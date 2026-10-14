from uuid import UUID

import stripe
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from ..auth import current_user, forget_user, supabase_logins
from ..config import settings
from ..db import get_pool
from ..generation import cancel_generation
from ..plans import PLANS
from .billing import cancel_subscription

router = APIRouter(prefix="/account", tags=["account"])


class Account(BaseModel):
    plan: str  # free, pro, pro_max
    plan_label: str
    canvases: int
    canvas_limit: int | None  # None = unlimited
    card_limit: int | None  # per canvas
    month_cost_usd: float  # what this month's replies cost, whoever's key paid
    payments_enabled: bool  # Stripe is set up, so Upgrade works
    has_subscription: bool  # a Stripe customer exists, so Manage works


@router.get("", response_model=Account)
async def get_account(user_id: UUID = Depends(current_user)):
    """The plan, how much of it is used, and this month's spend (Settings → Billing)."""
    row = await get_pool().fetchrow(
        """
        SELECT u.plan, u.stripe_customer_id,
               (SELECT count(*) FROM sessions WHERE user_id = u.id) AS canvases,
               (SELECT coalesce(sum(cost_usd), 0) FROM usage_events
                WHERE user_id = u.id AND created_at >= date_trunc('month', now())) AS month_cost
        FROM users u WHERE u.id = $1
        """,
        user_id,
    )
    plan = PLANS[row["plan"]]
    return Account(
        plan=row["plan"],
        plan_label=plan.label,
        canvases=row["canvases"],
        canvas_limit=plan.canvases,
        card_limit=plan.cards_per_canvas,
        month_cost_usd=float(row["month_cost"]),
        payments_enabled=settings.payments_enabled,
        has_subscription=row["stripe_customer_id"] is not None,
    )


@router.delete("", status_code=204)
async def delete_account(user_id: UUID = Depends(current_user)):
    """Delete the signed-in user: every canvas, card, attachment and saved key
    (ON DELETE CASCADE from users), and their Supabase login, in one transaction.

    The login has to go too: users.email is UNIQUE, so if only our row went and
    the same address signed up again, its new id would collide with the old email.
    """
    # Billing stops first: if Stripe can't be reached, nothing is deleted, rather
    # than leaving a subscription charging for an account that no longer exists.
    customer_id = await get_pool().fetchval(
        "SELECT stripe_customer_id FROM users WHERE id = $1", user_id
    )
    try:
        await cancel_subscription(customer_id)
    except stripe.StripeError as e:
        if getattr(e, "code", None) != "resource_missing":  # already gone is fine
            raise HTTPException(
                status_code=502,
                detail="Couldn't cancel your subscription with Stripe, so nothing was deleted. Try again.",
            )
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Stop any reply still being written before its row goes, so the job
            # can't write to a node that no longer exists.
            running = await conn.fetch(
                """
                SELECT n.id FROM nodes n JOIN sessions s ON s.id = n.session_id
                WHERE s.user_id = $1 AND n.status IN ('pending', 'streaming')
                """,
                user_id,
            )
            if running:
                cancel_generation([r["id"] for r in running])
            if not settings.auth_enabled:
                # The built-in dev user has to survive: every request is it.
                # Empty it instead, which is the same thing to see.
                await conn.execute("DELETE FROM sessions WHERE user_id = $1", user_id)
                await conn.execute("DELETE FROM api_keys WHERE user_id = $1", user_id)
                return Response(status_code=204)
            await conn.execute("DELETE FROM users WHERE id = $1", user_id)
            # Supabase keeps logins in the same database. Absent locally.
            if await supabase_logins(conn):
                await conn.execute("DELETE FROM auth.users WHERE id = $1", user_id)
    forget_user(user_id)
    return Response(status_code=204)
