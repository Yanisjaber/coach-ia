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
  // L'IA ne peut agir QUE sur le futur, et UNIQUEMENT en "prévu" (jamais sur une
  // activité passée / réalisée). Garde-fou en plus du prompt.
  const todayIso = new Date().toISOString().slice(0, 10);
  const done = [];
  let blockedPast = false;
  for (const a of actions) {
    if (!a || !a.date) continue;
    if (a.date < todayIso) { blockedPast = true; continue; } // jamais d'action sur le passé
    if (a.type === 'add_rest') {
      if (window.addTemplateRestDay) { window.addTemplateRestDay(a.date, true); done.push('repos ' + a.date); }
    } else if (a.type === 'add_session') {
      if (window.coachInsertTemplate) {
        window.coachInsertTemplate(a.date, {
          name: a.name || 'Séance', sport: a.sport || 'cyclisme', type: a.sessionType,
          duration_min: a.duration_min, tss: a.tss, description: a.description,
        }, 'prevu', true); // PRÉVU + créé par l'IA (created_by_ia=true)
        done.push((a.name || 'séance') + ' ' + a.date);
      }
    }
  }
  if (blockedPast) appendBubble('assistant', 'ℹ️ Je ne peux modifier que des séances à venir, pas le passé.', false);
  if (done.length && window.renderCalendar) window.renderCalendar();
  return done;
}

/* ===================== RÉSUMÉ DE FORME (calculé, sans API) ===================== */
function caiFormText(tsb) {
  if (tsb == null) return { t: '—', c: 'var(--text-mute)' };
  if (tsb >= 10) return { t: 'très frais', c: 'var(--accent)' };
  if (tsb >= 0) return { t: 'frais', c: 'var(--accent)' };
  if (tsb >= -10) return { t: 'équilibré', c: 'var(--warn)' };
  if (tsb >= -20) return { t: 'fatigué', c: 'var(--warn)' };
  return { t: 'très fatigué', c: 'var(--danger)' };
}
function renderFormSummary() {
  const wrap = document.getElementById('ia-form-summary');
  if (!wrap) return;
  const ctx = window.coachGetPlanContext ? window.coachGetPlanContext() : null;
  if (!ctx) { wrap.innerHTML = ''; return; }
  const f = ctx.forme || {};
  const form = caiFormText(f.tsb);
  const comp = ctx.competition;
  const vol = ctx.volume_recent || {};
  wrap.innerHTML = `
    <div class="grid-1 card ia-form-card">
      <div class="ia-form-head">
        <div class="section-title" style="margin-bottom:0;">Ton état de forme</div>
        <span class="ia-form-tag" style="color:${form.c};background:color-mix(in srgb, ${form.c} 16%, transparent);">${f.tsb == null ? '—' : (f.tsb >= 0 ? '+' : '') + f.tsb} · ${form.t}</span>
      </div>
      <div class="ia-form-grid">
        <div class="ia-form-stat"><div class="ia-form-v">${f.ctl == null ? '—' : f.ctl}</div><div class="ia-form-k">CTL · forme</div></div>
        <div class="ia-form-stat"><div class="ia-form-v">${f.atl == null ? '—' : f.atl}</div><div class="ia-form-k">ATL · fatigue</div></div>
        <div class="ia-form-stat"><div class="ia-form-v" style="color:${form.c};">${f.tsb == null ? '—' : (f.tsb >= 0 ? '+' : '') + f.tsb}</div><div class="ia-form-k">TSB · fraîcheur</div></div>
        <div class="ia-form-stat"><div class="ia-form-v">${vol.heures_par_semaine ?? '—'}<span class="ia-form-u">h/sem</span></div><div class="ia-form-k">Volume récent</div></div>
      </div>
      <div class="ia-form-foot">${comp ? `Prochain objectif : <strong>${(comp.nom || '').replace(/[<>]/g, '')}</strong> · J‑${comp.joursAvant}` : 'Aucune compétition à venir — ajoute un objectif pour orienter ta prépa.'}</div>
    </div>`;
}
window.renderFormSummary = renderFormSummary;

/* ===================== BILAN COUREUR (IA, onglet Accueil) ===================== */
const CAI_HOME_KEY = 'coach_ia_home_report_v5';

// Données prêtes ? (profil de puissance OU activités chargées)
function caiHasData() {
  const d = window.DASHBOARD_DATA || {};
  const pbs = d.power_by_sport || {};
  const anyPower = Object.values(pbs).some(s => s && s.durations && Object.keys(s.durations).length >= 3);
  const anyAct = (d.days || []).some(day => day.activities && day.activities.length);
  return anyPower || anyAct;
}

// Toutes les stats analysables, calculées depuis les sorties (sans IA).
function caiStats() {
  const d = window.DASHBOARD_DATA || {};
  const days = d.days || [];
  const yr = new Date().getFullYear();
  let km = 0, min = 0, dplus = 0, tss = 0, sess = 0;
  const z = [0, 0, 0, 0, 0]; let zMin = 0;
  for (const day of days) {
    const dt = typeof day.date === 'string' ? new Date(day.date + 'T12:00:00') : new Date(day.date);
    if (dt.getFullYear() !== yr) continue;
    const acts = day.activities || [];
    if (acts.length || day.sessionName) sess++;
    for (const a of acts) { km += a.distance_km || 0; dplus += a.elevation_gain || 0; }
    min += day.duration || 0; tss += day.tss || 0;
    const zones = day.zones_hr || day.zones_power;
    if (Array.isArray(zones) && zones.length >= 5 && day.duration) { for (let i = 0; i < 5; i++) z[i] += (zones[i] || 0) * day.duration; zMin += day.duration; }
  }
  const last = days[days.length - 1] || {};
  const ctl = Number.isFinite(last.ctl) ? Math.round(last.ctl) : null;
  const atl = Number.isFinite(last.atl) ? Math.round(last.atl) : null;
  const tsb = Number.isFinite(last.tsb) ? Math.round(last.tsb) : null;
  let ramp = null;
  if (ctl != null && days.length > 28) { const prev = days[days.length - 29]; if (prev && Number.isFinite(prev.ctl)) ramp = Math.round(((last.ctl - prev.ctl) / 4) * 10) / 10; }
  let pol = null;
  if (zMin > 0) { const t = z.reduce((s, v) => s + v, 0) || 1; pol = { z12: Math.round((z[0] + z[1]) / t * 100), z3: Math.round(z[2] / t * 100), z45: Math.round((z[3] + z[4]) / t * 100) }; }
  // Régularité (28 j) + plus longue série (60 j)
  const from = new Date(); from.setDate(from.getDate() - 28);
  const dayActive = {}; let recentSess = 0; const activeWeeks = new Set();
  for (const day of days) {
    const dt = typeof day.date === 'string' ? new Date(day.date + 'T12:00:00') : new Date(day.date);
    const iso = dt.toISOString().slice(0, 10);
    const has = (day.activities && day.activities.length) || day.sessionName;
    if (has) dayActive[iso] = true;
    if (dt >= from && has) { recentSess++; activeWeeks.add(Math.floor((dt - from) / (7 * 86400000))); }
  }
  let streak = 0, cur = 0;
  for (let i = 0; i < 60; i++) { const dd = new Date(); dd.setDate(dd.getDate() - i); if (dayActive[dd.toISOString().slice(0, 10)]) { cur++; if (cur > streak) streak = cur; } else cur = 0; }
  const pbs = d.power_by_sport || {}; const cyc = pbs.cyclisme || pbs[Object.keys(pbs)[0]] || {}; const durs = cyc.durations || {};
  const _cp = caiCPModel();
  const ftp = (_cp && _cp.eftp) || cyc.ftp || (durs['20min'] ? Math.round(durs['20min'] * 0.95) : null);
  const weight = cyc.weight || ((d.athlete && d.athlete.weight) || null);
  return {
    yr, km: Math.round(km), h: Math.round(min / 60), dplus: Math.round(dplus), tss: Math.round(tss), sess,
    ctl, atl, tsb, ramp, pol,
    regular: { perWeek: Math.round((recentSess / 4) * 10) / 10, activePct: Math.round((activeWeeks.size / 4) * 100), streak },
    ftp, weight, durs,
  };
}

