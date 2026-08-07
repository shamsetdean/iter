// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

import { supabase, getSession } from './supabase-client.js';
import { partagerParcoursAvecVisuel } from './partage-visuel.js';
import { STYLES } from './map.js';
import { exportGPX, exportCSV } from './export.js';

const liste = document.getElementById('liste');
let tousLesParcours = [];
let filtreActuel = 'tous';

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

function formatAllure(secParKm) {
  if (secParKm == null) return '—';
  const min = Math.floor(secParKm / 60);
  const sec = secParKm % 60;
  return `${min}'${String(sec).padStart(2, '0')}"/km`;
}

// ------------------------------------------------------------
// Récupération PAGINÉE des points GPS.
// Supabase plafonne par défaut à 1000 lignes par requête : sans
// pagination, un trajet long était silencieusement tronqué et le
// tracé affiché était incomplet.
// ------------------------------------------------------------
const TAILLE_PAGE = 1000;

async function chargerTousLesPoints(parcoursId, colonnes = 'lat, lng') {
  const tous = [];
  let debut = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('points_gps')
      .select(colonnes)
      .eq('parcours_id', parcoursId)
      .order('id', { ascending: true })
      .range(debut, debut + TAILLE_PAGE - 1);

    if (error) {
      console.error('Erreur chargement points GPS:', error);
      break;
    }
    if (!data || data.length === 0) break;

    tous.push(...data);
    if (data.length < TAILLE_PAGE) break;
    debut += TAILLE_PAGE;
  }

  return tous;
}

// ------------------------------------------------------------
// Chargement initial
// ------------------------------------------------------------
async function charger() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  // Masquer le lien dans la barre du haut ne protège rien :
  // l'adresse de cette page reste saisissable directement. On
  // vérifie donc le droit ici aussi. Cela reste un confort
  // d'affichage — la vraie protection est côté base, qui ne
  // renverra que les données auxquelles la personne a droit.
  const { data: profilCourant } = await supabase
    .from('profils').select('role').eq('user_id', session.user.id).maybeSingle();

  if (!profilCourant || profilCourant.role !== 'administrateur') {
    const { data: droitPm } = await supabase
      .from('droits').select('acces_historique')
      .eq('user_id', session.user.id).eq('domaine', 'pm').maybeSingle();

    if (!droitPm || droitPm.acces_historique !== true) {
      if (liste) {
        liste.className = 'etat';
        liste.innerHTML = "L'accès à l'historique ne vous est pas ouvert."
          + '<br><br><a href="index.html" style="color:var(--blue);">Retour à l\'application</a>';
      }
      document.querySelector('.hist-topbar')?.style.setProperty('display', 'none');
      return;
    }
  }

  const { data, error } = await supabase
    .from('parcours')
    .select('*')
    .eq('user_id', session.user.id)
    .order('date_debut', { ascending: false });

  if (error) {
    liste.innerHTML = `<div class="empty-state">Erreur de chargement : ${error.message}</div>`;
    return;
  }

  tousLesParcours = data || [];
  render();
}

function parcoursFiltres() {
  return tousLesParcours.filter((p) => filtreActuel === 'tous' || p.type === filtreActuel);
}

