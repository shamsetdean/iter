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
  svgIcone, LIBELLES_PRIORITE, LIBELLES_STATUT, LIBELLES_ICONES,
  chargerCategories, chargerToutesSousCategories, chargerServices,
  enregistrerCategorie, supprimerCategorie, basculerActiveCategorie,
  enregistrerSousCategorie, supprimerSousCategorie, basculerActiveSousCategorie,
  reordonner, slugify,
} from './categories.js';
import {
  chargerSignalements,
  changerStatutSignalement,
  changerPrioriteSignalement,
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
let filtreStatutSig = 'actifs';
let marqueursSig = [];
let sessionCourante = null;
// estAdminComplet : rôle "administrateur" (tous les droits, y
// compris administration des comptes et journal d'activité).
// estAccesDashboard : peut ouvrir cette page (droits.te.acces_dashboard
// ou administrateur), mais sans forcément voir la gestion des comptes.
let estAdminComplet = false;
let estAccesDashboard = false;

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
  const [resProfil, resDroitTe] = await Promise.all([
    supabase.from('profils').select('role').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('droits').select('acces_dashboard').eq('user_id', session.user.id).eq('domaine', 'te').maybeSingle(),
  ]);

  if (resProfil.error) {
    console.error('Lecture du profil impossible :', resProfil.error);
    afficherEcran('refus');
    return;
  }

  estAdminComplet = Boolean(resProfil.data && resProfil.data.role === 'administrateur');
  estAccesDashboard = estAdminComplet || Boolean(resDroitTe.data && resDroitTe.data.acces_dashboard);

  if (!estAccesDashboard) {
    afficherEcran('refus');
    return;
  }

  // La gestion des comptes/droits et le journal d'activité restent
  // réservés à l'administrateur complet : un accès "tableau de
  // bord" seul ne donne qu'une vue de supervision opérationnelle.
  document.getElementById('zone-admin-complet')?.style.setProperty('display', estAdminComplet ? '' : 'none');
  const btnAjouterCompte = document.getElementById('btn-ajouter-compte');
  if (btnAjouterCompte) btnAjouterCompte.style.display = estAdminComplet ? 'flex' : 'none';

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

  construireFiltrePersonnes();
  brancherFiltresSignalements();
  rendre();
  rendreSignalements();

  if (estAdminComplet) {
    await chargerJournal();
    await chargerComptes();
    await chargerCategoriesAdmin();
    rendreJournal();
    rendreComptes();
    rendreCategoriesAdmin();
  }

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

const STATUTS_CLOS = ['resolu', 'cloture', 'non_recevable'];

function signalementsFiltres() {
  return signalements.filter((s) => {
    if (filtrePersonne !== 'tous' && s.user_id !== filtrePersonne) return false;
    if (filtreStatutSig === 'tous') return true;
    if (filtreStatutSig === 'actifs') return !STATUTS_CLOS.includes(s.statut);
    return STATUTS_CLOS.includes(s.statut);
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
      const prio = LIBELLES_PRIORITE[s.priorite] || LIBELLES_PRIORITE.normal;
      const nomAffiche = s.sous_categorie_nom || s.categorie_nom || 'Signalement';
      const date = new Date(s.created_at).toLocaleString('fr-FR', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      const clos = STATUTS_CLOS.includes(s.statut);
      return `
      <div class="sig-ligne ${clos ? 'traite' : ''}" data-id="${s.id}">
        <div class="sig-rond" style="background:${prio.couleur}">${svgIcone(s.categorie_icone || 'autre', 19, '#0a0e1a')}</div>
        <div class="sig-infos">
          <div class="sig-type">${prio.emoji} ${nomAffiche}</div>
          <div class="sig-meta">${s.categorie_nom || ''}${s.categorie_nom ? ' · ' : ''}${profils.get(s.user_id) || 'Inconnu'} · ${date} · ${LIBELLES_STATUT[s.statut] || s.statut}</div>
          ${s.commentaire ? `<div class="sig-note">« ${s.commentaire} »</div>` : ''}
        </div>
        <div class="sig-actions">
          <button class="localiser" data-loc="${s.id}" title="Localiser sur la carte" aria-label="Localiser">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          </button>
          ${
            estAdminComplet
              ? `<select class="sig-statut-select" data-prio-select="${s.id}" title="Priorité">
                  ${Object.entries(LIBELLES_PRIORITE).map(([v, p]) => `<option value="${v}" ${s.priorite === v ? 'selected' : ''}>${p.emoji} ${p.libelle}</option>`).join('')}
                 </select>`
              : ''
          }
          ${
            estAdminComplet
              ? `<select class="sig-statut-select" data-statut-select="${s.id}">
                  ${Object.entries(LIBELLES_STATUT).map(([v, l]) => `<option value="${v}" ${s.statut === v ? 'selected' : ''}>${l}</option>`).join('')}
                 </select>`
              : ''
          }
          ${
            estAdminComplet
              ? `<button class="suppr" data-suppr-sig="${s.id}" title="Supprimer" aria-label="Supprimer">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>
                 </button>`
              : ''
          }
        </div>
      </div>`;
    })
    .join('');

  // Changer le statut / supprimer depuis ce tableau de bord restent
  // réservés à l'administrateur complet — un accès "dashboard"
  // seul est une vue de consultation, pas un outil de modération
  // sur les signalements d'autrui.
  if (estAdminComplet) {
    el.querySelectorAll('[data-statut-select]').forEach((sel) =>
      sel.addEventListener('change', (e) => majStatut(sel.dataset.statutSelect, e.target.value))
    );
    el.querySelectorAll('[data-prio-select]').forEach((sel) =>
      sel.addEventListener('change', (e) => majPriorite(sel.dataset.prioSelect, e.target.value))
    );
    el.querySelectorAll('[data-suppr-sig]').forEach((b) =>
      b.addEventListener('click', () => effacerSignalement(b.dataset.supprSig))
    );
  }
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

async function majPriorite(id, priorite) {
  try {
    await changerPrioriteSignalement(supabase, id, priorite);
    const s = signalements.find((x) => x.id === id);
    if (s) s.priorite = priorite;
    rendreSignalements();
    dessinerSignalements();
  } catch (err) {
    alert(`Mise à jour impossible : ${err.message}`);
  }
}

async function effacerSignalement(id) {
  const s = signalements.find((x) => x.id === id);
  if (!s) return;
  const libelle = s.sous_categorie_nom || s.categorie_nom || 'ce signalement';
  if (!confirm(`Supprimer définitivement ce signalement « ${libelle} » ?`)) return;

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

// ============================================================
// ADMINISTRATION DE LA TAXONOMIE — catégories et sous-catégories
// de signalement. Entièrement configurable ici, sans toucher au
// code (icône, service assigné, priorité par défaut, délai
// indicatif, ordre d'affichage, activation).
// ============================================================
let categoriesAdmin = [];
let sousCategoriesAdmin = [];
let servicesAdmin = [];

async function chargerCategoriesAdmin() {
  const [cats, subs, services] = await Promise.all([
    chargerCategories(supabase, { toutesInclusInactives: true }),
    chargerToutesSousCategories(supabase, { toutesInclusInactives: true }),
    chargerServices(supabase, { toutesInclusInactifs: true }),
  ]);
  categoriesAdmin = cats;
  sousCategoriesAdmin = subs;
  servicesAdmin = services;
}

function sousCategoriesDe(categoryId) {
  return sousCategoriesAdmin
    .filter((s) => s.category_id === categoryId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function rendreCategoriesAdmin() {
  const el = document.getElementById('liste-categories-admin');
  if (!el) return;

  if (categoriesAdmin.length === 0) {
    el.className = 'etat';
    el.innerHTML = 'Aucune catégorie.';
    return;
  }

  const optionsIcones = LIBELLES_ICONES.map((i) => `<option value="${i}">${i}</option>`).join('');
  const optionsServices = ['<option value="">— aucun —</option>']
    .concat(servicesAdmin.map((s) => `<option value="${s.id}">${s.nom}</option>`))
    .join('');
  const optionsPriorite = Object.entries(LIBELLES_PRIORITE)
    .map(([v, p]) => `<option value="${v}">${p.emoji} ${p.libelle}</option>`)
    .join('');

  const tri = [...categoriesAdmin].sort((a, b) => a.sort_order - b.sort_order);

  el.className = '';
  el.innerHTML = tri
    .map((c, index) => {
      const subs = sousCategoriesDe(c.id);
      const lignesSub = subs
        .map((s, si) => `
        <div class="cat-sub-ligne ${!s.is_active ? 'inactive' : ''}" data-sub="${s.id}">
          <button class="cat-fleche" data-sub-monter="${s.id}" ${si === 0 ? 'disabled' : ''} title="Monter">▲</button>
          <button class="cat-fleche" data-sub-descendre="${s.id}" ${si === subs.length - 1 ? 'disabled' : ''} title="Descendre">▼</button>
          <input type="text" class="cat-sub-nom" data-sub-nom="${s.id}" value="${s.nom.replace(/"/g, '&quot;')}">
          <select data-sub-service="${s.id}">${optionsServices}</select>
          <select data-sub-priorite="${s.id}">${optionsPriorite}</select>
          <input type="number" min="0" class="cat-sub-delai" data-sub-delai="${s.id}" value="${s.delai_indicatif_jours ?? ''}" title="Délai indicatif (jours)">
          <button class="cat-toggle ${s.is_active ? 'actif' : ''}" data-sub-toggle="${s.id}" title="${s.is_active ? 'Désactiver' : 'Activer'}">${s.is_active ? 'Actif' : 'Inactif'}</button>
          <button class="cat-suppr" data-sub-suppr="${s.id}" title="Supprimer">✕</button>
        </div>`)
        .join('');

      return `
      <div class="cat-carte ${!c.is_active ? 'inactive' : ''}" data-cat="${c.id}">
        <div class="cat-entete">
          <button class="cat-fleche" data-cat-monter="${c.id}" ${index === 0 ? 'disabled' : ''} title="Monter">▲</button>
          <button class="cat-fleche" data-cat-descendre="${c.id}" ${index === tri.length - 1 ? 'disabled' : ''} title="Descendre">▼</button>
          <span class="cat-icone-apercu">${svgIcone(c.icone, 20, 'var(--ink)')}</span>
          <input type="text" class="cat-nom" data-cat-nom="${c.id}" value="${c.nom.replace(/"/g, '&quot;')}">
          <select data-cat-icone="${c.id}">${optionsIcones}</select>
          <button class="cat-toggle ${c.is_active ? 'actif' : ''}" data-cat-toggle="${c.id}" title="${c.is_active ? 'Désactiver' : 'Activer'}">${c.is_active ? 'Active' : 'Inactive'}</button>
          <button class="cat-suppr" data-cat-suppr="${c.id}" title="Supprimer la catégorie et ses sous-catégories">✕</button>
        </div>
        <div class="cat-sous-liste">${lignesSub}</div>
        <button class="bt-action cat-ajouter-sub" data-ajouter-sub="${c.id}">+ Ajouter une sous-catégorie</button>
        <span class="cat-retour" data-cat-retour="${c.id}"></span>
      </div>`;
    })
    .join('');

  // Pré-sélectionne les <select> (fait après coup : plus simple
  // et plus sûr que d'injecter "selected" dans le HTML string).
  tri.forEach((c) => {
    const selIcone = el.querySelector(`[data-cat-icone="${c.id}"]`);
    if (selIcone) selIcone.value = c.icone;
    sousCategoriesDe(c.id).forEach((s) => {
      const selService = el.querySelector(`[data-sub-service="${s.id}"]`);
      if (selService) selService.value = s.service_id || '';
      const selPrio = el.querySelector(`[data-sub-priorite="${s.id}"]`);
      if (selPrio) selPrio.value = s.priorite_defaut;
    });
  });

  brancherCategoriesAdmin();
}

function retourCategorie(categoryId, texte, type = '') {
  const el = document.querySelector(`[data-cat-retour="${categoryId}"]`);
  if (!el) return;
  el.textContent = texte;
  el.className = `cat-retour ${type}`;
  if (texte) setTimeout(() => { if (el.textContent === texte) el.textContent = ''; }, 3000);
}

async function rafraichirEtRerendre() {
  await chargerCategoriesAdmin();
  rendreCategoriesAdmin();
}

function brancherCategoriesAdmin() {
  // ---- Catégories ----
  document.querySelectorAll('[data-cat-nom]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.catNom;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat || !input.value.trim()) return;
      try {
        await enregistrerCategorie(supabase, { ...cat, nom: input.value.trim() });
        cat.nom = input.value.trim();
        retourCategorie(id, 'Nom mis à jour', 'succes');
      } catch (err) {
        retourCategorie(id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-cat-icone]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.catIcone;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat) return;
      try {
        await enregistrerCategorie(supabase, { ...cat, icone: sel.value });
        cat.icone = sel.value;
        rendreCategoriesAdmin();
      } catch (err) {
        retourCategorie(id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-cat-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.catToggle;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat) return;
      try {
        await basculerActiveCategorie(supabase, id, !cat.is_active);
        cat.is_active = !cat.is_active;
        rendreCategoriesAdmin();
      } catch (err) {
        retourCategorie(id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-cat-suppr]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.catSuppr;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat) return;
      const nbSubs = sousCategoriesDe(id).length;
      if (!confirm(`Supprimer la catégorie « ${cat.nom} »${nbSubs ? ` et ses ${nbSubs} sous-catégorie(s)` : ''} ?\n\nLes signalements déjà envoyés dans cette catégorie ne sont pas supprimés, mais perdront leur classification.`)) return;
      try {
        await supprimerCategorie(supabase, id);
        await rafraichirEtRerendre();
      } catch (err) {
        alert(`Suppression impossible : ${err.message}`);
      }
    });
  });

  document.querySelectorAll('[data-cat-monter]').forEach((btn) => {
    btn.addEventListener('click', () => deplacerCategorie(btn.dataset.catMonter, -1));
  });
  document.querySelectorAll('[data-cat-descendre]').forEach((btn) => {
    btn.addEventListener('click', () => deplacerCategorie(btn.dataset.catDescendre, 1));
  });

  // ---- Sous-catégories ----
  document.querySelectorAll('[data-sub-nom]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.subNom;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub || !input.value.trim()) return;
      try {
        await enregistrerSousCategorie(supabase, { ...sub, nom: input.value.trim() });
        sub.nom = input.value.trim();
        retourCategorie(sub.category_id, 'Sous-catégorie mise à jour', 'succes');
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-service]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.subService;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      try {
        await enregistrerSousCategorie(supabase, { ...sub, service_id: sel.value || null });
        sub.service_id = sel.value || null;
        retourCategorie(sub.category_id, 'Service assigné', 'succes');
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-priorite]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.subPriorite;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      try {
        await enregistrerSousCategorie(supabase, { ...sub, priorite_defaut: sel.value });
        sub.priorite_defaut = sel.value;
        retourCategorie(sub.category_id, 'Priorité par défaut mise à jour', 'succes');
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-delai]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.subDelai;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      const valeur = input.value === '' ? null : parseInt(input.value, 10);
      try {
        await enregistrerSousCategorie(supabase, { ...sub, delai_indicatif_jours: valeur });
        sub.delai_indicatif_jours = valeur;
        retourCategorie(sub.category_id, 'Délai mis à jour', 'succes');
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.subToggle;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      try {
        await basculerActiveSousCategorie(supabase, id, !sub.is_active);
        sub.is_active = !sub.is_active;
        rendreCategoriesAdmin();
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-suppr]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.subSuppr;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      if (!confirm(`Supprimer la sous-catégorie « ${sub.nom} » ?\n\nLes signalements déjà envoyés avec ce choix ne sont pas supprimés, mais perdront leur classification.`)) return;
      try {
        await supprimerSousCategorie(supabase, id);
        await rafraichirEtRerendre();
      } catch (err) {
        alert(`Suppression impossible : ${err.message}`);
      }
    });
  });

  document.querySelectorAll('[data-sub-monter]').forEach((btn) => {
    btn.addEventListener('click', () => deplacerSousCategorie(btn.dataset.subMonter, -1));
  });
  document.querySelectorAll('[data-sub-descendre]').forEach((btn) => {
    btn.addEventListener('click', () => deplacerSousCategorie(btn.dataset.subDescendre, 1));
  });

  document.querySelectorAll('[data-ajouter-sub]').forEach((btn) => {
    btn.addEventListener('click', () => ajouterSousCategorie(btn.dataset.ajouterSub));
  });
}

async function deplacerCategorie(id, direction) {
  const tri = [...categoriesAdmin].sort((a, b) => a.sort_order - b.sort_order);
  const index = tri.findIndex((c) => c.id === id);
  const cible = index + direction;
  if (index < 0 || cible < 0 || cible >= tri.length) return;
  [tri[index], tri[cible]] = [tri[cible], tri[index]];
  try {
    await reordonner(supabase, 'categories_signalement', tri.map((c) => c.id));
    await rafraichirEtRerendre();
  } catch (err) {
    alert(`Réordonnancement impossible : ${err.message}`);
  }
}

async function deplacerSousCategorie(id, direction) {
  const sub = sousCategoriesAdmin.find((s) => s.id === id);
  if (!sub) return;
  const tri = sousCategoriesDe(sub.category_id);
  const index = tri.findIndex((s) => s.id === id);
  const cible = index + direction;
  if (index < 0 || cible < 0 || cible >= tri.length) return;
  [tri[index], tri[cible]] = [tri[cible], tri[index]];
  try {
    await reordonner(supabase, 'sous_categories_signalement', tri.map((s) => s.id));
    await rafraichirEtRerendre();
  } catch (err) {
    alert(`Réordonnancement impossible : ${err.message}`);
  }
}

async function ajouterSousCategorie(categoryId) {
  const nom = prompt('Nom de la nouvelle sous-catégorie :');
  if (!nom || !nom.trim()) return;

  let id = `${categoryId}-${slugify(nom)}`;
  let n = 2;
  while (sousCategoriesAdmin.some((s) => s.id === id)) { id = `${categoryId}-${slugify(nom)}-${n}`; n++; }

  const ordreMax = Math.max(0, ...sousCategoriesDe(categoryId).map((s) => s.sort_order));

  try {
    await enregistrerSousCategorie(supabase, {
      id,
      category_id: categoryId,
      nom: nom.trim(),
      priorite_defaut: 'normal',
      delai_indicatif_jours: 15,
      service_id: null,
      sort_order: ordreMax + 1,
      is_active: true,
    });
    await rafraichirEtRerendre();
  } catch (err) {
    alert(`Création impossible : ${err.message}`);
  }
}

document.getElementById('btn-ajouter-categorie')?.addEventListener('click', async () => {
  const nom = prompt('Nom de la nouvelle catégorie :');
  if (!nom || !nom.trim()) return;

  let id = slugify(nom);
  let n = 2;
  while (categoriesAdmin.some((c) => c.id === id)) { id = `${slugify(nom)}-${n}`; n++; }

  const ordreMax = Math.max(0, ...categoriesAdmin.map((c) => c.sort_order));

  try {
    await enregistrerCategorie(supabase, {
      id, nom: nom.trim(), icone: 'autre', sort_order: ordreMax + 1, is_active: true,
    });
    await rafraichirEtRerendre();
  } catch (err) {
    alert(`Création impossible : ${err.message}`);
  }
});
