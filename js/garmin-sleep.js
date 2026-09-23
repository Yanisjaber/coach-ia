/* ============================================================
   js/garmin-sleep.js — Panel Sommeil (p8)

   Lit la table garmin_sleep (remplie automatiquement toutes les heures
   par l'Edge Function garmin-ingest via pg_cron — voir
   supabase/functions/garmin-ingest/). Ce module ne fait QUE lire et
   afficher ; il ne touche jamais à Garmin directement.

   Un bouton "Actualiser" permet de forcer un sync immédiat (appel
   direct à garmin-ingest), même pattern que startWhoopIngest dans
   whoop-oauth.js.
   ============================================================ */

const LEVEL_NAME = ['deep', 'light', 'rem', 'awake'];
const LEVEL_LABEL = { deep: 'Profond', light: 'Léger', rem: 'REM', awake: 'Éveil' };
const QUALIFIER_LABEL_FR = { EXCELLENT: 'Excellent', GOOD: 'Bon', FAIR: 'Correct', POOR: 'Faible', INVALID: 'N/D' };
const QUALIFIER_CLASS = { EXCELLENT: 'excellent', GOOD: 'good', FAIR: 'fair', POOR: 'poor', INVALID: 'invalid' };
const COMPONENT_LABEL_FR = {
  totalDuration: 'Durée', stress: 'Stress', awakeCount: 'Réveils',
  remPercentage: '% REM', restlessness: 'Agitation',
  lightPercentage: '% Léger', deepPercentage: '% Profond',
};
const COMPONENT_ADVICE_FR = {
  totalDuration: "te coucher plus tôt pour allonger la nuit — c'est le levier n°1 ici",
  awakeCount: "limiter ce qui te réveille la nuit (bruit, lumière, température de la chambre)",
  stress: "installer une routine de descente en charge avant le coucher (écrans, lumière tamisée)",
  restlessness: "réduire l'agitation nocturne — activité physique en journée, éviter les écrans tard",
  remPercentage: "protéger la fin de nuit, où se concentre l'essentiel du sommeil paradoxal",
};

let _sleepChart = null;
let _sleepLoaded = false;

function scoreStatus(q) {
  if (q === 'EXCELLENT' || q === 'GOOD') return 'good';
  if (q === 'FAIR') return 'warning';
  return 'critical';
}
function hms(sec) {
  if (sec === null || sec === undefined) return '—';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h + 'h' + String(m).padStart(2, '0');
}
function timeOnly(dtStr) { return dtStr ? (dtStr.split(' ')[1] || dtStr) : '—'; }
function dowFr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][d.getDay()];
}
function dateShort(dateStr) { const [, m, d] = dateStr.split('-'); return d + '/' + m; }
function stressBand(v) {
  if (v == null) return '';
  if (v <= 25) return 'repos'; if (v <= 50) return 'bas'; if (v <= 75) return 'moyen'; return 'élevé';
}

function phaseBarHtml(n) {
  const total = (n.deep_sec || 0) + (n.light_sec || 0) + (n.rem_sec || 0) + (n.awake_sec || 0);
  if (!total) return '<div class="sleep-phasebar"></div>';
  const seg = (val, cls) => { const pct = (val || 0) / total * 100; return pct > 0 ? `<span class="${cls}" style="width:${pct}%"></span>` : ''; };
  return `<div class="sleep-phasebar">${seg(n.deep_sec, 'deep')}${seg(n.light_sec, 'light')}${seg(n.rem_sec, 'rem')}${seg(n.awake_sec, 'awake')}</div>`;
}

function hypnoHtml(n) {
  const segs = n.segments;
  if (!segs || !segs.length) return phaseBarHtml(n);
  const totalMin = Math.max(...segs.map((s) => s[1]));
  const bedtimeClock = (n.bedtime || '').split(' ')[1];
  const rows = LEVEL_NAME.map((name, level) => {
    const segHtml = segs.filter((s) => s[2] === level).map(([start, end]) => {
      const left = (start / totalMin) * 100, width = Math.max((end - start) / totalMin * 100, 0.3);
      return `<span class="sleep-hypno-seg ${name}" style="left:${left}%;width:${width}%"></span>`;
    }).join('');
    return `<div class="sleep-hypno-row"><span class="label">${LEVEL_LABEL[name]}</span><div class="sleep-hypno-track">${segHtml}</div></div>`;
  }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const min = totalMin * f;
    const [bh, bm] = (bedtimeClock || '0:0').split(':').map(Number);
    const total = bh * 60 + bm + min;
    const hh = Math.floor((total / 60) % 24), mm = Math.round(total % 60);
    return `<span>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</span>`;
  }).join('');
  return `<div>${rows}</div><div class="sleep-hypno-ticks">${ticks}</div>`;
}

