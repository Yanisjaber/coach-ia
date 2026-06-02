/* ============================================================
   js/bilan.js — Page Bilan annuel

   Sections :
   1. KPIs annuels YTD vs N-1 (respectent le filtre sport du header)
   2. Objectifs personnalisés par sport (templates + saisie manuelle)
   3. Records perso : volume + sport
   4. Cumul kilométrique annuel comparé (3 ans)

   Stockage :
     coach_ia_yearly_goals_v2 = {
       "2026": [
         { id, sport, template, target, currentManual? },
         ...
       ]
     }
   ============================================================ */

const GOALS_KEY = 'coach_ia_yearly_goals_v2';
const GOALS_LEGACY_KEY = 'coach_ia_yearly_goals_v1';
const GOALS_EXPAND_KEY = 'coach_ia_goals_expanded';

// Année affichée (sélecteur). Comparaison toujours avec l'année précédente.
let _bilanYear = new Date().getFullYear();
function bilanYear() { return _bilanYear; }
// Métrique du graphe de cumul annuel : 'distance_km' ou 'elevation_gain'.
let _cumulMetric = 'distance_km';

const SPORT_LABELS = {
  cyclisme: 'Cyclisme',
  course: 'Course à pied',
  natation: 'Natation',
  musculation: 'Musculation',
  autre: 'Autre',
  tous: 'Tous sports',
};

// ============ CATALOGUE DES OBJECTIFS PAR SPORT ============
// Chaque template a : id (unique), label, unit, calc (méthode de calcul du current)
// calc :
//   'sum_dist'         → somme distance YTD (km)
//   'sum_hours'        → somme durée YTD (h)
//   'sum_sess'         → nb d'activités YTD
//   'sum_tss'          → somme TSS YTD
//   'sum_elev'         → somme dénivelé YTD
//   'max_dist'         → distance max d'une activité YTD
//   'max_dur'          → durée max d'une activité YTD
//   'max_elev_day'     → dénivelé max cumulé sur 1 jour YTD
//   'avg_sess_week'    → nb sessions moyennes par semaine YTD
//   'avg_hours_week'   → heures moyennes par semaine YTD
//   'manual'           → valeur saisie par l'utilisateur (PR, 1RM, etc.)
//   'manual_lower'     → manuel mais l'objectif est "atteindre une valeur PLUS BASSE" (ex: chrono à réduire)
const GOAL_TEMPLATES = {
  // === CYCLISME ===
  cyclisme: [
    { id: 'cyc_dist',     label: 'Distance annuelle',         unit: 'km',     calc: 'sum_dist' },
    { id: 'cyc_hours',    label: 'Heures annuelles',          unit: 'h',      calc: 'sum_hours' },
    { id: 'cyc_tss',      label: 'TSS cumulé annuel',         unit: 'TSS',    calc: 'sum_tss' },
    { id: 'cyc_elev',     label: 'Dénivelé cumulé annuel',    unit: 'm D+',   calc: 'sum_elev' },
    { id: 'cyc_long',     label: 'Plus longue sortie',        unit: 'km',     calc: 'max_dist' },
    { id: 'cyc_bigday',   label: 'Plus de D+ en 1 jour',      unit: 'm D+',   calc: 'max_elev_day' },
    { id: 'cyc_sess_w',   label: 'Séances par semaine',       unit: '/sem',   calc: 'avg_sess_week' },
    { id: 'cyc_hours_w',  label: 'Heures par semaine',        unit: 'h/sem',  calc: 'avg_hours_week' },
    { id: 'cyc_ftp',      label: 'FTP cible',                 unit: 'W',      calc: 'manual' },
    { id: 'cyc_ftp_kg',   label: 'FTP / poids cible',         unit: 'W/kg',   calc: 'manual' },
    { id: 'cyc_w20',      label: 'Puissance 20 min cible',    unit: 'W',      calc: 'manual' },
    { id: 'cyc_chrono40', label: '40 km CLM (chrono)',        unit: 'min',    calc: 'manual_lower' },
  ],
  // === COURSE ===
  course: [
    { id: 'run_dist',     label: 'Distance annuelle',         unit: 'km',     calc: 'sum_dist' },
    { id: 'run_hours',    label: 'Heures annuelles',          unit: 'h',      calc: 'sum_hours' },
    { id: 'run_tss',      label: 'TSS cumulé annuel',         unit: 'TSS',    calc: 'sum_tss' },
    { id: 'run_elev',     label: 'Dénivelé cumulé annuel',    unit: 'm D+',   calc: 'sum_elev' },
    { id: 'run_long',     label: 'Plus longue sortie',        unit: 'km',     calc: 'max_dist' },
    { id: 'run_sess_w',   label: 'Séances par semaine',       unit: '/sem',   calc: 'avg_sess_week' },
    { id: 'run_vma',      label: 'VMA cible',                 unit: 'km/h',   calc: 'manual' },
    { id: 'run_5k',       label: '5 km (chrono cible)',       unit: 'min',    calc: 'manual_lower' },
    { id: 'run_10k',      label: '10 km (chrono cible)',      unit: 'min',    calc: 'manual_lower' },
    { id: 'run_semi',     label: 'Semi-marathon cible',       unit: 'min',    calc: 'manual_lower' },
    { id: 'run_mara',     label: 'Marathon cible',            unit: 'min',    calc: 'manual_lower' },
    { id: 'run_pace10',   label: 'Allure 10 km cible',        unit: 's/km',   calc: 'manual_lower' },
  ],
  // === NATATION ===
  natation: [
    { id: 'swim_dist',    label: 'Distance annuelle',         unit: 'km',     calc: 'sum_dist' },
    { id: 'swim_hours',   label: 'Heures annuelles',          unit: 'h',      calc: 'sum_hours' },
    { id: 'swim_sess_w',  label: 'Séances par semaine',       unit: '/sem',   calc: 'avg_sess_week' },
    { id: 'swim_100m',    label: '100 m crawl (chrono)',      unit: 's',      calc: 'manual_lower' },
    { id: 'swim_400m',    label: '400 m crawl (chrono)',      unit: 'min',    calc: 'manual_lower' },
    { id: 'swim_1500',    label: '1500 m (chrono)',           unit: 'min',    calc: 'manual_lower' },
  ],
  // === MUSCULATION ===
  musculation: [
    { id: 'mus_sess_w',   label: 'Séances par semaine',       unit: '/sem',   calc: 'avg_sess_week' },
    { id: 'mus_hours',    label: 'Heures annuelles',          unit: 'h',      calc: 'sum_hours' },
    { id: 'mus_bench',    label: 'Développé couché (1RM)',    unit: 'kg',     calc: 'manual' },
    { id: 'mus_squat',    label: 'Squat (1RM)',               unit: 'kg',     calc: 'manual' },
    { id: 'mus_dead',     label: 'Soulevé de terre (1RM)',    unit: 'kg',     calc: 'manual' },
    { id: 'mus_ohp',      label: 'Développé militaire (1RM)', unit: 'kg',     calc: 'manual' },
    { id: 'mus_clean',    label: 'Épaulé (1RM)',              unit: 'kg',     calc: 'manual' },
    { id: 'mus_pullup',   label: 'Tractions max consécutives', unit: 'reps',  calc: 'manual' },
    { id: 'mus_pushup',   label: 'Pompes max consécutives',   unit: 'reps',   calc: 'manual' },
    { id: 'mus_dips',     label: 'Dips max consécutifs',      unit: 'reps',   calc: 'manual' },
    { id: 'mus_plank',    label: 'Gainage durée max',         unit: 's',      calc: 'manual' },
    { id: 'mus_bw',       label: 'Poids corporel cible',      unit: 'kg',     calc: 'manual' },
  ],
  // === AUTRE ===
  autre: [
    { id: 'autre_hours',  label: 'Heures annuelles',          unit: 'h',      calc: 'sum_hours' },
    { id: 'autre_sess_w', label: 'Séances par semaine',       unit: '/sem',   calc: 'avg_sess_week' },
    { id: 'autre_dist',   label: 'Distance annuelle',         unit: 'km',     calc: 'sum_dist' },
  ],
  // === TOUS SPORTS (universel) ===
  tous: [
    { id: 'all_hours',    label: 'Heures totales annuelles',  unit: 'h',      calc: 'sum_hours' },
    { id: 'all_sess',     label: 'Séances totales annuelles', unit: '',       calc: 'sum_sess' },
    { id: 'all_tss',      label: 'TSS cumulé annuel',         unit: 'TSS',    calc: 'sum_tss' },
    { id: 'all_dist',     label: 'Distance totale annuelle',  unit: 'km',     calc: 'sum_dist' },
    { id: 'all_sess_w',   label: 'Séances totales par semaine', unit: '/sem', calc: 'avg_sess_week' },
  ],
};

