/* js/gpx-field.js - Gestion du champ GPX de la modale d'entrainement.
   Lit le fichier .gpx, stocke nom + contenu, expose des helpers pour app.js. */
(function () {
  var _gpx = { name: null, content: null };
  function nameEl() { return document.getElementById('train-modal-gpx-name'); }
  function clearBtn() { return document.getElementById('train-modal-gpx-clear'); }
  function render() {
    var n = nameEl(), c = clearBtn();
    if (n) n.textContent = _gpx.name ? _gpx.name : 'Aucun fichier';
    if (c) c.hidden = !_gpx.name;
  }
  window.getTrainGpx = function () { return { name: _gpx.name, content: _gpx.content }; };
  window.setTrainGpx = function (name, content) { _gpx = { name: name || null, content: content || null }; render(); };
  window.resetTrainGpx = function () { _gpx = { name: null, content: null }; var inp = document.getElementById('train-modal-gpx'); if (inp) inp.value = ''; render(); };
  function wire() {
    var inp = document.getElementById('train-modal-gpx'); if (!inp || inp._wired) return; inp._wired = true;
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { _gpx = { name: f.name, content: String(rd.result || '') }; render(); };
      rd.readAsText(f);
    });
    var c = clearBtn(); if (c) c.addEventListener('click', function () { window.resetTrainGpx(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
