"use client";

// ============================================================
// 🆕 v2.3.1 — AlertesPanel
// Onglet "Alertes" enrichi :
//   - Acquittement automatique à l'ouverture (badge disparaît) ← NOUVEAU v2.3.1
//   - 4 KPI en haut (Alertes actives / ≥90% non clôturé / Centres / Abonnés à risque)
//   - 1 carte par alerte avec :
//     * Badge % + header centre·secteur + heure
//     * Barre de progression
//     * Bloc "Consommation" : 4 chips cliquables (Nulle / Faible / Normale / Élevée)
//     * Bloc "État compteur" : 6 chips cliquables (Accessible / Illisible /
//       Défectueux / Bloqué / Inaccessible / Volé)
//     * Bouton "Voir tous les X abonnés avec anomalies"
//   - Clic sur une chip → DrillModal préfiltré (secteur + cycle + cat conso ou état)
//
// La logique métier reste : alerte affichée uniquement si CLOTURE = 0
// (filtre côté backend dans /api/releve/alertes).
// ============================================================

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Bell, Building2, Users, Eye, Clock,
  Droplet, Activity, CheckCircle2,
} from "lucide-react";

import { Card } from "./Card";
import KpiCard from "./KpiCard";
import DrillModal, { type DrillFilter } from "./DrillModal";
import { fmt } from "@/lib/format";
import type { GlobalFilters } from "@/lib/api";

// ============================================================
// Type étendu : 10 stats (4 conso + 6 état compteur)
// ============================================================

interface AlerteRichRow {
  alert_id:        number;
  alert_type:      string;
  STR_ID:          number;
  CENTRE_LIB:      string | null;
  SECT_ID:         number;
  SECT_LIB:        string | null;
  ANNEE:           number;
  MOIS:            number;
  pct_avant:       number;
  pct_apres:       number;
  detected_at:     string;
  acknowledged:    boolean;
  current_pct:     number;
  parc_total:      number;
  nb_saisis:       number;
  saisis_reel:     number;
  // Consommation
  nb_conso_nulle:   number;
  nb_conso_faible:  number;
  nb_conso_normale: number;
  nb_conso_elevee:  number;
  pct_conso_nulle:   number;
  pct_conso_faible:  number;
  pct_conso_normale: number;
  pct_conso_elevee:  number;
  // État compteur
  nb_accessible:    number;
  nb_illisible:     number;
  nb_defectueux:    number;
  nb_bloque:        number;
  nb_inaccessible:  number;
  nb_vole:          number;
  pct_accessible:    number;
  pct_illisible:     number;
  pct_defectueux:    number;
  pct_bloque:        number;
  pct_inaccessible:  number;
  pct_vole:          number;
  // Autres
  nb_estimes:    number;
  statut:        string;
  CLOTURE:       number;
  nb_anomalies:  number;
  // Compat ancien front
  pct_illisibles: number;
  pct_normaux:    number;
}

interface Props {
  onOpenDetail?: (alert: AlerteRichRow) => void;
}

// ============================================================
// Mapping ID_COMP (cohérent avec /api/releve/etat-comptage côté backend)
// 1 = Accessible · 2 = Illisible · 3 = Défectueux
// 4 = Bloqué    · 5 = Inaccessible · 6 = Volé
// ============================================================

const ID_COMP_BY_LABEL: Record<string, number> = {
  "Accessible":   1,
  "Illisible":    2,
  "Défectueux":   3,
  "Bloqué":       4,
  "Inaccessible": 5,
  "Volé":         6,
};

// ============================================================
// Helpers
// ============================================================

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "aujourd'hui";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/**
 * Convertit (ANNEE, MOIS) → fenêtre [premier jour, dernier jour] du mois,
 * au format "YYYY-MM-DD" attendu par /api/releve/list.
 */
function monthRange(annee: number, mois: number): { dateFrom: string; dateTo: string } {
  const mm = String(mois).padStart(2, "0");
  const dateFrom = `${annee}-${mm}-01`;
  // `new Date(year, monthIndex+1, 0)` = dernier jour du mois (monthIndex 0-based)
  const lastDay = new Date(annee, mois, 0).getDate();
  const dateTo = `${annee}-${mm}-${String(lastDay).padStart(2, "0")}`;
  return { dateFrom, dateTo };
}

/**
 * Définition d'une chip stat (utilisée pour les 10 boutons cliquables).
 */
interface StatChip {
  key:    string;
  label:  string;   // affiché dans la chip
  nb:     number;
  pct:    number;
  tone:   "danger" | "warn" | "info" | "success" | "neutral";
  drillKind:    "conso" | "etat";
  drillValue:   string;  // valeur passée au DrillModal (CONSO_CAT ou label état)
}

