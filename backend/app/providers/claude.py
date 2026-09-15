from collections.abc import AsyncIterator

import anthropic

from ..config import settings
from .base import Chunk, Message, ProviderError

MAX_TOKENS = 16000

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    # Created once and reused. The SDK retries 429/5xx and connection errors itself.
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def stream(model: str, messages: list[Message]) -> AsyncIterator[Chunk]:
    """Yield the reply piece by piece: thinking summaries first, then the answer."""
    try:
        async with _get_client().messages.stream(
            model=model,
            max_tokens=MAX_TOKENS,
            # Adaptive: Claude decides whether to think. "summarized" returns readable
            # thinking; the default on current models streams it with empty text.
            thinking={"type": "adaptive", "display": "summarized"},
            messages=[{"role": m.role, "content": m.content} for m in messages],
        ) as response:
            async for event in response:
                if event.type != "content_block_delta":
                    continue
                if event.delta.type == "thinking_delta" and event.delta.thinking:
                    yield Chunk("thought", event.delta.thinking)
                elif event.delta.type == "text_delta" and event.delta.text:
                    yield Chunk("text", event.delta.text)
            final = await response.get_final_message()
    except anthropic.APIStatusError as e:
        raise ProviderError(_friendly_error(e)) from e
    except anthropic.APIConnectionError as e:
        raise ProviderError("Couldn't reach Claude. Check your connection and try again.") from e

    if final.stop_reason == "refusal":
        raise ProviderError("Claude declined to answer this request.")


def _friendly_error(e: anthropic.APIStatusError) -> str:
    if isinstance(e, anthropic.RateLimitError):
        return "Claude's rate limit was reached. Wait a minute and try again."
    if isinstance(e, anthropic.AuthenticationError):
        return "Claude rejected the API key. Check ANTHROPIC_API_KEY in backend/.env."
    if e.status_code == 402:
        return "Your Anthropic account is out of credits. Add credits in the Claude Console."
    if isinstance(e, anthropic.NotFoundError):
        return "This Claude model isn't available."
    if e.status_code >= 500:
        return "Claude is busy or unavailable right now. Try again."
    return f"Claude returned an error ({e.status_code})."
