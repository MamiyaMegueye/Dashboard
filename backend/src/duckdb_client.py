"""
Client DuckDB - context managers pour lecture/écriture.

DuckDB en mode :
  - read_only=True pour l'API (concurrence safe)
  - read_only=False pour le pipeline (écriture)

[RECONSTRUIT] : inféré depuis pipeline.py qui utilise duckdb_write()
                et releve.py qui utilise duckdb_read()
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import duckdb
from loguru import logger

from src.config import settings


@contextmanager
def duckdb_write() -> Iterator[duckdb.DuckDBPyConnection]:
    """
    Connexion DuckDB en écriture (utilisée par le pipeline uniquement).
    Une seule connexion en écriture peut exister à la fois.
    """
    path = settings.duckdb_path_abs
    logger.debug(f"DuckDB connect (write) : {path}")
    con = duckdb.connect(str(path), read_only=False)
    try:
        yield con
    finally:
        con.close()


@contextmanager
def duckdb_read() -> Iterator[duckdb.DuckDBPyConnection]:
    """
    Connexion DuckDB en lecture seule (utilisée par l'API FastAPI).
    Plusieurs connexions read_only peuvent coexister.
    """
    path = settings.duckdb_path_abs
    logger.debug(f"DuckDB connect (read) : {path}")
    con = duckdb.connect(str(path), read_only=True)
    try:
        yield con
    finally:
        con.close()
