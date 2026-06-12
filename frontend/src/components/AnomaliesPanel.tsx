// ============================================================
// AnomaliesPanel — Liste des relevés en anomalie
// [v2.2] CSV → Excel (.xlsx)
//   - Export client-side via exportXlsx() (toutes les lignes affichées)
//   - Option : on peut basculer sur apiExports.anomalies(filters)
//     côté backend si on veut exporter au-delà du périmètre affiché.
// ============================================================

import { Card } from "./Card";
import { ExportBtn } from "./PageShared";
import { fmt, exportXlsx, formatDate } from "@/lib/format";
import type { AnomalieRow } from "@/lib/types";

const CAT_CLASS: Record<string, string> = {
  Nulle: "danger",
  Faible: "warn",
  Elevée: "warn",
};

/**
 * Export Excel client-side : on prend tel quel ce qui est dans `rows`.
 * Colonnes ordonnées pour une lecture confortable dans Excel.
 */
function exportAnomaliesXlsx(rows: AnomalieRow[]) {
  if (!rows.length) return;

  const stamp = new Date().toISOString().slice(0, 10);  // ex: "2026-06-11"
  const data = rows.map((r) => ({
    Date:             r.REL_DATE ? formatDate(r.REL_DATE) : "",
    Centre:           r.CENTRE_LIB || "",
    Secteur:          r.SECT_LIB || "",
    Compteur:         r.CPT_REF || "",
    "Abonné":         r.ABN_ID ?? "",
    "Releveur":       r.MATRICULE || "",
    "État":           r.ETAT_COMPTAGE || "",
    "Conso (m³)":     r.REL_CONSOM_CALCUL ?? "",
    "Catégorie":      r.CONSO_CAT || "",
    "Index actuel":   r.REL_INDEX ?? "",
    "Index ancien":   r.REL_ANCIEN_INDEX ?? "",
    "Validé":         r.REL_VALIDE === 1 ? "Oui" : r.REL_VALIDE === 0 ? "Non" : "",
  }));

  exportXlsx(data, `anomalies_${stamp}`, "Anomalies");
}

export default function AnomaliesPanel({ rows }: { rows: AnomalieRow[] | undefined }) {
  const data = rows ?? [];
  return (
    <Card
      title={`Anomalies de consommation (${data.length})`}
      subtitle="Non validés + Conso nulle / faible / élevée"
      action={
        <ExportBtn
          onClick={() => exportAnomaliesXlsx(data)}
          label="Excel"
        />
      }
    >
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Centre · Secteur</th>
              <th>Compteur</th>
              <th className="text-right">Conso</th>
              <th>Catégorie</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.REL_ID} className={CAT_CLASS[r.CONSO_CAT] ?? ""}>
                <td className="text-xs tabular-nums">
                  {new Date(r.REL_DATE).toLocaleDateString("fr-FR")}
                </td>
                <td className="text-xs">
                  <div className="font-medium text-slate-800">{r.CENTRE_LIB || "—"}</div>
                  <div className="text-slate-500">{r.SECT_LIB || "—"}</div>
                </td>
                <td className="font-mono text-xs">{r.CPT_REF}</td>
                <td className="text-right font-semibold tabular-nums">
                  {r.REL_CONSOM_CALCUL == null ? "—" : fmt(r.REL_CONSOM_CALCUL)}{" "}
                  <span className="text-[10px] text-slate-400">m³</span>
                </td>
                <td className="text-xs">{r.CONSO_CAT}</td>
                <td className="text-xs">{r.ETAT_COMPTAGE}</td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center italic text-slate-400">
                  Aucune anomalie sur ce périmètre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}