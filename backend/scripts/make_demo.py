"""Create the public demo canvas shown on the landing page.

Run from backend/:
    .venv/bin/python -m scripts.make_demo

Writes a complete worked example — a question, two branches, and a merge — and
flags it is_public. Prints the session id to put in VITE_DEMO_SESSION_ID.
Safe to re-run: it replaces any canvas it made before.
"""

import asyncio
import json
from math import ceil

import asyncpg

from app.config import settings

TITLE = "Postgres or MongoDB for a chat app"

# Laid out so the whole conversation fits the landing page's frame at its fixed
# zoom. Heights are derived from the text rather than guessed, so editing the
# copy above moves the boxes instead of pushing them off the bottom.
BOX_WIDTH = 560
CHARS_PER_LINE = 72
LINE = 25
PADDING = 32
MAX_BOX = 470  # .scroller in Box.module.css caps a reply
GAP = 48  # generous: within a column the stacking relies on estimated heights
# Three columns, far enough apart that a 560-wide box can't reach the next one.
COL = (0, 620, 1240)


def height(text: str, quoted: bool = False) -> int:
    paras = [p for p in text.split("\n\n") if p.strip()]
    lines = sum(max(1, ceil(len(p) / CHARS_PER_LINE)) for p in paras)
    tall = PADDING + lines * LINE + (len(paras) - 1) * 12 + (34 if quoted else 0)
    return min(tall, MAX_BOX)

ROOT_Q = "I'm building a chat app. Should I use Postgres or MongoDB?"

ROOT_A = """Both will work at small scale, so the decision is about what gets hard later.

**Postgres** gives you joins and transactions. Chat is more relational than it looks — users, rooms, memberships, read receipts — and **message ordering within a room** is the thing you'll fight hardest to get right.

**MongoDB** gives you flexible documents and easier horizontal sharding. Messages are naturally document-shaped, and you won't need migrations every time you add a field.

The honest summary: Postgres is harder to outgrow, MongoDB is easier to start."""

BRANCH_1_Q = "How would message ordering actually work in Postgres?"
BRANCH_1_QUOTE = "message ordering within a room"
BRANCH_1_A = """Don't order by timestamp. Clocks drift between servers, and two messages written in the same millisecond have no defined order.

Use a per-room monotonic sequence: a `BIGINT` assigned inside the same transaction as the insert, unique per `(room_id, seq)`. Reads become `WHERE room_id = $1 AND seq < $2 ORDER BY seq DESC LIMIT 50` — one index, no sorting, and pagination that can't skip or repeat a message.

The cost is a hot row per room handing out sequence numbers. Fine to thousands of messages a second."""

BRANCH_2_Q = "What does MongoDB's scaling story actually buy me here?"
BRANCH_2_A = """Sharding by `room_id`, mostly. Each room's messages live on one shard, so reads for a room never fan out, and you add capacity by adding shards rather than by making one machine bigger.

That matters at the point where a single Postgres primary can't hold the write load — realistically millions of daily messages.

Below that, it buys you very little, and you pay for it in lost joins: read receipts and membership checks become application-side lookups you'd otherwise get for free."""

MERGE_Q = "Which fits a solo founder trying to ship in a month?"
MERGE_A = """Postgres, and it isn't close for your situation.

The sharding advantage only arrives at a scale you don't have, while the costs arrive on day one — every join you lose becomes application code you write, test and debug alone.

The ordering problem is real but solved: one sequence column and a unique index, and it's done for good.

Pick MongoDB when you've measured a write ceiling you can't raise. Until then it's paying today for a problem you may never have."""


