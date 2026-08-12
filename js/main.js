// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

import { supabase, getSession, signIn, signUp, signOut, onAuthChange, envoyerLienReinitialisation } from './supabase-client.js';
import { initMap, createUserMarker, updateUserMarker, followUser, changeMapStyle, STYLES, calculerBounds, appliquerMasqueZone } from './map.js';
import { chargerZoneUtilisateur, chargerContourZone } from './zone.js';
import {
  envoyerAvatar, retirerAvatar, urlAvatar, chargerIdentites,
  creerPastille, habillerPastille,
} from './profil.js';
import {
  chargerCategories, chargerSousCategories, svgIcone, LIBELLES_PRIORITE,
} from './categories.js';
import {
  creerSignalement,
  chargerSignalements,
  creerMarqueurSignalement,
  envoyerPhoto,
  supprimerSignalement,
  changerStatutSignalement,
} from './signalements.js';
import { echapperHtml } from './html.js';
import { surveillerInactivite } from './inactivite.js';

let map = null;
let session = null;

// ------------------------------------------------------------
// Estompage de l'UI en cas d'inactivité (carte + point bleu
// toujours visibles, seule l'interface s'estompe)
// ------------------------------------------------------------
const IDLE_DELAY_MS = 4000;
let idleTimer = null;

function resetIdleTimer() {
  document.body.classList.remove('ui-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    document.body.classList.add('ui-idle');
  }, IDLE_DELAY_MS);
}

['pointerdown', 'touchstart', 'mousemove', 'wheel'].forEach((evt) => {
  document.addEventListener(evt, resetIdleTimer, { passive: true });
});
resetIdleTimer();

// ------------------------------------------------------------
// Splash screen
// ------------------------------------------------------------
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('splash').classList.add('hidden');
  }, 2500);
});

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------
const authScreen = document.getElementById('auth-screen');
const authError = document.getElementById('auth-error');
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
let authMode = 'signin'; // 'signin' | 'signup'

document.getElementById('auth-submit')?.addEventListener('click', async () => {
  authError.textContent = '';
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    authError.textContent = 'Renseigne un email et un mot de passe.';
    return;
  }

  if (authMode === 'signup' && password.length < 10) {
    authError.textContent = 'Le mot de passe doit contenir au moins 10 caractères.';
    return;
  }

  const { error } = authMode === 'signin'
    ? await signIn(email, password)
    : await signUp(email, password);

  if (error) {
    authError.style.color = 'var(--danger)';
    authError.textContent = messageErreurAuth(error, authMode);
    return;
  }

  if (authMode === 'signup') {
    authError.style.color = 'var(--ok)';
    authError.textContent = 'Compte créé — vérifiez votre boîte mail pour confirmer l\'adresse.';
  }
});

// L'inscription passe par une liste blanche contrôlée en base.
// Quand une adresse n'y figure pas, Supabase renvoie une erreur
// technique opaque (« Database error saving new user ») qui ne
// dit rien à la personne : on la traduit en message utile.
function messageErreurAuth(error, mode) {
  const brut = (error && error.message ? error.message : '').toLowerCase();

  if (mode === 'signup') {
    if (brut.includes('database error')
        || brut.includes("n'est pas autorisée")
        || brut.includes('not authorized')
        || brut.includes('unexpected_failure')) {
      return "Cette adresse n'est pas autorisée à créer un compte. Demandez à l'administrateur de l'ajouter au préalable.";
    }
    if (brut.includes('already registered') || brut.includes('already been registered')) {
      return 'Un compte existe déjà pour cette adresse. Utilisez « Se connecter », ou « Mot de passe oublié ».';
    }
    if (brut.includes('password') && brut.includes('6')) {
      return 'Le mot de passe doit contenir au moins 6 caractères.';
    }
  }

  if (mode === 'signin') {
    if (brut.includes('invalid login credentials')) {
      return 'Adresse ou mot de passe incorrect.';
    }
    if (brut.includes('email not confirmed')) {
      return "Adresse non confirmée. Ouvrez le lien reçu par courriel avant de vous connecter.";
    }
  }

  return error && error.message ? error.message : 'Une erreur est survenue.';
}

document.getElementById('auth-oubli')?.addEventListener('click', async () => {
  const email = emailInput?.value.trim();
  if (!email) {
    authError.style.color = 'var(--danger)';
    authError.textContent = "Saisissez d'abord votre adresse email, puis réessayez.";
    return;
  }
  authError.style.color = 'var(--ink-dim)';
  authError.textContent = 'Envoi en cours…';

  const { error } = await envoyerLienReinitialisation(email);
  if (error) {
    authError.style.color = 'var(--danger)';
    authError.textContent = error.message;
    return;
  }
  authError.style.color = 'var(--ok)';
  authError.textContent = 'Si un compte existe pour cette adresse, un lien de réinitialisation vient d\'être envoyé.';
});

