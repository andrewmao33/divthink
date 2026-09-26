import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..auth import current_user
from ..canvas import announce_new_nodes, insert_edges, insert_node
from ..db import get_pool
from ..generation import start_generation
from ..keys import api_key_for
from ..layout import GAP_BELOW_Y, Placed, estimate_prompt_height, prompt_position
from ..providers.catalog import DEFAULT_MODEL, LABELS, MODELS, PROVIDER_LABELS

router = APIRouter(prefix="/sessions", tags=["generate"])
log = logging.getLogger(__name__)

TITLE_MAX = 60
MAX_TEXT_CHARS = 50_000  # prompts and quotes


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value.strip()


class Highlight(BaseModel):
    source_node_id: UUID
    text: str = Field(max_length=MAX_TEXT_CHARS)

    _check_text = field_validator("text")(_not_blank)


class GenerateRequest(BaseModel):
    parent_ids: list[UUID] = Field(default=[], max_length=50)
    prompt: str = Field(max_length=MAX_TEXT_CHARS)
    model: str = DEFAULT_MODEL
    highlight: Highlight | None = None
    # Rendered height of each parent box, measured by the browser. Optional: an
    # older tab or a direct API call just gets DEFAULT_BOX_HEIGHT.
    parent_heights: dict[UUID, float] = Field(default={}, max_length=51)

    _check_prompt = field_validator("prompt")(_not_blank)


class GenerateResponse(BaseModel):
    user_node_id: UUID
    assistant_node_id: UUID
    session_title: str  # set from the first prompt, so the canvas list can update




@router.post("/{session_id}/generate", response_model=GenerateResponse, status_code=201)
async def generate(session_id: UUID, body: GenerateRequest, user_id: UUID = Depends(current_user)):
    """Save the prompt and an empty reply node. The AI fills the reply in later."""
    if body.model not in MODELS:
        raise HTTPException(status_code=422, detail=f"Unsupported model: {body.model}")
    provider = MODELS[body.model]
    # The user's own key, decrypted for this reply only.
    api_key = await api_key_for(user_id, provider)
    if not api_key:
        raise HTTPException(
            status_code=422,
            detail=f"Add your {PROVIDER_LABELS[provider]} API key to use {LABELS[body.model]} (menu → API keys).",
        )

    parent_ids = list(dict.fromkeys(body.parent_ids))  # drop duplicates, keep order
    heights = body.parent_heights
    source_id = body.highlight.source_node_id if body.highlight else None
    referenced = list(dict.fromkeys(parent_ids + ([source_id] if source_id else [])))

    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Locking the session row makes concurrent sends to the same canvas
            # take turns, so they don't compute the same positions.
            session = await conn.fetchrow(
                "SELECT title FROM sessions WHERE id = $1 AND user_id = $2 FOR UPDATE",
                session_id, user_id,
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

            # The quote rides on the prompt node rather than being a node of its own,
            # so branching makes two boxes instead of three. The reply it came from
            # is the prompt's parent, so the chain stays reply -> prompt -> reply.
            prompt_metadata: dict = {}
            if body.highlight:
                prompt_metadata["highlight"] = {
                    "source_node_id": str(source_id),
                    "text": body.highlight.text,
                }
                if not any(p[0] == source_id for p in parents):
                    source = found[source_id]
                    parents = parents + [(source_id, source["position_x"], source["position_y"])]

            ux, uy = await prompt_position(conn, session_id, parents, heights, source_id)
            user_node_id = await insert_node(
                conn, session_id, "user", body.prompt, "complete", ux, uy, metadata=prompt_metadata
            )
            assistant_id = await insert_node(
                conn, session_id, "assistant", "", "pending",
                ux, uy + estimate_prompt_height(body.prompt) + GAP_BELOW_Y,
                model=body.model,
            )
            await insert_edges(
                conn, session_id, [(p[0], user_node_id) for p in parents] + [(user_node_id, assistant_id)]
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
    await announce_new_nodes(session_id, [user_node_id, assistant_id])
    start_generation(session_id, user_node_id, assistant_id, body.model, api_key)

    return GenerateResponse(
        user_node_id=user_node_id,
        assistant_node_id=assistant_id,
        session_title=session_title,
    )


def _title_from(prompt: str) -> str:
    one_line = " ".join(prompt.split())
    if len(one_line) <= TITLE_MAX:
        return one_line
    return one_line[: TITLE_MAX - 1].rstrip() + "…"