/** Couleurs Tailwind par tonalité (cohérent avec KpiCard). */
const TONE_CLS: Record<StatChip["tone"], { bg: string; text: string; ring: string; hover: string }> = {
  danger:  { bg: "bg-rose-50",    text: "text-rose-700",    ring: "ring-rose-200",    hover: "hover:bg-rose-100"    },
  warn:    { bg: "bg-amber-50",   text: "text-amber-700",   ring: "ring-amber-200",   hover: "hover:bg-amber-100"   },
  info:    { bg: "bg-sky-50",     text: "text-sky-700",     ring: "ring-sky-200",     hover: "hover:bg-sky-100"     },
  success: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", hover: "hover:bg-emerald-100" },
  neutral: { bg: "bg-slate-50",   text: "text-slate-700",   ring: "ring-slate-200",   hover: "hover:bg-slate-100"   },
};

/**
 * Petit bouton qui affiche une stat et ouvre le drill au clic.
 * Visuellement : label en haut, gros nombre au centre, % en bas.
 */
function StatPill({ chip, onClick }: { chip: StatChip; onClick: () => void }) {
  const t = TONE_CLS[chip.tone];
  const disabled = chip.nb === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled
        ? `Aucun abonné dans cette catégorie`
        : `Cliquez pour voir les ${fmt(chip.nb)} abonné(s)`}
      className={`group flex flex-col items-center rounded-lg px-2 py-2 text-center ring-1 ring-inset transition
        ${t.bg} ${t.ring}
        ${disabled
          ? "cursor-not-allowed opacity-50"
          : `${t.hover} cursor-pointer focus:outline-none focus:ring-2 focus:ring-snde-300`
        }`}
    >
      <span className={`text-[9px] uppercase tracking-wider font-semibold ${t.text}`}>
        {chip.label}
      </span>
      <span className={`mt-0.5 text-lg font-bold tabular-nums ${t.text}`}>
        {fmt(chip.nb)}
      </span>
      <span className="text-[10px] text-slate-500 tabular-nums">
        {chip.pct.toFixed(1)} %
      </span>
    </button>
  );
}

// ============================================================
// Composant principal
// ============================================================

