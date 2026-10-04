import base64
import binascii
import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..auth import current_user
from ..canvas import announce_new_nodes, insert_edges, insert_node
from ..db import get_pool
from ..generation import start_generation
from ..keys import api_key_for
from ..layout import (
    GAP_BELOW_Y,
    Placed,
    estimate_prompt_height,
    free_block,
    reserved_block,
    prompt_position,
)
from ..providers.catalog import DEFAULT_MODEL, LABELS, MODELS, PROVIDER_LABELS

router = APIRouter(prefix="/sessions", tags=["generate"])
log = logging.getLogger(__name__)

TITLE_MAX = 60
MAX_TEXT_CHARS = 50_000  # prompts and quotes
MAX_ATTACHMENTS = 8
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_PDF_BYTES = 16 * 1024 * 1024  # PDFs are bigger; Anthropic's request cap is 32 MB
MAX_ATTACHMENTS_BYTES = 24 * 1024 * 1024  # all of them together


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value.strip()


class Highlight(BaseModel):
    source_node_id: UUID
    text: str = Field(max_length=MAX_TEXT_CHARS)

    _check_text = field_validator("text")(_not_blank)


class Attachment(BaseModel):
    """A file pasted, dropped or picked in the chat box, base64 as sent by the browser."""

    media_type: Literal[
        "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"
    ]
    data: str
    filename: str = Field(default="", max_length=200)


class GenerateRequest(BaseModel):
    parent_ids: list[UUID] = Field(default=[], max_length=50)
    prompt: str = Field(max_length=MAX_TEXT_CHARS)
    model: str = DEFAULT_MODEL
    highlight: Highlight | None = None
    # Rendered height of every box on the canvas, measured by the browser. Used
    # both to place below a parent and to avoid landing on anything else.
    # Optional: an older tab or a direct API call just gets DEFAULT_BOX_HEIGHT.
    parent_heights: dict[UUID, float] = Field(default={}, max_length=500)
    attachments: list[Attachment] = Field(default=[], max_length=MAX_ATTACHMENTS)
    web_search: bool = False

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

    files = _decoded(body.attachments)
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
            # The prompt and its reply are placed together, reserving the room the
            # reply will need once it has finished streaming — not the room it
            # takes while still empty.
            ux, uy = await free_block(
                conn, session_id, ux, uy, reserved_block(body.prompt, len(files)), heights
            )
            user_node_id = await insert_node(
                conn, session_id, "user", body.prompt, "complete", ux, uy, metadata=prompt_metadata
            )
            assistant_id = await insert_node(
                conn, session_id, "assistant", "", "pending",
                ux, uy + estimate_prompt_height(body.prompt, len(files)) + GAP_BELOW_Y,
                model=body.model,
            )
            await insert_edges(
                conn, session_id, [(p[0], user_node_id) for p in parents] + [(user_node_id, assistant_id)]
            )
            if files:
                # The descriptors go onto the prompt node so the browser knows what
                # to fetch; the bytes are never part of the graph payload.
                saved = []
                for media_type, data, filename in files:
                    attachment_id = await conn.fetchval(
                        """
                        INSERT INTO attachments (session_id, node_id, media_type, bytes, filename)
                        VALUES ($1, $2, $3, $4, $5) RETURNING id
                        """,
                        session_id, user_node_id, media_type, data, filename or None,
                    )
                    saved.append(
                        {"id": str(attachment_id), "media_type": media_type, "filename": filename}
                    )
                await conn.execute(
                    "UPDATE nodes SET metadata = metadata || $2::jsonb WHERE id = $1",
                    user_node_id, {"attachments": saved},
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
    start_generation(session_id, user_node_id, assistant_id, body.model, api_key, body.web_search)

    return GenerateResponse(
        user_node_id=user_node_id,
        assistant_node_id=assistant_id,
        session_title=session_title,
    )


def _decoded(attachments: list[Attachment]) -> list[tuple[str, bytes, str]]:
    """Base64 in, raw bytes out, with the size limits enforced before any write."""
    decoded: list[tuple[str, bytes, str]] = []
    total = 0
    for attachment in attachments:
        try:
            data = base64.b64decode(attachment.data, validate=True)
        except (binascii.Error, ValueError) as e:
            raise HTTPException(status_code=422, detail="A file couldn't be read.") from e
        if not data:
            raise HTTPException(status_code=422, detail="A file was empty.")
        is_pdf = attachment.media_type == "application/pdf"
        limit = MAX_PDF_BYTES if is_pdf else MAX_IMAGE_BYTES
        if len(data) > limit:
            raise HTTPException(
                status_code=413,
                detail="PDFs must be under 16 MB." if is_pdf else "Images must be under 4 MB.",
            )
        total += len(data)
        if total > MAX_ATTACHMENTS_BYTES:
            raise HTTPException(status_code=413, detail="Those files are too large together.")
        decoded.append((attachment.media_type, data, attachment.filename))
    return decoded


def _title_from(prompt: str) -> str:
    one_line = " ".join(prompt.split())
    if len(one_line) <= TITLE_MAX:
        return one_line
    return one_line[: TITLE_MAX - 1].rstrip() + "…"
