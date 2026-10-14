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

# What each model costs, in US dollars per million tokens: input, output, cache
# read, cache write. Used to record what every reply cost (app/usage.py).
# Check against the providers' pricing pages when a model is added or prices change.
# Gemini: Google lists an introductory rate until the end of 2026; this is the
# published rate after it, so costs err high rather than low.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-sonnet-5": (2.00, 10.00, 0.20, 2.50),
    "claude-opus-5": (5.00, 25.00, 0.50, 6.25),
    "gemini-3.6-flash": (1.50, 7.50, 0.15, 1.50),
}

# Per web search, in US dollars. Gemini's search grounding isn't counted yet.
SEARCH_PRICE = {"anthropic": 0.01, "google": 0.0}
