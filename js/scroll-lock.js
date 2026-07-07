/* ============================================================
   js/scroll-lock.js — Verrouillage du scroll d'arrière-plan (mobile)
   Quand une modale est ouverte (bottom sheet), la page derrière ne doit
   pas bouger quand on slide. CSS overflow:hidden ne suffit pas partout :
   on fige le body en position:fixed et on restaure le scroll à la fermeture.
   Détection automatique via MutationObserver → aucun call-site à modifier.
   ============================================================ */
(function () {
  var SEL = '.modal-overlay.active, .day-modal-overlay.active, .confirm-modal-overlay.active';
  var locked = false;
  var savedY = 0;

  function apply() {
    // Mobile uniquement : sur desktop la scrollbar disparaîtrait (layout shift)
    if (window.innerWidth >= 860) { if (locked) unlock(); return; }
    var open = !!document.querySelector(SEL);
    if (open && !locked) {
      savedY = window.scrollY || document.documentElement.scrollTop || 0;
      var b = document.body;
      b.style.position = 'fixed';
      b.style.top = (-savedY) + 'px';
      b.style.left = '0';
      b.style.right = '0';
      b.style.width = '100%';
      locked = true;
    } else if (!open && locked) {
      unlock();
    }
  }

  function unlock() {
    var b = document.body;
    b.style.position = '';
    b.style.top = '';
    b.style.left = '';
    b.style.right = '';
    b.style.width = '';
    window.scrollTo(0, savedY);
    locked = false;
  }

  var mo = new MutationObserver(function () {
    // setTimeout (pas rAF : gelé quand la fenêtre est en arrière-plan)
    if (mo._t) return;
    mo._t = setTimeout(function () { mo._t = null; apply(); }, 16);
  });

  function init() {
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
