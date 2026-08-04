// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// Import de parcours — GPX ou CSV (y compris ceux exportés
// par iter lui-même, pour rester cohérent avec export.js)
// ============================================================

export function parseGPX(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');

  const parserError = xml.querySelector('parsererror');
  if (parserError) throw new Error('Fichier GPX invalide.');

  const trkpts = Array.from(xml.querySelectorAll('trkpt'));
  if (trkpts.length === 0) throw new Error('Aucun point GPS trouvé dans ce fichier GPX.');

  return trkpts.map((pt) => {
    const eleEl = pt.querySelector('ele');
    const timeEl = pt.querySelector('time');
    return {
      lat: parseFloat(pt.getAttribute('lat')),
      lng: parseFloat(pt.getAttribute('lon')),
      altitude: eleEl ? parseFloat(eleEl.textContent) : null,
      timestamp_point: timeEl ? timeEl.textContent : null,
      vitesse_instant: null,
    };
  });
}

export function parseCSV(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map((h) => h.trim());
  const idxLat = header.indexOf('lat');
  const idxLng = header.indexOf('lng');
  const idxAlt = header.indexOf('altitude');
  const idxTime = header.indexOf('timestamp');
  const idxVit = header.indexOf('vitesse_kmh');

  if (idxLat === -1 || idxLng === -1) {
    throw new Error('Fichier CSV invalide : colonnes lat/lng introuvables.');
  }

  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split(',');
    return {
      lat: parseFloat(cols[idxLat]),
      lng: parseFloat(cols[idxLng]),
      altitude: idxAlt !== -1 && cols[idxAlt] ? parseFloat(cols[idxAlt]) : null,
      timestamp_point: idxTime !== -1 ? cols[idxTime] : null,
      vitesse_instant: idxVit !== -1 && cols[idxVit] ? parseFloat(cols[idxVit]) : null,
    };
  });
}

// Lit un fichier importé (File API) et retourne les points parsés
export function readImportedFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        const isGPX = file.name.toLowerCase().endsWith('.gpx') || text.trim().startsWith('<?xml');
        const points = isGPX ? parseGPX(text) : parseCSV(text);
        resolve(points);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
    reader.readAsText(file);
  });
}
