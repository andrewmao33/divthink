from dataclasses import dataclass
from typing import Literal


@dataclass
class Message:
    """One turn of a conversation, in our own provider-neutral format."""

    role: Literal["user", "assistant"]
    content: str


@dataclass
class Chunk:
    """One piece of a streamed reply."""

    kind: Literal["thought", "text"]  # thought = thinking summary, text = the answer
    text: str


class ProviderError(Exception):
    """A provider call failed. The message is written to be shown to the user."""
