// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// TAXONOMIE DES SIGNALEMENTS — catégories → sous-catégories,
// entièrement configurable depuis l'administration (aucune
// modification de code nécessaire pour ajouter/renommer/
// réorganiser une catégorie ou une sous-catégorie).
// ============================================================

// 16 icônes, une par catégorie (les sous-catégories n'en ont pas
// besoin : elles se choisissent depuis la liste de leur catégorie,
// déjà identifiée par son icône).
const ICONES = {
  route: '<path d="M9.3 6.2h5.4M7.5 12h9M3 20h18M6 20 12 3l6 17"/>',
  ampoule: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.45 1 1.15 1.1 1.9l.1.8h5l.1-.8c.1-.75.5-1.45 1.1-1.9A6 6 0 0 0 12 3Z"/>',
  poubelle: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6"/>',
  parking: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 16V8h3.5a2.5 2.5 0 0 1 0 5H9"/>',
  arbre: '<path d="M12 22v-6M9 16h6M12 16c-3.9 0-7-2.7-7-6a5.6 5.6 0 0 1 2.6-4.7A5.3 5.3 0 0 1 12 2a5.3 5.3 0 0 1 4.4 3.3A5.6 5.6 0 0 1 19 10c0 3.3-3.1 6-7 6Z"/>',
  banc: '<path d="M4 11h16M5 11V8h14v3M6 11v7M18 11v7M3 18h18"/>',
  panneau: '<path d="M12 13v9M12 2v3M5 5h11l3 4-3 4H5V5Z"/>',
  jeux: '<circle cx="8" cy="8" r="3"/><path d="M14 21v-6l3-3 4 4M3 21h18M14 15l-4 6"/>',
  eau: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  accessibilite: '<circle cx="12" cy="5" r="1.6"/><path d="M6 9h12M12 9v6M9 21l3-6 3 6M9 12l-3 2M15 12l3 2"/>',
  securite: '<path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z"/><path d="M9.5 12 11 13.5 15 9.5"/>',
  batiment: '<path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M9 11h.01M15 11h.01M9 15h.01M15 15h.01"/>',
  animal: '<circle cx="7" cy="8" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="17" cy="8" r="1.6"/><circle cx="9.5" cy="12" r="1.6"/><path d="M12 22c-3 0-5-1.8-5-4.2 0-2 1.6-3.3 3-4.3 1-.7 1-1.5 2-1.5s1 .8 2 1.5c1.4 1 3 2.3 3 4.3 0 2.4-2 4.2-5 4.2Z"/>',
  affichage: '<rect x="4" y="4" width="16" height="12" rx="1"/><path d="M9 20h6M12 16v4"/>',
  meteo: '<path d="M7 16a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 10a3.5 3.5 0 0 1-.5 6.97"/><path d="M8 20l-1 2M12 19l-1 3M16 20l-1 2"/>',
  autre: '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.2"/><circle cx="12" cy="17" r="1"/>',
};

export function svgIcone(cle, taille = 22, couleurTrait = 'currentColor') {
  const chemin = ICONES[cle] || ICONES.autre;
  return `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="none" stroke="${couleurTrait}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${chemin}</svg>`;
}

export const LIBELLES_ICONES = Object.keys(ICONES);

export const LIBELLES_PRIORITE = {
  urgent: { libelle: 'Urgent', emoji: '🔴', couleur: '#ef5350' },
  important: { libelle: 'Important', emoji: '🟠', couleur: '#f5a623' },
  normal: { libelle: 'Normal', emoji: '🟡', couleur: '#e0c341' },
  faible: { libelle: 'Faible', emoji: '🟢', couleur: '#3ddc97' },
};

export const LIBELLES_STATUT = {
  nouveau: 'Nouveau',
  pris_en_compte: 'Pris en compte',
  en_cours: 'En cours',
  en_attente: 'En attente',
  resolu: 'Résolu',
  cloture: 'Clôturé',
  non_recevable: 'Non recevable',
};

// ------------------------------------------------------------
// Lecture (citoyens + agents)
// ------------------------------------------------------------
export async function chargerCategories(supabase, { toutesInclusInactives = false } = {}) {
  let requete = supabase.from('categories_signalement').select('*').order('sort_order');
  if (!toutesInclusInactives) requete = requete.eq('is_active', true);
  const { data, error } = await requete;
  if (error) { console.error('Chargement des catégories impossible :', error); return []; }
  return data || [];
}

export async function chargerSousCategories(supabase, categoryId, { toutesInclusInactives = false } = {}) {
  let requete = supabase.from('sous_categories_signalement').select('*').eq('category_id', categoryId).order('sort_order');
  if (!toutesInclusInactives) requete = requete.eq('is_active', true);
  const { data, error } = await requete;
  if (error) { console.error('Chargement des sous-catégories impossible :', error); return []; }
  return data || [];
}

export async function chargerToutesSousCategories(supabase, { toutesInclusInactives = false } = {}) {
  let requete = supabase.from('sous_categories_signalement').select('*').order('sort_order');
  if (!toutesInclusInactives) requete = requete.eq('is_active', true);
  const { data, error } = await requete;
  if (error) { console.error('Chargement des sous-catégories impossible :', error); return []; }
  return data || [];
}

export async function chargerServices(supabase, { toutesInclusInactifs = false } = {}) {
  let requete = supabase.from('services_municipaux').select('*').order('sort_order');
  if (!toutesInclusInactifs) requete = requete.eq('actif', true);
  const { data, error } = await requete;
  if (error) { console.error('Chargement des services impossible :', error); return []; }
  return data || [];
}

// ------------------------------------------------------------
// Écriture (administration uniquement — la base applique la
// vraie restriction via RLS, ceci n'est qu'un confort d'appel)
// ------------------------------------------------------------
export async function enregistrerCategorie(supabase, categorie) {
  const { error } = await supabase.from('categories_signalement')
    .upsert({ ...categorie, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function supprimerCategorie(supabase, id) {
  const { error } = await supabase.from('categories_signalement').delete().eq('id', id);
  if (error) throw error;
}

export async function basculerActiveCategorie(supabase, id, is_active) {
  const { error } = await supabase.from('categories_signalement')
    .update({ is_active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function enregistrerSousCategorie(supabase, sousCategorie) {
  const { error } = await supabase.from('sous_categories_signalement')
    .upsert({ ...sousCategorie, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function supprimerSousCategorie(supabase, id) {
  const { error } = await supabase.from('sous_categories_signalement').delete().eq('id', id);
  if (error) throw error;
}

export async function basculerActiveSousCategorie(supabase, id, is_active) {
  const { error } = await supabase.from('sous_categories_signalement')
    .update({ is_active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// Réordonnancement : reçoit la liste ordonnée des id, réécrit
// sort_order en conséquence (1, 2, 3…).
export async function reordonner(supabase, table, idsOrdonnes) {
  const maj = idsOrdonnes.map((id, i) =>
    supabase.from(table).update({ sort_order: i + 1 }).eq('id', id)
  );
  const resultats = await Promise.all(maj);
  const erreur = resultats.find((r) => r.error);
  if (erreur) throw erreur.error;
}

// Génère un identifiant lisible et unique à partir d'un nom
// (ex. "Nid-de-poule" -> "nid-de-poule"). Utilisé par l'admin à
// la création : évite de demander un id technique à la personne.
export function slugify(nom) {
  return nom
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
