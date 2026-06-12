"""
Endpoints REST pour le dashboard SNDE Suivi Temps Réel.

[v2.1] Refonte :
  - Endpoints autour de v_secteur_cycle (vue unifiée)
  - Export Excel natif (openpyxl via pandas.to_excel)
  - Logique d'alerte centrée sur CLOTURE = 0
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timedelta
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field

from src.duckdb_client import duckdb_read


router = APIRouter(prefix="/api/releve", tags=["releve"])

MAX_RELOAD_DAYS = 366


# ============================================================
# Helpers
# ============================================================

def _fetch_all(sql: str, params: list | None = None) -> list[dict[str, Any]]:
    """Renvoie une liste de dicts JSON-safe (gère NaN, NaT, Decimal)."""
    try:
        with duckdb_read() as con:
            res = con.execute(sql, params or []).fetchdf()
        json_str = res.to_json(orient="records", date_format="iso", default_handler=str)
        return json.loads(json_str)
    except Exception as exc:
        logger.exception("Erreur DuckDB")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _fetch_one(sql: str, params: list | None = None) -> dict[str, Any]:
    rows = _fetch_all(sql, params)
    return rows[0] if rows else {}


def _fetch_df(sql: str, params: list | None = None) -> pd.DataFrame:
    """Pour export Excel (garde le DataFrame, ne sérialise pas)."""
    try:
        with duckdb_read() as con:
            return con.execute(sql, params or []).fetchdf()
    except Exception as exc:
        logger.exception("Erreur DuckDB (export)")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _df_to_xlsx_response(df: pd.DataFrame, filename: str, sheet_name: str = "Données") -> StreamingResponse:
    """
    Sérialise un DataFrame en Excel et renvoie une StreamingResponse FastAPI.
    Headers : Content-Disposition pour téléchargement.
    """
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name[:31], index=False)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}.xlsx"'},
    )


def _build_where(
    str_id: int | None,
    sect_id: int | None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> tuple[str, list]:
    parts: list[str] = []
    params: list = []
    if date_from or date_to:
        if date_from:
            parts.append("REL_DATE >= CAST(? AS TIMESTAMP)")
            params.append(date_from)
        if date_to:
            parts.append("REL_DATE < CAST(? AS TIMESTAMP) + INTERVAL 1 DAY")
            params.append(date_to)
    else:
        parts.append("REL_DATE >= (SELECT MAX(REL_DATE) - INTERVAL 30 DAY FROM raw_releve)")
    if str_id is not None:
        parts.append("STR_ID = ?")
        params.append(str_id)
    if sect_id is not None:
        parts.append("SECT_ID = ?")
        params.append(sect_id)
    return "WHERE " + " AND ".join(parts), params


ALLOWED_FILTER_COLUMNS = {
    "REL_DATE", "CPT_REF", "ABN_ID", "MATRICULE",
    "CENTRE_LIB", "SECT_LIB",
    "REL_ANCIEN_INDEX", "REL_INDEX",
    "REL_CONSOM_CALCUL", "REL_MOYENNE_CONSOM",
    "ETAT_COMPTAGE", "CONSO_CAT",
    "REL_ESTIMATIF",
}


def _column_filter_expression(col: str, val: str) -> tuple[str, list]:
    v = val.strip(); v_low = v.lower()
    if col == "REL_ESTIMATIF":
        if v_low in ("est", "1", "oui", "estimé", "estime"): return "REL_ESTIMATIF = ?", [1]
        if v_low in ("0", "non", "—", "-", "réel", "reel"): return "REL_ESTIMATIF = ?", [0]
        return "CAST(REL_ESTIMATIF AS VARCHAR) ILIKE ?", [f"%{v}%"]
    if col == "REL_DATE":
        return "strftime(REL_DATE, '%d/%m/%Y') ILIKE ?", [f"%{v}%"]
    return f"CAST({col} AS VARCHAR) ILIKE ?", [f"%{v}%"]


def _extract_column_filters(request: Request) -> list[tuple[str, list]]:
    out: list[tuple[str, list]] = []
    for key, value in request.query_params.items():
        if not key.startswith("f_") or not value:
            continue
        col = key[2:].upper()
        if col not in ALLOWED_FILTER_COLUMNS:
            continue
        out.append(_column_filter_expression(col, value))
    return out


# ============================================================
# Listes pour dropdowns
# ============================================================

@router.get("/centres-list")
def get_centres_list() -> list[dict]:
    return _fetch_all("""
        SELECT DISTINCT STR_ID,
               COALESCE(CENTRE_LIB, '(centre ' || CAST(STR_ID AS VARCHAR) || ')') AS CENTRE_LIB
        FROM v_releve
        WHERE REL_DATE >= (SELECT MAX(REL_DATE) - INTERVAL 30 DAY FROM raw_releve)
        ORDER BY STR_ID
    """)


@router.get("/secteurs-list")
def get_secteurs_list(str_id: int = Query(...)) -> list[dict]:
    return _fetch_all("""
        SELECT DISTINCT SECT_ID,
               COALESCE(SECT_LIB, '(secteur ' || CAST(SECT_ID AS VARCHAR) || ')') AS SECT_LIB
        FROM v_releve
        WHERE STR_ID = ?
          AND REL_DATE >= (SELECT MAX(REL_DATE) - INTERVAL 30 DAY FROM raw_releve)
          AND SECT_ID IS NOT NULL
        ORDER BY SECT_LIB
    """, [str_id])


@router.get("/cycles-disponibles")
def get_cycles_disponibles() -> list[dict]:
    return _fetch_all("""
        SELECT DISTINCT ANNEE, MOIS, (ANNEE * 100 + MOIS) AS CYCLE_KEY
        FROM raw_cloture_secteur
        ORDER BY CYCLE_KEY DESC
    """)


# ============================================================
# KPI globaux S_RELEVE (existants)
# ============================================================

@router.get("/kpi")
def get_kpi(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
) -> dict:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    return _fetch_one(f"""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE ID_COMP = 1) AS accessible,
            COUNT(*) FILTER (WHERE ID_COMP = 2) AS illisible,
            COUNT(*) FILTER (WHERE ID_COMP = 3) AS defectueux,
            COUNT(*) FILTER (WHERE ID_COMP = 4) AS bloque,
            COUNT(*) FILTER (WHERE ID_COMP = 5) AS inaccessible,
            COUNT(*) FILTER (WHERE ID_COMP = 6) AS vole,
            COUNT(*) FILTER (WHERE REL_VALIDE = 0) AS non_valides,
            COUNT(*) FILTER (WHERE CONSO_CAT = 'Nulle') AS conso_nulle,
            COUNT(*) FILTER (WHERE CONSO_CAT = 'Faible') AS conso_faible,
            COUNT(*) FILTER (WHERE CONSO_CAT = 'Elevée') AS conso_elevee
        FROM v_releve {where}
    """, params)


@router.get("/etat-comptage")
def get_etat_comptage(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
) -> list[dict]:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    return _fetch_all(f"""
        WITH base AS (SELECT * FROM v_releve {where}),
        tot AS (SELECT COUNT(*) AS total FROM base)
        SELECT base.ID_COMP, base.ETAT_COMPTAGE,
               COUNT(*) AS nb, tot.total AS total,
               ROUND(COUNT(*) * 100.0 / NULLIF(tot.total,0), 1) AS pct
        FROM base, tot
        GROUP BY base.ID_COMP, base.ETAT_COMPTAGE, tot.total
        ORDER BY nb DESC
    """, params)


@router.get("/fiabilite")
def get_fiabilite(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
) -> dict:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    return _fetch_one(f"""
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ID_COMP = 1) AS fiables,
               COUNT(*) FILTER (WHERE ID_COMP IN (2,3,4,5,6)) AS a_controler,
               ROUND(100.0 * COUNT(*) FILTER (WHERE ID_COMP IN (2,3,4,5,6))
                           / NULLIF(COUNT(*), 0), 1) AS pct_a_controler
        FROM v_releve {where}
    """, params)


@router.get("/anomalies")
def get_anomalies(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
    limit: int = Query(200, ge=1, le=2000),
) -> list[dict]:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    where += " AND CONSO_CAT IN ('Nulle','Faible','Elevée')"
    return _fetch_all(f"""
        SELECT REL_ID, REL_DATE, ABN_ID, CPT_REF, MATRICULE,
               STR_ID, CENTRE_LIB, SECT_ID, SECT_LIB,
               REL_INDEX, REL_ANCIEN_INDEX, REL_CONSOM_CALCUL,
               ID_COMP, COMPTAGE_LIB, ETAT_COMPTAGE, CONSO_CAT, REL_VALIDE
        FROM v_releve {where}
        ORDER BY REL_DATE DESC
        LIMIT {limit}
    """, params)


@router.get("/non-valides")
def get_non_valides(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
) -> list[dict]:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    where += " AND REL_VALIDE = 0"
    return _fetch_all(f"""
        SELECT REL_ID, REL_DATE, ABN_ID, CPT_REF, MATRICULE,
               STR_ID, CENTRE_LIB, SECT_LIB,
               REL_CONSOM_CALCUL, ID_COMP, ETAT_COMPTAGE, CONSO_CAT
        FROM v_releve {where}
        ORDER BY REL_DATE DESC
        LIMIT {limit}
    """, params)


@router.get("/hierarchie-centre")
def get_hierarchie_centre(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
) -> list[dict]:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    return _fetch_all(f"""
        SELECT STR_ID, CENTRE_LIB,
               COUNT(*) AS nb_releves,
               COUNT(*) FILTER (WHERE ID_COMP = 1) AS nb_accessible,
               COUNT(*) FILTER (WHERE ID_COMP IN (2,3,4,5,6)) AS nb_a_controler,
               COUNT(*) FILTER (WHERE REL_VALIDE = 0) AS nb_non_valides,
               COUNT(*) FILTER (WHERE CONSO_CAT = 'Nulle')  AS nb_conso_nulle,
               COUNT(*) FILTER (WHERE CONSO_CAT = 'Faible') AS nb_conso_faible,
               COUNT(*) FILTER (WHERE CONSO_CAT = 'Elevée') AS nb_conso_elevee,
               ROUND(AVG(REL_CONSOM_CALCUL), 2) AS conso_moy
        FROM v_releve {where}
        GROUP BY STR_ID, CENTRE_LIB
        ORDER BY nb_releves DESC
    """, params)


@router.get("/evolution-quotidienne")
def get_evolution(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
) -> list[dict]:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    return _fetch_all(f"""
        SELECT CAST(REL_DATE AS DATE) AS jour,
               COUNT(*) AS nb_releves,
               COUNT(*) FILTER (WHERE ID_COMP = 1) AS nb_accessible,
               COUNT(*) FILTER (WHERE REL_VALIDE = 0) AS nb_non_valides
        FROM v_releve {where}
        GROUP BY jour ORDER BY jour
    """, params)


@router.get("/list")
def get_list(
    request: Request,
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
    id_comp: int | None = None, conso_cat: str | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=2000), offset: int = Query(0, ge=0),
) -> dict:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    if id_comp is not None:
        where += " AND ID_COMP = ?"; params.append(id_comp)
    if conso_cat:
        where += " AND CONSO_CAT = ?"; params.append(conso_cat)
    if q:
        where += " AND (CAST(CPT_REF AS VARCHAR) ILIKE ? OR CAST(ABN_ID AS VARCHAR) ILIKE ? OR MATRICULE ILIKE ?)"
        params += [f"%{q}%", f"%{q}%", f"%{q}%"]
    for snippet, sp in _extract_column_filters(request):
        where += " AND " + snippet
        params.extend(sp)
    total = int(_fetch_one(f"SELECT COUNT(*) AS n FROM v_releve {where}", params).get("n", 0) or 0)
    rows = _fetch_all(f"""
        SELECT REL_ID, REL_DATE, REL_ANNEE, REL_MOIS,
               CPT_REF, ABN_ID, MATRICULE,
               STR_ID, CENTRE_LIB, SECT_ID, SECT_LIB,
               REL_ANCIEN_INDEX, REL_INDEX,
               REL_CONSOM_CALCUL, REL_MOYENNE_CONSOM, REL_NBR_JR,
               ID_COMP, COMPTAGE_LIB, ETAT_COMPTAGE,
               CONSO_CAT, REL_VALIDE, REL_ESTIMATIF
        FROM v_releve {where}
        ORDER BY REL_DATE DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    return {"total": total, "rows": rows}


