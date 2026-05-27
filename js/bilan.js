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
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
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

// ============ KPIs ANNUELS (respectent filtre header) ============
function renderKPIs(allUnfiltered) {
  const now = new Date();
  const year = now.getFullYear();
  const prevYear = year - 1;
  document.querySelectorAll('.bilan-year-label').forEach(el => el.textContent = year);

  // Filtre header
  const all = filterByHeaderActiveSports(allUnfiltered);
  const ytd = sumActs(activitiesYTD(all, year));
  const prev = sumActs(activitiesYTDPrevYear(all, year));

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
  const now = new Date();
  const year = now.getFullYear();
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
  const showMark = !isLower && (tpl.calc.startsWith('sum_') || tpl.calc.startsWith('avg_'));
  const expectedMark = (() => {
    const now = new Date();
    return Math.min(100, ((now - new Date(year, 0, 1)) / (365 * 86400000)) * 100);
  })();

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
  const now = new Date();
  const year = now.getFullYear();
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
  const year = new Date().getFullYear();
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
    <div class="bilan-record">
      <div class="bilan-record-label">${r.label}</div>
      <div class="bilan-record-value">${r.value}</div>
      <div class="bilan-record-sub">${escapeHtml(r.sub || '—')}</div>
      <div class="bilan-record-date">${fmtFullDate(r.date)}</div>
    </div>
  `).join('');
}

// Affiche les records de puissance (Mean Maximal Power) depuis window.DASHBOARD_DATA.power_profile
function renderPowerRecords() {
  const wrap = document.getElementById('bilan-power-records');
  if (!wrap) return;
  const data = window.DASHBOARD_DATA;
  const pp = data && data.power_profile;
  if (!pp || !pp.alltime || Object.keys(pp.alltime).length === 0) {
    wrap.innerHTML = `<p class="bilan-empty">Power Profile non disponible.<br>Sera calculé au prochain run de fetch_data.py (cron 15min).</p>`;
    return;
  }
  // Durées clés à mettre en avant (secondes → label)
  const KEY_DURS = [
    { s: '5',    label: '5 secondes'  },
    { s: '60',   label: '1 minute'    },
    { s: '300',  label: '5 minutes'   },
    { s: '1200', label: '20 minutes'  },
    { s: '3600', label: '1 heure'     },
  ];
  const alltime = pp.alltime || {};
  const recent = pp.last_90d || {};
  const rows = KEY_DURS.map(k => {
    const at = alltime[k.s];
    const r = recent[k.s];
    if (at == null) return null;
    const subParts = [];
    if (r != null && r !== at) {
      const diff = Math.round(r - at);
      const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;
      subParts.push(`90j : ${Math.round(r)} W (${diffStr} W)`);
    } else if (r != null) {
      subParts.push(`Égal au record sur les 90 derniers jours`);
    } else {
      subParts.push('Pas de récent comparable');
    }
    return {
      label: k.label,
      value: Math.round(at) + ' W',
      sub: subParts.join(' · '),
    };
  }).filter(Boolean);
  if (!rows.length) {
    wrap.innerHTML = `<p class="bilan-empty">Aucun record de puissance encore calculé.</p>`;
    return;
  }
  wrap.innerHTML = rows.map(r => `
    <div class="bilan-record">
      <div class="bilan-record-label">${escapeHtml(r.label)}</div>
      <div class="bilan-record-value">${r.value}</div>
      <div class="bilan-record-sub">${escapeHtml(r.sub)}</div>
    </div>
  `).join('');
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

  const datasets = years.map((year, i) => {
    const cumul = new Array(12).fill(0);
    const acts = all.filter(a => a.date.getFullYear() === year);
    for (const a of acts) {
      const m = a.date.getMonth();
      cumul[m] += a.distance_km || 0;
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
          label: (item) => `${item.dataset.label} : ${item.parsed.y == null ? '—' : Math.round(item.parsed.y) + ' km'}`,
        }},
      },
      scales: {
        x: { ticks: { color: '#8b94a8' }, grid: { color: '#232a3a' } },
        y: { ticks: { color: '#8b94a8', callback: (v) => v + ' km' }, grid: { color: '#232a3a' }, beginAtZero: true },
      },
    },
  });
}

// ============ MAIN ============
function renderBilan() {
  try {
    const all = getAllActivities();
    renderKPIs(all);
    renderGoals(all);
    renderVolumeRecords(all);
    renderPowerRecords();
    setTimeout(() => renderYearlyChart(all), 50);
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
  setTimeout(renderBilan, 200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.renderBilan = renderBilan;
