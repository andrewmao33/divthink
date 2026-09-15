import logging
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from .. import events
from ..config import DEV_USER_ID
from ..db import get_pool
from ..generation import start_generation
from ..providers.catalog import DEFAULT_MODEL, MODELS, provider_configured
from ..schemas import NODE_COLUMNS, Edge, Node

router = APIRouter(prefix="/sessions", tags=["generate"])
log = logging.getLogger(__name__)

# Starting positions in canvas pixels. The user drags from there.
BELOW_PARENT = 320  # parent (often a long reply) -> new node
BELOW_PROMPT = 160  # prompt -> its reply
SIBLING_GAP_X = 420  # each existing child of the same parent shifts the new one right
NEW_TREE_GAP_X = 800  # a new tree starts this far right of the rightmost node
TITLE_MAX = 60


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value.strip()


class Highlight(BaseModel):
    source_node_id: UUID
    text: str

    _check_text = field_validator("text")(_not_blank)


class GenerateRequest(BaseModel):
    parent_ids: list[UUID] = []
    prompt: str
    model: str = DEFAULT_MODEL
    highlight: Highlight | None = None

    _check_prompt = field_validator("prompt")(_not_blank)


class GenerateResponse(BaseModel):
    user_node_id: UUID
    assistant_node_id: UUID
    highlight_node_id: UUID | None = None
    session_title: str  # set from the first prompt, so the canvas list can update


# (node id, x, y)
Placed = tuple[UUID, float, float]


@router.post("/{session_id}/generate", response_model=GenerateResponse, status_code=201)
async def generate(session_id: UUID, body: GenerateRequest):
    """Save the prompt and an empty reply node. The AI fills the reply in later."""
    if body.model not in MODELS:
        raise HTTPException(status_code=422, detail=f"Unsupported model: {body.model}")
    if not provider_configured(MODELS[body.model]):
        raise HTTPException(status_code=422, detail=f"No API key is set for {body.model}.")

    parent_ids = list(dict.fromkeys(body.parent_ids))  # drop duplicates, keep order
    source_id = body.highlight.source_node_id if body.highlight else None
    referenced = list(dict.fromkeys(parent_ids + ([source_id] if source_id else [])))

    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Locking the session row makes concurrent sends to the same canvas
            # take turns, so they don't compute the same positions.
            session = await conn.fetchrow(
                "SELECT title FROM sessions WHERE id = $1 AND user_id = $2 FOR UPDATE",
                session_id, DEV_USER_ID,
            )
            if session is None:
                raise HTTPException(status_code=404, detail="Session not found")

            rows = await conn.fetch(
                """
                SELECT id, status, position_x, position_y
                FROM nodes
                WHERE session_id = $1 AND id = ANY($2::uuid[])
                """,
                session_id, referenced,
            )
            found = {r["id"]: r for r in rows}
            for node_id in referenced:
                if node_id not in found:
                    raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")
                # A node that is still streaming (or failed) has incomplete text.
                if found[node_id]["status"] != "complete":
                    raise HTTPException(status_code=409, detail=f"Node is not finished: {node_id}")

            parents: list[Placed] = [
                (p, found[p]["position_x"], found[p]["position_y"]) for p in parent_ids
            ]

            highlight_id = None
            if body.highlight:
                source = found[source_id]
                hx, hy = await _below(conn, source_id, source["position_x"], source["position_y"])
                highlight_id = await _insert_node(
                    conn, session_id, "highlight", body.highlight.text, "complete", hx, hy,
                    metadata={"source_node_id": str(source_id)},
                )
                await _insert_edges(conn, session_id, [(source_id, highlight_id)])
                # The highlight takes the source's place as a parent of the prompt.
                parents = [(highlight_id, hx, hy)] + [p for p in parents if p[0] != source_id]

            ux, uy = await _prompt_position(conn, session_id, parents)
            user_id = await _insert_node(conn, session_id, "user", body.prompt, "complete", ux, uy)
            assistant_id = await _insert_node(
                conn, session_id, "assistant", "", "pending", ux, uy + BELOW_PROMPT,
                model=body.model,
            )
            await _insert_edges(
                conn, session_id, [(p[0], user_id) for p in parents] + [(user_id, assistant_id)]
            )

            session_title = await conn.fetchval(
                """
                UPDATE sessions
                SET title = CASE WHEN title = '' THEN $2 ELSE title END,
                    updated_at = now()
                WHERE id = $1
                RETURNING title
                """,
                session_id, _title_from(body.prompt),
            )

    # Only after the transaction has committed, so listeners and the job can see
    # the new nodes. Announce first so tabs draw the boxes before any tokens arrive.
    await _announce_new_nodes(session_id, [i for i in (highlight_id, user_id, assistant_id) if i])
    start_generation(session_id, user_id, assistant_id, body.model)

    return GenerateResponse(
        user_node_id=user_id,
        assistant_node_id=assistant_id,
        highlight_node_id=highlight_id,
        session_title=session_title,
    )


