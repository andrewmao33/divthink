"""Stream a reply from Gemini: thinking headings (dimmed), then the answer.

Run from backend/:
    .venv/bin/python -m scripts.try_model                      # built-in 3-turn conversation
    .venv/bin/python -m scripts.try_model "your own prompt"    # single prompt
"""

import asyncio
import sys
import time

from app.config import settings
from app.prompt import BASE_PROMPT
from app.providers import gemini
from app.providers.base import Message
from app.thinking import thought_headings

MODEL = "gemini-3.6-flash"

# The model can only answer "green" if it received the earlier turns.
CONVERSATION = [
    Message("user", "My favorite color is green."),
    Message("assistant", "Great choice!"),
    Message("user", "What's my favorite color? Answer, then write a short poem about it."),
]

DIM, RESET = "\033[2m", "\033[0m"


async def main() -> None:
    prompt = " ".join(sys.argv[1:])
    messages = [Message("user", prompt)] if prompt else CONVERSATION

    start = time.perf_counter()
    first_heading_at = first_text_at = None
    thoughts = ""  # full thinking text; only its headings get shown
    shown = 0  # how many headings have been printed so far
    answer_started = False

    async for chunk in gemini.stream(MODEL, messages, settings.google_api_key, BASE_PROMPT):
        now = time.perf_counter() - start
        if chunk.kind == "thought":
            thoughts += chunk.text
            headings = thought_headings(thoughts)
            for heading in headings[shown:]:
                first_heading_at = first_heading_at or now
                print(f"{DIM}{heading}…{RESET}", flush=True)
            shown = len(headings)
        else:
            if not answer_started:
                first_text_at = now
                print()
                answer_started = True
            print(chunk.text, end="", flush=True)
    total = time.perf_counter() - start

    timings = [
        f"first heading after {first_heading_at:.1f}s" if first_heading_at else "no thinking headings",
        f"answer starts after {first_text_at:.1f}s" if first_text_at else "no answer text",
        f"done after {total:.1f}s",
    ]
    print(f"\n\n[{', '.join(timings)}]")


if __name__ == "__main__":
    asyncio.run(main())
