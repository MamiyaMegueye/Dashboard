"""
Diagnostic Oracle - à lancer AVANT le premier pipeline.
Vérifie la connexion, compte les lignes, montre les schémas.

Usage:
    python scripts/check_oracle.py
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import settings
from src.oracle_client import run_query

print(f"\n=== Connexion à {settings.oracle_dsn} ===")
print(f"User : {settings.ORACLE_USER}")

# Test 1 : ping
df = run_query("SELECT SYSDATE AS NOW_ORA, USER AS WHOAMI FROM DUAL")
print(f"\n[OK] Connexion réussie : {df.to_dict('records')[0]}")

# Test 2 : compter les relevés Nouakchott sur 90 jours
sql = """
    SELECT COUNT(*) AS NB
    FROM CRM_SNDE.S_RELEVE
    WHERE STR_ID NOT IN (1, 2, 63)
      AND REL_DATE >= SYSDATE - 90
"""
try:
    df = run_query(sql)
    print(f"\n[INFO] Relevés Nouakchott (sans ZONE_ID) sur 90j : {df.iloc[0]['NB']:,}")
except Exception as e:
    print(f"\n[KO] Erreur sans ZONE_ID : {e}")

# Test 3 : avec ZONE_ID
try:
    sql = """
        SELECT COUNT(*) AS NB
        FROM CRM_SNDE.S_RELEVE
        WHERE ZONE_ID = 2
          AND STR_ID NOT IN (1, 2, 63)
          AND REL_DATE >= SYSDATE - 90
    """
    df = run_query(sql)
    print(f"[INFO] Avec ZONE_ID = 2 : {df.iloc[0]['NB']:,}")
except Exception as e:
    print(f"[KO] ZONE_ID n'existe probablement pas : {e}")

# Test 4 : montrer la structure de chaque table de référence
for tbl in ["COMPTAGE", "CENTRE_PORTAIL", "S_SECTEUR", "TARIFICATION"]:
    print(f"\n=== Colonnes de {tbl} ===")
    try:
        df = run_query(f"""
            SELECT COLUMN_NAME, DATA_TYPE
            FROM ALL_TAB_COLUMNS
            WHERE OWNER = 'CRM_SNDE' AND TABLE_NAME = '{tbl}'
            ORDER BY COLUMN_ID
        """)
        print(df.to_string(index=False))
    except Exception as e:
        print(f"[KO] {e}")