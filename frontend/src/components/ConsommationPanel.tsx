import { Droplet, TrendingDown, TrendingUp, AlertTriangle, BarChart3 } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import KpiCard from "./KpiCard";
import { Card } from "./Card";
import { fmt, pct } from "@/lib/format";
import type { KpiGlobal } from "@/lib/types";
import type { DrillFilter } from "./DrillModal";

interface Props {
  kpi: KpiGlobal | undefined;
  onDrill: (f: DrillFilter) => void;
}

export default function ConsommationPanel({ kpi, onDrill }: Props) {
  const d = kpi;
  const total = d?.total ?? 0;
  const ratio = (n: number | undefined) => (total ? (n ?? 0) / total : 0);

  const distData = [
    { label: "Nulle (0)",    nb: d?.conso_nulle ?? 0,  color: "#ef4444", cat: "Nulle"   },
    { label: "Faible (<5)",  nb: d?.conso_faible ?? 0, color: "#f59e0b", cat: "Faible"  },
    { label: "Élevée (>300)",nb: d?.conso_elevee ?? 0, color: "#8b5cf6", cat: "Elevée"  },
  ];
  const anomTotale = distData.reduce((s, x) => s + x.nb, 0);

  return (
    <div className="space-y-5">
      {/* KPI Cards conso */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Total relevés"
          value={fmt(total)}
          sub={`${fmt(total - anomTotale)} normaux`}
          icon={Droplet}
          tone="info"
        />
        <KpiCard
          label="Conso nulle"
          value={fmt(d?.conso_nulle)}
          sub={`${pct(ratio(d?.conso_nulle))} · cliquer pour la liste`}
          icon={AlertTriangle}
          tone={ratio(d?.conso_nulle) > 0.15 ? "danger" : "warn"}
          onClick={() => onDrill({ title: "Consommations nulles", subtitle: "CONSO_CAT = Nulle", consoCat: "Nulle" })}
        />
        <KpiCard
          label="Conso faible"
          value={fmt(d?.conso_faible)}
          sub={`< 5 m³ · à vérifier`}
          icon={TrendingDown}
          tone="warn"
          onClick={() => onDrill({ title: "Consommations faibles", subtitle: "CONSO_CAT = Faible", consoCat: "Faible" })}
        />
        <KpiCard
          label="Conso élevée"
          value={fmt(d?.conso_elevee)}
          sub="> 300 m³ · alerte fuite"
          icon={TrendingUp}
          tone={ratio(d?.conso_elevee) > 0.02 ? "danger" : "warn"}
          onClick={() => onDrill({ title: "Consommations élevées", subtitle: "CONSO_CAT = Elevée", consoCat: "Elevée" })}
        />
      </div>

      {/* Distribution chart */}
      <Card
        title={<span className="flex items-center gap-2"><BarChart3 size={16} className="text-snde-700" />Distribution des anomalies de consommation</span>}
        subtitle="Cliquez sur une barre pour ouvrir la liste détaillée"
      >
        {anomTotale === 0 ? (
          <div className="py-12 text-center text-sm italic text-slate-400">
            Aucune anomalie de consommation sur ce périmètre.
          </div>
        ) : (
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={distData} margin={{ top: 16, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#475569" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#475569" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v) => [fmt(v as number), "Relevés"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", boxShadow: "0 8px 20px rgba(0,0,0,0.08)", fontSize: 12 }}
                  cursor={{ fill: "rgba(148, 163, 184, 0.1)" }}
                />
                <Bar dataKey="nb" radius={[8, 8, 0, 0]} onClick={(d) => onDrill({ title: `Consommations ${d.cat.toLowerCase()}`, subtitle: `CONSO_CAT = ${d.cat}`, consoCat: d.cat })} cursor="pointer">
                  {distData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Bandeau d'alerte explicatif */}
      <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
          <AlertTriangle size={16} className="text-amber-700" />
          Lecture des anomalies pour l&apos;audit
        </h3>
        <ul className="space-y-1.5 text-xs leading-relaxed text-amber-900">
          <li>
            <strong>Conso nulle</strong> — compteur figé, branchement contourné, ou relevé fictif.
            Cliquez sur le KPI pour voir la liste et croiser avec l&apos;état du compteur.
          </li>
          <li>
            <strong>Conso faible (&lt; 5 m³)</strong> — sous-déclaration possible, fuite cachée,
            compteur défaillant non signalé.
          </li>
          <li>
            <strong>Conso élevée (&gt; 300 m³)</strong> — fuite probable côté abonné, mais
            peut aussi révéler une sous-tarification.
          </li>
        </ul>
      </div>
    </div>
  );
}