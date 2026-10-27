from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .. import repos
from ..auth import current_user
from ..db import get_pool

router = APIRouter(prefix="/sessions", tags=["repos"])


class ConnectRepo(BaseModel):
    url: str = Field(max_length=500)


class Repo(BaseModel):
    owner: str
    name: str
    ref: str
    sha: str
    file_count: int
    truncated: bool


async def _check_owner(session_id: UUID, user_id: UUID) -> None:
    found = await get_pool().fetchval(
        "SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2", session_id, user_id
    )
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")


@router.put("/{session_id}/repo", response_model=Repo)
async def connect_repo(session_id: UUID, body: ConnectRepo, user_id: UUID = Depends(current_user)):
    """Download a public GitHub repo and connect it to the canvas, replacing any
    connected before. Takes a few seconds: the download happens in the request."""
    await _check_owner(session_id, user_id)
    try:
        snapshot = await repos.download(body.url)
    except repos.RepoError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Checked again: the canvas may have been deleted during the download.
            found = await conn.fetchval(
                "SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2 FOR UPDATE",
                session_id, user_id,
            )
            if not found:
                raise HTTPException(status_code=404, detail="Session not found")
            return await repos.save(conn, session_id, snapshot)


@router.delete("/{session_id}/repo", status_code=204)
async def disconnect_repo(session_id: UUID, user_id: UUID = Depends(current_user)):
    """Replies already written keep what they said; new ones no longer see the code."""
    await _check_owner(session_id, user_id)
    await get_pool().execute("DELETE FROM repos WHERE session_id = $1", session_id)
    return Response(status_code=204)
