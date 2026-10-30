import heapq
import re
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from itertools import count
from uuid import UUID

import asyncpg

from .providers.base import Attachment, Message

BRANCH_LABEL_MAX = 60

# A branch tag inside a turn's text, which would otherwise end its block early
# or open a fake one.
_BRANCH_TAG = re.compile(r"<(/?branch)", re.IGNORECASE)

_ANCESTORS_SQL = """
WITH RECURSIVE ancestors AS (
  SELECT id FROM nodes WHERE id = ANY($1::uuid[]) AND session_id = $2
  UNION
  SELECT e.parent_id
  FROM edges e
  JOIN ancestors a ON e.child_id = a.id
)
SELECT id, prompt, response, metadata, created_at
FROM nodes
WHERE id IN (SELECT id FROM ancestors)
  AND session_id = $2  -- guard against crossing sessions
"""


async def assemble_context(
    conn: asyncpg.Connection | asyncpg.Pool, session_id: UUID, node_ids: list[UUID]
) -> list[Message]:
    """The conversation for `node_ids`: those nodes plus all their ancestors,
    oldest first, as alternating user/assistant messages.

    Each card is a prompt and its response: two messages. The card being
    answered has no response yet, so the conversation ends on its prompt.

    A card with several parents is a merge, and gets a different shape: the
    history the branches share, then each branch on its own, then the prompt.
    Everything that continues from a merge keeps that shape and adds its own
    turns after it. Nothing above a merge can change once it exists, so the
    merge's context comes out the same on every later request.
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
    # Files sent with a prompt travel with it into the model's context.
    files: dict[UUID, list[Attachment]] = defaultdict(list)
    for row in await conn.fetch(
        """
        SELECT node_id, media_type, bytes, filename FROM attachments
        WHERE node_id = ANY($1::uuid[]) ORDER BY created_at, id
        """,
        list(nodes),
    ):
        files[row["node_id"]].append(
            Attachment(row["media_type"], bytes(row["bytes"]), row["filename"] or "")
        )

    parents_of: dict[UUID, list[UUID]] = defaultdict(list)
    for edge in edges:
        if edge["parent_id"] in nodes:
            parents_of[edge["child_id"]].append(edge["parent_id"])

    for node_id, node in nodes.items():
        nodes[node_id] = dict(node) | {"attachments": files.get(node_id, [])}

    targets = [node_id for node_id in node_ids if node_id in nodes]
    if len(targets) == 1:
        # Everything fetched is above the target, so it is the one node nothing
        # here continues from.
        return _conversation(nodes, edges, parents_of, set(nodes))
    return _to_messages(_oldest_first(nodes, edges))


def _conversation(
    nodes: dict, edges: list, parents_of: dict[UUID, list[UUID]], ids: set[UUID]
) -> list[Message]:
    """`ids`, a node and everything above it, as messages with real roles.

    A straight line is plain turns. Where the line meets a merge: the history
    the merged branches share, as a conversation of its own (so an older merge
    in it is written the same way), then the branches as blocks in one user
    message with the merge prompt, then the turns after it.
    """
    parents = _within(ids, parents_of)
    sinks = _sinks(nodes, ids, parents)
    if len(sinks) == 1:
        merge_id, after = _nearest_merge(sinks[0], parents)
        if merge_id is None:
            return _to_messages(_oldest_first(_subset(nodes, ids), edges))
        heads = sorted(parents[merge_id], key=_age(nodes))
    else:
        # Lines that only come together further down, each through merges of
        # its own: side by side as blocks, with no prompt of their own.
        merge_id, after, heads = None, [], sinks
    messages = _merged(nodes, edges, parents, heads, merge_id)
    for message in _to_messages([nodes[node_id] for node_id in after]):
        _append(messages, message.role, message.content, message.attachments)
    return messages


def _nearest_merge(
    start: UUID, parents_of: dict[UUID, list[UUID]]
) -> tuple[UUID | None, list[UUID]]:
    """Walks up from `start` along its single line of parents to the first merge.

    Returns that merge and the nodes that came after it, oldest first; or None
    when the line reaches the top of a thread without meeting one.
    """
    after: list[UUID] = []
    current = start
    seen = {start}
    while True:
        parents = parents_of.get(current, [])
        if len(parents) > 1:
            return current, list(reversed(after))
        if not parents or parents[0] in seen:
            return None, []
        after.append(current)
        current = parents[0]
        seen.add(current)


def _merged(
    nodes: dict,
    edges: list,
    parents_of: dict[UUID, list[UUID]],
    branch_heads: list[UUID],
    target_id: UUID | None,
) -> list[Message]:
    """Shared history as a normal conversation, then one <branch> block per branch,
    then the merge prompt and its response, if it has one yet (neither for lines
    that meet only further down).
    prompt.py tells the model what those blocks are.

    The blocks are text, so the files sent in the branches travel with the final
    message instead, and each block marks where its files were attached.
    """
    reachable = {head: _ancestors_of(head, parents_of) for head in branch_heads}
    shared = set.intersection(*reachable.values())

    messages: list[Message] = []
    for message in _conversation(nodes, edges, parents_of, shared) if shared else []:
        _append(messages, message.role, message.content, message.attachments)

    # Everything after the branches goes in one final user message. Should that
    # join a user message already there, its files come first, so the blocks'
    # numbering starts after them.
    joining = messages[-1].attachments if messages and messages[-1].role == "user" else []
    writer = _Blocks(nodes, edges, parents_of, list(joining))
    tail = writer.blocks(branch_heads, reachable, shared)

    files = writer.files[len(joining):]
    if target_id is not None:
        target = nodes[target_id]
        quote = _highlight_of(target)
        if quote:
            tail.append(quote)
        tail.append(target["prompt"].strip())
        files += target["attachments"]
    _append(messages, "user", "\n\n".join(part for part in tail if part), files)
    response = nodes[target_id]["response"].strip() if target_id is not None else ""
    if response:
        _append(messages, "assistant", response)
    return messages


@dataclass
class _Blocks:
    """Writes branches as <branch> blocks for one message, keeping count of the
    branches numbered so far and the files the blocks name, in the order named."""

    nodes: dict
    edges: list
    parents_of: dict[UUID, list[UUID]]
    files: list[Attachment]
    numbers: Iterator[int] = field(default_factory=lambda: count(1))

    def blocks(
        self, heads: list[UUID], reachable: dict[UUID, set[UUID]], emitted: set[UUID]
    ) -> list[str]:
        """The branches below what has already been written (`emitted`), as blocks.

        Branches that share history beyond it are one block: that shared part once,
        then a block nested inside for each way it splits. Without this, merging
        three branches where two split late would copy the two's common part into
        both of their blocks.
        """
        rest = {head: reachable[head] - emitted for head in heads}
        # A selected node that is an ancestor of another one adds nothing of its own.
        heads = [head for head in heads if rest[head]]

        blocks: list[str] = []
        for group in _overlapping(heads, rest):
            common = set.intersection(*(rest[head] for head in group))
            if len(group) == 1 or not common:
                # On its own; or tied to the others only through a merge further
                # up inside the branches: each written out in full, that merge
                # included.
                blocks += [self.block(rest[head]) for head in group]
                continue
            if sum(1 for head in group if rest[head] - common) <= 1:
                # Only one of them goes on past the shared part (the others are cards
                # above it): no split, so one block for the whole line.
                blocks.append(self.block(set.union(*(rest[head] for head in group))))
                continue
            lines, turns, merged = self.lines(common)  # before the blocks inside it, as it reads
            inner = self.blocks(group, reachable, emitted | common)
            blocks.append(_branch_block(self.label(turns, merged), lines, inner))
        return blocks

    def block(self, ids: set[UUID]) -> str:
        lines, turns, merged = self.lines(ids)
        return _branch_block(self.label(turns, merged), lines)

    def lines(self, ids: set[UUID]) -> tuple[list[str], list[Message], bool]:
        """A branch's own text, the turns written directly in it, and whether it
        holds a merge.

        A straight line is Prompt/Reply lines. A merge inside the branch is
        written as the merge message is: what its branches share, the branches
        as blocks nested here, then the merge prompt and the turns after it.
        Otherwise its lines would interleave by the time each was sent.
        """
        parents = _within(ids, self.parents_of)
        sinks = _sinks(self.nodes, ids, parents)
        if len(sinks) == 1:
            merge_id, after = _nearest_merge(sinks[0], parents)
            if merge_id is None:
                turns = _to_messages(_oldest_first(_subset(self.nodes, ids), self.edges))
                return _turn_lines(turns, self.files), turns, False
            heads = sorted(parents[merge_id], key=_age(self.nodes))
            below = [merge_id, *after]
        else:
            heads, below = sinks, []
        reachable = {head: _ancestors_of(head, parents) for head in heads}
        shared = set.intersection(*reachable.values())
        lines, turns, _ = self.lines(shared) if shared else ([], [], False)
        lines += self.blocks(heads, reachable, shared)
        after_turns = _to_messages([self.nodes[node_id] for node_id in below])
        lines += _turn_lines(after_turns, self.files)
        return lines, turns + after_turns, True

    def label(self, turns: list[Message], merged: bool) -> str:
        label = _label(turns, next(self.numbers))
        return f"{label} (merged)" if merged else label


def _within(ids: set[UUID], parents_of: dict[UUID, list[UUID]]) -> dict[UUID, list[UUID]]:
    """The parent links among `ids` alone."""
    return {
        child: [parent for parent in parents if parent in ids]
        for child, parents in parents_of.items()
        if child in ids
    }


def _sinks(nodes: dict, ids: set[UUID], parents_of: dict[UUID, list[UUID]]) -> list[UUID]:
    """The nodes in `ids` that nothing in `ids` continues from, oldest first."""
    continued = {parent for child in ids for parent in parents_of.get(child, [])}
    return sorted(ids - continued, key=_age(nodes))


def _age(nodes: dict):
    """Sort key: oldest first, by id when two were saved together, so the order
    is the same on every request."""
    return lambda node_id: (nodes[node_id]["created_at"], str(node_id))


def _overlapping(heads: list[UUID], rest: dict[UUID, set[UUID]]) -> list[list[UUID]]:
    """Heads grouped by shared history: two are together if their remaining
    ancestors overlap, directly or through another head. Groups and the heads in
    them keep the order of `heads`, so the result is the same on every request."""
    group_of = {head: i for i, head in enumerate(heads)}

    def root(i: int) -> int:
        while group_of[heads[i]] != i:
            i = group_of[heads[i]]
        return i

    for i, a in enumerate(heads):
        for b in heads[i + 1 :]:
            if rest[a] & rest[b]:
                ra, rb = root(group_of[a]), root(group_of[b])
                group_of[heads[max(ra, rb)]] = min(ra, rb)

    groups: dict[int, list[UUID]] = {}
    for i, head in enumerate(heads):
        groups.setdefault(root(i), []).append(head)
    return list(groups.values())


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


def _branch_block(label: str, lines: list[str], inner: list[str] | None = None) -> str:
    """One branch, flattened. It sits inside a user message, so the turns are
    labelled rather than carrying real roles (`lines`, from _turn_lines). `inner`
    are the branches it splits into, nested after its own turns."""
    body = "\n\n".join(lines + (inner or []))
    return f'<branch label="{label}">\n{body}\n</branch>'


def _turn_lines(turns: list[Message], files: list[Attachment]) -> list[str]:
    """A branch's turns as "Prompt: …" and "Reply: …". A turn's files are added
    to `files` and named after it, so call this in the order the text reads."""
    lines = []
    for turn in turns:
        line = f"{'Prompt' if turn.role == 'user' else 'Reply'}: {_escape(turn.content)}"
        if turn.attachments:
            line += "\n" + _attached(turn.attachments, files)
        lines.append(line)
    return lines


def _attached(turn_files: list[Attachment], files: list[Attachment]) -> str:
    """Where a turn's files were, as "[attached: a.pdf (file 2 above)]". The files
    themselves go with the message the blocks are in, before its text, numbered
    in the order the blocks name them. A file written out twice (branches tied
    only through a merge further up repeat their common part) is sent once."""
    named = []
    for file in turn_files:
        number = next((i for i, sent in enumerate(files, 1) if sent is file), None)
        if number is None:
            files.append(file)
            number = len(files)
        name = file.filename or ("a PDF" if file.is_pdf else "an image")
        named.append(f"{name} (file {number} above)")
    return f"[attached: {', '.join(named)}]"


def _escape(text: str) -> str:
    return _BRANCH_TAG.sub(r"&lt;\1", text)


def _label(turns: list[Message], number: int) -> str:
    """Names the branch after the prompt that started it, so the model can refer
    to it by something meaningful."""
    first = next((turn.content for turn in turns if turn.role == "user"), "")
    text = " ".join(first.split())
    if not text:
        return f"Branch {number}"
    if len(text) > BRANCH_LABEL_MAX:
        text = text[: BRANCH_LABEL_MAX - 1].rstrip() + "…"
    return _escape(text).replace('"', "'")  # keeps the attribute well-formed


def _oldest_first(nodes: dict, edges: list) -> list:
    """Order by created_at, but never put a node before its parents.

    Two cards can share a created_at, so time alone can't always tell a card
    from the one below it. Parents-first breaks those ties correctly.

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
    Kept on the card's metadata."""
    highlight = (node["metadata"] or {}).get("highlight")
    if not isinstance(highlight, dict):
        return None
    text = str(highlight.get("text") or "").strip()
    return _as_quote(text) if text else None


def _append(
    messages: list[Message], role: str, text: str, files: list[Attachment] | None = None
) -> None:
    """Back-to-back messages with the same role are combined into one."""
    if messages and messages[-1].role == role:
        messages[-1].content += "\n\n" + text
        messages[-1].attachments.extend(files or [])
    else:
        messages.append(Message(role, text, list(files or [])))


def _to_messages(ordered: list) -> list[Message]:
    """Each card as its prompt (with any quote and files), then its response."""
    messages: list[Message] = []
    for node in ordered:
        prompt = node["prompt"].strip()
        if prompt:
            quoted = _highlight_of(node)
            _append(
                messages,
                "user",
                "\n\n".join(([quoted] if quoted else []) + [prompt]),
                node.get("attachments"),
            )
        response = node["response"].strip()
        if response:
            _append(messages, "assistant", response)
    return messages
