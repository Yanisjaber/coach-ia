/* ============================================================
   js/wellness-ui.js — UI wellness manuel

   - Carte CTA (Tableau de bord) qui affiche la dernière saisie et ouvre la modal
   - Modal de saisie (sliders emoji + poids + notes)
   - Chart "Tendances wellness" (panel Tendances long-terme)
   - Auto-bootstrap au DOMContentLoaded
   ============================================================ */

import {
  loadWellness,
  saveWellnessDay,
  getWellnessDay,
  deleteWellnessDay,
  getWellnessRange,
} from './wellness.js';

const FIELD_KEYS = ['mood', 'fatigue', 'soreness', 'motivation'];
const FIELD_LABELS = {
  mood: 'Humeur',
  fatigue: 'Fatigue',
  soreness: 'Courbatures',
  motivation: 'Motivation',
};

// État local de la modal
let currentDate = null;     // ISO date affichée
let draft = {};             // valeurs en cours d'édition

function isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ============ MODAL ============
function openModal(isoDate) {
  currentDate = isoDate || isoToday();
  const existing = getWellnessDay(currentDate) || {};
  draft = { ...existing };

  // Date label
  const dateLabel = document.getElementById('wellness-date-label');
  if (dateLabel) dateLabel.textContent = formatDateLabel(currentDate);

  // Poids
  const weightInput = document.getElementById('wellness-weight-input');
  if (weightInput) weightInput.value = (existing.weight != null) ? existing.weight : '';

  // Notes
  const notesInput = document.getElementById('wellness-notes-input');
  if (notesInput) notesInput.value = existing.notes || '';

  // Scales 1-5
  FIELD_KEYS.forEach(k => updateScaleUI(k));

  // Bouton supprimer visible si saisie existante
  const delBtn = document.getElementById('wellness-delete');
  if (delBtn) delBtn.hidden = !Object.keys(existing).length;

  document.getElementById('wellness-backdrop').classList.add('active');
}

function closeModal() {
  document.getElementById('wellness-backdrop').classList.remove('active');
}

function updateScaleUI(key) {
  const v = draft[key];
  const valEl = document.getElementById(`wellness-${key}-val`);
  if (valEl) valEl.textContent = v ? `${v}/5` : '—';
  const wrap = document.querySelector(`.wellness-field[data-key="${key}"]`);
  if (!wrap) return;
  wrap.querySelectorAll('.wellness-scale button').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.val, 10) === v);
  });
}

function wireModal() {
  // Scales : click sur un emoji → set draft[key]
  FIELD_KEYS.forEach(key => {
    const wrap = document.querySelector(`.wellness-field[data-key="${key}"]`);
    if (!wrap) return;
    wrap.querySelectorAll('.wellness-scale button').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = parseInt(btn.dataset.val, 10);
        // Toggle : reclic sur la même valeur = désélection
        draft[key] = (draft[key] === v) ? undefined : v;
        updateScaleUI(key);
      });
    });
  });

  // Boutons header / footer
  document.getElementById('wellness-close')?.addEventListener('click', closeModal);
  document.getElementById('wellness-cancel')?.addEventListener('click', closeModal);

  // Backdrop click → close
  document.getElementById('wellness-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'wellness-backdrop') closeModal();
  });

  // ESC pour fermer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('wellness-backdrop').classList.contains('active')) {
      closeModal();
    }
  });

  // Save
  document.getElementById('wellness-save')?.addEventListener('click', () => {
    const weightInput = document.getElementById('wellness-weight-input');
    const notesInput = document.getElementById('wellness-notes-input');
    const data = {
      weight: weightInput?.value ? parseFloat(weightInput.value) : undefined,
      mood: draft.mood,
      fatigue: draft.fatigue,
      soreness: draft.soreness,
      motivation: draft.motivation,
      notes: notesInput?.value?.trim() || undefined,
    };
    saveWellnessDay(currentDate, data);
    closeModal();
    refreshCta();
    renderWellnessTrend();
  });

  // Delete
  document.getElementById('wellness-delete')?.addEventListener('click', () => {
    if (confirm('Effacer la saisie wellness de ce jour ?')) {
      deleteWellnessDay(currentDate);
      closeModal();
      refreshCta();
      renderWellnessTrend();
    }
  });
}

