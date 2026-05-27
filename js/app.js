/* ============================================================
   js/app.js — Module principal (refactoring Phase 2)

   Extrait du <script> inline de dashboard.html.
   Chargé via <script type="module" src="js/app.js"></script>.

   Notes :
   - Mode module ES6 (strict mode automatique).
   - data.js et streams.js sont chargés AVANT et exposent
     window.DASHBOARD_DATA et window.STREAMS_CACHE.
   - Les librairies (Chart.js, Leaflet, Flatpickr) sont accessibles
     via window.Chart, window.L, window.flatpickr.

   Phase 3 : ce fichier sera ensuite découpé en modules
   thématiques (utils, state, dashboard/, calendar/, modals/, etc.)
   ============================================================ */

// ========= UTILS =========
// Sortis dans js/utils.js — importés ici pour rester disponibles dans tout le module.
import { rand, randInt, clamp, fmtDate } from './utils.js';

// ========= SUPABASE (client + auth + storage adapter) =========
// Doit être chargé EN PREMIER pour que les autres modules aient accès à window.sb.
import './supabase-client.js';
import './auth.js';
import './storage-adapter.js';

// ========= MODE IA / MANUEL =========
// Sorti dans js/app-mode.js. Auto-bootstrap au DOMContentLoaded à l'import.
import './app-mode.js';

// ========= WELLNESS MANUEL =========
// Sorti dans js/wellness.js (storage) + js/wellness-ui.js (UI).
// Auto-bootstrap au DOMContentLoaded à l'import.
import './wellness-ui.js';

// ========= WORKOUT BUILDER (séances structurées par blocs) =========
// Sorti dans js/workout-builder.js. Expose window.getCurrentWorkoutStructure().
import './workout-builder.js';

// ========= POWER PROFILE (Mean Maximal Power) =========
// Lit window.DASHBOARD_DATA.power_profile (généré par fetch_data.py).
// Auto-render au DOMContentLoaded.
import './power-profile.js';

// ========= DAY EXTRAS (actions rapides sur un jour du calendrier) =========
// Bouton "+" au hover, popover : ajouter entraînement / note / repos / cycle (phase).
// Auto-bootstrap + MutationObserver sur #week-calendar pour ré-attacher après chaque render.
import './day-extras.js';

// ========= BILAN ANNUEL (nouvelle page p3, remplace Tendances long-terme) =========
// KPIs YTD vs N-1, objectifs annuels, records, cumul kilométrique annuel.
import './bilan.js';


// ========= DATA LOADER (data.js via window.DASHBOARD_DATA) =========
// Sorti dans js/data-loader.js.
import { loadData } from './data-loader.js';

// ========= MAIN (IIFE async) =========
(async () => {
const _allData = await loadData();
let data = _allData;
let todayData = _allData[_allData.length - 1];
// today = vraie date du jour (système), à minuit local. Réassignable pour refresh à minuit.
function getRealToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
let today = getRealToday();
// Filtre sports actif (Set : 'tout' OU sous-ensemble de cyclisme/course/musculation)
const activeSports = new Set(['tout']);
// Exposé pour les modules externes (bilan.js etc.) qui doivent respecter le filtre.
window.activeSports = activeSports;

// Programmation du refresh automatique à minuit
function scheduleMidnightRefresh() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 5, 0); // 5 secondes après minuit pour éviter les edge-cases
  const msUntilMidnight = nextMidnight - now;
  setTimeout(() => {
    today = getRealToday();
    // Refresh des vues qui dépendent de "today"
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof renderCompList === 'function') renderCompList();
    // Met à jour le timestamp affiché en header si présent
    const tsEl = document.getElementById('header-date');
    if (tsEl) tsEl.textContent = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    // Reprogramme pour la prochaine minuit
    scheduleMidnightRefresh();
  }, msUntilMidnight);
}
scheduleMidnightRefresh();

// Re-render des vues qui dépendent du mode IA/Manuel quand on bascule le toggle.
// L'event 'appModeChange' est dispatché par js/app-mode.js à chaque applyAppMode().
window.addEventListener('appModeChange', () => {
  if (typeof renderCalendar === 'function') renderCalendar();
});

// Sécurité : si la machine sort de veille / change de timezone, re-vérifier au focus
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const real = getRealToday();
    if (real.getTime() !== today.getTime()) {
      today = real;
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderCompList === 'function') renderCompList();
    }
  }
});

// ========= DATA GENERATION (fallback simulé, code mort) =========
// Sorti dans js/data-generation.js. Importer { generateData } depuis là si besoin.

// ========= HERO KPI =========
document.getElementById('today-date').textContent = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function renderHeroKpi() {
const hasRecovery = todayData.recovery != null;
document.getElementById('recovery-val').textContent = hasRecovery ? todayData.recovery + '%' : '—';
const ringDash = 213.6;
if (hasRecovery) {
  document.getElementById('recovery-ring').style.strokeDashoffset = ringDash * (1 - todayData.recovery / 100);
  const recColor = todayData.recovery > 66 ? 'var(--accent)' : todayData.recovery > 33 ? 'var(--warn)' : 'var(--danger)';
  document.getElementById('recovery-ring').style.stroke = recColor;
} else {
  document.getElementById('recovery-ring').style.strokeDashoffset = ringDash;
  document.getElementById('recovery-ring').style.stroke = 'var(--text-mute)';
}
document.getElementById('hrv-val').textContent = todayData.hrv != null ? todayData.hrv + ' ms' : '— ms';
document.getElementById('sleep-val').textContent = todayData.sleepH != null
  ? todayData.sleepH + ' h' + (todayData.sleepQ != null ? ' (qualité ' + todayData.sleepQ + '%)' : '')
  : '— h';

document.getElementById('tsb-val').textContent = (todayData.tsb >= 0 ? '+' : '') + todayData.tsb.toFixed(0);
const tsbState = todayData.tsb > 5 ? 'Frais · prêt à performer' : todayData.tsb > -10 ? 'Optimal · zone de progression' : todayData.tsb > -25 ? 'Fatigué · vigilance' : 'Surchargé · décharge recommandée';
const tsbClass = todayData.tsb > 5 ? 'up' : todayData.tsb < -20 ? 'down' : '';
const tsbEl = document.getElementById('tsb-state');
tsbEl.textContent = tsbState;
tsbEl.className = 'kpi-trend ' + tsbClass;
document.getElementById('ctl-val').textContent = todayData.ctl.toFixed(0);
document.getElementById('atl-val').textContent = todayData.atl.toFixed(0);

const last7 = data.slice(-7);
const weeklyTSS = last7.reduce((s,d)=>s+d.tss,0);
const prev7 = data.slice(-14,-7);
const prevTSS = prev7.reduce((s,d)=>s+d.tss,0);
const trendPct = ((weeklyTSS - prevTSS) / prevTSS * 100).toFixed(0);
document.getElementById('weekly-tss').textContent = weeklyTSS;
const trendEl = document.getElementById('weekly-trend');
trendEl.textContent = (trendPct > 0 ? '↑ +' : '↓ ') + trendPct + '% vs semaine précédente';
trendEl.className = 'kpi-trend ' + (trendPct > 5 ? 'up' : trendPct < -5 ? 'down' : '');
document.getElementById('weekly-sessions').textContent = last7.filter(d => d.tss > 0).length;
document.getElementById('weekly-hours').textContent = (last7.reduce((s,d)=>s+(d.duration||0),0)/60).toFixed(1) + ' h';

// Dernière séance — bloc en haut à gauche du hero
const lastSession = [...data].reverse().find(d => d.sessionType);
const dateEl = document.getElementById('last-session-date');
const nameEl = document.getElementById('last-session-name');
const metricsEl = document.getElementById('last-session-metrics');
if (!lastSession) {
  dateEl.textContent = '';
  nameEl.innerHTML = '<span class="ls-empty">Aucune séance dans la période</span>';
  metricsEl.innerHTML = '';
} else {
  const daysSince = Math.round((today - lastSession.date) / 86400000);
  const dateStr = daysSince === 0 ? "Aujourd'hui"
                : daysSince === 1 ? "Hier"
                : `Il y a ${daysSince} jours`;
  dateEl.textContent = `${dateStr} · ${lastSession.date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  nameEl.textContent = lastSession.sessionName || 'Séance';

  const dur = lastSession.duration || 0;
  const h = Math.floor(dur / 60);
  const m = (dur % 60).toString().padStart(2, '0');
  const metrics = [];
  if (lastSession.tss) metrics.push(`<div class="ls-metric"><div class="ls-val">${lastSession.tss}</div><div class="ls-lbl">TSS</div></div>`);
  if (dur) metrics.push(`<div class="ls-metric"><div class="ls-val">${h}h${m}</div><div class="ls-lbl">Durée</div></div>`);
  if (lastSession.np) metrics.push(`<div class="ls-metric"><div class="ls-val">${lastSession.np}<span style="font-size:13px;font-weight:500;">W</span></div><div class="ls-lbl">NP</div></div>`);
  if (lastSession.hr) metrics.push(`<div class="ls-metric"><div class="ls-val">${lastSession.hr}<span style="font-size:13px;font-weight:500;">bpm</span></div><div class="ls-lbl">FC moy</div></div>`);
  metricsEl.innerHTML = metrics.join('');
}
}
renderHeroKpi();

// ========= CHART DEFAULTS =========
Chart.defaults.color = '#8b94a8';
Chart.defaults.borderColor = '#232a3a';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
// Tooltips : ronds pleins au lieu de carrés pour les indicateurs de série
Chart.defaults.plugins.tooltip.usePointStyle = true;
Chart.defaults.plugins.tooltip.boxPadding = 6;

// ========= PLUGIN : LIGNE VERTICALE AU HOVER =========
Chart.register({
  id: 'verticalHoverLine',
  afterDraw: (chart) => {
    if (chart.config.options?.plugins?.verticalHoverLine === false) return;
    if (!chart.tooltip || !chart.tooltip._active || chart.tooltip._active.length === 0) return;
    const ctx = chart.ctx;
    const x = chart.tooltip._active[0].element.x;
    const topY = chart.chartArea.top;
    const bottomY = chart.chartArea.bottom;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, bottomY);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(139, 148, 168, 0.5)';
    ctx.stroke();
    ctx.restore();
  }
});
// Forcer le remplissage avec la couleur de la courbe / barre (sinon intérieur transparent / "blanc")
Chart.defaults.plugins.tooltip.callbacks = Chart.defaults.plugins.tooltip.callbacks || {};
Chart.defaults.plugins.tooltip.callbacks.labelColor = function(context) {
  // Priorité : couleur spécifique de la barre survolée si backgroundColor est un array,
  // sinon borderColor de la courbe, sinon backgroundColor unique.
  const ds = context.dataset;
  let color;
  if (Array.isArray(ds.backgroundColor)) {
    color = ds.backgroundColor[context.dataIndex];
  } else {
    color = ds.borderColor || ds.backgroundColor || '#888';
  }
  return {
    borderColor: color,
    backgroundColor: color,
    borderWidth: 0,
    borderRadius: 0
  };
};

const labels = data.map(d => fmtDate(d.date));

// ========= FILTRE SPORTS =========
function getSportFromDay(d) {
  // Prefer d.sport (nouveau format), fallback sur d.sessionType (ancien data.js)
  if (d.sport) return d.sport;
  if (!d.sessionType) return null;
  if (d.sessionType === 'force') return 'musculation';
  if (d.sessionType === 'mobilite') return 'mobilite';
  if (d.sessionType === 'natation') return 'natation';
  return 'cyclisme'; // par défaut, sessions cycling-like
}

// Helper : convertit un sport (catégorie minuscule OU format Strava 'Ride'/'Run'/...)
// en catégorie de filtre ('cyclisme'/'course'/'musculation'/'natation'/'autre').
// Utilisé partout où on doit comparer un sport à activeSports.
function getSportCategory(sport) {
  if (!sport) return 'cyclisme'; // par défaut (templates AI sans sport = cyclisme)
  const s = String(sport);
  const lower = s.toLowerCase();
  if (['cyclisme', 'course', 'musculation', 'natation', 'autre', 'mobilite'].includes(lower)) return lower;
  const entry = window.SPORTS_CATALOG && window.SPORTS_CATALOG[s];
  return entry ? entry.category : 'autre';
}

function applySportFilter() {
  // Reset des index activité par jour (les arrays changent selon le filtre)
  Object.keys(dayActivityIndex).forEach(k => delete dayActivityIndex[k]);

  if (activeSports.has('tout') || activeSports.size === 0) {
    data = _allData;
  } else {
    // 1. Construire la vue filtrée : filtre par ACTIVITÉ (granularité fine)
    const filtered = _allData.map(d => {
      // Pas d'activités du tout → jour de repos, on garde
      if (!d.activities || d.activities.length === 0) {
        // Fallback : si pas d'array activities mais sessionType présent, utiliser sport racine
        if (d.sessionType) {
          const sport = getSportFromDay(d);
          if (sport && !activeSports.has(sport)) {
            return {
              ...d,
              tss: 0, duration: 0, zones: null, zones_hr: null, zones_power: null,
              sessionType: null, sessionName: null,
              np: 0, avgW: 0, hr: 0, ftpPct: 0, compliance: null, intensity: 0,
              activities: []
            };
          }
        }
        return { ...d };
      }

      // Filtrer les activités qui matchent les sports actifs
      const matchingActs = d.activities.filter(a => activeSports.has(a.sport));

      if (matchingActs.length === 0) {
        // Aucune activité ne correspond → jour vidé
        return {
          ...d,
          tss: 0, duration: 0, zones: null, zones_hr: null, zones_power: null,
          sessionType: null, sessionName: null,
          np: 0, avgW: 0, hr: 0, ftpPct: 0, compliance: null, intensity: 0,
          activities: []
        };
      }

      // Au moins une activité matche : recomposer le jour avec les activités filtrées
      const main = matchingActs[0]; // déjà triées par TSS desc côté Python
      const totalTss = matchingActs.reduce((s, a) => s + (a.tss || 0), 0);
      const totalDur = matchingActs.reduce((s, a) => s + (a.duration || 0), 0);

      return {
        ...d,
        tss: totalTss,
        duration: totalDur,
        sessionName: main.name,
        sessionType: main.type,
        sport: main.sport,
        np: main.np || 0,
        hr: main.hr || 0,
        ftpPct: main.ftpPct || 0,
        zones: main.zones_hr || main.zones_power || null,
        zones_hr: main.zones_hr || null,
        zones_power: main.zones_power || null,
        activities: matchingActs
      };
    });

    // 2. Recalculer CTL/ATL/TSB sur les TSS filtrés (EWMA : 42j pour CTL, 7j pour ATL)
    let ctl = 0, atl = 0;
    filtered.forEach(d => {
      const t = d.tss || 0;
      ctl = ctl + (t - ctl) / 42;
      atl = atl + (t - atl) / 7;
      d.ctl = +ctl.toFixed(1);
      d.atl = +atl.toFixed(1);
      d.tsb = +(ctl - atl).toFixed(1);
    });

    data = filtered;
  }
  // Mettre à jour todayData (pointe sur le dernier jour de la vue filtrée)
  todayData = data[data.length - 1];
  rerenderFilteredCharts();
}

function rerenderFilteredCharts() {
  if (typeof renderHeroKpi === 'function') renderHeroKpi();
  if (typeof renderLoadChart === 'function') renderLoadChart(getInputDate('load-from'), getInputDate('load-to'));
  if (typeof renderHoursChart === 'function') renderHoursChart(getInputDate('hours-from'), getInputDate('hours-to'));
  if (typeof renderWeeklyChart === 'function') renderWeeklyChart(getInputDate('weekly-from'), getInputDate('weekly-to'));
  if (typeof renderZones === 'function') renderZones(getInputDate('zones-from'), getInputDate('zones-to'));
  if (typeof renderSessionsTable === 'function') renderSessionsTable();
  if (typeof renderCalendar === 'function') renderCalendar();
  // Page Bilan : KPIs annuels, records, chart cumul → filtrés par sport actif
  if (typeof window.renderBilan === 'function') window.renderBilan();
}

// ========= HELPERS DATE RANGE =========
// Important : utiliser les composantes LOCALES (pas UTC) pour éviter
// le décalage de fuseau horaire (ex: minuit local CEST → veille UTC).
const toIsoDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fmtShortDate = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
function sliceByDate(arr, fromIso, toIso) {
  return arr.filter(d => {
    const iso = toIsoDate(d.date);
    return iso >= fromIso && iso <= toIso;
  });
}
function setInputDate(id, d) {
  document.getElementById(id).value = toIsoDate(d);
}
function getInputDate(id) {
  return document.getElementById(id).value;
}

// ========= CHART 1: CTL/ATL/TSB + Recovery (filtrable par dates) =========
const loadChart = new Chart(document.getElementById('chart-load'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'CTL', data: [], borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)', cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#60a5fa', fill: true, yAxisID: 'y' },
      { label: 'ATL', data: [], borderColor: '#fbbf24', backgroundColor: 'transparent', cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#fbbf24', yAxisID: 'y' },
      { label: 'TSB', data: [], borderColor: '#a78bfa', backgroundColor: 'transparent', borderDash: [4,4], cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#a78bfa', yAxisID: 'y' }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } },
      y: { position: 'left', title: { display: true, text: 'TSS / TSB' } }
    }
  }
});

function renderLoadChart(fromIso, toIso) {
  const subset = sliceByDate(data, fromIso, toIso);
  loadChart.data.labels = subset.map(d => fmtDate(d.date));
  loadChart.data.datasets[0].data = subset.map(d => d.ctl);
  loadChart.data.datasets[1].data = subset.map(d => d.atl);
  loadChart.data.datasets[2].data = subset.map(d => d.tsb);
  loadChart.update();
}

// Init : 30 derniers jours par défaut
{
  const end = new Date(today);
  const start = new Date(today);
  start.setDate(end.getDate() - 29);
  setInputDate('load-from', start);
  setInputDate('load-to', end);
  // bornes min/max sur les inputs
  document.getElementById('load-from').min = toIsoDate(data[0].date);
  document.getElementById('load-from').max = toIsoDate(data[data.length-1].date);
  document.getElementById('load-to').min = toIsoDate(data[0].date);
  document.getElementById('load-to').max = toIsoDate(data[data.length-1].date);
  renderLoadChart(toIsoDate(start), toIsoDate(end));
}

// Event handlers
document.querySelectorAll('#load-range .preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#load-range .preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const days = +btn.dataset.days;
    const end = new Date(today);
    const start = new Date(today);
    start.setDate(end.getDate() - (days - 1));
    setInputDate('load-from', start);
    setInputDate('load-to', end);
    renderLoadChart(toIsoDate(start), toIsoDate(end));
  });
});
['load-from', 'load-to'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    // Désactiver les boutons preset si la sélection est manuelle
    document.querySelectorAll('#load-range .preset').forEach(b => b.classList.remove('active'));
    renderLoadChart(getInputDate('load-from'), getInputDate('load-to'));
  });
});

// (Corrélations supprimées du dashboard — bloc retiré sur demande)

// ========= CHART HOURS (heures hebdomadaires, semaines calendaires, drill-down jour) =========
let currentHoursWeeks = [];
let selectedHoursIndex = null;
let hoursDailyChart = null;

const hoursChart = new Chart(document.getElementById('chart-hours'), {
  type: 'bar',
  data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 4 }] },
  options: {
    responsive: true, maintainAspectRatio: false,
    onClick: (event, elements) => {
      if (elements.length === 0) return;
      const idx = elements[0].index;
      if (selectedHoursIndex === idx) {
        hideHoursDetail();
      } else {
        selectedHoursIndex = idx;
        showHoursDetail(currentHoursWeeks[idx]);
      }
    },
    onHover: (event, elements) => {
      event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => 'Semaine ' + items[0].label,
          label: (ctx) => ctx.parsed.y + ' h (clique pour détail)'
        }
      }
    },
    scales: {
      y: { title: { display: true, text: 'Heures' }, beginAtZero: true },
      x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 14 } }
    }
  }
});

function renderHoursChart(fromIso, toIso) {
  currentHoursWeeks = computeWeeksByDate(fromIso, toIso);
  const labels = currentHoursWeeks.map(w => w.label);
  const hoursArr = currentHoursWeeks.map(w => +(w.days.reduce((s, d) => s + (d.duration || 0), 0) / 60).toFixed(1));
  const colors = hoursArr.map(h => {
    if (h === 0) return '#2a3142';
    if (h > 12) return '#f87171';
    if (h > 8) return '#fbbf24';
    return '#4ade80';
  });
  hoursChart.data.labels = labels;
  hoursChart.data.datasets[0].data = hoursArr;
  hoursChart.data.datasets[0].backgroundColor = colors;
  hoursChart.update();
  hideHoursDetail();
}

function showHoursDetail(week) {
  if (!week) return;
  document.getElementById('hours-detail').style.display = 'block';
  document.getElementById('hours-detail-title').textContent =
    `Détail jour par jour · semaine du ${week.label}`;

  const dowFr = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const dayLabels = week.days.map(d => `${dowFr[d.date.getDay()]} ${d.date.getDate()}`);
  const dayHours = week.days.map(d => +((d.duration || 0) / 60).toFixed(1));
  const dayColors = dayHours.map(h => {
    if (h === 0) return '#2a3142';
    if (h > 3) return '#f87171';
    if (h > 1.5) return '#fbbf24';
    return '#4ade80';
  });
  const daySessionNames = week.days.map(d => d.sessionName || 'Repos');

  if (hoursDailyChart) {
    hoursDailyChart.data.labels = dayLabels;
    hoursDailyChart.data.datasets[0].data = dayHours;
    hoursDailyChart.data.datasets[0].backgroundColor = dayColors;
    hoursDailyChart.$daySessionNames = daySessionNames;
    hoursDailyChart.update();
  } else {
    const canvas = document.getElementById('chart-hours-daily');
    hoursDailyChart = new Chart(canvas, {
      type: 'bar',
      data: { labels: dayLabels, datasets: [{ data: dayHours, backgroundColor: dayColors, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const name = ctx.chart.$daySessionNames?.[ctx.dataIndex] || '';
                return name ? `${name} · ${ctx.parsed.y} h` : `${ctx.parsed.y} h`;
              }
            }
          }
        },
        scales: {
          y: { title: { display: true, text: 'Heures' }, beginAtZero: true },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    });
    hoursDailyChart.$daySessionNames = daySessionNames;
  }
}

function hideHoursDetail() {
  document.getElementById('hours-detail').style.display = 'none';
  selectedHoursIndex = null;
}

document.getElementById('hours-detail-close').addEventListener('click', hideHoursDetail);

function applyHoursPreset(numWeeks) {
  const end = new Date(today);
  const currentMonday = getMondayOfWeek(end);
  const start = new Date(currentMonday);
  start.setDate(currentMonday.getDate() - (numWeeks - 1) * 7);
  setInputDate('hours-from', start);
  setInputDate('hours-to', end);
  renderHoursChart(toIsoDate(start), toIsoDate(end));
}

// Init avec 12 semaines calendaires par défaut
document.getElementById('hours-from').min = toIsoDate(data[0].date);
document.getElementById('hours-from').max = toIsoDate(data[data.length-1].date);
document.getElementById('hours-to').min = toIsoDate(data[0].date);
document.getElementById('hours-to').max = toIsoDate(data[data.length-1].date);
applyHoursPreset(12);

document.querySelectorAll('#hours-range .preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#hours-range .preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyHoursPreset(+btn.dataset.weeks);
  });
});

['hours-from', 'hours-to'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('#hours-range .preset').forEach(b => b.classList.remove('active'));
    renderHoursChart(getInputDate('hours-from'), getInputDate('hours-to'));
  });
});

// ========= CHART WEEKLY (filtrable par nombre de semaines + drill-down jour) =========

let currentWeeks = [];        // semaines actuellement affichées
let selectedWeekIndex = null; // index de la semaine cliquée (null si aucune)
let dailyChart = null;         // chart du détail journalier, créé à la 1ère ouverture

// Lundi de la semaine d'une date donnée (semaine ISO calendaire Mon-Sun)
function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();         // 0=Dim, 1=Lun, ..., 6=Sam
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeWeeksByDate(fromIso, toIso) {
  // Regrouper par VRAIES semaines calendaires (Lundi -> Dimanche).
  // La semaine en cours est affichée même incomplète (les jours futurs valent 0).
  const fromDate = new Date(fromIso + 'T12:00:00');
  const toDate = new Date(toIso + 'T12:00:00');
  const firstMonday = getMondayOfWeek(fromDate);
  // Aller jusqu'au dimanche de la semaine de toDate
  const lastSunday = getMondayOfWeek(toDate);
  lastSunday.setDate(lastSunday.getDate() + 6);

  // Index data par date ISO pour lookup O(1)
  const dataByIso = {};
  data.forEach(d => { dataByIso[toIsoDate(d.date)] = d; });

  const weeks = [];
  let weekStart = new Date(firstMonday);

  while (weekStart <= lastSunday) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const weekDays = [];
    let weekHasAny = false;
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      const iso = toIsoDate(day);
      if (dataByIso[iso]) {
        weekDays.push(dataByIso[iso]);
        weekHasAny = true;
      } else {
        // Jour futur ou absent : barre vide / grise
        weekDays.push({
          date: day,
          tss: 0,
          sessionName: null,
          duration: 0
        });
      }
    }

    // Si la semaine entière est en dehors de l'historique (très ancien), on skip
    if (weekHasAny) {
      const tss = weekDays.reduce((s, d) => s + (d.tss || 0), 0);
      weeks.push({
        label: `${fmtShortDate(weekStart)} - ${fmtShortDate(weekEnd)}`,
        tss,
        days: weekDays
      });
    }

    // Avancer d'une semaine
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() + 7);
  }

  return weeks;
}

const weeklyChart = new Chart(document.getElementById('chart-weekly'), {
  type: 'bar',
  data: {
    labels: [],
    datasets: [{ data: [], backgroundColor: [], borderRadius: 4 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    onClick: (event, elements) => {
      if (elements.length === 0) return;
      const idx = elements[0].index;
      if (selectedWeekIndex === idx) {
        // Re-clic sur la même barre → on ferme
        hideWeekDetail();
      } else {
        selectedWeekIndex = idx;
        showWeekDetail(currentWeeks[idx]);
      }
    },
    onHover: (event, elements) => {
      event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { title: (items) => 'Semaine ' + items[0].label, label: (ctx) => ctx.parsed.y + ' TSS (clique pour détail)' } }
    },
    scales: {
      y: { title: { display: true, text: 'TSS hebdo' } },
      x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 14 } }
    }
  }
});

function renderWeeklyChart(fromIso, toIso) {
  currentWeeks = computeWeeksByDate(fromIso, toIso);
  weeklyChart.data.labels = currentWeeks.map(w => w.label);
  weeklyChart.data.datasets[0].data = currentWeeks.map(w => w.tss);
  weeklyChart.data.datasets[0].backgroundColor = currentWeeks.map(w =>
    w.tss > 500 ? '#f87171' : w.tss > 380 ? '#fbbf24' : '#4ade80'
  );
  weeklyChart.update();
  hideWeekDetail();
}

function showWeekDetail(week) {
  const detailDiv = document.getElementById('weekly-detail');
  detailDiv.style.display = 'block';
  document.getElementById('weekly-detail-title').textContent =
    `Détail jour par jour · semaine du ${week.label}`;

  const dowFr = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const dayLabels = week.days.map(d => `${dowFr[d.date.getDay()]} ${d.date.getDate()}`);
  const dayTss = week.days.map(d => d.tss);
  const dayColors = week.days.map(d => {
    if (!d.tss) return '#2a3142';      // jour de repos / pas de séance
    if (d.tss > 150) return '#f87171'; // grosse séance
    if (d.tss > 80) return '#fbbf24';  // séance moyenne
    return '#4ade80';                   // séance légère
  });
  const daySessionNames = week.days.map(d => d.sessionName || 'Repos');

  if (dailyChart) {
    dailyChart.data.labels = dayLabels;
    dailyChart.data.datasets[0].data = dayTss;
    dailyChart.data.datasets[0].backgroundColor = dayColors;
    dailyChart.$daySessionNames = daySessionNames;
    dailyChart.update();
  } else {
    const canvas = document.getElementById('chart-weekly-daily');
    dailyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: [{ data: dayTss, backgroundColor: dayColors, borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const name = ctx.chart.$daySessionNames?.[ctx.dataIndex] || '';
                return name ? `${name} · ${ctx.parsed.y} TSS` : `${ctx.parsed.y} TSS`;
              }
            }
          }
        },
        scales: {
          y: { title: { display: true, text: 'TSS' }, beginAtZero: true },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    });
    dailyChart.$daySessionNames = daySessionNames;
  }
}

function hideWeekDetail() {
  document.getElementById('weekly-detail').style.display = 'none';
  selectedWeekIndex = null;
}

document.getElementById('weekly-detail-close').addEventListener('click', hideWeekDetail);

// Helper preset : N semaines calendaires (semaine courante + N-1 semaines passées)
function applyWeeklyPreset(numWeeks) {
  const end = new Date(today);
  const currentMonday = getMondayOfWeek(end);
  const start = new Date(currentMonday);
  start.setDate(currentMonday.getDate() - (numWeeks - 1) * 7);
  setInputDate('weekly-from', start);
  setInputDate('weekly-to', end);
  renderWeeklyChart(toIsoDate(start), toIsoDate(end));
}

// Init : 12 semaines calendaires (semaine courante + 11 précédentes)
document.getElementById('weekly-from').min = toIsoDate(data[0].date);
document.getElementById('weekly-from').max = toIsoDate(data[data.length-1].date);
document.getElementById('weekly-to').min = toIsoDate(data[0].date);
document.getElementById('weekly-to').max = toIsoDate(data[data.length-1].date);
applyWeeklyPreset(12);

// Presets : 4 sem / 12 sem
document.querySelectorAll('#weekly-range .preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#weekly-range .preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyWeeklyPreset(+btn.dataset.weeks);
  });
});

// Date inputs manuels : déselectionne les presets
['weekly-from', 'weekly-to'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('#weekly-range .preset').forEach(b => b.classList.remove('active'));
    renderWeeklyChart(getInputDate('weekly-from'), getInputDate('weekly-to'));
  });
});

// ========= CHART ZONES (avec sélecteur de période) =========
const zoneLabels = ['Z1 récup', 'Z2 endurance', 'Z3 tempo', 'Z4 seuil', 'Z5 VO2max'];
const zoneColors = ['#bbf7d0','#86efac','#4ade80','#16a34a','#14532d'];

// État : 'hr' (FC) ou 'power' (Watts)
let currentZoneType = 'hr';

function getZonesForDay(d) {
  // Renvoie le tableau de zones approprié selon le toggle, avec fallback
  if (currentZoneType === 'power') return d.zones_power || null;
  return d.zones_hr || d.zones || null;
}

function computeZonesByDate(fromIso, toIso) {
  // Pondérer par la durée de chaque séance pour avoir un % réel du temps total
  const slice = data.filter(d => {
    const iso = toIsoDate(d.date);
    return iso >= fromIso && iso <= toIso && getZonesForDay(d) && d.duration;
  });
  const totals = [0,0,0,0,0];
  let totalTime = 0;
  slice.forEach(d => {
    const zones = getZonesForDay(d);
    zones.forEach((pct, i) => {
      const minutes = (pct / 100) * d.duration;
      totals[i] += minutes;
      totalTime += minutes;
    });
  });
  if (totalTime === 0) return { pct: [0,0,0,0,0], totalMin: 0, sessions: 0 };
  return {
    pct: totals.map(m => +(m * 100 / totalTime).toFixed(1)),
    totalMin: Math.round(totalTime),
    sessions: slice.length
  };
}

const zonesChart = new Chart(document.getElementById('chart-zones'), {
  type: 'doughnut',
  data: {
    labels: zoneLabels,
    datasets: [{ data: [0,0,0,0,0], backgroundColor: zoneColors, borderWidth: 0 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx) => ctx.label + ' : ' + ctx.parsed + '%' } }
    }
  }
});

function renderZones(fromIso, toIso) {
  const { pct, totalMin, sessions } = computeZonesByDate(fromIso, toIso);
  zonesChart.data.datasets[0].data = pct;
  zonesChart.update();
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const rows = zoneLabels.map((label, i) =>
    `<div class="zone-summary-row"><span class="zname"><span class="legend-dot" style="background:${zoneColors[i]};"></span>${label}</span><span class="zpct">${pct[i]}%</span></div>`
  ).join('');
  document.getElementById('zone-summary').innerHTML = `
    <div style="margin-bottom:8px;color:var(--text-dim);">
      <strong style="color:var(--text);">${sessions}</strong> séance${sessions>1?'s':''} · <strong style="color:var(--text);">${hours}h${mins.toString().padStart(2,'0')}</strong> de pratique
    </div>
    ${rows}
  `;
}

// Init avec 7 derniers jours par défaut
{
  const end = new Date(today);
  const start = new Date(today);
  start.setDate(end.getDate() - 6);
  setInputDate('zones-from', start);
  setInputDate('zones-to', end);
  document.getElementById('zones-from').min = toIsoDate(data[0].date);
  document.getElementById('zones-from').max = toIsoDate(data[data.length-1].date);
  document.getElementById('zones-to').min = toIsoDate(data[0].date);
  document.getElementById('zones-to').max = toIsoDate(data[data.length-1].date);
  renderZones(toIsoDate(start), toIsoDate(end));
}

// Presets
document.querySelectorAll('#zones-range .preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#zones-range .preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const days = +btn.dataset.days;
    const end = new Date(today);
    const start = new Date(today);
    start.setDate(end.getDate() - (days - 1));
    setInputDate('zones-from', start);
    setInputDate('zones-to', end);
    renderZones(toIsoDate(start), toIsoDate(end));
  });
});

// Date inputs manuels
['zones-from', 'zones-to'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('#zones-range .preset').forEach(b => b.classList.remove('active'));
    renderZones(getInputDate('zones-from'), getInputDate('zones-to'));
  });
});

// Toggle FC / Watts
document.querySelectorAll('#zones-type-toggle .ztoggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#zones-type-toggle .ztoggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentZoneType = btn.dataset.type;
    renderZones(getInputDate('zones-from'), getInputDate('zones-to'));
  });
});

// ========= PANEL 2: ENTRAÎNEUR (compétitions + plan 7j) =========
const dowFr = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const COMP_KEY = 'coach_ia_competitions_v1';

function loadCompetitions() {
  try {
    const raw = localStorage.getItem(COMP_KEY);
    if (!raw) return [];
    return JSON.parse(raw).filter(c => c.date && c.name);
  } catch (e) { return []; }
}

// Renvoie la liste des compés "à plat" : chaque course par étapes est expansée
// en une entrée par étape (avec date/sport/km/etc de l'étape).
// Les compés simples restent telles quelles. Sert au calendrier.
function loadCompetitionsExpanded() {
  const out = [];
  for (const c of loadCompetitions()) {
    if (c.stages && Array.isArray(c.stagesList) && c.stagesList.length > 0) {
      c.stagesList.forEach((st, idx) => {
        if (!st.date) return; // ignore les étapes sans date
        out.push({
          id: `${c.id}-stage-${idx}`,
          parentId: c.id,
          name: `${c.name} — Étape ${idx + 1}`,
          date: st.date,
          time: st.time || null,
          // Priority et sport sont GLOBAUX (depuis la compé), pas par étape
          priority: c.priority || 'A',
          sport: c.sport || 'Ride',
          type: st.type || null,
          km: st.km || null,
          dplus: st.dplus || null,
          target: st.target || null,
          laps: st.laps || null,
          notes: st.notes || null,
          gpxName: st.gpxName || null,
          gpxContent: st.gpxContent || null,
          stageIdx: idx,
          totalStages: c.stagesList.length,
          stages: false, // pour les render, on traite chaque étape comme une compé simple
        });
      });
    } else {
      out.push(c);
    }
  }
  return out;
}

function saveCompetitions(comps) {
  localStorage.setItem(COMP_KEY, JSON.stringify(comps));
  // Re-render automatique : "Compétitions à venir" + calendrier
  if (typeof renderCompList === 'function') renderCompList();
  if (typeof renderCalendar === 'function') renderCalendar();
}

// === SNAPSHOTS DU PLAN PRÉVU ===
// Chaque fois qu'un jour "aujourd'hui ou futur" affiche son prévu, on snapshot.
// Les snapshots persistent indéfiniment → les anciennes prévus restent visibles
// (en grisé) même longtemps après être passés.
const PLAN_SNAPSHOT_KEY = 'coach_ia_plan_snapshots_v1';
function loadPlanSnapshots() {
  try {
    const raw = localStorage.getItem(PLAN_SNAPSHOT_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) { return {}; }
}
function savePlanSnapshot(iso, proposal, allowOverwrite) {
  if (!iso || !proposal) return;
  const all = loadPlanSnapshots();
  // On ré-écrase uniquement si autorisé (cas d'aujourd'hui qui est continuellement ajusté)
  if (all[iso] && !allowOverwrite) return;
  all[iso] = {
    name: proposal.name,
    type: proposal.type,
    dur: proposal.dur,
    tss: proposal.tss,
    sport: proposal.sport,
    why: proposal.why,
    snapshotAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(PLAN_SNAPSHOT_KEY, JSON.stringify(all));
  } catch (e) { console.warn('[plan snapshot] localStorage plein ?', e); }
}

function renderCompList() {
  // Helpers de format
  const fmtFullDate = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShortDayMonth = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtYear = d => d.getFullYear();

  const comps = loadCompetitions()
    .map(c => {
      // Pour les courses par étapes : start = première étape, end = dernière étape
      let startDate = c.date, endDate = c.date;
      if (c.stages && Array.isArray(c.stagesList) && c.stagesList.length) {
        const dates = c.stagesList.map(s => s.date).filter(Boolean).sort();
        if (dates.length) { startDate = dates[0]; endDate = dates[dates.length - 1]; }
      }
      return {
        ...c,
        dateObj: new Date(startDate + 'T12:00:00'),
        endDateObj: new Date(endDate + 'T12:00:00'),
      };
    })
    .filter(c => c.endDateObj >= today) // affiche tant que la dernière étape n'est pas passée
    .sort((a, b) => a.dateObj - b.dateObj);

  const list = document.getElementById('comp-list');
  if (comps.length === 0) {
    list.innerHTML = `<div class="comp-empty">Aucune compétition enregistrée. Ajoute ton prochain objectif pour structurer ton plan.</div>`;
    return;
  }
  list.innerHTML = comps.map(c => {
    const daysUntil = Math.ceil((c.dateObj - today) / 86400000);
    let dateStr;
    if (c.stages && c.endDateObj.getTime() !== c.dateObj.getTime()) {
      // Course par étapes : start → end
      // Si même année, on ne répète pas l'année
      const sameYear = c.dateObj.getFullYear() === c.endDateObj.getFullYear();
      if (sameYear) {
        dateStr = `${fmtShortDayMonth(c.dateObj)} → ${fmtShortDayMonth(c.endDateObj)} ${fmtYear(c.endDateObj)}`;
      } else {
        dateStr = `${fmtShortDayMonth(c.dateObj)} ${fmtYear(c.dateObj)} → ${fmtShortDayMonth(c.endDateObj)} ${fmtYear(c.endDateObj)}`;
      }
      // Ajoute un petit indicateur du nb d'étapes
      const nbStages = c.stagesList.length;
      dateStr += ` <span class="comp-stages-badge" title="${nbStages} étapes">· ${nbStages} étapes</span>`;
    } else {
      dateStr = fmtFullDate(c.dateObj);
    }
    return `<div class="comp-item" data-comp-id="${c.id}" title="Voir le détail de la compétition">
      <span class="comp-prio ${c.priority}">${c.priority}</span>
      <span class="comp-name">${c.name}</span>
      <span class="comp-date">${dateStr}</span>
      <span class="comp-countdown">${daysUntil <= 0 ? 'en cours' : 'dans ' + daysUntil + ' j'}</span>
      <button class="comp-del" data-id="${c.id}" title="Supprimer">×</button>
    </div>`;
  }).join('');
}

document.getElementById('comp-add').addEventListener('click', async () => {
  const name = document.getElementById('comp-name').value.trim();
  const date = document.getElementById('comp-date').value;
  const priority = document.getElementById('comp-priority').value;
  if (!name || !date) {
    await appAlert({
      title: 'Champs manquants',
      message: 'Renseigne au moins le nom et la date.',
    });
    return;
  }
  const comps = loadCompetitions();
  comps.push({ id: Date.now().toString(), name, date, priority });
  saveCompetitions(comps);
  document.getElementById('comp-name').value = '';
  document.getElementById('comp-date').value = '';
  renderCompList();
  renderCalendar();
});

document.getElementById('comp-list').addEventListener('click', (e) => {
  // Clic sur la croix de suppression
  if (e.target.classList.contains('comp-del')) {
    e.stopPropagation();
    const id = e.target.dataset.id;
    const comps = loadCompetitions().filter(c => c.id !== id);
    saveCompetitions(comps);
    renderCompList();
    renderCalendar();
    return;
  }
  // Clic sur la ligne de compé → ouvre la modal de détail
  const item = e.target.closest('.comp-item');
  if (!item) return;
  const compId = item.dataset.compId;
  if (!compId) return;
  const comp = loadCompetitions().find(c => c.id === compId);
  if (!comp) return;
  // Pour course par étapes : ouvrir la 1ère étape ; sinon la date principale
  let openDate = comp.date;
  if (comp.stages && Array.isArray(comp.stagesList) && comp.stagesList.length) {
    const dates = comp.stagesList.map(s => s.date).filter(Boolean).sort();
    if (dates.length) openDate = dates[0];
  }
  if (openDate) {
    // S'assure d'être sur l'onglet Entraîneur (le modal nécessite que today soit accessible)
    if (typeof openSessionModal === 'function') openSessionModal(openDate, 'prevu');
  }
});

// ========= MODAL D'AJOUT DE COMPÉTITION =========
// === Custom dropdown qui remplace les <select> natifs ===
// Le <select> reste dans le DOM (caché) pour stocker la valeur, on construit un widget par-dessus
function enhanceSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel || sel._enhanced) return;
  sel._enhanced = true;
  // Cache le select natif
  sel.style.display = 'none';
  sel.tabIndex = -1;

  // Wrapper
  const wrap = document.createElement('div');
  wrap.className = 'custom-select';
  wrap.tabIndex = 0;

  // Bouton qui affiche la valeur courante
  const btn = document.createElement('div');
  btn.className = 'custom-select-btn';
  btn.innerHTML = '<span class="custom-select-label">—</span><span class="custom-select-arrow"></span>';
  wrap.appendChild(btn);

  // Panel des options
  const panel = document.createElement('div');
  panel.className = 'custom-select-panel';
  wrap.appendChild(panel);

  // Insère après le select
  sel.parentNode.insertBefore(wrap, sel.nextSibling);

  function rebuildPanel() {
    panel.innerHTML = '';
    // Pour chaque <optgroup> ou <option> direct
    Array.from(sel.children).forEach(child => {
      if (child.tagName === 'OPTGROUP') {
        const og = document.createElement('div');
        og.className = 'cs-group';
        og.textContent = child.label;
        panel.appendChild(og);
        Array.from(child.children).forEach(opt => panel.appendChild(buildOption(opt)));
      } else if (child.tagName === 'OPTION') {
        panel.appendChild(buildOption(child));
      }
    });
  }
  function buildOption(opt) {
    const item = document.createElement('div');
    item.className = 'cs-option';
    item.dataset.value = opt.value;
    item.textContent = opt.textContent;
    if (sel.value === opt.value) item.classList.add('selected');
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      updateLabel();
      panel.querySelectorAll('.cs-option').forEach(o => o.classList.remove('selected'));
      item.classList.add('selected');
      closePanel();
    });
    return item;
  }
  function updateLabel() {
    const selected = sel.options[sel.selectedIndex];
    btn.querySelector('.custom-select-label').textContent = selected ? selected.textContent : '—';
  }
  function openPanel() {
    rebuildPanel();
    wrap.classList.add('open');
    // Scroll vers l'option sélectionnée
    const sel_ = panel.querySelector('.cs-option.selected');
    if (sel_) sel_.scrollIntoView({ block: 'nearest' });
    // Ferme au clic en dehors
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  }
  function closePanel() {
    wrap.classList.remove('open');
    document.removeEventListener('mousedown', onOutside);
  }
  function onOutside(e) {
    if (!wrap.contains(e.target)) closePanel();
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.contains('open') ? closePanel() : openPanel();
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      wrap.classList.contains('open') ? closePanel() : openPanel();
    }
  });

  // Init
  updateLabel();
  // Si le select change depuis l'extérieur, met à jour le label
  sel._customUpdate = updateLabel;
}

// === Sport select : peuple avec tous les sports SPORTS_CATALOG groupés par catégorie ===
function populateSportSelect(selectId, defaultValue) {
  const sel = document.getElementById(selectId);
  if (!sel || !window.SPORTS_CATALOG) return;
  // Groupe les sports par catégorie
  const groups = {};
  for (const [rawType, info] of Object.entries(window.SPORTS_CATALOG)) {
    const cat = info.category || 'autre';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ rawType, fr: info.fr, icon: info.icon || '' });
  }
  // Ordre d'affichage des catégories
  const catOrder = ['cyclisme', 'course', 'natation', 'musculation', 'autre'];
  const catLabels = {
    cyclisme: '🚴 Cyclisme',
    course: '🏃 Course à pied',
    natation: '🏊 Natation',
    musculation: '🏋️ Musculation',
    autre: '📦 Autre',
  };
  // Vide et reconstruit
  sel.innerHTML = '';
  for (const cat of catOrder) {
    if (!groups[cat]) continue;
    const og = document.createElement('optgroup');
    og.label = catLabels[cat] || cat;
    // Tri alphabétique dans chaque catégorie
    groups[cat].sort((a, b) => a.fr.localeCompare(b.fr, 'fr'));
    for (const s of groups[cat]) {
      const opt = document.createElement('option');
      opt.value = s.rawType; // ex: "Ride", "AlpineSki" — pour avoir le sport Strava exact
      opt.textContent = `${s.icon ? s.icon + ' ' : ''}${s.fr}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  if (defaultValue) sel.value = defaultValue;
  // Si le select a déjà été enhanced, refresh le label
  if (sel._customUpdate) sel._customUpdate();
  // Sinon, l'enhance maintenant
  enhanceSelect(selectId);
}
// Peuple à l'init (si SPORTS_CATALOG déjà chargé), sinon différé à l'ouverture de la modal
if (window.SPORTS_CATALOG) {
  populateSportSelect('comp-modal-sport', 'Ride');
  populateSportSelect('train-modal-sport', 'Ride');
}

// === File picker custom (au lieu du bouton "Choisir un fichier" natif) ===
function initFilePickers() {
  document.querySelectorAll('.file-picker').forEach(picker => {
    if (picker._wired) return;
    picker._wired = true;
    const targetId = picker.getAttribute('data-target');
    const input = targetId ? document.getElementById(targetId) : picker.querySelector('input[type="file"]');
    const btn = picker.querySelector('.file-picker-btn');
    const label = picker.querySelector('.file-picker-label');
    const clearBtn = picker.querySelector('.file-picker-clear');
    const defaultLabel = label.textContent;
    if (!input || !btn || !label) return;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      input.click();
    });
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (f) {
        label.textContent = f.name;
        picker.classList.add('has-file');
        if (clearBtn) clearBtn.hidden = false;
      } else {
        label.textContent = defaultLabel;
        picker.classList.remove('has-file');
        if (clearBtn) clearBtn.hidden = true;
      }
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        input.value = '';
        label.textContent = defaultLabel;
        picker.classList.remove('has-file');
        clearBtn.hidden = true;
      });
    }
  });
}
initFilePickers();

// === Time stepper (heure avec flèches haut/bas) ===
// Step: +/- 1h pour heure, +/- 5 min pour minutes
function initTimeSteppers() {
  document.querySelectorAll('.time-stepper').forEach(stepper => {
    if (stepper._wired) return;
    stepper._wired = true;
    const targetId = stepper.getAttribute('data-target');
    const hiddenInput = targetId ? document.getElementById(targetId) : null;

    function read() {
      const h = parseInt(stepper.querySelector('.time-val[data-part="hour"]').textContent, 10) || 0;
      const m = parseInt(stepper.querySelector('.time-val[data-part="min"]').textContent, 10) || 0;
      return { h, m };
    }
    function write(h, m) {
      // Normalise (wrap)
      h = ((h % 24) + 24) % 24;
      m = ((m % 60) + 60) % 60;
      stepper.querySelector('.time-val[data-part="hour"]').textContent = h.toString().padStart(2, '0');
      stepper.querySelector('.time-val[data-part="min"]').textContent = m.toString().padStart(2, '0');
      if (hiddenInput) hiddenInput.value = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
    // Init hidden input depuis l'état affiché
    const cur = read();
    write(cur.h, cur.m);

    stepper.addEventListener('click', (e) => {
      const btn = e.target.closest('.time-arrow');
      if (!btn) return;
      e.preventDefault();
      const part = btn.getAttribute('data-part');
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      const { h, m } = read();
      if (part === 'hour') write(h + dir, m);
      else if (part === 'min') write(h, m + dir * 5);
    });
  });
}
// Helper public pour reset un stepper à une heure donnée (ex: openCompModal)
window.resetTimeStepper = function(targetId, h = 12, m = 0) {
  const stepper = document.querySelector(`.time-stepper[data-target="${targetId}"]`);
  if (!stepper) return;
  stepper.querySelector('.time-val[data-part="hour"]').textContent = h.toString().padStart(2, '0');
  stepper.querySelector('.time-val[data-part="min"]').textContent = m.toString().padStart(2, '0');
  const hidden = document.getElementById(targetId);
  if (hidden) hidden.value = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};
initTimeSteppers();

// Custom dropdowns pour mois ET année dans Flatpickr (au lieu du select natif moche)
// Approche : on REMPLACE complètement le contenu de .flatpickr-current-month
function attachCustomMonthDropdown(monthBox, fpInstance) {
  if (monthBox._customMonthAttached) return;
  monthBox._customMonthAttached = true;

  const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  // Sauvegarde du contenu original au cas où on doive le restaurer
  const originalHTML = monthBox.innerHTML;
  // On vide et reconstruit le contenu du header
  monthBox.innerHTML = '';
  monthBox.classList.add('fp-cm-custom');

  function buildBtn(label, extraClass) {
    const wrap = document.createElement('div');
    wrap.className = 'fp-cs-wrap';
    const btn = document.createElement('div');
    btn.className = 'fp-cs-btn ' + (extraClass || '');
    btn.innerHTML = `<span class="fp-cs-label">${label}</span><span class="fp-cs-arrow"></span>`;
    wrap.appendChild(btn);
    const panel = document.createElement('div');
    panel.className = 'fp-cs-panel';
    wrap.appendChild(panel);
    return { wrap, btn, panel };
  }

  // Panels en body (pour échapper à tout container avec overflow:hidden / z-index trop bas)
  function buildBody(extraClass) {
    const panel = document.createElement('div');
    panel.className = 'fp-cs-panel-body ' + (extraClass || '');
    document.body.appendChild(panel);
    return panel;
  }

  // === MOIS ===
  const m = buildBtn(monthNames[fpInstance.currentMonth], 'fp-month-btn');
  m.panel.remove(); // on n'utilise pas le panel inline, on en crée un dans body
  const mPanel = buildBody('fp-month-panel-body');
  for (let i = 0; i < 12; i++) {
    const it = document.createElement('div');
    it.className = 'fp-cs-option';
    it.textContent = monthNames[i];
    it.dataset.month = i;
    it.addEventListener('click', (e) => {
      e.stopPropagation();
      fpInstance.changeMonth(i, false);
      closeAll();
    });
    mPanel.appendChild(it);
  }
  m.btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel(m.btn, mPanel, fpInstance.currentMonth);
  });
  monthBox.appendChild(m.wrap);

  // === ANNÉE ===
  const y = buildBtn(String(fpInstance.currentYear), 'fp-year-btn');
  y.panel.remove();
  const yPanel = buildBody('fp-year-panel-body');
  function rebuildYears(centerYear) {
    yPanel.innerHTML = '';
    for (let yy = centerYear - 8; yy <= centerYear + 8; yy++) {
      const it = document.createElement('div');
      it.className = 'fp-cs-option';
      it.textContent = yy;
      it.dataset.year = yy;
      if (yy === fpInstance.currentYear) it.classList.add('selected');
      it.addEventListener('click', (e) => {
        e.stopPropagation();
        fpInstance.changeYear(yy);
        closeAll();
      });
      yPanel.appendChild(it);
    }
  }
  rebuildYears(fpInstance.currentYear);
  y.btn.addEventListener('click', (e) => {
    e.stopPropagation();
    rebuildYears(fpInstance.currentYear);
    togglePanel(y.btn, yPanel, null, true);
  });
  monthBox.appendChild(y.wrap);

  // Stocke refs panels pour syncLabels / closeAll
  const allPanels = [mPanel, yPanel];
  const allBtns = [m.btn, y.btn];

  // Nettoyage si la modal/calendrier se ferme
  fpInstance.config.onClose = (fpInstance.config.onClose || []).concat([() => closeAll()]);
  // Nettoyage panel si Flatpickr est détruit
  const origDestroy = fpInstance.destroy.bind(fpInstance);
  fpInstance.destroy = function() {
    allPanels.forEach(p => p.remove());
    return origDestroy();
  };

  // === Sync au changement (via les flèches prev/next ou via select date) ===
  function syncLabels() {
    m.btn.querySelector('.fp-cs-label').textContent = monthNames[fpInstance.currentMonth];
    y.btn.querySelector('.fp-cs-label').textContent = String(fpInstance.currentYear);
  }
  // On hook nos handlers en config (Flatpickr accepte un tableau)
  const addHook = (key, fn) => {
    if (!fpInstance.config[key]) fpInstance.config[key] = [];
    else if (!Array.isArray(fpInstance.config[key])) fpInstance.config[key] = [fpInstance.config[key]];
    fpInstance.config[key].push(fn);
  };
  addHook('onMonthChange', syncLabels);
  addHook('onYearChange', syncLabels);
  addHook('onChange', syncLabels);

  function closeAll() {
    allPanels.forEach(p => p.classList.remove('open'));
    allBtns.forEach(b => b.classList.remove('open'));
    document.removeEventListener('mousedown', onOutside);
  }
  function positionPanel(btn, panel) {
    const rect = btn.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.left = (rect.left + rect.width / 2) + 'px';
    panel.style.transform = 'translateX(-50%)';
  }
  function togglePanel(btn, panel, highlightIdx, isYear) {
    const wasOpen = panel.classList.contains('open');
    closeAll();
    if (!wasOpen) {
      panel.querySelectorAll('.fp-cs-option').forEach((it, i) => {
        if (isYear) {
          it.classList.toggle('selected', parseInt(it.dataset.year, 10) === fpInstance.currentYear);
        } else {
          it.classList.toggle('selected', i === highlightIdx);
        }
      });
      positionPanel(btn, panel);
      panel.classList.add('open');
      btn.classList.add('open');
      setTimeout(() => {
        const sel = panel.querySelector('.fp-cs-option.selected');
        if (sel) sel.scrollIntoView({ block: 'center' });
        document.addEventListener('mousedown', onOutside);
      }, 0);
    }
  }
  function onOutside(e) {
    if (!monthBox.contains(e.target) && !allPanels.some(p => p.contains(e.target))) closeAll();
  }
}

// Init Flatpickr (date pickers stylisés) sur tous les inputs date/time
function initFlatpickrAll() {
  if (typeof flatpickr === 'undefined') return;
  // Locale française
  if (window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.fr) {
    flatpickr.localize(flatpickr.l10ns.fr);
  }
  // Helper : empêche complètement la caret de l'input visible (cliquable mais pas éditable)
  function lockInput(t) {
    if (!t) return;
    t.setAttribute('readonly', 'readonly');
    t.setAttribute('inputmode', 'none');
    t.setAttribute('tabindex', '0');
    // Empêche le caret de se positionner même au clic
    t.addEventListener('mousedown', (e) => {
      // On laisse le clic ouvrir Flatpickr, mais on annule la sélection texte
      t.blur();
      setTimeout(() => t.focus(), 0);
      // Désélectionne immédiatement toute sélection en cours sur le document
      if (window.getSelection) window.getSelection().removeAllRanges();
    });
    t.addEventListener('focus', () => {
      // Pas de caret visible
      t.setSelectionRange && t.setSelectionRange(0, 0);
    });
    t.addEventListener('select', () => {
      t.setSelectionRange && t.setSelectionRange(0, 0);
    });
  }

  // Dates : format dd/mm/yyyy à l'affichage, valeur stockée en yyyy-mm-dd
  document.querySelectorAll('input[type="date"]').forEach(el => {
    if (el._flatpickr) return;
    flatpickr(el, {
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'l j F Y', // ex: "jeudi 21 mai 2026"
      allowInput: false,
      disableMobile: true,
      clickOpens: true,
      monthSelectorType: 'static', // pas de select natif moche, navigation par flèches uniquement
      onReady(_, __, instance) {
        if (instance.altInput) {
          instance.altInput.placeholder = 'Sélectionner une date';
          instance.altInput.classList.add('fp-with-icon', 'fp-icon-date');
          lockInput(instance.altInput);
        }
        // Rend le mois cliquable pour ouvrir notre custom dropdown
        try {
          const monthBox = instance.calendarContainer.querySelector('.flatpickr-current-month');
          if (monthBox && typeof attachCustomMonthDropdown === 'function') {
            attachCustomMonthDropdown(monthBox, instance);
          }
        } catch (err) {
          console.error('[attachCustomMonthDropdown]', err);
        }
      },
    });
  });
  // Plus de Flatpickr pour les heures : on utilise le time-stepper custom
  initTimeSteppers();
}
// Init initial + ré-init si la liste change
initFlatpickrAll();

// === Options "Type d'épreuve" selon le sport choisi ===
// Pour Cyclisme : 2 choix (Course en ligne, Contre la montre)
// Pour les autres sports : pas d'options spécifiques pour l'instant (champ vide)
const TYPE_OPTIONS_BY_SPORT = {
  // Cyclisme et variantes
  Ride: ['Course en ligne', 'Contre la montre'],
  GravelRide: ['Course en ligne', 'Contre la montre'],
  VirtualRide: ['Course en ligne', 'Contre la montre'],
  MountainBikeRide: ['Course en ligne', 'Contre la montre'],
  EBikeRide: ['Course en ligne', 'Contre la montre'],
};

function populateTypeSelectForSport(rawType) {
  const sel = document.getElementById('comp-modal-type');
  if (!sel) return;
  const opts = TYPE_OPTIONS_BY_SPORT[rawType] || [];
  const prev = sel.value;
  sel.innerHTML = '';
  // Option vide par défaut (texte libre / non précisé)
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = opts.length ? 'Sélectionner...' : 'Non précisé';
  sel.appendChild(empty);
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  });
  // Réessaye de garder la valeur précédente si possible
  if (prev && Array.from(sel.options).some(o => o.value === prev)) {
    sel.value = prev;
  } else {
    sel.value = '';
  }
  // Re-enhance le custom dropdown
  if (typeof enhanceSelect === 'function') enhanceSelect('comp-modal-type');
  if (sel._customUpdate) sel._customUpdate();
}

// Écoute les changements de sport pour mettre à jour les options du type
(function wireTypeSelectToSport() {
  const sportSel = document.getElementById('comp-modal-sport');
  if (!sportSel) return;
  sportSel.addEventListener('change', () => populateTypeSelectForSport(sportSel.value));
})();

// ========= GESTION DES ÉTAPES (course par étapes) =========
let stagesData = []; // [{name, date, time, sport, type, km, dplus, target, laps, notes, gpxName, gpxContent}, ...]
let activeStageIdx = 0;

// Champs gérés par les étapes (tout sauf le nom global qui reste partagé)
const STAGE_FIELDS = ['date','time','type','km','dplus','target','laps','notes','sport','priority','gpx'];

// Priority et Sport sont GLOBAUX à la compé (ne changent pas par étape)
// → ils ne sont pas inclus dans le snapshot stage
function readFormToStage() {
  const stage = {};
  stage.date = document.getElementById('comp-modal-date').value || '';
  stage.time = document.getElementById('comp-modal-time').value || '';
  stage.type = document.getElementById('comp-modal-type').value || '';
  stage.km = document.getElementById('comp-modal-km').value || '';
  stage.dplus = document.getElementById('comp-modal-dplus').value || '';
  stage.target = document.getElementById('comp-modal-target').value || '';
  stage.laps = document.getElementById('comp-modal-laps').value || '';
  stage.notes = document.getElementById('comp-modal-notes').value || '';
  const gpxInput = document.getElementById('comp-modal-gpx');
  const newFile = gpxInput && gpxInput.files[0] ? gpxInput.files[0] : null;
  if (newFile) {
    // L'utilisateur a uploadé un nouveau fichier pour cette étape
    stage.gpxFile = newFile;
    stage.gpxName = newFile.name;
    stage.gpxContent = null; // sera lu en async au save
  } else {
    // Pas de nouveau fichier : on PRÉSERVE le gpx existant (en mémoire dans stagesData)
    const existing = (typeof stagesData !== 'undefined' && stagesData[activeStageIdx]) || {};
    stage.gpxFile = existing.gpxFile || null;
    stage.gpxName = existing.gpxName || null;
    stage.gpxContent = existing.gpxContent || null;
  }
  return stage;
}

function writeStageToForm(stage) {
  if (!stage) stage = {};
  // NOTE: priority et sport NE sont PAS touchés (globaux à la compé)
  document.getElementById('comp-modal-date').value = stage.date || '';
  document.getElementById('comp-modal-type').value = stage.type || '';
  // km/dplus : si GPX présent pour cette étape, on calcule depuis le fichier (vérité terrain)
  let effKm = stage.km, effDplus = stage.dplus;
  const lapsForStage = parseInt(stage.laps, 10) || 1;
  if (stage.gpxContent && typeof extractGpxStats === 'function') {
    const gs = extractGpxStats(stage.gpxContent, lapsForStage);
    if (gs) {
      effKm = gs.km;
      effDplus = gs.dplus;
    }
  }
  document.getElementById('comp-modal-km').value = effKm || '';
  document.getElementById('comp-modal-dplus').value = effDplus || '';
  document.getElementById('comp-modal-target').value = stage.target || '';
  document.getElementById('comp-modal-laps').value = stage.laps || '';
  document.getElementById('comp-modal-notes').value = stage.notes || '';
  // Time stepper
  const [h, m] = (stage.time || '12:00').split(':').map(n => parseInt(n, 10) || 0);
  if (window.resetTimeStepper) window.resetTimeStepper('comp-modal-time', h, m);
  // Flatpickr date
  const dateInput = document.getElementById('comp-modal-date');
  if (dateInput && dateInput._flatpickr) {
    if (stage.date) dateInput._flatpickr.setDate(stage.date, false);
    else dateInput._flatpickr.clear();
  }
  // Custom select Type (priority/sport non touchés)
  const typeEl = document.getElementById('comp-modal-type');
  if (typeEl && typeEl._customUpdate) typeEl._customUpdate();
  // GPX picker : reset visual
  const gpxInput = document.getElementById('comp-modal-gpx');
  if (gpxInput) {
    gpxInput.value = '';
    const picker = gpxInput.closest('.file-picker');
    if (picker) {
      picker.classList.remove('has-file');
      const lbl = picker.querySelector('.file-picker-label');
      if (lbl) lbl.textContent = stage.gpxName || 'Choisir un fichier GPX';
      if (stage.gpxName) picker.classList.add('has-file');
      const clr = picker.querySelector('.file-picker-clear');
      if (clr) clr.hidden = !stage.gpxName;
    }
  }
}

function renderStageTabs() {
  const list = document.getElementById('comp-stage-tabs-list');
  if (!list) return;
  // Garde-fou : si stagesData vide, init avec 2 étapes vides
  if (!stagesData || stagesData.length < 2) {
    stagesData = [stagesData[0] || {}, stagesData[1] || {}];
    activeStageIdx = 0;
  }
  const hasClose = stagesData.length > 2;
  list.innerHTML = stagesData.map((s, i) => `
    <button type="button" class="stage-tab${i === activeStageIdx ? ' active' : ''}${hasClose ? ' has-close' : ''}" data-stage="${i}">
      <span class="stage-tab-label" data-long="Étape ${i + 1}" data-short="E${i + 1}">Étape ${i + 1}</span>
      ${hasClose ? `<span class="stage-tab-close" data-close="${i}" title="Supprimer cette étape">×</span>` : ''}
    </button>
  `).join('');
  // Wire clicks
  list.querySelectorAll('.stage-tab').forEach(t => {
    t.addEventListener('click', (e) => {
      if (e.target.classList.contains('stage-tab-close')) return;
      const idx = +t.dataset.stage;
      if (idx === activeStageIdx) return;
      stagesData[activeStageIdx] = readFormToStage();
      activeStageIdx = idx;
      writeStageToForm(stagesData[activeStageIdx]);
      renderStageTabs();
    });
  });
  list.querySelectorAll('.stage-tab-close').forEach(c => {
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = +c.dataset.close;
      if (stagesData.length <= 2) return;
      stagesData.splice(idx, 1);
      if (activeStageIdx >= stagesData.length) activeStageIdx = stagesData.length - 1;
      writeStageToForm(stagesData[activeStageIdx]);
      renderStageTabs();
    });
  });
  // Désactive visuellement le + si on atteint la limite (10)
  const addBtn = document.getElementById('comp-stage-tab-add');
  if (addBtn) {
    if (stagesData.length >= 10) {
      addBtn.disabled = true;
      addBtn.style.opacity = '0.3';
      addBtn.style.cursor = 'not-allowed';
      addBtn.title = 'Maximum 10 étapes';
    } else {
      addBtn.disabled = false;
      addBtn.style.opacity = '';
      addBtn.style.cursor = '';
      addBtn.title = 'Ajouter une étape';
    }
  }
  // Après render : check si les tabs débordent et raccourcir si besoin
  adjustStageTabLabels();
}

// Détecte si UN des labels passe à la ligne (le chiffre va sur une 2e ligne)
// et bascule TOUS les labels en version courte (E1, E2, etc.)
function adjustStageTabLabels() {
  const list = document.getElementById('comp-stage-tabs-list');
  if (!list) return;
  const labels = list.querySelectorAll('.stage-tab-label');
  // Reset en version longue
  labels.forEach(l => { l.textContent = l.dataset.long; });
  // Mesure : si un label a une hauteur > 1 ligne (passage à la ligne), bascule en short
  requestAnimationFrame(() => {
    let mustShorten = false;
    // Compare scrollHeight (incluant wrapping) vs hauteur 1 ligne (~22px pour font 13)
    const oneLineMaxHeight = 22;
    labels.forEach(l => {
      // Méthode 1 : si le contenu wrap, offsetHeight dépasse une ligne
      if (l.offsetHeight > oneLineMaxHeight) mustShorten = true;
      // Méthode 2 : si le texte est tronqué horizontalement (avec nowrap)
      if (l.scrollWidth > l.clientWidth + 1) mustShorten = true;
    });
    if (mustShorten) {
      labels.forEach(l => { l.textContent = l.dataset.short; });
    }
  });
}

// ResizeObserver pour re-vérifier si la modal change de taille (responsive)
if (typeof ResizeObserver !== 'undefined') {
  const list = document.getElementById('comp-stage-tabs-list');
  if (list) new ResizeObserver(() => adjustStageTabLabels()).observe(list);
}

function setStagesMode(on) {
  const tabsBar = document.getElementById('comp-stages-tabs');
  if (!tabsBar) return;
  if (on) {
    // 1ère activation : snapshot le form en stage 1 + ajoute un stage 2 vide
    // Réactivation : on garde toutes les étapes en mémoire, mais on sync le form courant
    // (qui a pu être édité en mode simple) sur l'étape 0
    if (stagesData.length >= 2) {
      stagesData[0] = readFormToStage();
      activeStageIdx = Math.min(activeStageIdx, stagesData.length - 1);
    } else {
      const current = readFormToStage();
      stagesData = [current, {}];
      activeStageIdx = 0;
    }
    tabsBar.hidden = false;
    renderStageTabs();
    writeStageToForm(stagesData[activeStageIdx]);
  } else {
    // Avant de cacher, snapshot le form courant dans l'étape active
    // → si on réactive plus tard, on retrouve les éditions
    if (stagesData.length > 0) {
      stagesData[activeStageIdx] = readFormToStage();
    }
    tabsBar.hidden = true;
    // Affiche les valeurs de l'étape 0 (= valeurs "principales" de la compé)
    if (stagesData.length > 0) writeStageToForm(stagesData[0]);
    // /!\ NE PAS vider stagesData → on garde tout en mémoire pour réactivation
  }
}

// Wire le toggle stages
const stagesToggleEl = document.getElementById('comp-modal-stages-toggle');
if (stagesToggleEl) {
  stagesToggleEl.addEventListener('change', () => {
    setStagesMode(stagesToggleEl.checked);
  });
}
// Wire le bouton + d'ajout d'étape
const MAX_STAGES = 10;
const stageAddBtn = document.getElementById('comp-stage-tab-add');
if (stageAddBtn) {
  stageAddBtn.addEventListener('click', () => {
    if (stagesData.length >= MAX_STAGES) return; // limite à 10 étapes
    stagesData[activeStageIdx] = readFormToStage();
    stagesData.push({});
    activeStageIdx = stagesData.length - 1;
    writeStageToForm(stagesData[activeStageIdx]);
    renderStageTabs();
  });
}

// Helper : auto-remplit km et D+ depuis le GPX courant dans la modal compé,
// en multipliant par le nombre de tours saisi
function _autofillKmDplusFromCompGpx() {
  const gpxInput = document.getElementById('comp-modal-gpx');
  const kmInput = document.getElementById('comp-modal-km');
  const dplusInput = document.getElementById('comp-modal-dplus');
  if (!gpxInput || !kmInput || !dplusInput) return;
  const file = gpxInput.files && gpxInput.files[0];
  const lapsVal = parseInt(document.getElementById('comp-modal-laps').value, 10) || 1;
  // Source du contenu : soit nouveau fichier upload, soit contenu déjà en mémoire (mode édition)
  function applyStats(gpxContent) {
    if (!gpxContent || typeof extractGpxStats !== 'function') return;
    const stats = extractGpxStats(gpxContent, lapsVal);
    if (!stats) return;
    kmInput.value = stats.km;
    dplusInput.value = stats.dplus;
    // Sync aussi le snapshot stage si on est en mode étapes
    if (typeof stagesData !== 'undefined' && stagesData[activeStageIdx]) {
      stagesData[activeStageIdx].km = String(stats.km);
      stagesData[activeStageIdx].dplus = String(stats.dplus);
    }
  }
  if (file) {
    file.text().then(applyStats).catch(() => {});
  } else if (typeof stagesData !== 'undefined' && stagesData[activeStageIdx] && stagesData[activeStageIdx].gpxContent) {
    applyStats(stagesData[activeStageIdx].gpxContent);
  }
}

function openCompModal() {
  const modal = document.getElementById('comp-modal');
  if (!modal) return;
  initFlatpickrAll(); // au cas où
  // Reset éventuels états d'erreur d'une précédente saisie
  if (typeof _clearAllFieldErrors === 'function') _clearAllFieldErrors('#comp-modal');
  // Reset mode édition (sera ré-activé par openCompModalForEdit si applicable)
  window._editingCompId = null;
  // Restaure le titre et le bouton en mode "création" par défaut
  const titleH2 = document.querySelector('#comp-modal .modal-title h2');
  if (titleH2) titleH2.textContent = 'Ajouter une compétition';
  const saveBtn = document.getElementById('comp-modal-save');
  if (saveBtn) saveBtn.textContent = 'Enregistrer';
  // Cache le bouton poubelle par défaut (sera affiché par openCompModalForEdit)
  const delBtn = document.getElementById('comp-modal-delete');
  if (delBtn) delBtn.hidden = true;
  // Reset form (sauf "time" qui est géré par le stepper)
  ['name','date','type','km','dplus','target','laps','notes'].forEach(k => {
    const el = document.getElementById('comp-modal-' + k);
    if (el) el.value = '';
  });
  // Reset toggle course par étapes + state stages
  const stagesToggle = document.getElementById('comp-modal-stages-toggle');
  if (stagesToggle) stagesToggle.checked = false;
  stagesData = [];
  activeStageIdx = 0;
  const tabsBar = document.getElementById('comp-stages-tabs');
  if (tabsBar) tabsBar.hidden = true;
  // Reset le stepper d'heure à 12h00 par défaut
  if (window.resetTimeStepper) window.resetTimeStepper('comp-modal-time', 12, 0);
  const prioEl = document.getElementById('comp-modal-priority');
  if (prioEl) {
    prioEl.value = 'A';
    if (typeof enhanceSelect === 'function') enhanceSelect('comp-modal-priority');
    if (prioEl._customUpdate) prioEl._customUpdate();
  }
  // Peuple le select sport (au cas où SPORTS_CATALOG n'était pas dispo à l'init)
  if (typeof populateSportSelect === 'function') populateSportSelect('comp-modal-sport', 'Ride');
  const sportEl = document.getElementById('comp-modal-sport');
  if (sportEl) sportEl.value = 'Ride';
  if (sportEl && sportEl._customUpdate) sportEl._customUpdate();
  // Peuple le select Type d'épreuve selon le sport actif
  if (typeof populateTypeSelectForSport === 'function') populateTypeSelectForSport('Ride');
  // Reset AGRESSIF du file-picker GPX (l'input file peut garder son state entre ouvertures)
  const gpxEl = document.getElementById('comp-modal-gpx');
  if (gpxEl) {
    try { gpxEl.value = ''; } catch (e) {}
    // Force aussi un FileList vide via DataTransfer (plus fiable que value='')
    try {
      const dt = new DataTransfer();
      gpxEl.files = dt.files;
    } catch (e) { /* navigateurs anciens */ }
    const picker = gpxEl.closest('.file-picker');
    if (picker) {
      picker.classList.remove('has-file');
      const lbl = picker.querySelector('.file-picker-label');
      if (lbl) lbl.textContent = 'Choisir un fichier GPX';
      const clr = picker.querySelector('.file-picker-clear');
      if (clr) clr.hidden = true;
    }
  }
  // Cleanup global de tous les file-pickers de la modal compé (au cas où il y en aurait plusieurs)
  document.querySelectorAll('#comp-modal .file-picker').forEach(p => {
    p.classList.remove('has-file');
    const lbl = p.querySelector('.file-picker-label');
    if (lbl) lbl.textContent = 'Choisir un fichier GPX';
    const clr = p.querySelector('.file-picker-clear');
    if (clr) clr.hidden = true;
    const inp = p.querySelector('input[type="file"]');
    if (inp) {
      try { inp.value = ''; } catch (e) {}
      try { inp.files = new DataTransfer().files; } catch (e) {}
    }
  });
  if (typeof initFilePickers === 'function') initFilePickers();
  modal.classList.add('active');
}
function closeCompModal() {
  const modal = document.getElementById('comp-modal');
  if (modal) modal.classList.remove('active');
}

// Helper validation : marque un champ comme requis manquant + affiche un mini message
function _markFieldError(inputId, message) {
  const el = document.getElementById(inputId);
  if (!el) return;
  // Cherche le form-field parent (peut être un label ou un div)
  const field = el.closest('.form-field') || el.parentElement;
  if (!field) return;
  field.classList.add('field-error');
  // Si un message d'erreur existe déjà, on l'update, sinon on le crée
  let msg = field.querySelector('.field-error-msg');
  if (!msg) {
    msg = document.createElement('div');
    msg.className = 'field-error-msg';
    field.appendChild(msg);
  }
  msg.textContent = message;
  // Cleanup auto au prochain input/change
  const clearOnce = () => {
    field.classList.remove('field-error');
    if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
    el.removeEventListener('input', clearOnce);
    el.removeEventListener('change', clearOnce);
  };
  el.addEventListener('input', clearOnce);
  el.addEventListener('change', clearOnce);
}
function _clearAllFieldErrors(modalSel) {
  document.querySelectorAll(`${modalSel} .field-error`).forEach(f => f.classList.remove('field-error'));
  document.querySelectorAll(`${modalSel} .field-error-msg`).forEach(m => m.remove());
}

async function saveCompFromModal() {
  _clearAllFieldErrors('#comp-modal');
  const name = document.getElementById('comp-modal-name').value.trim();
  const date = document.getElementById('comp-modal-date').value;
  if (!name || !date) {
    if (!name) _markFieldError('comp-modal-name', 'Champ requis');
    if (!date) _markFieldError('comp-modal-date', 'Champ requis');
    // Scroll vers le premier champ en erreur
    const first = document.querySelector('#comp-modal .field-error');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const time = document.getElementById('comp-modal-time').value || '';
  const priority = document.getElementById('comp-modal-priority').value;
  const sport = document.getElementById('comp-modal-sport').value;
  const typeEpr = document.getElementById('comp-modal-type').value.trim();
  const km = parseFloat(document.getElementById('comp-modal-km').value) || null;
  const dplus = parseInt(document.getElementById('comp-modal-dplus').value, 10) || null;
  const target = document.getElementById('comp-modal-target').value.trim();
  const laps = parseInt(document.getElementById('comp-modal-laps').value, 10) || null;
  const notes = document.getElementById('comp-modal-notes').value.trim();
  const stagesEl = document.getElementById('comp-modal-stages-toggle');
  const stages = !!(stagesEl && stagesEl.checked);

  // Si course par étapes : on récupère la liste des étapes (snapshot du form pour l'étape active)
  let stagesList = null;
  if (stages) {
    stagesData[activeStageIdx] = readFormToStage();
    // Lit les GPX async (chaque étape peut en avoir un)
    stagesList = [];
    for (let i = 0; i < stagesData.length; i++) {
      const s = stagesData[i];
      // Priorité : nouveau fichier > contenu existant en mémoire (édition sans re-upload)
      let gpxContent = s.gpxContent || null;
      if (s.gpxFile) {
        try { gpxContent = await s.gpxFile.text(); } catch (e) { console.warn('GPX étape ' + (i + 1) + ' :', e); }
      }
      stagesList.push({
        date: s.date || null,
        time: s.time || null,
        // priority et sport ne sont PAS stockés par étape (globaux à la compé)
        type: s.type || null,
        km: parseFloat(s.km) || null,
        dplus: parseInt(s.dplus, 10) || null,
        target: s.target || null,
        laps: parseInt(s.laps, 10) || null,
        notes: s.notes || null,
        gpxName: s.gpxName || null,
        gpxContent,
      });
    }
  }

  // GPX (lecture optionnelle)
  let gpxContent = null;
  let gpxName = null;
  const gpxFile = document.getElementById('comp-modal-gpx').files[0];
  if (gpxFile) {
    try {
      gpxContent = await gpxFile.text();
      gpxName = gpxFile.name;
    } catch (e) {
      console.warn('Lecture GPX impossible :', e);
    }
  }

  const comps = loadCompetitions();
  const newEntry = {
    id: window._editingCompId || Date.now().toString(),
    name, date, time, priority, sport,
    type: typeEpr, km, dplus, target, laps, notes,
    stages,
    stagesList,
    gpxName, gpxContent
  };
  if (window._editingCompId) {
    // Mode édition : remplace la compé existante
    const idx = comps.findIndex(c => c.id === window._editingCompId);
    if (idx >= 0) {
      // Conserve les éventuels champs GPX existants si non modifiés
      const old = comps[idx];
      if (!gpxContent && old.gpxContent) {
        newEntry.gpxName = old.gpxName;
        newEntry.gpxContent = old.gpxContent;
      }
      // Conserve gpxContent par étape si l'utilisateur n'a pas ré-uploadé
      if (stagesList && old.stagesList) {
        for (let i = 0; i < stagesList.length; i++) {
          if (!stagesList[i].gpxContent && old.stagesList[i] && old.stagesList[i].gpxContent) {
            stagesList[i].gpxContent = old.stagesList[i].gpxContent;
            stagesList[i].gpxName = old.stagesList[i].gpxName;
          }
        }
        newEntry.stagesList = stagesList;
      }
      comps[idx] = newEntry;
    } else {
      comps.push(newEntry); // au cas où l'ID a disparu, on l'ajoute
    }
    window._editingCompId = null;
  } else {
    comps.push(newEntry);
  }
  saveCompetitions(comps);
  closeCompModal();
  renderCompList();
  renderCalendar();
}

// Wire up modal triggers (défensif)
const openCompBtn = document.getElementById('open-comp-modal');
if (openCompBtn) openCompBtn.addEventListener('click', openCompModal);
const compModalClose = document.getElementById('comp-modal-close');
if (compModalClose) compModalClose.addEventListener('click', closeCompModal);
const compModalCancel = document.getElementById('comp-modal-cancel');
if (compModalCancel) compModalCancel.addEventListener('click', closeCompModal);
const compModalSave = document.getElementById('comp-modal-save');
if (compModalSave) compModalSave.addEventListener('click', saveCompFromModal);
const compModalOverlay = document.getElementById('comp-modal');
if (compModalOverlay) compModalOverlay.addEventListener('click', (e) => {
  if (e.target === compModalOverlay) closeCompModal();
});

// Auto-remplit km + D+ depuis le GPX dès qu'un fichier est sélectionné
const _compGpxInput = document.getElementById('comp-modal-gpx');
if (_compGpxInput) {
  _compGpxInput.addEventListener('change', () => {
    // Petit délai pour que le file-picker UI mette d'abord à jour son visuel
    setTimeout(() => { if (typeof _autofillKmDplusFromCompGpx === 'function') _autofillKmDplusFromCompGpx(); }, 50);
  });
}
// Recalcule km + D+ quand le nombre de tours change (si un GPX est présent)
const _compLapsInput = document.getElementById('comp-modal-laps');
if (_compLapsInput) {
  _compLapsInput.addEventListener('input', () => {
    if (typeof _autofillKmDplusFromCompGpx === 'function') _autofillKmDplusFromCompGpx();
  });
}

// ========= MODAL D'AJOUT D'ENTRAÎNEMENT =========
const TRAIN_KEY = 'coach_ia_trainings_v1';
function loadTrainings() {
  try {
    const raw = localStorage.getItem(TRAIN_KEY);
    if (!raw) return [];
    return JSON.parse(raw).filter(t => t.date && t.name);
  } catch (e) { return []; }
}
function saveTrainings(arr) {
  localStorage.setItem(TRAIN_KEY, JSON.stringify(arr));
}

// État local : mode d'ouverture de la modal entraînement ('prevu' ou 'realise')
let trainModalMode = 'prevu';
const TRAIN_REALISE_KEY = 'coach_ia_trainings_realise_v1';
function loadRealisedTrainings() {
  try {
    const raw = localStorage.getItem(TRAIN_REALISE_KEY);
    if (!raw) return [];
    return JSON.parse(raw).filter(t => t.date && t.name);
  } catch (e) { return []; }
}
function saveRealisedTrainings(arr) {
  localStorage.setItem(TRAIN_REALISE_KEY, JSON.stringify(arr));
}

function openTrainModal(mode) {
  const modal = document.getElementById('train-modal');
  if (!modal) return;
  trainModalMode = (mode === 'realise') ? 'realise' : 'prevu';
  initFlatpickrAll(); // au cas où
  if (typeof _clearAllFieldErrors === 'function') _clearAllFieldErrors('#train-modal');
  // Reset mode édition par défaut (sera ré-activé par openTrainModalForEdit)
  window._editingTrainId = null;
  window._editingTrainMode = null;
  const titleEl = document.getElementById('train-modal-title');
  if (titleEl) titleEl.textContent = (trainModalMode === 'realise')
    ? 'Ajouter un entraînement réalisé'
    : 'Ajouter un entraînement prévu';
  const saveBtn = document.getElementById('train-modal-save');
  if (saveBtn) saveBtn.textContent = 'Enregistrer';
  // Poubelle cachée par défaut (visible seulement en édition)
  const delBtn = document.getElementById('train-modal-delete');
  if (delBtn) delBtn.hidden = true;
  ['name','date','duration','tss','notes'].forEach(k => {
    const el = document.getElementById('train-modal-' + k);
    if (el) el.value = '';
  });
  // Reset structure (mode création)
  if (typeof window.resetWorkoutStructure === 'function') window.resetWorkoutStructure();
  if (typeof populateSportSelect === 'function') populateSportSelect('train-modal-sport', 'Ride');
  const s = document.getElementById('train-modal-sport');
  if (s) s.value = 'Ride';
  if (s && s._customUpdate) s._customUpdate();
  // Enhance le select Type aussi
  if (typeof enhanceSelect === 'function') enhanceSelect('train-modal-type');
  const tt = document.getElementById('train-modal-type');
  if (tt && tt._customUpdate) tt._customUpdate();
  const t = document.getElementById('train-modal-type');
  if (t) t.value = 'endurance';
  // Date par défaut : aujourd'hui pour réalisé, demain pour prévu
  const dateInput = document.getElementById('train-modal-date');
  if (dateInput) {
    const d = new Date();
    if (trainModalMode === 'prevu') d.setDate(d.getDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    dateInput.value = iso;
    if (dateInput._flatpickr) dateInput._flatpickr.setDate(d, false);
  }
  modal.classList.add('active');
}
function closeTrainModal() {
  const modal = document.getElementById('train-modal');
  if (modal) modal.classList.remove('active');
}
// Ouvre la modal entraînement en mode édition (pré-remplie)
function openTrainModalForEdit(training, mode) {
  if (!training || typeof openTrainModal !== 'function') return;
  openTrainModal(mode);
  window._editingTrainId = training.id;
  window._editingTrainMode = mode;
  trainModalMode = mode;
  document.getElementById('train-modal-name').value = training.name || '';
  document.getElementById('train-modal-date').value = training.date || '';
  if (document.getElementById('train-modal-date')._flatpickr && training.date) {
    document.getElementById('train-modal-date')._flatpickr.setDate(training.date, false);
  }
  if (training.sport) {
    const s = document.getElementById('train-modal-sport');
    if (s) { s.value = training.sport; if (s._customUpdate) s._customUpdate(); }
  }
  if (training.type) {
    const t = document.getElementById('train-modal-type');
    if (t) { t.value = training.type; if (t._customUpdate) t._customUpdate(); }
  }
  document.getElementById('train-modal-duration').value = training.duration != null ? training.duration : '';
  document.getElementById('train-modal-tss').value = training.tss != null ? training.tss : '';
  document.getElementById('train-modal-notes').value = training.notes || '';
  // Charger la structure si présente (mode édition)
  if (typeof window.setWorkoutStructure === 'function') {
    window.setWorkoutStructure(training.structure || []);
  }
  // Adapter titre + bouton + affiche poubelle
  const titleEl = document.getElementById('train-modal-title');
  if (titleEl) titleEl.textContent = (mode === 'realise')
    ? 'Modifier l\'entraînement réalisé'
    : 'Modifier l\'entraînement prévu';
  const saveBtn = document.getElementById('train-modal-save');
  if (saveBtn) saveBtn.textContent = 'Enregistrer les modifications';
  const delBtn = document.getElementById('train-modal-delete');
  if (delBtn) delBtn.hidden = false;
}

// Handler suppression entraînement depuis la modal d'édition
const _trainModalDelBtn = document.getElementById('train-modal-delete');
if (_trainModalDelBtn) {
  _trainModalDelBtn.addEventListener('click', async () => {
    const id = window._editingTrainId;
    const mode = window._editingTrainMode || trainModalMode;
    if (!id) return;
    const arr = mode === 'realise' ? loadRealisedTrainings() : loadTrainings();
    const t = arr.find(x => x.id === id);
    const name = t ? t.name : 'cet entraînement';
    const ok = await appConfirm({
      title: 'Supprimer cet entraînement',
      html: `Supprimer <strong>${window._confirmEscape(name)}</strong> ?`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const remaining = arr.filter(x => x.id !== id);
    if (mode === 'realise') saveRealisedTrainings(remaining);
    else saveTrainings(remaining);
    window._editingTrainId = null;
    window._editingTrainMode = null;
    closeTrainModal();
    if (typeof renderCalendar === 'function') renderCalendar();
  });
}

function saveTrainFromModal() {
  if (typeof _clearAllFieldErrors === 'function') _clearAllFieldErrors('#train-modal');
  const name = document.getElementById('train-modal-name').value.trim();
  const date = document.getElementById('train-modal-date').value;
  if (!name || !date) {
    if (typeof _markFieldError === 'function') {
      if (!name) _markFieldError('train-modal-name', 'Champ requis');
      if (!date) _markFieldError('train-modal-date', 'Champ requis');
      const first = document.querySelector('#train-modal .field-error');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
  const sport = document.getElementById('train-modal-sport').value;
  const type = document.getElementById('train-modal-type').value;
  const duration = parseInt(document.getElementById('train-modal-duration').value, 10) || 0;
  const tss = parseInt(document.getElementById('train-modal-tss').value, 10) || 0;
  const notes = document.getElementById('train-modal-notes').value.trim();
  const editingId = window._editingTrainId;
  // Structure (intervalles) si activée dans la modal — null sinon
  const structure = (typeof window.getCurrentWorkoutStructure === 'function')
    ? window.getCurrentWorkoutStructure()
    : null;
  const entry = {
    id: editingId || Date.now().toString(),
    name, date, sport, type, duration, tss, notes,
    mode: trainModalMode,
    structure, // [] | null | [{dur, target, reps}, ...]
  };

  const loadFn = trainModalMode === 'realise' ? loadRealisedTrainings : loadTrainings;
  const saveFn = trainModalMode === 'realise' ? saveRealisedTrainings : saveTrainings;
  const arr = loadFn();
  if (editingId) {
    // Mode édition : remplace l'entry existante
    const idx = arr.findIndex(t => t.id === editingId);
    if (idx >= 0) arr[idx] = entry; else arr.push(entry);
  } else {
    arr.push(entry);
  }
  saveFn(arr);
  window._editingTrainId = null;
  window._editingTrainMode = null;
  closeTrainModal();
  renderCalendar();
}

// Helpers globaux pour edit/delete depuis n'importe où
window.gpxEditTraining = function(id, mode) {
  const arr = mode === 'realise' ? loadRealisedTrainings() : loadTrainings();
  const t = arr.find(x => x.id === id);
  if (t && typeof openTrainModalForEdit === 'function') openTrainModalForEdit(t, mode);
};
window.gpxDeleteTraining = async function(id, mode) {
  const arr = mode === 'realise' ? loadRealisedTrainings() : loadTrainings();
  const t = arr.find(x => x.id === id);
  if (!t) return;
  const ok = await appConfirm({
    title: 'Supprimer cet entraînement',
    html: `Supprimer <strong>${window._confirmEscape(t.name)}</strong> ?`,
    confirmLabel: 'Supprimer',
    danger: true,
  });
  if (!ok) return;
  const remaining = arr.filter(x => x.id !== id);
  if (mode === 'realise') saveRealisedTrainings(remaining);
  else saveTrainings(remaining);
  if (typeof closeSessionModal === 'function') closeSessionModal();
  if (typeof renderCalendar === 'function') renderCalendar();
};

const openTrainBtn = document.getElementById('open-train-modal');
if (openTrainBtn) openTrainBtn.addEventListener('click', () => openTrainModal('prevu'));
const openTrainRealiseBtn = document.getElementById('open-train-realise-modal');
if (openTrainRealiseBtn) openTrainRealiseBtn.addEventListener('click', () => openTrainModal('realise'));
const trainModalClose = document.getElementById('train-modal-close');
if (trainModalClose) trainModalClose.addEventListener('click', closeTrainModal);
const trainModalCancel = document.getElementById('train-modal-cancel');
if (trainModalCancel) trainModalCancel.addEventListener('click', closeTrainModal);
const trainModalSave = document.getElementById('train-modal-save');
if (trainModalSave) trainModalSave.addEventListener('click', saveTrainFromModal);
const trainModalOverlay = document.getElementById('train-modal');
if (trainModalOverlay) trainModalOverlay.addEventListener('click', (e) => {
  if (e.target === trainModalOverlay) closeTrainModal();
});

// Esc ferme les modals d'ajout aussi
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCompModal();
    closeTrainModal();
  }
});

// ========= GÉNÉRATION DU PLAN 7 JOURS =========
function determinePhase(comps, currentTSB) {
  // TSB très bas → forcer décharge avant tout objectif
  if (currentTSB < -30) return { phase: 'recovery', daysUntil: null, comp: null };
  const futureComps = comps.filter(c => c.dateObj >= today).sort((a,b) => a.dateObj - b.dateObj);
  if (futureComps.length === 0) return { phase: 'build', daysUntil: null, comp: null };
  const next = futureComps[0];
  const daysUntil = Math.ceil((next.dateObj - today) / 86400000);
  let phase;
  if (daysUntil <= 7) phase = 'race';
  else if (daysUntil <= 28) phase = 'taper';
  else if (daysUntil <= 56) phase = 'peak';
  else phase = 'build';
  return { phase, daysUntil, comp: next };
}

// Templates par phase × jour de semaine (dow : 1=Lun, 0=Dim)
const PLAN_TEMPLATES = {
  build: {
    1: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Récup post-week-end, repos complet recommandé' },
    2: { type: 'tempo', name: 'Tempo / Sweet Spot', dur: 75, tss: 80, why: 'Volume d\'intensité modérée pour densifier le CTL' },
    3: { type: 'endurance', name: 'Endurance Z2', dur: 90, tss: 60, why: 'Base aérobie, fait grimper le CTL sans coût en fatigue' },
    4: { type: 'seuil', name: 'Seuil 4×8min', dur: 80, tss: 95, why: 'Bloc de seuil pour repousser le FTP' },
    5: { type: 'recup', name: 'Récup active', dur: 45, tss: 25, why: 'Évacuer la fatigue avant le week-end' },
    6: { type: 'vo2', name: 'VO2max 5×4min', dur: 90, tss: 110, why: 'Travail capacité aérobie maximale' },
    0: { type: 'endurance', name: 'Sortie longue Z2', dur: 180, tss: 160, why: 'Construire l\'endurance et la résistance, brique principale du build' }
  },
  peak: {
    1: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Récup totale' },
    2: { type: 'seuil', name: 'Seuil 3×12min', dur: 85, tss: 110, why: 'Renforcer le FTP en phase peak' },
    3: { type: 'endurance', name: 'Endurance Z2', dur: 75, tss: 55, why: 'Récupération active entre les blocs intensifs' },
    4: { type: 'vo2', name: 'VO2max 6×3min', dur: 80, tss: 115, why: 'Pic d\'intensité, le bloc clé du peak' },
    5: { type: 'recup', name: 'Récup active', dur: 40, tss: 20, why: 'Vidange complète avant le simulateur du week-end' },
    6: { type: 'tempo', name: 'Simulation course (sweet spot + sprints)', dur: 100, tss: 120, why: 'Reproduire les efforts de course pour préparer le corps' },
    0: { type: 'endurance', name: 'Sortie longue + 3×8min seuil', dur: 180, tss: 170, why: 'Maintenir l\'endurance avec un peu d\'intensité' }
  },
  taper: {
    1: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Affûtage' },
    2: { type: 'tempo', name: 'Tempo court 2×10min', dur: 50, tss: 50, why: 'Maintenir le tonus sans creuser la fatigue' },
    3: { type: 'endurance', name: 'Endurance Z2 courte', dur: 60, tss: 40, why: 'Volume réduit, faire chuter l\'ATL' },
    4: { type: 'vo2', name: 'VO2max 4×3min', dur: 60, tss: 70, why: 'Petite dose d\'intensité pour rester réactif' },
    5: { type: 'recup', name: 'Récup active', dur: 30, tss: 15, why: 'Décrassage' },
    6: { type: 'tempo', name: 'Openers : 3×30sec sprint', dur: 45, tss: 35, why: 'Activer le système neuromusculaire' },
    0: { type: 'endurance', name: 'Endurance Z2', dur: 90, tss: 60, why: 'Sortie de plaisir, sentir la forme arriver' }
  },
  race: {
    1: { type: 'rest', name: 'Repos complet', dur: 0, tss: 0, why: 'Semaine de course : zéro charge' },
    2: { type: 'recup', name: 'Récup active 30min', dur: 30, tss: 15, why: 'Décrasser sans fatiguer' },
    3: { type: 'tempo', name: 'Openers : 5×30sec sprint', dur: 40, tss: 30, why: 'Réveiller le corps' },
    4: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Veille de veille de course' },
    5: { type: 'tempo', name: 'Openers courts', dur: 30, tss: 25, why: 'Activation neuromusculaire' },
    6: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Repos avant course' },
    0: { type: 'vo2', name: 'COURSE 🏁', dur: 120, tss: 200, why: 'Jour J — donne tout' }
  },
  recovery: {
    1: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Décharge : récupération maximale' },
    2: { type: 'recup', name: 'Récup active', dur: 45, tss: 25, why: 'Décharge active douce' },
    3: { type: 'endurance', name: 'Endurance Z2 courte', dur: 60, tss: 40, why: 'Volume très bas, juste pour bouger' },
    4: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Récupération continue' },
    5: { type: 'recup', name: 'Récup active', dur: 40, tss: 20, why: 'Maintenir l\'élan sans charger' },
    6: { type: 'endurance', name: 'Endurance courte', dur: 75, tss: 55, why: 'Reprise progressive' },
    0: { type: 'endurance', name: 'Endurance Z2', dur: 90, tss: 60, why: 'Sortie facile pour finir la décharge' }
  }
};

const PHASE_LABELS = {
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race week',
  recovery: 'Décharge'
};

function adjustForRecovery(proposal, recovery) {
  // Récup basse → on adoucit
  if (recovery == null) return proposal;
  if (recovery < 34 && proposal.type !== 'rest') {
    return { ...proposal, type: 'recup', name: 'Récup active (recovery basse)', dur: Math.min(45, proposal.dur), tss: 20, why: `Recovery ${recovery}% : remplacement par récup active pour préserver l'équilibre` };
  }
  if (recovery < 50 && (proposal.type === 'vo2' || proposal.type === 'seuil')) {
    return { ...proposal, name: proposal.name + ' (allégé)', dur: Math.round(proposal.dur * 0.7), tss: Math.round(proposal.tss * 0.7), why: `Recovery ${recovery}% : intensité réduite -30%` };
  }
  return proposal;
}

function determinePhaseForDate(comps, fromDate, currentTSB) {
  if (currentTSB < -30) return 'recovery';
  const futureComps = comps.filter(c => c.dateObj >= fromDate).sort((a,b) => a.dateObj - b.dateObj);
  if (futureComps.length === 0) return 'build';
  const daysUntil = Math.ceil((futureComps[0].dateObj - fromDate) / 86400000);
  if (daysUntil <= 7) return 'race';
  if (daysUntil <= 28) return 'taper';
  if (daysUntil <= 56) return 'peak';
  return 'build';
}

function renderWeekPlan() {
  const comps = loadCompetitionsExpanded().map(c => ({ ...c, dateObj: new Date(c.date + 'T12:00:00') }));
  const { phase, daysUntil, comp } = determinePhase(comps, todayData.tsb);

  // Pill de phase supprimée — l'info est dans le sous-titre

  // Sous-titre supprimé
  const subEl = { textContent: '' };
  if (comp) {
    subEl.textContent = `Prochain objectif : ${comp.name} (priorité ${comp.priority}) dans ${daysUntil} jours · phase actuelle ${PHASE_LABELS[phase]}`;
  } else if (phase === 'recovery') {
    subEl.textContent = `TSB actuel ${todayData.tsb.toFixed(0)} : décharge prioritaire avant tout objectif`;
  } else {
    subEl.textContent = `Aucune compétition planifiée · phase ${PHASE_LABELS[phase]} (entretien général)`;
  }

  // Lundi de la semaine courante = première semaine affichée
  const thisMonday = getMondayOfWeek(today);
  const todayIso = toIsoDate(today);

  // Index data par date ISO pour les jours passés
  const dataByIso = {};
  data.forEach(d => { dataByIso[toIsoDate(d.date)] = d; });

  // Mode Prévu : TOUJOURS 4 semaines glissantes en ORDRE CHRONOLOGIQUE
  // (semaine courante / 1ère du mois en haut, semaines suivantes vers le bas)
  let weeksStarts = [];
  const startMonday = selectedMonth
    ? getMondayOfWeek(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1))
    : thisMonday;
  for (let w = 0; w < 4; w++) {
    const ws = new Date(startMonday);
    ws.setDate(startMonday.getDate() + w * 7);
    weeksStarts.push(ws);
  }

  const weeksHtml = [];
  for (let w = 0; w < weeksStarts.length; w++) {
    const weekStart = weeksStarts[w];
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekLabel = `Semaine du ${fmtShortDate(weekStart)} au ${fmtShortDate(weekEnd)}`;

    const dayCards = [];
    let weekTotalDur = 0;
    let weekTotalTss = 0;
    let weekTotalSessions = 0;
    let weekKind = 'past'; // 'past' = entièrement passée, 'current' = en cours, 'future' = à venir

    // Snapshots de plans figés (= ce qui était prévu pour les jours passés)
    const planSnapshots = loadPlanSnapshots();

    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = toIsoDate(d);
      const dow = d.getDay();
      const isPast = iso < todayIso;
      const isToday = iso === todayIso;

      let cardHTML;
      let proposal; // sera défini soit depuis le snapshot, soit calculé

      // Cas 1 : jour passé → on regarde si on a un snapshot
      if (isPast) {
        if (planSnapshots[iso]) {
          // Snapshot disponible → on affichera ce qui était prévu ce jour-là (grisé)
          proposal = { ...planSnapshots[iso] };
          // Filtre sport : si le snapshot ne match pas, afficher empty-past
          if (!activeSports.has('tout') && activeSports.size > 0 &&
              proposal.type !== 'rest' &&
              !activeSports.has(getSportCategory(proposal.sport))) {
            cardHTML = `
              <div class="day-card empty-past" data-iso="${iso}" data-source="prevu">
                <div class="day-card-dow">${dowFr[dow]}</div>
                <div class="day-card-date">${d.getDate()}</div>
              </div>
            `;
            dayCards.push(cardHTML);
            continue;
          }
        } else {
          // Pas de snapshot pour ce jour passé → vierge (avant l'activation du système)
          cardHTML = `
            <div class="day-card empty-past" data-iso="${iso}" data-source="prevu">
              <div class="day-card-dow">${dowFr[dow]}</div>
              <div class="day-card-date">${d.getDate()}</div>
            </div>
          `;
          dayCards.push(cardHTML);
          continue;
        }
      } else {
        // Cas 2 : aujourd'hui ou futur
        // On collecte TOUS les items du jour : compés/étapes + entraînements manuels
        // Si rien → template AI. Si ≥ 1 → on ignore le template.
        let items = [];

        // 1) Toutes les compés (chaque étape compte comme un item)
        const compsForToday = comps.filter(c => toIsoDate(c.dateObj) === iso);
        for (const c of compsForToday) {
          // Si pas de temps cible saisi → on n'affiche PAS de durée par défaut
          // (on garde un fallback de 120 min en interne pour le calcul TSS)
          let raceDur = null;
          let raceDurForTss = 120;
          if (c.target) {
            const m = c.target.match(/(\d+)\s*h\s*(\d{0,2})/i);
            if (m) {
              raceDur = parseInt(m[1], 10) * 60 + (parseInt(m[2], 10) || 0);
              raceDurForTss = raceDur;
            }
          }
          const raceTss = Math.round(raceDurForTss * 1.0);
          let raceName, stageInfo = '';
          if (c.stageIdx !== undefined && c.totalStages) {
            raceName = c.name.replace(/ — Étape \d+$/, '');
            stageInfo = `Étape ${c.stageIdx + 1}/${c.totalStages}`;
          } else {
            raceName = c.name;
          }
          items.push({
            type: 'vo2',
            name: raceName,
            stageInfo,
            isRace: true,
            dur: raceDur,
            tss: raceTss,
            sport: c.sport || 'Ride',
            km: c.km || null,
            priority: c.priority,
            why: `Compétition · priorité ${c.priority || 'A'}${c.km ? ' · ' + Math.round(c.km) + ' km' : ''}`,
          });
        }

        // 2) Tous les entraînements prévus manuels pour ce jour
        const manualTrainings = (typeof loadTrainings === 'function') ? loadTrainings() : [];
        const manualForToday = manualTrainings.filter(t => t.date === iso);
        for (const m of manualForToday) {
          items.push({
            type: m.type || 'endurance',
            name: m.name,
            dur: m.duration || 0,
            tss: m.tss || 0,
            sport: m.sport || 'Ride',
            why: m.notes || 'Séance ajoutée manuellement',
            _manual: true,
          });
        }

        // 3) Si aucun item explicite → template AI (uniquement en MODE IA)
        // En mode Manuel : on ne propose RIEN, le jour reste vide à planifier.
        // Le repos forcé manuel reste affiché dans les deux modes.
        if (items.length === 0) {
          const _isForcedRest = (typeof isTemplateRestDay === 'function') && isTemplateRestDay(iso);
          if (_isForcedRest) {
            items.push({ type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Repos forcé (override utilisateur)' });
          } else if (window.APP_MODE === 'ia') {
            const dayPhase = determinePhaseForDate(comps, d, todayData.tsb);
            const tmpl = PLAN_TEMPLATES[dayPhase][dow];
            let tmplProposal = { ...tmpl };
            if (isToday) tmplProposal = adjustForRecovery(tmplProposal, todayData.recovery);
            items.push(tmplProposal);
          }
          // Sinon (mode Manuel + pas de repos forcé) : items reste vide → jour empty-past
        }

        // 4) Filtre sport : ne garder que les items dont la catégorie match les sports actifs.
        // Les repos passent toujours (ils n'ont pas de sport propre).
        if (!activeSports.has('tout') && activeSports.size > 0) {
          items = items.filter(it => it.type === 'rest' || activeSports.has(getSportCategory(it.sport)));
        }

        // 5) Si aucun item ne passe le filtre → jour vide, on saute le rendu de la card normale
        if (items.length === 0) {
          cardHTML = `
            <div class="day-card empty-past" data-iso="${iso}" data-source="prevu">
              <div class="day-card-dow">${dowFr[dow]}</div>
              <div class="day-card-date">${d.getDate()}</div>
            </div>
          `;
          dayCards.push(cardHTML);
          continue;
        }

        // Index de l'item actuellement affiché (pour multi-items)
        const curIdx = Math.min(dayPrevuIndex[iso] || 0, items.length - 1);
        proposal = items[curIdx];
        proposal._totalItems = items.length;
        proposal._itemIdx = curIdx;

        // Snapshot : aujourd'hui est ré-écrasé à chaque render
        if (isToday) savePlanSnapshot(iso, proposal, true);
      }

      // Une séance est "rest" uniquement si son TYPE est 'rest'
      // (un entraînement manuel sans TSS reste un vrai entraînement, pas un repos)
      const isRest = proposal.type === 'rest';
      const todayClass = isToday ? ' today' : '';
      const pastClass = isPast ? ' prevu-past' : '';
      // On comptabilise dans les totaux uniquement aujourd'hui + futur (pas le passé)
      if (!isPast && proposal.tss) {
        weekTotalDur += proposal.dur || 0;
        weekTotalTss += proposal.tss || 0;
        weekTotalSessions += 1;
      }
      // L'item actuellement affiché peut être une compé ou un entraînement manuel
      const isRace = !!proposal.isRace;
      const raceClass = isRace ? ' race' : '';
      const raceAttr = isRace ? ` data-priority="${proposal.priority || 'A'}"` : '';
      // Sport label
      let sportLabel = '';
      let sportCat = 'autre';
      if (!isRest) {
        sportLabel = window.sportFr(proposal.sport || 'cyclisme');
        sportCat = window.activitySportColorKey({ sport: proposal.sport || 'cyclisme' }) || 'autre';
      }
      const kmStr = proposal.km ? Math.round(proposal.km) + ' km' : '';
      const durStr = proposal.dur ? `${Math.floor(proposal.dur/60)}h${(proposal.dur%60).toString().padStart(2,'0')}` : '';
      const metaLine = [durStr, kmStr].filter(Boolean).join(' · ');
      const sportBlock = sportLabel
        ? `<div class="day-card-sport"><span class="sport-pill" data-sport-cat="${sportCat}">${sportLabel}</span></div>`
        : '';
      const dowSuffix = isToday ? " · auj." : (isPast ? ' · passé' : '');
      const stageInfoLine = (proposal.stageInfo)
        ? `<div class="day-card-stage">${proposal.stageInfo}</div>`
        : '';
      // Multi-items : flèches ‹ › + compteur, comme pour Réalisé
      const totalItems = proposal._totalItems || 1;
      const curItemIdx = proposal._itemIdx || 0;
      const hasMulti = totalItems > 1;
      const dateRow = hasMulti ? `
        <div class="day-card-date-row">
          <div class="day-card-date">${d.getDate()}</div>
          <div class="day-card-arrows-wrapper">
            <button class="day-card-arrow-inline arrow-prev-prevu" data-iso="${iso}" title="Activité précédente">‹</button>
            <button class="day-card-arrow-inline arrow-next-prevu" data-iso="${iso}" title="Activité suivante">›</button>
          </div>
        </div>
      ` : `<div class="day-card-date">${d.getDate()}</div>`;
      const counter = hasMulti ? `<div class="day-card-counter">${curItemIdx + 1}/${totalItems}</div>` : '';
      cardHTML = `
        <div class="day-card${isRest ? ' rest' : ''}${todayClass}${pastClass}${raceClass}" data-iso="${iso}" data-source="prevu"${raceAttr}>
          <div class="day-card-dow">${dowFr[dow]}${dowSuffix}</div>
          ${dateRow}
          <div class="day-card-name">${proposal.name}</div>
          ${stageInfoLine}
          <div class="day-card-meta">${metaLine}</div>
          ${sportBlock}
          ${counter}
        </div>
      `;
      dayCards.push(cardHTML);

      // Détermine si la semaine est passée, en cours ou future
      if (isToday) weekKind = 'current';
      else if (!isPast && weekKind === 'past') weekKind = 'current';
    }
    if (weekStart > today) weekKind = 'future';

    // Carte des totaux (réalisé pour passé/courant, prévu pour future)
    const _wh = Math.floor(weekTotalDur / 60);
    const _wm = Math.round(weekTotalDur % 60);
    const totalHours = `${_wh}<span style="font-size:11px;font-weight:500;">h</span>${_wm.toString().padStart(2, '0')}`;
    const totalsLabel = weekKind === 'future' ? 'Prévu' : (weekKind === 'current' ? 'En cours' : 'Bilan');
    // Prévu : pas de km réels (à venir), pas de CTL/ATL projetés (complexe)
    const totalsCard = `
      <div class="week-totals" data-view="volume">
        <div class="wt-header">
          <button class="wt-arrow wt-prev" title="Vue précédente">‹</button>
          <span class="wt-label">${totalsLabel}</span>
          <button class="wt-arrow wt-next" title="Vue suivante">›</button>
        </div>
        <div class="wt-view wt-view-volume">
          <div class="wt-row"><span class="wt-val">${totalHours}</span><span class="wt-lbl">Volume</span></div>
          <div class="wt-row"><span class="wt-val">—</span><span class="wt-lbl">Km</span></div>
          <div class="wt-row"><span class="wt-val">${weekTotalSessions}</span><span class="wt-lbl">Séances</span></div>
        </div>
        <div class="wt-view wt-view-charge">
          <div class="wt-row"><span class="wt-val">${weekTotalTss}</span><span class="wt-lbl">TSS prévu</span></div>
          <div class="wt-row"><span class="wt-val">—</span><span class="wt-lbl">CTL</span></div>
          <div class="wt-row"><span class="wt-val">—</span><span class="wt-lbl">ATL</span></div>
        </div>
        <div class="wt-dots">
          <span class="wt-dot d-volume"></span>
          <span class="wt-dot d-charge"></span>
        </div>
      </div>
    `;
    dayCards.push(totalsCard);

    weeksHtml.push(`
      <div class="week-row">
        <div class="week-row-label">${weekLabel}</div>
        <div class="week-row-days">${dayCards.join('')}</div>
      </div>
    `);
  }

  document.getElementById('week-calendar').innerHTML = `<div class="month-plan">${weeksHtml.join('')}</div>`;
}

// ========= MODE PRÉVU vs RÉALISÉ =========
let calendarMode = 'prevu';
let selectedMonth = null; // null = 4 dernières semaines, sinon Date 1er du mois sélectionné
// Index de l'activité affichée par jour (pour les jours multi-activités). Clé = ISO date.
const dayActivityIndex = {};
// Index de l'item Prévu affiché par jour (pour jours avec plusieurs compés/entraînements)
const dayPrevuIndex = {};

function getDisplayedActivity(realDay) {
  // Renvoie l'activité actuellement à afficher pour ce jour (selon dayActivityIndex)
  const iso = toIsoDate(realDay.date);
  const acts = realDay.activities;
  if (!acts || acts.length === 0) return null;
  const idx = dayActivityIndex[iso] || 0;
  return { activity: acts[Math.min(idx, acts.length - 1)], idx: Math.min(idx, acts.length - 1), total: acts.length, iso };
}

function renderRealisedDayCard(d, dow, realDay, isToday) {
  const dispo = getDisplayedActivity(realDay);
  // Si pas de tableau activities (ancien data.js), fallback sur les champs racine du day
  const act = dispo ? dispo.activity : realDay;
  const total = dispo ? dispo.total : 1;
  const idx = dispo ? dispo.idx : 0;
  const iso = toIsoDate(d);

  const dur = act.duration || 0;
  const h = Math.floor(dur / 60);
  const m = (dur % 60).toString().padStart(2, '0');

  const hasMulti = total > 1;
  const dateRow = hasMulti ? `
    <div class="day-card-date-row">
      <div class="day-card-date">${d.getDate()}</div>
      <div class="day-card-arrows-wrapper">
        <button class="day-card-arrow-inline arrow-prev" data-iso="${iso}" title="Activité précédente">‹</button>
        <button class="day-card-arrow-inline arrow-next" data-iso="${iso}" title="Activité suivante">›</button>
      </div>
    </div>
  ` : `<div class="day-card-date">${d.getDate()}</div>`;

  const counter = hasMulti ? `<div class="day-card-counter">${idx + 1}/${total}</div>` : '';

  // Fallbacks robustes pour data.js ancien format (champs day-level)
  const aType = act.type || act.sessionType || '';
  const aName = act.name || act.sessionName || 'Séance';
  const km = act.distance_km ? Math.round(act.distance_km) + ' km' : '';
  // Nom de sport Strava exact + clé couleur pour la pill
  const sportLabel = window.activitySportLabel ? window.activitySportLabel(act) : '';
  const sportCat = window.activitySportColorKey ? window.activitySportColorKey(act) : 'autre';

  // Check si c'est un jour de compétition
  const comps = (typeof loadCompetitionsExpanded === 'function') ? loadCompetitionsExpanded() : [];
  const compToday = comps.find(c => c.date === iso);
  const raceClass = compToday ? ' race' : '';
  const raceAttr = compToday ? ` data-priority="${compToday.priority || 'A'}"` : '';

  // Meta : durée + km (Strava) OU durée + TSS (manuel sans km, ex: muscu/yoga)
  let metaParts = [];
  if (dur) metaParts.push(`${h}h${m}`);
  if (km) metaParts.push(km);
  else if (act.tss) metaParts.push(act.tss + ' TSS'); // pas de km → on met TSS
  const metaLine = metaParts.join(' · ');

  // Marqueur si TOUTES les activités du jour sont manuelles (= pas tracké par Strava)
  const allManual = realDay && realDay.activities && realDay.activities.length
    && realDay.activities.every(a => a._manual);
  const manualClass = allManual ? ' manual' : '';

  // Sport block : ne rendre QUE si on a un label (sinon = ligne dashed orpheline qui fait croire à un jour de repos)
  const sportBlock = sportLabel
    ? `<div class="day-card-sport"><span class="sport-pill" data-sport-cat="${sportCat}">${sportLabel}</span></div>`
    : '';

  return `
    <div class="day-card past${isToday ? ' today' : ''}${raceClass}${manualClass}" data-iso="${iso}" data-source="realise"${raceAttr}>
      <div class="day-card-dow">${dowFr[dow]}${isToday ? ' · auj.' : ''}</div>
      ${dateRow}
      <div class="day-card-name">${aName}</div>
      <div class="day-card-meta">${metaLine}</div>
      ${sportBlock}
      ${counter}
    </div>
  `;
}

function renderCalendar() {
  // Filtre mois visible dans les deux modes
  document.getElementById('month-filter').style.display = 'flex';
  // Reset button label selon le mode
  const resetBtn = document.getElementById('month-reset');
  if (resetBtn) {
    resetBtn.textContent = calendarMode === 'prevu' ? '4 sem. à venir' : '4 dernières semaines';
  }
  if (calendarMode === 'prevu') {
    renderWeekPlan();
  } else {
    renderRealiseCalendar();
  }
}

// Expose les fonctions principales sur window pour que les modules ES6 externes
// (day-extras.js notamment) puissent les appeler.
window.renderCalendar = renderCalendar;
window.openTrainModal = openTrainModal;
window.openCompModal = openCompModal;
window.renderCompList = (typeof renderCompList === 'function') ? renderCompList : (() => {});

function renderRealiseCalendar() {
  // Sous-titre supprimé
  const subEl = { textContent: '' };

  // Index data par ISO
  const dataByIso = {};
  data.forEach(d => { dataByIso[toIsoDate(d.date)] = d; });

  // Déterminer les semaines à afficher
  let weeksStarts = [];
  if (selectedMonth) {
    // Mois sélectionné : juste les semaines de ce mois, sans injection de semaine courante
    const firstDay = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
    const lastDay = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);
    const firstMonday = getMondayOfWeek(firstDay);
    let cursor = new Date(firstMonday);
    while (cursor <= lastDay) {
      weeksStarts.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    const monthLabel = selectedMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    subEl.textContent = `Réalisé · ${monthLabel}`;
  } else {
    // Default : 4 dernières semaines incluant la semaine en cours
    const thisMonday = getMondayOfWeek(today);
    for (let i = 3; i >= 0; i--) {
      const w = new Date(thisMonday);
      w.setDate(thisMonday.getDate() - i * 7);
      weeksStarts.push(w);
    }
    subEl.textContent = `Réalisé · 4 dernières semaines`;
  }
  // Inversion : semaine la plus récente du mois en haut
  weeksStarts.reverse();

  const todayIso = toIsoDate(today);
  const weeksHtml = [];
  for (const weekStart of weeksStarts) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekLabel = `Semaine du ${fmtShortDate(weekStart)} au ${fmtShortDate(weekEnd)}`;

    const dayCards = [];
    let weekTotalDur = 0;
    let weekTotalTss = 0;
    let weekTotalSessions = 0;
    let weekTotalKm = 0;
    let lastDayWithMetrics = null; // pour récupérer CTL/ATL en fin de semaine

    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = toIsoDate(d);
      const dow = d.getDay();
      const isFuture = iso > todayIso;
      const isToday = iso === todayIso;

      let cardHTML;
      if (isFuture) {
        // Jour futur : on n'affiche rien (mode réalisé)
        cardHTML = `
          <div class="day-card empty-past" data-iso="${iso}" data-source="realise" style="opacity:0.3;">
            <div class="day-card-dow">${dowFr[dow]}</div>
            <div class="day-card-date">${d.getDate()}</div>
            <div class="day-card-name" style="color:var(--text-mute);font-weight:500;">À venir</div>
          </div>
        `;
      } else {
        let realDay = dataByIso[iso];
        // Filtre les activités Strava masquées par l'utilisateur (suppression locale)
        if (realDay && realDay.activities && typeof isStravaIgnored === 'function') {
          const filtered = realDay.activities.filter(a => {
            if (a._manual) return true;
            const aid = a.id || a.activityId;
            return !aid || !isStravaIgnored(aid);
          });
          if (filtered.length !== realDay.activities.length) {
            realDay = { ...realDay, activities: filtered };
            // Si plus aucune activité après filtrage, on traite comme un jour sans data
            if (filtered.length === 0) realDay = null;
          }
        }
        // Récupère les entraînements MANUELS réalisés (ex: muscu, yoga ajoutés à la main)
        const manualRealised = (typeof loadRealisedTrainings === 'function') ? loadRealisedTrainings().filter(t => t.date === iso) : [];
        // Si on a des manuels et pas de realDay Strava, on en crée un virtuel
        // Si on a déjà un realDay Strava, on merge les activités manuelles dedans
        if (manualRealised.length > 0) {
          if (!realDay) realDay = { date: iso, activities: [], sessionType: 'autre' };
          if (!realDay.activities) realDay.activities = [];
          for (const m of manualRealised) {
            // Le sport peut être un raw_type Strava (Ride, WeightTraining...) OU une catégorie
            const sportVal = m.sport || 'autre';
            realDay.activities.push({
              name: m.name,
              sport: sportVal,
              raw_type: sportVal, // utilisé par activitySportLabel / Color pour le pill
              type: m.type || 'endurance',
              sessionType: m.type || 'endurance',
              sessionName: m.name,
              duration: m.duration || 0,
              tss: m.tss || 0,
              distance_km: null,
              _manual: true,
              _manualId: m.id, // id pour edit/delete depuis la modal
              notes: m.notes || '',
            });
          }
          // Recalcule duration et tss au niveau jour si pas déjà set
          if (!realDay.duration) realDay.duration = realDay.activities.reduce((s, a) => s + (a.duration || 0), 0);
          if (!realDay.tss) realDay.tss = realDay.activities.reduce((s, a) => s + (a.tss || 0), 0);
          if (!realDay.sessionType) realDay.sessionType = realDay.activities[0].type || 'endurance';
          if (!realDay.sessionName) realDay.sessionName = realDay.activities[0].name;
        }
        // Mémorise le dernier jour avec CTL/ATL
        if (realDay && (realDay.ctl != null || realDay.atl != null)) {
          lastDayWithMetrics = realDay;
        }
        if (realDay && realDay.sessionType) {
          const dur = realDay.duration || 0;
          weekTotalDur += dur;
          weekTotalTss += realDay.tss || 0;
          weekTotalSessions += (realDay.activities && realDay.activities.length) ? realDay.activities.length : 1;
          if (realDay.activities && realDay.activities.length) {
            for (const a of realDay.activities) weekTotalKm += a.distance_km || 0;
          } else if (realDay.distance_km) {
            weekTotalKm += realDay.distance_km;
          }
          cardHTML = renderRealisedDayCard(d, dow, realDay, isToday);
        } else {
          cardHTML = `
            <div class="day-card empty-past" data-iso="${iso}" data-source="realise">
              <div class="day-card-dow">${dowFr[dow]}${isToday ? " · auj." : ''}</div>
              <div class="day-card-date">${d.getDate()}</div>
              <div class="day-card-name" style="color:var(--text-mute);font-weight:500;">Repos</div>
            </div>
          `;
        }
      }
      dayCards.push(cardHTML);
    }

    const _rh = Math.floor(weekTotalDur / 60);
    const _rm = Math.round(weekTotalDur % 60);
    const totalHours = `${_rh}<span style="font-size:11px;font-weight:500;">h</span>${_rm.toString().padStart(2, '0')}`;
    const totalKm = Math.round(weekTotalKm);
    const lastCtl = lastDayWithMetrics && lastDayWithMetrics.ctl != null ? Math.round(lastDayWithMetrics.ctl) : '—';
    const lastAtl = lastDayWithMetrics && lastDayWithMetrics.atl != null ? Math.round(lastDayWithMetrics.atl) : '—';
    const totalsCard = `
      <div class="week-totals" data-view="volume">
        <div class="wt-header">
          <button class="wt-arrow wt-prev" title="Vue précédente">‹</button>
          <span class="wt-label">Bilan</span>
          <button class="wt-arrow wt-next" title="Vue suivante">›</button>
        </div>
        <div class="wt-view wt-view-volume">
          <div class="wt-row"><span class="wt-val">${totalHours}</span><span class="wt-lbl">Volume</span></div>
          <div class="wt-row"><span class="wt-val">${totalKm}<span style="font-size:11px;font-weight:500;">km</span></span><span class="wt-lbl">Distance</span></div>
          <div class="wt-row"><span class="wt-val">${weekTotalSessions}</span><span class="wt-lbl">Séances</span></div>
        </div>
        <div class="wt-view wt-view-charge">
          <div class="wt-row"><span class="wt-val">${weekTotalTss}</span><span class="wt-lbl">TSS</span></div>
          <div class="wt-row"><span class="wt-val">${lastCtl}</span><span class="wt-lbl">CTL</span></div>
          <div class="wt-row"><span class="wt-val">${lastAtl}</span><span class="wt-lbl">ATL</span></div>
        </div>
        <div class="wt-dots">
          <span class="wt-dot d-volume"></span>
          <span class="wt-dot d-charge"></span>
        </div>
      </div>
    `;
    dayCards.push(totalsCard);

    weeksHtml.push(`
      <div class="week-row">
        <div class="week-row-label">${weekLabel}</div>
        <div class="week-row-days">${dayCards.join('')}</div>
      </div>
    `);
  }

  document.getElementById('week-calendar').innerHTML = `<div class="month-plan">${weeksHtml.join('')}</div>`;
}

// Handler flèches + clic carte (event delegation sur le calendrier)
document.getElementById('week-calendar').addEventListener('click', (e) => {
  // Flèches de switch de vue sur les cartes totaux (Volume ↔ Charge)
  const isWtArrow = e.target.classList.contains('wt-arrow');
  if (isWtArrow) {
    e.stopPropagation();
    const card = e.target.closest('.week-totals');
    if (!card) return;
    const current = card.getAttribute('data-view') || 'volume';
    const views = ['volume', 'charge'];
    const idx = views.indexOf(current);
    const dir = e.target.classList.contains('wt-next') ? 1 : -1;
    let next = (idx + dir + views.length) % views.length;
    card.setAttribute('data-view', views[next]);
    return;
  }

  // Flèches multi-activités sur les cartes jour (mode Réalisé)
  const isPrev = e.target.classList.contains('arrow-prev');
  const isNext = e.target.classList.contains('arrow-next');
  if (isPrev || isNext) {
    e.stopPropagation();
    const iso = e.target.dataset.iso;
    const day = data.find(d => toIsoDate(d.date) === iso);
    if (!day || !day.activities || day.activities.length < 2) return;
    const dir = isNext ? 1 : -1;
    const current = dayActivityIndex[iso] || 0;
    let next = current + dir;
    if (next < 0) next = day.activities.length - 1;
    if (next >= day.activities.length) next = 0;
    dayActivityIndex[iso] = next;
    renderCalendar();
    return;
  }
  // Flèches multi-items sur les cartes Prévu (compés + entraînements manuels)
  const isPrevPrevu = e.target.classList.contains('arrow-prev-prevu');
  const isNextPrevu = e.target.classList.contains('arrow-next-prevu');
  if (isPrevPrevu || isNextPrevu) {
    e.stopPropagation();
    const iso = e.target.dataset.iso;
    // On compte le nombre d'items pour ce jour (compés + manuels)
    const compsExp = (typeof loadCompetitionsExpanded === 'function') ? loadCompetitionsExpanded() : [];
    const nbComps = compsExp.filter(c => c.date === iso).length;
    const manualTr = (typeof loadTrainings === 'function') ? loadTrainings() : [];
    const nbManual = manualTr.filter(t => t.date === iso).length;
    const total = nbComps + nbManual;
    if (total < 2) return;
    const dir = isNextPrevu ? 1 : -1;
    const current = dayPrevuIndex[iso] || 0;
    let next = current + dir;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    dayPrevuIndex[iso] = next;
    renderCalendar();
    return;
  }
  // Clic sur la carte → ouvrir la modal (sauf si c'est une carte totaux)
  const card = e.target.closest('.day-card');
  if (!card || card.classList.contains('empty-past')) return;
  const iso = card.dataset.iso;
  const source = card.dataset.source;
  if (!iso) return;
  openSessionModal(iso, source);
});

// ========= API CLIENT INTERVALS.ICU (via Cloudflare Worker proxy) =========
const streamsCache = {};
const activityCache = {};
const STREAMS_LS_KEY = 'coach_ia_streams_cache_v1';
const STREAMS_LS_MAX = 30; // garder les 30 derniers streams en localStorage

async function apiFetch(path) {
  const resp = await fetch(`/api/intervals${path}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

function _lsGet() {
  try { return JSON.parse(localStorage.getItem(STREAMS_LS_KEY) || '{}'); }
  catch { return {}; }
}
function _lsSet(cache) {
  try { localStorage.setItem(STREAMS_LS_KEY, JSON.stringify(cache)); }
  catch (e) {
    console.warn('LS streams cache plein, on vide');
    try { localStorage.removeItem(STREAMS_LS_KEY); } catch {}
  }
}
function loadStreamsFromLS(activityId) {
  const cache = _lsGet();
  return cache[activityId] ? cache[activityId].data : null;
}
function saveStreamsToLS(activityId, data) {
  let cache = _lsGet();
  cache[activityId] = { data, ts: Date.now() };
  const entries = Object.entries(cache);
  if (entries.length > STREAMS_LS_MAX) {
    entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    cache = Object.fromEntries(entries.slice(0, STREAMS_LS_MAX));
  }
  _lsSet(cache);
}

async function loadStreams(activityId) {
  if (!activityId) return null;
  const idKey = String(activityId);
  // 0. Pre-fetched côté serveur (streams.js, dispo dès le chargement)
  if (window.STREAMS_CACHE && window.STREAMS_CACHE[idKey]) {
    return window.STREAMS_CACHE[idKey];
  }
  // 1. Cache mémoire de la session courante
  if (streamsCache[activityId] !== undefined) return streamsCache[activityId];
  // 2. Cache localStorage (persiste entre sessions)
  const cached = loadStreamsFromLS(activityId);
  if (cached) {
    streamsCache[activityId] = cached;
    return cached;
  }
  // 3. Fetch live via le proxy
  try {
    const data = await apiFetch(`/activity/${activityId}/streams?types=watts,heartrate,cadence,distance,altitude`);
    streamsCache[activityId] = data;
    saveStreamsToLS(activityId, data);
    return data;
  } catch (e) {
    console.error('loadStreams:', e);
    streamsCache[activityId] = null;
    return null;
  }
}

async function loadActivityFull(activityId) {
  if (!activityId) return null;
  if (activityCache[activityId] !== undefined) return activityCache[activityId];
  try {
    const data = await apiFetch(`/activity/${activityId}`);
    activityCache[activityId] = data;
    return data;
  } catch (e) {
    console.error('loadActivityFull:', e);
    activityCache[activityId] = null;
    return null;
  }
}

// Downsample un tableau pour rendre Chart.js fluide (séances de 3h+ = 10000+ points)
function downsample(arr, targetSize = 600) {
  if (!arr || arr.length <= targetSize) return arr ? [...arr] : [];
  const step = arr.length / targetSize;
  const out = new Array(targetSize);
  for (let i = 0; i < targetSize; i++) {
    const s = Math.floor(i * step);
    const e = Math.min(arr.length, Math.floor((i + 1) * step));
    let sum = 0, count = 0;
    for (let j = s; j < e; j++) {
      const v = arr[j];
      if (v != null && !isNaN(v)) { sum += v; count++; }
    }
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

function formatHMS(seconds) {
  if (seconds == null || isNaN(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2,'0')}`;
  if (m > 0) return `${m}m${s.toString().padStart(2,'0')}`;
  return `${s}s`;
}

// Tracker des charts modal pour les détruire à la prochaine ouverture
// ============================================================
// CATALOGUE DE SPORTS — tous les types reconnus par intervals.icu
// Key = type Strava/intervals.icu, value = { fr, category, icon }
// Utilisé pour : catégorisation activités, sélecteur sport pour
// création d'entraînements futurs, filtres, affichage modal.
// ============================================================
// Catalogue aligné sur les libellés FR officiels Strava (ce que tu vois sur strava.com)
window.SPORTS_CATALOG = {
  // Cyclisme
  Ride: { fr: 'Cyclisme', category: 'cyclisme', icon: '🚴' },
  VirtualRide: { fr: 'Cyclisme virtuel', category: 'cyclisme', icon: '🚴' },
  MountainBikeRide: { fr: 'VTT', category: 'cyclisme', icon: '🚵' },
  GravelRide: { fr: 'Gravel', category: 'cyclisme', icon: '🚴' },
  EBikeRide: { fr: 'Vélo électrique', category: 'cyclisme', icon: '🚴' },
  EMountainBikeRide: { fr: 'VTT électrique', category: 'cyclisme', icon: '🚵' },
  Velomobile: { fr: 'Vélomobile', category: 'cyclisme', icon: '🚲' },
  Handcycle: { fr: 'Handbike', category: 'cyclisme', icon: '🚴' },

  // Course à pied
  Run: { fr: 'Course à pied', category: 'course', icon: '🏃' },
  TrailRun: { fr: 'Trail', category: 'course', icon: '🏃' },
  VirtualRun: { fr: 'Course virtuelle', category: 'course', icon: '🏃' },

  // Natation
  Swim: { fr: 'Natation', category: 'natation', icon: '🏊' },
  OpenWaterSwim: { fr: 'Natation en eau libre', category: 'natation', icon: '🏊' },

  // Force / Salle
  WeightTraining: { fr: 'Musculation', category: 'musculation', icon: '🏋️' },
  Workout: { fr: 'Entraînement', category: 'musculation', icon: '💪' },
  Crossfit: { fr: 'CrossFit', category: 'musculation', icon: '🏋️' },
  Elliptical: { fr: 'Vélo elliptique', category: 'musculation', icon: '🏃' },
  StairStepper: { fr: 'Stair-Stepper', category: 'musculation', icon: '🏃' },
  VirtualWorkout: { fr: 'Entraînement virtuel', category: 'musculation', icon: '💪' },

  // Marche / Rando
  Walk: { fr: 'Marche', category: 'autre', icon: '🚶' },
  Hike: { fr: 'Randonnée', category: 'autre', icon: '🥾' },
  Snowshoe: { fr: 'Raquettes', category: 'autre', icon: '🥾' },

  // Neige
  AlpineSki: { fr: 'Ski alpin', category: 'autre', icon: '⛷️' },
  BackcountrySki: { fr: 'Ski hors-piste', category: 'autre', icon: '⛷️' },
  NordicSki: { fr: 'Ski de fond', category: 'autre', icon: '⛷️' },
  Snowboard: { fr: 'Snowboard', category: 'autre', icon: '🏂' },
  IceSkate: { fr: 'Patinage', category: 'autre', icon: '⛸️' },
  InlineSkate: { fr: 'Roller', category: 'autre', icon: '🛼' },

  // Eau
  Rowing: { fr: 'Aviron', category: 'autre', icon: '🚣' },
  Kayaking: { fr: 'Kayak', category: 'autre', icon: '🛶' },
  Canoeing: { fr: 'Canoë', category: 'autre', icon: '🛶' },
  StandUpPaddling: { fr: 'Stand up paddle', category: 'autre', icon: '🏄' },
  Surfing: { fr: 'Surf', category: 'autre', icon: '🏄' },
  Windsurf: { fr: 'Planche à voile', category: 'autre', icon: '🏄' },
  Kitesurf: { fr: 'Kitesurf', category: 'autre', icon: '🪁' },
  Sailing: { fr: 'Voile', category: 'autre', icon: '⛵' },

  // Sports collectifs / raquettes
  Soccer: { fr: 'Football', category: 'autre', icon: '⚽' },
  Basketball: { fr: 'Basketball', category: 'autre', icon: '🏀' },
  Volleyball: { fr: 'Volleyball', category: 'autre', icon: '🏐' },
  Hockey: { fr: 'Hockey', category: 'autre', icon: '🏒' },
  Tennis: { fr: 'Tennis', category: 'autre', icon: '🎾' },
  Squash: { fr: 'Squash', category: 'autre', icon: '🎾' },
  Badminton: { fr: 'Badminton', category: 'autre', icon: '🏸' },
  TableTennis: { fr: 'Tennis de table', category: 'autre', icon: '🏓' },
  Cricket: { fr: 'Cricket', category: 'autre', icon: '🏏' },
  AmericanFootball: { fr: 'Football américain', category: 'autre', icon: '🏈' },

  // Mobilité / Bien-être
  Yoga: { fr: 'Yoga', category: 'autre', icon: '🧘' },
  Pilates: { fr: 'Pilates', category: 'autre', icon: '🧘' },
  Stretching: { fr: 'Étirements', category: 'autre', icon: '🧘' },

  // Divers
  RockClimbing: { fr: 'Escalade', category: 'autre', icon: '🧗' },
  Boxing: { fr: 'Boxe', category: 'autre', icon: '🥊' },
  Dance: { fr: 'Danse', category: 'autre', icon: '💃' },
  Golf: { fr: 'Golf', category: 'autre', icon: '⛳' },
  Skateboard: { fr: 'Skate', category: 'autre', icon: '🛹' },
  Wheelchair: { fr: 'Fauteuil roulant', category: 'autre', icon: '🦽' },
  Transition: { fr: 'Transition', category: 'autre', icon: '🏊' },
};

// Fallback de catégorie → libellé FR (utilisé quand raw_type Strava est absent)
const SPORT_CATEGORY_FR = {
  cyclisme: 'Cyclisme',
  course: 'Course à pied',
  natation: 'Natation',
  musculation: 'Musculation',
  autre: 'Autre',
};

// Catégorie de couleur fine (pour les pills colorées dans le calendrier)
// Bcp plus granulaire que la catégorie interne — chaque "famille" a sa teinte
const SPORT_COLOR_KEY = {
  Ride: 'cyclisme', VirtualRide: 'cyclisme', GravelRide: 'cyclisme',
  EBikeRide: 'cyclisme', Velomobile: 'cyclisme', Handcycle: 'cyclisme',
  MountainBikeRide: 'vtt', EMountainBikeRide: 'vtt',
  Run: 'course', VirtualRun: 'course',
  TrailRun: 'trail',
  Swim: 'natation', OpenWaterSwim: 'natation',
  WeightTraining: 'musculation', Workout: 'musculation', Crossfit: 'musculation',
  Elliptical: 'musculation', StairStepper: 'musculation', VirtualWorkout: 'musculation',
  Walk: 'marche', Hike: 'marche', Snowshoe: 'marche',
  AlpineSki: 'ski', BackcountrySki: 'ski', NordicSki: 'ski', Snowboard: 'ski',
  IceSkate: 'ski', InlineSkate: 'ski',
  Rowing: 'nautique', Kayaking: 'nautique', Canoeing: 'nautique',
  StandUpPaddling: 'nautique', Surfing: 'nautique', Windsurf: 'nautique',
  Kitesurf: 'nautique', Sailing: 'nautique',
  Soccer: 'football', Basketball: 'collectif', Volleyball: 'collectif',
  Hockey: 'collectif', AmericanFootball: 'collectif', Cricket: 'collectif',
  Tennis: 'raquette', Squash: 'raquette', Badminton: 'raquette', TableTennis: 'raquette',
  Yoga: 'yoga', Pilates: 'yoga', Stretching: 'yoga',
  RockClimbing: 'escalade',
  Boxing: 'combat',
  Dance: 'autre', Golf: 'autre', Skateboard: 'autre',
  Wheelchair: 'autre', Transition: 'autre',
};

// Mapping catégorie interne → couleur (fallback quand pas de raw_type)
const SPORT_COLOR_FROM_CATEGORY = {
  cyclisme: 'cyclisme',
  course: 'course',
  natation: 'natation',
  musculation: 'musculation',
  autre: 'autre',
};

// Helper unique : renvoie le nom Strava FR exact à afficher
//  Priorité : raw_type Strava traduit → catégorie traduite → 'Activité'
window.sportFr = (rawTypeOrCategory) => {
  if (!rawTypeOrCategory) return 'Activité';
  const entry = window.SPORTS_CATALOG[rawTypeOrCategory];
  if (entry) return entry.fr;
  if (SPORT_CATEGORY_FR[rawTypeOrCategory]) return SPORT_CATEGORY_FR[rawTypeOrCategory];
  return rawTypeOrCategory; // type Strava inconnu : on le montre brut
};

// Helper qui prend une activité complète et renvoie le nom de sport à afficher
window.activitySportLabel = (act) => {
  if (!act) return 'Activité';
  // Priorité 1 : raw_type Strava (ex: "Ride" → "Cyclisme")
  if (act.raw_type) return window.sportFr(act.raw_type);
  // Priorité 2 : type brut Strava sur certaines anciennes activités
  if (act.type && window.SPORTS_CATALOG[act.type]) return window.sportFr(act.type);
  // Priorité 3 : catégorie interne
  if (act.sport) return window.sportFr(act.sport);
  return 'Activité';
};

// Helper qui renvoie la "clé couleur" (data-attribute pour CSS)
window.activitySportColorKey = (act) => {
  if (!act) return 'autre';
  if (act.raw_type && SPORT_COLOR_KEY[act.raw_type]) return SPORT_COLOR_KEY[act.raw_type];
  if (act.type && SPORT_COLOR_KEY[act.type]) return SPORT_COLOR_KEY[act.type];
  // sport peut être soit un raw_type Strava (ex: "Ride") soit une catégorie ("cyclisme")
  if (act.sport && SPORT_COLOR_KEY[act.sport]) return SPORT_COLOR_KEY[act.sport];
  if (act.sport && SPORT_COLOR_FROM_CATEGORY[act.sport]) return SPORT_COLOR_FROM_CATEGORY[act.sport];
  return 'autre';
};

let _modalCharts = [];
function destroyModalCharts() {
  _modalCharts.forEach(c => {
    try {
      if (c.canvas && c.canvas._smoothMM) {
        c.canvas.removeEventListener('mousemove', c.canvas._smoothMM);
        c.canvas.removeEventListener('mouseleave', c.canvas._smoothML);
        delete c.canvas._smoothMM;
        delete c.canvas._smoothML;
      }
      if (c._stOverlay && c._stOverlay.parentNode) {
        c._stOverlay.parentNode.removeChild(c._stOverlay);
      }
      c.destroy();
    } catch (e) {}
  });
  _modalCharts = [];
}

// === Crosshair fluide + tooltip interpolé (canvas overlay) ===
// Au lieu de redessiner les charts à chaque mouvement de souris (coûteux),
// on superpose une canvas transparente sur chaque chart et on n'en redessine
// QUE la crosshair. Le chart lui-même n'est plus repeint pendant les hover.
function _ensureOverlay(chart) {
  if (chart._stOverlay && chart._stOverlay.isConnected) return;
  const canvas = chart.canvas;
  const parent = canvas.parentNode;
  if (!parent) return;
  const cs = getComputedStyle(parent);
  if (cs.position === 'static') parent.style.position = 'relative';
  const ov = document.createElement('canvas');
  ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  parent.appendChild(ov);
  chart._stOverlay = ov;
  chart._stOverlayCtx = ov.getContext('2d');
  _resizeOverlay(chart);

  // Listener direct sur la canvas pour suivre le curseur MÊME pendant un drag-zoom
  // (afterEvent peut être bypassé par le plugin zoom pendant la sélection).
  if (!canvas._smoothMM) {
    canvas._smoothMM = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width) / (chart.currentDevicePixelRatio || window.devicePixelRatio || 1);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height) / (chart.currentDevicePixelRatio || window.devicePixelRatio || 1);
      const { left, right, top, bottom } = chart.chartArea;
      if (x < left || x > right || y < top || y > bottom) {
        if (chart._stxv != null) {
          _smoothPendingX = null;
          _scheduleSmoothDraw();
        }
        return;
      }
      _smoothPendingX = chart.scales.x.getValueForPixel(x);
      _scheduleSmoothDraw();
    };
    canvas._smoothML = () => {
      _smoothPendingX = null;
      _scheduleSmoothDraw();
    };
    canvas.addEventListener('mousemove', canvas._smoothMM);
    canvas.addEventListener('mouseleave', canvas._smoothML);
  }
}
function _resizeOverlay(chart) {
  if (!chart._stOverlay) return;
  const c = chart.canvas;
  chart._stOverlay.width = c.width;
  chart._stOverlay.height = c.height;
  // Reset transform pour matcher le DPR utilisé par Chart.js
  const dpr = chart.currentDevicePixelRatio || window.devicePixelRatio || 1;
  chart._stOverlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function _drawOverlay(chart) {
  if (!chart._stOverlay) return;
  // Safety : si une overlay s'est créée par erreur sur un non-stream chart, on la retire
  if (typeof _isStreamChart === 'function' && !_isStreamChart(chart)) {
    try {
      if (chart._stOverlay.parentNode) chart._stOverlay.parentNode.removeChild(chart._stOverlay);
    } catch (e) {}
    chart._stOverlay = null;
    chart._stOverlayCtx = null;
    return;
  }
  const ctx = chart._stOverlayCtx;
  const w = chart._stOverlay.width;
  const h = chart._stOverlay.height;
  // Clear (en coords brutes, pas affecté par le transform DPR)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.restore();

  const xValue = chart._stxv;
  if (xValue == null) return;
  const xScale = chart.scales.x;
  if (!xScale || xValue < xScale.min || xValue > xScale.max) return;
  const pixelX = xScale.getPixelForValue(xValue);
  const { top, bottom, left, right } = chart.chartArea;
  if (pixelX < left - 0.5 || pixelX > right + 0.5) return;

  ctx.save();

  // Ligne verticale (crosshair)
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(180,180,180,0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.moveTo(pixelX, top);
  ctx.lineTo(pixelX, bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // Interpolation linéaire de chaque dataset à xValue
  const items = [];
  chart.data.datasets.forEach((ds, i) => {
    // Skip si la courbe est cachée via la légende
    const meta = chart.getDatasetMeta(i);
    if (meta && meta.hidden) return;
    const data = ds.data;
    if (!data || !data.length) return;
    let y;
    if (xValue <= data[0].x) y = data[0].y;
    else if (xValue >= data[data.length - 1].x) y = data[data.length - 1].y;
    else {
      let lo = 0, hi = data.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (data[mid].x <= xValue) lo = mid;
        else hi = mid;
      }
      const p0 = data[lo], p1 = data[hi];
      const dx = p1.x - p0.x;
      const t = dx === 0 ? 0 : (xValue - p0.x) / dx;
      y = p0.y + t * (p1.y - p0.y);
    }
    const yScale = chart.scales[ds.yAxisID || 'y'];
    if (!yScale) return;
    const pixelY = yScale.getPixelForValue(y);
    ctx.beginPath();
    ctx.fillStyle = ds.borderColor;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.5;
    ctx.arc(pixelX, pixelY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Pente (%) pour l'altitude — uniquement si X est la distance (m)
    // Recherche binaire dans la fenêtre ±100 m. Si vide (gap dans la data),
    // fallback sur les deux points immédiatement autour du curseur.
    let extra = null;
    if (ds.label && ds.label.toLowerCase().includes('altitude') && window._streamsUseDistance) {
      const win = 100;
      const tLo = xValue - win;
      const tHi = xValue + win;
      // Borne basse : premier index avec data[j].x >= tLo
      let lo = 0, hi = data.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (data[m].x < tLo) lo = m + 1;
        else hi = m;
      }
      let i1 = lo;
      // Borne haute : dernier index avec data[j].x <= tHi
      lo = 0; hi = data.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (data[m].x > tHi) hi = m - 1;
        else lo = m;
      }
      let i2 = lo;

      // Fallback : fenêtre vide → utilise les 2 points encadrant xValue
      if (i2 <= i1) {
        lo = 0; hi = data.length - 1;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (data[m].x < xValue) lo = m + 1;
          else hi = m;
        }
        i1 = Math.max(0, lo - 1);
        i2 = Math.min(data.length - 1, lo);
        // Élargir si encore i1 == i2 (xValue exactement sur un point unique)
        if (i2 === i1 && data.length > 1) {
          if (i1 > 0) i1--;
          else if (i2 < data.length - 1) i2++;
        }
      }

      if (i2 > i1) {
        const dD = data[i2].x - data[i1].x;
        const dA = data[i2].y - data[i1].y;
        if (dD > 0) {
          const slope = (dA / dD) * 100;
          extra = `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}%`;
        }
      }
    }
    items.push({ label: ds.label, value: y, color: ds.borderColor, extra });
  });

  if (items.length === 0) { ctx.restore(); return; }

  const fmtX = window._streamsFmtXTooltip || (v => v.toFixed(1));
  const title = fmtX(xValue);
  const fmtV = (v, lbl) => {
    if (lbl && (lbl.includes("W'bal") || lbl.includes('Vitesse'))) return v.toFixed(1);
    return Math.round(v).toString();
  };
  // Reformatage : "Altitude (m)" → label "Altitude" + unité "m" placée après la valeur
  const lines = items.map(it => {
    const m = (it.label || '').match(/^(.*?)\s*\((.+)\)\s*$/);
    const labelPart = m ? m[1].trim() : it.label;
    const unitPart = m ? m[2] : '';
    const valueStr = fmtV(it.value, it.label);
    const formatted = `${labelPart}: ${valueStr}${unitPart ? ' ' + unitPart : ''}`;
    return `${formatted}${it.extra ? ' · pente ' + it.extra : ''}`;
  });
  const allLines = [title, ...lines];

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  const widths = allLines.map(l => ctx.measureText(l).width);
  const boxW = Math.max(...widths) + 16;
  const lineH = 14;
  const boxH = allLines.length * lineH + 12;

  let bx = pixelX + 12;
  let by = top + 8;
  if (bx + boxW > right) bx = pixelX - boxW - 12;
  if (by + boxH > bottom) by = bottom - boxH - 8;
  if (bx < left) bx = left + 4;

  ctx.fillStyle = 'rgba(20,20,20,0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 5);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeRect(bx, by, boxW, boxH);
  }

  ctx.textBaseline = 'top';
  allLines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.65)' : items[i - 1].color;
    ctx.fillText(l, bx + 8, by + 6 + i * lineH);
  });

  ctx.restore();
}

// Throttle via requestAnimationFrame
let _smoothFrame = null;
let _smoothPendingX = undefined;
function _scheduleSmoothDraw() {
  if (_smoothFrame) return;
  _smoothFrame = requestAnimationFrame(() => {
    _smoothFrame = null;
    const v = _smoothPendingX;
    _modalCharts.forEach(c => {
      if (!_isStreamChart(c)) return; // ignore donuts et autres types
      c._stxv = v;
      _drawOverlay(c);
    });
  });
}

// Helper : le crosshair ne s'applique qu'aux line charts streams (pas aux donuts, bars, etc.)
function _isStreamChart(chart) {
  if (!chart || !chart.config || chart.config.type !== 'line') return false;
  if (!chart.canvas) return false;
  const id = chart.canvas.id || '';
  return id.startsWith('streams-');
}
const smoothTooltipPlugin = {
  id: 'smoothTooltip',
  afterInit(chart) { if (_isStreamChart(chart)) _ensureOverlay(chart); },
  afterRender(chart) { if (_isStreamChart(chart)) { _ensureOverlay(chart); _drawOverlay(chart); } },
  resize(chart) { if (_isStreamChart(chart)) { _resizeOverlay(chart); _drawOverlay(chart); } },
  afterEvent(chart, args) {
    if (!_isStreamChart(chart)) return;
    const e = args.event;
    if (e.type === 'mousemove') {
      const { left, right, top, bottom } = chart.chartArea;
      if (e.x < left || e.x > right || e.y < top || e.y > bottom) {
        if (chart._stxv != null) {
          _smoothPendingX = null;
          _scheduleSmoothDraw();
        }
        return;
      }
      _smoothPendingX = chart.scales.x.getValueForPixel(e.x);
      _scheduleSmoothDraw();
    } else if (e.type === 'mouseout') {
      _smoothPendingX = null;
      _scheduleSmoothDraw();
    }
  },
};
if (typeof Chart !== 'undefined') {
  try { Chart.register(smoothTooltipPlugin); } catch (e) { /* déjà enregistré */ }
}

// === Plugin : zone hachurée sous 0 pour W'bal ===
// Dessine un motif rayé rouge dans la partie négative du W'bal (au-dessus du fill normal).
let _hatchPattern = null;
function _getHatchPattern(ctx) {
  if (_hatchPattern) return _hatchPattern;
  const p = document.createElement('canvas');
  p.width = 7; p.height = 7;
  const pc = p.getContext('2d');
  pc.strokeStyle = 'rgba(248, 113, 113, 0.55)';
  pc.lineWidth = 1.2;
  pc.beginPath();
  pc.moveTo(-1, 8); pc.lineTo(8, -1);
  pc.moveTo(0, 14); pc.lineTo(14, 0);
  pc.stroke();
  _hatchPattern = ctx.createPattern(p, 'repeat');
  return _hatchPattern;
}
const wbalNegStripesPlugin = {
  id: 'wbalNegStripes',
  afterDatasetsDraw(chart) {
    if (!chart.canvas || chart.canvas.id !== 'streams-wbal') return;
    const ds = chart.data.datasets[0];
    const data = ds && ds.data;
    if (!data || !data.length) return;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    const zeroY = yScale.getPixelForValue(0);
    const { top, bottom, left, right } = chart.chartArea;
    if (zeroY >= bottom) return; // toute la zone est >= 0

    const ctx = chart.ctx;
    ctx.save();
    // Clip strict à la zone du chart
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();

    // Construit le polygone sous-zéro (suit la courbe en dessous de 0, ferme à y=0)
    const xMin = xScale.min, xMax = xScale.max;
    let inNeg = false;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      if (p.x < xMin || p.x > xMax) continue;
      const px = xScale.getPixelForValue(p.x);
      const py = yScale.getPixelForValue(p.y);
      if (p.y < 0) {
        if (!inNeg) { ctx.moveTo(px, zeroY); inNeg = true; }
        ctx.lineTo(px, py);
      } else if (inNeg) {
        ctx.lineTo(px, zeroY);
        ctx.closePath();
        ctx.fillStyle = _getHatchPattern(ctx) || 'rgba(248,113,113,0.25)';
        ctx.fill();
        ctx.beginPath();
        inNeg = false;
      }
    }
    if (inNeg) {
      const last = data[data.length - 1];
      ctx.lineTo(xScale.getPixelForValue(last.x), zeroY);
      ctx.closePath();
      ctx.fillStyle = _getHatchPattern(ctx) || 'rgba(248,113,113,0.25)';
      ctx.fill();
    }
    ctx.restore();
  }
};
if (typeof Chart !== 'undefined') {
  try { Chart.register(wbalNegStripesPlugin); } catch (e) {}
}

// (Plugin axisVisibility retiré — la synchro axe ↔ dataset est faite dans
// legendConfig.onClick avec un requestAnimationFrame pour éviter les conflits)

async function renderStreamsSection(container, activityId) {
  destroyModalCharts();
  const cached = streamsCache[activityId] !== undefined || loadStreamsFromLS(activityId);
  container.innerHTML = `<div class="modal-placeholder">${cached ? '📊 Rendu depuis le cache local...' : '⏳ Téléchargement des streams depuis Strava...'}</div>`;

  const streams = await loadStreams(activityId);
  if (!streams) {
    container.innerHTML = '<div class="modal-placeholder">Pas de streams disponibles pour cette activité (ou erreur de chargement).</div>';
    return;
  }
  // Yield to browser pour afficher le message "Rendu..." avant de bloquer sur le render
  container.innerHTML = '<div class="modal-placeholder">📊 Rendu des graphiques...</div>';
  await new Promise(r => requestAnimationFrame(r));

  // intervals.icu peut renvoyer les streams sous 2 formats : array de {type,data} ou objet {watts:[], ...}
  const findStream = (type) => {
    if (Array.isArray(streams)) {
      const s = streams.find(x => x && x.type === type);
      return s ? s.data : null;
    }
    return streams[type] || null;
  };

  let watts = findStream('watts');
  let hr = findStream('heartrate');
  let cadence = findStream('cadence');
  const altitude = findStream('altitude');
  const distance = findStream('distance');

  // Lissage 3 s (moyenne glissante centrée ±1 s = 3 points) sur Puissance, FC, Cadence
  // Pour adoucir le bruit instantané sans perdre les variations réelles.
  function smooth3s(arr) {
    if (!arr) return arr;
    const n = arr.length;
    const out = new Array(n);
    const win = 1;
    let sum = 0, count = 0;
    for (let i = 0; i <= win && i < n; i++) {
      if (arr[i] != null && !isNaN(arr[i])) { sum += arr[i]; count++; }
    }
    for (let i = 0; i < n; i++) {
      if (i > 0 && i + win < n && arr[i + win] != null && !isNaN(arr[i + win])) {
        sum += arr[i + win]; count++;
      }
      if (i - win - 1 >= 0 && arr[i - win - 1] != null && !isNaN(arr[i - win - 1])) {
        sum -= arr[i - win - 1]; count--;
      }
      out[i] = count > 0 ? sum / count : null;
    }
    return out;
  }
  // Lissage paramétré : 3s pour watts/FC, 9s pour cadence (plus stable visuellement)
  function smoothWin(arr, win) {
    if (!arr) return arr;
    const n = arr.length;
    const out = new Array(n);
    let sum = 0, count = 0;
    for (let i = 0; i <= win && i < n; i++) {
      if (arr[i] != null && !isNaN(arr[i])) { sum += arr[i]; count++; }
    }
    for (let i = 0; i < n; i++) {
      if (i > 0 && i + win < n && arr[i + win] != null && !isNaN(arr[i + win])) {
        sum += arr[i + win]; count++;
      }
      if (i - win - 1 >= 0 && arr[i - win - 1] != null && !isNaN(arr[i - win - 1])) {
        sum -= arr[i - win - 1]; count--;
      }
      out[i] = count > 0 ? sum / count : null;
    }
    return out;
  }
  if (watts) watts = smoothWin(watts, 1);      // ±1 s = 3 s
  if (hr) hr = smoothWin(hr, 1);                // ±1 s = 3 s
  if (cadence) cadence = smoothWin(cadence, 4); // ±4 s = 9 s (plus stable)

  const length = (watts && watts.length) || (hr && hr.length) || (cadence && cadence.length) || 0;
  if (length === 0) {
    container.innerHTML = '<div class="modal-placeholder">Aucun stream haute résolution n\'est disponible pour cette activité (séance peut-être sans capteur).</div>';
    return;
  }

  // Choix de l'axe X : distance (km) si dispo, sinon temps (h/m/s).
  const useDistance = distance && distance.length === length && distance[distance.length - 1] > 0;
  const fullTime = Array.from({ length }, (_, i) => i);
  const fullX = useDistance ? distance : fullTime;

  // PAS de downsampling manuel : on garde la résolution complète seconde par seconde.
  // Chart.js avec le plugin decimation (LTTB) gérera l'affichage : décime à ~1500 points
  // pour la performance, mais redécime à la résolution réelle au zoom in.

  // Formatter de l'axe X selon le mode (2 décimales pour ticks et tooltip)
  const fmtXTick = useDistance
    ? (val) => (val / 1000).toFixed(2) + ' km'
    : (val) => formatHMS(val);
  const fmtXTooltip = useDistance
    ? (val) => (val / 1000).toFixed(2) + ' km'
    : (val) => formatHMS(val);
  const fmtX = fmtXTick;
  // Expose au plugin smoothTooltip pour formater le titre du tooltip
  window._streamsFmtXTooltip = fmtXTooltip;
  // Expose pour le calcul de la pente (% uniquement si X est la distance)
  window._streamsUseDistance = useDistance;

  // Pairs {x,y} pour Chart.js (à connaître avant le template innerHTML)
  const pairs = (yArr) => {
    if (!yArr) return [];
    const out = [];
    for (let i = 0; i < fullX.length; i++) {
      if (yArr[i] != null && !isNaN(yArr[i])) out.push({ x: fullX[i], y: yArr[i] });
    }
    return out;
  };
  // === W'bal (modèle Skiba 2012) : réserve anaérobie au cours de l'effort ===
  // CP ≈ FTP, W' = 20 kJ par défaut (réserve typique cycliste entraîné).
  const cp = (window._athleteMeta && window._athleteMeta.ftp) || 250;
  const wPrime = 20000; // J
  function computeWbal(wattsArr) {
    if (!wattsArr || !cp || cp < 50) return null;
    const n = wattsArr.length;
    const out = new Array(n);
    let wbal = wPrime;
    for (let i = 0; i < n; i++) {
      const p = wattsArr[i] || 0;
      if (p > cp) {
        wbal -= (p - cp);
      } else {
        // Recovery : tau = 546·e^(-0.01·ΔCP) + 316 (Skiba)
        const deltaCP = cp - p;
        const tau = 546 * Math.exp(-0.01 * deltaCP) + 316;
        wbal = wPrime - (wPrime - wbal) * Math.exp(-1 / tau);
      }
      // On ne clampe plus à 0 : si le rider creuse dans la réserve au-delà de W',
      // le W'bal devient négatif (signe qu'il est "dans le rouge" selon le modèle).
      // Plafond max conservé pour pas dépasser W' physiologiquement.
      wbal = Math.min(wPrime, wbal);
      out[i] = wbal;
    }
    return out;
  }

  // === Vitesse instantanée (km/h) doublement lissée pour absorber le bruit GPS ===
  // Pass 1 : moyenne glissante ±15s (smooth les pics GPS courts)
  // Pass 2 : moyenne glissante ±15s sur la sortie du pass 1 (lissage 2nd ordre)
  // → Équivalent à un filtre gaussien plus stable qu'une grosse fenêtre simple
  function computeSpeed(distArr) {
    if (!distArr || distArr.length !== length) return null;
    const raw = new Array(length);
    for (let i = 1; i < length; i++) {
      raw[i] = Math.max(0, (distArr[i] - distArr[i - 1])); // m/s
    }
    raw[0] = raw[1] || 0;

    function smoothPass(arr, win) {
      const n = arr.length;
      const out = new Array(n);
      let sum = 0, count = 0;
      for (let i = 0; i <= win && i < n; i++) { sum += arr[i]; count++; }
      for (let i = 0; i < n; i++) {
        if (i > 0 && i + win < n) { sum += arr[i + win]; count++; }
        if (i - win - 1 >= 0) { sum -= arr[i - win - 1]; count--; }
        out[i] = count > 0 ? sum / count : 0;
      }
      return out;
    }

    const pass1 = smoothPass(raw, 15);
    const pass2 = smoothPass(pass1, 15);
    return pass2.map(v => v * 3.6); // m/s → km/h
  }

  const wbal = computeWbal(watts);
  const speed = computeSpeed(distance);

  const wattsPts = pairs(watts);
  const hrPts = pairs(hr);
  const cadencePts = pairs(cadence);
  const altPts = pairs(altitude);
  const wbalPts = pairs(wbal);
  const speedPts = pairs(speed);

  container.innerHTML = `
    <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center;margin-bottom:14px;font-size:12px;color:var(--text-dim);">
      <div style="display:inline-flex;gap:6px;align-items:baseline;">Temps : <strong id="stat-temps" style="color:var(--text);font-size:14px;min-width:70px;text-align:left;display:inline-block;">—</strong></div>
      <div style="display:inline-flex;gap:6px;align-items:baseline;">Distance : <strong id="stat-dist" style="color:var(--text);font-size:14px;min-width:80px;text-align:left;display:inline-block;">—</strong></div>
      <button id="streams-zoom-reset" style="margin-left:auto;visibility:hidden;background:var(--bg-elev2);border:1px solid var(--border);color:var(--text-dim);padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer;font-family:inherit;">Réinitialiser le zoom</button>
    </div>
    ${(wattsPts.length || hrPts.length) ? `
      <div id="power-hr-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:10px;margin-bottom:6px;padding-left:55px;padding-right:60px;gap:8px;overflow:hidden;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);min-width:0;">
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#fbbf24;">moy</span> <strong id="stat-wmoy" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#fbbf24;">max</span> <strong id="stat-wmaxx" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
        </div>
        <div id="custom-legend-powerhr" style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
          ${wattsPts.length ? `<button class="cl-btn-phr" data-idx="0" data-yax="y" data-color="#fbbf24" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#fbbf24;border:1.5px solid #fbbf24;border-radius:2px;display:inline-block;"></span>Puissance
          </button>` : ''}
          ${hrPts.length ? `<button class="cl-btn-phr" data-idx="${wattsPts.length ? 1 : 0}" data-yax="y1" data-color="#f87171" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#f87171;border:1.5px solid #f87171;border-radius:2px;display:inline-block;"></span>FC
          </button>` : ''}
        </div>
        <div style="display:flex;gap:9px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);justify-self:end;">
          <span style="white-space:nowrap;"><span style="color:#f87171;">moy</span> <strong id="stat-fcmoy" style="color:var(--text);font-size:11px;">—</strong></span>
          <span style="white-space:nowrap;"><span style="color:#f87171;">max</span> <strong id="stat-fcmaxx" style="color:var(--text);font-size:11px;">—</strong></span>
        </div>
      </div>
      <div class="chart-wrap" style="height:180px;margin-bottom:14px;"><canvas id="streams-power-hr"></canvas></div>` : ''}
    ${wbalPts.length ? `
      <div id="wbal-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:10px;margin-bottom:6px;padding-left:55px;padding-right:60px;gap:8px;overflow:hidden;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);min-width:0;">
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#60a5fa;">moy</span> <strong id="stat-wbalmoy" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#60a5fa;">min</span> <strong id="stat-wbalmin" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
        </div>
        <div id="custom-legend-wbal" style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
          <button class="cl-btn-wbal" data-idx="0" data-yax="y" data-color="#60a5fa" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#60a5fa;border:1.5px solid #60a5fa;border-radius:2px;display:inline-block;"></span>W'bal
          </button>
        </div>
        <div style="justify-self:end;"></div>
      </div>
      <div class="chart-wrap" style="height:180px;margin-bottom:14px;"><canvas id="streams-wbal"></canvas></div>` : ''}
    ${cadencePts.length ? `
      <div id="cadence-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:10px;margin-bottom:6px;padding-left:55px;padding-right:60px;gap:8px;overflow:hidden;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);min-width:0;">
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#a78bfa;">moy</span> <strong id="stat-cmoy" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#a78bfa;">max</span> <strong id="stat-cmaxx" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
        </div>
        <div id="custom-legend-cadence" style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
          <button class="cl-btn-cad" data-idx="0" data-yax="y" data-color="#a78bfa" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#a78bfa;border:1.5px solid #a78bfa;border-radius:2px;display:inline-block;"></span>Cadence
          </button>
        </div>
        <div style="justify-self:end;"></div>
      </div>
      <div class="chart-wrap" style="height:180px;margin-bottom:14px;"><canvas id="streams-cadence"></canvas></div>` : ''}
    ${(speedPts.length || altPts.length) ? `
      <div id="speed-alt-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:10px;margin-bottom:6px;padding-left:55px;padding-right:60px;gap:8px;overflow:hidden;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);min-width:0;">
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#4ade80;">D+</span> <strong id="stat-dplus" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#4ade80;">D-</span> <strong id="stat-dminus" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span id="stat-slope-wrap" style="display:none;white-space:nowrap;gap:6px;align-items:center;">
            <span style="display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#4ade80;">moy</span> <strong id="stat-slopeavg" style="color:var(--text);font-size:11px;min-width:38px;text-align:left;display:inline-block;">—</strong></span>
            <span style="display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#4ade80;">max</span> <strong id="stat-slopemax" style="color:var(--text);font-size:11px;min-width:38px;text-align:left;display:inline-block;">—</strong></span>
          </span>
        </div>
        <div id="custom-legend-altspeed" style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
          ${altPts.length ? `<button class="cl-btn" data-idx="0" data-yax="y1" data-color="#4ade80" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#4ade80;border:1.5px solid #4ade80;border-radius:2px;display:inline-block;"></span>Altitude
          </button>` : ''}
          ${speedPts.length ? `<button class="cl-btn" data-idx="${altPts.length ? 1 : 0}" data-yax="y" data-color="#22d3ee" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#22d3ee;border:1.5px solid #22d3ee;border-radius:2px;display:inline-block;"></span>Vitesse
          </button>` : ''}
        </div>
        <div style="display:flex;gap:9px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);justify-self:end;">
          <span style="white-space:nowrap;"><span style="color:#22d3ee;">moy</span> <strong id="stat-vmoy" style="color:var(--text);font-size:11px;">—</strong></span>
          <span style="white-space:nowrap;"><span style="color:#22d3ee;">max</span> <strong id="stat-vmax" style="color:var(--text);font-size:11px;">—</strong></span>
        </div>
      </div>
      <div class="chart-wrap" style="height:180px;"><canvas id="streams-speed-alt"></canvas></div>` : ''}
  `;

  // Compute stats sur la plage [minX, maxX] (en m si distance, en s si temps)
  // Utilise les FULL streams (pas downsampled) pour la précision.
  function computeStats(minX, maxX) {
    // Trouver les indices borne
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;

    // Temps écoulé = durée entre les deux indices (1 sample/s en général)
    const timeElapsed = lastIdx - firstIdx;

    // Distance parcourue
    let distCov = null;
    if (distance && distance.length === length) {
      distCov = (distance[lastIdx] - distance[firstIdx]) / 1000;
    }

    // Avg watts
    let wSum = 0, wCount = 0;
    if (watts) {
      for (let i = firstIdx; i <= lastIdx; i++) {
        const v = watts[i];
        if (v != null && !isNaN(v)) { wSum += v; wCount++; }
      }
    }
    const avgW = wCount > 0 ? Math.round(wSum / wCount) : null;

    // Avg HR
    let hSum = 0, hCount = 0;
    if (hr) {
      for (let i = firstIdx; i <= lastIdx; i++) {
        const v = hr[i];
        if (v != null && !isNaN(v)) { hSum += v; hCount++; }
      }
    }
    const avgH = hCount > 0 ? Math.round(hSum / hCount) : null;

    return { timeElapsed, distCov, avgW, avgH };
  }

  function renderStats(stats) {
    const tEl = document.getElementById('stat-temps');
    const dEl = document.getElementById('stat-dist');
    if (tEl) tEl.textContent = stats && stats.timeElapsed != null ? formatHMS(stats.timeElapsed) : '—';
    if (dEl) {
      if (stats && stats.distCov != null) {
        dEl.textContent = stats.distCov < 1
          ? Math.round(stats.distCov * 1000) + ' m'
          : stats.distCov.toFixed(2) + ' km';
      } else {
        dEl.textContent = '—';
      }
    }
  }

  // === Stats Altitude + Vitesse (au-dessus du chart speed-alt) ===
  function computeAltSpeedStats(minX, maxX) {
    if (!fullX || !fullX.length) return null;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;

    let dPlus = 0, dMinus = 0, altMax = null;
    let vSum = 0, vCount = 0, vMax = 0;
    let prevAlt = null;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (altitude && altitude[i] != null && !isNaN(altitude[i])) {
        const a = altitude[i];
        if (altMax === null || a > altMax) altMax = a;
        if (prevAlt != null) {
          const dA = a - prevAlt;
          if (dA > 0) dPlus += dA; else dMinus += -dA;
        }
        prevAlt = a;
      }
      if (speed && speed[i] != null && !isNaN(speed[i])) {
        vSum += speed[i]; vCount++;
        if (speed[i] > vMax) vMax = speed[i];
      }
    }

    // Slope stats : uniquement si zoomé (vue restreinte vs activité totale) ET distance dispo
    const fullSpan = fullX[fullX.length - 1] - fullX[0];
    const visSpan = maxX - minX;
    const isZoomed = visSpan < fullSpan * 0.97;
    let slopeAvg = null, slopeMax = null;
    if (useDistance && isZoomed && altitude && distance && lastIdx > firstIdx) {
      // Slope avg = pente nette du début à la fin de la section
      let fv = -1, lv = -1;
      for (let i = firstIdx; i <= lastIdx; i++) {
        if (altitude[i] != null && !isNaN(altitude[i]) && distance[i] != null) {
          if (fv === -1) fv = i;
          lv = i;
        }
      }
      if (fv !== -1 && lv > fv) {
        const dD = distance[lv] - distance[fv];
        if (dD > 0) slopeAvg = (altitude[lv] - altitude[fv]) / dD * 100;
      }
      // Slope max = pente la plus raide sur fenêtre glissante ±50m
      const winM = 50;
      for (let i = firstIdx; i <= lastIdx; i++) {
        if (altitude[i] == null) continue;
        const xVal = fullX[i];
        const tLo = xVal - winM, tHi = xVal + winM;
        let lo = firstIdx, hi = lastIdx;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (fullX[m] < tLo) lo = m + 1; else hi = m;
        }
        const i1 = lo;
        lo = firstIdx; hi = lastIdx;
        while (lo < hi) {
          const m = (lo + hi + 1) >> 1;
          if (fullX[m] > tHi) hi = m - 1; else lo = m;
        }
        const i2 = lo;
        if (i2 > i1 && altitude[i1] != null && altitude[i2] != null) {
          const dD = fullX[i2] - fullX[i1];
          if (dD > 0) {
            const sl = (altitude[i2] - altitude[i1]) / dD * 100;
            if (slopeMax === null || sl > slopeMax) slopeMax = sl;
          }
        }
      }
    }
    return {
      dPlus: Math.round(dPlus),
      dMinus: Math.round(dMinus),
      altMax: altMax !== null ? Math.round(altMax) : null,
      vAvg: vCount > 0 ? vSum / vCount : null,
      vMax: vMax > 0 ? vMax : null,
      slopeAvg, slopeMax, isZoomed
    };
  }

  function renderAltSpeedStats(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!s) {
      ['stat-dplus','stat-dminus','stat-altmax','stat-vmoy','stat-vmax'].forEach(id => set(id, '—'));
      const w = document.getElementById('stat-slope-wrap'); if (w) w.style.display = 'none';
      return;
    }
    set('stat-dplus', s.dPlus + ' m');
    set('stat-dminus', s.dMinus + ' m');
    set('stat-altmax', s.altMax !== null ? s.altMax + ' m' : '—');
    set('stat-vmoy', s.vAvg !== null ? s.vAvg.toFixed(1) + ' km/h' : '—');
    set('stat-vmax', s.vMax !== null ? s.vMax.toFixed(1) + ' km/h' : '—');
    const wrap = document.getElementById('stat-slope-wrap');
    if (wrap) {
      if (s.isZoomed && s.slopeAvg !== null && s.slopeMax !== null) {
        wrap.style.display = 'inline-flex';
        set('stat-slopeavg', (s.slopeAvg >= 0 ? '+' : '') + s.slopeAvg.toFixed(1) + '%');
        set('stat-slopemax', (s.slopeMax >= 0 ? '+' : '') + s.slopeMax.toFixed(1) + '%');
      } else {
        wrap.style.display = 'none';
      }
    }
  }

  // === Stats Puissance + FC ===
  function computePowerHRStats(minX, maxX) {
    if (!fullX || !fullX.length) return null;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;
    let wSum = 0, wCount = 0, wMax = 0;
    let hSum = 0, hCount = 0, hMax = 0;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (watts && watts[i] != null && !isNaN(watts[i])) {
        wSum += watts[i]; wCount++;
        if (watts[i] > wMax) wMax = watts[i];
      }
      if (hr && hr[i] != null && !isNaN(hr[i])) {
        hSum += hr[i]; hCount++;
        if (hr[i] > hMax) hMax = hr[i];
      }
    }
    return {
      wAvg: wCount > 0 ? Math.round(wSum / wCount) : null,
      wMax: wMax > 0 ? Math.round(wMax) : null,
      hAvg: hCount > 0 ? Math.round(hSum / hCount) : null,
      hMax: hMax > 0 ? Math.round(hMax) : null,
    };
  }
  function renderPowerHRStats(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!s) {
      ['stat-wmoy','stat-wmaxx','stat-fcmoy','stat-fcmaxx'].forEach(id => set(id, '—'));
      return;
    }
    set('stat-wmoy', s.wAvg !== null ? s.wAvg + ' w' : '—');
    set('stat-wmaxx', s.wMax !== null ? s.wMax + ' w' : '—');
    set('stat-fcmoy', s.hAvg !== null ? s.hAvg + ' bpm' : '—');
    set('stat-fcmaxx', s.hMax !== null ? s.hMax + ' bpm' : '—');
  }

  // === Stats W'bal (moyenne + min en kJ) ===
  function computeWbalStats(minX, maxX) {
    if (!fullX || !fullX.length || !wbal) return null;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;
    let wSum = 0, wCount = 0, wMin = Infinity;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (wbal[i] != null && !isNaN(wbal[i])) {
        wSum += wbal[i]; wCount++;
        if (wbal[i] < wMin) wMin = wbal[i];
      }
    }
    return {
      avg: wCount > 0 ? wSum / wCount : null,
      min: wMin !== Infinity ? wMin : null,
    };
  }
  function renderWbalStats(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!s) { ['stat-wbalmoy','stat-wbalmin'].forEach(id => set(id, '—')); return; }
    set('stat-wbalmoy', s.avg !== null ? (s.avg / 1000).toFixed(1) + ' kJ' : '—');
    set('stat-wbalmin', s.min !== null ? (s.min / 1000).toFixed(1) + ' kJ' : '—');
  }

  // === Stats Cadence ===
  function computeCadenceStats(minX, maxX) {
    if (!fullX || !fullX.length) return null;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;
    let cSum = 0, cCount = 0, cMax = 0;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (cadence && cadence[i] != null && !isNaN(cadence[i]) && cadence[i] > 0) {
        cSum += cadence[i]; cCount++;
        if (cadence[i] > cMax) cMax = cadence[i];
      }
    }
    return {
      cAvg: cCount > 0 ? Math.round(cSum / cCount) : null,
      cMax: cMax > 0 ? Math.round(cMax) : null,
    };
  }
  function renderCadenceStats(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!s) { ['stat-cmoy','stat-cmaxx'].forEach(id => set(id, '—')); return; }
    set('stat-cmoy', s.cAvg !== null ? s.cAvg + ' rpm' : '—');
    set('stat-cmaxx', s.cMax !== null ? s.cMax + ' rpm' : '—');
  }

  // Stats initiales : toute la plage
  setTimeout(() => {
    renderStats(computeStats(fullX[0], fullX[fullX.length - 1]));
    renderAltSpeedStats(computeAltSpeedStats(fullX[0], fullX[fullX.length - 1]));
    renderPowerHRStats(computePowerHRStats(fullX[0], fullX[fullX.length - 1]));
    renderCadenceStats(computeCadenceStats(fullX[0], fullX[fullX.length - 1]));
    renderWbalStats(computeWbalStats(fullX[0], fullX[fullX.length - 1]));
  }, 0);

  // Expose pour syncZoomToOthers
  window._streamsComputeStats = computeStats;
  window._streamsRenderStats = renderStats;
  window._streamsComputeAltSpeedStats = computeAltSpeedStats;
  window._streamsRenderAltSpeedStats = renderAltSpeedStats;
  window._streamsComputePowerHRStats = computePowerHRStats;
  window._streamsRenderPowerHRStats = renderPowerHRStats;
  window._streamsComputeCadenceStats = computeCadenceStats;
  window._streamsRenderCadenceStats = renderCadenceStats;
  window._streamsComputeWbalStats = computeWbalStats;
  window._streamsRenderWbalStats = renderWbalStats;

  // Bornes réelles de l'activité (évite l'auto-scaling qui rajoute des km fantômes)
  const xMin = fullX[0];
  const xMax = fullX[fullX.length - 1];

  // Axe X linéaire : positions proportionnelles à la distance (ou au temps)
  const sharedX = {
    type: 'linear',
    min: xMin,
    max: xMax,
    ticks: {
      maxTicksLimit: 8,
      callback: (val) => fmtXTick(val),
      font: { size: 10 }
    },
    grid: { display: false }
  };
  // Tooltip : affiche la valeur réelle de X (km ou temps), pas l'index
  const tooltipTitle = (items) => fmtXTooltip(items[0].parsed.x);

  // Plugin decimation : redécime intelligemment selon la zone visible (LTTB préserve les pics)
  const decimationConfig = {
    enabled: true,
    algorithm: 'lttb',
    samples: 1500,
    threshold: 1500
  };

  // Y axis ticks : valeurs entières (pas de décimales)
  const intY = { ticks: { callback: (v) => Math.round(v) } };
  // Tooltip label : arrondi à l'entier
  const labelInt = (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y)}`;

  // Config zoom : drag pour zoomer, double-clic pour reset, sync entre les 3 charts
  const syncZoomToOthers = (sourceChart) => {
    const { min, max } = sourceChart.scales.x;
    _modalCharts.forEach(c => {
      if (c === sourceChart || !c.scales.x) return;
      c.options.scales.x.min = min;
      c.options.scales.x.max = max;
      c.update('none');
    });
    // Afficher le bouton "Réinitialiser le zoom" si on est zoomé
    const fullSpan = fullX[fullX.length - 1] - fullX[0];
    const visSpan = max - min;
    const isZoomed = visSpan < fullSpan * 0.97;
    const btn = document.getElementById('streams-zoom-reset');
    if (btn) btn.style.visibility = isZoomed ? 'visible' : 'hidden';
    // Recalculer les stats sur la nouvelle plage visible
    if (window._streamsComputeStats && window._streamsRenderStats) {
      window._streamsRenderStats(window._streamsComputeStats(min, max));
    }
    if (window._streamsComputeAltSpeedStats && window._streamsRenderAltSpeedStats) {
      window._streamsRenderAltSpeedStats(window._streamsComputeAltSpeedStats(min, max));
    }
    if (window._streamsComputePowerHRStats && window._streamsRenderPowerHRStats) {
      window._streamsRenderPowerHRStats(window._streamsComputePowerHRStats(min, max));
    }
    if (window._streamsComputeCadenceStats && window._streamsRenderCadenceStats) {
      window._streamsRenderCadenceStats(window._streamsComputeCadenceStats(min, max));
    }
    if (window._streamsComputeWbalStats && window._streamsRenderWbalStats) {
      window._streamsRenderWbalStats(window._streamsComputeWbalStats(min, max));
    }
  };
  const zoomConfig = {
    zoom: {
      drag: {
        enabled: true,
        backgroundColor: 'rgba(74, 222, 128, 0.15)',
        borderColor: 'rgba(74, 222, 128, 0.5)',
        borderWidth: 1
      },
      mode: 'x',
      onZoomComplete: ({ chart }) => syncZoomToOthers(chart)
    },
    pan: {
      enabled: true,
      mode: 'x',
      modifierKey: 'shift', // pan avec Shift+drag (sinon le drag normal zoome)
      onPanComplete: ({ chart }) => syncZoomToOthers(chart)
    },
    limits: { x: { min: 'original', max: 'original' } }
  };

  // Double-clic sur n'importe quel chart → reset zoom partout + stats sur plage complète
  setTimeout(() => {
    const resetAll = () => {
      _modalCharts.forEach(c => { try { c.resetZoom(); } catch (e) {} });
      // Recalculer stats sur la plage complète après reset
      if (window._streamsComputeStats && window._streamsRenderStats) {
        window._streamsRenderStats(window._streamsComputeStats(fullX[0], fullX[fullX.length - 1]));
      }
      if (window._streamsComputeAltSpeedStats && window._streamsRenderAltSpeedStats) {
        window._streamsRenderAltSpeedStats(window._streamsComputeAltSpeedStats(fullX[0], fullX[fullX.length - 1]));
      }
      if (window._streamsComputePowerHRStats && window._streamsRenderPowerHRStats) {
        window._streamsRenderPowerHRStats(window._streamsComputePowerHRStats(fullX[0], fullX[fullX.length - 1]));
      }
      if (window._streamsComputeCadenceStats && window._streamsRenderCadenceStats) {
        window._streamsRenderCadenceStats(window._streamsComputeCadenceStats(fullX[0], fullX[fullX.length - 1]));
      }
      if (window._streamsComputeWbalStats && window._streamsRenderWbalStats) {
        window._streamsRenderWbalStats(window._streamsComputeWbalStats(fullX[0], fullX[fullX.length - 1]));
      }
      // Cacher le bouton "Réinitialiser le zoom" après reset
      const btn = document.getElementById('streams-zoom-reset');
      if (btn) btn.style.visibility = 'hidden';
    };
    ['streams-power-hr', 'streams-wbal', 'streams-cadence', 'streams-speed-alt'].forEach(id => {
      const cv = document.getElementById(id);
      if (cv) cv.addEventListener('dblclick', resetAll);
    });
    const btn = document.getElementById('streams-zoom-reset');
    if (btn) btn.addEventListener('click', resetAll);
  }, 0);

  // Largeurs fixes pour aligner pixel-perfect les chartAreas entre tous les
  // graphiques (sinon le label "900" est plus large que "60" → décalage).
  const LEFT_Y_WIDTH = 55;
  const RIGHT_Y_WIDTH = 60;
  const forceLeftWidth = (scale) => { scale.width = LEFT_Y_WIDTH; };
  const forceRightWidth = (scale) => { scale.width = RIGHT_Y_WIDTH; };

  // Légende : carré plein quand dataset visible, vide quand caché.
  // Toggle visibilité + sync de l'axe Y (titre + ticks) en différé pour ne pas
  // entrer en conflit avec l'update interne de Chart.js déclenché par hide/show.
  const legendConfig = {
    onClick: (e, legendItem, legend) => {
      const chart = legend.chart;
      const i = legendItem.datasetIndex;
      if (chart.isDatasetVisible(i)) chart.hide(i);
      else chart.show(i);
      requestAnimationFrame(() => {
        const ds = chart.data.datasets[i];
        const yAxisID = ds.yAxisID || 'y';
        const sc = chart.options.scales && chart.options.scales[yAxisID];
        if (!sc) return;
        const visible = chart.isDatasetVisible(i);
        if (sc.title) sc.title.display = visible;
        if (sc.ticks) sc.ticks.display = visible;
        chart.update('none');
      });
    },
    labels: {
      boxWidth: 10,
      font: { size: 11 },
      color: '#e6e9ef',
      generateLabels: (chart) => chart.data.datasets.map((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        const hidden = meta.hidden === true;
        return {
          text: ds.label,
          fillStyle: hidden ? 'transparent' : (ds.borderColor || ds.backgroundColor),
          strokeStyle: ds.borderColor || ds.backgroundColor,
          lineWidth: 1.5,
          fontColor: '#e6e9ef',
          hidden: false, // pas de strikethrough
          datasetIndex: i
        };
      })
    }
  };

  // Axe Y droit "fantôme" (invisible mais réserve l'espace) pour les charts
  // qui n'ont qu'un axe Y gauche, afin qu'ils s'alignent sur Watts/FC.
  const phantomY1 = {
    position: 'right',
    display: true,
    ticks: { display: true, color: 'transparent', callback: (v) => v.toFixed(0) },
    grid: { display: false },
    border: { display: false },
    title: { display: false },
    afterFit: forceRightWidth
  };

  // Chart 1 : Watts + FC (double Y, axe X linéaire en distance ou temps)
  if (wattsPts.length || hrPts.length) {
    const datasets = [];
    if (wattsPts.length) datasets.push({
      label: 'Puissance (w)', data: wattsPts,
      borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.12)',
      yAxisID: 'y', pointRadius: 0, borderWidth: 1.2, fill: true, tension: 0.1, spanGaps: true
    });
    if (hrPts.length) datasets.push({
      label: 'FC (bpm)', data: hrPts,
      borderColor: '#f87171', backgroundColor: 'transparent',
      yAxisID: 'y1', pointRadius: 0, borderWidth: 1.5, tension: 0.15, spanGaps: true
    });
    _modalCharts.push(new Chart(document.getElementById('streams-power-hr'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: {
          legend: { display: false }, // remplacée par la barre HTML custom
          tooltip: { enabled: false },
          zoom: zoomConfig,
          decimation: decimationConfig
        },
        scales: {
          x: sharedX,
          y: { position: 'left', title: { display: true, text: 'Watts' }, suggestedMin: 0, suggestedMax: 600, ...intY, afterFit: forceLeftWidth },
          ...(hrPts.length ? { y1: { position: 'right', title: { display: true, text: 'FC' }, grid: { display: false }, suggestedMin: 80, suggestedMax: 200, ...intY, afterFit: forceRightWidth } } : {})
        }
      }
    }));
    // Wire la légende HTML custom pour Puissance + FC
    const powerHrChart = _modalCharts[_modalCharts.length - 1];
    setTimeout(() => {
      document.querySelectorAll('#custom-legend-powerhr .cl-btn-phr').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.idx;
          const yax = btn.dataset.yax;
          const color = btn.dataset.color;
          if (powerHrChart.isDatasetVisible(idx)) powerHrChart.hide(idx);
          else powerHrChart.show(idx);
          requestAnimationFrame(() => {
            const visible = powerHrChart.isDatasetVisible(idx);
            const sc = powerHrChart.options.scales && powerHrChart.options.scales[yax];
            if (sc) {
              if (sc.title) sc.title.display = visible;
              if (sc.ticks) sc.ticks.display = visible;
            }
            powerHrChart.update('none');
            const box = btn.querySelector('.cl-box');
            if (box) box.style.background = visible ? color : 'transparent';
          });
        });
      });
    }, 0);
  }

  // Chart 1.5 : W'bal (réserve anaérobie en kJ)
  if (wbalPts.length) {
    const wbalKJ = wbalPts.map(p => ({ x: p.x, y: p.y / 1000 }));
    _modalCharts.push(new Chart(document.getElementById('streams-wbal'), {
      type: 'line',
      data: { datasets: [{
        label: "W'bal (kJ)", data: wbalKJ,
        borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.15)',
        pointRadius: 0, borderWidth: 1.2, fill: true, tension: 0.1, spanGaps: true,
        // Ligne en pointillé + rouge quand on est franchement sous 0
        // (les segments qui croisent y=0 restent solides pour ne pas "fuir" au-dessus de 0)
        segment: {
          borderDash: ctx => (ctx.p0.parsed.y < 0 && ctx.p1.parsed.y < 0) ? [5, 4] : undefined,
          borderColor: ctx => (ctx.p0.parsed.y < 0 && ctx.p1.parsed.y < 0) ? '#f87171' : '#60a5fa'
        }
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false, parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          zoom: zoomConfig,
          decimation: decimationConfig
        },
        scales: {
          x: sharedX,
          y: { title: { display: true, text: "W'bal (kJ)" }, suggestedMin: 0, suggestedMax: wPrime / 1000, ticks: { callback: (v) => v.toFixed(0) }, afterFit: forceLeftWidth },
          y1: phantomY1
        }
      }
    }));
    // Wire la légende HTML custom pour W'bal
    const wbalChart = _modalCharts[_modalCharts.length - 1];
    setTimeout(() => {
      document.querySelectorAll('#custom-legend-wbal .cl-btn-wbal').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.idx;
          const yax = btn.dataset.yax;
          const color = btn.dataset.color;
          if (wbalChart.isDatasetVisible(idx)) wbalChart.hide(idx);
          else wbalChart.show(idx);
          requestAnimationFrame(() => {
            const visible = wbalChart.isDatasetVisible(idx);
            const sc = wbalChart.options.scales && wbalChart.options.scales[yax];
            if (sc) {
              if (sc.title) sc.title.display = visible;
              if (sc.ticks) sc.ticks.display = visible;
            }
            wbalChart.update('none');
            const box = btn.querySelector('.cl-box');
            if (box) box.style.background = visible ? color : 'transparent';
          });
        });
      });
    }, 0);
  }

  // Chart 2 : Cadence
  if (cadencePts.length) {
    _modalCharts.push(new Chart(document.getElementById('streams-cadence'), {
      type: 'line',
      data: { datasets: [{ label: 'Cadence (rpm)', data: cadencePts, borderColor: '#a78bfa', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.2, tension: 0.1, spanGaps: true }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false }, zoom: zoomConfig, decimation: decimationConfig },
        scales: { x: sharedX, y: { title: { display: true, text: 'rpm' }, suggestedMin: 0, suggestedMax: 110, ...intY, afterFit: forceLeftWidth }, y1: phantomY1 }
      }
    }));
    // Wire la légende HTML custom pour Cadence
    const cadChart = _modalCharts[_modalCharts.length - 1];
    setTimeout(() => {
      document.querySelectorAll('#custom-legend-cadence .cl-btn-cad').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.idx;
          const yax = btn.dataset.yax;
          const color = btn.dataset.color;
          if (cadChart.isDatasetVisible(idx)) cadChart.hide(idx);
          else cadChart.show(idx);
          requestAnimationFrame(() => {
            const visible = cadChart.isDatasetVisible(idx);
            const sc = cadChart.options.scales && cadChart.options.scales[yax];
            if (sc) {
              if (sc.title) sc.title.display = visible;
              if (sc.ticks) sc.ticks.display = visible;
            }
            cadChart.update('none');
            const box = btn.querySelector('.cl-box');
            if (box) box.style.background = visible ? color : 'transparent';
          });
        });
      });
    }, 0);
  }

  // Chart 3 : Altitude (fond) + Vitesse (ligne au-dessus)
  // Altitude en premier dans le tableau → rendue en arrière-plan (profil de montagne).
  if (speedPts.length || altPts.length) {
    const datasets = [];
    if (altPts.length) datasets.push({
      label: 'Altitude (m)', data: altPts,
      borderColor: 'rgba(74,222,128,0.6)', backgroundColor: 'rgba(74,222,128,0.18)',
      yAxisID: 'y1', pointRadius: 0, borderWidth: 1, fill: true, tension: 0.2, spanGaps: true
    });
    if (speedPts.length) datasets.push({
      label: 'Vitesse (km/h)', data: speedPts,
      borderColor: '#22d3ee', backgroundColor: 'transparent',
      yAxisID: 'y', pointRadius: 0, borderWidth: 1.4, fill: false, tension: 0.1, spanGaps: true
    });
    _modalCharts.push(new Chart(document.getElementById('streams-speed-alt'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false, parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: {
          legend: { display: false }, // remplacée par la barre HTML custom
          tooltip: { enabled: false },
          zoom: zoomConfig,
          decimation: decimationConfig
        },
        scales: {
          x: sharedX,
          y: { position: 'left', title: { display: true, text: 'km/h' }, suggestedMin: 0, suggestedMax: 50, afterFit: forceLeftWidth },
          ...(altPts.length ? { y1: { position: 'right', title: { display: true, text: 'm' }, grid: { display: false }, ...intY, afterFit: forceRightWidth } } : { y1: phantomY1 })
        }
      }
    }));

    // Wire la légende HTML custom au-dessus du chart
    const speedAltChart = _modalCharts[_modalCharts.length - 1];
    setTimeout(() => {
      document.querySelectorAll('#custom-legend-altspeed .cl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.idx;
          const yax = btn.dataset.yax;
          const color = btn.dataset.color;
          if (speedAltChart.isDatasetVisible(idx)) speedAltChart.hide(idx);
          else speedAltChart.show(idx);
          requestAnimationFrame(() => {
            const visible = speedAltChart.isDatasetVisible(idx);
            const sc = speedAltChart.options.scales && speedAltChart.options.scales[yax];
            if (sc) {
              if (sc.title) sc.title.display = visible;
              if (sc.ticks) sc.ticks.display = visible;
            }
            speedAltChart.update('none');
            // Toggle visuel : carré plein si visible, vide sinon
            const box = btn.querySelector('.cl-box');
            if (box) box.style.background = visible ? color : 'transparent';
          });
        });
      });
    }, 0);
  }
}

// ========= MODAL DÉTAIL SÉANCE =========
// === Rendu du profil d'altitude d'un GPX en SVG (distance vs élévation) ===
function renderGpxElevation(gpxContent, svgId) {
  const svg = document.getElementById(svgId);
  if (!svg || !gpxContent) return;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Pas de points GPS</text>';
      return;
    }
    // Haversine distance helper (km)
    function dist(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    // Construit la série (cumKm, ele)
    const series = [];
    let cumKm = 0, prevLat = null, prevLon = null;
    let hasEle = false;
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (prevLat !== null) cumKm += dist(prevLat, prevLon, lat, lon);
      prevLat = lat; prevLon = lon;
      const eleEl = pts[i].getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isNaN(ele)) hasEle = true;
      series.push({ km: cumKm, ele: isNaN(ele) ? null : ele });
    }
    if (!hasEle) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Pas de données d\'altitude dans le GPX</text>';
      return;
    }
    // Bounds
    const elevs = series.map(p => p.ele).filter(e => e != null);
    let minEle = Math.min(...elevs);
    let maxEle = Math.max(...elevs);
    const totalKm = series[series.length - 1].km;
    if (totalKm <= 0) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Distance nulle</text>';
      return;
    }
    // Marge pour que la courbe ne touche pas les bords
    const eleRange = Math.max(maxEle - minEle, 10);
    const elePad = eleRange * 0.1;
    minEle -= elePad;
    maxEle += elePad;
    // Calcul D+ total (positive elevation gain)
    let elevGain = 0;
    for (let i = 1; i < series.length; i++) {
      const d = (series[i].ele || 0) - (series[i-1].ele || 0);
      if (d > 0) elevGain += d;
    }

    const W = 900, H = 180, padL = 40, padR = 16, padT = 16, padB = 28;
    const drawW = W - padL - padR;
    const drawH = H - padT - padB;
    // Path area (du bas vers le haut)
    let path = '';
    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      if (p.ele == null) continue;
      const x = padL + (p.km / totalKm) * drawW;
      const y = padT + drawH - ((p.ele - minEle) / (maxEle - minEle)) * drawH;
      path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    // Fermer l'area pour fill
    const lastX = padL + drawW;
    const baseY = padT + drawH;
    const area = path + `L${lastX.toFixed(1)} ${baseY.toFixed(1)} L${padL} ${baseY.toFixed(1)} Z`;

    // Axes labels (3 ticks Y, distance min/mid/max)
    const ticks = [];
    for (let t = 0; t <= 3; t++) {
      const eleT = minEle + (maxEle - minEle) * (1 - t / 3);
      const yT = padT + (drawH * t / 3);
      ticks.push({ y: yT, label: Math.round(eleT) + ' m' });
    }
    const xTicks = [];
    for (let t = 0; t <= 4; t++) {
      const kmT = (totalKm * t) / 4;
      const xT = padL + (drawW * t / 4);
      xTicks.push({ x: xT, label: kmT.toFixed(0) + ' km' });
    }

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="elevGrad-${svgId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(74,222,128,0.7)"/>
          <stop offset="100%" stop-color="rgba(74,222,128,0.05)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(74,222,128,0.03)" rx="8"/>
      ${ticks.map(t => `
        <line x1="${padL}" y1="${t.y}" x2="${W - padR}" y2="${t.y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${padL - 6}" y="${t.y + 4}" text-anchor="end" fill="#64748b" font-size="11">${t.label}</text>
      `).join('')}
      ${xTicks.map(t => `
        <text x="${t.x}" y="${H - 8}" text-anchor="middle" fill="#64748b" font-size="11">${t.label}</text>
      `).join('')}
      <path d="${area}" fill="url(#elevGrad-${svgId})" stroke="none"/>
      <path d="${path}" stroke="#4ade80" stroke-width="2" fill="none" stroke-linejoin="round"/>
      <text x="${W - padR - 8}" y="${padT + 14}" text-anchor="end" fill="#4ade80" font-size="11" font-weight="700">D+ ${Math.round(elevGain)} m</text>
      <line class="cursor-line" id="${svgId}-cursor-line" x1="0" y1="${padT}" x2="0" y2="${baseY}" stroke="#fff" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none"/>
      <circle class="cursor-dot" id="${svgId}-cursor-dot" cx="0" cy="0" r="5" fill="#4ade80" stroke="#062017" stroke-width="2" opacity="0" pointer-events="none"/>
    `;

    // ====== Interactivité curseur (crosshair + tooltip) ======
    const wrap = svg.parentNode;
    const tooltip = wrap ? wrap.querySelector('.gpx-elev-tooltip') : null;
    const cursorLine = svg.querySelector('.cursor-line');
    const cursorDot = svg.querySelector('.cursor-dot');
    if (!wrap || !tooltip || !cursorLine || !cursorDot) return;

    // Trouve l'altitude interpolée à un km donné
    function eleAtKm(km) {
      if (km <= 0) return series[0].ele;
      if (km >= totalKm) return series[series.length - 1].ele;
      // Binary search
      let lo = 0, hi = series.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (series[mid].km < km) lo = mid; else hi = mid;
      }
      const a = series[lo], b = series[hi];
      const t = (km - a.km) / (b.km - a.km || 1);
      return (a.ele || 0) + ((b.ele || 0) - (a.ele || 0)) * t;
    }

    // Pente locale sur fenêtre +/- 100m
    function slopeAtKm(km) {
      const window = 0.1; // km
      const km1 = Math.max(0, km - window);
      const km2 = Math.min(totalKm, km + window);
      const e1 = eleAtKm(km1);
      const e2 = eleAtKm(km2);
      const dx = (km2 - km1) * 1000; // m
      if (dx === 0) return 0;
      return ((e2 - e1) / dx) * 100; // %
    }

    function onMove(e) {
      const rect = wrap.getBoundingClientRect();
      const xPx = e.clientX - rect.left;
      // Mappe xPx (en pixels conteneur) → x SVG (viewBox)
      const xSvg = (xPx / rect.width) * W;
      if (xSvg < padL || xSvg > W - padR) { onLeave(); return; }
      const km = ((xSvg - padL) / drawW) * totalKm;
      const ele = eleAtKm(km);
      const slope = slopeAtKm(km);
      const ySvg = padT + drawH - ((ele - minEle) / (maxEle - minEle)) * drawH;
      cursorLine.setAttribute('x1', xSvg);
      cursorLine.setAttribute('x2', xSvg);
      cursorLine.setAttribute('opacity', '0.5');
      cursorDot.setAttribute('cx', xSvg);
      cursorDot.setAttribute('cy', ySvg);
      cursorDot.setAttribute('opacity', '1');
      // Tooltip en HTML, positionné en pixels conteneur
      tooltip.style.display = 'block';
      tooltip.innerHTML = `
        <div class="t-km">${km.toFixed(2)} km</div>
        <div class="t-ele">Altitude : ${Math.round(ele)} m · pente ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}%</div>
      `;
      // Positionnement : à droite du curseur sauf si trop près du bord
      const tipW = 170;
      let left = xPx + 12;
      if (left + tipW > rect.width) left = xPx - tipW - 12;
      tooltip.style.left = left + 'px';
      tooltip.style.top = '8px';
    }
    function onLeave() {
      cursorLine.setAttribute('opacity', '0');
      cursorDot.setAttribute('opacity', '0');
      tooltip.style.display = 'none';
    }
    // Nettoie d'éventuels listeners précédents
    if (wrap._gpxElevMove) wrap.removeEventListener('mousemove', wrap._gpxElevMove);
    if (wrap._gpxElevLeave) wrap.removeEventListener('mouseleave', wrap._gpxElevLeave);
    wrap._gpxElevMove = onMove;
    wrap._gpxElevLeave = onLeave;
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);
  } catch (e) {
    console.warn('[renderGpxElevation]', e);
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Erreur de lecture de l\'altitude</text>';
  }
}

// === Extraction des MONTÉES significatives (>= minGain m) depuis le GPX ===
// Détecte les portions de montée continue, en ignorant les petites descentes (< 5m)
function extractGpxClimbs(gpxContent, minGain = 30) {
  if (!gpxContent) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) return [];
    function _d(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    // Construit la série (km cumulé, altitude)
    const series = [];
    let cumKm = 0, prevLat = null, prevLon = null;
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (prevLat !== null) cumKm += _d(prevLat, prevLon, lat, lon);
      prevLat = lat; prevLon = lon;
      const eleEl = pts[i].getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isNaN(ele)) series.push({ km: cumKm, ele });
    }
    if (series.length < 2) return [];

    // Helper : pente locale en % sur fenêtre 300m autour de l'index
    function localSlope(idx, halfWin = 0.15) {
      let j1 = idx, j2 = idx;
      while (j1 > 0 && series[idx].km - series[j1-1].km < halfWin) j1--;
      while (j2 < series.length - 1 && series[j2+1].km - series[idx].km < halfWin) j2++;
      const dx = (series[j2].km - series[j1].km) * 1000;
      if (dx <= 0) return 0;
      return ((series[j2].ele - series[j1].ele) / dx) * 100;
    }

    // === NOUVELLE APPROCHE : scan slope-based + merging ===
    // 1. Pour chaque point, calculer la pente locale (300m window)
    // 2. Marquer les points "climbing" (slope >= 2%)
    // 3. Trouver les runs continus + merger ceux séparés par <300m
    // 4. Pour chaque run, calculer D+ réel et garder si >= minGain
    const SLOPE_ENTRY = 2; // % minimum pour entrer en "climbing"
    const MERGE_GAP_KM = 0.3; // on fusionne deux runs séparés de < 300m

    const slopes = series.map((_, i) => localSlope(i));

    // Trouve les runs continus où slope >= SLOPE_ENTRY
    const runs = [];
    let runStart = -1;
    for (let i = 0; i < slopes.length; i++) {
      if (slopes[i] >= SLOPE_ENTRY) {
        if (runStart < 0) runStart = i;
      } else {
        if (runStart >= 0) {
          runs.push({ s: runStart, e: i - 1 });
          runStart = -1;
        }
      }
    }
    if (runStart >= 0) runs.push({ s: runStart, e: slopes.length - 1 });

    // Merge des runs proches (gap < MERGE_GAP_KM)
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && series[r.s].km - series[last.e].km < MERGE_GAP_KM) {
        last.e = r.e;
      } else {
        merged.push({ s: r.s, e: r.e });
      }
    }

    // Pour chaque run mergé : calcul D+ réel + filtre par minGain
    const climbs = [];
    for (const r of merged) {
      let s = r.s, e = r.e;
      // Petite extension en amont/aval tant qu'on continue à monter doucement
      while (s > 0 && series[s].ele - series[s-1].ele > 0 && localSlope(s-1) > 0) s--;
      while (e < series.length - 1 && series[e+1].ele - series[e].ele > 0 && localSlope(e+1) > 0) e++;
      // D+ smart sur la portion [s..e]
      let lastSignif = series[s].ele;
      let gain = 0;
      const TH = 3;
      for (let i = s + 1; i <= e; i++) {
        const dd = series[i].ele - lastSignif;
        if (dd > TH) { gain += dd; lastSignif = series[i].ele; }
        else if (dd < -TH) { lastSignif = series[i].ele; }
      }
      if (gain < minGain) continue;
      const distKm = series[e].km - series[s].km;
      const avgSlope = distKm > 0 ? ((series[e].ele - series[s].ele) / (distKm * 1000)) * 100 : 0;
      // Pente max
      let maxSlope = -Infinity;
      for (let j = s; j <= e; j++) {
        const sl = localSlope(j);
        if (sl > maxSlope) maxSlope = sl;
      }
      climbs.push({
        startKm: series[s].km, endKm: series[e].km,
        startEle: series[s].ele, endEle: series[e].ele,
        distKm, gain, avgSlope,
        maxSlope: isFinite(maxSlope) ? maxSlope : avgSlope,
      });
    }
    return climbs;
  } catch (e) {
    console.warn('[extractGpxClimbs]', e);
    return [];
  }
}

// === Extraction des stats principales (km, D+, D-) depuis le contenu GPX ===
// Utilisé pour override les valeurs manuellement saisies si un GPX est uploadé
// Si laps > 1 : multiplie km/D+/D- (le parcours est répété N fois)
function extractGpxStats(gpxContent, laps = 1) {
  if (!gpxContent) return null;
  laps = Math.max(1, parseInt(laps, 10) || 1);
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) return null;
    function _d(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    let cumKm = 0, prevLat = null, prevLon = null;
    const elevs = [];
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (prevLat !== null) cumKm += _d(prevLat, prevLon, lat, lon);
      prevLat = lat; prevLon = lon;
      const eleEl = pts[i].getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isNaN(ele)) elevs.push(ele);
    }
    // D+ smart avec threshold 3m
    let gain = 0, loss = 0;
    if (elevs.length > 1) {
      let lastSignif = elevs[0];
      const TH = 3;
      for (let i = 1; i < elevs.length; i++) {
        const dd = elevs[i] - lastSignif;
        if (dd > TH) { gain += dd; lastSignif = elevs[i]; }
        else if (dd < -TH) { loss += -dd; lastSignif = elevs[i]; }
      }
    }
    return {
      km: +(cumKm * laps).toFixed(2),
      dplus: Math.round(gain * laps),
      dminus: Math.round(loss * laps),
      laps,
      lapKm: +cumKm.toFixed(2),
      lapDplus: Math.round(gain),
    };
  } catch (e) {
    console.warn('[extractGpxStats]', e);
    return null;
  }
}

// === Rendu du profil d'altitude GPX via Chart.js (même look que les streams réalisés) ===
let _gpxElevChart = null;
function renderGpxElevationChart(gpxContent, canvasId, laps = 1) {
  laps = Math.max(1, parseInt(laps, 10) || 1);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !gpxContent || typeof Chart === 'undefined') return;
  // Detruit le chart précédent si existant
  if (_gpxElevChart) {
    try { _gpxElevChart.destroy(); } catch (e) {}
    _gpxElevChart = null;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) {
      canvas.parentNode.innerHTML = '<div class="modal-placeholder">Pas de points GPS dans le fichier GPX</div>';
      return;
    }
    function dist(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    const series = []; // [{x:km, y:ele}]
    let cumKm = 0, prevLat = null, prevLon = null;
    let hasEle = false;
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (prevLat !== null) cumKm += dist(prevLat, prevLon, lat, lon);
      prevLat = lat; prevLon = lon;
      const eleEl = pts[i].getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isNaN(ele)) hasEle = true;
      series.push({ x: cumKm, y: isNaN(ele) ? null : ele });
    }
    if (!hasEle) {
      canvas.parentNode.innerHTML = '<div class="modal-placeholder">Pas de données d\'altitude dans le GPX</div>';
      return;
    }
    // Calcul D+ total : algo "smart" avec threshold 3m pour filtrer le bruit GPS
    function _smartGainTotal(arr) {
      if (!arr || arr.length < 2) return 0;
      let gain = 0;
      let lastSignif = arr[0].y;
      const TH = 3;
      for (let i = 1; i < arr.length; i++) {
        const d = arr[i].y - lastSignif;
        if (d > TH) { gain += d; lastSignif = arr[i].y; }
        else if (d < -TH) { lastSignif = arr[i].y; }
      }
      return gain;
    }
    const elevGain = _smartGainTotal(series.filter(p => p.y != null));
    // PAS de lissage pour l'affichage : on garde la finesse du GPX
    let basePlot = series.filter(p => p.y != null);
    const lapKm = basePlot.length ? basePlot[basePlot.length - 1].x : 0;

    // Répétition de la série N fois (laps) avec offset de km cumulé
    let plot = [];
    if (laps > 1 && lapKm > 0) {
      for (let L = 0; L < laps; L++) {
        const offset = L * lapKm;
        for (const p of basePlot) {
          plot.push({ x: p.x + offset, y: p.y });
        }
      }
    } else {
      plot = basePlot.slice();
    }

    // Décimation seulement si vraiment beaucoup de points (>2000)
    if (plot.length > 2000) {
      const step = Math.ceil(plot.length / 2000);
      plot = plot.filter((_, i) => i % step === 0);
    }
    const totalKm = plot.length ? plot[plot.length - 1].x : 0;

    // Pour les stats : série brute répétée N fois (laps)
    let rawSeries = series.filter(p => p.y != null);
    if (laps > 1 && lapKm > 0) {
      const baseRaw = rawSeries.slice();
      rawSeries = [];
      for (let L = 0; L < laps; L++) {
        const offset = L * lapKm;
        for (const p of baseRaw) rawSeries.push({ x: p.x + offset, y: p.y });
      }
    }

    // Calcul slope sur fenêtre glissante (~200m) pour éviter le bruit instantané
    function slopeOnWindow(arr, idx, windowKm = 0.2) {
      let i1 = idx, i2 = idx;
      while (i1 > 0 && arr[idx].x - arr[i1-1].x < windowKm/2) i1--;
      while (i2 < arr.length - 1 && arr[i2+1].x - arr[idx].x < windowKm/2) i2++;
      const dx = (arr[i2].x - arr[i1].x) * 1000;
      if (dx <= 0) return 0;
      return ((arr[i2].y - arr[i1].y) / dx) * 100;
    }

    // D+ / D- "smart" : threshold de 3m sur chaque segment monotone (filtre noise GPS)
    function smartElevation(arr) {
      if (arr.length < 2) return { gain: 0, loss: 0 };
      let gain = 0, loss = 0;
      let lastSignif = arr[0].y;
      let trend = 0; // +1 = montée, -1 = descente, 0 = aucune
      const TH = 3; // mètres
      for (let i = 1; i < arr.length; i++) {
        const d = arr[i].y - lastSignif;
        if (d > TH) {
          gain += d;
          lastSignif = arr[i].y;
          trend = 1;
        } else if (d < -TH) {
          loss += -d;
          lastSignif = arr[i].y;
          trend = -1;
        }
      }
      return { gain, loss };
    }

    function computeStats(kmMin, kmMax) {
      const filtered = rawSeries.filter(p => p.x >= kmMin && p.x <= kmMax);
      if (filtered.length < 2) return null;
      const { gain, loss } = smartElevation(filtered);
      // Pente max/min sur fenêtres ~200m
      let maxSlope = -Infinity, minSlope = Infinity;
      for (let i = 0; i < filtered.length; i++) {
        const s = slopeOnWindow(filtered, i, 0.2);
        if (s > maxSlope) maxSlope = s;
        if (s < minSlope) minSlope = s;
      }
      const startEle = filtered[0].y;
      const endEle = filtered[filtered.length - 1].y;
      const distKm = filtered[filtered.length - 1].x - filtered[0].x;
      const avgSlope = distKm > 0 ? ((endEle - startEle) / (distKm * 1000)) * 100 : 0;
      return { distKm, gain, loss, avgSlope, maxSlope, minSlope, startEle, endEle, kmMin: filtered[0].x, kmMax: filtered[filtered.length - 1].x };
    }
    function renderStats(stats, isSelection = false) {
      const row = document.getElementById('gpx-stats-row-prevu');
      if (!row) return;
      if (!stats) {
        row.innerHTML = '';
        window._gpxCurrentSelectionStats = null;
        return;
      }
      // Stocke la sélection courante en global pour que le bouton puisse la lire
      window._gpxCurrentSelectionStats = isSelection ? stats : null;
      const fmtSlope = s => (s >= 0 ? '+' : '') + s.toFixed(1) + '%';
      const addBtn = isSelection
        ? `<button class="add-segment-btn" id="add-segment-btn" title="Sauvegarder cette portion comme segment">+ Ajouter segment</button>`
        : '';
      row.innerHTML = `
        <div class="gpx-stat"><div class="g-l">Distance</div><div class="g-v">${stats.distKm.toFixed(2)} km</div></div>
        <div class="gpx-stat"><div class="g-l">D+</div><div class="g-v">${Math.round(stats.gain)} m</div></div>
        <div class="gpx-stat"><div class="g-l">D−</div><div class="g-v">${Math.round(stats.loss)} m</div></div>
        <div class="gpx-stat"><div class="g-l">Pente moy.</div><div class="g-v">${fmtSlope(stats.avgSlope)}</div></div>
        <div class="gpx-stat"><div class="g-l">Pente max</div><div class="g-v">${fmtSlope(stats.maxSlope)}</div></div>
        <div class="gpx-stat"><div class="g-l">Pente min</div><div class="g-v">${fmtSlope(stats.minSlope)}</div></div>
        ${addBtn}
      `;
      const btn = document.getElementById('add-segment-btn');
      if (btn) btn.addEventListener('click', () => {
        if (typeof window.gpxAddCurrentSelectionAsSegment === 'function') {
          window.gpxAddCurrentSelectionAsSegment();
        }
      });
    }
    // Stats initiales (parcours complet)
    renderStats(computeStats(0, totalKm));

    // Fonction pour highlighter un segment sur la carte Leaflet
    function highlightSegmentOnMap(kmMin, kmMax) {
      const linked = window._gpxLinkedData;
      if (!linked || !linked.map) return;
      // Supprime le précédent highlight
      if (linked._highlightLayer) {
        try { linked.map.removeLayer(linked._highlightLayer); } catch (e) {}
        linked._highlightLayer = null;
        try { linked.map.removeLayer(linked._highlightBg); } catch (e) {}
        linked._highlightBg = null;
      }
      if (kmMin == null || kmMax == null) return;
      // Sélectionne les coords correspondant au range km
      const segCoords = [];
      for (let i = 0; i < linked.cumKmByIdx.length; i++) {
        if (linked.cumKmByIdx[i] >= kmMin && linked.cumKmByIdx[i] <= kmMax) {
          segCoords.push(linked.coords[i]);
        }
      }
      if (segCoords.length < 2) return;
      // Double couche : contour vert épais + intérieur noir → effet "tube vert"
      linked._highlightBg = L.polyline(segCoords, {
        color: '#4ade80', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round',
      }).addTo(linked.map);
      linked._highlightLayer = L.polyline(segCoords, {
        color: '#000', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round',
      }).addTo(linked.map);
      // Recadrage léger
      linked.map.fitBounds(linked._highlightLayer.getBounds(), { padding: [40, 40], maxZoom: 17, animate: true });
    }

    // Chart.js area chart avec drag-select
    _gpxElevChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Altitude',
          data: plot,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74,222,128,0.20)',
          borderWidth: 1.4,
          pointRadius: 0,
          fill: true,
          tension: 0, // pas de lissage Bezier : on garde la forme exacte du GPX
          parsing: false,
          spanGaps: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: {
          legend: { display: false },
          // Tooltip Chart.js désactivé : on utilise un tooltip HTML custom interpolé
          tooltip: { enabled: false },
          // Désactive le plugin global verticalHoverLine qui dessinait une 2e ligne
          // snappée au point le plus proche
          verticalHoverLine: false,
          // Drag-select pour sélectionner une portion du parcours (zoom plugin)
          zoom: {
            zoom: {
              drag: {
                enabled: true,
                backgroundColor: 'rgba(74, 222, 128, 0.18)',
                borderColor: 'rgba(74, 222, 128, 0.6)',
                borderWidth: 1,
              },
              mode: 'x',
              onZoomComplete: ({ chart }) => {
                const xScale = chart.scales.x;
                const kmMin = xScale.min;
                const kmMax = xScale.max;
                const stats = computeStats(kmMin, kmMax);
                renderStats(stats, true); // true = c'est une sélection (affiche bouton + ajouter segment)
                if (stats) highlightSegmentOnMap(stats.kmMin, stats.kmMax);
              },
            },
            limits: { x: { min: 'original', max: 'original' } },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max: totalKm,
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: v => v.toFixed(0) + ' km',
              maxTicksLimit: 8,
            },
            grid: { display: false }, // pas de lignes de grille verticales (évite confusion avec le curseur)
            border: { display: false },
          },
          y: {
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: v => Math.round(v) + ' m',
              maxTicksLimit: 4,
            },
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            border: { display: false },
            title: { display: false },
          },
        },
      },
    });

    // Pas de badge D+ : l'info est déjà dans la barre de stats au-dessus du graphique
    const wrap = canvas.parentNode;
    const oldBadge = wrap.querySelector('.gpx-elev-dplus-badge');
    if (oldBadge) oldBadge.remove();

    // === CROSSHAIR INTERPOLÉ (DOM divs, pixel-perfect) ===
    const tooltipEl = wrap.querySelector('.gpx-elev-tooltip');
    // Cleanup AGGRESSIF : retire toutes les crosshair lines/dots/overlays existant
    // dans le document (au cas où d'anciennes instances traînent quelque part)
    document.querySelectorAll('.gpx-elev-line').forEach(n => n.remove());
    document.querySelectorAll('.gpx-elev-dot').forEach(n => n.remove());
    document.querySelectorAll('.gpx-elev-overlay').forEach(n => n.remove());
    // Crosshair vertical (div absolute) + dot — fraîchement créés
    const cursorLine = document.createElement('div');
    cursorLine.className = 'gpx-elev-line';
    wrap.appendChild(cursorLine);
    const cursorDot = document.createElement('div');
    cursorDot.className = 'gpx-elev-dot';
    wrap.appendChild(cursorDot);

    function interpolateY(km) {
      // Binary search dans plot pour interpoler l'altitude au km exact
      if (!plot.length) return null;
      if (km <= plot[0].x) return plot[0].y;
      if (km >= plot[plot.length - 1].x) return plot[plot.length - 1].y;
      let lo = 0, hi = plot.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (plot[mid].x < km) lo = mid; else hi = mid;
      }
      const t = (km - plot[lo].x) / (plot[hi].x - plot[lo].x || 1);
      return plot[lo].y + (plot[hi].y - plot[lo].y) * t;
    }
    function slopeAt(km, win = 0.1) {
      const e1 = interpolateY(km - win);
      const e2 = interpolateY(km + win);
      if (e1 == null || e2 == null) return 0;
      return ((e2 - e1) / (win * 2 * 1000)) * 100;
    }

    function onChartMove(e) {
      const cRect = canvas.getBoundingClientRect();
      const wRect = wrap.getBoundingClientRect();
      const xInCanvas = e.clientX - cRect.left;   // px relatifs au canvas chart
      const yInCanvas = e.clientY - cRect.top;
      const chartArea = _gpxElevChart.chartArea;
      if (xInCanvas < chartArea.left || xInCanvas > chartArea.right ||
          yInCanvas < chartArea.top || yInCanvas > chartArea.bottom) {
        clearCursor();
        return;
      }
      const km = _gpxElevChart.scales.x.getValueForPixel(xInCanvas);
      const ele = interpolateY(km);
      if (ele == null) { clearCursor(); return; }
      const yOnLineInCanvas = _gpxElevChart.scales.y.getPixelForValue(ele);
      const slope = slopeAt(km);

      // Positions converties en coords relatives au WRAP (pour le DOM positioning)
      const xInWrap = (cRect.left - wRect.left) + xInCanvas;
      const yInWrap = (cRect.top - wRect.top) + yOnLineInCanvas;
      const topInWrap = (cRect.top - wRect.top) + chartArea.top;
      const bottomInWrap = (cRect.top - wRect.top) + chartArea.bottom;

      // Ligne verticale (DOM div)
      cursorLine.style.left = xInWrap + 'px';
      cursorLine.style.top = topInWrap + 'px';
      cursorLine.style.height = (bottomInWrap - topInWrap) + 'px';
      cursorLine.style.display = 'block';

      // Dot
      cursorDot.style.left = (xInWrap - 6) + 'px';
      cursorDot.style.top = (yInWrap - 6) + 'px';
      cursorDot.style.display = 'block';

      // Tooltip
      tooltipEl.style.display = 'block';
      tooltipEl.innerHTML = `
        <div class="t-km">${km.toFixed(2)} km</div>
        <div class="t-ele">Altitude : ${Math.round(ele)} m · pente ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}%</div>
      `;
      const tipW = 180;
      let left = xInWrap + 14;
      if (left + tipW > wRect.width) left = xInWrap - tipW - 14;
      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top = '8px';

      // Bike marker sur la carte (interpolation pixel-perfect)
      // Si laps > 1 : on prend km modulo lapKm pour retrouver la position sur la boucle
      const linked = window._gpxLinkedData;
      if (linked && linked.bikeMarker && linked.cumKmByIdx) {
        const arr = linked.cumKmByIdx;
        const lapLen = linked.totalKm || (arr[arr.length - 1] || 0);
        let kmOnLoop = km;
        if (lapLen > 0) kmOnLoop = ((km % lapLen) + lapLen) % lapLen;
        let lo2 = 0, hi2 = arr.length - 1;
        while (lo2 < hi2 - 1) {
          const mid = (lo2 + hi2) >> 1;
          if (arr[mid] < kmOnLoop) lo2 = mid; else hi2 = mid;
        }
        const t2 = (kmOnLoop - arr[lo2]) / (arr[hi2] - arr[lo2] || 1);
        const lat = linked.coords[lo2][0] + (linked.coords[hi2][0] - linked.coords[lo2][0]) * t2;
        const lon = linked.coords[lo2][1] + (linked.coords[hi2][1] - linked.coords[lo2][1]) * t2;
        linked.bikeMarker.setLatLng([lat, lon]);
        linked.bikeMarker.setOpacity(1);
      }
    }
    function clearCursor() {
      cursorLine.style.display = 'none';
      cursorDot.style.display = 'none';
      tooltipEl.style.display = 'none';
      const linked = window._gpxLinkedData;
      if (linked && linked.bikeMarker) linked.bikeMarker.setOpacity(0);
    }
    // Cleanup old listeners
    if (canvas._gpxMove) canvas.removeEventListener('mousemove', canvas._gpxMove);
    if (canvas._gpxLeave) canvas.removeEventListener('mouseleave', canvas._gpxLeave);
    canvas._gpxMove = onChartMove;
    canvas._gpxLeave = clearCursor;
    canvas.addEventListener('mousemove', onChartMove);
    canvas.addEventListener('mouseleave', clearCursor);

    // Double-clic → reset zoom + stats + retire highlight
    canvas.addEventListener('dblclick', () => {
      try { _gpxElevChart.resetZoom(); } catch (e) {}
      renderStats(computeStats(0, totalKm));
      highlightSegmentOnMap(null, null);
    });
  } catch (e) {
    console.warn('[renderGpxElevationChart]', e);
    canvas.parentNode.innerHTML = '<div class="modal-placeholder">Erreur de lecture du GPX</div>';
  }
}

// Helper qui attache le système de crosshair smooth (overlay canvas + interpolation)
// utilisé par les streams realised, sur n'importe quel chart Chart.js
function _attachSmoothCrosshair(chart) {
  if (!chart || !chart.canvas) return;
  const canvas = chart.canvas;
  const parent = canvas.parentNode;
  if (!parent) return;
  // Crée overlay si pas existant
  if (!chart._stOverlay) {
    const cs = getComputedStyle(parent);
    if (cs.position === 'static') parent.style.position = 'relative';
    const ov = document.createElement('canvas');
    ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
    parent.appendChild(ov);
    chart._stOverlay = ov;
    chart._stOverlayCtx = ov.getContext('2d');
    if (typeof _resizeOverlay === 'function') _resizeOverlay(chart);
  }
  // Réutilise _smoothMM / _smoothML déjà définis pour les streams realised
  if (!canvas._smoothMM) {
    canvas._smoothMM = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width) / (chart.currentDevicePixelRatio || window.devicePixelRatio || 1);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height) / (chart.currentDevicePixelRatio || window.devicePixelRatio || 1);
      const { left, right, top, bottom } = chart.chartArea;
      if (x < left || x > right || y < top || y > bottom) {
        if (typeof _smoothPendingX !== 'undefined') {
          _smoothPendingX = null;
          if (typeof _scheduleSmoothDraw === 'function') _scheduleSmoothDraw();
        }
        return;
      }
      if (typeof _smoothPendingX !== 'undefined') {
        _smoothPendingX = chart.scales.x.getValueForPixel(x);
        if (typeof _scheduleSmoothDraw === 'function') _scheduleSmoothDraw();
      }
    };
    canvas._smoothML = () => {
      if (typeof _smoothPendingX !== 'undefined') {
        _smoothPendingX = null;
        if (typeof _scheduleSmoothDraw === 'function') _scheduleSmoothDraw();
      }
    };
    canvas.addEventListener('mousemove', canvas._smoothMM);
    canvas.addEventListener('mouseleave', canvas._smoothML);
  }
}

// === Rendu d'une trace GPX sur une vraie carte Leaflet (OpenStreetMap) ===
let _gpxLeafletMap = null;
function renderGpxLeafletMap(gpxContent, divId) {
  const el = document.getElementById(divId);
  if (!el || !gpxContent || typeof L === 'undefined') return;
  // Cleanup map précédente
  if (_gpxLeafletMap) {
    try { _gpxLeafletMap.remove(); } catch (e) {}
    _gpxLeafletMap = null;
  }
  el.innerHTML = '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) {
      el.innerHTML = '<div class="modal-placeholder">Pas de points GPS dans le fichier GPX</div>';
      return;
    }
    const coords = [];
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      coords.push([lat, lon]);
    }
    if (!coords.length) {
      el.innerHTML = '<div class="modal-placeholder">Trace illisible</div>';
      return;
    }

    // Init la carte
    _gpxLeafletMap = L.map(el, {
      zoomControl: true,
      attributionControl: false,
    });

    // 1) Couche de base : hillshade ESRI subtil pour donner du relief
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      opacity: 0.6,
    }).addTo(_gpxLeafletMap);

    // 2) Couche principale : OSM standard quasi opaque → look propre, lisible
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      opacity: 0.88,
    }).addTo(_gpxLeafletMap);

    // Attribution discrète en bas à droite
    L.control.attribution({
      prefix: false,
      position: 'bottomright',
    }).addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · Relief © <a href="https://www.esri.com/" target="_blank">Esri</a>').addTo(_gpxLeafletMap);

    // Trace en double couche : contour noir épais en dessous + vert accent au-dessus
    L.polyline(coords, {
      color: '#000',
      weight: 8,
      opacity: 0.55,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(_gpxLeafletMap);
    const trace = L.polyline(coords, {
      color: '#4ade80',
      weight: 5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(_gpxLeafletMap);

    // === Flèches indiquant le sens du parcours ===
    // On en place une tous les ~N points (ajusté pour avoir 8-12 flèches au total)
    const arrowEvery = Math.max(20, Math.floor(coords.length / 10));
    function bearing(lat1, lon1, lat2, lon2) {
      const toRad = d => d * Math.PI / 180;
      const toDeg = r => r * 180 / Math.PI;
      const φ1 = toRad(lat1), φ2 = toRad(lat2);
      const Δλ = toRad(lon2 - lon1);
      const y = Math.sin(Δλ) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
      return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }
    // SVG d'une vraie flèche (tige + pointe), pointant vers le HAUT par défaut
    // Tige + tête → direction sans ambiguïté possible
    const arrowSvg = `<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2 L18 11 L14 11 L14 22 L10 22 L10 11 L6 11 Z"
            fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`;
    for (let i = arrowEvery; i < coords.length - 1; i += arrowEvery) {
      let prevIdx = i - 1, nextIdx = i + 1;
      while (prevIdx > 0 && Math.abs(coords[prevIdx][0] - coords[i][0]) < 0.0001 && Math.abs(coords[prevIdx][1] - coords[i][1]) < 0.0001) prevIdx--;
      while (nextIdx < coords.length - 1 && Math.abs(coords[nextIdx][0] - coords[i][0]) < 0.0001 && Math.abs(coords[nextIdx][1] - coords[i][1]) < 0.0001) nextIdx++;
      const angle = bearing(coords[prevIdx][0], coords[prevIdx][1], coords[nextIdx][0], coords[nextIdx][1]);
      const arrowIcon = L.divIcon({
        className: 'gpx-arrow',
        html: `<div class="gpx-arrow-wrap" style="transform:rotate(${angle}deg);">${arrowSvg}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      L.marker(coords[i], { icon: arrowIcon, interactive: false, keyboard: false }).addTo(_gpxLeafletMap);
    }

    // === Référence globale pour le curseur du profil → marker mobile sur la carte ===
    // Calcul du cumul de distance par point pour pouvoir mapper km → lat/lon
    const cumKmByIdx = [0];
    for (let i = 1; i < coords.length; i++) {
      cumKmByIdx.push(cumKmByIdx[i-1] + dist(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]));
    }
    const totalKm = cumKmByIdx[cumKmByIdx.length - 1];
    window._gpxLinkedData = { coords, cumKmByIdx, totalKm, map: _gpxLeafletMap };
    // Marker bike (caché par défaut)
    const bikeIcon = L.divIcon({
      className: 'gpx-bike-marker',
      html: `<div class="gpx-bike-dot"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const bikeMarker = L.marker(coords[0], { icon: bikeIcon, interactive: false, keyboard: false, opacity: 0 }).addTo(_gpxLeafletMap);
    window._gpxLinkedData.bikeMarker = bikeMarker;
    // Helper distance pour le linkage
    function dist(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }

    // Markers départ + arrivée (avec gestion boucle)
    const start = coords[0];
    const end = coords[coords.length - 1];
    const isLoop = Math.abs(start[0] - end[0]) < 0.0002 && Math.abs(start[1] - end[1]) < 0.0002;

    // Icônes custom : cercles colorés via DivIcon
    function makeIcon(color, label) {
      return L.divIcon({
        className: 'gpx-marker',
        html: `<div class="gpx-marker-dot" style="background:${color};"></div><div class="gpx-marker-label" style="color:${color};">${label}</div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
    }
    if (isLoop) {
      L.marker(start, { icon: makeIcon('#fbbf24', 'DÉPART / ARRIVÉE') }).addTo(_gpxLeafletMap);
    } else {
      L.marker(start, { icon: makeIcon('#4ade80', 'DÉPART') }).addTo(_gpxLeafletMap);
      L.marker(end, { icon: makeIcon('#ef4444', 'ARRIVÉE') }).addTo(_gpxLeafletMap);
    }

    // Cadre la vue sur la trace avec un peu de padding
    const bounds = trace.getBounds();
    _gpxLeafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });

    // Plusieurs invalidateSize + refit pour gérer le rendu différé de la modal
    // (la modal peut prendre du temps à atteindre sa taille finale après animation)
    const refit = () => {
      if (!_gpxLeafletMap) return;
      _gpxLeafletMap.invalidateSize(true);
      _gpxLeafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    };
    requestAnimationFrame(refit);
    setTimeout(refit, 150);
    setTimeout(refit, 400);
    setTimeout(refit, 800);
  } catch (e) {
    console.warn('[renderGpxLeafletMap]', e);
    el.innerHTML = '<div class="modal-placeholder">Erreur de lecture du GPX</div>';
  }
}

// === Rendu d'une trace GPX en SVG (parse le XML + projette lat/lon en path SVG) — legacy, conservé pour compat ===
function renderGpxTrack(gpxContent, svgId) {
  const svg = document.getElementById(svgId);
  if (!svg || !gpxContent) return;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    if (!trkpts.length) {
      // Fallback : essaye les routes (rtept) ou waypoints (wpt)
      const alts = doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt');
      if (!alts.length) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Aucun point GPS dans le fichier GPX</text>';
        return;
      }
    }
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    const coords = [];
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      coords.push([lat, lon]);
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    if (!coords.length) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Trace illisible</text>';
      return;
    }

    // Projection simple Mercator-like sur la bounding box
    const W = 900, H = 400, pad = 16;
    const lonRange = maxLon - minLon || 0.0001;
    const latRange = maxLat - minLat || 0.0001;
    const aspect = lonRange / latRange * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    let drawW, drawH;
    if (aspect * (H - 2 * pad) >= (W - 2 * pad)) {
      drawW = W - 2 * pad;
      drawH = drawW / aspect;
    } else {
      drawH = H - 2 * pad;
      drawW = drawH * aspect;
    }
    const offX = (W - drawW) / 2;
    const offY = (H - drawH) / 2;

    const path = coords.map((c, i) => {
      const x = offX + ((c[1] - minLon) / lonRange) * drawW;
      // y inversé (lat croissante vers le haut)
      const y = offY + (1 - (c[0] - minLat) / latRange) * drawH;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');

    const startX = offX + ((coords[0][1] - minLon) / lonRange) * drawW;
    const startY = offY + (1 - (coords[0][0] - minLat) / latRange) * drawH;
    const endX = offX + ((coords[coords.length-1][1] - minLon) / lonRange) * drawW;
    const endY = offY + (1 - (coords[coords.length-1][0] - minLat) / latRange) * drawH;

    // Détection de superposition (boucle) : si départ et arrivée sont proches (< 30px)
    const distPx = Math.hypot(endX - startX, endY - startY);
    const isLoop = distPx < 30;

    // Helper pour placer le label DÉPART/ARRIVÉE en évitant les bords
    function placeLabel(cx, cy, text, color, prefer = 'right') {
      const padX = 12, padY = 4;
      const approxW = text.length * 6.5 + 4; // largeur estimée
      let lx = cx + padX, ly = cy + padY;
      let anchor = 'start';
      // Si trop près du bord droit, place à gauche
      if (lx + approxW > W - 8) { lx = cx - padX; anchor = 'end'; }
      // Si trop près du bord haut, descend
      if (ly < 14) ly = cy + 16;
      // Si trop près du bord bas
      if (ly > H - 8) ly = cy - 10;
      return `<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="${color}" font-size="11" font-weight="700" stroke="#062017" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${text}</text>`;
    }

    let markersSvg;
    if (isLoop) {
      // Cercle unique mi-vert mi-rouge + label combiné
      markersSvg = `
        <circle cx="${startX}" cy="${startY}" r="7" fill="#4ade80" stroke="#062017" stroke-width="2"/>
        <path d="M ${startX - 7} ${startY} A 7 7 0 0 1 ${startX + 7} ${startY} Z" fill="#ef4444" stroke="#062017" stroke-width="0"/>
        <circle cx="${startX}" cy="${startY}" r="7" fill="none" stroke="#062017" stroke-width="2"/>
        ${placeLabel(startX, startY, 'DÉPART / ARRIVÉE', '#fbbf24')}
      `;
    } else {
      markersSvg = `
        <circle cx="${startX}" cy="${startY}" r="6" fill="#4ade80" stroke="#062017" stroke-width="2"/>
        ${placeLabel(startX, startY, 'DÉPART', '#4ade80')}
        <circle cx="${endX}" cy="${endY}" r="6" fill="#ef4444" stroke="#062017" stroke-width="2"/>
        ${placeLabel(endX, endY, 'ARRIVÉE', '#ef4444')}
      `;
    }

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="gpxGrad-${svgId}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#4ade80"/>
          <stop offset="100%" stop-color="#22c55e"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="rgba(74,222,128,0.03)" rx="8"/>
      <path d="${path}" stroke="url(#gpxGrad-${svgId})" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      ${markersSvg}
    `;
  } catch (e) {
    console.warn('[renderGpxTrack] erreur de parsing :', e);
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Erreur de lecture du GPX</text>';
  }
}

function openSessionModal(iso, source) {
  // Reconstruire la date depuis l'iso (les jours futurs ne sont PAS dans data)
  const date = new Date(iso + 'T12:00:00');
  if (isNaN(date.getTime())) return;
  const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Lookup data uniquement pour le mode Réalisé (les jours futurs ne sont pas dedans)
  const day = data.find(d => toIsoDate(d.date) === iso);

  const titleEl = document.getElementById('modal-title');
  const metaEl = document.getElementById('modal-meta');
  const bodyEl = document.getElementById('modal-body');

  // Cache les boutons d'action par défaut (seront ré-affichés au besoin)
  const _editBtn = document.getElementById('modal-edit-btn');
  const _delBtn = document.getElementById('modal-delete-btn');
  if (_editBtn) {
    _editBtn.hidden = true;
    // Reset des datasets (évite de garder l'état du précédent appel)
    delete _editBtn.dataset.compId;
    delete _editBtn.dataset.trainingId;
    delete _editBtn.dataset.trainingMode;
    delete _editBtn.dataset.templateIso;
    delete _editBtn.dataset.kind;
  }
  if (_delBtn) {
    _delBtn.hidden = true;
    delete _delBtn.dataset.compId;
    delete _delBtn.dataset.trainingId;
    delete _delBtn.dataset.trainingMode;
    delete _delBtn.dataset.activityId;
    delete _delBtn.dataset.kind;
  }

  if (source === 'realise') {
    if (!day) {
      titleEl.innerHTML = 'Aucune donnée';
      metaEl.textContent = dateStr;
      bodyEl.innerHTML = '<div class="modal-placeholder">Pas de données pour ce jour.</div>';
      document.getElementById('session-modal').classList.add('active');
      return;
    }
    // Activités RÉELLES de ce jour
    const acts = day.activities && day.activities.length ? day.activities : (day.sessionType ? [day] : []);
    if (acts.length === 0) {
      titleEl.innerHTML = 'Pas de séance';
      metaEl.textContent = dateStr;
      bodyEl.innerHTML = '<div class="modal-placeholder">Aucune activité enregistrée ce jour-là.</div>';
    } else {
      let currentIdx = 0;
      function renderModalActivity(idx) {
        currentIdx = idx;
        const act = acts[idx];
        // Boutons d'action : seulement pour les activités manuelles (Strava est read-only)
        const _editBtn2 = document.getElementById('modal-edit-btn');
        const _delBtn2 = document.getElementById('modal-delete-btn');
        if (act._manual) {
          if (_editBtn2) {
            _editBtn2.hidden = false;
            _editBtn2.dataset.kind = 'training';
            _editBtn2.dataset.trainingId = act._manualId || act.id;
            _editBtn2.dataset.trainingMode = 'realise';
          }
          if (_delBtn2) {
            _delBtn2.hidden = false;
            _delBtn2.dataset.kind = 'training';
            _delBtn2.dataset.trainingId = act._manualId || act.id;
            _delBtn2.dataset.trainingMode = 'realise';
          }
        } else {
          // Activité Strava : pas modifiable (source de vérité). Mais on offre "Masquer" via delete.
          if (_editBtn2) _editBtn2.hidden = true;
          if (_delBtn2) {
            _delBtn2.hidden = false;
            _delBtn2.dataset.kind = 'strava';
            _delBtn2.dataset.activityId = String(act.id || act.activityId || '');
          }
        }
        const dur = act.duration || 0;
        const h = Math.floor(dur / 60);
        const m = (dur % 60).toString().padStart(2, '0');
        titleEl.innerHTML = `${act.name || act.sessionName || 'Séance'} ${act.type || act.sessionType ? `<span class="pill ${act.type || act.sessionType}">${act.type || act.sessionType}</span>` : ''}`;
        // Nom de sport Strava exact + clé couleur pour la pill
        const sportLabel = window.activitySportLabel(act);
        const sportCat = window.activitySportColorKey ? window.activitySportColorKey(act) : 'autre';
        const sportPill = sportLabel
          ? `<span class="sport-pill" data-sport-cat="${sportCat}" style="margin-left:8px;vertical-align:middle;">${sportLabel}</span>`
          : '';
        // Heure de début depuis start_date_local (format ISO local)
        let startTime = '';
        if (act.start_date_local) {
          const m = act.start_date_local.match(/T(\d{2}):(\d{2})/);
          if (m) startTime = `${m[1]}h${m[2]}`;
        }
        const textParts = [dateStr];
        if (startTime) textParts.push(startTime);
        metaEl.innerHTML = textParts.join(' · ') + sportPill;

        const switchHTML = acts.length > 1 ? `
          <div class="modal-activity-switch">
            ${acts.map((a, i) => `<button class="${i === idx ? 'active' : ''}" data-i="${i}">${a.name || 'Séance'} (${a.tss || 0} TSS)</button>`).join('')}
          </div>` : '';

        // Palettes vertes : 5 nuances pour FC, 7 pour Puissance (Coggan)
        const zoneColorsHR = ['#bbf7d0','#86efac','#4ade80','#16a34a','#14532d'];
        const zoneColorsPow = ['#dcfce7','#bbf7d0','#86efac','#4ade80','#22c55e','#15803d','#14532d'];
        // Plages
        const ftp = (window._athleteMeta && window._athleteMeta.ftp) || 250;
        const hrMax = (window._athleteMeta && window._athleteMeta.hr_max) || (act.max_hr ? Math.max(act.max_hr, 185) : 190);
        // 6 seuils pour 7 zones Coggan : 55/75/90/105/120/150% FTP
        const pZ = [
          Math.round(ftp*0.55), Math.round(ftp*0.75), Math.round(ftp*0.90),
          Math.round(ftp*1.05), Math.round(ftp*1.20), Math.round(ftp*1.50)
        ];
        // 4 seuils pour 5 zones FC : 60/70/80/90% HRmax
        const hZ = [Math.round(hrMax*0.60), Math.round(hrMax*0.70), Math.round(hrMax*0.80), Math.round(hrMax*0.90)];

        // Calcule la répartition % de temps dans chaque zone à partir d'un stream
        // N zones = thresholds.length + 1
        function computeZonesFromStream(values, thresholds) {
          if (!values || !values.length) return null;
          const counts = new Array(thresholds.length + 1).fill(0);
          let total = 0;
          for (const v of values) {
            if (v == null || isNaN(v) || v <= 0) continue;
            total++;
            let placed = false;
            for (let i = 0; i < thresholds.length; i++) {
              if (v < thresholds[i]) { counts[i]++; placed = true; break; }
            }
            if (!placed) counts[thresholds.length]++;
          }
          if (total === 0) return null;
          return counts.map(c => +(c / total * 100).toFixed(1));
        }

        // Récupère les streams en cache si dispo et calcule les zones cohérentes avec les labels
        let zonesHRComputed = null, zonesPowComputed = null;
        try {
          const aid = act.id || act.activityId || day.activityId;
          const cached = aid && window.STREAMS_CACHE ? window.STREAMS_CACHE[String(aid)] : null;
          if (cached && Array.isArray(cached)) {
            let hrData = null, wattsData = null;
            for (const s of cached) {
              if (s.type === 'heartrate') hrData = s.data;
              else if (s.type === 'watts') wattsData = s.data;
            }
            if (hrData) zonesHRComputed = computeZonesFromStream(hrData, hZ);
            if (wattsData) zonesPowComputed = computeZonesFromStream(wattsData, pZ);
          }
        } catch (e) { /* fallback sur les zones de l'API */ }
        // Labels affichés au centre du donut au hover (avec plage bpm/watts)
        const hrCenterLabels = [
          `Z1 (<${hZ[0]})`,
          `Z2 (${hZ[0]}-${hZ[1]})`,
          `Z3 (${hZ[1]}-${hZ[2]})`,
          `Z4 (${hZ[2]}-${hZ[3]})`,
          `Z5 (>${hZ[3]})`
        ];
        const powCenterLabels = [
          `Z1 (<${pZ[0]}w)`,
          `Z2 (${pZ[0]}-${pZ[1]}w)`,
          `Z3 (${pZ[1]}-${pZ[2]}w)`,
          `Z4 (${pZ[2]}-${pZ[3]}w)`,
          `Z5 (${pZ[3]}-${pZ[4]}w)`,
          `Z6 (${pZ[4]}-${pZ[5]}w)`,
          `Z7 (>${pZ[5]}w)`
        ];
        // Labels affichés dans la légende sous le donut (noms de zone)
        const hrNameLabels = ['Z1 récup','Z2 endurance','Z3 tempo','Z4 seuil','Z5 VO2max'];
        const powNameLabels = ['Z1 récup','Z2 endurance','Z3 tempo','Z4 seuil','Z5 VO2max','Z6 anaérobie','Z7 neuromusc.'];
        const zonesHR = zonesHRComputed || act.zones_hr || (act.zones && !act.zones_power ? act.zones : null);
        const zonesPow = zonesPowComputed || act.zones_power || null;
        const hasAnyZones = !!(zonesHR || zonesPow);
        const cols = (zonesHR && zonesPow) ? '1fr 1fr' : '1fr';
        const zonesHTML = hasAnyZones ? `
          <div class="modal-section">
            <div class="modal-section-title">Répartition par zones</div>
            <div style="display:grid;grid-template-columns:${cols};gap:20px;">
              ${zonesHR ? `<div style="text-align:center;min-width:0;">
                <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Zones FC</div>
                <div style="position:relative;height:180px;width:100%;"><canvas id="modal-zones-hr"></canvas></div>
                <div id="legend-zones-hr" style="display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:4px 10px;padding-top:8px;height:46px;font-size:10px;color:var(--text-dim);"></div>
              </div>` : ''}
              ${zonesPow ? `<div style="text-align:center;min-width:0;">
                <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Zones Puissance</div>
                <div style="position:relative;height:180px;width:100%;"><canvas id="modal-zones-power"></canvas></div>
                <div id="legend-zones-power" style="display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:4px 10px;padding-top:8px;height:46px;font-size:10px;color:var(--text-dim);"></div>
              </div>` : ''}
            </div>
          </div>` : '';

        // === Helpers pour bâtir les sections ===
        const card = (label, value, unit, sub) =>
          `<div class="modal-metric" style="text-align:center;">
             <div class="m-label">${label}</div>
             <div class="m-value">${value}${unit ? `<span style="font-size:14px;"> ${unit}</span>` : ''}</div>
             ${sub ? `<div class="m-sub">${sub}</div>` : ''}
           </div>`;
        const section = (title, cards) => {
          const filled = cards.filter(Boolean);
          if (filled.length === 0) return '';
          return `<div class="modal-section">
            <div class="modal-section-title">${title}</div>
            <div class="modal-metrics">${filled.join('')}</div>
          </div>`;
        };
        const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

        // --- 1. Synthèse : durée / distance / dénivelé / vitesse / TSS ---
        // Élapsed (h/m) depuis elapsed_time en secondes
        let elapsedSub = '';
        if (act.elapsed_time && act.elapsed_time > (act.moving_time || 0)) {
          const eh = Math.floor(act.elapsed_time / 3600);
          const em = Math.floor((act.elapsed_time % 3600) / 60).toString().padStart(2, '0');
          elapsedSub = `Élapsed ${eh}h${em}`;
        }
        const vMaxToShow = act.max_speed_smooth_kmh || act.max_speed_kmh;
        const syntheseHTML = section('Synthèse', [
          card('Durée', `${h}<span style="font-size:14px;">h</span>${m}`, '', elapsedSub),
          act.distance_km && card('Distance', act.distance_km, 'km'),
          act.elevation_gain && card('Dénivelé +', act.elevation_gain, 'm',
            act.elevation_loss ? `D− ${act.elevation_loss} m` : ''),
          act.avg_speed_kmh && card('Vitesse moy', act.avg_speed_kmh, 'km/h',
            vMaxToShow ? `Max ${vMaxToShow} km/h` : ''),
          act.tss && card('TSS', act.tss, ''),
        ]);

        // --- 2. Puissance & FC : 4 cards moy/max sur une ligne ---
        const puissanceFcHTML = section('Puissance & FC', [
          act.avg_watts && card('Puissance moy', act.avg_watts, 'W'),
          act.max_watts && card('Puissance max', act.max_watts, 'W'),
          act.hr && card('FC moy', act.hr, 'bpm'),
          act.max_hr && card('FC max', act.max_hr, 'bpm'),
        ]);

        // --- 3. Effort (intensité, énergie, cadence) ---
        const effortHTML = section('Effort', [
          act.np && card('NP', act.np, 'W',
            `IF ${act.intensity || '—'} · ${act.ftpPct || 0}% FTP`),
          act.cadence && card('Cadence', act.cadence, 'rpm',
            act.max_cadence ? `Max ${act.max_cadence} rpm` : ''),
          act.kj && card('Énergie', act.kj, 'kJ',
            act.calories ? `${act.calories} kcal` : ''),
        ]);

        // Section Cardio supprimée (intégrée à Puissance & FC)
        const cardioHTML = '';

        // Section Mouvement supprimée (intégrée à Synthèse + Effort)
        const mouvementHTML = '';

        // --- Lien Strava ---
        const aId = act.id || act.activityId || day.activityId;
        // Strava utilise des IDs numériques. On retire un préfixe "s" éventuel.
        const stravaId = aId ? String(aId).replace(/^s/, '').replace(/^i/, '') : '';
        const intervalsLink = stravaId && /^\d+$/.test(stravaId) ? `
          <a href="https://www.strava.com/activities/${stravaId}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;background:rgba(252,76,2,0.12);border:1px solid rgba(252,76,2,0.3);color:#fc5200;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500;">
            Voir le détail complet sur Strava ↗
          </a>
          <div style="font-size:11px;color:var(--text-mute);margin-top:6px;">ID activité : <code>${stravaId}</code></div>
        ` : '';

        bodyEl.innerHTML = `
          ${switchHTML}
          ${syntheseHTML}
          ${puissanceFcHTML}
          ${effortHTML}
          ${cardioHTML}
          ${mouvementHTML}
          ${zonesHTML}
          <div class="modal-section">
            <div class="modal-section-title">Graphique</div>
            <div id="streams-section"></div>
          </div>
          <div class="modal-section">
            <div class="modal-section-title">Lien activité</div>
            ${intervalsLink || '<div class="modal-placeholder">Pas d\'ID Strava disponible pour cette activité.</div>'}
          </div>
        `;
        // Wire switch buttons (avant le chargement async des streams)
        bodyEl.querySelectorAll('.modal-activity-switch button').forEach(btn => {
          btn.addEventListener('click', () => renderModalActivity(+btn.dataset.i));
        });

        // Camemberts des zones FC / Puissance — defer pour laisser le layout se calculer
        setTimeout(() => {
          // Durée totale (minutes) pour calculer le temps passé dans chaque zone
          const totalMin = act.duration || 0;
          const fmtTime = (totalSec) => {
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = Math.floor(totalSec % 60);
            if (h > 0) return `${h}h${m.toString().padStart(2,'0')}`;
            if (m > 0) return `${m}m${s.toString().padStart(2,'0')}`;
            return `${s}s`;
          };

          // Plugin texte central : %, temps passé, label centré (avec plage)
          const centerTextPlugin = {
            id: 'centerText',
            afterDraw(chart) {
              const idx = chart._hoveredIdx;
              if (idx == null) return;
              const ds = chart.data.datasets[0];
              const pct = ds.data[idx];
              // Si le chart a des labels custom pour le centre, les utilise, sinon fallback labels
              const label = (chart._centerLabels && chart._centerLabels[idx]) || chart.data.labels[idx];
              const timeSec = (pct / 100) * totalMin * 60;
              const { ctx, chartArea } = chart;
              const cx = (chartArea.left + chartArea.right) / 2;
              const cy = (chartArea.top + chartArea.bottom) / 2;
              ctx.save();
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              // % en gros
              ctx.fillStyle = ds.backgroundColor[idx];
              ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
              ctx.fillText(pct.toFixed(1) + '%', cx, cy - 14);
              // Temps passé
              ctx.fillStyle = 'var(--text)'; ctx.fillStyle = '#e6e9ef';
              ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
              ctx.fillText(fmtTime(timeSec), cx, cy + 6);
              // Nom de zone (plus petit pour ne pas déborder)
              ctx.fillStyle = 'rgba(230,233,239,0.6)';
              ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
              ctx.fillText(label, cx, cy + 22);
              ctx.restore();
            }
          };

          const doughnutOpts = () => ({
            responsive: true, maintainAspectRatio: false,
            radius: '85%',
            plugins: {
              legend: { display: false }, // remplacée par légende HTML custom (hauteur fixe)
              tooltip: { enabled: false },
              verticalHoverLine: false
            },
            cutout: '62%',
            animation: { duration: 0 },
            interaction: { mode: 'nearest', intersect: true },
            transitions: {
              active: { animation: { duration: 200, easing: 'easeOutCubic' } }
            },
            onHover: (e, els, chart) => {
              const newIdx = (els && els.length) ? els[0].index : null;
              if (newIdx === chart._hoveredIdx) return;
              chart._hoveredIdx = newIdx;
              chart.setActiveElements(newIdx != null ? [{ datasetIndex: 0, index: newIdx }] : []);
              chart.update();
            }
          });
          // hoverOffset doit être sur le dataset en Chart.js v4
          const makeDataset = (data, colors) => ({
            data,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 18,
            hoverBorderWidth: 0
          });
          // Helper : crée un donut + attache un listener mouseleave pour bien reset
          function makeDonut(canvasId, data, legendLabels, centerLabels, colors) {
            const cv = document.getElementById(canvasId);
            if (!cv) return null;
            const chart = new Chart(cv, {
              type: 'doughnut',
              data: { labels: legendLabels, datasets: [makeDataset(data, colors)] },
              options: doughnutOpts(),
              plugins: [centerTextPlugin]
            });
            chart._centerLabels = centerLabels;
            cv.addEventListener('mouseleave', () => {
              if (chart._hoveredIdx != null) {
                chart._hoveredIdx = null;
                chart.setActiveElements([]);
                chart.update();
              }
            });
            return chart;
          }
          // Helper : génère la légende HTML correspondante
          function fillLegend(elId, names, colors) {
            const el = document.getElementById(elId);
            if (!el) return;
            el.innerHTML = names.map((n, i) =>
              `<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">
                <span style="width:9px;height:9px;background:${colors[i]};border-radius:2px;display:inline-block;"></span>${n}
              </span>`
            ).join('');
          }

          if (zonesHR) {
            const c = makeDonut('modal-zones-hr', zonesHR, hrNameLabels, hrCenterLabels, zoneColorsHR);
            if (c) _modalCharts.push(c);
            fillLegend('legend-zones-hr', hrNameLabels, zoneColorsHR);
          }
          if (zonesPow) {
            const is7 = zonesPow.length === 7;
            const powNames = is7 ? powNameLabels : ['Z1 récup','Z2 endurance','Z3 tempo','Z4 seuil','Z5 VO2max'];
            const powCenters = is7 ? powCenterLabels : [
              `Z1 (<${pZ[0]}w)`,
              `Z2 (${pZ[0]}-${pZ[1]}w)`,
              `Z3 (${pZ[1]}-${pZ[2]}w)`,
              `Z4 (${pZ[2]}-${pZ[3]}w)`,
              `Z5 (>${pZ[3]}w)`
            ];
            const powColors = is7 ? zoneColorsPow : zoneColorsHR;
            const c = makeDonut('modal-zones-power', zonesPow, powNames, powCenters, powColors);
            if (c) _modalCharts.push(c);
            fillLegend('legend-zones-power', powNames, powColors);
          }
        }, 0);
        // Lancer le chargement des streams en async (la modal est déjà visible)
        const streamId = act.id || act.activityId || day.activityId;
        if (streamId) {
          renderStreamsSection(document.getElementById('streams-section'), streamId);
        } else {
          document.getElementById('streams-section').innerHTML = '<div class="modal-placeholder">Pas d\'ID activité disponible pour cette séance.</div>';
        }
      }
      renderModalActivity(0);
    }
  } else {
    // ============= Source = 'prevu' =============
    const compsAll = loadCompetitionsExpanded().map(c => ({ ...c, dateObj: new Date(c.date + 'T12:00:00') }));
    const compsForToday = compsAll.filter(c => toIsoDate(c.dateObj) === iso);
    const manualTrainings = (typeof loadTrainings === 'function') ? loadTrainings() : [];
    const manualForToday = manualTrainings.filter(t => t.date === iso);

    // === Items affichables sur la day card (source de vérité pour la sélection clavier/flèches) ===
    // L'ordre DOIT correspondre à la day card : compsForToday + manualForToday
    const dayItems = [];
    compsForToday.forEach(c => dayItems.push({ kind: 'comp', data: c }));
    manualForToday.forEach(t => dayItems.push({ kind: 'manual', data: t }));

    // Item sélectionné par l'utilisateur via les flèches du calendrier
    let dayCurIdx = dayPrevuIndex[iso] || 0;
    if (dayCurIdx >= dayItems.length) dayCurIdx = 0;
    const selectedItem = dayItems[dayCurIdx] || null;

    // Build la liste d'items finale (avec enrichissement étapes si applicable)
    // - Si l'item sélectionné est une étape de stage race : enrichit avec TOUTES les étapes
    //   du parent pour permettre la navigation entre étapes via le switcher de la modal
    // - Sinon : la liste = items du jour
    const items = [];
    let curIdx = 0;
    if (selectedItem && selectedItem.kind === 'comp' && selectedItem.data.parentId) {
      const stageRaceItems = compsAll
        .filter(c => c.parentId === selectedItem.data.parentId)
        .sort((a, b) => (a.stageIdx || 0) - (b.stageIdx || 0));
      stageRaceItems.forEach(c => items.push({ kind: 'comp', data: c }));
      // Insère les autres items du jour (compés non-stage + manuels) qui ne sont pas déjà dedans
      dayItems.forEach(it => {
        if (it.kind !== 'comp' || it.data.parentId !== selectedItem.data.parentId) {
          items.push(it);
        }
      });
      // Trouve l'étape correspondant à l'item sélectionné
      const idx = items.findIndex(it => it.kind === 'comp' && it.data.id === selectedItem.data.id);
      curIdx = idx >= 0 ? idx : 0;
    } else if (dayItems.length > 0) {
      dayItems.forEach(it => items.push(it));
      curIdx = dayCurIdx;
    } else {
      // Rien d'explicite : item template AI seul
      // IMPORTANT : on doit suivre EXACTEMENT la même logique que renderPlanned (day card)
      // sinon la modal contredit ce qui est affiché sur la carte.
      const _isForcedRest = (typeof isTemplateRestDay === 'function') && isTemplateRestDay(iso);
      const dayPhase = determinePhaseForDate(compsAll, date, todayData.tsb);
      const dow = date.getDay();
      // Détermine si c'est aujourd'hui (compare iso à la date locale du jour)
      const _todayIso = toIsoDate(new Date());
      const _isToday = iso === _todayIso;
      const tmpl = _isForcedRest
        ? { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Repos forcé (override utilisateur)' }
        : PLAN_TEMPLATES[dayPhase][dow];
      let proposal = { ...tmpl };
      if (_isToday && !_isForcedRest) proposal = adjustForRecovery(proposal, todayData.recovery);
      items.push({ kind: 'template', data: proposal, phase: dayPhase });
      curIdx = 0;
    }
    if (curIdx >= items.length) curIdx = 0;

    function renderPrevuItem(idx) {
      curIdx = idx;
      const item = items[idx];
      // Mise à jour de la date affichée si l'item est une étape sur une autre date
      let effectiveDateStr = dateStr;
      if (item.kind === 'comp' && item.data.date && item.data.date !== iso) {
        const d2 = new Date(item.data.date + 'T12:00:00');
        if (!isNaN(d2.getTime())) {
          effectiveDateStr = d2.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }
      }
      const switchHTML = items.length > 1 ? `
        <div class="modal-activity-switch">
          ${items.map((it, i) => {
            const label = it.kind === 'comp'
              ? (it.data.stageIdx !== undefined ? `Étape ${it.data.stageIdx + 1}` : it.data.name.split(' — ')[0])
              : (it.kind === 'manual' ? it.data.name : 'IA');
            return `<button class="${i === idx ? 'active' : ''}" data-i="${i}">${label}</button>`;
          }).join('')}
        </div>` : '';

      if (item.kind === 'comp') {
        renderCompModal(item.data, switchHTML, effectiveDateStr);
      } else if (item.kind === 'manual') {
        renderManualTrainingModal(item.data, switchHTML, effectiveDateStr);
      } else {
        renderTemplateModal(item.data, item.phase, switchHTML, effectiveDateStr);
      }
    }

    function renderCompModal(c, switchHTML, dateStrOverride) {
      const _dateStr = dateStrOverride || dateStr;
      const isStage = c.stageIdx !== undefined && c.totalStages;
      // Affiche les boutons "Modifier" et "Supprimer" pour cette compé
      const editBtn = document.getElementById('modal-edit-btn');
      const delBtn = document.getElementById('modal-delete-btn');
      if (editBtn) {
        editBtn.hidden = false;
        editBtn.dataset.kind = 'comp';
        editBtn.dataset.compId = c.parentId || c.id;
      }
      if (delBtn) {
        delBtn.hidden = false;
        delBtn.dataset.kind = 'comp';
        delBtn.dataset.compId = c.parentId || c.id;
      }
      const parentName = isStage ? c.name.replace(/ — Étape \d+$/, '') : c.name;
      const sportLabel = window.sportFr(c.sport || 'Ride');
      const sportCat = window.activitySportColorKey({ sport: c.sport }) || 'autre';
      const sportPill = `<span class="sport-pill" data-sport-cat="${sportCat}" style="margin-left:10px;vertical-align:middle;">${sportLabel}</span>`;

      // Title : juste le nom de la course (pas le numéro d'étape — déjà visible dans le switcher + section dédiée)
      titleEl.innerHTML = `🏁 ${parentName}`;

      // Meta : date + heure + sport pill
      const timeStr = c.time ? ` · ${c.time.replace(':', 'h')}` : '';
      metaEl.innerHTML = `${_dateStr}${timeStr}${sportPill}`;

      // Parse target → minutes
      let raceMinutes = null;
      if (c.target) {
        const m = c.target.match(/(\d+)\s*h\s*(\d{0,2})/i);
        if (m) raceMinutes = parseInt(m[1], 10) * 60 + (parseInt(m[2], 10) || 0);
      }

      // Calcule l'allure si km + target dispo (adapté au sport)
      let allure = null, allureLabel = 'Allure';
      if (c.km && raceMinutes) {
        const hours = raceMinutes / 60;
        const cyclingSports = ['Ride','VirtualRide','GravelRide','EBikeRide','MountainBikeRide','EMountainBikeRide','Velomobile','Handcycle'];
        const runSports = ['Run','TrailRun','VirtualRun'];
        const swimSports = ['Swim','OpenWaterSwim'];
        if (cyclingSports.includes(c.sport)) {
          allure = (c.km / hours).toFixed(1) + ' km/h';
        } else if (runSports.includes(c.sport)) {
          const minPerKm = raceMinutes / c.km;
          const mm = Math.floor(minPerKm);
          const ss = Math.round((minPerKm - mm) * 60);
          allure = `${mm}'${ss.toString().padStart(2,'0')}"/km`;
        } else if (swimSports.includes(c.sport)) {
          const minPer100m = (raceMinutes / c.km) / 10;
          const mm = Math.floor(minPer100m);
          const ss = Math.round((minPer100m - mm) * 60);
          allure = `${mm}'${ss.toString().padStart(2,'0')}"/100m`;
        } else {
          allure = (c.km / hours).toFixed(1) + ' km/h';
        }
      }

      // Si GPX présent : on override km / D+ avec les valeurs calculées depuis le fichier
      // (priorité au GPX → vérité terrain — sinon valeurs saisies manuellement)
      // Si nombre de tours défini, on multiplie km/D+/D- par le nombre de tours
      const lapsCount = parseInt(c.laps, 10) || 1;
      const gpxStats = c.gpxContent ? (typeof extractGpxStats === 'function' ? extractGpxStats(c.gpxContent, lapsCount) : null) : null;
      const effectiveKm = (gpxStats && gpxStats.km) || c.km;
      const effectiveDplus = (gpxStats && gpxStats.dplus) || c.dplus;
      // Recalcule l'allure si km vient du GPX
      if (gpxStats && gpxStats.km && raceMinutes) {
        const hours = raceMinutes / 60;
        const cyclingSports = ['Ride','VirtualRide','GravelRide','EBikeRide','MountainBikeRide','EMountainBikeRide','Velomobile','Handcycle'];
        const runSports = ['Run','TrailRun','VirtualRun'];
        const swimSports = ['Swim','OpenWaterSwim'];
        if (cyclingSports.includes(c.sport)) {
          allure = (gpxStats.km / hours).toFixed(1) + ' km/h';
        } else if (runSports.includes(c.sport)) {
          const minPerKm = raceMinutes / gpxStats.km;
          const mm = Math.floor(minPerKm);
          const ss = Math.round((minPerKm - mm) * 60);
          allure = `${mm}'${ss.toString().padStart(2,'0')}"/km`;
        } else if (swimSports.includes(c.sport)) {
          const minPer100m = (raceMinutes / gpxStats.km) / 10;
          const mm = Math.floor(minPer100m);
          const ss = Math.round((minPer100m - mm) * 60);
          allure = `${mm}'${ss.toString().padStart(2,'0')}"/100m`;
        } else {
          allure = (gpxStats.km / hours).toFixed(1) + ' km/h';
        }
      }

      // Ordre demandé : Temps cible → Distance → Dénivelé → Allure
      // Type d'épreuve en titre texte. Tours en complément.
      const cards = [];
      if (c.target) cards.push({ label: 'Temps cible', value: c.target, unit: '' });
      if (effectiveKm != null) cards.push({ label: 'Distance', value: effectiveKm, unit: 'km' });
      // Si GPX → D+ visible dans la barre stats du profil → on ne le montre pas en gros
      if (effectiveDplus != null && !gpxStats) cards.push({ label: 'Dénivelé +', value: effectiveDplus, unit: 'm' });
      if (allure) cards.push({ label: allureLabel, value: allure });
      if (c.laps != null) cards.push({ label: 'Tours', value: c.laps, unit: '' });

      // Sections détaillées
      const sections = [];
      // Section GPX : si content présent → profil d'altitude + trace en grand
      if (c.gpxContent) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Profil d'altitude</div>
          <div class="gpx-stats-row" id="gpx-stats-row-prevu"></div>
          <div class="gpx-elev-wrap" id="gpx-elev-wrap-prevu" style="margin-bottom:14px;">
            <canvas id="gpx-elev-canvas-prevu"></canvas>
            <div class="gpx-elev-tooltip" id="gpx-elev-tooltip-prevu" style="display:none;"></div>
          </div>
          <div class="modal-section-title">Tracé du parcours</div>
          <div class="gpx-map-wrap"><div class="gpx-leaflet" id="gpx-leaflet-prevu"></div></div>
        </div>`);
      } else if (c.gpxName) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Trace GPX</div>
          <div class="modal-info-box">📍 <strong>${c.gpxName}</strong></div>
        </div>`);
      }
      if (c.notes) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Notes / Stratégie</div>
          <div class="modal-info-box" style="white-space:pre-wrap;">${escapeHtml(c.notes)}</div>
        </div>`);
      }
      // Section "Segments" : la liste des segments AJOUTÉS manuellement par l'utilisateur
      // (via drag-select + bouton "Ajouter segment")
      if (c.gpxContent) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Segments</div>
          <div class="climbs-list" id="gpx-segments-list"></div>
        </div>`);
        window._gpxClimbContent = c.gpxContent;
        window._gpxCurrentCompId = c.parentId || c.id;
      }

      // Titre "Type d'épreuve" au-dessus des cards
      const typeTitle = c.type
        ? `<div class="modal-section-title" style="margin-bottom:12px;font-size:18px;color:var(--text);text-transform:none;letter-spacing:0;">${c.type}</div>`
        : '';
      bodyEl.innerHTML = `
        ${switchHTML}
        ${typeTitle}
        <div class="modal-metrics">
          ${cards.map(card => `<div class="modal-metric${card.accent ? ' accent' : ''}"><div class="m-label">${card.label}</div><div class="m-value" style="${card.isText ? 'font-size:16px;' : ''}">${card.value}${card.unit ? `<span style="font-size:13px;font-weight:500;margin-left:2px;">${card.unit}</span>` : ''}</div></div>`).join('')}
        </div>
        ${sections.join('')}
      `;
      wireSwitchButtons();
      // Rendu GPX si présent : profil altitude Chart.js + tracé Leaflet
      if (c.gpxContent) {
        renderGpxElevationChart(c.gpxContent, 'gpx-elev-canvas-prevu', lapsCount);
        renderGpxLeafletMap(c.gpxContent, 'gpx-leaflet-prevu');
        wireClimbsList();
      }
    }

    // === SEGMENTS UTILISATEUR (exposés sur window pour le bouton du chart) ===
    window._gpxSegKey = (compId) => `coach_ia_gpx_segments_${compId || 'global'}`;
    window.gpxLoadSegments = (compId) => {
      try {
        const raw = localStorage.getItem(window._gpxSegKey(compId));
        if (!raw) return [];
        return JSON.parse(raw);
      } catch (e) { return []; }
    };
    window.gpxSaveSegments = (compId, arr) => {
      localStorage.setItem(window._gpxSegKey(compId), JSON.stringify(arr));
    };
    window.gpxRenderSegmentsList = () => {
      const list = document.getElementById('gpx-segments-list');
      if (!list) return;
      const compId = window._gpxCurrentCompId;
      const segs = window.gpxLoadSegments(compId);
      if (segs.length === 0) {
        list.innerHTML = `<div class="comp-empty" style="padding:14px;">Sélectionne une portion du profil pour créer un segment.</div>`;
        return;
      }
      list.innerHTML = segs.map((s, i) => {
        const cat = s.gain >= 1000 ? 'HC' : s.gain >= 600 ? '1' : s.gain >= 300 ? '2' : s.gain >= 150 ? '3' : '4';
        return `<div class="climb-item" data-seg-idx="${i}">
          <div class="climb-row">
            <div class="climb-cat cat-${cat}">${cat}</div>
            <div class="climb-info">
              <div class="climb-range">${s.name || `Segment ${i + 1}`}</div>
              <div class="climb-meta">km ${s.startKm.toFixed(1)} → ${s.endKm.toFixed(1)} · ${s.distKm.toFixed(2)} km · D+ ${Math.round(s.gain)} m · ${s.avgSlope.toFixed(1)}% moy. · ${s.maxSlope.toFixed(1)}% max</div>
            </div>
            <button class="seg-del-btn" data-seg-del="${i}" title="Supprimer">×</button>
            <div class="climb-chevron">▼</div>
          </div>
          <div class="climb-detail" hidden></div>
        </div>`;
      }).join('');
    };
    window.gpxAddCurrentSelectionAsSegment = async () => {
      const sel = window._gpxCurrentSelectionStats;
      if (!sel) {
        await appAlert({
          title: 'Aucune sélection',
          message: 'Sélectionne d\'abord une portion du profil d\'altitude (glisse sur le graphique).',
        });
        return;
      }
      const compId = window._gpxCurrentCompId;
      const segs = window.gpxLoadSegments(compId);
      const idx = segs.length + 1;
      const name = await appPrompt({
        title: 'Nouveau segment',
        message: 'Donne un nom à ce segment du parcours.',
        defaultValue: `Segment ${idx}`,
        placeholder: `Segment ${idx}`,
        okLabel: 'Ajouter',
      });
      if (name === null) return;
      segs.push({
        startKm: sel.kmMin,
        endKm: sel.kmMax,
        distKm: sel.distKm,
        gain: sel.gain,
        loss: sel.loss,
        avgSlope: sel.avgSlope,
        maxSlope: sel.maxSlope,
        minSlope: sel.minSlope,
        name: (name && name.trim()) || `Segment ${idx}`,
        createdAt: new Date().toISOString(),
      });
      window.gpxSaveSegments(compId, segs);
      window.gpxRenderSegmentsList();
    };
    // Aliases pour compat interne (utilisés par wireClimbsList plus bas)
    const loadSegments = window.gpxLoadSegments;
    const saveSegments = window.gpxSaveSegments;
    const renderSegmentsList = window.gpxRenderSegmentsList;

    function wireClimbsList() {
      const list = document.getElementById('gpx-segments-list');
      if (!list) return;
      renderSegmentsList();
      list.addEventListener('click', (e) => {
        // Bouton suppression
        const delBtn = e.target.closest('.seg-del-btn');
        if (delBtn) {
          e.stopPropagation();
          const i = +delBtn.dataset.segDel;
          const compId = window._gpxCurrentCompId;
          const segs = loadSegments(compId);
          segs.splice(i, 1);
          saveSegments(compId, segs);
          renderSegmentsList();
          return;
        }
        const item = e.target.closest('.climb-item');
        if (!item) return;
        const idx = +item.dataset.segIdx;
        const compId = window._gpxCurrentCompId;
        const segs = loadSegments(compId);
        const gpx = window._gpxClimbContent;
        if (!segs[idx] || !gpx) return;
        const detail = item.querySelector('.climb-detail');
        const chevron = item.querySelector('.climb-chevron');
        const isOpen = !detail.hidden;
        list.querySelectorAll('.climb-item').forEach(it => {
          const d = it.querySelector('.climb-detail');
          const c = it.querySelector('.climb-chevron');
          if (d && d !== detail) { d.hidden = true; d.innerHTML = ''; }
          if (c) c.style.transform = '';
          it.classList.remove('expanded');
        });
        if (isOpen) {
          detail.hidden = true;
          detail.innerHTML = '';
          chevron.style.transform = '';
          item.classList.remove('expanded');
        } else {
          detail.innerHTML = renderClimbDetail(segs[idx], gpx);
          detail.hidden = false;
          chevron.style.transform = 'rotate(180deg)';
          item.classList.add('expanded');
        }
      });
    }

    // Rendu HTML du détail d'une bosse : profil découpé en segments coloréés par pente
    function renderClimbDetail(climb, gpxContent) {
      // Re-parse et filtre la série dans [startKm, endKm]
      const parser = new DOMParser();
      const doc = parser.parseFromString(gpxContent, 'application/xml');
      const trkpts = doc.getElementsByTagName('trkpt');
      const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : []);
      function _d(lat1, lon1, lat2, lon2) {
        const R = 6371, toRad = d => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
        return 2 * R * Math.asin(Math.sqrt(a));
      }
      let cumKm = 0, prevLat = null, prevLon = null;
      const fullSeries = [];
      for (let i = 0; i < pts.length; i++) {
        const lat = parseFloat(pts[i].getAttribute('lat'));
        const lon = parseFloat(pts[i].getAttribute('lon'));
        if (isNaN(lat) || isNaN(lon)) continue;
        if (prevLat !== null) cumKm += _d(prevLat, prevLon, lat, lon);
        prevLat = lat; prevLon = lon;
        const eleEl = pts[i].getElementsByTagName('ele')[0];
        const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
        if (!isNaN(ele)) fullSeries.push({ km: cumKm, ele });
      }
      const series = fullSeries.filter(p => p.km >= climb.startKm && p.km <= climb.endKm);
      if (series.length < 2) return '<div class="modal-placeholder">Pas assez de points</div>';

      // Découpage en segments de ~100m
      const segLen = 0.1; // km
      const segments = [];
      let segStart = series[0];
      for (let i = 1; i < series.length; i++) {
        const p = series[i];
        if (p.km - segStart.km >= segLen || i === series.length - 1) {
          const dx = (p.km - segStart.km) * 1000;
          const dy = p.ele - segStart.ele;
          const slope = dx > 0 ? (dy / dx) * 100 : 0;
          segments.push({
            startKm: segStart.km, endKm: p.km,
            startEle: segStart.ele, endEle: p.ele,
            slope,
            dist: p.km - segStart.km,
            gain: Math.max(0, dy),
          });
          segStart = p;
        }
      }

      // Couleur selon pente
      function slopeColor(s) {
        if (s < 3) return '#4ade80';
        if (s < 6) return '#fbbf24';
        if (s < 9) return '#f97316';
        if (s < 12) return '#ef4444';
        return '#b91c1c';
      }

      // SVG du profil découpé
      const W = 900, H = 240, padL = 30, padR = 16, padT = 16, padB = 30;
      const dw = W - padL - padR, dh = H - padT - padB;
      const totalSegKm = climb.endKm - climb.startKm;
      const minE = Math.min(...series.map(p => p.ele));
      const maxE = Math.max(...series.map(p => p.ele));
      const rng = Math.max(maxE - minE, 5);

      // Dessine chaque segment comme un polygone coloré
      const segmentsSvg = segments.map(s => {
        const x1 = padL + ((s.startKm - climb.startKm) / totalSegKm) * dw;
        const x2 = padL + ((s.endKm - climb.startKm) / totalSegKm) * dw;
        const y1 = padT + dh - ((s.startEle - minE) / rng) * dh;
        const y2 = padT + dh - ((s.endEle - minE) / rng) * dh;
        const baseY = padT + dh;
        const color = slopeColor(s.slope);
        return `<polygon points="${x1},${baseY} ${x1},${y1} ${x2},${y2} ${x2},${baseY}" fill="${color}" stroke="rgba(0,0,0,0.2)" stroke-width="0.5">
          <title>km ${s.startKm.toFixed(2)} → ${s.endKm.toFixed(2)} · ${s.slope.toFixed(1)}% · +${s.gain.toFixed(0)}m</title>
        </polygon>`;
      }).join('');

      // Ticks Y (altitude)
      const yTicks = [];
      for (let i = 0; i <= 3; i++) {
        const e = minE + (rng * (1 - i / 3));
        const y = padT + (dh * i / 3);
        yTicks.push(`<text x="${padL - 4}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${Math.round(e)}m</text>`);
      }
      // Ticks X (km depuis début bosse)
      const xTicks = [];
      const nTicks = Math.min(5, Math.max(2, Math.round(totalSegKm)));
      for (let i = 0; i <= nTicks; i++) {
        const km = climb.startKm + (totalSegKm * i / nTicks);
        const x = padL + (dw * i / nTicks);
        xTicks.push(`<text x="${x}" y="${H - 10}" text-anchor="middle" fill="#64748b" font-size="10">${km.toFixed(1)}</text>`);
      }

      // Légende des couleurs de pente
      const legend = `
        <div class="climb-legend">
          <span><span class="dot" style="background:#4ade80;"></span>&lt; 3%</span>
          <span><span class="dot" style="background:#fbbf24;"></span>3-6%</span>
          <span><span class="dot" style="background:#f97316;"></span>6-9%</span>
          <span><span class="dot" style="background:#ef4444;"></span>9-12%</span>
          <span><span class="dot" style="background:#b91c1c;"></span>≥ 12%</span>
        </div>
      `;

      // Liste des segments raides (>= 6%)
      const steepSegs = segments.filter(s => s.slope >= 6);
      const steepList = steepSegs.length ? `
        <div class="climb-steep-list">
          <div class="climb-steep-title">Sections les plus raides</div>
          ${steepSegs.map(s => `
            <div class="climb-steep-item">
              <span class="dot" style="background:${slopeColor(s.slope)};"></span>
              <span class="ss-range">km ${s.startKm.toFixed(2)} → ${s.endKm.toFixed(2)}</span>
              <span class="ss-slope">${s.slope.toFixed(1)}%</span>
              <span class="ss-gain">+${s.gain.toFixed(0)}m</span>
            </div>
          `).join('')}
        </div>
      ` : '';

      return `
        <div class="climb-detail-inner">
          <svg class="climb-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(0,0,0,0.2)" rx="6"/>
            ${segmentsSvg}
            ${yTicks.join('')}
            ${xTicks.join('')}
          </svg>
          ${legend}
          ${steepList}
        </div>
      `;
    }

    function renderManualTrainingModal(t, switchHTML, dateStrOverride) {
      const _dateStr = dateStrOverride || dateStr;
      // Affiche les boutons Modifier + Supprimer pour cet entraînement manuel prévu
      const editBtn = document.getElementById('modal-edit-btn');
      const delBtn = document.getElementById('modal-delete-btn');
      if (editBtn) {
        editBtn.hidden = false;
        editBtn.dataset.kind = 'training';
        editBtn.dataset.trainingId = t.id;
        editBtn.dataset.trainingMode = 'prevu';
      }
      if (delBtn) {
        delBtn.hidden = false;
        delBtn.dataset.kind = 'training';
        delBtn.dataset.trainingId = t.id;
        delBtn.dataset.trainingMode = 'prevu';
      }
      const sportLabel = window.sportFr(t.sport || 'Ride');
      const sportCat = window.activitySportColorKey({ sport: t.sport }) || 'autre';
      const sportPill = `<span class="sport-pill" data-sport-cat="${sportCat}" style="margin-left:8px;vertical-align:middle;">${sportLabel}</span>`;
      titleEl.innerHTML = `${t.name} ${t.type ? `<span class="pill ${t.type}" style="margin-left:8px;">${t.type}</span>` : ''}${sportPill}`;
      metaEl.innerHTML = `${_dateStr} · Séance ajoutée manuellement`;
      const dur = t.duration || 0;
      const h = Math.floor(dur / 60), mm = (dur % 60).toString().padStart(2, '0');
      const cards = [];
      if (dur) cards.push({ label: 'Durée', value: `${h}h${mm}`, unit: '' });
      if (t.tss) cards.push({ label: 'TSS', value: t.tss, unit: '' });
      if (t.type) cards.push({ label: 'Type', value: t.type, unit: '', isText: true });

      const sections = [];
      if (t.notes) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Notes / Structure</div>
          <div class="modal-info-box" style="white-space:pre-wrap;">${escapeHtml(t.notes)}</div>
        </div>`);
      }
      bodyEl.innerHTML = `
        ${switchHTML}
        <div class="modal-metrics">
          ${cards.map(c => `<div class="modal-metric"><div class="m-label">${c.label}</div><div class="m-value" style="${c.isText ? 'font-size:15px;text-transform:capitalize;' : ''}">${c.value}</div></div>`).join('')}
        </div>
        ${sections.join('')}
      `;
      wireSwitchButtons();
    }

    function renderTemplateModal(proposal, phase, switchHTML, dateStrOverride) {
      const _dateStr = dateStrOverride || dateStr;
      const isRest = proposal.type === 'rest' || (proposal.dur === 0 && proposal.tss === 0);
      const editBtn = document.getElementById('modal-edit-btn');
      const delBtn = document.getElementById('modal-delete-btn');

      // === Jour de repos : modal ultra-épurée ===
      if (isRest) {
        // ⋯ "personnaliser" reste utile (ajouter une séance ce jour-là)
        // 🗑️ caché (déjà repos, rien à supprimer)
        if (editBtn) {
          editBtn.hidden = false;
          editBtn.dataset.kind = 'template';
          editBtn.dataset.templateIso = iso;
          editBtn.dataset.templateData = JSON.stringify({
            name: 'Nouvelle séance',
            type: 'endurance',
            duration: 60,
            tss: 50,
            sport: 'Ride',
            notes: ''
          });
        }
        if (delBtn) delBtn.hidden = true;
        titleEl.textContent = 'Jour de repos';
        metaEl.textContent = _dateStr;
        bodyEl.innerHTML = `
          ${switchHTML}
          <div class="modal-rest-state">
            <div class="modal-rest-icon">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            </div>
            <div class="modal-rest-text">Récupération complète.</div>
            <div class="modal-rest-hint">Utilise <strong>⋯</strong> pour ajouter une séance ce jour-là.</div>
          </div>
        `;
        wireSwitchButtons();
        return;
      }

      // === Suggestion IA normale ===
      if (editBtn) {
        editBtn.hidden = false;
        editBtn.dataset.kind = 'template';
        editBtn.dataset.templateIso = iso;
        editBtn.dataset.templateData = JSON.stringify({
          name: proposal.name || 'Séance IA',
          type: proposal.type || 'endurance',
          duration: proposal.dur || 0,
          tss: proposal.tss || 0,
          sport: proposal.sport || 'Ride',
          notes: proposal.why || ''
        });
      }
      if (delBtn) {
        delBtn.hidden = false;
        delBtn.dataset.kind = 'template';
        delBtn.dataset.templateIso = iso;
      }
      const dur = proposal.dur || 0;
      const h = Math.floor(dur / 60), mm = (dur % 60).toString().padStart(2, '0');
      titleEl.innerHTML = `${proposal.name} ${proposal.type ? `<span class="pill ${proposal.type}">${proposal.type}</span>` : ''}`;
      metaEl.textContent = `${_dateStr} · ${h}h${mm} · ${proposal.tss || 0} TSS prévus · phase ${PHASE_LABELS[phase] || phase}`;
      bodyEl.innerHTML = `
        ${switchHTML}
        <div class="modal-metrics">
          <div class="modal-metric"><div class="m-label">Durée cible</div><div class="m-value">${h}<span style="font-size:14px;">h</span>${mm}</div></div>
          <div class="modal-metric"><div class="m-label">TSS cible</div><div class="m-value">${proposal.tss || 0}</div></div>
          <div class="modal-metric"><div class="m-label">Type</div><div class="m-value" style="font-size:15px;text-transform:capitalize;">${proposal.type || '—'}</div></div>
          <div class="modal-metric"><div class="m-label">Phase</div><div class="m-value" style="font-size:15px;">${PHASE_LABELS[phase] || '—'}</div></div>
        </div>
        <div class="modal-section">
          <div class="modal-section-title">Pourquoi cette séance</div>
          <div class="modal-info-box">${proposal.why || '—'}</div>
        </div>
      `;
      wireSwitchButtons();
    }

    function wireSwitchButtons() {
      bodyEl.querySelectorAll('.modal-activity-switch button').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = +btn.dataset.i;
          dayPrevuIndex[iso] = i;
          renderPrevuItem(i);
        });
      });
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    renderPrevuItem(curIdx);
  }
  document.getElementById('session-modal').classList.add('active');
}

function closeSessionModal() {
  document.getElementById('session-modal').classList.remove('active');
}

document.getElementById('modal-close').addEventListener('click', closeSessionModal);

// ========= Modal de confirmation custom (remplace window.confirm) =========
// Usage : const ok = await appConfirm({ title, message, confirmLabel, cancelLabel, danger })
window.appConfirm = function(opts) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const inner = overlay.querySelector('.confirm-modal');
    if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn || !inner) {
      // Fallback ultra-safe
      resolve(window.confirm(opts && opts.message ? opts.message : 'Confirmer ?'));
      return;
    }
    // Configuration
    titleEl.textContent = (opts && opts.title) || 'Confirmer';
    // Support du HTML simple (pour mettre en gras le nom)
    if (opts && opts.html) msgEl.innerHTML = opts.html;
    else msgEl.textContent = (opts && opts.message) || '';
    okBtn.textContent = (opts && opts.confirmLabel) || 'Confirmer';
    cancelBtn.textContent = (opts && opts.cancelLabel) || 'Annuler';
    inner.classList.toggle('is-danger', !!(opts && opts.danger));

    function cleanup() {
      overlay.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }
    function onOverlayClick(e) { if (e.target === overlay) onCancel(); }
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onOk();
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('active');
    // Focus sur le bouton de confirmation pour Enter direct
    setTimeout(() => okBtn.focus(), 50);
  });
};
// Helper d'escape HTML pour les noms d'item dans les messages de confirmation
window._confirmEscape = function(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
};

// ========= Modal de saisie texte (remplace window.prompt) =========
// Usage : const txt = await appPrompt({ title, message, defaultValue, placeholder, okLabel })
// Retourne la string saisie, ou null si annulé.
window.appPrompt = function(opts) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('prompt-modal');
    const titleEl = document.getElementById('prompt-modal-title');
    const msgEl = document.getElementById('prompt-modal-message');
    const input = document.getElementById('prompt-modal-input');
    const okBtn = document.getElementById('prompt-modal-ok');
    const cancelBtn = document.getElementById('prompt-modal-cancel');
    if (!overlay || !titleEl || !msgEl || !input || !okBtn || !cancelBtn) {
      resolve(window.prompt((opts && opts.message) || '', (opts && opts.defaultValue) || ''));
      return;
    }
    titleEl.textContent = (opts && opts.title) || 'Saisir une valeur';
    msgEl.textContent = (opts && opts.message) || '';
    msgEl.style.display = (opts && opts.message) ? '' : 'none';
    input.value = (opts && opts.defaultValue) || '';
    input.placeholder = (opts && opts.placeholder) || '';
    okBtn.textContent = (opts && opts.okLabel) || 'Valider';
    cancelBtn.textContent = (opts && opts.cancelLabel) || 'Annuler';

    function cleanup() {
      overlay.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() { const v = input.value; cleanup(); resolve(v); }
    function onCancel() { cleanup(); resolve(null); }
    function onOverlayClick(e) { if (e.target === overlay) onCancel(); }
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onOk();
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('active');
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
};

// ========= Modal d'alerte (remplace window.alert) =========
// Usage : await appAlert({ title, message, okLabel })
window.appAlert = function(opts) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('alert-modal');
    const titleEl = document.getElementById('alert-modal-title');
    const msgEl = document.getElementById('alert-modal-message');
    const okBtn = document.getElementById('alert-modal-ok');
    if (!overlay || !titleEl || !msgEl || !okBtn) {
      window.alert((opts && opts.message) || '');
      resolve();
      return;
    }
    titleEl.textContent = (opts && opts.title) || 'Information';
    msgEl.textContent = (opts && opts.message) || '';
    okBtn.textContent = (opts && opts.okLabel) || 'OK';

    function cleanup() {
      overlay.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() { cleanup(); resolve(); }
    function onOverlayClick(e) { if (e.target === overlay) onOk(); }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') onOk(); }
    okBtn.addEventListener('click', onOk);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('active');
    setTimeout(() => okBtn.focus(), 50);
  });
};

// ========= STRAVA IGNORE LIST (masquer des activités Strava localement) =========
const STRAVA_IGNORE_KEY = 'coach_ia_strava_ignored_v1';
function loadStravaIgnored() {
  try { return JSON.parse(localStorage.getItem(STRAVA_IGNORE_KEY) || '[]'); }
  catch { return []; }
}
function isStravaIgnored(id) { return loadStravaIgnored().includes(String(id)); }
function addStravaIgnored(id) {
  const arr = loadStravaIgnored();
  if (!arr.includes(String(id))) arr.push(String(id));
  localStorage.setItem(STRAVA_IGNORE_KEY, JSON.stringify(arr));
}

// ========= TEMPLATE IA OVERRIDES (marquer un jour en repos / personnalisation) =========
const TEMPLATE_REST_KEY = 'coach_ia_template_rest_days_v1';
function loadTemplateRestDays() {
  try { return JSON.parse(localStorage.getItem(TEMPLATE_REST_KEY) || '[]'); }
  catch { return []; }
}
function isTemplateRestDay(iso) { return loadTemplateRestDays().includes(iso); }
function addTemplateRestDay(iso) {
  const arr = loadTemplateRestDays();
  if (!arr.includes(iso)) arr.push(iso);
  localStorage.setItem(TEMPLATE_REST_KEY, JSON.stringify(arr));
}
function removeTemplateRestDay(iso) {
  const arr = loadTemplateRestDays().filter(d => d !== iso);
  localStorage.setItem(TEMPLATE_REST_KEY, JSON.stringify(arr));
}
function toggleTemplateRestDay(iso) {
  if (isTemplateRestDay(iso)) removeTemplateRestDay(iso);
  else addTemplateRestDay(iso);
}
// Expose pour modules ES6 externes (day-extras.js)
window.isTemplateRestDay = isTemplateRestDay;
window.addTemplateRestDay = addTemplateRestDay;
window.removeTemplateRestDay = removeTemplateRestDay;
window.toggleTemplateRestDay = toggleTemplateRestDay;

// ========= Bouton "Modifier" (⋯) dans le header du modal détail =========
// Route selon kind : comp → édition compé, training → édition entraînement, template → matérialiser
const _modalEditBtn = document.getElementById('modal-edit-btn');
if (_modalEditBtn) {
  _modalEditBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const kind = _modalEditBtn.dataset.kind;
    if (kind === 'comp') {
      const compId = _modalEditBtn.dataset.compId;
      if (!compId) return;
      const comp = loadCompetitions().find(c => c.id === compId);
      if (!comp) return;
      closeSessionModal();
      openCompModalForEdit(comp);
    } else if (kind === 'training') {
      const id = _modalEditBtn.dataset.trainingId;
      const mode = _modalEditBtn.dataset.trainingMode || 'prevu';
      if (!id) return;
      closeSessionModal();
      if (typeof window.gpxEditTraining === 'function') window.gpxEditTraining(id, mode);
    } else if (kind === 'template') {
      // Matérialise la suggestion IA en entraînement manuel prévu modifiable
      const isoT = _modalEditBtn.dataset.templateIso;
      let payload = {};
      try { payload = JSON.parse(_modalEditBtn.dataset.templateData || '{}'); } catch {}
      closeSessionModal();
      if (typeof openTrainModal === 'function') {
        openTrainModal('prevu');
        // Préremplit les champs (Date + valeurs du template)
        const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
        setVal('train-modal-name', payload.name);
        setVal('train-modal-date', isoT);
        const dateEl = document.getElementById('train-modal-date');
        if (dateEl && dateEl._flatpickr && isoT) dateEl._flatpickr.setDate(isoT, false);
        setVal('train-modal-duration', payload.duration);
        setVal('train-modal-tss', payload.tss);
        setVal('train-modal-notes', payload.notes);
        const sportEl = document.getElementById('train-modal-sport');
        if (sportEl && payload.sport) { sportEl.value = payload.sport; if (sportEl._customUpdate) sportEl._customUpdate(); }
        const typeEl = document.getElementById('train-modal-type');
        if (typeEl && payload.type) { typeEl.value = payload.type; if (typeEl._customUpdate) typeEl._customUpdate(); }
      }
    }
  });
}

// ========= Bouton "Supprimer" (🗑️) dans le header du modal détail =========
const _modalDelBtn = document.getElementById('modal-delete-btn');
if (_modalDelBtn) {
  _modalDelBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const kind = _modalDelBtn.dataset.kind;
    if (kind === 'comp') {
      const compId = _modalDelBtn.dataset.compId;
      if (!compId) return;
      const comp = loadCompetitions().find(c => c.id === compId);
      const name = comp ? comp.name : 'cette compétition';
      const ok = await appConfirm({
        title: 'Supprimer cette compétition',
        html: `Supprimer <strong>${window._confirmEscape(name)}</strong> ?`,
        confirmLabel: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
      const remaining = loadCompetitions().filter(c => c.id !== compId);
      saveCompetitions(remaining);
      closeSessionModal();
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderCompetitions === 'function') renderCompetitions();
    } else if (kind === 'training') {
      const id = _modalDelBtn.dataset.trainingId;
      const mode = _modalDelBtn.dataset.trainingMode || 'prevu';
      if (!id) return;
      if (typeof window.gpxDeleteTraining === 'function') window.gpxDeleteTraining(id, mode);
    } else if (kind === 'strava') {
      const aid = _modalDelBtn.dataset.activityId;
      if (!aid) return;
      const ok = await appConfirm({
        title: 'Masquer cette activité',
        message: 'Masquer cette activité Strava du calendrier ?\n\nElle reste sur Strava, c\'est juste un filtre local.',
        confirmLabel: 'Masquer',
        danger: true,
      });
      if (!ok) return;
      addStravaIgnored(aid);
      closeSessionModal();
      if (typeof renderCalendar === 'function') renderCalendar();
    } else if (kind === 'template') {
      const isoT = _modalDelBtn.dataset.templateIso;
      if (!isoT) return;
      const ok = await appConfirm({
        title: 'Marquer ce jour comme repos',
        message: 'Ignorer la suggestion IA et marquer ce jour comme repos ?',
        confirmLabel: 'Marquer en repos',
        danger: true,
      });
      if (!ok) return;
      addTemplateRestDay(isoT);
      closeSessionModal();
      if (typeof renderCalendar === 'function') renderCalendar();
    }
  });
}

// Ouvre la modal d'ajout de compétition en mode édition (préremplie + sauvegarde update)
// Helper : applique l'état visuel "fichier sélectionné" au file-picker compé
function _setCompModalGpxVisual(gpxName) {
  const gpxEl = document.getElementById('comp-modal-gpx');
  if (!gpxEl) return;
  const picker = gpxEl.closest('.file-picker');
  if (!picker) return;
  const lbl = picker.querySelector('.file-picker-label');
  const clr = picker.querySelector('.file-picker-clear');
  if (gpxName) {
    picker.classList.add('has-file');
    if (lbl) lbl.textContent = gpxName;
    if (clr) clr.hidden = false;
  } else {
    picker.classList.remove('has-file');
    if (lbl) lbl.textContent = 'Choisir un fichier GPX';
    if (clr) clr.hidden = true;
  }
}

function openCompModalForEdit(comp) {
  if (typeof openCompModal !== 'function') return;
  openCompModal();
  // Marque le mode édition
  window._editingCompId = comp.id;
  // Pré-remplit les champs principaux
  document.getElementById('comp-modal-name').value = comp.name || '';
  document.getElementById('comp-modal-date').value = comp.date || '';
  if (document.getElementById('comp-modal-date')._flatpickr && comp.date) {
    document.getElementById('comp-modal-date')._flatpickr.setDate(comp.date, false);
  }
  // Time
  if (comp.time && window.resetTimeStepper) {
    const [h, m] = comp.time.split(':').map(n => parseInt(n, 10) || 0);
    window.resetTimeStepper('comp-modal-time', h, m);
  }
  // Selects (priority, sport, type)
  ['priority', 'sport', 'type'].forEach(k => {
    const el = document.getElementById('comp-modal-' + k);
    if (el && comp[k] !== undefined && comp[k] !== null) {
      el.value = comp[k];
      if (el._customUpdate) el._customUpdate();
    }
  });
  if (typeof populateTypeSelectForSport === 'function' && comp.sport) {
    populateTypeSelectForSport(comp.sport);
    const t = document.getElementById('comp-modal-type');
    if (t && comp.type) { t.value = comp.type; if (t._customUpdate) t._customUpdate(); }
  }
  // Champs simples — si GPX présent, calcule km/dplus depuis le GPX (vérité terrain)
  // et écrase les valeurs manuelles (l'utilisateur veut que ça reflète le fichier)
  let effKm = comp.km, effDplus = comp.dplus;
  if (comp.gpxContent && typeof extractGpxStats === 'function') {
    const gs = extractGpxStats(comp.gpxContent, parseInt(comp.laps, 10) || 1);
    if (gs) {
      effKm = gs.km;
      effDplus = gs.dplus;
    }
  }
  document.getElementById('comp-modal-km').value = effKm != null ? effKm : '';
  document.getElementById('comp-modal-dplus').value = effDplus != null ? effDplus : '';
  document.getElementById('comp-modal-target').value = comp.target || '';
  document.getElementById('comp-modal-laps').value = comp.laps != null ? comp.laps : '';
  document.getElementById('comp-modal-notes').value = comp.notes || '';
  // Toggle stages + remplissage stagesData si applicable
  const stagesToggle = document.getElementById('comp-modal-stages-toggle');
  if (stagesToggle) {
    stagesToggle.checked = !!comp.stages;
    if (comp.stages && Array.isArray(comp.stagesList) && comp.stagesList.length) {
      stagesData = comp.stagesList.map(s => ({
        date: s.date || '',
        time: s.time || '',
        type: s.type || '',
        km: s.km != null ? String(s.km) : '',
        dplus: s.dplus != null ? String(s.dplus) : '',
        target: s.target || '',
        laps: s.laps != null ? String(s.laps) : '',
        notes: s.notes || '',
        gpxName: s.gpxName || null,
        gpxContent: s.gpxContent || null, // conserve le contenu en mémoire
        gpxFile: null, // les fichiers File API ne peuvent pas être pré-remplis
      }));
      activeStageIdx = 0;
      const tabsBar = document.getElementById('comp-stages-tabs');
      if (tabsBar) tabsBar.hidden = false;
      renderStageTabs();
      writeStageToForm(stagesData[0]);
      // Force l'affichage du nom GPX de l'étape 0 dans le picker
      _setCompModalGpxVisual(stagesData[0].gpxName);
    } else {
      // Compé simple : restaure le picker GPX si présent au niveau racine
      _setCompModalGpxVisual(comp.gpxName);
    }
  } else {
    _setCompModalGpxVisual(comp.gpxName);
  }
  // Adapter le titre + label du bouton "Enregistrer"
  const titleH2 = document.querySelector('#comp-modal .modal-title h2');
  if (titleH2) titleH2.textContent = 'Modifier la compétition';
  const saveBtn = document.getElementById('comp-modal-save');
  if (saveBtn) saveBtn.textContent = 'Enregistrer les modifications';
  // Affiche le bouton poubelle (uniquement en édition)
  const delBtn = document.getElementById('comp-modal-delete');
  if (delBtn) delBtn.hidden = false;
}

// Handler suppression compé depuis la modal d'édition
const _compModalDelBtn = document.getElementById('comp-modal-delete');
if (_compModalDelBtn) {
  _compModalDelBtn.addEventListener('click', async () => {
    const id = window._editingCompId;
    if (!id) return;
    const comp = (typeof loadCompetitions === 'function') ? loadCompetitions().find(c => c.id === id) : null;
    const name = comp ? comp.name : 'cette compétition';
    const ok = await appConfirm({
      title: 'Supprimer cette compétition',
      html: `Supprimer <strong>${window._confirmEscape(name)}</strong> ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const remaining = loadCompetitions().filter(c => c.id !== id);
    saveCompetitions(remaining);
    window._editingCompId = null;
    if (typeof closeCompModal === 'function') closeCompModal();
    if (typeof renderCompList === 'function') renderCompList();
    if (typeof renderCalendar === 'function') renderCalendar();
  });
}
document.getElementById('session-modal').addEventListener('click', (e) => {
  if (e.target.id === 'session-modal') closeSessionModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSessionModal();
});

// Handlers des sous-onglets
document.querySelectorAll('#calendar-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#calendar-subtabs .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    calendarMode = btn.dataset.mode;
    // Reset selectedMonth mais on garde le mois courant affiché dans l'input
    selectedMonth = null;
    document.getElementById('month-input').value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}`;
    renderCalendar();
  });
});

// Handlers du filtre mois
const monthInput = document.getElementById('month-input');
// Pré-remplit avec le mois courant à l'init (sans changer selectedMonth = vue par défaut)
monthInput.value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}`;
document.getElementById('month-prev').addEventListener('click', () => {
  const base = selectedMonth || new Date(today.getFullYear(), today.getMonth(), 1);
  selectedMonth = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  monthInput.value = `${selectedMonth.getFullYear()}-${(selectedMonth.getMonth()+1).toString().padStart(2,'0')}`;
  renderCalendar();
});
document.getElementById('month-next').addEventListener('click', () => {
  const base = selectedMonth || new Date(today.getFullYear(), today.getMonth(), 1);
  selectedMonth = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  monthInput.value = `${selectedMonth.getFullYear()}-${(selectedMonth.getMonth()+1).toString().padStart(2,'0')}`;
  renderCalendar();
});
monthInput.addEventListener('change', () => {
  if (!monthInput.value) {
    selectedMonth = null;
  } else {
    const [y, m] = monthInput.value.split('-').map(Number);
    selectedMonth = new Date(y, m - 1, 1);
  }
  renderCalendar();
});
document.getElementById('month-reset').addEventListener('click', () => {
  selectedMonth = null;
  // Garde le mois courant affiché visuellement (au lieu de tout vider)
  monthInput.value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}`;
  renderCalendar();
});

// ========= CHAT COACH IA =========
const CHAT_KEY = 'coach_ia_chat_v1';
const PREFS_KEY = 'coach_ia_prefs_v1';

function loadChatMessages() {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || []; }
  catch { return []; }
}
function saveChatMessages(msgs) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-50))); // garder max 50 derniers
}
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
  catch { return {}; }
}
function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

const PREF_LABELS = {
  recoveryMode: 'Mode récup activé',
  hardMode: 'Mode pousser',
  blocked: 'Repos forcé (blessure)',
  focusZone_seuil: 'Focus : Seuil',
  focusZone_vo2: 'Focus : VO2max',
  focusZone_endurance: 'Focus : Endurance',
  focusZone_force: 'Focus : Force',
  sleepConcern: 'Sommeil dégradé',
  stressMode: 'Stress signalé',
};

function renderChatPrefs() {
  const prefs = loadPrefs();
  const el = document.getElementById('chat-prefs');
  if (!el) return; // UI chat retirée
  const tags = [];
  if (prefs.recoveryMode) tags.push(PREF_LABELS.recoveryMode);
  if (prefs.hardMode) tags.push(PREF_LABELS.hardMode);
  if (prefs.blocked) tags.push(PREF_LABELS.blocked);
  if (prefs.focusZone) tags.push(PREF_LABELS['focusZone_' + prefs.focusZone] || `Focus : ${prefs.focusZone}`);
  if (prefs.sleepConcern) tags.push(PREF_LABELS.sleepConcern);
  if (prefs.stressMode) tags.push(PREF_LABELS.stressMode);
  if (tags.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `<span style="color:var(--text-dim);font-size:11px;margin-right:6px;">Préférences actives :</span>` +
    tags.map(t => `<span class="chat-pref-tag">${t}</span>`).join('');
}

function renderChat() {
  const messages = loadChatMessages();
  const container = document.getElementById('chat-messages');
  if (!container) return; // UI chat retirée
  if (messages.length === 0) {
    container.innerHTML = `<div class="chat-empty">
      Démarre la conversation avec ton Coach IA.<br>
      Exemples : "Je me sens fatigué cette semaine" · "Je veux travailler mon seuil" · "J'ai mal au genou" · "Bien dormi, en forme aujourd'hui"
    </div>`;
    return;
  }
  container.innerHTML = messages.map(m => `
    <div class="chat-message ${m.role}">
      <div class="chat-avatar ${m.role}">${m.role === 'user' ? 'TOI' : 'IA'}</div>
      <div class="chat-bubble-wrap">
        <div class="chat-bubble">${m.text}</div>
        <div class="chat-time">${m.time}</div>
      </div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
  renderChatPrefs();
}

function generateCoachResponse(userText) {
  const t = userText.toLowerCase();
  const tsb = todayData?.tsb ?? 0;
  const rec = todayData?.recovery;
  const ctxTSB = tsb < -15 ? ` Ton TSB actuel (${tsb.toFixed(0)}) confirme.` : tsb > 5 ? ` Ton TSB est positif (+${tsb.toFixed(0)}), c'est cohérent.` : '';
  const ctxRec = rec != null ? ` Recovery Whoop du jour : ${rec}%.` : '';

  // Détection d'intentions (ordre de priorité)
  if (/blesse|blessé|blessee|douleur|mal au|mal a la|tendinit|claqu|knee|genou|cheville|dos|épaule|coude|poignet/.test(t)) {
    return {
      message: `Important : ne t'entraîne pas avec une douleur. Repos complet jusqu'à disparition.\n\nSi ça persiste plus de 3-5 jours ou empire, consulte un kiné ou un médecin du sport — c'est non négociable.\n\nJe passe ton plan en mode repos forcé. Quand tu vas mieux, dis-moi pour reprendre progressivement.`,
      prefs: { recoveryMode: true, blocked: true }
    };
  }
  if (/fatig|crevé|crevee|épuis|epuis|nase|usé|usee|kacho|ko|naze/.test(t)) {
    return {
      message: `Compris, fatigue signalée.${ctxTSB}${ctxRec}\n\nJe vais alléger les séances :\n• Pas de blocs VO2max\n• Focus endurance Z2 et récupération active\n• Si la fatigue persiste 2-3 jours, on bascule en semaine de décharge\n\nDors bien, hydrate-toi, mange protéiné.`,
      prefs: { recoveryMode: true, blocked: false }
    };
  }
  if (/frais|en forme|reposé|reposee|pleine forme|envie de pousser|au top|peche|pêche/.test(t)) {
    return {
      message: `Top, tu es frais.${ctxTSB}${ctxRec} Bonne fenêtre pour pousser.\n\nJe peux densifier la semaine avec :\n• Un bloc de seuil supplémentaire\n• Ou un VO2max si ton TSB le permet\n\nTu veux travailler quoi en priorité ? Seuil, VO2max, endurance, force ?`,
      prefs: { hardMode: true, recoveryMode: false, blocked: false }
    };
  }
  if (/seuil|ftp|threshold/.test(t)) {
    return {
      message: `OK, focus sur le seuil.\n\nFormat type : 2 séances/sem de 3×12min ou 4×8min à 95-105% FTP, récup 3-5min.\n\nObjectif : pousser ton FTP dans 4-6 semaines. Re-test FTP dans 4 semaines pour mesurer.`,
      prefs: { focusZone: 'seuil' }
    };
  }
  if (/vo2|vmax|aerobie max|aérobie max/.test(t)) {
    return {
      message: `Compris, VO2max comme axe de travail.\n\nFormat type : 4×4min ou 6×3min à 110-115% FTP, récup 1:1.\nTrès exigeant → 1-2 fois/semaine max, jamais 2 jours de suite.\n\nLa phase Peak de ton plan se déclenche.`,
      prefs: { focusZone: 'vo2' }
    };
  }
  if (/endur|volume|sortie longue|fond|base aerobie|base aérobie/.test(t)) {
    return {
      message: `Bon choix, construire la base aérobie c'est la fondation.\n\nPlan : sorties Z2 longues le week-end (>2h), volume hebdo augmenté de 10% max/semaine. Reste sous 75% FTP, conversation aisée.\n\nC'est moins glamour mais c'est ce qui paie sur la durée.`,
      prefs: { focusZone: 'endurance' }
    };
  }
  if (/force|muscu|musculation|gainage|renfo/.test(t)) {
    return {
      message: `OK, focus force/musculation.\n\n2-3 séances/sem en complément du vélo, format : 4-5 exos polyarticulaires (squat, deadlift, presse, gainage), 3-4 séries de 5-8 reps lourdes.\n\nÉvite le jour avant une grosse séance vélo.`,
      prefs: { focusZone: 'force' }
    };
  }
  if (/sommeil|dormi mal|mal dormi|insomnie|nuit courte|fatigue chronique/.test(t)) {
    return {
      message: `Le sommeil c'est 50% de la récupération.\n\nSi tu dors mal 2+ nuits, j'allège auto le plan : pas plus que Z3 le lendemain.\n\nConseils : couche-toi 30min plus tôt, magnesium le soir, pas d'écran 30min avant. Si chronique, vérifie ton stress et ta charge globale.`,
      prefs: { sleepConcern: true }
    };
  }
  if (/stress|boulot|travail|charge mentale|presse|pressé|pressee/.test(t)) {
    return {
      message: `Stress non-sportif = fatigue cumulative pour le corps.\n\nJe réduis l'intensité cette semaine. Privilégie aussi des séances "plaisir" courtes (1h Z2) au lieu de tout planifier dur.\n\nLa séance dure quand tu es déjà stressé peut empirer les choses.`,
      prefs: { stressMode: true }
    };
  }
  if (/decharge|décharge|recup|récup|récupération|recuperation/.test(t)) {
    return {
      message: `OK, semaine de décharge.\n\nFormat : volume réduit de 30-50%, intensité conservée mais blocs courts. Format type : 3 sorties Z2 courtes + 1 séance modérée.\n\nL'objectif est de surcompenser pour repartir frais la semaine suivante.`,
      prefs: { recoveryMode: true }
    };
  }
  if (/competition|compétition|course|objectif|preparation|préparation/.test(t)) {
    return {
      message: `Pour structurer la prépa, ajoute ta compétition dans la section "Compétitions à venir" en haut de l'onglet.\n\nJe gère ensuite automatiquement les phases :\n• Build (>8 sem)\n• Peak (4-8 sem)\n• Taper (1-4 sem)\n• Race week (< 1 sem)`,
      prefs: {}
    };
  }
  if (/^(merci|ok|d'accord|compris|bien|super|nickel)/.test(t)) {
    return {
      message: `Pas de souci, je note. Si tu changes d'avis ou veux ajuster, dis-le moi à tout moment.`,
      prefs: {}
    };
  }
  if (/^(salut|bonjour|hello|coucou|hey|yo)/.test(t)) {
    return {
      message: `Salut ! Prêt à bosser. Dis-moi comment tu te sens aujourd'hui, ce que tu veux travailler, ou si tu as des douleurs/contraintes.${ctxRec}${ctxTSB}`,
      prefs: {}
    };
  }
  // Réponse par défaut
  return {
    message: `Noté. Je tiens compte pour la suite.\n\nDis-moi par exemple :\n• Ta sensation du jour (frais / fatigué / douleur)\n• Ce que tu veux travailler (seuil / VO2 / endurance / force)\n• Ton sommeil, ton stress, des contraintes spécifiques`,
    prefs: {}
  };
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const messages = loadChatMessages();
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  messages.push({ role: 'user', text, time });

  const { message: response, prefs: newPrefs } = generateCoachResponse(text);
  messages.push({ role: 'coach', text: response, time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) });

  // Sauvegarder préférences extraites
  if (newPrefs && Object.keys(newPrefs).length > 0) {
    const cur = loadPrefs();
    Object.assign(cur, newPrefs);
    savePrefs(cur);
  }

  saveChatMessages(messages);
  input.value = '';
  renderChat();
  // Re-render du calendrier pour appliquer les nouvelles préfs
  if (typeof renderCalendar === 'function') renderCalendar();
}

// Chat handlers — défensifs car le UI chat a été retiré de PANEL 2 (Entraîneur)
const _chatSendBtn = document.getElementById('chat-send');
if (_chatSendBtn) _chatSendBtn.addEventListener('click', sendChatMessage);
const _chatInputEl = document.getElementById('chat-input');
if (_chatInputEl) _chatInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});
const _chatClearBtn = document.getElementById('chat-clear');
if (_chatClearBtn) _chatClearBtn.addEventListener('click', async () => {
  const ok = await appConfirm({
    title: 'Effacer la conversation',
    message: 'Effacer la conversation et les préférences enregistrées ?',
    confirmLabel: 'Effacer',
    danger: true,
  });
  if (!ok) return;
  localStorage.removeItem(CHAT_KEY);
  localStorage.removeItem(PREFS_KEY);
  renderChat();
  if (typeof renderCalendar === 'function') renderCalendar();
});

try { renderChat(); } catch (e) { console.warn('[renderChat]', e); }

// ========= INTÉGRATION DES PRÉFÉRENCES DANS LE PLAN =========
// Patch sur adjustForRecovery pour aussi appliquer les prefs du chat
const _originalAdjustForRecovery = adjustForRecovery;
adjustForRecovery = function(proposal, recovery) {
  let p = _originalAdjustForRecovery(proposal, recovery);
  const prefs = loadPrefs();
  if (prefs.blocked && p.type !== 'rest') {
    return { ...p, type: 'rest', name: 'Repos forcé (douleur signalée)', dur: 0, tss: 0, why: 'Repos demandé suite à signalement de douleur — reprendre quand ça va mieux' };
  }
  if (prefs.recoveryMode && (p.type === 'vo2' || p.type === 'seuil')) {
    return { ...p, type: 'endurance', name: 'Endurance Z2 (mode récup activé)', dur: Math.round(p.dur * 0.7), tss: Math.round(p.tss * 0.55), why: 'Mode récup activé via chat — intensité allégée' };
  }
  if (prefs.hardMode && p.type === 'endurance' && p.tss < 80) {
    return { ...p, name: p.name + ' (renforcé)', tss: Math.round(p.tss * 1.2), why: 'Mode pousser activé via chat — un peu plus de stimulation' };
  }
  if (prefs.focusZone === 'seuil' && p.type === 'endurance' && p.tss > 50) {
    return { ...p, type: 'tempo', name: 'Sweet Spot (focus seuil)', tss: Math.round(p.tss * 1.15), why: 'Focus seuil via chat — endurance remplacée par sweet spot' };
  }
  return p;
};

// Init
renderCompList();
renderCalendar();

// ========= PANEL 3: LONG TERME (robuste aux nulls Whoop) =========
// Rolling average qui ignore les nulls (renvoie null si aucun point dans la fenêtre)
const rolling = (arr, n) => arr.map((_, i, a) => {
  const s = a.slice(Math.max(0, i-n+1), i+1).filter(v => v != null);
  if (s.length === 0) return null;
  return +(s.reduce((x,y)=>x+y,0)/s.length).toFixed(1);
});
const hrv7 = rolling(data.map(d=>d.hrv), 7);

new Chart(document.getElementById('chart-hrv'), {
  type: 'line',
  data: { labels, datasets: [{ data: hrv7, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.15)', tension: 0.3, pointRadius: 0, fill: true, spanGaps: false }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { title: { display: true, text: 'ms' } } } }
});

// Sommeil : 30 derniers jours, nulls → barre vide
const sleepSlice = data.slice(-30);
new Chart(document.getElementById('chart-sleep'), {
  type: 'bar',
  data: {
    labels: sleepSlice.map(d => fmtDate(d.date)),
    datasets: [{
      data: sleepSlice.map(d => d.sleepH),
      backgroundColor: sleepSlice.map(d => d.sleepH == null ? '#2a3142' : d.sleepH < 6.5 ? '#f87171' : d.sleepH < 7 ? '#fbbf24' : '#4ade80'),
      borderRadius: 2
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => ctx.parsed.y == null ? 'Pas de donnée Whoop' : ctx.parsed.y + ' h' } }
    },
    scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { title: { display: true, text: 'heures' }, min: 0 } }
  }
});

const ratio = data.map(d => d.ctl > 0 ? +(d.atl / d.ctl).toFixed(2) : 1);
new Chart(document.getElementById('chart-ratio'), {
  type: 'line',
  data: { labels, datasets: [
    { data: ratio, borderColor: '#fbbf24', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0 },
    { data: data.map(()=>1.3), borderColor: 'rgba(248,113,113,0.5)', borderDash: [3,3], pointRadius: 0 },
    { data: data.map(()=>0.8), borderColor: 'rgba(74,222,128,0.5)', borderDash: [3,3], pointRadius: 0 }
  ] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { title: { display: true, text: 'ATL/CTL' }, min: 0.5, max: 1.6 } } }
});

new Chart(document.getElementById('chart-ctl-trend'), {
  type: 'line',
  data: {
    labels,
    datasets: [{ label: 'CTL', data: data.map(d=>d.ctl), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', tension: 0.3, pointRadius: 0, fill: true }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { ticks: { maxTicksLimit: 10 }, grid: { display: false } }, y: { title: { display: true, text: 'CTL (fitness)' } } }
  }
});

// Alertes long-terme — calculées sur les vraies données
const alerts = [];

// 1. Évolution CTL sur 90j
const last90 = data.slice(-90);
if (last90.length >= 30) {
  const ctlStart = last90[0].ctl;
  const ctlEnd = last90[last90.length - 1].ctl;
  const ctlPct = ctlStart > 0 ? Math.round((ctlEnd - ctlStart) / ctlStart * 100) : 0;
  alerts.push({
    class: ctlPct > 5 ? 'good' : ctlPct < -10 ? 'danger' : 'warn',
    title: `Évolution de la forme : ${ctlPct >= 0 ? '+' : ''}${ctlPct}% sur 90 jours`,
    body: `CTL passé de ${ctlStart.toFixed(0)} à ${ctlEnd.toFixed(0)}. ${ctlPct > 10 ? 'Progression saine.' : ctlPct < -10 ? 'Régression — vérifier la cause (blessure, pause, démotivation).' : ctlPct > 0 ? 'Progression légère.' : 'Forme stable.'}`
  });
}

// 2. Ratio ATL/CTL : périodes à risque
const riskDays = data.filter(d => d.ctl > 10 && d.atl / d.ctl > 1.3).length;
if (riskDays > 0) {
  alerts.push({
    class: riskDays > 14 ? 'danger' : 'warn',
    title: `Ratio ATL/CTL > 1.3 sur ${riskDays} jour${riskDays>1?'s':''}`,
    body: riskDays > 14 ? 'Plusieurs périodes de surcharge — risque de blessure majoré. Bien intercaler des semaines de décharge.' : 'Période ponctuelle de surcharge bien gérée.'
  });
} else if (data.length > 30) {
  alerts.push({
    class: 'good',
    title: 'Aucune surcharge aiguë détectée',
    body: 'Ratio ATL/CTL toujours sous 1.3 → tu absorbes ta charge sans pic de risque.'
  });
}

// 3. HRV — seulement si données réelles
const realHrv = data.filter(d => d.whoopSource === 'real' && d.hrv != null);
if (realHrv.length >= 3) {
  const avgHrv = realHrv.reduce((s,d)=>s+d.hrv,0) / realHrv.length;
  const stdHrv = Math.sqrt(realHrv.reduce((s,d)=>s+Math.pow(d.hrv-avgHrv,2),0) / realHrv.length);
  alerts.push({
    class: stdHrv < 8 ? 'good' : 'warn',
    title: `HRV moyenne ${avgHrv.toFixed(0)} ms (σ ${stdHrv.toFixed(1)})`,
    body: stdHrv < 8 ? 'Variabilité faible → état de récup stable.' : 'Variabilité élevée → état fluctuant. Surveiller les soirs avant séance dure.'
  });
} else {
  alerts.push({
    class: 'warn',
    title: 'HRV : pas assez de données Whoop',
    body: `Seulement ${realHrv.length} jour${realHrv.length>1?'s':''} de mesures HRV réelles. Les analyses long-terme demandent 14j+.`
  });
}

// 4. Sommeil — seulement si données réelles
const realSleep = data.filter(d => d.whoopSource === 'real' && d.sleepH != null);
if (realSleep.length >= 3) {
  const avgSleep = realSleep.reduce((s,d)=>s+d.sleepH,0) / realSleep.length;
  const shortNights = realSleep.filter(d => d.sleepH < 7).length;
  alerts.push({
    class: avgSleep >= 7.5 && shortNights < realSleep.length * 0.3 ? 'good' : 'warn',
    title: `Sommeil moyen ${avgSleep.toFixed(1)}h · ${shortNights}/${realSleep.length} nuit${realSleep.length>1?'s':''} < 7h`,
    body: avgSleep >= 7.5 ? 'Volume correct. Les jours après une nuit courte sont à modérer en intensité.' : 'Volume insuffisant — priorité au sommeil pour récupérer.'
  });
}

document.getElementById('alerts-list').innerHTML = alerts.map(a => `
  <div class="insight ${a.class}">
    <div class="insight-title">${a.title}</div>
    <div class="insight-body">${a.body}</div>
  </div>`).join('');

// ========= PANEL 4: SESSIONS =========
let sessions = [];
function renderSessionsTable() {
  sessions = data.filter(d => d.sessionType).slice(-12).reverse();
  const tbody = document.getElementById('sessions-tbody');
  tbody.innerHTML = sessions.map((s, i) => {
    // Récup du sport Strava depuis la 1re activité du jour, sinon depuis la racine
    const firstAct = (s.activities && s.activities.length) ? s.activities[0] : s;
    const sportLabel = window.activitySportLabel ? window.activitySportLabel(firstAct) : (s.sport || '—');
    const sportCat = window.activitySportColorKey ? window.activitySportColorKey(firstAct) : 'autre';
    return `
    <tr data-idx="${i}">
      <td>${fmtDate(s.date)}</td>
      <td>${s.sessionName}</td>
      <td><span class="sport-pill" data-sport-cat="${sportCat}">${sportLabel}</span></td>
      <td><span class="pill ${s.sessionType}">${s.sessionType}</span></td>
      <td>${Math.floor(s.duration/60)}h${(s.duration%60).toString().padStart(2,'0')}</td>
      <td>${s.tss}</td>
      <td>${s.np}W (${s.ftpPct}%)</td>
      <td>${s.hr} bpm</td>
      <td>${s.compliance != null ? `<span style="color:${s.compliance>=95?'var(--accent)':s.compliance>=85?'var(--warn)':'var(--danger)'};">${s.compliance}%</span>` : '<span style="color:var(--text-mute);">—</span>'}</td>
    </tr>
    `;
  }).join('');
  // Auto-affichage de la 1ère séance ou message vide
  const detailWrap = document.getElementById('session-detail-wrap');
  if (sessions.length) {
    tbody.querySelector('tr')?.classList.add('selected');
    renderSessionDetail(sessions[0]);
  } else {
    detailWrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:13px;">Aucune séance pour le filtre sélectionné.</div>';
  }
}
try { renderSessionsTable(); } catch (e) { console.error('[renderSessionsTable]', e); }

function renderSessionDetail(s) {
  const zoneColors = ['#bbf7d0','#86efac','#4ade80','#16a34a','#14532d'];
  const zones = (s.zones && s.zones.length) ? s.zones : (s.zones_hr || s.zones_power || [0,0,0,0,0]);
  const zonesHTML = zones.map((z, i) => `<div class="zone-seg" style="width:${z}%;background:${zoneColors[i]};">${z>8?z+'%':''}</div>`).join('');
  const html = `
  <div class="session-detail">
    <div class="session-detail-header">
      <div>
        <h3>${s.sessionName} <span class="pill ${s.sessionType}" style="margin-left:8px;">${s.sessionType}</span></h3>
        <div class="meta">${s.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${Math.floor(s.duration/60)}h${(s.duration%60).toString().padStart(2,'0')} · ${s.tss} TSS</div>
      </div>
      <div style="text-align:right;font-size:12px;color:var(--text-dim);">Recovery avant : <strong style="color:var(--text);">${s.recovery != null ? s.recovery + '%' : '—'}</strong></div>
    </div>
    <div class="metric-row">
      <div class="mini-metric"><div class="label">NP / Puissance norm.</div><div class="value">${s.np} W</div><div class="compare">${s.ftpPct}% FTP</div></div>
      <div class="mini-metric"><div class="label">FC moyenne</div><div class="value">${s.hr} bpm</div><div class="compare">Max ${s.hr + randInt(15,30)} bpm</div></div>
      <div class="mini-metric"><div class="label">TSS réalisé</div><div class="value">${s.tss}</div><div class="compare ${s.compliance>=95?'up':'down'}">${s.compliance}% du prévu</div></div>
      <div class="mini-metric"><div class="label">Variabilité</div><div class="value">${(rand(1.02,1.18)).toFixed(2)}</div><div class="compare">IF ${(s.ftpPct/100).toFixed(2)}</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Répartition du temps par zone de FC</div>
    <div class="zone-bar">${zonesHTML}</div>
    <div class="legend">
      <span><span class="legend-dot" style="background:#4ade80;"></span>Z1 récup</span>
      <span><span class="legend-dot" style="background:#60a5fa;"></span>Z2 endurance</span>
      <span><span class="legend-dot" style="background:#a78bfa;"></span>Z3 tempo</span>
      <span><span class="legend-dot" style="background:#fbbf24;"></span>Z4 seuil</span>
      <span><span class="legend-dot" style="background:#f87171;"></span>Z5 VO2max</span>
    </div>
    <div style="margin-top:14px;padding:12px;background:var(--bg);border-radius:6px;font-size:13px;">
      <strong style="color:var(--info);">Analyse Coach IA :</strong>
      ${(() => {
        const c = s.compliance;
        const recTxt = s.recovery != null ? s.recovery + '%' : 'inconnue';
        if (c == null) return `Pas de TSS planifié pour cette séance (mode libre). NP ${s.np}W sur ${Math.floor(s.duration/60)}h${(s.duration%60).toString().padStart(2,'0')}.`;
        if (c >= 95) return `Séance conforme au plan. Exécution propre, ${s.ftpPct}% FTP atteint comme prévu.`;
        if (c >= 85) return `Léger écart (${c}% du prévu). Probablement lié à la récupération de départ (${recTxt}). Pas d'inquiétude — adapter la prochaine séance similaire.`;
        return `Écart significatif (${c}%). Possible signe de fatigue accumulée ou objectif trop ambitieux. Suggérer une décharge.`;
      })()}
    </div>
  </div>`;
  document.getElementById('session-detail-wrap').innerHTML = html;
}

document.getElementById('sessions-tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const tbody = e.currentTarget;
  tbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
  tr.classList.add('selected');
  renderSessionDetail(sessions[+tr.dataset.idx]);
});

// ========= TABS =========
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.panel).classList.add('active');
  });
});

// ========= FILTRES SPORTS (boutons header) =========
document.querySelectorAll('#sport-filter .sport-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sport = btn.dataset.sport;
    if (sport === 'tout') {
      // Clic sur "Tout" : ne sélectionne QUE Tout
      activeSports.clear();
      activeSports.add('tout');
    } else {
      activeSports.delete('tout');
      if (activeSports.has(sport)) {
        activeSports.delete(sport);
      } else {
        activeSports.add(sport);
      }
      // Si plus rien de sélectionné, revenir sur Tout
      if (activeSports.size === 0) activeSports.add('tout');
      // Si TOUS les sports individuels sont sélectionnés → bascule sur Tout
      const individuals = ['cyclisme', 'course', 'musculation', 'natation', 'autre'];
      if (individuals.every(s => activeSports.has(s))) {
        activeSports.clear();
        activeSports.add('tout');
      }
    }
    // MAJ visuelle des boutons
    document.querySelectorAll('#sport-filter .sport-btn').forEach(b => {
      b.classList.toggle('active', activeSports.has(b.dataset.sport));
    });
    applySportFilter();
  });
});

})(); // fin IIFE async

// ========= BOUTON REFRESH MANUEL =========
// Déclenche workflow_dispatch GitHub Actions via le Worker Cloudflare,
// poll jusqu'à la fin du run, puis recharge la page.
(function setupRefreshButton() {
  const btn = document.getElementById('refresh-btn');
  const icon = document.getElementById('refresh-icon');
  if (!btn || !icon) return;

  // Injecte le @keyframes spin si absent
  if (!document.getElementById('refresh-spin-style')) {
    const style = document.createElement('style');
    style.id = 'refresh-spin-style';
    style.textContent = '@keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  function setLoading(on, label) {
    btn.disabled = on;
    btn.classList.toggle('loading', on);
    if (on) {
      btn.style.color = 'var(--accent)';
      btn.style.borderColor = 'var(--accent)';
      icon.style.animation = 'refresh-spin 0.8s linear infinite';
      btn.title = label || 'Rafraîchissement en cours...';
    } else {
      btn.style.color = 'var(--text-dim)';
      btn.style.borderColor = 'var(--border)';
      icon.style.animation = '';
      btn.title = 'Rafraîchir maintenant';
    }
  }

  async function pollStatus(runId, maxSec = 180) {
    const start = Date.now();
    while ((Date.now() - start) / 1000 < maxSec) {
      try {
        const r = await fetch(`/api/refresh-status?runId=${runId}`, { credentials: 'include' });
        if (r.ok) {
          const j = await r.json();
          if (j.status === 'completed') return j.conclusion === 'success';
        }
      } catch (e) { /* on retente */ }
      await new Promise(res => setTimeout(res, 4000));
    }
    return false;
  }

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    setLoading(true, 'Déclenchement du run...');
    try {
      const resp = await fetch('/api/refresh', { method: 'POST', credentials: 'include' });
      if (!resp.ok) {
        const txt = await resp.text();
        await appAlert({
          title: 'Erreur de déclenchement',
          message: `HTTP ${resp.status}\n${txt.slice(0, 200)}`,
        });
        setLoading(false);
        return;
      }
      const { runId } = await resp.json();
      setLoading(true, 'Récupération Strava + Whoop...');
      const ok = await pollStatus(runId);
      if (ok) {
        // Reload avec cache-bust pour forcer la nouvelle data.js
        location.reload();
      } else {
        await appAlert({
          title: 'Échec du run',
          message: 'Le run GitHub Actions a échoué ou pris trop de temps. Voir https://github.com/Yanisjaber/coach-ia/actions',
        });
        setLoading(false);
      }
    } catch (e) {
      await appAlert({
        title: 'Erreur réseau',
        message: e.message || String(e),
      });
      setLoading(false);
    }
  });
})();
