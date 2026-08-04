// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// SIGNALEMENTS terrain — travaux, déchets, élagage, danger,
// signalétique. Posés à la position GPS courante, rattachés au
// parcours en cours s'il y en a un.
// ============================================================

export const TYPES_SIGNALEMENT = {
  travaux: {
    libelle: 'Travaux',
    couleur: '#f5a623',
    // Cône de chantier
    icone: '<path d="M9.3 6.2h5.4M7.5 12h9M3 20h18M6 20 12 3l6 17"/>',
  },
  dechet: {
    libelle: 'Déchet',
    couleur: '#8b6f47',
    // Corbeille
    icone: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6"/>',
  },
  elagage: {
    libelle: 'Élagage',
    couleur: '#3ddc97',
    // Arbre
    icone: '<path d="M12 22v-6M9 16h6M12 16c-3.9 0-7-2.7-7-6a5.6 5.6 0 0 1 2.6-4.7A5.3 5.3 0 0 1 12 2a5.3 5.3 0 0 1 4.4 3.3A5.6 5.6 0 0 1 19 10c0 3.3-3.1 6-7 6Z"/>',
  },
  danger: {
    libelle: 'Danger',
    couleur: '#ef5350',
    // Triangle d'alerte
    icone: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/>',
  },
  signaletique: {
    libelle: 'Signalétique',
    couleur: '#3fb6f5',
    // Panneau
    icone: '<path d="M12 13v9M12 2v3M5 5h11l3 4-3 4H5V5Z"/>',
  },
};

export function svgSignalement(type, taille = 20, couleurTrait = 'currentColor') {
  const def = TYPES_SIGNALEMENT[type];
  if (!def) return '';
  return `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="none" stroke="${couleurTrait}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${def.icone}</svg>`;
}

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
export async function creerSignalement(supabase, session, { type, lat, lng, commentaire, parcoursId }) {
  if (!session) throw new Error('Connexion requise pour signaler.');
  if (!TYPES_SIGNALEMENT[type]) throw new Error(`Type de signalement inconnu : ${type}`);
  if (lat == null || lng == null) throw new Error('Position indisponible.');

  const { data, error } = await supabase
    .from('signalements')
    .insert({
      user_id: session.user.id,
      parcours_id: parcoursId || null,
      type,
      lat,
      lng,
      commentaire: commentaire || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function chargerSignalements(supabase, { userId = null, statut = null } = {}) {
  let requete = supabase.from('signalements').select('*').order('created_at', { ascending: false });
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
  if (statut === 'traite') {
    maj.traite_at = new Date().toISOString();
    maj.traite_par = session ? session.user.id : null;
  } else {
    maj.traite_at = null;
    maj.traite_par = null;
  }
  const { error } = await supabase.from('signalements').update(maj).eq('id', id);
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
// ------------------------------------------------------------
export function creerMarqueurSignalement(signalement, options = {}) {
  const { auteur = null, supabase = null, surSuppression = null, peutSupprimer = false } = options;

  const def = TYPES_SIGNALEMENT[signalement.type];
  if (!def) return null;

  const el = document.createElement('div');
  el.className = 'marqueur-signalement';
  if (signalement.statut === 'traite') el.classList.add('traite');
  el.style.background = def.couleur;
  el.innerHTML = svgSignalement(signalement.type, 16, '#0a0e1a');
  el.title = def.libelle;

  const date = new Date(signalement.created_at).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const contenu = document.createElement('div');
  contenu.className = 'popup-signalement';
  contenu.innerHTML = `
    <div class="ps-titre" style="color:${def.couleur}">${def.libelle}</div>
    <div class="ps-meta">${auteur ? auteur + ' · ' : ''}${date}</div>
    ${signalement.commentaire ? `<div class="ps-note">« ${signalement.commentaire} »</div>` : ''}
    ${signalement.statut !== 'ouvert' ? `<div class="ps-statut">${signalement.statut === 'traite' ? 'Traité' : 'En cours'}</div>` : ''}
    <div class="ps-photo" data-photo></div>
    ${peutSupprimer ? '<button class="ps-supprimer" data-supprimer>Supprimer ce signalement</button>' : ''}
  `;

  // Photo : chargée à la demande, via une URL signée temporaire
  if (signalement.photo_chemin && supabase) {
    urlPhoto(supabase, signalement.photo_chemin).then((url) => {
      const zone = contenu.querySelector('[data-photo]');
      if (!url || !zone) return;
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Photo du signalement ${def.libelle}`;
      img.loading = 'lazy';
      img.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
      zone.appendChild(img);
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
