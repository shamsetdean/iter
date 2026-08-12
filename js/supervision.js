// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// SUPERVISION — signalements, catégories, statistiques (ouverts
// à Mélanie, Andréa, Shams) ; comptes/droits et journal
// d'activité (réservés à l'administrateur complet, Shams).
//
// Sécurité : cette page ne protège rien par elle-même. Ce qui
// protège les données, ce sont les policies RLS de Supabase :
// un compte sans droit de supervision ne recevra tout
// simplement aucune donnée, quelle que soit la page ouverte.
// Le contrôle ci-dessous n'est qu'un confort d'affichage — voir
// la note en fin de fichier au sujet des policies "catégories".
// ============================================================

import { supabase, getSession, signIn, signOut, onAuthChange, envoyerLienReinitialisation } from './supabase-client.js';
import { STYLES } from './map.js';
import {
  svgIcone, LIBELLES_PRIORITE, LIBELLES_STATUT, LIBELLES_ICONES,
  chargerCategories, chargerToutesSousCategories, chargerServices,
  enregistrerCategorie, supprimerCategorie, basculerActiveCategorie,
  enregistrerSousCategorie, supprimerSousCategorie, basculerActiveSousCategorie,
  reordonner, slugify,
} from './categories.js';
import {
  chargerSignalements,
  changerStatutSignalement,
  changerPrioriteSignalement,
  supprimerSignalement,
  creerMarqueurSignalement,
} from './signalements.js';

const authScreen = document.getElementById('auth-screen');
const ecranRefus = document.getElementById('ecran-refus');
const contenu = document.getElementById('contenu');

let profils = new Map();   // user_id -> nom
let carte = null;
let filtrePersonne = 'tous';
let signalements = [];
let filtreStatutSig = 'actifs';
let marqueursSig = [];
let sessionCourante = null;

// estAdminComplet : rôle "administrateur" (tous les droits, y
// compris administration des comptes et journal d'activité).
// estAccesDashboard : peut ouvrir cette page (droits.te.acces_dashboard
// ou administrateur) — donne accès à Signalements, Catégories et
// Statistiques, mais pas forcément à Comptes/Journal.
let estAdminComplet = false;
let estAccesDashboard = false;

const STATUTS_CLOS = ['resolu', 'cloture', 'non_recevable'];

// ------------------------------------------------------------
// Formatage
// ------------------------------------------------------------
function formatDate(iso) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// ------------------------------------------------------------
// Thème clair/sombre — persisté en localStorage, jamais déduit
// du thème système : direction assumée, cohérente sur tous les
// postes utilisés par une même personne.
// ------------------------------------------------------------
const CLE_THEME = 'iter_theme';

function appliquerTheme(theme) {
  if (theme === 'clair') document.documentElement.setAttribute('data-theme', 'clair');
  else document.documentElement.removeAttribute('data-theme');

  const label = document.getElementById('theme-label');
  if (label) label.textContent = theme === 'clair' ? 'Clair' : 'Sombre';
  const iconeLune = document.getElementById('icone-theme-lune');
  const iconeSoleil = document.getElementById('icone-theme-soleil');
  if (iconeLune) iconeLune.style.display = theme === 'clair' ? 'none' : 'block';
  if (iconeSoleil) iconeSoleil.style.display = theme === 'clair' ? 'block' : 'none';
}

appliquerTheme(localStorage.getItem(CLE_THEME) || 'sombre');

document.getElementById('btn-theme')?.addEventListener('click', () => {
  const actuel = document.documentElement.getAttribute('data-theme') === 'clair' ? 'clair' : 'sombre';
  const nouveau = actuel === 'clair' ? 'sombre' : 'clair';
  localStorage.setItem(CLE_THEME, nouveau);
  appliquerTheme(nouveau);
});

// ------------------------------------------------------------
// Navigation entre pages
// ------------------------------------------------------------
function afficherPage(nom) {
  // Garde-fou d'affichage : les pages Comptes/Journal restent
  // réservées à l'administrateur complet même si on tente d'y
  // accéder autrement qu'en cliquant le bouton correspondant
  // (celui-ci est de toute façon masqué pour les autres comptes).
  if ((nom === 'comptes' || nom === 'journal') && !estAdminComplet) nom = 'signalements';

  document.querySelectorAll('.page[data-page]').forEach((p) => {
    p.classList.toggle('active', p.dataset.page === nom);
  });
  document.querySelectorAll('.nav-item[data-page]').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === nom);
  });

  // La carte MapLibre, initialisée pendant que sa page était
  // masquée (display:none), a un canvas de taille nulle tant
  // qu'elle ne redevient pas visible : on force un recalcul.
  if (nom === 'signalements' && carte) {
    setTimeout(() => carte.resize(), 60);
  }
}

document.querySelectorAll('.nav-item[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => afficherPage(btn.dataset.page));
});

// ------------------------------------------------------------
// Authentification
// ------------------------------------------------------------
const authError = document.getElementById('auth-error');

document.getElementById('auth-submit')?.addEventListener('click', async () => {
  if (authError) authError.textContent = '';
  const email = document.getElementById('auth-email')?.value.trim();
  const motDePasse = document.getElementById('auth-password')?.value;

  if (!email || !motDePasse) {
    if (authError) authError.textContent = 'Renseignez un email et un mot de passe.';
    return;
  }

  const { error } = await signIn(email, motDePasse);
  if (error && authError) authError.textContent = error.message;
});

