"""
Test de connexion Oracle PROD — validation des garde-fous SELECT-only.

🛡️ Ce script vérifie que :
  1. La connexion fonctionne
  2. Les SELECT/WITH passent
  3. Les requêtes d'écriture sont BIEN refusées
  4. Le filtre Nouakchott ramène des données cohérentes

Usage :
    python -m scripts.test_prod_connection
"""

from __future__ import annotations

import sys

from loguru import logger

from src.config import settings
from src.oracle_client import run_query, ReadOnlyViolation


def test_connection_ok():
    logger.info("Test 1 : connexion + SELECT basique...")
    df = run_query("SELECT 1 AS ok FROM DUAL")
    assert len(df) == 1 and df["OK"].iloc[0] == 1
    logger.success("  ✓ Connexion OK")


def test_write_queries_rejected():
    logger.info("Test 2 : les requêtes d'écriture doivent être refusées...")
    bad_queries = [
        "INSERT INTO foo VALUES (1)",
        "UPDATE foo SET x = 1",
        "DELETE FROM foo",
        "DROP TABLE foo",
        "TRUNCATE TABLE foo",
        "ALTER TABLE foo ADD col x",
        "CREATE TABLE foo (a int)",
        "GRANT SELECT TO foo",
        "EXEC bar",
        "CALL bar()",
        "-- harmless\nUPDATE foo SET x = 1",
        "/* harmless */ DELETE FROM foo",
    ]
    for q in bad_queries:
        try:
            run_query(q)
            logger.error(f"  ❌ Requête acceptée à tort : {q[:50]}")
            sys.exit(1)
        except ReadOnlyViolation:
            logger.success(f"  ✓ Refusée : {q[:50]}")


def test_nouakchott_volume():
    logger.info("Test 3 : volume parc Nouakchott (S_STRUCTURE)...")
    df = run_query("""
        SELECT COUNT(*) AS nb_centres
        FROM CRM_SNDE.S_STRUCTURE
        WHERE ZONE_ID = :zone_id
    """, {"zone_id": settings.ZONE_ID})
    n = df["NB_CENTRES"].iloc[0]
    logger.info(f"  -> {n} centres Nouakchott")
    assert n > 0


def test_cloture_secteur_accessible():
    logger.info("Test 4 : table CLOTURE_SECTEUR accessible...")
    df = run_query("""
        SELECT COUNT(*) AS nb FROM CRM_SNDE.CLOTURE_SECTEUR
    """)
    n = df["NB"].iloc[0]
    logger.info(f"  -> {n} lignes dans CLOTURE_SECTEUR")
    assert n > 0


if __name__ == "__main__":
    logger.remove()
    logger.add(sys.stderr, level="INFO")

    logger.info(f"🔌 Cible : {settings.oracle_dsn} (user {settings.ORACLE_USER})")

    test_connection_ok()
    test_write_queries_rejected()
    test_nouakchott_volume()
    test_cloture_secteur_accessible()

    logger.success("\n✅ Tous les tests passent — base prête pour le pipeline")
