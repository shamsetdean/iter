// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// Météo — Open-Meteo (gratuit, sans clé, RGPD-friendly)
// Utilise l'API forecast avec "past_days" plutôt que l'API
// archive, car l'archive a plusieurs jours de retard et ne
// couvrirait pas un parcours qui vient d'être enregistré.
// ============================================================

export async function getTemperature(pointDepart, dateDebutISO) {
  if (!pointDepart) return null;

  try {
    const date = new Date(dateDebutISO);
    const now = new Date();
    const diffJours = Math.min(Math.max(Math.ceil((now - date) / 86400000), 0), 92);

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${pointDepart.lat}&longitude=${pointDepart.lng}&hourly=temperature_2m&past_days=${diffJours}&forecast_days=1&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Statut HTTP ${res.status}`);
    const data = await res.json();

    const heures = data?.hourly?.time || [];
    const temperatures = data?.hourly?.temperature_2m || [];
    if (heures.length === 0) return null;

    // Trouver l'heure la plus proche du début du parcours
    let idxProche = 0;
    let ecartMin = Infinity;
    heures.forEach((h, i) => {
      const ecart = Math.abs(new Date(h) - date);
      if (ecart < ecartMin) {
        ecartMin = ecart;
        idxProche = i;
      }
    });

    const temp = temperatures[idxProche];
    return temp != null ? Math.round(temp * 10) / 10 : null;
  } catch (err) {
    console.warn('Température indisponible:', err);
    return null;
  }
}
