import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable
from uuid import UUID

from . import events
from .context import assemble_context
from .db import get_pool
from .prompt import BASE_PROMPT
from .providers import claude, gemini
from .providers.base import Chunk, Message, ProviderError
from .providers.catalog import MODELS
from .thinking import thought_headings

log = logging.getLogger(__name__)

MAX_CONCURRENT = 5  # design.md, "Concurrency"

# Provider name (from providers/catalog.py) -> its stream function
# (model, messages, api_key, system).
PROVIDERS: dict[str, Callable[[str, list[Message], str, str], AsyncIterator[Chunk]]] = {
    "google": gemini.stream,
    "anthropic": claude.stream,
}

_slots = asyncio.Semaphore(MAX_CONCURRENT)
_tasks: set[asyncio.Task] = set()  # keeps running jobs from being garbage-collected


def start_generation(
    session_id: UUID, user_node_id: UUID, assistant_node_id: UUID, model: str, api_key: str
) -> asyncio.Task:
    """Fill in `assistant_node_id` in the background with the user's key. Returns immediately."""
    task = asyncio.create_task(_generate(session_id, user_node_id, assistant_node_id, model, api_key))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


async def _generate(
    session_id: UUID, user_node_id: UUID, assistant_node_id: UUID, model: str, api_key: str
) -> None:
    node = str(assistant_node_id)
    async with _slots:  # wait for one of the MAX_CONCURRENT slots
        pool = get_pool()
        try:
            # Each query borrows a connection only briefly; none is held while
            # waiting on the provider.
            await pool.execute(
                "UPDATE nodes SET status = 'streaming' WHERE id = $1", assistant_node_id
            )
            events.start_reply(session_id, node)
            messages = await assemble_context(pool, session_id, [user_node_id])

            stream = PROVIDERS[MODELS[model]]
            thoughts = answer = ""
            headings_sent = 0
            started = time.monotonic()
            thinking_seconds = None  # request start -> first answer text, if it thought
            async for chunk in stream(model, messages, api_key, BASE_PROMPT):
                if chunk.kind == "thought":
                    if not thoughts:
                        events.reply_thinking(session_id, node)
                    thoughts += chunk.text
                    # Only headings go to the browser, never the paragraphs.
                    headings = thought_headings(thoughts)
                    for heading in headings[headings_sent:]:
                        events.reply_thought(session_id, node, heading)
                    headings_sent = len(headings)
                else:
                    if thoughts and thinking_seconds is None:
                        thinking_seconds = round(time.monotonic() - started, 1)
                    answer += chunk.text
                    events.reply_token(session_id, node, chunk.text)

            reply = answer.strip()
            if not reply:
                raise ProviderError("The model returned an empty reply. Try again.")

            metadata = (
                {
                    "thoughts": thoughts,
                    "thought_headings": thought_headings(thoughts),
                    "thinking_seconds": thinking_seconds,
                }
                if thoughts
                else {}
            )
            await pool.execute(
                # "- 'error'": during a --reload restart the new process's startup cleanup
                # can mark this reply interrupted while this (old) process is still
                # finishing it. Finishing wins, so drop that stale reason.
                """
                UPDATE nodes
                SET content = $2, status = 'complete', metadata = (metadata - 'error') || $3::jsonb
                WHERE id = $1
                """,
                assistant_node_id, reply, metadata,
            )
            events.publish(session_id, "done", {
                "node_id": node,
                "content": reply,
                "thought_headings": metadata.get("thought_headings", []),
                "thinking_seconds": metadata.get("thinking_seconds"),
            })
        except Exception as e:
            if isinstance(e, ProviderError):
                reason = str(e)
                log.warning("generation failed for node %s: %s", assistant_node_id, e)
            else:
                reason = "Something went wrong while generating this reply."
                log.exception("generation crashed for node %s", assistant_node_id)
            await _mark_error(session_id, assistant_node_id, reason)
        finally:
            # Right after done/error is published (no await in between), or if the
            # job is cancelled. From here on the database has the final state.
            events.end_reply(session_id, node)


async def _mark_error(session_id: UUID, node_id: UUID, reason: str) -> None:
    try:
        await get_pool().execute(
            "UPDATE nodes SET status = 'error', metadata = metadata || $2::jsonb WHERE id = $1",
            node_id, {"error": reason},
        )
    except Exception:
        log.exception("could not mark node %s as error", node_id)
    # Tells the browser to drop any partial text it showed and display the reason.
    events.publish(session_id, "error", {"node_id": str(node_id), "message": reason})
