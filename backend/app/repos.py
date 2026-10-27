"""A GitHub repo connected to a canvas, so replies on it can read the code.

Connecting downloads the repo once, as the single compressed file GitHub offers
for every repo (the "Download ZIP" button, in .tar.gz form), and keeps its text
files in Postgres. No git, nothing written to disk.

A reply then gets two things: a map of the repo in its system prompt (every
file, with its length), and three tools to look closer — list a folder, read a
file, search the code. The model reads only what the question needs, so a repo
far bigger than the context window still works.

Public repos only for now. The server's own GitHub token (GITHUB_TOKEN) only
raises GitHub's rate limit; a repo it could see but the public can't is refused,
or anyone could read the token owner's private code.
"""

import asyncio
import io
import logging
import re
import tarfile
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import asyncpg
import httpx

from .config import settings
from .providers.base import Tool, Toolbox

log = logging.getLogger(__name__)

MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024  # the compressed file
MAX_FILE_BYTES = 256 * 1024  # bigger is generated, data or minified, not code to read
MAX_TOTAL_BYTES = 20 * 1024 * 1024  # all the text kept, per canvas
MAX_FILES = 5000
MAP_CHARS = 30_000  # about 10K tokens of map in every reply; past it, folders only
READ_LINES = 1500  # per read_file call; the model asks for a range to see more
MAX_TOOL_CHARS = 60_000  # any one tool result
SEARCH_HITS = 60

# Folders that hold dependencies, build output or tooling, never the code itself.
SKIP_DIRS = {
    ".git", "node_modules", "vendor", "dist", "build", "out", "target", ".next",
    ".nuxt", ".svelte-kit", "__pycache__", ".venv", "venv", "env", ".tox",
    ".mypy_cache", ".pytest_cache", ".gradle", ".idea", ".vscode", "coverage",
    "Pods", "DerivedData", ".turbo", ".cache",
}
SKIP_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "poetry.lock",
    "Pipfile.lock", "uv.lock", "Cargo.lock", "composer.lock", "Gemfile.lock",
    "go.sum", "Podfile.lock", ".DS_Store",
}
SKIP_SUFFIXES = (
    ".min.js", ".min.css", ".map", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
    ".bmp", ".tiff", ".pdf", ".zip", ".gz", ".tar", ".tgz", ".7z", ".jar", ".class",
    ".so", ".dylib", ".dll", ".exe", ".bin", ".wasm", ".woff", ".woff2", ".ttf",
    ".otf", ".eot", ".mp3", ".mp4", ".mov", ".wav", ".webm", ".pyc", ".o", ".a",
    ".sqlite", ".db", ".pkl", ".npy", ".parquet", ".psd", ".sketch", ".fig",
)

_OWNER = r"[A-Za-z0-9-]+"
_NAME = r"[A-Za-z0-9_.-]+"
_URL = re.compile(
    rf"^(?:https?://)?(?:www\.)?github\.com/(?P<owner>{_OWNER})/(?P<name>{_NAME})"
    r"(?:/tree/(?P<ref>[^?#]+))?/?(?:[?#].*)?$"
)
_SHORT = re.compile(rf"^(?P<owner>{_OWNER})/(?P<name>{_NAME})$")


class RepoError(Exception):
    """Connecting failed. The message is written to be shown to the user."""


@dataclass
class Snapshot:
    owner: str
    name: str
    ref: str
    sha: str
    files: dict[str, str]  # path -> text
    truncated: bool


def parse_url(url: str) -> tuple[str, str, str | None]:
    """owner, name and the branch if one was given, from a GitHub link or "owner/name"."""
    url = url.strip()
    match = _URL.match(url) or _SHORT.match(url)
    if not match:
        raise RepoError("That isn't a GitHub repo link. Paste one like github.com/owner/repo.")
    name = match["name"].removesuffix(".git")
    ref = match.groupdict().get("ref")
    return match["owner"], name, ref.strip("/") if ref else None


