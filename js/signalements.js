// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// SIGNALEMENTS terrain — classés par catégorie → sous-catégorie
// (voir categories.js pour la taxonomie), posés à la position
// GPS courante.
// ============================================================

import { svgIcone, LIBELLES_PRIORITE, LIBELLES_STATUT } from './categories.js';

// ------------------------------------------------------------
// Photos
//
// Le compartiment de stockage est privé : les photos ne sont
// jamais accessibles par une URL devinée. L'affichage passe par
// une URL signée à durée limitée, générée pour un compte
// autorisé uniquement.
// ------------------------------------------------------------
const COMPARTIMENT_PHOTOS = 'signalements';
const LARGEUR_MAX_PHOTO = 1600;
const QUALITE_PHOTO = 0.82;

// Réduit et compresse la photo avant envoi : une photo brute de
// téléphone pèse plusieurs mégaoctets, ce qui sature le forfait
// de stockage et rend l'envoi très lent en 4G sur le terrain.
export function compresserPhoto(fichier) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error('Lecture de la photo impossible.'));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Photo illisible ou format non pris en charge.'));
      img.onload = () => {
        const ratio = Math.min(1, LARGEUR_MAX_PHOTO / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Compression impossible.'))),
          'image/jpeg',
          QUALITE_PHOTO
        );
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });
}

export async function envoyerPhoto(supabase, session, signalementId, fichier) {
  if (!session) throw new Error('Connexion requise.');

  const blob = await compresserPhoto(fichier);
  // Le chemin commence par l'identifiant du compte : les policies
  // de stockage s'appuient dessus pour interdire l'écriture dans
  // le dossier d'autrui.
  const chemin = `${session.user.id}/${signalementId}.jpg`;

  const { error } = await supabase.storage
    .from(COMPARTIMENT_PHOTOS)
    .upload(chemin, blob, { contentType: 'image/jpeg', upsert: true });

  if (error) throw error;

  const { error: errMaj } = await supabase
    .from('signalements')
    .update({ photo_chemin: chemin })
    .eq('id', signalementId);

  if (errMaj) throw errMaj;
  return chemin;
}

// URL temporaire (1 heure) pour afficher une photo du compartiment privé
export async function urlPhoto(supabase, chemin) {
  if (!chemin) return null;
  const { data, error } = await supabase.storage
    .from(COMPARTIMENT_PHOTOS)
    .createSignedUrl(chemin, 3600);
  if (error) {
    console.warn('URL de photo indisponible :', error);
    return null;
  }
  return data?.signedUrl || null;
}