document.getElementById('auth-toggle')?.addEventListener('click', () => {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  document.getElementById('auth-title').textContent = authMode === 'signin' ? 'Connexion' : 'Créer un compte';
  document.getElementById('auth-submit').textContent = authMode === 'signin' ? 'Se connecter' : "S'inscrire";
  document.getElementById('auth-toggle').textContent = authMode === 'signin'
    ? "Pas de compte ? S'inscrire"
    : 'Déjà un compte ? Se connecter';
});

const ONBOARDING_KEY = 'iter_onboarding_vu';
const onboardingScreen = document.getElementById('onboarding-screen');

let demarrageEnCours = false;

function apresConnexion() {
  if (map || demarrageEnCours) return; // déjà démarré, ou en cours de démarrage
  if (localStorage.getItem(ONBOARDING_KEY)) {
    demarrageEnCours = true;
    startApp().finally(() => { demarrageEnCours = false; });
  } else {
    onboardingScreen.style.display = 'flex';
  }
}

document.getElementById('onboarding-close')?.addEventListener('click', () => {
  localStorage.setItem(ONBOARDING_KEY, '1');
  onboardingScreen.style.display = 'none';
  if (!map && !demarrageEnCours) { demarrageEnCours = true; startApp().finally(() => { demarrageEnCours = false; }); }
});

document.getElementById('btn-aide')?.addEventListener('click', () => {
  onboardingScreen.style.display = 'flex';
});

onAuthChange((s) => {
  session = s;
  authScreen.style.display = session ? 'none' : 'flex';
  if (session) apresConnexion();
});

surveillerInactivite(() => !!session, () => signOut());

getSession().then((s) => {
  session = s;
  authScreen.style.display = session ? 'none' : 'flex';
  if (session) apresConnexion();
});

// ------------------------------------------------------------
// Suivi GPS continu — point bleu + mode "follow" type navigation
// ------------------------------------------------------------
let userMarker = null;
let followMode = true;
let liveWatchId = null;
let dernierePosition = null; // { lat, lng, accuracy } — sert au signalement
const btnRecenter = document.getElementById('btn-recenter');

const MAP_STYLE_KEY = 'iter_map_style';

// ------------------------------------------------------------
// Profil et droits de l'utilisateur connecté.
//
// L'interface masque ce qui n'est pas permis, mais ce masquage
// n'est qu'un confort : la base refuse de toute façon toute
// opération non autorisée, quel que soit ce que fait le client.
// ------------------------------------------------------------
let profil = null;                    // { role, nom, avatar_chemin }
let droits = { te: {} };

function peut(droit) {
  if (profil && profil.role === 'administrateur') return true;
  return Boolean(droits.te && droits.te[droit]);
}

async function chargerProfilEtDroits() {
  if (!session) return;

  const [resProfil, resDroits] = await Promise.all([
    supabase.from('profils').select('role, nom, avatar_chemin').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('droits').select('domaine, consulter, enregistrer, traiter, modifier, supprimer, acces_dashboard')
      .eq('user_id', session.user.id).eq('domaine', 'te'),
  ]);

  profil = resProfil.data || { role: 'utilisateur', nom: null, avatar_chemin: null };
  droits = { te: (resDroits.data && resDroits.data[0]) || {} };

  appliquerDroitsInterface();
  majPastilleTopbar();
  majPhotoPosition();
}

// ------------------------------------------------------------
// Photo de profil
// ------------------------------------------------------------
function majPastilleTopbar() {
  const zone = document.getElementById('profil-pastille');
  if (!zone) return;
  zone.innerHTML = '';
  const p = creerPastille(profil?.nom, { taille: 38 });
  zone.appendChild(p);
  habillerPastille(p, supabase, profil?.avatar_chemin);
}

// Le visage remplace le point bleu sur la carte, à la position
// courante. Le halo qui pulse et le cercle de précision sont
// conservés : ils portent une information que la photo n'a pas.
async function majPhotoPosition() {
  if (!userMarker) return;
  const el = userMarker.getElement();
  if (!el) return;

  let photo = el.querySelector('.user-dot-photo');
  const url = profil?.avatar_chemin ? await urlAvatar(supabase, profil.avatar_chemin) : null;

  if (!url) {
    if (photo) photo.remove();
    el.querySelector('.user-dot-core')?.style.removeProperty('display');
    return;
  }

  if (!photo) {
    photo = document.createElement('div');
    photo.className = 'user-dot-photo';
    photo.style.width = '34px';
    photo.style.height = '34px';
    el.appendChild(photo);
  }
  photo.style.backgroundImage = `url("${url}")`;
  // Le point central est masqué : la photo le remplace
  const coeur = el.querySelector('.user-dot-core');
  if (coeur) coeur.style.display = 'none';
}

