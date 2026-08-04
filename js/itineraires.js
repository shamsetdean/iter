// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

import { distanceM } from './tracking.js';

const TOLERANCE_M = 150; // rayon de tolérance pour considérer "même itinéraire"

// Rattache le parcours qui vient d'être enregistré à un itinéraire
// existant (proximité départ/arrivée), ou en crée un nouveau.
// Retourne { itineraireId, comparaison } — comparaison est null s'il
// n'existe pas d'autre parcours à comparer.
export async function rattacherEtComparer(supabase, session, parcoursId, stats, type) {
  if (!stats.points || stats.points.length < 2) return { itineraireId: null, comparaison: null };

  const depart = stats.points[0];
  const arrivee = stats.points[stats.points.length - 1];

  const { data: itineraires, error: errFetch } = await supabase
    .from('itineraires')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('type', type);

  if (errFetch) {
    console.error('Erreur recherche itinéraires:', errFetch);
    return { itineraireId: null, comparaison: null };
  }

  let itineraire = (itineraires || []).find((it) => {
    if (it.point_depart_lat == null || it.point_arrivee_lat == null) return false;
    const dDepart = distanceM(it.point_depart_lat, it.point_depart_lng, depart.lat, depart.lng);
    const dArrivee = distanceM(it.point_arrivee_lat, it.point_arrivee_lng, arrivee.lat, arrivee.lng);
    return dDepart <= TOLERANCE_M && dArrivee <= TOLERANCE_M;
  });

  if (!itineraire) {
    const { data: nouveau, error: errCreate } = await supabase
      .from('itineraires')
      .insert({
        user_id: session.user.id,
        nom: `Itinéraire du ${new Date(stats.date_debut).toLocaleDateString('fr-FR')}`,
        type,
        point_depart_lat: depart.lat,
        point_depart_lng: depart.lng,
        point_arrivee_lat: arrivee.lat,
        point_arrivee_lng: arrivee.lng,
        statut_partage: 'prive',
      })
      .select()
      .single();

    if (errCreate) {
      console.error('Erreur création itinéraire:', errCreate);
      return { itineraireId: null, comparaison: null };
    }
    itineraire = nouveau;
  }

  await supabase.from('parcours').update({ itineraire_id: itineraire.id }).eq('id', parcoursId);

  // Comparaison avec les autres parcours du même itinéraire
  const { data: autres, error: errAutres } = await supabase
    .from('parcours')
    .select('*')
    .eq('itineraire_id', itineraire.id)
    .neq('id', parcoursId);

  if (errAutres || !autres || autres.length === 0) {
    return { itineraireId: itineraire.id, comparaison: null };
  }

  const comparaison = construireComparaison(stats, autres, type);
  return { itineraireId: itineraire.id, comparaison };
}

function construireComparaison(stats, autres, type) {
  const messages = [];

  const plusRapide = autres.reduce((min, p) => (p.duree_s != null && (!min || p.duree_s < min.duree_s) ? p : min), null);
  if (plusRapide && stats.duree_s && plusRapide.duree_s < stats.duree_s) {
    const gainMin = Math.round((stats.duree_s - plusRapide.duree_s) / 60);
    if (gainMin > 0) {
      messages.push(`Un parcours plus rapide existe — ${gainMin} min de moins (le ${new Date(plusRapide.date_debut).toLocaleDateString('fr-FR')}).`);
    }
  }

  const moinsDenivele = autres.reduce((min, p) => (p.denivele_positif != null && (!min || p.denivele_positif < min.denivele_positif) ? p : min), null);
  if (moinsDenivele && stats.denivele_positif != null && moinsDenivele.denivele_positif < stats.denivele_positif) {
    const gainM = Math.round(stats.denivele_positif - moinsDenivele.denivele_positif);
    if (gainM > 0) {
      messages.push(`Un parcours avec moins de dénivelé existe — ${gainM} m de moins.`);
    }
  }

  const moinsVirages = autres.reduce((min, p) => (p.nb_virages != null && (!min || p.nb_virages < min.nb_virages) ? p : min), null);
  if (moinsVirages && stats.nb_virages != null && moinsVirages.nb_virages < stats.nb_virages) {
    messages.push(`Un parcours plus direct existe — ${moinsVirages.nb_virages} virages contre ${stats.nb_virages}.`);
  }

  if (type === 'voiture') {
    const moinsCher = autres.reduce((min, p) => (p.cout_estime_eur != null && (!min || p.cout_estime_eur < min.cout_estime_eur) ? p : min), null);
    if (moinsCher && stats.cout_estime_eur != null && moinsCher.cout_estime_eur < stats.cout_estime_eur) {
      const gainEur = (stats.cout_estime_eur - moinsCher.cout_estime_eur).toFixed(2);
      messages.push(`Un parcours moins coûteux existe — ${gainEur} € de moins.`);
    }
  }

  return messages.length > 0 ? messages : null;
}
