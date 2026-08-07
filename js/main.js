// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

import { supabase, getSession, signIn, signUp, signOut, onAuthChange, envoyerLienReinitialisation } from './supabase-client.js';
import { initMap, setupTraceLayer, pushPointToTrace, createUserMarker, updateUserMarker, followUser, drawFullTrace, changeMapStyle, STYLES } from './map.js';
import { SessionTracking, distanceM } from './tracking.js';
import { getPrixEnergie, calculerCoutTrajet, calculerConsommation, LIBELLES_ENERGIE } from './cout.js';
import { exportGPX, exportCSV } from './export.js';
import { readImportedFile } from './import.js';
import { rattacherEtComparer } from './itineraires.js';
import { getTemperature } from './meteo.js';
import {
  envoyerAvatar, retirerAvatar, urlAvatar, chargerIdentites,
  creerPastille, habillerPastille,
} from './profil.js';
import { partagerParcoursAvecVisuel } from './partage-visuel.js';
import {
  TYPES_SIGNALEMENT,
  svgSignalement,
  creerSignalement,
  chargerSignalements,
  creerMarqueurSignalement,
  envoyerPhoto,
  supprimerSignalement,
  changerStatutSignalement,
} from './signalements.js';

let map = null;
let session = null;
let tracking = null;
let currentType = 'pied';

// ------------------------------------------------------------
// Formatage
// ------------------------------------------------------------
function formatDistance(m) {
  if (m == null) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatDuree(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(min).padStart(2, '0')}`;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatAllure(secParKm) {
  if (secParKm == null) return '—';
  const min = Math.floor(secParKm / 60);
  const sec = secParKm % 60;
  return `${min}'${String(sec).padStart(2, '0')}"/km`;
}

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

function apresConnexion() {
  if (map) return; // déjà démarré
  if (localStorage.getItem(ONBOARDING_KEY)) {
    startApp();
  } else {
    onboardingScreen.style.display = 'flex';
  }
}

document.getElementById('onboarding-close')?.addEventListener('click', () => {
  localStorage.setItem(ONBOARDING_KEY, '1');
  onboardingScreen.style.display = 'none';
  if (!map) startApp();
});

document.getElementById('btn-aide')?.addEventListener('click', () => {
  onboardingScreen.style.display = 'flex';
});

onAuthChange((s) => {
  session = s;
  authScreen.style.display = session ? 'none' : 'flex';
  if (session) apresConnexion();
});

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
let profil = null;                    // { role, type_energie, consommation }
let droits = { pm: {}, te: {} };

function peut(domaine, droit) {
  if (profil && profil.role === 'administrateur') return true;
  return Boolean(droits[domaine] && droits[domaine][droit]);
}

async function chargerProfilEtDroits() {
  if (!session) return;

  const [resProfil, resDroits] = await Promise.all([
    supabase.from('profils').select('role, nom, type_energie, consommation, avatar_chemin').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('droits').select('domaine, consulter, enregistrer, traiter, modifier, supprimer, type_parcours, acces_historique').eq('user_id', session.user.id),
  ]);

  profil = resProfil.data || { role: 'utilisateur', nom: null, type_energie: 'gazole', consommation: 6.5, avatar_chemin: null };
  droits = { pm: {}, te: {} };
  (resDroits.data || []).forEach((d) => { droits[d.domaine] = d; });

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

// Types de parcours autorisés à l'enregistrement. La base refuse
// de toute façon un type non permis : ce filtrage n'est là que
// pour ne pas proposer un bouton qui échouerait.
function typesParcoursAutorises() {
  if (profil && profil.role === 'administrateur') return ['pied', 'voiture'];
  const restriction = (droits.pm && droits.pm.type_parcours) || 'tous';
  return restriction === 'tous' ? ['pied', 'voiture'] : [restriction];
}

function appliquerDroitsInterface() {
  const estAdmin = profil && profil.role === 'administrateur';

  // Historique : droit explicite, distinct de l'enregistrement.
  // Collecter des données n'implique pas de pouvoir les relire.
  const lienHistorique = document.getElementById('lien-historique');
  if (lienHistorique) {
    const acces = estAdmin || Boolean(droits.pm && droits.pm.acces_historique);
    lienHistorique.style.display = acces ? 'flex' : 'none';
  }

  // Sélecteur pied / voiture, limité aux types autorisés
  const autorises = typesParcoursAutorises();
  document.querySelectorAll('.type-choice').forEach((btn) => {
    const permis = autorises.includes(btn.dataset.type);
    btn.style.display = permis ? 'flex' : 'none';
  });

  // Si le type actuellement sélectionné n'est plus permis, on
  // bascule sur le premier autorisé, sinon l'enregistrement
  // partirait avec un type que la base rejettera.
  if (!autorises.includes(currentType) && autorises.length > 0) {
    currentType = autorises[0];
    document.querySelectorAll('.type-choice').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === currentType);
    });
  }

  // Supervision et import : réservés à l'administrateur
  const lienSupervision = document.getElementById('lien-supervision');
  if (lienSupervision) lienSupervision.style.display = estAdmin ? 'flex' : 'none';
  const btnImport = document.getElementById('btn-import');
  if (btnImport) btnImport.style.display = estAdmin ? 'flex' : 'none';

  // Chaque bouton flottant n'apparaît que si la personne a le
  // droit correspondant. Ce n'est qu'un confort : la base refuse
  // de toute façon une opération non autorisée.
  const btnGirophare = document.getElementById('btn-girophare');
  if (btnGirophare) btnGirophare.style.display = peut('pm', 'enregistrer') ? 'flex' : 'none';

  const btnSignaler = document.getElementById('btn-signaler');
  if (btnSignaler) btnSignaler.style.display = peut('te', 'enregistrer') ? 'flex' : 'none';

  // Si aucun des deux, on masque le conteneur pour ne pas laisser
  // un bloc vide au milieu de l'écran.
  const conteneur = document.getElementById('boutons-flottants');
  if (conteneur) {
    const auMoinsUn = peut('pm', 'enregistrer') || peut('te', 'enregistrer');
    conteneur.style.display = auMoinsUn ? 'flex' : 'none';
  }
}

