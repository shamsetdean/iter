// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// ITER — Carte MapLibre GL JS
// ============================================================
// Fonds disponibles :
//  - standard  : OpenFreeMap Liberty (vectoriel, sans clé)
//  - plan-ign  : Plan IGN v2 (raster, Géoplateforme, sans clé)
//  - satellite : Ortho-photographies IGN (raster, sans clé)
//
// Identifiants de couches conformes à la documentation
// Géoplateforme : GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2 (et non
// GEOGRAPHICALGRIDSYSTEMS.PLAN.IGN, qui renvoie une erreur 400).
// ============================================================

function urlWMTS(couche, format) {
  return 'https://data.geopf.fr/wmts'
    + '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
    + `&LAYER=${couche}`
    + '&STYLE=normal'
    + `&FORMAT=${format}`
    + '&TILEMATRIXSET=PM'
    + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
}

function styleRasterIGN(couche, format, maxzoom) {
  return {
    version: 8,
    sources: {
      'fond-ign': {
        type: 'raster',
        tiles: [urlWMTS(couche, format)],
        tileSize: 256,
        maxzoom,
        attribution: '© IGN — Géoplateforme',
      },
    },
    layers: [{ id: 'fond-ign-raster', type: 'raster', source: 'fond-ign' }],
  };
}

export const STYLES = {
  standard: 'https://tiles.openfreemap.org/styles/liberty',
  'plan-ign': styleRasterIGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png', 19),
  satellite: styleRasterIGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg', 19),
};

export const LIBELLES_STYLES = {
  standard: 'Standard',
  'plan-ign': 'Plan IGN',
  satellite: 'Satellite',
};

export function initMap(containerId, center = [2.6167, 48.8], zoom = 13, styleKey = 'standard') {
  const map = new maplibregl.Map({
    container: containerId,
    style: STYLES[styleKey] || STYLES.standard,
    center,
    zoom,
    attributionControl: true,
    preserveDrawingBuffer: true, // indispensable pour pouvoir capturer la carte déjà visible lors du partage
  });

  // Pas de NavigationControl : ses boutons de 29 px sont trop
  // petits pour un usage au doigt. Des boutons ronds dédiés,
  // bien plus grands, sont câblés côté application.

  return map;
}

// Change le style de fond de carte à chaud. Comme setStyle()
// remplace toutes les couches, on doit réinjecter le tracé en
// direct une fois le nouveau style chargé (callback onReady).
//
// onEchec est appelé si les tuiles du nouveau fond ne se
// chargent pas (serveur indisponible, couche inexistante,
// zone non couverte) : sans ça, l'utilisateur reste devant une
// carte vide sans explication.
export function changeMapStyle(map, styleKey, onReady, onEchec) {
  const style = STYLES[styleKey];
  if (!style) return;

  let echecsTuiles = 0;
  const SEUIL_ECHECS = 4;

  const surErreur = (e) => {
    const msg = e && e.error && e.error.message ? e.error.message : '';
    if (!msg.includes('data.geopf.fr') && !msg.includes('tiles.openfreemap')) return;
    echecsTuiles++;
    if (echecsTuiles === SEUIL_ECHECS) {
      map.off('error', surErreur);
      if (onEchec) onEchec(styleKey);
    }
  };

  map.on('error', surErreur);
  // Au-delà de ce délai, on considère le fond comme viable et on
  // cesse de surveiller (sinon une erreur tardive ferait basculer
  // le fond alors que la carte s'affiche correctement).
  setTimeout(() => map.off('error', surErreur), 12000);

  map.once('style.load', () => {
    if (onReady) onReady();
  });
  map.setStyle(style);
}

// ------------------------------------------------------------
// Point bleu de position — comportement type GPS (Google Maps /
// navigation), avec cône de cap quand le heading est disponible.
// ------------------------------------------------------------
export function createUserMarker(map) {
  const el = document.createElement('div');
  el.className = 'user-dot-wrap';
  el.innerHTML = `
    <div class="user-dot-accuracy"></div>
    <div class="user-dot-heading"></div>
    <div class="user-dot-pulse"></div>
    <div class="user-dot-core"></div>
  `;


  const marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
    .setLngLat([0, 0]);

  return marker;
}

