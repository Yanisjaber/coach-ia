/* ============================================================
   js/session-builder.js - Editeur de seance structuree (style Nolio)
   Branche sur la modale "prevu" via les 3 fonctions pivot deja utilisees
   par app.js : resetWorkoutStructure / setWorkoutStructure / getCurrentWorkoutStructure.
   - Builder par blocs (echauffement, intervalles Nx, continu, recup, retour calme)
   - Cible par ligne : mesure (puissance/FC/allure) + unite (zones/% /valeurs)
   - Profil visuel, blocs reordonnables a la souris sur le graphe
   - Remplit automatiquement Duree (min) et TSS estime de la modale
   Mode "realise" : on delegue a l'ancien builder (inchange).
   ============================================================ */
(function () {
  // -------- CSS (scoped sous #sb-root) --------
  var CSS = ''
  + '#sb-root{--z1:#3b82f6;--z2:#22c55e;--z3:#eab308;--z4:#f97316;--z5:#ef4444;--z6:#a855f7;display:block}'
  + '#sb-root .sb-h{font-size:12px;font-weight:700;color:var(--text-dim,#9aa6b6);margin:14px 0 8px}'
  + '#sb-root .sb-profile{background:var(--bg-elev2,#1b2230);border:1px solid var(--border,#2a3444);border-radius:12px;padding:12px;display:flex;align-items:stretch;gap:2px;height:140px;overflow:hidden}'
  + '#sb-root .sb-pblock{display:flex;flex-direction:column;height:100%;cursor:grab;border-radius:0;padding:0;min-width:0;outline:1px solid transparent;transition:background .12s,outline .12s}'
  + '#sb-root .sb-pblock:hover{background:rgba(255,255,255,.05)}'
  + '#sb-root .sb-pblock.drag{opacity:.35}'
  + '#sb-root .sb-pblock.over{background:rgba(74,222,128,.16);outline:1px dashed var(--accent,#4ade80)}'
  + '#sb-root .sb-bars{flex:1;display:flex;align-items:flex-end;gap:0;min-height:0}'
  + '#sb-root .sb-bar{flex:1;border-radius:2px 2px 0 0;min-width:1px;opacity:.95}'
  + '#sb-root .sb-plab{height:15px;line-height:15px;font-size:9px;color:var(--text-mute,#6b7686);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}'
  + '#sb-root .sb-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:4px 0 14px}'
  + '#sb-root .sb-tc{background:var(--bg-elev2,#1b2230);border:1px solid var(--border,#2a3444);border-radius:12px;padding:10px;text-align:center}'
  + '#sb-root .sb-tc .v{font-size:21px;font-weight:800}'
  + '#sb-root .sb-tc .k{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-mute,#6b7686);margin-top:2px}'
  + '#sb-root .sb-addbar{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px}'
  + '#sb-root .sb-card{display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;background:var(--bg-elev2,#1b2230);border:1px solid var(--border,#2a3444);border-radius:13px;padding:12px 6px;cursor:pointer;font-family:inherit;transition:transform .12s,border-color .12s,background .12s,box-shadow .12s}'
  + '#sb-root .sb-card:hover{transform:translateY(-2px);background:var(--bg-elev,#141a23);box-shadow:0 8px 20px rgba(0,0,0,.28)}'
  + '#sb-root .sb-cico{width:34px;height:34px;flex:none;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;color:#07120b;font-weight:800;box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}'
  + '#sb-root .sb-ct{display:flex;flex-direction:column;line-height:1.25;min-width:0}'
  + '#sb-root .sb-ct{align-items:center}'
  + '#sb-root .sb-ct b{font-size:11px;font-weight:700;color:var(--text,#e7ecf3);white-space:normal;line-height:1.2}'
  + '#sb-root .sb-ct small{display:none}'
  + '#sb-root .t-warm .sb-cico{background:linear-gradient(135deg,#3b82f6,#60a5fa)} #sb-root .t-warm:hover{border-color:#3b82f6}'
  + '#sb-root .t-int .sb-cico{background:linear-gradient(135deg,#f97316,#ef4444)} #sb-root .t-int:hover{border-color:#f97316}'
  + '#sb-root .t-steady .sb-cico{background:linear-gradient(135deg,#eab308,#f59e0b)} #sb-root .t-steady:hover{border-color:#eab308}'
  + '#sb-root .t-rec .sb-cico{background:linear-gradient(135deg,#22c55e,#4ade80)} #sb-root .t-rec:hover{border-color:#22c55e}'
  + '#sb-root .t-cool .sb-cico{background:linear-gradient(135deg,#60a5fa,#22c55e)} #sb-root .t-cool:hover{border-color:#60a5fa}'
  + '#sb-root .sb-blocks{display:flex;flex-direction:column;gap:9px}'
  + '#sb-root .sb-blk{background:var(--bg-elev2,#1b2230);border:1px solid var(--border,#2a3444);border-left:4px solid var(--z2);border-radius:11px;padding:11px 12px}'
  + '#sb-root .sb-blk-top{display:flex;align-items:center;gap:10px}'
  + '#sb-root .sb-bico{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex:none;background:var(--bg-elev,#141a23)}'
  + '#sb-root .sb-bname{font-weight:700;font-size:14px;flex:1}'
  + '#sb-root .sb-bname input{background:transparent;border:none;padding:4px 0;font-weight:700;color:var(--text,#e7ecf3);width:100%}'
  + '#sb-root .sb-reps{display:flex;align-items:center;gap:5px;background:var(--bg-elev,#141a23);border:1px solid var(--border2,#374256);border-radius:8px;padding:3px 7px;font-size:12px;color:var(--text-dim,#9aa6b6)}'
  + '#sb-root .sb-reps input{width:40px;background:transparent;border:none;text-align:center;font-weight:800;color:var(--accent,#4ade80);padding:2px}'
  + '#sb-root .sb-del{width:26px;height:26px;border:none;background:var(--bg-elev,#141a23);color:var(--text-dim,#9aa6b6);border-radius:7px;cursor:pointer;font-size:13px}'
  + '#sb-root .sb-del:hover{color:var(--danger,#f87171)}'
  + '#sb-root .sb-lines{margin-top:9px;display:flex;flex-direction:column;gap:6px}'
  + '#sb-root .sb-line{display:grid;grid-template-columns:46px 0.7fr 1.3fr;gap:10px;align-items:end}'
  + '#sb-root .sb-range{display:flex;align-items:center;gap:5px}'
  + '#sb-root .sb-range input{flex:1;min-width:0;text-align:center}'
  + '#sb-root .sb-dash{color:var(--text-mute,#6b7686);flex:none}'
  + '#sb-root .sb-cmode{display:flex;align-items:center;gap:8px;margin:9px 0 2px;font-size:12px;color:var(--text-dim,#9aa6b6)}'
  + '#sb-root .sb-csel{padding:6px 9px;font-size:12.5px;font-weight:600;color:var(--text,#e7ecf3);background:var(--bg-elev,#141a23);border:1px solid var(--border2,#374256);border-radius:8px}'
  + '#sb-root .sb-role{font-size:11px;color:var(--text-mute,#6b7686);text-transform:uppercase;letter-spacing:.4px}'
  + '#sb-root .sb-mini{font-size:10px;color:var(--text-mute,#6b7686);display:block;margin-bottom:3px}'
  + '#sb-root .sb-line input,#sb-root .sb-line select{width:100%;background:var(--bg-elev,#141a23);border:1px solid var(--border2,#374256);color:var(--text,#e7ecf3);border-radius:8px;padding:8px 8px;font-size:12.5px;font-family:inherit}'
  + '#sb-root .sb-line input:focus,#sb-root .sb-line select:focus{outline:none;border-color:var(--accent,#4ade80)}'
  + '#sb-root .sb-eq{grid-column:1 / -1;display:flex;justify-content:flex-end;padding:6px 0 1px}'
  + '#sb-root .sb-eqpill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:var(--text,#e7ecf3);background:var(--bg-elev,#141a23);border:1px solid var(--border2,#374256);border-left:3px solid var(--border2,#374256);border-radius:8px;padding:5px 11px;white-space:nowrap}'
  + '#sb-root .sb-chip{width:13px;height:13px;border-radius:4px;display:inline-block;vertical-align:-2px;margin-right:5px}'
  + '#sb-root .sb-toggrow{display:flex;align-items:center;justify-content:space-between;padding:6px 0 12px}'
  + '#sb-root .sb-toglab{font-size:13.5px;font-weight:700;color:var(--text,#e7ecf3)}'
  + '#sb-root .sb-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;color:var(--text-dim,#9aa6b6)}'
  + '#sb-root .sb-switch input{display:none}'
  + '#sb-root .sb-sw{width:40px;height:22px;border-radius:11px;background:var(--bg-elev,#141a23);border:1px solid var(--border2,#374256);position:relative;transition:.15s}'
  + '#sb-root .sb-sw::after{content:\"\";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--text-mute,#6b7686);transition:.15s}'
  + '#sb-root .sb-switch input:checked + .sb-sw{background:rgba(74,222,128,.25);border-color:var(--accent,#4ade80)}'
  + '#sb-root .sb-switch input:checked + .sb-sw::after{transform:translateX(17px);background:var(--accent,#4ade80)}';

  var styleEl = document.createElement('style');
  styleEl.id = 'sb-style'; styleEl.textContent = CSS;
  (document.head || document.documentElement).appendChild(styleEl);

  // -------- config depuis le profil --------
  function FTP() { try { var a = window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete; return (a && +a.ftp) || 250; } catch (e) { return 250; } }
  function HRMAX() { try { var a = window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete; return (a && (+a.hr_max || +a.hrMax)) || 190; } catch (e) { return 190; } }
  var PACE = { course: { base: 240, unit: '/km' }, natation: { base: 100, unit: '/100m' } };
  var ZC = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)', 'var(--z6)'];
  function zoneOf(p) { if (p < 60) return 0; if (p < 76) return 1; if (p < 90) return 2; if (p < 105) return 3; if (p < 120) return 4; return 5; }
  var ICO = { warmup: '&#9650;', interval: '&#9889;', steady: '&#9473;', recovery: '&#9176;', cooldown: '&#9660;' };
  var NAME = { warmup: 'Echauffement', interval: 'Intervalles', steady: 'Bloc continu', recovery: 'Recuperation', cooldown: 'Retour au calme' };
  var DESC = { warmup: 'Montee progressive', interval: 'Serie effort / recup', steady: 'Effort soutenu', recovery: 'Entre les efforts', cooldown: 'Descente progressive' };
  var ZONES = {
    power: { labels: ['Z1 Recup', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max', 'Z6 Anaerobie', 'Z7 Sprint'], mid: [50, 65, 83, 98, 113, 135, 170], lo: [40, 56, 76, 91, 106, 121, 151], hi: [55, 75, 90, 105, 120, 150, 200] },
    hr: { labels: ['Z1 Recup', 'Z2 Aerobie', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max'], mid: [60, 70, 82, 93, 102], lo: [50, 60, 71, 83, 94], hi: [60, 70, 82, 93, 106] },
    pace: { labels: ['Z1 Footing', 'Z2 Endurance', 'Z3 Marathon', 'Z4 Seuil', 'Z5 VO2max'], mid: [70, 80, 90, 100, 112], lo: [60, 75, 85, 95, 106], hi: [75, 85, 95, 106, 125] }
  };
  var SPORT_GROUP = { Ride: 'cyclisme', VirtualRide: 'cyclisme', MountainBikeRide: 'cyclisme', GravelRide: 'cyclisme', EBikeRide: 'cyclisme', EMountainBikeRide: 'cyclisme', cyclisme: 'cyclisme', Run: 'course', TrailRun: 'course', VirtualRun: 'course', course: 'course', Swim: 'natation', OpenWaterSwim: 'natation', natation: 'natation' };
  var METRICS = { cyclisme: [['power', 'Puissance'], ['hr', 'FC']], course: [['pace', 'Allure'], ['hr', 'FC']], natation: [['pace', 'Allure'], ['hr', 'FC']] };
  function grp() { var s = document.getElementById('train-modal-sport'); return (s && SPORT_GROUP[s.value]) || 'cyclisme'; }
  function paceBase() { var g = grp(); return (PACE[g] && PACE[g].base) || 240; }
  function paceUnit() { var g = grp(); return (PACE[g] && PACE[g].unit) || '/km'; }
  function normalizeMetrics() { var gm = METRICS[grp()].map(function (a) { return a[0]; }); blocks.forEach(function (b) { if (!b.metric && b.work && b.work.metric) b.metric = b.work.metric; if (!b.unit && b.work && b.work.unit) b.unit = b.work.unit; if (!b.metric || gm.indexOf(b.metric) < 0) b.metric = gm[0]; if (!b.unit) b.unit = 'zone'; }); }

  function defaults() { return []; } // demarre vide : l'utilisateur ajoute ses blocs
  var blocks = defaults();
  var mounted = false;

  function curMetric() { return METRICS[grp()][0][0]; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtPace(i) { var s = Math.round(paceBase() * 100 / i); return Math.floor(s / 60) + ':' + pad(s % 60); }
  function zIdx(i, m) { var a = ZONES[m].mid, bi = 0, bd = 1e9; a.forEach(function (v, k) { var d = Math.abs(v - i); if (d < bd) { bd = d; bi = k; } }); return bi; }
  function midOf(s) { return (s.intHi != null && +s.intHi > 0) ? ((+s.int + +s.intHi) / 2) : (+s.int || 0); }
  function label(seg, m) {
    var lo = +seg.int || 0, hi = (seg.intHi != null && +seg.intHi > 0) ? +seg.intHi : null;
    var z = ZONES[m].labels[zIdx(midOf(seg), m)].split(' ')[0];
    if (hi == null) {
      if (m === 'power') return Math.round(FTP() * lo / 100) + ' W . ' + Math.round(lo) + '% FTP . ' + z;
      if (m === 'hr') return Math.round(HRMAX() * lo / 100) + ' bpm . ' + z;
      return fmtPace(lo) + ' ' + paceUnit() + ' . ' + z;
    }
    var a = Math.min(lo, hi), c = Math.max(lo, hi);
    if (m === 'power') return Math.round(FTP() * a / 100) + '-' + Math.round(FTP() * c / 100) + ' W . ' + Math.round(a) + '-' + Math.round(c) + '% FTP . ' + z;
    if (m === 'hr') return Math.round(HRMAX() * a / 100) + '-' + Math.round(HRMAX() * c / 100) + ' bpm . ' + z;
    return fmtPace(c) + '-' + fmtPace(a) + ' ' + paceUnit() + ' . ' + z;
  }
  function blockSegs(b) { var o = []; var n = Math.max(1, b.reps | 0); for (var i = 0; i < n; i++) { o.push(b.work); if (b.type === 'interval' && b.rec) o.push(b.rec); } return o; }
  function allSegs() { var o = []; blocks.forEach(function (b) { blockSegs(b).forEach(function (x) { o.push(x); }); }); return o; }
  function totals() { var dur = 0, tss = 0; allSegs().forEach(function (s) { dur += (+s.min || 0); var f = midOf(s) / 100; tss += ((+s.min || 0) / 60) * f * f * 100; }); return { dur: dur, tss: Math.round(tss) }; }
  function fmtDur(min) { var h = Math.floor(min / 60), m = Math.round(min % 60); return h ? h + 'h' + pad(m) : m + ' min'; }

  function R(id) { return document.getElementById(id); }
  function fillFields() {
    var t = totals();
    var d = R('train-modal-duration'); if (d) { d.value = Math.round(t.dur); }
    var ts = R('train-modal-tss'); if (ts) { ts.value = t.tss; }
  }

  function renderProfile() {
    var wrap = R('sb-profile'); if (!wrap) return; wrap.innerHTML = '';
    if (!blocks.length) { wrap.innerHTML = '<div style="margin:auto;color:var(--text-mute,#6b7686);font-size:12.5px;text-align:center">Ajoute un bloc ci-dessous pour construire la seance.</div>'; var ph0 = R('sb-profhint'); if (ph0) ph0.textContent = ''; return; }
    var bmins = blocks.map(function (b) { return blockSegs(b).reduce(function (s, x) { return s + (+x.min || 0); }, 0); });
    var tot = bmins.reduce(function (a, b) { return a + b; }, 0) || 1;
    var mx = Math.max(120); allSegs().forEach(function (s) { mx = Math.max(mx, midOf(s)); });
    blocks.forEach(function (b, bi) {
      var segs = blockSegs(b), bmin = bmins[bi] || 0;
      var grp = document.createElement('div'); grp.className = 'sb-pblock'; grp.draggable = true; grp.dataset.bi = bi;
      grp.style.flex = Math.max(0.06, bmin / tot); grp.title = (b.name || NAME[b.type]) + ' - ' + fmtDur(bmin);
      var inner = document.createElement('div'); inner.className = 'sb-bars'; var it = bmin || 1;
      segs.forEach(function (s) { var bar = document.createElement('div'); bar.className = 'sb-bar'; bar.style.flex = Math.max(0.05, (+s.min || 0) / it); bar.style.height = Math.max(8, (midOf(s) / mx) * 100) + '%'; bar.style.background = ZC[zoneOf(midOf(s))]; inner.appendChild(bar); });
      var lab = document.createElement('div'); lab.className = 'sb-plab'; lab.textContent = b.name || NAME[b.type];
      grp.appendChild(inner); grp.appendChild(lab); wrap.appendChild(grp);
    });
    var ph = R('sb-profhint'); if (ph) ph.textContent = blocks.length + ' blocs . glisse pour reordonner';
  }
  function renderTotals() { var t = totals(); var a = R('sb-tdur'); if (a) a.textContent = fmtDur(t.dur); var b = R('sb-ttss'); if (b) b.textContent = t.tss; }
  // Met a jour pastilles + couleurs SANS reconstruire les champs (sinon on perd le focus en saisie)
  function refreshPills() {
    var els = document.querySelectorAll('#sb-blocks .sb-blk');
    els.forEach(function (el, bi) {
      var b = blocks[bi]; if (!b) return;
      el.style.borderLeftColor = ZC[zoneOf(midOf(b.work))];
      var order = ['work']; if (b.type === 'interval' && b.rec) order.push('rec');
      var lines = el.querySelectorAll('.sb-line');
      lines.forEach(function (ln, k) {
        var seg = b[order[k]]; if (!seg) return;
        var pill = ln.querySelector('.sb-eqpill'); if (!pill) return;
        var col = ZC[zoneOf(midOf(seg))];
        pill.style.borderLeftColor = col;
        pill.innerHTML = '<span class="sb-chip" style="background:' + col + '"></span>' + label(seg, b.metric);
      });
    });
  }
  function lightRefresh() { refreshPills(); renderProfile(); renderTotals(); fillFields(); }

  function metricSel(idx, b) { var o = METRICS[grp()].map(function (a) { return '<option value="' + a[0] + '"' + (b.metric === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join(''); return '<select class="sb-csel" data-i="' + idx + '" data-f="metric">' + o + '</select>'; }
  function unitSel(idx, b) { var o = [['zone', 'Zones'], ['pct', '%'], ['raw', 'Valeurs']].map(function (a) { return '<option value="' + a[0] + '"' + (b.unit === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join(''); return '<select class="sb-csel" data-i="' + idx + '" data-f="unit">' + o + '</select>'; }
  function targetInput(idx, which, b) {
    var seg = b[which]; var d = 'data-i="' + idx + '" data-seg="' + which + '"';
    if (b.unit === 'zone') { var op = ZONES[b.metric].labels.map(function (l, zi) { return '<option value="' + zi + '"' + (zi === zIdx(midOf(seg), b.metric) ? ' selected' : '') + '>' + l + '</option>'; }).join(''); return '<select ' + d + ' data-f="int" data-kind="zone">' + op + '</select>'; }
    var kind = b.unit === 'pct' ? 'pct' : (b.metric === 'pace' ? 'rawpace' : 'rawnum');
    var toRaw = function (i) { return b.metric === 'power' ? Math.round(FTP() * i / 100) : Math.round(HRMAX() * i / 100); };
    var loVal, hiVal;
    if (kind === 'pct') { loVal = Math.round(seg.int); hiVal = (seg.intHi != null && +seg.intHi > 0) ? Math.round(seg.intHi) : ''; }
    else if (kind === 'rawpace') { loVal = fmtPace(seg.int); hiVal = (seg.intHi != null && +seg.intHi > 0) ? fmtPace(seg.intHi) : ''; }
    else { loVal = toRaw(seg.int); hiVal = (seg.intHi != null && +seg.intHi > 0) ? toRaw(seg.intHi) : ''; }
    var typ = (kind === 'rawpace') ? 'text' : 'number';
    var phLo = (kind === 'rawpace') ? ' placeholder="m:ss"' : '';
    var lo = '<input type="' + typ + '" ' + d + ' data-f="int" data-kind="' + kind + '" value="' + loVal + '"' + phLo + '>';
    var hi = '<input type="' + typ + '" ' + d + ' data-f="intHi" data-kind="' + kind + '" value="' + hiVal + '" placeholder="max">';
    return '<div class="sb-range">' + lo + '<span class="sb-dash">-</span>' + hi + '</div>';
  }
  function line(idx, which, role, b) {
    var seg = b[which];
    return '<div class="sb-line">'
      + '<span class="sb-role">' + role + '</span>'
      + '<div><span class="sb-mini">Duree (min)</span><input type="number" min="0" step="0.5" data-i="' + idx + '" data-seg="' + which + '" data-f="min" value="' + seg.min + '"></div>'
      + '<div><span class="sb-mini">Cible</span>' + targetInput(idx, which, b) + '</div>'
      + '<div class="sb-eq"><span class="sb-eqpill" style="border-left-color:' + ZC[zoneOf(midOf(seg))] + '"><span class="sb-chip" style="background:' + ZC[zoneOf(midOf(seg))] + '"></span>' + label(seg, b.metric) + '</span></div>'
      + '</div>';
  }
  function renderBlocks() {
    var wrap = R('sb-blocks'); if (!wrap) return; wrap.innerHTML = '';
    blocks.forEach(function (b, idx) {
      var el = document.createElement('div'); el.className = 'sb-blk'; el.style.borderLeftColor = ZC[zoneOf(midOf(b.work))];
      var isInt = b.type === 'interval';
      el.innerHTML = '<div class="sb-blk-top">'
        + '<span class="sb-bico">' + (ICO[b.type] || '&#9473;') + '</span>'
        + '<div class="sb-bname"><input data-i="' + idx + '" data-f="name" value="' + (b.name || NAME[b.type]) + '"></div>'
        + (isInt ? '<span class="sb-reps">Repeter <input type="number" min="1" data-i="' + idx + '" data-f="reps" value="' + b.reps + '"> x</span>' : '')
        + '<button class="sb-del" data-del="' + idx + '" title="Supprimer">&#10005;</button></div>'
        + '<div class="sb-cmode">Cibles en ' + metricSel(idx, b) + unitSel(idx, b) + '</div>'
        + '<div class="sb-lines">' + line(idx, 'work', isInt ? 'Effort' : 'Bloc', b) + (isInt ? line(idx, 'rec', 'Recup', b) : '') + '</div>';
      wrap.appendChild(el);
    });
  }
  function renderAll() { normalizeMetrics(); renderBlocks(); renderProfile(); renderTotals(); fillFields(); }

  function convVal(b, kind, val) {
    if (kind === 'pct') return +val;
    if (kind === 'zone') return ZONES[b.metric].mid[+val];
    if (kind === 'rawpace') { var p = String(val).split(':'); var sec = (+p[0] || 0) * 60 + (+p[1] || 0); return sec ? (paceBase() * 100 / sec) : 0; }
    return b.metric === 'power' ? ((+val) / FTP() * 100) : ((+val) / HRMAX() * 100);
  }
  function onEdit(e) {
    var t = e.target, i = t.dataset.i; if (i == null) return; var b = blocks[i], f = t.dataset.f, seg = t.dataset.seg;
    if (seg && (f === 'int' || f === 'intHi')) {
      if (t.dataset.kind === 'zone') { var zi = +t.value; b[seg].int = ZONES[b.metric].lo[zi]; b[seg].intHi = ZONES[b.metric].hi[zi]; renderAll(); }
      else { var raw = String(t.value).trim(); if (f === 'intHi' && raw === '') b[seg].intHi = null; else b[seg][f] = convVal(b, t.dataset.kind, t.value); lightRefresh(); }
    }
    else if (seg && f === 'min') { b[seg].min = +t.value; lightRefresh(); }
    else if (!seg && (f === 'metric' || f === 'unit')) { b[f] = t.value; if (b.unit === 'zone') { ['work', 'rec'].forEach(function (w) { var sg = b[w]; if (!sg) return; var zi = zIdx(midOf(sg), b.metric); sg.int = ZONES[b.metric].lo[zi]; sg.intHi = ZONES[b.metric].hi[zi]; }); } renderAll(); }
    else if (f === 'reps') { b.reps = +t.value; renderProfile(); renderTotals(); fillFields(); }
    else if (f === 'name') { b.name = t.value; var pl = document.querySelectorAll('#sb-profile .sb-plab')[i]; if (pl) pl.textContent = t.value; }
  }

  var TEMPLATE = ''
    + '<div class="sb-toggrow"><span class="sb-toglab">Structure (intervalles)</span><label class="sb-switch"><input type="checkbox" id="sb-toggle"><span class="sb-sw"></span><span>Activer</span></label></div>'
    + '<div id="sb-body" hidden>'
    + '<div class="sb-totals"><div class="sb-tc"><div class="v" id="sb-tdur" style="color:var(--info,#60a5fa)">0</div><div class="k">Duree</div></div>'
    + '<div class="sb-tc"><div class="v" id="sb-ttss" style="color:var(--accent,#4ade80)">0</div><div class="k">TSS estime</div></div>'
    + '<div class="sb-tc"><div class="v" style="color:var(--warn,#fbbf24);font-size:13px;font-weight:600;padding-top:6px">calcule auto</div><div class="k">Duree + TSS</div></div></div>'
    + '<div class="sb-h" style="display:flex;justify-content:space-between;align-items:baseline">Profil de la seance <span id="sb-profhint" style="font-weight:400;font-size:11px;color:var(--text-mute,#6b7686)"></span></div>'
    + '<div class="sb-profile" id="sb-profile"></div>'
    + '<div class="sb-h">Ajouter un bloc</div>'
    + '<div class="sb-addbar">'
    + card('warmup', 't-warm', '&#9650;') + card('interval', 't-int', '&#9889;') + card('steady', 't-steady', '&#9473;') + card('recovery', 't-rec', '&#9176;') + card('cooldown', 't-cool', '&#9660;')
    + '</div>'
    + '<div class="sb-h">Structure <span style="font-weight:400;font-size:11px;color:var(--text-mute,#6b7686)">- mesure et unite par bloc, glisse les blocs sur le graphe pour reordonner</span></div>'
    + '<div class="sb-blocks" id="sb-blocks"></div>'
    + '</div>';
  function card(type, cls, ico) { return '<button type="button" class="sb-card ' + cls + '" data-add="' + type + '" title="' + DESC[type] + '"><span class="sb-cico">' + ico + '</span><span class="sb-ct"><b>' + NAME[type] + (type === 'interval' ? ' (Nx)' : '') + '</b><small>' + DESC[type] + '</small></span></button>'; }

  function wire() {
    var rootEl = R('sb-root'); if (!rootEl) return;
    var tg = R('sb-toggle'); if (tg) tg.addEventListener('change', function () { setActive(tg.checked); });
    var sp = document.getElementById('train-modal-sport'); if (sp) sp.addEventListener('change', function () { normalizeMetrics(); renderAll(); });
    var bl = R('sb-blocks');
    bl.addEventListener('input', onEdit);
    bl.addEventListener('change', function (e) { var f = e.target.dataset.f; if (f === 'metric' || f === 'unit' || e.target.dataset.kind === 'zone') onEdit(e); });
    bl.addEventListener('click', function (e) { var d = e.target.dataset; if (d.del != null) { blocks.splice(+d.del, 1); renderAll(); } });
    R('sb-root').querySelector('.sb-addbar').addEventListener('click', function (e) {
      var c = e.target.closest('[data-add]'); if (!c) return; var type = c.dataset.add;
      var def = { warmup: { min: 15, int: 55 }, interval: { min: 4, int: 108 }, steady: { min: 30, int: 75 }, recovery: { min: 10, int: 50 }, cooldown: { min: 10, int: 50 } }[type];
      var m = curMetric();
      var b = { type: type, name: NAME[type], reps: type === 'interval' ? 4 : 1, metric: m, unit: 'zone', work: { min: def.min, int: def.int } };
      if (type === 'interval') b.rec = { min: 3, int: 55 };
      [b.work, b.rec].forEach(function (sg) { if (!sg) return; var zi = zIdx(sg.int, m); sg.int = ZONES[m].lo[zi]; sg.intHi = ZONES[m].hi[zi]; });
      blocks.push(b); renderAll();
    });
    // drag & drop sur le graphe
    var prof = R('sb-profile'); var dragBi = null;
    prof.addEventListener('dragstart', function (e) { var g = e.target.closest('.sb-pblock'); if (!g) return; dragBi = +g.dataset.bi; g.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragBi)); } catch (_) {} });
    prof.addEventListener('dragend', function () { prof.querySelectorAll('.sb-pblock').forEach(function (x) { x.classList.remove('drag', 'over'); }); dragBi = null; });
    prof.addEventListener('dragover', function (e) { e.preventDefault(); var g = e.target.closest('.sb-pblock'); prof.querySelectorAll('.sb-pblock').forEach(function (x) { x.classList.remove('over'); }); if (g && +g.dataset.bi !== dragBi) g.classList.add('over'); });
    prof.addEventListener('drop', function (e) { e.preventDefault(); var g = e.target.closest('.sb-pblock'); if (!g || dragBi == null) return; var to = +g.dataset.bi; if (to === dragBi) return; var mv = blocks.splice(dragBi, 1)[0]; blocks.splice(to, 0, mv); dragBi = null; renderAll(); });
  }
  function ensureMount() { if (mounted) return; var r = R('sb-root'); if (!r) return; r.innerHTML = TEMPLATE; wire(); mounted = true; }

  // -------- API interne --------
  function isOn() { var tg = R('sb-toggle'); return !!(tg && tg.checked); }
  function getBlocks() { if (!isOn()) return null; return (blocks && blocks.length) ? JSON.parse(JSON.stringify(blocks)) : null; }
  function setBlocks(st) { var has = !!(st && st.length && st[0] && st[0].work); if (has) { blocks = JSON.parse(JSON.stringify(st)); blocks.forEach(function (b) { if (!b.metric && b.work && b.work.metric) b.metric = b.work.metric; if (!b.unit && b.work && b.work.unit) b.unit = b.work.unit; }); } ensureMount(); var tg = R('sb-toggle'); if (tg) tg.checked = has; setActive(has); }
  function reset() { blocks = defaults(); ensureMount(); var tg = R('sb-toggle'); if (tg) tg.checked = false; setActive(false); }
  function setRO(ro) { ['train-modal-duration', 'train-modal-tss'].forEach(function (id) { var e = R(id); if (e) { e.readOnly = ro; e.style.opacity = ro ? '0.6' : ''; } }); }
  function setActive(on) { ensureMount(); var body = R('sb-body'); if (body) body.hidden = !on; setRO(on); if (on) renderAll(); }
  function showSection() { var sb = R('sb-section'); var old = document.querySelector('.workout-structure-block'); if (sb) sb.hidden = false; if (old) old.style.display = 'none'; ensureMount(); }

  // -------- override des 3 fonctions pivot (mode prevu) --------
  // Nouvel editeur utilise pour les DEUX modes (prevu et realise) : remplace l'ancien
  // builder partout. L'ancien reste charge mais n'est plus affiche.
  // Rendu LECTURE SEULE du profil depuis un tableau de blocs (pour les fiches detail).
  // Reutilise blockSegs / midOf / zoneOf / NAME / fmtDur. Couleurs en dur (hors #sb-root).
  window.renderWorkoutProfileHTML = function (blks, opts) {
    if (!Array.isArray(blks) || !blks.length) return '';
    opts = opts || {};
    var H = opts.height || 140;
    var showLabels = opts.labels !== false;
    var pad = (opts.padding != null) ? opts.padding : 12;
    var bg = (opts.bg != null) ? opts.bg : 'var(--bg-elev2,#1b2230)';
    var brd = (opts.border != null) ? opts.border : '1px solid var(--border,#2a3444)';
    var radius = (opts.radius != null) ? opts.radius : 12;
    var minFlex = (opts.minFlex != null) ? opts.minFlex : 0.06;
    var ZHEX = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
    var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var bmins = blks.map(function (b) { return blockSegs(b).reduce(function (a, x) { return a + (+x.min || 0); }, 0); });
    var tot = bmins.reduce(function (a, b) { return a + b; }, 0) || 1;
    var mx = 120; blks.forEach(function (b) { blockSegs(b).forEach(function (s) { mx = Math.max(mx, midOf(s)); }); });
    var html = '<div style="background:' + bg + ';border:' + brd + ';border-radius:' + radius + 'px;padding:' + pad + 'px;display:flex;align-items:stretch;gap:2px;height:' + H + 'px;overflow:hidden">';
    blks.forEach(function (b, bi) {
      var segs = blockSegs(b), bmin = bmins[bi] || 0, it = bmin || 1;
      html += '<div title="' + esc((b.name || NAME[b.type] || '') + ' - ' + fmtDur(bmin)) + '" style="display:flex;flex-direction:column;height:100%;min-width:0;flex:' + Math.max(minFlex, bmin / tot) + '">';
      html += '<div style="flex:1;display:flex;align-items:flex-end;gap:0;min-height:0">';
      segs.forEach(function (s) {
        var hgt = Math.max(8, (midOf(s) / mx) * 100);
        html += '<div style="flex:' + Math.max(0.05, (+s.min || 0) / it) + ';height:' + hgt + '%;background:' + ZHEX[zoneOf(midOf(s))] + ';border-radius:2px 2px 0 0;min-width:1px;opacity:.95"></div>';
      });
      html += '</div>';
      if (showLabels) html += '<div style="height:15px;line-height:15px;font-size:9px;color:var(--text-mute,#6b7686);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px">' + esc(b.name || NAME[b.type] || '') + '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  };
  // Detail des intervalles : barres proportionnelles a la duree (largeur = duree),
  // colorees par zone, texte en surimpression (toujours lisible) ; series encadrees "xN".
  window.renderWorkoutDetailHTML = function (blks) {
    if (!Array.isArray(blks) || !blks.length) return '';
    var ZHEX = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
    var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    function valStr(seg, m) {
      var lo = +seg.int || 0, hi = (seg.intHi != null && +seg.intHi > 0) ? +seg.intHi : null;
      var a = hi == null ? lo : Math.min(lo, hi), c = hi == null ? lo : Math.max(lo, hi);
      if (m === 'power') { var w1 = Math.round(FTP() * a / 100), w2 = Math.round(FTP() * c / 100); return hi == null ? (w1 + ' W') : (w1 + '-' + w2 + ' W'); }
      if (m === 'hr') { var b1 = Math.round(HRMAX() * a / 100), b2 = Math.round(HRMAX() * c / 100); return hi == null ? (b1 + ' bpm') : (b1 + '-' + b2 + ' bpm'); }
      return hi == null ? (fmtPace(a) + ' ' + paceUnit()) : (fmtPace(c) + '-' + fmtPace(a) + ' ' + paceUnit());
    }
    // Reference = plus longue duree de segment unitaire (1 rep)
    var maxMin = 1;
    blks.forEach(function (b) {
      if (b.work && +b.work.min > maxMin) maxMin = +b.work.min;
      if (b.type === 'interval' && b.rec && +b.rec.min > maxMin) maxMin = +b.rec.min;
    });
    function bar(seg, m, leftLabel) {
      var zi = zoneOf(midOf(seg)); var col = ZHEX[zi];
      var pct = Math.max(10, Math.min(100, Math.round((+seg.min || 0) / maxMin * 100)));
      var txt = fmtDur(+seg.min || 0) + ' · Z' + (zi + 1) + ' · ' + valStr(seg, m);
      return '<div style="display:flex;align-items:center;gap:10px;margin:7px 0">'
        + '<span style="font-size:12px;color:var(--text-dim,#9aa6b6);width:92px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(leftLabel) + '</span>'
        + '<div style="flex:1;position:relative;background:var(--bg-elev,#1e2636);border-radius:6px;height:26px;overflow:hidden">'
        +   '<div style="position:absolute;left:0;top:0;bottom:0;width:' + pct + '%;background:' + col + '4d;border-left:3px solid ' + col + '"></div>'
        +   '<div style="position:relative;line-height:26px;padding-left:10px;font-size:11.5px;color:var(--text,#dfe5ef);white-space:nowrap">' + esc(txt) + '</div>'
        + '</div>'
        + '</div>';
    }
    var out = blks.map(function (b) {
      var m = (b.metric) || (b.work && b.work.metric) || 'power';
      if (!ZONES[m]) m = 'power';
      var nm = b.name || NAME[b.type] || 'Bloc';
      if (b.type === 'interval' && b.rec) {
        var reps = Math.max(1, b.reps | 0);
        return '<div style="position:relative;border:1px solid #33406a;border-radius:10px;padding:13px 10px 7px;margin:13px 0 9px">'
          + '<span style="position:absolute;top:-10px;left:12px;background:#22305a;color:#9dc0f5;font-size:11px;font-weight:700;border-radius:6px;padding:2px 9px">×' + reps + '</span>'
          + bar(b.work, m, 'Effort')
          + bar(b.rec, m, b.rec.name || 'Récup')
          + '</div>';
      }
      return bar(b.work || {}, m, nm);
    }).join('');
    return '<div style="margin-top:18px">' + out + '</div>';
  };
  window.getCurrentWorkoutStructure = function () { return getBlocks(); };
  window.setWorkoutStructure = function (s) { showSection(); setBlocks(s); };
  window.resetWorkoutStructure = function () { showSection(); reset(); };
  window.SessionBuilder = { getBlocks: getBlocks, setBlocks: setBlocks, reset: reset };
})();
