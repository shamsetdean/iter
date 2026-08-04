// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// ITER — Estimation du coût d'un trajet
//
// Deux modes selon l'énergie du véhicule :
//   - thermique (gazole, essence) : prix relevé sur l'API
//     officielle data.economie.gouv.fr
//   - électrique : tarif au kWh (les véhicules de l'équipe PM
//     sont électriques, un prix de carburant liquide n'aurait
//     aucun sens pour eux)
// ============================================================

const DATASET = 'prix-des-carburants-en-france-flux-instantane-v2';
const API_BASE = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/${DATASET}/records`;

// Prix de secours (€/L) si l'API est indisponible : le coût ne
// doit jamais rester vide faute de réseau sur le terrain.
const PRIX_SECOURS = {
  gazole: 1.68,
  sp95: 1.79,
  sp98: 1.85,
  e10: 1.75,
  e85: 0.75,
  gplc: 0.95,
};

// Tarif moyen de recharge (€/kWh). Il n'existe pas d'API
// publique équivalente pour l'électricité : cette valeur est à
// ajuster à la main selon le contrat de la collectivité.
export const PRIX_KWH_DEFAUT = 0.1740; // tarif bleu, heures pleines

export const LIBELLES_ENERGIE = {
  gazole: 'Gazole',
  essence: 'Essence',
  electrique: 'Électrique',
};

export function unitéConsommation(typeEnergie) {
  return typeEnergie === 'electrique' ? 'kWh/100 km' : 'L/100 km';
}

// Récupère un prix moyen national récent, en moyennant plusieurs
// stations (plus représentatif qu'un relevé isolé).
export async function getPrixCarburantMoyen(typeCarburant = 'Gazole') {
  const cle = typeCarburant.toLowerCase();
  const champ = `${cle}_prix`;

  try {
    const url = `${API_BASE}?limit=50&where=${encodeURIComponent(`${champ} is not null`)}&select=${champ}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Statut HTTP ${res.status}`);
    const data = await res.json();

    const valeurs = (data.results || [])
      .map((r) => r[champ])
      .filter((v) => typeof v === 'number' && v > 0.3 && v < 3);

    if (valeurs.length === 0) throw new Error('Aucune valeur exploitable');

    const moyenne = valeurs.reduce((a, b) => a + b, 0) / valeurs.length;
    return Math.round(moyenne * 1000) / 1000;
  } catch (err) {
    console.warn('Prix carburant indisponible, utilisation du prix de secours :', err);
    return PRIX_SECOURS[cle] ?? PRIX_SECOURS.gazole;
  }
}

// Prix unitaire de l'énergie : €/L pour un thermique, €/kWh pour
// un électrique.
export async function getPrixEnergie(typeEnergie, prixKwh = PRIX_KWH_DEFAUT) {
  if (typeEnergie === 'electrique') return prixKwh;
  if (typeEnergie === 'essence') return getPrixCarburantMoyen('SP95');
  return getPrixCarburantMoyen('Gazole');
}

// Coût d'un trajet.
// distanceM  : distance parcourue en mètres
// consoPour100 : L/100 km (thermique) ou kWh/100 km (électrique)
// prixUnitaire : €/L ou €/kWh
export function calculerCoutTrajet(distanceM, consoPour100, prixUnitaire) {
  if (!distanceM || !consoPour100 || !prixUnitaire) return null;
  const distanceKm = distanceM / 1000;
  const quantite = (distanceKm / 100) * consoPour100;
  return Math.round(quantite * prixUnitaire * 100) / 100;
}

// Quantité consommée, utile pour l'affichage détaillé
// (« 4,2 kWh » est plus parlant que le seul coût).
export function calculerConsommation(distanceM, consoPour100) {
  if (!distanceM || !consoPour100) return null;
  return Math.round(((distanceM / 1000) / 100) * consoPour100 * 100) / 100;
}
