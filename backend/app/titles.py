"""A short title for a reply, so a zoomed-out canvas is still readable.

Written by the same model that wrote the reply, with the user's own key — one
small call (a couple of dozen output tokens) after the reply is already saved.
Never raises: a canvas without a title is fine, a failed reply is not.
"""

import logging

import anthropic
from google import genai
from google.genai import types

from .providers.catalog import MODELS

log = logging.getLogger(__name__)

MAX_TITLE_CHARS = 60
SOURCE_CHARS = 2000  # the opening is enough to name what a reply is about

INSTRUCTION = (
    "Write a title of at most six words for the text that follows. "
    "Name its specific subject, the way a chapter heading would. "
    "Reply with the title alone: no quotes, no punctuation at the end, no preamble."
)


async def title_for(text: str, model: str, api_key: str) -> str | None:
    source = text.strip()[:SOURCE_CHARS]
    if not source:
        return None
    try:
        if MODELS.get(model) == "anthropic":
            title = await _claude(source, model, api_key)
        else:
            title = await _gemini(source, model, api_key)
    except Exception:
        log.warning("could not write a title with %s", model, exc_info=True)
        return None
    return _tidy(title)


def _tidy(title: str | None) -> str | None:
    if not title:
        return None
    # Models like to wrap a title in quotes however firmly you ask them not to.
    cleaned = " ".join(title.split()).strip().strip('"').strip("'").rstrip(".")
    return cleaned[:MAX_TITLE_CHARS] or None


async def _claude(source: str, model: str, api_key: str) -> str | None:
    client = anthropic.AsyncAnthropic(api_key=api_key)
    try:
        reply = await client.messages.create(
            model=model,
            max_tokens=32,
            system=INSTRUCTION,
            messages=[{"role": "user", "content": source}],
        )
        return "".join(b.text for b in reply.content if getattr(b, "type", None) == "text")
    finally:
        await client.close()


async def _gemini(source: str, model: str, api_key: str) -> str | None:
    client = genai.Client(api_key=api_key)
    try:
        reply = await client.aio.models.generate_content(
            model=model,
            contents=source,
            config=types.GenerateContentConfig(
                system_instruction=INSTRUCTION,
                max_output_tokens=32,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        return reply.text
    finally:
        aclose = getattr(client.aio, "aclose", None)
        if aclose is not None:
            await aclose()
