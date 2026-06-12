"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Search, ChevronLeft, ChevronRight, FileSpreadsheet } from "lucide-react";
import { api, type GlobalFilters } from "@/lib/api";
import { fmt, exportXlsx } from "@/lib/format";
import type { ReleveDetail } from "@/lib/types";

export interface DrillFilter {
  title: string;
  subtitle?: string;
  idComp?: number;
  consoCat?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  filters: GlobalFilters;
  filter: DrillFilter | null;
}

const PAGE_SIZE = 50;

const formatDateTime = (s?: string) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

function exportToExcel(rows: ReleveDetail[], filename: string) {
  if (!rows.length) return;
  exportXlsx(
    rows.map(r => ({
      Date: r.REL_DATE,
      "ID relevé": r.REL_ID,
      Compteur: r.CPT_REF,
      Abonné: r.ABN_ID,
      Centre: r.CENTRE_LIB,
      Secteur: r.SECT_LIB,
      Releveur: r.MATRICULE,
      "Anc. index": r.REL_ANCIEN_INDEX,
      Index: r.REL_INDEX,
      "Conso (m³)": r.REL_CONSOM_CALCUL,
      "Moy. conso": r.REL_MOYENNE_CONSOM,
      "État comptage": r.ETAT_COMPTAGE,
      "Cat. conso": r.CONSO_CAT,
      "Estimé": r.REL_ESTIMATIF === 1 ? "Oui" : "Non",
    })),
    filename,
    "Relevés",
  );
}

export default function DrillModal({ open, onClose, filters, filter }: Props) {
  const [page, setPage]                 = useState(0);
  const [search, setSearch]             = useState("");
  const [debouncedSearch, setDebSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [filters, filter?.idComp, filter?.consoCat, debouncedSearch]);

  useEffect(() => {
    if (!open) {
      setSearch(""); setDebSearch(""); setPage(0);
    }
  }, [open]);

  const q = useQuery({
    queryKey: ["drill", filters, filter?.idComp, filter?.consoCat, debouncedSearch, page],
    queryFn: () => api.list({
      filters,
      idComp:   filter?.idComp ?? null,
      consoCat: filter?.consoCat ?? null,
      q:        debouncedSearch || undefined,
      limit:    PAGE_SIZE,
      offset:   page * PAGE_SIZE,
    }),
    enabled: open && filter !== null,
  });

  if (!open || !filter) return null;

  const total   = q.data?.total ?? 0;
  const rows    = q.data?.rows ?? [];
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative ml-auto flex h-full w-full max-w-6xl flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-snde-800 to-snde-600 px-5 py-3 text-white">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">{filter.title}</h2>
            {filter.subtitle && <p className="truncate text-xs text-white/75">{filter.subtitle}</p>}
            <p className="mt-0.5 text-xs text-white/80 tabular-nums">
              {fmt(total)} relevés au total
            </p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 transition hover:bg-white/20"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2.5">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par référence compteur ou abonné..."
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm focus:border-snde-500 focus:outline-none focus:ring-2 focus:ring-snde-100"
            />
          </div>
          <button
            onClick={() => exportToExcel(rows, `releves_${filter.idComp ?? filter.consoCat ?? "all"}_p${page + 1}`)}
            disabled={!rows.length}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            <FileSpreadsheet size={13} />
            Excel (page)
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {q.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Chargement...</div>
          ) : q.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              Erreur de chargement : {String((q.error as Error).message)}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Réf compteur</th>
                    <th>Abonné</th>
                    <th>Centre · Secteur</th>
                    <th>Releveur</th>
                    <th className="text-right">Anc. index</th>
                    <th className="text-right">Index</th>
                    <th className="text-right">Conso</th>
                    <th className="text-right">Moy.</th>
                    <th>État</th>
                    <th>Cat. conso</th>
                    <th>Estim.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.REL_ID}>
                      <td className="whitespace-nowrap text-xs tabular-nums">{formatDateTime(r.REL_DATE)}</td>
                      <td className="font-mono text-xs">{r.CPT_REF}</td>
                      <td className="font-mono text-xs">{r.ABN_ID}</td>
                      <td className="text-xs">
                        <div className="font-medium text-slate-800">{r.CENTRE_LIB || "—"}</div>
                        <div className="text-slate-500">{r.SECT_LIB || "—"}</div>
                      </td>
                      <td className="text-xs">{r.MATRICULE || "—"}</td>
                      <td className="text-right tabular-nums">{r.REL_ANCIEN_INDEX == null ? "—" : fmt(r.REL_ANCIEN_INDEX)}</td>
                      <td className="text-right tabular-nums">{r.REL_INDEX == null ? "—" : fmt(r.REL_INDEX)}</td>
                      <td className="text-right font-semibold tabular-nums">{r.REL_CONSOM_CALCUL == null ? "—" : fmt(r.REL_CONSOM_CALCUL)}</td>
                      <td className="text-right tabular-nums text-slate-500">{r.REL_MOYENNE_CONSOM == null ? "—" : fmt(r.REL_MOYENNE_CONSOM, 1)}</td>
                      <td className="text-xs">{r.ETAT_COMPTAGE}</td>
                      <td className="text-xs">{r.CONSO_CAT}</td>
                      <td className="text-center">
                        {r.REL_ESTIMATIF ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">EST</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={12} className="py-12 text-center italic text-slate-400">Aucun relevé sur ce filtre.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-2.5 text-sm">
          <p className="text-slate-600 tabular-nums">
            {total === 0
              ? "—"
              : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} sur ${fmt(total)}`}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronLeft size={14} /> Précédent
            </button>
            <span className="px-2 text-xs font-semibold tabular-nums text-slate-600">
              Page {page + 1} / {maxPage + 1}
            </span>
            <button
              onClick={() => setPage(Math.min(maxPage, page + 1))}
              disabled={page >= maxPage}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Suivant <ChevronRight size={14} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