// ============ STORAGE ============
function loadAllGoals() {
  try {
    const v2 = JSON.parse(localStorage.getItem(GOALS_KEY) || '{}');
    // Migration v1 → v2 (une seule fois)
    const v1Raw = localStorage.getItem(GOALS_LEGACY_KEY);
    if (v1Raw && Object.keys(v2).length === 0) {
      try {
        const v1 = JSON.parse(v1Raw);
        for (const year of Object.keys(v1)) {
          const arr = [];
          const map = { distance: 'all_dist', hours: 'all_hours', sessions: 'all_sess', tss: 'all_tss', elevation: 'all_elev' };
          for (const k of Object.keys(v1[year])) {
            const tplId = map[k];
            if (tplId && v1[year][k] > 0) {
              arr.push({ id: Date.now().toString() + Math.random(), sport: 'tous', template: tplId, target: v1[year][k] });
            }
          }
          if (arr.length) v2[year] = arr;
        }
        localStorage.setItem(GOALS_KEY, JSON.stringify(v2));
      } catch (e) { /* ignore */ }
    }
    return v2;
  } catch { return {}; }
}
function loadGoalsForYear(year) {
  const all = loadAllGoals();
  return all[String(year)] || [];
}
function saveGoalsForYear(year, arr) {
  const all = loadAllGoals();
  all[String(year)] = arr;
  localStorage.setItem(GOALS_KEY, JSON.stringify(all));
}
function isExpanded() {
  return localStorage.getItem(GOALS_EXPAND_KEY) === '1';
}
function setExpanded(v) {
  localStorage.setItem(GOALS_EXPAND_KEY, v ? '1' : '0');
}

function findTemplate(sport, tplId) {
  const list = GOAL_TEMPLATES[sport] || [];
  return list.find(t => t.id === tplId);
}

