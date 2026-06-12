# Frontend — SNDE Dashboard Relevés

Dashboard Next.js 15 + React 19 + Tremor + Tailwind + TanStack Query.

## Installation

```bash
cd frontend
npm install
cp .env.example .env.local
```

## Lancement (dev)

```bash
npm run dev
# -> http://localhost:3000
```

L'API doit tourner en parallèle sur `http://localhost:8000` (voir `backend/README.md`).
Le proxy `/api/*` est configuré dans `next.config.mjs`.

## Build prod

```bash
npm run build
npm start    # sert sur le port 3000
```

## Architecture

```
src/
├── app/
│   ├── layout.tsx        # shell + providers
│   ├── page.tsx          # dashboard principal
│   ├── providers.tsx     # TanStack Query (polling 60s)
│   └── globals.css
├── components/
│   ├── Header.tsx
│   ├── KpiCardsRow.tsx           # 5 cards du haut
│   ├── EtatComptagePanel.tsx     # donut + légende
│   ├── FiabilitePanel.tsx        # gauge demi-cercle + sous-cards
│   ├── AnomaliesPanel.tsx        # table anomalies
│   └── HierarchieCentrePanel.tsx # table par centre
└── lib/
    ├── api.ts            # client REST vers FastAPI
    ├── types.ts          # DTOs
    └── utils.ts          # helpers cn, fmt, pct
```

## Palette SNDE (utilisable directement en Tailwind)

| Classe              | Hex     | Rôle                |
|---------------------|---------|---------------------|
| `bg-snde-navy`      | #0A2A4E | Texte titres        |
| `bg-snde-ocean`     | #1565A0 | Action primaire     |
| `bg-snde-cyan`      | #3FA9C9 | Highlight           |
| `bg-snde-green`     | #2E8B57 | KPI OK              |
| `bg-snde-amber`     | #E8A317 | KPI à vérifier      |
| `bg-snde-red`       | #C0392B | KPI critique        |
