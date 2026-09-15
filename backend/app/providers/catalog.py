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

# Providers users can save an API key for, with display names.
PROVIDER_LABELS = {
    "anthropic": "Anthropic",
    "google": "Google",
}
