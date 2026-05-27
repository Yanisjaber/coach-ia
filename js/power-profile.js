/* ============================================================
   js/power-profile.js — Rendu du chart Power Profile

   Lit window.DASHBOARD_DATA.power_profile (généré par fetch_data.py)
   et rend un graphique log-log :
     - X : durée d'effort (1s → 2h) en échelle log
     - Y : puissance moyenne max (W) en échelle linéaire
     - 2 courbes : all-time (vert) + 90 derniers jours (bleu)

   Affiche aussi un résumé des records clés (1s, 5min, 20min, 60min).
   ============================================================ */

// Format une durée en label lisible : 60 → "1 min", 1200 → "20 min", 3600 → "1 h"
function formatDuration(secStr) {
  const s = parseInt(secStr, 10);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h} h`;
}

// Durées affichées dans le bandeau "records clés"
const HIGHLIGHT_DURATIONS = ['1', '5', '60', '300', '1200', '3600'];

function renderSummary(ppData) {
  const el = document.getElementById('power-profile-summary');
  if (!el) return;
  const alltime = ppData.alltime || {};
  const recent = ppData.last_90d || {};

  const items = HIGHLIGHT_DURATIONS.map(dur => {
    const at = alltime[dur];
    const r = recent[dur];
    if (!at && !r) return null;
    return `
      <div class="pp-record">
        <span class="pp-record-label">${formatDuration(dur)}</span>
        <span class="pp-record-value">${at ? Math.round(at) + ' W' : '—'}</span>
        ${r ? `<span class="pp-record-value recent" style="font-size:11px;font-weight:500;">90j : ${Math.round(r)} W</span>` : ''}
      </div>
    `;
  }).filter(Boolean).join('');

  el.innerHTML = items || '<span>Pas encore de records calculés.</span>';
}

let _ppChart = null;

function renderChart(ppData) {
  const canvas = document.getElementById('chart-power-profile');
  if (!canvas || !window.Chart) return;

  const durations = (ppData.durations || []).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const alltime = ppData.alltime || {};
  const recent = ppData.last_90d || {};

  // Construire les datasets : on aligne sur les durées disponibles
  const labels = durations.map(d => formatDuration(d));
  const allData = durations.map(d => alltime[d] != null ? Math.round(alltime[d]) : null);
  const recentData = durations.map(d => recent[d] != null ? Math.round(recent[d]) : null);

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
  const pp = dataRoot && dataRoot.power_profile;
  const card = document.querySelector('.power-profile-card');
  const emptyEl = document.getElementById('power-profile-empty');
  const chartWrap = card ? card.querySelector('.chart-wrap') : null;
  const summaryEl = document.getElementById('power-profile-summary');

  // Pas de PP ou cache vide → message d'attente
  if (!pp || !pp.alltime || Object.keys(pp.alltime).length === 0) {
    if (chartWrap) chartWrap.style.display = 'none';
    if (summaryEl) summaryEl.style.display = 'none';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (chartWrap) chartWrap.style.display = '';
  if (summaryEl) summaryEl.style.display = '';
  if (emptyEl) emptyEl.hidden = true;

  renderSummary(pp);
  renderChart(pp);
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