document.getElementById('auth-oubli')?.addEventListener('click', async () => {
  const email = document.getElementById('auth-email')?.value.trim();
  if (!authError) return;
  if (!email) {
    authError.style.color = 'var(--danger)';
    authError.textContent = "Saisissez d'abord votre adresse email, puis réessayez.";
    return;
  }
  authError.style.color = 'var(--ink-dim)';
  authError.textContent = 'Envoi en cours…';

  const { error } = await envoyerLienReinitialisation(email);
  if (error) {
    authError.style.color = 'var(--danger)';
    authError.textContent = error.message;
    return;
  }
  authError.style.color = 'var(--ok)';
  authError.textContent = 'Si un compte existe pour cette adresse, un lien de réinitialisation vient d\'être envoyé.';
});

document.getElementById('btn-deconnexion')?.addEventListener('click', () => signOut());
document.getElementById('btn-deconnexion-refus')?.addEventListener('click', () => signOut());

function afficherEcran(nom) {
  if (authScreen) authScreen.style.display = nom === 'auth' ? 'flex' : 'none';
  if (ecranRefus) ecranRefus.style.display = nom === 'refus' ? 'block' : 'none';
  if (contenu) contenu.style.display = nom === 'contenu' ? 'flex' : 'none';
}

async function verifierAcces() {
  const session = await getSession();
  if (!session) {
    afficherEcran('auth');
    return;
  }

  // Le droit est lu depuis la base, pas déduit côté client.
  // Même si cette vérification était contournée, les policies RLS
  // empêcheraient la lecture des données : c'est elles qui
  // protègent, pas cet écran.
  const [resProfil, resDroitTe] = await Promise.all([
    supabase.from('profils').select('role').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('droits').select('acces_dashboard').eq('user_id', session.user.id).eq('domaine', 'te').maybeSingle(),
  ]);

  if (resProfil.error) {
    console.error('Lecture du profil impossible :', resProfil.error);
    afficherEcran('refus');
    return;
  }

  estAdminComplet = Boolean(resProfil.data && resProfil.data.role === 'administrateur');
  estAccesDashboard = estAdminComplet || Boolean(resDroitTe.data && resDroitTe.data.acces_dashboard);

  if (!estAccesDashboard) {
    afficherEcran('refus');
    return;
  }

  // Comptes/droits et journal d'activité : réservés à
  // l'administrateur complet. Signalements, Catégories et
  // Statistiques sont ouverts à tout compte ayant acces_dashboard.
  document.getElementById('nav-comptes')?.style.setProperty('display', estAdminComplet ? 'flex' : 'none');
  document.getElementById('nav-journal')?.style.setProperty('display', estAdminComplet ? 'flex' : 'none');
  document.getElementById('nav-sep-admin')?.style.setProperty('display', estAdminComplet ? 'block' : 'none');

  sessionCourante = session;
  afficherEcran('contenu');
  await charger();
}

onAuthChange(() => verifierAcces());
verifierAcces();

// ------------------------------------------------------------
// Chargement des données
// ------------------------------------------------------------
async function charger() {
  const [resProfils, listeSignalements] = await Promise.all([
    supabase.from('profils').select('user_id, nom'),
    chargerSignalements(supabase),
  ]);
  signalements = listeSignalements;

  if (resProfils.error) console.error('Profils :', resProfils.error);
  profils = new Map((resProfils.data || []).map((p) => [p.user_id, p.nom || 'Sans nom']));

  construireFiltrePersonnes();
  brancherFiltresSignalements();
  rendreSynthese();
  rendreSignalements();
  await afficherCarte();

  // Catégories : ouvertes aux 3 comptes ayant acces_dashboard.
  await chargerCategoriesAdmin();
  rendreCategoriesAdmin();

  if (estAdminComplet) {
    await chargerJournal();
    await chargerComptes();
    rendreJournal();
    rendreComptes();
  }
}

function construireFiltrePersonnes() {
  const conteneur = document.getElementById('filtres-personne');
  if (!conteneur) return;

  conteneur.querySelectorAll('.f-personne[data-user]:not([data-user="tous"])').forEach((b) => b.remove());

  const auteurs = [...new Set(signalements.map((s) => s.user_id))];
  auteurs.forEach((uid) => {
    const btn = document.createElement('button');
    btn.className = 'f-personne';
    btn.dataset.user = uid;
    btn.textContent = profils.get(uid) || 'Inconnu';
    conteneur.appendChild(btn);
  });

  conteneur.querySelectorAll('.f-personne').forEach((btn) => {
    btn.addEventListener('click', () => {
      conteneur.querySelectorAll('.f-personne').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filtrePersonne = btn.dataset.user;
      rendreSynthese();
      rendreSignalements();
      dessinerSignalements();
    });
  });
}

// ------------------------------------------------------------
// Signalements — synthèse, liste, traitement, carte
// ------------------------------------------------------------
function brancherFiltresSignalements() {
  document.querySelectorAll('.f-sig').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.f-sig').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filtreStatutSig = btn.dataset.statut;
      rendreSignalements();
      dessinerSignalements();
    });
  });
}

function signalementsParPersonne() {
  return filtrePersonne === 'tous' ? signalements : signalements.filter((s) => s.user_id === filtrePersonne);
}

function signalementsFiltres() {
  return signalementsParPersonne().filter((s) => {
    if (filtreStatutSig === 'tous') return true;
    if (filtreStatutSig === 'actifs') return !STATUTS_CLOS.includes(s.statut);
    return STATUTS_CLOS.includes(s.statut);
  });
}

