/* ============================================================
   js/library.js — Bibliothèque de séances (modèles réutilisables)

   - Panneau à droite du calendrier (#seance-library)
   - Modèles classés par sport, catégories repliables, recherche + filtre
   - Glisser-déposer un modèle sur un jour du calendrier :
       · sous-mode "Prévu"   → crée une séance prévue
       · sous-mode "Réalisé" → crée une activité manuelle réalisée
     (via window.coachInsertTemplate, défini dans app.js)
   - Stockage local (coach_ia_templates_v1) + miroir Supabase (activity_template)
   ============================================================ */

const LIB_KEY = 'coach_ia_templates_v1';

const SPORTS = [
  { key: 'cyclisme',    label: 'Cyclisme',     color: '#3b82f6' },
  { key: 'vtt',         label: 'VTT',          color: '#b45309' },
  { key: 'course',      label: 'Course à pied', color: '#fc4c02' },
  { key: 'trail',       label: 'Trail',        color: '#15803d' },
  { key: 'natation',    label: 'Natation',     color: '#06b6d4' },
  { key: 'musculation', label: 'Musculation',  color: '#ef4444' },
  { key: 'autre',       label: 'Autre',        color: '#9ca3af' },
];
const SPORT_BY = Object.fromEntries(SPORTS.map(s => [s.key, s]));
function sportInfo(key) { return SPORT_BY[key] || SPORT_BY.autre; }

// ---- État local ----
let _filter = 'tous';
let _query = '';
const _collapsed = {};            // { sportKey: true } si replié
let _draggingId = null;           // modèle en cours de glissement

