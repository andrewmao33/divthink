from .base import BaseProvider
from .claude import ClaudeProvider
from .gemini import GeminiProvider
from .openai import OpenAIProvider

# Provider name (from catalog.py) -> what talks to it.
PROVIDERS: dict[str, BaseProvider] = {
    "anthropic": ClaudeProvider(),
    "google": GeminiProvider(),
    "openai": OpenAIProvider(),
}
