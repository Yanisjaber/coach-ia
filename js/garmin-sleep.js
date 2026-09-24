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

   La synchro forcée se fait depuis la page Connexions (carte Garmin,
   bouton "Re-synchroniser" → window.startGarminIngest, exposé en bas de
   ce fichier), pas depuis ce panel.
   ============================================================ */

const LEVEL_NAME = ['deep', 'light', 'rem', 'awake'];
const LEVEL_LABEL = { deep: 'Profond', light: 'Léger', rem: 'Paradoxal', awake: 'Éveil' };
const QUALIFIER_LABEL_FR = { EXCELLENT: 'Excellent', GOOD: 'Bon', FAIR: 'Correct', POOR: 'Faible', INVALID: 'N/D' };
const QUALIFIER_CLASS = { EXCELLENT: 'excellent', GOOD: 'good', FAIR: 'fair', POOR: 'poor', INVALID: 'invalid' };
const MY_COMPONENT_LABEL_FR = {
  duration: 'Durée', efficiency: 'Efficacité', waso: 'Éveil nocturne',
  awakenings: 'Réveils', latency: 'Endormissement', architecture: 'Architecture',
};
const MY_COMPONENT_ADVICE_FR = {
  duration: "te coucher plus tôt pour allonger la nuit — c'est le levier n°1 ici",
  efficiency: "ne te mets au lit que quand tu as sommeil, et lève-toi si tu ne t'endors pas en 20 min plutôt que de tourner",
  waso: "limiter ce qui te réveille en pleine nuit (bruit, lumière, température de la chambre) — c'est le temps éveillé après l'endormissement qui pèse ici",
  awakenings: "limiter le nombre de réveils — mêmes leviers que l'éveil nocturne (bruit, lumière, température, vessie pleine)",
  latency: "couper les écrans 30-45 min avant le coucher et éviter les activités stimulantes juste avant, pour t'endormir plus vite",
  architecture: "protéger la fin de nuit (où se concentre le sommeil paradoxal) en évitant de l'écourter",
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

/* ============================================================
   Score de sommeil "maison" — remplace le score Garmin affiché.
   100 = nuit idéale sur tous les critères. 0 = nuit blanche.

   Basé sur des seuils publiés, pas des seuils inventés :

   - Durée : Hirshkowitz et al. 2015, "National Sleep Foundation's sleep
     time duration recommendations" (Sleep Health). Adultes 18-64 ans :
     7-9h recommandé, 6-10h "peut convenir", <6h ou >10h déconseillé.

   - Efficacité, latence d'endormissement, réveils (>5 min), WASO (temps
     éveillé après l'endormissement) : Ohayon et al. 2017, "National
     Sleep Foundation's sleep quality recommendations: first report"
     (Sleep Health) — panel de consensus d'experts. Seuils adultes :
     efficacité "bonne" ≥85%, "inappropriée" <75% ; latence "appropriée"
     <30 min, "inappropriée" >45 min ; réveils >5min "appropriés" 0-1,
     "inappropriés" >4 ; WASO "approprié" <20 min (le panel n'a pas publié
     de seuil "inapproprié" chiffré pour le WASO — on reprend ~40 min,
     valeur usuelle en pratique clinique, à prendre avec plus de réserve
     que les autres seuils).

   - Architecture (% profond / % paradoxal) : ce même panel Ohayon 2017
     n'a PAS trouvé de consensus pour ériger l'architecture du sommeil en
     critère de qualité. Les cibles utilisées ici (profond ~13-23%,
     paradoxal ~20-25% du temps de sommeil) viennent de normes
     descriptives de polysomnographie (Ohayon et al. 2004, méta-analyse
     des paramètres de sommeil normaux) — un repère de population, pas
     un seuil de "qualité" validé. D'où un poids plus faible ici.

   Les signaux physio (HRV/FC/stress vs ta moyenne, SpO2) restent
   affichés dans "Signaux physiologiques" mais ne sont PAS inclus dans ce
   score : ce sont des marqueurs de récupération, pas des critères de
   qualité du sommeil au sens de cette littérature.

   Pondération : Durée 25% / Efficacité 20% / WASO 15% / Réveils 15% /
   Latence d'endormissement 10% / Architecture 15%.
   ============================================================ */
const SCORE_WEIGHTS = { duration: 0.25, efficiency: 0.20, waso: 0.15, awakenings: 0.15, latency: 0.10, architecture: 0.15 };

// Seuils Ohayon et al. 2017 (bon / repère "inapproprié" / point zéro).
// Au-delà du seuil "inapproprié" publié, la dégradation continue
// linéairement jusqu'à un point zéro (nuit extrême) plutôt que de
// tomber à 0 dès le seuil — un score continu est plus réaliste qu'un
// score en paliers.
const REF_EFF_GOOD = 85, REF_EFF_BAD = 75, REF_EFF_ZERO = 40;           // %, plus haut = mieux
const REF_LATENCY_GOOD = 15, REF_LATENCY_BAD = 45, REF_LATENCY_ZERO = 90; // min, plus bas = mieux
const REF_WASO_GOOD = 20, REF_WASO_BAD = 40, REF_WASO_ZERO = 120;        // min, plus bas = mieux
const REF_AWAKENINGS_GOOD = 1, REF_AWAKENINGS_BAD = 4, REF_AWAKENINGS_ZERO = 12; // plus bas = mieux
const REF_DURATION_GOOD = [7, 9], REF_DURATION_ZERO = [3, 13];           // h, Hirshkowitz 2015

function scoreToQualifier(v) {
  if (v >= 80) return 'EXCELLENT';
  if (v >= 65) return 'GOOD';
  if (v >= 50) return 'FAIR';
  return 'POOR';
}

// Score continu 100 → 25 entre "bon" et "inapproprié" (seuils publiés),
// puis 25 → 0 entre "inapproprié" et un point zéro au-delà.
function tierScore(value, good, bad, zero, higherIsBetter) {
  if (value == null) return null;
  if (higherIsBetter) {
    if (value >= good) return 100;
    if (value >= bad) return 25 + 75 * (value - bad) / (good - bad);
    if (value <= zero) return 0;
    return 25 * (value - zero) / (bad - zero);
  }
  if (value <= good) return 100;
  if (value <= bad) return 25 + 75 * (bad - value) / (bad - good);
  if (value >= zero) return 0;
  return 25 * (zero - value) / (zero - bad);
}

function scoreDurationComp(totalSec) {
  if (totalSec == null) return null;
  const h = totalSec / 3600;
  const [goodLo, goodHi] = REF_DURATION_GOOD;
  const [zeroLo, zeroHi] = REF_DURATION_ZERO;
  if (h >= goodLo && h <= goodHi) return 100;
  if (h < goodLo) return tierScore(h, goodLo, goodLo - 1, zeroLo, true);
  return tierScore(h, goodHi, goodHi + 1, zeroHi, false);
}

function scoreEfficiencyComp(totalSec, awakeSec) {
  const eff = sleepEfficiencyPct({ total_sec: totalSec, awake_sec: awakeSec });
  return tierScore(eff, REF_EFF_GOOD, REF_EFF_BAD, REF_EFF_ZERO, true);
}

function scoreLatencyComp(n) {
  const sol = sleepOnsetLatencyMin(n);
  return tierScore(sol, REF_LATENCY_GOOD, REF_LATENCY_BAD, REF_LATENCY_ZERO, false);
}

function scoreWasoComp(awakeSec) {
  const waso = awakeSec != null ? awakeSec / 60 : null;
  return tierScore(waso, REF_WASO_GOOD, REF_WASO_BAD, REF_WASO_ZERO, false);
}

function scoreAwakeningsComp(awakeCount) {
  return tierScore(awakeCount, REF_AWAKENINGS_GOOD, REF_AWAKENINGS_BAD, REF_AWAKENINGS_ZERO, false);
}

// Paradoxal légèrement plus pénalisant que profond dans le mélange : sur
// une nuit écourtée c'est lui qui manque en premier (il se concentre en
// fin de nuit) — mais rappel : ni l'un ni l'autre n'est un critère de
// "qualité" validé par le consensus Ohayon 2017, juste une norme
// descriptive (Ohayon 2004).
function scoreArchitectureComp(deepSec, remSec, totalSec) {
  if (!totalSec) return null;
  const deepPct = (deepSec || 0) / totalSec * 100;
  const remPct = (remSec || 0) / totalSec * 100;
  const deepScore = tierScore(deepPct, REF_DEEP_PCT[0], REF_DEEP_PCT[0] * 0.6, 0, true);
  const remScore = remPct <= REF_REM_PCT[1] + 5
    ? tierScore(remPct, REF_REM_PCT[0], REF_REM_PCT[0] * 0.6, 0, true)
    : Math.max(65, 100 - (remPct - REF_REM_PCT[1] - 5) * 3);
  return deepScore * 0.45 + remScore * 0.55;
}

function computeSleepScore(n) {
  // Nuit blanche : 0 explicite, sans dépendre des cas limites du calcul
  // pondéré (division par zéro, composants exclus faute de données...).
  if (!n.total_sec || n.total_sec <= 0) {
    return { total: 0, qualifier: 'POOR', components: {} };
  }
  const parts = [
    ['duration', scoreDurationComp(n.total_sec)],
    ['efficiency', scoreEfficiencyComp(n.total_sec, n.awake_sec)],
    ['waso', scoreWasoComp(n.awake_sec)],
    ['awakenings', scoreAwakeningsComp(n.awake_count)],
    ['latency', scoreLatencyComp(n)],
    ['architecture', scoreArchitectureComp(n.deep_sec, n.rem_sec, n.total_sec)],
  ];
  let sum = 0, totalW = 0;
  const components = {};
  parts.forEach(([key, val]) => {
    if (val == null) return;
    sum += val * SCORE_WEIGHTS[key]; totalW += SCORE_WEIGHTS[key];
    components[key] = Math.round(val);
  });
  if (!totalW) return null;
  const total = Math.round(sum / totalW);
  return { total, qualifier: scoreToQualifier(total), components };
}

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

function nightTicksHtml(bedtimeClock, totalMin) {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const min = totalMin * f;
    const [bh, bm] = (bedtimeClock || '0:0').split(':').map(Number);
    const total = bh * 60 + bm + min;
    const hh = Math.floor((total / 60) % 24), mm = Math.round(total % 60);
    return `<span>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</span>`;
  }).join('');
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
  return `<div>${rows}</div><div class="sleep-hypno-ticks">${nightTicksHtml(bedtimeClock, totalMin)}</div>`;
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

