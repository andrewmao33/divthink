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

# Boxes are capped in CSS (.scroller in Box.module.css), so a box can never grow
# past a known maximum however long its text is. New boxes reserve that maximum
# rather than their height-when-empty: a reply is created empty and then grows as
# it streams, and anything placed for the empty size gets overlapped on arrival.
MAX_PROMPT_HEIGHT = 320  # .user .scroller 220 + padding, quote and a filename row
MAX_REPLY_HEIGHT = 520  # .scroller 420 + padding, the thinking line and token counts
IMAGE_HEIGHT = 250  # a thumbnail row on a prompt, at .image max-height

# A prompt box is plain text at a known width, so its height can be estimated
# rather than measured: the reply below it is placed before the box exists.
PROMPT_CHARS_PER_LINE = 75  # at 560px and --text-sm
PROMPT_LINE_HEIGHT = 22
PROMPT_PADDING_Y = 40

# (node id, x, y)
Placed = tuple[UUID, float, float]

# Searching for a clear spot: step down first, since a thread reads downwards,
# and only move sideways once a column is full.
STEP_Y = 40
STEP_X = BOX_WIDTH + SIDE_GAP_X
MAX_STEPS_DOWN = 60


def bottom_of(node_id: UUID, y: float, heights: dict[UUID, float]) -> float:
    """Where a box ends on the canvas, using the browser's measurement if it sent one."""
    height = heights.get(node_id, DEFAULT_BOX_HEIGHT)
    if not 0 < height <= MAX_BOX_HEIGHT:  # negative, zero, or implausible
        height = DEFAULT_BOX_HEIGHT
    return y + height


def estimate_prompt_height(prompt: str, attachments: int = 0) -> float:
    """How tall the prompt box will be. It doesn't exist yet so it can't be
    measured, but unlike a reply it's plain text at a known width — and it can't
    exceed MAX_PROMPT_HEIGHT because the CSS caps it."""
    lines = sum(
        max(1, ceil(len(line) / PROMPT_CHARS_PER_LINE)) for line in (prompt.splitlines() or [""])
    )
    text = min(PROMPT_PADDING_Y + lines * PROMPT_LINE_HEIGHT, MAX_PROMPT_HEIGHT)
    return text + (IMAGE_HEIGHT if attachments else 0)


def reserved_block(prompt: str, attachments: int = 0) -> float:
    """Space a new prompt and its reply need, once the reply has finished growing."""
    return estimate_prompt_height(prompt, attachments) + GAP_BELOW_Y + MAX_REPLY_HEIGHT


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


def _overlaps(ax: float, ay: float, aw: float, ah: float, bx: float, by: float, bw: float, bh: float) -> bool:
    return ax < bx + bw and ax + aw > bx and ay < by + bh and ay + ah > by


async def free_block(
    conn: asyncpg.Connection,
    session_id: UUID,
    x: float,
    y: float,
    height: float,
    heights: dict[UUID, float],
) -> tuple[float, float]:
    """The nearest spot at or below (x, y) where a block of `height` hits nothing.

    A branch is placed beside the reply it came from, but that space may already
    hold a box from another thread or one the user dragged there — so the chosen
    spot is checked against every box on the canvas, not just the source's own
    children. The prompt and its reply are placed as one block so they can't be
    split by something sitting between them.
    """
    rows = await conn.fetch(
        "SELECT id, position_x, position_y FROM nodes WHERE session_id = $1", session_id
    )
    boxes = [
        (r["position_x"], r["position_y"], BOX_WIDTH, bottom_of(r["id"], 0.0, heights))
        for r in rows
    ]
    if not boxes:
        return x, y

    start_y = y
    for column in range(8):  # after enough full columns, give up and stack anyway
        candidate_x = x + column * STEP_X
        candidate_y = start_y
        for _ in range(MAX_STEPS_DOWN):
            clear = not any(
                _overlaps(candidate_x, candidate_y, BOX_WIDTH, height, bx, by, bw, bh)
                for bx, by, bw, bh in boxes
            )
            if clear:
                return candidate_x, candidate_y
            # Drop just past whatever is in the way, rather than creeping down.
            lowest = max(
                (by + bh for bx, by, bw, bh in boxes
                 if _overlaps(candidate_x, candidate_y, BOX_WIDTH, height, bx, by, bw, bh)),
                default=candidate_y,
            )
            candidate_y = max(lowest + GAP_BELOW_Y, candidate_y + STEP_Y)
    return x, y