function heroHtml(n) {
  const st = scoreStatus(n.score_qualifier);
  return `
    <div class="sleep-hero-head">
      <div class="sleep-hero-date">${dowFr(n.date)} ${dateShort(n.date)} <span class="sub">— dernière nuit</span></div>
      <div class="sleep-score-pill ${st}"><span class="n">${n.score ?? '—'}</span>${QUALIFIER_LABEL_FR[n.score_qualifier] || ''}</div>
    </div>
    <div class="hero" style="margin:16px 0;">
      <div class="card"><div class="kpi-label">Durée</div><div class="kpi-value" style="font-size:24px;">${hms(n.total_sec)}</div>${n.awake_sec ? `<div class="kpi-trend">+ ${hms(n.awake_sec)} éveil</div>` : ''}</div>
      <div class="card"><div class="kpi-label">Coucher</div><div class="kpi-value" style="font-size:24px;">${timeOnly(n.bedtime)}</div></div>
      <div class="card"><div class="kpi-label">Réveil</div><div class="kpi-value" style="font-size:24px;">${timeOnly(n.wake_time)}</div></div>
      <div class="card"><div class="kpi-label">HRV</div><div class="kpi-value" style="font-size:24px;">${n.hrv_avg != null ? Math.round(n.hrv_avg) : '—'}</div><div class="kpi-trend">plus haut = mieux récupéré</div></div>
    </div>
    ${phaseBarHtml(n)}
    <div class="sleep-legend">
      <span class="item"><span class="sw deep"></span>Profond ${hms(n.deep_sec)}</span>
      <span class="item"><span class="sw light"></span>Léger ${hms(n.light_sec)}</span>
      <span class="item"><span class="sw rem"></span>REM ${hms(n.rem_sec)}</span>
      <span class="item"><span class="sw awake"></span>Éveil ${hms(n.awake_sec)}</span>
    </div>`;
}

function detailHtml(n) {
  const comps = ['totalDuration', 'stress', 'awakeCount', 'remPercentage', 'restlessness', 'lightPercentage', 'deepPercentage'];
  const detail = n.score_detail || {};
  const chips = comps.filter((k) => detail[k]).map((k) => {
    const c = detail[k];
    const cls = QUALIFIER_CLASS[c.qualifierKey] || 'invalid';
    const label = QUALIFIER_LABEL_FR[c.qualifierKey] || c.qualifierKey || '—';
    const val = (c.value !== null && c.value !== undefined) ? ` ${c.value}%` : '';
    return `<span class="sleep-chip ${cls}">${COMPONENT_LABEL_FR[k]}: ${label}${val}</span>`;
  }).join('');
  return `
    <div class="sleep-history-detail">
      ${hypnoHtml(n)}
      <div class="sleep-detail-grid">
        <div><div class="sleep-detail-label">Réveils</div><div class="sleep-detail-value">${n.awake_count ?? '—'}</div></div>
        <div><div class="sleep-detail-label">Agitation</div><div class="sleep-detail-value">${n.restless_count ?? '—'} mvts</div></div>
        <div><div class="sleep-detail-label">Stress moy.</div><div class="sleep-detail-value">${n.avg_stress ?? '—'}</div></div>
        <div><div class="sleep-detail-label">FC sommeil</div><div class="sleep-detail-value">${n.avg_heart_rate ?? '—'} bpm</div></div>
        <div><div class="sleep-detail-label">Respiration</div><div class="sleep-detail-value">${n.resp_avg ?? '—'} /min</div></div>
        <div><div class="sleep-detail-label">Body Battery</div><div class="sleep-detail-value">${n.body_battery_change != null ? '+' + n.body_battery_change : '—'}</div></div>
        <div><div class="sleep-detail-label">HRV</div><div class="sleep-detail-value">${n.hrv_avg != null ? Math.round(n.hrv_avg) : '—'} ms</div></div>
      </div>
      ${chips ? `<div class="sleep-chip-row">${chips}</div>` : ''}
    </div>`;
}

function historyHtml(nights) {
  const rows = nights.map((n) => {
    const total = (n.deep_sec || 0) + (n.light_sec || 0) + (n.rem_sec || 0);
    const st = scoreStatus(n.score_qualifier);
    return `
      <div class="sleep-history-item">
        <div class="sleep-history-row" data-date="${n.date}" tabindex="0" role="button">
          <div class="sleep-history-date">${dateShort(n.date)}<span class="dow">${dowFr(n.date)}</span></div>
          ${phaseBarHtml(n)}
          <div class="sleep-score-pill ${st}" style="justify-self:end"><span class="n">${n.score ?? '—'}</span></div>
          <div class="sleep-history-dur">${hms(total)}</div>
          <div class="sleep-history-caret">▸</div>
        </div>
        ${detailHtml(n)}
      </div>`;
  }).join('');
  return `<div class="card"><div class="section-title">Historique</div>${rows}</div>`;
}