function appliquerDroitsInterface() {
  const estAdmin = profil && profil.role === 'administrateur';

  // Supervision : ouverte aux administrateurs ET aux comptes ayant
  // le droit explicite « acces_dashboard » (domaine te), distinct
  // du rôle administrateur complet.
  const accesDashboard = estAdmin || Boolean(droits.te && droits.te.acces_dashboard);
  const lienSupervision = document.getElementById('lien-supervision');
  if (lienSupervision) lienSupervision.style.display = accesDashboard ? 'flex' : 'none';

  // Le bouton flottant « Signaler » n'apparaît que si la personne
  // a le droit correspondant. Ce n'est qu'un confort d'affichage :
  // la base refuse de toute façon une opération non autorisée.
  const btnSignaler = document.getElementById('btn-signaler');
  const peutSignaler = peut('enregistrer');
  if (btnSignaler) btnSignaler.style.display = peutSignaler ? 'flex' : 'none';

  const conteneur = document.getElementById('boutons-flottants');
  if (conteneur) conteneur.style.display = peutSignaler ? 'flex' : 'none';
}

let contourZoneActive = null; // GeoJSON du contour de la zone en cours, réutilisé après changement de fond

async function startApp() {
  chargerProfilEtDroits();

  // Zone (1 zone = 1 ville) : la carte est bornée et masquée à la
  // zone de la personne connectée avant même sa première image,
  // pour qu'aucune autre ville ne soit jamais visible en la
  // faisant glisser ou en dézoomant.
  const zone = await chargerZoneUtilisateur(session ? session.user.id : null);
  const bounds = calculerBounds(zone);
  const centre = zone ? [zone.lng, zone.lat] : undefined;

  const stylePref = localStorage.getItem(MAP_STYLE_KEY) || 'standard';
  map = initMap('map', centre, centre ? 14 : undefined, stylePref, bounds);
  map.on('load', () => {
    userMarker = createUserMarker(map);
    userMarker.addTo(map);
    majPhotoPosition();
    startLiveLocationWatch();
    afficherSignalementsExistants();
  });

  // Contour exact de la commune : affiné dès qu'il arrive (le
  // carré de calculerBounds() reste actif entre-temps, donc la
  // carte n'est jamais dé-bornée le temps du chargement).
  if (zone) {
    chargerContourZone(zone).then((contour) => {
      if (!contour) return;
      contourZoneActive = contour;
      if (map.isStyleLoaded()) appliquerMasqueZone(map, contour);
      else map.once('load', () => appliquerMasqueZone(map, contour));
    });
  }

  // Un fond de carte peut devenir indisponible : serveur en panne,
  // couche retirée, zone non couverte. Le repli n'existait que lors
  // d'un changement de fond ; au chargement, la carte restait vide
  // sans explication si le fond enregistré ne répondait plus.
  surveillerFondDeCarte(stylePref);

  marquerStyleActif(stylePref);

  // L'utilisateur bouge la carte lui-même -> on coupe le suivi
  // automatique, comme sur une vraie appli GPS
  map.on('dragstart', () => setFollowMode(false));
  map.on('zoomstart', (e) => {
    if (e.originalEvent) setFollowMode(false);
  });
}

function setFollowMode(active) {
  followMode = active;
  btnRecenter?.classList.toggle('visible', !active);
}

btnRecenter?.addEventListener('click', () => setFollowMode(true));

// ------------------------------------------------------------
// Zoom — boutons dédiés, plus grands que le contrôle natif
// ------------------------------------------------------------
document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
  if (map) map.zoomIn({ duration: 250 });
});
document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
  if (map) map.zoomOut({ duration: 250 });
});

// ------------------------------------------------------------
// Modes Plan — Standard / Plan IGN / Satellite
// ------------------------------------------------------------
const modesPlan = document.getElementById('modes-plan');

function marquerStyleActif(styleKey) {
  document.querySelectorAll('.mp-option').forEach((b) => {
    b.classList.toggle('active', b.dataset.style === styleKey);
  });
}

document.getElementById('btn-modes-plan')?.addEventListener('click', () => {
  marquerStyleActif(localStorage.getItem(MAP_STYLE_KEY) || 'standard');
  modesPlan?.classList.add('visible');
});

document.getElementById('mp-close')?.addEventListener('click', () => {
  modesPlan?.classList.remove('visible');
});

// Fermer en touchant en dehors de la feuille
modesPlan?.addEventListener('click', (e) => {
  if (e.target === modesPlan) modesPlan?.classList.remove('visible');
});

document.querySelectorAll('.mp-option').forEach((btn) => {
  btn?.addEventListener('click', () => {
    const styleKey = btn.dataset.style;
    if (!map || !STYLES[styleKey]) return;
    appliquerStyle(styleKey);
    modesPlan?.classList.remove('visible');
  });
});

