"""
Chargement DataFrame -> DuckDB avec UPSERT idempotent.

[RECONSTRUIT] : inféré depuis pipeline.py qui appelle
                upsert_dataframe(con, df, "table", pk="COL")
"""

from __future__ import annotations

from typing import Optional

import duckdb
import pandas as pd
from loguru import logger


def upsert_dataframe(
    con: duckdb.DuckDBPyConnection,
    df: Optional[pd.DataFrame],
    table: str,
    pk: str,
) -> int:
    """
    UPSERT idempotent d'un DataFrame dans une table DuckDB.

    Stratégie : DELETE des PK présents dans df, puis INSERT.
    Idempotent : on peut le rejouer sans créer de doublons.

    Args:
        con: connexion DuckDB en écriture
        df: DataFrame à charger (peut être vide ou None -> no-op)
        table: nom de la table cible (doit exister)
        pk: nom de la colonne PK pour le DELETE

    Returns:
        Nombre de lignes insérées.
    """
    if df is None or df.empty:
        logger.debug(f"  {table} : df vide, skip")
        return 0

    if pk not in df.columns:
        raise ValueError(f"PK '{pk}' absente du DataFrame pour la table {table}")

    # 1. Enregistrer le DataFrame comme vue temporaire DuckDB
    con.register("_df_tmp", df)

    # 2. DELETE des PK qui vont être réinsérés
    con.execute(f"""
        DELETE FROM {table}
        WHERE {pk} IN (SELECT {pk} FROM _df_tmp)
    """)

    # 3. INSERT depuis la vue temporaire
    # On filtre les colonnes qui existent dans la table cible pour éviter les erreurs
    cols_table = [
        r[0] for r in con.execute(f"DESCRIBE {table}").fetchall()
    ]
    cols_common = [c for c in df.columns if c in cols_table]
    cols_sql = ", ".join(cols_common)

    n = con.execute(f"""
        INSERT INTO {table} ({cols_sql})
        SELECT {cols_sql} FROM _df_tmp
    """).fetchall()

    con.unregister("_df_tmp")

    logger.info(f"  {table:25s} : {len(df):>7,} lignes upsertées (PK={pk})")
    return len(df)