// Les 5 données les plus indicatives d'une nuit (cf. Ohayon et al. 2017
// pour l'efficacité/éveil nocturne, + HRV/FC/SpO2 comme signaux de
// récupération et d'alerte les plus fiables sur un wearable au poignet).
function keyStatsHtml(n) {
  const eff = sleepEfficiencyPct(n);
  const item = (label, val, unit) => `<div><div class="sleep-detail-label">${label}</div><div class="sleep-detail-value">${val != null ? val : '—'}${val != null && unit ? `<span class="kpi-unit">${unit}</span>` : ''}</div></div>`;
  return `
    <div class="card">
      <div class="sleep-key-stats">
        ${item('Effic.', eff != null ? Math.round(eff) : null, '%')}
        ${item('HRV', n.hrv_avg != null ? Math.round(n.hrv_avg) : null, 'ms')}
        ${item('FC moy.', n.avg_heart_rate != null ? Math.round(n.avg_heart_rate) : null, 'bpm')}
        ${item('FCR', n.resting_heart_rate != null ? Math.round(n.resting_heart_rate) : null, 'bpm')}
        ${item('Stress', n.avg_stress != null ? Math.round(n.avg_stress) : null, null)}
      </div>
    </div>`;
}

function heroHtml(n) {
  const my = n.myScore;
  const st = scoreStatus(my && my.qualifier);
  const subLabel = n.date === _latestDate ? 'dernière nuit' : 'nuit sélectionnée';
  return `
    <div class="sleep-hero-head">
      <div class="sleep-hero-date">${dowFr(n.date)} ${dateShort(n.date)} <span class="sub">— ${subLabel}</span></div>
      <div class="sleep-score-pill ${st}" title="Score maison, indépendant de Garmin (durée, efficacité, WASO, réveils, endormissement, architecture)"><span class="n">${my ? my.total : '—'}</span>${my ? QUALIFIER_LABEL_FR[my.qualifier] : ''}</div>
    </div>
    ${sleepArcHtml(n)}
    ${keyStatsHtml(n)}
    ${phaseBarHtml(n)}
    ${phaseGridHtml(n)}
    <div class="sleep-hero-hypno">
      <div class="sleep-hero-hypno-title">Chronologie de la nuit</div>
      ${hypnoHtml(n)}
      ${n.hr_stream && n.hr_stream.length ? `
        <div class="sleep-night-hr-title">FC pendant la nuit</div>
        <div class="sleep-night-hr-wrap"><canvas id="sleep-night-hr-chart"></canvas></div>
      ` : ''}
      <button class="btn-secondary sleep-detail-btn" type="button" id="sleep-open-detail">Analyse détaillée</button>
    </div>`;
}

