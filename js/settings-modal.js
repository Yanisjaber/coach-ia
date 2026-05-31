/* ============================================================
   js/settings-modal.js — Page « Paramètres » (page plein écran, comme le profil)

   Ouverte via le menu utilisateur → Paramètres (window.openSettingsModal).
   Sections : Compte · Unités · Affichage · Données & connexions.

   Préférences stockées dans localStorage et exposées sur window.coachPrefs :
     - unit_distance : 'km' | 'mi'
     - unit_weight   : 'kg' | 'lb'
     - default_tab   : 'realise' | 'prevu'
   ============================================================ */

const PREF_KEYS = {
  unit_distance: 'coach_ia_unit_distance',
  unit_weight: 'coach_ia_unit_weight',
  default_tab: 'coach_ia_default_tab',
};
function getPref(key, dflt) { try { return localStorage.getItem(PREF_KEYS[key]) || dflt; } catch { return dflt; } }
function setPref(key, val) {
  try { localStorage.setItem(PREF_KEYS[key], val); } catch (_) {}
  window.coachPrefs = window.coachPrefs || {};
  window.coachPrefs[key] = val;
}
window.coachPrefs = {
  unit_distance: getPref('unit_distance', 'km'),
  unit_weight: getPref('unit_weight', 'kg'),
  default_tab: getPref('default_tab', 'realise'),
};

let _panel = null;
let _prevTab = null;

function buildPanel() {
  const section = document.createElement('section');
  section.className = 'panel profile-page';
  section.id = 'settings-page';
  section.innerHTML = `
    <div class="profile-page-header">
      <button type="button" class="profile-back-btn" id="settings-back-btn">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        Retour
      </button>
    </div>
    <div class="settings-body" id="set-body"></div>
  `;
  // insérer dans le même conteneur que les autres panels
  const anchor = document.querySelector('.panel') || document.body;
  anchor.parentNode.appendChild(section);
  section.querySelector('#settings-back-btn').addEventListener('click', closeSettingsPage);
  return section;
}

function showSettingsHeaderTitle() {
  const header = document.querySelector('header');
  if (!header) return;
  let el = document.getElementById('settings-header-title');
  if (!el) {
    el = document.createElement('div');
    el.id = 'settings-header-title';
    el.className = 'profile-header-title';
    el.innerHTML = `
      <div class="profile-page-title-text">
        <h2>Paramètres</h2>
        <p>Compte, unités, affichage et données.</p>
      </div>
      <div class="profile-page-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </div>`;
    header.appendChild(el);
  }
  el.style.display = '';
}

export function openSettingsModal() {
  injectStyles();
  if (!_panel) _panel = buildPanel();

  _prevTab = document.querySelector('.tabs .tab.active') || document.querySelector('.tabs .tab[data-panel="p1"]');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
  _panel.classList.add('active');

  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) tabsBar.classList.add('profile-hidden');
  document.getElementById('sport-filter')?.style.setProperty('display', 'none');
  document.getElementById('mode-toggle')?.style.setProperty('display', 'none');
  const hi = document.querySelector('.header-info'); if (hi) hi.style.display = 'none';
  showSettingsHeaderTitle();
  const ft = document.querySelector('footer'); if (ft) ft.style.display = 'none';
  const ob = document.getElementById('onboarding-banner'); if (ob) ob.style.display = 'none';

  window.scrollTo({ top: 0, behavior: 'instant' });
  renderBody(_panel.querySelector('#set-body'));
}

function closeSettingsPage() {
  if (_panel) _panel.classList.remove('active');
  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) tabsBar.classList.remove('profile-hidden');
  document.getElementById('sport-filter')?.style.setProperty('display', '');
  document.getElementById('mode-toggle')?.style.setProperty('display', '');
  const hi = document.querySelector('.header-info'); if (hi) hi.style.display = '';
  const sht = document.getElementById('settings-header-title'); if (sht) sht.style.display = 'none';
  const ft = document.querySelector('footer'); if (ft) ft.style.display = '';
  const ob = document.getElementById('onboarding-banner'); if (ob) ob.style.display = '';

  // Revenir à l'onglet précédent (dashboard par défaut).
  const target = _prevTab && document.body.contains(_prevTab) ? _prevTab : document.querySelector('.tabs .tab[data-panel="p1"]');
  if (target) {
    document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    target.classList.add('active');
    const panel = document.getElementById(target.dataset.panel);
    if (panel) panel.classList.add('active');
  }
}