function rendreSynthese() {
  const el = document.getElementById('synthese');
  if (!el) return;

  const liste = signalementsParPersonne();
  const actifs = liste.filter((s) => !STATUTS_CLOS.includes(s.statut));
  const clos = liste.length - actifs.length;
  const urgents = actifs.filter((s) => s.priorite === 'urgent').length;

  const cases = [
    [String(liste.length), 'Signalements'],
    [String(actifs.length), 'En cours'],
    [String(clos), 'Clos'],
    [String(urgents), 'Urgents en cours'],
  ];

  el.innerHTML = cases
    .map(([v, l]) => `<div class="synthese-carte"><div class="synthese-val">${v}</div><div class="synthese-label">${l}</div></div>`)
    .join('');
}

function rendreSignalements() {
  const el = document.getElementById('liste-signalements');
  if (!el) return;

  const liste = signalementsFiltres();

  if (liste.length === 0) {
    el.className = 'etat';
    el.innerHTML = 'Aucun signalement pour cette sélection.';
    return;
  }

  el.className = '';
  el.innerHTML = liste
    .map((s) => {
      const prio = LIBELLES_PRIORITE[s.priorite] || LIBELLES_PRIORITE.normal;
      const nomAffiche = s.sous_categorie_nom || s.categorie_nom || 'Signalement';
      const date = new Date(s.created_at).toLocaleString('fr-FR', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      const clos = STATUTS_CLOS.includes(s.statut);
      return `
      <div class="sig-ligne ${clos ? 'traite' : ''}" data-id="${s.id}">
        <div class="sig-rond" style="background:${prio.couleur}">${svgIcone(s.categorie_icone || 'autre', 19, '#0a0e1a')}</div>
        <div class="sig-infos">
          <div class="sig-type">${prio.emoji} ${nomAffiche}</div>
          <div class="sig-meta">${s.categorie_nom || ''}${s.categorie_nom ? ' · ' : ''}${profils.get(s.user_id) || 'Inconnu'} · ${date} · ${LIBELLES_STATUT[s.statut] || s.statut}</div>
          ${s.commentaire ? `<div class="sig-note">« ${s.commentaire} »</div>` : ''}
        </div>
        <div class="sig-actions">
          <button class="localiser" data-loc="${s.id}" title="Localiser sur la carte" aria-label="Localiser">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          </button>
          ${
            estAdminComplet
              ? `<select class="sig-statut-select" data-prio-select="${s.id}" title="Priorité">
                  ${Object.entries(LIBELLES_PRIORITE).map(([v, p]) => `<option value="${v}" ${s.priorite === v ? 'selected' : ''}>${p.emoji} ${p.libelle}</option>`).join('')}
                 </select>`
              : ''
          }
          ${
            estAdminComplet
              ? `<select class="sig-statut-select" data-statut-select="${s.id}">
                  ${Object.entries(LIBELLES_STATUT).map(([v, l]) => `<option value="${v}" ${s.statut === v ? 'selected' : ''}>${l}</option>`).join('')}
                 </select>`
              : ''
          }
          ${
            estAdminComplet
              ? `<button class="suppr" data-suppr-sig="${s.id}" title="Supprimer" aria-label="Supprimer">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>
                 </button>`
              : ''
          }
        </div>
      </div>`;
    })
    .join('');

  // Changer le statut / la priorité / supprimer depuis ce tableau
  // de bord restent réservés à l'administrateur complet — un
  // accès "dashboard" seul est une vue de consultation, pas un
  // outil de modération sur les signalements d'autrui.
  if (estAdminComplet) {
    el.querySelectorAll('[data-statut-select]').forEach((sel) =>
      sel.addEventListener('change', (e) => majStatut(sel.dataset.statutSelect, e.target.value))
    );
    el.querySelectorAll('[data-prio-select]').forEach((sel) =>
      sel.addEventListener('change', (e) => majPriorite(sel.dataset.prioSelect, e.target.value))
    );
    el.querySelectorAll('[data-suppr-sig]').forEach((b) =>
      b.addEventListener('click', () => effacerSignalement(b.dataset.supprSig))
    );
  }
  el.querySelectorAll('[data-loc]').forEach((b) =>
    b.addEventListener('click', () => localiser(b.dataset.loc))
  );
}

async function majStatut(id, statut) {
  try {
    await changerStatutSignalement(supabase, sessionCourante, id, statut);
    const s = signalements.find((x) => x.id === id);
    if (s) s.statut = statut;
    rendreSynthese();
    rendreSignalements();
    dessinerSignalements();
  } catch (err) {
    alert(`Mise à jour impossible : ${err.message}`);
  }
}

async function majPriorite(id, priorite) {
  try {
    await changerPrioriteSignalement(supabase, id, priorite);
    const s = signalements.find((x) => x.id === id);
    if (s) s.priorite = priorite;
    rendreSynthese();
    rendreSignalements();
    dessinerSignalements();
  } catch (err) {
    alert(`Mise à jour impossible : ${err.message}`);
  }
}

async function effacerSignalement(id) {
  const s = signalements.find((x) => x.id === id);
  if (!s) return;
  const libelle = s.sous_categorie_nom || s.categorie_nom || 'ce signalement';
  if (!confirm(`Supprimer définitivement ce signalement « ${libelle} » ?`)) return;

  try {
    await supprimerSignalement(supabase, id, s.photo_chemin);
    signalements = signalements.filter((x) => x.id !== id);
    rendreSynthese();
    rendreSignalements();
    dessinerSignalements();
  } catch (err) {
    alert(`Suppression impossible : ${err.message}`);
  }
}

function localiser(id) {
  const s = signalements.find((x) => x.id === id);
  if (!s || !carte) return;
  document.getElementById('carte-signalements')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  carte.easeTo({ center: [s.lng, s.lat], zoom: 17, duration: 700 });
}

async function afficherCarte() {
  if (!carte) {
    carte = new maplibregl.Map({
      container: 'carte-signalements',
      style: STYLES[localStorage.getItem('iter_map_style') || 'standard'],
      center: [2.6167, 48.8],
      zoom: 12,
    });
    await new Promise((r) => carte.once('load', r));
  }
  dessinerSignalements();
}

function dessinerSignalements() {
  if (!carte) return;
  marqueursSig.forEach((m) => m.remove());
  marqueursSig = [];

  const liste = signalementsFiltres();

  liste.forEach((s) => {
    const marqueur = creerMarqueurSignalement(s, { auteur: profils.get(s.user_id), supabase });
    if (marqueur) {
      marqueur.addTo(carte);
      marqueursSig.push(marqueur);
    }
  });

  if (liste.length > 0) {
    const premier = [liste[0].lng, liste[0].lat];
    const bounds = liste.reduce(
      (b, s) => b.extend([s.lng, s.lat]),
      new maplibregl.LngLatBounds(premier, premier)
    );
    carte.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 400 });
  }
}

