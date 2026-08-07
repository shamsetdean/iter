// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// Génère une image "carte de récap" du parcours (fond de carte
// réel avec les rues + tracé + stats) pour le partage.
//
// Approche : on capture une carte MapLibre DÉJÀ visible et déjà
// chargée à l'écran (celle de l'app ou de l'historique), plutôt
// que d'en créer une invisible en arrière-plan pour la capture.
// C'est beaucoup plus fiable : pas de course contre le
// chargement des tuiles, pas de contexte WebGL caché qui peut
// échouer silencieusement selon le navigateur.
// ============================================================

const LARGEUR = 1080;
const HAUTEUR = 1350;
const ZONE_CARTE_HAUTEUR = 900; // partie haute réservée à la carte

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

// ------------------------------------------------------------
// Capture la carte MapLibre déjà visible à l'écran (le paramètre
// `map` est une instance maplibregl.Map réelle, déjà créée avec
// preserveDrawingBuffer: true). Attend que les tuiles soient
// chargées avant de capturer.
// ------------------------------------------------------------
export function capturerCarteVisible(map) {
  return new Promise((resolve, reject) => {
    const capturer = () => {
      try {
        const dataUrl = map.getCanvas().toDataURL('image/png');
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Conversion de la capture impossible'));
        img.src = dataUrl;
      } catch (err) {
        reject(err);
      }
    };

    if (map.loaded() && !map.isMoving() && !map.isZooming()) {
      capturer();
    } else {
      map.once('idle', capturer);
    }
  });
}

