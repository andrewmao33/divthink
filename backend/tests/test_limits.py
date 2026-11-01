import asyncio
import json
import logging
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import generation
from app.providers.base import Chunk, ProviderError
from app.providers.catalog import MODELS
from app.config import settings
from app.main import app
from app.routes.generate import MAX_OPEN_PER_USER, MAX_PROMPTS_PER_MINUTE, _check_rate, _check_running

MODEL = next(iter(MODELS))
MODEL_PROVIDER = MODELS[MODEL]
USER = uuid4()


class FakeConn:
    """Stands in for a database connection: every count comes back as `count`."""

    def __init__(self, count: int, oldest_age: float = 0):
        self.count = count
        self.oldest_age = oldest_age

    async def fetchval(self, *_):
        return self.count

    async def fetchrow(self, *_):
        return {"recent": self.count, "oldest_age": self.oldest_age}


def test_cap_is_ten():
    assert MAX_OPEN_PER_USER == 10


def test_open_replies_under_the_cap_are_allowed():
    asyncio.run(_check_running(FakeConn(MAX_OPEN_PER_USER - 1), uuid4()))


def test_open_replies_at_the_cap_are_refused():
    with pytest.raises(HTTPException) as refused:
        asyncio.run(_check_running(FakeConn(MAX_OPEN_PER_USER), uuid4()))
    assert refused.value.status_code == 429
    assert refused.value.headers == {"Retry-After": "10"}


def test_prompts_under_the_rate_limit_are_allowed():
    asyncio.run(_check_rate(FakeConn(MAX_PROMPTS_PER_MINUTE - 1), uuid4()))


@pytest.mark.parametrize(
    ("oldest_age", "seconds"),
    [(0, "60"), (25.5, "35"), (59.5, "1"), (60, "1"), (61, "1")],
)
def test_rate_limit_says_when_room_comes_back(oldest_age, seconds):
    with pytest.raises(HTTPException) as refused:
        asyncio.run(_check_rate(FakeConn(MAX_PROMPTS_PER_MINUTE, oldest_age), uuid4()))
    assert refused.value.status_code == 429
    assert refused.value.headers == {"Retry-After": seconds}


def test_browser_is_allowed_to_read_retry_after():
    origin = settings.cors_origins.split(",")[0].strip()
    response = TestClient(app).get("/health", headers={"Origin": origin})
    assert response.headers["access-control-expose-headers"] == "Retry-After"


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
        job_a = asyncio.create_task(generation._generate(session, a, USER, MODEL, "key"))
        await asyncio.wait_for(title_started.wait(), 1)
        # A is still writing its title, and the only slot is already free for B.
        title_started.clear()
        job_b = asyncio.create_task(generation._generate(session, b, USER, MODEL, "key"))
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
        await generation._generate(uuid4(), uuid4(), USER, MODEL, "key")
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
        job = asyncio.create_task(generation._generate(uuid4(), uuid4(), USER, MODEL, "key"))
        await asyncio.wait_for(streaming.wait(), 1)
        job.cancel()
        with pytest.raises(asyncio.CancelledError):
            await job
        assert not generation._slots.locked()
        assert titles == []

    asyncio.run(run())


def reply_lines(caplog) -> list[dict]:
    prefix = "reply "
    return [
        json.loads(r.getMessage().removeprefix(prefix))
        for r in caplog.records
        if r.name == "app.generation" and r.getMessage().startswith(prefix)
    ]


def fake_job(monkeypatch, context=None, provider=None) -> None:
    """A reply job with no database, no provider and no titles."""

    async def empty_context(*_):
        return []

    async def no_repo(*_):
        return None

    async def no_title(*_):
        pass

    monkeypatch.setattr(generation, "get_pool", FakePool)
    monkeypatch.setattr(generation, "assemble_context", context or empty_context)
    monkeypatch.setattr(generation.repos, "for_reply", no_repo)
    monkeypatch.setitem(generation.PROVIDERS, MODEL_PROVIDER, provider or FakeProvider())
    monkeypatch.setattr(generation, "_write_title", no_title)


