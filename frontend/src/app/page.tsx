"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, BarChart3, ShieldCheck, Database as DbIcon, TrendingUp, Bell,
} from "lucide-react";

import Header from "@/components/Header";
import FilterBar from "@/components/FilterBar";
import KpiCard from "@/components/KpiCard";

import EtatComptagePanel from "@/components/EtatComptagePanel";
import FiabilitePanel from "@/components/FiabilitePanel";
import AnomaliesPanel from "@/components/AnomaliesPanel";
import HierarchieCentrePanel from "@/components/HierarchieCentrePanel";
import ConsommationPanel from "@/components/ConsommationPanel";
import EtatCompletPanel from "@/components/EtatCompletPanel";
import AvancementSaisiePanel from "@/components/AvancementSaisiePanel";
import AlertesPanel from "@/components/AlertesPanel";
import AlertBanner from "@/components/AlertBanner";
import DrillModal, { type DrillFilter } from "@/components/DrillModal";

import { api, type GlobalFilters } from "@/lib/api";
import { fmt, pct } from "@/lib/format";

// ----------------------------------------------------------------------
// Onglets disponibles — 🆕 v2.2 : ajout "alertes"
// ----------------------------------------------------------------------

type TabId = "avancement" | "alertes" | "comptage" | "consommation" | "complet";

const TABS: { id: TabId; label: string; icon: typeof Activity; badge?: string }[] = [
  { id: "avancement",   label: "Avancement Saisie", icon: TrendingUp, badge: "TEMPS RÉEL" },
  { id: "alertes",      label: "Alertes",           icon: Bell },
  { id: "comptage",     label: "État Comptage",     icon: ShieldCheck },
  { id: "consommation", label: "Consommation",      icon: BarChart3 },
  { id: "complet",      label: "État Complet",      icon: DbIcon },
];

