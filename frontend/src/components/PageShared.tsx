// ============================================================
// Composants partagés entre panels — version Excel
// ============================================================

import { Download, FileSpreadsheet } from "lucide-react";

interface ExportBtnProps {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}

/**
 * Bouton d'export Excel — remplace l'ancien export CSV.
 * Le onClick doit appeler exportXlsx() ou apiExports.xxx().
 */
export function ExportBtn({ onClick, label = "Excel", disabled }: ExportBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 hover:border-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <FileSpreadsheet size={13} />
      {label}
    </button>
  );
}

/**
 * Variante secondaire (style outline) pour quand on a déjà un bouton primary à côté.
 */
export function ExportBtnSecondary({ onClick, label = "Excel", disabled }: ExportBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download size={13} />
      {label}
    </button>
  );
}

interface LoadingProps {
  message?: string;
}

export function Loading({ message = "Chargement..." }: LoadingProps) {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-slate-400">
      {message}
    </div>
  );
}

interface ErrorBoxProps {
  error: unknown;
}

export function ErrorBox({ error }: ErrorBoxProps) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      Erreur de chargement : {msg}
    </div>
  );
}

interface EmptyStateProps {
  message?: string;
}

export function EmptyState({ message = "Aucune donnée à afficher." }: EmptyStateProps) {
  return (
    <div className="py-12 text-center text-sm italic text-slate-400">
      {message}
    </div>
  );
}