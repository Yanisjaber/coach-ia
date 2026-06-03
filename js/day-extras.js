/* ============================================================
   js/day-extras.js — Actions rapides sur un jour du calendrier

   Quand on survole un jour VIDE du calendrier, un bouton "+" apparaît.
   Au clic : popover avec 4 actions :
     - Ajouter un entraînement (raccourci vers la modal existante)
     - Ajouter une note (modal note simple)
     - Marquer le jour en repos (toggle)
     - Ajouter un cycle / phase d'entraînement (modal phase)

   Stockage :
     - Notes      : localStorage 'coach_ia_day_notes_v1' = { iso: "texte" }
     - Phases     : localStorage 'coach_ia_phases_v1' = [ {from, to, phase, name} ]
     - Repos      : utilise window.addTemplateRestDay / removeTemplateRestDay (déjà en place)

   Auto-bootstrap au DOMContentLoaded. Réagit aux re-render du calendrier
   en attachant les listeners en délégation sur #week-calendar.
   ============================================================ */

// ============ STORAGE ============
const NOTES_KEY = 'coach_ia_day_notes_v1';   // legacy (texte par jour)
const NOTES_V2_KEY = 'coach_ia_notes_v2';    // nouveau : notes typées, sur plage de dates, avec couleur
const PHASES_KEY = 'coach_ia_phases_v1';

// Types de note + couleur par défaut
export const NOTE_TYPES = {
  maladie:  { label: 'Maladie',  color: '#f87171' },
  blessure: { label: 'Blessure', color: '#fb923c' },
  texte:    { label: 'Note',     color: '#60a5fa' },
};
// Palette de couleurs proposée
export const NOTE_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#4ade80', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#94a3b8'];

// Icônes par type pour les bandeaux : croix de pharmacie (maladie), ambulance (blessure).
const NOTE_ICONS = {
  maladie: '<svg class="note-band-icon" viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
  blessure: '<svg class="note-band-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><circle cx="7" cy="18" r="2"/><path d="M9 18h6"/><circle cx="17" cy="18" r="2"/></svg>',
};

// ----- legacy (conservé pour compat / migration) -----
export function loadNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); }
  catch { return {}; }
}
export function getNote(iso) { return loadNotes()[iso] || ''; }

// ----- notes v2 (typées, plage, couleur) -----
export function loadNotesV2() {
  try { return JSON.parse(localStorage.getItem(NOTES_V2_KEY) || '[]'); }
  catch { return []; }
}
function _saveNotesV2(arr) {
  localStorage.setItem(NOTES_V2_KEY, JSON.stringify(arr));
  triggerCalendarRefresh();
}
export function upsertNote(note) {
  // note: {id, type, text, color, from, to, _sbId?}
  const arr = loadNotesV2();
  const idx = arr.findIndex(n => n.id === note.id);
  if (idx >= 0) arr[idx] = note; else arr.push(note);
  _saveNotesV2(arr);
  if (window.cloudSync && window.cloudSync.pushNoteRange) {
    window.cloudSync.pushNoteRange(note).then(sbId => {
      if (sbId && note._sbId !== sbId) {
        note._sbId = sbId;
        _saveNotesV2(loadNotesV2().map(n => n.id === note.id ? note : n));
      }
    });
  }
}
export function removeNote(id) {
  const arr = loadNotesV2();
  const toDel = arr.find(n => n.id === id);
  _saveNotesV2(arr.filter(n => n.id !== id));
  if (window.cloudSync && window.cloudSync.deleteNoteRange && toDel) window.cloudSync.deleteNoteRange(toDel);
}
export function notesForDate(iso) {
  return loadNotesV2().filter(n => iso >= n.from && iso <= n.to);
}
// Convertit une fois les anciennes notes (texte par jour) en notes v2 (type 'texte').
function migrateLegacyNotes() {
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch { legacy = {}; }
  const keys = Object.keys(legacy || {});
  if (!keys.length) return;
  const arr = loadNotesV2();
  for (const iso of keys) {
    const text = legacy[iso];
    if (!text) continue;
    if (arr.some(n => n.from === iso && n.to === iso && n.text === text)) continue;
    const note = { id: 'mig-' + iso, type: 'texte', text, color: NOTE_TYPES.texte.color, from: iso, to: iso };
    arr.push(note);
    if (window.cloudSync && window.cloudSync.pushNoteRange) window.cloudSync.pushNoteRange(note);
  }
  localStorage.setItem(NOTES_V2_KEY, JSON.stringify(arr));
  localStorage.removeItem(NOTES_KEY);
}

