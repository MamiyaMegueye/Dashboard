"""
Construction des marts métier dans DuckDB.

[v2.2] :
  - Seuil d'alerte porté de 80% à 90% (via settings.CLOTURE_ALERT_THRESHOLD_PCT)
  - Colonne renommée flag_seuil_80 -> flag_seuil_alerte (indépendant du seuil)


[v2.1] Refonte :
  - Vue unifiée v_secteur_cycle qui croise CLOTURE_SECTEUR + S_RELEVE
    + COMPTAGE + S_STRUCTURE + S_SECTEUR + S_ABONNEMENT
  - Tous les marts de pilotage/avancement dérivent de cette vue unique
  - Logique d'alerte centrée sur CLOTURE = 0 (fenêtre actionnable)
"""

from __future__ import annotations

from loguru import logger

from src.config import settings


# ============================================================
# DDL — tables raw & ref
# ============================================================

DDL_RAW = """
CREATE TABLE IF NOT EXISTS raw_releve (
    REL_ID              BIGINT PRIMARY KEY,
    ABN_ID              BIGINT, CPT_REF VARCHAR, LOC_ID BIGINT, TOUR_ID BIGINT,
    STR_ID BIGINT, SECT_ID BIGINT, MATRICULE VARCHAR,
    REL_DATE TIMESTAMP, REL_ANNEE BIGINT, REL_MOIS BIGINT,
    DATE_GEN TIMESTAMP, REL_DATE_ANC_INDEX TIMESTAMP,
    REL_INDEX DOUBLE, REL_ANCIEN_INDEX DOUBLE,
    REL_CONSOM_CALCUL DOUBLE, REL_MOYENNE_CONSOM DOUBLE,
    REL_NBR_JR BIGINT, ID_COMP BIGINT, TYP_REL_ID BIGINT,
    REL_VALIDE BIGINT, REL_ESTIMATIF BIGINT, REL_FACTURABLE_FLAG BIGINT,
    REL_MAT VARCHAR, REL_MESSAGE VARCHAR, REL_ORIGINE VARCHAR
);

CREATE TABLE IF NOT EXISTS raw_cloture_secteur (
    IDCLOTURE BIGINT PRIMARY KEY,
    STR_ID BIGINT, SECT_ID BIGINT, ANNEE BIGINT, MOIS BIGINT,
    NBABO BIGINT, NBTRAITER BIGINT, NBNONTRAITER BIGINT,
    POURCTRAITER BIGINT, POURCNONTRAITER BIGINT,
    VOLUMEFACT DOUBLE, VOLUMESTIM DOUBLE,
    CLOTURE BIGINT, FLAG_CALCUL BIGINT, FLAG_VALID BIGINT,
    MATRICULE VARCHAR, DATE_CLOT TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raw_abonnement (
    ABN_ID BIGINT PRIMARY KEY,
    STR_ID BIGINT, SECT_ID BIGINT,
    ABN_RES BIGINT, CPT_REF VARCHAR
);

CREATE TABLE IF NOT EXISTS ref_comptage (ID_COMP BIGINT PRIMARY KEY, LIBELLE VARCHAR);
CREATE TABLE IF NOT EXISTS ref_centre   (CENTRE_ID BIGINT PRIMARY KEY, CENTRE_LIB VARCHAR);
CREATE TABLE IF NOT EXISTS ref_secteur  (SECT_ID BIGINT PRIMARY KEY, SECT_LIB VARCHAR, STR_ID BIGINT);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id INTEGER, started_at TIMESTAMP, finished_at TIMESTAMP,
    status VARCHAR, rows_extracted BIGINT, error_message VARCHAR
);

CREATE TABLE IF NOT EXISTS cloture_snapshot_prev (
    IDCLOTURE BIGINT PRIMARY KEY,
    STR_ID BIGINT, SECT_ID BIGINT,
    ANNEE BIGINT, MOIS BIGINT,
    POURCTRAITER BIGINT, snapshot_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts_log (
    alert_id INTEGER PRIMARY KEY,
    alert_type VARCHAR,
    STR_ID BIGINT, SECT_ID BIGINT,
    ANNEE BIGINT, MOIS BIGINT,
    pct_avant BIGINT, pct_apres BIGINT,
    detected_at TIMESTAMP,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP
);
"""


