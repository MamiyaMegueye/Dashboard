"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Database, MapPin, Layers, User, Gauge, Droplet,
  TrendingUp, FileCheck, Search, Download,
  ChevronLeft, ChevronRight, ArrowUpDown, X,
} from "lucide-react";
import { Card } from "./Card";
import { fmt } from "@/lib/format";
import { api, type GlobalFilters } from "@/lib/api";

interface Props {
  filters: GlobalFilters;
}

interface ReleveRow {
  REL_ID: number;
  REL_DATE: string;
  REL_ANNEE: number;
  REL_MOIS: number;
  CPT_REF: string;
  ABN_ID: number;
  MATRICULE: string;
  STR_ID: number;
  CENTRE_LIB: string;
  SECT_ID: number;
  SECT_LIB: string;
  REL_ANCIEN_INDEX: number;
  REL_INDEX: number;
  REL_CONSOM_CALCUL: number;
  REL_MOYENNE_CONSOM: number;
  REL_NBR_JR: number;
  ID_COMP: number;
  COMPTAGE_LIB: string;
  ETAT_COMPTAGE: string;
  CONSO_CAT: string;
  REL_ESTIMATIF: number;
}

const PAGE_SIZE = 50;

// Colonnes du tableau (clé backend, label affiché, type de filtre, alignement)
type ColType = "text" | "select-estimatif";
interface ColumnDef {
  key: string;
  label: string;
  type: ColType;
  align?: "right" | "left";
  sortable?: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "REL_DATE",           label: "Date",        type: "text",            sortable: true },
  { key: "CPT_REF",            label: "Compteur",    type: "text",            sortable: true },
  { key: "ABN_ID",             label: "Abonné",      type: "text",            sortable: true },
  { key: "MATRICULE",          label: "Releveur",    type: "text",            sortable: true },
  { key: "CENTRE_LIB",         label: "Centre",      type: "text",            sortable: true },
  { key: "SECT_LIB",           label: "Secteur",     type: "text",            sortable: true },
  { key: "REL_ANCIEN_INDEX",   label: "Anc Idx",     type: "text", align: "right", sortable: true },
  { key: "REL_INDEX",          label: "Index",       type: "text", align: "right", sortable: true },
  { key: "REL_CONSOM_CALCUL",  label: "Conso m³",    type: "text", align: "right", sortable: true },
  { key: "REL_MOYENNE_CONSOM", label: "Moy",         type: "text", align: "right", sortable: true },
  { key: "ETAT_COMPTAGE",      label: "État",        type: "text",            sortable: true },
  { key: "CONSO_CAT",          label: "Cat. Conso",  type: "text",            sortable: true },
  { key: "REL_ESTIMATIF",      label: "Estim.",      type: "select-estimatif",sortable: true },
];

// ------------------------------------------------------------------
// Helpers d'affichage
// ------------------------------------------------------------------

const formatDate = (s?: string) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const formatNum = (n: number | null | undefined, decimals = 0) => {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};


// ------------------------------------------------------------------
// Composant principal
// ------------------------------------------------------------------

