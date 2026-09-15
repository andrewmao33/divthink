"""In-memory event bus and reply buffers (design.md, "SSE bus").

- One queue per open stream connection. Publishing puts a copy of the event in
  every queue listening to that session, so every open tab sees every event.
- While a reply is streaming, its headings and text so far are kept here, so a
  tab that connects mid-reply gets caught up before live events.
"""

import asyncio
from typing import Any
from uuid import UUID

Event = tuple[str, dict[str, Any]]  # (event type, data)

_listeners: dict[UUID, set[asyncio.Queue[Event]]] = {}
# session -> reply node id -> {"thinking": bool, "headings": [...], "text": "..."},
# only while streaming
_buffers: dict[UUID, dict[str, dict[str, Any]]] = {}


def subscribe(session_id: UUID) -> tuple[asyncio.Queue[Event], list[Event]]:
    """Start listening, and return catch-up events for replies already in progress.

    Registering and snapshotting happen with no await in between, so no event
    can fall in a gap: anything published before is in the catch-up, anything
    after goes to the queue.
    """
    queue: asyncio.Queue[Event] = asyncio.Queue()
    _listeners.setdefault(session_id, set()).add(queue)
    catch_up: list[Event] = []
    for node_id, buf in _buffers.get(session_id, {}).items():
        if buf["thinking"]:
            catch_up.append(("thinking", {"node_id": node_id}))
        catch_up += [("thought", {"node_id": node_id, "heading": h}) for h in buf["headings"]]
        if buf["text"]:
            catch_up.append(("token", {"node_id": node_id, "text": buf["text"]}))
    return queue, catch_up


def unsubscribe(session_id: UUID, queue: asyncio.Queue[Event]) -> None:
    queues = _listeners.get(session_id)
    if queues is None:
        return
    queues.discard(queue)
    if not queues:
        del _listeners[session_id]


def publish(session_id: UUID, event_type: str, data: dict[str, Any]) -> None:
    for queue in _listeners.get(session_id, ()):
        queue.put_nowait((event_type, data))


def listener_count(session_id: UUID) -> int:
    return len(_listeners.get(session_id, ()))


# Reply streaming: keep the buffer and publish in one step, so they never disagree.

def start_reply(session_id: UUID, node_id: str) -> None:
    _buffers.setdefault(session_id, {})[node_id] = {"thinking": False, "headings": [], "text": ""}


def reply_thinking(session_id: UUID, node_id: str) -> None:
    """Thinking has started. Sent once per reply, whether or not headings follow
    (Claude's thinking summaries have none), so the UI can show "Thinking…"."""
    buf = _buffers.get(session_id, {}).get(node_id)
    if buf is not None:
        buf["thinking"] = True
    publish(session_id, "thinking", {"node_id": node_id})


def reply_thought(session_id: UUID, node_id: str, heading: str) -> None:
    buf = _buffers.get(session_id, {}).get(node_id)
    if buf is not None:
        buf["headings"].append(heading)
    publish(session_id, "thought", {"node_id": node_id, "heading": heading})


def reply_token(session_id: UUID, node_id: str, text: str) -> None:
    buf = _buffers.get(session_id, {}).get(node_id)
    if buf is not None:
        buf["text"] += text
    publish(session_id, "token", {"node_id": node_id, "text": text})


def end_reply(session_id: UUID, node_id: str) -> None:
    nodes = _buffers.get(session_id)
    if nodes is None:
        return
    nodes.pop(node_id, None)
    if not nodes:
        del _buffers[session_id]
