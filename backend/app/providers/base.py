from collections.abc import Awaitable, Callable
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