// ------------------------------------------------------------
// Export CSV des signalements affichés
// ------------------------------------------------------------
document.getElementById('btn-export-signalements')?.addEventListener('click', () => {
  const liste = signalementsFiltres();
  if (liste.length === 0) {
    alert('Aucun signalement à exporter pour cette sélection.');
    return;
  }

  const colonnes = ['personne', 'categorie', 'sous_categorie', 'priorite', 'statut', 'created_at', 'traite_at', 'commentaire', 'lat', 'lng'];

  const echapper = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const valeur = (s, c) => {
    if (c === 'personne') return profils.get(s.user_id) || 'Inconnu';
    if (c === 'categorie') return s.categorie_nom;
    if (c === 'sous_categorie') return s.sous_categorie_nom;
    return s[c];
  };

  const lignes = liste.map((s) => colonnes.map((c) => echapper(valeur(s, c))).join(','));
  const contenuCsv = colonnes.join(',') + '\n' + lignes.join('\n');

  const blob = new Blob([contenuCsv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iter-signalements-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  // a.remove() plutôt que document.body.removeChild(a) : la
  // seconde forme lève « The node to be removed is not a child of
  // this node » si le navigateur a déjà détaché le lien, ce qui
  // arrive sur Safari et quand une navigation suit le clic.
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
});

// ------------------------------------------------------------
// Journal d'activité — qui a créé, traité, modifié, supprimé.
// Réservé à l'administrateur : la policy RLS du journal ne
// renvoie rien aux autres comptes, quoi qu'ils tentent.
// ------------------------------------------------------------
let journal = [];
let filtreJournal = 'tous';

const LIBELLES_ACTION = {
  creation: 'a créé',
  traitement: 'a traité',
  modification: 'a modifié',
  suppression: 'a supprimé',
};

const LIBELLES_CIBLE = {
  signalements: 'un signalement',
};

async function chargerJournal() {
  const { data, error } = await supabase
    .from('vue_journal')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('Journal indisponible :', error);
    journal = [];
    return;
  }
  journal = data || [];
}

function resumeDetails(j) {
  const d = j.details || {};
  const morceaux = [];

  if (d.type) morceaux.push(d.type);
  if (d.titre) morceaux.push(`« ${d.titre} »`);
  if (d.nom) morceaux.push(`« ${d.nom} »`);
  if (d.cible) morceaux.push(`pour ${d.cible}`);

  if (j.action === 'traitement' && d.ancien_statut) {
    morceaux.push(`${d.ancien_statut} → ${d.nouveau_statut}`);
  }
  if (j.action === 'suppression') {
    if (d.auteur_initial) morceaux.push(`créé par ${d.auteur_initial}`);
    if (d.etait_traite === true) morceaux.push('déjà traité');
  }
  return morceaux.join(' · ');
}

function rendreJournal() {
  const el = document.getElementById('liste-journal');
  if (!el) return;

  const liste = journal.filter((j) => filtreJournal === 'tous' || j.action === filtreJournal);

  if (liste.length === 0) {
    el.className = 'etat';
    el.innerHTML = journal.length === 0
      ? "Aucune entrée. Si vous êtes administrateur sans voir le journal, c'est que l'habilitation ne vous a pas été accordée : elle est distincte du rôle."
      : 'Aucune activité pour cette sélection.';
    return;
  }

  el.className = '';
  el.innerHTML = liste
    .map((j) => {
      const quand = new Date(j.created_at).toLocaleString('fr-FR', {
        day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      const cible = LIBELLES_CIBLE[j.table_cible] || j.table_cible;
      const resume = resumeDetails(j);
      const contenuSupprime = j.donnees_supprimees
        ? `<button class="jr-voir" data-donnees="${j.id}">Voir la donnée supprimée</button>`
        : '';

      return `
      <div class="jr-ligne ${j.action}">
        <span class="jr-pastille"></span>
        <span class="jr-quoi">
          <span class="jr-qui">${j.auteur}</span> ${LIBELLES_ACTION[j.action] || j.action} ${cible}
          ${resume ? `<span class="jr-detail">${resume}</span>` : ''}
          ${contenuSupprime}
        </span>
        <span class="jr-quand">${quand}</span>
      </div>`;
    })
    .join('');

  el.querySelectorAll('[data-donnees]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entree = journal.find((x) => String(x.id) === btn.dataset.donnees);
      if (!entree || !entree.donnees_supprimees) return;

      const lignes = Object.entries(entree.donnees_supprimees)
        .filter(([, v]) => v !== null && v !== '')
        .map(([k, v]) => `${k} : ${v}`)
        .join('\n');

      alert(`Donnée supprimée le ${new Date(entree.created_at).toLocaleString('fr-FR')}\npar ${entree.auteur}\n\n${lignes}`);
    });
  });
}

