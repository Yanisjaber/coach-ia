/* ============================================================
   js/garmin-sleep.js — Panel Sommeil (p8)

   Lit la table garmin_sleep (remplie automatiquement toutes les heures
   par l'Edge Function garmin-ingest via pg_cron — voir
   supabase/functions/garmin-ingest/). Ce module ne fait QUE lire et
   afficher ; il ne touche jamais à Garmin directement.

   Structure : 3 sous-onglets —
     Aperçu     : nuit précédente + historique déroulant (existant)
     Graphiques : tendances détaillées + comparaisons (7j/7j, semaine/week-end)
     Conseils   : analyse façon bilan de sommeil (architecture, signaux
                  physiologiques, régularité, plan d'action priorisé)

   Un bouton "Actualiser" permet de forcer un sync immédiat (appel
   direct à garmin-ingest), même pattern que startWhoopIngest dans
   whoop-oauth.js.
   ============================================================ */

const LEVEL_NAME = ['deep', 'light', 'rem', 'awake'];
const LEVEL_LABEL = { deep: 'Profond', light: 'Léger', rem: 'Paradoxal', awake: 'Éveil' };
const QUALIFIER_LABEL_FR = { EXCELLENT: 'Excellent', GOOD: 'Bon', FAIR: 'Correct', POOR: 'Faible', INVALID: 'N/D' };
const QUALIFIER_CLASS = { EXCELLENT: 'excellent', GOOD: 'good', FAIR: 'fair', POOR: 'poor', INVALID: 'invalid' };
const COMPONENT_LABEL_FR = {
  totalDuration: 'Durée', stress: 'Stress', awakeCount: 'Réveils',
  remPercentage: '% Paradoxal', restlessness: 'Agitation',
  lightPercentage: '% Léger', deepPercentage: '% Profond',
};
const COMPONENT_ADVICE_FR = {
  totalDuration: "te coucher plus tôt pour allonger la nuit — c'est le levier n°1 ici",
  awakeCount: "limiter ce qui te réveille la nuit (bruit, lumière, température de la chambre)",
  stress: "installer une routine de descente en charge avant le coucher (écrans, lumière tamisée)",
  restlessness: "réduire l'agitation nocturne — activité physique en journée, éviter les écrans tard",
  remPercentage: "protéger la fin de nuit, où se concentre l'essentiel du sommeil paradoxal",
};

// Repères "pro" (hygiène du sommeil / actigraphie grand public — informatif, pas un diagnostic)
const REF_DEEP_PCT = [13, 23];
const REF_REM_PCT = [20, 25];
const REF_EFFICIENCY_GOOD = 85;
const REF_EFFICIENCY_FAIR = 75;
const REF_SOL_GOOD = 20;   // latence d'endormissement, minutes
const REF_SOL_FAIR = 30;
const REF_RESP_RANGE = [12, 20];
const REF_SPO2_GOOD = 95;
const REF_DEBT_TARGET_MIN = 8 * 60;

let _scoreChart = null;
let _graphCharts = {};
let _graphsRendered = false;
let _sleepLoaded = false;

/* ---------- helpers génériques ---------- */
function avg(arr) {
  const a = (arr || []).filter((v) => v != null && !Number.isNaN(v));
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}
function clockToMin(c) { const [h, m] = c.split(':').map(Number); return h * 60 + m; }
function shiftNoon(m) { return (m + 720) % 1440; }
function unshiftNoon(s) { return ((s - 720) % 1440 + 1440) % 1440; }
function fmtMin(m) { return String(Math.floor(m / 60)).padStart(2, '0') + 'h' + String(Math.round(m % 60)).padStart(2, '0'); }
function roundTo(m, step) { return Math.round(m / step) * step; }
function avgClockMin(clocks) {
  const list = (clocks || []).filter(Boolean);
  if (!list.length) return null;
  return unshiftNoon(avg(list.map((c) => shiftNoon(clockToMin(c)))));
}

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
function isWeekendDate(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  return dow === 0 || dow === 6;
}

/* ---------- métriques dérivées par nuit ---------- */
function sleepEfficiencyPct(n) {
  if (n.total_sec == null || n.awake_sec == null) return null;
  const inBed = n.total_sec + n.awake_sec;
  return inBed > 0 ? (n.total_sec / inBed) * 100 : null;
}
function sleepOnsetLatencyMin(n) {
  const segs = n.segments;
  if (!segs || !segs.length) return null;
  const sorted = segs.slice().sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  if (first[2] !== 3) return 0; // déjà endormi au marqueur de coucher
  const asleep = sorted.find((s) => s[2] !== 3);
  return asleep ? Math.round(asleep[0]) : null;
}

function phaseBarHtml(n) {
  const total = (n.deep_sec || 0) + (n.light_sec || 0) + (n.rem_sec || 0) + (n.awake_sec || 0);
  if (!total) return '<div class="sleep-phasebar"></div>';
  const seg = (val, cls) => { const pct = (val || 0) / total * 100; return pct > 0 ? `<span class="${cls}" style="width:${pct}%"></span>` : ''; };
  return `<div class="sleep-phasebar">${seg(n.deep_sec, 'deep')}${seg(n.light_sec, 'light')}${seg(n.rem_sec, 'rem')}${seg(n.awake_sec, 'awake')}</div>`;
}

