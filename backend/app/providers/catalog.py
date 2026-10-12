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

# How much conversation each model can take in, in tokens. Deliberately the
# standard window, not any extended one: a send is refused before it reaches
# the provider (routes/generate.py), so erring low only means warning early.
CONTEXT_TOKENS = {
    "claude-sonnet-5": 200_000,
    "claude-opus-5": 200_000,
    "gemini-3.6-flash": 1_000_000,
}

DEFAULT_MODEL = "claude-sonnet-5"

# Providers users can save an API key for, with display names.
PROVIDER_LABELS = {
    "anthropic": "Anthropic",
    "google": "Google",
}
