from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session
from app.models import Endpoint, EventStatus, WebhookEvent
from app.schemas import IngestResponse
from app.security import compute_fallback_idempotency_key, verify_hmac_signature
from app.worker import deliver_webhook_event

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


@router.post(
    "/{slug}",
    responses={
        status.HTTP_200_OK: {"model": IngestResponse},
        status.HTTP_202_ACCEPTED: {"model": IngestResponse},
    },
)
async def ingest_webhook(
    slug: str,
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Receive a webhook, validate HMAC signature, enforce idempotency, and queue delivery."""
    result = await session.exec(select(Endpoint).where(Endpoint.slug == slug))
    endpoint = result.first()
    if endpoint is None or not endpoint.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Endpoint not found or inactive",
        )

    raw_body = await request.body()

    if endpoint.signing_secret:
        signature_header = request.headers.get("x-webhook-signature")
        if not verify_hmac_signature(endpoint.signing_secret, raw_body, signature_header):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing X-Webhook-Signature",
            )

    raw_idempotency_key = request.headers.get("x-idempotency-key")
    if raw_idempotency_key and raw_idempotency_key.strip():
        idempotency_key = raw_idempotency_key.strip()
        if len(idempotency_key) > 255:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Idempotency-Key exceeds 255 characters",
            )
    else:
        idempotency_key = compute_fallback_idempotency_key(slug, raw_body)

    existing_result = await session.exec(
        select(WebhookEvent).where(
            WebhookEvent.endpoint_id == endpoint.id,
            WebhookEvent.idempotency_key == idempotency_key,
        )
    )
    existing = existing_result.first()
    if existing is not None:
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"event_id": str(existing.id), "status": "duplicate_ignored"},
        )

    headers_dict = {k: v for k, v in request.headers.items()}
    payload_text = raw_body.decode("utf-8", errors="replace")

    event = WebhookEvent(
        endpoint_id=endpoint.id,
        idempotency_key=idempotency_key,
        status=EventStatus.PENDING.value,
        attempts=0,
        request_headers=headers_dict,
        payload=payload_text,
    )

    try:
        session.add(event)
        await session.commit()
        await session.refresh(event)
    except IntegrityError:
        await session.rollback()
        conflict_result = await session.exec(
            select(WebhookEvent).where(
                WebhookEvent.endpoint_id == endpoint.id,
                WebhookEvent.idempotency_key == idempotency_key,
            )
        )
        existing_on_conflict = conflict_result.first()
        if existing_on_conflict is not None:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "event_id": str(existing_on_conflict.id),
                    "status": "duplicate_ignored",
                },
            )
        raise

    background_tasks.add_task(deliver_webhook_event, event.id)

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"event_id": str(event.id), "status": "queued"},
    )
