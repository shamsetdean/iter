// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// ZONES — architecture "1 zone = 1 ville"
//
// Aujourd'hui, une seule zone existe (Ferrières-en-Brie) : les
// fonctions ci-dessous se comportent donc comme si l'app n'avait
// qu'une ville. Le jour où une deuxième zone sera activée, il
// suffira que chaque compte ait un profils.zone_id renseigné :
// chargerZoneUtilisateur() basculera alors automatiquement sur la
// bonne zone pour chaque personne, sans rien changer ici.
//
// Le contour exact (GeoJSON) sert au masquage visuel de la carte :
// il vient de geo.api.gouv.fr (API officielle du gouvernement
// français, publique, sans clé), à partir du code INSEE de la
// zone. Pas de contour disponible → on retombe sur un simple
// carré calculé autour du centre (voir calculerBounds() dans
// map.js), ce qui reste fonctionnel même hors ligne côté contour.
// ============================================================

import { supabase } from './supabase-client.js';

let zoneActive = null;
let contourCache = new Map(); // code_insee -> GeoJSON (évite de re-fetcher à chaque écran)

// Zone de la personne connectée. À utiliser après authentification :
// c'est la version qui tiendra quand plusieurs zones coexisteront.
export async function chargerZoneUtilisateur(userId) {
  if (!userId) return chargerZoneParDefaut();

  const { data, error } = await supabase
    .from('profils')
    .select('zone_id, zones ( id, nom, code_insee, lat, lng, rayon_km, actif )')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) console.error('Zone utilisateur indisponible :', error);

  if (data && data.zones) {
    zoneActive = data.zones;
    return zoneActive;
  }
  // Profil sans zone assignée (ancien compte, ou pas encore
  // migré) : on retombe sur la zone par défaut plutôt que de
  // bloquer l'application.
  return chargerZoneParDefaut();
}

// Zone par défaut : utilisée avant connexion (écran d'accueil,
// carte de fond visible derrière le formulaire) et en repli si
// le profil n'a pas de zone. Tant qu'une seule zone est active,
// c'est toujours la même — geo.api.gouv.fr n'entre pas en jeu ici.
export async function chargerZoneParDefaut() {
  const { data, error } = await supabase
    .from('zones')
    .select('id, nom, code_insee, lat, lng, rayon_km, actif')
    .eq('actif', true)
    .order('nom')
    .limit(1)
    .maybeSingle();

  if (error) console.error('Zone par défaut indisponible :', error);
  zoneActive = data || null;
  return zoneActive;
}

export function zoneCourante() {
  return zoneActive;
}

// Contour officiel de la commune (GeoJSON), pour le masquage de
// la carte. Retourne null si indisponible : l'appelant doit alors
// se contenter du carré de calculerBounds(), pas bloquer l'écran.
export async function chargerContourZone(zone) {
  if (!zone || !zone.code_insee) return null;
  if (contourCache.has(zone.code_insee)) return contourCache.get(zone.code_insee);

  try {
    const reponse = await fetch(
      `https://geo.api.gouv.fr/communes/${zone.code_insee}?format=geojson&geometry=contour`
    );
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const geojson = await reponse.json();
    contourCache.set(zone.code_insee, geojson);
    return geojson;
  } catch (err) {
    console.warn('Contour de la commune indisponible, repli sur le carré englobant :', err);
    return null;
  }
}
