"""Creating nodes and telling every open tab about them.

Shared by the /generate route and by auto-branch, which both add boxes to a canvas.
"""

import logging
from uuid import UUID

import asyncpg

from . import events
from .db import get_pool
from .schemas import NODE_COLUMNS, Edge, Node

log = logging.getLogger(__name__)


async def insert_node(
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


async def insert_edges(
    conn: asyncpg.Connection, session_id: UUID, pairs: list[tuple[UUID, UUID]]
) -> None:
    await conn.executemany(
        "INSERT INTO edges (session_id, parent_id, child_id) VALUES ($1, $2, $3)",
        [(session_id, parent, child) for parent, child in pairs],
    )


async def announce_new_nodes(session_id: UUID, node_ids: list[UUID]) -> None:
    """Publish node_created for each new node, parents first, so every open tab
    can draw the boxes without refetching the whole canvas."""
    if not node_ids:
        return
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
