"""
backend/src/watcher.py

Watcher temps réel SNDE — surveille Oracle CLOTURE_SECTEUR toutes les 10 sec.
Détecte les franchissements ≥ 90% et publie via SSE.

Lancement (depuis backend/) :
    python -m src.watcher

Architecture :
    Oracle CLOTURE_SECTEUR
        → watcher (10 sec)
        → detect_threshold_crossings() → alerts_log DuckDB
        → broadcast SSE → tous les navigateurs connectés
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import AsyncIterator

import duckdb
from loguru import logger

from src.config import settings
from src.extractor import extract_cloture_secteur
from src.marts import (
    detect_threshold_crossings,
    refresh_cloture_snapshot,
    build_all_marts,
)

# ============================================================
# Gestionnaire de connexions SSE
# ============================================================

class SSEManager:
    """Gère toutes les connexions SSE actives."""

    def __init__(self) -> None:
        self._queues: list[asyncio.Queue] = []

    def connect(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._queues.append(q)
        logger.info(f"SSE: nouveau client ({len(self._queues)} connecté(s))")
        return q

    def disconnect(self, q: asyncio.Queue) -> None:
        self._queues.remove(q)
        logger.info(f"SSE: client déconnecté ({len(self._queues)} restant(s))")

    async def broadcast(self, event: str, data: dict) -> None:
        """Pousse un événement SSE à tous les clients connectés."""
        payload = json.dumps(data, ensure_ascii=False, default=str)
        msg = f"event: {event}\ndata: {payload}\n\n"
        for q in list(self._queues):
            await q.put(msg)
        logger.info(f"SSE broadcast '{event}' → {len(self._queues)} client(s)")

    async def stream(self, q: asyncio.Queue) -> AsyncIterator[str]:
        """Générateur async — itère les messages pour un client."""
        yield "event: connected\ndata: {\"status\": \"ok\"}\n\n"
        try:
            while True:
                msg = await q.get()
                yield msg
        except asyncio.CancelledError:
            pass


# Instance globale partagée entre le watcher et le router SSE
sse_manager = SSEManager()


# ============================================================
# Boucle principale du watcher
# ============================================================

async def _watcher_loop() -> None:
    """
    Boucle infinie :
      1. Extrait CLOTURE_SECTEUR depuis Oracle
      2. Met à jour raw_cloture_secteur dans DuckDB
      3. Détecte les franchissements >= CLOTURE_ALERT_THRESHOLD_PCT
      4. Broadcast SSE si nouvelles alertes
      5. Attend WATCHER_INTERVAL_SEC secondes
    """
    interval = settings.WATCHER_INTERVAL_SEC
    threshold = settings.CLOTURE_ALERT_THRESHOLD_PCT

    logger.info(
        f"Watcher démarré — Oracle toutes les {interval}s "
        f"· seuil {threshold}% · DuckDB {settings.duckdb_path_abs}"
    )

    while True:
        try:
            t0 = asyncio.get_event_loop().time()

            # 1. Extraction Oracle → DataFrame
            logger.debug("Watcher: extraction Oracle CLOTURE_SECTEUR …")
            df = await asyncio.to_thread(extract_cloture_secteur)

            if df.empty:
                logger.warning("Watcher: DataFrame Oracle vide — skip")
            else:
                # 2. Mise à jour DuckDB
                con = duckdb.connect(str(settings.duckdb_path_abs))
                try:
                    # Upsert propre sur la clé IDCLOTURE
                    con.execute("""
                        INSERT OR REPLACE INTO raw_cloture_secteur
                        SELECT * FROM df
                    """)

                    # 3. Reconstruire les marts cloture
                    await asyncio.to_thread(build_all_marts, con)

                    # 4. Détecter les franchissements
                    nb_new = await asyncio.to_thread(
                        detect_threshold_crossings, con, threshold
                    )

                    if nb_new > 0:
                        # 5. Récupérer les nouvelles alertes et broadcaster
                        new_alerts = con.execute("""
                            SELECT
                                a.alert_id,
                                a.alert_type,
                                a.STR_ID,
                                a.SECT_ID,
                                a.ANNEE,
                                a.MOIS,
                                a.pct_avant,
                                a.pct_apres,
                                a.detected_at,
                                rs.SECT_LIB   AS SECT_LIB,
                                rc.CENTRE_LIB AS CENTRE_LIB
                            FROM alerts_log a
                            LEFT JOIN ref_secteur rs ON rs.SECT_ID = a.SECT_ID
                            LEFT JOIN ref_centre  rc ON rc.CENTRE_ID = a.STR_ID
                            WHERE a.acknowledged = FALSE
                            ORDER BY a.detected_at DESC
                            LIMIT ?
                        """, [nb_new]).fetchdf()

                        for _, row in new_alerts.iterrows():
                            await sse_manager.broadcast("nouvelle_alerte", {
                                "alert_id"   : int(row.alert_id),
                                "alert_type" : row.alert_type,
                                "STR_ID"     : int(row.STR_ID),
                                "SECT_ID"    : int(row.SECT_ID),
                                "ANNEE"      : int(row.ANNEE),
                                "MOIS"       : int(row.MOIS),
                                "pct_avant"  : float(row.pct_avant),
                                "pct_apres"  : float(row.pct_apres),
                                "detected_at": str(row.detected_at),
                                "SECT_LIB"   : row.SECT_LIB,
                                "CENTRE_LIB" : row.CENTRE_LIB,
                            })

                    # 6. Rafraîchir le snapshot pour le prochain cycle
                    await asyncio.to_thread(refresh_cloture_snapshot, con)

                finally:
                    con.close()

            elapsed = asyncio.get_event_loop().time() - t0
            wait = max(0, interval - elapsed)
            logger.debug(f"Watcher: cycle terminé en {elapsed:.1f}s — attente {wait:.1f}s")
            await asyncio.sleep(wait)

        except Exception as exc:
            logger.error(f"Watcher: erreur — {exc}")
            await asyncio.sleep(interval)


async def start_watcher() -> None:
    """Point d'entrée async pour lancer le watcher en tâche de fond."""
    asyncio.create_task(_watcher_loop())
    logger.info("Watcher SSE lancé en tâche de fond")


# ============================================================
# Lancement standalone : python -m src.watcher
# ============================================================

if __name__ == "__main__":
    asyncio.run(_watcher_loop())