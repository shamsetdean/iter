// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// SUPERVISION — consultation et gestion des parcours de tous
// les utilisateurs.
//
// Sécurité : cette page ne protège rien par elle-même. Ce qui
// protège les données, ce sont les policies RLS de Supabase :
// un compte sans droit de supervision ne recevra tout
// simplement aucune donnée, quelle que soit la page ouverte.
// Le contrôle ci-dessous n'est qu'un confort d'affichage.
// ============================================================

import { supabase, getSession, signIn, signOut, onAuthChange, envoyerLienReinitialisation } from './supabase-client.js';
import { STYLES } from './map.js';
import {
  TYPES_SIGNALEMENT,
  svgSignalement,
  chargerSignalements,
  changerStatutSignalement,
  supprimerSignalement,
  creerMarqueurSignalement,
} from './signalements.js';

const authScreen = document.getElementById('auth-screen');
const ecranRefus = document.getElementById('ecran-refus');
const contenu = document.getElementById('contenu');
const listeEl = document.getElementById('liste-parcours');

let parcours = [];
let profils = new Map();   // user_id -> nom
let carte = null;
let filtrePersonne = 'tous';
let filtreType = 'tous';
let signalements = [];
let filtreStatutSig = 'ouvert';
let marqueursSig = [];
let sessionCourante = null;

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
  if (h > 0) return `${h}h${String(min).padStart(2, '0')}`;
  return `${min} min`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// ------------------------------------------------------------
// Authentification
// ------------------------------------------------------------
const authError = document.getElementById('auth-error');

document.getElementById('auth-submit')?.addEventListener('click', async () => {
  if (authError) authError.textContent = '';
  const email = document.getElementById('auth-email')?.value.trim();
  const motDePasse = document.getElementById('auth-password')?.value;

  if (!email || !motDePasse) {
    if (authError) authError.textContent = 'Renseignez un email et un mot de passe.';
    return;
  }

  const { error } = await signIn(email, motDePasse);
  if (error && authError) authError.textContent = error.message;
});