@router.get("/scope-info")
def get_scope_info(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
) -> dict:
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    return _fetch_one(f"""
        SELECT MIN(REL_DATE) AS date_min,
               MAX(REL_DATE) AS date_max,
               COUNT(*)      AS total
        FROM v_releve {where}
    """, params)


# ============================================================
# 🆕 Suivi Temps Réel (CLOTURE_SECTEUR + v_secteur_cycle)
# ============================================================

@router.get("/pilotage-global")
def get_pilotage_global() -> dict:
    return _fetch_one("SELECT * FROM mart_pilotage_global")


@router.get("/pilotage-par-centre")
def get_pilotage_par_centre() -> list[dict]:
    return _fetch_all("SELECT * FROM mart_pilotage_par_centre ORDER BY pct_avancement ASC")


@router.get("/avancement-saisie")
def get_avancement_saisie(
    str_id: int | None = Query(None),
    annee: int | None = Query(None),
    mois: int | None = Query(None),
    statut: str | None = Query(None),
    min_pct: int | None = Query(None, ge=0, le=100),
    max_pct: int | None = Query(None, ge=0, le=100),
    cloture: int | None = Query(None, ge=0, le=1, description="0 = en cours, 1 = clôturé"),
) -> list[dict]:
    parts: list[str] = []
    params: list = []

    if annee is not None and mois is not None:
        parts.append("ANNEE = ? AND MOIS = ?")
        params.extend([annee, mois])
    else:
        parts.append("cycle_key = (SELECT MAX(cycle_key) FROM v_secteur_cycle)")

    if str_id is not None:
        parts.append("centre_code = ?")
        params.append(str_id)
    if statut:
        parts.append("statut = ?")
        params.append(statut)
    if cloture is not None:
        parts.append("CLOTURE = ?")
        params.append(cloture)
    if min_pct is not None:
        parts.append("pct_avancement >= ?")
        params.append(min_pct)
    if max_pct is not None:
        parts.append("pct_avancement <= ?")
        params.append(max_pct)

    where = "WHERE " + " AND ".join(parts) if parts else ""
    return _fetch_all(f"""
        SELECT * FROM v_secteur_cycle
        {where}
        ORDER BY pct_avancement ASC NULLS FIRST, centre_libelle, secteur_libelle
    """, params)


