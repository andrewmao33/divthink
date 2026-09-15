from collections import defaultdict
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .. import events
from ..auth import current_user
from ..db import get_pool

router = APIRouter(prefix="/sessions", tags=["nodes"])


class DeleteNodesRequest(BaseModel):
    node_ids: list[UUID] = Field(min_length=1)
    dry_run: bool = False  # only report what would be deleted


class DeleteNodesResponse(BaseModel):
    deleted_node_ids: list[UUID]


class Position(BaseModel):
    id: UUID
    x: float
    y: float


class SavePositionsRequest(BaseModel):
    positions: list[Position] = Field(min_length=1, max_length=1000)


@router.post("/{session_id}/nodes/delete", response_model=DeleteNodesResponse)
async def delete_nodes(session_id: UUID, body: DeleteNodesRequest, user_id: UUID = Depends(current_user)):
    """Delete nodes plus every descendant left with no parents (design.md, "Graph").

    A node that still has another parent survives, e.g. a merge keeps its other
    branch. Refused if anything it would remove is still pending or streaming.
    """
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            await _lock_session(conn, session_id, user_id)
            rows = await conn.fetch(
                "SELECT id, status FROM nodes WHERE session_id = $1 ORDER BY created_at", session_id
            )
            status = {r["id"]: r["status"] for r in rows}
            requested = list(dict.fromkeys(body.node_ids))
            for node_id in requested:
                if node_id not in status:
                    raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")

            edges = await conn.fetch(
                "SELECT parent_id, child_id FROM edges WHERE session_id = $1", session_id
            )
            doomed = _with_orphaned_descendants(set(requested), edges)
            if any(status[n] in ("pending", "streaming") for n in doomed):
                raise HTTPException(
                    status_code=409, detail="Can't delete while a reply is still being written."
                )
            ordered = [r["id"] for r in rows if r["id"] in doomed]

            if not body.dry_run:
                # Edges go with their nodes (ON DELETE CASCADE).
                await conn.execute("DELETE FROM nodes WHERE id = ANY($1::uuid[])", ordered)
                await conn.execute("UPDATE sessions SET updated_at = now() WHERE id = $1", session_id)

    if not body.dry_run:
        events.publish(session_id, "nodes_deleted", {"node_ids": [str(n) for n in ordered]})
    return DeleteNodesResponse(deleted_node_ids=ordered)


@router.patch("/{session_id}/positions", status_code=204)
async def save_positions(session_id: UUID, body: SavePositionsRequest, user_id: UUID = Depends(current_user)):
    """Save where boxes were dragged. Ids no longer on the canvas are ignored."""
    async with get_pool().acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2", session_id, user_id
        )
        if not exists:
            raise HTTPException(status_code=404, detail="Session not found")
        await conn.executemany(
            "UPDATE nodes SET position_x = $3, position_y = $4 WHERE id = $2 AND session_id = $1",
            [(session_id, p.id, p.x, p.y) for p in body.positions],
        )
    return Response(status_code=204)


async def _lock_session(conn: asyncpg.Connection, session_id: UUID, user_id: UUID) -> None:
    # Takes turns with /generate on the same canvas, so a delete can't race a new
    # prompt being attached to a node it removes.
    found = await conn.fetchval(
        "SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2 FOR UPDATE", session_id, user_id
    )
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")


def _with_orphaned_descendants(start: set[UUID], edges) -> set[UUID]:
    """`start` plus every node all of whose parents end up deleted."""
    parents: dict[UUID, set[UUID]] = defaultdict(set)
    children: dict[UUID, set[UUID]] = defaultdict(set)
    for e in edges:
        parents[e["child_id"]].add(e["parent_id"])
        children[e["parent_id"]].add(e["child_id"])

    doomed = set(start)
    frontier = list(start)
    while frontier:
        node = frontier.pop()
        for child in children[node]:
            # Re-checked each time another of its parents is doomed.
            if child not in doomed and parents[child] <= doomed:
                doomed.add(child)
                frontier.append(child)
    return doomed