# ============================================================
# INDEX
# ============================================================

DDL_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_raw_releve_date     ON raw_releve(REL_DATE);
CREATE INDEX IF NOT EXISTS idx_raw_releve_strid    ON raw_releve(STR_ID);
CREATE INDEX IF NOT EXISTS idx_raw_releve_sectid   ON raw_releve(SECT_ID);
CREATE INDEX IF NOT EXISTS idx_raw_releve_strdate  ON raw_releve(STR_ID, REL_DATE);
CREATE INDEX IF NOT EXISTS idx_raw_releve_cycle    ON raw_releve(REL_ANNEE, REL_MOIS);

CREATE INDEX IF NOT EXISTS idx_cloture_strid       ON raw_cloture_secteur(STR_ID);
CREATE INDEX IF NOT EXISTS idx_cloture_sectid      ON raw_cloture_secteur(SECT_ID);
CREATE INDEX IF NOT EXISTS idx_cloture_cycle       ON raw_cloture_secteur(ANNEE, MOIS);
CREATE INDEX IF NOT EXISTS idx_cloture_str_sect    ON raw_cloture_secteur(STR_ID, SECT_ID);

CREATE INDEX IF NOT EXISTS idx_abonnement_strid    ON raw_abonnement(STR_ID);
CREATE INDEX IF NOT EXISTS idx_abonnement_sectid   ON raw_abonnement(SECT_ID);
"""


# ============================================================
# Vue enrichie S_RELEVE (avec ETAT_COMPTAGE et CONSO_CAT)
# ============================================================

VIEW_RELEVE_ENRICHED = """
CREATE OR REPLACE VIEW v_releve AS
SELECT
    -- 🔧 v2.2.1 : MATRICULE remplacé par COALESCE(MATRICULE, REL_MAT)
    --     car r.MATRICULE est souvent vide en Oracle, le vrai matricule
    --     du releveur est dans r.REL_MAT
    r.* EXCLUDE (MATRICULE),
    COALESCE(NULLIF(TRIM(r.MATRICULE), ''), TRIM(r.REL_MAT)) AS MATRICULE,
    c.LIBELLE                          AS COMPTAGE_LIB,
    ce.CENTRE_LIB                      AS CENTRE_LIB,
    s.SECT_LIB                         AS SECT_LIB,
    CASE r.ID_COMP
        WHEN 1 THEN 'Accessible'
        WHEN 2 THEN 'Illisible'
        WHEN 3 THEN 'Défectueux'
        WHEN 4 THEN 'Bloqué'
        WHEN 5 THEN 'Inaccessible'
        WHEN 6 THEN 'Volé'
        ELSE 'Autre'
    END                                AS ETAT_COMPTAGE,
    CASE
        WHEN r.REL_CONSOM_CALCUL IS NULL                            THEN 'Inconnue'
        WHEN r.REL_CONSOM_CALCUL = 0                                 THEN 'Nulle'
        WHEN r.REL_CONSOM_CALCUL > 0 AND r.REL_CONSOM_CALCUL < 5     THEN 'Faible'
        WHEN r.REL_CONSOM_CALCUL > 300                               THEN 'Elevée'
        ELSE 'Normale'
    END                                AS CONSO_CAT
