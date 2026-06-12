"use client";

// ============================================================
// 🆕 v2.2 — AlertBanner
// Bandeau persistant visible sur TOUS les onglets quand au moins
// une alerte (secteur ≥ 90% non clôturé) est active.
// Clic → bascule sur l'onglet Alertes.
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useState, useEffect } from "react";

interface AlertBannerProps {
  onClickGoToAlertes: () => void;
}

interface AlertCount {
  n: number;
}

export default function AlertBanner({ onClickGoToAlertes }: AlertBannerProps) {
  // Polling 30s du compteur alertes non acquittées
  const q = useQuery<AlertCount>({
    queryKey: ["alertes-count"],
    queryFn: async () => {
      const r = await fetch("/api/releve/alertes/count?only_unack=true", { cache: "no-store" });
      if (!r.ok) throw new Error("Erreur compteur alertes");
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const count = q.data?.n ?? 0;

  // Petite animation pulse quand le compteur augmente
  const [hasChanged, setHasChanged] = useState(false);
  useEffect(() => {
    if (count > 0) {
      setHasChanged(true);
      const t = setTimeout(() => setHasChanged(false), 1500);
      return () => clearTimeout(t);
    }
  }, [count]);

  if (count === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-center justify-between gap-3 rounded-xl border-2 border-rose-300 bg-gradient-to-r from-rose-50 to-rose-100 px-4 py-3 shadow-sm transition-all ${
        hasChanged ? "animate-pulse" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500 text-white shadow-md">
          <AlertTriangle size={18} />
        </div>
        <div>
          <p className="text-sm font-bold text-rose-900">
            🚨 {count} alerte{count > 1 ? "s" : ""} active{count > 1 ? "s" : ""}
          </p>
          <p className="text-xs text-rose-700">
            {count > 1
              ? `${count} secteurs ont atteint 90% de saisie sans clôture`
              : "Un secteur a atteint 90% de saisie sans clôture"} — vérification requise
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onClickGoToAlertes}
        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
      >
        Voir les détails
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