export function loadPhases() {
  try { return JSON.parse(localStorage.getItem(PHASES_KEY) || '[]'); }
  catch { return []; }
}
export function savePhases(arr) {
  localStorage.setItem(PHASES_KEY, JSON.stringify(arr));
  triggerCalendarRefresh();
}
export function addPhase(phase) {
  // phase : {from, to, phase: 'base'|'build'|'peak'|'taper'|'recup', name?}
  const arr = loadPhases();
  const newPhase = { ...phase, id: Date.now().toString() };
  arr.push(newPhase);
  savePhases(arr);
  // Mirror cloud, et stocker le _sbId retourné
  if (window.cloudSync) {
    window.cloudSync.pushPhase(newPhase).then(sbId => {
      if (sbId) {
        newPhase._sbId = sbId;
        savePhases(loadPhases().map(p => p.id === newPhase.id ? newPhase : p));
      }
    });
  }
}
export function removePhase(id) {
  const all = loadPhases();
  const toDelete = all.find(p => p.id === id);
  savePhases(all.filter(p => p.id !== id));
  if (window.cloudSync && toDelete) window.cloudSync.deletePhase(toDelete);
}
export function getPhaseForDate(iso) {
  return loadPhases().find(p => iso >= p.from && iso <= p.to) || null;
}

// Liste des phases avec leurs couleurs (pour bandeau)
export const PHASE_DEFS = {
  base:   { label: 'Base',   color: '#60a5fa', desc: 'Endurance & fondations' },
  build:  { label: 'Build',  color: '#4ade80', desc: 'Charge progressive' },
  peak:   { label: 'Peak',   color: '#fbbf24', desc: 'Intensité maximale' },
  taper:  { label: 'Taper',  color: '#a78bfa', desc: 'Affûtage avant compé' },
  recup:  { label: 'Récup',  color: '#94a3b8', desc: 'Décharge / récupération' },
};

// ============ TRIGGER CALENDAR REFRESH ============
function triggerCalendarRefresh() {
  if (typeof window.renderCalendar === 'function') window.renderCalendar();
}

// ============ POPOVER ACTIONS ============
let _activePopover = null;

function closePopover() {
  if (_activePopover) {
    _activePopover.remove();
    _activePopover = null;
    document.removeEventListener('click', _onOutsideClick);
  }
}
function _onOutsideClick(e) {
  if (_activePopover && !_activePopover.contains(e.target) && !e.target.closest('.day-add-btn')) {
    closePopover();
  }
}