document.querySelectorAll('.f-journal').forEach((btn) => {
  btn?.addEventListener('click', () => {
    document.querySelectorAll('.f-journal').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filtreJournal = btn.dataset.action;
    rendreJournal();
  });
});

document.getElementById('btn-export-journal')?.addEventListener('click', () => {
  if (journal.length === 0) {
    alert('Aucune entrée à exporter.');
    return;
  }
  const colonnes = ['created_at', 'auteur', 'auteur_email', 'action', 'domaine', 'table_cible', 'enregistrement_id', 'details', 'donnees_supprimees'];
  const echapper = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const contenuCsv = colonnes.join(',') + '\n' +
    journal.map((j) => colonnes.map((c) => echapper(j[c])).join(',')).join('\n');

  const blob = new Blob([contenuCsv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iter-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
});

// ============================================================
// ADMINISTRATION DES COMPTES — réservée à l'administrateur
// complet. Ne gère plus que le domaine "te" (Signalements) : le
// domaine "pm" (Parcours) et les réglages véhicule associés ont
// été retirés avec la fonctionnalité Parcours elle-même.
// ============================================================
const DROITS = {
  consulter: 'Consulter tout',
  enregistrer: 'Enregistrer',
  traiter: 'Traiter',
  modifier: 'Modifier',
  supprimer: 'Supprimer',
};

const COCHE = '<svg viewBox="0 0 24 24" fill="none" stroke="#06121a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

let comptes = [];

async function chargerComptes() {
  const { data, error } = await supabase.from('vue_comptes').select('*').order('email');
  if (error) {
    console.error('Comptes indisponibles :', error);
    comptes = [];
    return;
  }

  // La vue renvoie une ligne par domaine ; on ne garde que le
  // domaine "te" et on regroupe par personne.
  const parPersonne = new Map();
  (data || []).forEach((l) => {
    if (l.domaine && l.domaine !== 'te') return;
    if (!parPersonne.has(l.user_id)) {
      parPersonne.set(l.user_id, {
        user_id: l.user_id,
        email: l.email,
        nom: l.nom,
        role: l.role,
        droits: {},
      });
    }
    if (l.domaine === 'te') {
      parPersonne.get(l.user_id).droits = {
        consulter: l.consulter, enregistrer: l.enregistrer,
        traiter: l.traiter, modifier: l.modifier, supprimer: l.supprimer,
        acces_dashboard: l.acces_dashboard,
      };
    }
  });
  comptes = [...parPersonne.values()];
}

function rendreComptes() {
  const el = document.getElementById('liste-comptes');
  if (!el) return;

  if (comptes.length === 0) {
    el.className = 'etat';
    el.innerHTML = 'Aucun compte à afficher.';
    return;
  }

  const nbAdmins = comptes.filter((c) => c.role === 'administrateur').length;

  el.className = '';
  el.innerHTML = comptes
    .map((c) => {
      const estAdmin = c.role === 'administrateur';
      // On empêche de retirer le dernier administrateur : la base
      // refuserait de toute façon, autant le rendre visible.
      const dernierAdmin = estAdmin && nbAdmins <= 1;

      const droitsBoutons = Object.entries(DROITS)
        .map(([droit, nom]) => `
          <button class="cc-droit ${c.droits[droit] ? 'actif' : ''}"
                  data-user="${c.user_id}" data-droit="${droit}"
                  ${estAdmin ? 'disabled title="Un administrateur dispose déjà de tous les droits"' : ''}>
            <span class="puce">${COCHE}</span>${nom}
          </button>`)
        .join('');

      const accesDashboardBtn = `
        <button class="cc-droit ${c.droits.acces_dashboard ? 'actif' : ''}"
                data-user="${c.user_id}" data-droit="acces_dashboard"
                ${estAdmin ? 'disabled title="Un administrateur a déjà accès au tableau de bord"' : ''}>
          <span class="puce">${COCHE}</span>Accès tableau de bord
        </button>`;

      return `
      <div class="compte-carte" data-carte="${c.user_id}">
        <div class="cc-entete">
          <div class="cc-identite">
            <div class="cc-nom">${c.nom || c.email.split('@')[0]}</div>
            <div class="cc-mail">${c.email}</div>
          </div>
          <button class="cc-droit ${estAdmin ? 'actif' : ''}" data-user="${c.user_id}" data-role
                  ${dernierAdmin ? 'disabled title="Dernier administrateur : le rôle ne peut pas être retiré"' : ''}>
            <span class="puce">${COCHE}</span>Administrateur
          </button>
        </div>

        <div class="cc-domaine">
          <div class="cc-domaine-titre">Droits — Signalements</div>
          <div class="cc-droits">${droitsBoutons}${accesDashboardBtn}</div>
        </div>

        <div class="cc-pied">
          <span class="cc-retour" data-retour="${c.user_id}"></span>
        </div>
      </div>`;
    })
    .join('');

  brancherAdministration();
}

function retourCompte(userId, texte, type = '') {
  const el = document.querySelector(`[data-retour="${userId}"]`);
  if (!el) return;
  el.textContent = texte;
  el.className = `cc-retour ${type}`;
  if (texte) setTimeout(() => { if (el.textContent === texte) el.textContent = ''; }, 3000);
}

function brancherAdministration() {
  document.querySelectorAll('.cc-droit[data-droit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const { user, droit } = btn.dataset;
      const compte = comptes.find((c) => c.user_id === user);
      if (!compte) return;

      const actuel = compte.droits[droit] === true;
      const nouveau = !actuel;

      btn.disabled = true;
      const { error } = await supabase.from('droits').upsert(
        {
          user_id: user,
          domaine: 'te',
          consulter: droit === 'consulter' ? nouveau : compte.droits.consulter === true,
          enregistrer: droit === 'enregistrer' ? nouveau : compte.droits.enregistrer === true,
          traiter: droit === 'traiter' ? nouveau : compte.droits.traiter === true,
          modifier: droit === 'modifier' ? nouveau : compte.droits.modifier === true,
          supprimer: droit === 'supprimer' ? nouveau : compte.droits.supprimer === true,
          acces_dashboard: droit === 'acces_dashboard' ? nouveau : compte.droits.acces_dashboard === true,
        },
        { onConflict: 'user_id,domaine' }
      );
      btn.disabled = false;

      if (error) {
        retourCompte(user, `Échec : ${error.message}`, 'erreur');
        return;
      }

      compte.droits = { ...compte.droits, [droit]: nouveau };
      btn.classList.toggle('actif', nouveau);
      retourCompte(user, `${droit === 'acces_dashboard' ? 'Accès tableau de bord' : DROITS[droit]} ${nouveau ? 'activé' : 'désactivé'}`, 'succes');
    });
  });

  document.querySelectorAll('.cc-droit[data-role]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const user = btn.dataset.user;
      const compte = comptes.find((c) => c.user_id === user);
      if (!compte) return;

      const nouveau = compte.role === 'administrateur' ? 'utilisateur' : 'administrateur';
      if (!confirm(
        nouveau === 'administrateur'
          ? `Accorder TOUS les droits à ${compte.nom || compte.email} ?`
          : `Retirer le rôle administrateur à ${compte.nom || compte.email} ?`
      )) return;

      btn.disabled = true;
      const { error } = await supabase.from('profils').update({ role: nouveau }).eq('user_id', user);
      btn.disabled = false;

      if (error) {
        retourCompte(user, `Échec : ${error.message}`, 'erreur');
        return;
      }
      compte.role = nouveau;
      await chargerComptes();
      rendreComptes();
    });
  });
}

