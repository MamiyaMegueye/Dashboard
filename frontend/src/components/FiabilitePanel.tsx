import { ShieldCheck, ShieldAlert, XCircle, Eye, Lock, Wrench } from "lucide-react";
import { Card } from "./Card";
import { fmt, pct, ID_COMP_LABEL } from "@/lib/format";
import type { Fiabilite, EtatComptageRow } from "@/lib/types";

interface Props {
  fiab: Fiabilite | undefined;
  etatRows: EtatComptageRow[] | undefined;
}

const RISK_ICON: Record<string, typeof XCircle> = {
  Illisible: Eye,
  Inaccessible: XCircle,
  Bloqué: Lock,
  Défectueux: Wrench,
  Volé: ShieldAlert,
};

export default function FiabilitePanel({ fiab, etatRows }: Props) {
  const total = fiab?.total ?? 0;
  const fiables = fiab?.fiables ?? 0;
  const aRisque = fiab?.a_controler ?? 0;
  const tauxRisque = total ? aRisque / total : 0;
  const tauxFiable = total ? fiables / total : 0;

  const niveau =
    tauxRisque <= 0.05 ? { label: "Risque faible",  color: "#10b981" } :
    tauxRisque <= 0.15 ? { label: "Risque modéré", color: "#f59e0b" } :
                         { label: "Risque élevé",  color: "#ef4444" };

  // Géométrie demi-cercle
  const cx = 100, cy = 100, r = 78;
  const L = Math.PI * r;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const angle = ((180 - 180 * Math.min(tauxRisque, 1)) * Math.PI) / 180;
  const mx = cx + r * Math.cos(angle);
  const my = cy - r * Math.sin(angle);

  // Liste des états à risque (tout sauf Accessible)
  const aControler = (etatRows ?? [])
    .filter((e) => e.ID_COMP !== 1 && e.nb > 0)
    .sort((a, b) => b.nb - a.nb);

  return (
    <Card title="Fiabilité du parc — vue audit" subtitle="Part lue réellement vs compteurs à contrôler">
      <div className="flex h-full flex-col">
        {/* Jauge */}
        <div className="relative mx-auto" style={{ width: 280 }}>
          <svg viewBox="0 0 200 118" className="w-full">
            <path d={arc} fill="none" stroke="#e2e8f0" strokeWidth="13" strokeLinecap="round" />
            <path d={arc} fill="none" stroke="#10b981" strokeWidth="13" strokeLinecap="round"
              strokeDasharray={`${0.05 * L} ${L}`} />
            <path d={arc} fill="none" stroke="#f59e0b" strokeWidth="13"
              strokeDasharray={`${0.1 * L} ${L}`} strokeDashoffset={`${-0.05 * L}`} />
            <path d={arc} fill="none" stroke="#ef4444" strokeWidth="13" strokeLinecap="round"
              strokeDasharray={`${0.85 * L} ${L}`} strokeDashoffset={`${-0.15 * L}`} />
            <circle cx={mx} cy={my} r="9" fill="#fff" stroke="#fff" strokeWidth="2" />
            <circle cx={mx} cy={my} r="6.5" fill={niveau.color} />
            <text x={cx - r} y="114" fontSize="8.5" fill="#94a3b8" textAnchor="middle">0 %</text>
            <text x={cx + r} y="114" fontSize="8.5" fill="#94a3b8" textAnchor="middle">100 %</text>
          </svg>
          <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: "40%" }}>
            <p className="text-[34px] font-bold leading-none tabular-nums" style={{ color: niveau.color }}>
              {pct(tauxRisque)}
            </p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: niveau.color }}>
              {niveau.label}
            </p>
          </div>
        </div>

        {/* Résumé */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
            <div className="flex items-center gap-1.5 text-emerald-700">
              <ShieldCheck size={14} />
              <span className="text-[10px] font-semibold uppercase tracking-wide">Lecture fiable</span>
            </div>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-800">
              {fmt(fiables)} <span className="text-xs font-normal text-emerald-600">/ {fmt(total)}</span>
            </p>
            <p className="text-[11px] text-emerald-600">{pct(tauxFiable)} du parc</p>
          </div>
          <div className="rounded-lg border p-2.5" style={{ borderColor: `${niveau.color}55`, background: `${niveau.color}12` }}>
            <div className="flex items-center gap-1.5" style={{ color: niveau.color }}>
              <ShieldAlert size={14} />
              <span className="text-[10px] font-semibold uppercase tracking-wide">À vérifier</span>
            </div>
            <p className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: niveau.color }}>
              {fmt(aRisque)} <span className="text-xs font-normal opacity-70">/ {fmt(total)}</span>
            </p>
            <p className="text-[11px]" style={{ color: niveau.color }}>{pct(tauxRisque)} du parc</p>
          </div>
        </div>

        {/* Liste de travail */}
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Compteurs à contrôler sur le terrain
          </p>
          {aControler.length === 0 ? (
            <p className="text-xs italic text-slate-400">Aucun compteur à risque sur ce périmètre.</p>
          ) : (
            aControler.map((e, i) => {
              const label = ID_COMP_LABEL[e.ID_COMP] || "Autre";
              const Icon = RISK_ICON[label] ?? XCircle;
              const tone = e.ID_COMP === 4 || e.ID_COMP === 6 ? "#ef4444" : e.ID_COMP === 3 ? "#8b5cf6" : "#f59e0b";
              return (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon size={14} style={{ color: tone }} />
                    <span className="truncate text-xs font-medium text-slate-700">{label}</span>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="text-xs font-bold tabular-nums" style={{ color: tone }}>{fmt(e.nb)}</span>
                    <span className="text-[10px] text-slate-400"> / {fmt(total)}</span>
                    <span className="ml-1.5 text-[10px] font-semibold" style={{ color: tone }}>
                      {e.pct.toFixed(1)} %
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}