function startApp() {
  chargerProfilEtDroits();
  const stylePref = localStorage.getItem(MAP_STYLE_KEY) || 'standard';
  map = initMap('map', undefined, undefined, stylePref);
  map.on('load', () => {
    setupTraceLayer(map, 'trace-live');
    userMarker = createUserMarker(map);
    userMarker.addTo(map);
    majPhotoPosition();
    startLiveLocationWatch();
    afficherSignalementsExistants();
  });

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
  setupTraceLayer(map, 'trace-live');
  if (userMarker) userMarker.addTo(map);
  if (tracking && tracking.points.length > 1) {
    drawFullTrace(map, 'trace-live', tracking.points, currentType);
  } else if (lastParcours && lastParcours.points.length > 1) {
    drawFullTrace(map, 'trace-live', lastParcours.points, lastParcours.type);
  }
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
// Sélecteur de type de parcours
// ------------------------------------------------------------
document.querySelectorAll('.type-choice').forEach((btn) => {
  btn?.addEventListener('click', () => {
    document.querySelectorAll('.type-choice').forEach((b) => b.classList.remove('active'));
    btn?.classList.add('active');
    currentType = btn.dataset.type;
  });
});

// ------------------------------------------------------------
// Enregistrement
// ------------------------------------------------------------
const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');
const statDistance = document.getElementById('stat-distance');
const statDuree = document.getElementById('stat-duree');
const statVitesse = document.getElementById('stat-vitesse');
const driverAlert = document.getElementById('driver-alert');
const summaryPanel = document.getElementById('summary-panel');

let statsInterval = null;
let lastParcours = null; // { titre, type, points, stats } — pour export/partage
let liveDistanceM = 0;

btnStart?.addEventListener('click', () => {
  summaryPanel.style.display = 'none';
  liveDistanceM = 0;
  statDistance.textContent = '0 m';
  tracking = new SessionTracking(currentType);

  tracking.onPoint = (point) => {
    pushPointToTrace(map, 'trace-live', point.lng, point.lat, currentType);

    // Distance cumulée en direct — calcul incrémental entre les deux
    // derniers points valides (fix : l'ancienne version ne mettait
    // jamais l'affichage à jour, d'où le "0 m" permanent constaté).
    const pts = tracking.points;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      liveDistanceM += distanceM(a.lat, a.lng, b.lat, b.lng);
      statDistance.textContent = formatDistance(liveDistanceM);
    }

    if (point.vitesse_instant != null) {
      statVitesse.textContent = `${point.vitesse_instant.toFixed(1)} km/h`;
    }
  };

  tracking.onVitesse = () => {
    driverAlert?.classList.add('show');
  };

  tracking.start();

  document.getElementById('btn-girophare')?.classList.add('enregistre');
  basculerControles(true);

  statsInterval = setInterval(updateLiveDuree, 1000);

  btnStart.style.display = 'none';
  btnPause.style.display = 'block';
  btnStop.style.display = 'block';
});