function detailStatsHtml(bpms) {
  if (!bpms.length) return '';
  const avgBpm = Math.round(avg(bpms)), minBpm = Math.min(...bpms), maxBpm = Math.max(...bpms);
  const item = (label, val) => `<div><span class="sleep-detail-label">${label}</span> <strong>${val}</strong> <span class="kpi-unit">bpm</span></div>`;
  return `<div class="sleep-detail-stream-stats">${item('Moy', avgBpm)}${item('Min', minBpm)}${item('Max', maxBpm)}</div>`;
}

let _detailChart = null;
function closeNightDetailModal() {
  document.getElementById('_sleep-detail-modal')?.remove();
  if (_detailChart) { _detailChart.destroy(); _detailChart = null; }
}

function openNightDetailModal(n) {
  closeNightDetailModal();
  const hasStream = n.hr_stream && n.hr_stream.length;
  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.id = '_sleep-detail-modal';
  overlay.innerHTML = `
    <div class="day-modal" style="width:640px;max-width:calc(100vw - 32px);">
      <div class="day-modal-header">
        <h3>${dowFr(n.date)} ${dateShort(n.date)} — minute par minute</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        ${hasStream ? `
          ${detailStatsHtml(n.hr_stream.map((p) => p[1]))}
          <div class="section-title" style="margin-top:14px;margin-bottom:8px;">Fréquence cardiaque</div>
          <div class="chart-wrap" style="height:260px;"><canvas id="sleep-detail-hr-chart"></canvas></div>
          <div class="sleep-hypno-ticks">${nightTicksHtml((n.bedtime || '').split(' ')[1], Math.max(...n.hr_stream.map((p) => p[0])))}</div>
        ` : `<div class="sleep-state">Pas de données minute par minute pour cette nuit. Resynchronise (Connexions → Garmin) pour la récupérer sur les prochaines nuits.</div>`}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.day-modal-close').addEventListener('click', closeNightDetailModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeNightDetailModal(); });

  if (hasStream && typeof Chart !== 'undefined') {
    const canvas = document.getElementById('sleep-detail-hr-chart');
    _detailChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: n.hr_stream.map((p) => p[0]),
        datasets: [{ data: n.hr_stream.map((p) => p[1]), borderColor: '#f87171', backgroundColor: 'transparent', fill: false, tension: 0.25, pointRadius: 0, borderWidth: 1.5 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { display: false }, y: gridScale({ ticks: { color: CHART_AXIS_LABEL } }) },
        plugins: { legend: legend(false) },
      },
    });
  }
}

function wireNightDetailButton(root, n) {
  const btn = root.querySelector('#sleep-open-detail');
  if (btn) btn.onclick = () => openNightDetailModal(n);
}

let _nightHrChart = null;
function renderNightHrChart(n) {
  if (_nightHrChart) { _nightHrChart.destroy(); _nightHrChart = null; }
  const canvas = document.getElementById('sleep-night-hr-chart');
  if (!canvas || typeof Chart === 'undefined' || !n || !n.hr_stream || !n.hr_stream.length) return;
  const pts = n.hr_stream;
  _nightHrChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: pts.map((p) => p[0]),
      datasets: [{ data: pts.map((p) => p[1]), borderColor: '#f87171', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { display: false },
        y: gridScale({ ticks: { color: CHART_AXIS_LABEL, font: { size: 10 } } }),
      },
      plugins: { legend: legend(false), tooltip: { enabled: false } },
    },
  });
}

// Détail chiffré d'une nuit (efficacité, endormissement, réveils...) +
// chips par composante du score — affiché sous le calendrier pour la
// nuit sélectionnée (remplace l'ancien accordéon de la liste Historique).
function nightExtraStatsHtml(n) {
  // Efficacité, HRV, FC, Stress sont déjà dans les indicateurs clés en
  // haut de la carte — pas repris ici pour éviter le doublon. Et plus de
  // chips de score à côté (même mot que les valeurs brutes mais un
  // nombre différent = confusion, cf. retour utilisateur).
  const sol = sleepOnsetLatencyMin(n);
  return `
    <div class="card">
      <div class="section-title">Détail</div>
      <div class="sleep-detail-grid">
        <div><div class="sleep-detail-label">Endormissement</div><div class="sleep-detail-value">${sol != null ? sol + ' min' : '—'}</div></div>
        <div><div class="sleep-detail-label">Réveils</div><div class="sleep-detail-value">${n.awake_count ?? '—'}</div></div>
        <div><div class="sleep-detail-label">Agitation</div><div class="sleep-detail-value">${n.restless_count ?? '—'} mvts</div></div>
        <div><div class="sleep-detail-label">Respiration</div><div class="sleep-detail-value">${n.resp_avg ?? '—'} /min</div></div>
        <div><div class="sleep-detail-label">SpO2</div><div class="sleep-detail-value">${n.spo2_avg != null ? n.spo2_avg + '%' : '—'}</div></div>
        <div><div class="sleep-detail-label">Body Battery</div><div class="sleep-detail-value">${n.body_battery_change != null ? '+' + n.body_battery_change : '—'}</div></div>
      </div>
    </div>`;
}

/* ---------- Calendrier (sélecteur de nuit) ---------- */
function monthOf(dateStr) { return dateStr.slice(0, 7); }
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabelFr(ym) {
  const [y, m] = ym.split('-').map(Number);
  const names = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${names[m - 1]} ${y}`;
}

