"""
Flow Prefect : Oracle -> DuckDB -> marts -> détection alertes.

[v2.1] Ajouts :
  - task_extract_abonnement() pour vérifier le parc actif
  - Intégration gracieuse (continue même si S_ABONNEMENT échoue)
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta

from loguru import logger
from prefect import flow, task
from prefect.tasks import exponential_backoff

from src.config import settings
from src.duckdb_client import duckdb_write
from src.extractor import (
    extract_releve,
    extract_releve_range,
    extract_reference_tables,
    extract_cloture_secteur,
    extract_abonnement,
)
from src.loader import upsert_dataframe
from src.marts import (
    DDL_RAW,
    build_all_marts,
    detect_threshold_crossings,
    refresh_cloture_snapshot,
)


# ============================================================
# TASKS Prefect
# ============================================================

@task(retries=3, retry_delay_seconds=exponential_backoff(backoff_factor=5), timeout_seconds=60)
def task_ensure_schema():
    with duckdb_write() as con:
        con.execute(DDL_RAW)
    logger.info("Schéma DuckDB OK")


@task(retries=3, retry_delay_seconds=exponential_backoff(backoff_factor=5), timeout_seconds=600)
def task_get_watermark(initial: bool) -> datetime:
    if initial:
        return datetime.utcnow() - timedelta(days=settings.INITIAL_LOAD_DAYS)
    with duckdb_write() as con:
        row = con.execute("SELECT MAX(REL_DATE) FROM raw_releve").fetchone()
    max_date = row[0] if row else None
    if max_date is None:
        return datetime.utcnow() - timedelta(days=settings.INITIAL_LOAD_DAYS)
    return max_date - timedelta(hours=settings.INCREMENTAL_OVERLAP_HOURS)


@task(retries=3, retry_delay_seconds=exponential_backoff(backoff_factor=5), timeout_seconds=900)
def task_extract_releve(since: datetime):
    return extract_releve(since=since)


@task(retries=3, retry_delay_seconds=exponential_backoff(backoff_factor=5), timeout_seconds=600)
def task_extract_cloture():
    return extract_cloture_secteur()


@task(retries=2, retry_delay_seconds=exponential_backoff(backoff_factor=5), timeout_seconds=900)
def task_extract_abonnement():
    """🆕 Extraction parc actif. Retourne DF vide si KO (pas bloquant)."""
    return extract_abonnement()


@task(retries=3, retry_delay_seconds=exponential_backoff(backoff_factor=5), timeout_seconds=300)
def task_extract_refs():
    return extract_reference_tables()


@task(timeout_seconds=600)
def task_load(df_releve, df_cloture, df_abonnement, refs: dict) -> int:
    """Charge S_RELEVE + CLOTURE + ABONNEMENT + refs."""
    with duckdb_write() as con:
        upsert_dataframe(con, df_releve, "raw_releve", pk="REL_ID")
        upsert_dataframe(con, df_cloture, "raw_cloture_secteur", pk="IDCLOTURE")
        if df_abonnement is not None and not df_abonnement.empty:
            upsert_dataframe(con, df_abonnement, "raw_abonnement", pk="ABN_ID")
        upsert_dataframe(con, refs.get("ref_comptage"), "ref_comptage", pk="ID_COMP")
        upsert_dataframe(con, refs.get("ref_centre"), "ref_centre", pk="CENTRE_ID")
        upsert_dataframe(con, refs.get("ref_secteur"), "ref_secteur", pk="SECT_ID")
    return len(df_releve) + len(df_cloture) + len(df_abonnement)


@task(timeout_seconds=300)
def task_build_marts():
    with duckdb_write() as con:
        build_all_marts(con)


@task(timeout_seconds=60)
def task_detect_alerts():
    with duckdb_write() as con:
        nb_alerts = detect_threshold_crossings(con)
        refresh_cloture_snapshot(con)
    return nb_alerts


@task(timeout_seconds=30)
def task_log_run(started_at: datetime, status: str, rows: int, error: str = ""):
    with duckdb_write() as con:
        next_id = con.execute("SELECT COALESCE(MAX(run_id),0)+1 FROM pipeline_runs").fetchone()[0]
        con.execute(
            "INSERT INTO pipeline_runs VALUES (?, ?, ?, ?, ?, ?)",
            [next_id, started_at, datetime.utcnow(), status, rows, error],
        )


# ============================================================
# FLOW principal
# ============================================================

@flow(name="snde-suivi-temps-reel", log_prints=True)
def releve_flow(initial: bool = False):
    started = datetime.utcnow()
    try:
        task_ensure_schema()
        wm = task_get_watermark(initial=initial)
        df_releve = task_extract_releve(wm)
        df_cloture = task_extract_cloture()
        df_abonnement = task_extract_abonnement()
        refs = task_extract_refs()
        nb = task_load(df_releve, df_cloture, df_abonnement, refs)
        task_build_marts()
        nb_alerts = task_detect_alerts()
        task_log_run(started, "OK", nb, f"alerts={nb_alerts}")
        logger.success(f"Pipeline OK - {nb:,} lignes ingérées, {nb_alerts} alertes")
    except Exception as exc:
        task_log_run(started, "KO", 0, str(exc))
        logger.exception("Pipeline KO")
        raise


# ============================================================
# RELOAD à la demande
# ============================================================

def reload_period(date_from: datetime, date_to: datetime) -> dict:
    started = datetime.utcnow()
    logger.info(f"[RELOAD] {date_from.isoformat()} -> {date_to.isoformat()}")
    try:
        with duckdb_write() as con:
            con.execute(DDL_RAW)
        df_releve = extract_releve_range(date_from, date_to)
        df_cloture = extract_cloture_secteur()
        df_abonnement = extract_abonnement()
        refs = extract_reference_tables()
        with duckdb_write() as con:
            con.execute("DELETE FROM raw_releve")
            logger.info("  raw_releve vidée")
            upsert_dataframe(con, df_releve, "raw_releve", pk="REL_ID")
            upsert_dataframe(con, df_cloture, "raw_cloture_secteur", pk="IDCLOTURE")
            if not df_abonnement.empty:
                upsert_dataframe(con, df_abonnement, "raw_abonnement", pk="ABN_ID")
            upsert_dataframe(con, refs.get("ref_comptage"), "ref_comptage", pk="ID_COMP")
            upsert_dataframe(con, refs.get("ref_centre"), "ref_centre", pk="CENTRE_ID")
            upsert_dataframe(con, refs.get("ref_secteur"), "ref_secteur", pk="SECT_ID")
            build_all_marts(con)
            nb_alerts = detect_threshold_crossings(con)
            refresh_cloture_snapshot(con)
        nb = len(df_releve)
        duration = (datetime.utcnow() - started).total_seconds()
        with duckdb_write() as con:
            next_id = con.execute("SELECT COALESCE(MAX(run_id),0)+1 FROM pipeline_runs").fetchone()[0]
            con.execute(
                "INSERT INTO pipeline_runs VALUES (?, ?, ?, ?, ?, ?)",
                [next_id, started, datetime.utcnow(), "OK_RELOAD", nb,
                 f"reload {date_from.date()}->{date_to.date()} alerts={nb_alerts}"],
            )
        logger.success(f"[RELOAD] OK - {nb:,} lignes en {duration:.1f}s, {nb_alerts} alertes")
        return {
            "status": "ok",
            "rows": nb,
            "duration_s": round(duration, 1),
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "alerts_detected": nb_alerts,
        }
    except Exception as exc:
        duration = (datetime.utcnow() - started).total_seconds()
        with duckdb_write() as con:
            next_id = con.execute("SELECT COALESCE(MAX(run_id),0)+1 FROM pipeline_runs").fetchone()[0]
            con.execute(
                "INSERT INTO pipeline_runs VALUES (?, ?, ?, ?, ?, ?)",
                [next_id, started, datetime.utcnow(), "KO_RELOAD", 0, str(exc)[:500]],
            )
        logger.exception("[RELOAD] KO")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pipeline SNDE Suivi Temps Réel")
    parser.add_argument("--initial", action="store_true")
    args = parser.parse_args()
    logger.remove()
    logger.add(sys.stderr, level=settings.LOG_LEVEL)
    releve_flow(initial=args.initial)