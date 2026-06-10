/* ============================================================
   mobile-nav.js — Navigation mobile « app store »
   - Ajoute un onglet « Plus » dans la tab bar (< 860px)
   - Bottom sheet listant les onglets secondaires (Compétitions,
     Performance, Termes) + le pied de sidebar (toggle IA, compte)
   - Raccourcit les libellés trop longs dans la barre
   Réutilise la logique existante : clique les vrais boutons .tab,
   donc activatePanel() et le hash continuent de fonctionner.
   ============================================================ */

const MORE_PANELS = ['p6', 'p4', 'p5']; // Compétitions, Performance, Termes
const SHORT_LABELS = { p1: 'Accueil', p2: 'Calendrier', p7: 'IA', p3: 'Stats' };

const mq = window.matchMedia('(max-width: 860px)');
let moreBtn = null;
let sheet = null;
let overlay = null;
let headerInfoHome = null; // emplacement d'origine du pied de sidebar

function buildOnce() {
  if (moreBtn) return;

  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;

  /* --- Bouton « Plus » dans la tab bar --- */
  moreBtn = document.createElement('button');
  moreBtn.className = 'tab tab-more';
  moreBtn.type = 'button';
  moreBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>' +
    '<span>Plus</span>';
  moreBtn.addEventListener('click', toggleSheet);
  nav.appendChild(moreBtn);

  /* --- Mémorise les libellés complets (le swap se fait dans applyLabels) --- */
  Object.keys(SHORT_LABELS).forEach(panel => {
    const span = nav.querySelector(`.tab[data-panel="${panel}"] span`);
    if (span) span.dataset.full = span.textContent;
  });

  /* --- Overlay + bottom sheet --- */
  overlay = document.createElement('div');
  overlay.className = 'msheet-overlay';
  overlay.addEventListener('click', closeSheet);

  sheet = document.createElement('div');
  sheet.className = 'msheet';
  sheet.innerHTML = '<div class="msheet-handle"></div><nav class="msheet-nav"></nav><div class="msheet-foot"></div>';

  const sheetNav = sheet.querySelector('.msheet-nav');
  MORE_PANELS.forEach(panel => {
    const orig = nav.querySelector(`.tab[data-panel="${panel}"]`);
    if (!orig) return;
    const item = document.createElement('button');
    item.className = 'msheet-item';
    item.type = 'button';
    item.dataset.panel = panel;
    const svg = orig.querySelector('svg');
    const label = orig.querySelector('span');
    item.innerHTML = (svg ? svg.outerHTML : '') + `<span>${label ? label.textContent : panel}</span>`;
    item.addEventListener('click', () => {
      orig.click();        // réutilise activatePanel() + hash
      closeSheet();
    });
    sheetNav.appendChild(item);
  });

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);

  /* --- État actif de « Plus » suit le panel courant --- */
  const obs = new MutationObserver(syncActiveState);
  document.querySelectorAll('.panel').forEach(p =>
    obs.observe(p, { attributes: true, attributeFilter: ['class'] }));
  syncActiveState();

  /* --- Fermer la feuille avec le bouton retour Android --- */
  window.addEventListener('popstate', () => { if (isOpen()) closeSheet(); });
}

function isOpen() { return sheet && sheet.classList.contains('open'); }

function toggleSheet() { isOpen() ? closeSheet() : openSheet(); }

function openSheet() {
  if (!sheet) return;
  sheet.classList.add('open');
  overlay.classList.add('open');
  syncActiveState();
}

function closeSheet() {
  if (!sheet) return;
  sheet.classList.remove('open');
  overlay.classList.remove('open');
}

function syncActiveState() {
  const active = document.querySelector('.panel.active');
  const id = active ? active.id : null;
  if (moreBtn) moreBtn.classList.toggle('active', MORE_PANELS.includes(id));
  if (sheet) {
    sheet.querySelectorAll('.msheet-item').forEach(it =>
      it.classList.toggle('active', it.dataset.panel === id));
  }
}

/* --- Déplace le pied de sidebar (toggle IA/Manuel, compte) dans la
       feuille sur mobile, et le remet en place sur desktop --- */
function placeHeaderInfo() {
  const info = document.querySelector('.sidebar > .header-info, .msheet-foot > .header-info');
  if (!info) return;
  if (!headerInfoHome) headerInfoHome = info.parentElement;
  const foot = sheet ? sheet.querySelector('.msheet-foot') : null;
  if (mq.matches && foot && info.parentElement !== foot) {
    foot.appendChild(info);
  } else if (!mq.matches && headerInfoHome && info.parentElement !== headerInfoHome) {
    headerInfoHome.appendChild(info);
    closeSheet();
  }
}

/* --- Libellés courts sur mobile, complets sur desktop --- */
function applyLabels() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;
  Object.entries(SHORT_LABELS).forEach(([panel, short]) => {
    const span = nav.querySelector(`.tab[data-panel="${panel}"] span`);
    if (!span || !span.dataset.full) return;
    span.textContent = mq.matches ? short : span.dataset.full;
  });
}

function onViewportChange() {
  placeHeaderInfo();
  applyLabels();
}

function init() {
  buildOnce();
  placeHeaderInfo();
  applyLabels();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
mq.addEventListener('change', onViewportChange);
