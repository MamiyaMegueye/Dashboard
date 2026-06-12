"""
Extraction Oracle -> DataFrame avec pattern "clean at the border".

🛡️ TOUTES les requêtes sont SELECT pur, validées par oracle_client.run_query()
   qui refuse tout mot-clé d'écriture.

[v2.1] Ajouts :
  - extract_abonnement()  pour vérifier le parc actif
  - Toutes les extractions CLOTURE / ABONNEMENT sont try/except friendly
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
from loguru import logger

from src.config import settings
from src.oracle_client import run_query


# ============================================================
# Schémas "clean at the border"
# ============================================================

RELEVE_SCHEMA: dict[str, str] = {
    "REL_ID":               "Int64",
    "ABN_ID":               "Int64",
    "CPT_REF":              "string",
    "LOC_ID":               "Int64",
    "TOUR_ID":              "Int64",
    "STR_ID":               "Int64",
    "SECT_ID":              "Int64",
    "MATRICULE":            "string",
    "REL_DATE":             "datetime",
    "REL_ANNEE":            "Int64",
    "REL_MOIS":             "Int64",
    "DATE_GEN":             "datetime",
    "REL_DATE_ANC_INDEX":   "datetime",
    "REL_INDEX":            "Float64",
    "REL_ANCIEN_INDEX":     "Float64",
    "REL_CONSOM_CALCUL":    "Float64",
    "REL_MOYENNE_CONSOM":   "Float64",
    "REL_NBR_JR":           "Int64",
    "ID_COMP":              "Int64",
    "TYP_REL_ID":           "Int64",
    "REL_VALIDE":           "Int64",
    "REL_ESTIMATIF":        "Int64",
    "REL_FACTURABLE_FLAG":  "Int64",
    "REL_MAT":              "string",
    "REL_MESSAGE":          "string",
    "REL_ORIGINE":          "string",
}


CLOTURE_SCHEMA: dict[str, str] = {
    "IDCLOTURE":       "Int64",
    "STR_ID":          "Int64",
    "SECT_ID":         "Int64",
    "ANNEE":           "Int64",
    "MOIS":            "Int64",
    "NBABO":           "Int64",
    "NBTRAITER":       "Int64",
    "NBNONTRAITER":    "Int64",
    "POURCTRAITER":    "Int64",
    "POURCNONTRAITER": "Int64",
    "VOLUMEFACT":      "Float64",
    "VOLUMESTIM":      "Float64",
    "CLOTURE":         "Int64",
    "FLAG_CALCUL":     "Int64",
    "FLAG_VALID":      "Int64",
    "MATRICULE":       "string",
    "DATE_CLOT":       "datetime",
}


# 🆕 Schéma S_ABONNEMENT (subset utile pour vérifier le parc)
ABONNEMENT_SCHEMA: dict[str, str] = {
    "ABN_ID":     "Int64",
    "STR_ID":     "Int64",
    "SECT_ID":    "Int64",
    "ABN_RES":    "Int64",      # 0 = actif, autre = résilié/suspendu (à valider)
    "CPT_REF":    "string",
}


def _cast_dataframe(df: pd.DataFrame, schema: dict[str, str]) -> pd.DataFrame:
    """Pattern 'clean at the border'."""
    out = pd.DataFrame()
    for col, kind in schema.items():
        if col in df.columns:
            s = df[col]
        else:
            s = pd.Series([pd.NA] * len(df))

        if kind == "Int64":
            out[col] = pd.to_numeric(s, errors="coerce").astype("Int64")
        elif kind == "Float64":
            out[col] = pd.to_numeric(s, errors="coerce").astype("Float64")
        elif kind == "datetime":
            out[col] = pd.to_datetime(s, errors="coerce")
        elif kind == "string":
            out[col] = s.astype("string").fillna("")
        else:
            raise ValueError(f"Type inconnu : {kind}")
    return out


# ============================================================
# Requêtes Oracle S_RELEVE
# ============================================================

def _build_releve_query(since: Optional[datetime]) -> tuple[str, dict]:
    exclude_ids = ", ".join(str(x) for x in settings.str_id_exclude_list)
    exclude_clause = f"AND r.STR_ID NOT IN ({exclude_ids})" if exclude_ids else ""
    sql = f"""
        SELECT
            r.REL_ID, r.ABN_ID, r.CPT_REF, r.LOC_ID, r.TOUR_ID,
            r.STR_ID, r.SECT_ID, r.MATRICULE,
            r.REL_DATE, r.REL_ANNEE, r.REL_MOIS, r.DATE_GEN, r.REL_DATE_ANC_INDEX,
            r.REL_INDEX, r.REL_ANCIEN_INDEX, r.REL_CONSOM_CALCUL,
            r.REL_MOYENNE_CONSOM, r.REL_NBR_JR,
            r.ID_COMPTAGE AS ID_COMP, r.TYP_REL_ID, r.REL_VALIDE,
            r.REL_ESTIMATIF, r.REL_FACTURABLE_FLAG,
            r.REL_MAT, r.REL_MESSAGE, r.REL_ORIGINE
        FROM CRM_SNDE.S_RELEVE r
        JOIN CRM_SNDE.S_STRUCTURE s ON s.STR_ID = r.STR_ID
        WHERE s.ZONE_ID = :zone_id
          {exclude_clause}
          AND r.REL_DATE >= :since_dt
        ORDER BY r.REL_DATE
    """
    return sql, {"zone_id": settings.ZONE_ID, "since_dt": since}


def _build_releve_range_query(date_from: datetime, date_to: datetime) -> tuple[str, dict]:
    exclude_ids = ", ".join(str(x) for x in settings.str_id_exclude_list)
    exclude_clause = f"AND r.STR_ID NOT IN ({exclude_ids})" if exclude_ids else ""
    sql = f"""
        SELECT
            r.REL_ID, r.ABN_ID, r.CPT_REF, r.LOC_ID, r.TOUR_ID,
            r.STR_ID, r.SECT_ID, r.MATRICULE,
            r.REL_DATE, r.REL_ANNEE, r.REL_MOIS, r.DATE_GEN, r.REL_DATE_ANC_INDEX,
            r.REL_INDEX, r.REL_ANCIEN_INDEX, r.REL_CONSOM_CALCUL,
            r.REL_MOYENNE_CONSOM, r.REL_NBR_JR,
            r.ID_COMPTAGE AS ID_COMP, r.TYP_REL_ID, r.REL_VALIDE,
            r.REL_ESTIMATIF, r.REL_FACTURABLE_FLAG,
            r.REL_MAT, r.REL_MESSAGE, r.REL_ORIGINE
        FROM CRM_SNDE.S_RELEVE r
        JOIN CRM_SNDE.S_STRUCTURE s ON s.STR_ID = r.STR_ID
        WHERE s.ZONE_ID = :zone_id
          {exclude_clause}
          AND r.REL_DATE >= :date_from
          AND r.REL_DATE <  :date_to_excl
        ORDER BY r.REL_DATE
    """
    return sql, {
        "zone_id": settings.ZONE_ID,
        "date_from": date_from,
        "date_to_excl": date_to + timedelta(days=1),
    }


def extract_releve(since: Optional[datetime] = None) -> pd.DataFrame:
    if since is None:
        since = datetime.utcnow() - timedelta(days=settings.INITIAL_LOAD_DAYS)
    logger.info(f"Extraction Oracle S_RELEVE depuis {since.isoformat()}")
    sql, params = _build_releve_query(since)
    df_raw = run_query(sql, params)
    logger.info(f"  -> {len(df_raw):,} lignes brutes lues")
    df = _cast_dataframe(df_raw, RELEVE_SCHEMA)
    logger.info(f"  -> {len(df):,} lignes typées")
    return df


def extract_releve_range(date_from: datetime, date_to: datetime) -> pd.DataFrame:
    logger.info(f"Extraction Oracle S_RELEVE plage : {date_from.isoformat()} -> {date_to.isoformat()}")
    sql, params = _build_releve_range_query(date_from, date_to)
    df_raw = run_query(sql, params)
    logger.info(f"  -> {len(df_raw):,} lignes brutes lues sur la plage")
    df = _cast_dataframe(df_raw, RELEVE_SCHEMA)
    logger.info(f"  -> {len(df):,} lignes typées")
    return df


# ============================================================
# Requête Oracle CLOTURE_SECTEUR
# ============================================================

def _build_cloture_query(nb_cycles: int) -> tuple[str, dict]:
    exclude_ids = ", ".join(str(x) for x in settings.str_id_exclude_list)
    exclude_clause = f"AND cs.STR_ID NOT IN ({exclude_ids})" if exclude_ids else ""
    sql = f"""
        SELECT
            cs.IDCLOTURE, cs.STR_ID, cs.SECT_ID,
            cs.ANNEE, cs.MOIS,
            cs.NBABO, cs.NBTRAITER, cs.NBNONTRAITER,
            cs.POURCTRAITER, cs.POURCNONTRAITER,
            cs.VOLUMEFACT, cs.VOLUMESTIM,
            cs.CLOTURE, cs.FLAG_CALCUL, cs.FLAG_VALID,
            cs.MATRICULE, cs.DATE_CLOT
        FROM CRM_SNDE.CLOTURE_SECTEUR cs
        JOIN CRM_SNDE.S_STRUCTURE s ON s.STR_ID = cs.STR_ID
        WHERE s.ZONE_ID = :zone_id
          {exclude_clause}
          AND (cs.ANNEE * 100 + cs.MOIS) >= (
              SELECT MAX(ANNEE * 100 + MOIS) - :nb_cycles_minus_1
              FROM CRM_SNDE.CLOTURE_SECTEUR
              WHERE ANNEE = (SELECT MAX(ANNEE) FROM CRM_SNDE.CLOTURE_SECTEUR)
            )
          
        ORDER BY cs.ANNEE DESC, cs.MOIS DESC, cs.STR_ID, cs.POURCTRAITER ASC
    """
    return sql, {"zone_id": settings.ZONE_ID, "nb_cycles_minus_1": nb_cycles - 1}


def extract_cloture_secteur(nb_cycles: Optional[int] = None) -> pd.DataFrame:
    """Extraction CLOTURE_SECTEUR N derniers cycles, périmètre Nouakchott."""
    if nb_cycles is None:
        nb_cycles = settings.CLOTURE_NB_CYCLES
    logger.info(f"Extraction Oracle CLOTURE_SECTEUR pour {nb_cycles} cycles glissants")
    sql, params = _build_cloture_query(nb_cycles)
    df_raw = run_query(sql, params)
    logger.info(f"  -> {len(df_raw):,} lignes brutes lues (CLOTURE_SECTEUR)")
    df = _cast_dataframe(df_raw, CLOTURE_SCHEMA)
    logger.info(f"  -> {len(df):,} lignes typées (CLOTURE_SECTEUR)")
    if len(df) > 0:
        cycles = df.apply(lambda r: f"{r.ANNEE}-{r.MOIS:02d}", axis=1).unique()
        logger.info(f"  -> Cycles présents : {sorted(cycles, reverse=True)}")
    return df


# ============================================================
# 🆕 Requête Oracle S_ABONNEMENT (parc actif)
# ============================================================

def _build_abonnement_query() -> tuple[str, dict]:
    """
    Récupère le parc d'abonnés actifs pour la zone Nouakchott.

    ⚠️ HYPOTHÈSE : ABN_RES = 0 signifie 'actif' (à valider en DBeaver).
       Si différent, ajuster la clause WHERE.
    """
    exclude_ids = ", ".join(str(x) for x in settings.str_id_exclude_list)
    exclude_clause = f"AND a.STR_ID NOT IN ({exclude_ids})" if exclude_ids else ""
    sql = f"""
        SELECT
            a.ABN_ID, a.STR_ID, a.SECT_ID,
            a.ABN_RES, a.CPT_REF
        FROM CRM_SNDE.S_ABONNEMENT a
        JOIN CRM_SNDE.S_STRUCTURE s ON s.STR_ID = a.STR_ID
        WHERE s.ZONE_ID = :zone_id
          {exclude_clause}
          AND a.ABN_RES = 0
    """
    return sql, {"zone_id": settings.ZONE_ID}


def extract_abonnement() -> pd.DataFrame:
    """
    Extraction S_ABONNEMENT (parc actif Nouakchott).
    Retourne un DataFrame vide en cas d'erreur — la pipeline continue.

    Cette extraction est utilisée pour VÉRIFIER le dénominateur NBABO
    de CLOTURE_SECTEUR (cohérence inter-tables).
    """
    logger.info("Extraction Oracle S_ABONNEMENT (parc actif)")
    try:
        sql, params = _build_abonnement_query()
        df_raw = run_query(sql, params)
        logger.info(f"  -> {len(df_raw):,} abonnés actifs Nouakchott")
        df = _cast_dataframe(df_raw, ABONNEMENT_SCHEMA)
        return df
    except Exception as exc:
        logger.warning(
            f"⚠️ Extraction S_ABONNEMENT KO : {exc}. "
            f"La pipeline continue sans vérification de parc."
        )
        return _cast_dataframe(pd.DataFrame(), ABONNEMENT_SCHEMA)


# ============================================================
# Tables de référence
# ============================================================

REF_TABLES: dict[str, dict] = {
    "ref_comptage": {
        "sql": "SELECT ID_COMP, COMP_LIBLT AS LIBELLE FROM CRM_SNDE.COMPTAGE",
        "schema": {"ID_COMP": "Int64", "LIBELLE": "string"},
        "params": None,
    },
    "ref_centre": {
        "sql": (
            "SELECT STR_ID AS CENTRE_ID, STR_LIB_LT AS CENTRE_LIB "
            "FROM CRM_SNDE.S_STRUCTURE "
            "WHERE ZONE_ID = :zone_id"
        ),
        "schema": {"CENTRE_ID": "Int64", "CENTRE_LIB": "string"},
        "params": {"zone_id": None},
    },
    "ref_secteur": {
        "sql": "SELECT SECT_ID, SECT_LIBLT AS SECT_LIB, STR_ID FROM CRM_SNDE.S_SECTEUR",
        "schema": {"SECT_ID": "Int64", "SECT_LIB": "string", "STR_ID": "Int64"},
        "params": None,
    },
}


def extract_reference_tables() -> dict[str, pd.DataFrame]:
    refs: dict[str, pd.DataFrame] = {}
    for name, conf in REF_TABLES.items():
        try:
            params = conf.get("params")
            if params and "zone_id" in params:
                params = {"zone_id": settings.ZONE_ID}
            df_raw = run_query(conf["sql"], params) if params else run_query(conf["sql"])
            df = _cast_dataframe(df_raw, conf["schema"])
            if name == "ref_centre" and settings.str_id_exclude_list:
                exclude = settings.str_id_exclude_list
                before = len(df)
                df = df[~df["CENTRE_ID"].isin(exclude)].reset_index(drop=True)
                logger.info(f"  Ref ref_centre : {before - len(df)} entité(s) admin exclue(s) {exclude}")
            refs[name] = df
            logger.info(f"  Ref {name:20s} : {len(df):>6} lignes")
        except Exception as exc:
            logger.warning(f"  Ref {name} KO : {exc} -> table vide")
            refs[name] = _cast_dataframe(pd.DataFrame(), conf["schema"])
    return refs