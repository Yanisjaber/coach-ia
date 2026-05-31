/* ============================================================
   js/strava-oauth.js — Flow OAuth Strava côté navigateur

   1. Au clic sur "Connecter Strava" : redirige vers Strava OAuth avec
      le JWT Supabase comme state (pour identifier l'user au retour).
   2. Strava redirige vers l'Edge Function Supabase qui :
        - vérifie le JWT (state)
        - échange le code contre les tokens
        - stocke dans strava_connections
        - redirige vers l'app avec ?strava_connected=1
   3. Au prochain chargement de l'app, on détecte ?strava_connected=1
      et on lance l'ingestion des activités.

   Configuration :
   - window.STRAVA_CONFIG = {
       client_id: '248376',  // ton client_id Strava (public)
       redirect_uri: 'https://...supabase.co/functions/v1/strava-oauth-callback'
     }
   - À mettre dans strava-config.js (similaire à supabase-config.js)
   ============================================================ */

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const SCOPES = 'read,activity:read_all,profile:read_all';

export async function startStravaOAuth() {
  const cfg = window.STRAVA_CONFIG;
  if (!cfg || !cfg.client_id || !cfg.redirect_uri) {
    alert('Strava non configuré. Crée strava-config.js avec client_id + redirect_uri.');
    console.error('[strava-oauth] window.STRAVA_CONFIG manquant');
    return;
  }
  // Récupérer le JWT Supabase comme state (auth de l'user au retour)
  const sb = window.sb;
  if (!sb) { alert('Supabase non initialisé.'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { alert('Tu dois être connecté à ton compte Coach IA.'); return; }

  // Le state contient le JWT + l'URL de retour (encodés en base64 JSON)
  // L'Edge Function va décoder ça pour rediriger vers la BONNE app (localhost / GitHub Pages / domaine custom)
  const returnUrl = window.location.origin + window.location.pathname;
  const stateData = btoa(JSON.stringify({ jwt: session.access_token, returnUrl }));
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    response_type: 'code',
    redirect_uri: cfg.redirect_uri,
    approval_prompt: 'auto',
    scope: SCOPES,
    state: stateData,
  });
  window.location.href = `${STRAVA_AUTH_URL}?${params.toString()}`;
}

// Au chargement de la page, on détecte le retour de l'OAuth
async function checkOAuthReturn() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('strava_connected') === '1') {
    // Nettoyer l'URL
    url.searchParams.delete('strava_connected');
    window.history.replaceState({}, '', url.toString());
    // Afficher une notif et déclencher l'ingestion
    showStravaConnectedToast();
    // Démarrer l'ingestion dès que le SDK Supabase est prêt
    setTimeout(() => startStravaIngest(), 1000);
  }
  if (url.searchParams.get('strava_error')) {
    const err = url.searchParams.get('strava_error');
    url.searchParams.delete('strava_error');
    window.history.replaceState({}, '', url.toString());
    alert('Connexion Strava échouée : ' + err);
  }
}