FROM raw_releve r
LEFT JOIN ref_comptage  c  ON c.ID_COMP    = r.ID_COMP
LEFT JOIN ref_centre    ce ON ce.CENTRE_ID = r.STR_ID
LEFT JOIN ref_secteur   s  ON s.SECT_ID    = r.SECT_ID;
"""


# ============================================================
# 🆕 Vue maîtresse v_secteur_cycle
#    Croise CLOTURE_SECTEUR + S_RELEVE + COMPTAGE + S_ABONNEMENT
# ============================================================

VIEW_SECTEUR_CYCLE = f"""
CREATE OR REPLACE VIEW v_secteur_cycle AS
WITH
releve_stats AS (
    SELECT
        r.STR_ID, r.SECT_ID,
        r.REL_ANNEE AS ANNEE, r.REL_MOIS AS MOIS,
        COUNT(DISTINCT r.CPT_REF)                              AS nb_compteurs_releves,
        -- États comptage
        COUNT(*) FILTER (WHERE r.ID_COMP = 1)                  AS nb_accessible,
        COUNT(*) FILTER (WHERE r.ID_COMP = 2)                  AS nb_illisible,
        COUNT(*) FILTER (WHERE r.ID_COMP = 3)                  AS nb_defectueux,
        COUNT(*) FILTER (WHERE r.ID_COMP = 4)                  AS nb_bloque,
        COUNT(*) FILTER (WHERE r.ID_COMP = 5)                  AS nb_inaccessible,
        COUNT(*) FILTER (WHERE r.ID_COMP = 6)                  AS nb_vole,
        -- Catégories de consommation
        COUNT(*) FILTER (WHERE r.REL_CONSOM_CALCUL = 0)        AS nb_conso_nulle,
        COUNT(*) FILTER (WHERE r.REL_CONSOM_CALCUL > 0
                          AND r.REL_CONSOM_CALCUL < 5)         AS nb_conso_faible,
        COUNT(*) FILTER (WHERE r.REL_CONSOM_CALCUL > 300)      AS nb_conso_elevee,
        COUNT(*) FILTER (WHERE r.REL_CONSOM_CALCUL >= 5
                          AND r.REL_CONSOM_CALCUL <= 300)      AS nb_conso_normale,
        -- Qualité
        COUNT(*) FILTER (WHERE r.REL_ESTIMATIF = 1)            AS nb_estimes,
        COUNT(*) FILTER (WHERE r.REL_INDEX < r.REL_ANCIEN_INDEX) AS nb_index_decroissant,
        COUNT(*) FILTER (WHERE r.REL_VALIDE = 1)               AS nb_valides_releve,
        COUNT(*) FILTER (WHERE r.REL_VALIDE = 0)               AS nb_non_valides_releve,
        -- Releveurs
        COUNT(DISTINCT r.MATRICULE) FILTER (WHERE r.MATRICULE != '') AS nb_releveurs,
        SUM(r.REL_CONSOM_CALCUL)                               AS conso_totale,
        MAX(r.REL_DATE)                                        AS derniere_saisie
    FROM raw_releve r
    GROUP BY r.STR_ID, r.SECT_ID, r.REL_ANNEE, r.REL_MOIS
),
parc_actif AS (
    SELECT STR_ID, SECT_ID, COUNT(*) AS nb_parc_abonnement
    FROM raw_abonnement
    WHERE ABN_RES = 0
    GROUP BY STR_ID, SECT_ID
)
SELECT
    -- Identification
    cs.IDCLOTURE,
    cs.STR_ID                                                  AS centre_code,
    COALESCE(ce.CENTRE_LIB,
             '(centre ' || CAST(cs.STR_ID AS VARCHAR) || ')')  AS centre_libelle,
    cs.SECT_ID                                                 AS secteur_code,
    COALESCE(sec.SECT_LIB,
             '(secteur ' || CAST(cs.SECT_ID AS VARCHAR) || ')') AS secteur_libelle,
    cs.ANNEE, cs.MOIS,
    (cs.ANNEE * 100 + cs.MOIS)                                 AS cycle_key,
    -- Header CLOTURE_SECTEUR
    cs.NBABO                                                   AS parc_cloture,
    pa.nb_parc_abonnement                                      AS parc_abonnement_actif,
    cs.NBTRAITER                                               AS saisis_declare,
    rs.nb_compteurs_releves                                    AS saisis_reel,
    cs.NBNONTRAITER                                            AS restant,
    cs.POURCTRAITER                                            AS pct_avancement,
    cs.VOLUMEFACT                                              AS volume_facture,
    cs.VOLUMESTIM                                              AS volume_estime,
    ROUND(100.0 * cs.VOLUMESTIM / NULLIF(cs.VOLUMEFACT, 0), 1) AS pct_estimation,
    -- Flags cycle
    cs.CLOTURE, cs.FLAG_CALCUL, cs.FLAG_VALID,
    CASE
        WHEN cs.FLAG_VALID = 1                    THEN 'Validé'
        WHEN cs.CLOTURE = 1 AND cs.FLAG_VALID = 0 THEN 'À valider'
        WHEN cs.CLOTURE = 0                       THEN 'En cours'
        ELSE 'Autre'
    END                                                        AS statut,
    -- Catégorie d'avancement
    CASE
        WHEN cs.POURCTRAITER IS NULL OR cs.POURCTRAITER = 0                              THEN 'A 0pct'
        WHEN cs.POURCTRAITER < {settings.CLOTURE_THRESHOLD_LOW_PCT}                      THEN 'Critique'
        WHEN cs.POURCTRAITER < {settings.CLOTURE_ALERT_THRESHOLD_PCT}                    THEN 'En retard'
        WHEN cs.POURCTRAITER < {settings.CLOTURE_THRESHOLD_HIGH_PCT}                     THEN 'Avancé'
        ELSE 'Presque fini'
    END                                                        AS avancement_cat,
    cs.MATRICULE                                               AS matricule_clotureur,
    cs.DATE_CLOT,
    -- Stats S_RELEVE (états comptage)
    COALESCE(rs.nb_accessible, 0)    AS nb_accessible,
    COALESCE(rs.nb_illisible, 0)     AS nb_illisible,
    COALESCE(rs.nb_defectueux, 0)    AS nb_defectueux,
    COALESCE(rs.nb_bloque, 0)        AS nb_bloque,
    COALESCE(rs.nb_inaccessible, 0)  AS nb_inaccessible,
    COALESCE(rs.nb_vole, 0)          AS nb_vole,
    -- Stats S_RELEVE (consommation)
    COALESCE(rs.nb_conso_nulle, 0)   AS nb_conso_nulle,
    COALESCE(rs.nb_conso_faible, 0)  AS nb_conso_faible,
    COALESCE(rs.nb_conso_normale, 0) AS nb_conso_normale,
    COALESCE(rs.nb_conso_elevee, 0)  AS nb_conso_elevee,
    rs.conso_totale,
    -- Stats S_RELEVE (anomalies)
    COALESCE(rs.nb_estimes, 0)             AS nb_estimes,
    COALESCE(rs.nb_index_decroissant, 0)   AS nb_index_decroissant,
    COALESCE(rs.nb_valides_releve, 0)      AS nb_valides_releve,
    COALESCE(rs.nb_non_valides_releve, 0)  AS nb_non_valides_releve,
    COALESCE(rs.nb_releveurs, 0)           AS nb_releveurs,
    rs.derniere_saisie,
    -- Écart NBTRAITER vs COUNT(S_RELEVE) — pour audit cohérence
    (cs.NBTRAITER - COALESCE(rs.nb_compteurs_releves, 0)) AS ecart_nbtraiter,
    -- Indicateurs d'alerte (uniquement si CLOTURE = 0)
    CASE WHEN cs.CLOTURE = 0
              AND cs.POURCTRAITER >= {settings.CLOTURE_ALERT_THRESHOLD_PCT}
         THEN 1 ELSE 0 END                                     AS flag_seuil_alerte,
    CASE WHEN cs.CLOTURE = 0
              AND COALESCE(rs.nb_compteurs_releves, 0) > 0
              AND (COALESCE(rs.nb_conso_nulle, 0) * 1.0
                   / rs.nb_compteurs_releves) > 0.15
         THEN 1 ELSE 0 END                                     AS flag_trop_nulle,
    CASE WHEN cs.CLOTURE = 0
              AND COALESCE(rs.nb_compteurs_releves, 0) > 0
              AND (COALESCE(rs.nb_estimes, 0) * 1.0
                   / rs.nb_compteurs_releves) > 0.30
         THEN 1 ELSE 0 END                                     AS flag_trop_estime
