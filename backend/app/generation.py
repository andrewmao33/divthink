import asyncio
import logging
import time
from collections.abc import Iterable
from uuid import UUID

from . import events, repos
from .context import assemble_context
from .db import get_pool
from .prompt import BASE_PROMPT
from .providers.base import ProviderError
from .providers.catalog import MODELS
from .providers.registry import PROVIDERS
from .thinking import thought_headings
from .titles import canvas_title_for, title_for, title_from_prompt
from .usage import record as record_usage

log = logging.getLogger(__name__)

# Replies being written at once, across every user: a cap on the server's memory,
# not on any one person (routes/generate.py limits each user to a few).
MAX_CONCURRENT = 30

_slots = asyncio.Semaphore(MAX_CONCURRENT)
# Card id -> its running job. Keeps the task from being garbage-collected,
# and lets a delete stop a reply that is still being written.
_jobs: dict[UUID, asyncio.Task] = {}


def start_generation(
    session_id: UUID,
    node_id: UUID,
    model: str,
    api_key: str,
    web_search: bool = False,
) -> asyncio.Task:
    """Fill in the card's response in the background with the user's key. Returns immediately."""
    task = asyncio.create_task(_generate(session_id, node_id, model, api_key, web_search))
    _jobs[node_id] = task
    task.add_done_callback(lambda _: _jobs.pop(node_id, None))
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
    node_id: UUID,
    model: str,
    api_key: str,
    web_search: bool = False,
) -> None:
    node = str(node_id)
    async with _slots:  # wait for one of the MAX_CONCURRENT slots
        pool = get_pool()
        try:
            # Each query borrows a connection only briefly; none is held while
            # waiting on the provider.
            await pool.execute("UPDATE nodes SET status = 'streaming' WHERE id = $1", node_id)
            events.start_reply(session_id, node)
            messages = await assemble_context(pool, session_id, [node_id])
            # A connected repo adds its map to the system prompt, after the
            # fixed part, and the tools to read it.
            system, toolbox = BASE_PROMPT, None
            repo = await repos.for_reply(pool, session_id)
            if repo is not None:
                system, toolbox = BASE_PROMPT + repo[0], repo[1]

            stream = PROVIDERS[MODELS[model]].stream
            thoughts = answer = ""
            usage = None
            announced = False  # the one-off "thinking" event, for thoughts or a search
            headings_sent = 0
            started = time.monotonic()
            thinking_seconds = None  # request start -> first answer text, if it thought
            async for chunk in stream(model, messages, api_key, system, web_search, toolbox):
                if chunk.kind == "usage":
                    usage = chunk.usage
                elif chunk.kind in ("search", "tool"):
                    # Reuses the thinking channel, so a search or a file being
                    # read shows up in the UI exactly like a thinking heading does.
                    if not announced:
                        events.reply_thinking(session_id, node)
                        announced = True
                    label = f"Searching: {chunk.text}" if chunk.kind == "search" else chunk.text
                    events.reply_thought(session_id, node, label)
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
                    "cache_write_tokens": usage.cache_write_tokens,
                    "searches": usage.searches,
                    "cost_usd": await record_usage(session_id, node_id, model, "reply", usage),
                }
            await pool.execute(
                # "- 'error'": during a --reload restart the new process's startup cleanup
                # can mark this reply interrupted while this (old) process is still
                # finishing it. Finishing wins, so drop that stale reason.
                """
                UPDATE nodes
                SET response = $2, status = 'complete', metadata = (metadata - 'error') || $3::jsonb
                WHERE id = $1
                """,
                node_id, reply, metadata,
            )
            events.publish(session_id, "done", {
                "node_id": node,
                "response": reply,
                "thought_headings": metadata.get("thought_headings", []),
                "thinking_seconds": metadata.get("thinking_seconds"),
                "usage": metadata.get("usage"),
            })
            events.end_reply(session_id, node)  # straight after done, as in `finally`
            # The title is a second, small model call. It comes after "done" so the
            # finished reply doesn't look unfinished while it runs; it arrives on
            # its own "titled" event. Never raises.
            await _write_title(session_id, node_id, reply, model, api_key)
        except Exception as e:
            if isinstance(e, ProviderError):
                reason = str(e)
                log.warning("generation failed for node %s: %s", node_id, e)
            else:
                reason = "Something went wrong while generating this reply."
                log.exception("generation crashed for node %s", node_id)
            await _mark_error(session_id, node_id, reason)
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
    title, usage = await title_for(reply, model, api_key)
    if usage is not None:
        await record_usage(session_id, node_id, model, "title", usage)
    if title:
        try:
            await get_pool().execute(
                "UPDATE nodes SET metadata = metadata || $2::jsonb WHERE id = $1",
                node_id, {"title": title},
            )
            events.publish(session_id, "titled", {"node_id": str(node_id), "title": title})
        except Exception:
            log.exception("could not save the title for %s", node_id)
    await _title_canvas(session_id, node_id, reply, model, api_key)


async def _title_canvas(
    session_id: UUID, node_id: UUID, reply: str, model: str, api_key: str
) -> None:
    """Names the canvas after its first exchange, as a chat app names a
    conversation: a separate name from the card's, short enough to fit the bar.

    Until now the canvas was called by its first prompt, cut short (generate.py
    sets that). Only a canvas still called exactly that is renamed: one the user
    renamed keeps their name, and later replies, whose prompts aren't the
    canvas's name, cost no extra call. Never raises, like _write_title.
    """
    try:
        pool = get_pool()
        row = await pool.fetchrow(
            """
            SELECT n.prompt, s.title FROM nodes n
            JOIN sessions s ON s.id = n.session_id
            WHERE n.id = $1
            """,
            node_id,
        )
        if row is None or row["title"] != title_from_prompt(row["prompt"]):
            return
        prompt = row["prompt"]
        title, usage = await canvas_title_for(prompt, reply, model, api_key)
        if usage is not None:
            await record_usage(session_id, node_id, model, "title", usage)
        if not title:
            return
        renamed = await pool.fetchval(
            "UPDATE sessions SET title = $2 WHERE id = $1 AND title = $3 RETURNING id",
            session_id, title, title_from_prompt(prompt),
        )
        if renamed:
            events.publish(session_id, "canvas_titled", {"title": title})
    except Exception:
        log.exception("could not name canvas %s", session_id)


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