async def main() -> None:
    conn = await asyncpg.connect(settings.database_url)
    try:
        # The app registers this on its pool (db.py); a bare connection needs it
        # too, or a dict bound to a jsonb column is rejected.
        await conn.set_type_codec(
            "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )
        user_id = await conn.fetchval("SELECT id FROM users ORDER BY created_at LIMIT 1")
        if user_id is None:
            raise SystemExit("No users yet — sign in once so there's an owner for the canvas.")

        # Reuses the existing row so the id stays stable between runs — only the
        # nodes are rebuilt (edges and attachments follow them by cascade).
        session_id = await conn.fetchval(
            "SELECT id FROM sessions WHERE user_id = $1 AND title = $2", user_id, TITLE
        )
        if session_id is None:
            session_id = await conn.fetchval(
                "INSERT INTO sessions (user_id, title, is_public) VALUES ($1, $2, true) RETURNING id",
                user_id, TITLE,
            )
        else:
            await conn.execute("UPDATE sessions SET is_public = true WHERE id = $1", session_id)
            await conn.execute("DELETE FROM nodes WHERE session_id = $1", session_id)

        async def node(type_, content, x, y, title=None, highlight=None, model=None):
            metadata = {}
            if title:
                metadata["title"] = title
            if highlight:
                metadata["highlight"] = highlight
            return await conn.fetchval(
                """
                INSERT INTO nodes (session_id, type, content, model, position_x, position_y, status, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, 'complete', $7) RETURNING id
                """,
                session_id, type_, content, model, x, y, metadata,
            )

        model = "claude-sonnet-5"
        boxes: list[tuple[float, float, float]] = []  # (x, y, height)

        # Left: the original thread running down, its second branch stepping right
        # so the two replies don't sit in one straight column.
        y = 0
        q0 = await node("user", ROOT_Q, COL[0], y)
        boxes.append((COL[0], y, height(ROOT_Q)))
        y += height(ROOT_Q) + GAP
        a0 = await node("assistant", ROOT_A, COL[0], y, "Postgres or MongoDB, honestly", model=model)
        boxes.append((COL[0], y, height(ROOT_A)))
        y += height(ROOT_A) + GAP
        q2 = await node("user", BRANCH_2_Q, COL[0], y)
        boxes.append((COL[0], y, height(BRANCH_2_Q)))
        y += height(BRANCH_2_Q) + GAP
        a2 = await node("assistant", BRANCH_2_A, COL[0], y, "What sharding actually buys", model=model)
        boxes.append((COL[0], y, height(BRANCH_2_A)))

        # Middle: the branch taken off a highlight, beside the reply it came from.
        y = 90
        q1 = await node("user", BRANCH_1_Q, COL[1], y,
                        highlight={"source_node_id": str(a0), "text": BRANCH_1_QUOTE})
        boxes.append((COL[1], y, height(BRANCH_1_Q, quoted=True)))
        y += height(BRANCH_1_Q, quoted=True) + GAP
        a1 = await node("assistant", BRANCH_1_A, COL[1], y, "Ordering messages with a sequence", model=model)
        boxes.append((COL[1], y, height(BRANCH_1_A)))

        # Right: the merge, drawing a line in from each branch.
        y = 340
        q3 = await node("user", MERGE_Q, COL[2], y)
        boxes.append((COL[2], y, height(MERGE_Q)))
        y += height(MERGE_Q) + GAP
        a3 = await node("assistant", MERGE_A, COL[2], y, "Why Postgres wins here", model=model)
        boxes.append((COL[2], y, height(MERGE_A)))

        for parent, child in [
            (q0, a0), (a0, q1), (q1, a1), (a0, q2), (q2, a2), (a1, q3), (a2, q3), (q3, a3),
        ]:
            await conn.execute(
                "INSERT INTO edges (session_id, parent_id, child_id) VALUES ($1, $2, $3)",
                session_id, parent, child,
            )

        # Proven, not eyeballed: nothing may cover anything else.
        rects = [(x, y, x + BOX_WIDTH, y + h) for x, y, h in boxes]
        for i, a in enumerate(rects):
            for b in rects[i + 1 :]:
                if a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]:
                    raise SystemExit(f"Boxes overlap: {a} and {b}")

        right = max(r[2] for r in rects)
        bottom = max(r[3] for r in rects)
        print(f"Demo canvas created.  content {int(right)} x {int(bottom)} units")
        print(f"  at zoom 0.7 that is {int(right * 0.7)} x {int(bottom * 0.7)} px — frame is 700 tall")
        print(f"\nVITE_DEMO_SESSION_ID={session_id}\n")
        print(f"View it at: http://localhost:5173/?demo={session_id}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
