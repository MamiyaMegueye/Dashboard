"""
Génère des données factices dans DuckDB pour tester le dashboard
SANS avoir besoin d'accès Oracle (utile pour développement local).

Usage :
    python scripts/seed_demo.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd
from loguru import logger

from src.duckdb_client import duckdb_write
from src.loader import upsert_dataframe
from src.marts import DDL_RAW, build_all_marts


N_RELEVES = 8_000
N_DAYS = 30
RNG = np.random.default_rng(42)

# 24 centres Nouakchott (ZONE_ID=2, hors STR_ID 1,2,63)
CENTRES = [
    (3, "Centre Capitale"), (4, "Tevragh Zeina"), (5, "Ksar"),
    (6, "Sebkha"), (7, "Teyarett"), (8, "El Mina"),
    (9, "Arafat"), (10, "Riyad"), (11, "Toujounine"),
    (12, "Dar Naim"), (13, "Toustar"), (14, "Maghta Lahjar"),
    (15, "Center Comm. 1"), (16, "Center Comm. 2"), (17, "Center Comm. 3"),
]

ETATS = [1, 2, 3, 4, 5, 6]
ETATS_POIDS = [0.85, 0.05, 0.03, 0.02, 0.04, 0.01]  # accessible dominant
COMPTAGE_LIB = {
    1: "Accessible", 2: "Illisible", 3: "Défectueux",
    4: "Bloqué", 5: "Inaccessible", 6: "Volé",
}


def gen_releves() -> pd.DataFrame:
    now = datetime.utcnow()
    dates = [now - timedelta(days=int(d), hours=int(h))
             for d, h in zip(RNG.integers(0, N_DAYS, N_RELEVES),
                             RNG.integers(0, 24, N_RELEVES))]
    str_ids = RNG.choice([c[0] for c in CENTRES], N_RELEVES)
    id_comps = RNG.choice(ETATS, N_RELEVES, p=ETATS_POIDS)

    # conso : log-normale + queue lourde
    consos = RNG.lognormal(mean=2.8, sigma=1.1, size=N_RELEVES)
    consos = np.clip(consos, 0, 600)
    # forcer 5% à 0
    zero_mask = RNG.random(N_RELEVES) < 0.05
    consos[zero_mask] = 0

    # validation : 80% validés, 20% non
    valides = (RNG.random(N_RELEVES) > 0.20).astype(int)

    # un releveur n'a pas d'index si compteur non accessible
    rel_index = np.where(id_comps == 1,
                         RNG.uniform(1000, 50000, N_RELEVES),
                         np.nan)

    matricules = RNG.choice([f"R{1000+i:04d}" for i in range(40)], N_RELEVES)

    df = pd.DataFrame({
        "REL_ID":             pd.array(range(1, N_RELEVES + 1), dtype="Int64"),
        "ABN_ID":             pd.array(RNG.integers(100000, 999999, N_RELEVES), dtype="Int64"),
        "CPT_REF":            pd.array([f"C{x:08d}" for x in RNG.integers(1, 999999, N_RELEVES)], dtype="string"),
        "LOC_ID":             pd.array(RNG.integers(1, 1000, N_RELEVES), dtype="Int64"),
        "TOUR_ID":            pd.array(RNG.integers(1, 50, N_RELEVES), dtype="Int64"),
        "STR_ID":             pd.array(str_ids, dtype="Int64"),
        "SECT_ID":            pd.array(RNG.integers(1, 200, N_RELEVES), dtype="Int64"),
        "MATRICULE":          pd.array(matricules, dtype="string"),
        "REL_DATE":           pd.to_datetime(dates),
        "REL_ANNEE":          pd.array([d.year for d in dates], dtype="Int64"),
        "REL_MOIS":           pd.array([d.month for d in dates], dtype="Int64"),
        "DATE_GEN":           pd.to_datetime(dates),
        "REL_DATE_ANC_INDEX": pd.to_datetime([d - timedelta(days=30) for d in dates]),
        "REL_INDEX":          pd.array(rel_index, dtype="Float64"),
        "REL_ANCIEN_INDEX":   pd.array(rel_index - consos, dtype="Float64"),
        "REL_CONSOM_CALCUL":  pd.array(consos, dtype="Float64"),
        "REL_MOYENNE_CONSOM": pd.array(consos * RNG.uniform(0.8, 1.2, N_RELEVES), dtype="Float64"),
        "REL_NBR_JR":         pd.array([30] * N_RELEVES, dtype="Int64"),
        "ID_COMP":            pd.array(id_comps, dtype="Int64"),
        "TYP_REL_ID":         pd.array([1] * N_RELEVES, dtype="Int64"),
        "REL_VALIDE":         pd.array(valides, dtype="Int64"),
        "REL_ESTIMATIF":      pd.array([0] * N_RELEVES, dtype="Int64"),
        "REL_FACTURABLE_FLAG":pd.array([1] * N_RELEVES, dtype="Int64"),
        "REL_MAT":            pd.array([""] * N_RELEVES, dtype="string"),
        "REL_MESSAGE":        pd.array([""] * N_RELEVES, dtype="string"),
        "REL_ORIGINE":        pd.array(["MOBILE"] * N_RELEVES, dtype="string"),
    })
    return df


def gen_refs() -> dict[str, pd.DataFrame]:
    return {
        "ref_comptage": pd.DataFrame({
            "ID_COMP": pd.array(list(COMPTAGE_LIB.keys()), dtype="Int64"),
            "LIBELLE": pd.array(list(COMPTAGE_LIB.values()), dtype="string"),
        }),
        "ref_centre": pd.DataFrame({
            "CENTRE_ID": pd.array([c[0] for c in CENTRES], dtype="Int64"),
            "CENTRE_LIB": pd.array([c[1] for c in CENTRES], dtype="string"),
        }),
        "ref_secteur": pd.DataFrame({
            "SECT_ID":  pd.array(range(1, 201), dtype="Int64"),
            "SECT_LIB": pd.array([f"Secteur {i:03d}" for i in range(1, 201)], dtype="string"),
            "STR_ID":   pd.array(RNG.choice([c[0] for c in CENTRES], 200), dtype="Int64"),
        }),
        "ref_tarification": pd.DataFrame({
            "TAR_ID":  pd.array([1, 2, 3], dtype="Int64"),
            "TAR_LIB": pd.array(["Domestique", "Commercial", "Administratif"], dtype="string"),
        }),
    }


def main() -> None:
    logger.info(f"Génération de {N_RELEVES:,} relevés factices...")
    df = gen_releves()
    refs = gen_refs()

    with duckdb_write() as con:
        con.execute(DDL_RAW)
        # on vide d'abord pour repartir propre
        for t in ["raw_releve", "ref_comptage", "ref_centre", "ref_secteur", "ref_tarification"]:
            con.execute(f"DELETE FROM {t}")

        upsert_dataframe(con, df, "raw_releve", pk="REL_ID")
        upsert_dataframe(con, refs["ref_comptage"],     "ref_comptage",     pk="ID_COMP")
        upsert_dataframe(con, refs["ref_centre"],       "ref_centre",       pk="CENTRE_ID")
        upsert_dataframe(con, refs["ref_secteur"],      "ref_secteur",      pk="SECT_ID")
        upsert_dataframe(con, refs["ref_tarification"], "ref_tarification", pk="TAR_ID")

        build_all_marts(con)

    logger.success(f"Demo seeded : {N_RELEVES:,} relevés sur {N_DAYS} jours.")


if __name__ == "__main__":
    main()
