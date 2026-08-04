# iter

**Anthropotech Lab — N°07**

Application web progressive (PWA) pour enregistrer, analyser et optimiser
ses parcours à pied ou en voiture : distance, durée, vitesse, dénivelé,
nombre de virages et coût carburant estimé.

## Fonctionnalités

- Enregistrement GPS en temps réel (start / pause / stop)
- Tracé affiché en direct sur une carte MapLibre GL JS
- Calcul automatique : distance, vitesse moyenne/max, dénivelé, virages
- Estimation du coût carburant via l'API officielle
  [data.economie.gouv.fr](https://data.economie.gouv.fr)
- Regroupement des parcours en itinéraires comparables (le plus rapide,
  le moins de dénivelé, le moins coûteux)
- Export GPX / CSV
- Partage d'itinéraires à pied, public ou privé
- Alerte de sécurité : l'application ne doit jamais être utilisée par le
  conducteur d'un véhicule
- Notifications (vitesse, distance) relayées vers l'Apple Watch appairée

## Stack technique

- Vanilla JavaScript (ES modules), zéro framework
- [MapLibre GL JS](https://maplibre.org/) pour la cartographie
- [Supabase](https://supabase.com/) (PostgreSQL + Auth + Row Level
  Security) pour la persistance
- PWA (manifest + service worker) pour l'installation et l'usage
  hors-ligne partiel

## Philosophie du projet

Zéro tracker, zéro dépendance forcée, zéro publicité. Conforme RGPD.
La clé Supabase exposée côté client est une clé **publishable**,
volontairement conçue pour être visible dans un navigateur tant que le
Row Level Security est actif (voir `iter-schema-supabase.sql` pour le
détail des politiques RLS appliquées).

## Licence

© 2026 Shams Guettaf — Anthropotech Lab. Tous droits réservés.

Le code source est visible publiquement à des fins de démonstration
technique (portfolio). Cette visibilité ne constitue **pas** une
autorisation de réutilisation, modification ou distribution. Voir
[`LICENSE.txt`](./LICENSE.txt) pour le détail des conditions.