export default function HomePage() {
  // ----- Filtres globaux — 🆕 v2.2 : suppression relValide -----
  const [filters, setFilters] = useState<GlobalFilters>({
    strId: null,
    sectId: null,
    dateFrom: null,
    dateTo: null,
  });

  const [activeTab, setActiveTab] = useState<TabId>("avancement");

  // ----- Drill modal -----
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillFilter, setDrillFilter] = useState<DrillFilter | null>(null);

  const openDrill = (f: DrillFilter) => {
    setDrillFilter(f);
    setDrillOpen(true);
  };

  // ----- Compteur alertes — pour afficher le badge sur l'onglet -----
  const qAlertCount = useQuery<{ n: number }>({
    queryKey: ["alertes-count"],
    queryFn: async () => {
      const r = await fetch("/api/releve/alertes/count?only_unack=true", { cache: "no-store" });
      if (!r.ok) throw new Error("err");
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const nbAlertes = qAlertCount.data?.n ?? 0;

  // ----- Listes pour les dropdowns -----
  const qCentres  = useQuery({ queryKey: ["centres"],  queryFn: api.centresList });
  const qSecteurs = useQuery({
    queryKey: ["secteurs", filters.strId],
    queryFn: () => api.secteursList(filters.strId!),
    enabled: filters.strId != null,
  });

  // ----- Marts S_RELEVE (existants) -----
  const qKpi          = useQuery({ queryKey: ["kpi", filters],  queryFn: () => api.kpi(filters) });
  const qEtat         = useQuery({ queryKey: ["etat", filters], queryFn: () => api.etatComptage(filters) });
  const qFiab         = useQuery({ queryKey: ["fiab", filters], queryFn: () => api.fiabilite(filters) });
  const qAnom         = useQuery({ queryKey: ["anom", filters], queryFn: () => api.anomalies(filters) });
  const qHierarchie   = useQuery({ queryKey: ["hier", filters], queryFn: () => api.hierarchieCentre(filters) });

  return (
    <div className="min-h-screen bg-slate-100">
      <Header lastRefresh={new Date()} />

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 lg:px-6">
        {/* 🆕 v2.2 : Bandeau d'alerte persistant — visible sur TOUS les onglets */}
        <AlertBanner onClickGoToAlertes={() => setActiveTab("alertes")} />

        {/* FilterBar — 🆕 sans le dropdown Validation */}
        <FilterBar
          centres={qCentres.data}
          secteurs={qSecteurs.data}
          strId={filters.strId}
          sectId={filters.sectId}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onCentreChange={(id)   => setFilters(f => ({ ...f, strId: id }))}
          onSecteurChange={(id)  => setFilters(f => ({ ...f, sectId: id }))}
          onDateFromChange={(d)  => setFilters(f => ({ ...f, dateFrom: d }))}
          onDateToChange={(d)    => setFilters(f => ({ ...f, dateTo: d }))}
          onReloadPeriod={api.reloadPeriod}
          isLoadingSecteurs={qSecteurs.isLoading}
        />

        {/* Tabs */}
        <div className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <div className="flex flex-wrap gap-1">
            {TABS.map(t => {
              const isActive = activeTab === t.id;
              const isAlertes = t.id === "alertes";
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                    isActive
                      ? (isAlertes && nbAlertes > 0
                          ? "bg-rose-600 text-white shadow-sm"
                          : "bg-snde-600 text-white shadow-sm")
                      : (isAlertes && nbAlertes > 0
                          ? "text-rose-700 hover:bg-rose-50"
                          : "text-slate-600 hover:bg-slate-50")
                  }`}
                >
                  <t.icon size={15} />
                  {t.label}
                  {/* Badge "TEMPS RÉEL" pour Avancement */}
                  {t.badge && (
                    <span className={`ml-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-snde-100 text-snde-700"
                    }`}>
                      {t.badge}
                    </span>
                  )}
                  {/* 🆕 Badge compteur sur Alertes */}
                  {isAlertes && nbAlertes > 0 && (
                    <span className={`ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                      isActive ? "bg-white text-rose-700" : "bg-rose-500 text-white"
                    }`}>
                      {nbAlertes}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ====================================================== */}
        {/* ONGLET 1 — AVANCEMENT SAISIE                          */}
        {/* ====================================================== */}
        {activeTab === "avancement" && (
          <AvancementSaisiePanel
            strId={filters.strId}
            onOpenDetail={(row) => {
              const yyyy = row.ANNEE;
              const mm = String(row.MOIS).padStart(2, "0");
              const lastDay = new Date(yyyy, row.MOIS, 0).getDate();
              const dateFromCycle = `${yyyy}-${mm}-01`;
              const dateToCycle   = `${yyyy}-${mm}-${String(lastDay).padStart(2, "0")}`;

              setFilters(f => ({
                ...f,
                strId:    row.centre_code,
                sectId:   row.secteur_code,
                dateFrom: dateFromCycle,
                dateTo:   dateToCycle,
              }));

              openDrill({
                title:    `Secteur ${row.secteur_libelle || row.secteur_code}`,
                subtitle: `${row.centre_libelle || `Centre ${row.centre_code}`} — Cycle ${row.MOIS}/${row.ANNEE} (${row.pct_avancement}%)`,
              });
            }}
          />
        )}

        {/* ====================================================== */}
        {/* 🆕 ONGLET 2 — ALERTES                                  */}
        {/* ====================================================== */}
        {activeTab === "alertes" && (
          <AlertesPanel
            onOpenDetail={(alert) => {
              // Préfiltrer le drill par secteur + cycle de l'alerte
              const yyyy = alert.ANNEE;
              const mm = String(alert.MOIS).padStart(2, "0");
              const lastDay = new Date(yyyy, alert.MOIS, 0).getDate();
              setFilters(f => ({
                ...f,
                strId:    alert.STR_ID,
                sectId:   alert.SECT_ID,
                dateFrom: `${yyyy}-${mm}-01`,
                dateTo:   `${yyyy}-${mm}-${String(lastDay).padStart(2, "0")}`,
              }));

              const centreNom = alert.CENTRE_LIB || `Centre ${alert.STR_ID}`;
              const secteurNom = alert.SECT_LIB || `Secteur ${alert.SECT_ID}`;

              openDrill({
                title:    `Secteur ${secteurNom} · ${alert.current_pct}%`,
                subtitle: `${centreNom} — Cycle ${alert.MOIS}/${alert.ANNEE} — ${fmt(alert.nb_anomalies)} abonnés avec anomalies`,
              });
            }}
          />
        )}

        {/* ====================================================== */}
        {/* ONGLET 3 — ÉTAT COMPTAGE                              */}
        {/* ====================================================== */}
        {activeTab === "comptage" && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard
                label="Total relevés (30j)"
                value={fmt(qKpi.data?.total)}
                icon={Activity}
                tone="info"
              />
              <KpiCard
                label="Accessibles"
                value={fmt(qKpi.data?.accessible)}
                sub={qKpi.data?.total ? pct(qKpi.data.accessible / qKpi.data.total) : "—"}
                icon={ShieldCheck}
                tone="success"
              />
              <KpiCard
                label="À contrôler"
                value={fmt(
                  (qKpi.data?.illisible ?? 0) +
                  (qKpi.data?.defectueux ?? 0) +
                  (qKpi.data?.bloque ?? 0) +
                  (qKpi.data?.inaccessible ?? 0) +
                  (qKpi.data?.vole ?? 0)
                )}
                tone="warn"
                icon={Activity}
              />
              {/* 🆕 v2.2 : suppression du KPI "Non validés" */}
              <KpiCard
                label="Conso anormales"
                value={fmt(
                  (qKpi.data?.conso_nulle ?? 0) +
                  (qKpi.data?.conso_faible ?? 0) +
                  (qKpi.data?.conso_elevee ?? 0)
                )}
                sub="nulle + faible + élevée"
                tone="warn"
                icon={Activity}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <EtatComptagePanel rows={qEtat.data} />
              <FiabilitePanel fiab={qFiab.data} etatRows={qEtat.data} />
            </div>

            <HierarchieCentrePanel rows={qHierarchie.data} />
            <AnomaliesPanel rows={qAnom.data} />
          </>
        )}

        {/* ====================================================== */}
        {/* ONGLET 4 — CONSOMMATION                                */}
        {/* ====================================================== */}
        {activeTab === "consommation" && (
          <ConsommationPanel kpi={qKpi.data} onDrill={openDrill} />
        )}

        {/* ====================================================== */}
        {/* ONGLET 5 — ÉTAT COMPLET                                */}
        {/* ====================================================== */}
        {activeTab === "complet" && (
          <EtatCompletPanel filters={filters} />
        )}
      </main>

      {/* Drill-down modal */}
      <DrillModal
        open={drillOpen}
        onClose={() => setDrillOpen(false)}
        filters={filters}
        filter={drillFilter}
      />
    </div>
  );
}