FROM raw_cloture_secteur cs
LEFT JOIN ref_centre   ce  ON ce.CENTRE_ID = cs.STR_ID
LEFT JOIN ref_secteur  sec ON sec.SECT_ID  = cs.SECT_ID
LEFT JOIN releve_stats rs  ON rs.STR_ID = cs.STR_ID
                          AND rs.SECT_ID = cs.SECT_ID
                          AND rs.ANNEE = cs.ANNEE
                          AND rs.MOIS = cs.MOIS
LEFT JOIN parc_actif   pa  ON pa.STR_ID = cs.STR_ID
                          AND pa.SECT_ID = cs.SECT_ID;
"""


# ============================================================
# Marts S_RELEVE (fenêtre 30j)
# ============================================================

MARTS_RELEVE_SQL: dict[str, str] = {
    "mart_kpi_global": """
        CREATE OR REPLACE TABLE mart_kpi_global AS
        WITH base AS (SELECT * FROM v_releve WHERE REL_DATE >= {cutoff})
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
            COUNT(*) FILTER (WHERE CONSO_CAT = 'Elevée') AS conso_elevee,
            CAST(now() AS TIMESTAMP) AS computed_at
        FROM base;
    """,
    "mart_etat_comptage": """
        CREATE OR REPLACE TABLE mart_etat_comptage AS
        WITH base AS (SELECT * FROM v_releve WHERE REL_DATE >= {cutoff}),
        tot AS (SELECT COUNT(*) AS total FROM base)
        SELECT base.ID_COMP, base.ETAT_COMPTAGE,
               COUNT(*) AS nb, tot.total AS total,
               ROUND(COUNT(*) * 100.0 / NULLIF(tot.total,0), 1) AS pct
        FROM base, tot
        GROUP BY base.ID_COMP, base.ETAT_COMPTAGE, tot.total
        ORDER BY nb DESC;
    """,
    "mart_fiabilite": """
        CREATE OR REPLACE TABLE mart_fiabilite AS
        WITH base AS (SELECT * FROM v_releve WHERE REL_DATE >= {cutoff})
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ID_COMP = 1) AS fiables,
               COUNT(*) FILTER (WHERE ID_COMP IN (2,3,4,5,6)) AS a_controler,
               ROUND(100.0 * COUNT(*) FILTER (WHERE ID_COMP IN (2,3,4,5,6))
                           / NULLIF(COUNT(*), 0), 1) AS pct_a_controler
        FROM base;
    """,
    "mart_anomalies": """
        CREATE OR REPLACE TABLE mart_anomalies AS
        SELECT REL_ID, REL_DATE, ABN_ID, CPT_REF, MATRICULE,
               STR_ID, CENTRE_LIB, SECT_ID, SECT_LIB,
               REL_INDEX, REL_ANCIEN_INDEX, REL_CONSOM_CALCUL,
               ID_COMP, COMPTAGE_LIB, ETAT_COMPTAGE,
               CONSO_CAT, REL_VALIDE
        FROM v_releve
        WHERE REL_VALIDE = 0
          AND CONSO_CAT IN ('Nulle','Faible','Elevée')
          AND REL_DATE >= {cutoff}
        ORDER BY REL_DATE DESC;
    """,
    "mart_hierarchie_centre": """
        CREATE OR REPLACE TABLE mart_hierarchie_centre AS
        SELECT STR_ID, CENTRE_LIB,
               COUNT(*) AS nb_releves,
               COUNT(*) FILTER (WHERE ID_COMP = 1) AS nb_accessible,
               COUNT(*) FILTER (WHERE ID_COMP IN (2,3,4,5,6)) AS nb_a_controler,
               COUNT(*) FILTER (WHERE REL_VALIDE = 0) AS nb_non_valides,
               COUNT(*) FILTER (WHERE CONSO_CAT = 'Nulle')  AS nb_conso_nulle,
               COUNT(*) FILTER (WHERE CONSO_CAT = 'Faible') AS nb_conso_faible,
               COUNT(*) FILTER (WHERE CONSO_CAT = 'Elevée') AS nb_conso_elevee,
               ROUND(AVG(REL_CONSOM_CALCUL), 2) AS conso_moy
        FROM v_releve WHERE REL_DATE >= {cutoff}
        GROUP BY STR_ID, CENTRE_LIB
        ORDER BY nb_releves DESC;
    """,
}


# ============================================================
# 🆕 Marts CLOTURE — tous dérivés de v_secteur_cycle
# ============================================================

MARTS_CLOTURE_SQL: dict[str, str] = {

    # Synthèse globale Nouakchott — cycle courant
    "mart_pilotage_global": """
        CREATE OR REPLACE TABLE mart_pilotage_global AS
        WITH cur AS (
            SELECT * FROM v_secteur_cycle
            WHERE cycle_key = (SELECT MAX(cycle_key) FROM v_secteur_cycle)
        )
        SELECT
            MAX(cycle_key)       AS cycle_key,
            MAX(ANNEE)           AS annee,
            MAX(MOIS)            AS mois,
            COUNT(*)             AS nb_secteurs,
            SUM(parc_cloture)    AS parc_total,
            SUM(saisis_declare)  AS saisis,
            SUM(restant)         AS restant,
            ROUND(100.0 * SUM(saisis_declare) / NULLIF(SUM(parc_cloture), 0), 1) AS pct_avancement,
            COUNT(*) FILTER (WHERE statut = 'En cours')                     AS nb_en_cours,
            COUNT(*) FILTER (WHERE statut = 'À valider')                    AS nb_a_valider,
            COUNT(*) FILTER (WHERE statut = 'Validé')                       AS nb_valides,
            COUNT(*) FILTER (WHERE avancement_cat = 'A 0pct')               AS nb_secteurs_0pct,
            COUNT(*) FILTER (WHERE avancement_cat = 'Avancé')               AS nb_secteurs_avances,
            COUNT(*) FILTER (WHERE avancement_cat = 'Presque fini')         AS nb_secteurs_presque_fini,
            SUM(volume_facture)  AS volume_facture,
            SUM(volume_estime)   AS volume_estime,
            ROUND(100.0 * SUM(volume_estime) / NULLIF(SUM(volume_facture), 0), 1) AS pct_estimation_global,
            CAST(now() AS TIMESTAMP) AS computed_at
        FROM cur;
    """,

    # Heatmap par centre
    "mart_pilotage_par_centre": """
        CREATE OR REPLACE TABLE mart_pilotage_par_centre AS
        SELECT
            centre_code, centre_libelle,
            ANNEE, MOIS, cycle_key,
            COUNT(*)             AS nb_secteurs,
            SUM(parc_cloture)    AS parc_total,
            SUM(saisis_declare)  AS saisis,
            SUM(restant)         AS restant,
            ROUND(100.0 * SUM(saisis_declare) / NULLIF(SUM(parc_cloture), 0), 1) AS pct_avancement,
            COUNT(*) FILTER (WHERE avancement_cat = 'A 0pct')               AS nb_a_0pct,
            COUNT(*) FILTER (WHERE pct_avancement >= 80)                    AS nb_avances,
            COUNT(*) FILTER (WHERE CLOTURE = 1)                             AS nb_clotures,
            COUNT(*) FILTER (WHERE FLAG_VALID = 1)                          AS nb_valides
        FROM v_secteur_cycle
        WHERE cycle_key = (SELECT MAX(cycle_key) FROM v_secteur_cycle)
        GROUP BY centre_code, centre_libelle, ANNEE, MOIS, cycle_key
        ORDER BY pct_avancement ASC;
    """,
}


# ============================================================
# Construction de tous les marts
# ============================================================

def build_all_marts(con) -> None:
    """Construit indexes + vues + marts."""
    logger.info("Construction des marts DuckDB...")

    # 1) Index
    for stmt in DDL_INDEXES.strip().split(";"):
        stmt = stmt.strip()
        if stmt:
            con.execute(stmt)
    logger.info("  ✓ Index garantis")

    # 2) Vues enrichies
    con.execute(VIEW_RELEVE_ENRICHED)
    con.execute(VIEW_SECTEUR_CYCLE)
    logger.info("  ✓ Vues v_releve et v_secteur_cycle créées")

    # 3) Cutoff pour marts S_RELEVE
    row = con.execute(
        f"SELECT MAX(REL_DATE) - INTERVAL {settings.MART_WINDOW_DAYS} DAY FROM raw_releve"
    ).fetchone()
    cutoff = row[0] if row else None

    if cutoff is None:
        logger.warning("raw_releve vide -> marts S_RELEVE construits vides")
        cutoff_sql = "TIMESTAMP '1900-01-01'"
    else:
        cutoff_sql = f"TIMESTAMP '{cutoff}'"
        logger.info(f"  Fenêtre marts S_RELEVE : >= {cutoff}")

    # 4) Marts S_RELEVE
    for name, sql_template in MARTS_RELEVE_SQL.items():
        con.execute(sql_template.format(cutoff=cutoff_sql))
        logger.info(f"  ✓ {name}")

    # 5) Marts CLOTURE
    has_cloture = con.execute("SELECT COUNT(*) FROM raw_cloture_secteur").fetchone()[0]
    if has_cloture == 0:
        logger.warning("raw_cloture_secteur vide -> marts CLOTURE non construits")
    else:
        for name, sql in MARTS_CLOTURE_SQL.items():
            con.execute(sql)
            logger.info(f"  ✓ {name}")


# ============================================================
# Détection alertes franchissement
# ============================================================

def detect_threshold_crossings(con, threshold_pct: int = None) -> int:
    if threshold_pct is None:
        threshold_pct = settings.CLOTURE_ALERT_THRESHOLD_PCT

    new_alerts = con.execute(f"""
        SELECT
            cur.IDCLOTURE,
            cur.STR_ID, cur.SECT_ID,
            cur.ANNEE, cur.MOIS,
            COALESCE(prev.POURCTRAITER, 0) AS pct_avant,
            cur.POURCTRAITER               AS pct_apres
        FROM raw_cloture_secteur cur
        LEFT JOIN cloture_snapshot_prev prev
               ON prev.IDCLOTURE = cur.IDCLOTURE
        WHERE cur.CLOTURE = 0
          AND cur.POURCTRAITER >= {threshold_pct}
          AND COALESCE(prev.POURCTRAITER, 0) < {threshold_pct}
    """).fetchall()

    if not new_alerts:
        logger.info("  Aucun franchissement détecté")
        return 0

    next_id_row = con.execute("SELECT COALESCE(MAX(alert_id), 0) FROM alerts_log").fetchone()
    next_id = (next_id_row[0] or 0) + 1

    for row in new_alerts:
        idcloture, str_id, sect_id, annee, mois, pct_avant, pct_apres = row

        # Vérifier si une alerte non acquittée existe déjà
        existing = con.execute("""
            SELECT COUNT(*) FROM alerts_log
            WHERE STR_ID = ? AND SECT_ID = ?
            AND ANNEE = ? AND MOIS = ?
        """, [str_id, sect_id, annee, mois]).fetchone()[0]

        if existing == 0:
            con.execute("""
                INSERT INTO alerts_log
                    (alert_id, alert_type, STR_ID, SECT_ID, ANNEE, MOIS,
                     pct_avant, pct_apres, detected_at, acknowledged)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), FALSE)
            """, [next_id, f"SEUIL_{threshold_pct}", str_id, sect_id, annee, mois,
                  pct_avant, pct_apres])
            next_id += 1
    logger.info(f"  🚨 {len(new_alerts)} nouvelles alertes franchissement {threshold_pct}%")
    return len(new_alerts)


def refresh_cloture_snapshot(con) -> None:
    con.execute("DELETE FROM cloture_snapshot_prev")
    con.execute("""
        INSERT INTO cloture_snapshot_prev
            (IDCLOTURE, STR_ID, SECT_ID, ANNEE, MOIS, POURCTRAITER, snapshot_at)
        SELECT IDCLOTURE, STR_ID, SECT_ID, ANNEE, MOIS, POURCTRAITER, now()
        FROM raw_cloture_secteur
    """)
    logger.info("  ✓ Snapshot cloture rafraîchi")