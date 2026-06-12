# Architecture technique — SNDE Suivi Temps Réel

Document de référence pour comprendre les flux, schémas et décisions techniques.

---

## 1. Flux de données

```
┌──────────────────────────────────────────────────────────────────┐
│ ORACLE (CRM_SNDE)                                                 │
│ - S_RELEVE        (11.6M lignes, incrémental sur REL_DATE)        │
│ - CLOTURE_SECTEUR (~200 lignes / cycle, MAJ ~temps réel SNDE)     │
│ - S_STRUCTURE, S_SECTEUR, COMPTAGE (référentiels)                 │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ SELECT-only (7 garde-fous)
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ EXTRACTOR (Python)                                                │
│ extract_releve(since)              → S_RELEVE filtré Nouakchott   │
│ extract_cloture_secteur(nb_cycles) → CLOTURE_SECTEUR 3 cycles     │
│ extract_reference_tables()         → centres, secteurs, comptage  │
│ Pattern "clean at the border" : typage Int64/Float64/datetime/str │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ DUCKDB LOCAL (./data/snde.duckdb)                                 │
│                                                                    │
│ Tables raw :                                                       │
│ - raw_releve              (PK = REL_ID)                            │
│ - raw_cloture_secteur     (PK = IDCLOTURE)  🆕                     │
│ - cloture_snapshot_prev   (état précédent pour diff)  🆕           │
│                                                                    │
│ Tables ref : ref_centre, ref_secteur, ref_comptage                 │
│                                                                    │
│ Vues enrichies :                                                   │
│ - v_releve   (+ ETAT_COMPTAGE, CONSO_CAT calculés)                 │
│ - v_cloture  (+ STATUT, AVANCEMENT_CAT, PCT_ESTIMATION) 🆕         │
│                                                                    │
│ Marts S_RELEVE (fenêtre 30j) :                                     │
│ - mart_kpi_global, mart_etat_comptage, mart_fiabilite             │
│ - mart_anomalies, mart_non_valides                                 │
│ - mart_hierarchie_centre, mart_performance_releveur                │
│ - mart_evolution_quotidienne                                       │
│                                                                    │
│ Marts CLOTURE (cycle courant) : 🆕                                 │
│ - mart_pilotage_global     (1 ligne, synthèse Nouakchott)          │
│ - mart_pilotage_par_centre (1 ligne par centre)                    │
│ - mart_avancement_secteur  (1 ligne par secteur enrichi S_RELEVE)  │
│                                                                    │
│ Logs : pipeline_runs, alerts_log 🆕                                │
└──────────────────────────────────────────────────────────────────┘
                            │
                            │ read_only=True (concurrence safe)
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ FASTAPI                                                            │
│ Lit DuckDB en mode read_only, sérialise via pandas.to_json()      │
│ (JSON-safe, gère NaN/NaT/Decimal/np.int64).                        │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ NEXT.JS (React Query)                                              │
│ Polling auto 60s sur les endpoints, optimistic UI                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Stratégie de cycle (CLOTURE_SECTEUR)

**Question** : faut-il charger 1 cycle ou plusieurs ?

**Choix retenu** : **3 cycles glissants** (`CLOTURE_NB_CYCLES = 3`)

**Raisons** :
1. Cycle courant : pilotage temps réel
2. Cycle N-1 : peut encore être en validation (état "À valider")
3. Cycle N-2 : référence historique pour comparer le rythme

**Identification du cycle** : `(ANNEE * 100 + MOIS)` donne une clé entière ordonnable. Ex : juin 2026 → `202606`.

Le filtre côté Oracle :
```sql
AND (ANNEE * 100 + MOIS) >= (SELECT MAX(ANNEE*100+MOIS) - 2 FROM CLOTURE_SECTEUR)
```

---

## 3. Jointure CLOTURE ↔ S_RELEVE

La clé logique est `(STR_ID, SECT_ID, MOIS, ANNEE)`.

**Cardinalité** : 1 ligne CLOTURE_SECTEUR ↔ N lignes S_RELEVE (1 par compteur)

**Application dans `mart_avancement_secteur`** :

```sql
WITH releve_stats AS (
    SELECT STR_ID, SECT_ID, REL_ANNEE AS ANNEE, REL_MOIS AS MOIS,
           COUNT(DISTINCT CPT_REF)                   AS nb_releve_reel,
           COUNT(*) FILTER (WHERE REL_ESTIMATIF=1)   AS nb_estimes,
           ...
    FROM v_releve
    GROUP BY STR_ID, SECT_ID, REL_ANNEE, REL_MOIS
)
SELECT cs.*, rs.nb_releve_reel, rs.nb_estimes, ...,
       (cs.NBTRAITER - COALESCE(rs.nb_releve_reel, 0)) AS ecart_nbtraiter
FROM v_cloture cs
LEFT JOIN releve_stats rs
       ON rs.STR_ID = cs.STR_ID
      AND rs.SECT_ID = cs.SECT_ID
      AND rs.ANNEE = cs.ANNEE
      AND rs.MOIS = cs.MOIS