// ============ UTILS ============
function fmtNum(n, digits = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtDuration(minutes) {
  minutes = Math.round(Number(minutes) || 0);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}
function fmtFullDate(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

// ============ ACTIVITÉS ============
// Toutes les activités (sans filtre header) ; chaque consommateur filtre lui-même
function getAllActivities() {
  const data = window.DASHBOARD_DATA;
  if (!data || !data.days) return [];
  const out = [];
  for (const d of data.days) {
    const iso = typeof d.date === 'string' ? d.date.slice(0, 10) : new Date(d.date).toISOString().slice(0, 10);
    const acts = d.activities || [];
    for (const a of acts) {
      out.push({
        iso,
        date: new Date(iso + 'T12:00:00'),
        name: a.name, sport: a.sport, raw_type: a.raw_type,
        tss: a.tss || 0, duration_min: a.duration || 0,
        distance_km: a.distance_km || 0, elevation_gain: a.elevation_gain || 0,
        avg_watts: a.avg_watts, max_watts: a.max_watts,
        hr: a.hr, max_hr: a.max_hr, id: a.id,
      });
    }
  }
  return out;
}
function filterBySport(acts, sport) {
  if (!sport || sport === 'tous') return acts;
  return acts.filter(a => a.sport === sport);
}
function filterByHeaderActiveSports(acts) {
  const active = window.activeSports;
  if (!active || active.has('tout') || active.size === 0) return acts;
  return acts.filter(a => active.has(a.sport));
}
function activitiesYTD(all, year) {
  const start = new Date(year, 0, 1);
  const now = new Date();
  const end = year === now.getFullYear() ? now : new Date(year, 11, 31, 23, 59, 59);
  return all.filter(a => a.date >= start && a.date <= end);
}
function activitiesYTDPrevYear(all, year) {
  const now = new Date();
  const dayOfYear = year === now.getFullYear() ? Math.floor((now - new Date(year, 0, 1)) / 86400000) : 365;
  const start = new Date(year - 1, 0, 1);
  const end = new Date(year - 1, 0, 1);
  end.setDate(end.getDate() + dayOfYear);
  return all.filter(a => a.date >= start && a.date <= end);
}
function sumActs(acts) {
  let dist = 0, dur = 0, tss = 0, sessions = 0, elev = 0;
  for (const a of acts) {
    dist += a.distance_km || 0;
    dur += a.duration_min || 0;
    tss += a.tss || 0;
    elev += a.elevation_gain || 0;
    sessions += 1;
  }
  return { dist, dur, tss, sessions, elev };
}

// ============ SÉLECTEUR D'ANNÉE ============
function bilanAvailableYears(all) {
  const set = new Set();
  for (const a of all) set.add(a.date.getFullYear());
  set.add(new Date().getFullYear());
  return [...set].filter(y => y >= 2000).sort((a, b) => b - a);
}
function populateYearSelect(all) {
  const sel = document.getElementById('bilan-year-select');
  if (!sel) return;
  const years = bilanAvailableYears(all);
  if (!years.includes(_bilanYear)) _bilanYear = years[0];
  sel.innerHTML = years.map(y => `<option value="${y}"${y === _bilanYear ? ' selected' : ''}>${y}</option>`).join('');
  const prevEl = document.getElementById('bilan-prev-year');
  if (prevEl) prevEl.textContent = _bilanYear - 1;
  if (!sel._wired) {
    sel._wired = true;
    sel.addEventListener('change', () => { _bilanYear = +sel.value; renderBilan(); });
  }
}

// ============ SPARKLINES KPI ============
// Cumul mensuel d'une métrique pour une année donnée (null après le mois courant).
function monthlyCumul(all, year, key) {
  const m = new Array(12).fill(0);
  for (const a of all) {
    if (a.date.getFullYear() !== year) continue;
    const mo = a.date.getMonth();
    m[mo] += key === 'hours' ? (a.duration_min || 0) / 60
      : key === 'sessions' ? 1
      : (a[key] || 0);
  }
  for (let i = 1; i < 12; i++) m[i] += m[i - 1];
  const now = new Date();
  if (year === now.getFullYear()) for (let i = now.getMonth() + 1; i < 12; i++) m[i] = null;
  return m;
}
function drawSpark(svgId, arr) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const pts = arr.map((v, i) => [i, v]).filter(p => p[1] != null);
  if (pts.length < 2) { svg.innerHTML = ''; return; }
  const W = 120, H = 24, pad = 2;
  const maxY = Math.max(...pts.map(p => p[1])) || 1;
  const X = i => pad + (i / 11) * (W - 2 * pad);
  const Y = v => H - pad - (v / maxY) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const area = `${line} L${X(last[0]).toFixed(1)},${H} L${X(pts[0][0]).toFixed(1)},${H} Z`;
  svg.innerHTML = `<path d="${area}" fill="rgba(74,222,128,0.12)" stroke="none"/>`
    + `<path d="${line}" fill="none" stroke="#4ade80" stroke-width="1.6" stroke-linejoin="round"/>`;
}

// ============ KPIs ANNUELS (respectent filtre header) ============
function renderKPIs(allUnfiltered) {
  const year = _bilanYear;
  const prevYear = year - 1;
  document.querySelectorAll('.bilan-year-label').forEach(el => el.textContent = year);

  // Filtre header
  const all = filterByHeaderActiveSports(allUnfiltered);
  const ytd = sumActs(activitiesYTD(all, year));
  const prev = sumActs(activitiesYTDPrevYear(all, year));

  // Sparklines (cumul mensuel de l'année affichée)
  drawSpark('bilan-spark-dist', monthlyCumul(all, year, 'distance_km'));
  drawSpark('bilan-spark-hours', monthlyCumul(all, year, 'hours'));
  drawSpark('bilan-spark-sessions', monthlyCumul(all, year, 'sessions'));
  drawSpark('bilan-spark-tss', monthlyCumul(all, year, 'tss'));

  function setCard(prefix, currentVal, prevVal, fmt, unit) {
    const valEl = document.getElementById(`bilan-${prefix}-val`);
    const diffEl = document.getElementById(`bilan-${prefix}-diff`);
    const prevEl = document.getElementById(`bilan-${prefix}-prev`);
    if (!valEl) return;
    valEl.textContent = fmt(currentVal);
    if (prevVal > 0) {
      const pct = Math.round(((currentVal - prevVal) / prevVal) * 100);
      const sign = pct >= 0 ? '+' : '';
      diffEl.textContent = `${sign}${pct}% vs ${prevYear}`;
      diffEl.classList.toggle('up', pct >= 0);
      diffEl.classList.toggle('down', pct < 0);
      prevEl.textContent = `${prevYear} à la même date : ${fmt(prevVal)}${unit ? ' ' + unit : ''}`;
    } else {
      diffEl.textContent = '—';
      prevEl.textContent = `Pas de référence ${prevYear}`;
    }
  }

  setCard('dist', ytd.dist, prev.dist, v => fmtNum(v, 0), 'km');
  setCard('hours', ytd.dur / 60, prev.dur / 60, v => fmtNum(v, 1), 'h');
  setCard('sessions', ytd.sessions, prev.sessions, v => fmtNum(v, 0), '');
  setCard('tss', ytd.tss, prev.tss, v => fmtNum(v, 0), 'TSS');
}

// ============ CALCUL DU CURRENT D'UN OBJECTIF ============
function computeGoalCurrent(goal, allUnfiltered, year) {
  const tpl = findTemplate(goal.sport, goal.template);
  if (!tpl) return null;
  // Pour 'manual', on retourne ce que l'user a saisi
  if (tpl.calc === 'manual' || tpl.calc === 'manual_lower') {
    return goal.currentManual != null ? goal.currentManual : null;
  }
  // Sinon, on calcule depuis les activités du sport de l'objectif (ou toutes si 'tous')
  const scoped = filterBySport(allUnfiltered, goal.sport);
  const ytd = activitiesYTD(scoped, year);
  const s = sumActs(ytd);
  switch (tpl.calc) {
    case 'sum_dist':  return s.dist;
    case 'sum_hours': return s.dur / 60;
    case 'sum_sess':  return s.sessions;
    case 'sum_tss':   return s.tss;
    case 'sum_elev':  return s.elev;
    case 'max_dist': {
      let best = 0;
      for (const a of ytd) if ((a.distance_km || 0) > best) best = a.distance_km;
      return best;
    }
    case 'max_dur': {
      let best = 0;
      for (const a of ytd) if ((a.duration_min || 0) > best) best = a.duration_min;
      return best;
    }
    case 'max_elev_day': {
      const byDay = {};
      for (const a of ytd) byDay[a.iso] = (byDay[a.iso] || 0) + (a.elevation_gain || 0);
      let best = 0;
      for (const k in byDay) if (byDay[k] > best) best = byDay[k];
      return best;
    }
    case 'avg_sess_week': {
      const now = new Date();
      const weeks = year === now.getFullYear() ? Math.max(1, Math.floor((now - new Date(year, 0, 1)) / (7 * 86400000))) : 52;
      return s.sessions / weeks;
    }
    case 'avg_hours_week': {
      const now = new Date();
      const weeks = year === now.getFullYear() ? Math.max(1, Math.floor((now - new Date(year, 0, 1)) / (7 * 86400000))) : 52;
      return (s.dur / 60) / weeks;
    }
    default: return null;
  }
}

// ============ AFFICHAGE OBJECTIFS ============
function renderGoals(allUnfiltered) {
  const year = _bilanYear;
  document.getElementById('bilan-goals-year').textContent = year;

  const allGoals = loadGoalsForYear(year);
  const active = window.activeSports;
  const isFilterAll = !active || active.has('tout') || active.size === 0;
  const activeSportSingle = isFilterAll ? null : (active.size === 1 ? [...active][0] : null);

  const container = document.getElementById('bilan-goals');
  const headerWrap = document.querySelector('.bilan-goals-card .bilan-goals-header');
  const card = document.querySelector('.bilan-goals-card');
  const collapseBtn = document.getElementById('bilan-goals-collapse');

  // Filtre les objectifs à afficher selon le mode
  let goalsToShow;
  let addSports;
  if (isFilterAll) {
    // Mode "Tout" : section repliable (par défaut REPLIÉE)
    goalsToShow = allGoals;
    addSports = ['tous', 'cyclisme', 'course', 'natation', 'musculation', 'autre'];
    card.classList.add('is-collapsible');
    const expanded = isExpanded();
    card.classList.toggle('is-expanded', expanded);
    if (collapseBtn) {
      collapseBtn.hidden = false;
      collapseBtn.textContent = expanded ? '↑ Replier' : '↓ Déplier (' + allGoals.length + ')';
    }
  } else {
    // Mode sport spécifique : section toujours dépliée, n'affiche que les objectifs du sport + 'tous'
    const sportSet = new Set([...active]);
    goalsToShow = allGoals.filter(g => g.sport === 'tous' || sportSet.has(g.sport));
    addSports = activeSportSingle ? [activeSportSingle, 'tous'] : [...sportSet, 'tous'];
    card.classList.remove('is-collapsible', 'is-expanded');
    if (collapseBtn) collapseBtn.hidden = true;
  }

  // Header sub label
  const subEl = document.querySelector('.bilan-goals-card .section-subtitle');
  if (subEl) {
    if (isFilterAll) {
      subEl.textContent = allGoals.length === 0
        ? 'Aucun objectif défini. Clique sur « + Ajouter » pour en créer un.'
        : `${allGoals.length} objectif${allGoals.length > 1 ? 's' : ''} défini${allGoals.length > 1 ? 's' : ''} (tous sports confondus).`;
    } else {
      subEl.textContent = `Objectifs filtrés sur ${[...active].map(s => SPORT_LABELS[s] || s).join(', ')}`;
    }
  }

  // Rendu
  if (goalsToShow.length === 0) {
    container.innerHTML = `<div class="bilan-goal-empty-state">Aucun objectif défini pour ce filtre. Clique sur « + Ajouter un objectif » pour en créer un.</div>`;
  } else {
    container.innerHTML = goalsToShow.map(g => renderGoalRow(g, allUnfiltered, year, isFilterAll)).join('');
    // Wire actions (clic = édition, suppression via menu)
    container.querySelectorAll('.bilan-goal-row').forEach(row => {
      const id = row.dataset.goalId;
      row.querySelector('.bilan-goal-edit')?.addEventListener('click', (e) => {
        e.stopPropagation(); openGoalEditor(id);
      });
      row.querySelector('.bilan-goal-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmAndDelete(id);
      });
    });
  }

  // Boutons d'ajout
  const addBtnsEl = document.getElementById('bilan-goals-add-btns');
  if (addBtnsEl) {
    addBtnsEl.innerHTML = addSports.map(s => `
      <button class="bilan-goal-add-btn" data-sport="${s}" type="button">+ ${SPORT_LABELS[s]}</button>
    `).join('');
    addBtnsEl.querySelectorAll('.bilan-goal-add-btn').forEach(btn => {
      btn.addEventListener('click', () => openGoalAdd(btn.dataset.sport));
    });
  }
}

