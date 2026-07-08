/* ============================================================
   js/rpe-scale.js — Échelle RPE visuelle (1-10).

   Remplace les inputs number RPE par une rangée de 10 pastilles
   cliquables, colorées du vert au rouge, avec libellé d'effort
   (Très facile → Maximal). La valeur vit dans un <input hidden>
   (même id qu'avant : comp-modal-rpe / train-modal-rpe), donc
   AUCUN changement dans la logique save/edit d'app.js.

   Markup attendu :
     <input type="hidden" id="xxx-rpe">
     <div class="rpe-scale" data-input="xxx-rpe"></div>

   Sync automatique : le setter de .value de l'input est intercepté,
   donc un pré-remplissage programmatique (édition, reset, template)
   met à jour l'affichage sans appel explicite.
   ============================================================ */

(function () {
  'use strict';

  // Libellé + couleur par niveau (échelle type Borg CR10 simplifiée)
  var LABELS = { 1: 'Très facile', 2: 'Très facile', 3: 'Facile', 4: 'Facile', 5: 'Modéré', 6: 'Modéré', 7: 'Dur', 8: 'Dur', 9: 'Très dur', 10: 'Maximal' };
  var COLORS = { 1: '#34d399', 2: '#34d399', 3: '#84cc16', 4: '#84cc16', 5: '#fbbf24', 6: '#fbbf24', 7: '#fb923c', 8: '#fb923c', 9: '#f87171', 10: '#ef4444' };

  function paint(scale, input) {
    var raw = parseFloat(String(input.value || '').replace(',', '.'));
    var val = (isFinite(raw) && raw >= 1) ? Math.min(10, Math.round(raw)) : null;
    var col = val ? COLORS[val] : null;
    scale._pills.forEach(function (p, i) {
      var on = val != null && (i + 1) <= val;
      p.classList.toggle('on', on);
      p.style.background = on ? col : '';
      p.style.borderColor = on ? col : '';
    });
    if (val) {
      scale._lab.textContent = val + '/10 · ' + LABELS[val];
      scale._lab.style.color = col;
    } else {
      scale._lab.textContent = 'Non renseigné — touche une case';
      scale._lab.style.color = '';
    }
  }

  function build(scale) {
    if (scale._built) return;
    var input = document.getElementById(scale.dataset.input);
    if (!input) return;
    scale._built = true;

    var row = document.createElement('div');
    row.className = 'rpe-pills';
    var pills = [];
    for (var v = 1; v <= 10; v++) {
      (function (v) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'rpe-pill';
        b.textContent = v;
        b.setAttribute('aria-label', 'RPE ' + v + ' — ' + LABELS[v]);
        b.addEventListener('click', function () {
          var cur = parseFloat(String(input.value || '').replace(',', '.'));
          // re-cliquer la valeur active = désélection
          input.value = (isFinite(cur) && Math.round(cur) === v) ? '' : String(v);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        pills.push(b);
        row.appendChild(b);
      })(v);
    }
    var lab = document.createElement('div');
    lab.className = 'rpe-scale-label';
    scale.appendChild(row);
    scale.appendChild(lab);
    scale._pills = pills;
    scale._lab = lab;

    // Sync sur saisie utilisateur ET sur affectation programmatique de .value
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
