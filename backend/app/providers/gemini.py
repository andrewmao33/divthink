from collections.abc import AsyncIterator

from google import genai
from google.genai import errors, types

from ..config import settings
from .base import Chunk, Message, ProviderError

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    # Created once and reused, instead of reconnecting for every message.
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.google_api_key)
    return _client


def _to_gemini(messages: list[Message]) -> list[types.Content]:
    # Gemini calls the assistant role "model".
    return [
        types.Content(
            role="model" if m.role == "assistant" else "user",
            parts=[types.Part(text=m.content)],
        )
        for m in messages
    ]


async def stream(model: str, messages: list[Message]) -> AsyncIterator[Chunk]:
    """Yield the reply piece by piece: thinking summaries first, then the answer."""
    try:
        chunks = await _get_client().aio.models.generate_content_stream(
            model=model,
            contents=_to_gemini(messages),
            config=types.GenerateContentConfig(
                # We don't give the model Python functions to call; turning this off
                # also silences the SDK's AFC warning.
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                # Ask for thinking summaries so the UI can show what the model is
                # working on before the answer starts. Only valid on thinking models.
                thinking_config=types.ThinkingConfig(include_thoughts=True),
            ),
        )
        async for chunk in chunks:
            # chunk.text skips thought parts, so read the parts directly.
            for candidate in chunk.candidates or []:
                parts = candidate.content.parts if candidate.content else None
                for part in parts or []:
                    if part.text:  # skip empty and non-text parts
                        yield Chunk("thought" if part.thought else "text", part.text)
    except errors.APIError as e:
        raise ProviderError(_friendly_error(e)) from e


def _friendly_error(e: errors.APIError) -> str:
    if e.code == 429:
        return "Gemini's rate limit was reached. Wait a minute and try again."
    if e.code in (500, 502, 503, 504):
        return "Gemini is busy or unavailable right now. Try again."
    if e.code in (401, 403) or "API key" in str(e.message or ""):
        return "Gemini rejected the API key. Check GOOGLE_API_KEY in backend/.env."
    if e.code == 404:
        return "This Gemini model isn't available."
    return f"Gemini returned an error ({e.code})."