function caiHomeContext() {
  const base = window.coachGetPlanContext ? window.coachGetPlanContext() : {};
  const st = caiStats();
  const d = window.DASHBOARD_DATA || {};
  const pbs = d.power_by_sport || {};
  const cyc = pbs.cyclisme || pbs[Object.keys(pbs)[0]] || {};
  const durs = cyc.durations || {};
  const KEYS = ['5s', '15s', '30s', '1min', '2min', '5min', '10min', '20min', '30min', '1h'];
  const watts = {};
  KEYS.forEach(k => { if (durs[k] != null) watts[k] = Math.round(durs[k]); });
  const _cpm = caiCPModel();
  const ftp = (_cpm && _cpm.eftp) || cyc.ftp || (durs['20min'] ? Math.round(durs['20min'] * 0.95) : (durs['1h'] ? Math.round(durs['1h']) : null));
  const _ath = d.athlete || {};
  const weight = cyc.weight || _ath.weight || null;
  const ratios = {}, wkg = {};
  KEYS.forEach(k => {
    if (watts[k] == null) return;
    if (ftp) ratios[k] = Math.round((watts[k] / ftp) * 100) / 100;
    if (weight) wkg[k] = Math.round((watts[k] / weight) * 10) / 10;
  });
  // Records de volume (toutes activités)
  const days = d.days || [];
  let maxDist = 0, maxTss = 0, maxDur = 0, nAct = 0;
  for (const day of days) {
    const acts = day.activities || [];
    nAct += acts.length;
    for (const a of acts) { if ((a.distance_km || 0) > maxDist) maxDist = a.distance_km; if ((a.duration || 0) > maxDur) maxDur = a.duration; }
    if ((day.tss || 0) > maxTss) maxTss = day.tss;
  }
  const recent = [];
  for (let i = days.length - 1; i >= 0 && recent.length < 8; i--) {
    const day = days[i];
    const a = day.activities && day.activities[0];
    if (a) recent.push({ date: (typeof day.date === 'string' ? day.date.slice(0, 10) : ''), sport: a.sport, tss: day.tss || 0, duree_min: day.duration || 0, np: day.np || null, if: day.intensity || null });
  }
  return {
    ...base,
    athlete: { sexe: _ath.sex || null, age: _ath.age || null, poids_kg: weight || null },
    profil_puissance: {
      ftp_estime_watts: ftp,
      cp_modele_watts: _cpm ? _cpm.cp : null,   // Critical Power (régression courbe MMP)
      w_prime_j: _cpm ? _cpm.wprime : null,     // capacité anaérobie (W′)
      poids_kg: weight,
      wkg_ftp: (ftp && weight) ? Math.round((ftp / weight) * 10) / 10 : null,
      puissance_max_watts: watts,            // records de puissance par durée (5s → 1h)
      ratios_vs_ftp: ftp ? ratios : null,    // pour déterminer le type de coureur
      wkg_par_duree: weight ? wkg : null,
      nb_activites_avec_puissance: cyc.activities_count || null,
    },
    durabilite: (() => {
      const du = cyc.details && cyc.details.durability;
      if (!du) return null;
      return {
        seuil_secondes: du.after_sec,                          // après 2 h 30
        ratio_20min: du.ratio_20min, ratio_5min: du.ratio_5min, // part des watts conservée
        watts_20min_tardif: du.late_20min, watts_20min_frais: du.fresh_20min,
        nb_sorties_longues: du.n_long,
      };
    })(),
    records_volume: { plus_longue_km: Math.round(maxDist) || null, plus_longue_duree_min: maxDur || null, plus_gros_tss: Math.round(maxTss) || null },
    nb_activites_total: nAct || null,
    seances_recentes: recent,
    entrainement_saison: {
      annee: st.yr, distance_km: st.km, heures: st.h, denivele_m: st.dplus, tss_cumule: st.tss, nb_seances: st.sess,
      ramp_ctl_par_sem: st.ramp,
      polarisation_zones_pct: st.pol,            // % temps Z1-2 / Z3 / Z4-5
      regularite: st.regular,                    // séances/sem, % semaines actives, série
    },
  };
}

function renderHomeReport() {
  const stub = document.getElementById('ia-home-report');
  if (!stub) return;
  const todayIso = new Date().toISOString().slice(0, 10);
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(CAI_HOME_KEY) || 'null'); } catch {}
  // Cache valide = nouveau format (type_label) ET généré aujourd'hui.
  const fresh = cache && cache.report && cache.report.type_label && cache.iso === todayIso;
  if (fresh) { paintHomeReport(stub, cache.report); return; }
  // Pas de bilan frais → on affiche tout de suite un aperçu (réel si dispo, sinon démo),
  // puis l'IA enrichit en arrière-plan quand les données sont chargées (mode IA).
  paintHomeReport(stub, (cache && cache.report) || {});
  if (window.APP_MODE === 'ia' && !_homeBusy && caiHasData()) runHomeReport();
}
window.renderHomeReport = renderHomeReport;

// Radar du profil de puissance (ratios puissance/FTP par durée → score 0-100)
// Barèmes W/kg de référence (inspirés des tables Coggan) : [débutant ≈ 0, élite mondiale ≈ 100].
const CAI_BENCH = {
  M: { '5s': [8, 23], '1min': [5, 11.5], '5min': [2.8, 7.6], '20min': [2.3, 6.4], '1h': [2.1, 6.0] },
  F: { '5s': [7, 19.5], '1min': [4, 9.3], '5min': [2.3, 6.6], '20min': [1.9, 5.7], '1h': [1.8, 5.4] },
};
// Correction d'âge (masters) : on « age-grade » la W/kg pour comparer à l'open.
function caiAgeFactor(age) {
  if (!age || age <= 34) return 1;
  return Math.max(0.78, 1 - 0.007 * (age - 34)); // ~0,7 %/an de déclin après 34 ans
}
// Infos athlète (poids, sexe, âge) depuis le dataset.
function caiAthlete() {
  const a = (window.DASHBOARD_DATA || {}).athlete || {};
  return { weight: a.weight || null, sex: a.sex === 'F' ? 'F' : 'M', age: a.age || null };
}
// Fenêtre du profil : 'current' (90 j, forme du moment) ou 'career' (record carrière).
let _caiProfileWindow = 'current';

// Radar du profil : chaque axe noté sur une échelle débutant→élite (0-100),
// via barèmes W/kg par sexe + correction d'âge. Sans poids : référence ~70 kg.
function caiRiderRadar() {
  const d = window.DASHBOARD_DATA || {};
  const pbs = d.power_by_sport || {};
  const cyc = pbs.cyclisme || pbs[Object.keys(pbs)[0]] || {};
  const durs = cyc.durations || {};          // records carrière (all-time)
  const details = cyc.details || {};         // details[k].w90 = meilleur 90 j
  const { weight, sex, age } = caiAthlete();
  const bench = CAI_BENCH[sex] || CAI_BENCH.M;
  const ageF = caiAgeFactor(age);
  const kgRef = weight || 70;                 // sans poids → hypothèse 70 kg
  // Valeur d'une durée selon la fenêtre choisie (90 j prioritaire, repli record carrière).
  const g = k => {
    const career = durs[k] != null ? durs[k] : null;
    const recent = details[k] && details[k].w90 != null ? details[k].w90 : null;
    if (_caiProfileWindow === 'career') return career;
    return recent != null ? recent : career;  // 'current' : 90 j sinon repli carrière
  };
  const AX = [
    { k: '5s', label: 'Sprint' },
    { k: '1min', label: 'Anaérobie' },
    { k: '5min', label: 'VO2max' },
    { k: '20min', label: 'Seuil' },
    { k: '1h', label: 'Endurance' },
  ];
  const labels = [], scores = [], vals = [];
  for (const a of AX) {
    const w = g(a.k);
    if (w == null) continue;
    const range = bench[a.k];
    const wkg = w / kgRef;
    const wkgGraded = wkg / ageF;             // age-grading
    const score = (wkgGraded - range[0]) / (range[1] - range[0]);
    labels.push(a.label);
    scores.push(Math.max(3, Math.min(100, Math.round(score * 100))));
    vals.push(weight ? (Math.round(wkg * 10) / 10) + ' W/kg' : Math.round(w) + ' W');
  }
  return labels.length >= 3 ? { labels, scores, vals, hasWeight: !!weight, window: _caiProfileWindow } : null;
}
// Type de coureur dérivé des TERRAINS de prédilection (même source → toujours cohérent).
function caiRiderType(terrains) {
  if (!terrains || !terrains.length) return null;
  const spread = terrains[0].pct - terrains[terrains.length - 1].pct;
  if (spread < 18) return 'Coureur complet';            // profil équilibré
  const top = terrains[0].label, second = terrains[1] ? terrains[1].label : '';
  const isPunch = x => x === 'Mur court' || x === 'Circuit nerveux' || x === 'Bosse VO2';
  if (top === 'Sprint') return isPunch(second) ? 'Sprinteur-puncheur' : 'Sprinteur';
  if (top === 'Mur court' || top === 'Circuit nerveux') return second === 'Sprint' ? 'Puncheur-sprinteur' : 'Puncheur';
  if (top === 'Bosse VO2') return second === 'Col long / CLM' ? 'Grimpeur' : 'Puncheur-grimpeur';
  if (top === 'Col long / CLM') return second === 'Bosse VO2' ? 'Grimpeur' : 'Rouleur';
  if (top === 'Longue distance') return 'Fondeur';
  return 'Coureur complet';
}

