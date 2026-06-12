// ============================================================
// HierarchieCentrePanel — Tableau hiérarchie centre / secteur
// [v2.2] CSV → Excel (.xlsx)
//   - Export via exportXlsx() (toutes les lignes affichées)
//   - Calcule le taux d'accessibilité côté export pour Excel
// ============================================================

import { Card } from "./Card";
import { ExportBtn } from "./PageShared";
import { fmt, pct, colorForAccess, exportXlsx } from "@/lib/format";
import type { CentreRow } from "@/lib/types";

function exportHierarchieXlsx(rows: CentreRow[]) {
  if (!rows.length) return;

  const stamp = new Date().toISOString().slice(0, 10);
  const data = rows.map((r) => {
    const taux = r.nb_releves ? r.nb_accessible / r.nb_releves : 0;
    return {
      "STR_ID":                r.STR_ID,
      "Libellé":               r.CENTRE_LIB || `(id ${r.STR_ID})`,
      "Relevés":               r.nb_releves ?? 0,
      "Accessibles":           r.nb_accessible ?? 0,
      "Taux accessibilité":    Number((taux * 100).toFixed(1)),  // en %, sans le signe (Excel-friendly)
      "À contrôler":           r.nb_a_controler ?? 0,
      "Non validés":           r.nb_non_valides ?? 0,
      "Conso nulle":           r.nb_conso_nulle ?? 0,
      "Conso faible":          r.nb_conso_faible ?? 0,
      "Conso élevée":          r.nb_conso_elevee ?? 0,
      "Conso moyenne (m³)":    r.conso_moy == null ? "" : Number(r.conso_moy.toFixed(2)),
    };
  });

  exportXlsx(data, `hierarchie_centres_${stamp}`, "Hiérarchie centres");
}

export default function HierarchieCentrePanel({ rows }: { rows: CentreRow[] | undefined }) {
  const data = rows ?? [];
  return (
    <Card
      title={`Hiérarchie (${data.length})`}
      subtitle="Cliquez sur un centre pour zoomer sur ses secteurs"
      action={
        <ExportBtn
          onClick={() => exportHierarchieXlsx(data)}
          label="Excel"
        />
      }
    >
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table>
          <thead>
            <tr>
              <th>Libellé</th>
              <th className="text-right">Relevés</th>
              <th className="text-right">Accessibles</th>
              <th className="text-right">Taux acc.</th>
              <th className="text-right">À contrôler</th>
              <th className="text-right">Conso moy.</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const taux = r.nb_releves ? r.nb_accessible / r.nb_releves : 0;
              return (
                <tr key={`${r.STR_ID}-${r.CENTRE_LIB}`} className={taux < 0.7 ? "warn" : ""}>
                  <td className="font-medium">{r.CENTRE_LIB || `(id ${r.STR_ID})`}</td>
                  <td className="text-right font-semibold tabular-nums">{fmt(r.nb_releves)}</td>
                  <td className="text-right tabular-nums">
                    <span className="font-semibold">{fmt(r.nb_accessible)}</span>
                    <span className="ml-1 text-[10px] text-slate-400">/ {fmt(r.nb_releves)}</span>
                  </td>
                  <td className={`text-right font-semibold tabular-nums ${colorForAccess(taux)}`}>
                    {pct(taux)}
                  </td>
                  <td className="text-right tabular-nums">
                    <span className="text-amber-700">{fmt(r.nb_a_controler)}</span>
                  </td>
                  <td className="text-right tabular-nums text-snde-700">
                    {fmt(r.conso_moy, 1)} m³
                  </td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center italic text-slate-400">
                  Aucune donnée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}