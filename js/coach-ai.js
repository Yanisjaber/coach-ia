/* ============================================================
   js/coach-ai.js — Coach IA (API via edge function `coach-ai` → Gemini)

   1. Analyse de séance : débrief de la dernière sortie (#post-session-stub).
   2. Chat coach (#coach-chat) : conversation + actions sur le calendrier
      (ajouter une séance prévue/réalisée, poser un jour de repos).
   La clé du modèle reste côté serveur ; le front passe le JWT Supabase.
   ============================================================ */

const CAI_CACHE_KEY = 'coach_ia_ai_analysis_v1';
const CAI_CHAT_KEY = 'coach_ia_chat_v1';

function caiToken() {
  if (!window.sb) return Promise.resolve(null);
  return window.sb.auth.getSession().then(({ data }) => data?.session?.access_token || null).catch(() => null);
}
async function caiPost(payload) {
  const cfg = window.SUPABASE_CONFIG;
  const tok = await caiToken();
  if (!cfg || !cfg.url) throw new Error('Configuration Supabase absente.');
  if (!tok) throw new Error('Connecte-toi pour utiliser le coach IA.');
  const res = await fetch(`${cfg.url}/functions/v1/coach-ai`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `Erreur ${res.status}`);
  return data;
}

function caiR(n, d = 0) { return (n == null || isNaN(n)) ? null : Math.round(n * Math.pow(10, d)) / Math.pow(10, d); }
function caiDur(min) {
  min = Math.round(Number(min) || 0);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0');
}
// Mini-rendu markdown (gras + listes + paragraphes)
function caiMd(t) {
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const lines = esc(t).split('\n');
  let html = '', inList = false;
  for (let line of lines) {
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const m = line.match(/^\s*[-•]\s+(.*)/);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; }
    else { if (inList) { html += '</ul>'; inList = false; } if (line.trim()) html += `<p>${line}</p>`; }
  }
  if (inList) html += '</ul>';
  return html;
}

/* ===================== ANALYSE DE SÉANCE ===================== */
function caiLoadCache() { try { return JSON.parse(localStorage.getItem(CAI_CACHE_KEY) || 'null'); } catch { return null; } }
function caiSaveCache(o) { try { localStorage.setItem(CAI_CACHE_KEY, JSON.stringify(o)); } catch {} }

function caiLastSession() {
  const days = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.days) || [];
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.sessionName || (d.activities && d.activities.length)) return d;
  }
  return null;
}
function caiSportLabel(day) {
  const a = (day.activities && day.activities[0]) || { sport: day.sport, raw_type: day.sport };
  return window.activitySportLabel ? window.activitySportLabel(a) : (day.sport || 'Activité');
}
function caiBuildContext(day) {
  const acts = day.activities || [];
  let dist = 0, elev = 0, maxhr = 0, vi = null;
  for (const a of acts) {
    dist += a.distance_km || 0;
    elev += a.elevation_gain || 0;
    if (a.max_hr) maxhr = Math.max(maxhr, a.max_hr);
    if (a.variability_index) vi = a.variability_index;
  }
  const iso = typeof day.date === 'string' ? day.date.slice(0, 10) : new Date(day.date).toISOString().slice(0, 10);
  return {
    nom: day.sessionName || (acts[0] && acts[0].name) || 'Séance',
    sport: caiSportLabel(day), date: iso,
    duree_min: day.duration || null,
    distance_km: dist ? caiR(dist, 1) : null,
    denivele_m: elev ? caiR(elev) : null,
    np_watts: day.np || null, pct_ftp: day.ftpPct || null,
    if: day.intensity ? caiR(day.intensity, 2) : null,
    tss: day.tss || null, fc_moy: day.hr || null, fc_max: maxhr || null,
    variability_index: vi != null ? caiR(vi, 2) : null,
    zones_fc_pct: day.zones_hr || null,
    forme: { ctl: caiR(day.ctl), atl: caiR(day.atl), tsb: caiR(day.tsb) },
    recovery_whoop_pct: day.recovery ?? null,
  };
}
function caiHeader(ctx, btnLabel) {
  const meta = [ctx.date, ctx.duree_min ? caiDur(ctx.duree_min) : null, ctx.distance_km ? ctx.distance_km + ' km' : null, ctx.tss ? ctx.tss + ' TSS' : null].filter(Boolean).join(' · ');
  return `
    <div class="cai-head">
      <div class="cai-sess">
        <div class="cai-sess-name">${ctx.nom}</div>
        <div class="cai-sess-meta">${meta}</div>
      </div>
      <button class="cai-btn" id="cai-run">${btnLabel}</button>
    </div>
    <div class="cai-result" id="cai-result"></div>`;
}
function renderPostSession() {
  const stub = document.getElementById('post-session-stub');
  if (!stub) return;
  const day = caiLastSession();
  if (!day) {
    stub.innerHTML = `<div class="ia-stub-body"><strong>Aucune séance récente</strong>Importe ou ajoute une sortie pour obtenir une analyse.</div>`;
    return;
  }
  const ctx = caiBuildContext(day);
  const cache = caiLoadCache();
  const hasCache = cache && cache.iso === ctx.date && cache.text;
  stub.innerHTML = caiHeader(ctx, hasCache ? 'Relancer l\'analyse' : 'Analyser ma séance');
  const result = stub.querySelector('#cai-result');
  if (hasCache) result.innerHTML = `<div class="cai-text">${caiMd(cache.text)}</div>`;
  stub.querySelector('#cai-run').addEventListener('click', () => runAnalysis(ctx));
}
window.renderPostSession = renderPostSession;

