"use client";

import { useState } from "react";
import {
  ChevronDown, RotateCcw, MapPin, Layers, Calendar,
  Database, Loader2, CheckCircle2, AlertCircle,
} from "lucide-react";
import type { CentreListItem, SecteurListItem } from "@/lib/types";

interface FilterBarProps {
  centres: CentreListItem[] | undefined;
  secteurs: SecteurListItem[] | undefined;
  strId: number | null;
  sectId: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  onCentreChange: (id: number | null) => void;
  onSecteurChange: (id: number | null) => void;
  onDateFromChange: (d: string | null) => void;
  onDateToChange: (d: string | null) => void;
  onReloadPeriod: (dateFrom: string, dateTo: string) => Promise<{ rows: number; duration_s: number }>;
  isLoadingSecteurs: boolean;
}

function NativeSelect({
  value, onChange, disabled, children, icon: Icon,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  icon: typeof MapPin;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400">
        <Icon size={14} />
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-9 text-sm text-slate-800 shadow-sm transition focus:border-snde-500 focus:outline-none focus:ring-2 focus:ring-snde-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400">
        <ChevronDown size={16} />
      </span>
    </div>
  );
}

function DateInput({
  value, onChange, max, min,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  max?: string;
  min?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400">
        <Calendar size={14} />
      </span>
      <input
        type="date"
        value={value ?? ""}
        max={max}
        min={min}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-2 text-sm text-slate-800 shadow-sm transition focus:border-snde-500 focus:outline-none focus:ring-2 focus:ring-snde-100"
      />
    </div>
  );
}

export default function FilterBar({
  centres, secteurs, strId, sectId, dateFrom, dateTo,
  onCentreChange, onSecteurChange, onDateFromChange, onDateToChange,
  onReloadPeriod, isLoadingSecteurs,
}: FilterBarProps) {
  const ALL = "__all__";

  const [isReloading, setIsReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 🆕 v2.2 : suppression du filtre relValide
  const hasAnyFilter =
    strId !== null || sectId !== null || dateFrom !== null || dateTo !== null;

  const canReload = dateFrom !== null && dateTo !== null && !isReloading;

  const handleReload = async () => {
    if (!dateFrom || !dateTo) return;
    setIsReloading(true);
    setReloadMsg(null);
    try {
      const res = await onReloadPeriod(dateFrom, dateTo);
      setReloadMsg({
        type: "success",
        text: `✓ ${res.rows.toLocaleString("fr-FR")} relevés chargés depuis Oracle en ${res.duration_s.toFixed(1)}s`,
      });
      setTimeout(() => setReloadMsg(null), 8000);
    } catch (err: any) {
      setReloadMsg({
        type: "error",
        text: `Erreur : ${err.message || "rechargement échoué"}`,
      });
      setTimeout(() => setReloadMsg(null), 10000);
    } finally {
      setIsReloading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* 🆕 v2.2 : grid 4 colonnes au lieu de 5 (suppression Validation) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.4fr_1fr_1fr_auto] lg:items-end">
        {/* Centre */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Centre</label>
          <NativeSelect
            icon={MapPin}
            value={strId == null ? ALL : String(strId)}
            onChange={(v) => {
              onCentreChange(v === ALL ? null : Number(v));
              onSecteurChange(null);
            }}
          >
            <option value={ALL}>Tous les centres Nouakchott</option>
            {(centres ?? []).map((c) => (
              <option key={c.STR_ID} value={c.STR_ID}>
                {String(c.STR_ID).padStart(2, "0")} — {c.CENTRE_LIB}
              </option>
            ))}
          </NativeSelect>
        </div>

        {/* Secteur */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Secteur</label>
          <NativeSelect
            icon={Layers}
            value={sectId == null ? ALL : String(sectId)}
            onChange={(v) => onSecteurChange(v === ALL ? null : Number(v))}
            disabled={strId == null || isLoadingSecteurs}
          >
            <option value={ALL}>{strId == null ? "Choisir un centre d'abord" : "Tous les secteurs"}</option>
            {(secteurs ?? []).map((s) => (
              <option key={s.SECT_ID} value={s.SECT_ID}>{s.SECT_LIB}</option>
            ))}
          </NativeSelect>
        </div>

        {/* Date début */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Date début</label>
          <DateInput
            value={dateFrom}
            max={dateTo ?? undefined}
            onChange={onDateFromChange}
          />
        </div>

        {/* Date fin */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Date fin</label>
          <DateInput
            value={dateTo}
            min={dateFrom ?? undefined}
            onChange={onDateToChange}
          />
        </div>

        {/* Reset */}
        <button
          type="button"
          onClick={() => {
            onCentreChange(null);
            onSecteurChange(null);
            onDateFromChange(null);
            onDateToChange(null);
          }}
          disabled={!hasAnyFilter || isReloading}
          className="inline-flex h-[38px] items-center justify-center gap-1.5 self-end rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw size={14} />
          <span className="hidden sm:inline">Réinitialiser</span>
        </button>
      </div>

      {/* Ligne d'actions Oracle */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="text-[11px] text-slate-500">
          {dateFrom && dateTo ? (
            <>
              📅 Période sélectionnée : <span className="font-semibold text-slate-700">{dateFrom}</span> → <span className="font-semibold text-slate-700">{dateTo}</span>
            </>
          ) : (
            <>📅 Sélectionne une date début + date fin pour charger une période spécifique depuis Oracle</>
          )}
        </div>

        <button
          type="button"
          onClick={handleReload}
          disabled={!canReload}
          className="inline-flex items-center gap-2 rounded-lg border border-snde-500 bg-snde-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-snde-600 hover:border-snde-600 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
        >
          {isReloading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Extraction Oracle en cours...
            </>
          ) : (
            <>
              <Database size={16} />
              Charger cette période depuis Oracle
            </>
          )}
        </button>
      </div>

      {reloadMsg && (
        <div
          className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            reloadMsg.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {reloadMsg.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {reloadMsg.text}
        </div>
      )}

      {(dateFrom || dateTo) && !reloadMsg && (
        <p className="mt-2 text-[11px] text-slate-500">
          📅 Période personnalisée — la fenêtre dynamique 30j est désactivée tant que tu n&apos;as pas réinitialisé.
        </p>
      )}
    </div>
  );
}