// Autoriser une nouvelle adresse à créer un compte
document.getElementById('btn-ajouter-compte')?.addEventListener('click', async () => {
  const email = prompt(
    "Adresse email à autoriser :\n\nLa personne pourra ensuite créer son compte depuis l'application. Ses droits seront à activer ici une fois le compte créé."
  );
  if (!email) return;

  const propre = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(propre)) {
    alert('Adresse invalide.');
    return;
  }

  const { error } = await supabase.from('emails_autorises').insert({ email: propre, note: 'ajouté depuis la supervision' });
  if (error) {
    alert(error.message.includes('duplicate') ? 'Cette adresse est déjà autorisée.' : `Échec : ${error.message}`);
    return;
  }
  alert(`${propre} peut désormais créer son compte.`);
});

// ============================================================
// ADMINISTRATION DE LA TAXONOMIE — catégories et sous-catégories
// de signalement. Ouverte aux 3 comptes ayant accès au tableau
// de bord (Mélanie, Andréa, Shams), avec CRUD complet.
//
// IMPORTANT — policies Supabase : si les policies RLS actuelles
// sur categories_signalement / sous_categories_signalement
// n'autorisent l'écriture qu'au rôle "administrateur", elles
// doivent être élargies à tout compte ayant droits.te.acces_dashboard
// = true, sans quoi Mélanie et Andréa verront l'interface mais
// leurs modifications échoueront silencieusement côté base.
// ============================================================
let categoriesAdmin = [];
let sousCategoriesAdmin = [];
let servicesAdmin = [];

async function chargerCategoriesAdmin() {
  const [cats, subs, services] = await Promise.all([
    chargerCategories(supabase, { toutesInclusInactives: true }),
    chargerToutesSousCategories(supabase, { toutesInclusInactives: true }),
    chargerServices(supabase, { toutesInclusInactifs: true }),
  ]);
  categoriesAdmin = cats;
  sousCategoriesAdmin = subs;
  servicesAdmin = services;
}