@router.get("/secteur-detail")
def get_secteur_detail(
    str_id: int = Query(...), sect_id: int = Query(...),
    annee: int = Query(...), mois: int = Query(...),
    limit: int = Query(500, ge=1, le=5000),
) -> dict:
    header = _fetch_one("""
        SELECT * FROM v_secteur_cycle
        WHERE centre_code = ? AND secteur_code = ? AND ANNEE = ? AND MOIS = ?
    """, [str_id, sect_id, annee, mois])

    rows = _fetch_all("""
        SELECT REL_ID, REL_DATE, DATE_GEN,
               CPT_REF, ABN_ID, MATRICULE,
               REL_INDEX, REL_ANCIEN_INDEX,
               REL_CONSOM_CALCUL, REL_MOYENNE_CONSOM,
               REL_NBR_JR, REL_ESTIMATIF,
               ID_COMP, ETAT_COMPTAGE, CONSO_CAT,
               REL_VALIDE, REL_ORIGINE,
               CASE WHEN REL_INDEX < REL_ANCIEN_INDEX THEN 1 ELSE 0 END AS flag_index_decroissant
        FROM v_releve
        WHERE STR_ID = ? AND SECT_ID = ?
          AND REL_ANNEE = ? AND REL_MOIS = ?
        ORDER BY REL_DATE DESC, CPT_REF
        LIMIT ?
    """, [str_id, sect_id, annee, mois, limit])

    releveurs = _fetch_all("""
        SELECT MATRICULE,
               COUNT(*) AS nb,
               COUNT(*) FILTER (WHERE REL_ESTIMATIF = 1)   AS nb_estimes,
               COUNT(*) FILTER (WHERE CONSO_CAT = 'Nulle') AS nb_nulle,
               COUNT(*) FILTER (WHERE REL_VALIDE = 1)      AS nb_valides,
               COUNT(*) FILTER (WHERE REL_VALIDE = 0)      AS nb_non_valides,
               MAX(REL_DATE) AS derniere_saisie
        FROM v_releve
        WHERE STR_ID = ? AND SECT_ID = ?
          AND REL_ANNEE = ? AND REL_MOIS = ?
          AND MATRICULE != ''
        GROUP BY MATRICULE
        ORDER BY nb DESC
    """, [str_id, sect_id, annee, mois])

    return {"header": header, "releveurs": releveurs, "rows": rows}


