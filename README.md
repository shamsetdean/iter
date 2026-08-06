# iter

**Anthropotech Lab — N°07**

---

## Principe

Application web de terrain, en deux volets complémentaires.

**Enregistrer.** Les trajets effectués — à pied ou en véhicule — sont
tracés et analysés : distance, durée, vitesses, dénivelé, arrêts,
ralentissements, accélérations, coût. L'objectif est de comprendre un
itinéraire pour l'optimiser : le plus rapide, le moins coûteux, le moins
accidenté.

**Signaler.** Les éléments rencontrés en chemin sont relevés à leur
position exacte, photo à l'appui : travaux, déchets, élagage, danger,
signalétique.

La collecte se fait depuis le téléphone, l'analyse et le traitement
depuis un poste de supervision. Celui qui signale n'est pas
nécessairement celui qui traite ; celui qui enregistre n'a pas
nécessairement accès à l'ensemble des données. Chaque personne ne dispose
que des droits nécessaires à sa mission.

---

## Moyens utilisés

**Développement.** JavaScript natif en modules, sans framework ni étape
de compilation. Le code s'exécute tel qu'il est écrit.

**Cartographie.** MapLibre GL JS, avec trois fonds au choix : vectoriel
libre, Plan IGN et ortho-photographies IGN via la Géoplateforme.

**Données et sécurité.** Supabase — PostgreSQL, authentification,
stockage de fichiers. Les accès sont gouvernés par les politiques Row
Level Security de la base : c'est elle qui autorise ou refuse, jamais
l'interface. Les photos sont conservées dans des espaces privés,
accessibles uniquement par liens signés à durée limitée.

**Sources publiques.** IGN Géoplateforme pour les fonds de carte,
data.economie.gouv.fr pour les prix des carburants, Open-Meteo pour les
conditions météorologiques.

**Distribution.** Application web progressive : installable sur
téléphone, utilisable partiellement hors connexion.

---

## Droits d'auteur

**© 2026 Shams Guettaf — Anthropotech Lab. Tous droits réservés.**

L'ensemble des éléments constituant iter — code source, architecture,
interface, identité visuelle, nom, textes et fonctionnalités — est la
propriété exclusive de Shams Guettaf. Cette œuvre est protégée par le
droit d'auteur français dès sa création, sans formalité de dépôt,
conformément aux articles L111-1 et suivants du Code de la propriété
intellectuelle.

La visibilité publique de ce dépôt répond à un usage de portfolio et de
démonstration technique. **Elle n'emporte aucune renonciation aux droits
de son auteur et ne constitue en aucun cas une autorisation** de
reproduction, de modification, de distribution ou d'exploitation, en tout
ou partie.

Sont notamment interdits sans accord écrit préalable :

- la reproduction totale ou partielle du code, de l'architecture, du
  design ou du concept ;
- toute adaptation, traduction ou création d'une œuvre dérivée ;
- toute republication ou mise à disposition de tiers ;
- toute exploitation commerciale, directe ou indirecte ;
- toute réutilisation du nom « iter », du logo ou de l'identité visuelle.

Toute reproduction ou représentation non autorisée est susceptible de
constituer une contrefaçon, sanctionnée par les articles L335-2 et
suivants du Code de la propriété intellectuelle.

Ce dépôt n'est **pas** placé sous licence open source. Voir
[`LICENSE.txt`](./LICENSE.txt) pour les conditions complètes.

---

## Données personnelles

Les données de géolocalisation et les signalements relèvent du Règlement
Général sur la Protection des Données. Aucun traceur publicitaire, aucune
revente, aucune exploitation secondaire. Voir
[`mentions-legales.html`](./mentions-legales.html).

---

## Avertissement

Cette application ne doit jamais être utilisée par le conducteur d'un
véhicule en circulation.