function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); }
  catch { return []; }
}
function saveTemplates(arr) {
  let prev = [];
  try { prev = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch {}
  const ids = new Set(arr.map(t => t.id));
  const deleted = prev.filter(p => !ids.has(p.id));
  localStorage.setItem(LIB_KEY, JSON.stringify(arr));
  if (window.cloudSync) {
    for (const t of arr) {
      if (window.cloudSync.pushTemplate) {
        window.cloudSync.pushTemplate(t).then(sbId => {
          if (sbId && !t._sbId) {
            t._sbId = sbId;
            try {
              const cur = loadTemplates();
              const i = cur.findIndex(x => x.id === t.id);
              if (i >= 0) { cur[i]._sbId = sbId; localStorage.setItem(LIB_KEY, JSON.stringify(cur)); }
            } catch {}
          }
        });
      }
    }
    for (const d of deleted) if (window.cloudSync.deleteTemplate) window.cloudSync.deleteTemplate(d);
  }
}

function fmtDur(min) {
  if (window.fmtDur) return window.fmtDur(min);
  min = Math.round(Number(min) || 0);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0');
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Rendu ----
function renderLibraryFilters(present) {
  const wrap = document.getElementById('lib-filters');
  if (!wrap) return;
  const chips = [{ key: 'tous', label: 'Tous' }, ...SPORTS.filter(s => present.has(s.key))];
  wrap.innerHTML = chips.map(c =>
    `<button type="button" class="lib-chip${_filter === c.key ? ' on' : ''}" data-filter="${c.key}">${esc(c.label)}</button>`
  ).join('');
  wrap.querySelectorAll('.lib-chip').forEach(b => b.addEventListener('click', () => {
    _filter = b.dataset.filter; renderLibrary();
  }));
}

function renderLibrary() {
  const body = document.getElementById('lib-body');
  const emptyEl = document.getElementById('lib-empty');
  if (!body) return;

  const all = loadTemplates();
  const present = new Set(all.map(t => t.sport || 'autre'));
  renderLibraryFilters(present);

  // Filtre + recherche
  let list = all;
  if (_filter !== 'tous') list = list.filter(t => (t.sport || 'autre') === _filter);
  if (_query) {
    const q = _query.toLowerCase();
    list = list.filter(t => (t.name || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
  }

  if (all.length === 0) {
    body.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  // Groupe par sport (ordre SPORTS)
  const order = SPORTS.map(s => s.key);
  const groups = {};
  for (const t of list) {
    const k = t.sport || 'autre';
    (groups[k] = groups[k] || []).push(t);
  }
  const keys = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b));

  if (keys.length === 0) {
    body.innerHTML = '<div class="lib-noresult">Aucune séance ne correspond.</div>';
    return;
  }

  body.innerHTML = keys.map(k => {
    const info = sportInfo(k);
    const items = groups[k];
    const collapsed = !!_collapsed[k];
    const itemsHtml = items.map(t => `
      <div class="lib-item" draggable="true" data-id="${t.id}" title="Glisse-moi sur un jour">
        <span class="lib-accent" style="background:${info.color};"></span>
        <span class="lib-grip" aria-hidden="true">⠿</span>
        <div class="lib-item-body">
          <div class="lib-item-name">${esc(t.name)}</div>
          <div class="lib-item-meta">
            ${t.duration_min ? `<span class="lib-pill">${fmtDur(t.duration_min)}</span>` : ''}
            ${t.tss ? `<span class="lib-pill">${t.tss} TSS</span>` : ''}
          </div>
          ${t.description ? `<div class="lib-item-desc">${esc(t.description)}</div>` : ''}
        </div>
        <button class="lib-item-edit" data-edit="${t.id}" title="Modifier" type="button">✎</button>
      </div>
    `).join('');
    return `
      <div class="lib-cat${collapsed ? ' collapsed' : ''}" data-sport="${k}">
        <div class="lib-cat-head" data-toggle="${k}">
          <span class="lib-cat-name"><span class="lib-cat-caret">▾</span> ${esc(info.label)}</span>
          <span class="lib-cat-count">${items.length}</span>
        </div>
        <div class="lib-cat-items">${itemsHtml}</div>
      </div>`;
  }).join('');

  // Repli
  body.querySelectorAll('.lib-cat-head').forEach(h => h.addEventListener('click', () => {
    const k = h.dataset.toggle; _collapsed[k] = !_collapsed[k]; renderLibrary();
  }));
  // Édition
  body.querySelectorAll('.lib-item-edit').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation(); openTemplateModal(b.dataset.edit);
  }));
  // Drag (desktop) + tap-to-place (touch / mobile)
  body.querySelectorAll('.lib-item').forEach(it => {
    it.addEventListener('dragstart', (e) => {
      _draggingId = it.dataset.id;
      try { e.dataTransfer.setData('text/plain', it.dataset.id); e.dataTransfer.effectAllowed = 'copy'; } catch {}
      it.classList.add('dragging');
      document.body.classList.add('lib-dragging');
    });
    it.addEventListener('dragend', () => {
      _draggingId = null;
      it.classList.remove('dragging');
      document.body.classList.remove('lib-dragging');
      document.querySelectorAll('.day-card.lib-drop-hover').forEach(c => c.classList.remove('lib-drop-hover'));
    });

    // === Mode tactile : tap sur l'item = sélection, puis tap sur un jour = placement.
    // Détection : pointerdown sans mouvement suivi de pointerup proche → c'est un tap.
    // Sur les écrans desktop avec souris, le HTML5 DnD prend le dessus et ce code
    // n'est jamais déclenché (pas de touch).
    it.addEventListener('click', (e) => {
      // Si on est encore en train de drag (mouse), on ignore le click final
      if (document.body.classList.contains('lib-dragging')) return;
      // Mode touch : on toggle la sélection
      const wasSelected = it.classList.contains('selected-for-place');
      // Reset toutes les sélections
      document.querySelectorAll('.lib-item.selected-for-place').forEach(x => x.classList.remove('selected-for-place'));
      if (!wasSelected) {
        it.classList.add('selected-for-place');
        _draggingId = it.dataset.id;
        document.body.classList.add('lib-placing-mode');
        showPlacingHint(it.querySelector('.lib-item-name')?.textContent || 'Séance');
      } else {
        _draggingId = null;
        document.body.classList.remove('lib-placing-mode');
        hidePlacingHint();
      }
    });
  });
}

function showPlacingHint(name) {
  hidePlacingHint();
  const hint = document.createElement('div');
  hint.id = 'lib-placing-hint';
  hint.innerHTML = `
    <span><b>${name}</b> sélectionnée — tape un jour du calendrier pour l'y placer</span>
    <button type="button" id="lib-placing-cancel">Annuler</button>
  `;
  document.body.appendChild(hint);
  hint.querySelector('#lib-placing-cancel').addEventListener('click', () => {
    document.querySelectorAll('.lib-item.selected-for-place').forEach(x => x.classList.remove('selected-for-place'));
    _draggingId = null;
    document.body.classList.remove('lib-placing-mode');
    hidePlacingHint();
  });
}
function hidePlacingHint() {
  const h = document.getElementById('lib-placing-hint');
  if (h) h.remove();
}
window.renderSeanceLibrary = renderLibrary;

