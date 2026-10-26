"""A short title for a reply, so a zoomed-out canvas is still readable.

Written by the same model that wrote the reply, with the user's own key — one
small call (a couple of dozen output tokens) after the reply is already saved.
Never raises: a canvas without a title is fine, a failed reply is not.
"""

import logging

import anthropic
from google import genai
from google.genai import types

from .providers.base import Usage
from .providers.catalog import MODELS

log = logging.getLogger(__name__)

MAX_TITLE_CHARS = 60
SOURCE_CHARS = 2000  # the opening is enough to name what a reply is about

INSTRUCTION = (
    "Write a title of at most six words for the text that follows. "
    "Name its specific subject, the way a chapter heading would. "
    "Reply with the title alone: no quotes, no punctuation at the end, no preamble."
)

# The canvas's own name, in the sidebar and the bar in the top-left corner,
# which grows to show it whole (Sidebar.module.css).
CANVAS_TITLE_CHARS = 48
CANVAS_INSTRUCTION = (
    "Below is the opening prompt of a conversation and the reply to it. Name the "
    "conversation in three to six words, the way a chat app names a conversation in "
    "its sidebar: sentence case (capitalise only the first word and proper nouns), "
    "specific to what was asked, e.g. \"SpaceX technical interview confirmation\", "
    "\"Claude Code in Xcode setup\", \"Resume for Bloomberg\". Reply with the name "
    "alone: no quotes, no punctuation at the end, no preamble."
)


async def title_for(text: str, model: str, api_key: str) -> tuple[str | None, Usage | None]:
    """The title, and what writing it cost (None if the call never completed)."""
    source = text.strip()[:SOURCE_CHARS]
    if not source:
        return None, None
    title, usage = await _ask(INSTRUCTION, source, model, api_key)
    return _tidy(title, MAX_TITLE_CHARS), usage


async def canvas_title_for(
    prompt: str, reply: str, model: str, api_key: str
) -> tuple[str | None, Usage | None]:
    """A short name for a whole canvas, from its first prompt and reply."""
    source = f"Prompt:\n{prompt.strip()[:SOURCE_CHARS]}\n\nReply:\n{reply.strip()[:SOURCE_CHARS]}"
    title, usage = await _ask(CANVAS_INSTRUCTION, source, model, api_key)
    return _tidy(title, CANVAS_TITLE_CHARS), usage


async def _ask(
    instruction: str, source: str, model: str, api_key: str
) -> tuple[str | None, Usage | None]:
    try:
        if MODELS.get(model) == "anthropic":
            return await _claude(instruction, source, model, api_key)
        return await _gemini(instruction, source, model, api_key)
    except Exception:
        log.warning("could not write a title with %s", model, exc_info=True)
        return None, None


def title_from_prompt(prompt: str) -> str:
    """A new canvas's name until its first reply is titled: the first prompt,
    on one line and cut short."""
    one_line = " ".join(prompt.split())
    if len(one_line) <= MAX_TITLE_CHARS:
        return one_line
    return one_line[: MAX_TITLE_CHARS - 1].rstrip() + "…"


def _tidy(title: str | None, limit: int) -> str | None:
    if not title:
        return None
    # Models like to wrap a title in quotes however firmly you ask them not to.
    cleaned = " ".join(title.split()).strip().strip('"').strip("'").rstrip(".")
    if len(cleaned) > limit:
        # Over the limit anyway: drop whole words rather than cut one in half.
        cleaned = cleaned[: limit + 1].rsplit(" ", 1)[0] if " " in cleaned[:limit] else cleaned[:limit]
    return cleaned or None


async def _claude(instruction: str, source: str, model: str, api_key: str) -> tuple[str | None, Usage]:
    client = anthropic.AsyncAnthropic(api_key=api_key)
    try:
        reply = await client.messages.create(
            model=model,
            # Newer models think before answering, even for a title, and thinking
            # counts against max_tokens: room for it, and low effort so it stays short.
            max_tokens=1024,
            output_config={"effort": "low"},
            system=instruction,
            messages=[{"role": "user", "content": source}],
        )
        used = reply.usage
        usage = Usage(
            used.input_tokens or 0,
            used.output_tokens or 0,
            getattr(used, "cache_read_input_tokens", 0) or 0,
            getattr(used, "cache_creation_input_tokens", 0) or 0,
        )
        return "".join(b.text for b in reply.content if getattr(b, "type", None) == "text"), usage
    finally:
        await client.close()


async def _gemini(instruction: str, source: str, model: str, api_key: str) -> tuple[str | None, Usage]:
    client = genai.Client(api_key=api_key)
    try:
        reply = await client.aio.models.generate_content(
            model=model,
            contents=source,
            config=types.GenerateContentConfig(
                system_instruction=instruction,
                max_output_tokens=32,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        meta = reply.usage_metadata
        cached = getattr(meta, "cached_content_token_count", 0) or 0
        usage = Usage(
            (getattr(meta, "prompt_token_count", 0) or 0) - cached,
            (getattr(meta, "candidates_token_count", 0) or 0)
            + (getattr(meta, "thoughts_token_count", 0) or 0),
            cached,
        )
        return reply.text, usage
    finally:
        aclose = getattr(client.aio, "aclose", None)
        if aclose is not None:
            await aclose()
