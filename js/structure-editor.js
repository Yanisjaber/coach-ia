/* ============================================================
   js/structure-editor.js — Éditeur de structure PLEINE PAGE (v2)
   Maquette validée : topbar (nom, compteurs, undo/redo, Valider),
   étagère de modèles, graphe géant à bandes de zones avec blocs
   manipulables (sélection, poignées durée/intensité, réordonner),
   rangée d'ajout, ligne de commande (« 4x4' Z5 récup 3' »),
   inspecteur du bloc sélectionné, déroulé + sauvegarde bibliothèque.

   Il lit/écrit le MÊME format que session-builder.js via les pivots
   window.get/setWorkoutStructure : blocks[] { type, name, reps,
   metric ('power'|'hr'|'pace'), unit, work:{min,int,intHi}, rec }
   avec int en % (FTP / FCmax / allure de base).
   ============================================================ */
(function () {
  'use strict';

  // ---------- Constantes (miroir de session-builder) ----------
  const ZHEX = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#ec4899'];
  const ZONES = {
    power: { labels: ['Z1 Récup', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max', 'Z6 Anaérobie', 'Z7 Sprint'], mid: [50, 65, 83, 98, 113, 135, 170], lo: [40, 56, 76, 91, 106, 121, 151], hi: [55, 75, 90, 105, 120, 150, 200] },
    hr: { labels: ['Z1 Récup', 'Z2 Aérobie', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max'], mid: [60, 70, 82, 93, 102], lo: [50, 60, 71, 83, 94], hi: [60, 70, 82, 93, 106] },
    pace: { labels: ['Z1 Footing', 'Z2 Endurance', 'Z3 Marathon', 'Z4 Seuil', 'Z5 VO2max'], mid: [70, 80, 90, 100, 112], lo: [60, 75, 85, 95, 106], hi: [75, 85, 95, 106, 125] },
  };
  const SPORT_GROUP = { Ride: 'cyclisme', VirtualRide: 'cyclisme', MountainBikeRide: 'cyclisme', GravelRide: 'cyclisme', EBikeRide: 'cyclisme', EMountainBikeRide: 'cyclisme', cyclisme: 'cyclisme', Run: 'course', TrailRun: 'course', VirtualRun: 'course', course: 'course', Swim: 'natation', OpenWaterSwim: 'natation', natation: 'natation' };
  const METRICS = { cyclisme: [['power', 'Watts'], ['hr', 'FC']], course: [['pace', 'Allure'], ['hr', 'FC']], natation: [['pace', 'Allure'], ['hr', 'FC']] };
  const PACE = { course: { base: 240, unit: '/km' }, natation: { base: 100, unit: '/100m' } };
  const NAME = { warmup: 'Échauffement', interval: 'Intervalles', steady: 'Bloc continu', recovery: 'Récupération', cooldown: 'Retour au calme' };
  const TYPE_DEFAULT = {
    warmup: { work: { min: 15, int: 40, intHi: 55 } },
    interval: { work: { min: 4, int: 106, intHi: 120 }, rec: { min: 3, int: 40, intHi: 55 }, reps: 4 },
    steady: { work: { min: 30, int: 76, intHi: 90 } },
    recovery: { work: { min: 10, int: 40, intHi: 55 } },
    cooldown: { work: { min: 10, int: 40, intHi: 55 } },
  };
  const PRESETS = [
    { name: '30/30 ×12', mk: () => [blk('warmup', 15, 0), { type: 'interval', name: '30/30', reps: 12, metric: 'power', unit: 'zone', work: { min: 0.5, int: 121, intHi: 150 }, rec: { min: 0.5, int: 40, intHi: 55 } }, blk('cooldown', 10, 0)] },
    { name: '4×4 min', mk: () => [blk('warmup', 15, 0), { type: 'interval', name: '4×4 VO2', reps: 4, metric: 'power', unit: 'zone', work: { min: 4, int: 106, intHi: 120 }, rec: { min: 3, int: 40, intHi: 55 } }, blk('cooldown', 10, 0)] },
    { name: '2×20 sweet spot', mk: () => [blk('warmup', 15, 0), { type: 'interval', name: 'Sweet spot', reps: 2, metric: 'power', unit: 'pct', work: { min: 20, int: 88, intHi: 93 }, rec: { min: 5, int: 40, intHi: 55 } }, blk('cooldown', 10, 0)] },
    { name: 'Pyramide', mk: () => [blk('warmup', 15, 0), pyr(1), pyr(2), pyr(3), pyr(2), pyr(1), blk('cooldown', 10, 0)] },
    { name: 'Gimenez', mk: () => [blk('warmup', 15, 0), { type: 'interval', name: 'Gimenez', reps: 9, metric: 'power', unit: 'pct', work: { min: 1, int: 100, intHi: 110 }, rec: { min: 4, int: 65, intHi: 75 } }, blk('cooldown', 10, 0)] },
  ];
  function blk(type, min, _z) {
    const d = TYPE_DEFAULT[type];
    return { type, name: NAME[type], reps: 1, metric: 'power', unit: 'zone', work: { min, int: d.work.int, intHi: d.work.intHi } };
  }
  function pyr(n) { return { type: 'steady', name: n + ' min', reps: 1, metric: 'power', unit: 'zone', work: { min: n, int: 106, intHi: 120 } }; }

  // ---------- Profil athlète ----------
  const FTP = () => { try { const a = window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete; return (a && +a.ftp) || 250; } catch (e) { return 250; } };
  const HRMAX = () => { try { const a = window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete; return (a && (+a.hr_max || +a.hrMax)) || 190; } catch (e) { return 190; } };

  // ---------- État ----------
  let blocks = [];
  let sel = null;            // { bi, which: 'work'|'rec' }
  let undoStack = [], redoStack = [];
  let root = null;           // #p-structure

  const grp = () => { const s = document.getElementById('train-modal-sport'); return (s && SPORT_GROUP[s.value]) || 'cyclisme'; };
  const zonesOf = (m) => ZONES[m] || ZONES.power;
  const midOf = (s) => (s.intHi != null && +s.intHi > 0) ? ((+s.int + +s.intHi) / 2) : (+s.int || 0);
  const zoneOf = (p) => { if (p < 55) return 0; if (p < 76) return 1; if (p < 91) return 2; if (p < 106) return 3; if (p < 121) return 4; if (p < 151) return 5; return 6; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const paceBase = () => (PACE[grp()] && PACE[grp()].base) || 240;
  const paceUnit = () => (PACE[grp()] && PACE[grp()].unit) || '/km';
  const fmtPace = (i) => { const s = Math.round(paceBase() * 100 / Math.max(1, i)); return Math.floor(s / 60) + ':' + pad2(s % 60); };
  const fmtMin = (min) => { const t = Math.round((+min || 0) * 60), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; if (h) return h + 'h' + pad2(m); if (s && m) return m + ':' + pad2(s); if (!m) return s + 's'; return m + ':00'; };
  const fmtDur = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? h + 'h' + pad2(m) : m + ' min'; };
  // Durée en texte libre -> minutes. Accepte : 15 · 15m · 15min · 15mn · 15' ·
  // 15s · 15sec · 15" · 1h · 1h15 · 1h15m30s · 4:30 (m:ss) · 1:15:30 (h:mm:ss) · 1,5
  function parseDurTxt(v) {
    v = String(v == null ? '' : v).trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
    if (!v) return null;
    let m = v.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (m) return +m[1] * 60 + +m[2] + +m[3] / 60;
    m = v.match(/^(\d+):(\d{1,2})$/);
    if (m) return +m[1] + +m[2] / 60;
    m = v.match(/^(\d+)h(\d{1,2})$/); // 1h15 = minutes collées après h
    if (m) return +m[1] * 60 + +m[2];
    m = v.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)(?:min|mn|m|'))?(?:(\d+(?:\.\d+)?)(?:sec|s|"))?$/);
    if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 60 + (+m[2] || 0) + (+m[3] || 0) / 60;
    const f = parseFloat(v);
    return isNaN(f) ? null : f;
  }

  function segTargetLabel(seg, metric) {
    const lo = +seg.int || 0, hi = (seg.intHi != null && +seg.intHi > 0) ? +seg.intHi : null;
    const z = zonesOf(metric).labels[zIdx(midOf(seg), metric)].split(' ')[0];
    const a = hi == null ? lo : Math.min(lo, hi), c = hi == null ? lo : Math.max(lo, hi);
    if (metric === 'power') return (hi == null ? Math.round(FTP() * lo / 100) + ' W' : Math.round(FTP() * a / 100) + '–' + Math.round(FTP() * c / 100) + ' W') + ' · ' + z;
    if (metric === 'hr') return (hi == null ? Math.round(HRMAX() * lo / 100) + ' bpm' : Math.round(HRMAX() * a / 100) + '–' + Math.round(HRMAX() * c / 100) + ' bpm') + ' · ' + z;
    return (hi == null ? fmtPace(lo) : fmtPace(c) + '–' + fmtPace(a)) + ' ' + paceUnit() + ' · ' + z;
  }
  // Zone d'une intensité : par BORNES (lo/hi), pas par « milieu le plus proche »
  // (l'ancien calcul rendait Z1 pour un milieu de Z2 en cas d'égalité de distance).
  function zIdx(i, m) {
    const Z = zonesOf(m);
    let zi = 0;
    for (let k = Z.lo.length - 1; k >= 0; k--) { if (i >= Z.lo[k]) { zi = k; break; } }
    return zi;
  }

  function blockSegs(b) { const o = []; const n = Math.max(1, b.reps | 0); for (let i = 0; i < n; i++) { o.push({ seg: b.work, which: 'work' }); if (b.type === 'interval' && b.rec) o.push({ seg: b.rec, which: 'rec' }); } return o; }

  // Nombre de marches PARTAGÉ entre toutes les métriques affichées : si watts
  // (7 zones) côtoie FC/allure (5 zones), tout le monde se cale sur 7 marches
  // et la FC occupe les 5 premières -> Z2 FC sur la même ligne que Z2 watts.
  let stairMax = 0; // recalculé à chaque renderGraph ; 0 = métrique seule
  function stairCount(mt) { return Math.max(stairMax, zonesOf(mt).lo.length); }

  // Position en « étages de zones » : Z1 reste bas, chaque zone = une marche.
  // Retourne { zi, frac } : indice de zone (selon la métrique) + position dans la zone.
  function zonePos(mid, mt) {
    const Z = zonesOf(mt);
    let zi = 0;
    for (let i = Z.lo.length - 1; i >= 0; i--) { if (mid >= Z.lo[i]) { zi = i; break; } }
    const span = Math.max(1, (Z.hi[zi] - Z.lo[zi]));
    // dernière zone : frac NON plafonné -> un sprint à 1000 W monte au-delà de
    // Z7 au lieu d'être écrasé au plafond comme un bloc à 400 W
    const raw = (mid - Z.lo[zi]) / span;
    const frac = zi === Z.lo.length - 1 ? Math.max(0, raw) : Math.max(0, Math.min(1, raw));
    return { zi, frac, n: Z.lo.length };
  }
  // Hauteur (%) d'un segment : plancher 8 %, puis (zi + frac) marches sur n partagé
  function segHeight(seg, mt) {
    const p = zonePos(midOf(seg), mt);
    return 8 + (p.zi + p.frac) / stairCount(mt) * 90;
  }
  // Frontière basse de la zone zi (pour les lignes de bandes), même échelle
  function zoneFloor(zi, mt) {
    return 8 + zi / stairCount(mt) * 90;
  }
  function totals() {
    let dur = 0, tss = 0, kj = 0;
    blocks.forEach(b => blockSegs(b).forEach(({ seg }) => {
      const m = +seg.min || 0, f = midOf(seg) / 100;
      dur += m; tss += (m / 60) * f * f * 100;
      kj += m * 60 * (f * FTP()) / 1000;
    }));
    const ifr = dur > 0 ? Math.sqrt(tss / (dur / 60) / 100) : 0;
    return { dur, tss: Math.round(tss), ifr, kj: Math.round(kj) };
  }

  // ---------- Undo / redo ----------
  const snap = () => { undoStack.push(JSON.stringify(blocks)); if (undoStack.length > 60) undoStack.shift(); redoStack = []; };
  const undo = () => { if (!undoStack.length) return; redoStack.push(JSON.stringify(blocks)); blocks = JSON.parse(undoStack.pop()); clampSel(); render(); };
  const redo = () => { if (!redoStack.length) return; undoStack.push(JSON.stringify(blocks)); blocks = JSON.parse(redoStack.pop()); clampSel(); render(); };
  const clampSel = () => { if (sel && !blocks[sel.bi]) sel = null; if (sel && sel.which === 'rec' && !blocks[sel.bi].rec) sel.which = 'work'; };

  // ---------- Parser de la ligne de commande ----------
  // Exemples : « 15' Z1 » · « 20' à 250W » · « 3x8' Z4 récup 4' » · « 45" Z6 » · « 2x20' 90% r5' »
  function parseCmd(txt) {
    txt = String(txt || '').trim().toLowerCase().replace(/’/g, "'");
    if (!txt) return null;
    const m = txt.match(/^(?:(\d+)\s*x\s*)?\(?\s*(\d+(?:[.,]\d+)?)\s*(min|mn|m|'|"|s|sec)?\s*(?:a|à|@)?\s*([^+r]*?)\s*(?:(?:\+|r[ée]cup?|r)\s*\(?\s*(\d+(?:[.,]\d+)?)\s*(min|mn|m|'|"|s|sec)?\s*([^)]*))?\)?$/);
    if (!m) return null;
    const reps = m[1] ? +m[1] : 1;
    const toMin = (v, u) => { v = parseFloat(String(v).replace(',', '.')); return (u === '"' || u === 's' || u === 'sec') ? v / 60 : v; };
    const wMin = toMin(m[2], m[3]);
    const target = parseTarget(m[4]);
    if (!wMin || !target) return null;
    const b = { type: reps > 1 ? 'interval' : 'steady', name: reps > 1 ? reps + '×' + (m[2] + (m[3] === '"' ? '"' : "'")) : 'Bloc', reps, metric: target.metric || 'power', unit: target.unit, work: { min: wMin, int: target.lo, intHi: target.hi } };
    if (reps > 1) {
      const rMin = m[5] ? toMin(m[5], m[6]) : Math.max(0.5, Math.round(wMin * 0.75 * 2) / 2);
      const rT = m[7] ? parseTarget(m[7]) : null;
      b.type = 'interval';
      b.rec = { min: rMin, int: rT ? rT.lo : 40, intHi: rT ? rT.hi : 55 };
    }
    return b;
  }
  function parseTarget(s) {
    s = String(s || '').trim();
    if (!s) return { unit: 'zone', lo: 56, hi: 75, metric: curMetric() };
    let m = s.match(/^z\s*([1-7])$/i);
    if (m) { const zi = +m[1] - 1, mt = curMetric(), Z = zonesOf(mt); if (zi >= Z.lo.length) return null; return { unit: 'zone', lo: Z.lo[zi], hi: Z.hi[zi], metric: mt }; }
    m = s.match(/^(\d+)\s*(?:-|–|a|à)?\s*(\d+)?\s*w$/i);
    if (m) { const lo = +m[1] / FTP() * 100, hi = m[2] ? +m[2] / FTP() * 100 : null; return { unit: 'raw', lo, hi, metric: 'power' }; }
    m = s.match(/^(\d+)\s*(?:-|–)?\s*(\d+)?\s*%$/);
    if (m) return { unit: 'pct', lo: +m[1], hi: m[2] ? +m[2] : null, metric: curMetric() };
    m = s.match(/^(\d+)\s*(?:-|–)?\s*(\d+)?\s*(?:bpm|puls)$/i);
    if (m) { const lo = +m[1] / HRMAX() * 100, hi = m[2] ? +m[2] / HRMAX() * 100 : null; return { unit: 'raw', lo, hi, metric: 'hr' }; }
    m = s.match(/^(\d+):(\d{2})$/);
    if (m) { const sec = +m[1] * 60 + +m[2]; return { unit: 'raw', lo: paceBase() * 100 / sec, hi: null, metric: 'pace' }; }
    return null;
  }
  const curMetric = () => METRICS[grp()][0][0];

  // ---------- Rendu ----------
  function el(html) { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render() {
    if (!root) return;
    renderTop(); renderGraph(); renderInspector(); renderFlow();
  }

  function renderTop() {
    const t = totals();
    const nameInp = document.getElementById('train-modal-name');
    const q = (id) => root.querySelector(id);
    q('#se-name').value = nameInp ? nameInp.value : '';
    q('#se-sport').textContent = grp().charAt(0).toUpperCase() + grp().slice(1) + ' · cibles ' + (curMetric() === 'power' ? 'watts (FTP ' + FTP() + ')' : curMetric() === 'pace' ? 'allure' : 'FC (max ' + HRMAX() + ')');
    q('#se-dur').textContent = t.dur ? fmtDur(t.dur) : '0 min';
    q('#se-tss').textContent = t.tss;
    q('#se-if').textContent = t.dur ? t.ifr.toFixed(2) : '—';
    const kjEl = q('#se-kj');
    if (curMetric() === 'power') { kjEl.parentElement.style.display = ''; kjEl.textContent = t.kj; }
    else kjEl.parentElement.style.display = 'none';
    q('#se-undo').disabled = !undoStack.length;
    q('#se-redo').disabled = !redoStack.length;
  }

  function renderGraph() {
    const g = root.querySelector('#se-graph');
    g.innerHTML = '';
    // bandes de zones (fond) — même échelle « en étages » que les barres.
    // TOUTES les métriques utilisées par les blocs figurent dans la gouttière :
    // un bloc en FC + un bloc en watts -> chaque ligne Zx affiche W et bpm.
    const mt = curMetric();
    const usedMts = [...new Set(blocks.map(b => b.metric || mt))];
    if (!usedMts.length) usedMts.push(mt);
    stairMax = Math.max(...usedMts.map(m => zonesOf(m).lo.length));
    // si un segment dépasse la dernière zone (sprint hors échelle), on étend
    // l'échelle vers le haut : le reste du graphe se tasse en proportion
    blocks.forEach(b => {
      const m2 = b.metric || mt;
      blockSegs(b).forEach(({ seg }) => {
        const p = zonePos(midOf(seg), m2);
        stairMax = Math.max(stairMax, p.zi + p.frac);
      });
    });
    g.style.setProperty('--se-gutter', '74px');
    const bands = el('<div class="se-bands"></div>');
    const lines = {}; // fusion des échelles qui coïncident (FC et allure : 5 étages)
    usedMts.forEach((m2, col) => {
      const Zm = zonesOf(m2);
      for (let zi = Zm.lo.length - 1; zi >= 1; zi--) {
        const floor = zoneFloor(zi, m2);
        const key = floor.toFixed(2) + '|' + zi;
        const val = m2 === 'power' ? Math.round(FTP() * Zm.lo[zi] / 100) + 'W'
          : m2 === 'hr' ? Math.round(HRMAX() * Zm.lo[zi] / 100) + 'bpm'
          : fmtPace(Zm.lo[zi]);
        (lines[key] = lines[key] || { zi, floor, entries: [] }).entries.push({ col, val });
      }
    });
    Object.values(lines).forEach(L => {
      const band = el('<div class="se-band"></div>');
      band.style.top = (100 - L.floor) + '%';
      band.style.borderTopColor = ZHEX[Math.min(L.zi, 6)] + '55';
      // métriques empilées sur la ligne : 1re au-dessus, 2e en dessous
      band.innerHTML = L.entries.map(e =>
        '<span style="color:' + ZHEX[Math.min(L.zi, 6)] + ';top:' + (e.col ? 2 : -14) + 'px">Z' + (L.zi + 1) + ' · ' + e.val + '</span>'
      ).join('');
      bands.appendChild(band);
    });
    g.appendChild(bands);
    if (!blocks.length) {
      g.appendChild(el('<div class="se-empty">Pars d\'un modèle ci-dessus, ajoute un bloc, ou écris ta séance en bas — « 4x4\' Z5 récup 3\' »</div>'));
      return;
    }
    const totMin = blocks.reduce((s, b) => s + blockSegs(b).reduce((x, { seg }) => x + (+seg.min || 0), 0), 0) || 1;
    const row = el('<div class="se-row"></div>');
    blocks.forEach((b, bi) => {
      const grpEl = el('<div class="se-bgroup" draggable="true"></div>');
      grpEl.dataset.bi = bi;
      const bMin = blockSegs(b).reduce((s, { seg }) => s + (+seg.min || 0), 0);
      // Largeur STRICTEMENT proportionnelle à la durée (un 30s ne peut pas
      // ressembler à un 3 min) — le minimum cliquable est géré en px par le CSS.
      grpEl.style.flex = (bMin / totMin) + ' 1 0px';
      const bmt = b.metric || mt; // le graphe respecte la métrique DU BLOC (allure vs FC)
      blockSegs(b).forEach(({ seg, which }, si) => {
        const sEl = el('<div class="se-seg"></div>');
        const isSel = sel && sel.bi === bi && sel.which === which;
        sEl.dataset.bi = bi; sEl.dataset.which = which;
        sEl.style.flex = ((+seg.min || 0) / (bMin || 1)) + ' 1 0px';
        sEl.style.height = segHeight(seg, bmt) + '%';
        sEl.style.background = ZHEX[Math.min(zonePos(midOf(seg), bmt).zi, 6)];
        if (isSel) {
          // TOUTES les répétitions sont sélectionnées ET manipulables : chaque
          // occurrence a ses poignées — étirer n'importe laquelle redimensionne
          // toutes les répétitions (elles partagent le même segment).
          sEl.classList.add('sel');
          sEl.appendChild(el('<span class="se-h-dur" title="Étirer la durée"></span>'));
          sEl.appendChild(el('<span class="se-h-int" title="Étirer l\'intensité"></span>'));
          if (si === firstSelIdx(b, which)) {
            sEl.appendChild(el('<span class="se-tip">' + fmtMin(seg.min) + ' · ' + segTargetLabel(seg, b.metric) + '</span>'));
          }
        } else if (sel && sel.bi === bi) {
          // l'autre segment du même bloc (ex. les récups) reste marqué discrètement
          sEl.classList.add('sel-echo');
        }
        row.appendChild(nestInGroup(grpEl, sEl));
      });
      const lab = el('<div class="se-blab">' + esc(b.name || NAME[b.type]) + (b.reps > 1 ? ' ×' + b.reps : '') + '</div>');
      grpEl.appendChild(lab);
      row.appendChild(grpEl);
    });
    g.appendChild(row);
    const axis = el('<div class="se-axis"></div>');
    for (let i = 0; i <= 4; i++) axis.appendChild(el('<span>' + fmtDur(totMin * i / 4) + '</span>'));
    g.appendChild(axis);
    // Cale le calque des lignes de zones EXACTEMENT sur la boîte des barres
    // (.se-bars = rangée moins l'étiquette de nom) : sinon les % des lignes et
    // des barres ne parlent pas du même repère et tout paraît décalé.
    const bars0 = row.querySelector('.se-bars');
    if (bars0) {
      const gr = g.getBoundingClientRect(), br = bars0.getBoundingClientRect();
      bands.style.inset = 'auto';
      bands.style.left = '0'; bands.style.right = '0';
      bands.style.top = (br.top - gr.top) + 'px';
      bands.style.height = br.height + 'px';
    }
  }
  function nestInGroup(grpEl, sEl) { let inner = grpEl.querySelector('.se-bars'); if (!inner) { inner = el('<div class="se-bars"></div>'); grpEl.appendChild(inner); } inner.appendChild(sEl); return grpEl; }
  function firstSelIdx(b, which) { const segs = blockSegs(b); for (let i = 0; i < segs.length; i++) if (segs[i].which === which) return i; return 0; }

  function renderInspector() {
    const box = root.querySelector('#se-insp');
    if (!sel || !blocks[sel.bi]) {
      box.innerHTML = '<div class="se-insp-empty">Sélectionne un bloc sur le graphe pour l\'éditer ici.</div>';
      return;
    }
    const b = blocks[sel.bi];
    const mt = b.metric || curMetric();
    const isInt = b.type === 'interval' && b.rec;
    const col = ZHEX[Math.min(zonePos(midOf(b.work), mt).zi, 6)];
    const metricChips = METRICS[grp()].map(([v, lab]) =>
      '<button type="button" class="se-chip' + (b.metric === v ? ' on' : '') + '" data-metric="' + v + '">' + lab + '</button>').join('')
      + '<span class="se-chipsep"></span>' // séparateur métrique | unité
      + ['zone', 'pct', 'raw'].map(u => '<button type="button" class="se-chip' + (b.unit === u ? ' on' : '') + '" data-unit="' + u + '">' + (u === 'zone' ? 'Zones' : u === 'pct' ? '%' : 'Valeurs') + '</button>').join('');
    // Carte d'un segment (Effort / Récup / Bloc) — durée + cible + barre de zones
    const segCard = (which, title) => {
      const seg = b[which];
      const Z = zonesOf(mt);
      const c = ZHEX[Math.min(zonePos(midOf(seg), mt).zi, 6)];
      const toRaw = (i) => mt === 'power' ? Math.round(FTP() * i / 100) : mt === 'hr' ? Math.round(HRMAX() * i / 100) : fmtPace(i);
      const loHi = b.unit === 'pct'
        ? [Math.round(seg.int), seg.intHi ? Math.round(seg.intHi) : '']
        : [toRaw(seg.int), seg.intHi ? toRaw(seg.intHi) : ''];
      const paceTxt = mt === 'pace' && b.unit !== 'pct';
      return '<div class="se-segcard" data-card="' + which + '" style="border-left-color:' + c + '">'
        + '<div class="se-lab" style="color:' + c + '">' + title + '</div>'
        + '<div class="se-durrow"><button type="button" class="se-ib" data-dmin="-1" data-w="' + which + '">−</button>'
        + '<input class="se-w-min" data-w="' + which + '" type="text" value="' + fmtMin(+seg.min || 0) + '" title="15 · 15min · 30s · 1h15 · 4:30…">'
        + '<button type="button" class="se-ib" data-dmin="1" data-w="' + which + '">+</button>'
        + '<span class="se-unit" style="margin:0 3px">·</span>'
        + '<input class="se-w-lo" data-w="' + which + '" ' + (paceTxt ? 'type="text" placeholder="m:ss"' : 'type="number"') + ' value="' + loHi[0] + '">'
        + '<span class="se-unit">–</span>'
        + '<input class="se-w-hi" data-w="' + which + '" ' + (paceTxt ? 'type="text" placeholder="max"' : 'type="number" placeholder="max"') + ' value="' + loHi[1] + '">'
        + '<span class="se-unit">' + (b.unit === 'pct' ? '%' : mt === 'power' ? 'W' : mt === 'hr' ? 'bpm' : paceUnit()) + '</span></div>'
        + '<div class="se-zbar" data-w="' + which + '">' + Z.labels.map((l, zi) => '<span title="' + l + '" data-z="' + zi + '" style="background:' + ZHEX[Math.min(zi, 6)] + '" class="' + (zi === zIdx(midOf(seg), mt) ? 'on' : '') + '"></span>').join('') + '</div>'
        + '<div class="se-hint" style="margin-top:5px">' + segTargetLabel(seg, mt) + '</div>'
        + '</div>';
    };
    box.innerHTML = ''
      + '<div class="se-icol se-icol-info">'
      +   '<div class="se-insp-head"><span class="se-dot" style="background:' + col + '"></span>'
      +   '<input id="se-bname" value="' + esc(b.name || NAME[b.type]) + '">'
      +   '<button type="button" class="se-ib" id="se-dup" title="Dupliquer le bloc">⧉</button>'
      +   '<button type="button" class="se-ib" id="se-del" title="Supprimer le bloc">✕</button></div>'
      +   '<div class="se-lab">Répéter</div>'
      +   '<div class="se-durrow"><button type="button" class="se-ib" data-drep="-1">−</button><input id="se-reps" type="number" min="1" value="' + Math.max(1, b.reps | 0) + '"><button type="button" class="se-ib" data-drep="1">+</button></div>'
      +   (isInt ? '' : '<div class="se-hint" style="margin-top:4px">passer à ≥2 crée l\'alternance effort/récup</div>')
      +   '<div class="se-lab">Cibles en</div>'
      +   '<div class="se-chips">' + metricChips + '</div>'
      + '</div>'
      + segCard('work', isInt ? 'Effort' : 'Bloc')
      + (isInt ? segCard('rec', 'Récup') : '');
    wireInspector(box, b);
  }

  function renderFlow() {
    const f = root.querySelector('#se-flow');
    if (!blocks.length) { f.innerHTML = '<span class="se-hint">Le déroulé de la séance apparaîtra ici.</span>'; return; }
    f.innerHTML = blocks.map((b, bi) => {
      const col = ZHEX[zoneOf(midOf(b.work))];
      const reps = Math.max(1, b.reps | 0);
      const isSel = sel && sel.bi === bi;
      const badge = reps > 1 ? '<span class="se-flow-reps">×' + reps + '</span>' : '';
      const l2 = (b.type === 'interval' && b.rec) ? '<div class="se-flow-sub dim">récup ' + fmtMin(b.rec.min) + '</div>' : '';
      return '<button type="button" class="se-flow-it' + (isSel ? ' sel' : '') + '" data-bi="' + bi + '">'
        + '<span class="se-flow-bar" style="background:' + col + '"></span>'
        + '<span class="se-flow-body"><span class="se-flow-name">' + esc(b.name || NAME[b.type]) + badge + '</span>'
        + '<div class="se-flow-sub">' + fmtMin(b.work.min) + ' · ' + segTargetLabel(b.work, b.metric) + '</div>'
        + l2 + '</span></button>';
    }).join('');
  }

  // ---------- Wiring ----------
  function wireInspector(box, b) {
    const rerender = () => render();
    box.querySelector('#se-bname').addEventListener('input', e => { b.name = e.target.value; renderGraph(); renderFlow(); });
    box.querySelector('#se-dup').addEventListener('click', () => { snap(); blocks.splice(sel.bi + 1, 0, JSON.parse(JSON.stringify(b))); sel = { bi: sel.bi + 1, which: 'work' }; rerender(); });
    box.querySelector('#se-del').addEventListener('click', () => { snap(); blocks.splice(sel.bi, 1); sel = null; rerender(); });
    box.querySelectorAll('[data-metric]').forEach(x => x.addEventListener('click', () => {
      snap();
      const from = b.metric, to = x.dataset.metric;
      if (from !== to) {
        // Les intensités sont des % relatifs à la métrique : on re-cale chaque
        // segment sur la MÊME zone (Z2 allure -> Z2 FC), sinon les valeurs
        // deviennent des non-sens dans la nouvelle échelle.
        ['work', 'rec'].forEach(w => {
          const sg = b[w]; if (!sg) return;
          const zi = Math.min(zonePos(midOf(sg), from).zi, zonesOf(to).lo.length - 1);
          sg.int = zonesOf(to).lo[zi];
          sg.intHi = zonesOf(to).hi[zi];
        });
        b.metric = to;
      }
      rerender();
    }));
    box.querySelectorAll('[data-unit]').forEach(x => x.addEventListener('click', () => { snap(); b.unit = x.dataset.unit; rerender(); }));
    // cliquer dans une carte segment -> ce segment devient le sélectionné (surbrillance graphe)
    box.querySelectorAll('.se-segcard').forEach(card => card.addEventListener('pointerdown', () => {
      if (sel.which !== card.dataset.card) { sel.which = card.dataset.card; renderGraph(); }
    }));
    const readTarget = (v) => {
      v = String(v).trim(); if (!v) return null;
      if (b.unit === 'pct') return +v;
      if (b.metric === 'power') return +v / FTP() * 100;
      if (b.metric === 'hr') return +v / HRMAX() * 100;
      const p = v.split(':'); const sec = (+p[0] || 0) * 60 + (+p[1] || 0); return sec ? paceBase() * 100 / sec : null;
    };
    // Durée / cible / zones : PAR SEGMENT (les deux cartes sont éditables en même temps)
    box.querySelectorAll('.se-w-min').forEach(inp => inp.addEventListener('change', () => {
      const v = parseDurTxt(inp.value);
      if (v == null) { inp.value = fmtMin(+b[inp.dataset.w].min || 0); return; } // saisie illisible : on restaure
      snap(); b[inp.dataset.w].min = Math.max(0, Math.round(v * 60) / 60); rerender();
    }));
    box.querySelectorAll('[data-dmin]').forEach(x => x.addEventListener('click', () => {
      snap(); const seg = b[x.dataset.w];
      const cur = +seg.min || 0, d = +x.dataset.dmin;
      // sous la minute (affichage en secondes), le pas devient la seconde
      const step = (cur < 1 || (cur === 1 && d < 0)) ? 1 / 60 : 1;
      seg.min = Math.max(1 / 60, Math.round((cur + d * step) * 60) / 60); rerender();
    }));
    const applyLoHi = (which) => {
      snap(); const seg = b[which];
      const card = box.querySelector('.se-segcard[data-card="' + which + '"]');
      const lo = readTarget(card.querySelector('.se-w-lo').value);
      const hi = readTarget(card.querySelector('.se-w-hi').value);
      if (lo != null) seg.int = lo;
      seg.intHi = hi;
      rerender();
    };
    box.querySelectorAll('.se-w-lo, .se-w-hi').forEach(inp => inp.addEventListener('change', () => applyLoHi(inp.dataset.w)));
    box.querySelectorAll('.se-zbar').forEach(zb => zb.querySelectorAll('[data-z]').forEach(x => x.addEventListener('click', () => {
      snap(); const seg = b[zb.dataset.w];
      const Z = zonesOf(b.metric), zi = +x.dataset.z;
      seg.int = Z.lo[zi]; seg.intHi = Z.hi[zi]; b.unit = 'zone'; rerender();
    })));
    const repsInp = box.querySelector('#se-reps');
    const setReps = (n) => {
      snap(); n = Math.max(1, n | 0);
      if (n > 1) {
        if (b.type !== 'interval') { b._prevType = b.type; b.type = 'interval'; }
        if (!b.rec) b.rec = b._recSaved || { min: Math.max(0.5, Math.round((+b.work.min || 1) * 0.75 * 2) / 2), int: 40, intHi: 55 };
      } else if (b.type === 'interval') {
        // retour à ×1 : plus d'alternance -> on retire la récup (gardée en mémoire
        // si l'utilisateur repasse à ≥2) et on restaure le type d'origine
        if (b.rec) b._recSaved = b.rec;
        delete b.rec;
        b.type = b._prevType || 'steady';
        delete b._prevType;
        if (sel && sel.which === 'rec') sel.which = 'work';
      }
      b.reps = n; render();
    };
    repsInp.addEventListener('change', () => setReps(+repsInp.value));
    box.querySelectorAll('[data-drep]').forEach(x => x.addEventListener('click', () => setReps(Math.max(1, (b.reps | 0) + (+x.dataset.drep)))));
  }

  function wireGraph() {
    const g = root.querySelector('#se-graph');
    // sélection
    g.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.se-h-dur, .se-h-int');
      if (h) return startHandleDrag(e, h);
      const s = e.target.closest('.se-seg');
      if (!s) {
        // clic dans le vide du cadre (y compris au-dessus d'un bloc) -> désélection
        if (sel) { sel = null; render(); }
        return;
      }
      sel = { bi: +s.dataset.bi, which: s.dataset.which };
      render();
    });
    // réordonner (HTML5 dnd sur les groupes)
    let dragBi = null;
    g.addEventListener('dragstart', (e) => { const b = e.target.closest('.se-bgroup'); if (!b) return; dragBi = +b.dataset.bi; b.classList.add('drag'); });
    g.addEventListener('dragend', () => { g.querySelectorAll('.se-bgroup').forEach(x => x.classList.remove('drag', 'over')); dragBi = null; });
    g.addEventListener('dragover', (e) => { e.preventDefault(); const b = e.target.closest('.se-bgroup'); g.querySelectorAll('.se-bgroup').forEach(x => x.classList.remove('over')); if (b && +b.dataset.bi !== dragBi) b.classList.add('over'); });
    g.addEventListener('drop', (e) => {
      e.preventDefault(); const b = e.target.closest('.se-bgroup'); if (!b || dragBi == null) return;
      const to = +b.dataset.bi; if (to === dragBi) return;
      snap(); const mv = blocks.splice(dragBi, 1)[0]; blocks.splice(to, 0, mv);
      if (sel) sel.bi = to; render();
    });
    // double-clic = dupliquer
    g.addEventListener('dblclick', (e) => {
      const s = e.target.closest('.se-seg'); if (!s) return;
      snap(); const bi = +s.dataset.bi;
      blocks.splice(bi + 1, 0, JSON.parse(JSON.stringify(blocks[bi])));
      sel = { bi: bi + 1, which: 'work' }; render();
    });
  }
  function startHandleDrag(e, h) {
    e.preventDefault(); e.stopPropagation();
    if (!sel || !blocks[sel.bi]) return;
    const b = blocks[sel.bi], seg = b[sel.which] || b.work;
    const isDur = h.classList.contains('se-h-dur');
    const g = root.querySelector('#se-graph');
    const startSpread = (seg.intHi != null && +seg.intHi > 0) ? (+seg.intHi - +seg.int) : null;
    const mt0 = (b.metric || curMetric());
    // Références pour l'AGRANDISSEMENT (mapping delta sur l'échelle de départ)
    const startX = e.clientX;
    const startMin = +seg.min || 1;
    const gRect0 = g.getBoundingClientRect();
    const totMin0 = blocks.reduce((s, bb) => s + blockSegs(bb).reduce((x, { seg: sg }) => x + (+sg.min || 0), 0), 0) || 1;
    snap();
    const move = (ev) => {
      // On résout par rapport au bord RÉEL du bloc à chaque frame : le bord
      // suit exactement le curseur même quand l'échelle se renormalise.
      let selEl = g.querySelector('.se-seg.sel');
      if (!selEl) return;
      if (isDur) {
        // Mapping delta stable sur l'échelle de départ, dans les deux sens
        const dMin = (ev.clientX - startX) / gRect0.width * totMin0;
        seg.min = Math.max(0.5, Math.round((startMin + dMin) * 2) / 2);
        renderGraph();
      } else {
        const r = selEl.getBoundingClientRect(); void r;
        // hauteur visée = position de la souris dans le graphe -> inversion de
        // l'échelle « en étages de zones » pour retrouver l'intensité exacte
        // repère = la boîte des barres (.se-bars), le même que les hauteurs %
        const rowRect = g.querySelector('.se-bars').getBoundingClientRect();
        const hPct = Math.max(2, Math.min(100, (rowRect.bottom - ev.clientY) / rowRect.height * 100));
        const Z = zonesOf(mt0);
        const n = stairCount(mt0); // même échelle partagée que l'affichage
        const level = Math.max(0, Math.min(n - 0.001, (hPct - 8) / 90 * n));
        let zi = Math.floor(level), frac = level - zi;
        // au-delà des marches de cette métrique : on continue dans la zone
        // étendue (frac > 1) au lieu de plafonner
        if (zi > Z.lo.length - 1) { frac = level - (Z.lo.length - 1); zi = Z.lo.length - 1; }
        const mid = Z.lo[zi] + frac * Math.max(1, Z.hi[zi] - Z.lo[zi]);
        if (startSpread != null) {
          seg.int = Math.max(10, Math.round(mid - startSpread / 2));
          seg.intHi = Math.round(mid + startSpread / 2);
        } else {
          seg.int = Math.max(10, Math.round(mid));
        }
      }
      renderGraph(); renderTop(); renderFlow();
      const mi = root.querySelector('.se-segcard[data-card="' + sel.which + '"] .se-w-min');
      if (mi && isDur) mi.value = fmtMin(seg.min);
      if (!isDur) renderInspector();
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); render(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function addBlock(type) {
    snap();
    const d = TYPE_DEFAULT[type], mt = curMetric();
    const conv = (v) => v; // int déjà en %
    const b = { type, name: NAME[type], reps: d.reps || 1, metric: mt, unit: 'zone', work: { min: d.work.min, int: conv(d.work.int), intHi: d.work.intHi } };
    if (d.rec) b.rec = { min: d.rec.min, int: d.rec.int, intHi: d.rec.intHi };
    blocks.push(b);
    sel = { bi: blocks.length - 1, which: 'work' };
    render();
  }

  // ---------- Page ----------
  function buildPage() {
    const container = document.querySelector('.main .container') || document.querySelector('.container');
    let page = document.getElementById('p-structure');
    if (!page) { page = document.createElement('section'); page.className = 'panel'; page.id = 'p-structure'; container.appendChild(page); }
    page.innerHTML = ''
      + '<div class="se-top">'
      +   '<button type="button" class="se-back" id="se-back"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>Retour</button>'
      +   '<div class="se-title"><input id="se-name" placeholder="Nom de la séance"><div class="se-sub" id="se-sport"></div></div>'
      +   '<div class="se-stats">'
      +     '<span class="se-stat"><b id="se-dur" style="color:#60a5fa">0</b><i>durée</i></span>'
      +     '<span class="se-stat"><b id="se-tss" style="color:#fbbf24">0</b><i>TSS</i></span>'
      +     '<span class="se-stat"><b id="se-if" style="color:#f97316">—</b><i>IF</i></span>'
      +     '<span class="se-stat"><b id="se-kj" style="color:#9ca3af">0</b><i>kJ</i></span>'
      +     '<button type="button" class="se-ib" id="se-undo" title="Annuler (Ctrl+Z)">↩</button>'
      +     '<button type="button" class="se-ib" id="se-redo" title="Rétablir">↪</button>'
      +   '</div>'
      + '</div>'
      + '<div class="se-main">'
      +   '<div class="se-left">'
      +     '<div class="se-graphwrap"><div id="se-graph"></div></div>'
      +     '<div class="se-hint" style="margin:7px 2px 0">glisser un bloc = réordonner · poignées du bloc sélectionné = durée / intensité · double-clic = dupliquer</div>'
      +     '<div class="se-addbar">'
      +       '<button type="button" class="se-add" data-add="warmup" style="--c:#60a5fa">+ Échauffement</button>'
      +       '<button type="button" class="se-add" data-add="interval" style="--c:#ef4444">+ Intervalles ×N</button>'
      +       '<button type="button" class="se-add" data-add="steady" style="--c:#eab308">+ Bloc continu</button>'
      +       '<button type="button" class="se-add" data-add="recovery" style="--c:#3b82f6">+ Récup</button>'
      +       '<button type="button" class="se-add" data-add="cooldown" style="--c:#4ade80">+ Retour au calme</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="se-right"><div class="se-flowwrap"><div class="se-flowhead"><span>Déroulé</span></div><div id="se-flow"></div><button type="button" class="se-preset" id="se-savelib" style="margin-top:10px">Enregistrer dans ma bibliothèque</button></div></div>'
      + '</div>'
      + '<div class="se-inspwrap"><div id="se-insp"></div></div>';
    root = page;
    // wiring global
    page.querySelector('#se-back').addEventListener('click', close);
    page.querySelector('#se-undo').addEventListener('click', undo);
    page.querySelector('#se-redo').addEventListener('click', redo);
    page.querySelectorAll('[data-add]').forEach(x => x.addEventListener('click', () => addBlock(x.dataset.add)));
    page.querySelector('#se-name').addEventListener('input', (e) => { const n = document.getElementById('train-modal-name'); if (n) n.value = e.target.value; });
    // clic sur un item du déroulé -> sélectionne le bloc
    page.querySelector('#se-flow').addEventListener('click', (e) => {
      const it = e.target.closest('.se-flow-it');
      if (!it) return;
      sel = { bi: +it.dataset.bi, which: 'work' };
      render();
    });
    page.querySelector('#se-savelib').addEventListener('click', () => {
      if (!blocks.length) return;
      const t = totals();
      const nameV = (document.getElementById('train-modal-name') || {}).value || 'Séance structurée';
      const sportSel = document.getElementById('train-modal-sport');
      if (typeof window.libraryAddTemplate === 'function') {
        window.libraryAddTemplate({ name: nameV, sport: grp(), sport_raw: sportSel ? sportSel.value : 'Ride', duration_min: Math.round(t.dur), tss: t.tss, description: '', structure: JSON.parse(JSON.stringify(blocks)) });
        const btn = page.querySelector('#se-savelib'); btn.textContent = 'Enregistrée ✓'; btn.disabled = true;
        setTimeout(() => { btn.textContent = 'Enregistrer dans ma bibliothèque'; btn.disabled = false; }, 2500);
      }
    });
    wireGraph();
    // raccourcis clavier
    page.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (e.key === 'Delete' && sel && document.activeElement.tagName !== 'INPUT') { snap(); blocks.splice(sel.bi, 1); sel = null; render(); }
    });
  }

  // ---------- Ouverture / fermeture ----------
  let prevPanelId = null, modalWasOpen = false;
  function open() {
    const cur = JSON.parse(JSON.stringify((typeof window.getCurrentWorkoutStructure === 'function' && window.getCurrentWorkoutStructure()) || []));
    blocks = cur; sel = null; undoStack = []; redoStack = [];
    const modal = document.getElementById('train-modal');
    modalWasOpen = !!(modal && modal.classList.contains('active'));
    if (modal) modal.classList.remove('active');
    buildPage();
    const curPanel = document.querySelector('.panel.active');
    prevPanelId = (curPanel && curPanel.id !== 'p-structure') ? curPanel.id : (prevPanelId || 'p2');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    root.classList.add('active');
    window.scrollTo(0, 0);
    render();
  }
  function close() {
    // écrit la structure dans le builder caché de la modale (source de vérité au save)
    // — en retirant les clés de travail internes (_recSaved, _prevType)
    const clean = JSON.parse(JSON.stringify(blocks, (k, v) => (k === '_recSaved' || k === '_prevType') ? undefined : v));
    if (typeof window.setWorkoutStructure === 'function') window.setWorkoutStructure(blocks.length ? clean : []);
    const tg = document.getElementById('sb-toggle');
    if (tg) { tg.checked = blocks.length > 0; }
    if (root) root.classList.remove('active');
    if (typeof window.activatePanel === 'function') window.activatePanel(prevPanelId || 'p2', false);
    else { const pv = document.getElementById(prevPanelId || 'p2'); if (pv) pv.classList.add('active'); }
    if (modalWasOpen) { const m = document.getElementById('train-modal'); if (m) m.classList.add('active'); }
    if (window.__updateSbMini) setTimeout(window.__updateSbMini, 80);
  }

  window.StructEd = { open, close };
})();
