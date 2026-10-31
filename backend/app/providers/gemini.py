import urllib.request
from collections.abc import AsyncIterator

from google import genai
from google.genai import errors, types

from .base import MAX_TOOL_ROUNDS, BaseProvider, Chunk, Message, ProviderError, Toolbox, Usage


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


class GeminiProvider(BaseProvider):
    async def stream(
        self,
        model: str,
        messages: list[Message],
        api_key: str,
        system: str,
        web_search: bool = False,
        toolbox: Toolbox | None = None,
    ) -> AsyncIterator[Chunk]:
        """Yield the reply piece by piece: thinking summaries first, then the answer.

        A client per reply, closed afterwards, so the user's key isn't kept around.

        With a `toolbox` (a connected repo), Gemini may answer with function calls
        instead of text: they run here, the results go back as the next user turn,
        and it carries on until it answers without calling anything.
        """
        client = genai.Client(api_key=api_key)
        tools: list[types.Tool] = []
        if toolbox:
            tools.append(types.Tool(function_declarations=[
                types.FunctionDeclaration(
                    name=t.name, description=t.description, parameters_json_schema=t.parameters
                )
                for t in toolbox.tools
            ]))
        if web_search:
            # Google's equivalent of Anthropic's web search tool. Grounding
            # happens server-side; results come back inside the reply.
            tools.append(types.Tool(google_search=types.GoogleSearch()))
        config = types.GenerateContentConfig(
            # Google's name for the system prompt. Kept out of `contents` so it
            # isn't part of the conversation history.
            system_instruction=system,
            # Our tools are run by the loop below, not by the SDK; turning this off
            # also silences the SDK's AFC warning.
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            # Ask for thinking summaries so the UI can show what the model is
            # working on before the answer starts. Only valid on thinking models.
            thinking_config=types.ThinkingConfig(include_thoughts=True),
            tools=tools or None,
        )
        contents = _to_gemini(messages)
        total = Usage()
        rounds = 0
        wrote = False  # any answer text yet, so text after a tool call starts a new paragraph
        try:
            while True:
                chunks = await client.aio.models.generate_content_stream(
                    model=model, contents=contents, config=config
                )
                used = Usage()
                said: list[types.Part] = []  # everything this round, to hand back with the results
                calls: list[types.FunctionCall] = []
                fresh = True
                async for chunk in chunks:
                    # Each chunk carries running totals for this request; the last one wins.
                    meta = getattr(chunk, "usage_metadata", None)
                    if meta is not None:
                        # prompt_token_count includes the cached part, and thinking is
                        # counted apart from the answer but billed as output.
                        cached = getattr(meta, "cached_content_token_count", 0) or 0
                        used = Usage(
                            (getattr(meta, "prompt_token_count", 0) or 0) - cached,
                            (getattr(meta, "candidates_token_count", 0) or 0)
                            + (getattr(meta, "thoughts_token_count", 0) or 0),
                            cached,
                        )
                    # chunk.text skips thought parts, so read the parts directly.
                    for candidate in chunk.candidates or []:
                        parts = candidate.content.parts if candidate.content else None
                        for part in parts or []:
                            said.append(part)  # thought signatures included, which Gemini needs back
                            if part.function_call:
                                calls.append(part.function_call)
                            elif part.text:  # skip empty and non-text parts
                                if part.thought:
                                    yield Chunk("thought", part.text)
                                    continue
                                if fresh and wrote:
                                    yield Chunk("text", "\n\n")
                                fresh, wrote = False, True
                                yield Chunk("text", part.text)
                total = total + used
                if not calls or toolbox is None:
                    break
                contents.append(types.Content(role="model", parts=said))
                answers = []
                for call in calls:
                    name, args = call.name or "", dict(call.args or {})
                    yield Chunk("tool", toolbox.describe(name, args))
                    answers.append(types.Part(function_response=types.FunctionResponse(
                        id=call.id, name=name, response={"result": await toolbox.run(name, args)}
                    )))
                contents.append(types.Content(role="user", parts=answers))
                rounds += 1
                if rounds >= MAX_TOOL_ROUNDS:
                    # Answer with what it has.
                    config.tool_config = types.ToolConfig(
                        function_calling_config=types.FunctionCallingConfig(mode="NONE")
                    )
            yield Chunk("usage", usage=total)
        except errors.APIError as e:
            raise ProviderError(_friendly_error(e)) from e
        finally:
            aclose = getattr(client.aio, "aclose", None)
            if aclose is not None:
                await aclose()

    async def complete(self, model: str, system: str, text: str, api_key: str) -> tuple[str | None, Usage]:
        client = genai.Client(api_key=api_key)
        try:
            reply = await client.aio.models.generate_content(
                model=model,
                contents=text,
                config=types.GenerateContentConfig(
                    system_instruction=system,
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

    def _key_check_request(self, key: str) -> urllib.request.Request:
        return urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
            headers={"x-goog-api-key": key},
        )


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
