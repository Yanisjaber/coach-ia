/* ============================================================
   js/coach-athlete-page.js - Onglet Messagerie (chat coach<->athlete)
   Le panneau + l'onglet sont crees ici. L'athlete courant vient de
   window.coachState.athleteId (defini par coach-mode.js).
   ============================================================ */

let _athUser = null;
let _chatTimer = null;
let _navWired = false;

async function meId() {
  if (_athUser) return _athUser;
  const u = window.sbCurrentUser ? await window.sbCurrentUser() : null;
  _athUser = u ? u.id : null;
  return _athUser;
}

window.coachEnsureChat = function () {
  if (document.getElementById('p-chat')) { wireNavOnce(); return; }
  const container = document.querySelector('.container');
  const nav = document.querySelector('.sidebar-nav');
  if (!container || !nav) return;

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'p-chat';
  panel.innerHTML = [
    '<div class="chat-wrap">',
    '  <div id="chat-list" class="chat-list"></div>',
    '  <div class="chat-input-row">',
    '    <input id="chat-input" class="chat-input" type="text" placeholder="Ecrire un message..." autocomplete="off">',
    '    <button id="chat-send" class="chat-send" type="button">Envoyer</button>',
    '  </div>',
    '</div>'
  ].join('');
  container.appendChild(panel);

  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.panel = 'p-chat';
  tab.id = 'coach-chat-tab';
  tab.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
    '<span>Messagerie</span>';
  tab.addEventListener('click', showChat);
  nav.appendChild(tab);

  panel.querySelector('#chat-send').addEventListener('click', sendChat);
  panel.querySelector('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  wireNavOnce();
};

function wireNavOnce() {
  if (_navWired) return;
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab && tab.dataset.panel !== 'p-chat') stopChatPolling();
  });
  _navWired = true;
}

function athId() { return window.coachState ? window.coachState.athleteId : null; }

function showChat() {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const tab = document.getElementById('coach-chat-tab');
  const panel = document.getElementById('p-chat');
  if (tab) tab.classList.add('active');
  if (panel) panel.classList.add('active');
  const title = document.getElementById('topbar-title'); if (title) title.textContent = 'Messagerie';
  loadChat();
  startChatPolling();
}

async function loadChat() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  const id = athId();
  const sb = window.sb || (window.sbReady ? await window.sbReady : null);
  if (!sb || !id) { list.innerHTML = '<div class="chat-empty">Selectionne un athlete</div>'; return; }
  const me = await meId();
  try {
    const { data, error } = await sb.from('messages')
      .select('id, author_id, body, created_at')
      .eq('athlete_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!data || !data.length) { list.innerHTML = '<div class="chat-empty">Aucun message. Ecris le premier !</div>'; return; }
    const atBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 60;
    list.innerHTML = data.map(m => {
      const mine = m.author_id === me;
      const t = new Date(m.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return '<div class="chat-msg ' + (mine ? 'mine' : 'theirs') + '"><div class="chat-bubble">' +
             escapeHtml(m.body) + '</div><div class="chat-time">' + t + '</div></div>';
    }).join('');
    if (atBottom) list.scrollTop = list.scrollHeight;
  } catch (e) {
    list.innerHTML = '<div class="chat-empty">Erreur (migration messages appliquee ?)</div>';
  }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const body = input.value.trim();
  const id = athId();
  if (!body || !id) return;
  const sb = window.sb || (window.sbReady ? await window.sbReady : null);
  const me = await meId();
  if (!sb || !me) return;
  input.value = '';
  try {
    const { error } = await sb.from('messages').insert({ athlete_id: id, author_id: me, body });
    if (error) throw error;
    await loadChat();
    const list = document.getElementById('chat-list'); if (list) list.scrollTop = list.scrollHeight;
  } catch (e) { input.value = body; console.warn('[chat] envoi', e); }
}

function startChatPolling() { stopChatPolling(); _chatTimer = setInterval(loadChat, 6000); }
function stopChatPolling() { if (_chatTimer) { clearInterval(_chatTimer); _chatTimer = null; } }
window.coachStopChat = stopChatPolling;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