btnPause?.addEventListener('click', () => {
  if (!tracking) return;
  if (tracking.paused) {
    tracking.resume();
    btnPause.textContent = 'Pause';
  } else {
    tracking.pause();
    btnPause.textContent = 'Reprendre';
  }
});

let isStopping = false;

btnStop?.addEventListener('click', async () => {
  if (!tracking || isStopping) return;
  isStopping = true;

  const activeTracking = tracking;
  tracking = null; // empêche tout second clic de relancer le flux pendant l'attente réseau
  clearInterval(statsInterval);

  // Feedback immédiat : le bouton disparaît tout de suite, pas
  // seulement une fois la sauvegarde terminée
  btnStart.style.display = 'block';
  btnPause.style.display = 'none';
  btnStop.style.display = 'none';
  btnPause.textContent = 'Pause';
  document.getElementById('btn-girophare')?.classList.remove('enregistre');

  const stats = activeTracking.stop();
  const titre = `Parcours du ${new Date(stats.date_debut).toLocaleDateString('fr-FR')}`;

  statDistance.textContent = formatDistance(stats.distance_m);

  const { id: parcoursId, cout_estime_eur, type_energie } = await saveParcours(stats);
  stats.type_energie = type_energie;

  // Les signalements créés pendant l'enregistrement sont rattachés
  // au parcours a posteriori : son identifiant n'existe qu'une fois
  // la ligne insérée en base, donc pas au moment du signalement.
  if (parcoursId && session) {
    const { error: errRattache } = await supabase
      .from('signalements')
      .update({ parcours_id: parcoursId })
      .eq('user_id', session.user.id)
      .is('parcours_id', null)
      .gte('created_at', stats.date_debut)
      .lte('created_at', stats.date_fin);
    if (errRattache) console.warn('Rattachement des signalements impossible :', errRattache);
  }
  stats.cout_estime_eur = cout_estime_eur ?? null;

  if (parcoursId && stats.evenements && stats.evenements.length > 0) {
    const rowsEvenements = stats.evenements.map((e) => ({ ...e, parcours_id: parcoursId }));
    const { error: errEvenements } = await supabase.from('parcours_evenements').insert(rowsEvenements);
    if (errEvenements) console.error('Erreur sauvegarde événements:', errEvenements);
  }

  const meteo = await getTemperature(stats.points[0], stats.date_debut);
  stats.temperature_c = meteo;
  if (parcoursId && meteo != null) {
    await supabase.from('parcours').update({ temperature_c: meteo }).eq('id', parcoursId);
  }

  lastParcours = { titre, type: currentType, points: stats.points, stats };

  let comparaison = null;
  if (parcoursId) {
    const result = await rattacherEtComparer(supabase, session, parcoursId, stats, currentType);
    comparaison = result.comparaison;
  }

  renderSummary(stats, comparaison);
  summaryPanel.style.display = 'block';
  basculerControles(true);

  isStopping = false;
});

function updateLiveDuree() {
  if (!tracking) return;
  const elapsed = Math.round((Date.now() - tracking.dateDebut) / 1000);
  statDuree.textContent = formatDuree(elapsed);
}

