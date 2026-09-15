from collections.abc import AsyncIterator

from google import genai
from google.genai import errors, types

from .base import Chunk, Message, ProviderError


def _to_gemini(messages: list[Message]) -> list[types.Content]:
    # Gemini calls the assistant role "model".
    return [
        types.Content(
            role="model" if m.role == "assistant" else "user",
            parts=[types.Part(text=m.content)],
        )
        for m in messages
    ]


async def stream(model: str, messages: list[Message], api_key: str) -> AsyncIterator[Chunk]:
    """Yield the reply piece by piece: thinking summaries first, then the answer.

    A client per reply, closed afterwards, so the user's key isn't kept around.
    """
    client = genai.Client(api_key=api_key)
    try:
        chunks = await client.aio.models.generate_content_stream(
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
