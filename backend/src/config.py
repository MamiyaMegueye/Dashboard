"""
Configuration centralisée du backend SNDE - Dashboard Suivi Temps Réel.

🛡️ Limites de sécurité PROD intégrées pour protéger Oracle.

[v2.2] Seuil d'alerte porté à 90% (au lieu de 80%).
"""
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ============================================================
    # Oracle - Credentials
    # ============================================================
    ORACLE_USER: str
    ORACLE_PASSWORD: str
    ORACLE_HOST: str = "192.168.10.30"
    ORACLE_PORT: int = 1521
    ORACLE_SERVICE: str = "Sigasnde"

    # ============================================================
    # Oracle - Limites de sécurité
    # ============================================================
    ORACLE_QUERY_TIMEOUT_SEC: int = 600
    ORACLE_FETCH_BATCH: int = 10_000
    MAX_ROWS_PER_QUERY: int = 5_000_000

    # ============================================================
    # Filtre métier zone
    # ============================================================
    ZONE_ID: int = 2
    STR_ID_EXCLUDE: str = "1,2,63"

    # ============================================================
    # DuckDB
    # ============================================================
    DUCKDB_PATH: str = "./data/snde.duckdb"

    # ============================================================
    # Pipeline S_RELEVE
    # ============================================================
    INITIAL_LOAD_DAYS: int = 30
    INCREMENTAL_OVERLAP_HOURS: int = 1
    MAX_RELOAD_DAYS: int = 90
    MART_WINDOW_DAYS: int = 30

    # ============================================================
    # Pipeline CLOTURE_SECTEUR (Suivi Temps Réel)
    # ============================================================
    CLOTURE_NB_CYCLES: int = 3

    # 🆕 v2.2 : Seuil principal de franchissement → déclenche une alerte
    # Quand un secteur (avec CLOTURE=0) passe de <90% à ≥90%, le système
    # déclenche une alerte persistante visible sur tous les onglets.
    CLOTURE_ALERT_THRESHOLD_PCT: int = 90

    # Seuils secondaires (badges visuels uniquement, pas d'alerte push)
    CLOTURE_THRESHOLD_LOW_PCT: int = 50      # En dessous : badge rouge
    CLOTURE_THRESHOLD_HIGH_PCT: int = 95     # Au dessus : badge vert "presque fini"

    CLOTURE_DORMANT_DAYS: int = 5
    WATCHER_INTERVAL_SEC: int = 10

    # ============================================================
    # API
    # ============================================================
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    LOG_LEVEL: str = "INFO"

    # ============================================================
    # Propriétés dérivées
    # ============================================================
    @property
    def oracle_dsn(self) -> str:
        return f"{self.ORACLE_HOST}:{self.ORACLE_PORT}/{self.ORACLE_SERVICE}"

    @property
    def str_id_exclude_list(self) -> List[int]:
        return [int(x) for x in self.STR_ID_EXCLUDE.split(",") if x.strip()]

    @property
    def allowed_origins_list(self) -> List[str]:
        return [x.strip() for x in self.ALLOWED_ORIGINS.split(",") if x.strip()]

    @property
    def duckdb_path_abs(self) -> Path:
        p = Path(self.DUCKDB_PATH)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p.resolve()


settings = Settings()
