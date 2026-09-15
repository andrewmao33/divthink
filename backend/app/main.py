import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from . import db
from .routes import generate, models, nodes, sessions, stream

log = logging.getLogger(__name__)

INTERRUPTED = "Interrupted because the server restarted. Try again."


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.open_pool()  # on startup
    await mark_interrupted_replies()
    yield
    await db.close_pool()  # on shutdown


async def mark_interrupted_replies() -> int:
    """Replies left pending/streaming by a previous run can never finish, since
    generation jobs live in this process. Nothing is generating yet at startup,
    so every such node was cut off. (Assumes a single backend instance.)"""
    result = await db.get_pool().execute(
        """
        UPDATE nodes
        SET status = 'error', metadata = metadata || $1::jsonb
        WHERE status IN ('pending', 'streaming')
        """,
        {"error": INTERRUPTED},
    )
    count = int(result.split()[-1])  # asyncpg returns e.g. "UPDATE 2"
    if count:
        log.warning("marked %d interrupted repl%s as error", count, "y" if count == 1 else "ies")
    return count


app = FastAPI(title="divthink", lifespan=lifespan)
app.include_router(sessions.router)
app.include_router(generate.router)
app.include_router(stream.router)
app.include_router(nodes.router)
app.include_router(models.router)


@app.get("/health")
async def health():
    try:
        await db.get_pool().fetchval("SELECT 1", timeout=2)
    except Exception:
        return JSONResponse({"ok": False, "db": False}, status_code=503)
    return {"ok": True, "db": True}
