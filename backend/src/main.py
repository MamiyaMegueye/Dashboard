"""
Entrypoint FastAPI.

Lance le serveur :
    uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from src.config import settings
from src.api.routers import releve


# Configuration du logger
logger.remove()
logger.add(
    sys.stderr,
    level=settings.LOG_LEVEL,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level:8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
)


app = FastAPI(
    title="SNDE Suivi Temps Réel API",
    description=(
        "API du dashboard SNDE pour le suivi temps réel des relevés "
        "et de l'avancement des saisies par secteur (Nouakchott)."
    ),
    version="2.0.0",
)


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Routers
app.include_router(releve.router)


@app.get("/")
def root():
    return {
        "name": "SNDE Suivi Temps Réel",
        "version": "2.0.0",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