async function renderBody(body) {
  const sb = window.sb;
  let email = '—';
  try { const { data: { user } } = await sb.auth.getUser(); email = user?.email || '—'; } catch (_) {}

  const ud = getPref('unit_distance', 'km');
  const uw = getPref('unit_weight', 'kg');
  const dt = getPref('default_tab', 'realise');

  body.innerHTML = `
    <section class="set-section">
      <h3>Compte</h3>
      <div class="set-row"><span class="set-label">Email</span><span class="set-value">${email}</span></div>
      <div class="set-actions">
        <button class="set-btn" data-act="change-pwd">Changer le mot de passe</button>
        <button class="set-btn danger" data-act="logout">Se déconnecter</button>
      </div>
      <form class="set-pwd-form" id="set-pwd-form" hidden>
        <input type="password" id="set-new-pwd" placeholder="Nouveau mot de passe (min. 6)" minlength="6" autocomplete="new-password">
        <button class="set-btn primary" type="submit">Valider</button>
        <div class="set-pwd-msg" id="set-pwd-msg"></div>
      </form>
    </section>

    <section class="set-section">
      <h3>Unités</h3>
      <div class="set-row">
        <span class="set-label">Distance</span>
        <div class="set-seg" data-pref="unit_distance">
          <button class="${ud === 'km' ? 'on' : ''}" data-val="km">km</button>
          <button class="${ud === 'mi' ? 'on' : ''}" data-val="mi">miles</button>
        </div>
      </div>
      <div class="set-row">
        <span class="set-label">Poids</span>
        <div class="set-seg" data-pref="unit_weight">
          <button class="${uw === 'kg' ? 'on' : ''}" data-val="kg">kg</button>
          <button class="${uw === 'lb' ? 'on' : ''}" data-val="lb">lb</button>
        </div>
      </div>
    </section>

    <section class="set-section">
      <h3>Affichage</h3>
      <div class="set-row">
        <span class="set-label">Onglet calendrier par défaut</span>
        <div class="set-seg" data-pref="default_tab">
          <button class="${dt === 'realise' ? 'on' : ''}" data-val="realise">Réalisé</button>
          <button class="${dt === 'prevu' ? 'on' : ''}" data-val="prevu">Prévu</button>
        </div>
      </div>
      <div class="set-row"><span class="set-label">Thème</span><span class="set-value">Sombre</span></div>
    </section>

    <section class="set-section">
      <h3>Données &amp; connexions</h3>
      <div class="set-actions">
        <button class="set-btn" data-act="open-connections">Gérer les connexions (Strava / Whoop)</button>
        <button class="set-btn danger" data-act="wipe-all">Vider toutes mes données</button>
      </div>
      <p class="set-note">« Vider » supprime définitivement tes activités, ta charge, ton power profile et tes données Whoop. Les connexions sont conservées.</p>
    </section>
  `;
  wire(body);
}

function wire(body) {
  body.querySelectorAll('.set-seg').forEach(seg => {
    seg.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        setPref(seg.dataset.pref, btn.dataset.val);
      });
    });
  });
  body.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (act === 'change-pwd') { const f = body.querySelector('#set-pwd-form'); f.hidden = !f.hidden; return; }
      if (act === 'logout') {
        const ok = window.appConfirm
          ? await window.appConfirm({ title: 'Déconnexion', message: 'Te déconnecter de Coach IA ?', confirmLabel: 'Se déconnecter', cancelLabel: 'Annuler' })
          : confirm('Te déconnecter ?');
        if (ok && window.sb) { closeSettingsPage(); await window.sb.auth.signOut(); }
        return;
      }
      if (act === 'open-connections') { closeSettingsPage(); window.openConnectionsModal?.(); return; }
      if (act === 'wipe-all') return wipeAll();
    });
  });
  const form = body.querySelector('#set-pwd-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = body.querySelector('#set-new-pwd').value;
    const msg = body.querySelector('#set-pwd-msg');
    if (!pwd || pwd.length < 6) { msg.textContent = 'Au moins 6 caractères.'; msg.className = 'set-pwd-msg err'; return; }
    msg.textContent = 'Mise à jour…'; msg.className = 'set-pwd-msg';
    try {
      const { error } = await window.sb.auth.updateUser({ password: pwd });
      if (error) throw error;
      msg.textContent = 'Mot de passe mis à jour ✓'; msg.className = 'set-pwd-msg ok';
      body.querySelector('#set-new-pwd').value = '';
    } catch (err) { msg.textContent = 'Erreur : ' + (err.message || err); msg.className = 'set-pwd-msg err'; }
  });
}

