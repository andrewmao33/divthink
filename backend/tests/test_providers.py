import asyncio
import io
import urllib.error
from unittest.mock import patch

import pytest

from app.providers.base import BaseProvider
from app.providers.catalog import CONTEXT_TOKENS, LABELS, MODELS, PRICES, PROVIDER_LABELS, SEARCH_PRICE
from app.providers.registry import PROVIDERS


def test_every_provider_in_the_catalog_is_registered():
    assert set(MODELS.values()) == set(PROVIDERS) == set(PROVIDER_LABELS) == set(SEARCH_PRICE)
    assert all(isinstance(provider, BaseProvider) for provider in PROVIDERS.values())


def test_every_model_has_its_details():
    assert set(MODELS) == set(LABELS) == set(CONTEXT_TOKENS) == set(PRICES)


def test_a_provider_missing_a_method_cant_be_created():
    class Incomplete(BaseProvider):
        pass

    with pytest.raises(TypeError):
        Incomplete()


@pytest.mark.parametrize("name", PROVIDERS)
@pytest.mark.parametrize(
    ("status", "expected"),
    [(401, "invalid"), (403, "invalid"), (400, "invalid"), (429, "unavailable"), (500, "unavailable")],
)
def test_check_key_reads_the_providers_answer(name, status, expected):
    error = urllib.error.HTTPError("https://example.com", status, "", {}, io.BytesIO())
    with patch("urllib.request.urlopen", side_effect=error):
        assert asyncio.run(PROVIDERS[name].check_key("some-key")) == expected
