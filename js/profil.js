// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// PHOTOS DE PROFIL
//
// Le compartiment de stockage est privé : l'affichage passe par
// une URL signée à durée limitée, jamais par une adresse
// devinable.
// ============================================================

const COMPARTIMENT = 'avatars';
const TAILLE_AVATAR = 400;   // suffisant pour une pastille sur la carte
const QUALITE = 0.85;

// Cache des URL signées : sans lui, afficher dix marqueurs
// déclencherait dix appels réseau pour la même photo.
const cacheUrls = new Map();

// Recadre au carré et compresse : une photo de téléphone pèse
// plusieurs mégaoctets pour une pastille de 40 pixels.
export function preparerAvatar(fichier) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error('Lecture de la photo impossible.'));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Photo illisible ou format non pris en charge.'));
      img.onload = () => {
        // Recadrage centré au carré
        const cote = Math.min(img.width, img.height);
        const sx = (img.width - cote) / 2;
        const sy = (img.height - cote) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = TAILLE_AVATAR;
        canvas.height = TAILLE_AVATAR;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, cote, cote, 0, 0, TAILLE_AVATAR, TAILLE_AVATAR);

        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Compression impossible.'))),
          'image/jpeg',
          QUALITE
        );
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });
}

export async function envoyerAvatar(supabase, session, fichier) {
  if (!session) throw new Error('Connexion requise.');

  const blob = await preparerAvatar(fichier);
  // Le chemin commence par l'identifiant du compte : les règles
  // de stockage s'appuient dessus pour interdire l'écriture dans
  // le dossier d'un autre.
  const chemin = `${session.user.id}/avatar.jpg`;

  const { error } = await supabase.storage
    .from(COMPARTIMENT)
    .upload(chemin, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;

  const { error: errMaj } = await supabase
    .from('profils')
    .update({ avatar_chemin: chemin })
    .eq('user_id', session.user.id);
  if (errMaj) throw errMaj;

  cacheUrls.delete(chemin);
  return chemin;
}

export async function retirerAvatar(supabase, session, chemin) {
  if (!session) throw new Error('Connexion requise.');
  if (chemin) {
    await supabase.storage.from(COMPARTIMENT).remove([chemin]);
    cacheUrls.delete(chemin);
  }
  const { error } = await supabase
    .from('profils')
    .update({ avatar_chemin: null })
    .eq('user_id', session.user.id);
  if (error) throw error;
}

export async function urlAvatar(supabase, chemin) {
  if (!chemin) return null;
  if (cacheUrls.has(chemin)) return cacheUrls.get(chemin);

  const { data, error } = await supabase.storage.from(COMPARTIMENT).createSignedUrl(chemin, 3600);
  if (error) {
    console.warn('Photo de profil indisponible :', error);
    return null;
  }
  const url = data?.signedUrl || null;
  cacheUrls.set(chemin, url);
  return url;
}

// Identités de l'équipe : nom et photo, rien d'autre.
export async function chargerIdentites(supabase) {
  const { data, error } = await supabase.from('vue_identites').select('*');
  if (error) {
    console.warn('Identités indisponibles :', error);
    return new Map();
  }
  return new Map((data || []).map((i) => [i.user_id, i]));
}

// Initiales, utilisées quand aucune photo n'a été déposée
export function initiales(nom) {
  if (!nom) return '?';
  return nom
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((m) => m[0])
    .join('')
    .toUpperCase();
}

// ------------------------------------------------------------
// Pastille ronde affichable sur la carte ou dans une liste
// ------------------------------------------------------------
export function creerPastille(nom, { taille = 40, couleur = '#3fb6f5' } = {}) {
  const el = document.createElement('div');
  el.className = 'pastille-identite';
  el.style.width = `${taille}px`;
  el.style.height = `${taille}px`;
  el.style.borderColor = couleur;
  el.title = nom || '';

  const texte = document.createElement('span');
  texte.className = 'pastille-initiales';
  texte.style.fontSize = `${Math.round(taille * 0.36)}px`;
  texte.textContent = initiales(nom);
  el.appendChild(texte);

  return el;
}

// Remplace les initiales par la photo dès qu'elle est disponible.
// L'affichage n'attend jamais le réseau : les initiales restent
// visibles si la photo tarde ou manque.
export async function habillerPastille(el, supabase, chemin) {
  if (!el || !chemin) return;
  const url = await urlAvatar(supabase, chemin);
  if (!url) return;
  el.style.backgroundImage = `url("${url}")`;
  el.classList.add('avec-photo');
}
