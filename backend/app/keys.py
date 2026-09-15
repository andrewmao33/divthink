"""Users' own provider API keys, encrypted at rest (design.md, "Auth and key storage").

Keys are decrypted only when a reply is generated, never logged, never returned.
"""

from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken

from .config import settings
from .db import get_pool


def encrypt(key: str) -> bytes:
    return _fernet().encrypt(key.encode())


def encryption_configured() -> bool:
    return bool(settings.key_encryption_key)


async def saved_providers(user_id: UUID) -> set[str]:
    rows = await get_pool().fetch("SELECT provider FROM api_keys WHERE user_id = $1", user_id)
    return {r["provider"] for r in rows}


async def usable_providers(user_id: UUID) -> set[str]:
    """Providers this user can generate with right now."""
    providers = await saved_providers(user_id)
    if not settings.auth_enabled:
        providers |= {p for p, key in _dev_keys().items() if key}
    return providers


async def api_key_for(user_id: UUID, provider: str) -> str | None:
    blob = await get_pool().fetchval(
        "SELECT encrypted_key FROM api_keys WHERE user_id = $1 AND provider = $2", user_id, provider
    )
    if blob is not None and encryption_configured():
        try:
            return _fernet().decrypt(bytes(blob)).decode()
        except InvalidToken:
            return None  # encrypted with a different KEY_ENCRYPTION_KEY; the user re-enters it
    if not settings.auth_enabled:
        return _dev_keys().get(provider) or None
    return None


def _fernet() -> Fernet:
    if not settings.key_encryption_key:
        raise RuntimeError("KEY_ENCRYPTION_KEY is not set")
    return Fernet(settings.key_encryption_key.encode())


def _dev_keys() -> dict[str, str]:
    # Local development without sign-in only (auth_enabled is required in production).
    return {"anthropic": settings.anthropic_api_key, "google": settings.google_api_key}
