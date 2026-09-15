from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import current_user
from ..db import get_pool
from ..schemas import Edge, Node

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    default_model: str | None = None


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
