/* ============================================================
   mobile-nav.js — Navigation mobile « app store »
   - Ajoute un onglet « Plus » dans la tab bar (< 860px)
   - Bottom sheet listant les onglets secondaires (Compétitions,
     Performance, Termes) + le pied de sidebar (toggle IA, compte)
   - Raccourcit les libellés trop longs dans la barre
   Réutilise la logique existante : clique les vrais boutons .tab,
   donc activatePanel() et le hash continuent de fonctionner.
   ============================================================ */

// Panels "secondaires" affichés dans la sheet "Plus" sur mobile.
// Compétitions (p6) et Performance (p4) sont MAINTENANT visibles dans la
// bottom nav (l'user les veut accessibles directement), donc retirés de Plus.
// Plus ne garde que Termes (p5) + les tabs coach injectées dynamiquement.
const MORE_PANELS = ['p5', 'p-athletes', 'p-overview', 'p-chat'];
const SHORT_LABELS = { p1: 'Accueil', p2: 'Calendrier', p6: 'Compét.', p4: 'Perf.', p7: 'IA', p3: 'Stats' };

const mq = window.matchMedia('(max-width: 860px)');
let moreBtn = null;
let sheet = null;
let overlay = null;
let headerInfoHome = null; // emplacement d'origine du pied de sidebar

function buildOnce() {
  if (moreBtn !== null) return;

  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;

  // Bouton "Plus" supprimé : on garde une référence vide pour compat.
  // L'accès aux Termes et autres se fait via le menu user (en haut à droite).
  moreBtn = false; // sentinel pour éviter double-init

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

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);

  rebuildSheetItems();

  /* --- État actif de « Plus » suit le panel courant --- */
  const obs = new MutationObserver(syncActiveState);
  document.querySelectorAll('.panel').forEach(p =>
    obs.observe(p, { attributes: true, attributeFilter: ['class'] }));
  syncActiveState();

  /* --- Fermer la feuille avec le bouton retour Android --- */
  window.addEventListener('popstate', () => { if (isOpen()) closeSheet(); });
}

// Rebuild les items du sheet "Plus" depuis le nav courant. Appelé au boot
// puis re-appelé quand des tabs coach (p-athletes, p-overview, p-chat) sont
// ajoutées dynamiquement après l'init.
function rebuildSheetItems() {
  if (!sheet) return;
  const sheetNav = sheet.querySelector('.msheet-nav');
  if (!sheetNav) return;
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;
  sheetNav.innerHTML = '';
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
      orig.click();
      closeSheet();
    });
    sheetNav.appendChild(item);
  });
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

/* --- Sur mobile, on déplace le bouton "compte" (auth-user-menu-wrap) dans
       la topbar (haut à droite) pour avoir un accès direct. Le reste du
       .header-info (toggle IA/Manuel s'il existe) reste dans la sheet "Plus". --- */
function placeHeaderInfo() {
  const info = document.querySelector('.sidebar > .header-info, .msheet-foot > .header-info');
  const userMenu = document.querySelector('#auth-user-menu-wrap, .auth-user-menu-wrap');
  const topbar = document.querySelector('.topbar');

  // 1) Déplace le auth-user-menu-wrap vers la topbar sur mobile, retour sidebar sur desktop
  if (userMenu && topbar) {
    if (mq.matches) {
      if (userMenu.parentElement !== topbar) {
        topbar.appendChild(userMenu);
        topbar.classList.add('has-user-menu');
      }
    } else {
      // Retour à la position d'origine (.header-info) si on revient en desktop
      const home = info || document.querySelector('.sidebar .header-info');
      if (home && userMenu.parentElement !== home) {
        home.appendChild(userMenu);
        topbar.classList.remove('has-user-menu');
      }
    }
  }

  // 2) Le reste du .header-info (toggle IA/Manuel, etc.) va dans la sheet "Plus" sur mobile
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

// Re-place le user menu quand auth.js l'injecte (après login Supabase)
window.addEventListener('coach-ia-auth', () => {
  // Retry sur 3 frames pour laisser auth.js terminer l'injection du menu
  let n = 0;
  const tick = () => {
    placeHeaderInfo();
    if (++n < 3) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// Filet de sécurité : observe SEULEMENT le nav latéral pour détecter l'arrivée
// de nouvelles tabs (coach), pas tout document.body (sinon boucle infinie car
// rebuildSheetItems modifie le DOM → ré-trigger l'observer).
function setupNavObserver() {
  if (!window.MutationObserver) return;
  let pending = false;
  const trigger = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      try {
        if (document.getElementById('auth-user-menu-wrap')) placeHeaderInfo();
        rebuildSheetItems();
      } catch (e) {
        console.warn('[mobile-nav] observer trigger error', e);
      }
    });
  };
  const target = document.querySelector('.sidebar-nav');
  if (target) {
    new MutationObserver(trigger).observe(target, { childList: true, subtree: false });
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNavObserver);
} else {
  setupNavObserver();
}
