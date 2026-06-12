"""
Point d'entrée FastAPI.

Lancement (depuis backend/) :
    uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload

[v2.3] Ajout SSE streaming temps réel + watcher Oracle automatique.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.api.routers import releve
from src.api.routers import sse
from src.watcher import start_watcher


# ── Lifespan — démarrage/arrêt propre ───────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Au démarrage : lancer le watcher Oracle en tâche de fond
    await start_watcher()
    yield
    # À l'arrêt : rien à faire (les tâches asyncio s'arrêtent avec l'event loop)


# ── Application FastAPI ──────────────────────────────────────────────
app = FastAPI(
    title="SNDE - API Dashboard Relevés",
    version="2.3.0",
    description="API REST + SSE temps réel — dashboard suivi commercial SNDE",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────
app.include_router(releve.router)   # API REST existante
app.include_router(sse.router)      # Nouveau : SSE temps réel


# ── Health check ─────────────────────────────────────────────────────
@app.get("/healthz", tags=["meta"])
def healthz() -> dict:
    return {"status": "ok", "version": "2.3.0"}
