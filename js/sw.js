// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// ITER — Service Worker
// Cache minimal pour usage hors-ligne + gestion des push
// notifications (vitesse/distance), relayées automatiquement
// vers l'Apple Watch appairée par iOS.
// ============================================================

// Incrémenter cette version à chaque changement de stratégie du
// service worker : l'activation purge tous les caches portant un
// autre nom, ce qui évite qu'une ancienne version de l'app
// continue d'être servie après un déploiement.
const CACHE_NAME = 'iter-v22';
const ASSETS = [
  './index.html',
  './historique.html',
  './mentions-legales.html',
  './supervision.html',
  './reinitialisation.html',
  './manifest.json',
  './favicon.ico',
  './css/style.css',
  './js/main.js',
  './js/map.js',
  './js/tracking.js',
  './js/cout.js',
  './js/export.js',
  './js/import.js',
  './js/itineraires.js',
  './js/meteo.js',
  './js/partage-visuel.js',
  './js/historique.js',
  './js/supervision.js',
  './js/signalements.js',
  './js/profil.js',
  './js/reinitialisation.js',
  './js/supabase-client.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Une page peut demander à ce worker de prendre la main sans
// attendre la fermeture de tous les onglets. Sans cela, une
// version corrigée peut rester inactive plusieurs jours.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRENDRE_LA_MAIN') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ------------------------------------------------------------
// Interception réseau
//
// Le service worker ne gère QUE les fichiers de l'application
// (même origine). Les domaines externes — tuiles de carte IGN et
// OpenFreeMap, API Supabase, météo, prix carburants — passent
// directement au réseau sans interception : les intercepter
// provoquait l'erreur « un service worker a intercepté la requête
// et a rencontré une erreur inattendue » et empêchait les fonds
// de carte de s'afficher.
//
// Stratégie sur les fichiers de l'app : réseau d'abord, cache en
// secours. L'inverse (cache d'abord) servait indéfiniment
// d'anciennes versions après un déploiement.
// ------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Domaine externe -> on laisse le navigateur faire son travail
  if (url.origin !== self.location.origin) return;

  // Schémas non cachables (extensions de navigateur, etc.)
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    fetch(request)
      .then((reponse) => {
        // Mise en cache best-effort : une écriture impossible (quota
        // saturé, navigation privée, corps déjà consommé) ne doit
        // jamais empêcher la réponse d'être servie.
        try {
          if (reponse && reponse.status === 200 && reponse.type === 'basic') {
            const copie = reponse.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copie))
              .catch(() => {});
          }
        } catch (e) {
          /* écriture en cache impossible : sans conséquence */
        }
        // La réponse est renvoyée telle quelle, y compris en 404 :
        // le navigateur affiche alors la vraie erreur (fichier
        // manquant) au lieu d'un « erreur inattendue » du worker.
        return reponse;
      })
      .catch(() =>
        // Réseau injoignable : on sert le cache s'il existe.
        caches
          .match(request)
          .catch(() => undefined)
          .then(
            (cached) =>
              cached ||
              new Response('Ressource indisponible hors-ligne', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
              })
          )
      )
      // Filet ultime : respondWith ne doit jamais recevoir une
      // promesse rejetée, sinon le navigateur signale une « erreur
      // inattendue du service worker » qui masque la cause réelle.
      .catch(
        () =>
          new Response('Erreur du service worker', {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
      )
  );
});

// ------------------------------------------------------------
// Push : notifications vitesse/distance pendant l'enregistrement
// Ces notifications s'affichent automatiquement sur l'Apple
// Watch appairée, comme n'importe quelle notification iOS.
// ------------------------------------------------------------
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'iter';
  const options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'iter-stats', // remplace la précédente au lieu d'empiler
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
