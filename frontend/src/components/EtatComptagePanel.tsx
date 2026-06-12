"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Card } from "./Card";
import { fmt } from "@/lib/format";
import { COLORS_ETAT, ID_COMP_LABEL } from "@/lib/format";
import type { EtatComptageRow } from "@/lib/types";

interface Props { rows: EtatComptageRow[] | undefined; }

export default function EtatComptagePanel({ rows }: Props) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const data = (rows ?? []).filter((r) => r.nb > 0);
  const total = data.reduce((s, r) => s + r.nb, 0);

  const active = activeIdx !== null ? data[activeIdx] : null;
  const centerLabel = active ? (ID_COMP_LABEL[active.ID_COMP] || active.ETAT_COMPTAGE) : "Total compteurs";
  const centerValue = active ? fmt(active.nb) : fmt(total);
  const centerSub = active ? `${active.pct.toFixed(1)} % du total` : `${data.length} états`;

  return (
    <Card title="Répartition par état de comptage" subtitle="Survolez un segment ou une ligne pour le détail">
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-2">
        {/* Donut */}
        <div className="relative" style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="nb"
                nameKey="ETAT_COMPTAGE"
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={105}
                paddingAngle={2}
                strokeWidth={0}
                onMouseEnter={(_, idx) => setActiveIdx(idx)}
                onMouseLeave={() => setActiveIdx(null)}
              >
                {data.map((e, i) => {
                  const label = ID_COMP_LABEL[e.ID_COMP] || "Autre";
                  return (
                    <Cell
                      key={i}
                      fill={COLORS_ETAT[label] || "#94a3b8"}
                      style={{
                        filter: activeIdx === i ? "brightness(1.1) drop-shadow(0 4px 12px rgba(0,0,0,0.18))" : "none",
                        transform: activeIdx === i ? "scale(1.04)" : "scale(1)",
                        transformOrigin: "center",
                        transition: "all 0.18s ease-out",
                        cursor: "pointer",
                      }}
                    />
                  );
                })}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{centerLabel}</p>
            <p
              className="text-3xl font-bold tabular-nums"
              style={{ color: active ? COLORS_ETAT[ID_COMP_LABEL[active.ID_COMP] || "Autre"] || "#0f172a" : "#0f172a" }}
            >
              {centerValue}
            </p>
            <p className="mt-1 text-xs text-slate-500">{centerSub}</p>
          </div>
        </div>

        {/* Légende interactive */}
        <div className="space-y-1.5">
          {data.map((e, i) => {
            const label = ID_COMP_LABEL[e.ID_COMP] || "Autre";
            const color = COLORS_ETAT[label] || "#94a3b8";
            const isActive = activeIdx === i;
            return (
              <div
                key={i}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
                className={`group cursor-pointer rounded-lg border p-2.5 transition-all ${
                  isActive ? "border-transparent shadow-md" : "border-slate-200 hover:border-slate-300"
                }`}
                style={{
                  background: isActive ? `${color}10` : "white",
                  borderColor: isActive ? color : undefined,
                }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                      style={{ background: color, boxShadow: isActive ? `0 0 0 3px ${color}33` : "none" }}
                    />
                    <span className="truncate text-xs font-semibold text-slate-800">{label}</span>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="text-xs font-bold tabular-nums text-slate-800">{fmt(e.nb)}</span>
                    <span className="text-[10px] font-normal text-slate-400"> / {fmt(total)}</span>
                  </div>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${e.pct}%`, background: color }} />
                </div>
                <div className="mt-0.5 flex justify-end">
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>
                    {e.pct.toFixed(1)} %
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}