// ---- Modale créer / éditer ----
function openTemplateModal(id) {
  const all = loadTemplates();
  const tpl = id ? all.find(t => t.id === id) : null;
  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.innerHTML = `
    <div class="day-modal">
      <div class="day-modal-header">
        <h3>${tpl ? 'Modifier' : 'Nouvelle'} séance</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        <label class="lib-field"><span>Nom</span>
          <input type="text" id="tpl-name" placeholder="ex. Seuil 3×10'" value="${esc(tpl ? tpl.name : '')}">
        </label>
        <label class="lib-field"><span>Sport</span>
          <select id="tpl-sport">
            ${SPORTS.map(s => `<option value="${s.key}"${tpl && tpl.sport === s.key ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
        </label>
        <div class="lib-field-row">
          <label class="lib-field"><span>Durée (min)</span>
            <input type="number" id="tpl-duration" min="0" placeholder="ex. 75" value="${tpl && tpl.duration_min ? tpl.duration_min : ''}">
          </label>
          <label class="lib-field"><span>TSS estimé</span>
            <input type="number" id="tpl-tss" min="0" placeholder="ex. 95" value="${tpl && tpl.tss ? tpl.tss : ''}">
          </label>
        </div>
        <label class="lib-field"><span>Description / structure</span>
          <textarea id="tpl-desc" rows="3" placeholder="ex. 3×10' à FTP, récup 5' entre blocs">${esc(tpl ? tpl.description : '')}</textarea>
        </label>
      </div>
      <div class="day-modal-footer">
        ${tpl ? '<button class="day-modal-delete" type="button">Supprimer</button>' : ''}
        <div style="flex:1;"></div>
        <button class="day-modal-cancel" type="button">Annuler</button>
        <button class="day-modal-save" type="button">Enregistrer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.day-modal-close').addEventListener('click', close);
  overlay.querySelector('.day-modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('.day-modal-save').addEventListener('click', () => {
    const name = overlay.querySelector('#tpl-name').value.trim();
    if (!name) { overlay.querySelector('#tpl-name').focus(); return; }
    const sport = overlay.querySelector('#tpl-sport').value;
    const duration_min = parseInt(overlay.querySelector('#tpl-duration').value, 10) || 0;
    const tss = parseInt(overlay.querySelector('#tpl-tss').value, 10) || 0;
    const description = overlay.querySelector('#tpl-desc').value.trim();
    const arr = loadTemplates();
    if (tpl) {
      const i = arr.findIndex(t => t.id === tpl.id);
      if (i >= 0) arr[i] = { ...arr[i], name, sport, duration_min, tss, description };
    } else {
      arr.push({ id: Date.now().toString() + Math.random().toString(36).slice(2, 6), name, sport, duration_min, tss, description, sort_order: arr.length });
    }
    saveTemplates(arr);
    close();
    renderLibrary();
  });

  const delBtn = overlay.querySelector('.day-modal-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await (window.appConfirm ? window.appConfirm({
      title: 'Supprimer', message: `Supprimer la séance « ${tpl.name} » ?`, confirmLabel: 'Supprimer', danger: true,
    }) : Promise.resolve(window.confirm('Supprimer cette séance ?')));
    if (!ok) return;
    saveTemplates(loadTemplates().filter(t => t.id !== tpl.id));
    close();
    renderLibrary();
  });
}

// ---- Drop sur le calendrier ----
function wireCalendarDrop() {
  const cal = document.getElementById('week-calendar');
  if (!cal || cal._libWired) return;
  cal._libWired = true;
  cal.addEventListener('dragover', (e) => {
    if (!_draggingId) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch {}
    const card = e.target.closest('.day-card[data-iso]');
    cal.querySelectorAll('.day-card.lib-drop-hover').forEach(c => { if (c !== card) c.classList.remove('lib-drop-hover'); });
    if (card) card.classList.add('lib-drop-hover');
  });
  cal.addEventListener('drop', (e) => {
    if (!_draggingId) return;
    e.preventDefault();
    const card = e.target.closest('.day-card[data-iso]');
    cal.querySelectorAll('.day-card.lib-drop-hover').forEach(c => c.classList.remove('lib-drop-hover'));
    const iso = card && card.dataset.iso;
    const tpl = loadTemplates().find(t => t.id === _draggingId);
    _draggingId = null;
    document.body.classList.remove('lib-dragging');
    if (iso && tpl && window.coachInsertTemplate) {
      const mode = window.coachCalendarMode ? window.coachCalendarMode() : 'prevu';
      window.coachInsertTemplate(iso, tpl, mode);
      document.body.classList.remove('lib-open');   // referme l'overlay apres depot
    }
  });

  // === Mode tactile : tap sur un jour quand un template est "selected-for-place"
  cal.addEventListener('click', (e) => {
    if (!document.body.classList.contains('lib-placing-mode') || !_draggingId) return;
    const card = e.target.closest('.day-card[data-iso]');
    if (!card) return;
    const iso = card.dataset.iso;
    const tpl = loadTemplates().find(t => t.id === _draggingId);
    if (iso && tpl && window.coachInsertTemplate) {
      const mode = window.coachCalendarMode ? window.coachCalendarMode() : 'prevu';
      window.coachInsertTemplate(iso, tpl, mode);
      document.body.classList.remove('lib-open');   // referme l'overlay apres depot
    }
    // Reset l'état de placement
    _draggingId = null;
    document.body.classList.remove('lib-placing-mode');
    document.querySelectorAll('.lib-item.selected-for-place').forEach(x => x.classList.remove('selected-for-place'));
    hidePlacingHint();
    e.stopPropagation();
  }, true);  // capture phase pour intercepter avant l'ouverture de la day-modal
}

