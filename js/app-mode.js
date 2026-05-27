/* ============================================================
   js/app-mode.js — Mode IA / Mode Manuel

   État global persisté dans localStorage. Les deux modes sont des "vues" :
     - Mode IA      : surcouche d'aide automatique (recommandations, plan auto, alertes)
     - Mode Manuel  : app brute, tu planifies tout, aucun élément IA affiché
   Sources de vérité : window.APP_MODE + body.classList (mode-ia | mode-manual).

   Self-bootstrapping : un appel à initAppMode() est wiré au DOMContentLoaded
   simplement en important ce module.
   ============================================================ */

const APP_MODE_KEY = 'coach_ia_mode';

function getStoredMode() {
  try { return localStorage.getItem(APP_MODE_KEY); } catch (e) { return null; }
}
function storeMode(mode) {
  try { localStorage.setItem(APP_MODE_KEY, mode); } catch (e) { /* private mode */ }
}

export function applyAppMode(mode) {
  // mode = 'ia' | 'manual'
  if (mode !== 'ia' && mode !== 'manual') mode = 'ia';
  window.APP_MODE = mode;
  document.body.classList.remove('mode-ia', 'mode-manual');
  document.body.classList.add('mode-' + mode);
  positionModeSlider();
  // Event custom pour que d'autres modules puissent réagir si besoin
  window.dispatchEvent(new CustomEvent('appModeChange', { detail: { mode } }));
}

export function positionModeSlider() {
  // Calcule la position/taille du slider pour qu'il colle à l'option active.
  const toggle = document.getElementById('mode-toggle');
  const slider = document.getElementById('mode-slider');
  if (!toggle || !slider) return;
  const active = toggle.querySelector('.opt-' + (window.APP_MODE === 'manual' ? 'manual' : 'ia'));
  if (!active) return;
  const togRect = toggle.getBoundingClientRect();
  const actRect = active.getBoundingClientRect();
  slider.style.left = (actRect.left - togRect.left) + 'px';
  slider.style.width = actRect.width + 'px';
}

export function initAppMode() {
  const toggle = document.getElementById('mode-toggle');
  if (!toggle) return;

  // 1. Charge le mode existant ou affiche la modal de bienvenue
  const stored = getStoredMode();
  if (stored === 'ia' || stored === 'manual') {
    applyAppMode(stored);
  } else {
    // Première visite : démarrer en mode IA par défaut visuellement le temps
    // que l'utilisateur choisisse (pour que la modal s'affiche par-dessus l'app)
    applyAppMode('ia');
    showWelcomeModal();
  }

  // 2. Wire le toggle (click n'importe où dessus = bascule)
  toggle.addEventListener('click', (e) => {
    const opt = e.target.closest('.mode-opt');
    let newMode;
    if (opt && opt.dataset.mode) {
      newMode = opt.dataset.mode;
    } else {
      // Click ailleurs sur le toggle → bascule
      newMode = window.APP_MODE === 'ia' ? 'manual' : 'ia';
    }
    if (newMode === window.APP_MODE) return;
    applyAppMode(newMode);
    storeMode(newMode);
  });

  // 3. Re-positionner le slider quand on resize ou quand les fonts chargent
  window.addEventListener('resize', positionModeSlider);
  // Petit délai pour laisser les fonts/layout se stabiliser au 1er load
  setTimeout(positionModeSlider, 50);
  setTimeout(positionModeSlider, 300);
}

function showWelcomeModal() {
  const bd = document.getElementById('welcome-backdrop');
  if (!bd) return;
  bd.classList.add('active');
  bd.querySelectorAll('.welcome-card').forEach(card => {
    card.addEventListener('click', () => {
      const choice = card.dataset.choice === 'manual' ? 'manual' : 'ia';
      applyAppMode(choice);
      storeMode(choice);
      bd.classList.remove('active');
    }, { once: true });
  });
}

// Self-bootstrap : auto-init à l'import.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAppMode);
} else {
  initAppMode();
}