export default function AlertesPanel({ onOpenDetail }: Props) {
  const qc = useQueryClient();

  // 🆕 v2.3.1 — Acquittement automatique de toutes les alertes au montage
  //    → fait disparaître le badge "X" sur l'onglet Alertes dès qu'on l'ouvre
  //    → les cartes RESTENT affichées dans l'onglet (fetch en only_unack=false)
  //    → seul le badge en haut bascule à 0 (count basé sur only_unack=true)
  useEffect(() => {
    const ackAllOnMount = async () => {
      try {
        await fetch("/api/releve/alertes/acknowledge-all", { method: "POST" });
        // Refresh du compteur en haut → le badge passe à 0
        qc.invalidateQueries({ queryKey: ["alertes-count"] });
      } catch (e) {
        console.warn("Acquittement global échoué", e);
      }
    };
    ackAllOnMount();
  }, [qc]);

  // ---- State drill-down (géré localement, pas besoin de remonter à page.tsx) ----
  const [drillFilter, setDrillFilter]   = useState<DrillFilter | null>(null);
  const [drillGlobals, setDrillGlobals] = useState<GlobalFilters | null>(null);

  // ---- Fetch alertes ----
  const q = useQuery<AlerteRichRow[]>({
    queryKey: ["alertes-list"],
    queryFn: async () => {
      const r = await fetch("/api/releve/alertes?only_unack=false&limit=100", { cache: "no-store" });
      if (!r.ok) throw new Error("Erreur chargement alertes");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const alerts = q.data ?? [];

  // ---- KPIs calculés depuis la liste ----
  const nbAlertes          = alerts.length;
  const nbHighPct          = alerts.filter(a => (a.current_pct ?? 0) >= 90).length;
  const nbCentres          = new Set(alerts.map(a => a.STR_ID)).size;
  const totalAbosAnomalies = alerts.reduce((sum, a) => sum + (a.nb_anomalies ?? 0), 0);

  // ---- Handlers ----

  /** Ouvre le DrillModal préfiltré sur (secteur + cycle + catégorie cliquée). */
  const openDrill = (
    a: AlerteRichRow,
    kind: "conso" | "etat",
    value: string,
    nb: number,
  ) => {
    if (nb === 0) return;

    const { dateFrom, dateTo } = monthRange(a.ANNEE, a.MOIS);
    setDrillGlobals({
      strId:    a.STR_ID,
      sectId:   a.SECT_ID,
      dateFrom,
      dateTo,
    });

    const cycleLabel = `Cycle ${String(a.MOIS).padStart(2, "0")}/${a.ANNEE}`;
    const scopeLabel = `${a.CENTRE_LIB ?? `Centre ${a.STR_ID}`} · ${a.SECT_LIB ?? `Secteur ${a.SECT_ID}`} · ${cycleLabel}`;

    if (kind === "conso") {
      setDrillFilter({
        title:    `Consommations ${value.toLowerCase()}`,
        subtitle: scopeLabel,
        consoCat: value,
      });
    } else {
      setDrillFilter({
        title:    `Compteurs ${value.toLowerCase()}`,
        subtitle: scopeLabel,
        idComp:   ID_COMP_BY_LABEL[value],
      });
    }
  };

  const closeDrill = () => {
    setDrillFilter(null);
    setDrillGlobals(null);
  };

  /** Acquittement + drill-down sur tous les abonnés (bouton "Voir les X"). */
  const handleAcknowledgeAndOpen = async (a: AlerteRichRow) => {
    try {
      await fetch("/api/releve/alertes/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: a.alert_id }),
      });
      qc.invalidateQueries({ queryKey: ["alertes-list"] });
      qc.invalidateQueries({ queryKey: ["alertes-count"] });
    } catch (e) {
      console.warn("Acquittement échoué", e);
    }
    onOpenDetail?.(a);
  };

  /** Construit les 4 chips Consommation pour une alerte. */
  const consoChips = (a: AlerteRichRow): StatChip[] => [
    {
      key: "nulle",
      label: "Nulle",
      nb: a.nb_conso_nulle ?? 0,
      pct: a.pct_conso_nulle ?? 0,
      tone: "danger",
      drillKind: "conso",
      drillValue: "Nulle",
    },
    {
      key: "faible",
      label: "Faible",
      nb: a.nb_conso_faible ?? 0,
      pct: a.pct_conso_faible ?? 0,
      tone: "warn",
      drillKind: "conso",
      drillValue: "Faible",
    },
    {
      key: "normale",
      label: "Normale",
      nb: a.nb_conso_normale ?? 0,
      pct: a.pct_conso_normale ?? 0,
      tone: "success",
      drillKind: "conso",
      drillValue: "Normale",
    },
    {
      key: "elevee",
      label: "Élevée",
      nb: a.nb_conso_elevee ?? 0,
      pct: a.pct_conso_elevee ?? 0,
      tone: "warn",
      drillKind: "conso",
      drillValue: "Elevée",  // Backend filtre sur "Elevée" (sans accent grave)
    },
  ];

  /** Construit les 6 chips État compteur pour une alerte. */
  const etatChips = (a: AlerteRichRow): StatChip[] => [
    {
      key: "accessible",
      label: "Accessible",
      nb: a.nb_accessible ?? 0,
      pct: a.pct_accessible ?? 0,
      tone: "success",
      drillKind: "etat",
      drillValue: "Accessible",
    },
    {
      key: "illisible",
      label: "Illisible",
      nb: a.nb_illisible ?? 0,
      pct: a.pct_illisible ?? 0,
      tone: "warn",
      drillKind: "etat",
      drillValue: "Illisible",
    },
    {
      key: "defectueux",
      label: "Défectueux",
      nb: a.nb_defectueux ?? 0,
      pct: a.pct_defectueux ?? 0,
      tone: "warn",
      drillKind: "etat",
      drillValue: "Défectueux",
    },
    {
      key: "bloque",
      label: "Bloqué",
      nb: a.nb_bloque ?? 0,
      pct: a.pct_bloque ?? 0,
      tone: "danger",
      drillKind: "etat",
      drillValue: "Bloqué",
    },
    {
      key: "inaccessible",
      label: "Inaccessible",
      nb: a.nb_inaccessible ?? 0,
      pct: a.pct_inaccessible ?? 0,
      tone: "danger",
      drillKind: "etat",
      drillValue: "Inaccessible",
    },
    {
      key: "vole",
      label: "Volé",
      nb: a.nb_vole ?? 0,
      pct: a.pct_vole ?? 0,
      tone: "danger",
      drillKind: "etat",
      drillValue: "Volé",
    },
  ];

  // ============================================================
  // Render
  // ============================================================

  if (q.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-400">
        Chargement des alertes...
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        Erreur de chargement : {String((q.error as Error).message)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ====================================================== */}
      {/* Bandeau KPI                                            */}
      {/* ====================================================== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Alertes actives"
          value={fmt(nbAlertes)}
          icon={Bell}
          tone={nbAlertes > 0 ? "danger" : "default"}
        />
        <KpiCard
          label="≥ 90 % non clôturé"
          value={fmt(nbHighPct)}
          icon={AlertTriangle}
          tone={nbHighPct > 0 ? "warn" : "default"}
        />
        <KpiCard
          label="Centres concernés"
          value={fmt(nbCentres)}
          icon={Building2}
          tone="info"
        />
        <KpiCard
          label="Abonnés à risque"
          value={fmt(totalAbosAnomalies)}
          sub="conso anormale ou état non-accessible"
          icon={Users}
          tone={totalAbosAnomalies > 100 ? "warn" : "default"}
        />
      </div>

      {/* ====================================================== */}
      {/* Liste des alertes                                      */}
      {/* ====================================================== */}
      {alerts.length === 0 ? (
        <Card title="Aucune alerte active" subtitle="Tout est sous contrôle">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 size={28} className="text-emerald-600" />
            </div>
            <p className="text-sm font-medium text-slate-700">
              Aucun secteur n&apos;a franchi le seuil 90 % depuis le dernier tick
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Le polling se rafraîchit toutes les 30 secondes
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => {
            const pct = a.current_pct ?? a.pct_apres ?? 0;
            const isCritical  = pct >= 100;
            const badgeBg     = isCritical ? "bg-rose-100"    : "bg-amber-100";
            const badgeText   = isCritical ? "text-rose-700"  : "text-amber-700";
            const barColor    = isCritical ? "bg-rose-500"    : "bg-amber-500";
            const borderColor = isCritical ? "border-rose-200" : "border-amber-200";

            const centreNom  = a.CENTRE_LIB  || `Centre ${a.STR_ID}`;
            const secteurNom = a.SECT_LIB    || `Secteur ${a.SECT_ID}`;

            return (
              <div
                key={`${a.alert_id}-${a.STR_ID}-${a.SECT_ID}-${a.ANNEE}-${a.MOIS}`}
                className={`rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md ${borderColor}`}
              >
                {/* ----- Header de l'alerte ----- */}
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-bold tabular-nums ${badgeBg} ${badgeText}`}>
                      {pct} %
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {centreNom} · <span className="font-medium text-slate-700">{secteurNom}</span>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Cycle {String(a.MOIS).padStart(2, "0")}/{a.ANNEE} ·
                        Parc {fmt(a.parc_total)} abonnés ·
                        Saisis {fmt(a.nb_saisis)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock size={12} />
                    <span className="tabular-nums">{formatTime(a.detected_at)}</span>
                    <span className="text-slate-400">·</span>
                    <span>{formatDateShort(a.detected_at)}</span>
                  </div>
                </div>

                {/* ----- Barre de progression ----- */}
                <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>

                {/* ----- Bloc Consommation (4 chips) ----- */}
                <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    <Droplet size={11} />
                    Consommation
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {consoChips(a).map((c) => (
                      <StatPill
                        key={c.key}
                        chip={c}
                        onClick={() => openDrill(a, c.drillKind, c.drillValue, c.nb)}
                      />
                    ))}
                  </div>
                </div>

                {/* ----- Bloc État compteur (6 chips) ----- */}
                <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    <Activity size={11} />
                    État compteur
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                    {etatChips(a).map((c) => (
                      <StatPill
                        key={c.key}
                        chip={c}
                        onClick={() => openDrill(a, c.drillKind, c.drillValue, c.nb)}
                      />
                    ))}
                  </div>
                </div>

                {/* ----- Footer : drill-down global ----- */}
                <button
                  type="button"
                  onClick={() => handleAcknowledgeAndOpen(a)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-snde-600 transition hover:text-snde-800"
                >
                  <Eye size={14} />
                  Voir tous les {fmt(a.nb_anomalies)} abonnés avec anomalies
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ====================================================== */}
      {/* Aide                                                   */}
      {/* ====================================================== */}
      <div className="rounded-xl border-l-4 border-rose-400 bg-rose-50 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-900">
          <AlertTriangle size={16} className="text-rose-700" />
          Logique des alertes
        </h3>
        <ul className="space-y-1.5 text-xs leading-relaxed text-rose-900">
          <li>
            <strong>Déclenchement</strong> — un secteur passe ≥ 90 % de saisie sans être clôturé (CLOTURE = 0)
          </li>
          <li>
            <strong>Acquittement auto</strong> — dès qu&apos;on ouvre l&apos;onglet Alertes, le badge sur le menu disparaît
          </li>
          <li>
            <strong>Cliquer sur une chip (Nulle / Illisible / Bloqué …)</strong> — ouvre la liste des
            abonnés concernés pour ce secteur et ce cycle
          </li>
          <li>
            <strong>Cliquer sur &quot;Voir tous les abonnés&quot;</strong> — ouvre la vue détaillée des relevés
          </li>
        </ul>
      </div>

      {/* ====================================================== */}
      {/* DrillModal : préfiltré sur secteur + cycle + catégorie */}
      {/* ====================================================== */}
      <DrillModal
        open={drillFilter !== null}
        onClose={closeDrill}
        filters={drillGlobals ?? { strId: null, sectId: null, dateFrom: null, dateTo: null }}
        filter={drillFilter}
      />
    </div>
  );
}