// ------------------------------------------------------------
// Vue liste
// ------------------------------------------------------------
function render() {
  const filtres = parcoursFiltres();

  if (filtres.length === 0) {
    liste.innerHTML = `<div class="empty-state">Aucun parcours enregistré pour l'instant.</div>`;
    return;
  }

  liste.innerHTML = filtres.map((p) => `
    <div class="swipe-wrapper" data-id="${p.id}">
      <div class="swipe-action share">
        <svg viewBox="0 0 24 24" fill="none" stroke="#06121a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>
        <span>Partager</span>
      </div>
      <div class="swipe-action delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>
        <span>Supprimer</span>
      </div>
      <div class="parcours-card">
        <div class="pc-top">
          <div>
            <div class="pc-titre">${p.titre || 'Parcours'}</div>
            <div class="pc-date">${new Date(p.date_debut).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <span class="pc-type ${p.type}">${p.type === 'voiture' ? 'Voiture' : 'À pied'}</span>
        </div>
        <div class="pc-stats">
          <div>
            <div class="pc-stat-val">${formatDistance(p.distance_m)}</div>
            <div class="pc-stat-label">Distance</div>
          </div>
          <div>
            <div class="pc-stat-val">${formatDuree(p.duree_s)}</div>
            <div class="pc-stat-label">Durée</div>
          </div>
          <div>
            <div class="pc-stat-val">${p.vitesse_max != null ? p.vitesse_max + ' km/h' : '—'}</div>
            <div class="pc-stat-label">Vitesse pointe</div>
          </div>
          <div>
            <div class="pc-stat-val">${p.type === 'voiture' && p.cout_estime_eur != null ? p.cout_estime_eur + ' €' : (p.nb_virages != null ? p.nb_virages + ' virages' : '—')}</div>
            <div class="pc-stat-label">${p.type === 'voiture' ? 'Coût' : 'Virages'}</div>
          </div>
          ${p.type === 'pied' ? `
          <div>
            <div class="pc-stat-val">${formatAllure(p.allure_sec_km)}</div>
            <div class="pc-stat-label">Allure</div>
          </div>
          <div>
            <div class="pc-stat-val">${p.calories != null ? p.calories + ' kcal' : '—'}</div>
            <div class="pc-stat-label">Calories</div>
          </div>` : ''}
          <div>
            <div class="pc-stat-val">${p.temperature_c != null ? p.temperature_c + '°C' : '—'}</div>
            <div class="pc-stat-label">Météo</div>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.swipe-wrapper').forEach(attacherSwipe);
}

// ------------------------------------------------------------
// Glissement : gauche = supprimer, droite = partager
// ------------------------------------------------------------
const SEUIL_ACTION = 96;
const SEUIL_TAP = 8; // en deçà, on considère que c'est un appui, pas un glissement

function attacherSwipe(wrapper) {
  const card = wrapper.querySelector('.parcours-card');
  const id = wrapper.dataset.id;

  let startX = 0;
  let deltaX = 0;
  let dragging = false;

  const onDown = (e) => {
    dragging = true;
    startX = e.clientX;
    card.style.transition = 'none';
  };

  const onMove = (e) => {
    if (!dragging) return;
    deltaX = e.clientX - startX;
    card.style.transform = `translateX(${deltaX}px)`;
    wrapper.classList.toggle('revealing-share', deltaX > 12);
    wrapper.classList.toggle('revealing-delete', deltaX < -12);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    card.style.transition = 'transform 0.25s ease';

    if (deltaX <= -SEUIL_ACTION) {
      supprimerAvecAnimation(wrapper, card, id);
    } else if (deltaX >= SEUIL_ACTION) {
      partagerDepuisListe(id);
      card.style.transform = 'translateX(0)';
      wrapper.classList.remove('revealing-share');
    } else {
      card.style.transform = 'translateX(0)';
      wrapper.classList.remove('revealing-share', 'revealing-delete');
      // Appui simple (pas de glissement) : on ouvre le parcours
      // sur la carte, pour pouvoir choisir depuis la liste
      if (Math.abs(deltaX) < SEUIL_TAP) ouvrirParcoursSurCarte(id);
    }
    deltaX = 0;
  };

  card.addEventListener('pointerdown', onDown);
  card.addEventListener('pointermove', onMove);
  card.addEventListener('pointerup', onUp);
  card.addEventListener('pointercancel', onUp);
  card.style.touchAction = 'pan-y';
}

async function supprimerAvecAnimation(wrapper, card, id) {
  const ok = confirm('Supprimer définitivement ce parcours ?');
  if (!ok) {
    card.style.transform = 'translateX(0)';
    wrapper.classList.remove('revealing-delete');
    return;
  }

  card.style.transform = 'translateX(-100%)';
  wrapper.style.transition = 'max-height 0.25s ease 0.2s, opacity 0.25s ease 0.2s, margin 0.25s ease 0.2s';
  wrapper.style.opacity = '0';

  const { error } = await supabase.from('parcours').delete().eq('id', id);
  if (error) {
    alert(`Suppression impossible : ${error.message}`);
    card.style.transform = 'translateX(0)';
    wrapper.style.opacity = '1';
    return;
  }

  tousLesParcours = tousLesParcours.filter((p) => p.id !== id);
  setTimeout(() => {
    wrapper.style.maxHeight = '0px';
    wrapper.style.marginBottom = '0px';
    setTimeout(() => wrapper.remove(), 260);
  }, 10);
}

function texteDePartage(p) {
  return [
    `Mon parcours ${p.type === 'voiture' ? 'en voiture' : 'à pied'} sur iter :`,
    `${formatDistance(p.distance_m)} en ${formatDuree(p.duree_s)}`,
    p.vitesse_moy != null ? `vitesse moyenne ${p.vitesse_moy} km/h` : null,
  ].filter(Boolean).join(' — ');
}

// Ouvre un parcours sur la carte depuis la vue liste
async function ouvrirParcoursSurCarte(id) {
  await basculerVue('carte');
  await ouvrirDetail(id);
}

// Attend que la carte ait fini de bouger et de charger ses tuiles,
// condition nécessaire pour que la capture ne soit pas vide/partielle
function attendreCarteStable(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!mapHistorique) return resolve();
    if (mapHistorique.loaded() && !mapHistorique.isMoving() && !mapHistorique.isZooming()) return resolve();
    const fini = setTimeout(resolve, timeoutMs);
    mapHistorique.once('idle', () => {
      clearTimeout(fini);
      resolve();
    });
  });
}

// Partage du parcours actuellement ouvert, carte comprise
async function partagerParcoursCourant() {
  if (!pointsDetailActuel || !parcoursDetailActuel) return;
  await attendreCarteStable();
  await partagerParcoursAvecVisuel({
    points: pointsDetailActuel,
    stats: parcoursDetailActuel,
    type: parcoursDetailActuel.type,
    titre: parcoursDetailActuel.titre,
    texte: texteDePartage(parcoursDetailActuel),
    map: mapHistorique,
    evenements: evenementsDetailActuel,
  });
}

// Partage depuis la vue liste : on bascule d'abord sur la carte et
// on attend qu'elle soit stable, sinon la capture serait vide (le
// conteneur est masqué en vue liste, donc rien n'est rendu).
async function partagerDepuisListe(id) {
  const p = tousLesParcours.find((x) => x.id === id);
  if (!p) return;

  await ouvrirParcoursSurCarte(id);

  if (!pointsDetailActuel || pointsDetailActuel.length === 0) {
    window.location.href = `sms:&body=${encodeURIComponent(texteDePartage(p))}`;
    return;
  }

  await partagerParcoursCourant();
}

// ------------------------------------------------------------
// Filtres
// ------------------------------------------------------------
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filtreActuel = btn.dataset.type;
    fermerDetail();
    if (vueActuelle === 'liste') render();
    else dessinerRoutes();
  });
});

// ------------------------------------------------------------
// Vue carte
// ------------------------------------------------------------
let vueActuelle = 'liste';
let mapHistorique = null;
let marqueursEvenements = [];

// Garde anti "ghost click" : sur mobile, le tap qui ouvre cette
// page depuis le lien Historique peut se propager à la carte
// nouvellement affichée et ouvrir un parcours sans que
// l'utilisateur ait rien demandé. On ignore donc les clics carte
// pendant un court instant après son affichage.
let clicsCarteActifsA = 0;
const DELAI_ANTI_GHOST_MS = 900;

const btnVueListe = document.getElementById('btn-vue-liste');
const btnVueCarte = document.getElementById('btn-vue-carte');
const mapContainer = document.getElementById('map-historique');
const detailPanel = document.getElementById('detail-panel');

btnVueListe?.addEventListener('click', () => basculerVue('liste'));
btnVueCarte?.addEventListener('click', () => basculerVue('carte'));

async function basculerVue(vue) {
  vueActuelle = vue;
  btnVueListe?.classList.toggle('active', vue === 'liste');
  btnVueCarte?.classList.toggle('active', vue === 'carte');
  liste.style.display = vue === 'liste' ? 'block' : 'none';
  mapContainer?.classList.toggle('visible', vue === 'carte');
  document.getElementById('carte-compteur').classList.toggle('visible', vue === 'carte');
  document.getElementById('zoom-controls').style.display = vue === 'carte' ? 'flex' : 'none';
  if (vue === 'carte') await afficherCarte();
  else fermerDetail();
}

document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
  if (mapHistorique) mapHistorique.zoomIn({ duration: 250 });
});
document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
  if (mapHistorique) mapHistorique.zoomOut({ duration: 250 });
});

async function afficherCarte() {
  clicsCarteActifsA = Date.now() + DELAI_ANTI_GHOST_MS;

  if (!mapHistorique) {
    mapHistorique = new maplibregl.Map({
      container: 'map-historique',
      style: STYLES[localStorage.getItem('iter_map_style') || 'standard'],
      center: [2.6167, 48.8],
      zoom: 12,
      preserveDrawingBuffer: true,
    });
    await new Promise((resolve) => mapHistorique.once('load', resolve));
  } else {
    mapHistorique.resize();
  }

  await dessinerRoutes();
  clicsCarteActifsA = Date.now() + DELAI_ANTI_GHOST_MS;
}

const MAX_ROUTES_CARTE = 40;

// Cache des tracés déjà chargés, pour éviter de refaire les
// requêtes paginées à chaque redessin
const cacheTraces = new Map();

async function tracePour(parcoursId) {
  if (cacheTraces.has(parcoursId)) return cacheTraces.get(parcoursId);
  const points = await chargerTousLesPoints(parcoursId);
  cacheTraces.set(parcoursId, points);
  return points;
}

async function dessinerRoutes(idSelectionne = null) {
  if (!mapHistorique) return;

  const filtres = parcoursFiltres().slice(0, MAX_ROUTES_CARTE);
  const features = [];

  for (const p of filtres) {
    const points = await tracePour(p.id);
    if (points.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: {
        parcours_id: p.id,
        type: p.type,
        selectionne: idSelectionne ? (p.id === idSelectionne ? 1 : 0) : 1,
      },
      geometry: { type: 'LineString', coordinates: points.map((pt) => [pt.lng, pt.lat]) },
    });
  }

  const geojson = { type: 'FeatureCollection', features };

  const compteur = document.getElementById('carte-compteur');
  if (vueActuelle === 'carte') {
    compteur?.classList.add('visible');
    if (features.length === 0) {
      compteur.textContent = 'Aucun tracé à afficher';
    } else if (features.length === 1) {
      compteur.textContent = '1 parcours affiché';
    } else {
      compteur.textContent = `${features.length} parcours affichés — touchez un tracé`;
    }
  } else {
    compteur?.classList.remove('visible');
  }

  if (features.length === 0) {
    console.warn('Aucun tracé à afficher (aucun point GPS trouvé pour les parcours filtrés).');
  }

  if (mapHistorique.getSource('routes-historique')) {
    mapHistorique.getSource('routes-historique').setData(geojson);
  } else {
    mapHistorique.addSource('routes-historique', { type: 'geojson', data: geojson });
    mapHistorique.addLayer({
      id: 'routes-historique-ligne',
      type: 'line',
      source: 'routes-historique',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-width': ['case', ['==', ['get', 'selectionne'], 1], 6, 4],
        'line-color': ['match', ['get', 'type'], 'voiture', '#3fb6f5', 'pied', '#3ddc97', '#8b93a7'],
        'line-opacity': ['case', ['==', ['get', 'selectionne'], 1], 1, 0.5],
      },
    });

    mapHistorique.on('click', 'routes-historique-ligne', (e) => {
      if (Date.now() < clicsCarteActifsA) return; // clic fantôme ignoré
      ouvrirDetail(e.features[0].properties.parcours_id);
    });
    mapHistorique.on('mouseenter', 'routes-historique-ligne', () => {
      mapHistorique.getCanvas().style.cursor = 'pointer';
    });
    mapHistorique.on('mouseleave', 'routes-historique-ligne', () => {
      mapHistorique.getCanvas().style.cursor = '';
    });
  }

  if (features.length > 0 && !idSelectionne) {
    const premier = features[0].geometry.coordinates[0];
    const bounds = features.reduce(
      (b, f) => f.geometry.coordinates.reduce((bb, c) => bb.extend(c), b),
      new maplibregl.LngLatBounds(premier, premier)
    );
    mapHistorique.fitBounds(bounds, { padding: 60, duration: 400 });
  }
}

// ------------------------------------------------------------
// Marqueurs d'événements sur la carte — permet de naviguer dans
// son tracé et de voir OÙ ont eu lieu arrêts, ralentissements et
// accélérations, pas seulement de les lire dans une liste.
// ------------------------------------------------------------
const COULEURS_EVENEMENT = {
  arret: '#f5a623',
  ralentissement: '#ef5350',
  acceleration: '#3ddc97',
};
const LABELS_EVENEMENT = {
  arret: 'Arrêt',
  ralentissement: 'Ralentissement',
  acceleration: 'Accélération',
};

function effacerMarqueursEvenements() {
  marqueursEvenements.forEach((m) => m.remove());
  marqueursEvenements = [];
}

function afficherMarqueursEvenements(evenements) {
  effacerMarqueursEvenements();
  if (!mapHistorique || !evenements) return;

  evenements.forEach((ev) => {
    if (ev.lat == null || ev.lng == null) return;

    const el = document.createElement('div');
    el.className = 'marqueur-evenement';
    el.style.background = COULEURS_EVENEMENT[ev.type] || '#8b93a7';

    const heure = new Date(ev.timestamp_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    let detail = `${ev.duree_s ?? '?'}s`;
    if (ev.type !== 'arret' && ev.vitesse_avant != null && ev.vitesse_apres != null) {
      detail += ` · ${Math.round(ev.vitesse_avant)} → ${Math.round(ev.vitesse_apres)} km/h`;
    }

    const popup = new maplibregl.Popup({ offset: 14, closeButton: false })
      .setText(`${LABELS_EVENEMENT[ev.type] || ev.type} · ${heure} · ${detail}`);

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([ev.lng, ev.lat])
      .setPopup(popup)
      .addTo(mapHistorique);

    marqueursEvenements.push(marker);
  });
}

// ------------------------------------------------------------
// Panneau de détail
// ------------------------------------------------------------
let pointsDetailActuel = null;
let parcoursDetailActuel = null;
let evenementsDetailActuel = null;

async function ouvrirDetail(id) {
  const p = tousLesParcours.find((x) => x.id === id);
  if (!p) return;

  parcoursDetailActuel = p;
  pointsDetailActuel = null;
  evenementsDetailActuel = null;

  document.getElementById('dp-titre').textContent = p.titre || 'Parcours';
  document.getElementById('dp-date').textContent = new Date(p.date_debut).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const items = [
    [formatDistance(p.distance_m), 'Distance'],
    [formatDuree(p.duree_s), 'Durée'],
    [p.vitesse_moy != null ? `${p.vitesse_moy} km/h` : '—', 'Vitesse moy.'],
    [p.vitesse_max != null ? `${p.vitesse_max} km/h` : '—', 'Vitesse pointe'],
    [p.denivele_positif != null ? `${p.denivele_positif} m` : '—', 'Dénivelé +'],
    [p.denivele_negatif != null ? `${p.denivele_negatif} m` : '—', 'Dénivelé −'],
    [p.nb_virages != null ? p.nb_virages : '—', 'Virages'],
    [p.temperature_c != null ? `${p.temperature_c}°C` : '—', 'Météo'],
  ];
  if (p.type === 'voiture') items.push([p.cout_estime_eur != null ? `${p.cout_estime_eur} €` : '—', 'Coût']);
  if (p.type === 'pied') {
    items.push([formatAllure(p.allure_sec_km), 'Allure']);
    items.push([p.calories != null ? `${p.calories} kcal` : '—', 'Calories']);
  }

  document.getElementById('dp-stats').innerHTML = items.map(([val, label]) => `
    <div><div class="dp-stat-val">${val}</div><div class="dp-stat-label">${label}</div></div>
  `).join('');

  const evenementsEl = document.getElementById('dp-evenements');
  evenementsEl.innerHTML = '<div class="dp-info">Chargement du tracé…</div>';
  detailPanel?.classList.add('visible');
  detailPanel?.classList.remove('plein-ecran');

  // Position dans la liste filtrée + activation des flèches
  const liste_ = parcoursFiltres();
  const index = liste_.findIndex((x) => x.id === id);
  document.getElementById('dp-position').textContent =
    index >= 0 ? `Parcours ${index + 1} / ${liste_.length}` : '';
  document.getElementById('dp-prec').disabled = index <= 0;
  document.getElementById('dp-suiv').disabled = index < 0 || index >= liste_.length - 1;

  // Tracé complet (paginé) de CE parcours
  const points = await tracePour(id);
  pointsDetailActuel = points;

  // Met en avant ce tracé, estompe les autres
  await dessinerRoutes(id);

  if (points.length > 1 && mapHistorique) {
    const coords = points.map((pt) => [pt.lng, pt.lat]);
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    mapHistorique.fitBounds(bounds, {
      padding: { top: 80, bottom: 300, left: 40, right: 40 },
      duration: 500,
    });
  }

  const { data: evenements } = await supabase
    .from('parcours_evenements')
    .select('*')
    .eq('parcours_id', id)
    .order('timestamp_debut', { ascending: true });

  evenementsDetailActuel = evenements || [];
  afficherMarqueursEvenements(evenementsDetailActuel);

  if (evenementsDetailActuel.length === 0) {
    evenementsEl.innerHTML = '<div class="dp-info">Aucun arrêt ni variation notable détecté sur ce trajet.</div>';
    return;
  }

  evenementsEl.innerHTML = evenementsDetailActuel.map((e) => {
    const heure = new Date(e.timestamp_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    let detail = `${e.duree_s ?? '?'}s`;
    if (e.type !== 'arret' && e.vitesse_avant != null && e.vitesse_apres != null) {
      detail += ` — ${Math.round(e.vitesse_avant)} → ${Math.round(e.vitesse_apres)} km/h`;
    }
    return `<button class="dp-evenement ${e.type}" data-lat="${e.lat}" data-lng="${e.lng}"><span class="dot"></span>${heure} · ${LABELS_EVENEMENT[e.type] || e.type} · ${detail}</button>`;
  }).join('');

  // Cliquer un événement de la liste recentre la carte dessus
  evenementsEl?.querySelectorAll('.dp-evenement').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.dataset.lat);
      const lng = parseFloat(btn.dataset.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng) || !mapHistorique) return;
      mapHistorique.easeTo({ center: [lng, lat], zoom: 17, duration: 600 });
    });
  });
}

// ------------------------------------------------------------
// Export / partage du parcours affiché
// ------------------------------------------------------------
document.getElementById('dp-export-gpx')?.addEventListener('click', () => {
  if (!pointsDetailActuel || !parcoursDetailActuel) return;
  exportGPX(parcoursDetailActuel, pointsDetailActuel);
});

document.getElementById('dp-export-csv')?.addEventListener('click', () => {
  if (!pointsDetailActuel) return;
  exportCSV(pointsDetailActuel);
});

document.getElementById('dp-partager')?.addEventListener('click', async (e) => {
  if (!pointsDetailActuel || !parcoursDetailActuel) return;

  const btn = e.currentTarget;
  const htmlOriginal = btn.innerHTML;
  btn.innerHTML = '…';
  btn.disabled = true;

  await partagerParcoursCourant();

  btn.innerHTML = htmlOriginal;
  btn.disabled = false;
});

// ------------------------------------------------------------
// Plein écran / retour au détail
// ------------------------------------------------------------
const SVG_PLEIN_ECRAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
const SVG_REDUIRE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m0 6v4a2 2 0 0 0 2 2h4m6 0h4a2 2 0 0 0 2-2v-4m0-6V5a2 2 0 0 0-2-2h-4"/></svg>';

document.getElementById('dp-fullscreen')?.addEventListener('click', (e) => {
  const reduit = detailPanel?.classList.toggle('plein-ecran');
  e.currentTarget.innerHTML = reduit
    ? `${SVG_REDUIRE}Revenir au détail`
    : `${SVG_PLEIN_ECRAN}Naviguer dans la carte`;
});

function fermerDetail() {
  detailPanel?.classList.remove('visible', 'plein-ecran');
  document.getElementById('dp-fullscreen').innerHTML = `${SVG_PLEIN_ECRAN}Naviguer dans la carte`;
  pointsDetailActuel = null;
  parcoursDetailActuel = null;
  evenementsDetailActuel = null;
  effacerMarqueursEvenements();
  if (vueActuelle === 'carte') dessinerRoutes();
}

document.getElementById('dp-close')?.addEventListener('click', fermerDetail);

// Navigation entre parcours sans quitter la carte
function allerVersParcours(decalage) {
  if (!parcoursDetailActuel) return;
  const liste_ = parcoursFiltres();
  const index = liste_.findIndex((x) => x.id === parcoursDetailActuel.id);
  const cible = liste_[index + decalage];
  if (cible) ouvrirDetail(cible.id);
}

document.getElementById('dp-prec')?.addEventListener('click', () => allerVersParcours(-1));
document.getElementById('dp-suiv')?.addEventListener('click', () => allerVersParcours(1));

// ------------------------------------------------------------
// Démarrage : on charge puis on affiche la carte
// ------------------------------------------------------------
charger().then(() => basculerVue('carte'));