```

La colonne `ecart_nbtraiter` permet de **surveiller en continu la cohérence** entre les deux sources.

---

## 4. Logique d'alerte franchissement 80%

```
┌─────────────────────────────────────────────────────────────────┐
│ À chaque tick du pipeline :                                      │
│                                                                   │
│ 1. raw_cloture_secteur (état T)                                  │
│ 2. cloture_snapshot_prev (état T-1)                              │
│                                                                   │
│ 3. JOIN sur IDCLOTURE :                                          │
│    SELECT WHERE cur.POURCTRAITER >= 80                           │
│      AND COALESCE(prev.POURCTRAITER, 0) < 80                     │
│    → secteurs qui viennent de franchir le seuil                  │
│                                                                   │
│ 4. INSERT chaque franchissement dans alerts_log                  │
│    (acknowledged=FALSE)                                          │
│                                                                   │
│ 5. UPDATE cloture_snapshot_prev := état T                        │
└─────────────────────────────────────────────────────────────────┘
```

**Pourquoi `COALESCE(prev, 0)` ?** Pour gérer le premier passage : si le secteur n'existe pas encore dans `cloture_snapshot_prev`, on considère qu'il était à 0%.

**Idempotence** : si on relance le pipeline immédiatement, aucun nouveau franchissement n'est détecté car `prev = cur`.

---

## 5. Pattern "Clean at the Border"

**Principe** : typage strict au moment où la donnée entre dans Python, jamais plus tard.

```python
RELEVE_SCHEMA: dict[str, str] = {
    "REL_ID":            "Int64",      # pandas nullable int
    "REL_DATE":          "datetime",
    "REL_CONSOM_CALCUL": "Float64",    # pandas nullable float
    "MATRICULE":         "string",     # pas object
    ...
}
```

Le `_cast_dataframe()` applique ce mapping. Ainsi :
- Pas de surprise `float` à l'insertion DuckDB
- Pas d'erreur Pydantic `float object cannot be interpreted as integer`
- `NaN` et `NaT` propres

---

## 6. Sécurité Oracle : les 7 couches

| # | Couche | Implémentation |
|---|---|---|
| 1 | Whitelist | `_SAFE_QUERY_RE = re.compile(r"^\s*(SELECT|WITH)\b", IGNORECASE)` |
| 2 | Blacklist | regex sur mots-clés écriture (INSERT, UPDATE, DELETE, MERGE, DROP, …) |
| 3 | Nettoyage commentaires | `_strip_sql_comments()` avant validation |
| 4 | `autocommit = False` | sur la connexion |
| 5 | `rollback()` systématique | dans le `finally` du context manager |
| 6 | Timeout driver | `conn.call_timeout = ORACLE_QUERY_TIMEOUT_SEC * 1000` |
| 7 | Logging audit | durée + nb lignes loggés à chaque requête |

**Aucune requête `INSERT`/`UPDATE`/`DELETE`/`DROP`/... ne peut atteindre Oracle**, même en cas de bug applicatif.

---

## 7. Modèle d'exposition API

Endpoint type :
```python
@router.get("/avancement-saisie")
def get_avancement_saisie(
    str_id: int | None = Query(None),
    statut: str | None = Query(None),
    min_pct: int | None = Query(None, ge=0, le=100),
    ...
) -> list[dict]:
    parts: list[str] = []
    params: list = []
    # construction du WHERE dynamique
    ...
    return _fetch_all(sql, params)
```

Le helper `_fetch_all` passe par `pandas.to_json(orient="records", default_handler=str)` puis `json.loads()`. Garantit que :
- `NaN` / `NaT` → `null`
- `np.int64` → `int` natif Python
- `pd.Timestamp` → ISO 8601 string

Aucun type numpy/pandas ne fuit vers Pydantic.

---

## 8. Choix Frontend

- **App Router Next.js 15** + `"use client"` sur les composants stateful
- **React Query** : polling toutes 60s, staleTime 30s, retry 1
- **Recharts** pour les graphiques (Donut, Bar, Pie)
- **Lucide React** pour les icônes
- **Tailwind** avec palette `snde-*` custom (navy → blue → cyan)
- **TypeScript strict** + alias `@/` → `./src/`

---

## 9. Décisions techniques principales

| # | Décision | Justification |
|---|---|---|
| 1 | DuckDB local, pas PostgreSQL | Pas de serveur à gérer, requêtes analytiques rapides, file embarqué |
| 2 | `read_only=True` pour API | Permet la concurrence pipeline ↔ requêtes utilisateurs |
| 3 | 3 cycles CLOTURE en cache | Compromis volumétrie / utilité historique |
| 4 | Snapshot diff pour alertes | Plus robuste qu'un polling client, audit complet |
| 5 | Format ISO 8601 partout | Compatible avec `Date()` natif JS |
| 6 | Polling 60s côté frontend | Suffisant pour la latence métier, n'écrase pas l'API |
| 7 | Pas de WebSocket | Surcoût d'infra pour faible gain (dashboard interne) |

---

## 10. Évolutions futures possibles

- Module détection anomalies (IP suspecte, vitesse anormale, clusters de saisie)
- Push Telegram via le bot SNDE existant pour les alertes critiques
- Module performance releveur avec scoring composite
- Export PDF mensuel automatique (synthèse cycle)
- Mode "compétition" entre centres avec leaderboard
