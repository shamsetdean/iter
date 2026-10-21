// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// Définition d'un nouveau mot de passe.
//
// Supabase place l'utilisateur en session temporaire quand il
// arrive depuis le lien reçu par email (événement
// PASSWORD_RECOVERY). Le formulaire ne s'ouvre QUE dans ce cas :
// une session déjà ouverte (collègue resté connecté sur un poste
// partagé) ne suffit pas. Impossible de changer le mot de passe
// de quelqu'un sans être passé par sa boîte mail.
// ============================================================

import { supabase, getSession } from './supabase-client.js';

const LONGUEUR_MINIMALE = 10;

const sousTitre = document.getElementById('sous-titre');
const formulaire = document.getElementById('formulaire');
const message = document.getElementById('message');
const mdp1 = document.getElementById('mdp1');
const mdp2 = document.getElementById('mdp2');
const boutonValider = document.getElementById('valider');

function afficher(texte, type = '') {
  if (!message) return;
  message.textContent = texte;
  message.style.color = type === 'succes' ? 'var(--ok)' : type === 'info' ? 'var(--ink-dim)' : 'var(--danger)';
}

// L'adresse est lue ici, avant que le SDK ne la nettoie : ce code
// s'exécute dans la même tâche que la création du client
// Supabase, donc avant le traitement asynchrone du lien.
const adresseInitiale = `${window.location.search}${window.location.hash}`;
const arriveeParLien =
  /[#?&]type=recovery(?:&|$)/.test(adresseInitiale) || /[?&]code=/.test(adresseInitiale);

let formulaireOuvert = false;

function activerFormulaire() {
  if (formulaireOuvert) return;
  formulaireOuvert = true;
  afficher('');
  if (sousTitre) sousTitre.textContent = 'Choisissez un nouveau mot de passe pour votre compte.';
  if (formulaire) formulaire.style.display = 'block';
}

function lienInvalide() {
  if (sousTitre) sousTitre.textContent = 'Lien invalide ou expiré.';
  afficher(
    "Ce lien de réinitialisation n'est plus valable. Demandez-en un nouveau depuis l'écran de connexion.",
    'info'
  );
}

// Signal principal : l'événement émis par le SDK quand il a
// validé le jeton du lien. SIGNED_IN n'est volontairement plus
// accepté : il se produit aussi pour une session ordinaire.
supabase.auth.onAuthStateChange((evenement) => {
  if (evenement === 'PASSWORD_RECOVERY') activerFormulaire();
});

if (!arriveeParLien) {
  // Page ouverte directement, sans lien de réinitialisation :
  // refus, même si une session est ouverte dans ce navigateur.
  lienInvalide();
} else {
  // Filet de sécurité si l'événement a été émis avant l'écoute :
  // on laisse au SDK le temps de traiter le lien, puis on vérifie
  // qu'une session a bien été établie par ce lien.
  setTimeout(async () => {
    if (formulaireOuvert) return;
    const session = await getSession();
    if (session) activerFormulaire();
    else lienInvalide();
  }, 1200);
}

// ------------------------------------------------------------
// Contrôle des exigences en direct
// ------------------------------------------------------------
function verifierExigences() {
  const v1 = mdp1?.value || '';
  const v2 = mdp2?.value || '';

  const longueurOk = v1.length >= LONGUEUR_MINIMALE;
  const identiquesOk = v1.length > 0 && v1 === v2;

  document.getElementById('ex-longueur')?.classList.toggle('ok', longueurOk);
  document.getElementById('ex-identiques')?.classList.toggle('ok', identiquesOk);

  return longueurOk && identiquesOk;
}

mdp1?.addEventListener('input', verifierExigences);
mdp2?.addEventListener('input', verifierExigences);

// ------------------------------------------------------------
// Enregistrement
// ------------------------------------------------------------
boutonValider?.addEventListener('click', async () => {
  afficher('');

  const v1 = mdp1?.value || '';
  const v2 = mdp2?.value || '';

  if (v1.length < LONGUEUR_MINIMALE) {
    afficher(`Le mot de passe doit contenir au moins ${LONGUEUR_MINIMALE} caractères.`);
    return;
  }
  if (v1 !== v2) {
    afficher('Les deux saisies ne correspondent pas.');
    return;
  }

  boutonValider.disabled = true;
  boutonValider.textContent = 'Enregistrement…';

  const { error } = await supabase.auth.updateUser({ password: v1 });

  if (error) {
    afficher(`Modification impossible : ${error.message}`);
    boutonValider.disabled = false;
    boutonValider.textContent = 'Enregistrer';
    return;
  }

  // Déconnexion de toutes les sessions du compte, sur tous les
  // appareils : si quelqu'un utilisait l'ancien mot de passe, il
  // perd l'accès immédiatement. Un échec ici ne remet pas en
  // cause le changement de mot de passe, déjà enregistré.
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch (e) {
    console.warn('Déconnexion des autres sessions impossible :', e);
  }

  if (formulaire) formulaire.style.display = 'none';
  if (sousTitre) sousTitre.textContent = 'Mot de passe modifié.';
  afficher('Vous pouvez maintenant vous connecter. Redirection en cours…', 'succes');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 2200);
});