async function runAnalysis(ctx) {
  const stub = document.getElementById('post-session-stub');
  const btn = stub && stub.querySelector('#cai-run');
  const result = stub && stub.querySelector('#cai-result');
  if (!result) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Analyse en cours…'; }
  result.innerHTML = `<div class="cai-loading"><span class="cai-spin"></span> Analyse de ta séance…</div>`;
  try {
    const data = await caiPost({ action: 'analyze-session', context: ctx });
    const text = data.text || '';
    caiSaveCache({ iso: ctx.date, text });
    result.innerHTML = `<div class="cai-text">${caiMd(text)}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = 'Relancer l\'analyse'; }
  } catch (e) {
    result.innerHTML = `<div class="cai-error">${String(e.message).replace(/[<>]/g, '')}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = 'Réessayer'; }
  }
}

/* ===================== CHAT COACH ===================== */
let _chatMsgs = [];
let _chatInited = false;

function chatLoad() { try { return JSON.parse(localStorage.getItem(CAI_CHAT_KEY) || '[]'); } catch { return []; } }
function chatSave() { try { localStorage.setItem(CAI_CHAT_KEY, JSON.stringify(_chatMsgs.slice(-40))); } catch {} }

function bubbleHtml(role, text) { return `<div class="chat-b ${role === 'user' ? 'me' : 'ai'}">${caiMd(text)}</div>`; }
function paintChat() {
  const box = document.getElementById('chat-msgs');
  if (!box) return;
  box.innerHTML = _chatMsgs.map(m => bubbleHtml(m.role, m.text)).join('');
  box.scrollTop = box.scrollHeight;
}
function appendBubble(role, text, store = true) {
  if (store) { _chatMsgs.push({ role, text }); chatSave(); }
  const box = document.getElementById('chat-msgs');
  if (box) { box.insertAdjacentHTML('beforeend', bubbleHtml(role, text)); box.scrollTop = box.scrollHeight; }
}

