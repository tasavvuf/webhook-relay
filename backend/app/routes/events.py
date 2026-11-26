import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session
from app.models import Endpoint, EventStatus, WebhookEvent
from app.schemas import WebhookEventListItem, WebhookEventRead
from app.worker import deliver_webhook_event

router = APIRouter(tags=["events"])


@router.get("/api/endpoints/{endpoint_id}/events", response_model=list[WebhookEventListItem])
async def list_endpoint_events(
    endpoint_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
) -> list[WebhookEvent]:
    """List recent webhook events for a specific endpoint."""
    endpoint = await session.get(Endpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint not found")

    result = await session.exec(
        select(WebhookEvent)
        .where(WebhookEvent.endpoint_id == endpoint_id)
        .order_by(WebhookEvent.created_at.desc())
        .limit(limit)
    )
    return list(result.all())


@router.get("/api/events/{event_id}", response_model=WebhookEventRead)
async def get_event_detail(
    event_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> WebhookEvent:
    """Fetch full headers, raw payload, and target response for a single event."""
    event = await session.get(WebhookEvent, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


@router.post("/api/events/{event_id}/replay", response_model=WebhookEventRead)
async def replay_event(
    event_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> WebhookEvent:
    """Reset attempt counters and re-queue an event for delivery."""
    event = await session.get(WebhookEvent, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    event.attempts = 0
    event.status = EventStatus.RETRYING.value
    event.error_message = None
    event.response_status = None
    event.response_body = None

    session.add(event)
    await session.commit()
    await session.refresh(event)

    background_tasks.add_task(deliver_webhook_event, event.id)
    return event