async def _below(conn: asyncpg.Connection, parent_id: UUID, x: float, y: float) -> tuple[float, float]:
    """Below the parent, shifted right past any children it already has."""
    children = await conn.fetchval("SELECT count(*) FROM edges WHERE parent_id = $1", parent_id)
    return x + children * SIBLING_GAP_X, y + BELOW_PARENT


async def _prompt_position(
    conn: asyncpg.Connection, session_id: UUID, parents: list[Placed]
) -> tuple[float, float]:
    if not parents:  # new tree: to the right of everything on the canvas
        rightmost = await conn.fetchval(
            "SELECT max(position_x) FROM nodes WHERE session_id = $1", session_id
        )
        return (0.0 if rightmost is None else rightmost + NEW_TREE_GAP_X), 0.0
    if len(parents) == 1:
        parent_id, x, y = parents[0]
        return await _below(conn, parent_id, x, y)
    # Merge: below the lowest parent, centered between them.
    xs = [p[1] for p in parents]
    return sum(xs) / len(xs), max(p[2] for p in parents) + BELOW_PARENT


async def _insert_node(
    conn: asyncpg.Connection,
    session_id: UUID,
    type: str,
    content: str,
    status: str,
    x: float,
    y: float,
    model: str | None = None,
    metadata: dict | None = None,
) -> UUID:
    return await conn.fetchval(
        """
        INSERT INTO nodes (session_id, type, content, model, position_x, position_y, status, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        """,
        session_id, type, content, model, x, y, status, metadata or {},
    )


async def _insert_edges(
    conn: asyncpg.Connection, session_id: UUID, pairs: list[tuple[UUID, UUID]]
) -> None:
    await conn.executemany(
        "INSERT INTO edges (session_id, parent_id, child_id) VALUES ($1, $2, $3)",
        [(session_id, parent, child) for parent, child in pairs],
    )


async def _announce_new_nodes(session_id: UUID, node_ids: list[UUID]) -> None:
    """Publish node_created for each new node, parents first, so every open tab
    can draw the boxes without refetching the whole canvas."""
    try:
        pool = get_pool()
        rows = await pool.fetch(
            f"SELECT {NODE_COLUMNS} FROM nodes WHERE id = ANY($1::uuid[])", node_ids
        )
        edges = await pool.fetch(
            "SELECT id, parent_id, child_id FROM edges WHERE child_id = ANY($1::uuid[])", node_ids
        )
    except Exception:
        # The nodes are saved either way; tabs will see them on their next load.
        log.exception("could not announce new nodes in session %s", session_id)
        return

    by_id = {r["id"]: r for r in rows}
    for node_id in node_ids:
        events.publish(session_id, "node_created", {
            "node_id": str(node_id),
            "node": Node(**dict(by_id[node_id])).model_dump(mode="json"),
            "edges": [
                Edge(**dict(e)).model_dump(mode="json") for e in edges if e["child_id"] == node_id
            ],
        })


def _title_from(prompt: str) -> str:
    one_line = " ".join(prompt.split())
    if len(one_line) <= TITLE_MAX:
        return one_line
    return one_line[: TITLE_MAX - 1].rstrip() + "…"
