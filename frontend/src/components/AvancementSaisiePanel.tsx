"use client";

// ============================================================
// AvancementSaisiePanel — Onglet "Suivi Temps Réel"
// [v2.4] Refonte 4 sections + Export Excel
//        + Fix Section 2 défensif : supporte les deux conventions
//          de noms (minuscules `centre_code` OU majuscules `STR_ID`),
//          car le mart `mart_pilotage_par_centre` peut renvoyer
//          l'une ou l'autre selon la version du SQL appliquée.
//
// Architecture conforme à la fenêtre CLOTURE=0 :
//   1. PILOTAGE          → KPI globaux + bandeau alertes franchissement 80%
//   2. PAR CENTRE        → cartes/heatmap centres avec % avancement
//   3. PAR SECTEUR       → tableau principal (filtres + tri + badges anomalies)
//   4. DRILL-DOWN        → délégué au parent via onOpenDetail
//
// Source des données :
//   - apiCloture.pilotageGlobal()    → bandeau KPI
//   - apiCloture.pilotageParCentre() → section 2
//   - apiCloture.avancementSaisie()  → section 3
//   - apiExports.avancementSaisie()  → export Excel via backend
//
// Hors fenêtre (CLOTURE=1 ou FLAG_VALID=1), les badges d'anomalies
// sont grisés car les données ne sont plus modifiables → mode "audit".
// ============================================================

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Database, Filter, Search, Download, ArrowDown, ArrowUp, Eye,
  CheckCircle2, Clock, PlayCircle, AlertTriangle, Activity,
  Loader2, Bell, Building2, Target, MapPin, ChevronRight,
} from "lucide-react";
import { Card } from "./Card";
import KpiCard from "./KpiCard";
import { apiCloture, apiExports } from "@/lib/api";
import {
  fmt, colorForAvancement, formatDate, formatCycle,
} from "@/lib/format";
import type { AvancementSaisieRow, PilotageCentreRow } from "@/lib/types";

const PAGE_SIZE = 50;

type SortKey =
  | "pct_avancement" | "parc_cloture" | "saisis_declare" | "restant"
  | "pct_estimation" | "derniere_saisie" | "centre_libelle" | "secteur_libelle";

type PctBand = "" | "0" | "lt50" | "50-80" | "80-95" | "ge95";

interface Props {
  /** Filtre centre venant de la FilterBar globale (optionnel) */
  strId: number | null;
  /** Callback drill-down : ouvre la section 4 (modal détail secteur) */
  onOpenDetail?: (row: AvancementSaisieRow) => void;
}

// ============================================================
// Helpers internes
// ============================================================

/** Badge de statut (En cours / À valider / Validé) */
function StatutBadge({ statut }: { statut: string }) {
  const map: Record<string, { Icon: typeof Clock; cls: string }> = {
    "En cours":  { Icon: PlayCircle,   cls: "bg-snde-50 text-snde-700 border-snde-200" },
    "À valider": { Icon: Clock,        cls: "bg-amber-50 text-amber-700 border-amber-200" },
    "Validé":    { Icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  };
  const { Icon, cls } = map[statut] || {
    Icon: Clock, cls: "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      <Icon size={10} />
      {statut}
    </span>
  );
}

/** Barre de progression colorée selon le seuil */
function ProgressBar({ value }: { value: number | null }) {
  const v = value ?? 0;
  const color = colorForAvancement(v);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(v, 100)}%`, background: color.hex }}
        />
      </div>
      <span className={`min-w-[3.5em] text-right text-xs font-bold tabular-nums ${color.text}`}>
        {v}%
      </span>
    </div>
  );
}

/** Badges d'anomalies dérivés des flags du mart (uniquement actifs si CLOTURE=0) */
function AnomalieBadges({ row }: { row: AvancementSaisieRow }) {
  const inactive = row.CLOTURE === 1;  // mode audit, badges grisés

  const badges: { label: string; icon: any; cls: string; title: string }[] = [];

  if (row.flag_seuil_80 === 1) {
    badges.push({
      label: "🎯 80%+",
      icon: Target,
      cls: inactive
        ? "bg-slate-100 text-slate-400 border-slate-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200",
      title: "Le secteur a franchi le seuil de 80% d'avancement",
    });
  }

  if (row.flag_trop_nulle === 1) {
    badges.push({
      label: "Nulle",
      icon: AlertTriangle,
      cls: inactive
        ? "bg-slate-100 text-slate-400 border-slate-200"
        : "bg-rose-50 text-rose-700 border-rose-200",
      title: "Trop de relevés avec consommation nulle",
    });
  }

  if (row.flag_trop_estime === 1) {
    badges.push({
      label: "Estim",
      icon: Clock,
      cls: inactive
        ? "bg-slate-100 text-slate-400 border-slate-200"
        : "bg-amber-50 text-amber-700 border-amber-200",
      title: "Part d'estimations trop élevée",
    });
  }

  if (row.nb_index_decroissant > 0) {
    badges.push({
      label: `Idx↓ ${row.nb_index_decroissant}`,
      icon: AlertTriangle,
      cls: inactive
        ? "bg-slate-100 text-slate-400 border-slate-200"
        : "bg-rose-100 text-rose-800 border-rose-300",
      title: `${row.nb_index_decroissant} relevé(s) avec index décroissant`,
    });
  }

  if (!badges.length) return <span className="text-[10px] text-slate-300">—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b, i) => (
        <span
          key={i}
          title={b.title}
          className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${b.cls}`}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

