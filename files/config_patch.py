# MODIFICATION À APPORTER DANS backend/src/config.py
# =====================================================
# Ajouter ces lignes dans la classe Settings,
# après la section "# Marts / Alertes" existante :

# ============================================================
# Watcher SSE temps réel
# ============================================================
WATCHER_INTERVAL_SEC: int = 10   # fréquence de vérification Oracle (secondes)