document.getElementById('auth-oubli')?.addEventListener('click', async () => {
  const email = document.getElementById('auth-email')?.value.trim();
  if (!authError) return;
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

document.getElementById('btn-deconnexion')?.addEventListener('click', () => signOut());
document.getElementById('btn-deconnexion-refus')?.addEventListener('click', () => signOut());

function afficherEcran(nom) {
  if (authScreen) authScreen.style.display = nom === 'auth' ? 'flex' : 'none';
  if (ecranRefus) ecranRefus.style.display = nom === 'refus' ? 'block' : 'none';
  if (contenu) contenu.style.display = nom === 'contenu' ? 'block' : 'none';
}

async function verifierAcces() {
  const session = await getSession();
  if (!session) {
    afficherEcran('auth');
    return;
  }

  // Le droit est lu depuis la base, pas déduit côté client.
  // Même si cette vérification était contournée, les policies RLS
  // empêcheraient la lecture des données : c'est elles qui
  // protègent, pas cet écran.
  const { data, error } = await supabase
    .from('profils')
    .select('role')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Lecture du profil impossible :', error);
    afficherEcran('refus');
    return;
  }

  if (!data || data.role !== 'administrateur') {
    afficherEcran('refus');
    return;
  }

  sessionCourante = session;
  afficherEcran('contenu');
  await charger();
}

onAuthChange(() => verifierAcces());
verifierAcces();

// ------------------------------------------------------------
// Chargement des données
// ------------------------------------------------------------
async function charger() {
  const [resProfils, resParcours, listeSignalements] = await Promise.all([
    supabase.from('profils').select('user_id, nom'),
    supabase.from('parcours').select('*').order('date_debut', { ascending: false }),
    chargerSignalements(supabase),
  ]);
  signalements = listeSignalements;

  if (resProfils.error) console.error('Profils :', resProfils.error);
  if (resParcours.error) {
    if (listeEl) listeEl.innerHTML = `<div class="etat">Erreur de chargement : ${resParcours.error.message}</div>`;
    return;
  }

  profils = new Map((resProfils.data || []).map((p) => [p.user_id, p.nom || 'Sans nom']));
  parcours = resParcours.data || [];

  await chargerJournal();
  await chargerComptes();

  construireFiltrePersonnes();
  brancherFiltresSignalements();
  rendre();
  rendreSignalements();
  rendreJournal();
  rendreComptes();
  await afficherCarte();
}

function construireFiltrePersonnes() {
  const conteneur = document.getElementById('filtres');
  if (!conteneur) return;

  // On retire les anciens boutons de personne (hors « toutes »)
  conteneur.querySelectorAll('.f-personne[data-user]:not([data-user="tous"])').forEach((b) => b.remove());

  const auteurs = [...new Set(parcours.map((p) => p.user_id))];
  const separateur = conteneur.querySelector('.separateur');

  auteurs.forEach((uid) => {
    const btn = document.createElement('button');
    btn.className = 'f-personne';
    btn.dataset.user = uid;
    btn.textContent = profils.get(uid) || 'Inconnu';
    conteneur.insertBefore(btn, separateur);
  });

  conteneur.querySelectorAll('.f-personne').forEach((btn) => {
    btn.addEventListener('click', () => {
      conteneur.querySelectorAll('.f-personne').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filtrePersonne = btn.dataset.user;
      rendre();
      rendreSignalements();
      dessinerTraces();
      dessinerSignalements();
    });
  });

  conteneur.querySelectorAll('.f-type').forEach((btn) => {
    btn.addEventListener('click', () => {
      conteneur.querySelectorAll('.f-type').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filtreType = btn.dataset.type;
      rendre();
      dessinerTraces();
    });
  });
}

function parcoursFiltres() {
  return parcours.filter(
    (p) =>
      (filtrePersonne === 'tous' || p.user_id === filtrePersonne) &&
      (filtreType === 'tous' || p.type === filtreType)
  );
}

// ------------------------------------------------------------
// Rendu : synthèse + liste
// ------------------------------------------------------------
function rendre() {
  const liste = parcoursFiltres();

  const synthese = document.getElementById('synthese');
  if (synthese) {
    const distance = liste.reduce((s, p) => s + (p.distance_m || 0), 0);
    const duree = liste.reduce((s, p) => s + (p.duree_s || 0), 0);
    const cout = liste.reduce((s, p) => s + (Number(p.cout_estime_eur) || 0), 0);
    const personnes = new Set(liste.map((p) => p.user_id)).size;

    const cases = [
      [String(liste.length), 'Parcours'],
      [formatDistance(distance), 'Distance totale'],
      [formatDuree(duree), 'Temps cumulé'],
      [`${cout.toFixed(2)} €`, 'Coût cumulé'],
      [String(personnes), personnes > 1 ? 'Personnes' : 'Personne'],
    ];

    synthese.innerHTML = cases
      .map(([v, l]) => `<div class="synthese-carte"><div class="synthese-val">${v}</div><div class="synthese-label">${l}</div></div>`)
      .join('');
  }

  if (!listeEl) return;

  if (liste.length === 0) {
    listeEl.className = 'etat';
    listeEl.innerHTML = 'Aucun parcours ne correspond à cette sélection.';
    return;
  }

  listeEl.className = '';
  listeEl.innerHTML = liste
    .map(
      (p) => `
    <div class="parcours-ligne" data-id="${p.id}">
      <div class="pl-haut">
        <div>
          <div class="pl-titre">${p.titre || 'Parcours'}</div>
          <div class="pl-meta">
            <span class="pl-auteur">${profils.get(p.user_id) || 'Inconnu'}</span>${formatDate(p.date_debut)}
          </div>
        </div>
        <div class="pl-badges">
          <span class="pl-type ${p.type}">${p.type === 'voiture' ? 'Voiture' : 'À pied'}</span>
          <button class="pl-suppr" data-suppr="${p.id}" aria-label="Supprimer ce parcours">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>
          </button>
        </div>
      </div>
      <div class="pl-stats">
        <div><div class="pl-val">${formatDistance(p.distance_m)}</div><div class="pl-lab">Distance</div></div>
        <div><div class="pl-val">${formatDuree(p.duree_s)}</div><div class="pl-lab">Durée</div></div>
        <div><div class="pl-val">${p.vitesse_moy != null ? p.vitesse_moy + ' km/h' : '—'}</div><div class="pl-lab">Moyenne</div></div>
        <div><div class="pl-val">${p.vitesse_max != null ? p.vitesse_max + ' km/h' : '—'}</div><div class="pl-lab">Pointe</div></div>
        <div><div class="pl-val">${p.denivele_positif != null ? p.denivele_positif + ' m' : '—'}</div><div class="pl-lab">Dénivelé</div></div>
        <div><div class="pl-val">${p.nb_virages ?? '—'}</div><div class="pl-lab">Virages</div></div>
        <div><div class="pl-val">${p.cout_estime_eur != null ? p.cout_estime_eur + ' €' : '—'}</div><div class="pl-lab">Coût</div></div>
        <div><div class="pl-val">${p.temperature_c != null ? p.temperature_c + '°C' : '—'}</div><div class="pl-lab">Météo</div></div>
      </div>
    </div>`
    )
    .join('');

  listeEl.querySelectorAll('[data-suppr]').forEach((btn) => {
    btn.addEventListener('click', () => supprimer(btn.dataset.suppr));
  });
}

async function supprimer(id) {
  const p = parcours.find((x) => x.id === id);
  if (!p) return;

  const auteur = profils.get(p.user_id) || 'un utilisateur';
  const ok = confirm(
    `Supprimer définitivement ce parcours de ${auteur} ?\n\n${p.titre || 'Parcours'} — ${formatDistance(p.distance_m)}\n\nLes points GPS et événements associés seront également supprimés.`
  );
  if (!ok) return;

  const { error } = await supabase.from('parcours').delete().eq('id', id);
  if (error) {
    alert(`Suppression impossible : ${error.message}`);
    return;
  }

  parcours = parcours.filter((x) => x.id !== id);
  cacheTraces.delete(id);
  rendre();
  dessinerTraces();
}

// ------------------------------------------------------------
// Carte
// ------------------------------------------------------------
const TAILLE_PAGE = 1000;

async function chargerPoints(parcoursId) {
  const tous = [];
  let debut = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('points_gps')
      .select('lat, lng')
      .eq('parcours_id', parcoursId)
      .order('id', { ascending: true })
      .range(debut, debut + TAILLE_PAGE - 1);
    if (error || !data || data.length === 0) break;
    tous.push(...data);
    if (data.length < TAILLE_PAGE) break;
    debut += TAILLE_PAGE;
  }
  return tous;
}