# ============================================================
# 🆕 Alertes
# ============================================================

@router.get("/alertes")
def get_alertes(
    only_unack: bool = Query(True),
    limit: int = Query(50, ge=1, le=500),
) -> list[dict]:
    """
    🆕 v2.2 — Endpoint enrichi avec stats temps réel du secteur.
    Pour chaque alerte de franchissement (≥90%), join avec v_secteur_cycle
    pour récupérer les stats actuelles (% conso nulle, illisibles, normaux,
    nb abonnés avec anomalies) — utilisé par AlertesPanel selon la maquette.
    """
    where = "WHERE a.acknowledged = FALSE" if only_unack else ""
    return _fetch_all(f"""
        SELECT DISTINCT
            a.alert_id, a.alert_type,
            a.STR_ID, ce.CENTRE_LIB,
            a.SECT_ID, sec.SECT_LIB,
            a.ANNEE, a.MOIS,
            a.pct_avant, a.pct_apres,
            a.detected_at, a.acknowledged, a.acknowledged_at,
            v.pct_avancement                    AS current_pct,
            v.parc_cloture                      AS parc_total,
            v.saisis_declare                    AS nb_saisis,
            v.saisis_reel                    AS saisis_reel,
            v.nb_conso_nulle, v.nb_conso_faible,
            v.nb_conso_normale, v.nb_conso_elevee,
            v.nb_illisible, v.nb_accessible, v.nb_inaccessible,
            v.nb_estimes, v.statut, v.CLOTURE,
            CASE WHEN v.saisis_reel > 0
                 THEN ROUND(100.0 * v.nb_conso_nulle / v.saisis_reel, 1)
                 ELSE 0 END                      AS pct_conso_nulle,
            CASE WHEN v.saisis_reel > 0
                 THEN ROUND(100.0 * v.nb_illisible / v.saisis_reel, 1)
                 ELSE 0 END                      AS pct_illisibles,
            CASE WHEN v.saisis_reel > 0
                 THEN ROUND(100.0 * (v.nb_conso_normale + v.nb_conso_elevee)
                            / v.saisis_reel, 1)
                 ELSE 0 END                      AS pct_normaux,
            (v.nb_conso_nulle + v.nb_conso_faible
             + v.nb_illisible + v.nb_inaccessible) AS nb_anomalies
        FROM alerts_log a
        LEFT JOIN ref_centre  ce ON ce.CENTRE_ID = a.STR_ID
        LEFT JOIN ref_secteur sec ON sec.SECT_ID = a.SECT_ID
        LEFT JOIN v_secteur_cycle v
               ON v.centre_code = a.STR_ID
              AND v.secteur_code = a.SECT_ID
              AND v.ANNEE = a.ANNEE
              AND v.MOIS = a.MOIS
        {where}
        AND (v.CLOTURE = 0 OR v.CLOTURE IS NULL)
        ORDER BY a.detected_at DESC
        LIMIT {limit}
    """)


