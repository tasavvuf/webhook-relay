from datetime import datetime, timezone
from enum import Enum
from typing import Optional
import uuid

from sqlalchemy import JSON, Column, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlmodel import Field, Relationship, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class EventStatus(str, Enum):
    PENDING = "pending"
    RETRYING = "retrying"
    DELIVERED = "delivered"
    FAILED = "failed"


class Endpoint(SQLModel, table=True):
    """Registered webhook ingestion route and forwarding configuration."""

    __tablename__ = "endpoints"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100, nullable=False)
    slug: str = Field(max_length=32, unique=True, index=True, nullable=False)
    target_url: str = Field(sa_column=Column(Text, nullable=False))
    signing_secret: Optional[str] = Field(default=None, max_length=128)
    is_active: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    events: list["WebhookEvent"] = Relationship(
        back_populates="endpoint",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class WebhookEvent(SQLModel, table=True):
    """Persisted incoming webhook payload and its delivery lifecycle state."""

    __tablename__ = "webhook_events"
    __table_args__ = (
        UniqueConstraint(
            "endpoint_id",
            "idempotency_key",
            name="uq_webhook_events_endpoint_idempotency",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    endpoint_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid,
            ForeignKey("endpoints.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    idempotency_key: str = Field(max_length=255, index=True, nullable=False)
    status: str = Field(
        default=EventStatus.PENDING.value,
        sa_column=Column(String(20), nullable=False, default=EventStatus.PENDING.value),
    )
    attempts: int = Field(default=0, nullable=False)
    request_headers: dict[str, str] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    payload: str = Field(
        default="",
        sa_column=Column(Text, nullable=False),
    )
    response_status: Optional[int] = Field(default=None, nullable=True)
    response_body: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    error_message: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    last_attempt_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    endpoint: Optional[Endpoint] = Relationship(back_populates="events")
