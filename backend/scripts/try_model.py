"""Stream a reply from a model: thinking headings (dimmed), then the answer.

Run from backend/:
    .venv/bin/python -m scripts.try_model                      # built-in 3-turn conversation on Gemini
    .venv/bin/python -m scripts.try_model "your own prompt"    # single prompt on Gemini
    .venv/bin/python -m scripts.try_model --model gpt-6-luna "your own prompt"
    .venv/bin/python -m scripts.try_model --model gpt-6-luna --search "your own prompt"
    .venv/bin/python -m scripts.try_model --model gpt-6-luna --file notes.pdf "your own prompt"
    .venv/bin/python -m scripts.try_model --model gpt-6-luna --repo "your own prompt"   # a small made-up repo
"""

import argparse
import asyncio
import mimetypes
import time
from pathlib import Path

from app.config import settings
from app.prompt import BASE_PROMPT
from app.providers.base import Attachment, Message, Toolbox
from app.providers.catalog import MODELS
from app.providers.registry import PROVIDERS
from app.repos import TOOLS
from app.thinking import thought_headings

MODEL = "gemini-3.6-flash"

# The model can only answer "green" if it received the earlier turns.
CONVERSATION = [
    Message("user", "My favorite color is green."),
    Message("assistant", "Great choice!"),
    Message("user", "What's my favorite color? Answer, then write a short poem about it."),
]

DIM, RESET = "\033[2m", "\033[0m"

# The real repo tools' definitions, answered from these files instead of a canvas.
REPO_FILES = {
    "README.md": "# Tiny shop\nStart with `make run`.\n",
    "shop/prices.py": "TAX_RATE = 0.0825\n\n\ndef with_tax(price):\n    return round(price * (1 + TAX_RATE), 2)\n",
}


async def run_repo_tool(name: str, args: dict) -> str:
    if name == "list_files":
        return "\n".join(REPO_FILES)
    if name == "read_file":
        return REPO_FILES.get(args.get("path", ""), "There is no such file.")
    if name == "search_code":
        query = str(args.get("query", "")).lower()
        found = [
            f"{path}:{number}: {line}"
            for path, text in REPO_FILES.items()
            for number, line in enumerate(text.splitlines(), 1)
            if query in line.lower()
        ]
        return "\n".join(found) or "No matches."
    return f"There is no tool called {name}."


def describe_repo_tool(name: str, args: dict) -> str:
    return f"{name} {args}"


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--search", action="store_true", help="let the model search the web")
    parser.add_argument("--file", type=Path, help="attach an image or a PDF")
    parser.add_argument("--repo", action="store_true", help="let the model read a small made-up repo")
    parser.add_argument("prompt", nargs="*")
    args = parser.parse_args()
    prompt = " ".join(args.prompt)
    messages = [Message("user", prompt)] if prompt else CONVERSATION
    if args.file:
        media_type = mimetypes.guess_type(args.file.name)[0] or "application/octet-stream"
        attachment = Attachment(media_type, args.file.read_bytes(), args.file.name)
        messages[-1] = Message("user", messages[-1].content, [attachment])
    provider = MODELS[args.model]
    stream = PROVIDERS[provider].stream
    api_key = {
        "anthropic": settings.anthropic_api_key,
        "google": settings.google_api_key,
        "openai": settings.openai_api_key,
    }[provider]

    start = time.perf_counter()
    first_heading_at = first_text_at = None
    thoughts = ""  # full thinking text; only its headings get shown
    shown = 0  # how many headings have been printed so far
    answer_started = False
    usage = None

    toolbox = Toolbox(TOOLS, run_repo_tool, describe_repo_tool) if args.repo else None

    async for chunk in stream(args.model, messages, api_key, BASE_PROMPT, args.search, toolbox):
        now = time.perf_counter() - start
        if chunk.kind == "thought":
            thoughts += chunk.text
            headings = thought_headings(thoughts)
            for heading in headings[shown:]:
                first_heading_at = first_heading_at or now
                print(f"{DIM}{heading}…{RESET}", flush=True)
            shown = len(headings)
        elif chunk.kind == "usage":
            usage = chunk.usage
        elif chunk.kind == "search":
            print(f"{DIM}Searching: {chunk.text}{RESET}", flush=True)
        elif chunk.kind == "tool":
            print(f"{DIM}Tool: {chunk.text}{RESET}", flush=True)
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
    if usage is not None:
        print(f"[{usage}]")


if __name__ == "__main__":
    asyncio.run(main())
