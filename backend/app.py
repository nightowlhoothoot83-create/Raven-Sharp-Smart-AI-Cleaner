"""Stripe billing and health extension for Raven Sharp Smart AI Cleaner."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

import server

app = server.app
logger = server.logger
users_col = server.users_col
APP_SLUG = "smart-ai-cleaner"
LIVE_PRICES = {
    "monthly": "price_1TtSM8Rt1GNtAll7LO25wsJu",
    "yearly": "price_1TtSMSRt1GNtAll79smV7Cy9",
}


def _price_id(billing: str) -> str:
    env_name = "STRIPE_PRO_MONTHLY_PRICE_ID" if billing == "monthly" else "STRIPE_PRO_YEARLY_PRICE_ID"
    value = os.environ.get(env_name, "").strip()
    if value:
        return value
    if billing == "monthly":
        legacy = os.environ.get("STRIPE_PRO_PRICE_ID", "").strip()
        if legacy:
            return legacy
    return LIVE_PRICES[billing]


class CheckoutIn(BaseModel):
    tier: Literal["pro"] = "pro"
    billing: Literal["monthly", "yearly"] = "monthly"


_remove_paths = {
    "/api/billing/checkout",
    "/api/billing/webhook",
    "/health",
    "/api/health",
    "/api/billing/config",
}
app.router.routes = [
    route for route in app.router.routes if getattr(route, "path", None) not in _remove_paths
]


def _subscription_id(value) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("id")
    return None


async def _activate_subscription(
    *,
    user_id: str | None,
    subscription_id: str | None,
    billing: str | None,
    status: str = "active",
) -> None:
    if not user_id:
        raise ValueError("Stripe event is missing user_id metadata.")
    if billing not in {"monthly", "yearly"}:
        raise ValueError("Stripe event is missing a valid billing interval.")

    result = await users_col.update_one(
        {"id": user_id},
        {"$set": {
            "tier": "pro",
            "subscription_id": subscription_id,
            "subscription_status": status,
            "billing_interval": billing,
            "scans_this_month": 0,
            "payment_failed_at": None,
            "payment_failure_count": 0,
        }},
    )
    if result.matched_count == 0:
        raise ValueError(f"No Smart AI Cleaner user matches user_id={user_id!r}.")


@app.post("/api/billing/checkout")
async def create_checkout(payload: CheckoutIn, current: dict = Depends(server.get_current_user)):
    if not server.STRIPE_KEY:
        raise HTTPException(503, "Stripe is not configured.")

    price_id = _price_id(payload.billing)
    if not price_id.startswith("price_"):
        raise HTTPException(503, "Stripe pricing is not configured.")

    metadata = {
        "app_slug": APP_SLUG,
        "user_id": current["id"],
        "tier": "pro",
        "billing": payload.billing,
        "price_id": price_id,
    }
    data = {
        "mode": "subscription",
        "line_items[0][price]": price_id,
        "line_items[0][quantity]": "1",
        "success_url": f"{server.FRONTEND_URL}/account?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{server.FRONTEND_URL}/pricing",
        "customer_email": current["email"],
    }
    for key, value in metadata.items():
        data[f"metadata[{key}]"] = value
        data[f"subscription_data[metadata][{key}]"] = value

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://api.stripe.com/v1/checkout/sessions",
            headers={"Authorization": f"Bearer {server.STRIPE_KEY}"},
            data=data,
        )

    if not response.is_success:
        logger.error("Stripe checkout error: %s", response.text[:500])
        raise HTTPException(502, "Unable to create checkout session.")

    return {
        "checkout_url": response.json()["url"],
        "tier": "pro",
        "billing": payload.billing,
    }


@app.get("/api/billing/config")
async def billing_config():
    return {
        "enabled": bool(server.STRIPE_KEY),
        "plans": {
            "pro": {
                "monthly": {"amount_aud": 9, "price_id": _price_id("monthly")},
                "yearly": {"amount_aud": 90, "price_id": _price_id("yearly")},
            }
        },
    }


@app.post("/api/billing/webhook")
async def stripe_webhook(request: Request):
    raw_body = await request.body()
    if not server.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(503, "Webhook not configured.")

    signature = request.headers.get("stripe-signature", "")
    if not server.verify_stripe_signature(raw_body, signature, server.STRIPE_WEBHOOK_SECRET):
        raise HTTPException(400, "Invalid Stripe signature.")

    try:
        event = json.loads(raw_body)
        event_type = event.get("type", "")
        obj = event.get("data", {}).get("object", {})
        metadata = obj.get("metadata") or {}

        event_app = metadata.get("app_slug")
        if event_app and event_app != APP_SLUG:
            return {"ok": True, "ignored": True}

        if event_type == "checkout.session.completed":
            if metadata.get("price_id") not in {_price_id("monthly"), _price_id("yearly")}:
                raise ValueError("Checkout completed with an unexpected Price ID.")
            await _activate_subscription(
                user_id=metadata.get("user_id"),
                subscription_id=_subscription_id(obj.get("subscription")),
                billing=metadata.get("billing"),
            )

        elif event_type in {"customer.subscription.created", "customer.subscription.updated"}:
            status = obj.get("status")
            subscription_id = obj.get("id")
            if status in {"active", "trialing", "past_due"}:
                await _activate_subscription(
                    user_id=metadata.get("user_id"),
                    subscription_id=subscription_id,
                    billing=metadata.get("billing"),
                    status=status,
                )
            else:
                await users_col.update_one(
                    {"subscription_id": subscription_id},
                    {"$set": {"subscription_status": status}},
                )

        elif event_type in {"customer.subscription.deleted", "customer.subscription.paused"}:
            await users_col.update_one(
                {"subscription_id": obj.get("id")},
                {"$set": {
                    "tier": "free",
                    "subscription_status": obj.get("status") or "canceled",
                }},
            )

        elif event_type == "invoice.payment_failed":
            subscription_id = _subscription_id(obj.get("subscription"))
            if subscription_id:
                await users_col.update_one(
                    {"subscription_id": subscription_id},
                    {
                        "$set": {
                            "payment_failed_at": datetime.now(timezone.utc).isoformat(),
                            "subscription_status": "past_due",
                        },
                        "$inc": {"payment_failure_count": 1},
                    },
                )

        elif event_type == "invoice.paid":
            subscription_id = _subscription_id(obj.get("subscription"))
            if subscription_id:
                await users_col.update_one(
                    {"subscription_id": subscription_id},
                    {"$set": {
                        "payment_failed_at": None,
                        "payment_failure_count": 0,
                        "subscription_status": "active",
                    }},
                )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Stripe webhook processing failed: %s", exc)
        raise HTTPException(500, "Webhook processing failed.") from exc

    return {"ok": True}


@app.get("/health")
async def health():
    try:
        await server.db.command("ping")
    except Exception as exc:
        logger.error("Mongo health check failed: %s", exc)
        raise HTTPException(503, "Database unavailable.") from exc

    return {
        "status": "ok",
        "service": "raven-sharp-smart-ai-cleaner",
        "mongo": "ok",
        "stripe_configured": bool(server.STRIPE_KEY),
    }


@app.get("/api/health")
async def api_health():
    return await health()
