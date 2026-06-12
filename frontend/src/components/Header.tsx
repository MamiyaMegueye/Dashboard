import { Activity } from "lucide-react";

export default function Header({ lastRefresh }: { lastRefresh?: Date }) {
  return (
    <header className="border-b border-slate-200 bg-gradient-to-r from-snde-800 via-snde-700 to-snde-600 text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 backdrop-blur">
            <Activity size={18} />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">SNDE — Suivi des Relevés</h1>
            <p className="text-xs text-white/70">26 centre de Nouakchott </p>
          </div>
        </div>
        {lastRefresh && (
          <div className="text-right text-[11px] text-white/75">
            <p className="uppercase tracking-wider">Dernière maj</p>
            <p className="font-medium tabular-nums">
              {lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        )}
      </div>
    </header>
  );
}