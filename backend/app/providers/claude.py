import base64
from collections.abc import AsyncIterator
from typing import Any

import anthropic

from .base import Chunk, Message, ProviderError, Usage

MAX_TOKENS = 16000

# Server-side tool: Anthropic runs the search and returns results in the same
# response. Requires Sonnet 4.6 / Opus 4.6 or newer; older models would need the
# basic web_search_20250305 variant.
WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}


def _content(message: Message) -> str | list[dict[str, Any]]:
    """A turn as the API wants it: plain text, or blocks when files are attached.

    PDFs are "document" blocks, images are "image" blocks — the same base64
    source either way, but the API treats them differently.
    """
    if not message.attachments:
        return message.content
    blocks: list[dict[str, Any]] = [
        {
            "type": "document" if a.is_pdf else "image",
            "source": {
                "type": "base64",
                "media_type": a.media_type,
                "data": base64.b64encode(a.data).decode(),
            },
        }
        for a in message.attachments
    ]
    # Attachments first: the text that refers to them reads better after them.
    if message.content:
        blocks.append({"type": "text", "text": message.content})
    return blocks


async def stream(
    model: str, messages: list[Message], api_key: str, system: str, web_search: bool = False
) -> AsyncIterator[Chunk]:
    """Yield the reply piece by piece: thinking summaries first, then the answer.

    A client per reply, closed afterwards, so the user's key isn't kept around.
    The SDK retries 429/5xx and connection errors itself.

    With `web_search`, Claude may pause mid-turn to search. The API signals that
    with stop_reason "pause_turn"; the turn continues by sending back what it has
    written so far, so this loops until it stops for a different reason.
    """
    client = anthropic.AsyncAnthropic(api_key=api_key)
    total = Usage()
    turns: list[dict[str, Any]] = [{"role": m.role, "content": _content(m)} for m in messages]
    request: dict[str, Any] = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        # Its own field, not a message: it stays out of the conversation history
        # and identical across requests, which is what prefix caching needs.
        "system": system,
        # Adaptive: Claude decides whether to think. "summarized" returns readable
        # thinking; the default on current models streams it with empty text.
        "thinking": {"type": "adaptive", "display": "summarized"},
    }
    if web_search:
        request["tools"] = [WEB_SEARCH_TOOL]

    try:
        while True:
            async with client.messages.stream(messages=turns, **request) as response:
                async for event in response:
                    if event.type == "content_block_start":
                        block = event.content_block
                        # The query is only on the tool_use block, so it's reported
                        # here rather than when the results come back.
                        if getattr(block, "type", None) == "server_tool_use":
                            query = (getattr(block, "input", None) or {}).get("query")
                            yield Chunk("search", str(query) if query else "the web")
                        continue
                    if event.type != "content_block_delta":
                        continue
                    if event.delta.type == "thinking_delta" and event.delta.thinking:
                        yield Chunk("thought", event.delta.thinking)
                    elif event.delta.type == "text_delta" and event.delta.text:
                        yield Chunk("text", event.delta.text)
                final = await response.get_final_message()

            # A paused turn bills each continuation, so these accumulate.
            used = final.usage
            total.input_tokens += getattr(used, "input_tokens", 0) or 0
            total.output_tokens += getattr(used, "output_tokens", 0) or 0
            total.cache_read_tokens += getattr(used, "cache_read_input_tokens", 0) or 0

            if final.stop_reason != "pause_turn":
                break
            # Hand back everything written so far and let the turn carry on.
            turns.append({"role": "assistant", "content": final.content})
    except anthropic.APIStatusError as e:
        raise ProviderError(_friendly_error(e)) from e
    except anthropic.APIConnectionError as e:
        raise ProviderError("Couldn't reach Claude. Check your connection and try again.") from e
    finally:
        await client.close()

    if final.stop_reason == "refusal":
        raise ProviderError("Claude declined to answer this request.")

    yield Chunk("usage", usage=total)


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