// ------------------------------------------------------------
// Enregistrement
// ------------------------------------------------------------
export async function creerSignalement(supabase, session, { sousCategorieId, prioriteDefaut, lat, lng, commentaire }) {
  if (!session) throw new Error('Connexion requise pour signaler.');
  if (!sousCategorieId) throw new Error('Sous-catégorie manquante.');
  if (lat == null || lng == null) throw new Error('Position indisponible.');

  const { data, error } = await supabase
    .from('signalements')
    .insert({
      user_id: session.user.id,
      sous_categorie_id: sousCategorieId,
      priorite: prioriteDefaut || 'normal',
      statut: 'nouveau',
      lat,
      lng,
      commentaire: commentaire || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Lit depuis vue_signalements : la vue joint déjà catégorie,
// sous-catégorie et service (évite 3 requêtes séparées par
// affichage). La vue hérite des mêmes policies RLS que la table
// "signalements" (security_invoker) : rien de plus n'est exposé.
export async function chargerSignalements(supabase, { userId = null, statut = null } = {}) {
  let requete = supabase.from('vue_signalements').select('*').order('created_at', { ascending: false });
  if (userId) requete = requete.eq('user_id', userId);
  if (statut) requete = requete.eq('statut', statut);

  const { data, error } = await requete;
  if (error) {
    console.error('Chargement des signalements impossible :', error);
    return [];
  }
  return data || [];
}

export async function changerStatutSignalement(supabase, session, id, statut) {
  const maj = { statut };
  if (statut === 'resolu' || statut === 'cloture') {
    maj.traite_at = new Date().toISOString();
    maj.traite_par = session ? session.user.id : null;
  } else {
    maj.traite_at = null;
    maj.traite_par = null;
  }
  const { error } = await supabase.from('signalements').update(maj).eq('id', id);
  if (error) throw error;
}

export async function changerPrioriteSignalement(supabase, id, priorite) {
  const { error } = await supabase.from('signalements').update({ priorite }).eq('id', id);
  if (error) throw error;
}

export async function supprimerSignalement(supabase, id, cheminPhoto = null) {
  // La photo est retirée du stockage AVANT la ligne : si l'ordre
  // était inversé et que la suppression échouait, le fichier
  // resterait orphelin sans moyen de le retrouver.
  if (cheminPhoto) {
    const { error: errPhoto } = await supabase.storage
      .from(COMPARTIMENT_PHOTOS)
      .remove([cheminPhoto]);
    if (errPhoto) console.warn('Photo non supprimée du stockage :', errPhoto);
  }

  const { error } = await supabase.from('signalements').delete().eq('id', id);
  if (error) throw error;
}

// ------------------------------------------------------------
// Affichage sur la carte
//
// Icône = catégorie (identification visuelle immédiate).
// Couleur du marqueur = priorité (urgence visible d'un coup
// d'œil), conformément aux 4 niveaux 🔴🟠🟡🟢.
// ------------------------------------------------------------
const STATUTS_CLOS = ['resolu', 'cloture', 'non_recevable'];

export function creerMarqueurSignalement(signalement, options = {}) {
  const {
    auteur = null,
    supabase = null,
    surSuppression = null,
    surTraitement = null,
    peutSupprimer = false,
    peutTraiter = false,
  } = options;

  const priorite = LIBELLES_PRIORITE[signalement.priorite] || LIBELLES_PRIORITE.normal;
  const icone = signalement.categorie_icone || 'autre';
  const nomAffiche = signalement.sous_categorie_nom || signalement.categorie_nom || 'Signalement';

  const el = document.createElement('div');
  el.className = 'marqueur-signalement';
  const clos = STATUTS_CLOS.includes(signalement.statut);
  if (clos) el.classList.add('traite');
  el.style.background = priorite.couleur;
  el.innerHTML = svgIcone(icone, 16, '#0a0e1a');
  el.title = nomAffiche;

  const date = new Date(signalement.created_at).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const contenu = document.createElement('div');
  contenu.className = 'popup-signalement';
  contenu.innerHTML = `
    <div class="ps-titre" style="color:${priorite.couleur}">${priorite.emoji} ${nomAffiche}</div>
    <div class="ps-meta">${signalement.categorie_nom || ''}${signalement.categorie_nom ? ' · ' : ''}${auteur ? auteur + ' · ' : ''}${date}</div>
    ${signalement.commentaire ? `<div class="ps-note">« ${signalement.commentaire} »</div>` : ''}
    <div class="ps-statut">${LIBELLES_STATUT[signalement.statut] || signalement.statut}</div>
    <div class="ps-photo" data-photo></div>
    ${peutTraiter ? `
      <select class="ps-statut-select" data-statut-select>
        ${Object.entries(LIBELLES_STATUT).map(([v, l]) => `<option value="${v}" ${signalement.statut === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>` : ''}
    ${peutSupprimer ? '<button class="ps-supprimer" data-supprimer>Supprimer</button>' : ''}
  `;

  // Photo chargée à la demande, via une URL signée temporaire
  if (signalement.photo_chemin && supabase) {
    urlPhoto(supabase, signalement.photo_chemin).then((url) => {
      const zone = contenu.querySelector('[data-photo]');
      if (!url || !zone) return;
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Photo du signalement ${nomAffiche}`;
      img.loading = 'lazy';
      img.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
      zone.appendChild(img);
    });
  }

  if (peutTraiter && surTraitement) {
    contenu.querySelector('[data-statut-select]')?.addEventListener('change', (e) => {
      surTraitement(signalement, e.target.value);
    });
  }

  if (peutSupprimer && surSuppression) {
    contenu.querySelector('[data-supprimer]')?.addEventListener('click', () => {
      surSuppression(signalement);
    });
  }

  const popup = new maplibregl.Popup({ offset: 18, closeButton: true, maxWidth: '260px' }).setDOMContent(contenu);

  return new maplibregl.Marker({ element: el }).setLngLat([signalement.lng, signalement.lat]).setPopup(popup);
}