// ============ INGESTION : appel à l'Edge Function strava-ingest ============
export async function startStravaIngest() {
  const sb = window.sb;
  if (!sb) { showIngestToast('Supabase non initialisé', 'error'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showIngestToast('Tu dois être connecté', 'error'); return; }

  // Masquer le bandeau "compte vide" pendant l'import (il va se remplir)
  const banner = document.getElementById('onboarding-banner');
  if (banner) banner.classList.remove('active');

  showIngestToast('Import Strava en cours… (peut prendre 30-60s pour de gros historiques)', 'loading');

  try {
    const cfg = window.SUPABASE_CONFIG;
    const url = `${cfg.url}/functions/v1/strava-ingest`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await res.json();
    if (!res.ok) {
      // Cas spécial : aucun compte Strava lié → proposer de le connecter
      if (data.error === 'no_strava_connection') {
        showIngestToast('Aucun compte Strava connecté à ce compte', 'error');
        setTimeout(async () => {
          const ok = window.appConfirm
            ? await window.appConfirm({
                title: 'Connecter Strava',
                message: "Aucun compte Strava n'est lié à ce compte Coach IA. Veux-tu en connecter un maintenant ?",
                confirmLabel: 'Connecter Strava',
                cancelLabel: 'Plus tard',
              })
            : confirm("Aucun compte Strava lié. En connecter un maintenant ?");
          if (ok) startStravaOAuth();
        }, 800);
        if (banner) banner.classList.add('active');
        return;
      }
      showIngestToast(`Erreur import : ${data.error || res.status}`, 'error');
      // En cas d'erreur, ré-affiche la bannière pour que l'user puisse retenter
      if (banner) banner.classList.add('active');
      return;
    }
    let msg, toastType;
    if (data.activities_inserted === 0 && data.activities_errored > 0) {
      // Toutes les insertions ont échoué — afficher l'erreur
      msg = `Import échoué : 0 sur ${data.activities_received} insérées. Erreur : ${data.first_error || 'inconnue'}`;
      toastType = 'error';
      console.error('[strava-ingest] First error sample:', data.first_error_sample);
      showIngestToast(msg, toastType);
      if (banner) banner.classList.add('active');
      return;
    }

    msg = `Import terminé : ${data.activities_inserted || 0} activités, ${data.daily_metrics_computed || 0} jours calculés`;
    if (data.activities_errored > 0) {
      msg += ` (${data.activities_errored} erreurs)`;
    }
    showIngestToast(msg, 'success');
    // Re-render in-place sans reload de page : on relance le data loader Supabase
    // qui va refetch les activités fraîchement insérées et reconstruire window.DASHBOARD_DATA.
    if (window.reloadDataFromSupabase) {
      setTimeout(() => window.reloadDataFromSupabase(), 600);
    }
    // Puis on lance en arrière-plan le backfill des streams + power profile.
    setTimeout(() => startStravaStreams(), 1500);
  } catch (e) {
    showIngestToast('Erreur réseau : ' + (e.message || e), 'error');
    console.error('[strava-ingest]', e);
    if (banner) banner.classList.add('active');
  }
}

// ============ BACKFILL STREAMS + POWER PROFILE (edge function strava-streams) ============
// Appelle strava-streams en boucle : chaque appel traite un lot d'activités.
// S'arrête quand tout est traité (remaining=0) ou sur rate-limit Strava
// (auquel cas il faudra relancer ~15 min plus tard).
export async function startStravaStreams({ silent = false } = {}) {
  const sb = window.sb;
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const cfg = window.SUPABASE_CONFIG;
  const url = `${cfg.url}/functions/v1/strava-streams`;

  let totalSynced = 0;
  for (let pass = 0; pass < 60; pass++) { // garde-fou : 60 lots max par session
    let data;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 40 }),
      });
      data = await res.json();
      if (!res.ok) {
        console.warn('[strava-streams]', data.error || res.status);
        break;
      }
    } catch (e) {
      console.warn('[strava-streams] réseau', e);
      break;
    }
    totalSynced += data.streams_synced || 0;
    if (!silent && data.streams_synced > 0) {
      showIngestToast(`Power profile : ${totalSynced} activités analysées${data.remaining ? `, ${data.remaining} restantes…` : ''}`, 'loading');
    }
    if (data.rate_limited) {
      if (!silent) showIngestToast(`Power profile : limite Strava atteinte, ${data.remaining} activités restantes. Reprise auto au prochain chargement.`, 'success');
      break;
    }
    if (!data.remaining) {
      if (!silent && totalSynced > 0) showIngestToast(`Power profile à jour (${totalSynced} activités analysées)`, 'success');
      if (window.reloadDataFromSupabase) setTimeout(() => window.reloadDataFromSupabase(), 600);
      break;
    }
  }
}
window.startStravaStreams = startStravaStreams;

let _ingestToast = null;
function showIngestToast(message, type = 'loading') {
  if (_ingestToast) _ingestToast.remove();
  const toast = document.createElement('div');
  _ingestToast = toast;
  toast.className = 'ingest-toast ingest-toast-' + type;
  const colors = {
    loading: { bg: 'var(--info)', text: '#fff' },
    success: { bg: 'var(--accent)', text: '#0b0e14' },
    error: { bg: 'var(--danger)', text: '#fff' },
  };
  const c = colors[type] || colors.loading;
  toast.style.cssText = `
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    background: var(--bg-elev); border: 1px solid ${c.bg};
    color: var(--text); padding: 14px 22px; border-radius: 12px;
    z-index: 9999; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    font-size: 13px; font-weight: 600;
    display: flex; align-items: center; gap: 12px;
    max-width: 560px;
  `;
  const icon = type === 'loading'
    ? '<div style="width:16px;height:16px;border:2px solid var(--text-mute);border-top-color:var(--info);border-radius:50%;animation:spin 0.8s linear infinite;"></div>'
    : (type === 'success'
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></sv