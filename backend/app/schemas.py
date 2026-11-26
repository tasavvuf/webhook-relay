from datetime import datetime
from typing import Optional
import uuid

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field


class EndpointCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    target_url: AnyHttpUrl
    use_secret: bool = True
    signing_secret: Optional[str] = Field(default=None, max_length=128)


class EndpointRead(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    target_url: str
    signing_secret: Optional[str] = None
    is_active: bool
    created_at: datetime
    event_count: int = 0
    delivered_count: int = 0
    failed_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class IngestResponse(BaseModel):
    event_id: uuid.UUID
    status: str


class WebhookEventListItem(BaseModel):
    id: uuid.UUID
    endpoint_id: uuid.UUID
    idempotency_key: str
    status: str
    attempts: int
    response_status: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime
    last_attempt_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class WebhookEventRead(WebhookEventListItem):
    request_headers: dict[str, str]
    payload: str
    response_body: Optional[str] = None
