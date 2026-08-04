// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// ITER — Suivi GPS et calculs
// ============================================================

const EARTH_RADIUS_M = 6371000;
const SEUIL_VIRAGE_DEG = 30;      // angle minimum pour compter un virage
const SEUIL_BRUIT_GPS_M = 3;      // distance minimum entre deux points valides
const INTERVALLE_MIN_ARRET_S = 5; // on garde un point au moins toutes les 5s même immobile
const SEUIL_VITESSE_VOITURE_KMH = 20; // au-delà, on demande confirmation passager

// Détection des arrêts / ralentissements / accélérations
const SEUIL_ARRET_VITESSE_KMH = 1.5;  // en dessous, on considère à l'arrêt
const SEUIL_ARRET_DUREE_S = 8;        // durée mini pour compter comme un arrêt
const FENETRE_VARIATION_S = 5;        // écart de temps max entre 2 points pour évaluer une variation
const SEUIL_TAUX_KMH_S = 3;           // variation de vitesse (km/h par seconde) pour compter comme notable

// Estimation calories — formule MET (Metabolic Equivalent of Task).
// Poids par défaut faute de profil utilisateur ; à rendre réglable
// dans les paramètres si l'utilisateur le souhaite plus tard.
const POIDS_DEFAUT_KG = 70;
const MET_MARCHE = 3.8;

function toRad(deg) { return (deg * Math.PI) / 180; }
function toDeg(rad) { return (rad * 180) / Math.PI; }