function openPopover(iso, anchorEl) {
  closePopover();
  const popover = document.createElement('div');
  popover.className = 'day-popover';
  const isRest = window.isTemplateRestDay && window.isTemplateRestDay(iso);
  const note = getNote(iso);
  const phase = getPhaseForDate(iso);

  // SVG icons (lucide-style) — sans emoji
  const ICONS = {
    training: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2"/></svg>',
    competition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    rest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    phase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  };

  popover.innerHTML = `
    <div class="day-popover-header">${formatPopoverDate(iso)}</div>
    <button class="day-popover-action" data-action="training">
      <span class="day-popover-icon">${ICONS.training}</span>
      <span>Ajouter un entraînement</span>
    </button>
    <button class="day-popover-action" data-action="competition">
      <span class="day-popover-icon">${ICONS.competition}</span>
      <span>Ajouter une compétition</span>
    </button>
    <button class="day-popover-action" data-action="note">
      <span class="day-popover-icon">${ICONS.note}</span>
      <span>${note ? 'Modifier la note' : 'Ajouter une note'}</span>
    </button>
    <button class="day-popover-action ${isRest ? 'is-active' : ''}" data-action="rest">
      <span class="day-popover-icon">${ICONS.rest}</span>
      <span>${isRest ? 'Annuler le repos' : 'Marquer en repos'}</span>
    </button>
    <button class="day-popover-action" data-action="phase">
      <span class="day-popover-icon">${ICONS.phase}</span>
      <span>${phase ? 'Modifier la phase' : 'Ajouter un cycle (phase)'}</span>
    </button>
  `;

  document.body.appendChild(popover);

  // Position : à côté du bouton qui a déclenché (ou centré sur le jour)
  const rect = anchorEl.getBoundingClientRect();
  const popH = popover.offsetHeight;
  const popW = popover.offsetWidth;
  let top = rect.bottom + 6 + window.scrollY;
  let left = rect.left + window.scrollX;
  // Ajustement si dépasse à droite
  if (left + popW > window.innerWidth - 8) {
    left = window.innerWidth - popW - 8;
  }
  // Si dépasse en bas, mettre au-dessus
  if (rect.bottom + popH > window.innerHeight - 8) {
    top = rect.top - popH - 6 + window.scrollY;
  }
  popover.style.top = top + 'px';
  popover.style.left = left + 'px';

  _activePopover = popover;
  setTimeout(() => document.addEventListener('click', _onOutsideClick), 0);

  // Wire actions
  popover.querySelectorAll('.day-popover-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      closePopover();
      handleAction(action, iso);
    });
  });
}

function handleAction(action, iso) {
  try {
    return _handleActionInner(action, iso);
  } catch (e) {
    console.error('[day-extras] handleAction error for', action, iso, e);
    notify('Erreur : ' + (e.message || e), 'Erreur');
  }
}
function _handleActionInner(action, iso) {
  switch (action) {
    case 'training':
      if (typeof window.openTrainModal === 'function') {
        // Mode selon le sous-onglet actif du calendrier : Réalisé → 'realise', sinon 'prevu'
        const _mode = document.querySelector('#calendar-subtabs .subtab.active')?.dataset.mode === 'realise' ? 'realise' : 'prevu';
        window.openTrainModal(_mode);
        // Pré-remplir la date dans la modal
        const dateInp = document.getElementById('train-modal-date');
        if (dateInp) {
          dateInp.value = iso;
          if (dateInp._flatpickr) dateInp._flatpickr.setDate(iso, false);
        }
      } else {
        console.warn('[day-extras] openTrainModal pas disponible sur window');
      }
      break;
    case 'competition':
      if (typeof window.openCompModal === 'function') {
        window.openCompModal();
        // Pré-remplir la date
        const dateInp = document.getElementById('comp-modal-date');
        if (dateInp) {
          dateInp.value = iso;
          if (dateInp._flatpickr) dateInp._flatpickr.setDate(iso, false);
        }
      } else {
        console.warn('[day-extras] openCompModal pas disponible sur window');
      }
      break;
    case 'note':
      openNoteModal(iso);
      break;
    case 'rest':
      if (typeof window.toggleTemplateRestDay === 'function') {
        window.toggleTemplateRestDay(iso);
        triggerCalendarRefresh();
      } else {
        console.warn('[day-extras] toggleTemplateRestDay pas disponible sur window');
      }
      break;
    case 'phase':
      openPhaseModal(iso);
      break;
  }
}

function formatPopoverDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ============ MODAL NOTE (typée, plage, couleur) ============
// Depuis le "+" d'un jour → nouvelle note (from=to=jour).
// Depuis un clic sur un bandeau → édition de la note existante.
function openNoteModal(iso) {
  openNoteEditor({
    id: 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: 'texte', text: '', color: NOTE_TYPES.texte.color, from: iso, to: iso,
  }, true);
}