// Terrains de prédilection déduits du radar (combinaisons pondérées des axes).
// Le % = NIVEAU ABSOLU sur ce terrain (échelle débutant→élite, comme le radar),
// PAS une affinité normalisée. Comparable à un autre coureur.
function caiTerrains(radar) {
  if (!radar) return null;
  const s = {};
  radar.labels.forEach((l, i) => { s[l] = radar.scores[i]; });
  const g = k => (s[k] != null ? s[k] : 0);
  const defs = [
    { label: 'Sprint', note: 'Emballage massif à plat', w: { Sprint: 0.8, 'Anaérobie': 0.2 } },
    { label: 'Mur court', note: 'Bosses < 2 min, pentes raides', w: { 'Anaérobie': 0.7, Sprint: 0.3 } },
    { label: 'Bosse VO2', note: 'Côtes de 3 à 6 min', w: { 'VO2max': 0.8, 'Anaérobie': 0.2 } },
    { label: 'Col long / CLM', note: 'Efforts soutenus > 15 min', w: { Seuil: 0.7, 'VO2max': 0.3 } },
    { label: 'Circuit nerveux', note: 'Relances répétées, cuvettes', w: { 'Anaérobie': 0.5, 'VO2max': 0.3, Sprint: 0.2 } },
  ];
  // Aptitude brute de chaque terrain = combinaison pondérée des niveaux d'axes.
  const arr = defs.map(d => {
    let v = 0, wsum = 0;
    for (const k in d.w) { v += g(k) * d.w[k]; wsum += d.w[k]; }
    return { label: d.label, note: d.note, raw: wsum ? v / wsum : 0 };
  });

  // Longue distance = DURABILITÉ : capacité à tenir les watts après 2 h 30 (calcul serveur).
  const dur = caiDurability();
  if (dur && dur.ratio != null) {
    const fen = (_caiProfileWindow === 'current' && !dur.recent) ? ' · repli carrière' : '';
    arr.push({
      label: 'Longue distance',
      note: `Garde ${Math.round(dur.ratio * 100)}% de tes watts après 2 h 30 (${dur.nLong} sortie${dur.nLong > 1 ? 's' : ''}${fen})`,
      raw: Math.max(0, Math.min(100, ((dur.ratio - 0.70) / 0.30) * 100)),
    });
  } else {
    arr.push({
      label: 'Longue distance',
      note: 'Durabilité indisponible (aucune sortie > 2 h 30)',
      raw: g('Endurance') * 0.7 + g('Seuil') * 0.3,
    });
  }

  // RELATIF : on normalise pour que ton meilleur terrain = 100 % (affinité, pas niveau absolu).
  const max = Math.max(...arr.map(a => a.raw)) || 1;
  return arr.map(a => ({ label: a.label, note: a.note, pct: Math.round((a.raw / max) * 100) }))
    .sort((a, b) => b.pct - a.pct);
}

// Durabilité depuis le profil serveur : ratio puissance après 2 h 30 / à froid (20 min prioritaire).
// Respecte la fenêtre choisie : 'current' = 90 j (forme actuelle), 'career' = record.
// En mode 90 j, repli sur la carrière si aucune sortie longue récente.
function caiDurability() {
  const d = window.DASHBOARD_DATA || {};
  const pbs = d.power_by_sport || {};
  const cyc = pbs.cyclisme || pbs[Object.keys(pbs)[0]] || {};
  const du = cyc.details && cyc.details.durability;
  if (!du) return null;
  const careerRatio = du.ratio_20min != null ? du.ratio_20min : du.ratio_5min;
  const recentRatio = du.ratio_20min_90 != null ? du.ratio_20min_90 : du.ratio_5min_90;
  if (_caiProfileWindow === 'career') {
    if (careerRatio == null) return null;
    return { ratio: careerRatio, nLong: du.n_long || 0, recent: false };
  }
  // forme actuelle (90 j), repli carrière
  if (recentRatio != null) return { ratio: recentRatio, nLong: du.n_long_90 || 0, recent: true };
  if (careerRatio != null) return { ratio: careerRatio, nLong: du.n_long || 0, recent: false };
  return null;
}

// Niveau : W/kg au FTP positionné sur le barème seuil par sexe (+ correction d'âge).
function caiLevel() {
  const d = window.DASHBOARD_DATA || {};
  const pbs = d.power_by_sport || {};
  const cyc = pbs.cyclisme || pbs[Object.keys(pbs)[0]] || {};
  const cp = caiCPModel();
  const ftp = (cp && cp.eftp) || cyc.ftp || ((cyc.durations || {})['20min'] ? cyc.durations['20min'] * 0.95 : null);
  const { weight, sex, age } = caiAthlete();
  if (!ftp || !weight) return null;
  const wkg = Math.round((ftp / weight) * 10) / 10;
  const range = (CAI_BENCH[sex] || CAI_BENCH.M)['20min'];
  const graded = (ftp / weight) / caiAgeFactor(age);
  const pct = Math.max(0, Math.min(100, Math.round(((graded - range[0]) / (range[1] - range[0])) * 100)));
  return { wkg, pct };
}

// Modèle Critical Power : P(t) = CP + W'/t, ajusté par régression sur la courbe MMP.
// Donne une FTP/seuil (CP) plus robuste que « 20 min × 0,95 » + estimation des durées non testées.
function caiCPModel() {
  const d = window.DASHBOARD_DATA || {};
  const pbs = d.power_by_sport || {};
  const cyc = pbs.cyclisme || pbs[Object.keys(pbs)[0]] || {};
  const durs = cyc.durations || {};
  const details = cyc.details || {};
  const val = k => {
    const career = durs[k] != null ? durs[k] : null;
    const recent = details[k] && details[k].w90 != null ? details[k].w90 : null;
    return _caiProfileWindow === 'career' ? career : (recent != null ? recent : career);
  };
  // Points (durée_s, watts) dans la plage valide du modèle CP (≈ 2 à 20 min).
  const MAP = [[60, '1min'], [300, '5min'], [1200, '20min'], [3600, '1h']];
  const pts = [];
  for (const [t, k] of MAP) { const w = val(k); if (w != null && t >= 120 && t <= 2400) pts.push([t, w]); }
  if (pts.length < 2) return null;
  // Régression linéaire P = CP + W'·(1/t).
  let n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [t, w] of pts) { const x = 1 / t; sx += x; sy += w; sxx += x * x; sxy += x * w; }
  const denom = (n * sxx - sx * sx) || 1;
  const wprime = (n * sxy - sx * sy) / denom;
  const cp = (sy - wprime * sx) / n;
  if (!(cp > 0) || !(wprime > 0)) return null;
  return {
    cp: Math.round(cp),
    wprime: Math.round(wprime),
    eftp: Math.round(cp),                 // FTP ≈ CP (approx.)
    predict: t => Math.round(cp + wprime / t),
    nPoints: n,
    confidence: n >= 3 ? 'élevée' : 'moyenne',
  };
}

let _homeRadar = null;
let _homeTrend = null;
// Évolution FTP + forme (CTL) sur 8 semaines. DÉMO pour l'instant (dérivable des séances hebdo plus tard).
function caiTrend() {
  return {
    labels: ['S-7', 'S-6', 'S-5', 'S-4', 'S-3', 'S-2', 'S-1', 'Cette sem.'],
    ftp: [240, 242, 245, 244, 250, 253, 256, 259],
    ctl: [58, 60, 63, 62, 66, 69, 72, 74],
  };
}

function drawHomeVisuals() {
  const radar = caiRiderRadar();
  const canvas = document.getElementById('ia-radar');
  if (canvas && window.Chart && radar) {
    if (_homeRadar) { try { _homeRadar.destroy(); } catch {} _homeRadar = null; }
    const n = radar.labels.length;
    const eliteRef = new Array(n).fill(85);   // repère « niveau élite »
    _homeRadar = new window.Chart(canvas, {
      type: 'radar',
      data: {
        labels: radar.labels,
        datasets: [
          { label: 'Niveau élite', data: eliteRef, backgroundColor: 'transparent', borderColor: 'rgba(148,163,184,0.45)', borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false },
          { label: 'Toi', data: radar.scores, backgroundColor: 'rgba(74,222,128,0.18)', borderColor: '#4ade80', borderWidth: 2, pointBackgroundColor: '#4ade80', pointRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: 10 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (items) => radar.labels[items[0].dataIndex],
              label: (item) => item.datasetIndex === 1
                ? `${radar.vals[item.dataIndex]} · ${item.raw}/100`
                : `Élite : ${item.raw}/100`,
            },
          },
        },
        scales: {
          r: {
            min: 0, max: 100, beginAtZero: true,
            ticks: { display: false, stepSize: 25 },
            grid: { color: '#232a3a' }, angleLines: { color: '#232a3a' },
            pointLabels: {
              color: '#cbd3e1', font: { size: 11.5, weight: '600' },
              callback: (label, i) => [label, radar.vals[i]],
            },
          },
        },
      },
    });
  }
  const tcv = document.getElementById('ia-trend');
  if (tcv && window.Chart) {
    if (_homeTrend) { try { _homeTrend.destroy(); } catch {} _homeTrend = null; }
    const t = caiTrend();
    _homeTrend = new window.Chart(tcv, {
      type: 'line',
      data: {
        labels: t.labels,
        datasets: [
          { label: 'FTP', data: t.ftp, borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.10)', borderWidth: 2, tension: 0.35, pointRadius: 0, fill: true, yAxisID: 'y' },
          { label: 'Forme', data: t.ctl, borderColor: '#60a5fa', borderWidth: 2, tension: 0.35, pointRadius: 0, borderDash: [4, 3], yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#6b7280', font: { size: 10 } } },
          y: { position: 'left', grid: { color: '#1e2532' }, ticks: { color: '#6b7280', font: { size: 10 } } },
          y1: { position: 'right', grid: { display: false }, ticks: { color: '#6b7280', font: { size: 10 } } },
        },
      },
    });
  }
}

