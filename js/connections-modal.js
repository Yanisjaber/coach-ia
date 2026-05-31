/* ============================================================
   js/connections-modal.js — Page « Connexions »

   Fenêtre accessible via le menu utilisateur → Connexions.
   Pour Strava et Whoop : statut, (re)connexion, re-synchro, déconnexion.

   Lit le statut depuis Supabase (colonnes "safe" uniquement — jamais les tokens).
   S'appuie sur les fonctions déjà exposées :
     window.startStravaOAuth / startStravaIngest / startStravaStreams
     window.startWhoopOAuth  / startWhoopIngest
   Expose : window.openConnectionsModal()
   ============================================================ */

function fmtDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return null; }
}

async function fetchConnections() {
  const sb = window.sb;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { user: null };
  const [{ data: strava }, { data: whoop }] = await Promise.all([
    sb.from('strava_connections')
      .select('strava_athlete_id, athlete_name, last_sync_at, last_sync_status, total_activities_synced, first_connected_at')
      .eq('user_id', user.id).maybeSingle(),
    sb.from('whoop_connections')
      .select('whoop_user_id, last_sync_at, last_sync_status, first_connected_at')
      .eq('user_id', user.id).maybeSingle(),
  ]);
  return { user, strava, whoop };
}

export async function openConnectionsModal() {
  injectStyles();
  // Overlay + conteneur
  let overlay = document.getElementById('connections-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'connections-overlay';
  overlay.className = 'cnx-overlay';
  overlay.innerHTML = `
    <div class="cnx-modal" role="dialog" aria-modal="true">
      <div class="cnx-head">
        <h2>Connexions</h2>
        <button class="cnx-close" id="cnx-close" type="button" aria-label="Fermer">×</button>
      </div>
      <div class="cnx-body" id="cnx-body">
        <div class="cnx-loading"><span class="cnx-spin"></span> Chargement du statut…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#cnx-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  await render(overlay.querySelector('#cnx-body'));
}

async function render(body) {
  let data;
  try {
    data = await fetchConnections();
  } catch (e) {
    body.innerHTML = `<div class="cnx-error">Impossible de charger le statut : ${e.message || e}</div>`;
    return;
  }
  if (!data.user) {
    body.innerHTML = `<div class="cnx-error">Tu dois être connecté à ton compte Coach IA.</div>`;
    return;
  }

  body.innerHTML = `
    ${cardStrava(data.strava)}
    ${cardWhoop(data.whoop)}
    <p class="cnx-foot">Tes jetons d'accès restent stockés côté serveur (Supabase) et ne sont jamais exposés ici.</p>
  `;
  wire(body);
}

function statusPill(conn) {
  if (!conn) return `<span class="cnx-pill off">Non connecté</span>`;
  const s = conn.last_sync_status;
  if (s === 'error') return `<span class="cnx-pill err">Erreur de sync</span>`;
  if (s === 'running') return `<span class="cnx-pill run">Sync en cours…</span>`;
  return `<span class="cnx-pill on">Connecté</span>`;
}

function cardStrava(c) {
  const last = fmtDate(c?.last_sync_at);
  const sub = c
    ? `${c.athlete_name ? c.athlete_name + ' · ' : ''}${c.total_activities_synced || 0} activités${last ? ' · sync ' + last : ''}`
    : 'Importe automatiquement tes activités, puissances et streams.';
  return `
    <div class="cnx-card strava">
      <div class="cnx-card-top">
        <div class="cnx-logo strava">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
        </div>
        <div class="cnx-card-title"><strong>Strava</strong>${statusPill(c)}</div>
      </div>
      <p class="cnx-card-sub">${sub}</p>
      <div class="cnx-actions">
        ${c
          ? `<button class="cnx-btn primary" data-act="strava-sync">Re-synchroniser</button>
             <button class="cnx-btn ghost" data-act="strava-connect">Reconnecter</button>
             <button class="cnx-btn danger" data-act="strava-disconnect">Déconnecter</button>`
          : `<button class="cnx-btn primary" data-act="strava-connect">Connecter Strava</button>`}
      </div>
    </div>`;
}

function cardWhoop(c) {
  const last = fmtDate(c?.last_sync_at);
  const sub = c
    ? `Connecté${last ? ' · sync ' + last : ''}`
    : 'Importe ta récupération, ton sommeil et ton strain.';
  return `
    <div class="cnx-card whoop">
      <div class="cnx-card-top">
        <div class="cnx-logo whoop">W</div>
        <div class="cnx-card-title"><strong>Whoop</strong>${statusPill(c)}</div>
      </div>
      <p class="cnx-card-sub">${sub}</p>
      <div class="cnx-actions">
        ${c
          ? `<button class="cnx-btn primary" data-act="whoop-sync">Re-synchroniser</button>
             <button class="cnx-btn ghost" data-act="whoop-connect">Reconnecter</button>
             <button class="cnx-btn danger" data-act="whoop-disconnect">Déconnecter</button>`
          : `<button class="cnx-btn primary" data-act="whoop-connect">Connecter Whoop</button>`}
      </div>
    </div>`;
}

function wire(body) {
  body.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (act === 'strava-connect') return window.startStravaOAuth?.();
      if (act === 'whoop-connect') return window.startWhoopOAuth?.();
      if (act === 'strava-sync') {
        closeOverlay();
        await window.startStravaIngest?.();
        window.startStravaStreams?.();
        return;
      }
      if (act === 'whoop-sync') {
        closeOverlay();
        await window.startWhoopIngest?.();
        return;
      }
      if (act === 'strava-disconnect') return showDisconnectChoice('strava', 'Strava', body);
      if (act === 'whoop-disconnect') return showDisconnectChoice('whoop', 'Whoop', body);
    });
  });
}

function closeOverlay() {
  document.getElementById('connections-overlay')?.remove();
}

// Écran de choix : déconnexion seule OU déconnexion + suppression des données.
function showDisconnectChoice(provider, label, body) {
  const dataLabel = provider === 'strava'
    ? 'activités, charge (CTL/ATL/TSB) et power profile'
    : 'recovery, sommeil et strain';
  body.innerHTML = `
    <div class="cnx-choice">
      <button class="cnx-back" id="cnx-back" type="button">← Retour</button>
      <h3 class="cnx-choice-title">Déconnecter ${label}</h3>
      <p class="cnx-choice-intro">Choisis ce que tu veux faire :</p>

      <button class="cnx-choice-opt" data-mode="soft" type="button">
        <span class="cnx-choice-opt-title">Déconnecter le compte ${label}</span>
        <span class="cnx-choice-opt-desc">Coupe la synchronisation, mais <strong>conserve</strong> tes données déjà importées (${dataLabel}). Tu pourras reconnecter plus tard sans tout re-télécharger.</span>
      </button>

      <button class="cnx-choice-opt danger" data-mode="full" type="button">
        <span class="cnx-choice-opt-title">Déconnecter <strong>et supprimer les données</strong></span>
        <span class="cnx-choice-opt-desc">Coupe la synchronisation ET efface définitivement toutes tes données ${label} (${dataLabel}). Irréversible — il faudra tout re-télécharger.</span>
      </button>
    </div>
  `;
  body.querySelector('#cnx-back').addEventListener('click', () => render(body));
  body.querySelectorAll('.cnx-choice-opt').forEach(opt => {
    opt.addEventListener('click', () => doDisconnect(provider, label, opt.dataset.mode === 'full', body));
  });
}

async function doDisconnect(provider, label, wipe, body) {
  if (wipe) {
    // On ferme la fenêtre Connexions pour ne laisser que la confirmation à l'écran.
    closeOverlay();
    const ok = window.appConfirm
      ? await window.appConfirm({
          title: `Supprimer les données ${label}`,
          message: `Action irréversible : toutes tes données ${label} vont être effacées. Continuer ?`,
          confirmLabel: 'Tout supprimer', cancelLabel: 'Annuler',
        })
      : confirm(`Supprimer définitivement toutes tes données ${label} ?`);
    if (!ok) { openConnectionsModal(); return; } // annulé → on rouvre la page Connexions
  }

  const sb = window.sb;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.appAlert?.({ title: 'Session expirée', message: 'Recharge la page et reconnecte-toi.' });
    return;
  }
  const cfg = window.SUPABASE_CONFIG;
  try {
    const res = await fetch(`${cfg.url}/functions/v1/disconnect-integration`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, wipe }),
    });
    const data = await res.json();
    if (!res.ok) {
      window.appAlert?.({ title: 'Déconnexion impossible', message: `${data.error || res.status}${data.detail ? '\n' + data.detail : ''}` });
      if (!wipe) await render(body);
      return;
    }
    if (wipe) {
      // Données effacées + fenêtre déjà fermée → on recharge le dashboard.
      if (window.reloadDataFromSupabase) window.reloadDataFromSupabase();
      window.appAlert?.({ title: `${label} déconnecté`, message: `Tes données ${label} ont été supprimées.` });
    } else {
      await render(body); // déconnexion seule → on rafraîchit le statut dans la fenêtre
    }
  } catch (e) {
    window.appAlert?.({ title: 'Erreur réseau', message: e.message || String(e) });
  }
}

function injectStyles() {
  if (document.getElementById('cnx-styles')) return;
  const s = document.createElement('style');
  s.id = 'cnx-styles';
  s.textContent = `
    .cnx-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
      z-index: 96000; display: flex; align-items: center; justify-content: center; padding: 20px;
      animation: cnxFade .15s ease-out; }
    @keyframes cnxFade { from { opacity: 0; } to { opacity: 1; } }
    .cnx-modal { width: 100%; max-width: 520px; background: var(--bg-elev, #161b26);
      border: 1px solid var(--border, #2a3242); border-radius: 16px; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
    .cnx-head { display: flex; align-items: center; justify-content: space-between;
      padding: 18px 22px; border-bottom: 1px solid var(--border, #2a3242); }
    .cnx-head h2 { font-size: 17px; font-weight: 700; color: var(--text, #e8edf5); margin: 0; }
    .cnx-close { background: none; border: none; color: var(--text-dim, #8b94a8); font-size: 24px;
      cursor: pointer; line-height: 1; padding: 0 4px; }
    .cnx-close:hover { color: var(--text, #fff); }
    .cnx-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 16px; }
    .cnx-loading, .cnx-error { color: var(--text-dim, #8b94a8); font-size: 14px; display: flex; align-items: center; gap: 10px; }
    .cnx-error { color: var(--danger, #f87171); }
    .cnx-spin { width: 16px; height: 16px; border: 2px solid var(--bg-elev2, #2a3242);
      border-top-color: var(--accent, #4ade80); border-radius: 50%; animation: cnxSpin .7s linear infinite; display: inline-block; }
    @keyframes cnxSpin { to { transform: rotate(360deg); } }
    .cnx-card { background: var(--bg, #0b0e14); border: 1px solid var(--border, #2a3242);
      border-radius: 12px; padding: 16px; }
    .cnx-card.strava { border-left: 3px solid #FC4C02; }
    .cnx-card.whoop { border-left: 3px solid #0bbfa6; }
    .cnx-card-top { display: flex; align-items: center; gap: 12px; }
    .cnx-logo { width: 38px; height: 38px; border-radius: 9px; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0; font-weight: 800; }
    .cnx-logo.strava { background: rgba(252,76,2,0.15); color: #FC4C02; }
    .cnx-logo.whoop { background: rgba(11,191,166,0.15); color: #0bbfa6; }
    .cnx-card-title { display: flex; align-items: center; gap: 10px; }
    .cnx-card-title strong { color: var(--text, #e8edf5); font-size: 15px; }
    .cnx-pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 99px; }
    .cnx-pill.on  { background: rgba(74,222,128,0.15); color: var(--accent, #4ade80); }
    .cnx-pill.off { background: rgba(139,148,168,0.15); color: var(--text-dim, #8b94a8); }
    .cnx-pill.err { background: rgba(248,113,113,0.15); color: var(--danger, #f87171); }
    .cnx-pill.run { background: rgba(96,165,250,0.15); color: var(--info, #60a5fa); }
    .cnx-card-sub { color: var(--text-dim, #8b94a8); font-size: 12.5px; margin: 10px 0 14px; line-height: 1.5; }
    .cnx-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .cnx-btn { border: none; border-radius: 8px; padding: 9px 14px; font-size: 12.5px; font-weight: 700;
      cursor: pointer; font-family: inherit; transition: filter .15s, transform .15s; }
    .cnx-btn:hover { transform: translateY(-1px); }
    .cnx-btn.primary { background: var(--accent, #4ade80); color: #06231a; }
    .cnx-btn.ghost { background: var(--bg-elev2, #232a38); color: var(--text, #e8edf5); }
    .cnx-btn.danger { background: rgba(248,113,113,0.12); color: var(--danger, #f87171); }
    .cnx-foot { color: var(--text-mute, #6b7689); font-size: 11.5px; margin: 4px 0 0; line-height: 1.5; }

    /* Écran de choix de déconnexion */
    .cnx-choice { display: flex; flex-direction: column; gap: 12px; }
    .cnx-back { align-self: flex-start; background: none; border: none; color: var(--text-dim, #8b94a8);
      font-size: 13px; cursor: pointer; padding: 0; font-family: inherit; }
    .cnx-back:hover { color: var(--text, #fff); }
    .cnx-choice-title { color: var(--text, #e8edf5); font-size: 16px; font-weight: 700; margin: 2px 0 0; }
    .cnx-choice-intro { color: var(--text-dim, #8b94a8); font-size: 13px; margin: 0 0 4px; }
    .cnx-choice-opt { text-align: left; background: var(--bg, #0b0e14); border: 1px solid var(--border, #2a3242);
      border-radius: 12px; padding: 14px 16px; cursor: pointer; display: flex; flex-direction: column; gap: 6px;
      font-family: inherit; transition: border-color .15s, background .15s; }
    .cnx-choice-opt:hover { border-color: var(--accent, #4ade80); background: var(--bg-elev2, #161b26); }
    .cnx-choice-opt.danger:hover { border-color: var(--danger, #f87171); }
    .cnx-choice-opt-title { color: var(--text, #e8edf5); font-size: 14px; font-weight: 700; }
    .cnx-choice-opt.danger .cnx-choice-opt-title { color: var(--danger, #f87171); }
    .cnx-choice-opt-desc { color: var(--text-dim, #8b94a8); font-size: 12px; line-height: 1.5; }
  `;
  document.head.appendChild(s);
}

window.openConnectionsModal = openConnectionsModal;
