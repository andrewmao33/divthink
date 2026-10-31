import base64
import json
from collections.abc import AsyncIterator
from typing import Any

import openai

from .base import MAX_TOOL_ROUNDS, Chunk, Message, ProviderError, Toolbox, Usage

MAX_TOKENS = 16000

# Calls to OpenAI's search tool in one request, a cap on what a reply can spend.
MAX_SEARCHES = 5


def _content(message: Message) -> str | list[dict[str, Any]]:
    """A turn as the API wants it: plain text, or parts when files are attached.

    PDFs are "input_file" parts, images are "input_image" parts, both sent as
    base64 data URLs.
    """
    if not message.attachments:
        return message.content
    parts: list[dict[str, Any]] = []
    for a in message.attachments:
        url = f"data:{a.media_type};base64,{base64.b64encode(a.data).decode()}"
        if a.is_pdf:
            parts.append({"type": "input_file", "filename": a.filename or "document.pdf", "file_data": url})
        else:
            parts.append({"type": "input_image", "image_url": url, "detail": "auto"})
    # Attachments first: the text that refers to them reads better after them.
    if message.content:
        parts.append({"type": "input_text", "text": message.content})
    return parts


async def stream(
    model: str,
    messages: list[Message],
    api_key: str,
    system: str,
    web_search: bool = False,
    toolbox: Toolbox | None = None,
) -> AsyncIterator[Chunk]:
    """Yield the reply piece by piece: thinking summaries first, then the answer.

    A client per reply, closed afterwards, so the user's key isn't kept around.
    The SDK retries 429/5xx and connection errors itself.

    With `web_search`, OpenAI runs the searches itself within the one response.

    With a `toolbox` (a connected repo), the model may stop to call one of its
    tools: the tool runs here, what it said and the results go back as input,
    and the loop carries on until it answers without calling anything.
    """
    client = openai.AsyncOpenAI(api_key=api_key)
    request: dict[str, Any] = {
        "model": model,
        "max_output_tokens": MAX_TOKENS,
        # OpenAI's name for the system prompt. Kept out of `input` so it isn't
        # part of the conversation history.
        "instructions": system,
        "input": [{"role": m.role, "content": _content(m)} for m in messages],
        # Readable thinking, which is otherwise left out of the response.
        "reasoning": {"summary": "auto"},
        # The whole thread is sent every time, so OpenAI needn't keep a copy.
        "store": False,
    }
    tools: list[dict[str, Any]] = []
    if web_search:
        tools.append({"type": "web_search"})
        request["max_tool_calls"] = MAX_SEARCHES
    if toolbox:
        tools += [
            {
                "type": "function",
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
                # Strict needs every property required, and ours have optional ones.
                "strict": False,
            }
            for t in toolbox.tools
        ]
    if tools:
        request["tools"] = tools
    total = Usage()
    rounds = 0
    wrote = False  # any answer text yet, so text after a search or tool call starts a new paragraph
    try:
        while True:
            fresh = True
            said: list[Any] = []  # every finished item this round, to hand back with the results
            calls: list[Any] = []
            async with client.responses.stream(**request) as response:
                async for event in response:
                    if event.type == "response.reasoning_summary_text.delta":
                        yield Chunk("thought", event.delta)
                    elif event.type in ("response.output_text.delta", "response.refusal.delta"):
                        if fresh and wrote:
                            yield Chunk("text", "\n\n")
                        fresh, wrote = False, True
                        yield Chunk("text", event.delta)
                    elif event.type == "response.output_item.added":
                        if event.item.type == "message":
                            fresh = True
                    elif event.type == "response.output_item.done":
                        said.append(event.item)
                        if event.item.type == "function_call":
                            calls.append(event.item)
                        # The query is only known once the search call is finished.
                        elif event.item.type == "web_search_call" and event.item.action.type == "search":
                            action = event.item.action
                            query = action.query or ", ".join(action.queries or [])
                            yield Chunk("search", query or "the web")
                    elif event.type in ("response.completed", "response.incomplete"):
                        used = _usage(event.response.usage)
                        # Every call counts, opening a page as well as searching, so
                        # the logged cost errs high rather than low.
                        used.searches = sum(item.type == "web_search_call" for item in event.response.output)
                        total = total + used
                        details = event.response.incomplete_details
                        if details is not None and details.reason == "content_filter":
                            raise ProviderError("OpenAI stopped this reply with its content filter.")
                    elif event.type == "response.failed":
                        raise ProviderError(_friendly_failure(event.response.error))
                    elif event.type == "error":
                        raise ProviderError("OpenAI is busy or unavailable right now. Try again.")

            if not calls or toolbox is None:
                break
            # Thinking included: with store off, the API needs it back to carry on.
            request["input"] += [item.model_dump(exclude_none=True) for item in said]
            for call in calls:
                args = _arguments(call.arguments)
                yield Chunk("tool", toolbox.describe(call.name, args))
                request["input"].append({
                    "type": "function_call_output",
                    "call_id": call.call_id,
                    "output": await toolbox.run(call.name, args),
                })
            rounds += 1
            if rounds >= MAX_TOOL_ROUNDS:
                request["tool_choice"] = "none"  # answer with what it has
    except openai.APIStatusError as e:
        raise ProviderError(_friendly_error(e)) from e
    except openai.APIConnectionError as e:
        raise ProviderError("Couldn't reach OpenAI. Check your connection and try again.") from e
    finally:
        await client.close()

    yield Chunk("usage", usage=total)


def _arguments(text: str) -> dict[str, Any]:
    """A tool call's input. If it isn't valid JSON the tool runs with nothing,
    and its error message lets the model correct itself."""
    try:
        args = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return args if isinstance(args, dict) else {}


def _usage(used: Any) -> Usage:
    if used is None:
        return Usage()
    # input_tokens includes cache reads and writes; ours counts them separately.
    # output_tokens already includes reasoning.
    details = used.input_tokens_details
    return Usage(
        used.input_tokens - details.cached_tokens - details.cache_write_tokens,
        used.output_tokens,
        details.cached_tokens,
        details.cache_write_tokens,
    )


def _friendly_failure(error: Any) -> str:
    code = getattr(error, "code", None)
    if code == "rate_limit_exceeded":
        return "OpenAI's rate limit was reached. Wait a minute and try again."
    if code == "server_error":
        return "OpenAI is busy or unavailable right now. Try again."
    return f"OpenAI couldn't finish this reply ({code or 'unknown error'})."


def _friendly_error(e: openai.APIStatusError) -> str:
    code = getattr(e, "code", None)
    if code == "insufficient_quota":
        return "Your OpenAI account is out of credits. Add credits in OpenAI's billing settings."
    if isinstance(e, openai.RateLimitError):
        return "OpenAI's rate limit was reached. Wait a minute and try again."
    if isinstance(e, openai.AuthenticationError):
        return "OpenAI rejected your API key. Update it in the menu → API keys."
    if isinstance(e, openai.NotFoundError):
        return "This OpenAI model isn't available on your account."
    if e.status_code >= 500:
        return "OpenAI is busy or unavailable right now. Try again."
    return f"OpenAI returned an error ({e.status_code})."