const cacheTraces = new Map();

async function tracePour(id) {
  if (cacheTraces.has(id)) return cacheTraces.get(id);
  const pts = await chargerPoints(id);
  cacheTraces.set(id, pts);
  return pts;
}

async function afficherCarte() {
  if (carte) {
    await dessinerTraces();
    return;
  }
  carte = new maplibregl.Map({
    container: 'carte-sup',
    style: STYLES[localStorage.getItem('iter_map_style') || 'standard'],
    center: [2.6167, 48.8],
    zoom: 11,
  });
  await new Promise((r) => carte.once('load', r));
  await dessinerTraces();
  dessinerSignalements();
}

const MAX_TRACES = 40;

async function dessinerTraces() {
  if (!carte) return;

  const liste = parcoursFiltres().slice(0, MAX_TRACES);
  const features = [];

  for (const p of liste) {
    const pts = await tracePour(p.id);
    if (pts.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { type: p.type },
      geometry: { type: 'LineString', coordinates: pts.map((pt) => [pt.lng, pt.lat]) },
    });
  }

  const geojson = { type: 'FeatureCollection', features };

  if (carte.getSource('traces-sup')) {
    carte.getSource('traces-sup').setData(geojson);
  } else {
    carte.addSource('traces-sup', { type: 'geojson', data: geojson });
    carte.addLayer({
      id: 'traces-sup-ligne',
      type: 'line',
      source: 'traces-sup',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-width': 4,
        'line-color': ['match', ['get', 'type'], 'voiture', '#3fb6f5', 'pied', '#3ddc97', '#8b93a7'],
        'line-opacity': 0.85,
      },
    });
  }

  if (features.length > 0) {
    const premier = features[0].geometry.coordinates[0];
    const bounds = features.reduce(
      (b, f) => f.geometry.coordinates.reduce((bb, c) => bb.extend(c), b),
      new maplibregl.LngLatBounds(premier, premier)
    );
    carte.fitBounds(bounds, { padding: 40, duration: 400 });
  }
}

