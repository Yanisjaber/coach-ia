/* ============================================================
   js/power-profile.js — Rendu du chart Power Profile

   Lit window.DASHBOARD_DATA.power_profile (généré par fetch_data.py)
   et rend un graphique log-log :
     - X : durée d'effort (1s → 2h) en échelle log
     - Y : puissance moyenne max (W) en échelle linéaire
     - 2 courbes : all-time (vert) + 90 derniers jours (bleu)

   Affiche aussi un résumé des records clés (1s, 5min, 20min, 60min).
   ============================================================ */

// Ordre des durées (= colonnes de power_profile_sport), de la plus courte à la plus longue.
const ALL_LABELS = [
  '1s','2s','3s','4s','5s','6s','7s','8s','9s','10s','11s','12s','13s','14s','15s',
  '20s','25s','30s','45s',
  '1min','2min','3min','4min','5min','6min','7min','8min','9min','10min',
  '12min','15min','20min','25min','30min','35min','40min','45min',
  '1h','1h30','2h','2h30','3h','3h30','4h','4h30','5h','6h','7h','8h',
];
// Durées mises en avant dans le bandeau "records clés"
const HIGHLIGHT_LABELS = ['1s', '5s', '1min', '5min', '20min', '1h'];

// Sport ciblé = celui choisi dans le sélecteur local des records (bilan.js).
function ppTargetSport() {
  return (typeof window.coachPowerSport === 'function' && window.coachPowerSport()) || 'cyclisme';
}

function renderSummary(pps) {
  const el = document.getElementById('power-profile-summary');
  if (!el) return;
  const durations = pps.durations || {};
  const details = pps.details || {};

  const items = HIGHLIGHT_LABELS.map(lab => {
    const at = durations[lab];
    const r = (details[lab] || {}).w90;
    if (at == null && r == null) return null;
    return `
      <div class="pp-record">
        <span class="pp-record-label">${lab}</span>
        <span class="pp-record-value">${at != null ? Math.round(at) + ' W' : '—'}</span>
        ${r != null ? `<span class="pp-record-value recent" style="font-size:11px;font-weight:500;">90j : ${Math.round(r)} W</span>` : ''}
      </div>
    `;
  }).filter(Boolean).join('');

  el.innerHTML = items || '<span>Pas encore de records calculés.</span>';
}

let _ppChart = null;

function renderChart(pps) {
  const canvas = document.getElementById('chart-power-profile');
  if (!canvas || !window.Chart) return;

  const durations = pps.durations || {};
  const details = pps.details || {};
  // On n'affiche que les durées présentes, dans l'ordre.
  const present = ALL_LABELS.filter(lab => durations[lab] != null);
  const labels = present;
  const allData = present.map(lab => Math.round(durations[lab]));
  const recentData = present.map(lab => {
    const w = (details[lab] || {}).w90;
    return w != null ? Math.round(w) : null;
  });

  if (_ppChart) { _ppChart.destroy(); _ppChart = null; }

  _ppChart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'All-time (records)',
          data: allData,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74, 222, 128, 0.15)',
          borderWidth: 2.5,
          tension: 0.25,
          fill: true,
          spanGaps: true,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: '90 derniers jours',
          data: recentData,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.08)',
          borderWidth: 2,
          tension: 0.25,
          fill: false,
          spanGaps: true,
          borderDash: [5, 4],
          pointRadius: 2,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#e6e9ef', font: { size: 11 }, boxWidth: 14 } },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            title: (items) => 'Effort : ' + items[0].label,
            label: (item) => item.dataset.label + ' : ' + (item.parsed.y || '—') + ' W',
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8b94a8', font: { size: 11 } },
          grid: { color: '#232a3a' },
          title: { display: true, text: 'Durée d\'effort (échelle log)', color: '#8b94a8' },
        },
        y: {
          ticks: { color: '#8b94a8', callback: (v) => v + ' W' },
          grid: { color: '#232a3a' },
          title: { display: true, text: 'Puissance moyenne max (W)', color: '#8b94a8' },
          beginAtZero: false,
        },
      },
    },
  });
}

export function renderPowerProfile() {
  const dataRoot = window.DASHBOARD_DATA;
  const bySport = (dataRoot && dataRoot.power_by_sport) || {};
  const pps = bySport[ppTargetSport()];
  const card = document.querySelector('.power-profile-card');
  const emptyEl = document.getElementById('power-profile-empty');
  const chartWrap = card ? card.querySelector('.chart-wrap') : null;
  const summaryEl = document.getElementById('power-profile-summary');

  // Pas de données de puissance pour ce sport → message d'attente
  if (!pps || !pps.durations || Object.keys(pps.durations).length === 0) {
    if (chartWrap) chartWrap.style.display = 'none';
    if (summaryEl) summaryEl.style.display = 'none';
    if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = 'Aucune donnée de puissance pour ce sport.'; }
    return;
  }

  if (chartWrap) chartWrap.style.display = '';
  if (summaryEl) summaryEl.style.display = '';
  if (emptyEl) emptyEl.hidden = true;

  renderSummary(pps);
  renderChart(pps);
}

function init() {
  // Petit délai pour laisser data.js + Chart.js + DOM se setup
  setTimeout(renderPowerProfile, 200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.renderPowerProfile = renderPowerProfile;
