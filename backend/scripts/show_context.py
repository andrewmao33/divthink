"""Print the conversation that would be sent to the AI for a node.

Run from backend/:
    .venv/bin/python -m scripts.show_context <node_id>
"""

import asyncio
import sys
from uuid import UUID

import asyncpg

from app.config import settings
from app.context import assemble_context


async def main() -> None:
    try:
        node_id = UUID(sys.argv[1])
    except (IndexError, ValueError):
        print(__doc__)
        raise SystemExit(1)

    conn = await asyncpg.connect(settings.database_url)
    try:
        session_id = await conn.fetchval("SELECT session_id FROM nodes WHERE id = $1", node_id)
        if session_id is None:
            print("No node with that id.")
            return
        messages = await assemble_context(conn, session_id, [node_id])
    finally:
        await conn.close()

    for i, m in enumerate(messages, 1):
        print(f"--- {i}. {m.role} ---\n{m.content}\n")
    print(f"[{len(messages)} message(s)]")


if __name__ == "__main__":
    asyncio.run(main())
