// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// Déconnexion automatique après inactivité — utile sur un poste
// municipal partagé : évite qu'une session reste ouverte
// indéfiniment sur un ordinateur utilisé par plusieurs personnes.
// ============================================================

const DELAI_MS = 30 * 60 * 1000; // 30 minutes

const EVENEMENTS_ACTIVITE = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'];

// estConnecte() est appelée à chaque activité pour savoir s'il y a
// une session à surveiller ; deconnecter() est appelée une seule
// fois, au moment du timeout.
export function surveillerInactivite(estConnecte, deconnecter) {
  let minuteur = null;

  function reinitialiser() {
    if (minuteur) clearTimeout(minuteur);
    if (!estConnecte()) return;
    minuteur = setTimeout(() => {
      if (estConnecte()) deconnecter();
    }, DELAI_MS);
  }

  EVENEMENTS_ACTIVITE.forEach((evt) => {
    document.addEventListener(evt, reinitialiser, { passive: true });
  });

  reinitialiser();
}