function calendarHtml(nightsByDate, ym, selectedDate) {
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  let dow = new Date(y, m - 1, 1).getDay();
  dow = (dow + 6) % 7; // 0=Lundi ... 6=Dimanche
  const cells = [];
  for (let i = 0; i < dow; i++) cells.push('<div class="cal-day empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = nightsByDate.get(ds);
    if (!n || !n.myScore) {
      cells.push(`<div class="cal-day nodata">${d}</div>`);
    } else {
      const st = scoreStatus(n.myScore.qualifier);
      const sel = ds === selectedDate ? ' selected' : '';
      cells.push(`<div class="cal-day ${st}${sel}" data-date="${ds}" role="button" tabindex="0">${d}</div>`);
    }
  }
  return `
    <div class="card">
      <div class="sleep-cal-head">
        <button class="sleep-cal-nav" data-nav="-1" type="button" aria-label="Mois précédent">‹</button>
        <div class="section-title" style="margin:0;">${monthLabelFr(ym)}</div>
        <button class="sleep-cal-nav" data-nav="1" type="button" aria-label="Mois suivant">›</button>
      </div>
      <div class="sleep-cal-grid">
        <div class="sleep-cal-dow">L</div><div class="sleep-cal-dow">M</div><div class="sleep-cal-dow">M</div><div class="sleep-cal-dow">J</div><div class="sleep-cal-dow">V</div><div class="sleep-cal-dow">S</div><div class="sleep-cal-dow">D</div>
        ${cells.join('')}
      </div>
      <div class="sleep-cal-legend-row">
        <div class="sleep-cal-legend">
          <span><span class="sw critical"></span>Faible</span>
          <span><span class="sw warning"></span>Correct</span>
          <span><span class="sw good"></span>Bon</span>
        </div>
        ${selectedDate !== _latestDate ? `<button class="sleep-cal-today" type="button" data-today="1">↺ Dernière nuit</button>` : ''}
      </div>
    </div>`;
}