function sousCategoriesDe(categoryId) {
  return sousCategoriesAdmin
    .filter((s) => s.category_id === categoryId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function rendreCategoriesAdmin() {
  const el = document.getElementById('liste-categories-admin');
  if (!el) return;

  if (categoriesAdmin.length === 0) {
    el.className = 'etat';
    el.innerHTML = 'Aucune catégorie.';
    return;
  }

  const optionsIcones = LIBELLES_ICONES.map((i) => `<option value="${i}">${i}</option>`).join('');
  const optionsServices = ['<option value="">— aucun —</option>']
    .concat(servicesAdmin.map((s) => `<option value="${s.id}">${s.nom}</option>`))
    .join('');
  const optionsPriorite = Object.entries(LIBELLES_PRIORITE)
    .map(([v, p]) => `<option value="${v}">${p.emoji} ${p.libelle}</option>`)
    .join('');

  const tri = [...categoriesAdmin].sort((a, b) => a.sort_order - b.sort_order);

  el.className = '';
  el.innerHTML = tri
    .map((c, index) => {
      const subs = sousCategoriesDe(c.id);
      const lignesSub = subs
        .map((s, si) => `
        <div class="cat-sub-ligne ${!s.is_active ? 'inactive' : ''}" data-sub="${s.id}">
          <button class="cat-fleche" data-sub-monter="${s.id}" ${si === 0 ? 'disabled' : ''} title="Monter">▲</button>
          <button class="cat-fleche" data-sub-descendre="${s.id}" ${si === subs.length - 1 ? 'disabled' : ''} title="Descendre">▼</button>
          <input type="text" class="cat-sub-nom" data-sub-nom="${s.id}" value="${s.nom.replace(/"/g, '&quot;')}">
          <select data-sub-service="${s.id}">${optionsServices}</select>
          <select data-sub-priorite="${s.id}">${optionsPriorite}</select>
          <input type="number" min="0" class="cat-sub-delai" data-sub-delai="${s.id}" value="${s.delai_indicatif_jours ?? ''}" title="Délai indicatif (jours)">
          <button class="cat-toggle ${s.is_active ? 'actif' : ''}" data-sub-toggle="${s.id}" title="${s.is_active ? 'Désactiver' : 'Activer'}">${s.is_active ? 'Actif' : 'Inactif'}</button>
          <button class="cat-suppr" data-sub-suppr="${s.id}" title="Supprimer">✕</button>
        </div>`)
        .join('');

      return `
      <div class="cat-carte ${!c.is_active ? 'inactive' : ''}" data-cat="${c.id}">
        <div class="cat-entete">
          <button class="cat-fleche" data-cat-monter="${c.id}" ${index === 0 ? 'disabled' : ''} title="Monter">▲</button>
          <button class="cat-fleche" data-cat-descendre="${c.id}" ${index === tri.length - 1 ? 'disabled' : ''} title="Descendre">▼</button>
          <span class="cat-icone-apercu" style="background:${c.couleur}">${svgIcone(c.icone, 18, '#0a0e1a')}</span>
          <input type="text" class="cat-nom" data-cat-nom="${c.id}" value="${c.nom.replace(/"/g, '&quot;')}">
          <select data-cat-icone="${c.id}">${optionsIcones}</select>
          <input type="color" class="cat-couleur" data-cat-couleur="${c.id}" value="${c.couleur}" title="Couleur de la catégorie">
          <button class="cat-toggle ${c.is_active ? 'actif' : ''}" data-cat-toggle="${c.id}" title="${c.is_active ? 'Désactiver' : 'Activer'}">${c.is_active ? 'Active' : 'Inactive'}</button>
          <button class="cat-suppr" data-cat-suppr="${c.id}" title="Supprimer la catégorie et ses sous-catégories">✕</button>
        </div>
        <div class="cat-sous-liste">${lignesSub}</div>
        <button class="bt-action cat-ajouter-sub" data-ajouter-sub="${c.id}">+ Ajouter une sous-catégorie</button>
        <span class="cat-retour" data-cat-retour="${c.id}"></span>
      </div>`;
    })
    .join('');

  tri.forEach((c) => {
    const selIcone = el.querySelector(`[data-cat-icone="${c.id}"]`);
    if (selIcone) selIcone.value = c.icone;
    sousCategoriesDe(c.id).forEach((s) => {
      const selService = el.querySelector(`[data-sub-service="${s.id}"]`);
      if (selService) selService.value = s.service_id || '';
      const selPrio = el.querySelector(`[data-sub-priorite="${s.id}"]`);
      if (selPrio) selPrio.value = s.priorite_defaut;
    });
  });

  brancherCategoriesAdmin();
}

function retourCategorie(categoryId, texte, type = '') {
  const el = document.querySelector(`[data-cat-retour="${categoryId}"]`);
  if (!el) return;
  el.textContent = texte;
  el.className = `cat-retour ${type}`;
  if (texte) setTimeout(() => { if (el.textContent === texte) el.textContent = ''; }, 3000);
}

async function rafraichirEtRerendre() {
  await chargerCategoriesAdmin();
  rendreCategoriesAdmin();
}

function brancherCategoriesAdmin() {
  // ---- Catégories ----
  document.querySelectorAll('[data-cat-nom]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.catNom;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat || !input.value.trim()) return;
      try {
        await enregistrerCategorie(supabase, { ...cat, nom: input.value.trim() });
        cat.nom = input.value.trim();
        retourCategorie(id, 'Nom mis à jour', 'succes');
      } catch (err) {
        retourCategorie(id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-cat-icone]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.catIcone;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat) return;
      try {
        await enregistrerCategorie(supabase, { ...cat, icone: sel.value });
        cat.icone = sel.value;
        rendreCategoriesAdmin();
      } catch (err) {
        retourCategorie(id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-cat-couleur]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.catCouleur;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat) return;
      try {
        await enregistrerCategorie(supabase, { ...cat, couleur: input.value });
        cat.couleur = input.value;
        rendreCategoriesAdmin();
      } catch (err) {
        retourCategorie(id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-cat-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.catToggle;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat) return;
      try {
        await basculerActiveCategorie(supabase, id, !cat.is_active);
        cat.is_active = !cat.is_active;
        rendreCategoriesAdmin();
      } catch (err) {
        retourCategorie(id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-cat-suppr]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.catSuppr;
      const cat = categoriesAdmin.find((c) => c.id === id);
      if (!cat) return;
      const nbSubs = sousCategoriesDe(id).length;
      if (!confirm(`Supprimer la catégorie « ${cat.nom} »${nbSubs ? ` et ses ${nbSubs} sous-catégorie(s)` : ''} ?\n\nLes signalements déjà envoyés dans cette catégorie ne sont pas supprimés, mais perdront leur classification.`)) return;
      try {
        await supprimerCategorie(supabase, id);
        await rafraichirEtRerendre();
      } catch (err) {
        alert(`Suppression impossible : ${err.message}`);
      }
    });
  });

  document.querySelectorAll('[data-cat-monter]').forEach((btn) => {
    btn.addEventListener('click', () => deplacerCategorie(btn.dataset.catMonter, -1));
  });
  document.querySelectorAll('[data-cat-descendre]').forEach((btn) => {
    btn.addEventListener('click', () => deplacerCategorie(btn.dataset.catDescendre, 1));
  });

  // ---- Sous-catégories ----
  document.querySelectorAll('[data-sub-nom]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.subNom;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub || !input.value.trim()) return;
      try {
        await enregistrerSousCategorie(supabase, { ...sub, nom: input.value.trim() });
        sub.nom = input.value.trim();
        retourCategorie(sub.category_id, 'Sous-catégorie mise à jour', 'succes');
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-service]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.subService;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      try {
        await enregistrerSousCategorie(supabase, { ...sub, service_id: sel.value || null });
        sub.service_id = sel.value || null;
        retourCategorie(sub.category_id, 'Service assigné', 'succes');
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-priorite]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.subPriorite;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      try {
        await enregistrerSousCategorie(supabase, { ...sub, priorite_defaut: sel.value });
        sub.priorite_defaut = sel.value;
        retourCategorie(sub.category_id, 'Priorité par défaut mise à jour', 'succes');
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-delai]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.subDelai;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      const valeur = input.value === '' ? null : parseInt(input.value, 10);
      try {
        await enregistrerSousCategorie(supabase, { ...sub, delai_indicatif_jours: valeur });
        sub.delai_indicatif_jours = valeur;
        retourCategorie(sub.category_id, 'Délai mis à jour', 'succes');
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.subToggle;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      try {
        await basculerActiveSousCategorie(supabase, id, !sub.is_active);
        sub.is_active = !sub.is_active;
        rendreCategoriesAdmin();
      } catch (err) {
        retourCategorie(sub.category_id, `Échec : ${err.message}`, 'erreur');
      }
    });
  });

  document.querySelectorAll('[data-sub-suppr]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.subSuppr;
      const sub = sousCategoriesAdmin.find((s) => s.id === id);
      if (!sub) return;
      if (!confirm(`Supprimer la sous-catégorie « ${sub.nom} » ?\n\nLes signalements déjà envoyés avec ce choix ne sont pas supprimés, mais perdront leur classification.`)) return;
      try {
        await supprimerSousCategorie(supabase, id);
        await rafraichirEtRerendre();
      } catch (err) {
        alert(`Suppression impossible : ${err.message}`);
      }
    });
  });

  document.querySelectorAll('[data-sub-monter]').forEach((btn) => {
    btn.addEventListener('click', () => deplacerSousCategorie(btn.dataset.subMonter, -1));
  });
  document.querySelectorAll('[data-sub-descendre]').forEach((btn) => {
    btn.addEventListener('click', () => deplacerSousCategorie(btn.dataset.subDescendre, 1));
  });

  document.querySelectorAll('[data-ajouter-sub]').forEach((btn) => {
    btn.addEventListener('click', () => ajouterSousCategorie(btn.dataset.ajouterSub));
  });
}