function phaseGridHtml(n) {
  const total = (n.deep_sec || 0) + (n.light_sec || 0) + (n.rem_sec || 0) + (n.awake_sec || 0);
  const pct = (v) => total ? Math.round((v || 0) / total * 100) + '%' : '—';
  const item = (cls, label, sec) => `
    <div class="sleep-phase-item">
      <span class="sw ${cls}"></span>
      <div>
        <div class="sleep-phase-name">${label}</div>
        <div class="sleep-phase-val">${hms(sec)} <span class="sleep-phase-pct">· ${pct(sec)}</span></div>
      </div>
    </div>`;
  return `<div class="sleep-phase-grid">
    ${item('deep', 'Profond', n.deep_sec)}
    ${item('light', 'Léger', n.light_sec)}
    ${item('rem', 'Paradoxal', n.rem_sec)}
    ${item('awake', 'Éveil', n.awake_sec)}
  </div>`;
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
    return `<div class="sleep-hypno-row"><div class="sleep-hypno-track">${segHtml}</div></div>`;
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

const ICON_MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
const ICON_SUN = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';

function svgIcon(paths, x, y) {
  return `<g transform="translate(${x},${y})">
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>
  </g>`;
}

function sleepArcHtml(n) {
  const bedClock = timeOnly(n.bedtime);
  const wakeClock = timeOnly(n.wake_time);
  const totalNightSec = (n.total_sec || 0) + (n.awake_sec || 0);
  const dur = hms(totalNightSec);
  return `
    <svg class="sleep-arc" viewBox="0 0 400 158" role="img" aria-label="Coucher ${bedClock}, durée totale ${dur}, réveil ${wakeClock}">
      <text x="200" y="40" text-anchor="middle" class="sleep-arc-dur">${dur}</text>
      <path class="sleep-arc-path" d="M40,92 Q200,50 360,92" fill="none" />
      <circle class="sleep-arc-badge moon" cx="40" cy="92" r="19" />
      <circle class="sleep-arc-badge sun" cx="360" cy="92" r="19" />
      <g class="sleep-arc-icon moon">${svgIcon(ICON_MOON, 28, 80)}</g>
      <g class="sleep-arc-icon sun">${svgIcon(ICON_SUN, 348, 80)}</g>
      <text x="40" y="128" text-anchor="middle" class="sleep-arc-time">${bedClock}</text>
      <text x="40" y="143" text-anchor="middle" class="sleep-arc-label">Coucher</text>
      <text x="360" y="128" text-anchor="middle" class="sleep-arc-time">${wakeClock}</text>
      <text x="360" y="143" text-anchor="middle" class="sleep-arc-label">Réveil</text>
    </svg>`;
}

function heroHtml(n) {
  const st = scoreStatus(n.score_qualifier);
  return `
    <div class="sleep-hero-head">
      <div class="sleep-hero-date">${dowFr(n.date)} ${dateShort(n.date)} <span class="sub">— dernière nuit</span></div>
      <div class="sleep-score-pill ${st}"><span class="n">${n.score ?? '—'}</span>${QUALIFIER_LABEL_FR[n.score_qualifier] || ''}</div>
    </div>
    ${sleepArcHtml(n)}
    <div class="card sleep-hrv-mini">
      <div class="kpi-label">HRV</div>
      <div class="kpi-value" style="font-size:22px;">${n.hrv_avg != null ? Math.round(n.hrv_avg) : '—'}</div>
    </div>
    ${phaseBarHtml(n)}
    ${phaseGridHtml(n)}
    <div class="sleep-hero-hypno">
      <div class="sleep-hero-hypno-title">Chronologie de la nuit</div>
      ${hypnoHtml(n)}
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
  const eff = sleepEfficiencyPct(n);
  const sol = sleepOnsetLatencyMin(n);
  return `
    <div class="sleep-history-detail">
      ${hypnoHtml(n)}
      <div class="sleep-detail-grid">
        <div><div class="sleep-detail-label">Efficacité</div><div class="sleep-detail-value">${eff != null ? Math.round(eff) + '%' : '—'}</div></div>
        <div><div class="sleep-detail-label">Endormissement</div><div class="sleep-detail-value">${sol != null ? sol + ' min' : '—'}</div></div>
        <div><div class="sleep-detail-label">Réveils</div><div class="sleep-detail-value">${n.awake_count ?? '—'}</div></div>
        <div><div class="sleep-detail-label">Agitation</div><div class="sleep-detail-value">${n.restless_count ?? '—'} mvts</div></div>
        <div><div class="sleep-detail-label">Stress moy.</div><div class="sleep-detail-value">${n.avg_stress ?? '—'}</div></div>
        <div><div class="sleep-detail-label">FC sommeil</div><div class="sleep-detail-value">${n.avg_heart_rate ?? '—'} bpm</div></div>
        <div><div class="sleep-detail-label">Respiration</div><div class="sleep-detail-value">${n.resp_avg ?? '—'} /min</div></div>
        <div><div class="sleep-detail-label">SpO2</div><div class="sleep-detail-value">${n.spo2_avg ?? '—'}%</div></div>
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

/* ---------- Aperçu : onglet 1 ---------- */
function overviewHtml(sorted) {
  return `
    <div class="card">${heroHtml(sorted[0])}</div>
    <div class="card">
      <div class="section-title">Score de sommeil</div>
      <div class="chart-wrap small"><canvas id="chart-sleep-score"></canvas></div>
    </div>
    ${historyHtml(sorted)}
  `;
}

function renderScoreChart(nights) {
  const canvas = document.getElementById('chart-sleep-score');
  if (!canvas || typeof Chart === 'undefined') return;
  const pts = nights.filter((n) => n.score != null).slice().reverse();
  if (_scoreChart) { _scoreChart.destroy(); _scoreChart = null; }
  if (pts.length < 2) return;
  _scoreChart = new Chart(canvas.getContext('2d'), {
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

/* ---------- Graphiques : onglet 2 ---------- */
function groupStats(list) {
  const effList = list.map(sleepEfficiencyPct).filter((v) => v != null);
  return {
    n: list.length,
    durSec: avg(list.map((n) => n.total_sec).filter((v) => v != null)),
    score: avg(list.map((n) => n.score).filter((v) => v != null)),
    hrv: avg(list.map((n) => n.hrv_avg).filter((v) => v != null)),
    eff: effList.length ? avg(effList) : null,
    bedMin: avgClockMin(list.map((n) => n.bedtime && n.bedtime.split(' ')[1])),
    wakeMin: avgClockMin(list.map((n) => n.wake_time && n.wake_time.split(' ')[1])),
  };
}

function compareRowHtml(label, aVal, bVal, fmt, deltaFmt) {
  if (aVal == null && bVal == null) return '';
  const diff = (aVal != null && bVal != null) ? aVal - bVal : null;
  const deltaTxt = diff == null ? '—' : (diff === 0 ? '=' : (diff > 0 ? '↑ ' : '↓ ') + deltaFmt(Math.abs(diff)));
  return `
    <div class="sleep-compare-row">
      <div class="sleep-compare-label">${label}</div>
      <div class="sleep-compare-vals"><span class="prev">${bVal != null ? fmt(bVal) : '—'}</span><span class="arrow">→</span><span class="cur">${aVal != null ? fmt(aVal) : '—'}</span></div>
      <div class="sleep-compare-delta">${deltaTxt}</div>
    </div>`;
}

function comparisonsHtml(valid) {
  const recent7 = valid.slice(0, 7);
  const prev7 = valid.slice(7, 14);
  let recentBlock = '';
  if (recent7.length >= 3 && prev7.length >= 3) {
    const a = groupStats(recent7), b = groupStats(prev7);
    recentBlock = `
      <div class="card">
        <div class="section-title">7 derniers jours vs 7 jours précédents</div>
        <div class="section-subtitle">${a.n} nuits comparées à ${b.n} nuits — tendance récente.</div>
        <div class="sleep-compare-table">
          <div class="sleep-compare-head"><span></span><span>précédent</span><span></span><span>récent</span></div>
          ${compareRowHtml('Durée moyenne', a.durSec, b.durSec, (v) => hms(v), (v) => hms(v))}
          ${compareRowHtml('Score moyen', a.score, b.score, (v) => Math.round(v), (v) => Math.round(v) + ' pts')}
          ${compareRowHtml('HRV moyenne', a.hrv, b.hrv, (v) => Math.round(v), (v) => Math.round(v) + ' ms')}
          ${compareRowHtml('Efficacité', a.eff, b.eff, (v) => Math.round(v) + '%', (v) => Math.round(v) + ' pts')}
        </div>
      </div>`;
  }

  const weekday = valid.filter((n) => !isWeekendDate(n.date)).slice(0, 30);
  const weekend = valid.filter((n) => isWeekendDate(n.date)).slice(0, 12);
  let weekendBlock = '';
  if (weekday.length >= 3 && weekend.length >= 2) {
    const a = groupStats(weekend), b = groupStats(weekday);
    weekendBlock = `
      <div class="card">
        <div class="section-title">Semaine vs week-end</div>
        <div class="section-subtitle">${b.n} nuits en semaine, ${a.n} nuits de week-end — effet « jet-lag social ».</div>
        <div class="sleep-compare-table">
          <div class="sleep-compare-head"><span></span><span>semaine</span><span></span><span>week-end</span></div>
          ${compareRowHtml('Durée moyenne', a.durSec, b.durSec, (v) => hms(v), (v) => hms(v))}
          ${compareRowHtml('Score moyen', a.score, b.score, (v) => Math.round(v), (v) => Math.round(v) + ' pts')}
          ${compareRowHtml('Heure de coucher', a.bedMin, b.bedMin, (v) => fmtMin(v), (v) => Math.round(v) + ' min')}
          ${compareRowHtml('Heure de réveil', a.wakeMin, b.wakeMin, (v) => fmtMin(v), (v) => Math.round(v) + ' min')}
        </div>
      </div>`;
  }
  return recentBlock + weekendBlock;
}

function chartCard(id, title, caption) {
  return `
    <div class="card">
      <div class="section-title">${title}</div>
      ${caption ? `<div class="section-subtitle">${caption}</div>` : ''}
      <div class="chart-wrap small"><canvas id="${id}"></canvas></div>
    </div>`;
}

function graphsHtml(valid) {
  if (valid.length < 3) {
    return `<div class="card"><div class="sleep-state">Pas encore assez de nuits synchronisées pour les graphiques détaillés (3 minimum).</div></div>`;
  }
  return `
    ${chartCard('chart-sleep-duration-score', 'Durée & score', 'Durée de sommeil (barres) et score (ligne) — 10 dernières nuits.')}
    ${chartCard('chart-sleep-architecture', 'Architecture du sommeil', 'Répartition des phases par nuit, en % de la durée totale.')}
    ${chartCard('chart-sleep-hrv', 'Variabilité cardiaque nocturne (HRV)', 'Ligne pointillée = ta moyenne sur la période.')}
    ${chartCard('chart-sleep-resp', 'Fréquence respiratoire', 'Zone = intervalle min–max, ligne = moyenne de la nuit.')}
    ${chartCard('chart-sleep-spo2', 'Saturation en oxygène (SpO2)', 'Repère : en dessous de 95% de moyenne mérite une vérification.')}
    ${chartCard('chart-sleep-stress', 'Stress pendant le sommeil', 'Plus la barre est basse et verte, plus la nuit a été récupératrice.')}
    ${comparisonsHtml(valid)}
  `;
}

function renderGraphCharts(valid) {
  Object.values(_graphCharts).forEach((c) => c && c.destroy());
  _graphCharts = {};
  if (typeof Chart === 'undefined' || valid.length < 3) return;

  const mk = (id, config) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    _graphCharts[id] = new Chart(canvas.getContext('2d'), config);
  };

  const bars = valid.slice(0, 10).slice().reverse();
  const lines = valid.slice(0, 30).slice().reverse();
  const labelsBars = bars.map((n) => dateShort(n.date));
  const labelsLines = lines.map((n) => dateShort(n.date));

  mk('chart-sleep-duration-score', {
    data: {
      labels: labelsBars,
      datasets: [
        { type: 'bar', label: 'Durée (h)', data: bars.map((n) => n.total_sec != null ? +(n.total_sec / 3600).toFixed(2) : null), backgroundColor: 'rgba(96,165,250,0.55)', yAxisID: 'y', borderRadius: 4 },
        { type: 'line', label: 'Score', data: bars.map((n) => n.score), borderColor: '#4ade80', backgroundColor: 'transparent', yAxisID: 'y1', tension: 0.3, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { position: 'left', title: { display: true, text: 'h', color: '#8b94a8' }, grid: { color: '#232a3a' } },
        y1: { position: 'right', min: 0, max: 100, title: { display: true, text: 'score', color: '#8b94a8' }, grid: { drawOnChartArea: false } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    },
  });

  mk('chart-sleep-architecture', {
    type: 'bar',
    data: {
      labels: labelsBars,
      datasets: [
        { label: 'Profond', data: bars.map((n) => n.total_sec ? +((n.deep_sec || 0) / n.total_sec * 100).toFixed(1) : 0), backgroundColor: '#60a5fa' },
        { label: 'Léger', data: bars.map((n) => n.total_sec ? +((n.light_sec || 0) / n.total_sec * 100).toFixed(1) : 0), backgroundColor: '#4ade80' },
        { label: 'Paradoxal', data: bars.map((n) => n.total_sec ? +((n.rem_sec || 0) / n.total_sec * 100).toFixed(1) : 0), backgroundColor: '#a78bfa' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, min: 0, max: 100, grid: { color: '#232a3a' } },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    },
  });

  const hrvVals = lines.map((n) => n.hrv_avg);
  const hrvBaseline = avg(hrvVals.filter((v) => v != null));
  mk('chart-sleep-hrv', {
    type: 'line',
    data: {
      labels: labelsLines,
      datasets: [
        { label: 'HRV', data: hrvVals, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.12)', fill: true, tension: 0.3, pointRadius: 2 },
        { label: 'Moyenne période', data: hrvVals.map(() => hrvBaseline), borderColor: '#5a6378', borderDash: [5, 4], pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { grid: { color: '#232a3a' } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    },
  });

  mk('chart-sleep-resp', {
    type: 'line',
    data: {
      labels: labelsLines,
      datasets: [
        { label: 'Max', data: lines.map((n) => n.resp_max), borderColor: 'transparent', backgroundColor: 'rgba(96,165,250,0.15)', fill: '+1', pointRadius: 0 },
        { label: 'Min', data: lines.map((n) => n.resp_min), borderColor: 'transparent', backgroundColor: 'rgba(96,165,250,0.15)', fill: false, pointRadius: 0 },
        { label: 'Moyenne', data: lines.map((n) => n.resp_avg), borderColor: '#60a5fa', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { grid: { color: '#232a3a' } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    },
  });

  mk('chart-sleep-spo2', {
    type: 'line',
    data: {
      labels: labelsLines,
      datasets: [
        { label: 'SpO2 moy.', data: lines.map((n) => n.spo2_avg), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.1)', fill: true, tension: 0.3, pointRadius: 2 },
        { label: 'Seuil 95%', data: lines.map(() => REF_SPO2_GOOD), borderColor: '#5a6378', borderDash: [5, 4], pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { min: 85, max: 100, grid: { color: '#232a3a' } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    },
  });

  const stressColor = (v) => {
    const b = stressBand(v);
    return b === 'repos' ? '#4ade80' : b === 'bas' ? '#60a5fa' : b === 'moyen' ? '#fbbf24' : b === 'élevé' ? '#f87171' : '#5a6378';
  };
  mk('chart-sleep-stress', {
    type: 'bar',
    data: {
      labels: labelsBars,
      datasets: [{ label: 'Stress moyen', data: bars.map((n) => n.avg_stress), backgroundColor: bars.map((n) => stressColor(n.avg_stress)), borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100, grid: { color: '#232a3a' } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false } },
    },
  });
}

/* ---------- Conseils : onglet 3 (analyse façon bilan pro) ---------- */
function computeInsights(nights) {
  const withDetail = nights.filter((n) => n.bedtime && n.wake_time && n.total_sec);
  if (!withDetail.length) return null;
  const avgDurationMin = avg(withDetail.map((n) => n.total_sec / 60));

  const bedShifted = withDetail.map((n) => shiftNoon(clockToMin(n.bedtime.split(' ')[1])));
  const wakeShifted = withDetail.map((n) => shiftNoon(clockToMin(n.wake_time.split(' ')[1])));
  const avgBedShifted = avg(bedShifted), avgWakeShifted = avg(wakeShifted);
  const bedRangeMin = Math.max(...bedShifted) - Math.min(...bedShifted);
  const wakeRangeMin = Math.max(...wakeShifted) - Math.min(...wakeShifted);

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
  const targetWake = roundTo(unshiftNoon(avgWakeShifted), 15);
  let targetBed = (targetWake - targetDurationMin + 1440) % 1440;
  targetBed = roundTo(targetBed, 15);

  return {
    avgBedtime: fmtMin(unshiftNoon(avgBedShifted)), avgWake: fmtMin(unshiftNoon(avgWakeShifted)),
    bedRangeMin: Math.round(bedRangeMin), wakeRangeMin: Math.round(wakeRangeMin), avgDurationMin: Math.round(avgDurationMin),
    avgRemPct, weakest, targetBed: fmtMin(targetBed), targetWake: fmtMin(targetWake),
    nightsCount: withDetail.length,
  };
}

function computeProInsights(sorted) {
  const valid = sorted.filter((n) => n.total_sec != null);
  if (!valid.length) return null;
  const ins = computeInsights(sorted);
  const recent = valid.slice(0, 30);
  const recent14 = valid.slice(0, 14);
  const last7 = valid.slice(0, 7);

  const effAvg = avg(recent14.map(sleepEfficiencyPct));
  const solList = recent14.map(sleepOnsetLatencyMin).filter((v) => v != null);
  const solAvg = solList.length ? avg(solList) : null;

  const sleepDebtMin = last7.reduce((acc, n) => acc + Math.max(0, REF_DEBT_TARGET_MIN * 60 - (n.total_sec || 0)), 0) / 60;

  const deepPctAvg = avg(recent14.map((n) => n.total_sec ? (n.deep_sec || 0) / n.total_sec * 100 : null));
  const lightPctAvg = avg(recent14.map((n) => n.total_sec ? (n.light_sec || 0) / n.total_sec * 100 : null));
  const remPctAvg = avg(recent14.map((n) => n.total_sec ? (n.rem_sec || 0) / n.total_sec * 100 : null));

  const lastVsBaseline = (field) => {
    const withVal = recent.filter((n) => n[field] != null);
    if (!withVal.length) return { last: null, baseline: null, deltaPct: null };
    const last = withVal[0][field];
    const baseList = withVal.slice(1);
    const baseline = baseList.length ? avg(baseList.map((n) => n[field])) : null;
    const deltaPct = baseline ? ((last - baseline) / baseline) * 100 : null;
    return { last, baseline, deltaPct };
  };

  return {
    ins, nightsCount: valid.length,
    effAvg, solAvg, sleepDebtMin,
    deepPctAvg, lightPctAvg, remPctAvg,
    hrv: lastVsBaseline('hrv_avg'),
    rhr: lastVsBaseline('avg_heart_rate'),
    resp: lastVsBaseline('resp_avg'),
    spo2: lastVsBaseline('spo2_avg'),
    stress: lastVsBaseline('avg_stress'),
  };
}

function signalRow(title, valueTxt, flagCls, text) {
  return `
    <div class="sleep-signal-row">
      <span class="sleep-signal-icon ${flagCls}"></span>
      <div class="sleep-signal-body">
        <div class="sleep-signal-title">${title}<span class="sleep-signal-value">${valueTxt}</span></div>
        <div class="sleep-signal-text">${text}</div>
      </div>
    </div>`;
}

function physioSignalsHtml(pro) {
  const rows = [];
  if (pro.hrv.last != null) {
    const d = pro.hrv.deltaPct;
    const cls = d == null ? 'neutral' : d >= -5 ? 'good' : d >= -15 ? 'warn' : 'bad';
    rows.push(signalRow('HRV nocturne', Math.round(pro.hrv.last) + ' ms', cls,
      d == null ? `Pas encore assez de nuits pour une moyenne de référence.` :
      `${d >= 0 ? '+' : ''}${Math.round(d)}% par rapport à ta moyenne récente (${Math.round(pro.hrv.baseline)} ms). ${d < -15 ? 'Baisse marquée — signe de fatigue ou récupération incomplète à surveiller.' : d < -5 ? 'Légèrement sous ta moyenne.' : 'Dans ta norme habituelle, bon signe de récupération.'}`));
  }
  if (pro.rhr.last != null) {
    const d = pro.rhr.deltaPct;
    const cls = d == null ? 'neutral' : d <= 5 ? 'good' : d <= 10 ? 'warn' : 'bad';
    rows.push(signalRow('FC pendant le sommeil', Math.round(pro.rhr.last) + ' bpm', cls,
      d == null ? `Pas encore assez de nuits pour une moyenne de référence.` :
      `${d >= 0 ? '+' : ''}${Math.round(d)}% par rapport à ta moyenne récente (${Math.round(pro.rhr.baseline)} bpm). ${d > 10 ? 'FC nocturne élevée — souvent lié à du stress, de l\'alcool ou une charge d\'entraînement non digérée la veille.' : 'Cohérent avec ta ligne de base.'}`));
  }
  if (pro.resp.last != null) {
    const inRange = pro.resp.last >= REF_RESP_RANGE[0] && pro.resp.last <= REF_RESP_RANGE[1];
    rows.push(signalRow('Fréquence respiratoire', Math.round(pro.resp.last * 10) / 10 + ' /min', inRange ? 'good' : 'warn',
      inRange ? `Dans la plage habituelle au repos (${REF_RESP_RANGE[0]}–${REF_RESP_RANGE[1]}/min).` : `En dehors de la plage habituelle (${REF_RESP_RANGE[0]}–${REF_RESP_RANGE[1]}/min) — peut refléter une congestion, de la fièvre ou un stress respiratoire léger.`));
  }
  if (pro.spo2.last != null) {
    const good = pro.spo2.last >= REF_SPO2_GOOD;
    rows.push(signalRow('SpO2 moyenne', Math.round(pro.spo2.last) + '%', good ? 'good' : 'bad',
      good ? `Saturation normale (≥ ${REF_SPO2_GOOD}%).` : `Sous ${REF_SPO2_GOOD}% de moyenne — si c'est récurrent, ça mérite d'en parler à un médecin (piste possible : apnées du sommeil).`));
  }
  if (pro.stress.last != null) {
    const band = stressBand(pro.stress.last);
    const cls = band === 'repos' ? 'good' : band === 'bas' ? 'good' : band === 'moyen' ? 'warn' : 'bad';
    const stressText = (band === 'repos' || band === 'bas')
      ? `Niveau « ${band} ». Système nerveux bien apaisé pendant la nuit, favorable à la récupération.`
      : `Niveau « ${band} ». Un stress nocturne élevé retarde l'entrée en sommeil profond et fragmente les cycles.`;
    rows.push(signalRow('Stress pendant le sommeil', Math.round(pro.stress.last), cls, stressText));
  }
  if (!rows.length) return '';
  return `
    <div class="card">
      <div class="section-title">Signaux physiologiques</div>
      <div class="section-subtitle">Dernière nuit comparée à ta moyenne récente (jusqu'à 30 nuits).</div>
      <div class="sleep-signal-list">${rows.join('')}</div>
    </div>`;
}

function architectureHtml(pro) {
  if (pro.deepPctAvg == null && pro.remPctAvg == null) return '';
  const chip = (label, val, ref) => {
    if (val == null) return '';
    const ok = val >= ref[0] && val <= ref[1];
    const cls = ok ? 'good' : (val < ref[0] * 0.6 ? 'poor' : 'fair');
    return `<span class="sleep-chip ${cls}">${label}: ${Math.round(val)}% <span style="opacity:.65">(cible ${ref[0]}–${ref[1]}%)</span></span>`;
  };
  const deepOk = pro.deepPctAvg != null && pro.deepPctAvg >= REF_DEEP_PCT[0];
  const remOk = pro.remPctAvg != null && pro.remPctAvg >= REF_REM_PCT[0];
  let text = `Sur tes ${pro.nightsCount >= 14 ? '14' : pro.nightsCount} dernières nuits, le sommeil profond représente en moyenne ${pro.deepPctAvg != null ? Math.round(pro.deepPctAvg) + '%' : '—'} et le sommeil paradoxal ${pro.remPctAvg != null ? Math.round(pro.remPctAvg) + '%' : '—'} du temps de sommeil. `;
  text += deepOk ? `La part de sommeil profond, qui porte l'essentiel de la récupération physique, est dans la norme attendue (${REF_DEEP_PCT[0]}–${REF_DEEP_PCT[1]}%). ` : `La part de sommeil profond est sous la cible (${REF_DEEP_PCT[0]}–${REF_DEEP_PCT[1]}%) — c'est la phase la plus sensible à l'heure de coucher et à l'alcool en soirée. `;
  text += remOk ? `Le sommeil paradoxal, lié à la consolidation mémoire, est également correct.` : `Le sommeil paradoxal est sous la cible (${REF_REM_PCT[0]}–${REF_REM_PCT[1]}%) — il se concentre en fin de nuit, donc les réveils précoces le rognent en premier.`;
  return `
    <div class="card">
      <div class="section-title">Architecture du sommeil</div>
      <div class="sleep-chip-row">
        ${chip('Profond', pro.deepPctAvg, REF_DEEP_PCT)}
        ${chip('Paradoxal', pro.remPctAvg, REF_REM_PCT)}
      </div>
      <p class="sleep-signal-text" style="margin-top:14px;font-size:13.5px;line-height:1.55;">${text}</p>
    </div>`;
}

function synthesisText(sorted, pro) {
  const withScore = sorted.filter((n) => n.score != null).slice(0, 14);
  if (!withScore.length) return "Pas encore assez de nuits scorées pour une synthèse.";
  const avgScore = Math.round(avg(withScore.map((n) => n.score)));
  const qualWord = avgScore >= 80 ? 'bon' : avgScore >= 65 ? 'correct' : avgScore >= 50 ? 'modéré' : 'faible';
  let s = `Sur tes ${withScore.length} dernières nuits, ton sommeil est en moyenne <strong>${qualWord}</strong> (score moyen ${avgScore}/100).`;
  if (pro.ins && pro.ins.weakest && COMPONENT_ADVICE_FR[pro.ins.weakest]) {
    s += ` Le facteur qui pèse le plus sur ce score : <strong>${COMPONENT_LABEL_FR[pro.ins.weakest].toLowerCase()}</strong>.`;
  }
  if (pro.effAvg != null) {
    s += pro.effAvg < REF_EFFICIENCY_FAIR
      ? ` Ton efficacité de sommeil (${Math.round(pro.effAvg)}%) est nettement sous le seuil de ${REF_EFFICIENCY_GOOD}% généralement visé : tu passes beaucoup de temps éveillé au lit.`
      : pro.effAvg < REF_EFFICIENCY_GOOD
      ? ` Ton efficacité de sommeil (${Math.round(pro.effAvg)}%) est légèrement sous le seuil de ${REF_EFFICIENCY_GOOD}%.`
      : ` Ton efficacité de sommeil (${Math.round(pro.effAvg)}%) est bonne.`;
  }
  if (pro.sleepDebtMin > 60) {
    s += ` Dette de sommeil cumulée sur 7 jours : <strong>~${fmtMin(Math.round(pro.sleepDebtMin))}</strong> par rapport à 8h/nuit.`;
  }
  return s;
}

function proKpiGridHtml(pro) {
  const box = (label, val, sub) => `<div class="sleep-target-box"><div class="sleep-target-label">${label}</div><div class="sleep-target-value">${val}</div>${sub ? `<div class="sleep-target-sub">${sub}</div>` : ''}</div>`;
  return `
    <div class="sleep-target-grid">
      ${box('Efficacité', pro.effAvg != null ? Math.round(pro.effAvg) + '%' : '—', `cible ≥ ${REF_EFFICIENCY_GOOD}%`)}
      ${box('Endormissement', pro.solAvg != null ? Math.round(pro.solAvg) + ' min' : '—', `cible ≤ ${REF_SOL_GOOD} min`)}
      ${box('Dette (7j)', pro.sleepDebtMin != null ? fmtMin(Math.round(pro.sleepDebtMin)) : '—', 'vs 8h/nuit')}
      ${pro.ins ? box('Régularité coucher', '± ' + fmtMin(Math.round(pro.ins.bedRangeMin / 2)), 'écart sur la période') : ''}
    </div>`;
}

function actionPlanHtml(sorted, pro) {
  const ins = pro.ins;
  const actions = [];
  if (ins && ins.weakest && COMPONENT_ADVICE_FR[ins.weakest]) {
    actions.push({ tag: 'fort', html: `<strong>Priorité n°1 :</strong> ${COMPONENT_ADVICE_FR[ins.weakest]}. C'est le point qui a le plus pénalisé ton score sur tes ${ins.nightsCount} dernières nuits.` });
  }
  if (pro.effAvg != null && pro.effAvg < REF_EFFICIENCY_FAIR) {
    actions.push({ tag: 'fort', html: `Ton efficacité de sommeil est basse (${Math.round(pro.effAvg)}%) : ne va te coucher que quand tu as sommeil, et si tu ne t'endors pas en 20 min, lève-toi plutôt que de rester à tourner au lit.` });
  }
  if (pro.solAvg != null && pro.solAvg > REF_SOL_FAIR) {
    actions.push({ tag: 'fort', html: `Ton endormissement prend en moyenne ${Math.round(pro.solAvg)} min (cible ≤ ${REF_SOL_GOOD} min) : coupe les écrans 30-45 min avant le coucher et évite les activités stimulantes juste avant.` });
  }
  if (ins && (450 - ins.avgDurationMin) > 20) {
    actions.push({ tag: 'fort', html: `Tu dors en moyenne <strong>${fmtMin(ins.avgDurationMin)}</strong> — vise plutôt <strong>7h30–8h</strong>. Avance ton coucher progressivement (15–20 min tous les 2-3 jours).` });
  }
  if (ins && ins.bedRangeMin > 90) {
    actions.push({ tag: 'modere', html: `Tes horaires de coucher varient de <strong>${fmtMin(ins.bedRangeMin)}</strong> d'une nuit à l'autre. Un créneau stable aide autant que la durée elle-même — vise ± 30 min autour de ${ins.targetBed}.` });
  }
  if (ins && ins.avgRemPct != null && ins.avgRemPct < REF_REM_PCT[0]) {
    actions.push({ tag: 'modere', html: `Ton sommeil paradoxal tourne autour de <strong>${Math.round(ins.avgRemPct)}%</strong>, sous la cible de ${REF_REM_PCT[0]}–${REF_REM_PCT[1]}%. Le sommeil paradoxal se concentre en fin de nuit : une nuit écourtée le rogne en premier.` });
  }
  if (pro.rhr && pro.rhr.deltaPct != null && pro.rhr.deltaPct > 10) {
    actions.push({ tag: 'modere', html: `Ta FC pendant le sommeil est sensiblement au-dessus de ta moyenne récente — regarde du côté de la charge d'entraînement, de l'alcool ou du stress de la veille.` });
  }
  actions.push({ tag: 'general', html: `Lumière du jour le matin (15–20 min) pour caler ton horloge circadienne.` });
  actions.push({ tag: 'general', html: `Caféine : éviter après le début d'après-midi (demi-vie ~5–6h).` });
  actions.push({ tag: 'general', html: `Repas lourds et alcool en fin de soirée fragmentent le sommeil profond — à limiter.` });
  actions.push({ tag: 'general', html: `Chambre : viser 17–19°C, noir et calme.` });

  const tagLabel = { fort: 'impact fort', modere: 'impact modéré', general: 'général' };
  const li = actions.map((a) => `<li><span class="sleep-insight-tag ${a.tag}">${tagLabel[a.tag]}</span><span>${a.html}</span></li>`).join('');
  return `
    <div class="card">
      <div class="section-title">Plan d'action priorisé</div>
      <ul class="sleep-insight-list">${li}</ul>
    </div>`;
}

function targetsHtml(ins) {
  if (!ins) return '';
  return `
    <div class="card">
      <div class="section-title">Objectifs</div>
      <div class="sleep-target-grid">
        <div class="sleep-target-box"><div class="sleep-target-label">Coucher visé</div><div class="sleep-target-value">${ins.targetBed}</div><div class="sleep-target-sub">± 30 min</div></div>
        <div class="sleep-target-box"><div class="sleep-target-label">Lever visé</div><div class="sleep-target-value">${ins.targetWake}</div></div>
        <div class="sleep-target-box"><div class="sleep-target-label">Durée visée</div><div class="sleep-target-value">7h30–8h</div><div class="sleep-target-sub">actuel : ${fmtMin(ins.avgDurationMin)}</div></div>
      </div>
    </div>`;
}

function adviceHtml(sorted) {
  const pro = computeProInsights(sorted);
  if (!pro) return `<div class="card"><div class="sleep-state">Pas encore assez de nuits pour une analyse détaillée.</div></div>`;
  return `
    <div class="card">
      <div class="section-title">Analyse</div>
      <div class="section-subtitle">Basé sur tes ${pro.nightsCount} dernières nuits — informatif, ne remplace pas un avis médical.</div>
      ${proKpiGridHtml(pro)}
      <p class="sleep-signal-text" style="font-size:13.5px;line-height:1.55;">${synthesisText(sorted, pro)}</p>
    </div>
    ${architectureHtml(pro)}
    ${physioSignalsHtml(pro)}
    ${actionPlanHtml(sorted, pro)}
    ${targetsHtml(pro.ins)}
    <div class="sleep-disclaimer">Ces analyses s'appuient sur les mesures Garmin (montre au poignet) et des repères généraux d'hygiène du sommeil. Elles ne posent aucun diagnostic médical — en cas de doute (fatigue persistante, ronflements, SpO2 basse récurrente…), consulte un médecin.</div>
  `;
}

/* ---------- sous-onglets ---------- */
function subtabsHtml() {
  return `
    <div class="sleep-toolbar">
      <div class="sleep-subtabs" id="sleep-subtabs" role="tablist">
        <button class="sleep-subtab active" data-tab="apercu" type="button">Aperçu</button>
        <button class="sleep-subtab" data-tab="graphiques" type="button">Graphiques</button>
        <button class="sleep-subtab" data-tab="conseils" type="button">Conseils</button>
      </div>
      <button id="sleep-refresh-btn" class="comp-add-btn" type="button" title="Actualiser (synchronisé automatiquement depuis Garmin toutes les heures)">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      </button>
    </div>`;
}

function wireSleepSubtabs(root, valid) {
  const refreshBtn = root.querySelector('#sleep-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', forceSync);

  const bar = root.querySelector('#sleep-subtabs');
  if (!bar) return;
  bar.querySelectorAll('.sleep-subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.sleep-subtab').forEach((b) => b.classList.toggle('active', b === btn));
      root.querySelectorAll('.sleep-subpanel').forEach((p) => p.classList.toggle('active', p.id === 'sleep-tab-' + btn.dataset.tab));
      if (btn.dataset.tab === 'graphiques' && !_graphsRendered) {
        _graphsRendered = true;
        requestAnimationFrame(() => renderGraphCharts(valid));
      }
    });
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
  if (_scoreChart) { _scoreChart.destroy(); _scoreChart = null; }
  Object.values(_graphCharts).forEach((c) => c && c.destroy());
  _graphCharts = {};
  _graphsRendered = false;

  const sorted = nights.slice().sort((a, b) => b.date.localeCompare(a.date));
  const valid = sorted.filter((n) => n.total_sec != null);

  app.innerHTML = `
    ${subtabsHtml()}
    <div class="sleep-subpanel active" id="sleep-tab-apercu">${overviewHtml(sorted)}</div>
    <div class="sleep-subpanel" id="sleep-tab-graphiques">${graphsHtml(valid)}</div>
    <div class="sleep-subpanel" id="sleep-tab-conseils">${adviceHtml(sorted)}</div>
  `;
  attachInteractions(app);
  wireSleepSubtabs(app, valid);
  renderScoreChart(sorted);
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
  if (btn) { btn.disabled = true; btn.classList.add('syncing'); }
  await startGarminIngest({ silent: true });
  if (btn) { btn.disabled = false; btn.classList.remove('syncing'); }
}

/* ---------- synchro Garmin, réutilisable (panel Sommeil + page Connexions) ---------- */
let _garminToast = null;
function showGarminToast(message, type = 'loading') {
  if (_garminToast) _garminToast.remove();
  const toast = document.createElement('div');
  _garminToast = toast;
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
  if (type !== 'loading') setTimeout(() => { toast.remove(); if (_garminToast === toast) _garminToast = null; }, 4000);
}

async function startGarminIngest(opts = {}) {
  const silent = !!opts.silent;
  const sb = window.sb;
  if (!sb) { if (!silent) showGarminToast('Supabase non initialisé', 'error'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { if (!silent) showGarminToast('Tu dois être connecté', 'error'); return; }
  if (!silent) showGarminToast('Synchro sommeil Garmin en cours…', 'loading');
  try {
    const cfg = window.SUPABASE_CONFIG;
    const res = await fetch(`${cfg.url}/functions/v1/garmin-ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: opts.days || 3 }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error === 'no_garmin_connection' ? 'Aucun compte Garmin connecté' : `Erreur synchro Garmin : ${data.error || res.status}`;
      if (!silent) showGarminToast(msg, 'error');
      console.error('[garmin-ingest]', data);
      return;
    }
    if (!silent) showGarminToast(`Sommeil Garmin synchronisé : ${data.days_upserted || 0} nuit(s)`, 'success');
    if (document.getElementById('sleep-app')) await loadAndRender();
    if (window.refreshConnectionsIfOpen) window.refreshConnectionsIfOpen();
  } catch (e) {
    if (!silent) showGarminToast('Erreur réseau Garmin : ' + (e.message || e), 'error');
    console.error('[garmin-ingest]', e);
  }
}
window.startGarminIngest = startGarminIngest;

function initSleepPanel() {
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