@router.get("/alertes/count")
def get_alertes_count(only_unack: bool = Query(True)) -> dict:
    """🆕 Compteur léger pour le AlertBanner (polling 30s)."""
    where = "WHERE acknowledged = FALSE" if only_unack else ""
    return _fetch_one(f"SELECT COUNT(*) AS n FROM alerts_log {where}")


class AlertAckRequest(BaseModel):
    alert_id: int


@router.post("/alertes/acknowledge")
def post_acknowledge_alert(payload: AlertAckRequest) -> dict:
    from src.duckdb_client import duckdb_write
    with duckdb_write() as con:
        con.execute("""
            UPDATE alerts_log
            SET acknowledged = TRUE, acknowledged_at = now()
            WHERE alert_id = ?
        """, [payload.alert_id])
    return {"status": "ok", "alert_id": payload.alert_id}


# ============================================================
# 🆕 Exports Excel (.xlsx)
# ============================================================

@router.get("/export/avancement-saisie")
def export_avancement_saisie(
    str_id: int | None = None,
    annee: int | None = None, mois: int | None = None,
    statut: str | None = None,
):
    parts: list[str] = []
    params: list = []
    if annee is not None and mois is not None:
        parts.append("ANNEE = ? AND MOIS = ?"); params.extend([annee, mois])
    else:
        parts.append("cycle_key = (SELECT MAX(cycle_key) FROM v_secteur_cycle)")
    if str_id is not None:
        parts.append("centre_code = ?"); params.append(str_id)
    if statut:
        parts.append("statut = ?"); params.append(statut)
    where = "WHERE " + " AND ".join(parts)

    df = _fetch_df(f"""
        SELECT centre_code, centre_libelle,
               secteur_code, secteur_libelle,
               ANNEE, MOIS, parc_cloture, saisis_declare, saisis_reel, restant,
               pct_avancement, volume_facture, volume_estime, pct_estimation,
               statut, avancement_cat, CLOTURE, FLAG_CALCUL, FLAG_VALID,
               matricule_clotureur, DATE_CLOT,
               nb_accessible, nb_illisible, nb_defectueux, nb_bloque, nb_inaccessible, nb_vole,
               nb_conso_nulle, nb_conso_faible, nb_conso_normale, nb_conso_elevee,
               nb_estimes, nb_index_decroissant, nb_releveurs, derniere_saisie
        FROM v_secteur_cycle {where}
        ORDER BY pct_avancement ASC NULLS FIRST
    """, params)
    return _df_to_xlsx_response(df, "avancement_saisie", "Avancement")


