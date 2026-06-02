/* ============================================================
   js/whoop-oauth.js — Flow OAuth Whoop côté navigateur (calqué sur strava-oauth.js)

   1. Au clic "Connecter Whoop" : redirige vers Whoop OAuth avec le JWT
      Supabase encodé dans le state (pour identifier l'user au retour).
   2. Whoop redirige vers l'Edge Function whoop-oauth-callback qui échange
      le code, stocke les tokens dans whoop_connections, puis revient à l'app
      avec ?whoop_connected=1.
   3. Au retour, on lance l'ingestion (whoop-ingest) qui remplit whoop_data.

   Config : window.WHOOP_CONFIG = { client_id, redirect_uri }  (whoop-config.js)
   ============================================================ */

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_SCOPES = 'offline read:recovery read:cycles read:sleep read:profile read:body_measurement read:workout';

export async function startWhoopOAuth() {
  const cfg = window.WHOOP_CONFIG;
  if (!cfg || !cfg.client_id || !cfg.redirect_uri) {
    alert('Whoop non configuré. Crée whoop-config.js avec client_id + redirect_uri.');
    console.error('[whoop-oauth] window.WHOOP_CONFIG manquant');
    return;
  }
  const sb = window.sb;
  if (!sb) { alert('Supabase non initialisé.'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { alert('Tu dois être connecté à ton compte Coach IA.'); return; }

  const returnUrl = window.location.origin + window.location.pathname;
  const stateData = btoa(JSON.stringify({ jwt: session.access_token, returnUrl }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.client_id,
    redirect_uri: cfg.redirect_uri,
    scope: WHOOP_SCOPES,
    state: stateData,
  });
  window.location.href = `${WHOOP_AUTH_URL}?${params.toString()}`;
}

// Détection du retour OAuth
async function checkWhoopReturn() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('whoop_connected') === '1') {
    url.searchParams.delete('whoop_connected');
    window.history.replaceState({}, '', url.toString());
    showWhoopToast('Whoop connecté. Import des données en cours…', 'success');
    setTimeout(() => startWhoopIngest(), 1000);
  }
  if (url.searchParams.get('whoop_error')) {
    const err = url.searchParams.get('whoop_error');
    url.searchParams.delete('whoop_error');
    window.history.replaceState({}, '', url.toString());
    alert('Connexion Whoop échouée : ' + err);
  }
}

// ============ INGESTION : appel à l'Edge Function whoop-ingest ============
export async function startWhoopIngest(days = 365, opts = {}) {
  const silent = !!opts.silent; // refresh auto en arrière-plan : pas de toast
  const sb = window.sb;
  if (!sb) { if (!silent) showWhoopToast('Supabase non initialisé', 'error'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { if (!silent) showWhoopToast('Tu dois être connecté', 'error'); return; }

  if (!silent) showWhoopToast('Import Whoop en cours…', 'loading');
  try {
    const cfg = window.SUPABASE_CONFIG;
    const res = await fetch(`${cfg.url}/functions/v1/whoop-ingest`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'no_whoop_connection') {
        if (!silent) showWhoopToast('Aucun compte Whoop connecté', 'error');
        return;
      }
      if (!silent) showWhoopToast(`Erreur import Whoop : ${data.error || res.status}`, 'error');
      return;
    }
    if (!silent) showWhoopToast(`Whoop importé : ${data.days_upserted || 0} jours (recovery ${data.recovery_records || 0}, sommeil ${data.sleep_records || 0})`, 'success');
    if (window.reloadDataFromSupabase) setTimeout(() => window.reloadDataFromSupabase(), 600);
  } catch (e) {
    if (!silent) showWhoopToast('Erreur réseau Whoop : ' + (e.message || e), 'error');
    console.error('[whoop-ingest]', e);
  }
}

// ============ TOAST (réutilise le style des toasts existants) ============
let _whoopToast = null;
function showWhoopToast(message, type = 'loading') {
  if (_whoopToast) _whoopToast.remove();
  const toast = document.createElement('div');
  _whoopToast = toast;
  const border = { loading: 'var(--info)', success: 'var(--accent)', error: 'var(--danger)' }[type] || 'var(--info)';
  toast.style.cssText = `
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    background: var(--bg-elev); border: 1px solid ${border};
    color: var(--text); padding: 14px 22px; border-radius: 12px;
    z-index: 9999; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 12px; max-width: 560px;
  `;
  const icon = type === 'loading'
    ? '<div style="width:16px;height:16px;border:2px solid var(--text-mute);border-top-color:var(--info);border-radius:50%;animation:spin 0.8s linear infinite;"></div>'
    : (type === 'success'
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>');
  toast.innerHTML = `${icon}<span>${message}</span>`;
  if (!document.getElementById('ingest-toast-spin')) {
    const s = document.createElement('style');
    s.id = 'ingest-toast-spin';
    s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }
  document.body.appendChild(toast);
  if (type !== 'loading') setTimeout(() => { toast.remove(); if (_whoopToast === toast) _whoopToast = null; }, 4000);
}

// Expose globalement
window.startWhoopOAuth = startWhoopOAuth;
window.startWhoopIngest = startWhoopIngest;

// Auto-check au chargement
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkWhoopReturn);
} else {
  checkWhoopReturn();
}
