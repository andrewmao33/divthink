from collections.abc import AsyncIterator

import anthropic

from .base import Chunk, Message, ProviderError

MAX_TOKENS = 16000


async def stream(model: str, messages: list[Message], api_key: str) -> AsyncIterator[Chunk]:
    """Yield the reply piece by piece: thinking summaries first, then the answer.

    A client per reply, closed afterwards, so the user's key isn't kept around.
    The SDK retries 429/5xx and connection errors itself.
    """
    client = anthropic.AsyncAnthropic(api_key=api_key)
    try:
        async with client.messages.stream(
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
    finally:
        await client.close()

    if final.stop_reason == "refusal":
        raise ProviderError("Claude declined to answer this request.")


def _friendly_error(e: anthropic.APIStatusError) -> str:
    if isinstance(e, anthropic.RateLimitError):
        return "Claude's rate limit was reached. Wait a minute and try again."
    if isinstance(e, anthropic.AuthenticationError):
        return "Anthropic rejected your API key. Update it in the menu → API keys."
    if e.status_code == 402:
        return "Your Anthropic account is out of credits. Add credits in the Claude Console."
    if isinstance(e, anthropic.NotFoundError):
        return "This Claude model isn't available on your account."
    if e.status_code >= 500:
        return "Claude is busy or unavailable right now. Try again."
    return f"Claude returned an error ({e.status_code})."
