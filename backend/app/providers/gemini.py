from collections.abc import AsyncIterator

from google import genai
from google.genai import errors, types

from .base import Chunk, Message, ProviderError, Usage


def _parts(message: Message) -> list[types.Part]:
    """Attachments first, then the text that refers to them. Gemini takes PDFs
    and images through the same inline-bytes part."""
    parts = [
        types.Part.from_bytes(data=a.data, mime_type=a.media_type)
        for a in message.attachments
    ]
    if message.content or not parts:
        parts.append(types.Part(text=message.content))
    return parts


def _to_gemini(messages: list[Message]) -> list[types.Content]:
    # Gemini calls the assistant role "model".
    return [
        types.Content(
            role="model" if m.role == "assistant" else "user",
            parts=_parts(m),
        )
        for m in messages
    ]


async def stream(
    model: str, messages: list[Message], api_key: str, system: str, web_search: bool = False
) -> AsyncIterator[Chunk]:
    """Yield the reply piece by piece: thinking summaries first, then the answer.

    A client per reply, closed afterwards, so the user's key isn't kept around.
    """
    client = genai.Client(api_key=api_key)
    try:
        chunks = await client.aio.models.generate_content_stream(
            model=model,
            contents=_to_gemini(messages),
            config=types.GenerateContentConfig(
                # Google's name for the system prompt. Kept out of `contents` so it
                # isn't part of the conversation history.
                system_instruction=system,
                # We don't give the model Python functions to call; turning this off
                # also silences the SDK's AFC warning.
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                # Ask for thinking summaries so the UI can show what the model is
                # working on before the answer starts. Only valid on thinking models.
                thinking_config=types.ThinkingConfig(include_thoughts=True),
                # Google's equivalent of Anthropic's web search tool. Grounding
                # happens server-side; results come back inside the reply.
                tools=[types.Tool(google_search=types.GoogleSearch())] if web_search else None,
            ),
        )
        total = Usage()
        async for chunk in chunks:
            # Each chunk carries running totals; the last one wins.
            meta = getattr(chunk, "usage_metadata", None)
            if meta is not None:
                total = Usage(
                    getattr(meta, "prompt_token_count", 0) or 0,
                    getattr(meta, "candidates_token_count", 0) or 0,
                    getattr(meta, "cached_content_token_count", 0) or 0,
                )
            # chunk.text skips thought parts, so read the parts directly.
            for candidate in chunk.candidates or []:
                parts = candidate.content.parts if candidate.content else None
                for part in parts or []:
                    if part.text:  # skip empty and non-text parts
                        yield Chunk("thought" if part.thought else "text", part.text)
        yield Chunk("usage", usage=total)
    except errors.APIError as e:
        raise ProviderError(_friendly_error(e)) from e
    finally:
        aclose = getattr(client.aio, "aclose", None)
        if aclose is not None:
            await aclose()


def _friendly_error(e: errors.APIError) -> str:
    if e.code == 429:
        return "Gemini's rate limit was reached. Wait a minute and try again."
    if e.code in (500, 502, 503, 504):
        return "Gemini is busy or unavailable right now. Try again."
    if e.code in (401, 403) or "API key" in str(e.message or ""):
        return "Google rejected your API key. Update it in the menu → API keys."
    if e.code == 404:
        return "This Gemini model isn't available on your account."
    return f"Gemini returned an error ({e.code})."