async def download(url: str) -> Snapshot:
    owner, name, ref = parse_url(url)
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "divthink"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"
    api = f"https://api.github.com/repos/{owner}/{name}"
    try:
        async with httpx.AsyncClient(headers=headers, timeout=30, follow_redirects=True) as client:
            info = await client.get(api)
            _check(info)
            repo = info.json()
            if repo.get("private") or repo.get("visibility", "public") != "public":
                raise RepoError(_NOT_FOUND)
            owner, name = repo["owner"]["login"], repo["name"]  # as GitHub spells them
            ref = ref or repo["default_branch"]

            # A link to a folder (/tree/main/src) has the folder after the branch,
            # and a branch can have slashes too: try the longest first.
            parts = ref.split("/")
            for end in range(len(parts), 0, -1):
                commit = await client.get(
                    f"{api}/commits/{'/'.join(parts[:end])}",
                    headers={"Accept": "application/vnd.github.sha"},
                )
                if commit.status_code not in (404, 422):
                    break
            else:
                raise RepoError(f"{owner}/{name} has no branch called “{ref}”.")
            _check(commit)
            ref, sha = "/".join(parts[:end]), commit.text.strip()

            # The archive of that exact commit, so the files match the sha saved.
            data = bytearray()
            async with client.stream("GET", f"{api}/tarball/{sha}") as archive:
                _check(archive)
                async for piece in archive.aiter_bytes():
                    data += piece
                    if len(data) > MAX_DOWNLOAD_BYTES:
                        raise RepoError("That repo is too big to connect (over 50 MB compressed).")
    except httpx.HTTPError as e:
        raise RepoError("Couldn't reach GitHub. Try again in a moment.") from e

    # Unpacking is CPU work; off the event loop so other requests keep moving.
    files, truncated = await asyncio.to_thread(_text_files, bytes(data))
    if not files:
        raise RepoError(f"{owner}/{name} has no text files to read.")
    return Snapshot(owner, name, ref, sha, files, truncated)


_NOT_FOUND = "Couldn't find that repo. Only public repos can be connected for now."


def _check(response: httpx.Response) -> None:
    if response.status_code == 404:
        raise RepoError(_NOT_FOUND)
    if response.status_code in (403, 429):
        raise RepoError("GitHub is limiting downloads right now. Try again in a few minutes.")
    if response.status_code >= 400:
        raise RepoError(f"GitHub returned an error ({response.status_code}).")


def _text_files(archive: bytes) -> tuple[dict[str, str], bool]:
    """Every file worth reading, by path, and whether some were left out for the caps."""
    files: dict[str, str] = {}
    total = 0
    truncated = False
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            # Every path starts with a folder named after the commit: drop it.
            path = member.name.partition("/")[2]
            if not path or not _worth_reading(path) or member.size > MAX_FILE_BYTES:
                continue
            if len(files) >= MAX_FILES or total + member.size > MAX_TOTAL_BYTES:
                truncated = True
                continue
            raw = tar.extractfile(member)
            if raw is None:
                continue
            data = raw.read()
            if b"\0" in data[:8192]:
                continue  # binary, whatever its name says
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                continue
            files[path] = text.replace("\0", "")  # Postgres text can't hold NUL
            total += len(data)
    return files, truncated


def _worth_reading(path: str) -> bool:
    *folders, filename = path.split("/")
    if any(folder in SKIP_DIRS for folder in folders) or filename in SKIP_FILES:
        return False
    return not filename.lower().endswith(SKIP_SUFFIXES)