function renderGoalRow(goal, allUnfiltered, year, showSport) {
  const tpl = findTemplate(goal.sport, goal.template);
  if (!tpl) return '';
  const current = computeGoalCurrent(goal, allUnfiltered, year);
  const target = goal.target;
  const isLower = tpl.calc === 'manual_lower';
  // Pour 'manual_lower' : on atteint quand current <= target
  let pct, onTrack;
  if (current == null) {
    pct = 0; onTrack = false;
  } else if (isLower) {
    // Plus la valeur est basse, plus on progresse vers la target
    pct = Math.min(100, Math.max(0, (target / current) * 100));
    onTrack = current <= target;
  } else {
    pct = Math.min(100, (current / target) * 100);
    // Pour 'manual' : on est "on track" si on a atteint la target
    // Pour les cumuls (sum_*) : on track si on suit le rythme jour/année
    if (tpl.calc.startsWith('sum_') || tpl.calc.startsWith('avg_')) {
      const now = new Date();
      const expected = target * ((now - new Date(year, 0, 1)) / (365 * 86400000));
      onTrack = current >= expected;
    } else {
      onTrack = current >= target;
    }
  }

  const currentStr = current == null ? '—' : fmtNum(current, tpl.unit === 'h' ? 1 : (tpl.unit === 'W/kg' ? 2 : 0));
  const targetStr = fmtNum(target, tpl.unit === 'h' ? 1 : (tpl.unit === 'W/kg' ? 2 : 0));
  const sportBadge = showSport && goal.sport !== 'tous'
    ? `<span class="bilan-goal-sport-badge" data-sport-cat="${goal.sport}">${SPORT_LABELS[goal.sport]}</span>`
    : '';
  const sportBadgeTous = showSport && goal.sport === 'tous'
    ? `<span class="bilan-goal-sport-badge bilan-goal-sport-tous">Tous</span>`
    : '';

  // Indicateur manuel : pas de barre de progression "rythme attendu"
  const isCumulative = tpl.calc.startsWith('sum_') || tpl.calc.startsWith('avg_');
  const showMark = !isLower && isCumulative;
  const now = new Date();
  const expectedMark = Math.min(100, ((now - new Date(year, 0, 1)) / (365 * 86400000)) * 100);

  // Projection de fin d'année (seulement année en cours + objectif cumulé)
  let projHtml = '';
  if (isCumulative && current != null && year === now.getFullYear()) {
    const frac = (now - new Date(year, 0, 1)) / (365 * 86400000);
    if (frac > 0.02) {
      const projection = current / frac;
      const projPct = Math.round((projection / target) * 100);
      const projStr = fmtNum(projection, tpl.unit === 'h' ? 1 : 0);
      const cls = projPct >= 100 ? 'proj-ok' : 'proj-low';
      projHtml = `<div class="bilan-goal-proj ${cls}">Projection fin d'année : <strong>${projStr} ${tpl.unit}</strong> · cible à ${projPct}%</div>`;
    }
  }

  return `
    <div class="bilan-goal-row" data-goal-id="${goal.id}">
      <div class="bilan-goal-row-head">
        ${sportBadge}${sportBadgeTous}
        <span class="bilan-goal-label">${escapeHtml(tpl.label)}</span>
        <span class="bilan-goal-meta-inline">
          <strong>${currentStr}</strong> / ${targetStr} ${tpl.unit}
          <span class="bilan-goal-pct">${current == null ? '—' : pct.toFixed(0) + '%'}</span>
        </span>
        <div class="bilan-goal-row-actions">
          <button class="bilan-goal-edit" type="button" title="Modifier">✎</button>
          <button class="bilan-goal-del" type="button" title="Supprimer">×</button>
        </div>
      </div>
      <div class="bilan-goal-bar">
        <div class="bilan-goal-fill ${onTrack ? 'on-track' : 'behind'}" style="width:${pct.toFixed(1)}%;"></div>
        ${showMark ? `<div class="bilan-goal-mark" style="left:${expectedMark.toFixed(1)}%;" title="Rythme attendu à cette date"></div>` : ''}
      </div>
      ${projHtml}
    </div>
  `;
}