function computeInsights(nights) {
  const withDetail = nights.filter((n) => n.bedtime && n.wake_time && n.total_sec);
  if (!withDetail.length) return null;
  const clockToMin = (c) => { const [h, m] = c.split(':').map(Number); return h * 60 + m; };
  const shift = (m) => (m + 720) % 1440;
  const unshift = (s) => ((s - 720) % 1440 + 1440) % 1440;
  const fmtMin = (m) => String(Math.floor(m / 60)).padStart(2, '0') + 'h' + String(Math.round(m % 60)).padStart(2, '0');
  const roundTo = (m, step) => Math.round(m / step) * step;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  const bedShifted = withDetail.map((n) => shift(clockToMin(n.bedtime.split(' ')[1])));
  const wakeShifted = withDetail.map((n) => shift(clockToMin(n.wake_time.split(' ')[1])));
  const avgBedShifted = avg(bedShifted), avgWakeShifted = avg(wakeShifted);
  const bedRangeMin = Math.max(...bedShifted) - Math.min(...bedShifted);
  const avgDurationMin = avg(withDetail.map((n) => n.total_sec / 60));

  const RANK = { POOR: 0, FAIR: 1, GOOD: 2, EXCELLENT: 3 };
  const compScores = {};
  withDetail.forEach((n) => {
    const sd = n.score_detail || {};
    Object.keys(sd).forEach((k) => {
      const q = sd[k] && sd[k].qualifierKey;
      if (q == null || RANK[q] == null) return;
      (compScores[k] = compScores[k] || []).push(RANK[q]);
    });
  });
  let weakest = null, weakestAvg = 4;
  Object.keys(compScores).forEach((k) => {
    if (!COMPONENT_ADVICE_FR[k]) return;
    const a = avg(compScores[k]);
    if (a < weakestAvg) { weakestAvg = a; weakest = k; }
  });

  const remVals = withDetail.map((n) => n.score_detail && n.score_detail.remPercentage && n.score_detail.remPercentage.value).filter((v) => v != null);
  const avgRemPct = remVals.length ? avg(remVals) : null;

  const targetDurationMin = 7.5 * 60;
  const targetWake = roundTo(unshift(avgWakeShifted), 15);
  let targetBed = (targetWake - targetDurationMin + 1440) % 1440;
  targetBed = roundTo(targetBed, 15);

  return {
    avgBedtime: fmtMin(unshift(avgBedShifted)), avgWake: fmtMin(unshift(avgWakeShifted)),
    bedRangeMin: Math.round(bedRangeMin), avgDurationMin: Math.round(avgDurationMin),
    avgRemPct, weakest, targetBed: fmtMin(targetBed), targetWake: fmtMin(targetWake),
    nightsCount: withDetail.length,
  };
}

function adviceHtml(nights) {
  const ins = computeInsights(nights);
  if (!ins) return `<div class="card"><div class="sleep-state">Pas encore assez de nuits pour des conseils personnalisés.</div></div>`;
  const fmtMin = (m) => String(Math.floor(m / 60)).padStart(2, '0') + 'h' + String(Math.round(m % 60)).padStart(2, '0');
  const durationGapMin = Math.round(450 - ins.avgDurationMin);
  const actions = [];
  if (ins.weakest && COMPONENT_ADVICE_FR[ins.weakest]) {
    actions.push({ tag: 'perso', html: `<strong>Priorité :</strong> ${COMPONENT_ADVICE_FR[ins.weakest]}. C'est le point qui a le plus pénalisé ton score sur tes ${ins.nightsCount} dernières nuits.` });
  }
  if (durationGapMin > 20) {
    actions.push({ tag: 'perso', html: `Tu dors en moyenne <strong>${fmtMin(ins.avgDurationMin)}</strong> — vise plutôt <strong>7h30–8h</strong>. Avance ton coucher progressivement (15–20 min tous les 2-3 jours).` });
  }
  if (ins.bedRangeMin > 90) {
    actions.push({ tag: 'perso', html: `Tes horaires de coucher varient de <strong>${fmtMin(ins.bedRangeMin)}</strong> d'une nuit à l'autre. Un créneau stable aide autant que la durée elle-même.` });
  }
  if (ins.avgRemPct != null && ins.avgRemPct < 20) {
    actions.push({ tag: 'perso', html: `Ton sommeil paradoxal tourne autour de <strong>${Math.round(ins.avgRemPct)}%</strong>, sous la cible de 20–25%. Le REM se concentre en fin de nuit : une nuit écourtée le rogne en premier.` });
  }
  actions.push({ tag: 'general', html: `Caféine : éviter après le début d'après-midi (demi-vie ~5–6h).` });
  actions.push({ tag: 'general', html: `Chambre : viser 17–19°C, noir et calme.` });
  const actionsHtml = actions.map((a) => `<li><span class="sleep-insight-tag ${a.tag}">${a.tag === 'perso' ? 'perso' : 'général'}</span><span>${a.html}</span></li>`).join('');

  return `
    <div class="card">
      <div class="section-title">Conseils</div>
      <div class="section-subtitle">Basé sur tes ${ins.nightsCount} dernières nuits — pas un avis médical.</div>
      <div class="sleep-target-grid">
        <div class="sleep-target-box"><div class="sleep-target-label">Coucher visé</div><div class="sleep-target-value">${ins.targetBed}</div><div class="sleep-target-sub">± 30 min</div></div>
        <div class="sleep-target-box"><div class="sleep-target-label">Lever visé</div><div class="sleep-target-value">${ins.targetWake}</div></div>
        <div class="sleep-target-box"><div class="sleep-target-label">Durée visée</div><div class="sleep-target-value">7h30–8h</div><div class="sleep-target-sub">actuel : ${fmtMin(ins.avgDurationMin)}</div></div>
      </div>
      <ul class="sleep-insight-list">${actionsHtml}</ul>
    </div>`;
}

