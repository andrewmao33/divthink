import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app import generation
from app.providers.base import Chunk, ProviderError
from app.providers.catalog import MODELS
from app.routes.generate import MAX_OPEN_PER_USER, _check_running

MODEL = next(iter(MODELS))
MODEL_PROVIDER = MODELS[MODEL]


class FakeConn:
    """Stands in for a database connection: every count comes back as `count`."""

    def __init__(self, count: int):
        self.count = count

    async def fetchval(self, *_):
        return self.count


def test_cap_is_ten():
    assert MAX_OPEN_PER_USER == 10


def test_open_replies_under_the_cap_are_allowed():
    asyncio.run(_check_running(FakeConn(MAX_OPEN_PER_USER - 1), uuid4()))


def test_open_replies_at_the_cap_are_refused():
    with pytest.raises(HTTPException) as refused:
        asyncio.run(_check_running(FakeConn(MAX_OPEN_PER_USER), uuid4()))
    assert refused.value.status_code == 429


class FakeProvider:
    """Streams one word, and records that it was asked to."""

    def __init__(self):
        self.started = []

    async def stream(self, model, messages, *_):
        self.started.append(messages)
        yield Chunk(kind="text", text="done")

    async def complete(self, *_):
        return None, None


class FakePool:
    async def execute(self, *_):
        pass


def test_slot_is_free_before_titles_are_written(monkeypatch):
    provider = FakeProvider()
    title_started = asyncio.Event()
    finish_title = asyncio.Event()
    titles = []

    async def slow_title(session_id, node_id, reply, model, api_key):
        titles.append(node_id)
        title_started.set()
        await finish_title.wait()

    async def no_context(pool, session_id, node_ids):
        return node_ids

    async def no_repo(pool, session_id):
        return None

    async def run():
        monkeypatch.setattr(generation, "_slots", asyncio.Semaphore(1))
        monkeypatch.setattr(generation, "get_pool", FakePool)
        monkeypatch.setattr(generation, "assemble_context", no_context)
        monkeypatch.setattr(generation.repos, "for_reply", no_repo)
        monkeypatch.setitem(generation.PROVIDERS, MODEL_PROVIDER, provider)
        monkeypatch.setattr(generation, "_write_title", slow_title)

        session = uuid4()
        a, b = uuid4(), uuid4()
        job_a = asyncio.create_task(generation._generate(session, a, MODEL, "key"))
        await asyncio.wait_for(title_started.wait(), 1)
        # A is still writing its title, and the only slot is already free for B.
        title_started.clear()
        job_b = asyncio.create_task(generation._generate(session, b, MODEL, "key"))
        await asyncio.wait_for(title_started.wait(), 1)
        assert not job_a.done()
        assert provider.started == [[a], [b]]
        finish_title.set()
        await asyncio.gather(job_a, job_b)
        assert titles == [a, b]

    asyncio.run(run())


def test_failed_reply_writes_no_title(monkeypatch):
    titles = []

    async def title(*_):
        titles.append(1)

    async def failing_context(*_):
        raise ProviderError("no")

    async def run():
        monkeypatch.setattr(generation, "_slots", asyncio.Semaphore(1))
        monkeypatch.setattr(generation, "get_pool", FakePool)
        monkeypatch.setattr(generation, "assemble_context", failing_context)
        monkeypatch.setattr(generation, "_write_title", title)
        await generation._generate(uuid4(), uuid4(), MODEL, "key")
        # The failed reply gave its slot back.
        assert not generation._slots.locked()
        assert titles == []

    asyncio.run(run())


def test_cancelled_reply_gives_its_slot_back_and_writes_no_title(monkeypatch):
    titles = []
    streaming = asyncio.Event()

    async def title(*_):
        titles.append(1)

    async def hanging_context(*_):
        streaming.set()
        await asyncio.Event().wait()

    async def run():
        monkeypatch.setattr(generation, "_slots", asyncio.Semaphore(1))
        monkeypatch.setattr(generation, "get_pool", FakePool)
        monkeypatch.setattr(generation, "assemble_context", hanging_context)
        monkeypatch.setattr(generation, "_write_title", title)
        job = asyncio.create_task(generation._generate(uuid4(), uuid4(), MODEL, "key"))
        await asyncio.wait_for(streaming.wait(), 1)
        job.cancel()
        with pytest.raises(asyncio.CancelledError):
            await job
        assert not generation._slots.locked()
        assert titles == []

    asyncio.run(run())