async def save(conn: asyncpg.Connection, session_id: UUID, snapshot: Snapshot) -> dict[str, Any]:
    """Replace the canvas's repo with this one. Call inside a transaction."""
    await conn.execute("DELETE FROM repos WHERE session_id = $1", session_id)
    row = await conn.fetchrow(
        f"""
        INSERT INTO repos (session_id, owner, name, ref, sha, file_count, total_bytes, truncated)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING {REPO_COLUMNS}
        """,
        session_id, snapshot.owner, snapshot.name, snapshot.ref, snapshot.sha,
        len(snapshot.files), sum(len(t.encode()) for t in snapshot.files.values()),
        snapshot.truncated,
    )
    await conn.copy_records_to_table(
        "repo_files",
        records=[(session_id, path, text) for path, text in snapshot.files.items()],
        columns=["session_id", "path", "content"],
    )
    return dict(row)


REPO_COLUMNS = "owner, name, ref, sha, file_count, truncated"


async def get(conn: asyncpg.Connection | asyncpg.Pool, session_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {REPO_COLUMNS} FROM repos WHERE session_id = $1", session_id)
    return dict(row) if row else None


# --- What a reply gets ------------------------------------------------------

PROMPT = """

A GitHub repository is connected to this canvas: {owner}/{name}, branch {ref}, \
commit {short}. Questions here are usually about its code. Use the tools to look \
at the code before answering anything that depends on it, rather than guessing \
from file names: search_code to find where something is defined or used, \
read_file to read it, list_files to see a folder. Make several calls at once \
when you already know what you need. Read as much as the question needs, then answer. Don't narrate each step; the user sees what you opened. \
Cite files as path:line.

The repository's files, with their line counts:
<repo_map>
{map}
</repo_map>"""


async def for_reply(pool: asyncpg.Pool, session_id: UUID) -> tuple[str, Toolbox] | None:
    """The system prompt's addition and the tools, if the canvas has a repo.

    The addition is the same on every reply until the repo changes, so it
    caches along with the prompt in front of it.
    """
    repo = await get(pool, session_id)
    if repo is None:
        return None
    rows = await pool.fetch(
        """
        SELECT path, length(content) - length(replace(content, E'\\n', '')) + 1 AS lines
        FROM repo_files WHERE session_id = $1 ORDER BY path
        """,
        session_id,
    )
    sizes = {r["path"]: r["lines"] for r in rows}
    addition = PROMPT.format(
        owner=repo["owner"], name=repo["name"], ref=repo["ref"], short=repo["sha"][:7],
        map=_map(sizes, repo["truncated"]),
    )
    return addition, _toolbox(pool, session_id, sizes)


def _map(sizes: dict[str, int], truncated: bool) -> str:
    """Every file with its line count, or, for a repo too big for that, every
    folder with how many files it holds."""
    lines = [f"{path} ({count})" for path, count in sizes.items()]
    text = "\n".join(lines)
    if len(text) > MAP_CHARS:
        folders: dict[str, int] = {}
        for path in sizes:
            folder = path.rpartition("/")[0] or "."
            folders[folder] = folders.get(folder, 0) + 1
        lines = ["Too many files to list; folders with their file counts. Use list_files to see inside one."]
        lines += [f"{folder}/ ({count} files)" for folder, count in sorted(folders.items())]
        text = _cap("\n".join(lines), MAP_CHARS, "folders")
    if truncated:
        text += "\n(Some files were left out to stay under the size limit.)"
    return text


def _cap(text: str, limit: int, what: str = "output") -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rpartition("\n")[0] + f"\n… ({what} cut short; narrow it down)"


TOOLS = [
    Tool(
        "list_files",
        "List the files in a folder of the connected repository, with their line counts.",
        {
            "type": "object",
            "properties": {
                "folder": {"type": "string", "description": "A folder path, e.g. src/components. Empty for the whole repo."},
            },
        },
    ),
    Tool(
        "read_file",
        f"Read a file from the connected repository, with line numbers. At most {READ_LINES} lines at a time; "
        "ask for a range to read further.",
        {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The file's path, as in the repo map."},
                "start_line": {"type": "integer", "description": "First line to read (from 1). Optional."},
                "end_line": {"type": "integer", "description": "Last line to read. Optional."},
            },
            "required": ["path"],
        },
    ),
    Tool(
        "search_code",
        "Find lines containing some text in the connected repository (plain text, not case-sensitive). "
        "Returns path:line: text for each match.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The text to look for, e.g. a function name."},
                "folder": {"type": "string", "description": "Only search in this folder. Optional."},
            },
            "required": ["query"],
        },
    ),
]


