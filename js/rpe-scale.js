/* ============================================================
   js/rpe-scale.js — Jauge RPE compacte (1-10).

   Barre de 10 segments cliquable/glissable, colorée du vert au
   rouge selon le niveau, libellé sous la jauge (« 8/10 · Dur »)
   + petite croix pour effacer. Compacte : tient à droite du TSS.

   La valeur vit dans un <input hidden> (mêmes ids qu'avant :
   comp-modal-rpe / train-modal-rpe) → logique save/edit intacte.
   Le setter de .value est intercepté : un pré-remplissage
   programmatique (édition, reset, template) resynchronise l'affichage.

   Markup attendu :
     <input type="hidden" id="xxx-rpe">
     <div class="rpe-scale" data-input="xxx-rpe"></div>
   ============================================================ */

(function () {
  'use strict';

  var LABELS = { 1: 'Très facile', 2: 'Très facile', 3: 'Facile', 4: 'Facile', 5: 'Modéré', 6: 'Modéré', 7: 'Dur', 8: 'Dur', 9: 'Très dur', 10: 'Maximal' };
  var COLORS = { 1: '#34d399', 2: '#34d399', 3: '#84cc16', 4: '#84cc16', 5: '#fbbf24', 6: '#fbbf24', 7: '#fb923c', 8: '#fb923c', 9: '#f87171', 10: '#ef4444' };

  function paint(scale, input) {
    var raw = parseFloat(String(input.value || '').replace(',', '.'));
    var val = (isFinite(raw) && raw >= 1) ? Math.min(10, Math.round(raw)) : null;
    var col = val ? COLORS[val] : null;
    scale._segs.forEach(function (s, i) {
      var on = val != null && (i + 1) <= val;
      s.classList.toggle('on', on);
      s.style.background = on ? col : '';
    });
    if (val) {
      scale._labTxt.textContent = val + '/10 · ' + LABELS[val];
      scale._labTxt.style.color = col;
      scale._clear.hidden = false;
    } else {
      scale._labTxt.textContent = 'RPE ?';
      scale._labTxt.style.color = '';
      scale._clear.hidden = true;
    }
  }

  function build(scale) {
    if (scale._built) return;
    var input = document.getElementById(scale.dataset.input);
    if (!input) return;
    scale._built = true;

    var bar = document.createElement('div');
    bar.className = 'rpe-bar';
    var segs = [];
    for (var v = 1; v <= 10; v++) {
      var s = document.createElement('div');
      s.className = 'rpe-seg';
      segs.push(s);
      bar.appendChild(s);
    }
    var lab = document.createElement('div');
    lab.className = 'rpe-scale-label';
    var labTxt = document.createElement('span');
    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'rpe-clear';
    clear.textContent = '×';
    clear.title = 'Effacer le RPE';
    clear.hidden = true;
    lab.appendChild(labTxt);
    lab.appendChild(clear);
    scale.appendChild(bar);
    scale.appendChild(lab);
    scale._segs = segs;
    scale._labTxt = labTxt;
    scale._clear = clear;

    var setVal = function (v) {
      if (String(input.value) === String(v)) return;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    var valFromEvent = function (e) {
      var r = bar.getBoundingClientRect();
      var f = (e.clientX - r.left) / (r.width || 1);
      return Math.max(1, Math.min(10, Math.ceil(f * 10)));
    };
    var dragging = false;
    bar.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      dragging = true;
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      setVal(valFromEvent(e));
    });
    bar.addEventListener('pointermove', function (e) {
      if (dragging) setVal(valFromEvent(e));
    });
    bar.addEventListener('pointerup', function () { dragging = false; });
    bar.addEventListener('pointercancel', function () { dragging = false; });
    clear.addEventListener('click', function () {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Sync sur saisie ET sur affectation programmatique de .value
    input.addEventListener('input', function () { paint(scale, input); });
    var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) {
      Object.defineProperty(input, 'value', {
        get: function () { return desc.get.call(this); },
        set: function (nv) { desc.set.call(this, nv); paint(scale, input); },
      });
    }
    paint(scale, input);
  }

  function init() {
    document.querySelectorAll('.rpe-scale').forEach(build);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.RpeScale = { init: init };
})();
