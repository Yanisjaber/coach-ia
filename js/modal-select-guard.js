// ============================================================
// modal-select-guard.js
// Empeche la fermeture d'une modale quand une SELECTION DE TEXTE demarre dans le
// contenu (input/textarea) et se termine sur le fond : le navigateur emet alors un
// 'click' sur le fond -> les handlers "clic exterieur = fermer" se declenchent a tort.
// On annule ce clic uniquement si le geste n'a PAS commence sur le fond.
// Un vrai clic sur le fond (mousedown ET mouseup sur le fond) ferme toujours.
// ============================================================
(function () {
  var _downOnBackdrop = false;

  // Un "fond de modale" = tout element dont une classe contient "overlay"
  // (day-modal-overlay, modal-overlay, cnx-overlay, month-input-overlay, ...).
  function isBackdrop(el) {
    return !!(el && el.classList && Array.prototype.some.call(el.classList, function (c) {
      return c.indexOf('overlay') !== -1;
    }));
  }

  // Capture : on note si le geste a demarre directement sur un fond.
  document.addEventListener('pointerdown', function (e) {
    _downOnBackdrop = isBackdrop(e.target);
  }, true);

  // Capture (avant les handlers de fermeture) : si le clic atterrit sur un fond
  // mais que le geste a commence ailleurs (selection de texte), on l'annule.
  document.addEventListener('click', function (e) {
    if (isBackdrop(e.target) && !_downOnBackdrop) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
})();