let _calState = { month: null, selected: null };
let _latestDate = null;

function wireCalendar(root, sorted) {
  const byDate = new Map(sorted.map((n) => [n.date, n]));
  const wrap = root.querySelector('#sleep-cal-wrap');
  if (!wrap) return;
  const selectNight = (ds) => {
    const n = byDate.get(ds);
    if (!n) return;
    _calState.selected = ds;
    const hero = root.querySelector('#sleep-hero-card');
    if (hero) hero.innerHTML = heroHtml(n);
    renderNightHrChart(n);
    wireNightDetailButton(root, n);
    const extra = root.querySelector('#sleep-extra-stats');
    if (extra) extra.innerHTML = nightExtraStatsHtml(n);
    wrap.innerHTML = calendarHtml(byDate, _calState.month, _calState.selected);
  };
  wrap.addEventListener('click', (e) => {
    const dayEl = e.target.closest('.cal-day[data-date]');
    if (dayEl) { selectNight(dayEl.dataset.date); return; }
    const todayEl = e.target.closest('.sleep-cal-today');
    if (todayEl) { _calState.month = monthOf(_latestDate); selectNight(_latestDate); return; }
    const navEl = e.target.closest('.sleep-cal-nav[data-nav]');
    if (navEl) {
      _calState.month = shiftMonth(_calState.month, Number(navEl.dataset.nav));
      wrap.innerHTML = calendarHtml(byDate, _calState.month, _calState.selected);
    }
  });
}

