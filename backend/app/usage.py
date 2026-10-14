"""What each model call cost, kept per user in a log of its own.

The log is separate from the nodes so that deleting a card or a canvas doesn't
take its cost with it: a monthly allowance has to count what was spent, not
what is still on the canvas.
"""

import logging
from uuid import UUID

from .db import get_pool
from .providers.base import Usage
from .providers.catalog import MODELS, PRICES, SEARCH_PRICE

log = logging.getLogger(__name__)


def cost_usd(model: str, usage: Usage) -> float:
    input_price, output_price, read_price, write_price = PRICES[model]
    tokens = (
        usage.input_tokens * input_price
        + usage.output_tokens * output_price
        + usage.cache_read_tokens * read_price
        + usage.cache_write_tokens * write_price
    ) / 1_000_000
    return tokens + usage.searches * SEARCH_PRICE[MODELS[model]]


async def record(session_id: UUID, node_id: UUID, model: str, kind: str, usage: Usage) -> float:
    """Log one call (`kind`: "reply" or "title") against the canvas's owner.
    Returns its cost. Never raises: a missing log row is not a reason to fail a reply."""
    cost = cost_usd(model, usage)
    try:
        await get_pool().execute(
            """
            INSERT INTO usage_events (user_id, node_id, model, kind, input_tokens,
                output_tokens, cache_read_tokens, cache_write_tokens, searches, cost_usd)
            SELECT user_id, $2, $3, $4, $5, $6, $7, $8, $9, $10 FROM sessions WHERE id = $1
            """,
            session_id, node_id, model, kind, usage.input_tokens, usage.output_tokens,
            usage.cache_read_tokens, usage.cache_write_tokens, usage.searches, cost,
        )
    except Exception:
        log.exception("could not log usage for node %s", node_id)
    return cost
