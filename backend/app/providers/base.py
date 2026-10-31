import asyncio
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

# Rounds of tool calls in one reply before the model is made to answer with
# what it has: a guard against a model that keeps reading forever.
MAX_TOOL_ROUNDS = 15


@dataclass
class Attachment:
    """A file attached to a prompt. Raw bytes; each provider encodes its own way."""

    media_type: str  # image/png, image/jpeg, image/gif, image/webp, application/pdf
    data: bytes
    filename: str = ""

    @property
    def is_pdf(self) -> bool:
        return self.media_type == "application/pdf"


@dataclass
class Message:
    """One turn of a conversation, in our own provider-neutral format.

    Attachments ride alongside the text rather than replacing it, so merging
    consecutive same-role turns stays a string concatenation.
    """

    role: Literal["user", "assistant"]
    content: str
    attachments: list[Attachment] = field(default_factory=list)


@dataclass
class Usage:
    """What the request cost, as the provider reported it."""

    input_tokens: int = 0  # uncached input only; cache reads and writes are separate
    output_tokens: int = 0  # thinking included
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    searches: int = 0  # web searches, billed per search

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
            self.cache_read_tokens + other.cache_read_tokens,
            self.cache_write_tokens + other.cache_write_tokens,
            self.searches + other.searches,
        )


@dataclass
class Chunk:
    """One piece of a streamed reply."""

    # thought = thinking summary, text = the answer, search = a web search ran,
    # tool = one of our tools ran (text says what it did), usage = the token
    # counts, sent once at the end
    kind: Literal["thought", "text", "search", "tool", "usage"]
    text: str = ""
    usage: "Usage | None" = None


@dataclass
class Tool:
    """A tool the model may call, described the way both providers take it."""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON schema of the input


@dataclass
class Toolbox:
    """Tools for one reply, and what runs them. Each provider turns `tools` into
    its own format and loops: the model asks, `run` answers, the model carries on."""

    tools: list[Tool]
    # (name, input) -> the result as text. Never raises: a bad call gets an
    # error message back, which the model can correct itself from.
    run: Callable[[str, dict[str, Any]], Awaitable[str]]
    # (name, input) -> a short line for the UI while it runs, e.g. "Reading app/main.py".
    describe: Callable[[str, dict[str, Any]], str]


class ProviderError(Exception):
    """A provider call failed. The message is written to be shown to the user."""


class BaseProvider(ABC):
    """Everything that differs from one AI company to the next. One instance per
    company lives in registry.py; keys are passed per call, never kept."""

    @abstractmethod
    def stream(
        self,
        model: str,
        messages: list[Message],
        api_key: str,
        system: str,
        web_search: bool = False,
        toolbox: Toolbox | None = None,
    ) -> AsyncIterator[Chunk]:
        """Yield a full reply piece by piece: thinking, tool use, the answer, then usage."""

    @abstractmethod
    async def complete(self, model: str, system: str, text: str, api_key: str) -> tuple[str | None, Usage]:
        """One short plain-text answer, all at once, and what it cost. Used for titles."""

    @abstractmethod
    def _key_check_request(self, key: str) -> urllib.request.Request:
        """A free, read-only request (listing models) that only works with a good key."""

    async def check_key(self, key: str) -> Literal["ok", "invalid", "unavailable"]:
        """Try the key before saving it."""
        request = self._key_check_request(key)

        def call() -> Literal["ok", "invalid", "unavailable"]:
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return "ok" if response.status == 200 else "unavailable"
            except urllib.error.HTTPError as e:
                return "invalid" if e.code in (400, 401, 403) else "unavailable"
            except OSError:
                return "unavailable"

        return await asyncio.to_thread(call)