// ============ CARTE CTA (Tableau de bord) ============
function refreshCta() {
  const sub = document.getElementById('wellness-cta-sub');
  const btn = document.getElementById('wellness-cta-btn-label');
  if (!sub || !btn) return;
  const today = isoToday();
  const todayData = getWellnessDay(today);

  if (todayData && Object.keys(todayData).filter(k => k !== 'ts').length > 0) {
    // Résumé : "72.5 kg · Humeur 4/5 · Fatigue 2/5"
    const parts = [];
    if (todayData.weight != null) parts.push(`${todayData.weight} kg`);
    if (todayData.mood) parts.push(`Humeur ${todayData.mood}/5`);
    if (todayData.fatigue) parts.push(`Fatigue ${todayData.fatigue}/5`);
    if (todayData.soreness) parts.push(`Courbat. ${todayData.soreness}/5`);
    if (todayData.motivation) parts.push(`Motiv. ${todayData.motivation}/5`);
    sub.textContent = parts.join(' · ') || 'Saisie enregistrée';
    btn.textContent = 'Modifier';
  } else {
    sub.textContent = 'Aucune saisie pour aujourd\'hui';
    btn.textContent = '+ Saisir';
  }
}

function wireCta() {
  document.getElementById('wellness-open-btn')?.addEventListener('click', () => openModal());
  // Click sur toute la carte (sauf bouton) ouvre aussi la modal
  document.getElementById('wellness-cta')?.addEventListener('click', (e) => {
    if (e.target.closest('.wellness-cta-btn')) return;
    openModal();
  });
  // Bouton "Faire ma première saisie" dans la zone empty du panel Tendances
  document.getElementById('wellness-empty-cta')?.addEventListener('click', () => openModal());
}

// ============ CHART TENDANCES (panel Tendances long-terme) ============
let _wellnessChart = null;