// ------------------------------------------------------------
// Panneau récapitulatif — un maximum d'informations sur le
// parcours qui vient d'être enregistré, + alternative éventuelle
// ------------------------------------------------------------
function renderSummary(stats, comparaison) {
  const grid = document.getElementById('summary-grid');
  const items = [
    ['Distance', formatDistance(stats.distance_m)],
    ['Durée', formatDuree(stats.duree_s)],
    ['Vitesse moyenne', stats.vitesse_moy != null ? `${stats.vitesse_moy} km/h` : '—'],
    ['Vitesse de pointe', stats.vitesse_max != null ? `${stats.vitesse_max} km/h` : '—'],
  ];

  if (currentType === 'pied') {
    items.push(['Allure', formatAllure(stats.allure_sec_km)]);
    items.push(['Calories', stats.calories != null ? `${stats.calories} kcal` : '—']);
  }

  items.push(
    ['Dénivelé positif', stats.denivele_positif != null ? `${stats.denivele_positif} m` : '—'],
    ['Dénivelé négatif', stats.denivele_negatif != null ? `${stats.denivele_negatif} m` : '—'],
  );

  if (stats.altitude_max != null) {
    items.push(['Altitude', `${stats.altitude_min}–${stats.altitude_max} m`]);
  }

  items.push(['Virages', stats.nb_virages != null ? stats.nb_virages : '—']);
  items.push(['Température', stats.temperature_c != null ? `${stats.temperature_c}°C` : '—']);

  if (stats.evenements && stats.evenements.length > 0) {
    const nbArrets = stats.evenements.filter((e) => e.type === 'arret').length;
    const nbRalentissements = stats.evenements.filter((e) => e.type === 'ralentissement').length;
    const nbAccelerations = stats.evenements.filter((e) => e.type === 'acceleration').length;
    items.push(['Arrêts', nbArrets]);
    items.push(['Ralentissements', nbRalentissements]);
    items.push(['Accélérations', nbAccelerations]);
  }

  if (currentType === 'voiture') {
    const energie = stats.type_energie || (profil && profil.type_energie) || 'gazole';
    const conso = (profil && Number(profil.consommation)) || (energie === 'electrique' ? 18 : 6.5);
    const quantite = calculerConsommation(stats.distance_m, conso);
    items.push(['Coût estimé', stats.cout_estime_eur != null ? `${stats.cout_estime_eur} €` : '—']);
    items.push([
      energie === 'electrique' ? 'Énergie' : 'Carburant',
      quantite != null ? `${quantite} ${energie === 'electrique' ? 'kWh' : 'L'}` : '—',
    ]);
    items.push(['Véhicule', LIBELLES_ENERGIE[energie] || energie]);
  }

  grid.innerHTML = items.map(([label, val]) => `
    <div class="summary-item">
      <div class="summary-val">${val}</div>
      <div class="summary-label">${label}</div>
    </div>
  `).join('');

  const comparaisonEl = document.getElementById('summary-comparaison');
  comparaisonEl.style.display = 'block';
  if (comparaison && comparaison.length > 0) {
    comparaisonEl?.classList.remove('comparaison-neutre');
    comparaisonEl.innerHTML = comparaison.map((m) => `<div class="comparaison-line">${m}</div>`).join('');
  } else {
    comparaisonEl?.classList.add('comparaison-neutre');
    comparaisonEl.innerHTML = `<div class="comparaison-line">Pas encore de comparaison possible — c'est le premier trajet enregistré sur cet itinéraire. Reviens-y une prochaine fois pour voir si tu peux faire mieux.</div>`;
  }
}

// ------------------------------------------------------------
// Alerte conducteur : confirmation passager
// ------------------------------------------------------------
document.getElementById('alert-confirm-passager')?.addEventListener('click', () => {
  driverAlert?.classList.remove('show');
});
document.getElementById('alert-stop-recording')?.addEventListener('click', () => {
  driverAlert?.classList.remove('show');
  btnStop.click();
});

// ------------------------------------------------------------
// Sauvegarde Supabase — retourne l'id du parcours + le coût
// (nécessaires pour le rattachement à un itinéraire et le résumé)
// ------------------------------------------------------------
async function saveParcours(stats) {
  if (!session) return { id: null, cout_estime_eur: null };

  const { data: parcours, error } = await supabase
    .from('parcours')
    .insert({
      user_id: session.user.id,
      titre: `Parcours du ${new Date(stats.date_debut).toLocaleDateString('fr-FR')}`,
      type: currentType,
      date_debut: stats.date_debut,
      date_fin: stats.date_fin,
      distance_m: stats.distance_m,
      duree_s: stats.duree_s,
      vitesse_moy: stats.vitesse_moy,
      vitesse_max: stats.vitesse_max,
      denivele_positif: stats.denivele_positif,
      denivele_negatif: stats.denivele_negatif,
      nb_virages: stats.nb_virages,
      vitesse_min: stats.vitesse_min,
      altitude_max: stats.altitude_max,
      altitude_min: stats.altitude_min,
      allure_sec_km: stats.allure_sec_km,
      calories: stats.calories,
    })
    .select()
    .single();

  if (error) {
    console.error('Erreur sauvegarde parcours:', error);
    return { id: null, cout_estime_eur: null, type_energie: null };
  }

  if (stats.points.length > 0) {
    const rows = stats.points.map((p) => ({ ...p, parcours_id: parcours.id }));
    const { error: errPoints } = await supabase.from('points_gps').insert(rows);
    if (errPoints) console.error('Erreur sauvegarde points GPS:', errPoints);
  }

  // Coût : calculé selon l'énergie réellement utilisée. L'équipe
  // PM roule en électrique, un prix de carburant liquide donnerait
  // un montant faux.
  let cout_estime_eur = null;
  let type_energie = null;
  if (currentType === 'voiture') {
    type_energie = (profil && profil.type_energie) || 'gazole';
    const conso = (profil && Number(profil.consommation)) || (type_energie === 'electrique' ? 18 : 6.5);
    const prix = await getPrixEnergie(type_energie);
    if (prix) {
      cout_estime_eur = calculerCoutTrajet(stats.distance_m, conso, prix);
      if (cout_estime_eur != null) {
        await supabase.from('parcours').update({ cout_estime_eur, type_energie }).eq('id', parcours.id);
      }
    }
  }

  return { id: parcours.id, cout_estime_eur, type_energie };
}

