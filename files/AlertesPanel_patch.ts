// MODIFICATION À APPORTER DANS AlertesPanel.tsx
// ================================================
// 1. Ajouter cet import en haut du fichier, après les imports existants :

import { useAlerteStream } from "@/hooks/useAlerteStream";

// 2. Dans le composant AlertesPanel, après les déclarations existantes,
//    ajouter ces 3 lignes :

const { connected, nbNew, resetNbNew } = useAlerteStream();

// 3. Réinitialiser le compteur quand l'onglet alertes est ouvert
//    (optionnel — ajouter dans un useEffect) :

// useEffect(() => { resetNbNew(); }, [resetNbNew]);

// 4. Afficher l'indicateur de connexion SSE — ajouter dans le JSX
//    juste après le div className="space-y-5" :

/*
<div className="flex items-center gap-2 text-xs text-slate-500">
  <span
    className={`inline-block h-2 w-2 rounded-full ${
      connected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
    }`}
  />
  {connected ? "Temps réel actif" : "Reconnexion…"}
  {nbNew > 0 && (
    <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
      +{nbNew} nouvelle{nbNew > 1 ? "s" : ""}
    </span>
  )}
</div>
*/
