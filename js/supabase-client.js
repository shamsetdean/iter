// ============================================================
// iter — Anthropotech Lab
// © 2026 Shams Guettaf. Tous droits réservés.
// Reproduction, modification ou distribution interdites sans
// autorisation écrite préalable. Voir LICENSE.txt.
// ============================================================

// ============================================================
// ITER — Client Supabase
// ============================================================
// Clé "publishable" : safe côté client tant que RLS est actif
// (c'est le cas, voir iter-schema-complet.sql).
// ============================================================

const SUPABASE_URL = 'https://gnphnfmdzlxscfnasmpg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_nOBxTihKFAZ3dnUsp6Mm6w_rlwTU3vV';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ------------------------------------------------------------
// Auth helpers
// ------------------------------------------------------------
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

// Envoie un lien de réinitialisation par email. Le lien renvoie
// vers reinitialisation.html, qui doit figurer dans les Redirect
// URLs autorisées du projet Supabase.
export async function envoyerLienReinitialisation(email) {
  const base = window.location.href.replace(/[^/]*$/, '');
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${base}reinitialisation.html`,
  });
}
