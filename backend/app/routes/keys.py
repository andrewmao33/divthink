import asyncio
import urllib.error
import urllib.request
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from ..auth import current_user
from ..db import get_pool
from ..keys import encrypt, encryption_configured, saved_providers
from ..providers.catalog import PROVIDER_LABELS

router = APIRouter(prefix="/keys", tags=["keys"])

Provider = Literal["anthropic", "google"]


class KeyStatus(BaseModel):
    provider: str
    label: str
    configured: bool


class SaveKeyRequest(BaseModel):
    # Printable ASCII, no spaces: every provider key format fits, and it's safe in a header.
    key: str = Field(min_length=10, max_length=500, pattern=r"^[!-~]+$")


@router.get("", response_model=list[KeyStatus])
async def list_keys(user_id: UUID = Depends(current_user)):
    """Which providers have a saved key. Never the keys themselves."""
    saved = await saved_providers(user_id)
    return [KeyStatus(provider=p, label=label, configured=p in saved) for p, label in PROVIDER_LABELS.items()]


@router.put("/{provider}", status_code=204)
async def save_key(provider: Provider, body: SaveKeyRequest, user_id: UUID = Depends(current_user)):
    if not encryption_configured():
        raise HTTPException(status_code=503, detail="Saving API keys isn't set up on this server.")
    key = body.key.strip()
    result = await _check_key(provider, key)
    if result == "invalid":
        raise HTTPException(status_code=400, detail=f"That {PROVIDER_LABELS[provider]} key was rejected. Check it and try again.")
    if result == "unavailable":
        raise HTTPException(status_code=503, detail=f"Couldn't reach {PROVIDER_LABELS[provider]} to check the key. Try again.")
    await get_pool().execute(
        """
        INSERT INTO api_keys (user_id, provider, encrypted_key) VALUES ($1, $2, $3)
        ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_key = EXCLUDED.encrypted_key, created_at = now()
        """,
        user_id, provider, encrypt(key),
    )
    return Response(status_code=204)


@router.delete("/{provider}", status_code=204)
async def delete_key(provider: Provider, user_id: UUID = Depends(current_user)):
    await get_pool().execute("DELETE FROM api_keys WHERE user_id = $1 AND provider = $2", user_id, provider)
    return Response(status_code=204)


async def _check_key(provider: str, key: str) -> Literal["ok", "invalid", "unavailable"]:
    """Try the key on a free, read-only endpoint (listing models) before saving it."""
    if provider == "anthropic":
        request = urllib.request.Request(
            "https://api.anthropic.com/v1/models?limit=1",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        )
    else:
        request = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
            headers={"x-goog-api-key": key},
        )

    def call() -> Literal["ok", "invalid", "unavailable"]:
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return "ok" if response.status == 200 else "unavailable"
        except urllib.error.HTTPError as e:
            return "invalid" if e.code in (400, 401, 403) else "unavailable"
        except OSError:
            return "unavailable"

    return await asyncio.to_thread(call)