@router.get("/export/anomalies")
def export_anomalies(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
):
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    where += " AND CONSO_CAT IN ('Nulle','Faible','Elevée')"
    df = _fetch_df(f"""
        SELECT REL_DATE, CENTRE_LIB, SECT_LIB, CPT_REF, ABN_ID, MATRICULE,
               REL_INDEX, REL_ANCIEN_INDEX, REL_CONSOM_CALCUL,
               ETAT_COMPTAGE, CONSO_CAT, REL_VALIDE
        FROM v_releve {where}
        ORDER BY REL_DATE DESC
    """, params)
    return _df_to_xlsx_response(df, "anomalies", "Anomalies")


@router.get("/export/hierarchie-centre")
def export_hierarchie_centre(
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
):
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    df = _fetch_df(f"""
        SELECT STR_ID, CENTRE_LIB,
               COUNT(*) AS nb_releves,
               COUNT(*) FILTER (WHERE ID_COMP = 1) AS nb_accessible,
               COUNT(*) FILTER (WHERE ID_COMP IN (2,3,4,5,6)) AS nb_a_controler,
               COUNT(*) FILTER (WHERE REL_VALIDE = 0) AS nb_non_valides,
               ROUND(AVG(REL_CONSOM_CALCUL), 2) AS conso_moy
        FROM v_releve {where}
        GROUP BY STR_ID, CENTRE_LIB
        ORDER BY nb_releves DESC
    """, params)
    return _df_to_xlsx_response(df, "hierarchie_centres", "Centres")


