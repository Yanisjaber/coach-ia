/* ============================================================
   js/help-modal.js — Page « Aide & support » (page plein écran, comme Paramètres)
   Ouverte via le menu utilisateur → Aide & support (window.openHelpModal).
   ============================================================ */

const HELP_HASH = '#aide';
let _panel = null;
let _prevTab = null;

function buildPanel() {
  const section = document.createElement('section');
  section.className = 'panel profile-page';
  section.id = 'help-page';
  section.innerHTML = `
    <div class="profile-page-body">
      <div class="profile-left">
        <button type="button" class="profile-back-btn" id="help-back-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          Retour
        </button>
        <aside class="profile-sidebar">
          <div class="profile-sidebar-group">
            <div class="profile-sidebar-group-label">Aide</div>
            <button type="button" class="set-nav-item active" data-target="help-start">Bien démarrer</button>
            <button type="button" class="set-nav-item" data-target="help-terms">Glossaire</button>
            <button type="button" class="set-nav-item" data-target="help-contact">Contact</button>
            <button type="button" class="set-nav-item" data-target="help-about">À propos</button>
          </div>
        </aside>
      </div>
      <div class="help-body">
      <section class="help-section" id="help-start">
        <h3>Bien démarrer</h3>
        <details class="help-qa"><summary>Comment connecter Strava ?</summary>
          <p>Menu (en haut à droite) → <strong>Connexions</strong> → <strong>Connecter Strava</strong>, ou clique sur le bouton du bandeau « Aucun compte connecté ». Autorise l'accès sur Strava : tes activités s'importent automatiquement.</p></details>
        <details class="help-qa"><summary>Comment connecter Whoop ?</summary>
          <p>Menu → <strong>Connexions</strong> → <strong>Connecter Whoop</strong>. Tu récupères ta récupération, ton sommeil et ton strain réels.</p></details>
        <details class="help-qa"><summary>C'est quoi le « Power Profile » ?</summary>
          <p>Ce sont tes meilleurs records de puissance par durée d'effort (5 s, 1 min, 5 min, 20 min…), calculés à partir des streams de tes activités Strava. Il se construit en arrière-plan après la connexion et se complète au fil des synchros.</p></details>
        <details class="help-qa"><summary>Pourquoi l'import prend du temps ?</summary>
          <p>Les activités arrivent vite, mais l'analyse du power profile se fait par lots (≈ 40 activités) à cause de la limite de l'API Strava. Si la limite est atteinte, ça reprend tout seul au prochain chargement.</p></details>
        <details class="help-qa"><summary>Je ne vois pas mes données / elles sont à zéro</summary>
          <p>Vérifie qu'un compte est connecté (menu → Connexions). Si oui, clique <strong>Re-synchroniser</strong>. Les données Whoop n'apparaissent que si Whoop est connecté.</p></details>
      </section>

      <section class="help-section" id="help-terms">
        <h3>Comprendre les termes</h3>
        <p class="help-text">TSS, CTL, ATL, TSB, NP, zones… tout est expliqué dans le glossaire.</p>
        <button class="help-btn" id="help-open-glossary">Ouvrir le glossaire</button>
      </section>

      <section class="help-section" id="help-contact">
        <h3>Contact</h3>
        <p class="help-text">Une question, un bug, une idée ? Écris-moi :</p>
        <a class="help-btn" href="mailto:yanisjaber23@gmail.com">yanisjaber23@gmail.com</a>
      </section>

      <section class="help-section" id="help-about">
        <h3>À propos</h3>
        <p class="help-text">Coach IA — dashboard d'entraînement &amp; récupération. Sources : Strava + Whoop.</p>
      </section>
      </div>
    </div>
  `;
  const anchor = document.querySelector('.panel') || document.body;
  anchor.parentNode.appendChild(section);
  section.querySelector('#help-back-btn').addEventListener('click', closeHelpPage);
  section.querySelector('#help-open-glossary').addEventListener('click', () => {
    closeHelpPage();
    window.location.hash = '#termes'; // l'onglet Termes s'active via le routage par ancre
  });
  section.querySelectorAll('.set-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      section.querySelectorAll('.set-nav-item').forEach(b => b.classList.remove('active'));
      item.classList.add('active');
      section.querySelector('#' + item.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  return section;
}

function showHelpHeaderTitle() {
  const header = document.querySelector('header');
  if (!header) return;
  let el = document.getElementById('help-header-title');
  if (!el) {
    el = document.createElement('div');
    el.id = 'help-header-title';
    el.className = 'profile-header-title';
    el.innerHTML = `
      <div class="profile-page-title-text">
        <h2>Aide &amp; support</h2>
        <p>FAQ, glossaire et contact.</p>
      </div>
      <div class="profile-page-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>`;
    header.appendChild(el);
  }
  el.style.display = '';
}

export function openHelpModal(skipHash = false) {
  injectStyles();
  if (!skipHash && window.location.hash !== HELP_HASH) {
    history.pushState(null, '', HELP_HASH);
  }
  if (!_panel) _panel = buildPanel();

  _prevTab = document.querySelector('.tabs .tab.active') || document.querySelector('.tabs .tab[data-panel="p1"]');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
  _panel.classList.add('active');

  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) tabsBar.classList.add('profile-hidden');
  document.getElementById('sport-filter')?.style.setProperty('display', 'none');
  document.getElementById('mode-toggle')?.style.setProperty('display', 'none');
  const hi = document.querySelector('.header-info'); if (hi) hi.style.display = 'none';
  showHelpHeaderTitle();
  const ft = document.querySelector('footer'); if (ft) ft.style.display = 'none';
  const ob = document.getElementById('onboarding-banner'); if (ob) ob.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeHelpPage() {
  if (_panel) _panel.classList.remove('active');
  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) tabsBar.classList.remove('profile-hidden');
  document.getElementById('sport-filter')?.style.setProperty('display', '');
  document.getElementById('mode-toggle')?.style.setProperty('display', '');
  const hi = document.querySelector('.header-info'); if (hi) hi.style.display = '';
  const ht = document.getElementById('help-header-title'); if (ht) ht.style.display = 'none';
  const ft = document.querySelector('footer'); if (ft) ft.style.display = '';
  const ob = document.getElementById('onboarding-banner'); if (ob) ob.style.display = '';

  const target = _prevTab && document.body.contains(_prevTab) ? _prevTab : document.querySelector('.tabs .tab[data-panel="p1"]');
  if (target) {
    document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    target.classList.add('active');
    const panel = document.getElementById(target.dataset.panel);
    if (panel) panel.classList.add('active');
  }
  if (window.location.hash === HELP_HASH) {
    history.pushState(null, '', window.location.pathname + window.location.search);
  }
}

// Routage par ancre : ouverture/fermeture via #aide.
function _helpHashChange() {
  if (window.location.hash === HELP_HASH) openHelpModal(true);
  else if (_panel && _panel.classList.contains('active')) closeHelpPage();
}
window.addEventListener('hashchange', _helpHashChange);
window.addEventListener('popstate', _helpHashChange);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.location.hash === HELP_HASH) setTimeout(() => openHelpModal(true), 200);
  });
} else if (window.location.hash === HELP_HASH) {
  setTimeout(() => openHelpModal(true), 200);
}