// ------------------------------------------------------------
// Export CSV global
// ------------------------------------------------------------
document.getElementById('btn-export-tout')?.addEventListener('click', () => {
  const liste = parcoursFiltres();
  if (liste.length === 0) {
    alert('Aucun parcours à exporter pour cette sélection.');
    return;
  }

  const colonnes = [
    'personne', 'titre', 'type', 'date_debut', 'date_fin', 'distance_m', 'duree_s',
    'vitesse_moy', 'vitesse_max', 'denivele_positif', 'denivele_negatif',
    'nb_virages', 'allure_sec_km', 'calories', 'cout_estime_eur', 'temperature_c',
  ];

  const echapper = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lignes = liste.map((p) =>
    colonnes
      .map((c) => echapper(c === 'personne' ? profils.get(p.user_id) || 'Inconnu' : p[c]))
      .join(',')
  );

  const contenuCsv = colonnes.join(',') + '\n' + lignes.join('\n');
  const blob = new Blob([contenuCsv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iter-supervision-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  // a.remove() plutôt que document.body.removeChild(a) : la
  // seconde forme lève « The node to be removed is not a child of
  // this node » si le navigateur a déjà détaché le lien, ce qui
  // arrive sur Safari et quand une navigation suit le clic.
  // a.remove() ne fait rien dans ce cas, sans lever d'erreur.
  a.remove();
  // Révocation différée : la faire immédiatement après le clic
  // interrompt le téléchargement sur certains navigateurs, qui
  // n'ont pas encore fini de lire le blob.
  setTimeout(() => URL.revokeObjectURL(url), 15000);
});

// ------------------------------------------------------------
// Signalements — liste, traitement, affichage cartographique
// ------------------------------------------------------------
function brancherFiltresSignalements() {
  document.querySelectorAll('.f-sig').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.f-sig').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filtreStatutSig = btn.dataset.statut;
      rendreSignalements();
      dessinerSignalements();
    });
  });
}

function signalementsFiltres() {
  return signalements.filter((s) => {
    if (filtrePersonne !== 'tous' && s.user_id !== filtrePersonne) return false;
    if (filtreStatutSig === 'tous') return true;
    if (filtreStatutSig === 'ouvert') return s.statut !== 'traite';
    return s.statut === filtreStatutSig;
  });
}