function reinjecterCouches() {
  if (userMarker) userMarker.addTo(map);
  if (contourZoneActive) appliquerMasqueZone(map, contourZoneActive);
}

// Surveille les échecs de chargement de tuiles. Au-delà de
// quelques échecs, on bascule sur le fond standard : mieux vaut
// une carte lisible dans un autre style qu'un écran vide.
function surveillerFondDeCarte(styleKey, delaiMs = 12000) {
  if (!map || styleKey === 'standard') return;

  let echecs = 0;
  const SEUIL = 4;

  const surErreur = (e) => {
    const msg = (e && e.error && e.error.message) || '';
    if (!msg.includes('data.geopf.fr') && !msg.includes('tiles.openfreemap')) return;

    echecs++;
    if (echecs < SEUIL) return;

    map.off('error', surErreur);
    console.warn(`Fond « ${styleKey} » injoignable, retour au fond standard.`);

    localStorage.setItem(MAP_STYLE_KEY, 'standard');
    marquerStyleActif('standard');
    changeMapStyle(map, 'standard', reinjecterCouches);

    afficherAlerteCarte(
      "Le fond de carte choisi est momentanément indisponible. "
      + "Le fond standard a été rétabli ; vous pourrez y revenir plus tard depuis les Modes Plan."
    );
    setTimeout(() => afficherAlerteCarte(null), 8000);
  };

  map.on('error', surErreur);
  setTimeout(() => map.off('error', surErreur), delaiMs);
}

function appliquerStyle(styleKey) {
  const note = document.getElementById('mp-erreur');
  if (note) note.style.display = 'none';

  changeMapStyle(
    map,
    styleKey,
    reinjecterCouches,
    // Repli : si les tuiles du fond choisi ne se chargent pas, on
    // revient au fond standard plutôt que de laisser une carte vide
    (echoue) => {
      if (echoue === 'standard') return;
      console.warn(`Fond « ${echoue} » indisponible, retour au fond standard.`);
      localStorage.setItem(MAP_STYLE_KEY, 'standard');
      marquerStyleActif('standard');
      changeMapStyle(map, 'standard', reinjecterCouches);
      if (note) {
        note.textContent = 'Ce fond de carte est momentanément indisponible. Retour au fond standard.';
        note.style.display = 'block';
      }
    }
  );

  localStorage.setItem(MAP_STYLE_KEY, styleKey);
  marquerStyleActif(styleKey);
}

// ------------------------------------------------------------
// Géolocalisation : un échec doit être visible et explicité.
//
// Sans message, l'application paraît simplement figée : la carte
// ne suit pas, le signalement refuse de partir, et rien n'indique
// pourquoi. Une autorisation refusée dans le navigateur ne se
// redemande jamais d'elle-même, il faut aller la rétablir.
// ------------------------------------------------------------
function messageGeolocalisation(err) {
  if (!err) return "Position indisponible.";

  switch (err.code) {
    case 1: // PERMISSION_DENIED
      return "L'accès à votre position est refusé pour ce site. "
        + "Autorisez la localisation dans les réglages du navigateur, puis rechargez la page. "
        + "L'autorisation accordée à d'autres applications (Plans, Waze) ne s'applique pas ici.";
    case 2: // POSITION_UNAVAILABLE
      return "Position introuvable pour le moment. Vérifiez que la localisation est activée sur l'appareil, "
        + "et placez-vous à l'extérieur si vous êtes dans un bâtiment.";
    case 3: // TIMEOUT
      return "Le signal GPS met trop de temps à arriver. Nouvelle tentative en cours…";
    default:
      return "Position indisponible.";
  }
}

function afficherAlerteCarte(texte) {
  const zone = document.getElementById('alerte-carte');
  if (!zone) return;
  if (!texte) {
    zone.classList.remove('visible');
    zone.textContent = '';
    return;
  }
  zone.textContent = texte;
  zone.classList.add('visible');
}

function afficherAlerteGeolocalisation(texte) {
  const zone = document.getElementById('alerte-geoloc');
  if (!zone) return;
  if (!texte) {
    zone.classList.remove('visible');
    zone.textContent = '';
    return;
  }
  zone.textContent = texte;
  zone.classList.add('visible');
}