function renderWellnessTrend() {
  const canvas = document.getElementById('chart-wellness-trend');
  const emptyEl = document.getElementById('wellness-empty');
  const summaryEl = document.getElementById('wellness-trend-summary');
  if (!canvas || !window.Chart) return;

  // Range : 60 derniers jours
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 60);
  const toIsoLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const fromIso = toIsoLocal(from);
  const toIso = toIsoLocal(today);

  const rows = getWellnessRange(fromIso, toIso);

  // Empty state
  if (!rows.length) {
    if (canvas.parentElement) canvas.parentElement.style.display = 'none';
    if (summaryEl) summaryEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (canvas.parentElement) canvas.parentElement.style.display = '';
  if (emptyEl) emptyEl.hidden = true;

  // Construction d'une vue continue 60j (avec null pour les jours non saisis)
  const allDates = [];
  const allMap = Object.fromEntries(rows.map(r => [r.date, r]));
  let cursor = new Date(from);
  while (cursor <= today) {
    allDates.push(toIsoLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const labels = allDates.map(d => {
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  });

  const series = {
    weight: { data: [], color: '#a78bfa', label: 'Poids (kg)', axis: 'y1' },
    mood: { data: [], color: '#4ade80', label: 'Humeur', axis: 'y' },
    fatigue: { data: [], color: '#f87171', label: 'Fatigue', axis: 'y' },
    soreness: { data: [], color: '#fbbf24', label: 'Courbatures', axis: 'y' },
    motivation: { data: [], color: '#60a5fa', label: 'Motivation', axis: 'y' },
  };
  for (const iso of allDates) {
    const r = allMap[iso];
    series.weight.data.push(r && r.weight != null ? r.weight : null);
    series.mood.data.push(r && r.mood != null ? r.mood : null);
    series.fatigue.data.push(r && r.fatigue != null ? r.fatigue : null);
    series.soreness.data.push(r && r.soreness != null ? r.soreness : null);
    series.motivation.data.push(r && r.motivation != null ? r.motivation : null);
  }

  // Résumé : nb de saisies + valeurs moyennes
  const avg = (arr) => {
    const v = arr.filter(x => x != null);
    if (!v.length) return null;
    return v.reduce((s, x) => s + x, 0) / v.length;
  };
  const summary = [
    { label: 'Saisies', value: `<strong>${rows.length}</strong>` },
    { label: 'Poids moyen', value: avg(series.weight.data) != null ? `<strong>${avg(series.weight.data).toFixed(1)}</strong> kg` : '—' },
    { label: 'Humeur', value: avg(series.mood.data) != null ? `<strong>${avg(series.mood.data).toFixed(1)}</strong>/5` : '—' },
    { label: 'Fatigue', value: avg(series.fatigue.data) != null ? `<strong>${avg(series.fatigue.data).toFixed(1)}</strong>/5` : '—' },
    { label: 'Motivation', value: avg(series.motivation.data) != null ? `<strong>${avg(series.motivation.data).toFixed(1)}</strong>/5` : '—' },
  ];
  if (summaryEl) {
    summaryEl.innerHTML = summary
      .map(s => `<span>${s.label} : ${s.value}</span>`)
      .join('');
  }

  // Détruit l'ancienne instance
  if (_wellnessChart) { _wellnessChart.destroy(); _wellnessChart = null; }

  _wellnessChart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: series.mood.label, data: series.mood.data, borderColor: series.mood.color, backgroundColor: series.mood.color + '20', tension: 0.3, yAxisID: 'y', spanGaps: true, pointRadius: 2 },
        { label: series.fatigue.label, data: series.fatigue.data, borderColor: series.fatigue.color, backgroundColor: series.fatigue.color + '20', tension: 0.3, yAxisID: 'y', spanGaps: true, pointRadius: 2 },
        { label: series.soreness.label, data: series.soreness.data, borderColor: series.soreness.color, backgroundColor: series.soreness.color + '20', tension: 0.3, yAxisID: 'y', spanGaps: true, pointRadius: 2 },
        { label: series.motivation.label, data: series.motivation.data, borderColor: series.motivation.color, backgroundColor: series.motivation.color + '20', tension: 0.3, yAxisID: 'y', spanGaps: true, pointRadius: 2 },
        { label: series.weight.label, data: series.weight.data, borderColor: series.weight.color, backgroundColor: series.weight.color + '20', borderWidth: 2.5, tension: 0.3, yAxisID: 'y1', spanGaps: true, pointRadius: 2, borderDash: [4, 4] },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#e6e9ef', font: { size: 11 }, boxWidth: 14 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { ticks: { color: '#8b94a8', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: '#232a3a' } },
        y: { position: 'left', min: 1, max: 5, ticks: { color: '#8b94a8', stepSize: 1 }, grid: { color: '#232a3a' }, title: { display: true, text: 'Subjectif (1-5)', color: '#8b94a8' } },
        y1: { position: 'right', ticks: { color: '#a78bfa' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Poids (kg)', color: '#a78bfa' } },
      },
    },
  });
}

// ============ BOOTSTRAP ============
function init() {
  wireModal();
  wireCta();
  refreshCta();
  // Le chart est rendu une fois que le DOM + Chart.js sont prêts.
  // Petit délai pour laisser Chart.js (chargé en <script>) finir de s'initialiser.
  setTimeout(renderWellnessTrend, 100);
}

// Re-render quand l'utilisateur sauvegarde depuis n'importe où
window.addEventListener('wellnessChange', () => {
  refreshCta();
  renderWellnessTrend();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Exposer pour debug & accès depuis d'autres modules
window.openWellnessModal = openModal;
window.renderWellnessTrend = renderWellnessTrend;
