# SNDE — Suivi Temps Réel des Relevés Compteurs (Nouakchott)

> **Version 2.0** — Refonte du dashboard avec table `CLOTURE_SECTEUR` pour pilotage temps réel.

Dashboard analytique pour la **Société Nationale de l'Eau (Mauritanie)**, Direction Contrôle & Audit, qui suit en temps quasi-réel l'avancement des saisies de relevés compteurs sur la zone Nouakchott.

---

## 🎯 Objectif métier

Permettre à la Direction et aux chefs de centre de :

1. **Voir l'avancement temps réel** des saisies par secteur (% saisis vs parc total)
2. **Recevoir des alertes automatiques** quand un secteur franchit le seuil 80% (mobilisation adjoint facturation)
3. **Détecter les anomalies de saisie** (consommation nulle/élevée, index décroissant, IP suspecte)
4. **Drill-down du global au compteur individuel** en 3 niveaux : Pilotage → Avancement → Détail

---

## 🏗️ Architecture en 3 niveaux

```
┌─────────────────────────────────────────────────────────────┐
│  NIVEAU 1 — PILOTAGE (vue Nouakchott)                       │
│  Source : CLOTURE_SECTEUR agrégé                            │
│  Question : "Où en est Nouakchott globalement ?"            │
└─────────────────────────────────────────────────────────────┘
                            │ drill-down
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  NIVEAU 2 — AVANCEMENT (par centre → secteur)               │
│  Source : CLOTURE_SECTEUR + agrégats S_RELEVE               │
│  Question : "Quels secteurs sont en retard ?"               │
└─────────────────────────────────────────────────────────────┘
                            │ drill-down
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  NIVEAU 3 — DÉTAIL (par abonné, dans un secteur)            │
│  Source : S_RELEVE filtré sur (STR_ID, SECT_ID, MOIS, ANNEE)│
│  Question : "Qu'est-ce que les releveurs ont saisi ?"       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔌 Stack technique

```
Oracle PROD (CRM_SNDE, SELECT only)
        ↓ extraction Python (oracledb, garde-fous 7 couches)
DuckDB local (cache analytique)
        ↓ FastAPI (REST)
