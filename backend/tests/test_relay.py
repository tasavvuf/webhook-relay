from collections.abc import AsyncGenerator
from pathlib import Path
from unittest.mock import patch
import uuid

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app import database
from app.database import _make_engine, get_session
from app.main import app
from app.models import Endpoint
from app.security import compute_hmac_signature


@pytest_asyncio.fixture
async def test_env(tmp_path: Path):
    """Provide an isolated SQLite DB, patched worker session maker, and ASGI client."""
    db_file = tmp_path / "test_relay.db"
    test_engine = _make_engine(f"sqlite+aiosqlite:///{db_file}")
    async with test_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    test_session_maker = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async def override_get_session() -> AsyncGenerator[AsyncSession, None]:
        async with test_session_maker() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session

    original_maker = database.async_session_maker
    database.async_session_maker = test_session_maker

    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client, test_session_maker
    finally:
        database.async_session_maker = original_maker
        app.dependency_overrides.clear()
        await test_engine.dispose()


def _patch_worker_transport(handler):
    real_async_client = httpx.AsyncClient
    mock_transport = httpx.MockTransport(handler)

    def _client_factory(*args, **kwargs):
        kwargs["transport"] = mock_transport
        return real_async_client(*args, **kwargs)

    return patch("app.worker.httpx.AsyncClient", side_effect=_client_factory)


@pytest.mark.asyncio
async def test_endpoint_crud_and_counts(test_env):
    client, _ = test_env

    create_res = await client.post(
        "/api/endpoints",
        json={
            "name": "Stripe Production",
            "target_url": "https://example.com/webhooks/stripe",
            "use_secret": True,
        },
    )
    assert create_res.status_code == 201
    ep = create_res.json()
    assert ep["name"] == "Stripe Production"
    assert ep["slug"].startswith("wh_")
    assert ep["signing_secret"].startswith("whsec_")
    assert ep["event_count"] == 0

    no_secret_res = await client.post(
        "/api/endpoints",
        json={
            "name": "Internal Hook",
            "target_url": "https://example.com/internal",
            "use_secret": False,
        },
    )
    assert no_secret_res.status_code == 201
    assert no_secret_res.json()["signing_secret"] is None

    list_res = await client.get("/api/endpoints")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 2

    del_res = await client.delete(f"/api/endpoints/{ep['id']}")
    assert del_res.status_code == 204

    missing_del = await client.delete(f"/api/endpoints/{ep['id']}")
    assert missing_del.status_code == 404


