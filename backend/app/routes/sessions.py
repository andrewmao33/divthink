from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from ..auth import current_user
from ..db import get_pool
from ..generation import cancel_generation
from ..schemas import Edge, Node

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    default_model: str | None = None


class SessionRename(BaseModel):
    title: str = Field(max_length=200)


class Session(BaseModel):
    id: UUID
    title: str
    default_model: str | None
    created_at: datetime
    updated_at: datetime


class SessionGraph(Session):
    nodes: list[Node]
    edges: list[Edge]


@router.post("", response_model=Session, status_code=201)
async def create_session(body: SessionCreate, user_id: UUID = Depends(current_user)):
    row = await get_pool().fetchrow(
        """
        INSERT INTO sessions (user_id, title, default_model)
        VALUES ($1, $2, $3)
        RETURNING id, title, default_model, created_at, updated_at
        """,
        user_id, body.title, body.default_model,
    )
    return dict(row)


@router.get("", response_model=list[Session])
async def list_sessions(user_id: UUID = Depends(current_user)):
    rows = await get_pool().fetch(
        """
        SELECT id, title, default_model, created_at, updated_at
        FROM sessions
        WHERE user_id = $1
        ORDER BY updated_at DESC
        """,
        user_id,
    )
    return [dict(r) for r in rows]


@router.patch("/{session_id}", status_code=204)
async def rename_session(session_id: UUID, body: SessionRename, user_id: UUID = Depends(current_user)):
    """Rename a canvas. updated_at is left alone: renaming isn't working in it,
    and shouldn't move it to the top of the list."""
    renamed = await get_pool().fetchval(
        "UPDATE sessions SET title = $3 WHERE id = $1 AND user_id = $2 RETURNING id",
        session_id, user_id, " ".join(body.title.split()),
    )
    if renamed is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return Response(status_code=204)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: UUID, user_id: UUID = Depends(current_user)):
    """Delete a canvas and everything on it. Its nodes, their edges and their
    attachments go with it (ON DELETE CASCADE)."""
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Locked so a prompt can't be sent to the canvas while it is going.
            found = await conn.fetchval(
                "SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2 FOR UPDATE",
                session_id, user_id,
            )
            if not found:
                raise HTTPException(status_code=404, detail="Session not found")
            # Stop any reply still being written before its row goes, so the job
            # can't write to a node that no longer exists.
            running = await conn.fetch(
                "SELECT id FROM nodes WHERE session_id = $1 AND status IN ('pending', 'streaming')",
                session_id,
            )
            if running:
                cancel_generation([r["id"] for r in running])
            await conn.execute("DELETE FROM sessions WHERE id = $1", session_id)
    return Response(status_code=204)


@router.get("/{session_id}", response_model=SessionGraph)
async def get_session(session_id: UUID, user_id: UUID = Depends(current_user)):
    pool = get_pool()
    session = await pool.fetchrow(
        """
        SELECT id, title, default_model, created_at, updated_at
        FROM sessions
        WHERE id = $1 AND user_id = $2
        """,
        session_id, user_id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    nodes = await pool.fetch(
        """
        SELECT id, type, content, model, position_x, position_y,
               status, metadata, created_at
        FROM nodes
        WHERE session_id = $1
        ORDER BY created_at
        """,
        session_id,
    )
    edges = await pool.fetch(
        "SELECT id, parent_id, child_id FROM edges WHERE session_id = $1",
        session_id,
    )
    return {
        **dict(session),
        "nodes": [dict(n) for n in nodes],
        "edges": [dict(e) for e in edges],
    }
