# Backend — SNDE Dashboard Relevés

Pipeline ELT **Oracle → DuckDB → Marts → FastAPI** + orchestration Prefect.

## Installation (Windows / Linux)

```bash
cd backend
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1
# Linux / WSL
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # puis éditer les valeurs Oracle
```

## Lancement (3 commandes, 3 terminaux)

### Terminal 1 — Initialiser DuckDB

```bash
# Soit avec données factices (DÉMARRAGE RAPIDE, pas besoin d'Oracle) :
python scripts/seed_demo.py

# Soit en se branchant sur Oracle (premier chargement 90 jours) :
python -m src.pipeline --initial
```

### Terminal 2 — Lancer l'API FastAPI

```bash
uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
```

Accès : <http://localhost:8000/docs>

### Terminal 3 — Orchestrateur Prefect (optionnel pour démarrer)

```bash
# UI Prefect
prefect server start

# Dans un 4ᵉ terminal : déploiement cron */30 min
prefect deploy src/pipeline.py:releve_flow -n releve-30min --cron "*/30 * * * *"
prefect worker start --pool default-agent-pool
```

## Lancement manuel d'un tick incrémental

```bash
python -m src.pipeline
```

## Schéma DuckDB

| Table / Vue                  | Rôle                                                       |
|------------------------------|------------------------------------------------------------|
| `raw_releve`                 | Mirror typé strict de `CRM_SNDE.S_RELEVE`                  |
| `ref_comptage`               | Libellés ID_COMP                                           |
| `ref_centre`                 | Centres Nouakchott                                         |
| `ref_secteur`                | Secteurs                                                   |
| `ref_tarification`           | Tarifs                                                     |
| `v_releve`                   | Vue enrichie (joins + catégories métier)                   |
| `mart_kpi_global`            | KPI cards du haut du dashboard                             |
| `mart_etat_comptage`         | Donut Accessible / Inaccessible / Bloqué …                 |
| `mart_fiabilite`             | Gauge fiabilité du parc                                    |
| `mart_anomalies`             | Anomalies (conso suspecte ET non validé)                   |
| `mart_non_valides`           | Tous les relevés REL_VALIDE = 0                            |
| `mart_hierarchie_centre`     | Agrégat par centre (drill-down)                            |
| `mart_performance_releveur`  | Stats par MATRICULE                                        |
| `mart_evolution_quotidienne` | Volumes par jour                                           |
| `pipeline_runs`              | Journal des runs Prefect                                   |