// ============ MODAL : AJOUTER UN OBJECTIF ============
function openGoalAdd(sport) {
  const tpls = GOAL_TEMPLATES[sport] || [];
  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.innerHTML = `
    <div class="day-modal">
      <div class="day-modal-header">
        <h3>Ajouter un objectif · ${SPORT_LABELS[sport]}</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        <div class="bilan-tpl-grid">
          ${tpls.map(t => `
            <button class="bilan-tpl-pick" type="button" data-tpl="${t.id}">
              <strong>${escapeHtml(t.label)}</strong>
              <span class="bilan-tpl-unit">${t.unit}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.day-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll('.bilan-tpl-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.remove();
      openGoalEditor(null, sport, btn.dataset.tpl);
    });
  });
}

// ============ MODAL : ÉDITER UN OBJECTIF (ajout / modif) ============
function openGoalEditor(id, presetSport, presetTpl) {
  const year = _bilanYear;
  const goals = loadGoalsForYear(year);
  let goal = id ? goals.find(g => g.id === id) : null;
  const sport = goal ? goal.sport : presetSport;
  const tpl = findTemplate(sport, goal ? goal.template : presetTpl);
  if (!tpl) return;

  const isManual = tpl.calc === 'manual' || tpl.calc === 'manual_lower';

  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.innerHTML = `
    <div class="day-modal">
      <div class="day-modal-header">
        <h3>${goal ? 'Modifier' : 'Nouvel'} objectif · ${SPORT_LABELS[sport]}</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        <div class="bilan-edit-label">${escapeHtml(tpl.label)}</div>
        <label class="bilan-edit-field">
          <span>Objectif (${tpl.unit}) ${tpl.calc === 'manual_lower' ? ' — valeur à atteindre (plus bas = mieux)' : ''}</span>
          <input type="number" id="_goal-target" step="any" value="${goal ? goal.target : ''}" placeholder="ex. ${tpl.unit === 'kg' ? '100' : '1000'}">
        </label>
        ${isManual ? `
          <label class="bilan-edit-field">
            <span>Valeur actuelle (${tpl.unit})</span>
            <input type="number" id="_goal-current" step="any" value="${goal && goal.currentManual != null ? goal.currentManual : ''}" placeholder="Ta perf actuelle">
          </label>
          <p class="bilan-edit-help">Pour les records perso (1RM, chrono, FTP…), saisis ta valeur actuelle. Tu la mettras à jour quand tu progresseras.</p>
        ` : `<p class="bilan-edit-help">La valeur actuelle est calculée automatiquement depuis tes activités.</p>`}
      </div>
      <div class="day-modal-footer">
        ${goal ? '<button class="day-modal-delete" type="button">Supprimer</button>' : ''}
        <div style="flex:1;"></div>
        <button class="day-modal-cancel" type="button">Annuler</button>
        <button class="day-modal-save" type="button">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.day-modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.day-modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.day-modal-save').addEventListener('click', () => {
    const target = parseFloat(document.getElementById('_goal-target').value);
    if (!target || target <= 0) return;
    const currentManualInp = document.getElementById('_goal-current');
    const currentManual = isManual && currentManualInp && currentManualInp.value !== ''
      ? parseFloat(currentManualInp.value) : undefined;
    let savedGoal;
    if (goal) {
      goal.target = target;
      if (currentManual !== undefined) goal.currentManual = currentManual;
      else delete goal.currentManual;
      savedGoal = goal;
    } else {
      savedGoal = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        sport, template: tpl.id, target,
        ...(currentManual !== undefined ? { currentManual } : {}),
      };
      goals.push(savedGoal);
    }
    saveGoalsForYear(year, goals);
    // Mirror cloud (fire-and-forget)
    if (window.cloudSync) {
      window.cloudSync.pushGoal(year, savedGoal).then(sbId => {
        if (sbId && !savedGoal._sbId) {
          savedGoal._sbId = sbId;
          saveGoalsForYear(year, goals); // re-save avec _sbId pour pouvoir update plus tard
        }
      });
    }
    overlay.remove();
    renderBilan();
  });
  const delBtn = overlay.querySelector('.day-modal-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await (window.appConfirm ? window.appConfirm({
      title: 'Supprimer', message: 'Supprimer cet objectif ?', confirmLabel: 'Supprimer', danger: true,
    }) : Promise.resolve(window.confirm('Supprimer cet objectif ?')));
    if (!ok) return;
    const remaining = goals.filter(g => g.id !== goal.id);
    saveGoalsForYear(year, remaining);
    if (window.cloudSync) window.cloudSync.deleteGoal(goal);
    overlay.remove();
    renderBilan();
  });
}

async function confirmAndDelete(id) {
  const ok = await (window.appConfirm ? window.appConfirm({
    title: 'Supprimer', message: 'Supprimer cet objectif ?', confirmLabel: 'Supprimer', danger: true,
  }) : Promise.resolve(window.confirm('Supprimer cet objectif ?')));
  if (!ok) return;
  const year = _bilanYear;
  const all = loadGoalsForYear(year);
  const goalToDelete = all.find(g => g.id === id);
  const remaining = all.filter(g => g.id !== id);
  saveGoalsForYear(year, remaining);
  if (window.cloudSync && goalToDelete) window.cloudSync.deleteGoal(goalToDelete);
  renderBilan();
}

// ============ RECORDS DE VOLUME (respectent filtre header) ============
function renderVolumeRecords(allUnfiltered) {
  const wrap = document.getElementById('bilan-volume-records');
  if (!wrap) return;
  const all = filterByHeaderActiveSports(allUnfiltered);
  if (!all.length) { wrap.innerHTML = '<p class="bilan-empty">Aucune activité</p>'; return; }

  const byMax = (key) => {
    let best = null;
    for (const a of all) if ((a[key] || 0) > (best ? (best[key] || 0) : 0)) best = a;
    return best;
  };
  const longest = byMax('distance_km');
  const longestDur = byMax('duration_min');
  const biggestTss = byMax('tss');
  const elevByDay = {};
  for (const a of all) elevByDay[a.iso] = (elevByDay[a.iso] || 0) + (a.elevation_gain || 0);
  let bigDayIso = null, bigDayElev = 0;
  for (const iso in elevByDay) if (elevByDay[iso] > bigDayElev) { bigDayElev = elevByDay[iso]; bigDayIso = iso; }

  const rows = [
    longest && longest.distance_km > 0 && { label: 'Plus longue sortie', value: fmtNum(longest.distance_km, 1) + ' km', sub: longest.name, date: longest.iso },
    longestDur && longestDur.duration_min > 0 && { label: 'Plus longue durée', value: fmtDuration(longestDur.duration_min), sub: longestDur.name, date: longestDur.iso },
    biggestTss && biggestTss.tss > 0 && { label: 'Plus gros TSS', value: fmtNum(biggestTss.tss, 0), sub: biggestTss.name, date: biggestTss.iso },
    bigDayElev > 0 && { label: 'Plus de D+ en 1 jour', value: fmtNum(bigDayElev, 0) + ' m', sub: 'Cumul des activités du jour', date: bigDayIso },
  ].filter(Boolean);

  wrap.innerHTML = rows.map(r => `
    <div class="bilan-record"${r.date ? ` data-date="${r.date}"` : ''}>
      <div class="bilan-record-label">${r.label}${isRecentRecord(r.date) ? ' <span class="bilan-record-new">nouveau</span>' : ''}</div>
      <div class="bilan-record-value">${r.value}</div>
      <div class="bilan-record-sub">${escapeHtml(r.sub || '—')}</div>
      <div class="bilan-record-date">${fmtFullDate(r.date)}</div>
    </div>
  `).join('');
  wireRecordClicks(wrap);
}

// Un record est "nouveau" s'il a été établi dans les 30 derniers jours.
function isRecentRecord(iso) {
  if (!iso) return false;
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return false;
  return (Date.now() - d.getTime()) < 30 * 86400000;
}

// Sport choisi pour les records de puissance (sélecteur local, indépendant).
let _powerSport = 'cyclisme';
function powerTargetSport() { return _powerSport; }
window.coachPowerSport = () => _powerSport; // lu aussi par power-profile.js

const POWER_SPORT_LABELS = { cyclisme: 'Cyclisme', course: 'Course', musculation: 'Muscu', natation: 'Natation', autre: 'Autre' };

// Remplit le <select> des sports disposant de données de puissance + câble le change.
function populatePowerSportSelect(bySport) {
  const sel = document.getElementById('power-sport-select');
  if (!sel) return;
  const order = ['cyclisme', 'course', 'musculation', 'natation', 'autre'];
  const avail = order.filter(s => bySport[s] && bySport[s].durations && Object.keys(bySport[s].durations).length);
  if (avail.length && !avail.includes(_powerSport)) _powerSport = avail[0];
  sel.innerHTML = avail.map(s => `<option value="${s}"${s === _powerSport ? ' selected' : ''}>${POWER_SPORT_LABELS[s] || s}</option>`).join('');
  sel.style.display = avail.length > 1 ? '' : 'none'; // inutile s'il n'y a qu'un sport
  if (!sel._wired) {
    sel._wired = true;
    sel.addEventListener('change', () => {
      _powerSport = sel.value;
      renderPowerRecords();
      if (window.renderPowerProfile) window.renderPowerProfile();
    });
  }
}

// Affiche les records de puissance depuis power_by_sport, pour le sport actif.
function renderPowerRecords() {
  const wrap = document.getElementById('bilan-power-records');
  if (!wrap) return;
  const data = window.DASHBOARD_DATA;
  const bySport = (data && data.power_by_sport) || {};
  populatePowerSportSelect(bySport);
  const sport = powerTargetSport();
  const pps = bySport[sport];
  if (!pps || !pps.durations || Object.keys(pps.durations).length === 0) {
    wrap.innerHTML = `<p class="bilan-empty">Aucun record de puissance pour ce sport.</p>`;
    return;
  }
  // Durées clés (libellés = colonnes de power_profile_sport)
  const KEY_DURS = [
    { c: '5s',   label: '5 secondes'  },
    { c: '15s',  label: '15 secondes' },
    { c: '30s',  label: '30 secondes' },
    { c: '1min', label: '1 minute'    },
    { c: '2min', label: '2 minutes'   },
    { c: '5min', label: '5 minutes'   },
    { c: '10min',label: '10 minutes'  },
    { c: '20min',label: '20 minutes'  },
    { c: '30min',label: '30 minutes'  },
    { c: '1h',   label: '1 heure'     },
  ];
  const durations = pps.durations || {};
  const details = pps.details || {};
  const rows = KEY_DURS.map(k => {
    const at = durations[k.c];
    if (at == null) return null;
    const d = details[k.c] || {};
    const r = d.w90;
    const subParts = [];
    if (r != null && r !== at) {
      const diff = Math.round(r - at);
      subParts.push(`90j : ${Math.round(r)} W (${diff >= 0 ? '+' : ''}${diff} W)`);
    } else if (r != null) {
      subParts.push('Égal au record sur les 90 derniers jours');
    } else {
      subParts.push('Pas de récent comparable');
    }
    return {
      label: k.label,
      value: Math.round(at) + ' W',
      sub: subParts.join(' · '),
      date: d.date || null,
    };
  }).filter(Boolean);
  if (!rows.length) {
    wrap.innerHTML = `<p class="bilan-empty">Aucun record de puissance pour ce sport.</p>`;
    return;
  }
  wrap.innerHTML = rows.map(r => `
    <div class="bilan-record"${r.date ? ` data-date="${r.date}"` : ''}>
      <div class="bilan-record-label">${escapeHtml(r.label)}${isRecentRecord(r.date) ? ' <span class="bilan-record-new">nouveau</span>' : ''}</div>
      <div class="bilan-record-value">${r.value}</div>
      <div class="bilan-record-sub">${escapeHtml(r.sub)}</div>
    </div>
  `).join('');
  wireRecordClicks(wrap);
}

// Rend cliquable chaque record ayant une date → ouvre la sortie dans le calendrier.
function wireRecordClicks(wrap) {
  wrap.querySelectorAll('.bilan-record[data-date]').forEach(el => {
    el.style.cursor = 'pointer';
    el.title = 'Voir cette sortie dans le calendrier';
    el.addEventListener('click', () => {
      const iso = el.dataset.date;
      if (iso && window.goToCalendarDay) window.goToCalendarDay(iso);
    });
  });
}

// ============ CHART CUMUL ANNUEL (respecte filtre header) ============
let _yearlyChart = null;
function renderYearlyChart(allUnfiltered) {
  const canvas = document.getElementById('chart-bilan-yearly');
  if (!canvas || !window.Chart) return;
  const all = filterByHeaderActiveSports(allUnfiltered);
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear];

  const metric = _cumulMetric;            // 'distance_km' | 'elevation_gain'
  const unit = metric === 'elevation_gain' ? ' m' : ' km';
  const datasets = years.map((year, i) => {
    const cumul = new Array(12).fill(0);
    const acts = all.filter(a => a.date.getFullYear() === year);
    for (const a of acts) {
      const m = a.date.getMonth();
      cumul[m] += a[metric] || 0;
    }
    for (let j = 1; j < 12; j++) cumul[j] += cumul[j - 1];
    if (year === currentYear) {
      const curMonth = now.getMonth();
      for (let j = curMonth + 1; j < 12; j++) cumul[j] = null;
    }
    const colors = ['#5a6378', '#60a5fa', '#4ade80'];
    return {
      label: String(year),
      data: cumul,
      borderColor: colors[i],
      backgroundColor: colors[i] + '15',
      borderWidth: i === 2 ? 2.5 : 1.5,
      tension: 0.25, fill: false, spanGaps: false,
      pointRadius: i === 2 ? 3 : 2,
    };
  });
  if (_yearlyChart) { _yearlyChart.destroy(); _yearlyChart = null; }
  _yearlyChart = new window.Chart(canvas, {
    type: 'line',
    data: { labels: ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'], datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#e6e9ef', font: { size: 11 }, boxWidth: 14 } },
        tooltip: { mode: 'index', intersect: false, callbacks: {
          label: (item) => `${item.dataset.label} : ${item.parsed.y == null ? '—' : Math.round(item.parsed.y) + unit}`,
        }},
      },
      scales: {
        x: { ticks: { color: '#8b94a8' }, grid: { color: '#232a3a' } },
        y: { ticks: { color: '#8b94a8', callback: (v) => v + unit }, grid: { color: '#232a3a' }, beginAtZero: true },
      },
    },
  });
}

// ============ CHART VOLUME PAR MOIS (année vs N-1) ============
let _monthlyChart = null;
function renderMonthlyVolumeChart(allUnfiltered) {
  const canvas = document.getElementById('chart-bilan-monthly');
  if (!canvas || !window.Chart) return;
  const all = filterByHeaderActiveSports(allUnfiltered);
  const year = _bilanYear, prev = year - 1;
  const cur = new Array(12).fill(0), pre = new Array(12).fill(0);
  for (const a of all) {
    const y = a.date.getFullYear(), mo = a.date.getMonth();
    const h = (a.duration_min || 0) / 60;
    if (y === year) cur[mo] += h;
    else if (y === prev) pre[mo] += h;
  }
  const r1 = v => Math.round(v * 10) / 10;
  const yEl = document.getElementById('bilan-monthly-year');
  const pEl = document.getElementById('bilan-monthly-prev');
  if (yEl) yEl.textContent = year;
  if (pEl) pEl.textContent = prev;
  if (_monthlyChart) { _monthlyChart.destroy(); _monthlyChart = null; }
  _monthlyChart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'],
      datasets: [
        { label: String(prev), data: pre.map(r1), backgroundColor: '#2c3447', borderRadius: 4, categoryPercentage: 0.7, barPercentage: 0.9 },
        { label: String(year), data: cur.map(r1), backgroundColor: '#4ade80', borderRadius: 4, categoryPercentage: 0.7, barPercentage: 0.9 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#e6e9ef', font: { size: 11 }, boxWidth: 12 } },
        tooltip: { mode: 'index', intersect: false, callbacks: {
          label: (item) => `${item.dataset.label} : ${r1(item.parsed.y)} h`,
        }},
      },
      scales: {
        x: { ticks: { color: '#8b94a8' }, grid: { display: false } },
        y: { ticks: { color: '#8b94a8', callback: (v) => v + ' h' }, grid: { color: '#232a3a' }, beginAtZero: true },
      },
    },
  });
}

// ============ MAIN ============
function renderBilan() {
  try {
    const all = getAllActivities();
    populateYearSelect(all);
    renderKPIs(all);
    renderGoals(all);
    renderVolumeRecords(all);
    renderPowerRecords();
    setTimeout(() => { renderMonthlyVolumeChart(all); renderYearlyChart(all); }, 50);
  } catch (e) {
    console.error('[bilan] render error:', e);
  }
}

function init() {
  // Bouton replier/déplier (mode Tout sports)
  const collapseBtn = document.getElementById('bilan-goals-collapse');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      setExpanded(!isExpanded());
      renderBilan();
    });
  }
  // Toggle Distance / Dénivelé sur le cumul annuel
  const cumulToggle = document.getElementById('bilan-cumul-toggle');
  if (cumulToggle) {
    cumulToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-metric]');
      if (!btn) return;
      _cumulMetric = btn.dataset.metric;
      cumulToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      renderYearlyChart(getAllActivities());
    });
  }
  setTimeout(renderBilan, 200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.renderBilan = renderBilan;
