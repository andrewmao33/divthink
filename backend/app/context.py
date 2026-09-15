import heapq
from collections import defaultdict
from uuid import UUID

import asyncpg

from .providers.base import Message

_ANCESTORS_SQL = """
WITH RECURSIVE ancestors AS (
  SELECT id FROM nodes WHERE id = ANY($1::uuid[]) AND session_id = $2
  UNION
  SELECT e.parent_id
  FROM edges e
  JOIN ancestors a ON e.child_id = a.id
)
SELECT id, type, content, created_at
FROM nodes
WHERE id IN (SELECT id FROM ancestors)
  AND session_id = $2  -- guard against crossing sessions
"""


async def assemble_context(
    conn: asyncpg.Connection | asyncpg.Pool, session_id: UUID, node_ids: list[UUID]
) -> list[Message]:
    """The conversation for `node_ids`: those nodes plus all their ancestors,
    oldest first, as alternating user/assistant messages."""
    rows = await conn.fetch(_ANCESTORS_SQL, node_ids, session_id)
    if not rows:
        return []
    nodes = {r["id"]: r for r in rows}
    # Every parent of an ancestor is itself an ancestor, so these edges stay inside the set.
    edges = await conn.fetch(
        "SELECT parent_id, child_id FROM edges WHERE child_id = ANY($1::uuid[])", list(nodes)
    )
    return _to_messages(_oldest_first(nodes, edges))


def _oldest_first(nodes: dict, edges: list) -> list:
    """Order by created_at, but never put a node before its parents.

    Nodes saved by the same /generate call share a created_at (Postgres now() is
    the transaction start), so time alone can't tell a highlight from the
    prompt below it. Parents-first breaks those ties correctly.
    """
    waiting_on = {node_id: 0 for node_id in nodes}
    children = defaultdict(list)
    for e in edges:
        waiting_on[e["child_id"]] += 1
        children[e["parent_id"]].append(e["child_id"])

    def entry(node_id):
        return (nodes[node_id]["created_at"], str(node_id), node_id)

    ready = [entry(i) for i, n in waiting_on.items() if n == 0]
    heapq.heapify(ready)
    ordered = []
    while ready:
        _, _, node_id = heapq.heappop(ready)
        ordered.append(nodes[node_id])
        for child in children[node_id]:
            waiting_on[child] -= 1
            if waiting_on[child] == 0:
                heapq.heappush(ready, entry(child))
    return ordered


def _to_messages(ordered: list) -> list[Message]:
    messages: list[Message] = []
    quotes: list[str] = []  # highlights waiting to be attached to the next prompt

    def add(role: str, text: str) -> None:
        # Back-to-back messages with the same role are combined into one.
        if messages and messages[-1].role == role:
            messages[-1].content += "\n\n" + text
        else:
            messages.append(Message(role, text))

    for node in ordered:
        text = node["content"].strip()
        if not text:
            continue
        if node["type"] == "highlight":
            quotes.append("\n".join("> " + line for line in text.splitlines()))
        elif node["type"] == "user":
            add("user", "\n\n".join(quotes + [text]))
            quotes = []
        else:
            add("assistant", text)

    if quotes:  # a highlight with no prompt after it still counts as user input
        add("user", "\n\n".join(quotes))
    return messages
