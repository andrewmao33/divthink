from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class Node(BaseModel):
    id: UUID
    prompt: str
    response: str
    model: str | None
    position_x: float
    position_y: float
    status: str
    metadata: dict[str, Any]
    created_at: datetime


class Edge(BaseModel):
    id: UUID
    parent_id: UUID
    child_id: UUID


NODE_COLUMNS = "id, prompt, response, model, position_x, position_y, status, metadata, created_at"