export default function EtatCompletPanel({ filters }: Props) {
  const [page, setPage]                   = useState(0);
  const [search, setSearch]               = useState("");
  const [debouncedSearch, setDebSearch]   = useState("");
  const [sortBy, setSortBy]               = useState("REL_DATE");
  const [sortDir, setSortDir]             = useState<"asc" | "desc">("desc");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [debColumnFilters, setDebCols]    = useState<Record<string, string>>({});

  // Reset page quand quelque chose change
  useEffect(() => { setPage(0); }, [filters, debouncedSearch, sortBy, sortDir, debColumnFilters]);

  // Debounce recherche globale
  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Debounce filtres par colonne (pour ne pas hammer le backend à chaque frappe)
  useEffect(() => {
    const t = setTimeout(() => setDebCols(columnFilters), 350);
    return () => clearTimeout(t);
  }, [columnFilters]);

  const setColumnFilter = (col: string, val: string) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (val) next[col] = val;
      else delete next[col];
      return next;
    });
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const clearAllFilters = () => {
    setSearch("");
    setColumnFilters({});
  };

  // === Queries ===
  const { data: stats } = useQuery({
    queryKey: ["etat-complet-stats", filters],
    queryFn: () => api.etatCompletStats(filters),
    refetchInterval: 60_000,
  });

  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ["etat-complet-list", filters, debouncedSearch, page, sortBy, sortDir, debColumnFilters],
    queryFn: () => api.etatCompletList({
      filters,
      q: debouncedSearch || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sortBy,
      sortDir,
      columnFilters: debColumnFilters,
    }),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  const total      = list?.total ?? 0;
  const rows       = (list?.rows ?? []) as ReleveRow[];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFiltersCount = Object.keys(debColumnFilters).length + (debouncedSearch ? 1 : 0);

  // Export CSV
  const exportCSV = async () => {
    const json = await api.etatCompletList({
      filters,
      q: debouncedSearch || undefined,
      limit: 10000,
      offset: 0,
      sortBy,
      sortDir,
      columnFilters: debColumnFilters,
    });

    const headers = [
      "Date", "Compteur", "Abonné", "Releveur",
      "Centre", "Secteur",
      "Anc Index", "Index", "Conso (m³)", "Moy Conso", "Nbr Jours",
      "État", "Cat Conso", "Estimatif",
    ];
    const lines = (json.rows as ReleveRow[]).map((r) => [
      formatDate(r.REL_DATE),
      r.CPT_REF, r.ABN_ID, r.MATRICULE,
      r.CENTRE_LIB, r.SECT_LIB,
      r.REL_ANCIEN_INDEX, r.REL_INDEX,
      r.REL_CONSOM_CALCUL, r.REL_MOYENNE_CONSOM, r.REL_NBR_JR,
      r.ETAT_COMPTAGE, r.CONSO_CAT,
      r.REL_ESTIMATIF ? "EST" : "—",
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));

    const csv = "\uFEFF" + [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `etat_complet_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* ============ STATS ============ */}
      <Card title="Statistiques globales" subtitle="Vue d'ensemble sur la période courante">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Database}   color="snde"    label="Total relevés"     value={fmt(stats?.total_releves ?? 0)} />
          <StatCard icon={MapPin}     color="emerald" label="Centres"           value={fmt(stats?.nb_centres ?? 0)} />
          <StatCard icon={Layers}     color="violet"  label="Secteurs"          value={fmt(stats?.nb_secteurs ?? 0)} />
          <StatCard icon={User}       color="amber"   label="Releveurs"         value={fmt(stats?.nb_releveurs ?? 0)} />
          <StatCard icon={Gauge}      color="cyan"    label="Compteurs"         value={fmt(stats?.nb_compteurs ?? 0)} />
          <StatCard icon={Droplet}    color="blue"    label="Conso totale (m³)" value={formatNum(stats?.conso_totale ?? 0)} />
          <StatCard icon={TrendingUp} color="rose"    label="Conso moy (m³)"    value={formatNum(stats?.conso_moyenne ?? 0, 1)} />
        </div>
      </Card>

      {/* ============ TABLE COMPLÈTE ============ */}
      <Card
        title="Table complète des relevés"
        subtitle={`Croisement S_RELEVE × CENTRES_PORTAIL × S_SECTEUR × COMPTAGE — ${fmt(total)} lignes`}
      >
        {/* Barre d'outils */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="relative w-full min-w-[240px] max-w-md flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Recherche globale : compteur, abonné, matricule..."
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-snde-500 focus:outline-none focus:ring-2 focus:ring-snde-100"
            />
          </div>

          <div className="flex items-center gap-2">
            {activeFiltersCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
              >
                <X size={14} />
                {activeFiltersCount} filtre{activeFiltersCount > 1 ? "s" : ""}
              </button>
            )}
            <button
              onClick={exportCSV}
              disabled={total === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              {/* Ligne 1 : titres triables */}
              <tr>
                {COLUMNS.map((c) => (
                  <Th
                    key={c.key}
                    col={c.key}
                    label={c.label}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align={c.align}
                    sortable={c.sortable}
                  />
                ))}
              </tr>
              {/* Ligne 2 : inputs de filtre */}
              <tr className="border-t border-slate-200 bg-white">
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-1.5 py-1.5">
                    <FilterCell
                      col={c}
                      value={columnFilters[c.key] ?? ""}
                      onChange={(v) => setColumnFilter(c.key, v)}
                    />
                  </td>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {listLoading && !list ? (
                <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-slate-400">Chargement...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-slate-400">Aucun relevé pour ce filtre</td></tr>
              ) : (
                rows.map((r) => {
                  return (
                    <tr key={r.REL_ID} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-700">{formatDate(r.REL_DATE)}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-slate-600">{r.CPT_REF}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">{r.ABN_ID}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">{r.MATRICULE || "—"}</td>
                      <td className="px-2 py-1.5">{r.CENTRE_LIB || "—"}</td>
                      <td className="px-2 py-1.5">{r.SECT_LIB || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatNum(r.REL_ANCIEN_INDEX)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatNum(r.REL_INDEX)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatNum(r.REL_CONSOM_CALCUL, 1)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{formatNum(r.REL_MOYENNE_CONSOM, 1)}</td>
                      <td className="px-2 py-1.5"><EtatBadge etat={r.ETAT_COMPTAGE} idComp={r.ID_COMP} /></td>
                      <td className="px-2 py-1.5"><ConsoBadge cat={r.CONSO_CAT} /></td>

                      <td className="px-2 py-1.5 text-center">
                        {r.REL_ESTIMATIF ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">EST</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
          <div>
            {total > 0 ? (
              <>
                <span className="font-semibold">{fmt(page * PAGE_SIZE + 1)}–{fmt(Math.min((page + 1) * PAGE_SIZE, total))}</span>
                {" sur "}
                <span className="font-semibold">{fmt(total)}</span>
              </>
            ) : (
              "0 résultat"
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40"
            >
              <ChevronLeft size={14} />
              Précédent
            </button>
            <span className="px-2 font-medium">Page {page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page + 1 >= totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40"
            >
              Suivant
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------
// Sous-composants
// ------------------------------------------------------------------

interface StatCardProps { icon: any; color: string; label: string; value: string; }
function StatCard({ icon: Icon, color, label, value }: StatCardProps) {
  const colors: Record<string, string> = {
    snde:    "from-snde-50 to-snde-100 text-snde-700 border-snde-200",
    emerald: "from-emerald-50 to-emerald-100 text-emerald-700 border-emerald-200",
    violet:  "from-violet-50 to-violet-100 text-violet-700 border-violet-200",
    amber:   "from-amber-50 to-amber-100 text-amber-700 border-amber-200",
    cyan:    "from-cyan-50 to-cyan-100 text-cyan-700 border-cyan-200",
    blue:    "from-blue-50 to-blue-100 text-blue-700 border-blue-200",
    rose:    "from-rose-50 to-rose-100 text-rose-700 border-rose-200",
    green:   "from-green-50 to-green-100 text-green-700 border-green-200",
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${colors[color] || colors.snde} p-3`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider opacity-80">
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

interface ThProps {
  col: string;
  label: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  align?: "left" | "right";
  sortable?: boolean;
}
function Th({ col, label, sortBy, sortDir, onSort, align, sortable }: ThProps) {
  const isActive = sortBy === col;
  return (
    <th
      onClick={() => sortable && onSort(col)}
      className={`${sortable ? "cursor-pointer hover:bg-slate-100" : ""} select-none px-2 py-2 ${align === "right" ? "text-right" : "text-left"} text-[10px] font-bold uppercase tracking-wider`}
    >
      <span className={`inline-flex items-center gap-1 ${isActive ? "text-snde-700" : ""}`}>
        {label}
        {sortable && <ArrowUpDown size={10} className={isActive ? "opacity-100" : "opacity-30"} />}
        {isActive && <span className="text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}

/** Cellule de filtre — input texte, ou select pour REL_ESTIMATIF */
function FilterCell({
  col, value, onChange,
}: { col: ColumnDef; value: string; onChange: (v: string) => void }) {
  if (col.type === "select-estimatif") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-[10px] focus:border-snde-500 focus:outline-none focus:ring-1 focus:ring-snde-100"
      >
        <option value="">Tous</option>
        <option value="EST">EST</option>
        <option value="0">—</option>
      </select>
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="filtrer..."
      className={`w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] focus:border-snde-500 focus:outline-none focus:ring-1 focus:ring-snde-100 ${col.align === "right" ? "text-right" : ""}`}
    />
  );
}

function EtatBadge({ etat, idComp }: { etat: string; idComp: number }) {
  const colors: Record<number, string> = {
    1: "bg-emerald-100 text-emerald-700",
    2: "bg-slate-100 text-slate-700",
    3: "bg-amber-100 text-amber-700",
    4: "bg-rose-100 text-rose-700",
    5: "bg-indigo-100 text-indigo-700",
    6: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${colors[idComp] || "bg-slate-100 text-slate-600"}`}>
      {etat || "—"}
    </span>
  );
}

function ConsoBadge({ cat }: { cat: string }) {
  const colors: Record<string, string> = {
    Nulle:   "bg-red-50 text-red-600",
    Faible:  "bg-amber-50 text-amber-600",
    Normale: "bg-emerald-50 text-emerald-600",
    Elevée:  "bg-violet-50 text-violet-600",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${colors[cat] || "bg-slate-50 text-slate-500"}`}>
      {cat || "—"}
    </span>
  );
}