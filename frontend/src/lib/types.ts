// ============================================================
// Types DTO renvoyés par FastAPI
// [v2.1] : types CLOTURE alignés sur v_secteur_cycle
// ============================================================

export interface KpiGlobal {
  total: number;
  accessible: number; illisible: number; defectueux: number;
  bloque: number; inaccessible: number; vole: number;
  non_valides: number;
  conso_nulle: number; conso_faible: number; conso_elevee: number;
  computed_at?: string;
}

export interface EtatComptageRow {
  ID_COMP: number;
  ETAT_COMPTAGE: string;
  nb: number; total: number; pct: number;
}

export interface Fiabilite {
  total: number;
  fiables: number;
  a_controler: number;
  pct_a_controler: number;
}

export interface AnomalieRow {
  REL_ID: number; REL_DATE: string;
  ABN_ID: number; CPT_REF: string; MATRICULE: string;
  STR_ID: number; CENTRE_LIB: string;
  SECT_ID: number; SECT_LIB: string;
  REL_INDEX: number | null;
  REL_ANCIEN_INDEX: number | null;
  REL_CONSOM_CALCUL: number | null;
  ID_COMP: number; COMPTAGE_LIB: string; ETAT_COMPTAGE: string;
  CONSO_CAT: string;
  REL_VALIDE: number;
}

export interface CentreRow {
  STR_ID: number; CENTRE_LIB: string;
  nb_releves: number;
  nb_accessible: number; nb_a_controler: number; nb_non_valides: number;
  nb_conso_nulle: number; nb_conso_faible: number; nb_conso_elevee: number;
  conso_moy: number;
}

export interface EvolutionRow {
  jour: string;
  nb_releves: number;
  nb_accessible: number;
  nb_non_valides: number;
}

export interface CentreListItem {
  STR_ID: number;
  CENTRE_LIB: string;
}

export interface SecteurListItem {
  SECT_ID: number;
  SECT_LIB: string;
}

export interface ReleveDetail {
  REL_ID: number; REL_DATE: string;
  REL_ANNEE: number; REL_MOIS: number;
  CPT_REF: string; ABN_ID: number; MATRICULE: string;
  STR_ID: number; CENTRE_LIB: string;
  SECT_ID: number; SECT_LIB: string;
  REL_ANCIEN_INDEX: number | null;
  REL_INDEX: number | null;
  REL_CONSOM_CALCUL: number | null;
  REL_MOYENNE_CONSOM: number | null;
  REL_NBR_JR: number | null;
  ID_COMP: number; ETAT_COMPTAGE: string;
  CONSO_CAT: string;
  REL_VALIDE: number; REL_ESTIMATIF: number;
}

export interface ReleveListResponse {
  total: number;
  rows: ReleveDetail[];
}

export interface ScopeInfo {
  date_min: string | null;
  date_max: string | null;
  total: number;
}

// ============================================================
// 🆕 Types Suivi Temps Réel (CLOTURE_SECTEUR)
// ============================================================

export interface PilotageGlobal {
  cycle_key: number;
  annee: number;
  mois: number;
  nb_secteurs: number;
  parc_total: number;
  saisis: number;
  restant: number;
  pct_avancement: number;
  nb_en_cours: number;
  nb_a_valider: number;
  nb_valides: number;
  nb_secteurs_0pct: number;
  nb_secteurs_avances: number;
  nb_secteurs_presque_fini: number;
  volume_facture: number;
  volume_estime: number;
  pct_estimation_global: number;
  computed_at: string;
}

export interface PilotageCentreRow {
  STR_ID: number;
  CENTRE_LIB: string;
  ANNEE: number;
  MOIS: number;
  CYCLE_KEY: number;
  nb_secteurs: number;
  parc_total: number;
  saisis: number;
  restant: number;
  pct_avancement: number;
  nb_a_0pct: number;
  nb_avances: number;
  nb_clotures: number;
  nb_valides: number;
}

// 🆕 Ligne de v_secteur_cycle — utilisée dans AvancementSaisiePanel
export interface AvancementSaisieRow {
  IDCLOTURE: number;
  centre_code: number;
  centre_libelle: string;
  secteur_code: number;
  secteur_libelle: string;
  ANNEE: number; MOIS: number; cycle_key: number;

  parc_cloture: number;
  parc_abonnement_actif: number | null;
  saisis_declare: number;
  saisis_reel: number;
  restant: number;
  pct_avancement: number;
  volume_facture: number;
  volume_estime: number;
  pct_estimation: number;

  CLOTURE: number;
  FLAG_CALCUL: number;
  FLAG_VALID: number;
  statut: string;
  avancement_cat: string;
  matricule_clotureur: string;
  DATE_CLOT: string | null;

  // États comptage
  nb_accessible: number;
  nb_illisible: number;
  nb_defectueux: number;
  nb_bloque: number;
  nb_inaccessible: number;
  nb_vole: number;

  // Catégories consommation
  nb_conso_nulle: number;
  nb_conso_faible: number;
  nb_conso_normale: number;
  nb_conso_elevee: number;
  conso_totale: number | null;

  // Anomalies
  nb_estimes: number;
  nb_index_decroissant: number;
  nb_valides_releve: number;
  nb_non_valides_releve: number;
  nb_releveurs: number;
  derniere_saisie: string | null;
  ecart_nbtraiter: number;

  // Flags d'alerte (uniquement si CLOTURE = 0)
  flag_seuil_80: number;
  flag_trop_nulle: number;
  flag_trop_estime: number;
}

export interface CycleDispo {
  ANNEE: number;
  MOIS: number;
  CYCLE_KEY: number;
}

export interface AlerteRow {
  alert_id: number;
  alert_type: string;
  STR_ID: number;
  CENTRE_LIB: string;
  SECT_ID: number;
  SECT_LIB: string;
  ANNEE: number;
  MOIS: number;
  pct_avant: number;
  pct_apres: number;
  detected_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface SecteurDetailReleve {
  REL_ID: number;
  REL_DATE: string;
  DATE_GEN: string;
  CPT_REF: string;
  ABN_ID: number;
  MATRICULE: string;
  REL_INDEX: number | null;
  REL_ANCIEN_INDEX: number | null;
  REL_CONSOM_CALCUL: number | null;
  REL_MOYENNE_CONSOM: number | null;
  REL_NBR_JR: number | null;
  REL_ESTIMATIF: number;
  ID_COMP: number;
  ETAT_COMPTAGE: string;
  CONSO_CAT: string;
  REL_VALIDE: number;
  REL_ORIGINE: string;
  flag_index_decroissant: number;
}

export interface SecteurDetailReleveur {
  MATRICULE: string;
  nb: number;
  nb_estimes: number;
  nb_nulle: number;
  nb_valides: number;
  nb_non_valides: number;
  derniere_saisie: string;
}

export interface SecteurDetailResponse {
  header: AvancementSaisieRow;
  releveurs: SecteurDetailReleveur[];
  rows: SecteurDetailReleve[];
}