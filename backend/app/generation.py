import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable, Iterable
from uuid import UUID

from . import events
from .context import assemble_context
from .db import get_pool
from .prompt import BASE_PROMPT
from .providers import claude, gemini
from .providers.base import Chunk, Message, ProviderError
from .providers.catalog import MODELS
from .thinking import thought_headings
from .titles import title_for

log = logging.getLogger(__name__)

MAX_CONCURRENT = 5  # design.md, "Concurrency"

# Provider name (from providers/catalog.py) -> its stream function
# (model, messages, api_key, system).
PROVIDERS: dict[str, Callable[[str, list[Message], str, str], AsyncIterator[Chunk]]] = {
    "google": gemini.stream,
    "anthropic": claude.stream,
}

_slots = asyncio.Semaphore(MAX_CONCURRENT)
# Reply node id -> its running job. Keeps the task from being garbage-collected,
# and lets a delete stop a reply that is still being written.
_jobs: dict[UUID, asyncio.Task] = {}


def start_generation(
    session_id: UUID,
    user_node_id: UUID,
    assistant_node_id: UUID,
    model: str,
    api_key: str,
    web_search: bool = False,
) -> asyncio.Task:
    """Fill in `assistant_node_id` in the background with the user's key. Returns immediately."""
    task = asyncio.create_task(
        _generate(session_id, user_node_id, assistant_node_id, model, api_key, web_search)
    )
    _jobs[assistant_node_id] = task
    task.add_done_callback(lambda _: _jobs.pop(assistant_node_id, None))
    return task


def cancel_generation(node_ids: Iterable[UUID]) -> list[UUID]:
    """Stop replies that are still being written. Returns the ones actually stopped.

    Cancelling raises CancelledError inside the job: it is a BaseException, so the
    job's `except Exception` doesn't swallow it, the semaphore slot is released on
    the way out, and the `finally` still clears the reply's buffer.
    """
    stopped = []
    for node_id in node_ids:
        task = _jobs.get(node_id)
        if task is not None and not task.done():
            task.cancel()
            stopped.append(node_id)
    return stopped


async def _generate(
    session_id: UUID,
    user_node_id: UUID,
    assistant_node_id: UUID,
    model: str,
    api_key: str,
    web_search: bool = False,
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
            usage = None
            announced = False  # the one-off "thinking" event, for thoughts or a search
            headings_sent = 0
            started = time.monotonic()
            thinking_seconds = None  # request start -> first answer text, if it thought
            async for chunk in stream(model, messages, api_key, BASE_PROMPT, web_search):
                if chunk.kind == "usage":
                    usage = chunk.usage
                elif chunk.kind == "search":
                    # Reuses the thinking channel, so a search shows up in the UI
                    # exactly like a thinking heading does.
                    if not announced:
                        events.reply_thinking(session_id, node)
                        announced = True
                    events.reply_thought(session_id, node, f"Searching: {chunk.text}")
                elif chunk.kind == "thought":
                    if not announced:
                        events.reply_thinking(session_id, node)
                        announced = True
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

            metadata: dict = (
                {
                    "thoughts": thoughts,
                    "thought_headings": thought_headings(thoughts),
                    "thinking_seconds": thinking_seconds,
                }
                if thoughts
                else {}
            )
            if usage is not None:
                # What this reply actually cost, as the provider reported it.
                metadata["usage"] = {
                    "input_tokens": usage.input_tokens,
                    "output_tokens": usage.output_tokens,
                    "cache_read_tokens": usage.cache_read_tokens,
                }
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
            await _write_title(session_id, assistant_node_id, reply, model, api_key)
            events.publish(session_id, "done", {
                "node_id": node,
                "content": reply,
                "thought_headings": metadata.get("thought_headings", []),
                "thinking_seconds": metadata.get("thinking_seconds"),
                "usage": metadata.get("usage"),
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


async def _write_title(
    session_id: UUID, node_id: UUID, reply: str, model: str, api_key: str
) -> None:
    """Name the reply so it stays readable when the canvas is zoomed out.

    Runs after the reply is saved, and swallows its own failures: a missing title
    is a cosmetic loss, not a reason to fail a reply that already succeeded.
    """
    title = await title_for(reply, model, api_key)
    if not title:
        return
    try:
        await get_pool().execute(
            "UPDATE nodes SET metadata = metadata || $2::jsonb WHERE id = $1",
            node_id, {"title": title},
        )
        events.publish(session_id, "titled", {"node_id": str(node_id), "title": title})
    except Exception:
        log.exception("could not save the title for %s", node_id)


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
