// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// ITER — Export GPX / CSV
// ============================================================

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportGPX(parcours, points) {
  const trkpts = points
    .map((p) => {
      const ele = p.altitude_corrigee ?? p.altitude;
      return `      <trkpt lat="${p.lat}" lon="${p.lng}">
${ele != null ? `        <ele>${ele}</ele>\n` : ''}        <time>${p.timestamp_point}</time>
      </trkpt>`;
    })
    .join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="iter — Anthropotech Lab" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${parcours.titre || 'Parcours iter'}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

  downloadFile(`${parcours.titre || 'parcours'}.gpx`, gpx, 'application/gpx+xml');
}

export function exportCSV(points) {
  const header = 'lat,lng,altitude,altitude_corrigee,timestamp,vitesse_kmh\n';
  const rows = points
    .map((p) =>
      [p.lat, p.lng, p.altitude ?? '', p.altitude_corrigee ?? '', p.timestamp_point, p.vitesse_instant ?? '']
        .join(',')
    )
    .join('\n');

  downloadFile('parcours.csv', header + rows, 'text/csv');
}
