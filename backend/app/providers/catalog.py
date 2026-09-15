from ..config import settings

# Models the app can use: model id -> provider. Hardcoded (design.md, "Models").
MODELS = {
    "claude-sonnet-5": "anthropic",
    "claude-opus-5": "anthropic",
    "gemini-3.6-flash": "google",
}

LABELS = {
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-opus-5": "Claude Opus 5",
    "gemini-3.6-flash": "Gemini 3.6 Flash",
}

DEFAULT_MODEL = "claude-sonnet-5"


def provider_configured(provider: str) -> bool:
    """Whether an API key for this provider is set in backend/.env."""
    keys = {
        "anthropic": settings.anthropic_api_key,
        "google": settings.google_api_key,
        "openai": settings.openai_api_key,
    }
    return bool(keys.get(provider, "").strip())
