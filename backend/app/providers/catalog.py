# Models the app can use: model id -> provider. Hardcoded (design.md, "Models").
# Listed in the order the model picker shows them: newest generation first.
# Every Claude model here takes the same request (adaptive thinking, summarized);
# Claude Haiku 4.5 is left out because it needs the older thinking settings.
MODELS = {
    "claude-sonnet-5-5": "anthropic",
    "claude-opus-5-5": "anthropic",
    "claude-haiku-5-5": "anthropic",
    "claude-fable-5-1": "anthropic",
    "claude-sonnet-5": "anthropic",
    "claude-opus-5": "anthropic",
    "claude-fable-5": "anthropic",
    "claude-opus-4-8": "anthropic",
    "claude-opus-4-7": "anthropic",
    "claude-opus-4-6": "anthropic",
    "claude-sonnet-4-6": "anthropic",
    "gemini-3.6-flash": "google",
}

LABELS = {
    "claude-sonnet-5-5": "Claude Sonnet 5.5",
    "claude-opus-5-5": "Claude Opus 5.5",
    "claude-haiku-5-5": "Claude Haiku 5.5",
    "claude-fable-5-1": "Claude Fable 5.1",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-opus-5": "Claude Opus 5",
    "claude-fable-5": "Claude Fable 5",
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "gemini-3.6-flash": "Gemini 3.6 Flash",
}

# How much conversation each model can take in, in tokens. Deliberately the
# standard window, not any extended one: a send is refused before it reaches
# the provider (routes/generate.py), so erring low only means warning early.
CONTEXT_TOKENS = {
    **{model_id: 200_000 for model_id, provider in MODELS.items() if provider == "anthropic"},
    "gemini-3.6-flash": 1_000_000,
}

DEFAULT_MODEL = "claude-sonnet-5-5"

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
# Claude cache writes are 1.25x input (the five-minute cache claude.py asks for).
# Haiku 5.5 is priced for prompts up to 100K tokens; longer ones cost five times as much.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
    "claude-fable-5-1": (10.00, 50.00, 0.25, 12.50),
    "claude-sonnet-5": (2.00, 10.00, 0.20, 2.50),
    "claude-opus-5": (5.00, 25.00, 0.50, 6.25),
    "claude-fable-5": (10.00, 50.00, 1.00, 12.50),
    "claude-opus-4-8": (5.00, 25.00, 0.50, 6.25),
    "claude-opus-4-7": (5.00, 25.00, 0.50, 6.25),
    "claude-opus-4-6": (5.00, 25.00, 0.50, 6.25),
    "claude-sonnet-4-6": (3.00, 15.00, 0.30, 3.75),
    "gemini-3.6-flash": (1.50, 7.50, 0.15, 1.50),
}

# Per web search, in US dollars. Gemini's search grounding isn't counted yet.
SEARCH_PRICE = {"anthropic": 0.01, "google": 0.0}