async function wipeAll() {
  const ok = window.appConfirm
    ? await window.appConfirm({ title: 'Vider toutes mes données', message: 'Action irréversible : toutes tes données Strava et Whoop seront effacées (les connexions restent). Continuer ?', confirmLabel: 'Tout vider', cancelLabel: 'Annuler' })
    : confirm('Vider toutes tes données Strava et Whoop ?');
  if (!ok) return;
  const sb = window.sb;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.appAlert?.({ title: 'Session expirée', message: 'Recharge la page.' }); return; }
  const cfg = window.SUPABASE_CONFIG;
  const url = `${cfg.url}/functions/v1/disconnect-integration`;
  const prog = window.coachProgress ? window.coachProgress('Suppression des données…') : null;
  let p = 0;
  const timer = prog ? setInterval(() => { p = Math.min(90, p + 6); prog.update(p, 'Suppression en cours…'); }, 250) : null;
  try {
    for (const provider of ['strava', 'whoop']) {
      await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, wipe: true }) });
    }
    if (timer) clearInterval(timer);
    prog?.update(100, 'Terminé');
    setTimeout(() => { prog?.close(); window.reloadDataFromSupabase?.(); }, 600);
  } catch (e) { if (timer) clearInterval(timer); prog?.fail(e.message || String(e)); }
}

function injectStyles() {
  if (document.getElementById('set-styles')) return;
  const s = document.createElement('style');
  s.id = 'set-styles';
  s.textContent = `
    .settings-body { max-width: 720px; }
    .set-section { padding: 18px 0; border-bottom: 1px solid var(--border, #2a3242); }
    .set-section:last-child { border-bottom: none; }
    .set-section h3 { margin: 0 0 12px; font-size: 15px; font-weight: 700; color: var(--text, #e8edf5); }
    .set-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
    .set-label { color: var(--text-dim, #8b94a8); font-size: 13px; }
    .set-value { color: var(--text, #e8edf5); font-size: 13px; font-weight: 600; }
    .set-seg { display: inline-flex; background: var(--bg, #0b0e14); border: 1px solid var(--border, #2a3242); border-radius: 8px; overflow: hidden; }
    .set-seg button { background: none; border: none; color: var(--text-dim, #8b94a8); font-size: 12.5px; font-weight: 600; padding: 8px 16px; cursor: pointer; font-family: inherit; }
    .set-seg button.on { background: var(--accent, #4ade80); color: #06231a; }
    .set-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .set-btn { background: var(--bg-elev2, #232a38); color: var(--text, #e8edf5); border: 1px solid var(--border, #2a3242); border-radius: 8px; padding: 10px 16px; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .set-btn:hover { filter: brightness(1.15); }
    .set-btn.primary { background: var(--accent, #4ade80); color: #06231a; border-color: transparent; }
    .set-btn.danger { background: rgba(248,113,113,0.12); color: var(--danger, #f87171); border-color: rgba(248,113,113,0.3); }
    .set-pwd-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
    .set-pwd-form input { flex: 1; min-width: 220px; background: var(--bg, #0b0e14); border: 1px solid var(--border, #2a3242); border-radius: 8px; padding: 10px 12px; color: var(--text, #e8edf5); font-size: 13px; font-family: inherit; }
    .set-pwd-msg { width: 100%; font-size: 12px; color: var(--text-dim, #8b94a8); }
    .set-pwd-msg.ok { color: var(--accent, #4ade80); }
    .set-pwd-msg.err { color: var(--danger, #f87171); }
    .set-note { color: var(--text-mute, #6b7689); font-size: 11.5px; margin: 10px 0 0; line-height: 1.5; }
  `;
  document.head.appendChild(s);
}

window.openSettingsModal = openSettingsModal;