// ============================================================
// Composant principal
// ============================================================

export default function AvancementSaisiePanel({ strId, onOpenDetail }: Props) {
  // ---- Filtres tableau (Section 3) ----
  const [statutFilter, setStatutFilter] = useState<string>("");
  const [pctBand, setPctBand]           = useState<PctBand>("");
  const [search, setSearch]             = useState("");
  const [sortKey, setSortKey]           = useState<SortKey>("pct_avancement");
  const [sortDir, setSortDir]           = useState<"asc" | "desc">("asc");
  const [page, setPage]                 = useState(0);
  const [isExporting, setIsExporting]   = useState(false);
  const [exportError, setExportError]   = useState<string | null>(null);

  // ---- Données ----
  const qPilotage = useQuery({
    queryKey: ["pilotage-global"],
    queryFn: () => apiCloture.pilotageGlobal(),
    refetchInterval: 60_000,
  });

  const qCentres = useQuery({
    queryKey: ["pilotage-par-centre"],
    queryFn: () => apiCloture.pilotageParCentre(),
    refetchInterval: 60_000,
  });

  // Mapping pct band → min/max pour l'API
  const pctParams = useMemo(() => {
    switch (pctBand) {
      case "0":     return { minPct: 0,  maxPct: 0  };
      case "lt50":  return { minPct: 1,  maxPct: 49 };
      case "50-80": return { minPct: 50, maxPct: 79 };
      case "80-95": return { minPct: 80, maxPct: 94 };
      case "ge95":  return { minPct: 95, maxPct: 100 };
      default:      return { minPct: null, maxPct: null };
    }
  }, [pctBand]);

  const qAvancement = useQuery({
    queryKey: ["avancement-saisie", strId, statutFilter, pctParams.minPct, pctParams.maxPct],
    queryFn: () => apiCloture.avancementSaisie({
      strId:  strId ?? null,
      statut: statutFilter || null,
      minPct: pctParams.minPct,
      maxPct: pctParams.maxPct,
    }),
    refetchInterval: 60_000,
  });

  const allRows  = qAvancement.data ?? [];
  const pilotage = qPilotage.data;
  const centres  = qCentres.data ?? [];

  // ---- Section 1 : alertes franchissement 80% ----
  // Toutes les lignes EN COURS (CLOTURE=0) qui ont franchi le seuil 80%
  const alertes80 = useMemo(
    () => allRows.filter(r => r.CLOTURE === 0 && r.flag_seuil_80 === 1),
    [allRows],
  );

  // ---- Section 3 : filtre + tri local ----
  const filteredRows = useMemo(() => {
    const term = search.toLowerCase().trim();
    let rows = !term ? allRows : allRows.filter(r =>
      (r.secteur_libelle || "").toLowerCase().includes(term) ||
      (r.centre_libelle  || "").toLowerCase().includes(term) ||
      String(r.secteur_code).includes(term)
    );

    rows = [...rows].sort((a, b) => {
      const va = (a as any)[sortKey];
      const vb = (b as any)[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb) : (va - vb);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [allRows, search, sortKey, sortDir]);

  const paginatedRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const maxPage = Math.max(0, Math.ceil(filteredRows.length / PAGE_SIZE) - 1);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "pct_avancement" ? "asc" : "desc");
    }
    setPage(0);
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k
      ? <span className="text-slate-300">⇅</span>
      : sortDir === "asc"
        ? <ArrowUp size={12} className="inline" />
        : <ArrowDown size={12} className="inline" />;

  /** Export Excel via backend — respecte tous les filtres actifs */
  const handleExportXlsx = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      await apiExports.avancementSaisie({
        strId:  strId ?? null,
        statut: statutFilter || null,
        annee:  pilotage?.annee ?? null,
        mois:   pilotage?.mois ?? null,
      });
    } catch (err) {
      setExportError((err as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-5">

      {/* ============================================================
          SECTION 1 — PILOTAGE
          Bandeau alertes + KPI cards globaux
      ============================================================ */}

      {/* Bandeau alertes franchissement 80% */}
      {alertes80.length > 0 && (
        <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <Bell size={18} className="mt-0.5 shrink-0 text-emerald-700" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-emerald-900">
                {alertes80.length} secteur{alertes80.length > 1 ? "s ont" : " a"} franchi le seuil 80%
              </h3>
              <p className="mt-0.5 text-xs text-emerald-800">
                Adjoint facturation, vous pouvez basculer ces secteurs en validation.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {alertes80.slice(0, 10).map((r) => (
                  <button
                    key={r.IDCLOTURE}
                    onClick={() => onOpenDetail?.(r)}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-800 transition hover:bg-emerald-100"
                  >
                    {r.centre_libelle} · {r.secteur_libelle}
                    <span className="text-emerald-600 tabular-nums">{r.pct_avancement}%</span>
                  </button>
                ))}
                {alertes80.length > 10 && (
                  <span className="text-[11px] italic text-emerald-700">
                    +{alertes80.length - 10} autres…
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cartes KPI globales */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Parc Nouakchott"
          value={fmt(pilotage?.parc_total)}
          sub={pilotage ? `Cycle ${formatCycle(pilotage.annee, pilotage.mois)}` : "—"}
          icon={Database}
          tone="info"
        />
        <KpiCard
          label="Saisis"
          value={fmt(pilotage?.saisis)}
          sub={pilotage ? `${pilotage.nb_secteurs_avances} secteurs avancés` : "—"}
          icon={CheckCircle2}
          tone="success"
        />
        <KpiCard
          label="Reste à saisir"
          value={fmt(pilotage?.restant)}
          sub={pilotage ? `${pilotage.nb_secteurs_0pct} secteur(s) à 0%` : "—"}
          icon={AlertTriangle}
          tone={pilotage && pilotage.nb_secteurs_0pct > 0 ? "danger" : "default"}
        />
        <KpiCard
          label="% Avancement"
          value={pilotage ? `${pilotage.pct_avancement}%` : "—"}
          sub={pilotage ? `${pilotage.nb_secteurs} secteurs · ${pilotage.nb_en_cours} en cours` : "—"}
          icon={Activity}
          tone={
            pilotage && pilotage.pct_avancement >= 80 ? "success" :
            pilotage && pilotage.pct_avancement >= 50 ? "warn" : "danger"
          }
        />
      </div>

      {/* ============================================================
          SECTION 2 — PAR CENTRE
          Cartes / heatmap par centre avec couleur selon %
      ============================================================ */}

      <Card
        title="Avancement par centre"
        subtitle={`${centres.length} centre(s) actif(s) sur la zone Nouakchott`}
      >
        {qCentres.isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-slate-400">
            Chargement des centres…
          </div>
        ) : centres.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm italic text-slate-500">
            Aucun centre dans le cycle courant.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {centres.map((c: PilotageCentreRow & any) => {
              // ----------------------------------------------------------
              // Compatibilité noms de champs (le mart peut renvoyer
              // soit minuscules `centre_code` (version actuelle du SQL)
              // soit majuscules `STR_ID` (anciennes versions du mart).
              // On lit les deux pour ne jamais voir "undefined".
              // ----------------------------------------------------------
              const code     = c.centre_code    ?? c.STR_ID;
              const libelle  = c.centre_libelle ?? c.CENTRE_LIB;
              const cycleKey = c.cycle_key      ?? c.CYCLE_KEY;

              const color = colorForAvancement(c.pct_avancement);
              const isActive = strId === code;
              return (
                <div
                  key={`${code}-${cycleKey}`}
                  className={`group rounded-xl border bg-white p-3 transition ${
                    isActive
                      ? "border-snde-400 ring-2 ring-snde-100"
                      : "border-slate-200 hover:border-snde-300 hover:shadow-md"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-semibold text-slate-800">
                        {libelle || `Centre ${code}`}
                      </h4>
                      <p className="text-[10px] text-slate-500">
                        Code {code} · {fmt(c.nb_secteurs)} secteur(s)
                      </p>
                    </div>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${color.bg} ${color.text}`}>
                      {color.label}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={c.pct_avancement} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                    <div className="rounded bg-slate-50 px-1.5 py-1 text-center">
                      <div className="text-slate-500">Parc</div>
                      <div className="font-semibold tabular-nums text-slate-800">{fmt(c.parc_total)}</div>
                    </div>
                    <div className="rounded bg-slate-50 px-1.5 py-1 text-center">
                      <div className="text-slate-500">Saisis</div>
                      <div className="font-semibold tabular-nums text-emerald-700">{fmt(c.saisis)}</div>
                    </div>
                    <div className="rounded bg-slate-50 px-1.5 py-1 text-center">
                      <div className="text-slate-500">Reste</div>
                      <div className={`font-semibold tabular-nums ${c.restant > 0 ? "text-rose-700" : "text-slate-400"}`}>
                        {fmt(c.restant)}
                      </div>
                    </div>
                  </div>
                  {(c.nb_a_0pct > 0 || c.nb_avances > 0 || c.nb_clotures > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1 text-[9px]">
                      {c.nb_a_0pct > 0 && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200">
                          {c.nb_a_0pct} à 0%
                        </span>
                      )}
                      {c.nb_avances > 0 && (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          {c.nb_avances} avancés
                        </span>
                      )}
                      {c.nb_clotures > 0 && (
                        <span className="rounded bg-snde-50 px-1.5 py-0.5 font-semibold text-snde-700 ring-1 ring-snde-200">
                          {c.nb_clotures} clos
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ============================================================
          SECTION 3 — PAR SECTEUR
          Tableau principal triable + filtres + export Excel
      ============================================================ */}

      <Card
        title="Avancement par secteur"
        subtitle="Tri par défaut : pourcentage croissant (les plus en retard en haut)"
        action={
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 tabular-nums">
              {fmt(filteredRows.length)} secteur(s)
            </span>
            <button
              onClick={handleExportXlsx}
              disabled={!filteredRows.length || isExporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting
                ? <Loader2 size={13} className="animate-spin" />
                : <Download size={13} />
              }
              Excel
            </button>
          </div>
        }
      >
        {/* Toolbar : filtres */}
        <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-3">
          {/* Statut */}
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-slate-400" />
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Statut</span>
            {["", "En cours", "À valider", "Validé"].map((s) => (
              <button
                key={s || "all"}
                onClick={() => { setStatutFilter(s); setPage(0); }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  statutFilter === s
                    ? "bg-snde-600 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {s || "Tous"}
              </button>
            ))}
          </div>

          {/* Tranche avancement */}
          <div className="flex items-center gap-1.5">
            <Target size={13} className="text-slate-400" />
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Tranche</span>
            {(
              [
                { v: "",      label: "Toutes" },
                { v: "0",     label: "0%" },
                { v: "lt50",  label: "<50%" },
                { v: "50-80", label: "50–80%" },
                { v: "80-95", label: "80–95%" },
                { v: "ge95",  label: "≥95%" },
              ] as { v: PctBand; label: string }[]
            ).map((b) => (
              <button
                key={b.v || "all"}
                onClick={() => { setPctBand(b.v); setPage(0); }}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  pctBand === b.v
                    ? "bg-snde-600 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative ml-auto w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Recherche centre / secteur"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm focus:border-snde-500 focus:outline-none focus:ring-2 focus:ring-snde-100"
            />
          </div>
        </div>

        {/* Error banner export */}
        {exportError && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            ⚠ Erreur d&apos;export : {exportError}
          </div>
        )}

        {qAvancement.isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-slate-400">
            Chargement...
          </div>
        ) : qAvancement.error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Erreur : {String((qAvancement.error as Error).message)}
          </div>
        ) : (
          <>
            <div className="table-wrap" style={{ maxHeight: 600 }}>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="cursor-pointer" onClick={() => toggleSort("centre_libelle")}>
                      Centre <SortIcon k="centre_libelle" />
                    </th>
                    <th className="cursor-pointer" onClick={() => toggleSort("secteur_libelle")}>
                      Secteur <SortIcon k="secteur_libelle" />
                    </th>
                    <th>Statut</th>
                    <th className="text-right cursor-pointer" onClick={() => toggleSort("parc_cloture")}>
                      Parc <SortIcon k="parc_cloture" />
                    </th>
                    <th className="text-right cursor-pointer" onClick={() => toggleSort("saisis_declare")}>
                      Saisis <SortIcon k="saisis_declare" />
                    </th>
                    <th className="text-right cursor-pointer" onClick={() => toggleSort("restant")}>
                      Reste <SortIcon k="restant" />
                    </th>
                    <th className="cursor-pointer" onClick={() => toggleSort("pct_avancement")}>
                      Avancement <SortIcon k="pct_avancement" />
                    </th>
                    <th>Anomalies</th>
                    <th className="text-right cursor-pointer" onClick={() => toggleSort("pct_estimation")}>
                      % Estim <SortIcon k="pct_estimation" />
                    </th>
                    <th className="cursor-pointer" onClick={() => toggleSort("derniere_saisie")}>
                      Dernière saisie <SortIcon k="derniere_saisie" />
                    </th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((r) => (
                    <tr
                      key={r.IDCLOTURE}
                      onClick={() => onOpenDetail?.(r)}
                      className={`cursor-pointer hover:bg-slate-50 ${
                        r.CLOTURE === 1 ? "opacity-70" : ""
                      }`}
                    >
                      <td className="font-medium text-slate-800">
                        <div className="flex items-center gap-1">
                          <MapPin size={11} className="text-slate-400" />
                          {r.centre_libelle || `(centre ${r.centre_code})`}
                        </div>
                      </td>
                      <td className="text-slate-700">
                        {r.secteur_libelle || `(secteur ${r.secteur_code})`}
                      </td>
                      <td>
                        <StatutBadge statut={r.statut} />
                      </td>
                      <td className="text-right font-semibold tabular-nums">{fmt(r.parc_cloture)}</td>
                      <td className="text-right tabular-nums">{fmt(r.saisis_declare)}</td>
                      <td className="text-right tabular-nums text-slate-600">{fmt(r.restant)}</td>
                      <td>
                        <ProgressBar value={r.pct_avancement} />
                      </td>
                      <td>
                        <AnomalieBadges row={r} />
                      </td>
                      <td className={`text-right tabular-nums text-xs ${
                        r.pct_estimation > 30 ? "text-rose-600 font-semibold" :
                        r.pct_estimation > 15 ? "text-amber-600" : "text-slate-500"
                      }`}>
                        {r.pct_estimation ? `${r.pct_estimation}%` : "—"}
                      </td>
                      <td className="text-xs text-slate-600 tabular-nums">
                        {formatDate(r.derniere_saisie)}
                      </td>
                      <td className="text-right">
                        {onOpenDetail && (
                          <span
                            onClick={(e) => { e.stopPropagation(); onOpenDetail(r); }}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:border-snde-300 hover:text-snde-700"
                          >
                            <Eye size={11} />
                            Détail
                            <ChevronRight size={10} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {paginatedRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-12 text-center italic text-slate-400">
                        Aucun secteur ne correspond aux filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <footer className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm">
              <p className="text-slate-600 tabular-nums">
                {filteredRows.length === 0
                  ? "—"
                  : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filteredRows.length)} sur ${fmt(filteredRows.length)}`}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  ◀ Précédent
                </button>
                <span className="px-2 text-xs font-semibold tabular-nums text-slate-600">
                  Page {page + 1} / {maxPage + 1}
                </span>
                <button
                  onClick={() => setPage(Math.min(maxPage, page + 1))}
                  disabled={page >= maxPage}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Suivant ▶
                </button>
              </div>
            </footer>
          </>
        )}
      </Card>

      {/* ============================================================
          Bandeau d'aide pédagogique
      ============================================================ */}

      <div className="rounded-xl border-l-4 border-snde-400 bg-snde-50 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-snde-900">
          <Activity size={16} className="text-snde-700" />
          Lecture du tableau
        </h3>
        <ul className="space-y-1.5 text-xs leading-relaxed text-snde-900">
          <li>
            <strong>Fenêtre de contrôle</strong> — on travaille sur les secteurs <code className="rounded bg-white/60 px-1">CLOTURE = 0</code>.
            Une fois clôturés, les badges anomalies passent en gris (mode audit).
          </li>
          <li>
            <strong>🎯 80%+</strong> — le secteur a franchi 80% : c&apos;est le moment de basculer en validation.
          </li>
          <li>
            <strong>% Estim</strong> — ratio <code className="rounded bg-white/60 px-1">VOLUMESTIM / VOLUMEFACT</code>.
            Au-delà de 30 %, signal d&apos;alerte sur la qualité du relevé.
          </li>
          <li>
            <strong>Clic sur une ligne</strong> — ouvre le détail abonnés (états comptage, conso, performance releveur).
          </li>
        </ul>
      </div>
    </div>
  );
}