function openNoteEditor(note, isNew) {
  closeAnyDayModal();
  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.id = '_day-note-modal';

  let curType = note.type || 'texte';
  let curColor = note.color || NOTE_TYPES[curType].color;

  const typeChips = Object.entries(NOTE_TYPES).map(([k, v]) =>
    `<button type="button" class="note-type-chip${k === curType ? ' active' : ''}" data-type="${k}">${v.label}</button>`
  ).join('');
  const colorSwatches = NOTE_COLORS.map(c =>
    `<button type="button" class="note-color-swatch${c === curColor ? ' active' : ''}" data-color="${c}" style="background:${c};"></button>`
  ).join('');

  overlay.innerHTML = `
    <div class="day-modal day-modal-note">
      <div class="day-modal-header">
        <h3>${isNew ? 'Nouvelle note' : 'Modifier la note'}</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        <label class="note-field-label">Type</label>
        <div class="note-type-chips">${typeChips}</div>
        <label class="note-field-label">Description</label>
        <textarea id="_note-text" rows="3" placeholder="Ex : Grippe, tendinite au genou, déplacement pro…">${escapeHtml(note.text || '')}</textarea>
        <div class="note-range-row">
          <div><label class="note-field-label">Du</label><input type="date" id="_note-from" value="${note.from}"></div>
          <div><label class="note-field-label">Au</label><input type="date" id="_note-to" value="${note.to}"></div>
        </div>
        <label class="note-field-label">Couleur</label>
        <div class="note-color-row">${colorSwatches}</div>
      </div>
      <div class="day-modal-footer">
        ${isNew ? '' : '<button class="day-modal-delete" type="button">Supprimer</button>'}
        <div style="flex:1;"></div>
        <button class="day-modal-cancel" type="button">Annuler</button>
        <button class="day-modal-save" type="button">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const setActiveColor = (c) => {
    curColor = c;
    overlay.querySelectorAll('.note-color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === c));
  };
  overlay.querySelectorAll('.note-type-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prevDefault = NOTE_TYPES[curType].color;
      overlay.querySelectorAll('.note-type-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      curType = chip.dataset.type;
      // Si la couleur courante était celle du type précédent (non personnalisée), on adopte celle du nouveau type
      if (curColor === prevDefault) setActiveColor(NOTE_TYPES[curType].color);
    });
  });
  overlay.querySelectorAll('.note-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => setActiveColor(sw.dataset.color));
  });
  overlay.querySelector('.day-modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.day-modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.day-modal-save').addEventListener('click', () => {
    let from = document.getElementById('_note-from').value || note.from;
    let to = document.getElementById('_note-to').value || from;
    if (to < from) { const t = from; from = to; to = t; }
    const text = document.getElementById('_note-text').value.trim();
    upsertNote({ ...note, type: curType, color: curColor, text, from, to });
    overlay.remove();
  });
  const delBtn = overlay.querySelector('.day-modal-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDelete('Supprimer cette note ?');
      if (ok) { removeNote(note.id); overlay.remove(); }
    });
  }
  setTimeout(() => document.getElementById('_note-text')?.focus(), 50);
}

// ============ MODAL PHASE ============
// Deux modes :
//   - 'view' (défaut si une phase existe pour iso) : affiche les infos + bouton "..."
//   - 'edit' (défaut sinon) : formulaire avec choix phase + dates
function openPhaseModal(iso, mode) {
  const existing = getPhaseForDate(iso);
  if (!mode) mode = existing ? 'view' : 'edit';
  if (mode === 'view' && !existing) mode = 'edit';

  closeAnyDayModal();
  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.id = '_day-phase-modal';

  // === MODE VIEW : affichage en lecture ===
  if (mode === 'view') {
    const def = PHASE_DEFS[existing.phase] || { label: existing.phase, color: '#94a3b8', desc: '' };
    // Durée totale (jours)
    const dFrom = new Date(existing.from + 'T12:00:00');
    const dTo = new Date(existing.to + 'T12:00:00');
    const durDays = Math.round((dTo - dFrom) / (1000 * 60 * 60 * 24)) + 1;
    const dateLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

    overlay.innerHTML = `
      <div class="day-modal day-modal-phase">
        <div class="day-modal-header">
          <h3>Cycle d'entraînement</h3>
          <div class="day-modal-header-actions">
            <div class="day-note-menu-wrap">
              <button class="day-note-menu-btn" type="button" title="Options">...</button>
              <div class="day-note-menu" hidden>
                <button type="button" data-action="edit">Modifier</button>
                <button type="button" data-action="delete">Supprimer</button>
              </div>
            </div>
            <button class="day-modal-close" type="button" title="Fermer">×</button>
          </div>
        </div>
        <div class="day-modal-body">
          <div class="phase-view-card" style="border-left:4px solid ${def.color};background:linear-gradient(90deg, ${def.color}1a, transparent);">
            <div class="phase-view-type" style="color:${def.color};">${escapeHtml(def.label)}</div>
            ${existing.name ? `<div class="phase-view-name">${escapeHtml(existing.name)}</div>` : ''}
            <div class="phase-view-desc">${escapeHtml(def.desc || '')}</div>
          </div>
          <div class="phase-view-meta">
            <div><span class="phase-view-meta-lbl">Du</span> <strong>${dateLabel(existing.from)}</strong></div>
            <div><span class="phase-view-meta-lbl">Au</span> <strong>${dateLabel(existing.to)}</strong></div>
            <div><span class="phase-view-meta-lbl">Durée</span> <strong>${durDays} jour${durDays > 1 ? 's' : ''}</strong></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.day-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Bouton "..." → menu Modifier / Supprimer
    const menuBtn = overlay.querySelector('.day-note-menu-btn');
    const menu = overlay.querySelector('.day-note-menu');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    overlay.addEventListener('click', (e) => {
      if (!e.target.closest('.day-note-menu-wrap')) menu.hidden = true;
    });
    menu.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'edit') {
          overlay.remove();
          openPhaseModal(iso, 'edit');
        } else if (action === 'delete') {
          const ok = await confirmDelete('Supprimer cette phase ?');
          if (!ok) return;
          removePhase(existing.id);
          overlay.remove();
        }
      });
    });
    return;
  }

  // === MODE EDIT : formulaire ===
  // Date de fin par défaut : iso + 13 jours (2 semaines)
  const defaultEnd = (() => {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + 13);
    return d.toISOString().slice(0, 10);
  })();

  const phaseOpts = Object.entries(PHASE_DEFS).map(([k, v]) =>
    `<button class="phase-pick ${existing && existing.phase === k ? 'selected' : ''}" data-phase="${k}" style="border-color:${v.color};">
      <span class="phase-pick-dot" style="background:${v.color};"></span>
      <strong>${v.label}</strong>
      <span class="phase-pick-desc">${v.desc}</span>
    </button>`
  ).join('');

  overlay.innerHTML = `
    <div class="day-modal day-modal-phase">
      <div class="day-modal-header">
        <h3>${existing ? 'Modifier la phase' : 'Ajouter un cycle d\'entraînement'}</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        <div class="phase-pick-grid">${phaseOpts}</div>
        <div class="phase-range-row">
          <label>
            <span>Du</span>
            <input type="date" id="_phase-from" value="${existing ? existing.from : iso}">
          </label>
          <label>
            <span>Au</span>
            <input type="date" id="_phase-to" value="${existing ? existing.to : defaultEnd}">
          </label>
        </div>
        <label class="phase-name-label">
          <span>Nom (optionnel)</span>
          <input type="text" id="_phase-name" value="${existing ? escapeHtml(existing.name || '') : ''}" placeholder="ex. Bloc spécifique Granfondo">
        </label>
      </div>
      <div class="day-modal-footer">
        ${existing ? '<button class="day-modal-delete" type="button">Supprimer cette phase</button>' : ''}
        <div style="flex:1;"></div>
        <button class="day-modal-cancel" type="button">Annuler</button>
        <button class="day-modal-save" type="button">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let selectedPhase = existing ? existing.phase : null;
  overlay.querySelectorAll('.phase-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPhase = btn.dataset.phase;
      overlay.querySelectorAll('.phase-pick').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  overlay.querySelector('.day-modal-close').addEventListener('click', () => {
    overlay.remove();
    if (existing) openPhaseModal(iso, 'view');
  });
  overlay.querySelector('.day-modal-cancel').addEventListener('click', () => {
    overlay.remove();
    if (existing) openPhaseModal(iso, 'view');
  });
  overlay.querySelector('.day-modal-save').addEventListener('click', async () => {
    try {
      if (!selectedPhase) {
        await notify('Choisis une phase (Base, Build, Peak, Taper ou Récup)', 'Phase manquante');
        return;
      }
      const from = document.getElementById('_phase-from').value;
      const to = document.getElementById('_phase-to').value;
      if (!from || !to || from > to) {
        await notify('Plage de dates invalide', 'Dates incorrectes');
        return;
      }
      const name = document.getElementById('_phase-name').value.trim();
      const wasUpdate = !!existing;
      // IMPORTANT : on retire la modal AVANT de trigger le re-render du calendrier
      overlay.remove();
      if (existing) {
        const updated = { ...existing, phase: selectedPhase, from, to, name: name || undefined };
        const arr = loadPhases().map(p => p.id === existing.id ? updated : p);
        savePhases(arr);
        // Mirror cloud
        if (window.cloudSync) window.cloudSync.pushPhase(updated);
      } else {
        addPhase({ phase: selectedPhase, from, to, name: name || undefined });
      }
      // Après MODIFICATION : on revient en mode view (cohérent avec le flux d'édition)
      // Après CRÉATION : on ferme simplement, l'utilisateur verra le bandeau apparaître
      if (wasUpdate) {
        const newViewIso = from <= iso && iso <= to ? iso : from;
        setTimeout(() => openPhaseModal(newViewIso, 'view'), 50);
      }
    } catch (e) {
      console.error('[day-extras] Erreur sauvegarde phase:', e);
      await notify('Erreur lors de la sauvegarde : ' + (e.message || e), 'Erreur');
    }
  });
  const delBtn = overlay.querySelector('.day-modal-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDelete('Supprimer cette phase ?');
      if (!ok) return;
      if (existing) removePhase(existing.id);
      overlay.remove();
    });
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      if (existing) openPhaseModal(iso, 'view');
    }
  });
}

function closeAnyDayModal() {
  document.querySelectorAll('.day-modal-overlay').forEach(o => o.remove());
}

// ============ INJECT BOUTON "+" SUR LES JOURS ============
// On utilise la délégation : un seul listener sur le conteneur du calendrier.
// Le bouton est ajouté en CSS via :hover sur les .day-card.empty-past,
// ou bien on l'ajoute en JS à chaque render du calendrier.
function attachAddButtons() {
  const root = document.getElementById('week-calendar');
  if (!root) return;
  root.querySelectorAll('.day-card').forEach(card => {
    if (card.querySelector('.day-add-btn')) return; // déjà ajouté
    const iso = card.dataset.iso;
    if (!iso) return;
    // Ajoute le bouton à toutes les day-cards (vides ou pleines).
    // Le bouton n'est visible qu'au hover via CSS, et seulement sur l'onglet Prévu.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-add-btn';
    btn.title = 'Actions rapides : entraînement, note, repos, cycle';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // ne pas déclencher le clic sur la card (qui ouvre la modal détail)
      openPopover(iso, btn);
    });
    card.appendChild(btn);
    // (Les notes s'affichent désormais en bandeaux via injectNoteBanners, plus de tag inline.)
  });
}

// ============ BANDEAUX DE PHASE au-dessus des jours ============
// Pour chaque semaine, on regarde les 7 jours et on construit des bandes
// horizontales positionnées dans le même grid que les day-cards.
// Chaque bande couvre les colonnes correspondant aux jours concernés par une phase.
function injectPhaseBanners() {
  const root = document.getElementById('week-calendar');
  if (!root) return;
  const allPhases = loadPhases().filter(p => !window.coachModeKeep || window.coachModeKeep(p.ia));
  root.querySelectorAll('.week-row').forEach(row => {
    // Nettoyer un ancien container de phase si présent
    const old = row.querySelector('.phase-row');
    if (old) old.remove();

    const cards = row.querySelectorAll('.day-card[data-iso]');
    if (!cards.length || allPhases.length === 0) return;

    // Construire la liste des phases par colonne (1 à 7)
    // colPhase[i] = { id, def } ou null
    const isos = Array.from(cards).map(c => c.dataset.iso);
    const colPhase = isos.map(iso => {
      const p = allPhases.find(ph => iso >= ph.from && iso <= ph.to);
      if (!p) return null;
      const def = PHASE_DEFS[p.phase];
      if (!def) return null;
      return { phase: p, def };
    });
    // Si aucune phase nulle part dans la semaine → ne rien insérer
    if (colPhase.every(c => c === null)) return;

    // Grouper les jours consécutifs avec la même phase (par id)
    const groups = []; // [{phaseObj, startCol, endCol}]
    let i = 0;
    while (i < colPhase.length) {
      if (!colPhase[i]) { i++; continue; }
      const startCol = i + 1; // grid-column 1-based
      const currentId = colPhase[i].phase.id;
      let j = i;
      while (j + 1 < colPhase.length && colPhase[j + 1] && colPhase[j + 1].phase.id === currentId) {
        j++;
      }
      const endCol = j + 2; // grid-column-end est exclusif
      groups.push({ phaseObj: colPhase[i], startCol, endCol });
      i = j + 1;
    }
    if (!groups.length) return;

    // Construire le DOM : .phase-row > .phase-band (×N)
    const phaseRow = document.createElement('div');
    phaseRow.className = 'phase-row';
    groups.forEach(g => {
      const { phase, def } = g.phaseObj;
      const label = phase.name ? `${def.label} · ${phase.name}` : def.label;
      const band = document.createElement('div');
      band.className = 'phase-band';
      band.dataset.phaseId = phase.id;
      band.style.gridColumn = `${g.startCol} / ${g.endCol}`;
      band.style.background = `linear-gradient(90deg, ${def.color}38, ${def.color}18)`;
      band.style.borderLeft = `3px solid ${def.color}`;
      band.style.color = def.color;
      band.title = `Cliquer pour modifier (${phase.from} → ${phase.to})`;
      band.innerHTML = `<span class="phase-band-dot" style="background:${def.color};"></span><span class="phase-band-label">${escapeHtml(label)}</span>`;
      // Click → ouvrir modal phase en mode VIEW (lecture)
      band.addEventListener('click', (e) => {
        e.stopPropagation();
        const firstIso = isos[g.startCol - 1];
        console.log('[day-extras] click bandeau phase, firstIso=', firstIso);
        try {
          openPhaseModal(firstIso, 'view');
        } catch (err) {
          console.error('[day-extras] erreur openPhaseModal view:', err);
        }
      });
      phaseRow.appendChild(band);
    });

    // Insérer la phaseRow juste AVANT week-row-days
    const daysEl = row.querySelector('.week-row-days');
    if (daysEl) row.insertBefore(phaseRow, daysEl);
    else row.appendChild(phaseRow);
  });
}

// ============ BANDEAUX DE NOTE (maladie / blessure / texte) ============
// Une bande colorée par note, couvrant les colonnes de sa plage de dates dans
// la semaine. Chaque note occupe sa propre ligne (pas de collision). Clic = édition.
function injectNoteBanners() {
  const root = document.getElementById('week-calendar');
  if (!root) return;
  const allNotes = loadNotesV2().filter(n => !window.coachModeKeep || window.coachModeKeep(n.ia));
  root.querySelectorAll('.week-row').forEach(row => {
    // Nettoyer d'anciennes lignes de note
    row.querySelectorAll('.note-row').forEach(el => el.remove());
    const cards = row.querySelectorAll('.day-card[data-iso]');
    if (!cards.length || allNotes.length === 0) return;
    const isos = Array.from(cards).map(c => c.dataset.iso);
    const daysEl = row.querySelector('.week-row-days');

    allNotes.forEach(note => {
      // Colonnes couvertes par la note dans cette semaine
      let startCol = null, endCol = null;
      isos.forEach((iso, idx) => {
        if (iso >= note.from && iso <= note.to) {
          if (startCol === null) startCol = idx + 1;
          endCol = idx + 2;
        }
      });
      if (startCol === null) return; // note absente de cette semaine

      const typeLabel = (NOTE_TYPES[note.type] && NOTE_TYPES[note.type].label) || 'Note';
      const label = note.text ? note.text : typeLabel;
      const color = note.color || '#60a5fa';

      const noteRow = document.createElement('div');
      noteRow.className = 'note-row';
      const band = document.createElement('div');
      band.className = 'note-band';
      band.dataset.noteId = note.id;
      band.style.gridColumn = `${startCol} / ${endCol}`;
      band.style.background = `linear-gradient(90deg, ${color}38, ${color}18)`;
      band.style.borderLeft = `3px solid ${color}`;
      band.style.color = color;
      band.title = `${typeLabel} (${note.from} → ${note.to}) — cliquer pour modifier`;
      const marker = NOTE_ICONS[note.type] || `<span class="note-band-dot" style="background:${color};"></span>`;
      band.innerHTML = `${marker}<span class="note-band-label">${escapeHtml(label)}</span>`;
      band.addEventListener('click', (e) => {
        e.stopPropagation();
        openNoteEditor(note, false);
      });
      noteRow.appendChild(band);
      if (daysEl) row.insertBefore(noteRow, daysEl);
      else row.appendChild(noteRow);
    });
  });
}

// ============ HOOK : observer le calendrier pour ré-attacher après render ============
// IMPORTANT : safeAttach() modifie le DOM (ajout de boutons + et de phase-row).
// Pour éviter une boucle infinie avec le MutationObserver, on déconnecte le
// observer pendant nos propres modifications, puis on le reconnecte.
let _observer = null;
let _observerRoot = null;
let _pendingAttach = null;
let _attachInProgress = false;

function safeAttach() {
  if (_attachInProgress) return;
  _attachInProgress = true;
  // Suspend le observer pour éviter que nos propres modifs ne déclenchent
  // une nouvelle exécution (boucle infinie)
  if (_observer) _observer.disconnect();
  try { attachAddButtons(); }
  catch (e) { console.error('[day-extras] attachAddButtons error:', e); }
  try { injectPhaseBanners(); }
  catch (e) { console.error('[day-extras] injectPhaseBanners error:', e); }
  try { injectNoteBanners(); }
  catch (e) { console.error('[day-extras] injectNoteBanners error:', e); }
  // Reconnecte
  if (_observer && _observerRoot) {
    _observer.observe(_observerRoot, { childList: true, subtree: true });
  }
  _attachInProgress = false;
}

function setupCalendarObserver() {
  const root = document.getElementById('week-calendar');
  if (!root) return;
  _observerRoot = root;
  // Premier pass
  safeAttach();
  // MutationObserver throttled via rAF
  if (_observer) _observer.disconnect();
  _observer = new MutationObserver(() => {
    if (_pendingAttach || _attachInProgress) return;
    _pendingAttach = requestAnimationFrame(() => {
      _pendingAttach = null;
      safeAttach();
    });
  });
  _observer.observe(root, { childList: true, subtree: true });
}

// ============ UTILS ============
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

// Wrapper qui utilise la modal custom appConfirm/appAlert de l'app si disponible,
// sinon fallback sur confirm/alert natifs.
async function confirmDelete(message) {
  if (typeof window.appConfirm === 'function') {
    return await window.appConfirm({
      title: 'Confirmer',
      message,
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    });
  }
  return window.confirm(message);
}
async function notify(message, title) {
  if (typeof window.appAlert === 'function') {
    await window.appAlert({ title: title || 'Attention', message });
    return;
  }
  window.alert(message);
}

// ============ INIT ============
function init() {
  try { migrateLegacyNotes(); } catch (e) { console.warn('[day-extras] migrate notes:', e); }
  setupCalendarObserver();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
// Re-migrer après pull cloud (les notes legacy peuvent arriver à la connexion)
window.addEventListener('coach-ia-auth', () => {
  setTimeout(() => { try { migrateLegacyNotes(); } catch (e) {} }, 1500);
});

// Expose pour debug
window.openDayPopover = openPopover;
window.openNoteModal = openNoteModal;
window.openPhaseModal = openPhaseModal;