function injectStyles() {
  if (document.getElementById('help-styles')) return;
  const s = document.createElement('style');
  s.id = 'help-styles';
  s.textContent = `
    .help-body { max-width: 720px; }
    .set-nav-item { display: block; width: 100%; text-align: left; background: none; border: none;
      color: var(--text-dim, #8b94a8); font-size: 13px; font-weight: 600; padding: 9px 12px;
      border-radius: 8px; cursor: pointer; font-family: inherit; }
    .set-nav-item:hover { background: var(--bg-elev2, #232a38); color: var(--text, #e8edf5); }
    .set-nav-item.active { background: rgba(74,222,128,0.12); color: var(--accent, #4ade80); }
    .help-section { scroll-margin-top: 16px; }
    .help-section { padding: 18px 0; border-bottom: 1px solid var(--border, #2a3242); }
    .help-section:last-child { border-bottom: none; }
    .help-section h3 { margin: 0 0 12px; font-size: 15px; font-weight: 700; color: var(--text, #e8edf5); }
    .help-text { color: var(--text-dim, #8b94a8); font-size: 13px; line-height: 1.55; margin: 0 0 12px; }
    .help-qa { border: 1px solid var(--border, #2a3242); border-radius: 10px; margin-bottom: 8px; background: var(--bg, #0b0e14); }
    .help-qa summary { cursor: pointer; padding: 11px 14px; font-size: 13px; font-weight: 600; color: var(--text, #e8edf5); list-style: none; }
    .help-qa summary::-webkit-details-marker { display: none; }
    .help-qa summary::after { content: '+'; float: right; color: var(--text-dim, #8b94a8); font-weight: 700; }
    .help-qa[open] summary::after { content: '−'; }
    .help-qa p { margin: 0; padding: 0 14px 13px; color: var(--text-dim, #8b94a8); font-size: 12.5px; line-height: 1.6; }
    .help-btn { display: inline-block; background: var(--bg-elev2, #232a38); color: var(--text, #e8edf5); border: 1px solid var(--border, #2a3242);
      border-radius: 8px; padding: 10px 16px; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; text-decoration: none; }
    .help-btn:hover { filter: brightness(1.15); }
  `;
  document.head.appendChild(s);
}

window.openHelpModal = openHelpModal;