function rendreSignalements() {
  const el = document.getElementById('liste-signalements');
  if (!el) return;

  const liste = signalementsFiltres();

  if (liste.length === 0) {
    el.className = 'etat';
    el.innerHTML = 'Aucun signalement pour cette sélection.';
    return;
  }

  el.className = '';
  el.innerHTML = liste
    .map((s) => {
      const def = TYPES_SIGNALEMENT[s.type];
      if (!def) return '';
      const date = new Date(s.created_at).toLocaleString('fr-FR', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      const traite = s.statut === 'traite';
      return `
      <div class="sig-ligne ${traite ? 'traite' : ''}" data-id="${s.id}">
        <div class="sig-rond" style="background:${def.couleur}">${svgSignalement(s.type, 19, '#0a0e1a')}</div>
        <div class="sig-infos">
          <div class="sig-type">${def.libelle}</div>
          <div class="sig-meta">${profils.get(s.user_id) || 'Inconnu'} · ${date}${traite ? ' · traité' : ''}</div>
          ${s.commentaire ? `<div class="sig-note">« ${s.commentaire} »</div>` : ''}
        </div>
        <div class="sig-actions">
          <button class="localiser" data-loc="${s.id}" title="Localiser sur la carte" aria-label="Localiser">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          </button>
          ${
            traite
              ? `<button class="rouvrir" data-rouvrir="${s.id}" title="Rouvrir" aria-label="Rouvrir">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5M3.05 13a9 9 0 1 0 2.13-6.36L3 8"/></svg>
                 </button>`
              : `<button class="valider" data-traiter="${s.id}" title="Marquer comme traité" aria-label="Marquer comme traité">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                 </button>`
          }
          <button class="suppr" data-suppr-sig="${s.id}" title="Supprimer" aria-label="Supprimer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>
          </button>
        </div>
      </div>`;
    })
    .join('');

  el.querySelectorAll('[data-traiter]').forEach((b) =>
    b.addEventListener('click', () => majStatut(b.dataset.traiter, 'traite'))
  );
  el.querySelectorAll('[data-rouvrir]').forEach((b) =>
    b.addEventListener('click', () => majStatut(b.dataset.rouvrir, 'ouvert'))
  );
  el.querySelectorAll('[data-suppr-sig]').forEach((b) =>
    b.addEventListener('click', () => effacerSignalement(b.dataset.supprSig))
  );
  el.querySelectorAll('[data-loc]').forEach((b) =>
    b.addEventListener('click', () => localiser(b.dataset.loc))
  );
}

async function majStatut(id, statut) {
  try {
    await changerStatutSignalement(supabase, sessionCourante, id, statut);
    const s = signalements.find((x) => x.id === id);
    if (s) s.statut = statut;
    rendreSignalements();
    dessinerSignalements();
  } catch (err) {
    alert(`Mise à jour impossible : ${err.message}`);
  }
}

async function effacerSignalement(id) {
  const s = signalements.find((x) => x.id === id);
  if (!s) return;
  const def = TYPES_SIGNALEMENT[s.type];
  if (!confirm(`Supprimer définitivement ce signalement « ${def ? def.libelle : s.type} » ?`)) return;

  try {
    await supprimerSignalement(supabase, id, s.photo_chemin);
    signalements = signalements.filter((x) => x.id !== id);
    rendreSignalements();
    dessinerSignalements();
  } catch (err) {
    alert(`Suppression impossible : ${err.message}`);
  }
}

function localiser(id) {
  const s = signalements.find((x) => x.id === id);
  if (!s || !carte) return;
  document.getElementById('carte-sup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  carte.easeTo({ center: [s.lng, s.lat], zoom: 17, duration: 700 });
}

function dessinerSignalements() {
  if (!carte) return;
  marqueursSig.forEach((m) => m.remove());
  marqueursSig = [];

  signalementsFiltres().forEach((s) => {
    const marqueur = creerMarqueurSignalement(s, { auteur: profils.get(s.user_id), supabase });
    if (marqueur) {
      marqueur.addTo(carte);
      marqueursSig.push(marqueur);
    }
  });
}

// ------------------------------------------------------------
// Journal d'activité — qui a créé, traité, modifié, supprimé.
// Réservé à l'administrateur : la policy RLS du journal ne
// renvoie rien aux autres comptes, quoi qu'ils tentent.
// ------------------------------------------------------------
let journal = [];
let filtreJournal = 'tous';

const LIBELLES_ACTION = {
  creation: 'a créé',
  traitement: 'a traité',
  modification: 'a modifié',
  suppression: 'a supprimé',
};

const LIBELLES_CIBLE = {
  signalements: 'un signalement',
  parcours: 'un parcours',
};

async function chargerJournal() {
  // Lecture via la vue : elle joint le nom de l'auteur et
  // n'expose rien sans habilitation explicite.
  const { data, error } = await supabase
    .from('vue_journal')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('Journal indisponible :', error);
    journal = [];
    return;
  }
  journal = data || [];
}

function resumeDetails(j) {
  const d = j.details || {};
  const morceaux = [];

  if (d.type) morceaux.push(d.type);
  if (d.titre) morceaux.push(`« ${d.titre} »`);
  if (d.nom) morceaux.push(`« ${d.nom} »`);
  if (d.cible) morceaux.push(`pour ${d.cible}`);

  if (j.action === 'traitement' && d.ancien_statut) {
    morceaux.push(`${d.ancien_statut} → ${d.nouveau_statut}`);
  }
  if (j.action === 'suppression') {
    if (d.auteur_initial) morceaux.push(`créé par ${d.auteur_initial}`);
    if (d.etait_traite === true) morceaux.push('déjà traité');
    if (d.points_gps_perdus) morceaux.push(`${d.points_gps_perdus} points GPS perdus`);
    if (d.distance_m) morceaux.push(`${(d.distance_m / 1000).toFixed(2)} km`);
  }
  return morceaux.join(' · ');
}

function rendreJournal() {
  const el = document.getElementById('liste-journal');
  if (!el) return;

  const liste = journal.filter((j) => filtreJournal === 'tous' || j.action === filtreJournal);

  if (liste.length === 0) {
    el.className = 'etat';
    el.innerHTML = journal.length === 0
      ? "Aucune entrée. Si vous êtes administrateur sans voir le journal, c'est que l'habilitation ne vous a pas été accordée : elle est distincte du rôle."
      : 'Aucune activité pour cette sélection.';
    return;
  }

  el.className = '';
  el.innerHTML = liste
    .map((j) => {
      const quand = new Date(j.created_at).toLocaleString('fr-FR', {
        day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      const cible = LIBELLES_CIBLE[j.table_cible] || j.table_cible;
      const resume = resumeDetails(j);
      const contenuSupprime = j.donnees_supprimees
        ? `<button class="jr-voir" data-donnees="${j.id}">Voir la donnée supprimée</button>`
        : '';

      return `
      <div class="jr-ligne ${j.action}">
        <span class="jr-pastille"></span>
        <span class="jr-quoi">
          <span class="jr-qui">${j.auteur}</span> ${LIBELLES_ACTION[j.action] || j.action} ${cible}
          ${resume ? `<span class="jr-detail">${resume}</span>` : ''}
          ${contenuSupprime}
        </span>
        <span class="jr-quand">${quand}</span>
      </div>`;
    })
    .join('');

  // Consultation du contenu supprimé
  el.querySelectorAll('[data-donnees]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entree = journal.find((x) => String(x.id) === btn.dataset.donnees);
      if (!entree || !entree.donnees_supprimees) return;

      const lignes = Object.entries(entree.donnees_supprimees)
        .filter(([, v]) => v !== null && v !== '')
        .map(([k, v]) => `${k} : ${v}`)
        .join('\n');

      alert(`Donnée supprimée le ${new Date(entree.created_at).toLocaleString('fr-FR')}\npar ${entree.auteur}\n\n${lignes}`);
    });
  });
}

