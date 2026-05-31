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

// ============ IMPORT (écran bloquant avec barre + bouton Annuler) ============
// État partagé d'annulation pour stopper l'import en cours.
let _importCancelled = false;
let _importAbort = null;

function beginImport(title) {
  _importCancelled = false;
  _importAbort = new AbortController();
  const prog = window.coachProgress
    ? window.coachProgress(title, {
        onCancel: () => { _importCancelled = true; try { _importAbort.abort(); } catch (_) {} },
      })
    : null;
  return prog;
}

// ============ INGESTION : appel à l'Edge Function strava-ingest ============
export async function startStravaIngest() {
  const sb = window.sb;
  if (!sb) { showIngestToast('Supabase non initialisé', 'error'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showIngestToast('Tu dois être connecté', 'error'); return; }

  const banner = document.getElementById('onboarding-banner');
  if (banner) banner.classList.remove('active');

  const prog = beginImport('Import Strava');
  // Animation pendant l'appel ingest (1 seule requête → pas de % réel, on monte jusqu'à 25%).
  let fake = 5;
  prog?.update(fake, 'Import des activités…');
  const timer = prog ? setInterval(() => { fake = Math.min(25, fake + 3); prog.update(fake, 'Import des activités…'); }, 600) : null;

  try {
    const cfg = window.SUPABASE_CONFIG;
    const res = await fetch(`${cfg.url}/functions/v1/strava-ingest`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      signal: _importAbort?.signal,
    });
    clearInterval(timer);
    const data = await res.json();

    if (!res.ok) {
      if (data.error === 'no_strava_connection') {
        prog?.close();
        const ok = window.appConfirm
          ? await window.appConfirm({
              title: 'Connecter Strava',
              message: "Aucun compte Strava n'est lié à ce compte Coach IA. Veux-tu en connecter un maintenant ?",
              confirmLabel: 'Connecter Strava', cancelLabel: 'Plus tard',
            })
          : confirm("Aucun compte Strava lié. En connecter un maintenant ?");
        if (ok) startStravaOAuth();
        if (banner) banner.classList.add('active');
        return;
      }
      prog?.fail(`${data.error || res.status}`);
      if (banner) banner.classList.add('active');
      return;
    }
    if (data.activities_inserted === 0 && data.activities_errored > 0) {
      console.error('[strava-ingest] First error sample:', data.first_error_sample);
      prog?.fail(`0/${data.activities_received} insérées (${data.first_error || 'inconnue'})`);
      if (banner) banner.classList.add('active');
      return;
    }

    prog?.update(28, `${data.activities_inserted || 0} activités importées`);
    if (window.reloadDataFromSupabase) setTimeout(() => window.reloadDataFromSupabase(), 600);

    // Phase 2 : power profile dans LE MÊME écran (28 → 100 %), annulable.
    await streamsPhase(session, prog, 28);
  } catch (e) {
    clearInterval(timer);
    if (e.name === 'AbortError' || _importCancelled) return; // annulé par l'utilisateur
    prog?.fail(e.message || String(e));
    console.error('[strava-ingest]', e);
    if (banner) banner.classList.add('active');
  }
}

// ============ BACKFILL STREAMS + POWER PROFILE ============
// Boucle d'appels à strava-streams (40 activités/lot). Reporte dans la barre `prog`
// (de `base` % à 100 %). S'arrête si l'utilisateur annule, sur rate-limit, ou quand fini.
async function streamsPhase(session, prog, base = 0) {
  const sb = window.sb;
  const cfg = window.SUPABASE_CONFIG;
  const url = `${cfg.url}/functions/v1/strava-streams`;
  const span = 100 - base;

  let total = 0;
  try {
    const { count } = await sb.from('activities').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id);
    total = count || 0;
  } catch (_) { /* total inconnu */ }

  for (let pass = 0; pass < 300; pass++) {
    if (_importCancelled) { prog?.close(); return; }
    let data;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 40 }),
        signal: _importAbort?.signal,
      });
      data = await res.json();
      if (!res.ok) { prog?.fail(`${data.error || res.status}`); return; }
    } catch (e) {
      if (e.name === 'AbortError' || _importCancelled) { prog?.close(); return; }
      prog?.fail(e.message || String(e)); return;
    }

    const remaining = data.remaining || 0;
    const processed = total ? Math.max(0, total - remaining) : 0;
    const pct = total ? Math.min(99, base + Math.round((processed / total) * span)) : base;
    prog?.update(pct, `Power profile : ${processed}${total ? ' / ' + total : ''} activités`);

    if (data.rate_limited) {
      prog?.update(pct, `Limite Strava atteinte — ${remaining} restantes, reprise plus tard.`);
      setTimeout(() => prog?.close(), 4000);
      return;
    }
    if (!remaining) {
      prog?.update(100, 'Terminé ✓');
      setTimeout(() => prog?.close(), 900);
      if (window.reloadDataFromSupabase) setTimeout(() => window.reloadDataFromSupabase(), 600);
      return;
    }
  }
}

// Lancement autonome (ex : bouton « Re-synchroniser ») → écran bloquant avec Annuler.
export async function startStravaStreams() {
  const sb = window.sb;
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const prog = beginImport('Analyse du Power Profile');
  await streamsPhase(session, prog, 0);
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
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>');
  toast.innerHTML = `${icon}<span>${message}</span>`;
  if (!document.getElementById('ingest-toast-spin')) {
    const s = document.createElement('style');
    s.id = 'ingest-toast-spin';
    s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }
  document.body.appendChild(toast);
  // Auto-hide après 8s sauf si loading
  if (type !== 'loading') {
    setTimeout(() => { toast.remove(); if (_ingestToast === toast) _ingestToast = null; }, 8000);
  }
}

window.startStravaIngest = startStravaIngest;

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
