/**
 * frontend/src/hooks/useAlerteStream.ts
 *
 * Hook React — connexion SSE vers /api/stream/alertes
 *
 * Usage :
 *   const { alertes, connected } = useAlerteStream()
 *
 * - Reçoit les nouvelles alertes en temps réel via SSE
 * - Reconnexion automatique si le réseau coupe
 * - Fusionne avec les alertes existantes (polling React Query)
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ────────────────────────────────────────────────────────────
export interface AlerteSSE {
  alert_id   : number;
  alert_type : string;
  STR_ID     : number;
  SECT_ID    : number;
  ANNEE      : number;
  MOIS       : number;
  pct_avant  : number;
  pct_apres  : number;
  detected_at: string;
  SECT_LIB   : string | null;
  CENTRE_LIB : string | null;
}

interface UseAlerteStreamResult {
  connected  : boolean;           // SSE connecté ?
  lastAlerte : AlerteSSE | null;  // dernière alerte reçue
  nbNew      : number;            // compteur alertes reçues via SSE (non acquittées)
  resetNbNew : () => void;        // réinitialise le compteur
}

// ── Constantes ───────────────────────────────────────────────────────
const SSE_URL           = "/api/stream/alertes";
const RECONNECT_DELAY_MS = 3_000;   // délai avant reconnexion
const MAX_RECONNECT      = 10;       // tentatives max

// ── Hook principal ───────────────────────────────────────────────────
export function useAlerteStream(): UseAlerteStreamResult {
  const qc               = useQueryClient();
  const esRef            = useRef<EventSource | null>(null);
  const reconnectCount   = useRef(0);
  const reconnectTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connected,   setConnected]   = useState(false);
  const [lastAlerte,  setLastAlerte]  = useState<AlerteSSE | null>(null);
  const [nbNew,       setNbNew]       = useState(0);

  const resetNbNew = useCallback(() => setNbNew(0), []);

  const connect = useCallback(() => {
    // Fermer la connexion précédente si elle existe
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(SSE_URL);
    esRef.current = es;

    // Connexion établie
    es.addEventListener("connected", () => {
      setConnected(true);
      reconnectCount.current = 0;
      console.log("[SSE] Connecté à", SSE_URL);
    });

    // Nouvelle alerte reçue depuis le watcher Python
    es.addEventListener("nouvelle_alerte", (e: MessageEvent) => {
      try {
        const alerte: AlerteSSE = JSON.parse(e.data);
        console.log("[SSE] Nouvelle alerte:", alerte);

        setLastAlerte(alerte);
        setNbNew(n => n + 1);

        // Invalider le cache React Query pour forcer le rechargement
        // de la liste complète des alertes (avec tous les détails)
        qc.invalidateQueries({ queryKey: ["alertes-list"] });
        qc.invalidateQueries({ queryKey: ["alertes-count"] });

      } catch (err) {
        console.warn("[SSE] Erreur parsing alerte:", err);
      }
    });

    // Heartbeat — juste un ping, on ne fait rien
    es.addEventListener("heartbeat", () => {
      // Silencieux — sert juste à maintenir la connexion
    });

    // Erreur / déconnexion — reconnexion automatique
    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      if (reconnectCount.current >= MAX_RECONNECT) {
        console.warn("[SSE] Nb max reconnexions atteint — arrêt");
        return;
      }

      reconnectCount.current++;
      const delay = RECONNECT_DELAY_MS * reconnectCount.current;
      console.log(
        `[SSE] Déconnecté — reconnexion dans ${delay}ms `
        + `(tentative ${reconnectCount.current}/${MAX_RECONNECT})`
      );

      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [qc]);

  // Connexion au montage, déconnexion au démontage
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  return { connected, lastAlerte, nbNew, resetNbNew };
}