document.querySelectorAll('.f-journal').forEach((btn) => {
  btn?.addEventListener('click', () => {
    document.querySelectorAll('.f-journal').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filtreJournal = btn.dataset.action;
    rendreJournal();
  });
});

// ============================================================
// ADMINISTRATION DES COMPTES
//
// Chaque option est activable et désactivable individuellement.
// L'interface n'est qu'une commande : c'est la base qui applique
// réellement les droits, et qui refuse toute écriture venant
// d'un compte non administrateur.
// ============================================================
const DOMAINES = { pm: 'Parcours (PM)', te: 'Signalements (T&E)' };
const DROITS = {
  consulter: 'Consulter tout',
  enregistrer: 'Enregistrer',
  traiter: 'Traiter',
  modifier: 'Modifier',
  supprimer: 'Supprimer',
};
const ENERGIES = { gazole: 'Gazole', essence: 'Essence', electrique: 'Électrique' };

const COCHE = '<svg viewBox="0 0 24 24" fill="none" stroke="#06121a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

let comptes = [];

async function chargerComptes() {
  const { data, error } = await supabase.from('vue_comptes').select('*').order('email');
  if (error) {
    console.error('Comptes indisponibles :', error);
    comptes = [];
    return;
  }

  // La vue renvoie une ligne par domaine : on regroupe par personne
  const parPersonne = new Map();
  (data || []).forEach((l) => {
    if (!parPersonne.has(l.user_id)) {
      parPersonne.set(l.user_id, {
        user_id: l.user_id,
        email: l.email,
        nom: l.nom,
        role: l.role,
        type_energie: l.type_energie,
        consommation: l.consommation,
        domaines: {},
      });
    }
    if (l.domaine) {
      parPersonne.get(l.user_id).domaines[l.domaine] = {
        consulter: l.consulter, enregistrer: l.enregistrer,
        traiter: l.traiter, modifier: l.modifier, supprimer: l.supprimer,
      };
    }
  });
  comptes = [...parPersonne.values()];
}

