"""
Script de test : vérifie la cohérence entre CLOTURE_SECTEUR.NBTRAITER
et le COUNT(DISTINCT CPT_REF) réel dans S_RELEVE.

🛡️ SELECT pur uniquement. Aucune écriture.

Usage :
    python -m scripts.test_cloture_coherence
"""

from __future__ import annotations

import sys

from loguru import logger
import pandas as pd

from src.config import settings
from src.oracle_client import run_query


def test_coherence_current_cycle():
    """
    Compare NBTRAITER (CLOTURE_SECTEUR) vs COUNT(DISTINCT CPT_REF) (S_RELEVE)
    sur le cycle le plus récent pour la zone Nouakchott.
    """
    exclude_ids = ", ".join(str(x) for x in settings.str_id_exclude_list)
    exclude_clause = f"AND cs.STR_ID NOT IN ({exclude_ids})" if exclude_ids else ""

    sql = f"""
        SELECT
            cs.STR_ID,
            cs.SECT_ID,
            cs.ANNEE,
            cs.MOIS,
            cs.NBABO                                  AS parc,
            cs.NBTRAITER                              AS nbtraiter_declare,
            (SELECT COUNT(DISTINCT r.CPT_REF)
               FROM CRM_SNDE.S_RELEVE r
              WHERE r.STR_ID    = cs.STR_ID
                AND r.SECT_ID   = cs.SECT_ID
                AND r.REL_MOIS  = cs.MOIS
                AND r.REL_ANNEE = cs.ANNEE)           AS nb_releve_reel,
            cs.POURCTRAITER                           AS pct,
            cs.CLOTURE,
            cs.FLAG_CALCUL,
            cs.FLAG_VALID
        FROM CRM_SNDE.CLOTURE_SECTEUR cs
        JOIN CRM_SNDE.S_STRUCTURE s ON s.STR_ID = cs.STR_ID
        WHERE s.ZONE_ID = :zone_id
          {exclude_clause}
          AND (cs.ANNEE * 100 + cs.MOIS) = (
              SELECT MAX(ANNEE * 100 + MOIS) FROM CRM_SNDE.CLOTURE_SECTEUR
          )
        ORDER BY cs.STR_ID, cs.SECT_ID
    """

    df = run_query(sql, {"zone_id": settings.ZONE_ID})

    # Calcul de l'écart
    df["ECART"] = df["NBTRAITER_DECLARE"] - df["NB_RELEVE_REEL"]

    logger.info(f"\n{'='*70}")
    logger.info("Test de cohérence CLOTURE_SECTEUR ↔ S_RELEVE")
    logger.info(f"{'='*70}")
    logger.info(f"Cycle analysé : {df['ANNEE'].iloc[0]}-{df['MOIS'].iloc[0]:02d}")
    logger.info(f"Secteurs Nouakchott : {len(df)}")
    logger.info(f"\nStatistiques de l'écart NBTRAITER - COUNT(S_RELEVE) :")
    logger.info(f"  Nombre avec écart = 0   : {(df['ECART'] == 0).sum()}")
    logger.info(f"  Nombre avec écart > 0   : {(df['ECART'] > 0).sum()}")
    logger.info(f"  Nombre avec écart < 0   : {(df['ECART'] < 0).sum()}")
    logger.info(f"  Nombre NBTRAITER NULL   : {df['NBTRAITER_DECLARE'].isna().sum()}")
    logger.info(f"  Écart max absolu        : {df['ECART'].abs().max()}")
    logger.info(f"  Écart moyen             : {df['ECART'].mean():.1f}")

    # Affichage des 10 plus gros écarts
    logger.info(f"\n10 plus gros écarts :")
    top_ecarts = df.reindex(df["ECART"].abs().sort_values(ascending=False).index).head(10)
    print(top_ecarts.to_string(index=False))

    # Recommandation
    pct_zero_ecart = (df["ECART"] == 0).sum() / len(df) * 100 if len(df) else 0
    logger.info(f"\n{'='*70}")
    if pct_zero_ecart >= 95:
        logger.success(f"✅ {pct_zero_ecart:.1f}% des secteurs ont écart=0")
        logger.success("   → NBTRAITER est fiable, on peut s'y fier directement")
    elif pct_zero_ecart >= 70:
        logger.warning(f"⚠️  {pct_zero_ecart:.1f}% des secteurs ont écart=0")
        logger.warning("   → NBTRAITER est globalement fiable, mais surveiller les écarts")
    else:
        logger.error(f"❌ Seuls {pct_zero_ecart:.1f}% des secteurs ont écart=0")
        logger.error("   → NBTRAITER pas fiable, utiliser COUNT(S_RELEVE) comme source")
    logger.info(f"{'='*70}\n")

    return df


if __name__ == "__main__":
    logger.remove()
    logger.add(sys.stderr, level="INFO")
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", 200)

    test_coherence_current_cycle()
