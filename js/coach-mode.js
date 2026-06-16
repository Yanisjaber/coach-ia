/* ============================================================
   js/coach-mode.js - Vue entraineur (toolbar) + invitations
   - Bouton bascule "Vue entraineur" <-> "Vue perso" (au-dessus du compte).
   - Onglet "Athletes" : liste avec statut (actif / en attente), actions
     (afficher, renommer, retirer, copier/renvoyer l'invitation) + ajout email.
   - Flux d'acceptation : l'athlete invite voit une fenetre pour accepter/refuser.
   ============================================================ */

let _coachUser = null;
const _nameById = new Map();
let _origP1Label = null;
window.coachState = null;

window.addEventListener('coach-ia-auth', (e) => {
  _coachUser = e.detail.user || null;
  if (_coachUser) waitForFoot().then(setup).catch(() => {});
  else cleanupAll();
});

(async function bootstrap() {
  try {
    if (window.sbReady) { try { await window.sbReady; } catch (_) {} }
    const user = window.sbCurrentUser ? await window.sbCurrentUser() : null;
    if (user) { _coachUser = user; waitForFoot().then(setup).catch(() => {}); }
  } catch (e) { console.warn('[coach-mode] bootstrap', e); }
})();

function waitForFoot(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ok = () => (document.querySelector('.header-info') || document.getElementById('auth-user-menu-wrap'))
      && document.querySelector('.sidebar-nav') && document.querySelector('.container');
    if (ok()) return resolve(true);
    const t0 = Date.now();
    const obs = new MutationObserver(() => {
      if (ok()) { obs.disconnect(); resolve(true); }
      else if (Date.now() - t0 > timeoutMs) { obs.disconnect(); reject(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
}

function setup() {
  injectToggleButton();
  ensureAthletesUI();
  injectTopIndicator();
  checkInvites();
}

function cleanupAll() {
  const b = document.getElementById('coach-side-btn'); if (b) b.remove();
  exitCoachMode();
}

/* ---- Bouton bascule ---- */
function injectToggleButton() {
  if (document.getElementById('coach-side-btn')) return;
  const wrap = document.getElementById('auth-user-menu-wrap');
  const foot = document.querySelector('.header-info') || (wrap && wrap.parentNode);
  if (!foot) return;
  const btn = document.createElement('button');
  btn.id = 'coach-side-btn'; btn.type = 'button'; btn.className = 'coach-side-btn';
  setToggleLabel(btn, false);
  btn.addEventListener('click', toggleCoachMode);
  if (wrap && wrap.parentNode === foot) foot.insertBefore(btn, wrap);
  else foot.insertBefore(btn, foot.firstChild);
}
function setToggleLabel(btn, coach) {
  btn.classList.toggle('is-coach', coach);
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    (coach ? '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
           : '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>') +
    '</svg><span>' + (coach ? 'Vue perso' : 'Vue entraineur') + '</span>';
}
function toggleCoachMode() {
  if (document.body.classList.contains('coach-mode')) exitCoachMode(); else enterCoachMode();
}
function enterCoachMode() {
  document.body.classList.add('coach-mode');
  const span = document.querySelector('.tab[data-panel="p1"] span');
  if (span) { if (_origP1Label === null) _origP1Label = span.textContent; span.textContent = 'Forme'; }
  const btn = document.getElementById('coach-side-btn'); if (btn) setToggleLabel(btn, true);
  if (window.coachEnsureChat) window.coachEnsureChat();
  showAthletesPanel();
  loadCards();
}
function exitCoachMode() {
  if (window.coachStopChat) window.coachStopChat();
  document.body.classList.remove('coach-mode', 'coach-has-athlete');
  const span = document.querySelector('.tab[data-panel="p1"] span');
  if (span && _origP1Label !== null) span.textContent = _origP1Label;
  const btn = document.getElementById('coach-side-btn'); if (btn) setToggleLabel(btn, false);
  updateTopIndicator();
  window.coachState = null;
  if (window.getViewingAthleteId && window.getViewingAthleteId()) { if (window.viewAsAthlete) window.viewAsAthlete(null); }
  const t1 = document.querySelector('.tab[data-panel="p1"]'); if (t1) t1.click();
}

/* ---- Onglet + panneau Athletes ---- */
function ensureAthletesUI() {
  if (document.getElementById('p-athletes')) return;
  const container = document.querySelector('.container');
  const nav = document.querySelector('.sidebar-nav');
  if (!container || !nav) return;
  const panel = document.createElement('section');
  panel.className = 'panel'; panel.id = 'p-athletes';
  panel.innerHTML = [
    '<div class="coach-athletes-head">',
    '  <h2 class="coach-ath-h">Mes athletes</h2>',
    '  <div class="coach-ath-sub" id="coach-fp-sub"></div>',
    '</div>',
    '<div class="coach-add-row">',
    '  <input id="coach-add-email" class="coach-add-input" type="email" placeholder="Inviter un athlete par email" autocomplete="off">',
    '  <button id="coach-add-btn" class="coach-add-btn" type="button">Inviter</button>',
    '</div>',
    '<div id="coach-add-msg" class="coach-add-msg" hidden></div>',
    '<div id="coach-cards" class="coach-cards"></div>'
  ].join('');
  container.appendChild(panel);

  const tab = document.createElement('button');
  tab.className = 'tab'; tab.dataset.panel = 'p-athletes'; tab.id = 'coach-athletes-tab';
  tab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>Athletes</span>';
  tab.addEventListener('click', showAthletesPanel);
  nav.insertBefore(tab, nav.firstChild);

  const input = panel.querySelector('#coach-add-email');
  const addBtn = panel.querySelector('#coach-add-btn');
  const onAdd = () => addAthlete(input.value);
  addBtn.addEventListener('click', onAdd);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onAdd(); });
}

function showAthletesPanel() {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const tab = document.getElementById('coach-athletes-tab');
  const panel = document.getElementById('p-athletes');
  if (tab) tab.classList.add('active');
  if (panel) panel.classList.add('active');
  const title = document.getElementById('topbar-title'); if (title) title.textContent = 'Athletes';
}

async function loadCards() {
  const wrap = document.getElementById('coach-cards');
  const sub = document.getElementById('coach-fp-sub');
  if (!wrap) return;
  wrap.innerHTML = '<div class="coach-empty">Chargement...</div>';
  const sb = window.sb || (window.sbReady ? await window.sbReady : null);
  if (!sb || !_coachUser) { wrap.innerHTML = '<div class="coach-empty">Connexion indisponible</div>'; return; }

  let links = [];
  try {
    const { data, error } = await sb.from('coach_athlete')
      .select('id, athlete_id, status, coach_label, invited_email')
      .eq('coach_id', _coachUser.id).neq('athlete_id', _coachUser.id)
      .in('status', ['active', 'pending']);
    if (error) throw error;
    links = data || [];
  } catch (e) {
    wrap.innerHTML = '<div class="coach-empty">Erreur de chargement (migrations SQL appliquees ?)</div>';
    return;
  }

  const active = links.filter(l => l.status === 'active');
  const pending = links.filter(l => l.status === 'pending');

  // noms des athletes actifs (profils accessibles seulement si actifs)
  const profById = {};
  if (active.length) {
    try {
      const { data: profs } = await sb.from('profiles').select('id, display_name').in('id', active.map(l => l.athlete_id));
      (profs || []).forEach(p => { profById[p.id] = p.display_name; });
    } catch (e) {}
  }

  _nameById.clear();
  active.forEach(l => _nameById.set(l.athlete_id, l.coach_label || profById[l.athlete_id] || 'Athlete'));

  if (sub) {
    const a = active.length, p = pending.length;
    sub.textContent = (a ? (a + ' actif' + (a > 1 ? 's' : '')) : 'Aucun athlete actif') + (p ? ' - ' + p + ' en attente' : '');
  }

  if (!links.length) {
    wrap.innerHTML = '<div class="coach-empty">Aucun athlete pour le moment.<br>Invite un athlete par son email ci-dessus.</div>';
    return;
  }

  const cards = []
    .concat(pending.map(l => pendingCard(l)))
    .concat(active.map(l => activeCard(l, l.coach_label || profById[l.athlete_id] || 'Athlete')));
  wrap.innerHTML = cards.join('');

  active.forEach(l => fillCard(sb, l.athlete_id));
  wireCards(wrap);
}

function activeCard(l, name) {
  const id = l.athlete_id, initial = (name[0] || 'A').toUpperCase();
  const sel = (window.coachState && window.coachState.athleteId === id) ? ' selected' : '';
  return [
    '<div class="coach-card active' + sel + '" data-id="' + id + '" data-link="' + l.id + '">',
    '  <div class="coach-card-head">',
    '    <span class="coach-card-avatar">' + escapeHtml(initial) + '</span>',
    '    <span class="coach-card-name">' + escapeHtml(name) + '</span>',
    '    <span class="coach-badge ok">Actif</span>',
    '  </div>',
    '  <div class="coach-card-stats" id="cc-' + id + '">',
    statHtml('--', 'Forme', '') + statHtml('--', 'Fitness', '') + statHtml('--', 'Fatigue', '') + statHtml('--', 'Recup', ''),
    '  </div>',
    '  <div class="coach-card-last" id="cl-' + id + '">Derniere seance : --</div>',
    '  <button class="coach-open-btn" data-act="open" data-id="' + id + '" type="button">Afficher l&rsquo;athlete</button>',
    '  <div class="coach-card-actions">',
    '    <button data-act="rename" data-id="' + id + '" type="button">Renommer</button>',
    '    <button data-act="remove" data-id="' + id + '" data-name="' + escapeHtml(name) + '" type="button" class="danger">Retirer</button>',
    '  </div>',
    '</div>'
  ].join('');
}

function pendingCard(l) {
  const label = l.coach_label || l.invited_email || 'Athlete';
  const initial = (label[0] || '?').toUpperCase();
  return [
    '<div class="coach-card pending" data-link="' + l.id + '" data-email="' + escapeHtml(l.invited_email || '') + '">',
    '  <div class="coach-card-head">',
    '    <span class="coach-card-avatar pend">' + escapeHtml(initial) + '</span>',
    '    <span class="coach-card-name">' + escapeHtml(label) + '</span>',
    '    <span class="coach-badge warn">En attente</span>',
    '  </div>',
    '  <div class="coach-pending-note">Invitation creee. En attente de l&rsquo;acceptation de l&rsquo;athlete.</div>',
    '  <div class="coach-card-actions">',
    '    <button data-act="copy" data-link="' + l.id + '" type="button">Copier le lien</button>',
    '    <button data-act="resend" data-link="' + l.id + '" data-email="' + escapeHtml(l.invited_email || '') + '" type="button">Renvoyer l&rsquo;email</button>',
    '    <button data-act="remove-link" data-link="' + l.id + '" type="button" class="danger">Retirer</button>',
    '  </div>',
    '</div>'
  ].join('');
}

function wireCards(wrap) {
  wrap.querySelectorAll('[data-act]').forEach(btn => {
    const act = btn.dataset.act;
    btn.addEventListener('click', () => {
      if (act === 'open') selectAthlete(btn.dataset.id, _nameById.get(btn.dataset.id) || 'Athlete');
      else if (act === 'rename') renameAthlete(btn.dataset.id);
      else if (act === 'remove') removeAthlete(btn.dataset.id, btn.dataset.name);
      else if (act === 'remove-link') removeLink(btn.dataset.link);
      else if (act === 'copy') copyInvite(btn.dataset.link, btn);
      else if (act === 'resend') resendInvite(btn.dataset.link, btn.dataset.email, btn);
    });
  });
}

async function fillCard(sb, id) {
  try {
    const [dm, wd, act] = await Promise.all([
      sb.from('daily_metrics').select('ctl, atl, tsb, iso_date').eq('user_id', id).order('iso_date', { ascending: false }).limit(1),
      sb.from('whoop_data').select('recovery, iso_date').eq('user_id', id).order('iso_date', { ascending: false }).limit(1),
      sb.from('activities').select('name, tss, start_date_local').eq('user_id', id).order('start_date_local', { ascending: false }).limit(1),
    ]);
    const m = (dm.data && dm.data[0]) || {}, w = (wd.data && wd.data[0]) || {}, s = (act.data && act.data[0]) || {};
    const stats = document.getElementById('cc-' + id);
    if (stats) {
      const tsb = (m.tsb != null) ? Math.round(m.tsb) : null;
      const ctl = (m.ctl != null) ? Math.round(m.ctl) : null;
      const atl = (m.atl != null) ? Math.round(m.atl) : null;
      const rec = (w.recovery != null) ? (w.recovery + '%') : '--';
      const tsbStr = tsb != null ? (tsb > 0 ? '+' + tsb : '' + tsb) : '--';
      stats.innerHTML =
        statHtml(tsbStr, 'Forme', tsb != null ? (tsb >= -10 ? 'ok' : 'warn') : '') +
        statHtml(ctl != null ? '' + ctl : '--', 'Fitness', '') +
        statHtml(atl != null ? '' + atl : '--', 'Fatigue', '') +
        statHtml(rec, 'Recup', (w.recovery != null) ? (w.recovery >= 66 ? 'ok' : (w.recovery <= 33 ? 'warn' : '')) : '');
    }
    const last = document.getElementById('cl-' + id);
    if (last) {
      if (s.name) {
        const d = s.start_date_local ? new Date(s.start_date_local) : null;
        const dStr = d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
        const tss = (s.tss != null) ? (' - ' + Math.round(s.tss) + ' TSS') : '';
        last.textContent = 'Derniere seance : ' + s.name + (dStr ? ' (' + dStr + ')' : '') + tss;
      } else { last.textContent = 'Aucune seance enregistree'; }
    }
  } catch (e) { console.warn('[coach-mode] fillCard', id, e); }
}

function statHtml(val, lbl, kind) {
  return '<div class="coach-stat"><span class="cs-val ' + (kind || '') + '">' + escapeHtml(val) + '</span><span class="cs-lbl">' + lbl + '</span></div>';
}

/* ---- Actions ---- */
// Le lien d'invitation pointe TOUJOURS vers le site en ligne (jamais localhost),
// pour que l'athlete puisse l'ouvrir depuis son propre appareil.
const APP_PUBLIC_URL = 'https://jaberautomations.fr/';
function inviteUrl(linkId) {
  const base = /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname)
    ? APP_PUBLIC_URL
    : (location.origin + location.pathname);
  return base + '?invite=' + linkId;
}

async function copyInvite(linkId, btn) {
  const url = inviteUrl(linkId);
  try { await navigator.clipboard.writeText(url); if (btn) flash(btn, 'Lien copie !'); }
  catch (e) { window.prompt && window.prompt('Copie ce lien d invitation :', url); }
}

async function resendInvite(linkId, email, btn) {
  const ok = await sendInviteEmail(email, inviteUrl(linkId));
  if (btn) flash(btn, ok ? 'Email envoye' : 'Lien copie (email indispo)');
  if (!ok) copyInvite(linkId);
}

async function renameAthlete(id) {
  const cur = _nameById.get(id) || '';
  const name = window.appPrompt ? await window.appPrompt({ title: 'Renommer l athlete', message: 'Surnom (visible par toi seulement) :', value: cur })
                                : window.prompt('Surnom :', cur);
  if (name == null) return;
  const sb = window.sb; if (!sb) return;
  try {
    await sb.from('coach_athlete').update({ coach_label: name.trim() || null })
      .eq('coach_id', _coachUser.id).eq('athlete_id', id);
    loadCards();
  } catch (e) { console.warn('[coach] rename', e); }
}

async function removeAthlete(id, name) {
  const ok = window.appConfirm ? await window.appConfirm({ title: 'Retirer l athlete', message: 'Retirer ' + (name || 'cet athlete') + ' ? Tu n auras plus acces a ses donnees.', confirmLabel: 'Retirer', cancelLabel: 'Annuler' })
                               : window.confirm('Retirer ' + (name || 'cet athlete') + ' ?');
  if (!ok) return;
  const sb = window.sb; if (!sb) return;
  try {
    await sb.from('coach_athlete').delete().eq('coach_id', _coachUser.id).eq('athlete_id', id);
    if (window.coachState && window.coachState.athleteId === id) exitToAthletes();
    loadCards();
  } catch (e) { console.warn('[coach] remove', e); }
}

async function removeLink(linkId) {
  const sb = window.sb; if (!sb) return;
  try { await sb.from('coach_athlete').delete().eq('id', linkId); loadCards(); }
  catch (e) { console.warn('[coach] removeLink', e); }
}

function exitToAthletes() {
  document.body.classList.remove('coach-has-athlete');
  window.coachState = null;
  updateTopIndicator();
  if (window.viewAsAthlete) window.viewAsAthlete(null);
  showAthletesPanel();
}

/* ---- Selection ---- */
async function selectAthlete(id, name) {
  window.coachState = { athleteId: id, athleteName: name };
  if (window.viewAsAthlete) await window.viewAsAthlete(id);
  document.body.classList.add('coach-has-athlete');
  updateTopIndicator();
  document.querySelectorAll('.coach-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
  const t1 = document.querySelector('.tab[data-panel="p1"]'); if (t1) t1.click();
}

/* ---- Indicateur topbar ---- */
function injectTopIndicator() {
  if (document.getElementById('coach-ath-top')) return;
  const topbar = document.querySelector('.topbar'); if (!topbar) return;
  const ind = document.createElement('div'); ind.id = 'coach-ath-top'; ind.className = 'coach-ath-top';
  topbar.appendChild(ind); updateTopIndicator();
}
function updateTopIndicator() {
  const ind = document.getElementById('coach-ath-top'); if (!ind) return;
  if (window.coachState && document.body.classList.contains('coach-has-athlete')) {
    const n = window.coachState.athleteName || 'Athlete';
    ind.innerHTML = '<span class="cat-av">' + escapeHtml((n[0] || 'A').toUpperCase()) + '</span><span class="cat-name">' + escapeHtml(n) + '</span><span class="cat-ro">lecture seule (planif autorisee)</span>';
    ind.classList.add('on');
  } else { ind.innerHTML = ''; ind.classList.remove('on'); }
}
window.applyReadOnlyBanner = updateTopIndicator;

/* ---- Inviter ---- */
async function addAthlete(email) {
  const msg = document.getElementById('coach-add-msg');
  const input = document.getElementById('coach-add-email');
  const val = (email || '').trim();
  if (!val) return;
  showMsg(msg, 'Invitation en cours...', 'info');
  const sb = window.sb || (window.sbReady ? await window.sbReady : null);
  if (!sb) { showMsg(msg, 'Connexion indisponible', 'error'); return; }
  try {
    const { data, error } = await sb.rpc('add_athlete_by_email', { _email: val });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (input) input.value = '';
    if (row && row.link_status === 'active') { showMsg(msg, 'Deja un athlete actif', 'ok'); loadCards(); return; }
    const url = inviteUrl(row.invite_id);
    const sent = await sendInviteEmail(val, url);
    try { await navigator.clipboard.writeText(url); } catch (e) {}
    showMsg(msg, sent ? ('Invitation envoyee a ' + val) : ('Invitation creee. Lien copie (email a configurer)'), 'ok');
    loadCards();
  } catch (e) {
    showMsg(msg, frError((e && (e.message || e.hint)) || 'Echec'), 'error');
  }
}

/* ---- Email (Edge Function Resend) ---- */
async function sendInviteEmail(email, acceptUrl) {
  try {
    const sb = window.sb; if (!sb || !sb.functions) return false;
    const coachName = (_coachUser && (_coachUser.email || '')) || 'Ton coach';
    const { error } = await sb.functions.invoke('send-invite', { body: { email, acceptUrl, coachName } });
    return !error;
  } catch (e) { return false; }
}

/* ---- Acceptation cote athlete ---- */
async function checkInvites() {
  const sb = window.sb || (window.sbReady ? await window.sbReady : null);
  if (!sb) return;
  try {
    const { data, error } = await sb.rpc('my_pending_invites');
    if (error) return; // migration pas encore appliquee
    if (data && data.length) showInviteModal(data);
  } catch (e) {}
}

function showInviteModal(invites) {
  if (document.getElementById('coach-invite-modal')) return;
  const ov = document.createElement('div');
  ov.id = 'coach-invite-modal'; ov.className = 'coach-invite-overlay';
  ov.innerHTML = '<div class="coach-invite-box"><h2>Invitation de coaching</h2><div class="coach-invite-list"></div></div>';
  document.body.appendChild(ov);
  const list = ov.querySelector('.coach-invite-list');
  invites.forEach(inv => {
    const row = document.createElement('div');
    row.className = 'coach-invite-row';
    row.innerHTML =
      '<div class="ci-info"><strong>' + escapeHtml(inv.coach_name || inv.coach_email || 'Un coach') + '</strong>' +
      '<span>souhaite devenir ton coach et acceder a tes donnees.</span></div>' +
      '<div class="ci-actions"><button class="ci-accept" type="button">Accepter</button>' +
      '<button class="ci-refuse" type="button">Refuser</button></div>';
    row.querySelector('.ci-accept').addEventListener('click', () => respondInvite(inv.invite_id, true, row, ov));
    row.querySelector('.ci-refuse').addEventListener('click', () => respondInvite(inv.invite_id, false, row, ov));
    list.appendChild(row);
  });
}

async function respondInvite(inviteId, accept, row, ov) {
  const sb = window.sb; if (!sb) return;
  try {
    await sb.from('coach_athlete')
      .update(accept ? { status: 'active', accepted_at: new Date().toISOString() } : { status: 'revoked' })
      .eq('id', inviteId);
  } catch (e) { console.warn('[coach] respondInvite', e); }
  if (row) row.remove();
  if (ov && !ov.querySelector('.coach-invite-row')) ov.remove();
}

/* ---- Utils ---- */
function frError(m) {
  if (/Aucun compte/i.test(m)) return 'Aucun compte avec cet email';
  if (/vous-meme|meme/i.test(m)) return 'C est votre propre compte';
  if (/Non authentifie/i.test(m)) return 'Reconnecte-toi puis reessaie';
  if (/add_athlete_by_email.* does not exist/i.test(m)) return 'Migration SQL non appliquee';
  return m;
}
function showMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text; el.dataset.kind = kind; el.hidden = false;
  if (kind === 'ok') setTimeout(() => { el.hidden = true; }, 3500);
}
function flash(btn, text) {
  const old = btn.textContent; btn.textContent = text; btn.disabled = true;
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1800);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
