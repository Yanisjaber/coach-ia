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

  const stateJwt = session.access_token;
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    response_type: 'code',
    redirect_uri: cfg.redirect_uri,
    approval_prompt: 'auto',
    scope: SCOPES,
    state: stateJwt,
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
    if (window.startStravaIngest) {
      setTimeout(() => window.startStravaIngest(), 800);
    } else {
      console.log('[strava-oauth] Ingestion pas encore implémentée — relance manuelle nécessaire');
    }
  }
  if (url.searchParams.get('strava_error')) {
    const err = url.searchParams.get('strava_error');
    url.searchParams.delete('strava_error');
    window.history.replaceState({}, '', url.toString());
    alert('Connexion Strava échouée : ' + err);
  }
}

function showStravaConnectedToast() {
  const toast = document.createElement('div');
  toast.className = 'strava-toast';
  toast.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="#FC4C02">
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
    </svg>
    <span>Strava connecté avec succès. Import des activités en cours…</span>
  `;
  toast.style.cssText = `
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    background: var(--bg-elev); border: 1px solid var(--accent);
    color: var(--text); padding: 14px 22px; border-radius: 12px;
    display: flex; align-items: center; gap: 12px;
    z-index: 9999; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    font-size: 13px; font-weight: 600;
    animation: stravaToastIn 0.3s ease-out;
  `;
  if (!document.getElementById('strava-toast-style')) {
    const st = document.createElement('style');
    st.id = 'strava-toast-style';
    st.textContent = '@keyframes stravaToastIn { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }';
    document.head.appendChild(st);
  }
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// Expose globalement
window.startStravaOAuth = startStravaOAuth;

// Auto-check au chargement
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkOAuthReturn);
} else {
  checkOAuthReturn();
}
