import asyncio
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import HTTPException, Request

from .config import DEV_USER_ID, settings
from .db import get_pool

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
    await get_pool().execute(
        """
        INSERT INTO users (id, email) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
        """,
        user_id, email or f"{user_id}@users.divthink",
    )
    _users_seen.add(user_id)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401, detail="Please sign in again.", headers={"WWW-Authenticate": "Bearer"}
    )