function startLiveLocationWatch() {
  if (!('geolocation' in navigator)) {
    afficherAlerteGeolocalisation(
      "Cet appareil ou ce navigateur ne fournit pas de position. Essayez avec Safari ou Chrome à jour."
    );
    return;
  }

  liveWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy, heading } = pos.coords;

      dernierePosition = { lat: latitude, lng: longitude, accuracy };
      afficherAlerteGeolocalisation(null); // la position est revenue

      if (userMarker) {
        updateUserMarker(userMarker, longitude, latitude, accuracy, heading);
      }

      if (followMode) {
        followUser(map, longitude, latitude, heading);
      }
    },
    (err) => {
      console.warn('Suivi de position indisponible :', err);
      // Un dépassement de délai est fréquent et transitoire : on ne
      // l'affiche que si aucune position n'a encore été obtenue,
      // pour ne pas alarmer pendant un trajet qui fonctionne.
      if (err && err.code === 3 && dernierePosition) return;
      afficherAlerteGeolocalisation(messageGeolocalisation(err));
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

// ------------------------------------------------------------
// Déconnexion
// ------------------------------------------------------------
document.getElementById('btn-logout')?.addEventListener('click', () => signOut());

// ------------------------------------------------------------
// SIGNALEMENTS terrain — assistant en 4 étapes :
// Catégorie → Sous-catégorie → Photo → Localisation → Description
// ------------------------------------------------------------
const feuilleSignalement = document.getElementById('feuille-signalement');
const fsTitreEtape = document.getElementById('fs-titre-etape');
const fsBoutonRetourEtape = document.getElementById('fs-retour-etape');
const fsPosition = document.getElementById('fs-position');
const fsRetour = document.getElementById('fs-retour');
const fsNote = document.getElementById('fs-note');
const fsPhotoInput = document.getElementById('fs-photo');
const fsPhotoBtn = document.getElementById('fs-photo-btn');
const fsPhotoApercu = document.getElementById('fs-photo-apercu');
const fsPhotoLibelle = document.getElementById('fs-photo-libelle');

let marqueursSignalements = [];
let photoSelectionnee = null;
let categoriesCache = null;
let sousCategoriesCache = new Map(); // category_id -> liste

const ETAPES = ['categorie', 'sous-categorie', 'photo', 'localisation', 'description'];
const TITRES_ETAPE = {
  categorie: 'Catégorie',
  'sous-categorie': 'Précisez',
  photo: 'Photo',
  localisation: 'Position',
  description: 'Description',
};

let etatSignalement = {
  etapeIndex: 0,
  categorie: null,      // { id, nom, icone }
  sousCategorie: null,  // { id, nom, priorite_defaut }
};

function etapeCourante() {
  return ETAPES[etatSignalement.etapeIndex];
}

function afficherEtape(nomEtape) {
  ETAPES.forEach((e) => {
    const el = document.getElementById(`fs-etape-${e}`);
    if (el) el.style.display = e === nomEtape ? 'block' : 'none';
  });
  if (fsTitreEtape) fsTitreEtape.textContent = TITRES_ETAPE[nomEtape] || '';
  if (fsBoutonRetourEtape) {
    fsBoutonRetourEtape.style.display = etatSignalement.etapeIndex > 0 ? 'flex' : 'none';
  }
  if (fsRetour) { fsRetour.textContent = ''; fsRetour.className = 'fs-retour'; }
}

function allerEtape(index) {
  etatSignalement.etapeIndex = Math.max(0, Math.min(index, ETAPES.length - 1));
  const nom = etapeCourante();
  afficherEtape(nom);
  if (nom === 'localisation') majPositionSignalement();
}

function etapeSuivante() { allerEtape(etatSignalement.etapeIndex + 1); }

fsBoutonRetourEtape?.addEventListener('click', () => allerEtape(etatSignalement.etapeIndex - 1));

async function ouvrirFeuilleSignalement() {
  etatSignalement = { etapeIndex: 0, categorie: null, sousCategorie: null };
  if (fsNote) fsNote.value = '';
  retirerPhoto();
  feuilleSignalement?.classList.add('visible');
  allerEtape(0);
  await chargerEtAfficherCategories();
}

// ---- Étape 1 : Catégorie ----
async function chargerEtAfficherCategories() {
  const conteneur = document.getElementById('fs-liste-categories');
  if (!conteneur) return;
  conteneur.innerHTML = '<div class="fs-chargement">Chargement…</div>';

  if (!categoriesCache) categoriesCache = await chargerCategories(supabase);

  if (categoriesCache.length === 0) {
    conteneur.innerHTML = '<div class="fs-chargement">Aucune catégorie disponible.</div>';
    return;
  }

  conteneur.innerHTML = categoriesCache
    .map((c) => `
      <button class="fs-cat-carte" data-cat="${c.id}">
        <span class="fs-cat-icone" style="background:${c.couleur || 'var(--accent)'}">${svgIcone(c.icone, 26, '#0a0e1a')}</span>
        <span class="fs-cat-nom">${echapperHtml(c.nom)}</span>
      </button>`)
    .join('');

  conteneur.querySelectorAll('.fs-cat-carte').forEach((btn) => {
    btn.addEventListener('click', () => choisirCategorie(btn.dataset.cat));
  });
}

async function choisirCategorie(categoryId) {
  const cat = categoriesCache.find((c) => c.id === categoryId);
  if (!cat) return;
  etatSignalement.categorie = cat;
  etatSignalement.sousCategorie = null;
  etapeSuivante();
  await chargerEtAfficherSousCategories(categoryId);
}

// ---- Étape 2 : Sous-catégorie ----
async function chargerEtAfficherSousCategories(categoryId) {
  const conteneur = document.getElementById('fs-liste-sous-categories');
  if (!conteneur) return;
  conteneur.innerHTML = '<div class="fs-chargement">Chargement…</div>';

  if (!sousCategoriesCache.has(categoryId)) {
    sousCategoriesCache.set(categoryId, await chargerSousCategories(supabase, categoryId));
  }
  const liste = sousCategoriesCache.get(categoryId);

  if (liste.length === 0) {
    conteneur.innerHTML = '<div class="fs-chargement">Aucune sous-catégorie disponible.</div>';
    return;
  }

  const couleurCat = etatSignalement.categorie?.couleur || 'var(--accent)';
  conteneur.innerHTML = liste
    .map((sc) => {
      const prio = LIBELLES_PRIORITE[sc.priorite_defaut] || LIBELLES_PRIORITE.normal;
      return `
      <button class="fs-souscat-ligne" data-souscat="${sc.id}" style="border-left:3px solid ${couleurCat}">
        <span class="fs-souscat-nom">${echapperHtml(sc.nom)}</span>
        <span class="fs-souscat-prio" title="Priorité ${prio.libelle}">${prio.emoji}</span>
      </button>`;
    })
    .join('');

  conteneur.querySelectorAll('.fs-souscat-ligne').forEach((btn) => {
    btn.addEventListener('click', () => choisirSousCategorie(btn.dataset.souscat));
  });
}

function choisirSousCategorie(sousCategorieId) {
  const liste = sousCategoriesCache.get(etatSignalement.categorie.id) || [];
  const sc = liste.find((s) => s.id === sousCategorieId);
  if (!sc) return;
  etatSignalement.sousCategorie = sc;
  etapeSuivante();
}

// ---- Étape 3 : Photo ----
function retirerPhoto() {
  photoSelectionnee = null;
  if (fsPhotoInput) fsPhotoInput.value = '';
  if (fsPhotoApercu) {
    fsPhotoApercu.innerHTML = '';
    fsPhotoApercu.classList.remove('visible');
  }
  fsPhotoBtn?.classList.remove('remplie');
  if (fsPhotoLibelle) fsPhotoLibelle.textContent = 'Ajouter une photo';
}

fsPhotoBtn?.addEventListener('click', () => fsPhotoInput?.click());

fsPhotoInput?.addEventListener('change', (e) => {
  const fichier = e.target.files && e.target.files[0];
  if (!fichier) return;

  photoSelectionnee = fichier;
  fsPhotoBtn?.classList.add('remplie');
  if (fsPhotoLibelle) fsPhotoLibelle.textContent = 'Photo jointe';

  const url = URL.createObjectURL(fichier);
  if (fsPhotoApercu) {
    fsPhotoApercu.innerHTML = `
      <img src="${url}" alt="Aperçu de la photo">
      <button class="fs-photo-retirer" aria-label="Retirer la photo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>`;
    fsPhotoApercu.classList.add('visible');
    fsPhotoApercu.querySelector('.fs-photo-retirer')?.addEventListener('click', () => {
      URL.revokeObjectURL(url);
      retirerPhoto();
    });
  }
});

document.getElementById('fs-photo-suivant')?.addEventListener('click', etapeSuivante);
document.getElementById('fs-photo-passer')?.addEventListener('click', etapeSuivante);

// ---- Étape 4 : Localisation ----
function majPositionSignalement() {
  if (!fsPosition) return;
  if (dernierePosition) {
    const precision = dernierePosition.accuracy != null ? ` · précision ${Math.round(dernierePosition.accuracy)} m` : '';
    fsPosition.textContent = `Position acquise${precision}`;
    fsPosition.className = 'fs-position prete';
  } else {
    fsPosition.textContent = "Position GPS indisponible — impossible de signaler pour l'instant.";
    fsPosition.className = 'fs-position erreur';
  }
}

document.getElementById('fs-position-suivant')?.addEventListener('click', () => {
  if (!dernierePosition) {
    majPositionSignalement();
    return;
  }
  etapeSuivante();
});

// ---- Étape 5 : Description + envoi ----
document.getElementById('btn-signaler')?.addEventListener('click', ouvrirFeuilleSignalement);
document.getElementById('fs-close')?.addEventListener('click', () => feuilleSignalement?.classList.remove('visible'));
feuilleSignalement?.addEventListener('click', (e) => {
  if (e.target === feuilleSignalement) feuilleSignalement.classList.remove('visible');
});

document.getElementById('fs-envoyer')?.addEventListener('click', envoyerSignalement);

async function envoyerSignalement() {
  const bouton = document.getElementById('fs-envoyer');
  if (!etatSignalement.sousCategorie) {
    if (fsRetour) {
      fsRetour.textContent = 'Choisissez une catégorie et une sous-catégorie.';
      fsRetour.className = 'fs-retour erreur';
    }
    return;
  }
  if (!dernierePosition) {
    if (fsRetour) {
      fsRetour.textContent = "Position GPS indisponible. Attendez l'acquisition du signal, puis réessayez.";
      fsRetour.className = 'fs-retour erreur';
    }
    return;
  }
  if (!session) {
    if (fsRetour) {
      fsRetour.textContent = 'Connexion requise pour signaler.';
      fsRetour.className = 'fs-retour erreur';
    }
    return;
  }

  if (bouton) { bouton.disabled = true; bouton.textContent = 'Envoi…'; }

  try {
    const signalement = await creerSignalement(supabase, session, {
      sousCategorieId: etatSignalement.sousCategorie.id,
      prioriteDefaut: etatSignalement.sousCategorie.priorite_defaut,
      lat: dernierePosition.lat,
      lng: dernierePosition.lng,
      commentaire: fsNote?.value.trim() || null,
    });

    // Enrichi avec ce qu'on connaît déjà du choix fait dans
    // l'assistant, pour afficher le marqueur immédiatement sans
    // requête supplémentaire vers vue_signalements.
    signalement.categorie_nom = etatSignalement.categorie.nom;
    signalement.categorie_icone = etatSignalement.categorie.icone;
    signalement.sous_categorie_nom = etatSignalement.sousCategorie.nom;

    if (photoSelectionnee) {
      if (fsRetour) {
        fsRetour.textContent = 'Envoi de la photo…';
        fsRetour.className = 'fs-retour';
      }
      try {
        signalement.photo_chemin = await envoyerPhoto(supabase, session, signalement.id, photoSelectionnee);
      } catch (errPhoto) {
        console.error('Envoi de la photo impossible :', errPhoto);
        if (fsRetour) {
          fsRetour.textContent = `Signalement enregistré, mais la photo n'a pas pu être envoyée : ${errPhoto.message}`;
          fsRetour.className = 'fs-retour erreur';
        }
        ajouterMarqueurSignalement(signalement);
        return;
      }
    }

    ajouterMarqueurSignalement(signalement);

    if (fsRetour) {
      fsRetour.textContent = `${etatSignalement.sousCategorie.nom} signalé à votre position.`;
      fsRetour.className = 'fs-retour succes';
    }

    setTimeout(() => feuilleSignalement?.classList.remove('visible'), 900);
  } catch (err) {
    console.error('Signalement impossible :', err);
    if (fsRetour) {
      fsRetour.textContent = `Signalement impossible : ${err.message}`;
      fsRetour.className = 'fs-retour erreur';
    }
  } finally {
    if (bouton) { bouton.disabled = false; bouton.textContent = 'Envoyer le signalement'; }
  }
}

function ajouterMarqueurSignalement(signalement) {
  if (!map) return;

  const info = typeof identite === 'function' ? identite(signalement.user_id) : null;
  const estAuteur = session && signalement.user_id === session.user.id;

  // Le droit « supprimer » ne vaut que pour ses PROPRES signalements.
  // Un administrateur complet garde un accès total via peut().
  const estAdminComplet = profil && profil.role === 'administrateur';
  const peutSupprimerCeSignalement = estAdminComplet || (estAuteur && peut('supprimer'));

  const marqueur = creerMarqueurSignalement(signalement, {
    supabase,
    auteur: estAuteur ? null : (info && info.nom) || null,
    peutSupprimer: peutSupprimerCeSignalement,
    peutTraiter: peut('traiter'),
    surSuppression: (s) => effacerSignalement(s, marqueur),
    surTraitement: (s, statut) => traiterSignalement(s, statut, marqueur),
  });
  if (!marqueur) return;
  marqueur.addTo(map);
  marqueursSignalements.push(marqueur);
}

// Marquer traité, ou rouvrir. Le marqueur est reconstruit pour que
// la bulle reflète le nouvel état sans recharger toute la carte.
async function traiterSignalement(signalement, statut, marqueur) {
  try {
    await changerStatutSignalement(supabase, session, signalement.id, statut);
    signalement.statut = statut;
    marqueur.remove();
    marqueursSignalements = marqueursSignalements.filter((m) => m !== marqueur);
    ajouterMarqueurSignalement(signalement);
  } catch (err) {
    alert(`Mise à jour impossible : ${err.message}`);
  }
}

async function effacerSignalement(signalement, marqueur) {
  const libelle = signalement.sous_categorie_nom || signalement.categorie_nom || 'ce signalement';
  if (!confirm(`Supprimer ce signalement « ${libelle} » ?`)) return;

  try {
    await supprimerSignalement(supabase, signalement.id, signalement.photo_chemin);
    marqueur.remove();
    marqueursSignalements = marqueursSignalements.filter((m) => m !== marqueur);
  } catch (err) {
    alert(`Suppression impossible : ${err.message}`);
  }
}

export function effacerMarqueursSignalements() {
  marqueursSignalements.forEach((m) => m.remove());
  marqueursSignalements = [];
}

async function afficherSignalementsExistants() {
  if (!map || !session) return;

  // Avec le droit « consulter », on affiche les signalements de
  // toute l'équipe : sans cela, quelqu'un chargé de les traiter ne
  // verrait que les siens et son droit serait inopérant.
  const voitTout = peut('consulter');
  const liste = await chargerSignalements(
    supabase,
    voitTout ? {} : { userId: session.user.id }
  );

  // Les noms servent à afficher l'auteur dans la bulle
  if (voitTout) await chargerIdentites(supabase);

  liste.forEach(ajouterMarqueurSignalement);
}

// ------------------------------------------------------------
// Feuille « Mon profil »
// ------------------------------------------------------------
const feuilleProfil = document.getElementById('feuille-profil');
const fpRetour = document.getElementById('fp-retour');
const fpNom = document.getElementById('fp-nom');
const fpPhotoInput = document.getElementById('fp-photo');
let nouvellePhotoProfil = null;

function retourProfil(texte, type = '') {
  if (!fpRetour) return;
  fpRetour.textContent = texte;
  fpRetour.className = `fs-retour ${type}`;
}

function rafraichirApercuProfil(urlLocale = null) {
  const zone = document.getElementById('fp-pastille');
  if (!zone) return;
  zone.innerHTML = '';
  const p = creerPastille(fpNom?.value || profil?.nom, { taille: 84 });
  zone.appendChild(p);

  if (urlLocale) {
    p.style.backgroundImage = `url("${urlLocale}")`;
    p.classList.add('avec-photo');
  } else {
    habillerPastille(p, supabase, profil?.avatar_chemin);
  }

  const btnRetirer = document.getElementById('fp-photo-retirer');
  if (btnRetirer) {
    btnRetirer.style.display = profil?.avatar_chemin || urlLocale ? 'block' : 'none';
  }
}

document.getElementById('btn-profil')?.addEventListener('click', () => {
  retourProfil('');
  nouvellePhotoProfil = null;
  if (fpNom) fpNom.value = profil?.nom || '';
  rafraichirApercuProfil();
  feuilleProfil?.classList.add('visible');
});

document.getElementById('fp-close')?.addEventListener('click', () => feuilleProfil?.classList.remove('visible'));
feuilleProfil?.addEventListener('click', (e) => {
  if (e.target === feuilleProfil) feuilleProfil.classList.remove('visible');
});

document.getElementById('fp-photo-btn')?.addEventListener('click', () => fpPhotoInput?.click());

fpPhotoInput?.addEventListener('change', (e) => {
  const fichier = e.target.files && e.target.files[0];
  if (!fichier) return;
  nouvellePhotoProfil = fichier;
  rafraichirApercuProfil(URL.createObjectURL(fichier));
  retourProfil("Appuyez sur Enregistrer pour valider.", '');
});

document.getElementById('fp-photo-retirer')?.addEventListener('click', async () => {
  if (!confirm('Retirer votre photo de profil ?')) return;
  try {
    await retirerAvatar(supabase, session, profil?.avatar_chemin);
    profil.avatar_chemin = null;
    nouvellePhotoProfil = null;
    rafraichirApercuProfil();
    majPastilleTopbar();
    majPhotoPosition();
    retourProfil('Photo retirée.', 'succes');
  } catch (err) {
    retourProfil(`Échec : ${err.message}`, 'erreur');
  }
});

document.getElementById('fp-enregistrer')?.addEventListener('click', async (e) => {
  if (!session) return;
  const bouton = e.currentTarget;
  bouton.disabled = true;
  bouton.textContent = 'Enregistrement…';

  try {
    if (nouvellePhotoProfil) {
      retourProfil('Envoi de la photo…');
      profil.avatar_chemin = await envoyerAvatar(supabase, session, nouvellePhotoProfil);
      nouvellePhotoProfil = null;
    }

    const nom = fpNom?.value.trim();
    if (nom && nom !== profil?.nom) {
      const { error } = await supabase.from('profils').update({ nom }).eq('user_id', session.user.id);
      if (error) throw error;
      profil.nom = nom;
    }

    majPastilleTopbar();
    majPhotoPosition();
    rafraichirApercuProfil();
    retourProfil('Profil mis à jour.', 'succes');
    setTimeout(() => feuilleProfil?.classList.remove('visible'), 900);
  } catch (err) {
    console.error('Mise à jour du profil impossible :', err);
    retourProfil(`Échec : ${err.message}`, 'erreur');
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Enregistrer';
  }
});