document.getElementById('btn-logout')?.addEventListener('click', () => signOut());

document.getElementById('summary-close')?.addEventListener('click', () => {
  summaryPanel.style.display = 'none';
});

// ------------------------------------------------------------
// Export
// ------------------------------------------------------------
document.getElementById('export-gpx')?.addEventListener('click', () => {
  if (!lastParcours) return;
  exportGPX(lastParcours, lastParcours.points);
});

document.getElementById('export-csv')?.addEventListener('click', () => {
  if (!lastParcours) return;
  exportCSV(lastParcours.points);
});

// ------------------------------------------------------------
// Partage par SMS
// ------------------------------------------------------------
document.getElementById('share-sms')?.addEventListener('click', async () => {
  if (!lastParcours) return;
  const s = lastParcours.stats;
  const texte = [
    `Mon parcours ${lastParcours.type === 'voiture' ? 'en voiture' : 'à pied'} sur iter :`,
    `${formatDistance(s.distance_m)} en ${formatDuree(s.duree_s)}`,
    s.vitesse_moy != null ? `vitesse moyenne ${s.vitesse_moy} km/h` : null,
  ].filter(Boolean).join(' — ');

  const btn = document.getElementById('share-sms');
  const texteOriginal = btn?.textContent;
  btn.textContent = '…';
  btn.disabled = true;

  // On s'assure que la carte affiche bien le tracé complet avant
  // capture (le suivi GPS live continue de recentrer sur la
  // position actuelle après l'arrêt, ce qui décadrerait le partage)
  setFollowMode(false);
  drawFullTrace(map, 'trace-live', lastParcours.points, lastParcours.type);

  await partagerParcoursAvecVisuel({
    points: lastParcours.points,
    stats: s,
    type: lastParcours.type,
    titre: lastParcours.titre,
    texte,
    map,
    evenements: s.evenements,
  });

  btn.textContent = texteOriginal;
  btn.disabled = false;
});

// ------------------------------------------------------------
// Import d'un parcours (GPX/CSV) pour visualisation sur la carte
// ------------------------------------------------------------
const importInput = document.getElementById('import-input');

document.getElementById('btn-import')?.addEventListener('click', () => {
  importInput.click();
});

importInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const points = await readImportedFile(file);
    if (points.length === 0) throw new Error('Fichier vide ou illisible.');

    drawFullTrace(map, 'trace-import', points, 'pied');
    setFollowMode(false);

    let distance = 0;
    for (let i = 1; i < points.length; i++) {
      distance += distanceM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }
    statDistance.textContent = formatDistance(distance);
  } catch (err) {
    alert(`Import impossible : ${err.message}`);
  } finally {
    importInput.value = '';
  }
});

// ------------------------------------------------------------
// SIGNALEMENTS terrain
// ------------------------------------------------------------
const feuilleSignalement = document.getElementById('feuille-signalement');
const fsPosition = document.getElementById('fs-position');
const fsRetour = document.getElementById('fs-retour');
const fsNote = document.getElementById('fs-note');
const fsPhotoInput = document.getElementById('fs-photo');
const fsPhotoBtn = document.getElementById('fs-photo-btn');
const fsPhotoApercu = document.getElementById('fs-photo-apercu');
const fsPhotoLibelle = document.getElementById('fs-photo-libelle');
let marqueursSignalements = [];
let photoSelectionnee = null;

// Construction des boutons de type à partir des définitions
(function construireTypesSignalement() {
  const conteneur = document.getElementById('fs-types');
  if (!conteneur) return;

  conteneur.innerHTML = Object.entries(TYPES_SIGNALEMENT)
    .map(
      ([cle, def]) => `
      <button class="fs-type" data-type="${cle}">
        <span class="rond" style="background:${def.couleur}">${svgSignalement(cle, 22, '#0a0e1a')}</span>
        <span class="nom">${def.libelle}</span>
      </button>`
    )
    .join('');

  conteneur.querySelectorAll('.fs-type').forEach((btn) => {
    btn.addEventListener('click', () => envoyerSignalement(btn.dataset.type, btn));
  });
})();