Next.js 15 + Tailwind + React Query (dashboard 4 onglets)
```

| Couche | Tech |
|---|---|
| Source | Oracle `CRM_SNDE` (lecture seule) |
| Extraction | Python 3.11, `oracledb`, pandas, `pydantic-settings` |
| Cache | DuckDB (mode `read_only=True` pour API, write pour pipeline) |
| Orchestration | Prefect 3 |
| Backend API | FastAPI, `loguru` |
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind, React Query, Recharts, Lucide |

---

## 📊 Tables Oracle utilisées (toutes en SELECT seul)

| Table | Usage |
|---|---|
| `S_RELEVE` | Détail relevés compteurs (~11.6M lignes, incrémental sur REL_DATE) |
| `CLOTURE_SECTEUR` | **🆕 Synthèse par secteur × cycle** (PK=IDCLOTURE) — clé du suivi temps réel |
| `S_STRUCTURE` | Centres (filtre ZONE_ID=2 pour Nouakchott) |
| `S_SECTEUR` | Secteurs (libellés) |
| `COMPTAGE` | États compteur (6 catégories) |

### CLOTURE_SECTEUR — la machine à états

| Colonne | Sens |
|---|---|
| `IDCLOTURE` | PK auto |
| `STR_ID`, `SECT_ID` | Centre + secteur |
| `ANNEE`, `MOIS` | Cycle |
| `NBABO` | Parc total abonnés (dénominateur) |
| `NBTRAITER` | Abonnés relevés/saisis (numérateur) |
| `NBNONTRAITER` | Reste à faire |
| `POURCTRAITER` | % avancement (déjà calculé par SNDE) |
| `VOLUMEFACT` / `VOLUMESTIM` | Volume facturé / estimé (qualité du relevé) |
| `CLOTURE` | **0 = en cours · 1 = clôturé** (fenêtre dorée = CLOTURE=0) |
| `FLAG_CALCUL` | 1 = calcul effectué |
| `FLAG_VALID` | 1 = validé par adjoint facturation |
| `MATRICULE` | Agent ayant clôturé |
| `DATE_CLOT` | Date de clôture |

**Phases du cycle** :
| CLOTURE | FLAG_CALCUL | FLAG_VALID | Phase | Action possible |
|---|---|---|---|---|
| 0 | 0/1 | 0 | **En cours** | 🎯 Fenêtre dorée — releveur saisit, tout modifiable |
| 1 | 1 | 0 | À valider | Adjoint facturation contrôle |
| 1 | 1 | 1 | Validé | 🔒 Figé |

---

## 🛡️ Sécurité Oracle — SELECT only strict

Le client `oracle_client.py` a **7 couches de protection** contre toute écriture accidentelle :

1. **Whitelist regex** : la requête doit commencer par `SELECT` ou `WITH`
2. **Blacklist regex** : refus de tout mot-clé d'écriture (INSERT, UPDATE, DELETE, MERGE, DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE, EXEC, CALL, COMMIT, ROLLBACK, SAVEPOINT)
3. **Nettoyage commentaires** avant validation (empêche `-- INSERT` caché)
4. `autocommit = False` (rien ne peut être commité par accident)
5. `rollback()` systématique après chaque requête
6. Timeout configurable
7. Logging audit (durée + nb lignes)

**Aucune requête d'écriture n'atteint Oracle.** Toutes les écritures se font dans DuckDB local.

---

## 📁 Structure du projet

```
snde-suivi-temps-reel/
├── README.md                          (ce fichier)
├── ARCHITECTURE.md                    (détails techniques)
├── .gitignore
│
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── src/
│   │   ├── config.py                  [MODIFIÉ] + settings CLOTURE
│   │   ├── oracle_client.py           [ORIGINAL] SELECT-only 7 couches
│   │   ├── duckdb_client.py           [RECONSTRUIT]
│   │   ├── loader.py                  [RECONSTRUIT] upsert_dataframe
│   │   ├── extractor.py               [MODIFIÉ] + extract_cloture_secteur
│   │   ├── marts.py                   [MODIFIÉ] + marts CLOTURE + alertes
│   │   ├── pipeline.py                [MODIFIÉ] + tasks CLOTURE + alertes
│   │   ├── main.py                    [RECONSTRUIT] FastAPI app
│   │   └── api/routers/
│   │       └── releve.py              [MODIFIÉ] + endpoints suivi
│   └── scripts/
│       ├── test_prod_connection.py    [RECONSTRUIT]
│       └── test_cloture_coherence.py  [NOUVEAU] vérif NBTRAITER vs S_RELEVE
│
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── tailwind.config.ts             palette snde-*
    ├── next.config.js
    ├── postcss.config.js
    ├── .env.local.example
    └── src/
        ├── app/
        │   ├── layout.tsx             [RECONSTRUIT]
        │   ├── providers.tsx          [RECONSTRUIT] React Query
        │   ├── page.tsx               [MODIFIÉ] + onglet Avancement
        │   └── globals.css            [RECONSTRUIT]
        ├── lib/
        │   ├── api.ts                 [MODIFIÉ] + apiCloture
        │   ├── types.ts               [MODIFIÉ] + types CLOTURE
        │   └── format.ts              [RECONSTRUIT] helpers
        └── components/
            ├── Card.tsx                 [ORIGINAL]
            ├── KpiCard.tsx              [ORIGINAL]
            ├── Header.tsx               [ORIGINAL]
            ├── FilterBar.tsx            [ORIGINAL]
            ├── DrillModal.tsx           [ORIGINAL]
            ├── AnomaliesPanel.tsx       [ORIGINAL]
            ├── ConsommationPanel.tsx    [ORIGINAL]
            ├── EtatComptagePanel.tsx    [ORIGINAL]
            ├── EtatCompletPanel.tsx     [ORIGINAL]
            ├── FiabilitePanel.tsx       [ORIGINAL]
            ├── HierarchieCentrePanel.tsx[ORIGINAL]
            ├── PageShared.tsx           [RECONSTRUIT] ExportBtn etc.
            └── AvancementSaisiePanel.tsx[NOUVEAU] 🆕 onglet temps réel
```

**Légende** :
- `[ORIGINAL]` — fichier de Mamiya repris tel quel
- `[MODIFIÉ]` — fichier existant étendu avec les nouveaux endpoints/types
- `[RECONSTRUIT]` — fichier inféré depuis l'usage (à valider/ajuster)
- `[NOUVEAU]` — création pour le suivi temps réel

---

## 🚀 Démarrage

### Backend

```bash
cd backend

# 1. Créer venv + installer
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Configurer .env (copier .env.example et remplir credentials)
cp .env.example .env
# éditer .env avec vos credentials Oracle

# 3. Tester la connexion Oracle (SELECT only)
python -m scripts.test_prod_connection

# 4. Vérifier la cohérence CLOTURE_SECTEUR ↔ S_RELEVE
python -m scripts.test_cloture_coherence

# 5. Premier chargement (30 jours)
python -m src.pipeline --initial

# 6. Lancer l'API
uvicorn src.main:app --reload --port 8000
# Swagger : http://localhost:8000/docs
```

### Frontend

```bash
cd frontend

# 1. Installer
npm install

# 2. Configurer (optionnel)
cp .env.local.example .env.local