// Met à jour la position, la précision et le cap du point bleu.
// Le déplacement est interpolé en douceur (~900ms) plutôt que
// d'être appliqué d'un coup, pour éviter l'effet saccadé propre
// aux mises à jour GPS espacées de 1 à 3 secondes.
const animationsEnCours = new WeakMap();

export function updateUserMarker(marker, lng, lat, accuracy, heading) {
  const depart = marker.getLngLat();
  const arriveeLng = lng;
  const arriveeLat = lat;
  const duree = 900;
  const debut = performance.now();

  // Annule toute animation de déplacement encore en cours pour ce
  // marqueur, pour ne pas cumuler plusieurs trajectoires en même temps
  const frameEnCours = animationsEnCours.get(marker);
  if (frameEnCours) cancelAnimationFrame(frameEnCours);

  function step(maintenant) {
    const t = Math.min((maintenant - debut) / duree, 1);
    const ease = 1 - Math.pow(1 - t, 2); // ease-out : démarre vite, ralentit en fin
    const curLng = depart.lng + (arriveeLng - depart.lng) * ease;
    const curLat = depart.lat + (arriveeLat - depart.lat) * ease;
    marker.setLngLat([curLng, curLat]);

    if (t < 1) {
      animationsEnCours.set(marker, requestAnimationFrame(step));
    } else {
      animationsEnCours.delete(marker);
    }
  }
  animationsEnCours.set(marker, requestAnimationFrame(step));

  const el = marker.getElement();
  const accuracyEl = el.querySelector('.user-dot-accuracy');
  const headingEl = el.querySelector('.user-dot-heading');

  // Rayon de précision approximatif à l'écran (purement indicatif,
  // recalculé grossièrement selon le zoom actuel)
  if (accuracy != null && accuracyEl) {
    const metersPerPixel = 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, marker._map ? marker._map.getZoom() : 15);
    const radiusPx = Math.min(Math.max(accuracy / metersPerPixel, 14), 120);
    accuracyEl.style.width = `${radiusPx * 2}px`;
    accuracyEl.style.height = `${radiusPx * 2}px`;
  }

  if (heading != null && !Number.isNaN(heading)) {
    headingEl.style.opacity = '1';
    headingEl.style.transform = `translateX(-50%) rotate(${heading}deg)`;
  } else if (headingEl) {
    headingEl.style.opacity = '0';
  }
}

// Fait suivre la carte à la position + oriente selon le cap
// (mode "navigation", comme un vrai GPS)
export function followUser(map, lng, lat, heading, zoom = 17) {
  map.easeTo({
    center: [lng, lat],
    zoom,
    bearing: heading != null && !Number.isNaN(heading) ? heading : map.getBearing(),
    pitch: 45,
    duration: 600,
  });
}

// Ajoute une source + couche vide pour le tracé en direct
export function setupTraceLayer(map, id = 'trace-live') {
  map.addSource(id, {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
  });

  map.addLayer({
    id: `${id}-line`,
    type: 'line',
    source: id,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 4,
    },
  });
}

// Met à jour le tracé avec un nouveau point (voiture = accent clair, pied = accent foncé)
export function pushPointToTrace(map, id, lng, lat, type) {
  const source = map.getSource(id);
  if (!source) return;

  const data = source._data || { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } };
  data.geometry.coordinates.push([lng, lat]);
  data.properties = { color: type === 'voiture' ? '#3fb6f5' : '#3ddc97' };
  source._data = data;
  source.setData(data);
}

// Affiche un tracé complet (relecture d'un parcours enregistré)
export function drawFullTrace(map, id, points, type) {
  const coordinates = points.map((p) => [p.lng, p.lat]);
  const geojson = {
    type: 'Feature',
    properties: { color: type === 'voiture' ? '#3fb6f5' : '#3ddc97' },
    geometry: { type: 'LineString', coordinates },
  };

  if (map.getSource(id)) {
    map.getSource(id).setData(geojson);
  } else {
    map.addSource(id, { type: 'geojson', data: geojson });
    map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: id,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
    });
  }

  if (coordinates.length > 0) {
    const bounds = coordinates.reduce(
      (b, coord) => b.extend(coord),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
    );
    map.fitBounds(bounds, { padding: 40, duration: 500 });
  }
}