function ouvrirFeuilleSignalement() {
  if (fsRetour) {
    fsRetour.textContent = '';
    fsRetour.className = 'fs-retour';
  }
  if (fsNote) fsNote.value = '';
  retirerPhoto();
  majPositionSignalement();
  feuilleSignalement?.classList.add('visible');
}

// ---- Photo ----
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

// ------------------------------------------------------------
// Panneau d'enregistrement, replié derrière le girophare
// ------------------------------------------------------------
const panneauControles = document.getElementById('controls');

function basculerControles(forcer = null) {
  if (!panneauControles) return;

  // Le résumé de fin de parcours est imbriqué dans ce panneau :
  // le replier le ferait disparaître avant que la personne ait pu
  // exporter ou partager. On l'en empêche tant qu'il est affiché.
  const resumeAffiche = summaryPanel && summaryPanel.style.display === 'block';
  if (forcer === false && resumeAffiche) return;
  if (forcer === null && resumeAffiche && panneauControles.classList.contains('visible')) return;

  const ouvrir = forcer !== null ? forcer : !panneauControles.classList.contains('visible');
  panneauControles.classList.toggle('visible', ouvrir);
}

document.getElementById('btn-girophare')?.addEventListener('click', () => {
  // Pendant un enregistrement, le panneau reste ouvert : on ne
  // referme pas par mégarde les commandes de pause et d'arrêt.
  if (tracking) {
    basculerControles(true);
    return;
  }
  basculerControles();
});

document.getElementById('btn-signaler')?.addEventListener('click', ouvrirFeuilleSignalement);
document.getElementById('fs-close')?.addEventListener('click', () => feuilleSignalement?.classList.remove('visible'));
feuilleSignalement?.addEventListener('click', (e) => {
  if (e.target === feuilleSignalement) feuilleSignalement.classList.remove('visible');
});

async function envoyerSignalement(type, bouton) {
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

  // Verrouillage : évite les doubles envois pendant l'appel réseau
  document.querySelectorAll('.fs-type').forEach((b) => (b.disabled = true));
  if (bouton) bouton.style.opacity = '0.5';

  try {
    const signalement = await creerSignalement(supabase, session, {
      type,
      lat: dernierePosition.lat,
      lng: dernierePosition.lng,
      commentaire: fsNote?.value.trim() || null,
      // Le rattachement au parcours se fait après coup, à l'arrêt
      // de l'enregistrement (l'identifiant n'existe pas encore ici).
      parcoursId: null,
    });

    // Photo envoyée après création : le nom du fichier reprend
    // l'identifiant du signalement, qui n'existe qu'à ce moment.
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
        retirerPhoto();
        if (fsNote) fsNote.value = '';
        return;
      }
    }

    ajouterMarqueurSignalement(signalement);

    if (fsRetour) {
      fsRetour.textContent = `${TYPES_SIGNALEMENT[type].libelle} signalé à votre position.`;
      fsRetour.className = 'fs-retour succes';
    }
    if (fsNote) fsNote.value = '';
    retirerPhoto();

    setTimeout(() => feuilleSignalement?.classList.remove('visible'), 900);
  } catch (err) {
    console.error('Signalement impossible :', err);
    if (fsRetour) {
      fsRetour.textContent = `Signalement impossible : ${err.message}`;
      fsRetour.className = 'fs-retour erreur';
    }
  } finally {
    document.querySelectorAll('.fs-type').forEach((b) => (b.disabled = false));
    if (bouton) bouton.style.opacity = '';
  }
}

function ajouterMarqueurSignalement(signalement) {
  if (!map) return;

  const info = typeof identite === 'function' ? identite(signalement.user_id) : null;
  const estAuteur = session && signalement.user_id === session.user.id;

  const marqueur = creerMarqueurSignalement(signalement, {
    supabase,
    auteur: estAuteur ? null : (info && info.nom) || null,
    peutSupprimer: peut('te', 'supprimer'),
    peutTraiter: peut('te', 'traiter'),
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
  const def = TYPES_SIGNALEMENT[signalement.type];
  const libelle = def ? def.libelle : signalement.type;
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
  const voitTout = peut('te', 'consulter');
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
