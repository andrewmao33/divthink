"""The one canvas anyone can read without an account.

Everything here skips `current_user`, so `is_public` has to be part of every
query — it is the only thing standing between these routes and someone else's
conversations. There is deliberately no listing endpoint: a canvas can only be
reached by its id, which you only have if it was given to you.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from ..config import settings
from ..db import get_pool
from ..schemas import NODE_COLUMNS, Edge, Node

router = APIRouter(prefix="/public", tags=["public"])

# In production the content is fixed, so caching it takes load off the only
# endpoints here with no authentication in front of them. In development the demo
# gets rebuilt constantly, and a cached copy just hides every change.
CACHE = "public, max-age=300" if settings.is_production else "no-store"


class PublicSession(BaseModel):
    """Deliberately narrower than the signed-in shape: no user id, no timestamps,
    nothing about who made it."""

    id: UUID
    title: str
    nodes: list[Node]
    edges: list[Edge]


@router.get("/sessions/{session_id}", response_model=PublicSession)
async def get_public_session(session_id: UUID, response: Response):
    pool = get_pool()
    session = await pool.fetchrow(
        "SELECT id, title FROM sessions WHERE id = $1 AND is_public", session_id
    )
    if session is None:
        raise HTTPException(status_code=404, detail="No such canvas")

    nodes = await pool.fetch(
        f"SELECT {NODE_COLUMNS} FROM nodes WHERE session_id = $1 ORDER BY created_at", session_id
    )
    edges = await pool.fetch(
        "SELECT id, parent_id, child_id FROM edges WHERE session_id = $1", session_id
    )
    response.headers["Cache-Control"] = CACHE
    return PublicSession(
        id=session["id"],
        title=session["title"],
        nodes=[Node(**dict(n)) for n in nodes],
        edges=[Edge(**dict(e)) for e in edges],
    )


@router.get("/sessions/{session_id}/attachments/{attachment_id}")
async def get_public_attachment(session_id: UUID, attachment_id: UUID):
    """Images on a public canvas. The `is_public` join is what stops an id from a
    private canvas being read through this route."""
    row = await get_pool().fetchrow(
        """
        SELECT a.media_type, a.bytes
        FROM attachments a
        JOIN sessions s ON s.id = a.session_id
        WHERE a.id = $1 AND a.session_id = $2 AND s.is_public
        """,
        attachment_id, session_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(
        content=bytes(row["bytes"]),
        media_type=row["media_type"],
        headers={"Cache-Control": CACHE},
    )
