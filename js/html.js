// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// Échappement HTML — à utiliser pour toute donnée utilisateur
// (commentaire, nom de profil, nom de catégorie…) interpolée
// dans une chaîne assignée à innerHTML. Sans ça, un commentaire
// de signalement ou un nom de profil peut exécuter du script
// dans le navigateur de quiconque l'affiche (XSS stockée).
// ============================================================
export function echapperHtml(texte) {
  if (texte == null) return '';
  return String(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