export async function genererImageParcours({ points, stats, type, titre, map, evenements }) {
  const canvas = document.createElement('canvas');
  canvas.width = LARGEUR;
  canvas.height = HAUTEUR;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);

  // Capture + repères départ/arrivée projetés sur la carte AVANT
  // qu'elle ne soit convertie en simple image, pour connaître leur
  // position exacte en pixels.
  let fondCarteImg = null;
  let departPx = null;
  let arriveePx = null;

  if (map && points && points.length > 0) {
    try {
      fondCarteImg = await capturerCarteVisible(map);
      const dpr = window.devicePixelRatio || 1;
      const pDepart = map.project([points[0].lng, points[0].lat]);
      const pArrivee = map.project([points[points.length - 1].lng, points[points.length - 1].lat]);
      departPx = { x: pDepart.x * dpr, y: pDepart.y * dpr };
      arriveePx = { x: pArrivee.x * dpr, y: pArrivee.y * dpr };
    } catch (err) {
      console.warn('Capture de la carte visible impossible, repli sur le tracé simple:', err);
    }
  }

  // ------------------------------------------------------------
  // Zone carte : vrai fond capturé si disponible, sinon repli en
  // simple ligne sur fond dégradé
  // ------------------------------------------------------------
  if (fondCarteImg) {
    // On centre-recadre l'image capturée (généralement au format
    // écran du téléphone) sur le ratio de la zone carte de la fiche
    const ratioZone = LARGEUR / ZONE_CARTE_HAUTEUR;
    const ratioImg = fondCarteImg.width / fondCarteImg.height;
    let sx, sy, sw, sh;
    if (ratioImg > ratioZone) {
      sh = fondCarteImg.height;
      sw = sh * ratioZone;
      sx = (fondCarteImg.width - sw) / 2;
      sy = 0;
    } else {
      sw = fondCarteImg.width;
      sh = sw / ratioZone;
      sx = 0;
      sy = (fondCarteImg.height - sh) / 2;
    }
    ctx.drawImage(fondCarteImg, sx, sy, sw, sh, 0, 0, LARGEUR, ZONE_CARTE_HAUTEUR);

    // Repères départ (bleu) / arrivée (vert), convertis depuis les
    // coordonnées de l'image source vers celles de la fiche finale
    const versXY = (px) => [
      (px.x - sx) * (LARGEUR / sw),
      (px.y - sy) * (ZONE_CARTE_HAUTEUR / sh),
    ];
    const dessinerRepere = (px, couleur) => {
      if (!px) return;
      const [x, y] = versXY(px);
      if (x < -20 || x > LARGEUR + 20 || y < -20 || y > ZONE_CARTE_HAUTEUR + 20) return; // hors cadre
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = couleur;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };
    dessinerRepere(departPx, '#3fb6f5');
    dessinerRepere(arriveePx, '#3ddc97');

    const voile = ctx.createLinearGradient(0, 0, 0, 140);
    voile.addColorStop(0, 'rgba(10,14,26,0.75)');
    voile.addColorStop(1, 'rgba(10,14,26,0)');
    ctx.fillStyle = voile;
    ctx.fillRect(0, 0, LARGEUR, 140);
  } else if (points && points.length > 1) {
    const halo1 = ctx.createRadialGradient(150, 100, 0, 150, 100, 500);
    halo1.addColorStop(0, 'rgba(63,182,245,0.14)');
    halo1.addColorStop(1, 'rgba(63,182,245,0)');
    ctx.fillStyle = halo1;
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);

    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    const pad = 90;
    const zoneW = LARGEUR - pad * 2;
    const zoneH = ZONE_CARTE_HAUTEUR - pad * 2 - 60;
    const spanLat = Math.max(maxLat - minLat, 0.0005);
    const spanLng = Math.max(maxLng - minLng, 0.0005);
    const echelle = Math.min(zoneW / spanLng, zoneH / spanLat);
    const decalX = pad + (zoneW - spanLng * echelle) / 2;
    const decalY = pad + 60 + (zoneH - spanLat * echelle) / 2;
    const toXY = (p) => [decalX + (p.lng - minLng) * echelle, decalY + (maxLat - p.lat) * echelle];

    const grad = ctx.createLinearGradient(0, decalY, 0, decalY + spanLat * echelle);
    grad.addColorStop(0, '#3fb6f5');
    grad.addColorStop(1, '#3ddc97');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = toXY(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const [xDepart, yDepart] = toXY(points[0]);
    const [xArrivee, yArrivee] = toXY(points[points.length - 1]);
    [[xDepart, yDepart, '#3fb6f5'], [xArrivee, yArrivee, '#3ddc97']].forEach(([x, y, couleur]) => {
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = couleur;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#0a0e1a';
      ctx.stroke();
    });

    ctx.font = '500 20px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#8b93a7';
    ctx.textAlign = 'center';
    ctx.fillText('(fond de carte indisponible)', LARGEUR / 2, ZONE_CARTE_HAUTEUR - 20);
    ctx.textAlign = 'left';
  }

  // ------------------------------------------------------------
  // En-tête
  // ------------------------------------------------------------
  ctx.fillStyle = '#f3f5f8';
  ctx.font = '700 40px -apple-system, system-ui, sans-serif';
  ctx.fillText('iter', 60, 90);

  ctx.fillStyle = '#c7cbd6';
  ctx.font = '600 22px -apple-system, system-ui, sans-serif';
  ctx.fillText('anthropotech /lab', 60, 120);

  ctx.textAlign = 'right';
  ctx.fillStyle = type === 'voiture' ? '#3fb6f5' : '#3ddc97';
  ctx.font = '700 24px -apple-system, system-ui, sans-serif';
  ctx.fillText(type === 'voiture' ? 'VOITURE' : 'À PIED', LARGEUR - 60, 100);
  ctx.textAlign = 'left';

  // ------------------------------------------------------------
  // Bandeau de stats en bas
  // ------------------------------------------------------------
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, ZONE_CARTE_HAUTEUR, LARGEUR, HAUTEUR - ZONE_CARTE_HAUTEUR);

  const yBase = ZONE_CARTE_HAUTEUR + 70;
  const items = [
    [formatDistance(stats.distance_m), 'DISTANCE'],
    [formatDuree(stats.duree_s), 'DURÉE'],
    [stats.vitesse_moy != null ? `${stats.vitesse_moy} km/h` : '—', 'VITESSE MOY.'],
    [stats.denivele_positif != null ? `${stats.denivele_positif} m` : '—', 'DÉNIVELÉ'],
  ];

  const colW = LARGEUR / items.length;
  items.forEach(([val, label], i) => {
    const x = colW * i + colW / 2;
    ctx.textAlign = 'center';
    const g = ctx.createLinearGradient(x - 80, 0, x + 80, 0);
    g.addColorStop(0, '#3fb6f5');
    g.addColorStop(1, '#3ddc97');
    ctx.fillStyle = g;
    ctx.font = '700 44px -apple-system, system-ui, sans-serif';
    ctx.fillText(val, x, yBase);

    ctx.fillStyle = '#8b93a7';
    ctx.font = '600 18px -apple-system, system-ui, sans-serif';
    ctx.fillText(label, x, yBase + 32);
  });

  const yBase2 = yBase + 110;
  const items2 = type === 'pied'
    ? [
        [stats.allure_sec_km != null ? `${Math.floor(stats.allure_sec_km / 60)}'${String(stats.allure_sec_km % 60).padStart(2, '0')}"` : '—', 'ALLURE /KM'],
        [stats.calories != null ? `${stats.calories}` : '—', 'KCAL'],
        [stats.nb_virages != null ? `${stats.nb_virages}` : '—', 'VIRAGES'],
        [stats.temperature_c != null ? `${stats.temperature_c}°C` : '—', 'MÉTÉO'],
      ]
    : [
        [stats.cout_estime_eur != null ? `${stats.cout_estime_eur} €` : '—', 'COÛT'],
        [stats.nb_virages != null ? `${stats.nb_virages}` : '—', 'VIRAGES'],
        [stats.vitesse_max != null ? `${stats.vitesse_max} km/h` : '—', 'POINTE'],
        [stats.temperature_c != null ? `${stats.temperature_c}°C` : '—', 'MÉTÉO'],
      ];

  items2.forEach(([val, label], i) => {
    const x = colW * i + colW / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f3f5f8';
    ctx.font = '700 30px -apple-system, system-ui, sans-serif';
    ctx.fillText(val, x, yBase2);
    ctx.fillStyle = '#8b93a7';
    ctx.font = '600 16px -apple-system, system-ui, sans-serif';
    ctx.fillText(label, x, yBase2 + 26);
  });

  // Ligne des événements détectés (arrêts / ralentissements / accélérations)
  if (evenements && evenements.length > 0) {
    const nbArrets = evenements.filter((e) => e.type === 'arret').length;
    const nbRalentissements = evenements.filter((e) => e.type === 'ralentissement').length;
    const nbAccelerations = evenements.filter((e) => e.type === 'acceleration').length;

    ctx.textAlign = 'center';
    ctx.font = '600 22px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#f5a623';
    ctx.fillText(`${nbArrets} arrêt${nbArrets > 1 ? 's' : ''}`, LARGEUR / 6, yBase2 + 70);
    ctx.fillStyle = '#ef5350';
    ctx.fillText(`${nbRalentissements} ralentissement${nbRalentissements > 1 ? 's' : ''}`, LARGEUR / 2, yBase2 + 70);
    ctx.fillStyle = '#3ddc97';
    ctx.fillText(`${nbAccelerations} accélération${nbAccelerations > 1 ? 's' : ''}`, LARGEUR - LARGEUR / 6, yBase2 + 70);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#4a5164';
  ctx.font = '500 18px -apple-system, system-ui, sans-serif';
  ctx.fillText(titre || 'Parcours iter', LARGEUR / 2, HAUTEUR - 30);
  ctx.textAlign = 'left';

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

// ------------------------------------------------------------
// Partage natif (image + texte). Fallback sur sms: (texte seul)
// uniquement si le partage de fichiers n'est vraiment pas
// supporté par le navigateur — pas en cas d'échec de capture,
// puisque la capture ne dépend plus d'un contexte caché fragile.
// ------------------------------------------------------------
export async function partagerParcoursAvecVisuel({ points, stats, type, titre, texte, map, evenements }) {
  const blob = await genererImageParcours({ points, stats, type, titre, map, evenements });
  const file = new File([blob], 'iter-parcours.png', { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: texte, title: titre || 'Mon parcours iter' });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      console.warn('Partage natif indisponible, fallback SMS texte:', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'iter-parcours.png';
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

  window.location.href = `sms:&body=${encodeURIComponent(texte)}`;
  return false;
}
