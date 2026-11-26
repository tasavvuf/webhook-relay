import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session
from app.models import Endpoint, EventStatus, WebhookEvent
from app.schemas import EndpointCreate, EndpointRead
from app.security import generate_signing_secret, generate_slug

router = APIRouter(prefix="/api/endpoints", tags=["endpoints"])


@router.get("", response_model=list[EndpointRead])
async def list_endpoints(session: AsyncSession = Depends(get_session)) -> list[EndpointRead]:
    """List all registered webhook endpoints along with event delivery counts."""
    counts_stmt = (
        select(
            WebhookEvent.endpoint_id,
            func.count(WebhookEvent.id).label("total"),
            func.sum(
                case((WebhookEvent.status == EventStatus.DELIVERED.value, 1), else_=0)
            ).label("delivered"),
            func.sum(
                case((WebhookEvent.status == EventStatus.FAILED.value, 1), else_=0)
            ).label("failed"),
        )
        .group_by(WebhookEvent.endpoint_id)
    )
    counts_result = await session.exec(counts_stmt)
    counts_by_endpoint = {
        row[0]: (int(row[1] or 0), int(row[2] or 0), int(row[3] or 0))
        for row in counts_result.all()
    }

    endpoints_result = await session.exec(
        select(Endpoint).order_by(Endpoint.created_at.desc())
    )
    endpoints = endpoints_result.all()

    response: list[EndpointRead] = []
    for ep in endpoints:
        total, delivered, failed = counts_by_endpoint.get(ep.id, (0, 0, 0))
        response.append(
            EndpointRead(
                id=ep.id,
                name=ep.name,
                slug=ep.slug,
                target_url=ep.target_url,
                signing_secret=ep.signing_secret,
                is_active=ep.is_active,
                created_at=ep.created_at,
                event_count=total,
                delivered_count=delivered,
                failed_count=failed,
            )
        )
    return response


@router.post("", response_model=EndpointRead, status_code=status.HTTP_201_CREATED)
async def create_endpoint(
    payload: EndpointCreate,
    session: AsyncSession = Depends(get_session),
) -> EndpointRead:
    """Register a new webhook ingestion endpoint."""
    slug = generate_slug()
    for _ in range(5):
        existing = await session.exec(select(Endpoint.id).where(Endpoint.slug == slug))
        if existing.first() is None:
            break
        slug = generate_slug()

    secret: str | None = None
    if payload.signing_secret and payload.signing_secret.strip():
        secret = payload.signing_secret.strip()
    elif payload.use_secret:
        secret = generate_signing_secret()

    endpoint = Endpoint(
        name=payload.name.strip(),
        slug=slug,
        target_url=str(payload.target_url),
        signing_secret=secret,
        is_active=True,
    )
    session.add(endpoint)
    await session.commit()
    await session.refresh(endpoint)

    return EndpointRead(
        id=endpoint.id,
        name=endpoint.name,
        slug=endpoint.slug,
        target_url=endpoint.target_url,
        signing_secret=endpoint.signing_secret,
        is_active=endpoint.is_active,
        created_at=endpoint.created_at,
        event_count=0,
        delivered_count=0,
        failed_count=0,
    )


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_endpoint(
    endpoint_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete an endpoint and all associated webhook events."""
    endpoint = await session.get(Endpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint not found")

    await session.delete(endpoint)
    await session.commit()