@pytest.mark.asyncio
async def test_valid_ingestion_hmac_and_forwarding(test_env):
    client, _ = test_env

    ep_res = await client.post(
        "/api/endpoints",
        json={
            "name": "Orders",
            "target_url": "https://receiver.local/hook",
            "use_secret": True,
        },
    )
    ep = ep_res.json()
    raw_body = b'{"event":"order.paid","amount":4200}'
    signature = compute_hmac_signature(ep["signing_secret"], raw_body)

    captured: list[tuple[bytes, dict[str, str]]] = []

    def target_handler(request: httpx.Request) -> httpx.Response:
        captured.append((request.content, dict(request.headers)))
        return httpx.Response(200, text="accepted:" + ("x" * 2500))

    with _patch_worker_transport(target_handler):
        ingest_res = await client.post(
            f"/api/ingest/{ep['slug']}",
            content=raw_body,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Signature": signature,
                "X-Idempotency-Key": "evt_order_123",
                "X-Custom-Header": "custom-value",
            },
        )

    assert ingest_res.status_code == 202
    data = ingest_res.json()
    assert data["status"] == "queued"
    event_id = data["event_id"]

    assert len(captured) == 1
    forwarded_body, forwarded_headers = captured[0]
    assert forwarded_body == raw_body
    assert forwarded_headers["x-relay-event-id"] == event_id
    assert forwarded_headers["x-custom-header"] == "custom-value"
    assert forwarded_headers["content-type"] == "application/json"

    detail_res = await client.get(f"/api/events/{event_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["status"] == "delivered"
    assert detail["attempts"] == 1
    assert detail["response_status"] == 200
    assert len(detail["response_body"]) == 2048
    assert detail["payload"] == raw_body.decode("utf-8")

    events_res = await client.get(f"/api/endpoints/{ep['id']}/events")
    assert events_res.status_code == 200
    assert len(events_res.json()) == 1


@pytest.mark.asyncio
async def test_invalid_hmac_rejected_and_inactive_404(test_env):
    client, session_maker = test_env

    ep_res = await client.post(
        "/api/endpoints",
        json={
            "name": "Secured",
            "target_url": "https://receiver.local/hook",
            "use_secret": True,
        },
    )
    ep = ep_res.json()

    called = False

    def target_handler(_request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200)

    with _patch_worker_transport(target_handler):
        missing_sig = await client.post(f"/api/ingest/{ep['slug']}", content=b'{"x":1}')
        assert missing_sig.status_code == 401

        bad_sig = await client.post(
            f"/api/ingest/{ep['slug']}",
            content=b'{"x":1}',
            headers={"X-Webhook-Signature": "sha256=0000"},
        )
        assert bad_sig.status_code == 401

        unknown_slug = await client.post("/api/ingest/wh_doesnotexist", content=b'{"x":1}')
        assert unknown_slug.status_code == 404

    assert not called

    async with session_maker() as session:
        db_ep = await session.get(Endpoint, uuid.UUID(ep["id"]))
        assert db_ep is not None
        db_ep.is_active = False
        session.add(db_ep)
        await session.commit()

    inactive_res = await client.post(f"/api/ingest/{ep['slug']}", content=b'{"x":1}')
    assert inactive_res.status_code == 404


@pytest.mark.asyncio
async def test_idempotency_suppression_header_and_fallback(test_env):
    client, _ = test_env

    ep_res = await client.post(
        "/api/endpoints",
        json={
            "name": "Idempotent",
            "target_url": "https://receiver.local/hook",
            "use_secret": False,
        },
    )
    ep = ep_res.json()

    deliveries = 0

    def target_handler(_request: httpx.Request) -> httpx.Response:
        nonlocal deliveries
        deliveries += 1
        return httpx.Response(204)

    with _patch_worker_transport(target_handler):
        first = await client.post(
            f"/api/ingest/{ep['slug']}",
            content=b'{"id":1}',
            headers={"X-Idempotency-Key": "idem-abc"},
        )
        second = await client.post(
            f"/api/ingest/{ep['slug']}",
            content=b'{"id":1}',
            headers={"X-Idempotency-Key": "idem-abc"},
        )

    assert first.status_code == 202
    assert second.status_code == 200
    assert second.json() == {
        "event_id": first.json()["event_id"],
        "status": "duplicate_ignored",
    }
    assert deliveries == 1

    # Fallback hash based on slug + raw body when X-Idempotency-Key is absent
    with _patch_worker_transport(target_handler):
        fb_first = await client.post(
            f"/api/ingest/{ep['slug']}",
            content=b'{"event":"same-body"}',
        )
        fb_second = await client.post(
            f"/api/ingest/{ep['slug']}",
            content=b'{"event":"same-body"}',
        )

    assert fb_first.status_code == 202
    assert fb_second.status_code == 200
    assert fb_second.json()["event_id"] == fb_first.json()["event_id"]
    assert fb_second.json()["status"] == "duplicate_ignored"
    assert deliveries == 2


@pytest.mark.asyncio
async def test_retry_backoff_and_manual_replay(test_env):
    client, _ = test_env

    ep_res = await client.post(
        "/api/endpoints",
        json={
            "name": "Flaky Target",
            "target_url": "https://receiver.local/flaky",
            "use_secret": False,
        },
    )
    ep = ep_res.json()

    response_code = 500
    attempts_seen = 0
    recorded_sleeps: list[float] = []

    def target_handler(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts_seen
        attempts_seen += 1
        if response_code >= 500:
            return httpx.Response(response_code, text="upstream error")
        return httpx.Response(200, text='{"ok":true}')

    async def fake_sleep(delay: float) -> None:
        recorded_sleeps.append(delay)

    with (
        _patch_worker_transport(target_handler),
        patch("app.worker.asyncio.sleep", side_effect=fake_sleep),
    ):
        ingest_res = await client.post(
            f"/api/ingest/{ep['slug']}",
            content=b'{"retry":"please"}',
            headers={"X-Idempotency-Key": "retry-1"},
        )

    assert ingest_res.status_code == 202
    event_id = ingest_res.json()["event_id"]
    assert attempts_seen == 3
    assert recorded_sleeps == [2.0, 4.0]

    failed_detail = (await client.get(f"/api/events/{event_id}")).json()
    assert failed_detail["status"] == "failed"
    assert failed_detail["attempts"] == 3
    assert failed_detail["response_status"] == 500
    assert failed_detail["response_body"] == "upstream error"

    # Now fix target and replay manually
    response_code = 200
    with (
        _patch_worker_transport(target_handler),
        patch("app.worker.asyncio.sleep", side_effect=fake_sleep),
    ):
        replay_res = await client.post(f"/api/events/{event_id}/replay")

    assert replay_res.status_code == 200
    assert replay_res.json()["status"] == "retrying"
    assert replay_res.json()["attempts"] == 0

    recovered_detail = (await client.get(f"/api/events/{event_id}")).json()
    assert recovered_detail["status"] == "delivered"
    assert recovered_detail["attempts"] == 1
    assert recovered_detail["response_status"] == 200
    assert recovered_detail["response_body"] == '{"ok":true}'
    assert recovered_detail["error_message"] is None
    assert attempts_seen == 4


@pytest.mark.asyncio
async def test_timeout_failure_recording(test_env):
    client, _ = test_env

    ep_res = await client.post(
        "/api/endpoints",
        json={
            "name": "Slow Target",
            "target_url": "https://receiver.local/slow",
            "use_secret": False,
        },
    )
    ep = ep_res.json()

    def timeout_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    async def fake_sleep(_delay: float) -> None:
        return None

    with (
        _patch_worker_transport(timeout_handler),
        patch("app.worker.asyncio.sleep", side_effect=fake_sleep),
    ):
        ingest_res = await client.post(
            f"/api/ingest/{ep['slug']}",
            content=b'{"slow":true}',
            headers={"X-Idempotency-Key": "slow-1"},
        )

    assert ingest_res.status_code == 202
    event_id = ingest_res.json()["event_id"]

    detail = (await client.get(f"/api/events/{event_id}")).json()
    assert detail["status"] == "failed"
    assert detail["attempts"] == 3
    assert detail["response_status"] is None
    assert "timed out" in detail["error_message"].lower()


@pytest.mark.asyncio
async def test_demo_sink_modes(test_env):
    client, _ = test_env

    ok_res = await client.post(
        "/api/demo/sink?mode=ok",
        content=b'{"demo":true}',
        headers={"X-Relay-Event-ID": "evt-123"},
    )
    assert ok_res.status_code == 200
    assert ok_res.json()["ok"] is True
    assert ok_res.json()["relay_event_id"] == "evt-123"

    fail_res = await client.post("/api/demo/sink?mode=fail", content=b'{"demo":false}')
    assert fail_res.status_code == 500
    assert fail_res.json()["ok"] is False

