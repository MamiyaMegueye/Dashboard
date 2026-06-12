// ============================================================
// API client SNDE Suivi Temps Réel
// [v2.2] : suppression de relValide de GlobalFilters
// ============================================================

import type {
  KpiGlobal, EtatComptageRow, Fiabilite, AnomalieRow, CentreRow, EvolutionRow,
  CentreListItem, SecteurListItem, ReleveListResponse, ScopeInfo,
  PilotageGlobal, PilotageCentreRow, AvancementSaisieRow,
  CycleDispo, AlerteRow, SecteurDetailResponse,
} from "./types";
import { downloadXlsxFromBackend } from "./format";

/** 🆕 v2.2 : suppression du champ relValide */
export interface GlobalFilters {
  strId: number | null;
  sectId: number | null;
  dateFrom: string | null;
  dateTo: string | null;
}

function qs(o: Record<string, string | number | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v !== null && v !== undefined && v !== "") {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function globalQs(f: GlobalFilters): Record<string, string | number | null> {
  return {
    str_id:    f.strId,
    sect_id:   f.sectId,
    date_from: f.dateFrom,
    date_to:   f.dateTo,
  };
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`API ${path} -> ${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

// ============================================================
// API S_RELEVE
// ============================================================

export const api = {
  centresList:  () => get<CentreListItem[]>("/api/releve/centres-list"),
  secteursList: (strId: number) =>
    get<SecteurListItem[]>(`/api/releve/secteurs-list?str_id=${strId}`),

  scopeInfo: (f: GlobalFilters) => get<ScopeInfo>(`/api/releve/scope-info${qs(globalQs(f))}`),

  kpi:           (f: GlobalFilters) => get<KpiGlobal>(`/api/releve/kpi${qs(globalQs(f))}`),
  etatComptage:  (f: GlobalFilters) => get<EtatComptageRow[]>(`/api/releve/etat-comptage${qs(globalQs(f))}`),
  fiabilite:     (f: GlobalFilters) => get<Fiabilite>(`/api/releve/fiabilite${qs(globalQs(f))}`),
  anomalies:     (f: GlobalFilters, limit = 200) =>
    get<AnomalieRow[]>(`/api/releve/anomalies${qs({ ...globalQs(f), limit })}`),
  nonValides:    (f: GlobalFilters, limit = 500) =>
    get<AnomalieRow[]>(`/api/releve/non-valides${qs({ ...globalQs(f), limit })}`),
  hierarchieCentre: (f: GlobalFilters) =>
    get<CentreRow[]>(`/api/releve/hierarchie-centre${qs(globalQs(f))}`),
  evolution:     (f: GlobalFilters) =>
    get<EvolutionRow[]>(`/api/releve/evolution-quotidienne${qs(globalQs(f))}`),

  list: (params: {
    filters: GlobalFilters; idComp?: number | null; consoCat?: string | null;
    q?: string; limit?: number; offset?: number;
  }) =>
    get<ReleveListResponse>(`/api/releve/list${qs({
      ...globalQs(params.filters),
      id_comp:   params.idComp,
      conso_cat: params.consoCat,
      q:         params.q,
      limit:     params.limit ?? 100,
      offset:    params.offset ?? 0,
    })}`),

  etatCompletStats: (f: GlobalFilters) =>
    get<any>(`/api/releve/etat-complet-stats${qs(globalQs(f))}`),

  etatCompletList: (params: {
    filters: GlobalFilters; q?: string; limit?: number; offset?: number;
    sortBy?: string; sortDir?: "asc" | "desc"; columnFilters?: Record<string, string>;
  }) => {
    const base: Record<string, string | number | null> = {
      ...globalQs(params.filters),
      q:        params.q ?? null,
      limit:    params.limit ?? 50,
      offset:   params.offset ?? 0,
      sort_by:  params.sortBy ?? "REL_DATE",
      sort_dir: params.sortDir ?? "desc",
    };
    if (params.columnFilters) {
      for (const [col, val] of Object.entries(params.columnFilters)) {
        if (val) base[`f_${col}`] = val;
      }
    }
    return get<any>(`/api/releve/etat-complet-list${qs(base)}`);
  },

  reloadPeriod: async (dateFrom: string, dateTo: string) => {
    const r = await fetch("/api/releve/reload-period", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date_from: dateFrom, date_to: dateTo }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || `Erreur ${r.status}`);
    }
    return r.json();
  },
};

// ============================================================
// API Suivi Temps Réel (CLOTURE_SECTEUR)
// ============================================================

export const apiCloture = {
  pilotageGlobal:    () => get<PilotageGlobal>("/api/releve/pilotage-global"),
  pilotageParCentre: () => get<PilotageCentreRow[]>("/api/releve/pilotage-par-centre"),

  avancementSaisie: (params: {
    strId?: number | null;
    annee?: number | null;
    mois?: number | null;
    statut?: string | null;
    cloture?: number | null;
    minPct?: number | null;
    maxPct?: number | null;
  } = {}) =>
    get<AvancementSaisieRow[]>(`/api/releve/avancement-saisie${qs({
      str_id:  params.strId  ?? null,
      annee:   params.annee  ?? null,
      mois:    params.mois   ?? null,
      statut:  params.statut ?? null,
      cloture: params.cloture ?? null,
      min_pct: params.minPct ?? null,
      max_pct: params.maxPct ?? null,
    })}`),

  cyclesDisponibles: () => get<CycleDispo[]>("/api/releve/cycles-disponibles"),

  secteurDetail: (params: {
    strId: number; sectId: number; annee: number; mois: number; limit?: number;
  }) =>
    get<SecteurDetailResponse>(`/api/releve/secteur-detail${qs({
      str_id:  params.strId,
      sect_id: params.sectId,
      annee:   params.annee,
      mois:    params.mois,
      limit:   params.limit ?? 500,
    })}`),

  alertes: (onlyUnack: boolean = true, limit: number = 50) =>
    get<AlerteRow[]>(`/api/releve/alertes${qs({
      only_unack: onlyUnack ? 1 : 0,
      limit,
    })}`),

  alertesCount: (onlyUnack: boolean = true) =>
    get<{ n: number }>(`/api/releve/alertes/count?only_unack=${onlyUnack ? 1 : 0}`),

  acknowledgeAlert: async (alertId: number) => {
    const r = await fetch("/api/releve/alertes/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_id: alertId }),
    });
    if (!r.ok) throw new Error(`Erreur ack ${r.status}`);
    return r.json() as Promise<{ status: string; alert_id: number }>;
  },
};

// ============================================================
// API Exports Excel
// ============================================================

export const apiExports = {
  avancementSaisie: (params: {
    strId?: number | null; annee?: number | null;
    mois?: number | null; statut?: string | null;
  } = {}) =>
    downloadXlsxFromBackend(
      `/api/releve/export/avancement-saisie${qs({
        str_id: params.strId  ?? null,
        annee:  params.annee  ?? null,
        mois:   params.mois   ?? null,
        statut: params.statut ?? null,
      })}`,
      "avancement_saisie",
    ),

  anomalies: (f: GlobalFilters) =>
    downloadXlsxFromBackend(
      `/api/releve/export/anomalies${qs(globalQs(f))}`,
      "anomalies",
    ),

  hierarchieCentre: (f: GlobalFilters) =>
    downloadXlsxFromBackend(
      `/api/releve/export/hierarchie-centre${qs(globalQs(f))}`,
      "hierarchie_centres",
    ),

  secteurDetail: (params: { strId: number; sectId: number; annee: number; mois: number }) =>
    downloadXlsxFromBackend(
      `/api/releve/export/secteur-detail${qs({
        str_id:  params.strId,
        sect_id: params.sectId,
        annee:   params.annee,
        mois:    params.mois,
      })}`,
      `secteur_${params.strId}_${params.sectId}_${params.annee}_${String(params.mois).padStart(2, "0")}`,
    ),

  relevesList: (params: {
    filters: GlobalFilters; idComp?: number | null;
    consoCat?: string | null; q?: string;
  }) =>
    downloadXlsxFromBackend(
      `/api/releve/export/releves-list${qs({
        ...globalQs(params.filters),
        id_comp:   params.idComp ?? null,
        conso_cat: params.consoCat ?? null,
        q:         params.q ?? null,
      })}`,
      "releves",
    ),
};
