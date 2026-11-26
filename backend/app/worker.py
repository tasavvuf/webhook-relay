import asyncio
from collections.abc import Callable
import uuid

import httpx
from sqlmodel import select

from app import database
from app.config import settings
from app.models import Endpoint, EventStatus, WebhookEvent, utc_now

HOP_BY_HOP_HEADERS = frozenset(
    {
        "host",
        "content-length",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
    }
)

MAX_RESPONSE_BODY_CHARS = 2048


def build_forward_headers(request_headers: dict[str, str], event_id: uuid.UUID) -> dict[str, str]:
    """Filter unsafe hop-by-hop headers and attach X-Relay-Event-ID."""
    forwarded: dict[str, str] = {}
    for key, value in request_headers.items():
        if key.lower() not in HOP_BY_HOP_HEADERS:
            forwarded[key] = value
    forwarded["X-Relay-Event-ID"] = str(event_id)
    return forwarded


async def deliver_webhook_event(
    event_id: uuid.UUID,
    session_factory: Callable | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    """Forward a persisted webhook event to its target URL with exponential backoff."""
    maker = session_factory or database.async_session_maker

    async with maker() as session:
        result = await session.exec(select(WebhookEvent).where(WebhookEvent.id == event_id))
        event = result.first()
        if event is None:
            return

        ep_result = await session.exec(select(Endpoint).where(Endpoint.id == event.endpoint_id))
        endpoint = ep_result.first()
        if endpoint is None:
            return

        forward_headers = build_forward_headers(event.request_headers, event.id)
        body_bytes = event.payload.encode("utf-8")

        client_kwargs: dict = {"timeout": settings.DELIVERY_TIMEOUT_SECONDS}
        if transport is not None:
            client_kwargs["transport"] = transport

        async with httpx.AsyncClient(**client_kwargs) as client:
            while event.attempts < settings.MAX_DELIVERY_ATTEMPTS:
                event.attempts += 1
                event.last_attempt_at = utc_now()

                try:
                    response = await client.post(
                        endpoint.target_url,
                        content=body_bytes,
                        headers=forward_headers,
                    )
                    event.response_status = response.status_code
                    event.response_body = response.text[:MAX_RESPONSE_BODY_CHARS]

                    if 200 <= response.status_code < 300:
                        event.status = EventStatus.DELIVERED.value
                        event.error_message = None
                        session.add(event)
                        await session.commit()
                        return

                    event.error_message = f"Target returned HTTP {response.status_code}"
                except httpx.TimeoutException as exc:
                    event.response_status = None
                    event.response_body = None
                    event.error_message = f"Request timed out: {exc}"
                except httpx.RequestError as exc:
                    event.response_status = None
                    event.response_body = None
                    event.error_message = f"Network error: {exc}"

                if event.attempts < settings.MAX_DELIVERY_ATTEMPTS:
                    event.status = EventStatus.RETRYING.value
                    session.add(event)
                    await session.commit()
                    delay = settings.BACKOFF_BASE_SECONDS ** event.attempts
                    await asyncio.sleep(delay)
                else:
                    event.status = EventStatus.FAILED.value
                    session.add(event)
                    await session.commit()
                    return