/* ---------- Aperçu : onglet 1 ---------- */
function overviewHtml(sorted) {
  const latest = sorted[0];
  _calState.month = _calState.month || monthOf(latest.date);
  _calState.selected = _calState.selected || latest.date;
  const byDate = new Map(sorted.map((n) => [n.date, n]));
  const selectedNight = byDate.get(_calState.selected) || latest;
  return `
    <div class="card" id="sleep-hero-card">${heroHtml(selectedNight)}</div>
    <div id="sleep-cal-wrap">${calendarHtml(byDate, _calState.month, _calState.selected)}</div>
    <div id="sleep-extra-stats">${nightExtraStatsHtml(selectedNight)}</div>
  `;
}

/* ---------- Graphiques : onglet 2 ---------- */
// Thème partagé par tous les graphiques Chart.js du panel : mêmes
// couleurs de grille/texte, même style de légende. Un seul endroit à
// modifier pour que tous les graphiques restent visuellement cohérents.
const CHART_GRID = '#232a3a';
const CHART_AXIS_LABEL = '#8b94a8';
function legend(show) {
  return show
    ? { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: CHART_AXIS_LABEL } }
    : { display: false };
}
function gridScale(extra) { return Object.assign({ grid: { color: CHART_GRID } }, extra); }
function noGridScale(extra) { return Object.assign({ grid: { display: false } }, extra); }
function groupStats(list) {
  const effList = list.map(sleepEfficiencyPct).filter((v) => v != null);
  return {
    n: list.length,
    durSec: avg(list.map((n) => n.total_sec).filter((v) => v != null)),
    score: avg(list.map((n) => n.myScore && n.myScore.total).filter((v) => v != null)),
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
    ${chartCard('chart-sleep-duration-score', 'Durée & score', 'Score maison (Hirshkowitz 2015, Ohayon 2017 — pas Garmin) en ligne, durée de sommeil en barres. 10 dernières nuits.')}
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
        { type: 'line', label: 'Score', data: bars.map((n) => n.myScore && n.myScore.total), borderColor: '#4ade80', backgroundColor: 'transparent', yAxisID: 'y1', fill: false, tension: 0.3, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: gridScale({ position: 'left', title: { display: true, text: 'h', color: CHART_AXIS_LABEL } }),
        y1: { position: 'right', min: 0, max: 100, title: { display: true, text: 'score', color: CHART_AXIS_LABEL }, grid: { drawOnChartArea: false } },
        x: noGridScale(),
      },
      plugins: { legend: legend(true) },
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
        x: noGridScale({ stacked: true }),
        y: gridScale({ stacked: true, min: 0, max: 100 }),
      },
      plugins: { legend: legend(true) },
    },
  });

  const hrvVals = lines.map((n) => n.hrv_avg);
  const hrvBaseline = avg(hrvVals.filter((v) => v != null));
  mk('chart-sleep-hrv', {
    type: 'line',
    data: {
      labels: labelsLines,
      datasets: [
        { label: 'HRV', data: hrvVals, borderColor: '#a78bfa', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 2 },
        { label: 'Moyenne période', data: hrvVals.map(() => hrvBaseline), borderColor: '#5a6378', borderDash: [5, 4], pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: gridScale(), x: noGridScale() },
      plugins: { legend: legend(true) },
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
      scales: { y: gridScale(), x: noGridScale() },
      plugins: { legend: legend(true) },
    },
  });

  mk('chart-sleep-spo2', {
    type: 'line',
    data: {
      labels: labelsLines,
      datasets: [
        { label: 'SpO2 moy.', data: lines.map((n) => n.spo2_avg), borderColor: '#4ade80', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 2 },
        { label: 'Seuil 95%', data: lines.map(() => REF_SPO2_GOOD), borderColor: '#5a6378', borderDash: [5, 4], pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: gridScale({ min: 85, max: 100 }), x: noGridScale() },
      plugins: { legend: legend(true) },
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
      scales: { y: gridScale({ min: 0, max: 100 }), x: noGridScale() },
      plugins: { legend: legend(false) },
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

  // Composant le plus faible du score maison (pas celui de Garmin) : moyenne
  // de chaque composant (0-100) sur les nuits dispo, on prend le plus bas.
  const compScores = {};
  withDetail.forEach((n) => {
    const comps = n.myScore && n.myScore.components;
    if (!comps) return;
    Object.keys(comps).forEach((k) => {
      (compScores[k] = compScores[k] || []).push(comps[k]);
    });
  });
  let weakest = null, weakestAvg = 101;
  Object.keys(compScores).forEach((k) => {
    const a = avg(compScores[k]);
    if (a < weakestAvg) { weakestAvg = a; weakest = k; }
  });

  const avgRemPct = avg(withDetail.map((n) => n.total_sec ? (n.rem_sec || 0) / n.total_sec * 100 : null));

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
  const withScore = sorted.filter((n) => n.myScore != null).slice(0, 14);
  if (!withScore.length) return "Pas encore assez de nuits scorées pour une synthèse.";
  const avgScore = Math.round(avg(withScore.map((n) => n.myScore.total)));
  const qualWord = avgScore >= 80 ? 'bon' : avgScore >= 65 ? 'correct' : avgScore >= 50 ? 'modéré' : 'faible';
  let s = `Sur tes ${withScore.length} dernières nuits, ton sommeil est en moyenne <strong>${qualWord}</strong> (score moyen ${avgScore}/100).`;
  if (pro.ins && pro.ins.weakest && MY_COMPONENT_ADVICE_FR[pro.ins.weakest]) {
    s += ` Le facteur qui pèse le plus sur ce score : <strong>${MY_COMPONENT_LABEL_FR[pro.ins.weakest].toLowerCase()}</strong>.`;
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
  if (ins && ins.weakest && MY_COMPONENT_ADVICE_FR[ins.weakest]) {
    actions.push({ tag: 'fort', html: `<strong>Priorité n°1 :</strong> ${MY_COMPONENT_ADVICE_FR[ins.weakest]}. C'est le point qui a le plus pénalisé ton score sur tes ${ins.nightsCount} dernières nuits.` });
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
    <div class="sleep-disclaimer">Score et analyses basés sur les mesures Garmin (montre au poignet), recalculés selon des seuils publiés : Hirshkowitz et al. 2015 (durée, National Sleep Foundation) et Ohayon et al. 2017 (efficacité, latence d'endormissement, réveils, éveil nocturne — consensus d'experts National Sleep Foundation). L'architecture profond/paradoxal suit des normes descriptives de polysomnographie, pas un seuil de qualité validé par ce consensus — pondérée en conséquence. Ce n'est pas un diagnostic médical — en cas de doute (fatigue persistante, ronflements, SpO2 basse récurrente…), consulte un médecin.</div>
  `;
}

/* ---------- sous-onglets ---------- */
function subtabsHtml() {
  return `
    <div class="sleep-subtabs" id="sleep-subtabs" role="tablist">
      <button class="sleep-subtab active" data-tab="apercu" type="button">Aperçu</button>
      <button class="sleep-subtab" data-tab="graphiques" type="button">Graphiques</button>
      <button class="sleep-subtab" data-tab="conseils" type="button">Conseils</button>
    </div>`;
}

function wireSleepSubtabs(root, valid) {
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

function render(nights) {
  const app = document.getElementById('sleep-app');
  if (!app) return;
  if (!nights.length) {
    app.innerHTML = `<div class="card"><div class="sleep-state">Aucune nuit synchronisée pour l'instant. La synchro se fait automatiquement toutes les heures depuis Garmin.</div></div>`;
    return;
  }
  Object.values(_graphCharts).forEach((c) => c && c.destroy());
  _graphCharts = {};
  _graphsRendered = false;
  if (_nightHrChart) { _nightHrChart.destroy(); _nightHrChart = null; }
  _calState = { month: null, selected: null };

  const sorted = nights.slice().sort((a, b) => b.date.localeCompare(a.date));
  const valid = sorted.filter((n) => n.total_sec != null);
  sorted.forEach((n) => { n.myScore = computeSleepScore(n); });
  _latestDate = sorted[0].date;

  app.innerHTML = `
    ${subtabsHtml()}
    <div class="sleep-subpanel active" id="sleep-tab-apercu">${overviewHtml(sorted)}</div>
    <div class="sleep-subpanel" id="sleep-tab-graphiques">${graphsHtml(valid)}</div>
    <div class="sleep-subpanel" id="sleep-tab-conseils">${adviceHtml(sorted)}</div>
  `;
  wireCalendar(app, sorted);
  wireSleepSubtabs(app, valid);
  const _initialNight = sorted.find((n) => n.date === _calState.selected) || sorted[0];
  renderNightHrChart(_initialNight);
  wireNightDetailButton(app, _initialNight);
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

/* ---------- synchro Garmin, réutilisable depuis la page Connexions ---------- */
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
