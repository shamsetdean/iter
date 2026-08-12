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
// PASSWORD_RECOVERY). Sans cette session, la page refuse
// d'afficher le formulaire : impossible de changer le mot de
// passe de quelqu'un sans être passé par sa boîte mail.
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

function activerFormulaire() {
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

// Le jeton arrive dans le fragment d'URL (#access_token=…), que
// le SDK Supabase consomme au chargement. On écoute donc
// l'événement plutôt que de lire l'URL nous-mêmes.
supabase.auth.onAuthStateChange((evenement, session) => {
  if (evenement === 'PASSWORD_RECOVERY' || (evenement === 'SIGNED_IN' && session)) {
    activerFormulaire();
  }
});

// Cas où la session est déjà établie au moment du chargement
getSession().then((session) => {
  if (session) activerFormulaire();
  else {
    // On laisse au SDK le temps de traiter le fragment d'URL
    setTimeout(async () => {
      const s = await getSession();
      if (s) activerFormulaire();
      else lienInvalide();
    }, 1200);
  }
});

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

  if (formulaire) formulaire.style.display = 'none';
  if (sousTitre) sousTitre.textContent = 'Mot de passe modifié.';
  afficher('Vous pouvez maintenant vous connecter. Redirection en cours…', 'succes');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 2200);
});