@router.get("/export/secteur-detail")
def export_secteur_detail(
    str_id: int = Query(...), sect_id: int = Query(...),
    annee: int = Query(...), mois: int = Query(...),
):
    df = _fetch_df("""
        SELECT REL_DATE, DATE_GEN, CPT_REF, ABN_ID, MATRICULE,
               REL_INDEX, REL_ANCIEN_INDEX,
               REL_CONSOM_CALCUL, REL_MOYENNE_CONSOM,
               REL_NBR_JR, REL_ESTIMATIF,
               ETAT_COMPTAGE, CONSO_CAT, REL_VALIDE, REL_ORIGINE
        FROM v_releve
        WHERE STR_ID = ? AND SECT_ID = ?
          AND REL_ANNEE = ? AND REL_MOIS = ?
        ORDER BY REL_DATE DESC, CPT_REF
    """, [str_id, sect_id, annee, mois])
    return _df_to_xlsx_response(df, f"secteur_{str_id}_{sect_id}_{annee}_{mois:02d}", "Détail")


@router.get("/export/releves-list")
def export_releves_list(
    request: Request,
    str_id: int | None = None, sect_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
    id_comp: int | None = None, conso_cat: str | None = None,
    q: str | None = None,
):
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    if id_comp is not None:
        where += " AND ID_COMP = ?"; params.append(id_comp)
    if conso_cat:
        where += " AND CONSO_CAT = ?"; params.append(conso_cat)
    if q:
        where += " AND (CAST(CPT_REF AS VARCHAR) ILIKE ? OR CAST(ABN_ID AS VARCHAR) ILIKE ? OR MATRICULE ILIKE ?)"
        params += [f"%{q}%", f"%{q}%", f"%{q}%"]
    for snippet, sp in _extract_column_filters(request):
        where += " AND " + snippet; params.extend(sp)
    df = _fetch_df(f"""
        SELECT REL_DATE, CENTRE_LIB, SECT_LIB, CPT_REF, ABN_ID, MATRICULE,
               REL_ANCIEN_INDEX, REL_INDEX,
               REL_CONSOM_CALCUL, REL_MOYENNE_CONSOM,
               ETAT_COMPTAGE, CONSO_CAT, REL_VALIDE, REL_ESTIMATIF
        FROM v_releve {where}
        ORDER BY REL_DATE DESC
    """, params)
    return _df_to_xlsx_response(df, "releves", "Relevés")


# ============================================================
# Reload période depuis Oracle
# ============================================================

class ReloadPeriodRequest(BaseModel):
    date_from: str = Field(...)
    date_to:   str = Field(...)