// Distance haversine entre deux points, en mètres
export function distanceM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// Cap (bearing) entre deux points, en degrés (0-360)
function bearingDeg(lat1, lng1, lat2, lng2) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Différence angulaire absolue la plus courte entre deux caps
function diffAngle(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export class SessionTracking {
  constructor(type) {
    this.type = type; // 'voiture' | 'pied'
    this.points = [];
    this.watchId = null;
    this.dateDebut = null;
    this.dateFin = null;
    this.onPoint = null;       // callback(point) — pour dessiner sur la carte
    this.onVitesse = null;     // callback(kmh) — pour alerte conducteur
    this.paused = false;
    this.pausedMs = 0;
    this.pauseStartedAt = null;
  }

  start() {
    if (!('geolocation' in navigator)) {
      throw new Error('Géolocalisation non disponible sur cet appareil.');
    }
    this.dateDebut = new Date();
    this.points = [];
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handlePosition(pos),
      (err) => console.error('Erreur GPS:', err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.dateFin = new Date();
    const stats = this._computeStats();
    stats.evenements = this._detecterEvenements();
    return stats;
  }

  _handlePosition(pos) {
    if (this.paused) return;

    const { latitude, longitude, altitude, speed } = pos.coords;
    const timestamp = new Date(pos.timestamp);
    const vitesseKmh = speed != null ? speed * 3.6 : null;

    // Filtrage du bruit GPS : on ignore un point trop proche du précédent
    // SAUF si ça fait plus de INTERVALLE_MIN_ARRET_S secondes qu'on n'a
    // rien enregistré — sinon un arrêt réel ne produirait quasiment aucun
    // point (mouvement < 3m), ce qui rendrait sa détection impossible.
    const last = this.points[this.points.length - 1];
    if (last) {
      const d = distanceM(last.lat, last.lng, latitude, longitude);
      const dtDepuisDernier = (timestamp - new Date(last.timestamp_point)) / 1000;
      if (d < SEUIL_BRUIT_GPS_M && dtDepuisDernier < INTERVALLE_MIN_ARRET_S) return;
    }

    const point = {
      lat: latitude,
      lng: longitude,
      altitude: altitude ?? null,
      timestamp_point: timestamp.toISOString(),
      vitesse_instant: vitesseKmh,
      angle_direction: null,
    };

    if (last) {
      point.angle_direction = bearingDeg(last.lat, last.lng, latitude, longitude);
    }

    this.points.push(point);

    if (this.onPoint) this.onPoint(point);

    // Alerte sécurité conducteur : vitesse type voiture en mode piéton
    if (this.type === 'pied' && vitesseKmh != null && vitesseKmh > SEUIL_VITESSE_VOITURE_KMH) {
      if (this.onVitesse) this.onVitesse(vitesseKmh);
    }
  }

  // Calcule les statistiques finales à partir des points collectés
  _computeStats() {
    let distanceTotal = 0;
    let deniveléPositif = 0;
    let deniveléNegatif = 0;
    let vitesseMax = 0;
    let sommeVitesses = 0;
    let nbVitessesValides = 0;
    let nbVirages = 0;
    let altitudeMax = -Infinity;
    let altitudeMin = Infinity;
    let vitesseMin = Infinity;

    for (let i = 1; i < this.points.length; i++) {
      const prev = this.points[i - 1];
      const curr = this.points[i];

      distanceTotal += distanceM(prev.lat, prev.lng, curr.lat, curr.lng);

      if (prev.altitude != null && curr.altitude != null) {
        const dAlt = curr.altitude - prev.altitude;
        if (dAlt > 0) deniveléPositif += dAlt;
        else deniveléNegatif += Math.abs(dAlt);
      }
      if (curr.altitude != null) {
        altitudeMax = Math.max(altitudeMax, curr.altitude);
        altitudeMin = Math.min(altitudeMin, curr.altitude);
      }

      if (curr.vitesse_instant != null) {
        vitesseMax = Math.max(vitesseMax, curr.vitesse_instant);
        if (curr.vitesse_instant > 0.5) vitesseMin = Math.min(vitesseMin, curr.vitesse_instant);
        sommeVitesses += curr.vitesse_instant;
        nbVitessesValides++;
      }

      if (i >= 2) {
        const prevAngle = this.points[i - 1].angle_direction;
        const currAngle = curr.angle_direction;
        if (prevAngle != null && currAngle != null) {
          if (diffAngle(prevAngle, currAngle) >= SEUIL_VIRAGE_DEG) {
            nbVirages++;
          }
        }
      }
    }

    const dureeS = this.dateFin && this.dateDebut
      ? Math.round((this.dateFin - this.dateDebut) / 1000)
      : null;

    const vitesseMoy = dureeS && dureeS > 0
      ? (distanceTotal / 1000) / (dureeS / 3600)
      : (nbVitessesValides > 0 ? sommeVitesses / nbVitessesValides : null);

    // Allure (min/km), pertinente surtout à pied
    const allureSecParKm = distanceTotal > 0 && dureeS
      ? Math.round(dureeS / (distanceTotal / 1000))
      : null;

    // Calories — estimation MET, pertinente à pied uniquement
    // (la marche en voiture ne dépense pas d'énergie physique notable)
    const calories = this.type === 'pied' && dureeS
      ? Math.round(MET_MARCHE * POIDS_DEFAUT_KG * (dureeS / 3600))
      : null;

    return {
      points: this.points,
      date_debut: this.dateDebut.toISOString(),
      date_fin: this.dateFin.toISOString(),
      distance_m: Math.round(distanceTotal),
      duree_s: dureeS,
      vitesse_moy: vitesseMoy != null ? Math.round(vitesseMoy * 10) / 10 : null,
      vitesse_max: Math.round(vitesseMax * 10) / 10,
      vitesse_min: vitesseMin !== Infinity ? Math.round(vitesseMin * 10) / 10 : null,
      denivele_positif: Math.round(deniveléPositif),
      denivele_negatif: Math.round(deniveléNegatif),
      altitude_max: altitudeMax !== -Infinity ? Math.round(altitudeMax) : null,
      altitude_min: altitudeMin !== Infinity ? Math.round(altitudeMin) : null,
      nb_virages: nbVirages,
      allure_sec_km: allureSecParKm,
      calories,
    };
  }

  // ------------------------------------------------------------
  // Détection des arrêts, ralentissements et accélérations —
  // répond à l'objectif de récolter un maximum d'informations
  // sur le trajet, pas seulement des totaux agrégés.
  // ------------------------------------------------------------
  _detecterEvenements() {
    const pts = this.points;
    const events = [];

    // --- Arrêts : séquences de points sous le seuil de vitesse ---
    let debutArret = null;
    for (let i = 0; i < pts.length; i++) {
      const v = pts[i].vitesse_instant;
      const estArrete = v != null && v < SEUIL_ARRET_VITESSE_KMH;

      if (estArrete && debutArret === null) {
        debutArret = i;
      } else if (!estArrete && debutArret !== null) {
        this._ajouterArretSiAssezLong(events, pts, debutArret, i - 1);
        debutArret = null;
      }
    }
    if (debutArret !== null) {
      this._ajouterArretSiAssezLong(events, pts, debutArret, pts.length - 1);
    }

    // --- Ralentissements / accélérations : variation de vitesse notable
    //     entre deux points rapprochés dans le temps ---
    let courant = null;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];

      if (prev.vitesse_instant == null || curr.vitesse_instant == null) {
        courant = null;
        continue;
      }

      const dt = (new Date(curr.timestamp_point) - new Date(prev.timestamp_point)) / 1000;
      if (dt <= 0 || dt > FENETRE_VARIATION_S) {
        courant = null;
        continue;
      }

      const taux = (curr.vitesse_instant - prev.vitesse_instant) / dt;
      let type = null;
      if (taux <= -SEUIL_TAUX_KMH_S) type = 'ralentissement';
      else if (taux >= SEUIL_TAUX_KMH_S) type = 'acceleration';

      if (type) {
        if (courant && courant.type === type) {
          courant.timestamp_fin = curr.timestamp_point;
          courant.vitesse_apres = curr.vitesse_instant;
        } else {
          if (courant) events.push(courant);
          courant = {
            type,
            lat: prev.lat,
            lng: prev.lng,
            timestamp_debut: prev.timestamp_point,
            timestamp_fin: curr.timestamp_point,
            vitesse_avant: prev.vitesse_instant,
            vitesse_apres: curr.vitesse_instant,
          };
        }
      } else if (courant) {
        events.push(courant);
        courant = null;
      }
    }
    if (courant) events.push(courant);

    // Calcul de la durée + filtre du bruit résiduel (< 2s = négligeable)
    return events
      .map((e) => ({
        ...e,
        duree_s: e.duree_s ?? Math.round((new Date(e.timestamp_fin) - new Date(e.timestamp_debut)) / 1000),
      }))
      .filter((e) => e.type === 'arret' || e.duree_s >= 2);
  }

  _ajouterArretSiAssezLong(events, pts, iDebut, iFin) {
    const t0 = new Date(pts[iDebut].timestamp_point);
    const t1 = new Date(pts[iFin].timestamp_point);
    const duree = Math.round((t1 - t0) / 1000);
    if (duree >= SEUIL_ARRET_DUREE_S) {
      events.push({
        type: 'arret',
        lat: pts[iDebut].lat,
        lng: pts[iDebut].lng,
        timestamp_debut: pts[iDebut].timestamp_point,
        timestamp_fin: pts[iFin].timestamp_point,
        duree_s: duree,
        vitesse_avant: null,
        vitesse_apres: null,
      });
    }
  }
}
