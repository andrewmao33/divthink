from fastapi import APIRouter
from pydantic import BaseModel

from ..providers.catalog import DEFAULT_MODEL, LABELS, MODELS, provider_configured

router = APIRouter(tags=["models"])


class ModelInfo(BaseModel):
    id: str
    label: str
    provider: str
    available: bool  # its provider's API key is set


class ModelsResponse(BaseModel):
    models: list[ModelInfo]
    default: str


@router.get("/models", response_model=ModelsResponse)
async def list_models():
    return ModelsResponse(
        models=[
            ModelInfo(id=model_id, label=LABELS[model_id], provider=provider, available=provider_configured(provider))
            for model_id, provider in MODELS.items()
        ],
        default=DEFAULT_MODEL,
    )
