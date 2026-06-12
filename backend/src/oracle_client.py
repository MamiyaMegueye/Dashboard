"""
Client Oracle SNDE - LECTURE SEULE — Version durcie pour PROD.

🛡️ 7 couches de protection :
  1. Whitelist : seuls SELECT et WITH sont acceptés (regex)
  2. Blacklist : mots-clés dangereux refusés (INSERT, UPDATE, DELETE, ...)
  3. autocommit = False (aucune écriture accidentelle ne sera commitée)
  4. rollback() systématique après chaque requête (paranoia)
  5. arraysize = 10000 (performance)
  6. Timeout configurable (évite les requêtes infinies)
  7. Logging détaillé : durée + nombre de lignes pour audit
"""

from __future__ import annotations

import re
import time
from contextlib import contextmanager
from typing import Iterator

import oracledb
import pandas as pd
from loguru import logger

from src.config import settings


# ============================================================
# Sécurité — Validation des requêtes
# ============================================================

# Whitelist : la requête DOIT commencer par SELECT ou WITH
_SAFE_QUERY_RE = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)

# Blacklist : aucun de ces mots-clés ne doit apparaître dans la requête.
# Le \b assure qu'on matche le mot entier (pas "INSERTION" qui contiendrait "INSERT").
_DANGEROUS_KEYWORDS_RE = re.compile(
    r"\b("
    r"INSERT|UPDATE|DELETE|MERGE|"
    r"DROP|TRUNCATE|ALTER|CREATE|RENAME|"
    r"GRANT|REVOKE|"
    r"EXEC|EXECUTE|CALL|"
    r"COMMIT|ROLLBACK|SAVEPOINT"
    r")\b",
    re.IGNORECASE,
)


class ReadOnlyViolation(RuntimeError):
    """Levée quand une requête tente de modifier la base."""
    pass


def _strip_sql_comments(sql: str) -> str:
    """
    Supprime les commentaires SQL avant validation pour éviter
    qu'un attaquant cache un INSERT dans /* ... */ ou -- ...
    """
    # Supprime les commentaires multi-lignes /* ... */
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    # Supprime les commentaires de fin de ligne -- ...
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


def _assert_read_only(sql: str) -> None:
    """
    Triple validation :
      1. Refus si vide
      2. Refus si ne commence pas par SELECT/WITH (après nettoyage commentaires)
      3. Refus si contient un mot-clé d'écriture
    """
    if not sql or not sql.strip():
        raise ReadOnlyViolation("Requête vide refusée.")

    sql_clean = _strip_sql_comments(sql).strip()

    # Whitelist : doit commencer par SELECT/WITH
    if not _SAFE_QUERY_RE.match(sql_clean):
        raise ReadOnlyViolation(
            f"❌ Seules les requêtes SELECT / WITH sont autorisées vers Oracle. "
            f"Reçu : {sql_clean[:120]}..."
        )

    # Blacklist : aucun mot-clé d'écriture
    match = _DANGEROUS_KEYWORDS_RE.search(sql_clean)
    if match:
        raise ReadOnlyViolation(
            f"❌ Mot-clé d'écriture détecté : '{match.group(1).upper()}'. "
            f"Requête refusée par sécurité."
        )


# ============================================================
# Connexion Oracle
# ============================================================

@contextmanager
def oracle_connection() -> Iterator[oracledb.Connection]:
    """
    Context manager pour ouvrir/fermer proprement une connexion Oracle.
    Configurée en read-only paranoid :
      - autocommit OFF (aucune écriture ne sera persistée par accident)
      - call_timeout (timeout requête depuis settings)
    """
    logger.debug(f"Connexion Oracle vers {settings.oracle_dsn}")
    conn = oracledb.connect(
        user=settings.ORACLE_USER,
        password=settings.ORACLE_PASSWORD,
        dsn=settings.oracle_dsn,
    )

    # 🛡️ Aucune écriture ne sera commitée automatiquement
    conn.autocommit = False

    # 🛡️ Timeout côté driver (en millisecondes)
    try:
        conn.call_timeout = settings.ORACLE_QUERY_TIMEOUT_SEC * 1000
    except AttributeError:
        # Anciennes versions d'oracledb : pas grave
        logger.debug("call_timeout non supporté par cette version d'oracledb")

    try:
        yield conn
    finally:
        # 🛡️ Rollback explicite au cas où — paranoia ultime
        try:
            conn.rollback()
        except Exception:
            pass
        conn.close()
        logger.debug("Connexion Oracle fermée")


# ============================================================
# Exécution requêtes
# ============================================================

def run_query(sql: str, params: dict | None = None) -> pd.DataFrame:
    """
    Exécute une requête SELECT/WITH et renvoie un DataFrame.
    Logs : durée + nombre de lignes pour audit prod.
    """
    _assert_read_only(sql)

    t0 = time.perf_counter()
    with oracle_connection() as conn:
        with conn.cursor() as cur:
            # 🚀 Lecture par gros paquets (perf)
            cur.arraysize = settings.ORACLE_FETCH_BATCH
            cur.prefetchrows = settings.ORACLE_FETCH_BATCH + 1

            cur.execute(sql, params or {})
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()

        # 🛡️ Rollback explicite (encore une fois, paranoia)
        conn.rollback()

    df = pd.DataFrame(rows, columns=cols)
    duration = time.perf_counter() - t0

    # Log audit : durée + volume
    logger.info(
        f"Oracle query OK | {duration:.2f}s | {len(df):,} lignes | "
        f"SQL[:80]={_strip_sql_comments(sql)[:80].replace(chr(10), ' ')}..."
    )

    # Alerte si volume anormalement gros
    if len(df) > settings.MAX_ROWS_PER_QUERY:
        logger.warning(
            f"⚠️ Volume élevé : {len(df):,} lignes "
            f"(seuil : {settings.MAX_ROWS_PER_QUERY:,}). "
            f"Vérifier la requête."
        )

    return df


def run_query_iter(
    sql: str,
    params: dict | None = None,
    chunksize: int = 50_000,
) -> pd.DataFrame:
    """
    Variante streaming pour très gros volumes (>500k lignes).
    Lecture par chunks pour éviter de saturer la RAM.
    """
    _assert_read_only(sql)

    t0 = time.perf_counter()
    chunks: list[pd.DataFrame] = []
    cols: list[str] = []
    total = 0

    with oracle_connection() as conn:
        with conn.cursor() as cur:
            cur.arraysize = chunksize
            cur.prefetchrows = chunksize + 1

            cur.execute(sql, params or {})
            cols = [d[0] for d in cur.description]

            while True:
                rows = cur.fetchmany(chunksize)
                if not rows:
                    break
                chunks.append(pd.DataFrame(rows, columns=cols))
                total += len(rows)
                logger.debug(f"  ... {total:,} lignes lues")

        conn.rollback()

    duration = time.perf_counter() - t0
    df = pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame(columns=cols)
    logger.info(
        f"Oracle query (stream) OK | {duration:.2f}s | "
        f"{len(df):,} lignes en {len(chunks)} chunks"
    )
    return df