function caiTsbGauge() {
  const ctx = window.coachGetPlanContext ? window.coachGetPlanContext() : null;
  const tsb = ctx && ctx.forme ? ctx.forme.tsb : null;
  if (tsb == null) return null;
  const pct = Math.max(0, Math.min(100, Math.round(((tsb + 30) / 55) * 100))); // -30..+25
  const color = tsb >= 0 ? 'var(--accent)' : (tsb >= -15 ? 'var(--warn)' : 'var(--danger)');
  return { tsb, pct, color };
}

// DEMO : insights bidon pour visualiser le rendu (remplacés par r.insights quand l'IA en renvoie).
const CAI_DEMO_INSIGHTS = [
  { kind: 'force', titre: 'L\'explosivité est ton arme', detail: 'Ta puissance 1 min te situe dans le top 15 % des coureurs à ton FTP. Tu encaisses très bien les efforts courts et répétés.', reco: 'Joue les arrivées en bosse et les relances type criterium.' },
  { kind: 'axe', titre: 'L\'endurance longue te limite', detail: 'Au-delà de 2 h, ta puissance moyenne chute d\'environ 18 % : ta réserve aérobie cède avant tes jambes.', reco: 'Ajoute 1 sortie longue Z2 (3 h+) par semaine pendant 4 semaines.' },
  { kind: 'tendance', titre: 'Ta FTP grimpe régulièrement', detail: '+8 % de FTP estimé en 8 semaines (240 → 259 W). La progression est solide, pas en plateau.', reco: 'Garde 2 blocs de seuil/semaine pour prolonger la hausse.' },
  { kind: 'force', titre: 'Tu récupères vite', detail: 'TSB +19 et régularité élevée : tu absorbes bien la charge actuelle, peu de signes de fatigue.', reco: 'Tu peux encaisser 1 séance intense de plus cette semaine.' },
  { kind: 'risque', titre: 'Montée de charge à surveiller', detail: 'Ta progression de CTL (+6/sem) dépasse la zone sûre (≤ +5). Risque de fatigue si ça continue.', reco: 'Plafonne le volume ou place une semaine de décharge.' },
  { kind: 'tendance', titre: 'Configuration idéale pour Caujac', detail: 'Profil explosif + forme fraîche (J-12) = parfait pour une course nerveuse et vallonnée.', reco: 'Affûtage léger : garde l\'intensité courte, baisse le volume.' },
];
const CAI_INS_META = {
  force: { c: 'var(--accent)', tag: 'Point fort' },
  axe: { c: 'var(--warn)', tag: 'À travailler' },
  tendance: { c: 'var(--info)', tag: 'Tendance' },
  risque: { c: 'var(--danger)', tag: 'Vigilance' },
};

// DÉMO — contenus bidon pour visualiser les nouvelles fonctionnalités IA.
const CAI_DEMO_ALERTS = [
  { level: 'warn', titre: 'Charge en hausse rapide', detail: 'Ta progression de CTL (+6/sem) dépasse la zone sûre. Place une semaine de décharge sous 10 jours.' },
  { level: 'info', titre: 'Trop d\'intensité', detail: '68 % de ton temps en Z4-5 ces 2 dernières semaines : risque de fatigue nerveuse, ta base Z2 est négligée.' },
];
const CAI_DEMO_PREDICTION = {
  objectif: 'Caujac', echeance: 'J-12', type: 'Route vallonnée · ~80 km',
  classement: 'Top 10-15', confiance: 72,
  cible: 'NP 245 W (~3,7 W/kg) sur 2 h',
  scenario: 'Course nerveuse : économise dans les bosses, place-toi pour le sprint d\'un groupe réduit. Ton explosivité fait la différence sur la dernière côte.',
  cles: ['Rester dans les 15 premiers à 5 km de l\'arrivée', 'Bien s\'alimenter avant la dernière bosse', 'Éviter de rouler dans le vent en début de course'],
};
const CAI_DEMO_ARCHETYPES = {
  dominant: 'Puncheur-grimpeur',
  scores: [{ label: 'Puncheur', pct: 88 }, { label: 'Grimpeur', pct: 74 }, { label: 'Sprinteur', pct: 52 }, { label: 'Rouleur', pct: 41 }],
  pro: 'Profil de type explosif sur bosses courtes — proche d\'un coureur de classiques vallonnées.',
};
const CAI_DEMO_PLAN = [
  { titre: 'Bloc endurance — 4 semaines', detail: '1 sortie longue Z2 de 3 h+ par semaine pour relever ta réserve aérobie.', impact: 'Tenue sur les efforts > 2 h' },
  { titre: 'Maintien du seuil', detail: '2 séances de 2×20 min au seuil par semaine pour prolonger la hausse de FTP.', impact: '+3 à 5 % de FTP en 6 sem.' },
  { titre: 'Semaine de décharge', detail: 'Réduis le volume de 40 % en semaine 3 pour absorber la charge accumulée.', impact: 'Évite le surmenage' },
  { titre: 'Affûtage avant Caujac', detail: 'De J-7 à J-1 : garde l\'intensité courte, baisse le volume de moitié.', impact: 'Fraîcheur maximale le jour J' },
];