function renderChat() {
  const root = document.getElementById('coach-chat');
  if (!root || _chatInited) return; // idempotent : ne réinitialise pas la conversation
  _chatInited = true;
  _chatMsgs = chatLoad();
  root.innerHTML = `
    <div class="chat-msgs" id="chat-msgs"></div>
    <div class="chat-input">
      <input type="text" id="chat-text" placeholder="Un conseil, ou « ajoute une séance de seuil mardi »…" autocomplete="off">
      <button id="chat-send" title="Envoyer" aria-label="Envoyer">➤</button>
      <button id="chat-clear" title="Effacer la conversation" aria-label="Effacer">✕</button>
    </div>`;
  const input = root.querySelector('#chat-text');
  const doSend = () => sendChat(input.value.trim(), input);
  root.querySelector('#chat-send').addEventListener('click', doSend);
  root.querySelector('#chat-clear').addEventListener('click', () => {
    _chatMsgs = []; chatSave(); paintChat();
    appendBubble('assistant', 'Conversation effacée. Comment puis-je t\'aider ?', false);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  paintChat();
  if (!_chatMsgs.length) {
    appendBubble('assistant', "Salut ! Je suis ton coach. Pose-moi une question, demande une analyse, ou dis-moi par ex. « ajoute une sortie endurance 2h dimanche ».", false);
  }
}
window.renderChat = renderChat;
window.renderPlanStub = renderChat; // compat hooks de re-render

async function sendChat(text, input) {
  if (!text) return;
  if (input) input.value = '';
  appendBubble('user', text);
  const box = document.getElementById('chat-msgs');
  if (box) { box.insertAdjacentHTML('beforeend', `<div class="chat-b ai" id="chat-loading"><span class="cai-spin"></span></div>`); box.scrollTop = box.scrollHeight; }
  try {
    const ctx = window.coachGetPlanContext ? window.coachGetPlanContext() : {};
    const data = await caiPost({ action: 'chat', context: ctx, messages: _chatMsgs.map(m => ({ role: m.role, text: m.text })) });
    document.getElementById('chat-loading')?.remove();
    appendBubble('assistant', data.reply || '…');
    const done = applyChatActions(data.actions || []);
    if (done.length) appendBubble('assistant', '✅ Ajouté au calendrier : ' + done.join(', '), false);
  } catch (e) {
    document.getElementById('chat-loading')?.remove();
    appendBubble('assistant', '⚠️ ' + String(e.message), false);
  }
}

function applyChatActions(actions) {
  const done = [];
  for (const a of actions) {
    if (!a || !a.date) continue;
    if (a.type === 'add_rest') {
      if (window.addTemplateRestDay) { window.addTemplateRestDay(a.date); done.push('repos ' + a.date); }
    } else if (a.type === 'add_session') {
      if (window.coachInsertTemplate) {
        window.coachInsertTemplate(a.date, {
          name: a.name || 'Séance', sport: a.sport || 'cyclisme', type: a.sessionType,
          duration_min: a.duration_min, tss: a.tss, description: a.description,
        }, a.mode === 'realise' ? 'realise' : 'prevu');
        done.push((a.name || 'séance') + ' ' + a.date);
      }
    }
  }
  if (done.length && window.renderCalendar) window.renderCalendar();
  return done;
}

/* ===================== STYLES + INIT ===================== */
function caiInjectStyles() {
  if (document.getElementById('cai-styles')) return;
  const s = document.createElement('style');
  s.id = 'cai-styles';
  s.textContent = `
    #post-session-stub, #coach-chat { display: block; }
    .cai-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .cai-sess-name { font-size: 15px; font-weight: 600; color: var(--text); }
    .cai-sess-meta { font-size: 12px; color: var(--text-mute); margin-top: 2px; }
    .cai-btn { background: var(--accent); color: #06231a; border: none; border-radius: 9px;
      padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; transition: filter .15s; }
    .cai-btn:hover { filter: brightness(1.06); }
    .cai-btn:disabled { opacity: .6; cursor: default; }
    .cai-result { margin-top: 14px; }
    .cai-result:empty { margin-top: 0; }
    .cai-text { font-size: 13.5px; line-height: 1.6; color: var(--text); }
    .cai-text p { margin: 0 0 9px; }
    .cai-text ul { margin: 0 0 9px; padding-left: 18px; }
    .cai-text li { margin: 3px 0; }
    .cai-loading { display: flex; align-items: center; gap: 9px; color: var(--text-dim); font-size: 13px; }
    .cai-spin { width: 15px; height: 15px; border: 2px solid var(--bg-elev2); border-top-color: var(--accent);
      border-radius: 50%; animation: caiSpin .7s linear infinite; display: inline-block; }
    @keyframes caiSpin { to { transform: rotate(360deg); } }
    .cai-error { color: var(--danger); font-size: 13px; }

    /* Chat */
    .chat-msgs { display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow-y: auto; padding: 4px 2px 8px; }
    .chat-b { max-width: 82%; padding: 9px 13px; border-radius: 13px; font-size: 13.5px; line-height: 1.5; }
    .chat-b p { margin: 0 0 6px; } .chat-b p:last-child { margin: 0; }
    .chat-b ul { margin: 4px 0; padding-left: 18px; } .chat-b li { margin: 2px 0; }
    .chat-b.ai { align-self: flex-start; background: var(--bg-elev2); border: 1px solid var(--border); color: var(--text); border-bottom-left-radius: 4px; }
    .chat-b.me { align-self: flex-end; background: rgba(74,222,128,0.16); border: 1px solid rgba(74,222,128,0.3); color: var(--text); border-bottom-right-radius: 4px; }
    .chat-input { display: flex; gap: 8px; margin-top: 12px; }
    .chat-input input { flex: 1; min-width: 0; background: var(--bg-elev2); border: 1px solid var(--border);
      color: var(--text); border-radius: 10px; height: 40px; padding: 0 13px; font-size: 14px; font-family: inherit; }
    .chat-input input:focus { outline: none; border-color: var(--accent); }
    .chat-input button { flex: none; width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--border);
      background: var(--bg-elev2); color: var(--text-dim); font-size: 15px; cursor: pointer; }
    #chat-send { background: var(--accent); color: #06231a; border-color: transparent; font-weight: 700; }
    #chat-send:hover { filter: brightness(1.06); }
    #chat-clear:hover { color: var(--danger); border-color: rgba(248,113,113,0.4); }
  `;
  document.head.appendChild(s);
}

function caiInit() { caiInjectStyles(); renderPostSession(); renderChat(); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', caiInit);
} else {
  caiInit();
}
window.addEventListener('coach-ia-auth', (e) => {
  if (e.detail && e.detail.user) { renderPostSession(); renderChat(); }
});
