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
  + '#sb-root .sb-profile{background:var(--bg-elev2,#1b2230);border:1px solid var(--border,#2a3444);border-radius:12px;padding:12px;display:flex;align-items:stretch;gap:5px;height:140px}'
  + '#sb-root .sb-pblock{display:flex;flex-direction:column;height:100%;cursor:grab;border-radius:6px;padding:3px 2px 0;min-width:8px;outline:1px solid transparent;transition:background .12s,outline .12s}'
  + '#sb-root .sb-pblock:hover{background:rgba(255,255,255,.05)}'
  + '#sb-root .sb-pblock.drag{opacity:.35}'
  + '#sb-root .sb-pblock.over{background:rgba(74,222,128,.16);outline:1px dashed var(--accent,#4ade80)}'
  + '#sb-root .sb-bars{flex:1;display:flex;align-items:flex-end;gap:1px;min-height:0}'
  + '#sb-root .sb-bar{flex:1;border-radius:3px 3px 0 0;min-width:2px;opacity:.92}'
  + '#sb-root .sb-plab{height:15px;line-height:15px;font-size:9px;color:var(--text-mute,#6b7686);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}'
  + '#sb-root .sb-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}'
  + '#sb-root .sb-tc{background:var(--bg-elev2,#1b2230);border:1px solid var(--border,#2a3444);border-radius:12px;padding:10px;text-align:center}'
  + '#sb-root .sb-tc .v{font-size:21px;font-weight:800}'
  + '#sb-root .sb-tc .k{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-mute,#6b7686);margin-top:2px}'
  + '#sb-root .sb-addbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}'
  + '#sb-root .sb-card{display:flex;align-items:center;gap:11px;text-align:left;background:var(--bg-elev2,#1b2230);border:1px solid var(--border,#2a3444);border-radius:13px;padding:11px 12px;cursor:pointer;font-family:inherit;transition:transform .12s,border-color .12s,background .12s,box-shadow .12s}'
  + '#sb-root .sb-card:hover{transform:translateY(-2px);background:var(--bg-elev,#141a23);box-shadow:0 8px 20px rgba(0,0,0,.28)}'
  + '#sb-root .sb-cico{width:36px;height:36px;flex:none;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;color:#07120b;font-weight:800;box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}'
  + '#sb-root .sb-ct{display:flex;flex-direction:column;line-height:1.25;min-width:0}'
  + '#sb-root .sb-ct b{font-size:13px;font-weight:700;color:var(--text,#e7ecf3);white-space:nowrap}'
  + '#sb-root .sb-ct small{font-size:10px;color:var(--text-mute,#6b7686);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
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
  + '#sb-root .sb-line{display:grid;grid-template-columns:46px 0.85fr 1fr 0.95fr 1.05fr;gap:8px;align-items:end}'
  + '#sb-root .sb-role{font-size:11px;color:var(--text-mute,#6b7686);text-transform:uppercase;letter-spacing:.4px}'
  + '#sb-root .sb-mini{font-size:10px;color:var(--text-mute,#6b7686);display:block;margin-bottom:3px}'
  + '#sb-root .sb-line input,#sb-root .sb-line select{width:100%;background:var(--bg-elev,#141a23);border:1px solid var(--border2,#374256);color:var(--text,#e7ecf3);border-radius:8px;padding:8px 8px;font-size:12.5px;font-family:inherit}'
  + '#sb-root .sb-line input:focus,#sb-root .sb-line select:focus{outline:none;border-color:var(--accent,#4ade80)}'
  + '#sb-root .sb-eq{grid-column:1 / -1;font-size:11px;color:var(--text-mute,#6b7686);padding:4px 0 2px 46px;white-space:nowrap}'
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
  var PACEBASE = 300;
  var ZC = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)', 'var(--z6)'];
  function zoneOf(p) { if (p < 60) return 0; if (p < 76) return 1; if (p < 90) return 2; if (p < 105) return 3; if (p < 120) return 4; return 5; }
  var ICO = { warmup: '&#9650;', interval: '&#9889;', steady: '&#9473;', recovery: '&#9176;', cooldown: '&#9660;' };
  var NAME = { warmup: 'Echauffement', interval: 'Intervalles', steady: 'Bloc continu', recovery: 'Recuperation', cooldown: 'Retour au calme' };
  var DESC = { warmup: 'Montee progressive', interval: 'Serie effort / recup', steady: 'Effort soutenu', recovery: 'Entre les efforts', cooldown: 'Descente progressive' };
  var ZONES = {
    power: { labels: ['Z1 Recup', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max', 'Z6 Anaerobie', 'Z7 Sprint'], mid: [50, 65, 83, 98, 113, 135, 170] },
    hr: { labels: ['Z1 Recup', 'Z2 Aerobie', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max'], mid: [60, 70, 82, 93, 102] },
    pace: { labels: ['Z1 Footing', 'Z2 Endurance', 'Z3 Marathon', 'Z4 Seuil', 'Z5 VO2max'], mid: [70, 80, 90, 100, 112] }
  };
  var SPORT_METRIC = { Ride: 'power', VirtualRide: 'power', cyclisme: 'power', Run: 'pace', course: 'pace', Swim: 'pace', natation: 'pace' };

  function defaults() { return []; } // demarre vide : l'utilisateur ajoute ses blocs
  var blocks = defaults();
  var mounted = false;

  function curMetric() { var s = document.getElementById('train-modal-sport'); return (s && SPORT_METRIC[s.value]) || 'power'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtPace(i) { var s = Math.round(PACEBASE * 100 / i); return Math.floor(s / 60) + ':' + pad(s % 60); }
  function zIdx(i, m) { var a = ZONES[m].mid, bi = 0, bd = 1e9; a.forEach(function (v, k) { var d = Math.abs(v - i); if (d < bd) { bd = d; bi = k; } }); return bi; }
  function label(i, m) {
    if (m === 'power') return Math.round(FTP() * i / 100) + ' W . ' + i + '% FTP . ' + ZONES.power.labels[zIdx(i, 'power')].split(' ')[0];
    if (m === 'hr') return Math.round(HRMAX() * i / 100) + ' bpm . ' + ZONES.hr.labels[zIdx(i, 'hr')].split(' ')[0];
    return fmtPace(i) + ' /km . ' + ZONES.pace.labels[zIdx(i, 'pace')].split(' ')[0];
  }
  function blockSegs(b) { var o = []; var n = Math.max(1, b.reps | 0); for (var i = 0; i < n; i++) { o.push(b.work); if (b.type === 'interval' && b.rec) o.push(b.rec); } return o; }
  function allSegs() { var o = []; blocks.forEach(function (b) { blockSegs(b).forEach(function (x) { o.push(x); }); }); return o; }
  function totals() { var dur = 0, tss = 0; allSegs().forEach(function (s) { dur += (+s.min || 0); var f = (+s.int || 0) / 100; tss += ((+s.min || 0) / 60) * f * f * 100; }); return { dur: dur, tss: Math.round(tss) }; }
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
    var mx = Math.max(120); allSegs().forEach(function (s) { mx = Math.max(mx, +s.int || 0); });
    blocks.forEach(function (b, bi) {
      var segs = blockSegs(b), bmin = bmins[bi] || 0;
      var grp = document.createElement('div'); grp.className = 'sb-pblock'; grp.draggable = true; grp.dataset.bi = bi;
      grp.style.flex = Math.max(0.06, bmin / tot); grp.title = (b.name || NAME[b.type]) + ' - ' + fmtDur(bmin);
      var inner = document.createElement('div'); inner.className = 'sb-bars'; var it = bmin || 1;
      segs.forEach(function (s) { var bar = document.createElement('div'); bar.className = 'sb-bar'; bar.style.flex = Math.max(0.05, (+s.min || 0) / it); bar.style.height = Math.max(8, ((+s.int || 0) / mx) * 100) + '%'; bar.style.background = ZC[zoneOf(+s.int || 0)]; inner.appendChild(bar); });
      var lab = document.createElement('div'); lab.className = 'sb-plab'; lab.textContent = b.name || NAME[b.type];
      grp.appendChild(inner); grp.appendChild(lab); wrap.appendChild(grp);
    });
    var ph = R('sb-profhint'); if (ph) ph.textContent = blocks.length + ' blocs . glisse pour reordonner';
  }
  function renderTotals() { var t = totals(); var a = R('sb-tdur'); if (a) a.textContent = fmtDur(t.dur); var b = R('sb-ttss'); if (b) b.textContent = t.tss; }

  function metricSel(i, w, s) { var o = [['power', 'Puissance'], ['hr', 'FC'], ['pace', 'Allure']].map(function (a) { return '<option value="' + a[0] + '"' + (s.metric === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join(''); return '<select data-i="' + i + '" data-seg="' + w + '" data-f="metric">' + o + '</select>'; }
  function unitSel(i, w, s) { var o = [['zone', 'Zones'], ['pct', '%'], ['raw', 'Valeurs']].map(function (a) { return '<option value="' + a[0] + '"' + (s.unit === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join(''); return '<select data-i="' + i + '" data-seg="' + w + '" data-f="unit">' + o + '</select>'; }
  function targetInput(i, w, s) {
    var base = 'data-i="' + i + '" data-seg="' + w + '" data-f="int"';
    if (s.unit === 'zone') { var op = ZONES[s.metric].labels.map(function (l, zi) { return '<option value="' + zi + '"' + (zi === zIdx(s.int, s.metric) ? ' selected' : '') + '>' + l + '</option>'; }).join(''); return '<select ' + base + ' data-kind="zone">' + op + '</select>'; }
    if (s.unit === 'pct') return '<input type="number" ' + base + ' data-kind="pct" value="' + s.int + '">';
    if (s.metric === 'pace') return '<input type="text" ' + base + ' data-kind="rawpace" value="' + fmtPace(s.int) + '" placeholder="m:ss">';
    var raw = s.metric === 'power' ? Math.round(FTP() * s.int / 100) : Math.round(HRMAX() * s.int / 100);
    return '<input type="number" ' + base + ' data-kind="rawnum" value="' + raw + '">';
  }
  function line(i, w, role, s) {
    return '<div class="sb-line">'
      + '<span class="sb-role">' + role + '</span>'
      + '<div><span class="sb-mini">Duree (min)</span><input type="number" min="0" step="0.5" data-i="' + i + '" data-seg="' + w + '" data-f="min" value="' + s.min + '"></div>'
      + '<div><span class="sb-mini">Mesure</span>' + metricSel(i, w, s) + '</div>'
      + '<div><span class="sb-mini">Unite</span>' + unitSel(i, w, s) + '</div>'
      + '<div><span class="sb-mini">Cible</span>' + targetInput(i, w, s) + '</div>'
      + '<div class="sb-eq"><span class="sb-chip" style="background:' + ZC[zoneOf(s.int)] + '"></span>' + label(s.int, s.metric) + '</div>'
      + '</div>';
  }
  function renderBlocks() {
    var wrap = R('sb-blocks'); if (!wrap) return; wrap.innerHTML = '';
    blocks.forEach(function (b, idx) {
      var el = document.createElement('div'); el.className = 'sb-blk'; el.style.borderLeftColor = ZC[zoneOf(b.work.int)];
      var isInt = b.type === 'interval';
      el.innerHTML = '<div class="sb-blk-top">'
        + '<span class="sb-bico">' + (ICO[b.type] || '&#9473;') + '</span>'
        + '<div class="sb-bname"><input data-i="' + idx + '" data-f="name" value="' + (b.name || NAME[b.type]) + '"></div>'
        + (isInt ? '<span class="sb-reps">Repeter <input type="number" min="1" data-i="' + idx + '" data-f="reps" value="' + b.reps + '"> x</span>' : '')
        + '<button class="sb-del" data-del="' + idx + '" title="Supprimer">&#10005;</button></div>'
        + '<div class="sb-lines">' + line(idx, 'work', isInt ? 'Effort' : 'Bloc', b.work) + (isInt ? line(idx, 'rec', 'Recup', b.rec) : '') + '</div>';
      wrap.appendChild(el);
    });
  }
  function renderAll() { renderBlocks(); renderProfile(); renderTotals(); fillFields(); }

  function applyTarget(seg, t) {
    var k = t.dataset.kind, v = seg.int;
    if (k === 'pct') v = +t.value;
    else if (k === 'zone') v = ZONES[seg.metric].mid[+t.value];
    else if (k === 'rawnum') v = seg.metric === 'power' ? Math.round((+t.value) / FTP() * 100) : Math.round((+t.value) / HRMAX() * 100);
    else if (k === 'rawpace') { var p = String(t.value).split(':'); var sec = (+p[0] || 0) * 60 + (+p[1] || 0); v = sec ? Math.round(PACEBASE * 100 / sec) : 0; }
    seg.int = v;
  }
  function onEdit(e) {
    var t = e.target, i = t.dataset.i; if (i == null) return; var b = blocks[i], f = t.dataset.f, seg = t.dataset.seg;
    if (seg && f === 'int') { applyTarget(b[seg], t); renderAll(); }
    else if (seg && f === 'min') { b[seg].min = +t.value; renderProfile(); renderTotals(); fillFields(); }
    else if (seg && (f === 'metric' || f === 'unit')) { b[seg][f] = t.value; renderAll(); }
    else if (f === 'reps') { b.reps = +t.value; renderProfile(); renderTotals(); fillFields(); }
    else if (f === 'name') { b.name = t.value; var pl = document.querySelectorAll('#sb-profile .sb-plab')[i]; if (pl) pl.textContent = t.value; }
  }

  var TEMPLATE = ''
    + '<div class="sb-toggrow"><span class="sb-toglab">Structure (intervalles)</span><label class="sb-switch"><input type="checkbox" id="sb-toggle"><span class="sb-sw"></span><span>Activer</span></label></div>'
    + '<div id="sb-body" hidden>'
    + '<div class="sb-h" style="display:flex;justify-content:space-between;align-items:baseline">Profil de la seance <span id="sb-profhint" style="font-weight:400;font-size:11px;color:var(--text-mute,#6b7686)"></span></div>'
    + '<div class="sb-profile" id="sb-profile"></div>'
    + '<div class="sb-totals"><div class="sb-tc"><div class="v" id="sb-tdur" style="color:var(--info,#60a5fa)">0</div><div class="k">Duree</div></div>'
    + '<div class="sb-tc"><div class="v" id="sb-ttss" style="color:var(--accent,#4ade80)">0</div><div class="k">TSS estime</div></div>'
    + '<div class="sb-tc"><div class="v" style="color:var(--warn,#fbbf24);font-size:13px;font-weight:600;padding-top:6px">calcule auto</div><div class="k">Duree + TSS</div></div></div>'
    + '<div class="sb-h">Ajouter un bloc</div>'
    + '<div class="sb-addbar">'
    + card('warmup', 't-warm', '&#9650;') + card('interval', 't-int', '&#9889;') + card('steady', 't-steady', '&#9473;') + card('recovery', 't-rec', '&#9176;') + card('cooldown', 't-cool', '&#9660;')
    + '</div>'
    + '<div class="sb-h">Structure <span style="font-weight:400;font-size:11px;color:var(--text-mute,#6b7686)">- mesure et unite par ligne, glisse les blocs sur le graphe pour reordonner</span></div>'
    + '<div class="sb-blocks" id="sb-blocks"></div>'
    + '</div>';
  function card(type, cls, ico) { return '<button type="button" class="sb-card ' + cls + '" data-add="' + type + '"><span class="sb-cico">' + ico + '</span><span class="sb-ct"><b>' + NAME[type] + (type === 'interval' ? ' (Nx)' : '') + '</b><small>' + DESC[type] + '</small></span></button>'; }

  function wire() {
    var rootEl = R('sb-root'); if (!rootEl) return;
    var tg = R('sb-toggle'); if (tg) tg.addEventListener('change', function () { setActive(tg.checked); });
    var bl = R('sb-blocks');
    bl.addEventListener('input', onEdit);
    bl.addEventListener('change', function (e) { var f = e.target.dataset.f; if (f === 'metric' || f === 'unit' || e.target.dataset.kind === 'zone') onEdit(e); });
    bl.addEventListener('click', function (e) { var d = e.target.dataset; if (d.del != null) { blocks.splice(+d.del, 1); renderAll(); } });
    R('sb-root').querySelector('.sb-addbar').addEventListener('click', function (e) {
      var c = e.target.closest('[data-add]'); if (!c) return; var type = c.dataset.add;
      var def = { warmup: { min: 15, int: 55 }, interval: { min: 4, int: 108 }, steady: { min: 30, int: 75 }, recovery: { min: 10, int: 50 }, cooldown: { min: 10, int: 50 } }[type];
      var m = curMetric();
      var b = { type: type, name: NAME[type], reps: type === 'interval' ? 4 : 1, work: { min: def.min, int: def.int, metric: m, unit: 'zone' } };
      if (type === 'interval') b.rec = { min: 3, int: 55, metric: m, unit: 'zone' };
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
  function setBlocks(st) { var has = !!(st && st.length && st[0] && st[0].work); if (has) blocks = JSON.parse(JSON.stringify(st)); ensureMount(); var tg = R('sb-toggle'); if (tg) tg.checked = has; setActive(has); }
  function reset() { blocks = defaults(); ensureMount(); var tg = R('sb-toggle'); if (tg) tg.checked = false; setActive(false); }
  function setRO(ro) { ['train-modal-duration', 'train-modal-tss'].forEach(function (id) { var e = R(id); if (e) { e.readOnly = ro; e.style.opacity = ro ? '0.6' : ''; } }); }
  function setActive(on) { ensureMount(); var body = R('sb-body'); if (body) body.hidden = !on; setRO(on); if (on) renderAll(); }
  function showSection() { var sb = R('sb-section'); var old = document.querySelector('.workout-structure-block'); if (sb) sb.hidden = false; if (old) old.style.display = 'none'; ensureMount(); }

  // -------- override des 3 fonctions pivot (mode prevu) --------
  // Nouvel editeur utilise pour les DEUX modes (prevu et realise) : remplace l'ancien
  // builder partout. L'ancien reste charge mais n'est plus affiche.
  window.getCurrentWorkoutStructure = function () { return getBlocks(); };
  window.setWorkoutStructure = function (s) { showSection(); setBlocks(s); };
  window.resetWorkoutStructure = function () { showSection(); reset(); };
  window.SessionBuilder = { getBlocks: getBlocks, setBlocks: setBlocks, reset: reset };
})();
