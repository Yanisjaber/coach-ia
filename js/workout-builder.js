/* ============================================================
   js/workout-builder.js — Constructeur de séance structurée

   Permet de définir une séance par BLOCS d'intervalles dans la modal
   d'ajout d'entraînement prévu. Chaque bloc :
     { dur: minutes, target: %FTP, reps: 1 }
   Ou un "repeat" (groupe de blocs répétés N fois) :
     { type: 'repeat', reps: N, blocks: [...] }

   Le profil de puissance est prévisualisé en canvas et le TSS est
   calculé automatiquement (IF² × durée_h × 100).

   API exposée :
     - getCurrentStructure() : retourne [] ou la structure courante
     - setStructure(blocks)  : charge une structure pour édition
     - computeTotals(blocks) : { duration, tss }
   ============================================================ */

const STORAGE_DRAFT_KEY = '_coach_ia_workout_draft';

// État local de la modal (réinitialisé à chaque ouverture)
let blocks = [];   // flat list de blocs (les repeats sont expandés)

const DEFAULT_BLOCKS = {
  'warmup':    { label: 'Échauffement', dur: 15, target: 55 },
  'endurance': { label: 'Z2 Endurance',  dur: 30, target: 70 },
  'tempo':     { label: 'Tempo',         dur: 15, target: 85 },
  'seuil':     { label: 'Seuil',         dur: 8,  target: 100 },
  'vo2':       { label: 'VO2max',        dur: 4,  target: 115 },
  'recup':     { label: 'Récup',         dur: 3,  target: 50 },
  'cooldown':  { label: 'Retour calme',  dur: 10, target: 55 },
};

// ============ STORAGE ============
function saveDraft() {
  try { sessionStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(blocks)); }
  catch (e) { /* ignore */ }
}
function loadDraft() {
  try {
    const raw = sessionStorage.getItem(STORAGE_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearDraft() {
  try { sessionStorage.removeItem(STORAGE_DRAFT_KEY); } catch (e) { /* ignore */ }
}

// ============ CALCULS ============
// Calcule la durée totale (min) et le TSS prévu pour une liste de blocs.
// Formule TSS Coggan : TSS = (durée_h) × (IF)² × 100  avec IF = target/100
export function computeTotals(blockList) {
  let duration = 0;
  let tssSum = 0;
  for (const b of blockList || []) {
    const reps = Math.max(1, b.reps || 1);
    const dur = (b.dur || 0) * reps;
    const intensity = (b.target || 0) / 100;
    duration += dur;
    tssSum += (dur / 60) * intensity * intensity * 100;
  }
  return { duration: Math.round(duration), tss: Math.round(tssSum) };
}

// Couleur d'un bloc selon son intensité cible (% FTP)
function colorForTarget(target) {
  if (target < 60) return '#94a3b8'; // gris (récup)
  if (target < 75) return '#60a5fa'; // bleu (endurance Z2)
  if (target < 88) return '#4ade80'; // vert (tempo)
  if (target < 95) return '#fbbf24'; // jaune (sweet spot)
  if (target < 106) return '#fb923c'; // orange (seuil)
  return '#f87171';                  // rouge (VO2max+)
}

// ============ RENDU ============
function renderBlocksList() {
  const wrap = document.getElementById('workout-blocks-list');
  if (!wrap) return;

  if (blocks.length === 0) {
    wrap.innerHTML = '<div class="workout-blocks-empty">Ajoute des blocs pour construire ta séance</div>';
    return;
  }

  const html = blocks.map((b, i) => {
    const reps = b.reps || 1;
    const isRep = reps > 1;
    return `
      <div class="workout-block${isRep ? ' is-repeat' : ''}" data-idx="${i}">
        <div class="workout-block-handle">⋮⋮</div>
        ${isRep ? `
          <div class="workout-block-input-wrap">
            <span class="workout-block-label">Reps</span>
            <input type="number" min="1" max="20" class="workout-reps-input" data-field="reps" value="${reps}">
            <span class="workout-block-unit">×</span>
          </div>
        ` : `
          <div class="workout-block-input-wrap">
            <span class="workout-block-label">Type</span>
            <span style="font-size:12px;color:${colorForTarget(b.target || 0)};font-weight:600;">${b.label || '—'}</span>
          </div>
        `}
        <div class="workout-block-input-wrap">
          <span class="workout-block-label">Durée</span>
          <input type="number" min="0" max="600" data-field="dur" value="${b.dur || 0}">
          <span class="workout-block-unit">min</span>
        </div>
        <div class="workout-block-input-wrap">
          <span class="workout-block-label">Cible</span>
          <input type="number" min="0" max="200" data-field="target" value="${b.target || 0}">
          <span class="workout-block-unit">%FTP</span>
        </div>
        <button type="button" class="workout-block-remove" data-action="remove" title="Supprimer ce bloc">×</button>
      </div>
    `;
  }).join('');

  wrap.innerHTML = html;

  // Wire les inputs
  wrap.querySelectorAll('.workout-block').forEach(blockEl => {
    const idx = parseInt(blockEl.dataset.idx, 10);
    blockEl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const field = inp.dataset.field;
        const v = parseFloat(inp.value) || 0;
        blocks[idx][field] = v;
        renderTotalsAndPreview();
        saveDraft();
      });
    });
    blockEl.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
      blocks.splice(idx, 1);
      renderAll();
      saveDraft();
    });
  });
}