@router.post("/reload-period")
def post_reload_period(payload: ReloadPeriodRequest) -> dict:
    from src.pipeline import reload_period
    try:
        d_from = datetime.strptime(payload.date_from, "%Y-%m-%d")
        d_to   = datetime.strptime(payload.date_to, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Dates invalides (YYYY-MM-DD)")
    if d_from > d_to:
        raise HTTPException(400, "date_from doit être <= date_to")
    nb_days = (d_to - d_from).days + 1
    if nb_days > MAX_RELOAD_DAYS:
        raise HTTPException(400, f"Plage trop large ({nb_days}j). Max {MAX_RELOAD_DAYS}j.")
    logger.info(f"[API] /reload-period : {payload.date_from} -> {payload.date_to}")
    try:
        return reload_period(d_from, d_to)
    except Exception as exc:
        logger.exception("[API] /reload-period KO")
        raise HTTPException(500, f"Erreur rechargement : {exc}") from exc

# ============================================================
# AJOUT — Endpoints "État Complet" (onglet 4)
# ============================================================
# Source : v_releve (raw_releve + jointures ref + colonnes calculées)
# ============================================================


@router.get("/etat-complet-stats")
def get_etat_complet_stats(
    str_id:     int | None  = Query(None),
    sect_id:    int | None  = Query(None),
    date_from:  str | None  = Query(None),
    date_to:    str | None  = Query(None),
) -> dict:
    """
    KPI agrégés pour les 8 cards de l'onglet État Complet.
    Respecte les filtres globaux (str_id, sect_id, dates).
    """
    where, params = _build_where(str_id, sect_id, date_from, date_to)

    sql = f"""
        SELECT
            COUNT(*)                                          AS total_releves,
            COUNT(DISTINCT STR_ID)                            AS nb_centres,
            COUNT(DISTINCT SECT_ID)                           AS nb_secteurs,
            COUNT(DISTINCT MATRICULE)
                FILTER (WHERE MATRICULE IS NOT NULL AND MATRICULE != '')
                                                              AS nb_releveurs,
            COUNT(DISTINCT CPT_REF)                           AS nb_compteurs,
            COALESCE(SUM(REL_CONSOM_CALCUL), 0)               AS conso_totale,
            COALESCE(AVG(REL_CONSOM_CALCUL), 0)               AS conso_moyenne,
            COUNT(*) FILTER (WHERE REL_VALIDE = 1)            AS nb_valides,
            COUNT(*) FILTER (WHERE REL_VALIDE = 0)            AS nb_non_valides,
            COUNT(*) FILTER (WHERE REL_ESTIMATIF = 1)         AS nb_estimes
        FROM v_releve
        {where}
    """
    return _fetch_one(sql, params)


@router.get("/etat-complet-list")
def get_etat_complet_list(
    request:    Request,
    str_id:     int | None  = Query(None),
    sect_id:    int | None  = Query(None),
    date_from:  str | None  = Query(None),
    date_to:    str | None  = Query(None),
    q:          str | None  = Query(None, description="Recherche globale (CPT_REF, ABN_ID, MATRICULE)"),
    sort_by:    str = Query("REL_DATE"),
    sort_dir:   str = Query("desc", regex="^(asc|desc)$"),
    limit:      int = Query(50, le=10000),
    offset:     int = 0,
) -> dict:
    """
    Liste paginée des relevés (table principale de l'onglet État Complet).

    Supporte :
      - Filtres globaux (FilterBar)
      - Recherche globale `q` sur CPT_REF / ABN_ID / MATRICULE
      - Filtres par colonne `f_<colonne>` (ex: f_centre_lib=El+Mina)
      - Tri par n'importe quelle colonne de ALLOWED_FILTER_COLUMNS

    Retourne {total, rows}.
    """
    where, params = _build_where(str_id, sect_id, date_from, date_to)
    extra_parts: list[str] = []

    # 1) Recherche globale
    if q:
        extra_parts.append("(CPT_REF ILIKE ? OR CAST(ABN_ID AS VARCHAR) ILIKE ? OR MATRICULE ILIKE ?)")
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])

    # 2) Filtres par colonne
    for expr, vals in _extract_column_filters(request):
        extra_parts.append(expr)
        params.extend(vals)

    if extra_parts:
        where = where + " AND " + " AND ".join(extra_parts)

    # 3) Sort whitelist
    if sort_by not in ALLOWED_FILTER_COLUMNS:
        sort_by = "REL_DATE"
    sort_dir_sql = "DESC" if sort_dir == "desc" else "ASC"

    # 4) Total
    total_row = _fetch_one(
        f"SELECT COUNT(*) AS n FROM v_releve {where}",
        params,
    )
    total = int(total_row.get("n", 0) or 0)

    # 5) Page
    rows = _fetch_all(
        f"""
        SELECT
            REL_ID, REL_DATE, REL_ANNEE, REL_MOIS,
            CPT_REF, ABN_ID, MATRICULE,
            STR_ID, CENTRE_LIB,
            SECT_ID, SECT_LIB,
            REL_ANCIEN_INDEX, REL_INDEX,
            REL_CONSOM_CALCUL, REL_MOYENNE_CONSOM, REL_NBR_JR,
            ID_COMP, COMPTAGE_LIB, ETAT_COMPTAGE,
            CONSO_CAT, REL_VALIDE, REL_ESTIMATIF
        FROM v_releve
        {where}
        ORDER BY {sort_by} {sort_dir_sql}, REL_ID DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    )

    return {"total": total, "rows": rows}