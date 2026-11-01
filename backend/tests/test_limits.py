import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routes.generate import MAX_OPEN_PER_USER, _check_running


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
