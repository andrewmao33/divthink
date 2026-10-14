"""Paying for Pro, through Stripe.

Upgrade opens Divthink's own checkout screen, with Stripe's payment fields in it
(Checkout Sessions in "elements" mode); Manage sends the browser to Stripe's
customer portal (change card, cancel). Neither changes the plan itself: Stripe
tells the webhook what happened, and the webhook is the only thing that sets
users.plan from a payment. Card details never reach this server.
"""

import logging
from uuid import UUID

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from ..auth import current_user
from ..config import settings
from ..db import get_pool

router = APIRouter(prefix="/billing", tags=["billing"])
log = logging.getLogger(__name__)

# Subscription states that keep Pro. past_due is a card retry in progress: Stripe
# keeps trying for a while, and cancels (subscription.deleted) if it never works.
ACTIVE = {"active", "trialing", "past_due"}


class Redirect(BaseModel):
    url: str


class CheckoutSession(BaseModel):
    client_secret: str  # Stripe.js draws the payment fields with it


def _client() -> stripe.StripeClient:
    if not settings.payments_enabled:
        raise HTTPException(status_code=503, detail="Payments aren't set up yet.")
    return stripe.StripeClient(settings.stripe_secret_key)


def _settings_url(result: str) -> str:
    return f"{settings.app_url.rstrip('/')}/?billing={result}"


@router.post("/checkout", response_model=CheckoutSession)
async def checkout(user_id: UUID = Depends(current_user)):
    """A Stripe Checkout session for Pro, for the checkout screen to complete."""
    client = _client()
    row = await get_pool().fetchrow(
        "SELECT email, plan, stripe_customer_id FROM users WHERE id = $1", user_id
    )
    if row["plan"] != "free":
        raise HTTPException(status_code=409, detail="You're already on a paid plan.")
    customer_id = row["stripe_customer_id"] or await _new_customer(client, user_id, row["email"])
    try:
        session = await client.v1.checkout.sessions.create_async(params={
            "mode": "subscription",
            "ui_mode": "elements",
            "customer": customer_id,
            "client_reference_id": str(user_id),
            "line_items": [{"price": settings.stripe_price_pro, "quantity": 1}],
            # Cards finish in place; only a payment method that has to leave for
            # its bank comes back through this address.
            "return_url": _settings_url("success"),
            "allow_promotion_codes": True,
            # Stripe's merchant-of-record service (it handles sales tax for a
            # 3.5% fee). Off unless chosen on purpose: when an account has it
            # half set up, Stripe refuses every checkout that uses it.
            "managed_payments": {"enabled": False},
        })
    except stripe.StripeError:
        log.exception("could not start checkout for %s", user_id)
        raise HTTPException(status_code=502, detail="Couldn't reach Stripe. Try again.")
    return CheckoutSession(client_secret=session.client_secret)


async def _new_customer(client: stripe.StripeClient, user_id: UUID, email: str) -> str:
    try:
        customer = await client.v1.customers.create_async(
            params={"email": email, "metadata": {"user_id": str(user_id)}}
        )
    except stripe.StripeError:
        log.exception("could not create a Stripe customer for %s", user_id)
        raise HTTPException(status_code=502, detail="Couldn't reach Stripe. Try again.")
    await get_pool().execute(
        "UPDATE users SET stripe_customer_id = $2 WHERE id = $1", user_id, customer.id
    )
    return customer.id


@router.post("/portal", response_model=Redirect)
async def portal(user_id: UUID = Depends(current_user)):
    """Stripe's customer portal: change the card, see invoices, cancel."""
    client = _client()
    customer_id = await get_pool().fetchval(
        "SELECT stripe_customer_id FROM users WHERE id = $1", user_id
    )
    if not customer_id:
        raise HTTPException(status_code=404, detail="There's no subscription to manage.")
    try:
        session = await client.v1.billing_portal.sessions.create_async(
            params={"customer": customer_id, "return_url": _settings_url("managed")}
        )
    except stripe.StripeError:
        log.exception("could not open the billing portal for %s", user_id)
        raise HTTPException(status_code=502, detail="Couldn't reach Stripe. Try again.")
    return Redirect(url=session.url)


@router.post("/webhook", include_in_schema=False)
async def webhook(request: Request):
    """Stripe's report of what happened. Signed, so nobody else can send one."""
    client = _client()
    payload = await request.body()
    try:
        event = client.construct_event(
            payload, request.headers.get("stripe-signature", ""), settings.stripe_webhook_secret
        )
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid signature")

    data = event.data.object.to_dict()
    if (
        event.type == "checkout.session.completed"
        and data.get("mode") == "subscription"
        and data.get("payment_status") in ("paid", "no_payment_required")
    ):
        # Matched by the customer we created at checkout, which carries the account.
        await _set_plan(data.get("customer"), "pro")
    elif event.type in ("customer.subscription.updated", "customer.subscription.deleted"):
        status = data.get("status")
        await _set_plan(data.get("customer"), "pro" if status in ACTIVE else "free")
    return Response(status_code=200)


async def _set_plan(customer_id: str | None, plan: str) -> None:
    if not customer_id:
        return
    # Only between free and pro: an account given another plan by hand
    # (pro_max) is left alone.
    updated = await get_pool().fetchval(
        """
        UPDATE users SET plan = $2
        WHERE stripe_customer_id = $1 AND plan IN ('free', 'pro')
        RETURNING id
        """,
        customer_id, plan,
    )
    log.info("stripe customer %s -> %s (%s)", customer_id, plan, "updated" if updated else "no account")


async def cancel_subscription(customer_id: str | None) -> None:
    """For a deleted account: deleting the Stripe customer cancels its
    subscription straight away, so nobody is billed for an account that's gone."""
    if not customer_id or not settings.stripe_secret_key:
        return
    client = stripe.StripeClient(settings.stripe_secret_key)
    await client.v1.customers.delete_async(customer_id)