async function deplacerCategorie(id, direction) {
  const tri = [...categoriesAdmin].sort((a, b) => a.sort_order - b.sort_order);
  const index = tri.findIndex((c) => c.id === id);
  const cible = index + direction;
  if (index < 0 || cible < 0 || cible >= tri.length) return;
  [tri[index], tri[cible]] = [tri[cible], tri[index]];
  try {
    await reordonner(supabase, 'categories_signalement', tri.map((c) => c.id));
    await rafraichirEtRerendre();
  } catch (err) {
    alert(`Réordonnancement impossible : ${err.message}`);
  }
}

async function deplacerSousCategorie(id, direction) {
  const sub = sousCategoriesAdmin.find((s) => s.id === id);
  if (!sub) return;
  const tri = sousCategoriesDe(sub.category_id);
  const index = tri.findIndex((s) => s.id === id);
  const cible = index + direction;
  if (index < 0 || cible < 0 || cible >= tri.length) return;
  [tri[index], tri[cible]] = [tri[cible], tri[index]];
  try {
    await reordonner(supabase, 'sous_categories_signalement', tri.map((s) => s.id));
    await rafraichirEtRerendre();
  } catch (err) {
    alert(`Réordonnancement impossible : ${err.message}`);
  }
}

async function ajouterSousCategorie(categoryId) {
  const nom = prompt('Nom de la nouvelle sous-catégorie :');
  if (!nom || !nom.trim()) return;

  let id = `${categoryId}-${slugify(nom)}`;
  let n = 2;
  while (sousCategoriesAdmin.some((s) => s.id === id)) { id = `${categoryId}-${slugify(nom)}-${n}`; n++; }

  const ordreMax = Math.max(0, ...sousCategoriesDe(categoryId).map((s) => s.sort_order));

  try {
    await enregistrerSousCategorie(supabase, {
      id,
      category_id: categoryId,
      nom: nom.trim(),
      priorite_defaut: 'normal',
      delai_indicatif_jours: 15,
      service_id: null,
      sort_order: ordreMax + 1,
      is_active: true,
    });
    await rafraichirEtRerendre();
  } catch (err) {
    alert(`Création impossible : ${err.message}`);
  }
}

document.getElementById('btn-ajouter-categorie')?.addEventListener('click', async () => {
  const nom = prompt('Nom de la nouvelle catégorie :');
  if (!nom || !nom.trim()) return;

  let id = slugify(nom);
  let n = 2;
  while (categoriesAdmin.some((c) => c.id === id)) { id = `${slugify(nom)}-${n}`; n++; }

  const ordreMax = Math.max(0, ...categoriesAdmin.map((c) => c.sort_order));

  try {
    await enregistrerCategorie(supabase, {
      id, nom: nom.trim(), icone: 'autre', couleur: '#3fb6f5', sort_order: ordreMax + 1, is_active: true,
    });
    await rafraichirEtRerendre();
  } catch (err) {
    alert(`Création impossible : ${err.message}`);
  }
});
