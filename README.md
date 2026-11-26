# Idempotent Webhook Relay & Inspector

A minimal, production-style webhook ingestion relay with constant-time HMAC-SHA256 verification, database-enforced idempotency deduplication, exponential backoff retries, manual event replay, and a dark inspection console.

## Architecture

```text
Incoming Webhook ──▶ POST /api/ingest/{slug}
                        │
                        ├── 1. Lookup active Endpoint by slug (404 if missing/inactive)
                        ├── 2. Verify X-Webhook-Signature (sha256=<hex>) via hmac.compare_digest (401)
                        ├── 3. Enforce unique (endpoint_id, idempotency_key) (200 duplicate_ignored)
                        ├── 4. Persist WebhookEvent (status=pending) + queue BackgroundTask
                        └── 5. Return 202 Accepted ({ event_id, status: "queued" })
                                    │
                                    ▼
                        Async httpx Worker (timeout=10s)
                        ├── 2xx ─────────▶ status="delivered", response_status, response_body (<=2KB)
                        └── 4xx/5xx/err ─▶ retry with 2s, 4s backoff (max 3 attempts) ─▶ status="failed"
```

## Project Structure

- `backend/` — FastAPI, SQLModel (async SQLAlchemy), `aiosqlite` / `asyncpg`, `httpx`
- `frontend/` — Vite, React, TypeScript, Tailwind CSS (with Web Crypto `crypto.subtle` test sender)

## Quick Start

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

By default, the backend uses local SQLite (`sqlite+aiosqlite:///./relay.db`). To use PostgreSQL:

```bash
export DATABASE_URL="postgresql+asyncpg://user:password@localhost:5432/webhook_relay"
uvicorn app.main:app --port 8000
```

Run backend tests:

```bash
cd backend
pytest -v
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api/*` requests to `http://localhost:8000`.

## API & `curl` Examples

### Create an Endpoint

```bash
curl -s -X POST http://localhost:8000/api/endpoints \
  -H "Content-Type: application/json" \
  -d '{"name":"Stripe Production","target_url":"https://httpbin.org/post","use_secret":true}'
```

### Send a Signed Idempotent Webhook

```bash
SLUG="wh_xxxxxxxx"
SECRET="whsec_xxxxxxxxxxxxxxxx"
BODY='{"event":"invoice.paid","amount":4900}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -i -X POST "http://localhost:8000/api/ingest/${SLUG}" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: ${SIG}" \
  -H "X-Idempotency-Key: evt_12345" \
  -d "$BODY"
```

Re-sending the exact same `X-Idempotency-Key` returns `200 OK` with `{"event_id":"...","status":"duplicate_ignored"}` without forwarding again.

### Replay a Failed Event

```bash
curl -s -X POST "http://localhost:8000/api/events/<event_id>/replay"
```
