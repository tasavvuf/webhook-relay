from typing import Literal

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/sink")
async def demo_sink(
    request: Request,
    mode: Literal["ok", "fail"] = Query(default="ok"),
) -> JSONResponse:
    """Built-in deterministic target endpoint for live browser demos."""
    raw_body = await request.body()
    relay_event_id = request.headers.get("x-relay-event-id")

    if mode == "fail":
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "ok": False,
                "demo_sink": True,
                "relay_event_id": relay_event_id,
                "error": "Simulated downstream 500 outage",
            },
        )

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "ok": True,
            "demo_sink": True,
            "relay_event_id": relay_event_id,
            "bytes_received": len(raw_body),
        },
    )
