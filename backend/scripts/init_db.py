"""
Script d'initialisation DuckDB.

Crée les tables raw_releve, ref_*, pipeline_runs et toutes les marts vides.
Utile la toute première fois, AVANT d'avoir un accès Oracle, pour pouvoir
déjà lancer l'API et le frontend en mode "vide".

Usage :
    python scripts/init_db.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger

from src.duckdb_client import duckdb_write
from src.marts import DDL_RAW, VIEW_RELEVE_ENRICHED, MARTS_SQL


def main() -> None:
    with duckdb_write() as con:
        logger.info("Création des tables raw / ref / pipeline_runs...")
        con.execute(DDL_RAW)
        logger.info("Création de la vue v_releve...")
        con.execute(VIEW_RELEVE_ENRICHED)
        logger.info("Création des marts vides...")
        for name, sql in MARTS_SQL.items():
            try:
                con.execute(sql)
                logger.info(f"  ✓ {name}")
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"  ! {name} : {exc}")
    logger.success("DuckDB initialisé.")


if __name__ == "__main__":
    main()
