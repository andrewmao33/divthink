from uuid import UUID

from fastapi import APIRouter, Depends, Response

from ..auth import current_user, forget_user, supabase_logins
from ..config import settings
from ..db import get_pool
from ..generation import cancel_generation

router = APIRouter(prefix="/account", tags=["account"])


@router.delete("", status_code=204)
async def delete_account(user_id: UUID = Depends(current_user)):
    """Delete the signed-in user: every canvas, card, attachment and saved key
    (ON DELETE CASCADE from users), and their Supabase login, in one transaction.

    The login has to go too: users.email is UNIQUE, so if only our row went and
    the same address signed up again, its new id would collide with the old email.
    """
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