function renderTotalsAndPreview() {
  const totals = computeTotals(blocks);
  const totalsEl = document.getElementById('workout-totals');
  if (totalsEl) {
    const h = Math.floor(totals.duration / 60);
    const m = totals.duration % 60;
    const durStr = h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    totalsEl.textContent = `${durStr} · TSS ${totals.tss}`;
  }
  renderPreview();

  // Auto-remplir le champ TSS et Durée de la modal principale (si activé)
  const toggle = document.getElementById('workout-structure-toggle');
  if (toggle && toggle.checked) {
    const tssInp = document.getElementById('train-modal-tss');
    const durInp = document.getElementById('train-modal-duration');
    if (tssInp && totals.tss > 0) tssInp.value = totals.tss;
    if (durInp && totals.duration > 0) durInp.value = totals.duration;
  }
}

function renderPreview() {
  const canvas = document.getElementById('workout-preview-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  // Resize en CSS pixels
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth || 400;
  const h = 80;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (blocks.length === 0) {
    ctx.fillStyle = '#5a6378';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Aperçu du profil de puissance', w / 2, h / 2 + 4);
    return;
  }

  // Construire la timeline expandée : on développe les reps en plusieurs barres
  // Pour simplifier, chaque bloc est une barre dont la largeur = sa durée
  const totalDur = blocks.reduce((s, b) => s + (b.dur || 0) * (b.reps || 1), 0);
  if (totalDur === 0) return;

  const padding = 4;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  const maxTarget = Math.max(120, ...blocks.map(b => b.target || 0));

  let x = padding;
  for (const b of blocks) {
    const reps = b.reps || 1;
    for (let r = 0; r < reps; r++) {
      const bw = ((b.dur || 0) / totalDur) * innerW;
      const bh = ((b.target || 0) / maxTarget) * innerH;
      const by = padding + (innerH - bh);
      ctx.fillStyle = colorForTarget(b.target || 0);
      ctx.fillRect(x, by, bw, bh);
      // Bordure légère
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.strokeRect(x, by, bw, bh);
      x += bw;
    }
  }

  // Ligne FTP horizontale
  const ftpY = padding + (innerH - (100 / maxTarget) * innerH);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding, ftpY);
  ctx.lineTo(w - padding, ftpY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('FTP', w - padding - 24, ftpY - 3);
}

function renderAll() {
  renderBlocksList();
  renderTotalsAndPreview();
}

// ============ API PUBLIQUE ============
export function getCurrentStructure() {
  const toggle = document.getElementById('workout-structure-toggle');
  if (!toggle || !toggle.checked) return null;
  return blocks.length > 0 ? JSON.parse(JSON.stringify(blocks)) : null;
}

export function setStructure(blockList) {
  blocks = Array.isArray(blockList) ? JSON.parse(JSON.stringify(blockList)) : [];
  const toggle = document.getElementById('workout-structure-toggle');
  if (toggle) {
    toggle.checked = blocks.length > 0;
    document.getElementById('workout-structure-body').hidden = !toggle.checked;
  }
  renderAll();
}

export function resetStructure() {
  blocks = [];
  const toggle = document.getElementById('workout-structure-toggle');
  if (toggle) toggle.checked = false;
  const body = document.getElementById('workout-structure-body');
  if (body) body.hidden = true;
  clearDraft();
  renderAll();
}

// ============ WIRING ============
function addBlock(presetKey) {
  const preset = DEFAULT_BLOCKS[presetKey] || DEFAULT_BLOCKS.endurance;
  blocks.push({ ...preset, reps: 1 });
  renderAll();
  saveDraft();
}

function addRepeat() {
  // Pour MVP : un "repeat" est un bloc unique dont reps > 1. On ajoute 2 blocs liés (effort + récup)
  blocks.push({ ...DEFAULT_BLOCKS.seuil, reps: 4 });
  blocks.push({ ...DEFAULT_BLOCKS.recup, reps: 4 });
  renderAll();
  saveDraft();
}

function init() {
  const toggle = document.getElementById('workout-structure-toggle');
  if (!toggle) return; // pas dans le DOM (autre page)

  const body = document.getElementById('workout-structure-body');
  toggle.addEventListener('change', () => {
    body.hidden = !toggle.checked;
    if (toggle.checked && blocks.length === 0) {
      // Premier toggle : on propose une séance par défaut (Échauffement + 1 bloc + Retour calme)
      blocks = [
        { ...DEFAULT_BLOCKS.warmup, reps: 1 },
        { ...DEFAULT_BLOCKS.endurance, reps: 1 },
        { ...DEFAULT_BLOCKS.cooldown, reps: 1 },
      ];
      renderAll();
      saveDraft();
    } else if (toggle.checked) {
      renderAll();
    }
  });

  document.getElementById('workout-add-block')?.addEventListener('click', () => addBlock('endurance'));
  document.getElementById('workout-add-repeat')?.addEventListener('click', () => addRepeat());

  // Recharger l'éventuel draft de la session
  const draft = loadDraft();
  if (draft && draft.length) {
    // Ne charge le draft que si pas en mode édition (sinon setStructure() prendra le dessus)
    if (!window._editingTrainId) {
      setStructure(draft);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose pour le code existant (save/load des trainings)
window.getCurrentWorkoutStructure = getCurrentStructure;
window.setWorkoutStructure = setStructure;
window.resetWorkoutStructure = resetStructure;
window.computeWorkoutTotals = computeTotals;