def _toolbox(pool: asyncpg.Pool, session_id: UUID, sizes: dict[str, int]) -> Toolbox:
    async def run(name: str, args: dict[str, Any]) -> str:
        try:
            if name == "list_files":
                return _list(sizes, str(args.get("folder") or ""))
            if name == "read_file":
                return await _read(pool, session_id, sizes, args)
            if name == "search_code":
                return await _search(pool, session_id, args)
            return f"There is no tool called {name}."
        except Exception:
            log.exception("repo tool %s failed on canvas %s", name, session_id)
            return "That tool failed. Try again or try something else."

    def describe(name: str, args: dict[str, Any]) -> str:
        if name == "read_file":
            return f"Reading {args.get('path', 'a file')}"
        if name == "search_code":
            return f"Searching the code: {args.get('query', '')}"
        if name == "list_files":
            return f"Listing {args.get('folder') or 'the repo'}"
        return name

    return Toolbox(TOOLS, run, describe)


def _folder(value: str) -> str:
    folder = value.strip().strip("/")
    return "" if folder in ("", ".") else folder + "/"


def _list(sizes: dict[str, int], folder: str) -> str:
    prefix = _folder(folder)
    found = [f"{path} ({count})" for path, count in sizes.items() if path.startswith(prefix)]
    if not found:
        return f"No files in {folder}."
    return _cap("\n".join(found), MAX_TOOL_CHARS)


async def _read(pool: asyncpg.Pool, session_id: UUID, sizes: dict[str, int], args: dict[str, Any]) -> str:
    path = str(args.get("path") or "").strip().strip("/")
    text = await pool.fetchval(
        "SELECT content FROM repo_files WHERE session_id = $1 AND path = $2", session_id, path
    )
    if text is None:
        near = [p for p in sizes if p.endswith("/" + path.rpartition("/")[2])][:5]
        hint = f" Did you mean: {', '.join(near)}?" if near else ""
        return f"No file at {path}.{hint}"
    lines = text.split("\n")
    start = max(1, int(args.get("start_line") or 1))
    end = min(len(lines), int(args.get("end_line") or start + READ_LINES - 1), start + READ_LINES - 1)
    if start > len(lines):
        return f"{path} has only {len(lines)} lines."
    body = "\n".join(f"{n}\t{lines[n - 1]}" for n in range(start, end + 1))
    more = f"\n… (lines {end + 1}-{len(lines)} not shown)" if end < len(lines) else ""
    return _cap(f"{path}, lines {start}-{end} of {len(lines)}:\n{body}{more}", MAX_TOOL_CHARS)


async def _search(pool: asyncpg.Pool, session_id: UUID, args: dict[str, Any]) -> str:
    query = str(args.get("query") or "")
    if not query.strip():
        return "Give some text to search for."
    prefix = _folder(str(args.get("folder") or ""))
    rows = await pool.fetch(
        """
        SELECT path, content FROM repo_files
        WHERE session_id = $1 AND starts_with(path, $3) AND strpos(lower(content), lower($2)) > 0
        ORDER BY path
        """,
        session_id, query, prefix,
    )
    needle = query.lower()
    hits: list[str] = []
    for row in rows:
        for number, line in enumerate(row["content"].split("\n"), 1):
            if needle in line.lower():
                hits.append(f"{row['path']}:{number}: {line.strip()[:200]}")
                if len(hits) >= SEARCH_HITS:
                    break
        if len(hits) >= SEARCH_HITS:
            hits.append(f"… (stopped at {SEARCH_HITS} matches; search for something more specific)")
            break
    if not hits:
        return f"No matches for “{query}”."
    return _cap("\n".join(hits), MAX_TOOL_CHARS)