// ---- Alignement vertical du panneau sur la 1re carte Bilan ----
// (compense libellé de semaine + bandeaux de cycle/note au-dessus de la grille)
function alignLibraryToBilan() {
  const panel = document.getElementById('seance-library');
  const cal = document.getElementById('week-calendar');
  if (!panel || !cal) return;
  const target = cal.querySelector('.week-totals')
    || cal.querySelector('.week-row-days')
    || cal.querySelector('.day-card');
  if (!target) { panel.style.marginTop = '0px'; return; }
  const off = target.getBoundingClientRect().top - cal.getBoundingClientRect().top;
  panel.style.marginTop = Math.max(0, Math.round(off)) + 'px';
}
let _alignRaf = null;
function scheduleAlign() {
  if (_alignRaf) cancelAnimationFrame(_alignRaf);
  _alignRaf = requestAnimationFrame(() => { _alignRaf = null; alignLibraryToBilan(); });
}
window.alignSeanceLibrary = scheduleAlign;

// ---- Bouton replier/déplier le panneau Bibliothèque (laptop / petits écrans) ----
function injectLibraryToggle() {
  const panel = document.getElementById('seance-library');
  const layout = panel ? panel.closest('.calendar-layout') : null;
  if (!panel || !layout || panel.querySelector('.lib-toggle')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lib-toggle';
  btn.title = 'Replier / Déplier la bibliothèque';
  // SVG chevron-right (replier) / chevron-left (déplier) géré via JS
  const renderIcon = () => {
    const collapsed = layout.classList.contains('lib-collapsed');
    btn.setAttribute('aria-label', collapsed ? 'Déplier la bibliothèque' : 'Replier la bibliothèque');
    btn.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  };
  btn.addEventListener('click', () => {
    layout.classList.toggle('lib-collapsed');
    try { localStorage.setItem('lib-collapsed', layout.classList.contains('lib-collapsed') ? '1' : '0'); } catch {}
    renderIcon();
    if (typeof scheduleAlign === 'function') scheduleAlign();
  });
  // Restaurer l'état persisté
  try {
    if (localStorage.getItem('lib-collapsed') === '1') layout.classList.add('lib-collapsed');
  } catch {}
  renderIcon();
  panel.appendChild(btn);
}

// ---- Bibliotheque en panneau flottant (overlay) sur ecran etroit ----
function injectLibraryOverlay() {
  if (document.getElementById('lib-fab')) return;
  const panel = document.getElementById('seance-library');
  if (!panel) return;
  const close = () => document.body.classList.remove('lib-open');
  const toggle = () => document.body.classList.toggle('lib-open');

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'lib-fab';
  fab.className = 'lib-fab';
  fab.title = 'Bibliotheque de seances';
  fab.setAttribute('aria-label', 'Ouvrir la bibliotheque');
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  fab.addEventListener('click', toggle);
  const _subtabs = document.getElementById('calendar-subtabs');
  const _card = _subtabs ? _subtabs.parentNode : null;
  (_card || document.body).appendChild(fab);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('mousedown', (e) => {
    if (!document.body.classList.contains('lib-open')) return;
    if (e.target.closest('#seance-library') || e.target.closest('#lib-fab')) return;
    close();
  });
}

// ---- Init ----
function init() {
  const addBtn = document.getElementById('lib-add');
  if (addBtn) addBtn.addEventListener('click', () => openTemplateModal(null));
  const search = document.getElementById('lib-search');
  if (search) search.addEventListener('input', () => { _query = search.value.trim(); renderLibrary(); });
  wireCalendarDrop();
  renderLibrary();
  injectLibraryToggle();
  injectLibraryOverlay();

  // Réaligne le panneau à chaque (re)rendu du calendrier + au redimensionnement.
  const cal = document.getElementById('week-calendar');
  if (cal && window.MutationObserver) {
    new MutationObserver(scheduleAlign).observe(cal, { childList: true, subtree: true });
  }
  window.addEventListener('resize', scheduleAlign);
  scheduleAlign();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