function homeReportHtml(r) {
  const esc = s => String(s == null ? '' : s).replace(/[<>]/g, '');
  const short = (s, n) => { s = String(s == null ? '' : s).split(/[.\n:]/)[0].trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const niveauL = short(r.niveau_label || r.niveau, 28) || 'Amateur entraîné';
  const formeL = short(r.forme_label, 22) || 'Très frais';
  const radar = caiRiderRadar();
  const hasRadar = !!radar;
  // Terrains, type et lecture dérivent TOUS de la même source (aptitude relative) → cohérents.
  const terrains = caiTerrains(radar);
  const typeL = caiRiderType(terrains) || short(r.type_label || r.type_coureur, 38) || 'Coureur complet';
  const lvl = caiLevel();
  const tsb = caiTsbGauge();
  const st = caiStats();
  // Sécurité anti-pavé : garde les N premières phrases, plafonné en caractères.
  // La ponctuation de fin doit être suivie d'un espace/fin → on ne coupe pas sur les décimales (ex. "0.84").
  const sentences = (s, n, maxChars) => {
    s = String(s == null ? '' : s).trim();
    const parts = s.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || (s ? [s] : []);
    let out = parts.slice(0, n).join(' ').trim() || s;
    if (out.length > maxChars) { out = out.slice(0, maxChars).replace(/\s+\S*$/, '').trim() + '…'; }
    return out;
  };
  const synth = sentences(r.synthese || 'Profil explosif avec une base aérobie correcte. Forme fraîche, idéale pour ton prochain objectif.', 2, 200);
  const insights = (Array.isArray(r.insights) && r.insights.length) ? r.insights : CAI_DEMO_INSIGHTS;

  const insCards = insights.slice(0, 6).map(it => {
    const m = CAI_INS_META[it.kind] || CAI_INS_META.tendance;
    return `<div class="ins" style="--c:${m.c};">
      <div class="ins-tag">${m.tag}</div>
      <div class="ins-titre">${esc(sentences(it.titre, 1, 42))}</div>
      <div class="ins-detail">${esc(sentences(it.detail, 1, 130))}</div>
      ${it.reco ? `<div class="ins-reco">→ ${esc(sentences(it.reco, 1, 85))}</div>` : ''}
    </div>`;
  }).join('');

  // --- Prédiction de course ---
  const p = r.prediction || CAI_DEMO_PREDICTION;
  const conf = Math.max(0, Math.min(100, Number(p.confiance) || 0));
  const predHtml = `<div class="ia-card-blk ia-pred">
    <div class="ia-blk-head"><span class="ia-sec-lbl">Prédiction · prochain objectif</span>${p.echeance ? `<span class="ia-pred-ech">${esc(p.echeance)}</span>` : ''}</div>
    <div class="ia-pred-top">
      <div>
        <div class="ia-pred-obj">${esc(sentences(p.objectif, 1, 40) || '—')}</div>
        <div class="ia-pred-type">${esc(sentences(p.type, 1, 55))}</div>
      </div>
      <div class="ia-pred-rank"><span class="ia-pred-rank-v">${esc(sentences(p.classement, 1, 22) || '—')}</span><span class="ia-pred-rank-k">classement probable</span></div>
    </div>
    <div class="ia-pred-conf"><div class="ia-pred-conf-bar"><span style="width:${conf}%;"></span></div><span class="ia-pred-conf-lbl">Confiance ${conf}%</span></div>
    ${p.gpx_manquant
      ? `<div class="ia-pred-gpx">📍 Ajoute le <b>GPX du parcours</b> (onglet Compétitions) pour une cible de puissance et un scénario adaptés au terrain.</div>`
      : (p.cible ? `<div class="ia-pred-line"><b>Cible</b> ${esc(sentences(p.cible, 1, 60))}</div>` : '')}
    ${p.scenario ? `<div class="ia-pred-line"><b>Scénario</b> ${esc(sentences(p.scenario, 2, 180))}</div>` : ''}
    ${(Array.isArray(p.cles) && p.cles.length) ? `<ul class="ia-pred-keys">${p.cles.slice(0, 4).map(k => `<li>${esc(sentences(k, 1, 70))}</li>`).join('')}</ul>` : ''}
  </div>`;

  // --- Comparaison archétypes ---
  const ar = r.archetypes || CAI_DEMO_ARCHETYPES;
  const arScores = Array.isArray(ar.scores) ? ar.scores : [];
  const archHtml = `<div class="ia-card-blk ia-arch">
    <div class="ia-blk-head"><span class="ia-sec-lbl">Comparaison · archétypes</span>${ar.dominant ? `<span class="ia-arch-dom">${esc(ar.dominant)}</span>` : ''}</div>
    <div class="ia-arch-bars">${arScores.map(s => {
      const pct = Math.max(0, Math.min(100, Number(s.pct) || 0));
      return `<div class="ia-arch-row"><span class="ia-arch-lbl">${esc(s.label)}</span><div class="ia-arch-track"><span style="width:${pct}%;"></span></div><span class="ia-arch-pct">${pct}%</span></div>`;
    }).join('')}</div>
    ${ar.pro ? `<div class="ia-arch-pro">${esc(ar.pro)}</div>` : ''}
  </div>`;

  // --- Plan d'action priorisé ---
  const plan = (Array.isArray(r.action_plan) && r.action_plan.length) ? r.action_plan : CAI_DEMO_PLAN;
  const planHtml = `<div class="ia-card-blk ia-plan-blk">
    <div class="ia-blk-head"><span class="ia-sec-lbl">Plan d'action · prochaines semaines</span></div>
    <div class="ia-plan-steps">${plan.slice(0, 5).map((a, i) => `<div class="ia-plan-step">
      <span class="ia-plan-num">${i + 1}</span>
      <div class="ia-plan-body"><div class="ia-plan-titre">${esc(a.titre)}</div><div class="ia-plan-detail">${esc(a.detail)}</div></div>
      ${a.impact ? `<span class="ia-plan-impact">${esc(a.impact)}</span>` : ''}
    </div>`).join('')}</div>
  </div>`;

  const heroHtml = `<div class="ia-rep-hero">
      <div class="ia-rep-type-card">
        <div class="ia-rep-label">Type de coureur</div>
        <div class="ia-rep-type-val">${esc(typeL)}</div>
      </div>
      <div class="ia-mini">
        <div class="ia-mini-lbl">Niveau${lvl ? ` · ${lvl.wkg} W/kg` : ''}</div>
        ${lvl ? `<div class="ia-level-bar"><div class="ia-level-marker" style="left:${lvl.pct}%;"></div></div>` : ''}
        <div class="ia-mini-val">${esc(niveauL)}</div>
      </div>
    </div>`;

  // === Onglet PROFIL : qui tu es comme coureur ===
  // Lecture DÉRIVÉE des terrains (même source que le type → cohérente).
  let profilRead = `Profil <b>${esc(typeL)}</b>.`;
  if (terrains && terrains.length) {
    const tp = terrains[0], bt = terrains[terrains.length - 1];
    profilRead = `Profil <b>${esc(typeL)}</b>. Ton terrain de prédilection est <b>${esc(tp.label.toLowerCase())}</b> (${tp.pct}%), ta plus grande marge est sur <b>${esc(bt.label.toLowerCase())}</b> (${bt.pct}%).`;
  }
  const terrainsHtml = terrains ? `<div class="ia-card-blk ia-terrains">
      <div class="ia-blk-head"><span class="ia-sec-lbl">Terrains de prédilection</span></div>
      <div class="ia-terr-list">${terrains.map((t, i) => `<div class="ia-terr-row${i === 0 ? ' top' : ''}">
        <div class="ia-terr-info"><span class="ia-terr-lbl">${esc(t.label)}${i === 0 ? ' <span class="ia-terr-badge">ton terrain</span>' : ''}</span><span class="ia-terr-note">${esc(t.note)}</span></div>
        <div class="ia-terr-track"><span style="width:${t.pct}%;"></span></div>
        <span class="ia-terr-pct">${t.pct}%</span>
      </div>`).join('')}</div>
    </div>` : '';

  const win = _caiProfileWindow;
  const profilHtml = `
    ${heroHtml}
    <div class="ia-profil-head">
      <span class="ia-sec-lbl">Profil de puissance & terrains</span>
      <div class="bil-win">
        <button type="button" data-win="current" class="${win === 'current' ? 'active' : ''}">Forme actuelle</button>
        <button type="button" data-win="career" class="${win === 'career' ? 'active' : ''}">Record carrière</button>
      </div>
    </div>
    <div class="ia-profil-grid">
      <div class="ia-profil-card">
        ${hasRadar ? `<div class="ia-rep-radar"><canvas id="ia-radar"></canvas></div>` : ''}
        <div class="ia-profil-read">
          <p>${profilRead}</p>
          ${(() => { const cp = caiCPModel(); return cp ? `<div class="ia-cp"><b>FTP estimée (modèle CP)</b> ${cp.eftp} W · W′ ${Math.round(cp.wprime / 100) / 10} kJ · confiance ${cp.confidence}</div>` : ''; })()}
          ${!hasRadar
            ? `<div class="ia-radar-note">Profil de puissance indisponible : pas assez de données de puissance sur tes sorties. Importe des activités avec capteur/puissance pour l'afficher.</div>`
            : (!radar.hasWeight ? `<div class="ia-radar-note">Profil estimé en watts (réf. ~70 kg). Renseigne ton poids pour un profil précis en W/kg.</div>` : '')}
        </div>
      </div>
      ${terrainsHtml}
    </div>
    <div class="ia-sec-lbl" style="margin:18px 0 10px;">Analyse du coach</div>
    <div class="ins-list">${insCards}</div>`;

  // === Onglet ÉVOLUTION : entraînement, forme, charge ===
  const reg = st.regular || {};
  const pol = st.pol || null;
  const stat = (v, k) => `<div class="ia-evo-stat"><div class="ia-evo-v">${v}</div><div class="ia-evo-k">${k}</div></div>`;
  const evoHtml = `
    <div class="ia-trend-card">
      <div class="ia-trend-head"><span class="ia-sec-lbl">Évolution · 8 dernières semaines</span><span class="ia-trend-leg"><i class="lg-ftp"></i>FTP <i class="lg-ctl"></i>Forme</span></div>
      <div class="ia-trend-canvas"><canvas id="ia-trend"></canvas></div>
    </div>
    <div class="ia-card-blk" style="margin-top:14px;">
      <div class="ia-blk-head"><span class="ia-sec-lbl">Charge & régularité</span></div>
      <div class="ia-evo-stats">
        ${stat(st.ramp != null ? (st.ramp >= 0 ? '+' : '') + st.ramp : '—', 'Ramp CTL /sem')}
        ${stat(reg.perWeek != null ? reg.perWeek : '—', 'Séances /sem')}
        ${stat(reg.streak != null ? reg.streak + ' j' : '—', 'Série en cours')}
        ${stat(reg.activePct != null ? reg.activePct + '%' : '—', 'Semaines actives')}
      </div>
      ${pol ? `<div class="ia-sec-lbl" style="margin:16px 0 8px;">Polarisation (temps par zone)</div>
        <div class="ia-pol-bar"><span style="width:${pol.z12}%;background:#60a5fa;"></span><span style="width:${pol.z3}%;background:#a78bfa;"></span><span style="width:${pol.z45}%;background:#f87171;"></span></div>
        <div class="ia-pol-leg"><span><i style="background:#60a5fa;"></i>Z1-2 · ${pol.z12}%</span><span><i style="background:#a78bfa;"></i>Z3 · ${pol.z3}%</span><span><i style="background:#f87171;"></i>Z4-5 · ${pol.z45}%</span></div>` : ''}
    </div>`;

  // === Onglet PRÉPARATION : compétition à venir ===
  const prepHtml = `
    ${predHtml}
    <div style="margin-top:16px;">${planHtml}</div>`;

  return `
    <div class="bil-tabs">
      <button class="bil-tab active" data-bt="profil" type="button">Profil</button>
      <button class="bil-tab" data-bt="evo" type="button">Évolution</button>
      <button class="bil-tab" data-bt="prep" type="button">Préparation</button>
    </div>
    <div class="bil-panel" data-bp="profil">${profilHtml}</div>
    <div class="bil-panel hidden" data-bp="evo">${evoHtml}</div>
    <div class="bil-panel hidden" data-bp="prep">${prepHtml}</div>`;
}

let _caiLastReport = {};

// Navigation des sous-onglets du bilan + (re)dessin du graphe visible.
function wireBilanTabs(root) {
  const tabs = root.querySelectorAll('.bil-tab');
  const panels = root.querySelectorAll('.bil-panel');
  tabs.forEach(btn => btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-bt');
    tabs.forEach(t => t.classList.toggle('active', t === btn));
    panels.forEach(p => p.classList.toggle('hidden', p.getAttribute('data-bp') !== key));
    setTimeout(drawHomeVisuals, 20); // le canvas devient visible → on (re)dessine à la bonne taille
  }));
  // Bascule fenêtre du profil : 90 j (forme actuelle) vs record carrière.
  root.querySelectorAll('.bil-win button').forEach(btn => btn.addEventListener('click', () => {
    const w = btn.getAttribute('data-win');
    if (w === _caiProfileWindow) return;
    _caiProfileWindow = w;
    const stub = document.getElementById('ia-home-report');
    if (stub) paintHomeReport(stub, _caiLastReport);
  }));
}

// Pose le rapport dans le stub + câble les onglets + dessine les visuels.
function paintHomeReport(stub, report) {
  _caiLastReport = report || {};
  stub.innerHTML = homeReportHtml(report);
  wireBilanTabs(stub);
  setTimeout(drawHomeVisuals, 30);
}

let _homeBusy = false;
async function runHomeReport() {
  if (_homeBusy) return;
  _homeBusy = true;
  const stub = document.getElementById('ia-home-report');
  if (!stub) { _homeBusy = false; return; }
  // On garde l'aperçu déjà affiché pendant la génération (pas de spinner qui efface tout).
  try {
    const data = await caiPost({ action: 'home-report', context: caiHomeContext() });
    const report = data.report || {};
    try { localStorage.setItem(CAI_HOME_KEY, JSON.stringify({ report, iso: new Date().toISOString().slice(0, 10) })); } catch {}
    paintHomeReport(stub, report);
  } catch (e) {
    // Échec (tokens, surcharge…) : on conserve l'aperçu affiché, pas d'erreur bloquante.
    console.warn('[coach-ai] home-report indisponible :', e && e.message);
  } finally {
    _homeBusy = false;
  }
}

/* ===================== RECO DU JOUR (IA) ===================== */
const CAI_RECO_KEY = 'coach_ia_daily_reco_v1';
let _recoBusy = false;
function renderDailyReco() {
  const stub = document.getElementById('daily-reco-stub');
  if (!stub) return;
  const todayIso = new Date().toISOString().slice(0, 10);
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(CAI_RECO_KEY) || 'null'); } catch {}
  if (cache && cache.iso === todayIso && cache.text) { stub.innerHTML = `<div class="cai-text">${caiMd(cache.text)}</div>`; return; }
  stub.innerHTML = `<div class="cai-loading"><span class="cai-spin"></span> Le coach prépare ta reco…</div>`;
  if (window.APP_MODE === 'ia' && !_recoBusy) runDailyReco();
}
window.renderDailyReco = renderDailyReco;

async function runDailyReco() {
  if (_recoBusy) return;
  _recoBusy = true;
  const stub = document.getElementById('daily-reco-stub');
  if (!stub) { _recoBusy = false; return; }
  stub.innerHTML = `<div class="cai-loading"><span class="cai-spin"></span> Le coach prépare ta reco…</div>`;
  try {
    const ctx = window.coachGetPlanContext ? window.coachGetPlanContext() : {};
    const data = await caiPost({ action: 'daily-reco', context: ctx });
    const text = data.text || '';
    try { localStorage.setItem(CAI_RECO_KEY, JSON.stringify({ iso: new Date().toISOString().slice(0, 10), text })); } catch {}
    stub.innerHTML = `<div class="cai-text">${caiMd(text)}</div>`;
  } catch (e) {
    stub.innerHTML = `<div class="cai-error">Reco indisponible (${String(e.message).replace(/[<>]/g, '')}). <a href="#" id="cai-reco-retry">Réessayer</a></div>`;
    stub.querySelector('#cai-reco-retry')?.addEventListener('click', (ev) => { ev.preventDefault(); runDailyReco(); });
  } finally {
    _recoBusy = false;
  }
}

/* ===================== PLANIFICATION (générateur de plan IA) ===================== */
const CAI_PLAN_KEY = 'coach_ia_ai_plan_v1';
const PLAN_SPORT_DOT = { cyclisme: '#3b82f6', vtt: '#b45309', course: '#fc4c02', trail: '#15803d', natation: '#06b6d4', musculation: '#ef4444', autre: '#9ca3af' };
function planCacheGet() { try { return JSON.parse(localStorage.getItem(CAI_PLAN_KEY) || 'null'); } catch { return null; } }
function planCacheSet(o) { try { localStorage.setItem(CAI_PLAN_KEY, JSON.stringify(o)); } catch {} }
function planDow(iso) { try { return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }); } catch { return iso; } }

function renderPlanContent(plan) {
  const wrap = document.getElementById('ia-plan-content');
  if (!wrap) return;
  const weeks = (plan && plan.weeks) || [];
  if (!weeks.length) { wrap.innerHTML = '<div class="cai-error">Plan vide.</div>'; return; }
  const weeksHtml = weeks.map((w, wi) => {
    const sessions = (w.sessions || []).map((s, si) => {
      const isRest = (s.type === 'rest') || (!s.duration_min && !s.tss);
      const color = PLAN_SPORT_DOT[s.sport] || '#9ca3af';
      const meta = [s.duration_min ? caiDur(s.duration_min) : null, s.tss ? s.tss + ' TSS' : null].filter(Boolean).join(' · ');
      return `<div class="cai-pl-sess">
        <span class="cai-pl-dot" style="background:${isRest ? '#3a4253' : color};"></span>
        <div class="cai-pl-main">
          <div class="cai-pl-top"><span class="cai-pl-day">${planDow(s.date)}</span><span class="cai-pl-name">${(s.name || '').replace(/[<>]/g, '')}</span></div>
          ${s.description ? `<div class="cai-pl-desc">${(s.description || '').replace(/[<>]/g, '')}</div>` : ''}
        </div>
        <span class="cai-pl-meta">${isRest ? 'Repos' : meta}</span>
        <button class="cai-pl-add" data-w="${wi}" data-s="${si}" title="Ajouter au calendrier (prévu)">+</button>
      </div>`;
    }).join('');
    return `<div class="cai-pl-week">
      <div class="cai-pl-week-head"><span class="cai-pl-week-label">${(w.label || 'Semaine ' + (wi + 1)).replace(/[<>]/g, '')}</span>${w.focus ? `<span class="cai-pl-week-focus">${(w.focus || '').replace(/[<>]/g, '')}</span>` : ''}</div>
      ${sessions}
    </div>`;
  }).join('');
  wrap.innerHTML = `<div class="cai-pl-actions"><button class="cai-btn" id="cai-pl-addall">Tout ajouter au calendrier</button></div>${weeksHtml}`;
  const addOne = (wi, si) => {
    const s = plan.weeks[wi].sessions[si];
    if ((s.type === 'rest') || (!s.duration_min && !s.tss)) { if (window.addTemplateRestDay) window.addTemplateRestDay(s.date, true); }
    else if (window.coachInsertTemplate) window.coachInsertTemplate(s.date, { name: s.name, sport: s.sport || 'cyclisme', type: s.type, duration_min: s.duration_min, tss: s.tss, description: s.description }, 'prevu', true);
  };
  wrap.querySelectorAll('.cai-pl-add').forEach(b => b.addEventListener('click', () => {
    addOne(+b.dataset.w, +b.dataset.s); b.textContent = '✓'; b.disabled = true; b.classList.add('done');
  }));
  wrap.querySelector('#cai-pl-addall')?.addEventListener('click', (e) => {
    plan.weeks.forEach((w, wi) => (w.sessions || []).forEach((s, si) => addOne(wi, si)));
    wrap.querySelectorAll('.cai-pl-add').forEach(b => { b.textContent = '✓'; b.disabled = true; b.classList.add('done'); });
    e.target.textContent = 'Plan ajouté ✓'; e.target.disabled = true;
  });
}

function renderPlanTab() {
  const root = document.getElementById('ia-plan');
  if (!root) return;
  const ctx = window.coachGetPlanContext ? window.coachGetPlanContext() : null;
  const comp = ctx && ctx.competition;
  if (!comp) {
    root.innerHTML = `<div class="ia-stub-body"><strong>Aucune compétition à venir</strong>Ajoute un objectif (onglet Compétitions) pour générer un plan jusqu'à ta course.</div>`;
    return;
  }
  const cache = planCacheGet();
  const hasCache = cache && cache.compDate === comp.date && cache.plan;
  root.innerHTML = `
    <div class="cai-head">
      <div class="cai-sess"><div class="cai-sess-name">${comp.nom.replace(/[<>]/g, '')}</div><div class="cai-sess-meta">${comp.date} · J‑${comp.joursAvant}</div></div>
      <button class="cai-btn" id="cai-plan-run">${hasCache ? 'Régénérer' : 'Générer mon plan'}</button>
    </div>
    <div class="cai-plan" id="ia-plan-content"></div>`;
  if (hasCache) renderPlanContent(cache.plan);
  root.querySelector('#cai-plan-run').addEventListener('click', () => runPlanTab(ctx, comp));
}
window.renderPlanTab = renderPlanTab;