function rendreComptes() {
  const el = document.getElementById('liste-comptes');
  if (!el) return;

  if (comptes.length === 0) {
    el.className = 'etat';
    el.innerHTML = 'Aucun compte à afficher.';
    return;
  }

  const nbAdmins = comptes.filter((c) => c.role === 'administrateur').length;

  el.className = '';
  el.innerHTML = comptes
    .map((c) => {
      const estAdmin = c.role === 'administrateur';
      // On empêche de retirer le dernier administrateur : la base
      // refuserait de toute façon, autant le rendre visible.
      const dernierAdmin = estAdmin && nbAdmins <= 1;

      const domaines = Object.entries(DOMAINES)
        .map(([cle, libelle]) => {
          const d = c.domaines[cle] || {};
          const droits = Object.entries(DROITS)
            .map(([droit, nom]) => `
              <button class="cc-droit ${d[droit] ? 'actif' : ''}"
                      data-user="${c.user_id}" data-domaine="${cle}" data-droit="${droit}"
                      ${estAdmin ? 'disabled title="Un administrateur dispose déjà de tous les droits"' : ''}>
                <span class="puce">${COCHE}</span>${nom}
              </button>`)
            .join('');
          return `<div class="cc-domaine">
                    <div class="cc-domaine-titre">${libelle}</div>
                    <div class="cc-droits">${droits}</div>
                  </div>`;
        })
        .join('');

      return `
      <div class="compte-carte" data-carte="${c.user_id}">
        <div class="cc-entete">
          <div class="cc-identite">
            <div class="cc-nom">${c.nom || c.email.split('@')[0]}</div>
            <div class="cc-mail">${c.email}</div>
          </div>
          <button class="cc-droit ${estAdmin ? 'actif' : ''}" data-user="${c.user_id}" data-role
                  ${dernierAdmin ? 'disabled title="Dernier administrateur : le rôle ne peut pas être retiré"' : ''}>
            <span class="puce">${COCHE}</span>Administrateur
          </button>
        </div>

        ${domaines}

        <div class="cc-reglages">
          <label for="energie-${c.user_id}">Véhicule</label>
          <select id="energie-${c.user_id}" data-user="${c.user_id}" data-energie>
            ${Object.entries(ENERGIES).map(([v, n]) => `<option value="${v}" ${c.type_energie === v ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <input type="number" step="0.1" min="0" value="${c.consommation ?? ''}"
                 data-user="${c.user_id}" data-conso
                 title="${c.type_energie === 'electrique' ? 'kWh pour 100 km' : 'litres pour 100 km'}">
          <span style="font-size:11px;color:var(--ink-dim);">${c.type_energie === 'electrique' ? 'kWh/100 km' : 'L/100 km'}</span>
          <span class="cc-retour" data-retour="${c.user_id}"></span>
        </div>
      </div>`;
    })
    .join('');

  brancherAdministration();
}

function retourCompte(userId, texte, type = '') {
  const el = document.querySelector(`[data-retour="${userId}"]`);
  if (!el) return;
  el.textContent = texte;
  el.className = `cc-retour ${type}`;
  if (texte) setTimeout(() => { if (el.textContent === texte) el.textContent = ''; }, 3000);
}

function brancherAdministration() {
  // Bascule d'un droit
  document.querySelectorAll('.cc-droit[data-droit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const { user, domaine, droit } = btn.dataset;
      const compte = comptes.find((c) => c.user_id === user);
      if (!compte) return;

      const actuel = (compte.domaines[domaine] || {})[droit] === true;
      const nouveau = !actuel;

      btn.disabled = true;
      const ligne = { user_id: user, domaine, ...(compte.domaines[domaine] || {}), [droit]: nouveau };
      // upsert : la ligne du domaine peut ne pas exister encore
      const { error } = await supabase.from('droits').upsert(
        {
          user_id: user,
          domaine,
          consulter: ligne.consulter === true,
          enregistrer: ligne.enregistrer === true,
          traiter: ligne.traiter === true,
          modifier: ligne.modifier === true,
          supprimer: ligne.supprimer === true,
        },
        { onConflict: 'user_id,domaine' }
      );
      btn.disabled = false;

      if (error) {
        retourCompte(user, `Échec : ${error.message}`, 'erreur');
        return;
      }

      compte.domaines[domaine] = { ...(compte.domaines[domaine] || {}), [droit]: nouveau };
      btn.classList.toggle('actif', nouveau);
      retourCompte(user, `${DROITS[droit]} ${nouveau ? 'activé' : 'désactivé'}`, 'succes');
    });
  });

  // Bascule du rôle administrateur
  document.querySelectorAll('.cc-droit[data-role]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const user = btn.dataset.user;
      const compte = comptes.find((c) => c.user_id === user);
      if (!compte) return;

      const nouveau = compte.role === 'administrateur' ? 'utilisateur' : 'administrateur';
      if (!confirm(
        nouveau === 'administrateur'
          ? `Accorder TOUS les droits à ${compte.nom || compte.email} ?`
          : `Retirer le rôle administrateur à ${compte.nom || compte.email} ?`
      )) return;

      btn.disabled = true;
      const { error } = await supabase.from('profils').update({ role: nouveau }).eq('user_id', user);
      btn.disabled = false;

      if (error) {
        retourCompte(user, `Échec : ${error.message}`, 'erreur');
        return;
      }
      compte.role = nouveau;
      await chargerComptes();
      rendreComptes();
    });
  });

  // Type d'énergie du véhicule
  document.querySelectorAll('select[data-energie]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const user = sel.dataset.user;
      const { error } = await supabase.from('profils').update({ type_energie: sel.value }).eq('user_id', user);
      if (error) { retourCompte(user, `Échec : ${error.message}`, 'erreur'); return; }
      const compte = comptes.find((c) => c.user_id === user);
      if (compte) compte.type_energie = sel.value;
      retourCompte(user, 'Véhicule mis à jour', 'succes');
      rendreComptes(); // l'unité affichée dépend de l'énergie
    });
  });

  // Consommation
  document.querySelectorAll('input[data-conso]').forEach((champ) => {
    champ.addEventListener('change', async () => {
      const user = champ.dataset.user;
      const valeur = parseFloat(champ.value);
      if (Number.isNaN(valeur) || valeur < 0) {
        retourCompte(user, 'Valeur invalide', 'erreur');
        return;
      }
      const { error } = await supabase.from('profils').update({ consommation: valeur }).eq('user_id', user);
      if (error) { retourCompte(user, `Échec : ${error.message}`, 'erreur'); return; }
      const compte = comptes.find((c) => c.user_id === user);
      if (compte) compte.consommation = valeur;
      retourCompte(user, 'Consommation mise à jour', 'succes');
    });
  });
}

// Autoriser une nouvelle adresse à créer un compte
document.getElementById('btn-ajouter-compte')?.addEventListener('click', async () => {
  const email = prompt(
    "Adresse email à autoriser :\n\nLa personne pourra ensuite créer son compte depuis l'application. Ses droits seront à activer ici une fois le compte créé."
  );
  if (!email) return;

  const propre = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(propre)) {
    alert('Adresse invalide.');
    return;
  }

  const { error } = await supabase.from('emails_autorises').insert({ email: propre, note: 'ajouté depuis la supervision' });
  if (error) {
    alert(error.message.includes('duplicate') ? 'Cette adresse est déjà autorisée.' : `Échec : ${error.message}`);
    return;
  }
  alert(`${propre} peut désormais créer son compte.`);
});

// Export du journal — trace hors ligne, conservable
document.getElementById('btn-export-journal')?.addEventListener('click', () => {
  if (journal.length === 0) {
    alert('Aucune entrée à exporter.');
    return;
  }
  const colonnes = ['created_at', 'auteur', 'auteur_email', 'action', 'domaine', 'table_cible', 'enregistrement_id', 'details', 'donnees_supprimees'];
  const echapper = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const contenu = colonnes.join(',') + '\n' +
    journal.map((j) => colonnes.map((c) => echapper(j[c])).join(',')).join('\n');

  const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iter-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  // a.remove() plutôt que document.body.removeChild(a) : la
  // seconde forme lève « The node to be removed is not a child of
  // this node » si le navigateur a déjà détaché le lien, ce qui
  // arrive sur Safari et quand une navigation suit le clic.
  // a.remove() ne fait rien dans ce cas, sans lever d'erreur.
  a.remove();
  // Révocation différée : la faire immédiatement après le clic
  // interrompt le téléchargement sur certains navigateurs, qui
  // n'ont pas encore fini de lire le blob.
  setTimeout(() => URL.revokeObjectURL(url), 15000);
});
