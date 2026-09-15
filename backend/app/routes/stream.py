import asyncio
import json
import time
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from .. import events
from ..config import DEV_USER_ID
from ..db import get_pool

router = APIRouter(prefix="/sessions", tags=["stream"])

POLL_SECONDS = 1.0  # how often to check whether the client has gone away
KEEPALIVE_SECONDS = 15.0  # send a comment line if nothing else was sent for this long


@router.get("/{session_id}/stream")
async def stream(session_id: UUID, request: Request):
    """Server-sent events for one canvas: node_created, thought, token, done, error."""
    exists = await get_pool().fetchval(
        "SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2", session_id, DEV_USER_ID
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_stream():
        # Subscribe inside the generator so the finally block always unsubscribes.
        queue, catch_up = events.subscribe(session_id)
        try:
            yield ": connected\n\n"
            # Replies already in progress: headings and text so far, then live events.
            for event_type, data in catch_up:
                yield _format(event_type, data)
            last_sent = time.monotonic()
            while True:
                try:
                    event_type, data = await asyncio.wait_for(queue.get(), POLL_SECONDS)
                except TimeoutError:
                    if await request.is_disconnected():
                        break
                    if time.monotonic() - last_sent >= KEEPALIVE_SECONDS:
                        yield ": keepalive\n\n"  # stops idle connections being dropped
                        last_sent = time.monotonic()
                    continue
                yield _format(event_type, data)
                last_sent = time.monotonic()
        finally:
            events.unsubscribe(session_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _format(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
