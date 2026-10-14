import asyncio
import logging
from functools import lru_cache
from uuid import UUID

import asyncpg
import jwt
from fastapi import HTTPException, Request

from .config import DEV_USER_ID, settings
from .db import get_pool

log = logging.getLogger(__name__)

_users_seen: set[UUID] = set()


async def current_user(request: Request) -> UUID:
    """The signed-in user's id. A FastAPI dependency on every route that touches user data.

    Verifies the Supabase access token (Authorization: Bearer ...) against the
    project's public signing keys. Without SUPABASE_URL (local development) every
    request is the built-in dev user.
    """
    if not settings.auth_enabled:
        return DEV_USER_ID

    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()

    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    try:
        # Fetching the signing keys is blocking I/O (cached after the first call).
        signing_key = await asyncio.to_thread(_jwks().get_signing_key_from_jwt, token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=issuer,
        )
        user_id = UUID(claims["sub"])
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(status_code=503, detail="Sign-in is temporarily unavailable. Try again.")
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _unauthorized()

    await _ensure_user(user_id, claims.get("email"))
    return user_id


@lru_cache
def _jwks() -> jwt.PyJWKClient:
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


async def _ensure_user(user_id: UUID, email: str | None) -> None:
    # Our users row shares the Supabase user id. Created on first request.
    if user_id in _users_seen:
        return
    async with get_pool().acquire() as conn:
        # A deleted account's token stays valid until it expires (up to an hour).
        # Without this, a request from a tab left open would bring its row back.
        if await supabase_logins(conn) and not await _login_exists(conn, user_id):
            raise _unauthorized()
        await conn.execute(
            """
            INSERT INTO users (id, email) VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
            """,
            user_id, email or f"{user_id}@users.divthink",
        )
    _users_seen.add(user_id)


async def _login_exists(conn, user_id: UUID) -> bool:
    try:
        return bool(await conn.fetchval("SELECT 1 FROM auth.users WHERE id = $1", user_id))
    except asyncpg.InsufficientPrivilegeError:
        # Never lock everyone out over this check: without permission to read
        # Supabase's logins, trust the token as before.
        log.warning("No permission to read auth.users; skipping the deleted-account check")
        return True


def forget_user(user_id: UUID) -> None:
    """After an account is deleted: its next request is checked again."""
    _users_seen.discard(user_id)


_has_auth_schema: bool | None = None


async def supabase_logins(conn) -> bool:
    """Whether this database holds Supabase's logins (auth.users): true on
    Supabase, false on the local Docker database."""
    global _has_auth_schema
    if _has_auth_schema is None:
        _has_auth_schema = await conn.fetchval("SELECT to_regclass('auth.users') IS NOT NULL")
    return _has_auth_schema


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401, detail="Please sign in again.", headers={"WWW-Authenticate": "Bearer"}
    )