function renderChart(nights) {
  const canvas = document.getElementById('chart-sleep-score');
  if (!canvas || typeof Chart === 'undefined') return;
  const pts = nights.filter((n) => n.score != null).slice().reverse();
  if (_sleepChart) { _sleepChart.destroy(); _sleepChart = null; }
  if (pts.length < 2) return;
  _sleepChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: pts.map((n) => dateShort(n.date)),
      datasets: [{
        label: 'Score de sommeil',
        data: pts.map((n) => n.score),
        borderColor: '#4ade80',
        backgroundColor: 'rgba(74, 222, 128, 0.12)',
        fill: true, tension: 0.3, pointRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100, grid: { color: '#232a3a' } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false } },
    },
  });
}

function attachInteractions(root) {
  root.querySelectorAll('.sleep-history-row').forEach((row) => {
    const toggle = () => row.closest('.sleep-history-item').classList.toggle('open');
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

function render(nights) {
  const app = document.getElementById('sleep-app');
  if (!app) return;
  if (!nights.length) {
    app.innerHTML = `<div class="card"><div class="sleep-state">Aucune nuit synchronisée pour l'instant. La synchro se fait automatiquement toutes les heures depuis Garmin.</div></div>`;
    return;
  }
  const sorted = nights.slice().sort((a, b) => b.date.localeCompare(a.date));
  app.innerHTML = `
    <div class="card">${heroHtml(sorted[0])}</div>
    <div class="card">
      <div class="section-title">Score de sommeil</div>
      <div class="chart-wrap" style="height:220px;"><canvas id="chart-sleep-score"></canvas></div>
    </div>
    ${adviceHtml(sorted)}
    ${historyHtml(sorted)}
  `;
  attachInteractions(app);
  renderChart(sorted);
}

async function loadAndRender() {
  const app = document.getElementById('sleep-app');
  if (!app) return;
  const user = await window.sbCurrentUser();
  if (!user) { app.innerHTML = `<div class="card"><div class="sleep-state">Connecte-toi pour voir ton sommeil.</div></div>`; return; }
  const { data, error } = await window.sb
    .from('garmin_sleep').select('*')
    .eq('user_id', user.id).order('date', { ascending: false }).limit(60);
  if (error) { app.innerHTML = `<div class="card"><div class="sleep-state">Erreur de chargement : ${error.message}</div></div>`; return; }
  render(data || []);
}

async function forceSync() {
  const btn = document.getElementById('sleep-refresh-btn');
  const user = await window.sbCurrentUser();
  if (!user) return;
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Synchro…'; }
  try {
    const cfg = window.SUPABASE_CONFIG;
    const res = await fetch(`${cfg.url}/functions/v1/garmin-ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 3 }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('[garmin-ingest]', data); }
    await loadAndRender();
  } catch (e) {
    console.error('[garmin-ingest]', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Actualiser'; }
  }
}

function initSleepPanel() {
  const btn = document.getElementById('sleep-refresh-btn');
  if (btn) btn.addEventListener('click', forceSync);

  const tabBtn = document.querySelector('.tab[data-panel="p8"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => { if (!_sleepLoaded) { _sleepLoaded = true; loadAndRender(); } });
  }
  if (window.location.hash === '#sommeil') { _sleepLoaded = true; loadAndRender(); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.sbReady && window.sbReady.then(initSleepPanel); });
} else {
  window.sbReady && window.sbReady.then(initSleepPanel);
}
