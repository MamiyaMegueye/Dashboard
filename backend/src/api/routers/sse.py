"""
backend/src/api/routers/sse.py

Endpoint SSE (Server-Sent Events) pour les alertes temps réel SNDE.

Le client s'abonne via :
    GET /api/stream/alertes
    Accept: text/event-stream

Événements émis :
    event: connected       → confirmation connexion
    event: nouvelle_alerte → payload JSON alerte franchissement ≥ 90%
    event: heartbeat       → ping toutes les 15 sec (évite timeout proxy)
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from src.watcher import sse_manager

router = APIRouter(prefix="/api/stream", tags=["sse"])


async def _event_generator(q: asyncio.Queue):
    """
    Générateur SSE pour un client.
    - Envoie les alertes dès qu'elles arrivent (via la queue)
    - Envoie un heartbeat toutes les 15 sec pour maintenir la connexion
    """
    # Confirmation connexion
    yield "event: connected\ndata: {\"status\": \"ok\"}\n\n"

    heartbeat_interval = 15  # secondes

    try:
        while True:
            try:
                # Attendre un message ou timeout (heartbeat)
                msg = await asyncio.wait_for(q.get(), timeout=heartbeat_interval)
                yield msg
            except asyncio.TimeoutError:
                # Heartbeat — maintient la connexion ouverte
                ts = datetime.now().isoformat()
                yield f"event: heartbeat\ndata: {{\"ts\": \"{ts}\"}}\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        sse_manager.disconnect(q)


@router.get(
    "/alertes",
    summary="Stream SSE des alertes secteurs en temps réel",
    response_class=StreamingResponse,
)
async def stream_alertes():
    """
    Connexion SSE persistante.
    Le client reçoit :
    - `connected`       dès la connexion
    - `nouvelle_alerte` à chaque franchissement ≥ 90%
    - `heartbeat`       toutes les 15 sec
    """
    q = sse_manager.connect()

    return StreamingResponse(
        _event_generator(q),
        media_type="text/event-stream",
        headers={
            "Cache-Control"              : "no-cache",
            "X-Accel-Buffering"          : "no",   # désactive le buffer Nginx
            "Access-Control-Allow-Origin": "*",
        },
    )
