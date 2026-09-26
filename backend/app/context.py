import heapq
from collections import defaultdict
from uuid import UUID

import asyncpg

from .providers.base import Message

BRANCH_LABEL_MAX = 60

_ANCESTORS_SQL = """
WITH RECURSIVE ancestors AS (
  SELECT id FROM nodes WHERE id = ANY($1::uuid[]) AND session_id = $2
  UNION
  SELECT e.parent_id
  FROM edges e
  JOIN ancestors a ON e.child_id = a.id
)
SELECT id, type, content, metadata, created_at
FROM nodes
WHERE id IN (SELECT id FROM ancestors)
  AND session_id = $2  -- guard against crossing sessions
"""


async def assemble_context(
    conn: asyncpg.Connection | asyncpg.Pool, session_id: UUID, node_ids: list[UUID]
) -> list[Message]:
    """The conversation for `node_ids`: those nodes plus all their ancestors,
    oldest first, as alternating user/assistant messages.

    A prompt with several parents is a merge, and gets a different shape: the
    history the branches share, then each branch on its own, then the prompt.
    """
    rows = await conn.fetch(_ANCESTORS_SQL, node_ids, session_id)
    if not rows:
        return []
    nodes = {r["id"]: r for r in rows}
    # Every parent of an ancestor is itself an ancestor, so these edges stay inside
    # the set. _oldest_first drops any that don't, since it's also given subsets.
    edges = await conn.fetch(
        "SELECT parent_id, child_id FROM edges WHERE child_id = ANY($1::uuid[])", list(nodes)
    )

    parents_of: dict[UUID, list[UUID]] = defaultdict(list)
    for edge in edges:
        if edge["parent_id"] in nodes:
            parents_of[edge["child_id"]].append(edge["parent_id"])

    targets = [node_id for node_id in node_ids if node_id in nodes]
    if len(targets) == 1:
        # Oldest branch first, so the order doesn't shift between requests.
        merged = sorted(parents_of[targets[0]], key=lambda i: (nodes[i]["created_at"], str(i)))
        if len(merged) > 1:
            return _merged(nodes, edges, targets[0], merged, parents_of)
    return _to_messages(_oldest_first(nodes, edges))


def _merged(
    nodes: dict,
    edges: list,
    target_id: UUID,
    branch_heads: list[UUID],
    parents_of: dict[UUID, list[UUID]],
) -> list[Message]:
    """Shared history as a normal conversation, then one <branch> block per branch,
    then the merge prompt. prompt.py tells the model what those blocks are."""
    reachable = [_ancestors_of(head, parents_of) for head in branch_heads]
    shared = set.intersection(*reachable)

    messages: list[Message] = []
    for message in _to_messages(_oldest_first(_subset(nodes, shared), edges)):
        _append(messages, message.role, message.content)

    # Everything after the branches goes in one final user message.
    tail: list[str] = []
    for number, (head, seen) in enumerate(zip(branch_heads, reachable, strict=True), start=1):
        only_here = seen - shared
        if not only_here:  # a selected node that is an ancestor of another one
            continue
        turns = _to_messages(_oldest_first(_subset(nodes, only_here), edges))
        tail.append(_branch_block(_label(turns, number), turns))

    target = nodes[target_id]
    quote = _highlight_of(target)
    if quote:
        tail.append(quote)
    tail.append(target["content"].strip())
    _append(messages, "user", "\n\n".join(part for part in tail if part))
    return messages


def _ancestors_of(start: UUID, parents_of: dict[UUID, list[UUID]]) -> set[UUID]:
    """`start` and everything above it."""
    seen = {start}
    stack = [start]
    while stack:
        for parent in parents_of.get(stack.pop(), []):
            if parent not in seen:
                seen.add(parent)
                stack.append(parent)
    return seen


def _subset(nodes: dict, ids: set[UUID]) -> dict:
    return {node_id: nodes[node_id] for node_id in ids}


def _branch_block(label: str, turns: list[Message]) -> str:
    """One branch, flattened. It sits inside a user message, so the turns are
    labelled rather than carrying real roles."""
    body = "\n\n".join(
        f"{'Prompt' if turn.role == 'user' else 'Reply'}: {turn.content}" for turn in turns
    )
    return f'<branch label="{label}">\n{body}\n</branch>'


def _label(turns: list[Message], number: int) -> str:
    """Names the branch after the prompt that started it, so the model can refer
    to it by something meaningful."""
    first = next((turn.content for turn in turns if turn.role == "user"), "")
    text = " ".join(first.split())
    if not text:
        return f"Branch {number}"
    if len(text) > BRANCH_LABEL_MAX:
        text = text[: BRANCH_LABEL_MAX - 1].rstrip() + "…"
    return text.replace('"', "'")  # keeps the attribute well-formed


def _oldest_first(nodes: dict, edges: list) -> list:
    """Order by created_at, but never put a node before its parents.

    Nodes saved by the same /generate call share a created_at (Postgres now() is
    the transaction start), so time alone can't tell a highlight from the
    prompt below it. Parents-first breaks those ties correctly.

    Edges reaching outside `nodes` are ignored: this is called with subsets of the
    graph, and a node waiting on a parent that isn't there would never be emitted.
    """
    waiting_on = {node_id: 0 for node_id in nodes}
    children = defaultdict(list)
    for e in edges:
        if e["parent_id"] not in nodes or e["child_id"] not in nodes:
            continue
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


def _as_quote(text: str) -> str:
    return "\n".join("> " + line for line in text.splitlines())


def _highlight_of(node) -> str | None:
    """The passage the user highlighted before writing this prompt, as a quote.

    Kept on the prompt node's metadata. Highlights used to be nodes of their own;
    those still exist on older canvases and are handled separately.
    """
    highlight = (node["metadata"] or {}).get("highlight")
    if not isinstance(highlight, dict):
        return None
    text = str(highlight.get("text") or "").strip()
    return _as_quote(text) if text else None


def _append(messages: list[Message], role: str, text: str) -> None:
    """Back-to-back messages with the same role are combined into one."""
    if messages and messages[-1].role == role:
        messages[-1].content += "\n\n" + text
    else:
        messages.append(Message(role, text))


def _to_messages(ordered: list) -> list[Message]:
    messages: list[Message] = []
    quotes: list[str] = []  # highlights waiting to be attached to the next prompt

    for node in ordered:
        text = node["content"].strip()
        if not text:
            continue
        if node["type"] == "highlight":  # older canvases: the quote was a node of its own
            quotes.append(_as_quote(text))
        elif node["type"] == "user":
            quoted = _highlight_of(node)  # the quote now rides on the prompt itself
            _append(messages, "user", "\n\n".join(quotes + ([quoted] if quoted else []) + [text]))
            quotes = []
        else:
            _append(messages, "assistant", text)

    if quotes:  # a highlight with no prompt after it still counts as user input
        _append(messages, "user", "\n\n".join(quotes))
    return messages
