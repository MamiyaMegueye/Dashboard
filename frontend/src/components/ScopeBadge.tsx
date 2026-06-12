import { Calendar, MapPin, Sparkles } from "lucide-react";
import { fmt } from "@/lib/format";
import type { ScopeInfo } from "@/lib/types";

interface Props {
  scope: string;
  info: ScopeInfo | undefined;
  isCustomDateRange: boolean;
}

export default function ScopeBadge({ scope, info, isCustomDateRange }: Props) {
  const fmtDate = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-snde-200 bg-gradient-to-r from-snde-50 via-white to-snde-50 p-3 sm:grid-cols-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-snde-100 text-snde-700">
          <MapPin size={15} />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Périmètre</p>
          <p className="text-sm font-semibold text-slate-800">{scope}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${isCustomDateRange ? "bg-amber-100 text-amber-700" : "bg-snde-100 text-snde-700"}`}>
          {isCustomDateRange ? <Sparkles size={15} /> : <Calendar size={15} />}
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Période {isCustomDateRange ? "(personnalisée)" : ""}
          </p>
          <p className="text-sm font-semibold tabular-nums text-slate-800">
            {fmtDate(info?.date_min)} → {fmtDate(info?.date_max)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-snde-100 text-snde-700 text-xs font-bold">
          ∑
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total relevés</p>
          <p className="text-sm font-bold tabular-nums text-slate-900">{fmt(info?.total)}</p>
        </div>
      </div>
    </div>
  );
}