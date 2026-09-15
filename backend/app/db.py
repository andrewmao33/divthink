import json

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    # Return jsonb columns as Python dicts instead of raw strings.
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


async def open_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        settings.database_url, min_size=1, max_size=10, init=_init_connection
    )


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


def get_pool() -> asyncpg.Pool:
    assert _pool is not None, "DB pool not open"
    return _pool
