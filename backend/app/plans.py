"""Plans and what each allows. The plan is set on users.plan; Stripe will set it
once payments exist, and until then it is changed by hand in the SQL editor.

Limits stop new things being made, never take away what exists (402, which the
browser answers with an Upgrade button): an account
already over a limit keeps everything, and can read and delete as before.
"""

from dataclasses import dataclass
from uuid import UUID

import asyncpg
from fastapi import HTTPException


@dataclass(frozen=True)
class Plan:
    label: str
    canvases: int | None  # None = unlimited
    cards_per_canvas: int | None


PLANS = {
    "free": Plan("Free", canvases=5, cards_per_canvas=50),
    "pro": Plan("Pro", canvases=None, cards_per_canvas=None),
    # Advertised as coming soon. Until it exists (included model use on our own
    # keys), an account set to it is treated exactly like Pro.
    "pro_max": Plan("Pro Max", canvases=None, cards_per_canvas=None),
}


async def plan_of(conn: asyncpg.Connection | asyncpg.Pool, user_id: UUID) -> str:
    return await conn.fetchval("SELECT plan FROM users WHERE id = $1", user_id) or "free"


async def check_new_canvas(conn: asyncpg.Connection | asyncpg.Pool, user_id: UUID) -> None:
    plan = PLANS[await plan_of(conn, user_id)]
    if plan.canvases is None:
        return
    count = await conn.fetchval("SELECT count(*) FROM sessions WHERE user_id = $1", user_id)
    if count >= plan.canvases:
        raise HTTPException(
            status_code=402,
            detail=(
                f"The {plan.label} plan has room for {plan.canvases} canvases. "
                "Delete one to start another, or upgrade to Pro."
            ),
        )


async def check_new_card(conn: asyncpg.Connection, user_id: UUID, session_id: UUID) -> None:
    plan = PLANS[await plan_of(conn, user_id)]
    if plan.cards_per_canvas is None:
        return
    # A card is a prompt and its reply, so prompts are what's counted.
    count = await conn.fetchval(
        "SELECT count(*) FROM nodes WHERE session_id = $1 AND type = 'user'", session_id
    )
    if count >= plan.cards_per_canvas:
        raise HTTPException(
            status_code=402,
            detail=(
                f"This canvas is full: the {plan.label} plan has room for "
                f"{plan.cards_per_canvas} cards per canvas. Start a new canvas, "
                "or upgrade to Pro."
            ),
        )
