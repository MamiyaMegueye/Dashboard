// ============================================================
// Helpers de formatage et styling — palette SNDE
// [v2.1] Ajouts :
//   - exportXlsx() : export Excel centralisé (SheetJS)
//   - downloadXlsx() : déclenche un téléchargement depuis le backend
// ============================================================

import * as XLSX from "xlsx";

export type Tone = "default" | "info" | "success" | "warn" | "danger";

export interface ToneStyle {
  bg: string;
  text: string;
  ring: string;
}

export const TONE_STYLES: Record<Tone, ToneStyle> = {
  default: { bg: "bg-slate-50",    text: "text-slate-700",   ring: "ring-slate-200" },
  info:    { bg: "bg-snde-50",     text: "text-snde-700",    ring: "ring-snde-200" },
  success: { bg: "bg-emerald-50",  text: "text-emerald-700", ring: "ring-emerald-200" },
  warn:    { bg: "bg-amber-50",    text: "text-amber-700",   ring: "ring-amber-200" },
  danger:  { bg: "bg-rose-50",     text: "text-rose-700",    ring: "ring-rose-200" },
};

export const ID_COMP_LABEL: Record<number, string> = {
  1: "Accessible",
  2: "Illisible",
  3: "Défectueux",
  4: "Bloqué",
  5: "Inaccessible",
  6: "Volé",
};

export const COLORS_ETAT: Record<string, string> = {
  Accessible:   "#10b981",
  Illisible:    "#f59e0b",
  Défectueux:   "#8b5cf6",
  Bloqué:       "#ef4444",
  Inaccessible: "#f97316",
  Volé:         "#dc2626",
  Autre:        "#94a3b8",
};

export const COLORS_AVANCEMENT: Record<string, string> = {
  "À 0%":         "#ef4444",
  "Critique":     "#f59e0b",
  "En retard":    "#facc15",
  "Avancé":       "#84cc16",
  "Presque fini": "#10b981",
  "Terminé":      "#059669",
};

export const COLORS_STATUT: Record<string, string> = {
  "En cours":   "#1565A0",
  "À valider":  "#E8A317",
  "Validé":     "#2E8B57",
};

export function fmt(value: number | null | undefined, decimals: number = 0): string {
  if (value == null || (typeof value === "number" && isNaN(value))) return "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function pct(ratio: number | null | undefined, decimals: number = 1): string {
  if (ratio == null || isNaN(ratio)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(ratio);
}

export function colorForAccess(taux: number): string {
  if (taux >= 0.9) return "text-emerald-600";
  if (taux >= 0.7) return "text-amber-600";
  return "text-rose-600";
}

export function colorForAvancement(pctVal: number | null | undefined): {
  bg: string; text: string; hex: string; label: string;
} {
  if (pctVal == null || pctVal === 0)
    return { bg: "bg-rose-100", text: "text-rose-700", hex: "#ef4444", label: "À 0%" };
  if (pctVal < 50)
    return { bg: "bg-rose-50", text: "text-rose-700", hex: "#f87171", label: "Critique" };
  if (pctVal < 80)
    return { bg: "bg-amber-50", text: "text-amber-700", hex: "#f59e0b", label: "En retard" };
  if (pctVal < 95)
    return { bg: "bg-lime-50", text: "text-lime-700", hex: "#84cc16", label: "Avancé" };
  if (pctVal < 100)
    return { bg: "bg-emerald-50", text: "text-emerald-700", hex: "#10b981", label: "Presque fini" };
  // 100% (ou plus, juste au cas où) = cycle totalement bouclé
  return { bg: "bg-emerald-100", text: "text-emerald-900", hex: "#059669", label: "Terminé" };
}

export function formatDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export const MONTH_LABEL: Record<number, string> = {
  1: "Janvier",  2: "Février",  3: "Mars",
  4: "Avril",    5: "Mai",      6: "Juin",
  7: "Juillet",  8: "Août",     9: "Septembre",
 10: "Octobre", 11: "Novembre", 12: "Décembre",
};

export function formatCycle(annee: number, mois: number): string {
  return `${MONTH_LABEL[mois] ?? mois} ${annee}`;
}

// ============================================================
// 🆕 EXPORT EXCEL — centralisé pour tous les panels
// ============================================================

/**
 * Export client-side d'un tableau d'objets en fichier Excel (.xlsx).
 * Génère le fichier dans le navigateur via SheetJS (xlsx).
 *
 * @param rows     Tableau d'objets à exporter (1 objet = 1 ligne)
 * @param filename Nom du fichier sans extension (ex: "anomalies_2026_06")
 * @param sheetName Nom de l'onglet Excel (max 31 caractères)
 * @param headers  Optionnel : liste des colonnes à inclure dans l'ordre
 */
export function exportXlsx<T extends Record<string, any>>(
  rows: T[],
  filename: string,
  sheetName: string = "Données",
  headers?: string[],
): void {
  if (!rows || !rows.length) {
    console.warn("exportXlsx : aucune donnée à exporter");
    return;
  }

  // Si on a une liste de colonnes, on filtre/réordonne ; sinon on prend toutes les clés
  let data: any[];
  if (headers && headers.length) {
    data = rows.map(r => {
      const obj: Record<string, any> = {};
      for (const h of headers) obj[h] = r[h] ?? "";
      return obj;
    });
  } else {
    data = rows;
  }

  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  const wb = XLSX.utils.book_new();
  // Excel limite les noms d'onglet à 31 caractères et interdit / \ ? * [ ]
  const cleanSheet = sheetName.replace(/[\/\\?*\[\]]/g, "").slice(0, 31) || "Données";
  XLSX.utils.book_append_sheet(wb, ws, cleanSheet);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Téléchargement Excel depuis un endpoint backend.
 * Le backend renvoie directement un .xlsx via StreamingResponse.
 *
 * @param url      URL de l'endpoint backend (ex: "/api/releve/export/anomalies?str_id=95")
 * @param filename Nom du fichier sans extension (utilisé en fallback)
 */
export async function downloadXlsxFromBackend(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Erreur téléchargement Excel ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}