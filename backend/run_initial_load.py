"""
Chargement initial 90 jours SANS Prefect.
Pour bypasser les soucis de migration Prefect au démarrage.

Lancement (depuis backend/) :
    python scripts/run_initial_load.py
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Permettre l'import de src.* quand on lance depuis backend/
sys.path.insert(0, str(Path(__file__).parent.parent))

from loguru import logger

from src.config import settings
from src.duckdb_client import duckdb_write
from src.extractor import extract_releve, extract_reference_tables
from src.loader import upsert_dataframe
from src.marts import DDL_RAW, build_all_marts


def main():
    logger.remove()
    logger.add(sys.stderr, level=settings.LOG_LEVEL)

    started = datetime.utcnow()
    logger.info(f"=== CHARGEMENT INITIAL {settings.INITIAL_LOAD_DAYS} jours ===")

    # 1. Schéma DuckDB
    with duckdb_write() as con:
        con.execute(DDL_RAW)
    logger.info("Schéma DuckDB OK")

    # 2. Watermark = -90 jours
    wm = datetime.utcnow() - timedelta(days=settings.INITIAL_LOAD_DAYS)
    logger.info(f"Watermark : {wm.isoformat()}")

    # 3. Extraction Oracle
    df = extract_releve(since=wm)
    refs = extract_reference_tables()

    # 4. Chargement DuckDB
    with duckdb_write() as con:
        upsert_dataframe(con, df,                       "raw_releve",   pk="REL_ID")
        upsert_dataframe(con, refs.get("ref_comptage"), "ref_comptage", pk="ID_COMP")
        upsert_dataframe(con, refs.get("ref_centre"),   "ref_centre",   pk="CENTRE_ID")
        upsert_dataframe(con, refs.get("ref_secteur"),  "ref_secteur",  pk="SECT_ID")
    logger.info(f"{len(df):,} relevés chargés dans DuckDB")

    # 5. Construction des marts
    with duckdb_write() as con:
        build_all_marts(con)

    duration = (datetime.utcnow() - started).total_seconds()
    logger.success(f"=== Pipeline OK en {duration:.1f}s — {len(df):,} relevés ===")


if __name__ == "__main__":
    main()