def test_finished_reply_logs_one_line(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app.generation")
    fake_job(monkeypatch)
    node = uuid4()

    async def run():
        monkeypatch.setattr(generation, "_slots", asyncio.Semaphore(1))
        await generation._generate(uuid4(), node, USER, MODEL, "key", False, 2048, 300)

    asyncio.run(run())
    line = reply_lines(caplog)[0]
    assert len(reply_lines(caplog)) == 1
    assert line["node_id"] == str(node)
    assert line["user_id"] == str(USER)
    assert line["model"] == MODEL
    assert line["outcome"] == "done"
    assert line["file_bytes"] == 2048
    assert line["context_chars"] == 300
    assert line["queue_wait_ms"] >= 0
    assert 0 <= line["ttft_ms"] <= line["duration_ms"]
    assert generation._slots_in_use == 0


def test_failed_reply_logs_error_with_no_first_text(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app.generation")

    async def failing_context(*_):
        raise ProviderError("no")

    fake_job(monkeypatch, failing_context)

    async def run():
        monkeypatch.setattr(generation, "_slots", asyncio.Semaphore(1))
        await generation._generate(uuid4(), uuid4(), USER, MODEL, "key")

    asyncio.run(run())
    line = reply_lines(caplog)[0]
    assert line["outcome"] == "error"
    assert line["ttft_ms"] is None
    assert line["duration_ms"] >= 0


def test_cancel_while_waiting_for_a_slot_logs_empty_timings(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app.generation")
    fake_job(monkeypatch)

    async def run():
        slots = asyncio.Semaphore(1)
        monkeypatch.setattr(generation, "_slots", slots)
        await slots.acquire()  # the only slot is taken
        job = asyncio.create_task(generation._generate(uuid4(), uuid4(), USER, MODEL, "key"))
        await asyncio.sleep(0)
        job.cancel()
        with pytest.raises(asyncio.CancelledError):
            await job

    asyncio.run(run())
    line = reply_lines(caplog)[0]
    assert line["outcome"] == "cancelled"
    assert line["queue_wait_ms"] is None
    assert line["ttft_ms"] is None
    assert line["duration_ms"] is None
    assert generation._slots_in_use == 0


def test_cancel_mid_reply_logs_cancelled(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app.generation")
    started = None

    async def hanging_context(*_):
        started.set()
        await asyncio.Event().wait()

    fake_job(monkeypatch, hanging_context)

    async def run():
        nonlocal started
        started = asyncio.Event()
        monkeypatch.setattr(generation, "_slots", asyncio.Semaphore(1))
        job = asyncio.create_task(generation._generate(uuid4(), uuid4(), USER, MODEL, "key"))
        await asyncio.wait_for(started.wait(), 1)
        assert generation._slots_in_use == 1
        job.cancel()
        with pytest.raises(asyncio.CancelledError):
            await job

    asyncio.run(run())
    line = reply_lines(caplog)[0]
    assert line["outcome"] == "cancelled"
    assert line["queue_wait_ms"] >= 0
    assert line["duration_ms"] >= 0
    assert generation._slots_in_use == 0


def test_cancel_during_titles_stays_done(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app.generation")
    fake_job(monkeypatch)
    titling = None

    async def hanging_title(*_):
        titling.set()
        await asyncio.Event().wait()

    async def run():
        nonlocal titling
        titling = asyncio.Event()
        monkeypatch.setattr(generation, "_slots", asyncio.Semaphore(1))
        monkeypatch.setattr(generation, "_write_title", hanging_title)
        job = asyncio.create_task(generation._generate(uuid4(), uuid4(), USER, MODEL, "key"))
        await asyncio.wait_for(titling.wait(), 1)
        job.cancel()
        with pytest.raises(asyncio.CancelledError):
            await job

    asyncio.run(run())
    assert reply_lines(caplog)[0]["outcome"] == "done"


@pytest.mark.parametrize(
    ("check", "conn", "limit", "count"),
    [
        (_check_running, FakeConn(MAX_OPEN_PER_USER), "open_cap", MAX_OPEN_PER_USER),
        (_check_rate, FakeConn(MAX_PROMPTS_PER_MINUTE, 5), "rate", MAX_PROMPTS_PER_MINUTE),
    ],
)
def test_refusals_log_one_line(check, conn, limit, count, caplog):
    caplog.set_level(logging.INFO, logger="app.routes.generate")
    with pytest.raises(HTTPException):
        asyncio.run(check(conn, USER))
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("refused ")]
    assert [json.loads(line.removeprefix("refused ")) for line in lines] == [
        {"user_id": str(USER), "limit": limit, "count": count}
    ]


def test_memory_is_read_from_proc(monkeypatch, tmp_path):
    status = tmp_path / "status"
    status.write_text("Name:\tpython\nVmRSS:\t  123456 kB\nThreads:\t4\n")
    real_open = open
    monkeypatch.setattr("builtins.open", lambda *_: real_open(status))
    assert generation._memory_kb() == 123456


def test_memory_is_empty_without_proc(monkeypatch):
    def missing(*_):
        raise FileNotFoundError

    monkeypatch.setattr("builtins.open", missing)
    assert generation._memory_kb() is None


def test_load_line_is_logged_on_a_timer(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app.generation")
    monkeypatch.setattr(generation, "LOAD_LOG_SECONDS", 0)
    monkeypatch.setattr(generation, "_memory_kb", lambda: 7)

    async def run():
        job = asyncio.create_task(generation.log_load())
        await asyncio.sleep(0.01)
        job.cancel()

    asyncio.run(run())
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("load "))
    assert json.loads(line.removeprefix("load ")) == {
        "slots_in_use": generation._slots_in_use,
        "slots": generation.MAX_CONCURRENT,
        "vmrss_kb": 7,
    }


def test_app_logs_at_info_and_nothing_else_does():
    app_logger = logging.getLogger("app")
    assert app_logger.level == logging.INFO
    assert app_logger.handlers
    assert logging.getLogger("httpx").getEffectiveLevel() > logging.INFO