async function runPlanTab(ctx, comp) {
  const root = document.getElementById('ia-plan');
  const btn = root && root.querySelector('#cai-plan-run');
  const wrap = root && root.querySelector('#ia-plan-content');
  if (!wrap) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
  wrap.innerHTML = `<div class="cai-loading"><span class="cai-spin"></span> Le coach construit ton plan…</div>`;
  try {
    const data = await caiPost({ action: 'generate-plan', context: ctx });
    const plan = data.plan;
    planCacheSet({ compDate: comp.date, plan });
    renderPlanContent(plan);
    if (btn) { btn.disabled = false; btn.textContent = 'Régénérer'; }
  } catch (e) {
    wrap.innerHTML = `<div class="cai-error">${String(e.message).replace(/[<>]/g, '')}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = 'Réessayer'; }
  }
}

/* ===================== SOUS-ONGLETS IA ===================== */
function wireIaSubtabs() {
  const bar = document.getElementById('ia-subtabs');
  if (!bar || bar._wired) return;
  bar._wired = true;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('.ia-subtab');
    if (!b) return;
    const tab = b.dataset.iatab;
    bar.querySelectorAll('.ia-subtab').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('#p7 .ia-subpanel').forEach(p => { p.hidden = p.dataset.iapanel !== tab; });
  });
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

    /* Résumé de forme */
    .ia-form-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .ia-form-tag { font-size: 12px; font-weight: 700; padding: 4px 11px; border-radius: 999px; white-space: nowrap; }
    .ia-form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    @media (max-width: 640px) { .ia-form-grid { grid-template-columns: repeat(2, 1fr); } }
    .ia-form-stat { background: var(--bg-elev2); border-radius: 10px; padding: 11px 12px; text-align: center; }
    .ia-form-v { font-size: 22px; font-weight: 700; color: var(--text); line-height: 1; }
    .ia-form-u { font-size: 12px; color: var(--text-mute); margin-left: 2px; }
    .ia-form-k { font-size: 9px; color: var(--text-mute); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 5px; }
    .ia-form-foot { font-size: 12px; color: var(--text-dim); margin-top: 13px; }

    /* Bilan coureur — analyse & déductions */
    /* #ia-home-report porte la classe .ia-stub (flex, bordure pointillée) prévue pour un placeholder.
       Quand il contient le rapport complet, on repasse en flux bloc normal et on retire le chrome du stub. */
    #ia-home-report { display: block; padding: 0; border: none; background: none; }
    .ia-rep-hero { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0 14px; }
    @media (max-width: 760px) { .ia-rep-hero { grid-template-columns: 1fr; } }
    .ia-sec-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-mute); font-weight: 600; }
    .ia-bilan { display: grid; grid-template-columns: 0.82fr 1.18fr; gap: 16px; align-items: stretch; }
    @media (max-width: 900px) { .ia-bilan { grid-template-columns: 1fr; } }
    .ia-col-left, .ia-col-right { display: flex; flex-direction: column; gap: 14px; }
    .ia-verdict { display: flex; align-items: center; gap: 16px; background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; }
    @media (max-width: 600px) { .ia-verdict { flex-direction: column; text-align: center; } }
    .ia-verdict-txt { font-size: 14.5px; line-height: 1.55; color: var(--text); font-weight: 500; }
    .ia-verdict-txt .ia-rep-label { display: block; margin-bottom: 6px; }
    .ia-radar-note { font-size: 11px; color: var(--text-mute); margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--border); line-height: 1.45; }
    .ia-cp { font-size: 12px; color: var(--text-dim); margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--border); }
    .ia-cp b { color: var(--text); font-weight: 700; }
    .ia-trend-card { background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; flex: 1; display: flex; flex-direction: column; }
    .ia-trend-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .ia-trend-leg { font-size: 11px; color: var(--text-mute); display: flex; align-items: center; gap: 6px; }
    .ia-trend-leg i { display: inline-block; width: 14px; height: 0; border-top: 2px solid; margin-left: 8px; }
    .ia-trend-leg i.lg-ftp { border-color: #4ade80; }
    .ia-trend-leg i.lg-ctl { border-top-style: dashed; border-color: #60a5fa; }
    .ia-trend-canvas { position: relative; flex: 1; min-height: 210px; }
    .ins-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; align-content: start; }
    /* Sous-onglets internes du bilan */
    .bil-tabs { display: inline-flex; gap: 4px; background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 11px; padding: 4px; margin-bottom: 16px; }
    .bil-tab { border: none; background: transparent; color: var(--text-dim); font-family: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: background .15s, color .15s; }
    .bil-tab:hover { color: var(--text); }
    .bil-tab.active { background: var(--accent); color: #06231a; }
    .bil-panel.hidden { display: none; }
    /* Évolution — stats charge/régularité */
    .ia-evo-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    @media (max-width: 600px) { .ia-evo-stats { grid-template-columns: repeat(2, 1fr); } }
    .ia-evo-stat { background: var(--bg); border-radius: 10px; padding: 12px 10px; text-align: center; }
    .ia-evo-v { font-size: 20px; font-weight: 800; color: var(--text); line-height: 1; }
    .ia-evo-k { font-size: 9px; color: var(--text-mute); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 6px; }
    .ia-pol-bar { display: flex; height: 9px; border-radius: 999px; overflow: hidden; background: var(--bg); }
    .ia-pol-leg { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 11.5px; color: var(--text-mute); }
    .ia-pol-leg i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
    /* Alertes — compactes, plusieurs par ligne */
    .ia-alerts { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 8px; margin: 0 0 14px; }
    .ia-alert { display: flex; gap: 8px; align-items: baseline; border-radius: 9px; padding: 8px 12px; border: 1px solid; }
    .ia-alert.warn { background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.28); }
    .ia-alert.info { background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.26); }
    .ia-alert-ic { font-size: 12px; line-height: 1.3; flex: none; }
    .ia-alert.warn .ia-alert-ic { color: var(--danger); }
    .ia-alert.info .ia-alert-ic { color: var(--info); }
    .ia-alert b { font-size: 12.5px; color: var(--text); white-space: nowrap; flex: none; }
    .ia-alert span { font-size: 11.5px; color: var(--text-dim); line-height: 1.4; }
    /* Blocs prédiction / archétypes / plan */
    .ia-grid2b { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
    @media (max-width: 900px) { .ia-grid2b { grid-template-columns: 1fr; } }
    .ia-card-blk { background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; }
    .ia-blk-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    /* Prédiction */
    .ia-pred-ech { font-size: 11px; font-weight: 700; color: var(--accent); background: rgba(74,222,128,0.14); padding: 3px 9px; border-radius: 999px; }
    .ia-pred-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .ia-pred-obj { font-size: 19px; font-weight: 800; color: var(--text); line-height: 1.1; }
    .ia-pred-type { font-size: 12px; color: var(--text-mute); margin-top: 3px; }
    .ia-pred-rank { text-align: right; flex: none; }
    .ia-pred-rank-v { display: block; font-size: 18px; font-weight: 800; color: var(--accent); }
    .ia-pred-rank-k { font-size: 9px; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-mute); }
    .ia-pred-conf { display: flex; align-items: center; gap: 9px; margin: 12px 0; }
    .ia-pred-conf-bar { flex: 1; height: 7px; border-radius: 999px; background: var(--bg); overflow: hidden; }
    .ia-pred-conf-bar span { display: block; height: 100%; background: linear-gradient(90deg, #fbbf24, #4ade80); border-radius: 999px; }
    .ia-pred-conf-lbl { font-size: 11px; color: var(--text-mute); white-space: nowrap; }
    .ia-pred-line { font-size: 12.5px; color: var(--text-dim); line-height: 1.5; margin-top: 7px; }
    .ia-pred-line b { color: var(--text); font-weight: 700; margin-right: 5px; }
    .ia-pred-gpx { font-size: 12.5px; color: var(--text-dim); line-height: 1.5; margin-top: 9px; padding: 10px 12px; border-radius: 9px; background: rgba(96,165,250,0.08); border: 1px dashed rgba(96,165,250,0.35); }
    .ia-pred-gpx b { color: var(--text); }
    .ia-pred-keys { margin: 10px 0 0; padding-left: 18px; }
    .ia-pred-keys li { font-size: 12.5px; color: var(--text-dim); line-height: 1.5; margin-bottom: 3px; }
    /* Archétypes */
    .ia-arch-dom { font-size: 11px; font-weight: 700; color: var(--accent); }
    .ia-arch-bars { display: flex; flex-direction: column; gap: 9px; }
    .ia-arch-row { display: flex; align-items: center; gap: 10px; }
    .ia-arch-lbl { font-size: 12.5px; color: var(--text-dim); width: 78px; flex: none; }
    .ia-arch-track { flex: 1; height: 9px; border-radius: 999px; background: var(--bg); overflow: hidden; }
    .ia-arch-track span { display: block; height: 100%; background: linear-gradient(90deg, #2563eb, #4ade80); border-radius: 999px; }
    .ia-arch-pct { font-size: 12px; font-weight: 700; color: var(--text); width: 36px; text-align: right; flex: none; }
    .ia-arch-pro { font-size: 12.5px; color: var(--text-dim); line-height: 1.5; margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--border); }
    /* Plan d'action */
    .ia-plan-blk { margin-top: 16px; }
    .ia-plan-steps { display: flex; flex-direction: column; gap: 10px; }
    .ia-plan-step { display: flex; align-items: center; gap: 13px; background: var(--bg); border-radius: 11px; padding: 12px 14px; }
    .ia-plan-num { flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: #06231a; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .ia-plan-body { flex: 1; min-width: 0; }
    .ia-plan-titre { font-size: 14px; font-weight: 700; color: var(--text); }
    .ia-plan-detail { font-size: 12.5px; color: var(--text-dim); line-height: 1.45; margin-top: 2px; }
    .ia-plan-impact { flex: none; font-size: 11px; font-weight: 600; color: var(--accent); background: rgba(74,222,128,0.12); padding: 5px 10px; border-radius: 8px; max-width: 180px; text-align: center; }
    @media (max-width: 600px) { .ia-plan-impact { display: none; } }
    .ins { background: var(--bg-elev2); border: 1px solid var(--border); border-left: 3px solid var(--c); border-radius: 12px; padding: 13px 16px; }
    .ins-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--c); }
    .ins-titre { font-size: 15px; font-weight: 700; color: var(--text); margin: 5px 0 7px; line-height: 1.25; }
    .ins-detail { font-size: 13px; color: var(--text-dim); line-height: 1.5; }
    .ins-reco { font-size: 12.5px; color: var(--text); margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--border); }
    .ia-rep-radar { position: relative; height: 340px; width: 340px; flex: none; }
    @media (max-width: 620px) { .ia-rep-radar { width: 100%; height: 300px; } }
    .ia-profil-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 16px 0 8px; flex-wrap: wrap; }
    .bil-win { display: inline-flex; gap: 3px; background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 9px; padding: 3px; }
    .bil-win button { border: none; background: transparent; color: var(--text-dim); font-family: inherit; font-size: 11.5px; font-weight: 600; padding: 5px 11px; border-radius: 6px; cursor: pointer; }
    .bil-win button.active { background: var(--accent); color: #06231a; }
    .ia-profil-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: stretch; }
    @media (max-width: 960px) { .ia-profil-grid { grid-template-columns: 1fr; } }
    .ia-profil-card { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 20px; background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 14px; padding: 18px 22px; }
    .ia-profil-read { flex: 1; min-width: 150px; max-width: 290px; }
    @media (max-width: 620px) { .ia-profil-card { flex-direction: column; text-align: center; } }
    .ia-profil-read { font-size: 15px; line-height: 1.6; color: var(--text-dim); }
    .ia-profil-read p { margin: 0; }
    .ia-profil-read b { color: var(--text); font-weight: 700; }
    /* Terrains de prédilection */
    .ia-terrains { display: flex; flex-direction: column; }
    .ia-terr-list { display: flex; flex-direction: column; gap: 11px; }
    .ia-terr-row { display: flex; align-items: center; gap: 12px; }
    .ia-terr-info { width: 210px; flex: none; }
    .ia-terr-lbl { display: block; font-size: 13px; font-weight: 600; color: var(--text); line-height: 1.5; }
    .ia-terr-note { display: block; font-size: 10.5px; color: var(--text-mute); margin-top: 1px; }
    .ia-terr-track { flex: 1; height: 8px; border-radius: 999px; background: var(--bg); overflow: hidden; }
    .ia-terr-track span { display: block; height: 100%; background: linear-gradient(90deg, #2563eb, #60a5fa); border-radius: 999px; }
    .ia-terr-row.top .ia-terr-track span { background: linear-gradient(90deg, #22c55e, #4ade80); }
    .ia-terr-pct { width: 38px; text-align: right; font-size: 12.5px; font-weight: 700; color: var(--text); flex: none; }
    .ia-terr-badge { display: inline-block; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; color: #06231a; background: var(--accent); padding: 1px 6px; border-radius: 6px; margin-left: 7px; vertical-align: 1px; white-space: nowrap; }
    .ia-synth-line { font-size: 13.5px; line-height: 1.55; color: var(--text); background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-top: 14px; }
    .ia-synth-line .ia-rep-label { display: inline; margin-right: 6px; }
    .ia-rep-noradar { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-mute); font-size: 12px; font-style: italic; text-align: center; padding: 0 16px; }
    .ia-rep-side { display: flex; flex-direction: column; gap: 12px; }
    .ia-rep-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-mute); font-weight: 600; margin-bottom: 6px; }
    .ia-rep-type-card { background: linear-gradient(135deg, rgba(74,222,128,0.14), transparent 70%), var(--bg-elev2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 15px; }
    .ia-rep-type-val { font-size: 20px; font-weight: 700; color: var(--accent); line-height: 1.2; }
    .ia-mini { background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 12px; padding: 11px 15px; }
    .ia-mini-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-mute); font-weight: 600; margin-bottom: 7px; }
    .ia-mini-val { font-size: 14px; font-weight: 600; color: var(--text); margin-top: 6px; }
    .ia-level-bar, .ia-tsb-bar { position: relative; height: 7px; border-radius: 999px; }
    .ia-level-bar { background: linear-gradient(90deg, #60a5fa, #4ade80, #fbbf24, #f87171); }
    .ia-tsb-bar { background: linear-gradient(90deg, #f87171, #fbbf24, #4ade80); }
    .ia-level-marker, .ia-tsb-marker { position: absolute; top: 50%; width: 13px; height: 13px; border-radius: 50%; background: #fff; border: 2px solid var(--bg-elev); transform: translate(-50%, -50%); box-shadow: 0 0 0 2px rgba(0,0,0,0.25); }
    .ia-rep-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 760px) { .ia-rep-cols { grid-template-columns: 1fr; } }
    .ia-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 4px; }
    .ia-chip { font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 999px; }
    .ia-chip.pro { background: rgba(74,222,128,0.14); color: var(--accent); border: 1px solid rgba(74,222,128,0.3); }
    .ia-chip.axe { background: rgba(251,191,36,0.14); color: var(--warn); border: 1px solid rgba(251,191,36,0.3); }

    /* Sous-onglets de la page IA (barre segmentée) */
    .ia-subtabs { display: flex; gap: 6px; background: var(--bg-elev2); border: 1px solid var(--border);
      border-radius: 12px; padding: 5px; margin-bottom: 16px; }
    .ia-subtab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 10px 12px; border: none; background: transparent; color: var(--text-dim);
      font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; border-radius: 9px; transition: background .15s, color .15s; }
    .ia-subtab svg { width: 17px; height: 17px; }
    .ia-subtab:hover { color: var(--text); }
    .ia-subtab.active { background: var(--accent); color: #06231a; }
    @media (max-width: 680px) { .ia-subtab span { display: none; } }

    /* Liste de plan (onglet Planification) */
    .cai-plan { margin-top: 14px; }
    .cai-plan:empty { margin-top: 0; }
    .cai-pl-actions { margin-bottom: 12px; }
    .cai-pl-week { margin-bottom: 14px; }
    .cai-pl-week-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
    .cai-pl-week-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-dim); }
    .cai-pl-week-focus { font-size: 11px; color: var(--text-mute); }
    .cai-pl-sess { display: flex; align-items: center; gap: 11px; background: var(--bg-elev2);
      border: 1px solid var(--border); border-radius: 10px; padding: 9px 12px; margin-bottom: 7px; }
    .cai-pl-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .cai-pl-main { flex: 1; min-width: 0; }
    .cai-pl-top { display: flex; align-items: baseline; gap: 9px; }
    .cai-pl-day { font-size: 11px; color: var(--text-mute); white-space: nowrap; text-transform: capitalize; min-width: 86px; }
    .cai-pl-name { font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cai-pl-desc { font-size: 11px; color: var(--text-mute); margin-top: 2px; margin-left: 95px; }
    .cai-pl-meta { font-size: 11px; color: var(--text-dim); white-space: nowrap; flex: none; }
    .cai-pl-add { flex: none; width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg-elev); color: var(--accent); font-size: 17px; font-weight: 700; cursor: pointer; line-height: 1; }
    .cai-pl-add:hover { background: rgba(74,222,128,0.12); }
    .cai-pl-add.done { color: var(--accent); border-color: rgba(74,222,128,0.35); cursor: default; }
  `;
  document.head.appendChild(s);
}

function caiRenderAll() { renderFormSummary(); renderHomeReport(); renderDailyReco(); renderPlanTab(); renderChat(); renderPostSession(); }
function caiInit() { caiInjectStyles(); wireIaSubtabs(); caiRenderAll(); }
window.renderIaPage = caiRenderAll;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', caiInit);
} else {
  caiInit();
}
window.addEventListener('coach-ia-auth', (e) => {
  if (e.detail && e.detail.user) caiRenderAll();
});
