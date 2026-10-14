from dataclasses import dataclass, field
from typing import Literal


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
    # usage = the token counts, sent once at the end
    kind: Literal["thought", "text", "search", "usage"]
    text: str = ""
    usage: "Usage | None" = None


class ProviderError(Exception):
    """A provider call failed. The message is written to be shown to the user."""
