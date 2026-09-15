from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import current_user
from ..keys import usable_providers
from ..providers.catalog import DEFAULT_MODEL, LABELS, MODELS

router = APIRouter(tags=["models"])


class ModelInfo(BaseModel):
    id: str
    label: str
    provider: str
    available: bool  # the user has a key for its provider


class ModelsResponse(BaseModel):
    models: list[ModelInfo]
    default: str


@router.get("/models", response_model=ModelsResponse)
async def list_models(user_id: UUID = Depends(current_user)):
    usable = await usable_providers(user_id)
    return ModelsResponse(
        models=[
            ModelInfo(id=model_id, label=LABELS[model_id], provider=provider, available=provider in usable)
            for model_id, provider in MODELS.items()
        ],
        default=DEFAULT_MODEL,
    )
