/* ============================================================
   js/adherence.js — Prévu vs Réalisé V2 : adhérence par intervalle.

   Compare la structure planifiée (blocs du session-builder, cibles en
   %FTP) aux streams de puissance réalisés (1 Hz) :
   - aplatit la structure en segments ordonnés (work/récup × reps) ;
   - pour chaque segment d'EFFORT (blocs interval/steady), cherche dans
     le stream la meilleure fenêtre de la durée prévue (max puissance
     moyenne = la tentative réelle de l'athlète) via sommes préfixes ;
   - score = W moyen réalisé / W cible (milieu de fourchette) ;
   - échauffement / récup / retour au calme : non scorés (servent au
     positionnement du curseur de recherche).

   Exposé : window.computeAdherence, window.renderAdherenceHTML,
   window.fillAdherenceSlot (remplit #pvr-adherence quand les streams
   arrivent — appelé depuis app.js après chargement des streams).
   ============================================================ */

(function () {
  'use strict';

  var EFFORT_TYPES = { interval: 1, steady: 1 };
  var TYPE_LABELS = { warmup: 'Échauffement', interval: 'Effort', steady: 'Bloc continu', recovery: 'Récup', cooldown: 'Retour au calme' };

  // Aplatit les blocs en segments séquentiels
  function flatten(structure) {
    var segs = [];
    (structure || []).forEach(function (b) {
      if (!b || !b.work) return;
      var reps = Math.max(1, b.reps | 0);
      var effortIdx = 0;
      for (var i = 0; i < reps; i++) {
        effortIdx++;
        segs.push({
          type: b.type,
          metric: b.metric || 'power',
          label: (TYPE_LABELS[b.type] || b.name || 'Bloc') + (reps > 1 ? ' ' + effortIdx : ''),
          min: +b.work.min || 0,
          lo: +b.work.int || 0,
          hi: (b.work.intHi != null && +b.work.intHi > 0) ? +b.work.intHi : (+b.work.int || 0),
          effort: !!EFFORT_TYPES[b.type],
        });
        if (b.type === 'interval' && b.rec && i < reps) {
          segs.push({
            type: 'recovery', metric: b.metric || 'power', label: 'Récup',
            min: +b.rec.min || 0, lo: +b.rec.int || 0,
            hi: (b.rec.intHi != null && +b.rec.intHi > 0) ? +b.rec.intHi : (+b.rec.int || 0),
            effort: false,
          });
        }
      }
    });
    return segs;
  }

  // Meilleure fenêtre de `len` échantillons entre from et to (max moyenne), via préfixes
  function bestWindow(prefix, from, to, len) {
    var n = prefix.length - 1;
    from = Math.max(0, Math.min(from, n - len));
    to = Math.max(from, Math.min(to, n - len));
    var bestT = from, bestSum = -1;
    for (var t = from; t <= to; t++) {
      var s = prefix[t + len] - prefix[t];
      if (s > bestSum) { bestSum = s; bestT = t; }
    }
    return { start: bestT, mean: bestSum / len };
  }

  // structure: blocs session-builder ; watts: array 1 Hz ; ftp: nombre
  // Retour : { scorable, overall, items:[...] } ou null si rien d'évaluable.
  window.computeAdherence = function (structure, watts, ftp) {
    if (!Array.isArray(structure) || !structure.length) return null;
    if (!watts || !watts.length || !ftp || ftp < 50) return null;
    var segs = flatten(structure);
    var efforts = segs.filter(function (s) { return s.effort && s.metric === 'power' && s.min > 0 && s.lo > 0; });
    if (!efforts.length) return null;

    var n = watts.length;
    var prefix = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) prefix[i + 1] = prefix[i] + (watts[i] || 0);

    var items = [];
    var cursor = 0;
    var totalW = 0, weighted = 0;
    for (var k = 0; k < segs.length; k++) {
      var s = segs[k];
      var durS = Math.round(s.min * 60);
      if (durS <= 0) continue;
      if (!s.effort || s.metric !== 'power' || !s.lo) { cursor += durS; continue; }
      if (cursor >= n - 10) break; // stream fini avant la fin du plan
      var len = Math.min(durS, n - 1);
      // Fenêtre de recherche élastique : la récup réelle peut être plus longue que prévue
      var searchTo = Math.min(n - len, cursor + durS * 3 + 600);
      var w = bestWindow(prefix, cursor, searchTo, len);
      var targetMidPct = (s.lo + s.hi) / 2;
      var targetMidW = ftp * targetMidPct / 100;
      var pct = targetMidW > 0 ? (w.mean / targetMidW) : 0;
      // adhérence du segment : 1 - écart à la cible (dépasser N'EST PAS adhérent non plus)
      var adh = Math.max(0, 1 - Math.abs(1 - pct));
      items.push({
        label: s.label,
        plannedMin: s.min,
        targetLoW: Math.round(ftp * s.lo / 100),
        targetHiW: Math.round(ftp * s.hi / 100),
        avgW: Math.round(w.mean),
        pct: Math.round(pct * 100),
        adh: adh,
        color: (pct >= 0.95 && pct <= 1.10) ? 'var(--accent)' : ((pct >= 0.85 && pct < 0.95) || (pct > 1.10 && pct <= 1.25)) ? 'var(--warn)' : 'var(--danger)',
        truncated: len < durS,
      });
      var weight = durS;
      totalW += weight;
      weighted += adh * weight;
      cursor = w.start + len;
    }
    if (!items.length) return null;
    return { scorable: true, overall: Math.round((weighted / totalW) * 100), items: items };
  };

  window.renderAdherenceHTML = function (res) {
    if (!res || !res.items || !res.items.length) return '';
    var ocol = res.overall >= 90 ? 'var(--accent)' : res.overall >= 75 ? 'var(--warn)' : 'var(--danger)';
    var rows = res.items.map(function (it) {
      var barPct = Math.max(4, Math.min(125, it.pct));
      return '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;min-width:0">'
        + '<span style="flex:0 0 92px;font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + it.label + ' · ' + it.plannedMin + '′</span>'
        + '<div style="flex:1;height:12px;background:var(--bg-elev2,#1b2230);border-radius:6px;overflow:hidden;position:relative">'
        +   '<div style="width:' + Math.min(100, barPct / 1.25) + '%;height:100%;background:' + it.color + ';opacity:.85"></div>'
        +   '<div style="position:absolute;top:0;bottom:0;left:' + (100 / 1.25) + '%;width:1px;background:rgba(255,255,255,.35)" title="cible"></div>'
        + '</div>'
        + '<span style="flex:0 0 118px;font-size:11px;text-align:right;color:var(--text-dim)"><b style="color:var(--text)">' + it.avgW + ' W</b> / ' + it.targetLoW + '–' + it.targetHiW + ' · <b style="color:' + it.color + '">' + it.pct + '%</b></span>'
        + '</div>';
    }).join('');
    return '<div style="margin-top:14px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:2px">'
      +   '<span style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-mute,#6b7686)">Adhérence par intervalle</span>'
      +   '<span style="font-size:12px;font-weight:700;color:' + ocol + '">' + res.overall + ' %</span>'
      + '</div>'
      + rows
      + '<div style="font-size:10px;color:var(--text-mute,#6b7686);margin-top:6px">Repère blanc = cible · basé sur la meilleure fenêtre de puissance de la durée prévue pour chaque effort</div>'
      + '</div>';
  };

  // Remplit le placeholder #pvr-adherence (posé par renderPrevuVsRealiseHTML)
  // dès que les streams sont disponibles. Appelé après le set de __lastStreams.
  window.fillAdherenceSlot = function () {
    try {
      var slot = document.getElementById('pvr-adherence');
      if (!slot || slot.dataset.filled) return;
      var S = window.__lastStreams;
      if (!S || !S.watts || !S.watts.length) return;
      var structure = null;
      try { structure = JSON.parse(decodeURIComponent(slot.dataset.structure || '')); } catch (_) { return; }
      var res = window.computeAdherence(structure, S.watts, S.ftp);
      if (!res) { slot.dataset.filled = '1'; return; }
      slot.innerHTML = window.renderAdherenceHTML(res);
      slot.dataset.filled = '1';
    } catch (e) { console.warn('[adherence]', e && e.message); }
  };
})();