# 3. Lancer en dev
npm run dev
# Ouvrir http://localhost:3000
```

### Pipeline en mode incrémental (cron)

```bash
# Tick incrémental toutes les 5 minutes
*/5 * * * * cd /path/to/backend && /path/to/.venv/bin/python -m src.pipeline >> logs/pipeline.log 2>&1
```

---

## 📡 Endpoints API principaux

### Endpoints S_RELEVE (existants — fenêtre 30j)
- `GET /api/releve/kpi` — KPI globaux
- `GET /api/releve/etat-comptage` — répartition 6 états
- `GET /api/releve/fiabilite` — taux fiable / à contrôler
- `GET /api/releve/anomalies` — non validés + conso anormale
- `GET /api/releve/hierarchie-centre` — agrégat par centre
- `GET /api/releve/list` — drill-down détaillé
- `GET /api/releve/etat-complet-list` — table paginée
- `POST /api/releve/reload-period` — rechargement à la demande

### 🆕 Endpoints CLOTURE_SECTEUR (Suivi Temps Réel)
- `GET /api/releve/pilotage-global` — Niveau 1, synthèse Nouakchott cycle courant
- `GET /api/releve/pilotage-par-centre` — heatmap par centre
- `GET /api/releve/avancement-saisie` — Niveau 2, liste secteurs (filtres : str_id, statut, min_pct, max_pct)
- `GET /api/releve/cycles-disponibles` — cycles présents en base
- `GET /api/releve/secteur-detail` — Niveau 3, drill-down complet d'un secteur
- `GET /api/releve/alertes` — feed alertes franchissement 80%
- `POST /api/releve/alertes/acknowledge` — marquer une alerte comme vue

---

## 🚨 Logique des alertes 80%

À chaque tick du pipeline :

```
1. Extract CLOTURE_SECTEUR cycle courant
2. UPSERT dans raw_cloture_secteur
3. Comparer avec cloture_snapshot_prev (état au tick précédent)
4. Pour chaque secteur où POURCTRAITER a franchi 80% à la hausse :
   → INSERT dans alerts_log (alert_type=SEUIL_80, acknowledged=FALSE)
5. Refresh cloture_snapshot_prev avec l'état courant
```

Le frontend récupère les alertes non acquittées via `GET /api/releve/alertes?only_unack=true` toutes les 30s.

---

## ✅ Tests / Validation pré-prod

**Avant de migrer vers la prod**, lancer dans cet ordre :

1. **`test_prod_connection.py`** — vérifie que :
   - La connexion fonctionne
   - Les SELECT/WITH passent
   - Les requêtes d'écriture sont BIEN refusées (test sur INSERT/UPDATE/DELETE/...)
   - Le filtre Nouakchott ramène des données cohérentes

2. **`test_cloture_coherence.py`** — vérifie la fiabilité de `NBTRAITER` :
   - Compare `CLOTURE_SECTEUR.NBTRAITER` vs `COUNT(DISTINCT S_RELEVE.CPT_REF)` pour le cycle courant
   - Détermine si on peut faire confiance à NBTRAITER ou s'il faut recalculer depuis S_RELEVE

---

## 🔄 Workflow contributif

1. Lancer les 2 scripts de test avant de modifier quoi que ce soit
2. Si modification de requête Oracle → tester en DBeaver D'ABORD
3. Toute nouvelle requête Oracle passe **obligatoirement** par `oracle_client.run_query()` (garde-fous)
4. Toute écriture en base passe **uniquement** par DuckDB local
5. Avant déploiement : `npm run build` côté front, `python -m src.pipeline --initial` côté back

---

## ⚙️ Configuration clé (`.env`)

| Variable | Défaut | Sens |
|---|---|---|
| `CLOTURE_NB_CYCLES` | 3 | Cycles glissants chargés en cache |
| `CLOTURE_ALERT_THRESHOLD_PCT` | 80 | Seuil de franchissement → alerte |
| `CLOTURE_THRESHOLD_LOW_PCT` | 50 | Badge "Critique" si en dessous |
| `CLOTURE_THRESHOLD_HIGH_PCT` | 95 | Badge "Presque fini" si au dessus |
| `MART_WINDOW_DAYS` | 30 | Fenêtre des marts S_RELEVE |
| `ZONE_ID` | 2 | 2=Nouakchott |
| `STR_ID_EXCLUDE` | 1,2,63 | Centres admin à exclure |

---

## 📚 Documentation complémentaire

- `ARCHITECTURE.md` — détails techniques (pipeline, marts, schéma DuckDB)
- Swagger interactif : `http://localhost:8000/docs`

---

## 👤 Crédits

**Mamiya Megueye** — Data Scientist, SNDE (Direction Contrôle & Audit)
GitHub : [@MamiyaMegueye](https://github.com/MamiyaMegueye)

**Abdellahi Lemrabett** — Data Scientist, SNDE (Direction Contrôle & Audit)
