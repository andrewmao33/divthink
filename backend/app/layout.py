"""Where new boxes go on the canvas, in canvas pixels. The user drags from there.

Shared by the /generate route and by auto-branch, which both create nodes.

A box is as tall as its text, so new boxes are placed below a parent's BOTTOM
edge, not a fixed distance below its top. Only the browser knows how tall a
rendered reply is, so it sends the heights with the prompt; DEFAULT_BOX_HEIGHT
is the fallback when it doesn't.
"""

from math import ceil
from uuid import UUID

import asyncpg

GAP_BELOW_Y = 80  # clear space under a parent box
DEFAULT_BOX_HEIGHT = 240  # when the browser reported no height
MAX_BOX_HEIGHT = 20_000  # ignore implausible heights from the browser

# Both clear the 560px box width in frontend/src/Box.module.css; change them together.
SIBLING_GAP_X = 620  # each existing child of the same parent shifts the new one right
NEW_TREE_GAP_X = 1100  # a new tree starts this far right of the rightmost node

# Branching from a quote goes sideways instead of down: a reply can be 1500px tall,
# and a follow-up placed under one is off-screen. Continuing a thread still goes down.
BOX_WIDTH = 560  # frontend/src/Box.module.css
SIDE_GAP_X = 120  # gap between a reply and a branch beside it
BRANCH_STACK_Y = 360  # each further branch off the same reply sits this much lower

# A prompt box is plain text at a known width, so its height can be estimated
# rather than measured: the reply below it is placed before the box exists.
PROMPT_CHARS_PER_LINE = 75  # at 560px and --text-sm
PROMPT_LINE_HEIGHT = 22
PROMPT_PADDING_Y = 40

# (node id, x, y)
Placed = tuple[UUID, float, float]


def bottom_of(node_id: UUID, y: float, heights: dict[UUID, float]) -> float:
    """Where a box ends on the canvas, using the browser's measurement if it sent one."""
    height = heights.get(node_id, DEFAULT_BOX_HEIGHT)
    if not 0 < height <= MAX_BOX_HEIGHT:  # negative, zero, or implausible
        height = DEFAULT_BOX_HEIGHT
    return y + height


def estimate_prompt_height(prompt: str) -> float:
    """How tall the prompt box will be. It doesn't exist yet so it can't be
    measured, but unlike a reply it's plain text at a known width."""
    lines = sum(
        max(1, ceil(len(line) / PROMPT_CHARS_PER_LINE)) for line in (prompt.splitlines() or [""])
    )
    return PROMPT_PADDING_Y + lines * PROMPT_LINE_HEIGHT


async def below(
    conn: asyncpg.Connection, parent_id: UUID, x: float, y: float, heights: dict[UUID, float]
) -> tuple[float, float]:
    """Under the parent's bottom edge, shifted right past any children it already has."""
    children = await conn.fetchval("SELECT count(*) FROM edges WHERE parent_id = $1", parent_id)
    return x + children * SIBLING_GAP_X, bottom_of(parent_id, y, heights) + GAP_BELOW_Y


async def beside(
    conn: asyncpg.Connection, parent_id: UUID, x: float, y: float, slot: int | None = None
) -> tuple[float, float]:
    """To the right of the parent, stacked down past any branches it already has.

    Deliberately ignores the parent's height: a branch lines up with the TOP of the
    reply it came from, so both are on screen together. `slot` overrides the count
    for callers placing several branches at once, before any of them exist.
    """
    if slot is None:
        slot = await conn.fetchval("SELECT count(*) FROM edges WHERE parent_id = $1", parent_id)
    return x + BOX_WIDTH + SIDE_GAP_X, y + slot * BRANCH_STACK_Y


async def prompt_position(
    conn: asyncpg.Connection,
    session_id: UUID,
    parents: list[Placed],
    heights: dict[UUID, float],
    branch_from: UUID | None = None,
) -> tuple[float, float]:
    if not parents:  # new tree: to the right of everything on the canvas
        rightmost = await conn.fetchval(
            "SELECT max(position_x) FROM nodes WHERE session_id = $1", session_id
        )
        return (0.0 if rightmost is None else rightmost + NEW_TREE_GAP_X), 0.0
    # Branching from a quote: beside the reply it was taken from, not under it.
    branch_parent = next((p for p in parents if p[0] == branch_from), None)
    if branch_parent is not None:
        return await beside(conn, branch_parent[0], branch_parent[1], branch_parent[2])
    if len(parents) == 1:
        parent_id, x, y = parents[0]
        return await below(conn, parent_id, x, y, heights)
    # Merge: clear of whichever parent reaches lowest, centered between them.
    xs = [p[1] for p in parents]
    lowest = max(bottom_of(p[0], p[2], heights) for p in parents)
    return sum(xs) / len(xs), lowest + GAP_BELOW_Y
