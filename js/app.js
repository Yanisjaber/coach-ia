/* ============================================================
   js/app.js — Module principal (refactoring Phase 2)

   Extrait du <script> inline de dashboard.html.
   Chargé via <script type="module" src="js/app.js"></script>.

   Notes :
   - Mode module ES6 (strict mode automatique).
   - data.js et streams.js sont chargés AVANT et exposent
     window.DASHBOARD_DATA et window.STREAMS_CACHE.
   - Les librairies (Chart.js, Leaflet, Flatpickr) sont accessibles
     via window.Chart, window.L, window.flatpickr.

   Phase 3 : ce fichier sera ensuite découpé en modules
   thématiques (utils, state, dashboard/, calendar/, modals/, etc.)
   ============================================================ */

// ========= UTILS =========
// Sortis dans js/utils.js — importés ici pour rester disponibles dans tout le module.
import { rand, randInt, clamp, fmtDate } from './utils.js';

// ========= SUPABASE (client + auth + storage adapter + cloud sync + data loader + Strava OAuth) =========
// Doit être chargé EN PREMIER pour que les autres modules aient accès à window.sb.
import './supabase-client.js';
import './auth.js';
import './profile-modal.js';
import './storage-adapter.js';
import './cloud-sync.js';
import './supabase-data-loader.js';
import './strava-oauth.js';
import './whoop-oauth.js';
import './connections-modal.js';
import './settings-modal.js';
import './help-modal.js';

// ========= MODE IA / MANUEL =========
// Sorti dans js/app-mode.js. Auto-bootstrap au DOMContentLoaded à l'import.
import './app-mode.js';

// ========= WORKOUT BUILDER (séances structurées par blocs) =========
// Sorti dans js/workout-builder.js. Expose window.getCurrentWorkoutStructure().
import './workout-builder.js';
// Editeur de seance structuree (style Nolio) pour la modale prevu. Doit etre importe
// APRES workout-builder pour surcharger les 3 fonctions pivot.
import './session-builder.js';
import './gpx-field.js';

// ========= POWER PROFILE (Mean Maximal Power) =========
// Lit window.DASHBOARD_DATA.power_profile (généré par fetch_data.py).
// Auto-render au DOMContentLoaded.
import './power-profile.js';

// ========= DAY EXTRAS (actions rapides sur un jour du calendrier) =========
// Bouton "+" au hover, popover : ajouter entraînement / note / repos / cycle (phase).
// Auto-bootstrap + MutationObserver sur #week-calendar pour ré-attacher après chaque render.
import './sport-profiles.js';
import './day-extras.js';
import './scroll-lock.js';
import './adherence.js';

// ========= BILAN ANNUEL (nouvelle page p3, remplace Tendances long-terme) =========
// KPIs YTD vs N-1, objectifs annuels, records, cumul kilométrique annuel.
import './bilan.js';
// Icones SVG des lignes du bilan hebdo (Design "icone + valeur + label")
const _WT_IC = {
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  km:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/></svg>',
  sea: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4h13l-2 4 2 4H4"/></svg>',
  tss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  ctl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>',
  atl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>',
};
import './library.js';
import './opendossard.js';
import './coach-ai.js';


// ========= DATA LOADER (data.js via window.DASHBOARD_DATA) =========
// Sorti dans js/data-loader.js.
import { loadData } from './data-loader.js';

// ========= UTIL : format durée =========
// < 60 min → "X min" ; sinon "XhYY". Utilisé partout pour homogénéiser l'affichage.
function fmtDur(min) {
  min = Math.round(Number(min) || 0);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  const m = (min % 60).toString().padStart(2, '0');
  return h + 'h' + m;
}
window.fmtDur = fmtDur;

// Priorité de compétition : Principal (doré) / Secondaire (argenté).
// Compat : anciennes valeurs 'A' → principal, 'B'/'C' → secondaire.
function compPrio(priority) {
  const isPrincipal = (priority === 'A' || priority === 'principal' || priority == null || priority === '');
  return isPrincipal
    ? { key: 'principal', label: 'Objectif', color: '#fbbf24' }
    : { key: 'secondaire', label: 'Préparation', color: '#9ca3af' };
}
function trophySvg(color, size = 15) {
  return `<svg class="comp-trophy" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`;
}
window.compPrio = compPrio;
window.trophySvg = trophySvg;

// Petit canapé dessiné pour les jours de repos.
const REST_COUCH_SVG = `<svg class="rest-couch" viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round"><path d="M14 24 V12 C14 9.2 15.6 8 18 8 H30.5 C31.5 8 32 8.6 32 9.6 V24"/><path d="M50 24 V12 C50 9.2 48.4 8 46 8 H33.5 C32.5 8 32 8.6 32 9.6 V24"/><path d="M13 24 H31 C31.6 24 32 24.5 32 25.2 V31 H10 V27 C10 25.3 11.3 24 13 24 Z"/><path d="M51 24 H33 C32.4 24 32 24.5 32 25.2 V31 H54 V27 C54 25.3 52.7 24 51 24 Z"/><path d="M9 31 H55 V35 H9 Z"/><path d="M13 35 V40"/><path d="M51 35 V40"/></svg>`;

// ========= CALQUE D'OVERRIDES D'ACTIVITÉ =========
// Les activités viennent de Strava (réécrites à chaque synchro). On stocke ici
// les modifications manuelles (nom/type/sport/durée/distance/TSS/notes) et les
// masquages de métriques (puissance/cardio/distance), réappliqués après synchro.
const ACT_EDIT_KEY = 'coach_ia_activity_edits_v1';
function loadActivityEdits() {
  try { return JSON.parse(localStorage.getItem(ACT_EDIT_KEY) || '{}'); } catch { return {}; }
}
function getActivityEdit(id) { return loadActivityEdits()[String(id)] || null; }
function setActivityEdit(id, ov) {
  const map = loadActivityEdits();
  if (ov && Object.keys(ov).length) map[String(id)] = ov; else delete map[String(id)];
  localStorage.setItem(ACT_EDIT_KEY, JSON.stringify(map));
  if (window.cloudSync) {
    if (map[String(id)] && window.cloudSync.pushActivityEdit) window.cloudSync.pushActivityEdit(String(id), map[String(id)]);
    else if (window.cloudSync.deleteActivityEdit) window.cloudSync.deleteActivityEdit(String(id));
  }
  if (window.__applyOverridesAndRerender) window.__applyOverridesAndRerender();
}
window.activityEdits = { get: getActivityEdit, set: setActivityEdit, load: loadActivityEdits };

// Applique les overrides sur une liste de jours (mutation), recalcule les totaux
// jour + le PMC (CTL/ATL/TSB) si au moins un TSS a été modifié.
function applyActivityEditsToDays(days) {
  const overrides = loadActivityEdits();
  if (!days || !days.length) return days;
  let anyTss = false;
  for (const d of days) {
    if (!d.activities || !d.activities.length) {
      // Jour SANS activité : daily_metrics peut garder un TSS/durée obsolète
      // (activité supprimée ou re-datée sans recalcul serveur → « TSS fantôme »
      // qui fait monter la courbe + point cliquable sur un jour de repos).
      // Source unique = les activités : un jour sans activité est un jour à zéro.
      if ((d.tss || 0) !== 0 || (d.duration || 0) !== 0) {
        d.tss = 0; d.duration = 0;
        d.sessionName = null; d.sessionType = null;
        d.np = 0; d.avgW = 0; d.hr = 0; d.ftpPct = 0;
      }
      continue;
    }
    // Activites Strava masquees (poubelle "masquer") : on les retire completement
    // -> elles disparaissent de l'affichage ET des stats/charge (TSS + CTL/ATL recalcules sans elles).
    d.activities = d.activities.filter(a => {
      const ovh = overrides[String(a.id)];
      return !(ovh && ovh.hidden);
    });
    for (const a of d.activities) {
      const ov = overrides[String(a.id)];
      if (!ov) continue;
      if (ov.name != null) a.name = ov.name;
      if (ov.type != null) { a.type = ov.type; a.sessionType = ov.type; }
      if (ov.sport != null) { a.sport = ov.sport; a.raw_type = ov.sport; }
      if (ov.duration != null) a.duration = ov.duration;
      if (ov.distance_km != null) a.distance_km = ov.distance_km;
      if (ov.tss != null) { a.tss = ov.tss; anyTss = true; }
      if (ov.elevation_gain != null) a.elevation_gain = ov.elevation_gain;
      if (ov.rpe != null) a.rpe = ov.rpe;
      if (ov.laps != null) a.laps = ov.laps;
      if (ov.notes != null) a.notes = ov.notes;
      // Exclusion des records/stats : la donnée RESTE sur l'activité, on pose juste
      // des drapeaux pour que le power profile / les stats l'ignorent.
      a._exclPower = !!ov.excludePower;
      a._exclHr = !!ov.excludeHr;
      a._exclDistance = !!ov.excludeDistance;
    }
    d.activities.sort((x, y) => (y.tss || 0) - (x.tss || 0));
    d.tss = d.activities.reduce((s, a) => s + (a.tss || 0), 0);
    d.duration = d.activities.reduce((s, a) => s + (a.duration || 0), 0);
    const main = d.activities[0];
    if (main) {
      d.sessionName = main.name; d.sessionType = main.type; d.sport = main.sport;
      d.np = main.np || 0; d.avgW = main.avg_watts || 0; d.hr = main.hr || 0; d.ftpPct = main.ftpPct || 0;
    } else {
      // Plus aucune activite (toutes masquees) : on vide le resume du jour.
      d.sessionName = ''; d.sessionType = null;
      d.np = 0; d.avgW = 0; d.hr = 0; d.ftpPct = 0;
    }
  }
  // Recalcul PMC depuis les TSS (toujours), ancré sur le 1er jour — reflète les
  // activités manuelles / TSS modifiés. (anyTss conservé pour lisibilité.)
  void anyTss;
  if (days.length) {
    let ctl = days[0].ctl || 0, atl = days[0].atl || 0;
    for (let i = 1; i < days.length; i++) {
      const prevCtl = ctl, prevAtl = atl;
      const tss = days[i].tss || 0;
      ctl = prevCtl + (tss - prevCtl) / 42;
      atl = prevAtl + (tss - prevAtl) / 7;
      days[i].ctl = +ctl.toFixed(1);
      days[i].atl = +atl.toFixed(1);
      days[i].tsb = +(prevCtl - prevAtl).toFixed(1);
    }
  }
  return days;
}

// ========= MAIN (IIFE async) =========
(async () => {
let _allData = await loadData();
let data = _allData;
let todayData = _allData[_allData.length - 1];
// today = vraie date du jour (système), à minuit local. Réassignable pour refresh à minuit.
function getRealToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
let today = getRealToday();
// Filtre sports actif (Set : 'tout' OU sous-ensemble de cyclisme/course/musculation)
const activeSports = new Set(['tout']);
// Exposé pour les modules externes (bilan.js etc.) qui doivent respecter le filtre.
window.activeSports = activeSports;

// Programmation du refresh automatique à minuit
function scheduleMidnightRefresh() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 5, 0); // 5 secondes après minuit pour éviter les edge-cases
  const msUntilMidnight = nextMidnight - now;
  setTimeout(() => {
    today = getRealToday();
    // Refresh des vues qui dépendent de "today"
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof renderCompList === 'function') renderCompList();
    // Met à jour le timestamp affiché en header si présent
    const tsEl = document.getElementById('header-date');
    if (tsEl) tsEl.textContent = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    // Reprogramme pour la prochaine minuit
    scheduleMidnightRefresh();
  }, msUntilMidnight);
}
scheduleMidnightRefresh();

// Re-render des vues qui dépendent du mode IA/Manuel quand on bascule le toggle.
// L'event 'appModeChange' est dispatché par js/app-mode.js à chaque applyAppMode().
window.addEventListener('appModeChange', (e) => {
  if (typeof renderCalendar === 'function') renderCalendar();
  // La projection de la courbe de charge filtre les prévus par mode IA/Manuel
  if (window.refreshLoadChart) window.refreshLoadChart();
  // L'onglet IA (p7) n'existe qu'en mode IA : si on repasse en Manuel dessus, on rebascule au tableau de bord.
  const mode = e && e.detail && e.detail.mode;
  if (mode === 'manual') {
    const p7 = document.getElementById('p7');
    if (p7 && p7.classList.contains('active') && typeof activatePanel === 'function') activatePanel('p1', true);
  }
});

// Filtre planif selon le mode : Manuel => éléments non-IA ; IA => éléments IA.
// (les activités RÉALISÉES ne passent jamais par ce filtre — toujours visibles)
window.coachModeKeep = function (ia) {
  return (window.APP_MODE === 'ia') ? (ia === true) : (ia !== true);
};

// Re-render complet quand le data loader Supabase remplace window.DASHBOARD_DATA
// (après login + chargement depuis BDD)
// Reconstruit _allData depuis window.DASHBOARD_DATA (clone profond des activités
// pour ne pas muter la source), applique le calque d'overrides, puis re-render.
function rebuildFromDashboard() {
  if (!window.DASHBOARD_DATA || !window.DASHBOARD_DATA.days) return;
  _allData = window.DASHBOARD_DATA.days.map(d => ({
    ...d,
    date: new Date(d.date + 'T12:00:00'),
    activities: (d.activities || []).map(a => ({ ...a })),
  }));
  applyActivityEditsToDays(_allData);
  data = _allData;
  todayData = _allData[_allData.length - 1];
  if (typeof renderHeroKpi === 'function') renderHeroKpi();
  if (typeof rerenderFilteredCharts === 'function') rerenderFilteredCharts();
  if (typeof renderCalendar === 'function') renderCalendar();
  const f = getInputDate('load-from'), t = getInputDate('load-to');
  if (f && t && typeof renderLoadChart === 'function') renderLoadChart(f, t);
}
window.__applyOverridesAndRerender = rebuildFromDashboard;

window.addEventListener('dashboardDataReplaced', () => {
  try {
    rebuildFromDashboard();
    console.log('[main] Vues re-rendues avec données Supabase');
  } catch (e) {
    console.error('[main] Erreur re-render après load Supabase:', e);
  }
});

// Sécurité : si la machine sort de veille / change de timezone, re-vérifier au focus
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const real = getRealToday();
    if (real.getTime() !== today.getTime()) {
      today = real;
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderCompList === 'function') renderCompList();
    }
  }
});

// ========= DATA GENERATION (fallback simulé, code mort) =========
// Sorti dans js/data-generation.js. Importer { generateData } depuis là si besoin.

// ========= HERO KPI =========
{
  const _dateEl = document.getElementById('today-date');
  if (_dateEl) _dateEl.textContent = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// HTML d'origine de la carte Whoop (mode "Récupération"), capturé avant tout swap ACWR.
let _whoopCardOriginal = null;

// Carte ACWR (Acute:Chronic Workload Ratio) affichée à la place de la carte Whoop
// quand Whoop n'est pas connecté. ACWR ≈ charge aiguë (ATL) / charge chronique (CTL),
// cohérent avec les CTL/ATL affichés dans la carte Forme (TSB).
function renderAcwrCard() {
  const card = document.getElementById('whoop-card');
  if (!card) return;
  const ctl = todayData.ctl || 0;
  const atl = todayData.atl || 0;
  const acwr = ctl > 0 ? atl / ctl : 0;
  let color, state;
  // État ACWR : label court + détail dans .state-detail (masqué sur mobile via CSS)
  if (ctl <= 0) { color = 'var(--text-mute)'; state = 'Pas assez de données'; }
  else if (acwr < 0.8) { color = 'var(--warn)'; state = 'Sous-charge <span class="state-detail">· désentraînement</span>'; }
  else if (acwr <= 1.3) { color = 'var(--accent)'; state = 'Zone optimale'; }
  else if (acwr <= 1.5) { color = 'var(--warn)'; state = 'Charge élevée <span class="state-detail">· vigilance</span>'; }
  else { color = 'var(--danger)'; state = 'Risque de blessure'; }
  const ringDash = 213.6;
  const frac = Math.max(0, Math.min(1, acwr / 2)); // 2.0 = anneau plein
  const off = ctl > 0 ? ringDash * (1 - frac) : ringDash;
  card.dataset.mode = 'acwr';
  // Spans .label-detail (suffixe "ACWR") + .acwr-detail (libellés longs)
  // sont masqués sur mobile via mobile-home.css pour un rendu épuré.
  // Pour mobile : on remplace le donut SVG par une barre horizontale qui se
  // remplit en proportion du frac (0..1, où 1.0 = ACWR = 2.0).
  // CSS détecte ce layout via .ratio-bar et masque le SVG sur mobile.
  const pct = Math.round(frac * 100);
  card.innerHTML = `
    <div class="kpi-label">Ratio de charge<span class="label-detail"> (ACWR)</span></div>
    <div class="ring-container">
      <div class="ring">
        <div class="ratio-bar">
          <div class="ratio-bar-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <svg width="80" height="80"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" stroke-width="8"/><circle cx="40" cy="40" r="34" fill="none" stroke="${color}" stroke-width="8" stroke-dasharray="${ringDash}" stroke-dashoffset="${off}" stroke-linecap="round"/></svg>
        <div class="ring-text">${ctl > 0 ? acwr.toFixed(2) : '—'}</div>
      </div>
      <div>
        <div style="font-size:12.5px;font-weight:600;color:${color};margin-bottom:8px;">${state}</div>
        <div class="acwr-detail" style="font-size:11px;color:var(--text-dim);">Charge aiguë 7j</div>
        <div class="acwr-detail" style="font-size:17px;font-weight:600;">${atl.toFixed(0)}<span style="font-size:11px;font-weight:500;color:var(--text-dim);"> /j</span></div>
        <div class="acwr-detail" style="font-size:11px;color:var(--text-dim);margin-top:4px;">Charge chronique 42j</div>
        <div class="acwr-detail" style="font-size:13px;">${ctl.toFixed(0)}<span style="font-size:11px;color:var(--text-dim);"> /j</span></div>
        <div class="acwr-compact" hidden>7j <b style="color:var(--text);">${atl.toFixed(0)}</b> · 42j <b style="color:var(--text);">${ctl.toFixed(0)}</b></div>
      </div>
    </div>`;
}

function renderHeroKpi() {
// Capture le HTML d'origine de la carte Whoop (mode récupération) avant tout swap ACWR.
if (_whoopCardOriginal === null) {
  const _wc = document.getElementById('whoop-card');
  if (_wc) _whoopCardOriginal = _wc.innerHTML;
}
const noWhoop = !!window.__noWhoopCard;
if (noWhoop) {
  renderAcwrCard();
} else {
  // Restaure la carte Récupération si elle était passée en mode ACWR.
  const _wc = document.getElementById('whoop-card');
  if (_wc && _wc.dataset.mode === 'acwr' && _whoopCardOriginal !== null) {
    _wc.innerHTML = _whoopCardOriginal;
    _wc.removeAttribute('data-mode');
  }
  const hasRecovery = todayData.recovery != null;
  document.getElementById('recovery-val').textContent = hasRecovery ? todayData.recovery + '%' : '—';
  const ringDash = 213.6;
  if (hasRecovery) {
    document.getElementById('recovery-ring').style.strokeDashoffset = ringDash * (1 - todayData.recovery / 100);
    const recColor = todayData.recovery > 66 ? 'var(--accent)' : todayData.recovery > 33 ? 'var(--warn)' : 'var(--danger)';
    document.getElementById('recovery-ring').style.stroke = recColor;
  } else {
    document.getElementById('recovery-ring').style.strokeDashoffset = ringDash;
    document.getElementById('recovery-ring').style.stroke = 'var(--text-mute)';
  }
  document.getElementById('hrv-val').textContent = todayData.hrv != null ? todayData.hrv + ' ms' : '— ms';
  document.getElementById('sleep-val').textContent = todayData.sleepH != null
    ? todayData.sleepH + ' h' + (todayData.sleepQ != null ? ' (qualité ' + todayData.sleepQ + '%)' : '')
    : '— h';
}

document.getElementById('tsb-val').textContent = (todayData.tsb >= 0 ? '+' : '') + todayData.tsb.toFixed(0);
// État TSB : on garde le label court en clair, le détail dans un span qu'on
// peut masquer en mobile via mobile-home.css (.state-detail { display: none }).
const tsbState = todayData.tsb > 5 ? 'Frais <span class="state-detail">· prêt à performer</span>'
               : todayData.tsb > -10 ? 'Optimal <span class="state-detail">· zone de progression</span>'
               : todayData.tsb > -25 ? 'Fatigué <span class="state-detail">· vigilance</span>'
               : 'Surchargé <span class="state-detail">· décharge recommandée</span>';
const tsbClass = todayData.tsb > 5 ? 'up' : todayData.tsb < -20 ? 'down' : '';
const tsbEl = document.getElementById('tsb-state');
tsbEl.innerHTML = tsbState;
tsbEl.className = 'kpi-trend ' + tsbClass;
document.getElementById('ctl-val').textContent = todayData.ctl.toFixed(0);
document.getElementById('atl-val').textContent = todayData.atl.toFixed(0);

const last7 = data.slice(-7);
const weeklyTSS = last7.reduce((s,d)=>s+d.tss,0);
const prev7 = data.slice(-14,-7);
const prevTSS = prev7.reduce((s,d)=>s+d.tss,0);
document.getElementById('weekly-tss').textContent = weeklyTSS;
// Sparkline 7 jours : injecté en CSS-only via spans dans la card Charge 7 jours.
// Visible uniquement sur mobile via mobile-home.css.
{
  const card = document.querySelector('.hero .card:has(#weekly-tss)') || document.getElementById('weekly-tss')?.closest('.card');
  if (card) {
    let spark = card.querySelector('.weekly-spark');
    if (!spark) {
      spark = document.createElement('div');
      spark.className = 'weekly-spark';
      card.appendChild(spark);
    }
    const maxT = Math.max(1, ...last7.map(d => d.tss || 0));
    spark.innerHTML = last7.map(d => {
      const h = Math.max(2, Math.round((d.tss || 0) / maxT * 100));
      return `<span style="height:${h}%;" title="${d.tss || 0} TSS"></span>`;
    }).join('');
  }
}
const trendEl = document.getElementById('weekly-trend');
// Si prevTSS = 0, on évite la division par zéro (qui donnait "+Infinity%")
// et on affiche un texte explicite à la place du pourcentage.
if (prevTSS <= 0) {
  trendEl.textContent = weeklyTSS > 0 ? 'Nouvelle activité cette semaine' : 'Pas d\'activité';
  trendEl.className = 'kpi-trend ' + (weeklyTSS > 0 ? 'up' : '');
} else {
  const trendPct = Math.round((weeklyTSS - prevTSS) / prevTSS * 100);
  trendEl.textContent = (trendPct > 0 ? '↑ +' : trendPct < 0 ? '↓ ' : '') + trendPct + '% vs semaine précédente';
  trendEl.className = 'kpi-trend ' + (trendPct > 5 ? 'up' : trendPct < -5 ? 'down' : '');
}
document.getElementById('weekly-sessions').textContent = last7.filter(d => d.tss > 0).length;
{
  const _wkMin = last7.reduce((s,d)=>s+(d.duration||0),0);
  document.getElementById('weekly-hours').textContent = _wkMin < 60 ? Math.round(_wkMin) + ' min' : (_wkMin/60).toFixed(1) + ' h';
}

// Dernière séance — bloc en haut à gauche du hero
// (on repère un jour avec activité réelle via sessionName, car le type a été retiré)
const lastSession = [...data].reverse().find(d => d.sessionName || (d.activities && d.activities.length > 0));
const dateEl = document.getElementById('last-session-date');
const nameEl = document.getElementById('last-session-name');
const metricsEl = document.getElementById('last-session-metrics');
const lsCardEl = document.getElementById('last-session-card');
if (!lastSession) {
  dateEl.textContent = '';
  nameEl.innerHTML = '<span class="ls-empty">Aucune séance dans la période</span>';
  metricsEl.innerHTML = '';
  if (lsCardEl) { lsCardEl.style.cursor = ''; lsCardEl.onclick = null; lsCardEl.title = ''; }
} else {
  // Clic → va à la semaine de la séance dans le calendrier + ouvre l'activité.
  if (lsCardEl) {
    lsCardEl.style.cursor = 'pointer';
    lsCardEl.title = 'Voir cette séance dans le calendrier';
    lsCardEl.onclick = () => {
      if (typeof goToCalendarDay === 'function') goToCalendarDay(toIsoDate(lastSession.date));
    };
  }
  const daysSince = Math.round((today - lastSession.date) / 86400000);
  const dateStr = daysSince === 0 ? "Aujourd'hui"
                : daysSince === 1 ? "Hier"
                : `Il y a ${daysSince} jours`;
  dateEl.textContent = `${dateStr} · ${lastSession.date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  nameEl.textContent = lastSession.sessionName || 'Séance';

  const dur = lastSession.duration || 0;
  const metrics = [];
  if (lastSession.tss) metrics.push(`<div class="ls-metric"><div class="ls-val">${lastSession.tss}</div><div class="ls-lbl">TSS</div></div>`);
  if (dur) metrics.push(`<div class="ls-metric"><div class="ls-val">${fmtDur(dur)}</div><div class="ls-lbl">Durée</div></div>`);
  if (lastSession.np) metrics.push(`<div class="ls-metric"><div class="ls-val">${lastSession.np}<span style="font-size:13px;font-weight:500;">W</span></div><div class="ls-lbl">NP</div></div>`);
  if (lastSession.hr) metrics.push(`<div class="ls-metric"><div class="ls-val">${lastSession.hr}<span style="font-size:13px;font-weight:500;">bpm</span></div><div class="ls-lbl">FC moy</div></div>`);
  metricsEl.innerHTML = metrics.join('');
}
}
window.renderHeroKpi = renderHeroKpi;
renderHeroKpi();

// ========= CHART DEFAULTS =========
Chart.defaults.color = '#8b94a8';
Chart.defaults.borderColor = '#232a3a';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
// Tooltips : ronds pleins au lieu de carrés pour les indicateurs de série
Chart.defaults.plugins.tooltip.usePointStyle = true;
Chart.defaults.plugins.tooltip.boxPadding = 6;

// ========= PLUGIN : LIGNE VERTICALE AU HOVER =========
Chart.register({
  id: 'verticalHoverLine',
  afterDraw: (chart) => {
    if (chart.config.options?.plugins?.verticalHoverLine === false) return;
    if (!chart.tooltip || !chart.tooltip._active || chart.tooltip._active.length === 0) return;
    const ctx = chart.ctx;
    const x = chart.tooltip._active[0].element.x;
    const topY = chart.chartArea.top;
    const bottomY = chart.chartArea.bottom;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, bottomY);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(139, 148, 168, 0.5)';
    ctx.stroke();
    ctx.restore();
  }
});
// Forcer le remplissage avec la couleur de la courbe / barre (sinon intérieur transparent / "blanc")
Chart.defaults.plugins.tooltip.callbacks = Chart.defaults.plugins.tooltip.callbacks || {};
Chart.defaults.plugins.tooltip.callbacks.labelColor = function(context) {
  // Priorité : couleur spécifique de la barre survolée si backgroundColor est un array,
  // sinon borderColor de la courbe, sinon backgroundColor unique.
  const ds = context.dataset;
  let color;
  if (Array.isArray(ds.backgroundColor)) {
    color = ds.backgroundColor[context.dataIndex];
  } else {
    color = ds.borderColor || ds.backgroundColor || '#888';
  }
  return {
    borderColor: color,
    backgroundColor: color,
    borderWidth: 0,
    borderRadius: 0
  };
};

const labels = data.map(d => fmtDate(d.date));

// ========= FILTRE SPORTS =========
function getSportFromDay(d) {
  // Prefer d.sport (nouveau format), fallback sur d.sessionType (ancien data.js)
  if (d.sport) return d.sport;
  if (!d.sessionType) return null;
  if (d.sessionType === 'force') return 'musculation';
  if (d.sessionType === 'mobilite') return 'mobilite';
  if (d.sessionType === 'natation') return 'natation';
  return 'cyclisme'; // par défaut, sessions cycling-like
}

// Helper : convertit un sport (catégorie minuscule OU format Strava 'Ride'/'Run'/...)
// en catégorie de filtre ('cyclisme'/'course'/'musculation'/'natation'/'autre').
// Utilisé partout où on doit comparer un sport à activeSports.
function getSportCategory(sport) {
  if (!sport) return 'cyclisme'; // par défaut (templates AI sans sport = cyclisme)
  const s = String(sport);
  const lower = s.toLowerCase();
  if (['cyclisme', 'course', 'musculation', 'natation', 'triathlon', 'autre', 'mobilite'].includes(lower)) return lower;
  const entry = window.SPORTS_CATALOG && window.SPORTS_CATALOG[s];
  return entry ? entry.category : 'autre';
}
window.getSportCategory = getSportCategory;

function applySportFilter() {
  // Reset des index activité par jour (les arrays changent selon le filtre)
  Object.keys(dayActivityIndex).forEach(k => delete dayActivityIndex[k]);

  if (activeSports.has('tout') || activeSports.size === 0) {
    data = _allData;
  } else {
    // 1. Construire la vue filtrée : filtre par ACTIVITÉ (granularité fine)
    const filtered = _allData.map(d => {
      // Pas d'activités du tout → jour de repos, on garde
      if (!d.activities || d.activities.length === 0) {
        // Fallback : si pas d'array activities mais sessionType présent, utiliser sport racine
        if (d.sessionType) {
          const sport = getSportFromDay(d);
          if (sport && !activeSports.has(sport)) {
            return {
              ...d,
              tss: 0, duration: 0, zones: null, zones_hr: null, zones_power: null,
              sessionType: null, sessionName: null,
              np: 0, avgW: 0, hr: 0, ftpPct: 0, compliance: null, intensity: 0,
              activities: []
            };
          }
        }
        return { ...d };
      }

      // Filtrer les activités qui matchent les sports actifs
      const matchingActs = d.activities.filter(a => activeSports.has(a.sport));

      if (matchingActs.length === 0) {
        // Aucune activité ne correspond → jour vidé
        return {
          ...d,
          tss: 0, duration: 0, zones: null, zones_hr: null, zones_power: null,
          sessionType: null, sessionName: null,
          np: 0, avgW: 0, hr: 0, ftpPct: 0, compliance: null, intensity: 0,
          activities: []
        };
      }

      // Au moins une activité matche : recomposer le jour avec les activités filtrées
      const main = matchingActs[0]; // déjà triées par TSS desc côté Python
      const totalTss = matchingActs.reduce((s, a) => s + (a.tss || 0), 0);
      const totalDur = matchingActs.reduce((s, a) => s + (a.duration || 0), 0);

      return {
        ...d,
        tss: totalTss,
        duration: totalDur,
        sessionName: main.name,
        sessionType: main.type,
        sport: main.sport,
        np: main.np || 0,
        hr: main.hr || 0,
        ftpPct: main.ftpPct || 0,
        zones: main.zones_hr || main.zones_power || null,
        zones_hr: main.zones_hr || null,
        zones_power: main.zones_power || null,
        activities: matchingActs
      };
    });

    // 2. Recalculer CTL/ATL/TSB sur les TSS filtrés (EWMA : 42j pour CTL, 7j pour ATL)
    let ctl = 0, atl = 0;
    filtered.forEach(d => {
      const t = d.tss || 0;
      ctl = ctl + (t - ctl) / 42;
      atl = atl + (t - atl) / 7;
      d.ctl = +ctl.toFixed(1);
      d.atl = +atl.toFixed(1);
      d.tsb = +(ctl - atl).toFixed(1);
    });

    data = filtered;
  }
  // Mettre à jour todayData (pointe sur le dernier jour de la vue filtrée)
  todayData = data[data.length - 1];
  rerenderFilteredCharts();
}

function rerenderFilteredCharts() {
  if (typeof renderHeroKpi === 'function') renderHeroKpi();
  if (typeof renderLoadChart === 'function') renderLoadChart(getInputDate('load-from'), getInputDate('load-to'));
  if (typeof renderHoursChart === 'function') renderHoursChart(getInputDate('hours-from'), getInputDate('hours-to'));
  if (typeof renderWeeklyChart === 'function') renderWeeklyChart(getInputDate('weekly-from'), getInputDate('weekly-to'));
  if (typeof renderZones === 'function') renderZones(getInputDate('zones-from'), getInputDate('zones-to'));
  if (typeof renderSessionsTable === 'function') renderSessionsTable();
  if (typeof renderCalendar === 'function') renderCalendar();
  // Page Bilan : KPIs annuels, records, chart cumul → filtrés par sport actif
  if (typeof window.renderBilan === 'function') window.renderBilan();
  // Graphe Power Profile : suit aussi le sport actif (records par sport)
  if (typeof window.renderPowerProfile === 'function') window.renderPowerProfile();
}

// ========= HELPERS DATE RANGE =========
// Important : utiliser les composantes LOCALES (pas UTC) pour éviter
// le décalage de fuseau horaire (ex: minuit local CEST → veille UTC).
const toIsoDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fmtShortDate = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
function sliceByDate(arr, fromIso, toIso) {
  return arr.filter(d => {
    const iso = toIsoDate(d.date);
    return iso >= fromIso && iso <= toIso;
  });
}
function setInputDate(id, d) {
  const el = document.getElementById(id);
  el.value = toIsoDate(d);
  syncCompactDateLabel(el);
  // Si flatpickr est attaché à cet input (cas mobile), on synchronise aussi
  // sa valeur visible (sinon l'altInput continue d'afficher "Sélectionner une date")
  if (el._flatpickr) {
    try { el._flatpickr.setDate(d, false); } catch (_) {}
  }
}
// Met à jour l'overlay .date-compact-display (format DD/MM) depuis la value
// d'un <input type="date">. Appelé par setInputDate + sur l'event 'change' du
// picker natif (utilisateur qui choisit lui-même une date).
function syncCompactDateLabel(input) {
  const wrap = input.closest && input.closest('.date-compact');
  if (!wrap) return;
  const span = wrap.querySelector('.date-compact-display');
  if (!span) return;
  const v = input.value;
  if (!v) { span.textContent = ''; return; }
  const [, m, d] = v.split('-');
  span.textContent = `${d}/${m}`;
}
// Auto-sync au change : couvre le cas où l'utilisateur ouvre le picker natif
document.addEventListener('change', (e) => {
  if (e.target && e.target.matches && e.target.matches('.date-compact input[type="date"]')) {
    syncCompactDateLabel(e.target);
  }
});
function getInputDate(id) {
  return document.getElementById(id).value;
}

// ========= CHART 1: CTL/ATL/TSB + Recovery (filtrable par dates) =========
const loadChart = new Chart(document.getElementById('chart-load'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'CTL', data: [], borderColor: '#60a5fa', backgroundColor: (c) => { const ch = c.chart, a = ch.chartArea; if (!a) return 'rgba(96,165,250,0.12)'; const g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, 'rgba(96,165,250,0.30)'); g.addColorStop(1, 'rgba(96,165,250,0.02)'); return g; }, borderWidth: 2.5, cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#60a5fa', fill: 'origin', order: 3, yAxisID: 'y' },
      { label: 'ATL', data: [], borderColor: '#fbbf24', backgroundColor: 'transparent', borderWidth: 2, cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#fbbf24', fill: false, order: 2, yAxisID: 'y' },
      { label: 'TSB', data: [], borderColor: '#a78bfa', borderWidth: 2, cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#a78bfa', fill: { target: { value: 0 }, above: 'rgba(167,139,250,0.22)', below: 'rgba(83,74,183,0.30)' }, order: 1, yAxisID: 'y' },
      // Projection (séances prévues) : mêmes couleurs, atténuées + pointillés
      { label: 'CTL prévu', data: [], borderColor: 'rgba(96,165,250,0.55)', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 5], cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#60a5fa', fill: false, order: 3, yAxisID: 'y', spanGaps: false },
      { label: 'ATL prévu', data: [], borderColor: 'rgba(251,191,36,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [6, 5], cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#fbbf24', fill: false, order: 2, yAxisID: 'y', spanGaps: false },
      { label: 'TSB prévu', data: [], borderColor: 'rgba(167,139,250,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [6, 5], cubicInterpolationMode: 'monotone', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 0, pointHoverBackgroundColor: '#a78bfa', fill: false, order: 1, yAxisID: 'y', spanGaps: false }
    ]
  },
  plugins: [{
    // Séparateur vertical « Aujourd'hui » quand la projection est affichée
    id: 'todayLine',
    afterDatasetsDraw(chart) {
      const rc = chart._realCount;
      if (!rc || rc >= chart.data.labels.length) return;
      const x = chart.scales.x.getPixelForValue(rc - 1);
      if (!isFinite(x)) return;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#6b7488';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText("Aujourd'hui", x + 5, top + 11);
      ctx.restore();
    }
  }],
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    onClick: (evt) => {
      // N'ouvre le calendrier QUE si on clique réellement sur un rond d'activité
      // (les jours sans activité ont un point de rayon 0 → non cliquables).
      const els = loadChart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
      if (!els || !els.length) return;
      const d = loadChart._subset && loadChart._subset[els[0].index];
      if (!d) return;
      // Jour projeté : ouvre le calendrier côté Prévu sur ce jour
      if (d._proj) {
        if (d.planned && d.planned.length && typeof goToCalendarDay === 'function') goToCalendarDay(toIsoDate(d.date), 'prevu');
        return;
      }
      if (!dayHasActivity(d)) return;
      if (typeof goToCalendarDay === 'function') goToCalendarDay(toIsoDate(d.date));
    },
    onHover: (evt) => {
      const el = evt.native && evt.native.target;
      if (!el) return;
      const hit = loadChart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
      el.style.cursor = (hit && hit.length) ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        // Au point de jonction (dernier jour réel), les datasets projetés dupliquent
        // la valeur réelle pour la continuité du trait : on masque ces doublons.
        filter: (item) => !(item.datasetIndex >= 3 && loadChart._realCount && item.dataIndex === loadChart._realCount - 1),
        callbacks: {
          // Ajoute le(s) nom(s) de sortie + durée/km sous les valeurs CTL/ATL/TSB.
          afterBody: (items) => {
            if (!items || !items.length) return '';
            const d = loadChart._subset && loadChart._subset[items[0].dataIndex];
            if (!d) return '';
            // Jour projeté : liste les séances prévues du jour
            if (d._proj) {
              const pl = d.planned || [];
              if (!pl.length) return '';
              return pl.map(p => {
                const dur = p.duration ? fmtDur(p.duration) : '';
                const meta = [dur, p.tss ? Math.round(p.tss) + ' TSS' : ''].filter(Boolean).join(' · ');
                return `• ${p.isRace ? '🏁 ' : ''}${p.name} (prévu)${meta ? ' — ' + meta : ''}`;
              });
            }
            const acts = (d.activities && d.activities.length) ? d.activities : (d.sessionType ? [d] : []);
            if (!acts.length) return '';
            return acts.map(a => {
              const name = a.name || a.sessionName || 'Séance';
              const dur = a.duration ? fmtDur(a.duration) : '';
              const km = a.distance_km ? Math.round(a.distance_km) + ' km' : '';
              const meta = [dur, km].filter(Boolean).join(' · ');
              return meta ? `• ${name} — ${meta}` : `• ${name}`;
            });
          }
        }
      },
      // Sélection à la souris (drag) → met à jour la plage de dates.
      zoom: {
        zoom: {
          drag: { enabled: true, backgroundColor: 'rgba(74,222,128,0.12)', borderColor: 'rgba(74,222,128,0.55)', borderWidth: 1 },
          mode: 'x',
          onZoomComplete: ({ chart }) => { applyLoadChartDragSelection(chart); },
        }
      }
    },
    scales: {
      x: {
        // Mobile : moins de ticks (4) + police plus petite ; desktop : 8 ticks normaux.
        ticks: {
          maxTicksLimit: window.innerWidth < 860 ? 4 : 8,
          color: '#6b7488',
          font: { size: window.innerWidth < 860 ? 9 : 11 },
          maxRotation: 0,
        },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        position: 'left',
        title: {
          display: window.innerWidth >= 860,  // pas de titre "TSS / TSB" sur mobile (gain de place)
          text: 'TSS / TSB',
          color: '#6b7488',
        },
        ticks: {
          color: '#6b7488',
          stepSize: 20,
          font: { size: window.innerWidth < 860 ? 9 : 11 },
        },
        grid: { color: 'rgba(255,255,255,0.045)', drawBorder: false },
        border: { display: false },
      },
    }
  }
});

// Drag souris sur le graphe → convertit la sélection en plage de dates + re-render.
let _loadDragBusy = false;
function applyLoadChartDragSelection(chart) {
  if (_loadDragBusy) return;
  const sub = loadChart._subset || [];
  if (!sub.length) { try { chart.resetZoom(); } catch (_) {} return; }
  const x = chart.scales.x;
  let i0 = Math.round(x.min), i1 = Math.round(x.max);
  i0 = Math.max(0, Math.min(sub.length - 1, i0));
  i1 = Math.max(0, Math.min(sub.length - 1, i1));
  _loadDragBusy = true;
  try { chart.resetZoom(); } catch (_) {}
  if (i1 - i0 >= 1) {
    // Si la sélection démarre dans la zone projetée, on recule le début au dernier
    // jour réel : la projection a besoin de son point d'ancrage (sinon graphe vide).
    if (sub[i0] && sub[i0]._proj) {
      while (i0 > 0 && sub[i0]._proj) i0--;
    }
    const from = toIsoDate(sub[i0].date);
    const to = toIsoDate(sub[i1].date);
    setInputDate('load-from', new Date(from + 'T12:00:00'));
    setInputDate('load-to', new Date(to + 'T12:00:00'));
    document.querySelectorAll('#load-range .preset').forEach(b => b.classList.remove('active'));
    renderLoadChart(from, to);
  }
  setTimeout(() => { _loadDragBusy = false; }, 60);
}

function dayHasActivity(d) {
  return !!((d.activities && d.activities.length) || d.sessionType || (d.duration > 0));
}

// ===== Projection du prévu (CTL/ATL/TSB futurs depuis les séances planifiées) =====
// Séances prévues d'un jour futur : entraînements (filtrés par mode IA/Manuel)
// + compétitions non réalisées (TSS estimé = minutes cibles, fallback 120 min — même règle que le calendrier).
function plannedItemsForDay(iso) {
  const items = [];
  try {
    const tr = ((typeof loadTrainings === 'function') ? loadTrainings() : [])
      .filter(t => !window.coachModeKeep || window.coachModeKeep(t.ia))
      .filter(t => t.date === iso);
    for (const t of tr) items.push({ name: t.name || 'Séance prévue', tss: +t.tss || 0, duration: +t.duration || 0, sport: t.sport || 'Ride' });
  } catch (_) {}
  try {
    const comps = (typeof loadCompetitionsExpanded === 'function') ? loadCompetitionsExpanded() : [];
    for (const c of comps) {
      if (!c.dateObj || toIsoDate(c.dateObj) !== iso) continue;
      if (typeof compIsRealised === 'function' && compIsRealised(c)) continue;
      const mins = (typeof parseTimeToMin === 'function') ? parseTimeToMin(c.target) : null;
      items.push({ name: c.name || 'Compétition', tss: Math.round(mins || 120), duration: mins || 0, isRace: true, sport: c.sport || 'Ride' });
    }
  } catch (_) {}
  // Filtre sport actif : même règle que le calendrier (cohérent avec la courbe réelle filtrée)
  if (typeof activeSports !== 'undefined' && !activeSports.has('tout') && activeSports.size > 0 && typeof getSportCategory === 'function') {
    return items.filter(it => activeSports.has(getSportCategory(it.sport)));
  }
  return items;
}

// Jours projetés après le dernier jour réel, jusqu'à endIso inclus.
// Mêmes constantes PMC que le réel (CTL 42 j / ATL 7 j), TSB = forme avant la séance du jour.
function buildProjection(lastRealDay, endIso) {
  const out = [];
  if (!lastRealDay) return out;
  let ctl = +lastRealDay.ctl || 0, atl = +lastRealDay.atl || 0;
  const d = new Date(lastRealDay.date);
  d.setHours(12, 0, 0, 0);
  for (let guard = 0; guard < 120; guard++) {
    d.setDate(d.getDate() + 1);
    const iso = toIsoDate(d);
    if (iso > endIso) break;
    const items = plannedItemsForDay(iso);
    const tss = items.reduce((s, it) => s + (it.tss || 0), 0);
    const prevCtl = ctl, prevAtl = atl;
    ctl = prevCtl + (tss - prevCtl) / 42;
    atl = prevAtl + (tss - prevAtl) / 7;
    out.push({ date: new Date(d), ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(prevCtl - prevAtl).toFixed(1), tss, planned: items, _proj: true });
  }
  return out;
}

// Horizon de projection par défaut quand la plage s'arrête à aujourd'hui
const LOAD_PROJ_DAYS = 14;

function renderLoadChart(fromIso, toIso) {
  const subset = sliceByDate(data, fromIso, toIso);
  const todayIso = toIsoDate(today);
  const lastReal = data.length ? data[data.length - 1] : null;
  // Projection uniquement si la plage couvre aujourd'hui (dernier jour réel inclus)
  let proj = [];
  if (subset.length && lastReal && toIso >= todayIso && subset[subset.length - 1] === lastReal) {
    let endIso = toIso;
    if (toIso <= todayIso) {
      const e = new Date(today);
      e.setDate(e.getDate() + LOAD_PROJ_DAYS);
      endIso = toIsoDate(e);
    }
    proj = buildProjection(lastReal, endIso);
  }
  loadChart._subset = subset.concat(proj); // pour le tooltip + le clic
  loadChart._realCount = subset.length;    // pour le séparateur « Aujourd'hui » + filtre tooltip
  const projNulls = proj.map(() => null);
  loadChart.data.labels = subset.map(d => fmtDate(d.date)).concat(proj.map(d => fmtDate(d.date)));
  loadChart.data.datasets[0].data = subset.map(d => d.ctl).concat(projNulls);
  loadChart.data.datasets[1].data = subset.map(d => d.atl).concat(projNulls);
  loadChart.data.datasets[2].data = subset.map(d => d.tsb).concat(projNulls);
  // Datasets projetés : null sur le réel sauf le dernier jour (jonction), puis valeurs projetées
  const mkProj = (key) => {
    if (!proj.length) return [];
    const arr = new Array(subset.length - 1).fill(null);
    arr.push(subset[subset.length - 1][key]);
    return arr.concat(proj.map(p => p[key]));
  };
  loadChart.data.datasets[3].data = mkProj('ctl');
  loadChart.data.datasets[4].data = mkProj('atl');
  loadChart.data.datasets[5].data = mkProj('tsb');
  // Point sur la courbe de forme (CTL) uniquement les jours avec activité
  loadChart.data.datasets[0].pointRadius = subset.map(d => dayHasActivity(d) ? 3.5 : 0).concat(proj.map(() => 0));
  loadChart.data.datasets[0].pointHoverRadius = subset.map(d => dayHasActivity(d) ? 6 : 0).concat(proj.map(() => 0));
  loadChart.data.datasets[0].pointBackgroundColor = '#60a5fa';
  loadChart.data.datasets[0].pointBorderColor = '#0b0e14';
  loadChart.data.datasets[0].pointBorderWidth = 1.5;
  // Points creux sur la projection CTL les jours avec séance prévue (cliquables → calendrier Prévu)
  if (proj.length) {
    const pr = new Array(subset.length).fill(0).concat(proj.map(p => (p.planned && p.planned.length) ? 3 : 0));
    loadChart.data.datasets[3].pointRadius = pr;
    loadChart.data.datasets[3].pointHoverRadius = pr.map(r => (r ? 5.5 : 0));
    loadChart.data.datasets[3].pointBackgroundColor = '#0b0e14';
    loadChart.data.datasets[3].pointBorderColor = 'rgba(96,165,250,0.85)';
    loadChart.data.datasets[3].pointBorderWidth = 1.5;
  } else {
    loadChart.data.datasets[3].pointRadius = 0;
    loadChart.data.datasets[3].pointHoverRadius = 0;
  }
  loadChart.update();
}

// Refresh de la courbe de charge sur la plage courante (appelé quand les
// prévus/compétitions changent : ajout, modif, suppression, pull cloud, bascule IA/Manuel).
window.refreshLoadChart = function () {
  try { renderLoadChart(getInputDate('load-from'), getInputDate('load-to')); } catch (_) {}
};

// Navigue vers un jour précis dans le calendrier (mode Réalisé) et le met en évidence.
function goToCalendarDay(iso, mode) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return;
  calendarMode = (mode === 'prevu') ? 'prevu' : 'realise';
  document.querySelectorAll('#calendar-subtabs .subtab').forEach(b => b.classList.toggle('active', b.dataset.mode === calendarMode));
  // Vue "4 semaines" ancrée sur la semaine de l'activité (en haut), pas le mois.
  selectedMonth = null;
  calendarAnchorDate = d;
  if (window.__updateMonthOverlay) window.__updateMonthOverlay();
  if (window.location.hash !== '#calendrier') window.location.hash = '#calendrier';
  if (typeof renderCalendar === 'function') renderCalendar();
  setTimeout(() => {
    // Pas de scroll : la semaine de l'activité est déjà en haut du calendrier.
    const card = document.querySelector(`#week-calendar .day-card[data-iso="${iso}"]`);
    if (card) {
      card.classList.add('day-flash');
      setTimeout(() => card.classList.remove('day-flash'), 1500);
    }
    if (typeof openSessionModal === 'function') openSessionModal(iso, calendarMode);
  }, 300);
}
window.goToCalendarDay = goToCalendarDay;

// Init : 30 derniers jours par défaut
{
  const end = new Date(today);
  const start = new Date(today);
  start.setDate(end.getDate() - 29);
  setInputDate('load-from', start);
  setInputDate('load-to', end);
  // bornes min/max sur les inputs
  // max étendu dans le futur : permet de sélectionner une plage incluant la projection du prévu
  const _futureMax = new Date(today);
  _futureMax.setDate(_futureMax.getDate() + 56);
  document.getElementById('load-from').min = toIsoDate(data[0].date);
  document.getElementById('load-from').max = toIsoDate(_futureMax);
  document.getElementById('load-to').min = toIsoDate(data[0].date);
  document.getElementById('load-to').max = toIsoDate(_futureMax);
  renderLoadChart(toIsoDate(start), toIsoDate(end));

  // Sur mobile : convertit TOUS les date inputs en flatpickr custom pour virer
  // la chrome native iOS (chevron) qui prend de la place et ne s'enlève pas en CSS.
  if (window.innerWidth < 860 && window.flatpickr) {
    document.querySelectorAll('.date-range input[type="date"]').forEach(el => {
      if (el._flatpickr) return;
      const currentVal = el.value;
      el.type = 'text';
      el.setAttribute('readonly', 'readonly');
      window.flatpickr(el, {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m',
        locale: window.flatpickr?.l10ns?.fr || 'fr',
        defaultDate: currentVal || undefined,
        onChange: (sel, dateStr, fp) => {
          fp.input.value = dateStr;
          fp.input.dispatchEvent(new Event('change', { bubbles: true }));
        },
      });
    });
  }
}

// Event handlers
document.querySelectorAll('#load-range .preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#load-range .preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const days = +btn.dataset.days;
    const end = new Date(today);
    const start = new Date(today);
    start.setDate(end.getDate() - (days - 1));
    setInputDate('load-from', start);
    setInputDate('load-to', end);
    renderLoadChart(toIsoDate(start), toIsoDate(end));
  });
});
['load-from', 'load-to'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    // Désactiver les boutons preset si la sélection est manuelle
    document.querySelectorAll('#load-range .preset').forEach(b => b.classList.remove('active'));
    renderLoadChart(getInputDate('load-from'), getInputDate('load-to'));
  });
});
// Bouton « Réinitialiser » : revient à la plage par défaut (30 jours).
document.getElementById('load-reset')?.addEventListener('click', () => {
  try { if (loadChart.resetZoom) loadChart.resetZoom(); } catch (_) {}
  const p30 = document.querySelector('#load-range .preset[data-days="30"]');
  if (p30) p30.click();
});

// (Corrélations supprimées du dashboard — bloc retiré sur demande)

// ========= CHART HOURS (heures hebdomadaires, semaines calendaires, drill-down jour) =========
let currentHoursWeeks = [];
let selectedHoursIndex = null;
let hoursDailyChart = null;

// Bandeau de stats au-dessus du graphe Volume : durée, km, D+, TSS de la semaine.
function formatWeekStats(week) {
  if (!week) return '';
  let mins = 0, km = 0, dplus = 0;
  for (const d of (week.days || [])) {
    mins += d.duration || 0;
    for (const a of (d.activities || [])) { km += a.distance_km || 0; dplus += a.elevation_gain || 0; }
  }
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  const durStr = h > 0 ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
  const ic = {
    dur: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    km: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="5" r="2.4"/><path d="M8.4 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.6"/></svg>',
    dplus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 20 9 9 13 15 16 10 21 20"/></svg>',
    tss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  };
  const chip = (icon, val, lbl) => `<div class="vol-stat">${icon}<div><span class="vs-val">${val}</span><span class="vs-lbl">${lbl}</span></div></div>`;
  const chips = [chip(ic.dur, durStr, 'Durée')];
  if (km > 0) chips.push(chip(ic.km, Math.round(km) + ' km', 'Distance'));
  if (dplus > 0) chips.push(chip(ic.dplus, Math.round(dplus) + ' m', 'D+'));
  chips.push(chip(ic.tss, Math.round(week.tss || 0), 'TSS'));
  return `<div class="vol-stats-week">${week.label}</div><div class="vol-stats-grid">${chips.join('')}</div>`;
}
function setVolStats(week) {
  const el = document.getElementById('vol-stats');
  if (el) el.innerHTML = formatWeekStats(week);
}

const hoursChart = new Chart(document.getElementById('chart-hours'), {
  type: 'line',
  data: { labels: [], datasets: [{
    data: [],
    borderColor: '#4ade80', borderWidth: 2.5,
    backgroundColor: (c) => { const ch = c.chart, a = ch.chartArea; if (!a) return 'rgba(74,222,128,0.10)'; const g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, 'rgba(74,222,128,0.28)'); g.addColorStop(1, 'rgba(74,222,128,0.02)'); return g; },
    fill: 'origin', cubicInterpolationMode: 'monotone', tension: 0.35,
    pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: [], pointBorderColor: '#0b0e14', pointBorderWidth: 1.5,
  }] },
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    onClick: (event, elements) => {
      if (elements.length === 0) return;
      const idx = elements[0].index;
      if (selectedHoursIndex === idx) {
        hideHoursDetail();
      } else {
        selectedHoursIndex = idx;
        showHoursDetail(currentHoursWeeks[idx]);
      }
    },
    onHover: (event, elements) => {
      event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      if (elements.length) setVolStats(currentHoursWeeks[elements[0].index]);
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    },
    scales: {
      y: { beginAtZero: true, ticks: { color: '#6b7488', callback: (v) => v + 'h' }, grid: { color: 'rgba(255,255,255,0.045)', drawBorder: false }, border: { display: false } },
      x: { grid: { display: false }, border: { display: false }, ticks: { color: '#6b7488', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } }
    }
  }
});

function renderHoursChart(fromIso, toIso) {
  currentHoursWeeks = computeWeeksByDate(fromIso, toIso);
  const labels = currentHoursWeeks.map(w => {
    const d = w.days && w.days[0] && w.days[0].date;
    return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') : w.label;
  });
  const hoursArr = currentHoursWeeks.map(w => +(w.days.reduce((s, d) => s + (d.duration || 0), 0) / 60).toFixed(1));
  const colors = hoursArr.map(h => {
    if (h === 0) return '#2a3142';
    if (h > 12) return '#f87171';
    if (h > 8) return '#fbbf24';
    return '#4ade80';
  });
  hoursChart.data.labels = labels;
  hoursChart.data.datasets[0].data = hoursArr;
  hoursChart.data.datasets[0].pointBackgroundColor = '#4ade80';
  hoursChart.update();
  setVolStats(currentHoursWeeks[currentHoursWeeks.length - 1]);
  hideHoursDetail();
}

function showHoursDetail(week) {
  if (!week) return;
  document.getElementById('hours-detail').style.display = 'block';
  document.getElementById('hours-detail-title').textContent =
    `Détail jour par jour · semaine du ${week.label}`;

  const dowFr = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const dayLabels = week.days.map(d => `${dowFr[d.date.getDay()]} ${d.date.getDate()}`);
  const dayHours = week.days.map(d => +((d.duration || 0) / 60).toFixed(1));
  const dayColors = dayHours.map(h => {
    if (h === 0) return '#2a3142';
    if (h > 3) return '#f87171';
    if (h > 1.5) return '#fbbf24';
    return '#4ade80';
  });
  const daySessionNames = week.days.map(d => d.sessionName || 'Repos');

  if (hoursDailyChart) {
    hoursDailyChart.data.labels = dayLabels;
    hoursDailyChart.data.datasets[0].data = dayHours;
    hoursDailyChart.data.datasets[0].backgroundColor = dayColors;
    hoursDailyChart.$daySessionNames = daySessionNames;
    hoursDailyChart.update();
  } else {
    const canvas = document.getElementById('chart-hours-daily');
    hoursDailyChart = new Chart(canvas, {
      type: 'bar',
      data: { labels: dayLabels, datasets: [{ data: dayHours, backgroundColor: dayColors, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const name = ctx.chart.$daySessionNames?.[ctx.dataIndex] || '';
                return name ? `${name} · ${ctx.parsed.y} h` : `${ctx.parsed.y} h`;
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => v + 'h' } },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    });
    hoursDailyChart.$daySessionNames = daySessionNames;
  }
}

function hideHoursDetail() {
  document.getElementById('hours-detail').style.display = 'none';
  selectedHoursIndex = null;
}

document.getElementById('hours-detail-close').addEventListener('click', hideHoursDetail);

function applyHoursPreset(numWeeks) {
  const end = new Date(today);
  const currentMonday = getMondayOfWeek(end);
  const start = new Date(currentMonday);
  start.setDate(currentMonday.getDate() - (numWeeks - 1) * 7);
  setInputDate('hours-from', start);
  setInputDate('hours-to', end);
  renderHoursChart(toIsoDate(start), toIsoDate(end));
}

// Init avec 12 semaines calendaires par défaut
document.getElementById('hours-from').min = toIsoDate(data[0].date);
document.getElementById('hours-from').max = toIsoDate(data[data.length-1].date);
document.getElementById('hours-to').min = toIsoDate(data[0].date);
document.getElementById('hours-to').max = toIsoDate(data[data.length-1].date);
applyHoursPreset(12);

document.querySelectorAll('#hours-range .preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#hours-range .preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyHoursPreset(+btn.dataset.weeks);
  });
});

['hours-from', 'hours-to'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('#hours-range .preset').forEach(b => b.classList.remove('active'));
    renderHoursChart(getInputDate('hours-from'), getInputDate('hours-to'));
  });
});

// ========= CHART WEEKLY (filtrable par nombre de semaines + drill-down jour) =========

let currentWeeks = [];        // semaines actuellement affichées
let selectedWeekIndex = null; // index de la semaine cliquée (null si aucune)
let dailyChart = null;         // chart du détail journalier, créé à la 1ère ouverture

// Lundi de la semaine d'une date donnée (semaine ISO calendaire Mon-Sun)
function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();         // 0=Dim, 1=Lun, ..., 6=Sam
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeWeeksByDate(fromIso, toIso) {
  // Regrouper par VRAIES semaines calendaires (Lundi -> Dimanche).
  // La semaine en cours est affichée même incomplète (les jours futurs valent 0).
  const fromDate = new Date(fromIso + 'T12:00:00');
  const toDate = new Date(toIso + 'T12:00:00');
  const firstMonday = getMondayOfWeek(fromDate);
  // Aller jusqu'au dimanche de la semaine de toDate
  const lastSunday = getMondayOfWeek(toDate);
  lastSunday.setDate(lastSunday.getDate() + 6);

  // Index data par date ISO pour lookup O(1)
  const dataByIso = {};
  data.forEach(d => { dataByIso[toIsoDate(d.date)] = d; });

  const weeks = [];
  let weekStart = new Date(firstMonday);

  while (weekStart <= lastSunday) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const weekDays = [];
    let weekHasAny = false;
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      const iso = toIsoDate(day);
      if (dataByIso[iso]) {
        weekDays.push(dataByIso[iso]);
        weekHasAny = true;
      } else {
        // Jour futur ou absent : barre vide / grise
        weekDays.push({
          date: day,
          tss: 0,
          sessionName: null,
          duration: 0
        });
      }
    }

    // Si la semaine entière est en dehors de l'historique (très ancien), on skip
    if (weekHasAny) {
      const tss = weekDays.reduce((s, d) => s + (d.tss || 0), 0);
      weeks.push({
        label: `${fmtShortDate(weekStart)} - ${fmtShortDate(weekEnd)}`,
        tss,
        days: weekDays
      });
    }

    // Avancer d'une semaine
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() + 7);
  }

  return weeks;
}

const weeklyChart = new Chart(document.getElementById('chart-weekly'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      data: [],
      borderColor: '#4ade80', borderWidth: 2.5,
      backgroundColor: (c) => { const ch = c.chart, a = ch.chartArea; if (!a) return 'rgba(74,222,128,0.10)'; const g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, 'rgba(74,222,128,0.28)'); g.addColorStop(1, 'rgba(74,222,128,0.02)'); return g; },
      fill: 'origin', cubicInterpolationMode: 'monotone', tension: 0.35,
      pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: [], pointBorderColor: '#0b0e14', pointBorderWidth: 1.5,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    onClick: (event, elements) => {
      if (elements.length === 0) return;
      const idx = elements[0].index;
      if (selectedWeekIndex === idx) {
        // Re-clic sur la même barre → on ferme
        hideWeekDetail();
      } else {
        selectedWeekIndex = idx;
        showWeekDetail(currentWeeks[idx]);
      }
    },
    onHover: (event, elements) => {
      event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      if (elements.length) setVolStats(currentWeeks[elements[0].index]);
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    },
    scales: {
      y: { title: { display: true, text: 'TSS hebdo', color: '#6b7488' }, beginAtZero: true, ticks: { color: '#6b7488' }, grid: { color: 'rgba(255,255,255,0.045)', drawBorder: false }, border: { display: false } },
      x: { grid: { display: false }, border: { display: false }, ticks: { color: '#6b7488', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } }
    }
  }
});

function renderWeeklyChart(fromIso, toIso) {
  currentWeeks = computeWeeksByDate(fromIso, toIso);
  weeklyChart.data.labels = currentWeeks.map(w => {
    const d = w.days && w.days[0] && w.days[0].date;
    return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') : w.label;
  });
  weeklyChart.data.datasets[0].data = currentWeeks.map(w => w.tss);
  weeklyChart.data.datasets[0].pointBackgroundColor = '#4ade80';
  weeklyChart.update();
  setVolStats(currentWeeks[currentWeeks.length - 1]);
  hideWeekDetail();
}

function showWeekDetail(week) {
  const detailDiv = document.getElementById('weekly-detail');
  detailDiv.style.display = 'block';
  document.getElementById('weekly-detail-title').textContent =
    `Détail jour par jour · semaine du ${week.label}`;

  const dowFr = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const dayLabels = week.days.map(d => `${dowFr[d.date.getDay()]} ${d.date.getDate()}`);
  const dayTss = week.days.map(d => d.tss);
  const dayColors = week.days.map(d => {
    if (!d.tss) return '#2a3142';      // jour de repos / pas de séance
    if (d.tss > 150) return '#f87171'; // grosse séance
    if (d.tss > 80) return '#fbbf24';  // séance moyenne
    return '#4ade80';                   // séance légère
  });
  const daySessionNames = week.days.map(d => d.sessionName || 'Repos');

  if (dailyChart) {
    dailyChart.data.labels = dayLabels;
    dailyChart.data.datasets[0].data = dayTss;
    dailyChart.data.datasets[0].backgroundColor = dayColors;
    dailyChart.$daySessionNames = daySessionNames;
    dailyChart.update();
  } else {
    const canvas = document.getElementById('chart-weekly-daily');
    dailyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: [{ data: dayTss, backgroundColor: dayColors, borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const name = ctx.chart.$daySessionNames?.[ctx.dataIndex] || '';
                return name ? `${name} · ${ctx.parsed.y} TSS` : `${ctx.parsed.y} TSS`;
              }
            }
          }
        },
        scales: {
          y: { title: { display: true, text: 'TSS' }, beginAtZero: true },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    });
    dailyChart.$daySessionNames = daySessionNames;
  }
}

function hideWeekDetail() {
  document.getElementById('weekly-detail').style.display = 'none';
  selectedWeekIndex = null;
}

document.getElementById('weekly-detail-close').addEventListener('click', hideWeekDetail);

// Helper preset : N semaines calendaires (semaine courante + N-1 semaines passées)
function applyWeeklyPreset(numWeeks) {
  const end = new Date(today);
  const currentMonday = getMondayOfWeek(end);
  const start = new Date(currentMonday);
  start.setDate(currentMonday.getDate() - (numWeeks - 1) * 7);
  setInputDate('weekly-from', start);
  setInputDate('weekly-to', end);
  renderWeeklyChart(toIsoDate(start), toIsoDate(end));
}

// Init : 12 semaines calendaires (semaine courante + 11 précédentes)
document.getElementById('weekly-from').min = toIsoDate(data[0].date);
document.getElementById('weekly-from').max = toIsoDate(data[data.length-1].date);
document.getElementById('weekly-to').min = toIsoDate(data[0].date);
document.getElementById('weekly-to').max = toIsoDate(data[data.length-1].date);
applyWeeklyPreset(12);

// Presets : 4 sem / 12 sem (pilotent Heures ET TSS pour rester en phase)
document.querySelectorAll('#weekly-range .preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#weekly-range .preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyWeeklyPreset(+btn.dataset.weeks);
    if (typeof applyHoursPreset === 'function') applyHoursPreset(+btn.dataset.weeks);
  });
});

// Date inputs manuels : déselectionne les presets + synchronise les deux graphes
['weekly-from', 'weekly-to'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('#weekly-range .preset').forEach(b => b.classList.remove('active'));
    const f = getInputDate('weekly-from'), t = getInputDate('weekly-to');
    renderWeeklyChart(f, t);
    setInputDate('hours-from', new Date(f + 'T12:00:00'));
    setInputDate('hours-to', new Date(t + 'T12:00:00'));
    renderHoursChart(f, t);
  });
});

// Bascule métrique de la carte Volume (Heures / TSS) : montre le bon graphe.
(function setupVolumeToggle() {
  const toggle = document.getElementById('vol-toggle');
  if (!toggle) return;
  const hoursWrap = document.getElementById('vol-hours-wrap');
  const tssWrap = document.getElementById('vol-tss-wrap');
  toggle.querySelectorAll('.ztoggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('.ztoggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const showHours = btn.dataset.metric === 'hours';
      if (hoursWrap) hoursWrap.style.display = showHours ? '' : 'none';
      if (tssWrap) tssWrap.style.display = showHours ? 'none' : '';
      if (typeof hideHoursDetail === 'function') hideHoursDetail();
      if (typeof hideWeekDetail === 'function') hideWeekDetail();
      // Un graphe caché a une taille nulle → resize quand il réapparaît.
      try { if (showHours) hoursChart.resize(); else weeklyChart.resize(); } catch (_) {}
      // Rafraîchit le bandeau de stats selon le graphe affiché (dernière semaine).
      const arr = showHours ? currentHoursWeeks : currentWeeks;
      setVolStats(arr[arr.length - 1]);
    });
  });
})();

// ========= CHART ZONES (avec sélecteur de période) =========
const zoneLabels = ['Z1 récup', 'Z2 endurance', 'Z3 tempo', 'Z4 seuil', 'Z5 VO2max'];
const zoneColors = ['#bbf7d0','#86efac','#4ade80','#16a34a','#14532d'];

// État : 'hr' (FC) ou 'power' (Watts)
let currentZoneType = 'hr';

function getZonesForDay(d) {
  // Renvoie le tableau de zones approprié selon le toggle, avec fallback
  if (currentZoneType === 'power') return d.zones_power || null;
  return d.zones_hr || d.zones || null;
}

// Repartition 5 zones a partir d'un stream (FC ou puissance) -> [%...5].
function __zones5Hr(hr, hrMax) {
  const z = [0, 0, 0, 0, 0]; let n = 0;
  for (let i = 0; i < hr.length; i++) { const h = hr[i]; if (h == null) continue; const p = h / hrMax * 100; const k = p < 60 ? 0 : p < 70 ? 1 : p < 82 ? 2 : p < 93 ? 3 : 4; z[k]++; n++; }
  if (!n) return null; return z.map(s => +(s * 100 / n).toFixed(1));
}
function __zones5Pow(w, ftp) {
  const z = [0, 0, 0, 0, 0]; let n = 0;
  for (let i = 0; i < w.length; i++) { const x = w[i]; if (x == null) continue; const p = x / ftp * 100; const k = p < 55 ? 0 : p < 76 ? 1 : p < 91 ? 2 : p < 106 ? 3 : 4; z[k]++; n++; }
  if (!n) return null; return z.map(s => +(s * 100 / n).toFixed(1));
}
// Charge les streams des activites de la periode qui n'ont pas encore de zones,
// calcule FC + puissance, et met en cache sur l'activite (_zhr / _zpow).
async function ensureZonesForRange(fromIso, toIso) {
  const ath = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete) || {};
  const ftp = +ath.ftp || 250, hrMax = +ath.hr_max || +ath.hrMax || 190;
  const todo = [];
  data.forEach(d => {
    const iso = toIsoDate(d.date);
    if (iso < fromIso || iso > toIso) return;
    (d.activities || []).forEach(a => {
      if (!a || !(a.id || a.activityId)) return;
      const hasHr = a._zhr || a.zones_hr, hasPow = a._zpow || a.zones_power;
      if (a._zonesDone || (hasHr && hasPow)) return;
      todo.push(a);
    });
  });
  for (let i = 0; i < todo.length; i++) {
    const a = todo[i];
    try {
      const streams = await loadStreamsFromSupabase(a.id || a.activityId);
      a._zonesDone = true; // ne pas reessayer cette session meme si pas de streams
      if (!streams) continue;
      const watts = Array.isArray(streams) ? ((streams.find(x => x && x.type === 'watts') || {}).data) : streams.watts;
      const hr = Array.isArray(streams) ? ((streams.find(x => x && x.type === 'heartrate') || {}).data) : streams.heartrate;
      if (hr && hr.length && !a._zhr && !a.zones_hr) a._zhr = __zones5Hr(hr, hrMax);
      if (watts && watts.length && !a._zpow && !a.zones_power) a._zpow = __zones5Pow(watts, ftp);
    } catch (e) { a._zonesDone = true; }
    if ((i & 7) === 0) await new Promise(r => setTimeout(r, 0));
  }
}
function computeZonesByDate(fromIso, toIso) {
  // Pondere par la duree de CHAQUE activite (zones calculees depuis les streams, sinon intervals)
  const totals = [0, 0, 0, 0, 0];
  let totalTime = 0, sessions = 0;
  data.forEach(d => {
    const iso = toIsoDate(d.date);
    if (iso < fromIso || iso > toIso) return;
    (d.activities || []).forEach(a => {
      if (!a) return;
      const dur = a.duration || (a.moving_time ? a.moving_time / 60 : 0);
      if (!dur) return;
      const zones = (currentZoneType === 'power') ? (a._zpow || a.zones_power) : (a._zhr || a.zones_hr || a.zones);
      if (!zones || !zones.length) return;
      sessions++;
      for (let i = 0; i < 5; i++) { const pct = +zones[i] || 0; const m = (pct / 100) * dur; totals[i] += m; totalTime += m; }
    });
  });
  if (totalTime === 0) return { pct: [0, 0, 0, 0, 0], totalMin: 0, sessions: 0 };
  return {
    pct: totals.map(m => +(m * 100 / totalTime).toFixed(1)),
    totalMin: Math.round(totalTime),
    sessions
  };
}

const zonesChart = new Chart(document.getElementById('chart-zones'), {
  type: 'doughnut',
  data: {
    labels: zoneLabels,
    datasets: [{ data: [0,0,0,0,0], backgroundColor: zoneColors, borderWidth: 0, borderRadius: 4, spacing: 2, hoverOffset: 6 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    cutout: '70%',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => ctx.label + ' : ' + ctx.parsed + '%' } }
    }
  }
});

let _zonesRenderSeq = 0;
async function renderZones(fromIso, toIso) {
  const emptyEl0 = document.getElementById('zones-empty');
  const wrapEl0 = document.getElementById('zones-chart-wrap');
  // 1er rendu immediat avec ce qu'on a deja
  let r = computeZonesByDate(fromIso, toIso);
  // Si rien (zones pas encore calculees), on les calcule depuis les streams
  const seq = ++_zonesRenderSeq;
  if (r.pct.reduce((x, y) => x + (y || 0), 0) === 0) {
    if (emptyEl0) { emptyEl0.hidden = false; emptyEl0.innerHTML = '<div style="color:var(--text-dim)">Calcul des zones depuis les streams…</div>'; }
    if (wrapEl0) wrapEl0.style.display = 'none';
    try { await ensureZonesForRange(fromIso, toIso); } catch (e) {}
    if (seq !== _zonesRenderSeq) return; // une autre periode a ete demandee entre-temps
    r = computeZonesByDate(fromIso, toIso);
    if (emptyEl0) emptyEl0.innerHTML = 'Aucune donnée de zones sur cette période.<br><span style="font-size:12px;opacity:.7">Les zones nécessitent les streams FC / puissance des activités.</span>';
  }
  _renderZonesView(fromIso, toIso, r);
}
function _renderZonesView(fromIso, toIso, precomputed) {
  const { pct, totalMin, sessions } = precomputed || computeZonesByDate(fromIso, toIso);
  const total = pct.reduce((a, b) => a + (b || 0), 0);
  const emptyEl = document.getElementById('zones-empty');
  const wrapEl = document.getElementById('zones-chart-wrap');
  if (total === 0) {
    // Aucune donnée : message au lieu d'un anneau vide.
    if (wrapEl) wrapEl.style.display = 'none';
    if (emptyEl) emptyEl.hidden = false;
    const zs = document.getElementById('zone-summary');
    if (zs) zs.innerHTML = '';
    return;
  }
  if (wrapEl) wrapEl.style.display = '';
  if (emptyEl) emptyEl.hidden = true;
  zonesChart.data.labels = zoneLabels;
  zonesChart.data.datasets[0].data = pct;
  zonesChart.data.datasets[0].backgroundColor = zoneColors;
  zonesChart.update();
  const rows = zoneLabels.map((label, i) =>
    `<div class="zone-summary-row"><span class="zname"><span class="legend-dot" style="background:${zoneColors[i]};"></span>${label}</span><span class="zpct">${pct[i]}%</span></div>`
  ).join('');
  document.getElementById('zone-summary').innerHTML = `
    <div style="margin-bottom:8px;color:var(--text-dim);">
      <strong style="color:var(--text);">${sessions}</strong> séance${sessions>1?'s':''} · <strong style="color:var(--text);">${fmtDur(totalMin)}</strong> de pratique
    </div>
    ${rows}
  `;
}

// Init avec 30 derniers jours par défaut
{
  const end = new Date(today);
  const start = new Date(today);
  start.setDate(end.getDate() - 29);
  setInputDate('zones-from', start);
  setInputDate('zones-to', end);
  document.getElementById('zones-from').min = toIsoDate(data[0].date);
  document.getElementById('zones-from').max = toIsoDate(data[data.length-1].date);
  document.getElementById('zones-to').min = toIsoDate(data[0].date);
  document.getElementById('zones-to').max = toIsoDate(data[data.length-1].date);
  renderZones(toIsoDate(start), toIsoDate(end));
}

// Presets
document.querySelectorAll('#zones-range .preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#zones-range .preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const days = +btn.dataset.days;
    const end = new Date(today);
    const start = new Date(today);
    start.setDate(end.getDate() - (days - 1));
    setInputDate('zones-from', start);
    setInputDate('zones-to', end);
    renderZones(toIsoDate(start), toIsoDate(end));
  });
});

// Date inputs manuels
['zones-from', 'zones-to'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('#zones-range .preset').forEach(b => b.classList.remove('active'));
    renderZones(getInputDate('zones-from'), getInputDate('zones-to'));
  });
});

// Toggle FC / Watts
document.querySelectorAll('#zones-type-toggle .ztoggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#zones-type-toggle .ztoggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentZoneType = btn.dataset.type;
    renderZones(getInputDate('zones-from'), getInputDate('zones-to'));
  });
});

// ========= PANEL 2: ENTRAÎNEUR (compétitions + plan 7j) =========
const dowFr = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const COMP_KEY = 'coach_ia_competitions_v1';

function loadCompetitions() {
  try {
    const raw = localStorage.getItem(COMP_KEY);
    if (!raw) return [];
    return JSON.parse(raw).filter(c => c.date && c.name);
  } catch (e) { return []; }
}

// Une competition appartient-elle au calendrier REALISE (vs prevu) ?
// Ancre sur le drapeau realised (calendrier d'origine) ; repli sur la table/date pour l'existant.
function compIsRealised(c) {
  if (!c) return false;
  if (c.realised === true) return true;
  if (c.realised === false) return false;
  if (c._table === 'competition' || c._table === 'activity') return true;
  if (c._table === 'planned') return false;
  try { return (c.date || '') <= toIsoDate(today); } catch (e) { return false; }
}

// Renvoie la liste des compés "à plat" : chaque course par étapes est expansée
// en une entrée par étape (avec date/sport/km/etc de l'étape).
// Les compés simples restent telles quelles. Sert au calendrier.
function loadCompetitionsExpanded() {
  const out = [];
  for (const c of loadCompetitions()) {
    if (c.stages && Array.isArray(c.stagesList) && c.stagesList.length > 0) {
      c.stagesList.forEach((st, idx) => {
        if (!st.date) return; // ignore les étapes sans date
        out.push({
          id: `${c.id}-stage-${idx}`,
          parentId: c.id,
          _table: c._table,
          name: `${c.name} — Étape ${idx + 1}`,
          date: st.date,
          time: st.time || null,
          // Priority et sport sont GLOBAUX (depuis la compé), pas par étape
          priority: c.priority || 'principal',
          sport: c.sport || 'Ride',
          type: st.type || null,
          km: st.km || null,
          dplus: st.dplus || null,
          target: st.target || null,
          laps: st.laps || null,
          notes: st.notes || null,
          gpxName: st.gpxName || null,
          gpxContent: st.gpxContent || null,
          stageIdx: idx,
          totalStages: c.stagesList.length,
          stages: false, // pour les render, on traite chaque étape comme une compé simple
        });
      });
    } else {
      out.push(c);
    }
  }
  return out;
}

function saveCompetitions(comps) {
  // Diff avec l'ancien array pour détecter les suppressions
  let previous = [];
  try { previous = JSON.parse(localStorage.getItem(COMP_KEY) || '[]'); } catch {}
  const currentIds = new Set(comps.map(c => c.id));
  const deleted = previous.filter(p => !currentIds.has(p.id));

  localStorage.setItem(COMP_KEY, JSON.stringify(comps));
  // La projection de la courbe de charge inclut les compétitions → refresh
  if (window.refreshLoadChart) window.refreshLoadChart();

  // Mirror cloud
  if (window.cloudSync) {
    // Push (upsert) chaque compé courante
    for (const c of comps) {
      window.cloudSync.pushCompetition(c).then(sbId => {
        if (sbId && !c._sbId) {
          c._sbId = sbId;
          // Re-save silencieux pour persister le _sbId
          try {
            const cur = JSON.parse(localStorage.getItem(COMP_KEY) || '[]');
            const idx = cur.findIndex(x => x.id === c.id);
            if (idx >= 0) { cur[idx]._sbId = sbId; localStorage.setItem(COMP_KEY, JSON.stringify(cur)); }
          } catch {}
        }
      });
    }
    // Delete les supprimées
    for (const d of deleted) window.cloudSync.deleteCompetition(d);
  }

  // Re-render automatique : "Compétitions à venir" + calendrier + page Compétitions
  if (typeof renderCompList === 'function') renderCompList();
  if (typeof renderCompetitionsPage === 'function') renderCompetitionsPage();
  if (typeof renderCalendar === 'function') renderCalendar();
}

// (Les snapshots de plan ont été supprimés : les jours passés lisent désormais
//  uniquement les vraies données depuis la base.)

// Compétition TRIATHLON planifiée pour une date donnée (rapprochement du réalisé)
window.__triCompForDate = function (iso) {
  try {
    const comps = (typeof loadCompetitionsExpanded === 'function') ? loadCompetitionsExpanded() : [];
    return comps.find(c => c.date === iso && typeof getSportCategory === 'function' && getSportCategory(c.sport) === 'triathlon') || null;
  } catch (e) { return null; }
};

// Libellé compact des distances triathlon d'une compétition : "750m · 20km · 5km"
window.triDistLabel = function (c) {
  const t = c && c.tri;
  if (!t || (!t.swim_m && !t.bike_km && !t.run_km)) return '';
  const parts = [];
  if (t.swim_m) parts.push(Math.round(t.swim_m) + 'm');
  if (t.bike_km) parts.push((+t.bike_km) + 'km');
  if (t.run_km) parts.push((+t.run_km) + 'km');
  return parts.join(' · ');
};

function renderCompList() {
  // Helpers de format
  const fmtFullDate = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShortDayMonth = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtYear = d => d.getFullYear();

  const comps = loadCompetitions()
    .map(c => {
      // Pour les courses par étapes : start = première étape, end = dernière étape
      let startDate = c.date, endDate = c.date;
      if (c.stages && Array.isArray(c.stagesList) && c.stagesList.length) {
        const dates = c.stagesList.map(s => s.date).filter(Boolean).sort();
        if (dates.length) { startDate = dates[0]; endDate = dates[dates.length - 1]; }
      }
      return {
        ...c,
        dateObj: new Date(startDate + 'T12:00:00'),
        endDateObj: new Date(endDate + 'T12:00:00'),
      };
    })
    .filter(c => c.endDateObj >= today) // affiche tant que la dernière étape n'est pas passée
    .sort((a, b) => a.dateObj - b.dateObj);

  const list = document.getElementById('comp-list');
  if (comps.length === 0) {
    list.innerHTML = `<div class="comp-empty">Aucune compétition enregistrée. Ajoute ton prochain objectif pour structurer ton plan.</div>`;
    return;
  }
  list.innerHTML = comps.map(c => {
    const daysUntil = Math.ceil((c.dateObj - today) / 86400000);
    let dateStr;
    if (c.stages && c.endDateObj.getTime() !== c.dateObj.getTime()) {
      // Course par étapes : start → end
      // Si même année, on ne répète pas l'année
      const sameYear = c.dateObj.getFullYear() === c.endDateObj.getFullYear();
      if (sameYear) {
        dateStr = `${fmtShortDayMonth(c.dateObj)} → ${fmtShortDayMonth(c.endDateObj)} ${fmtYear(c.endDateObj)}`;
      } else {
        dateStr = `${fmtShortDayMonth(c.dateObj)} ${fmtYear(c.dateObj)} → ${fmtShortDayMonth(c.endDateObj)} ${fmtYear(c.endDateObj)}`;
      }
      // Ajoute un petit indicateur du nb d'étapes
      const nbStages = c.stagesList.length;
      dateStr += ` <span class="comp-stages-badge" title="${nbStages} étapes">· ${nbStages} étapes</span>`;
    } else {
      dateStr = fmtFullDate(c.dateObj);
    }
    const _pi = compPrio(c.priority);
    // Progression de la jauge : temps écoulé depuis le début de saison
    // (1er janvier de l'année de la course) jusqu'au jour de course.
    const seasonStart = new Date(c.dateObj.getFullYear(), 0, 1);
    const totalMs = c.dateObj - seasonStart;
    let fillPct = totalMs > 0 ? ((today - seasonStart) / totalMs) * 100 : 100;
    fillPct = Math.max(0, Math.min(100, fillPct));
    return `<div class="comp-item" data-prio="${_pi.key}" data-comp-id="${c.id}" title="Voir le détail de la compétition">
      <div class="comp-row">
        <span class="comp-name">${trophySvg(_pi.color)}<span class="comp-name-text">${c.name}</span></span>
        <span class="comp-date">${dateStr}</span>
        <span class="comp-countdown">${daysUntil <= 0 ? 'en cours' : 'J‑' + daysUntil}</span>
        <button class="comp-del" data-id="${c.id}" title="Supprimer">×</button>
      </div>
      ${window.triDistLabel(c) ? `<div class="comp-tri-mini"><span class="ctm-dist">${window.triDistLabel(c)}</span>${c.target ? `<span class="ctm-obj">Objectif · ${fmtMinToTime(c.target)}</span>` : ''}</div>` : ''}
      <div class="comp-phase-track"><div class="comp-phase-fill" style="width:${fillPct.toFixed(1)}%"></div></div>
    </div>`;
  }).join('');
}

// Page "Compétitions" (onglet dédié) : hero prochain objectif + frise de saison
// + à venir (jauge) + passées enrichies (résultats réels).
const _PHASE_COLORS = { build: '#60a5fa', peak: '#fbbf24', taper: '#a78bfa', race: '#f87171', recovery: '#4ade80' };
function _formInfo(tsb) {
  if (tsb == null) return { t: '—', c: 'var(--text-mute)' };
  if (tsb >= 10) return { t: 'très frais', c: 'var(--accent)' };
  if (tsb >= 0) return { t: 'frais', c: 'var(--accent)' };
  if (tsb >= -10) return { t: 'équilibré', c: 'var(--warn)' };
  if (tsb >= -20) return { t: 'fatigué', c: 'var(--warn)' };
  return { t: 'très fatigué', c: 'var(--danger)' };
}
function _prepReco(phaseKey, tsb) {
  if (tsb != null && tsb < -20) return "Fatigue marquée — priorité à la récupération avant d'affûter.";
  switch (phaseKey) {
    case 'race': return 'Semaine de course : repos et activations courtes, garde la fraîcheur.';
    case 'taper': return 'Affûtage en cours — réduis le volume, conserve un peu d\'intensité.';
    case 'peak': return 'Pic de charge : intensité spécifique, surveille bien la récupération.';
    case 'build': return 'Construis le foncier et le CTL. L\'affûtage viendra plus tard.';
    case 'recovery': return 'Phase de décharge : récupère pour mieux rebondir.';
    default: return 'Continue ta préparation régulière.';
  }
}

function renderCompetitionsPage() {
  const heroWrap = document.getElementById('comp-hero');
  const seasonWrap = document.getElementById('comp-season');
  const upWrap = document.getElementById('comp-page-upcoming');
  const pastWrap = document.getElementById('comp-page-past');
  if (!heroWrap && !seasonWrap && !upWrap && !pastWrap) return;

  const fmtFullDate = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShortDayMonth = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtYear = d => d.getFullYear();

  const comps = loadCompetitions().map(c => {
    let startDate = c.date, endDate = c.date;
    if (c.stages && Array.isArray(c.stagesList) && c.stagesList.length) {
      const dates = c.stagesList.map(s => s.date).filter(Boolean).sort();
      if (dates.length) { startDate = dates[0]; endDate = dates[dates.length - 1]; }
    }
    return { ...c, dateObj: new Date(startDate + 'T12:00:00'), endDateObj: new Date(endDate + 'T12:00:00') };
  });

  const dateLabel = (c) => {
    if (c.stages && c.endDateObj.getTime() !== c.dateObj.getTime()) {
      const sameYear = c.dateObj.getFullYear() === c.endDateObj.getFullYear();
      const base = sameYear
        ? `${fmtShortDayMonth(c.dateObj)} → ${fmtShortDayMonth(c.endDateObj)} ${fmtYear(c.endDateObj)}`
        : `${fmtShortDayMonth(c.dateObj)} ${fmtYear(c.dateObj)} → ${fmtShortDayMonth(c.endDateObj)} ${fmtYear(c.endDateObj)}`;
      return `${base} <span class="comp-stages-badge" title="${c.stagesList.length} étapes">· ${c.stagesList.length} étapes</span>`;
    }
    return fmtFullDate(c.dateObj);
  };

  const upcoming = comps.filter(c => c.endDateObj >= today).sort((a, b) => a.dateObj - b.dateObj);
  const past = comps.filter(c => c.endDateObj < today).sort((a, b) => b.dateObj - a.dateObj);

  // Métriques de forme les plus récentes
  const last = (Array.isArray(data) && data.length) ? data[data.length - 1] : null;
  const tsb = last && Number.isFinite(last.tsb) ? Math.round(last.tsb) : null;
  const ctl = last && Number.isFinite(last.ctl) ? Math.round(last.ctl) : null;
  const atl = last && Number.isFinite(last.atl) ? Math.round(last.atl) : null;

  // ---- HERO : prochain objectif ----
  if (heroWrap) {
    const next = upcoming[0];
    if (!next) {
      heroWrap.innerHTML = '';
    } else {
      const daysUntil = Math.max(0, Math.ceil((next.dateObj - today) / 86400000));
      const _pi = compPrio(next.priority);
      const phKey = daysUntil <= 7 ? 'race' : daysUntil <= 28 ? 'taper' : daysUntil <= 56 ? 'peak' : 'build';
      const phColor = _PHASE_COLORS[phKey];
      const phLabel = (typeof PHASE_LABELS !== 'undefined' && PHASE_LABELS[phKey]) || phKey;
      const seasonStart = new Date(next.dateObj.getFullYear(), 0, 1);
      const totalMs = next.dateObj - seasonStart;
      const frac = totalMs > 0 ? Math.max(0, Math.min(1, (today - seasonStart) / totalMs)) : 1;
      const C = 301; const off = (C * (1 - frac)).toFixed(0);
      const form = _formInfo(tsb);
      const prioLabel = _pi.key === 'principal' ? 'Objectif principal' : 'Préparation';
      heroWrap.innerHTML = `
        <div class="comp-hero" data-comp-id="${next.id}" style="--pc:${_pi.color};" title="Voir le détail">
          <div class="comp-hero-lbl">Prochain objectif</div>
          <div class="comp-hero-body">
            <div class="comp-hero-ring">
              <svg viewBox="0 0 108 108">
                <circle cx="54" cy="54" r="48" fill="none" stroke="var(--border)" stroke-width="8"/>
                <circle cx="54" cy="54" r="48" fill="none" stroke="${_pi.color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 54 54)"/>
              </svg>
              <div class="comp-hero-ring-txt">
                <div class="comp-hero-jx" style="color:${_pi.color};">${daysUntil <= 0 ? 'Jour J' : 'J‑' + daysUntil}</div>
                <div class="comp-hero-jdate">${fmtShortDayMonth(next.dateObj)}</div>
              </div>
            </div>
            <div class="comp-hero-main">
              <div class="comp-hero-name">${trophySvg(_pi.color)}<span style="color:${_pi.color};">${next.name}</span>
                <span class="comp-pill" style="background:${_pi.color}28;color:${_pi.color};">${prioLabel}</span>
              </div>
              <div class="comp-hero-sub">${dateLabel(next)}</div>
              <div class="comp-hero-tags">
                ${window.triDistLabel(next) ? `<span class="comp-pill" style="background:rgba(244,63,94,0.18);color:#f43f5e;">${window.triDistLabel(next)}</span>` : ''}
                <span class="comp-pill" style="background:${phColor}28;color:${phColor};">Phase : ${phLabel}</span>
                <span class="comp-pill" style="background:color-mix(in srgb, ${form.c} 22%, transparent);color:${form.c};">Forme ${tsb == null ? '—' : (tsb >= 0 ? '+' : '') + tsb} · ${form.t}</span>
              </div>
            </div>
            <div class="comp-hero-prep">
              <div class="comp-hero-lbl">État de préparation</div>
              <div class="comp-prep-grid">
                <div><div class="comp-prep-val">${ctl == null ? '—' : ctl}</div><div class="comp-prep-k">CTL</div></div>
                <div><div class="comp-prep-val">${atl == null ? '—' : atl}</div><div class="comp-prep-k">ATL</div></div>
                <div><div class="comp-prep-val" style="color:${form.c};">${tsb == null ? '—' : (tsb >= 0 ? '+' : '') + tsb}</div><div class="comp-prep-k">TSB</div></div>
              </div>
              <div class="comp-prep-reco">${_prepReco(phKey, tsb)}</div>
            </div>
          </div>
        </div>`;
    }
  }

  // ---- FRISE DE SAISON + chiffres ----
  if (seasonWrap) {
    const yr = today.getFullYear();
    const jan1 = new Date(yr, 0, 1), dec31 = new Date(yr, 11, 31);
    const span = dec31 - jan1;
    const yearComps = comps.filter(c => c.dateObj.getFullYear() === yr).sort((a, b) => a.dateObj - b.dateObj);
    const pos = d => Math.max(0, Math.min(100, ((d - jan1) / span) * 100));
    const todayPos = pos(today);
    // Répartition des étiquettes en "lanes" verticales pour éviter le chevauchement
    const GAP = 16; // % minimal entre 2 étiquettes sur la même lane
    const laneLast = [];
    const tlItems = yearComps.map(c => ({ c, p: pos(c.dateObj) })).sort((a, b) => a.p - b.p);
    tlItems.forEach(m => {
      let lane = 0;
      while (laneLast[lane] != null && m.p - laneLast[lane] < GAP) lane++;
      laneLast[lane] = m.p; m.lane = lane;
    });
    const maxLane = Math.max(0, laneLast.length - 1);
    const tlHeight = 34 + (maxLane + 1) * 15 + 4;
    const markers = tlItems.map(m => {
      const c = m.c;
      const _pi = compPrio(c.priority);
      const isPast = c.endDateObj < today;
      const color = _pi.key === 'principal' ? _pi.color : '#9ca3af';
      const big = _pi.key === 'principal';
      return `<div class="comp-tl-marker${isPast ? ' past' : ''}" style="left:${m.p.toFixed(1)}%;">
        <span class="comp-tl-dot${big ? ' big' : ''}" style="background:${color};${big ? `box-shadow:0 0 0 2px ${color};` : ''}"></span>
        <span class="comp-tl-stem" style="top:13px;height:${5 + m.lane * 15}px;background:${color};"></span>
        <span class="comp-tl-cap" style="margin-top:${5 + m.lane * 15}px;${big ? `color:${color};font-weight:700;` : ''}">${c.name} · ${c.dateObj.getDate()}/${c.dateObj.getMonth() + 1}</span>
      </div>`;
    }).join('');
    const nPrincipal = yearComps.filter(c => compPrio(c.priority).key === 'principal').length;
    const nPast = yearComps.filter(c => c.endDateObj < today).length;
    seasonWrap.innerHTML = `
      <div class="grid-1 card">
        <div class="section-title">Saison ${yr}</div>
        ${yearComps.length === 0 ? '<div class="comp-empty">Aucune compétition cette saison.</div>' : `
        <div class="comp-timeline" style="height:${tlHeight}px;">
          <div class="comp-tl-axis"></div>
          <div class="comp-tl-today" style="left:${todayPos.toFixed(1)}%;"><span>auj.</span></div>
          ${markers}
        </div>
        <div class="comp-season-stats">
          <div><span class="comp-ss-val">${yearComps.length}</span> <span class="comp-ss-k">compétition${yearComps.length > 1 ? 's' : ''}</span></div>
          <div><span class="comp-ss-val" style="color:#fbbf24;">${nPrincipal}</span> <span class="comp-ss-k">objectif${nPrincipal > 1 ? 's' : ''} principal${nPrincipal > 1 ? 'aux' : ''}</span></div>
          <div><span class="comp-ss-val">${yearComps.length - nPrincipal}</span> <span class="comp-ss-k">préparation</span></div>
          <div><span class="comp-ss-val">${nPast}</span> <span class="comp-ss-k">déjà courue${nPast > 1 ? 's' : ''}</span></div>
        </div>`}
      </div>`;
  }

  // ---- À venir (avec jauge de prépa) ----
  if (upWrap) {
    upWrap.innerHTML = upcoming.length ? upcoming.map(c => {
      const daysUntil = Math.ceil((c.dateObj - today) / 86400000);
      const _pi = compPrio(c.priority);
      const seasonStart = new Date(c.dateObj.getFullYear(), 0, 1);
      const totalMs = c.dateObj - seasonStart;
      let fillPct = totalMs > 0 ? ((today - seasonStart) / totalMs) * 100 : 100;
      fillPct = Math.max(0, Math.min(100, fillPct));
      return `<div class="comp-item" data-prio="${_pi.key}" data-comp-id="${c.id}" title="Voir le détail">
        <div class="comp-row">
          <span class="comp-name">${trophySvg(_pi.color)}<span class="comp-name-text">${c.name}</span></span>
          <span class="comp-date">${dateLabel(c)}</span>
          <span class="comp-countdown">${daysUntil <= 0 ? 'en cours' : 'J‑' + daysUntil}</span>
          <button class="comp-del" data-id="${c.id}" title="Supprimer">×</button>
        </div>
        ${window.triDistLabel(c) ? `<div class="comp-tri-mini"><span class="ctm-dist">${window.triDistLabel(c)}</span>${c.target ? `<span class="ctm-obj">Objectif · ${fmtMinToTime(c.target)}</span>` : ''}</div>` : ''}
        <div class="comp-phase-track"><div class="comp-phase-fill" style="width:${fillPct.toFixed(1)}%"></div></div>
      </div>`;
    }).join('') : '<div class="comp-empty">Aucune compétition à venir.</div>';
  }

  // ---- Passées enrichies (résultats réels) ----
  if (pastWrap) {
    pastWrap.innerHTML = past.length ? past.map(c => {
      const _pi = compPrio(c.priority);
      const iso = toIsoDate(c.dateObj);
      const day = Array.isArray(data) ? data.find(d => toIsoDate(d.date) === iso) : null;
      const acts = (day && day.activities) ? day.activities : [];
      // Agrège les activités du jour (course par étapes : on prend le jour de départ)
      let dist = 0, dur = 0, elev = 0, tssV = 0, hrSum = 0, hrN = 0;
      for (const a of acts) {
        dist += a.distance_km || 0; dur += a.duration || 0; elev += a.elevation_gain || 0;
        tssV += a.tss || 0; if (a.hr) { hrSum += a.hr; hrN++; }
      }
      if (!tssV && day) tssV = day.tss || 0;
      // Stats en ligne légère (valeurs + unités), pas de boîtes
      const metrics = [];
      if (dist) metrics.push(Math.round(dist) + ' km');
      if (dur) metrics.push(fmtDur(dur));
      if (elev) metrics.push(Math.round(elev) + ' m D+');
      if (tssV) metrics.push(Math.round(tssV) + ' TSS');
      if (hrN) metrics.push(Math.round(hrSum / hrN) + ' bpm');
      const metricsHtml = metrics.length
        ? `<div class="comp-res-metrics">${metrics.map(m => `<span class="comp-res-m">${m}</span>`).join('<span class="comp-res-sep">·</span>')}</div>`
        : '<div class="comp-res-metrics comp-res-nodata">Pas de données d\'activité</div>';

      // Médaille = résultat officiel Open Dossard (lié par date), sinon trophée neutre
      const od = window.odResultForDate ? window.odResultForDate(iso) : null;
      let medal;
      if (od && od.rankingScratch != null) {
        const podium = od.rankingScratch === 1 ? ' gold' : (od.rankingScratch <= 3 ? ' podium' : '');
        const cat = (od.rankingInCategory != null && od.totalInCategory != null)
          ? `${od.rankingInCategory}/${od.totalInCategory}${od.catev ? ' · ' + od.catev : ''}`
          : (od.catev ? od.catev : 'scratch');
        medal = `<div class="comp-res-medal${podium}" title="Résultat officiel Open Dossard">
          <div class="comp-res-medal-rank">${od.rankingScratch}<sup>${od.rankingScratch === 1 ? 'er' : 'e'}</sup></div>
          <div class="comp-res-medal-cat">${cat}</div>
        </div>`;
      } else {
        medal = `<div class="comp-res-medal none">${trophySvg(_pi.color, 22)}</div>`;
      }

      return `<div class="comp-result-card" data-prio="${_pi.key}" data-comp-id="${c.id}" style="--pc:${_pi.color};" title="Voir le détail">
        ${medal}
        <div class="comp-res-content">
          <div class="comp-res-top">
            <span class="comp-res-name"><span style="color:${_pi.color};">${c.name}</span></span>
            <span class="comp-res-date">${dateLabel(c)}</span>
            <button class="comp-del" data-id="${c.id}" title="Supprimer">×</button>
          </div>
          ${metricsHtml}
        </div>
      </div>`;
    }).join('') : '<div class="comp-empty">Aucune compétition passée.</div>';
  }
}
window.renderCompetitionsPage = renderCompetitionsPage;

// Contexte pour la génération de plan IA (prochaine compétition, forme, volume récent).
window.coachGetPlanContext = function () {
  const comps = loadCompetitions().map(c => {
    let startDate = c.date;
    if (c.stages && Array.isArray(c.stagesList) && c.stagesList.length) {
      const ds = c.stagesList.map(s => s.date).filter(Boolean).sort();
      if (ds.length) startDate = ds[0];
    }
    return { ...c, dateObj: new Date(startDate + 'T12:00:00'), startDate };
  }).filter(c => c.dateObj >= today).sort((a, b) => a.dateObj - b.dateObj);
  const next = comps[0] || null;

  const last = (Array.isArray(data) && data.length) ? data[data.length - 1] : null;
  const forme = {
    ctl: last && Number.isFinite(last.ctl) ? Math.round(last.ctl) : null,
    atl: last && Number.isFinite(last.atl) ? Math.round(last.atl) : null,
    tsb: last && Number.isFinite(last.tsb) ? Math.round(last.tsb) : null,
  };

  // Volume des 28 derniers jours
  const from = new Date(today); from.setDate(from.getDate() - 28);
  let mins = 0, sessions = 0;
  const sportCount = {};
  for (const d of (data || [])) {
    if (!(d.date >= from && d.date <= today)) continue;
    mins += d.duration || 0;
    const acts = d.activities || [];
    if (acts.length || d.sessionName) sessions++;
    for (const a of acts) {
      const k = window.activitySportColorKey ? window.activitySportColorKey(a) : (a.sport || 'autre');
      sportCount[k] = (sportCount[k] || 0) + 1;
    }
  }
  const sportPrincipal = Object.keys(sportCount).sort((a, b) => sportCount[b] - sportCount[a])[0] || 'cyclisme';

  return {
    today: toIsoDate(today),
    competition: next ? (() => {
      const stagesList = Array.isArray(next.stagesList) ? next.stagesList : [];
      const gpxPresent = !!(next.gpxContent || next.gpxName) || stagesList.some(s => s.gpxContent || s.gpxName);
      const sumKm = stagesList.reduce((a, s) => a + (Number(s.km) || 0), 0);
      const sumDplus = stagesList.reduce((a, s) => a + (Number(s.dplus) || 0), 0);
      const km = Number(next.km) || sumKm || null;
      const dplus = Number(next.dplus) || Number(next.course_dplus) || sumDplus || null;
      return {
        nom: next.name,
        date: toIsoDate(next.dateObj),
        joursAvant: Math.ceil((next.dateObj - today) / 86400000),
        priorite: compPrio(next.priority).key,
        parcours: {
          gpx_present: gpxPresent,            // si false → ne PAS inventer le profil du parcours
          distance_km: km,
          denivele_m: dplus,
          type: fmtMinToTime(next.target) || null,
        },
      };
    })() : null,
    forme,
    volume_recent: {
      heures_par_semaine: Math.round((mins / 60 / 4) * 10) / 10,
      seances_par_semaine: Math.round((sessions / 4) * 10) / 10,
    },
    sport_principal: sportPrincipal,
  };
};

document.getElementById('comp-add').addEventListener('click', async () => {
  const name = document.getElementById('comp-name').value.trim();
  const date = document.getElementById('comp-date').value;
  const priority = document.getElementById('comp-priority').value;
  if (!name || !date) {
    await appAlert({
      title: 'Champs manquants',
      message: 'Renseigne au moins le nom et la date.',
    });
    return;
  }
  const comps = loadCompetitions();
  comps.push({ id: Date.now().toString(), name, date, priority });
  saveCompetitions(comps);
  document.getElementById('comp-name').value = '';
  document.getElementById('comp-date').value = '';
  renderCompList();
  renderCompetitionsPage();
  renderCalendar();
});

// Handler de clic partagé entre la carte du calendrier (#comp-list) et la page Compétitions.
function _handleCompClick(e) {
  // Clic sur la croix de suppression
  if (e.target.classList.contains('comp-del')) {
    e.stopPropagation();
    const id = e.target.dataset.id;
    const comps = loadCompetitions().filter(c => c.id !== id);
    saveCompetitions(comps);
    renderCompList();
    renderCompetitionsPage();
    renderCalendar();
    return;
  }
  // Clic sur une carte de compé (ligne, hero, carte résultat) → ouvre le détail
  const item = e.target.closest('[data-comp-id]');
  if (!item) return;
  const compId = item.dataset.compId;
  if (!compId) return;
  const comp = loadCompetitions().find(c => c.id === compId);
  if (!comp) return;
  // Pour course par étapes : ouvrir la 1ère étape ; sinon la date principale
  let openDate = comp.date;
  if (comp.stages && Array.isArray(comp.stagesList) && comp.stagesList.length) {
    const dates = comp.stagesList.map(s => s.date).filter(Boolean).sort();
    if (dates.length) openDate = dates[0];
  }
  if (openDate && typeof openSessionModal === 'function') {
    const isPast = new Date(openDate + 'T12:00:00') < today;
    openSessionModal(openDate, isPast ? 'realise' : 'prevu');
  }
}
document.getElementById('comp-list')?.addEventListener('click', _handleCompClick);
document.getElementById('comp-hero')?.addEventListener('click', _handleCompClick);
document.getElementById('comp-page-upcoming')?.addEventListener('click', _handleCompClick);
document.getElementById('comp-page-past')?.addEventListener('click', _handleCompClick);

// ========= MODAL D'AJOUT DE COMPÉTITION =========
// === Custom dropdown qui remplace les <select> natifs ===
// Le <select> reste dans le DOM (caché) pour stocker la valeur, on construit un widget par-dessus
function enhanceSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel || sel._enhanced) return;
  sel._enhanced = true;
  // Cache le select natif
  sel.style.display = 'none';
  sel.tabIndex = -1;

  // Wrapper
  const wrap = document.createElement('div');
  wrap.className = 'custom-select';
  wrap.tabIndex = 0;

  // Bouton qui affiche la valeur courante
  const btn = document.createElement('div');
  btn.className = 'custom-select-btn';
  btn.innerHTML = '<span class="custom-select-label">—</span><span class="custom-select-arrow"></span>';
  wrap.appendChild(btn);

  // Panel des options
  const panel = document.createElement('div');
  panel.className = 'custom-select-panel';
  wrap.appendChild(panel);

  // Insère après le select
  sel.parentNode.insertBefore(wrap, sel.nextSibling);

  function rebuildPanel() {
    panel.innerHTML = '';
    // Pour chaque <optgroup> ou <option> direct
    Array.from(sel.children).forEach(child => {
      if (child.tagName === 'OPTGROUP') {
        const og = document.createElement('div');
        og.className = 'cs-group';
        og.textContent = child.label;
        panel.appendChild(og);
        Array.from(child.children).forEach(opt => panel.appendChild(buildOption(opt)));
      } else if (child.tagName === 'OPTION') {
        panel.appendChild(buildOption(child));
      }
    });
  }
  function buildOption(opt) {
    const item = document.createElement('div');
    item.className = 'cs-option';
    item.dataset.value = opt.value;
    item.textContent = opt.textContent;
    if (sel.value === opt.value) item.classList.add('selected');
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      updateLabel();
      panel.querySelectorAll('.cs-option').forEach(o => o.classList.remove('selected'));
      item.classList.add('selected');
      closePanel();
    });
    return item;
  }
  function updateLabel() {
    const selected = sel.options[sel.selectedIndex];
    const labEl = btn.querySelector('.custom-select-label');
    const full = selected ? selected.textContent : '—';
    labEl.textContent = full;
    // Pas la place pour le nom complet ? on retire les emojis de tête
    // (ex : "🏊🚴🏃 Triathlon" tronqué -> "Triathlon" lisible)
    // setTimeout et non rAF : rAF est gelé fenêtre en arrière-plan
    setTimeout(() => {
      if (labEl.scrollWidth > labEl.clientWidth + 1) {
        const noEmoji = full.replace(/^[^\p{L}\p{N}]+\s*/u, '');
        if (noEmoji && noEmoji !== full) labEl.textContent = noEmoji;
      }
    }, 0);
  }
  function openPanel() {
    rebuildPanel();
    wrap.classList.add('open');
    // Scroll vers l'option sélectionnée
    const sel_ = panel.querySelector('.cs-option.selected');
    if (sel_) sel_.scrollIntoView({ block: 'nearest' });
    // Ferme au clic en dehors
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  }
  function closePanel() {
    wrap.classList.remove('open');
    document.removeEventListener('mousedown', onOutside);
  }
  function onOutside(e) {
    if (!wrap.contains(e.target)) closePanel();
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.contains('open') ? closePanel() : openPanel();
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      wrap.classList.contains('open') ? closePanel() : openPanel();
    }
  });

  // Init
  updateLabel();
  // Si le select change depuis l'extérieur, met à jour le label
  sel._customUpdate = updateLabel;
}

// === Sport select : peuple avec tous les sports SPORTS_CATALOG groupés par catégorie ===
function populateSportSelect(selectId, defaultValue) {
  const sel = document.getElementById(selectId);
  if (!sel || !window.SPORTS_CATALOG) return;
  // Groupe les sports par catégorie
  const groups = {};
  for (const [rawType, info] of Object.entries(window.SPORTS_CATALOG)) {
    const cat = info.category || 'autre';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ rawType, fr: info.fr, icon: info.icon || '' });
  }
  // Ordre d'affichage des catégories
  const catOrder = ['triathlon', 'cyclisme', 'course', 'natation', 'musculation', 'autre'];
  const catLabels = {
    triathlon: '🏊🚴🏃 Triathlon',
    cyclisme: '🚴 Cyclisme',
    course: '🏃 Course à pied',
    natation: '🏊 Natation',
    musculation: '🏋️ Musculation',
    autre: '📦 Autre',
  };
  // Vide et reconstruit
  sel.innerHTML = '';
  for (const cat of catOrder) {
    if (!groups[cat]) continue;
    const og = document.createElement('optgroup');
    og.label = catLabels[cat] || cat;
    // Tri alphabétique dans chaque catégorie
    groups[cat].sort((a, b) => a.fr.localeCompare(b.fr, 'fr'));
    for (const s of groups[cat]) {
      const opt = document.createElement('option');
      opt.value = s.rawType; // ex: "Ride", "AlpineSki" — pour avoir le sport Strava exact
      opt.textContent = `${s.icon ? s.icon + ' ' : ''}${s.fr}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  if (defaultValue) sel.value = defaultValue;
  // Si le select a déjà été enhanced, refresh le label
  if (sel._customUpdate) sel._customUpdate();
  // Sinon, l'enhance maintenant
  enhanceSelect(selectId);
}
// Peuple à l'init (si SPORTS_CATALOG déjà chargé), sinon différé à l'ouverture de la modal
if (window.SPORTS_CATALOG) {
  populateSportSelect('comp-modal-sport', 'Ride');
  populateSportSelect('train-modal-sport', 'Ride');
}

// === File picker custom (au lieu du bouton "Choisir un fichier" natif) ===
function initFilePickers() {
  document.querySelectorAll('.file-picker').forEach(picker => {
    if (picker._wired) return;
    picker._wired = true;
    const targetId = picker.getAttribute('data-target');
    const input = targetId ? document.getElementById(targetId) : picker.querySelector('input[type="file"]');
    const btn = picker.querySelector('.file-picker-btn');
    const label = picker.querySelector('.file-picker-label');
    const clearBtn = picker.querySelector('.file-picker-clear');
    const defaultLabel = label.textContent;
    if (!input || !btn || !label) return;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      input.click();
    });
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (f) {
        label.textContent = f.name;
        picker.classList.add('has-file');
        if (clearBtn) clearBtn.hidden = false;
      } else {
        label.textContent = defaultLabel;
        picker.classList.remove('has-file');
        if (clearBtn) clearBtn.hidden = true;
      }
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        input.value = '';
        label.textContent = defaultLabel;
        picker.classList.remove('has-file');
        clearBtn.hidden = true;
      });
    }
  });
}
initFilePickers();

// === Time stepper (heure avec flèches haut/bas) ===
// Step: +/- 1h pour heure, +/- 5 min pour minutes
function initTimeSteppers() {
  document.querySelectorAll('.time-stepper').forEach(stepper => {
    if (stepper._wired) return;
    stepper._wired = true;
    const targetId = stepper.getAttribute('data-target');
    const hiddenInput = targetId ? document.getElementById(targetId) : null;

    function read() {
      const h = parseInt(stepper.querySelector('.time-val[data-part="hour"]').textContent, 10) || 0;
      const m = parseInt(stepper.querySelector('.time-val[data-part="min"]').textContent, 10) || 0;
      return { h, m };
    }
    function write(h, m) {
      // Normalise (wrap)
      h = ((h % 24) + 24) % 24;
      m = ((m % 60) + 60) % 60;
      stepper.querySelector('.time-val[data-part="hour"]').textContent = h.toString().padStart(2, '0');
      stepper.querySelector('.time-val[data-part="min"]').textContent = m.toString().padStart(2, '0');
      if (hiddenInput) hiddenInput.value = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
    // Init hidden input depuis l'état affiché
    const cur = read();
    write(cur.h, cur.m);

    stepper.addEventListener('click', (e) => {
      const btn = e.target.closest('.time-arrow');
      if (!btn) return;
      e.preventDefault();
      const part = btn.getAttribute('data-part');
      const dir = parseInt(btn.getAttribute('data-dir'), 10);
      const { h, m } = read();
      if (part === 'hour') write(h + dir, m);
      else if (part === 'min') write(h, m + dir * 5);
    });
  });
}
// Helper public pour reset un stepper à une heure donnée (ex: openCompModal)
window.resetTimeStepper = function(targetId, h = 12, m = 0) {
  const stepper = document.querySelector(`.time-stepper[data-target="${targetId}"]`);
  if (!stepper) return;
  stepper.querySelector('.time-val[data-part="hour"]').textContent = h.toString().padStart(2, '0');
  stepper.querySelector('.time-val[data-part="min"]').textContent = m.toString().padStart(2, '0');
  const hidden = document.getElementById(targetId);
  if (hidden) hidden.value = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};
initTimeSteppers();

// Custom dropdowns pour mois ET année dans Flatpickr (au lieu du select natif moche)
// Approche : on REMPLACE complètement le contenu de .flatpickr-current-month
function attachCustomMonthDropdown(monthBox, fpInstance) {
  if (monthBox._customMonthAttached) return;
  monthBox._customMonthAttached = true;

  const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  // Sauvegarde du contenu original au cas où on doive le restaurer
  const originalHTML = monthBox.innerHTML;
  // On vide et reconstruit le contenu du header
  monthBox.innerHTML = '';
  monthBox.classList.add('fp-cm-custom');

  function buildBtn(label, extraClass) {
    const wrap = document.createElement('div');
    wrap.className = 'fp-cs-wrap';
    const btn = document.createElement('div');
    btn.className = 'fp-cs-btn ' + (extraClass || '');
    btn.innerHTML = `<span class="fp-cs-label">${label}</span><span class="fp-cs-arrow"></span>`;
    wrap.appendChild(btn);
    const panel = document.createElement('div');
    panel.className = 'fp-cs-panel';
    wrap.appendChild(panel);
    return { wrap, btn, panel };
  }

  // Panels en body (pour échapper à tout container avec overflow:hidden / z-index trop bas)
  function buildBody(extraClass) {
    const panel = document.createElement('div');
    panel.className = 'fp-cs-panel-body ' + (extraClass || '');
    // Le panneau est dans <body>, hors du calendrier Flatpickr : sans ça, le
    // mousedown serait vu comme un "clic extérieur" et Flatpickr fermerait avant
    // que le clic sur l'option n'aboutisse → la sélection mois/année serait perdue.
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(panel);
    return panel;
  }

  // === MOIS ===
  const m = buildBtn(monthNames[fpInstance.currentMonth], 'fp-month-btn');
  m.panel.remove(); // on n'utilise pas le panel inline, on en crée un dans body
  const mPanel = buildBody('fp-month-panel-body');
  for (let i = 0; i < 12; i++) {
    const it = document.createElement('div');
    it.className = 'fp-cs-option';
    it.textContent = monthNames[i];
    it.dataset.month = i;
    it.addEventListener('click', (e) => {
      e.stopPropagation();
      // On garde le jour courant (borné au dernier jour du mois cible) et on
      // VALIDE la date → le changement se sauvegarde sans avoir à cliquer un jour.
      const cur = fpInstance.selectedDates[0] || new Date(fpInstance.currentYear, fpInstance.currentMonth, 1);
      const maxDay = new Date(fpInstance.currentYear, i + 1, 0).getDate();
      fpInstance.setDate(new Date(fpInstance.currentYear, i, Math.min(cur.getDate(), maxDay)), true);
      syncLabels();
      closeAll();
    });
    mPanel.appendChild(it);
  }
  m.btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel(m.btn, mPanel, fpInstance.currentMonth);
  });
  monthBox.appendChild(m.wrap);

  // === ANNÉE ===
  const y = buildBtn(String(fpInstance.currentYear), 'fp-year-btn');
  y.panel.remove();
  const yPanel = buildBody('fp-year-panel-body');
  function rebuildYears(centerYear) {
    yPanel.innerHTML = '';
    for (let yy = centerYear - 8; yy <= centerYear + 8; yy++) {
      const it = document.createElement('div');
      it.className = 'fp-cs-option';
      it.textContent = yy;
      it.dataset.year = yy;
      if (yy === fpInstance.currentYear) it.classList.add('selected');
      it.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = fpInstance.selectedDates[0] || new Date(fpInstance.currentYear, fpInstance.currentMonth, 1);
        const maxDay = new Date(yy, fpInstance.currentMonth + 1, 0).getDate();
        fpInstance.setDate(new Date(yy, fpInstance.currentMonth, Math.min(cur.getDate(), maxDay)), true);
        syncLabels();
        closeAll();
      });
      yPanel.appendChild(it);
    }
  }
  rebuildYears(fpInstance.currentYear);
  y.btn.addEventListener('click', (e) => {
    e.stopPropagation();
    rebuildYears(fpInstance.currentYear);
    togglePanel(y.btn, yPanel, null, true);
  });
  monthBox.appendChild(y.wrap);

  // Stocke refs panels pour syncLabels / closeAll
  const allPanels = [mPanel, yPanel];
  const allBtns = [m.btn, y.btn];

  // Nettoyage si la modal/calendrier se ferme
  fpInstance.config.onClose = (fpInstance.config.onClose || []).concat([() => closeAll()]);
  // Nettoyage panel si Flatpickr est détruit
  const origDestroy = fpInstance.destroy.bind(fpInstance);
  fpInstance.destroy = function() {
    allPanels.forEach(p => p.remove());
    return origDestroy();
  };

  // === Sync au changement (via les flèches prev/next ou via select date) ===
  function syncLabels() {
    m.btn.querySelector('.fp-cs-label').textContent = monthNames[fpInstance.currentMonth];
    y.btn.querySelector('.fp-cs-label').textContent = String(fpInstance.currentYear);
  }
  // On hook nos handlers en config (Flatpickr accepte un tableau)
  const addHook = (key, fn) => {
    if (!fpInstance.config[key]) fpInstance.config[key] = [];
    else if (!Array.isArray(fpInstance.config[key])) fpInstance.config[key] = [fpInstance.config[key]];
    fpInstance.config[key].push(fn);
  };
  addHook('onMonthChange', syncLabels);
  addHook('onYearChange', syncLabels);
  addHook('onChange', syncLabels);

  function closeAll() {
    allPanels.forEach(p => p.classList.remove('open'));
    allBtns.forEach(b => b.classList.remove('open'));
    document.removeEventListener('mousedown', onOutside);
  }
  function positionPanel(btn, panel) {
    const rect = btn.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.left = (rect.left + rect.width / 2) + 'px';
    panel.style.transform = 'translateX(-50%)';
  }
  function togglePanel(btn, panel, highlightIdx, isYear) {
    const wasOpen = panel.classList.contains('open');
    closeAll();
    if (!wasOpen) {
      panel.querySelectorAll('.fp-cs-option').forEach((it, i) => {
        if (isYear) {
          it.classList.toggle('selected', parseInt(it.dataset.year, 10) === fpInstance.currentYear);
        } else {
          it.classList.toggle('selected', i === highlightIdx);
        }
      });
      positionPanel(btn, panel);
      panel.classList.add('open');
      btn.classList.add('open');
      setTimeout(() => {
        const sel = panel.querySelector('.fp-cs-option.selected');
        if (sel) sel.scrollIntoView({ block: 'center' });
        document.addEventListener('mousedown', onOutside);
      }, 0);
    }
  }
  function onOutside(e) {
    if (!monthBox.contains(e.target) && !allPanels.some(p => p.contains(e.target))) closeAll();
  }
}

// Init Flatpickr (date pickers stylisés) sur tous les inputs date/time
function initFlatpickrAll() {
  if (typeof flatpickr === 'undefined') return;
  // Locale française
  if (window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.fr) {
    flatpickr.localize(flatpickr.l10ns.fr);
  }
  // Helper : empêche complètement la caret de l'input visible (cliquable mais pas éditable)
  function lockInput(t) {
    if (!t) return;
    t.setAttribute('readonly', 'readonly');
    t.setAttribute('inputmode', 'none');
    t.setAttribute('tabindex', '0');
    // Empêche le caret de se positionner même au clic
    t.addEventListener('mousedown', (e) => {
      // On laisse le clic ouvrir Flatpickr, mais on annule la sélection texte
      t.blur();
      setTimeout(() => t.focus(), 0);
      // Désélectionne immédiatement toute sélection en cours sur le document
      if (window.getSelection) window.getSelection().removeAllRanges();
    });
    t.addEventListener('focus', () => {
      // Pas de caret visible
      t.setSelectionRange && t.setSelectionRange(0, 0);
    });
    t.addEventListener('select', () => {
      t.setSelectionRange && t.setSelectionRange(0, 0);
    });
  }

  // Dates : format dd/mm/yyyy à l'affichage, valeur stockée en yyyy-mm-dd
  document.querySelectorAll('input[type="date"]').forEach(el => {
    if (el._flatpickr) return;
    flatpickr(el, {
      dateFormat: 'Y-m-d',
      altInput: true,
      // "Forme & fatigue" (pleine largeur) en lettres ; les colonnes étroites en chiffres (compact, 1 ligne).
      altFormat: (el.id === 'load-from' || el.id === 'load-to') ? 'j F Y' : 'd/m/Y',
      allowInput: false,
      disableMobile: true,
      clickOpens: true,
      monthSelectorType: 'static', // pas de select natif moche, navigation par flèches uniquement
      onReady(_, __, instance) {
        if (instance.altInput) {
          instance.altInput.placeholder = 'Sélectionner une date';
          instance.altInput.classList.add('fp-with-icon', 'fp-icon-date');
          lockInput(instance.altInput);
        }
        // Rend le mois cliquable pour ouvrir notre custom dropdown
        try {
          const monthBox = instance.calendarContainer.querySelector('.flatpickr-current-month');
          if (monthBox && typeof attachCustomMonthDropdown === 'function') {
            attachCustomMonthDropdown(monthBox, instance);
          }
        } catch (err) {
          console.error('[attachCustomMonthDropdown]', err);
        }
      },
    });
  });
  // Plus de Flatpickr pour les heures : on utilise le time-stepper custom
  initTimeSteppers();
}
// Init initial + ré-init si la liste change
initFlatpickrAll();

// === Options "Type d'épreuve" selon le sport choisi ===
// Pour Cyclisme : 2 choix (Course en ligne, Contre la montre)
// Pour les autres sports : pas d'options spécifiques pour l'instant (champ vide)
// Type d'épreuve : réservé au CYCLISME (Circuit / Course en ligne / CLM)
const CYCLING_TYPE_OPTIONS = ['Circuit', 'Course en ligne', 'Contre la montre'];

function populateTypeSelectForSport(rawType) {
  const sel = document.getElementById('comp-modal-type');
  if (!sel) return;
  const isCyc = (typeof getSportCategory === 'function') && getSportCategory(rawType) === 'cyclisme';
  // Champ visible uniquement pour le cyclisme
  const wrap = sel.closest('label') || (sel.parentElement && sel.parentElement.closest('.form-field'));
  const cs = sel.parentElement && sel.parentElement.classList.contains('custom-select') ? sel.parentElement : null;
  const holder = (cs && cs.closest('label')) || wrap;
  if (holder) holder.style.display = isCyc ? '' : 'none';
  const opts = isCyc ? CYCLING_TYPE_OPTIONS : [];
  const prev = sel.value;
  sel.innerHTML = '';
  // Option vide par défaut (texte libre / non précisé)
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = opts.length ? 'Sélectionner...' : 'Non précisé';
  sel.appendChild(empty);
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  });
  // Réessaye de garder la valeur précédente si possible
  if (prev && Array.from(sel.options).some(o => o.value === prev)) {
    sel.value = prev;
  } else {
    sel.value = '';
  }
  // Re-enhance le custom dropdown
  if (typeof enhanceSelect === 'function') enhanceSelect('comp-modal-type');
  if (sel._customUpdate) sel._customUpdate();
  if (typeof updateLapsVisibility === 'function') updateLapsVisibility();
}

// « Nombre de tours » : uniquement pour une épreuve en Circuit
function updateLapsVisibility() {
  const typeSel = document.getElementById('comp-modal-type');
  const laps = document.getElementById('comp-modal-laps');
  const lab = laps && laps.closest('label');
  if (!lab) return;
  lab.style.display = (typeSel && typeSel.value === 'Circuit') ? '' : 'none';
  if (typeof reflowCompParcoursRows === 'function') reflowCompParcoursRows();
}
document.getElementById('comp-modal-type')?.addEventListener('change', updateLapsVisibility);

// Écoute les changements de sport pour mettre à jour les options du type
(function wireTypeSelectToSport() {
  const sportSel = document.getElementById('comp-modal-sport');
  if (!sportSel) return;
  sportSel.addEventListener('change', () => populateTypeSelectForSport(sportSel.value));
})();

// ========= GESTION DES ÉTAPES (course par étapes) =========
let stagesData = []; // [{name, date, time, sport, type, km, dplus, target, laps, notes, gpxName, gpxContent}, ...]
let activeStageIdx = 0;

// Champs gérés par les étapes (tout sauf le nom global qui reste partagé)
// Helpers temps <-> minutes (le "temps cible" compet est desormais stocke en minutes, comme duration)
function parseTimeToMin(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v);
  var s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
  var m = s.match(/(\d+)\s*[h:]\s*(\d{0,2})/);
  if (m) return (+m[1]) * 60 + (m[2] ? +m[2] : 0);
  var m2 = s.match(/(\d+)\s*min/);
  if (m2) return +m2[1];
  var n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}
function fmtMinToTime(min) {
  if (min == null || min === '') return '';
  min = Math.round(+min);
  if (isNaN(min) || min <= 0) return '';
  var h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (h + 'h' + String(m).padStart(2, '0')) : (m + ' min');
}
const STAGE_FIELDS = ['date','time','type','km','dplus','target','laps','notes','sport','priority','gpx'];

// Priority et Sport sont GLOBAUX à la compé (ne changent pas par étape)
// → ils ne sont pas inclus dans le snapshot stage
function readFormToStage() {
  const stage = {};
  stage.date = document.getElementById('comp-modal-date').value || '';
  stage.time = document.getElementById('comp-modal-time').value || '';
  stage.type = document.getElementById('comp-modal-type').value || '';
  stage.km = document.getElementById('comp-modal-km').value || '';
  stage.dplus = document.getElementById('comp-modal-dplus').value || '';
  stage.target = parseTimeToMin(document.getElementById('comp-modal-target').value);
  stage.laps = document.getElementById('comp-modal-laps').value || '';
  stage.notes = document.getElementById('comp-modal-notes').value || '';
  const gpxInput = document.getElementById('comp-modal-gpx');
  const newFile = gpxInput && gpxInput.files[0] ? gpxInput.files[0] : null;
  if (newFile) {
    // L'utilisateur a uploadé un nouveau fichier pour cette étape
    stage.gpxFile = newFile;
    stage.gpxName = newFile.name;
    stage.gpxContent = null; // sera lu en async au save
  } else {
    // Pas de nouveau fichier : on PRÉSERVE le gpx existant (en mémoire dans stagesData)
    const existing = (typeof stagesData !== 'undefined' && stagesData[activeStageIdx]) || {};
    stage.gpxFile = existing.gpxFile || null;
    stage.gpxName = existing.gpxName || null;
    stage.gpxContent = existing.gpxContent || null;
  }
  return stage;
}

function writeStageToForm(stage) {
  if (!stage) stage = {};
  // NOTE: priority et sport NE sont PAS touchés (globaux à la compé)
  document.getElementById('comp-modal-date').value = stage.date || '';
  document.getElementById('comp-modal-type').value = stage.type || '';
  // km/dplus : si GPX présent pour cette étape, on calcule depuis le fichier (vérité terrain)
  let effKm = stage.km, effDplus = stage.dplus;
  const lapsForStage = parseInt(stage.laps, 10) || 1;
  if (stage.gpxContent && typeof extractGpxStats === 'function') {
    const gs = extractGpxStats(stage.gpxContent, lapsForStage);
    if (gs) {
      effKm = gs.km;
      effDplus = gs.dplus;
    }
  }
  document.getElementById('comp-modal-km').value = effKm || '';
  document.getElementById('comp-modal-dplus').value = effDplus || '';
  document.getElementById('comp-modal-target').value = fmtMinToTime(stage.target);
  document.getElementById('comp-modal-laps').value = stage.laps || '';
  document.getElementById('comp-modal-notes').value = stage.notes || '';
  // Time stepper
  const [h, m] = (stage.time || '12:00').split(':').map(n => parseInt(n, 10) || 0);
  if (window.resetTimeStepper) window.resetTimeStepper('comp-modal-time', h, m);
  // Flatpickr date
  const dateInput = document.getElementById('comp-modal-date');
  if (dateInput && dateInput._flatpickr) {
    if (stage.date) dateInput._flatpickr.setDate(stage.date, false);
    else dateInput._flatpickr.clear();
  }
  // Custom select Type (priority/sport non touchés)
  const typeEl = document.getElementById('comp-modal-type');
  if (typeEl && typeEl._customUpdate) typeEl._customUpdate();
  // GPX picker : reset visual
  const gpxInput = document.getElementById('comp-modal-gpx');
  if (gpxInput) {
    gpxInput.value = '';
    const picker = gpxInput.closest('.file-picker');
    if (picker) {
      picker.classList.remove('has-file');
      const lbl = picker.querySelector('.file-picker-label');
      if (lbl) lbl.textContent = stage.gpxName || 'Choisir un fichier GPX';
      if (stage.gpxName) picker.classList.add('has-file');
      const clr = picker.querySelector('.file-picker-clear');
      if (clr) clr.hidden = !stage.gpxName;
    }
  }
}

function renderStageTabs() {
  const list = document.getElementById('comp-stage-tabs-list');
  if (!list) return;
  // Garde-fou : si stagesData vide, init avec 2 étapes vides
  if (!stagesData || stagesData.length < 2) {
    stagesData = [stagesData[0] || {}, stagesData[1] || {}];
    activeStageIdx = 0;
  }
  const hasClose = stagesData.length > 2;
  list.innerHTML = stagesData.map((s, i) => `
    <button type="button" class="stage-tab${i === activeStageIdx ? ' active' : ''}${hasClose ? ' has-close' : ''}" data-stage="${i}">
      <span class="stage-tab-label" data-long="Étape ${i + 1}" data-short="E${i + 1}">Étape ${i + 1}</span>
      ${hasClose ? `<span class="stage-tab-close" data-close="${i}" title="Supprimer cette étape">×</span>` : ''}
    </button>
  `).join('');
  // Wire clicks
  list.querySelectorAll('.stage-tab').forEach(t => {
    t.addEventListener('click', (e) => {
      if (e.target.classList.contains('stage-tab-close')) return;
      const idx = +t.dataset.stage;
      if (idx === activeStageIdx) return;
      stagesData[activeStageIdx] = readFormToStage();
      activeStageIdx = idx;
      writeStageToForm(stagesData[activeStageIdx]);
      renderStageTabs();
    });
  });
  list.querySelectorAll('.stage-tab-close').forEach(c => {
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = +c.dataset.close;
      if (stagesData.length <= 2) return;
      stagesData.splice(idx, 1);
      if (activeStageIdx >= stagesData.length) activeStageIdx = stagesData.length - 1;
      writeStageToForm(stagesData[activeStageIdx]);
      renderStageTabs();
    });
  });
  // Désactive visuellement le + si on atteint la limite (10)
  const addBtn = document.getElementById('comp-stage-tab-add');
  if (addBtn) {
    if (stagesData.length >= 10) {
      addBtn.disabled = true;
      addBtn.style.opacity = '0.3';
      addBtn.style.cursor = 'not-allowed';
      addBtn.title = 'Maximum 10 étapes';
    } else {
      addBtn.disabled = false;
      addBtn.style.opacity = '';
      addBtn.style.cursor = '';
      addBtn.title = 'Ajouter une étape';
    }
  }
  // Après render : check si les tabs débordent et raccourcir si besoin
  adjustStageTabLabels();
}

// Détecte si UN des labels passe à la ligne (le chiffre va sur une 2e ligne)
// et bascule TOUS les labels en version courte (E1, E2, etc.)
function adjustStageTabLabels() {
  const list = document.getElementById('comp-stage-tabs-list');
  if (!list) return;
  const labels = list.querySelectorAll('.stage-tab-label');
  // Reset en version longue
  labels.forEach(l => { l.textContent = l.dataset.long; });
  // Mesure : si un label a une hauteur > 1 ligne (passage à la ligne), bascule en short
  requestAnimationFrame(() => {
    let mustShorten = false;
    // Compare scrollHeight (incluant wrapping) vs hauteur 1 ligne (~22px pour font 13)
    const oneLineMaxHeight = 22;
    labels.forEach(l => {
      // Méthode 1 : si le contenu wrap, offsetHeight dépasse une ligne
      if (l.offsetHeight > oneLineMaxHeight) mustShorten = true;
      // Méthode 2 : si le texte est tronqué horizontalement (avec nowrap)
      if (l.scrollWidth > l.clientWidth + 1) mustShorten = true;
    });
    if (mustShorten) {
      labels.forEach(l => { l.textContent = l.dataset.short; });
    }
  });
}

// ResizeObserver pour re-vérifier si la modal change de taille (responsive)
if (typeof ResizeObserver !== 'undefined') {
  const list = document.getElementById('comp-stage-tabs-list');
  if (list) new ResizeObserver(() => adjustStageTabLabels()).observe(list);
}

function setStagesMode(on) {
  const tabsBar = document.getElementById('comp-stages-tabs');
  if (!tabsBar) return;
  if (on) {
    // 1ère activation : snapshot le form en stage 1 + ajoute un stage 2 vide
    // Réactivation : on garde toutes les étapes en mémoire, mais on sync le form courant
    // (qui a pu être édité en mode simple) sur l'étape 0
    if (stagesData.length >= 2) {
      stagesData[0] = readFormToStage();
      activeStageIdx = Math.min(activeStageIdx, stagesData.length - 1);
    } else {
      const current = readFormToStage();
      stagesData = [current, {}];
      activeStageIdx = 0;
    }
    tabsBar.hidden = false;
    renderStageTabs();
    writeStageToForm(stagesData[activeStageIdx]);
  } else {
    // Avant de cacher, snapshot le form courant dans l'étape active
    // → si on réactive plus tard, on retrouve les éditions
    if (stagesData.length > 0) {
      stagesData[activeStageIdx] = readFormToStage();
    }
    tabsBar.hidden = true;
    // Affiche les valeurs de l'étape 0 (= valeurs "principales" de la compé)
    if (stagesData.length > 0) writeStageToForm(stagesData[0]);
    // /!\ NE PAS vider stagesData → on garde tout en mémoire pour réactivation
  }
}

// Wire le toggle stages
const stagesToggleEl = document.getElementById('comp-modal-stages-toggle');
if (stagesToggleEl) {
  stagesToggleEl.addEventListener('change', () => {
    setStagesMode(stagesToggleEl.checked);
  });
}
// Wire le bouton + d'ajout d'étape
const MAX_STAGES = 10;
const stageAddBtn = document.getElementById('comp-stage-tab-add');
if (stageAddBtn) {
  stageAddBtn.addEventListener('click', () => {
    if (stagesData.length >= MAX_STAGES) return; // limite à 10 étapes
    stagesData[activeStageIdx] = readFormToStage();
    stagesData.push({});
    activeStageIdx = stagesData.length - 1;
    writeStageToForm(stagesData[activeStageIdx]);
    renderStageTabs();
  });
}

// Helper : auto-remplit km et D+ depuis le GPX courant dans la modal compé,
// en multipliant par le nombre de tours saisi
function _autofillKmDplusFromCompGpx() {
  const gpxInput = document.getElementById('comp-modal-gpx');
  const kmInput = document.getElementById('comp-modal-km');
  const dplusInput = document.getElementById('comp-modal-dplus');
  if (!gpxInput || !kmInput || !dplusInput) return;
  const file = gpxInput.files && gpxInput.files[0];
  const lapsVal = parseInt(document.getElementById('comp-modal-laps').value, 10) || 1;
  // Source du contenu : soit nouveau fichier upload, soit contenu déjà en mémoire (mode édition)
  function applyStats(gpxContent) {
    if (!gpxContent || typeof extractGpxStats !== 'function') return;
    const stats = extractGpxStats(gpxContent, lapsVal);
    if (!stats) return;
    kmInput.value = stats.km;
    dplusInput.value = stats.dplus;
    // Sync aussi le snapshot stage si on est en mode étapes
    if (typeof stagesData !== 'undefined' && stagesData[activeStageIdx]) {
      stagesData[activeStageIdx].km = String(stats.km);
      stagesData[activeStageIdx].dplus = String(stats.dplus);
    }
  }
  if (file) {
    file.text().then(applyStats).catch(() => {});
  } else if (typeof stagesData !== 'undefined' && stagesData[activeStageIdx] && stagesData[activeStageIdx].gpxContent) {
    applyStats(stagesData[activeStageIdx].gpxContent);
  }
}

// ============================================================
// Adaptation des FORMULAIRES au sport sélectionné (natation -> distance en m,
// pas de D+/GPX ; musculation -> section Parcours masquée ; etc.).
// Conversion m<->km à l'affichage UNIQUEMENT : le stockage reste en km
// (input.dataset.distUnit porte l'unité affichée, lue au moment du save).
// ============================================================
function adaptSportForm(selectId, ids) {
  const sel = document.getElementById(selectId);
  if (!sel || !window.SportProfiles || !window.SportProfiles.formConfig) return;
  const cfg = window.SportProfiles.formConfig(sel.value);
  const kmInput = ids.km ? document.getElementById(ids.km) : null;
  if (kmInput) {
    const lab = kmInput.closest('label');
    const span = lab && lab.querySelector('span');
    const prev = kmInput.dataset.distUnit || 'km';
    const next = cfg.dist || 'km';
    if (prev !== next && kmInput.value !== '') {
      const v = parseFloat(kmInput.value);
      if (!isNaN(v)) kmInput.value = next === 'm' ? Math.round(v * 1000) : +(v / 1000).toFixed(2);
    }
    kmInput.dataset.distUnit = next;
    if (span) span.textContent = next === 'm' ? 'Distance (m)' : 'Distance (km)';
    if (lab) lab.style.display = cfg.dist ? '' : 'none';
  }
  if (ids.dplus) {
    const el = document.getElementById(ids.dplus);
    const lab = el && el.closest('label');
    if (lab) lab.style.display = cfg.dplus ? '' : 'none';
  }
  if (ids.gpx) {
    const g = document.getElementById(ids.gpx);
    const wrap = g && g.closest('.form-field');
    if (wrap) wrap.style.display = cfg.gpx ? '' : 'none';
  }
  if (ids.laps) {
    const l = document.getElementById(ids.laps);
    const lab2 = l && l.closest('label');
    const span2 = lab2 && lab2.querySelector('span');
    if (span2 && cfg.laps) span2.textContent = cfg.laps;
  }
  // Section Parcours entière (train-modal) : masquée si plus aucun champ dedans
  if (ids.hideSection && kmInput) {
    const sec = kmInput.closest('.add-sec');
    if (sec) sec.style.display = (cfg.dist || cfg.dplus || cfg.gpx) ? '' : 'none';
  }
}
// Lit une distance saisie en respectant l'unité affichée -> renvoie des KM
function readDistAsKm(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return null;
  const v = parseFloat(el.value);
  if (isNaN(v) || v <= 0) return null;
  return el.dataset.distUnit === 'm' ? +(v / 1000).toFixed(3) : v;
}
const adaptTrainSportForm = () => {
  adaptSportForm('train-modal-sport', { km: 'train-modal-km', dplus: 'train-modal-dplus', gpx: 'train-modal-gpx', hideSection: true });
  // Triathlon : 3 distances par discipline (pas en mode modèle bibliothèque)
  const sel = document.getElementById('train-modal-sport');
  const isTri = !window._templateMode && !!sel && typeof getSportCategory === 'function' && getSportCategory(sel.value) === 'triathlon';
  const triRow = document.getElementById('train-tri-fields');
  const kmLab = document.getElementById('train-modal-km')?.closest('label');
  if (triRow) triRow.hidden = !isTri;
  if (kmLab && isTri) kmLab.style.display = 'none';
};
// Re-compacte les rangées du bloc Parcours : les champs VISIBLES se regroupent
// 2 par ligne (les champs masqués par le sport laissaient des lignes à 1 seul champ).
function reflowCompParcoursRows() {
  const std = document.getElementById('comp-parcours-std');
  if (!std) return;
  const rows = Array.from(std.querySelectorAll('.add-sec-grid.g2'));
  if (!rows.length) return;
  const labels = rows.flatMap(r => Array.from(r.children));
  // Ordre canonique fixe (le déplacement de nœuds ne doit jamais le perturber)
  const ORDER = ['comp-modal-target', 'comp-modal-km', 'comp-modal-dplus', 'comp-modal-speed', 'comp-modal-laps'];
  const rank = (l) => { const inp = l.querySelector('input,select'); const i = inp ? ORDER.indexOf(inp.id) : -1; return i === -1 ? 99 : i; };
  labels.sort((a, b) => rank(a) - rank(b));
  const visible = labels.filter(l => l.style.display !== 'none');
  const hidden = labels.filter(l => l.style.display === 'none');
  const ordered = visible.concat(hidden);
  rows.forEach(r => { while (r.firstChild) r.removeChild(r.firstChild); });
  ordered.forEach((l, i) => rows[Math.min(Math.floor(i / 2), rows.length - 1)].appendChild(l));
  rows.forEach(r => { r.style.display = Array.from(r.children).some(c => c.style.display !== 'none') ? '' : 'none'; });
}

const adaptCompSportForm = () => {
  adaptSportForm('comp-modal-sport', { km: 'comp-modal-km', dplus: 'comp-modal-dplus', gpx: 'comp-modal-gpx', laps: 'comp-modal-laps' });
  // Pas de distance pour ce sport -> la vitesse moyenne n'a pas de sens non plus
  {
    const sel0 = document.getElementById('comp-modal-sport');
    const cfg0 = (sel0 && window.SportProfiles && window.SportProfiles.formConfig) ? window.SportProfiles.formConfig(sel0.value) : null;
    const spd0 = document.getElementById('comp-modal-speed');
    const spdLab = spd0 && spd0.closest('label');
    if (spdLab && cfg0) spdLab.style.display = cfg0.dist ? '' : 'none';
  }
  // Triathlon : bloc standard remplacé par les onglets Nat/T1/Vélo/T2/CAP
  const sel = document.getElementById('comp-modal-sport');
  const isTri = !!sel && typeof getSportCategory === 'function' && getSportCategory(sel.value) === 'triathlon';
  const std = document.getElementById('comp-parcours-std');
  const tri = document.getElementById('comp-parcours-tri');
  // Compét tri "legacy" (données dans temps cible/distance/D+ mais pas de segments) :
  // on laisse le bloc standard visible pour ne pas masquer les données existantes.
  if (std) std.hidden = isTri && !window._compEditLegacyStd;
  if (tri) tri.hidden = !isTri;
  if (typeof updateLapsVisibility === 'function') updateLapsVisibility();
  reflowCompParcoursRows();
};
document.getElementById('train-modal-sport')?.addEventListener('change', adaptTrainSportForm);
document.getElementById('comp-modal-sport')?.addEventListener('change', adaptCompSportForm);

// ============================================================
// TRIOS temps / distance / vitesse-allure auto-calculés + onglets triathlon.
// Règle : dès que 2 des 3 champs sont remplis, le 3e (vide ou auto) se calcule.
// Un champ rempli à la main perd son statut "auto" et n'est plus écrasé.
// ============================================================
// "1h20" -> 80 ; "25:30" -> 25.5 (mm:ss) ; "90" -> 90 min
function parseSegTime(v) {
  if (v == null || String(v).trim() === '') return null;
  const s2 = String(v).trim().toLowerCase();
  let m = s2.match(/^(\d+)\s*h\s*(\d{0,2})$/);
  if (m) return (+m[1]) * 60 + (m[2] ? +m[2] : 0);
  m = s2.match(/^(\d+):(\d{1,2})$/);
  if (m) return (+m[1]) + (+m[2]) / 60;          // mm:ss
  const n = parseFloat(s2.replace(',', '.'));
  return isNaN(n) ? null : n;
}
function fmtSegTime(min) {
  if (min == null || !isFinite(min) || min <= 0) return '';
  if (min >= 60) { const hh3 = Math.floor(min / 60), mm3 = Math.round(min % 60); return hh3 + 'h' + String(mm3).padStart(2, '0'); }
  const mm4 = Math.floor(min), ss4 = Math.round((min - mm4) * 60);
  return mm4 + ':' + String(ss4).padStart(2, '0');
}
// "1:45" -> 105 s ; "4:30" -> 270 s
function parsePace(v) {
  if (v == null || String(v).trim() === '') return null;
  const m = String(v).trim().match(/^(\d+):(\d{1,2})$/);
  if (m) return (+m[1]) * 60 + (+m[2]);
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n * 60;
}
function fmtPaceSec(sec) {
  if (sec == null || !isFinite(sec) || sec <= 0) return '';
  return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
}
// Câble un trio : cfg = { timeId, distId, rateId, mode: 'speed'|'pace_km'|'pace_100m' }
// time en min (parseSegTime OU parseTimeToMin pour le temps cible), dist selon champ, rate selon mode.
function wireTrio(cfg) {
  const t = document.getElementById(cfg.timeId), d = document.getElementById(cfg.distId), r = document.getElementById(cfg.rateId);
  if (!t || !d || !r || t._trioWired) return;
  t._trioWired = true;
  const readTime = () => (cfg.timeParse === 'target' ? parseTimeToMin(t.value) : parseSegTime(t.value));
  const readDist = () => {
    let v = parseFloat(String(d.value).replace(',', '.'));
    if (isNaN(v) || v <= 0) return null;
    if (d.dataset.distUnit === 'm' && cfg.mode === 'speed') v = v / 1000;  // vitesse km/h depuis des metres
    return v;
  };
  const readRate = () => (cfg.mode === 'speed' ? (parseFloat(String(r.value).replace(',', '.')) || null) : parsePace(r.value));
  // dist en km pour speed/pace_km ; en m pour pace_100m
  // Règle DÉTERMINISTE (recalcul même si les 3 champs sont remplis) :
  // - je modifie le TEMPS      -> la vitesse/allure se recalcule (distance = fait de terrain)
  // - je modifie la DISTANCE   -> la vitesse/allure se recalcule
  // - je modifie la VITESSE    -> le temps se recalcule
  // (si le champ prioritaire manque, on calcule celui qui est possible)
  const setRate = (tm, dv) => {
    if (cfg.mode === 'speed') r.value = +(dv / (tm / 60)).toFixed(1);
    else if (cfg.mode === 'pace_km') r.value = fmtPaceSec(tm * 60 / dv);
    else r.value = fmtPaceSec(tm * 60 / (dv / 100));
    r.dataset.auto = '1';
  };
  const setDist = (tm, rv) => {
    let dv;
    if (cfg.mode === 'speed') dv = +(rv * tm / 60).toFixed(1);
    else if (cfg.mode === 'pace_km') dv = +(tm * 60 / rv).toFixed(1);
    else dv = Math.round(tm * 60 / rv * 100);
    if (dv > 0) { d.value = (cfg.mode === 'speed' && d.dataset.distUnit === 'm') ? Math.round(dv * 1000) : dv; d.dataset.auto = '1'; }
  };
  const setTime = (dv, rv) => {
    let mins;
    if (cfg.mode === 'speed') mins = dv / rv * 60;
    else if (cfg.mode === 'pace_km') mins = dv * rv / 60;
    else mins = (dv / 100) * rv / 60;
    const out = cfg.timeParse === 'target' ? fmtMinToTime(Math.round(mins)) : fmtSegTime(mins);
    if (out) { t.value = out; t.dataset.auto = '1'; }
  };
  const compute = (changed) => {
    const tm = readTime(), dv = readDist(), rv = readRate();
    if (changed === 'time') {
      if (tm == null) return;
      if (dv != null) setRate(tm, dv);
      else if (rv != null) setDist(tm, rv);
    } else if (changed === 'dist') {
      if (dv == null) return;
      if (tm != null) setRate(tm, dv);
      else if (rv != null) setTime(dv, rv);
    } else {
      if (rv == null) return;
      if (dv != null) setTime(dv, rv);
      else if (tm != null) setDist(tm, rv);
    }
  };
  t.addEventListener('input', () => { delete t.dataset.auto; compute('time'); });
  d.addEventListener('input', () => { delete d.dataset.auto; compute('dist'); });
  r.addEventListener('input', () => { delete r.dataset.auto; compute('rate'); });
}
function wireCompTrios() {
  wireTrio({ timeId: 'comp-modal-target', distId: 'comp-modal-km', rateId: 'comp-modal-speed', mode: 'speed', timeParse: 'target' });
  wireTrio({ timeId: 'comp-tri-nat-time', distId: 'comp-tri-nat-dist', rateId: 'comp-tri-nat-pace', mode: 'pace_100m' });
  wireTrio({ timeId: 'comp-tri-bike-time', distId: 'comp-tri-bike-dist', rateId: 'comp-tri-bike-speed', mode: 'speed' });
  wireTrio({ timeId: 'comp-tri-run-time', distId: 'comp-tri-run-dist', rateId: 'comp-tri-run-pace', mode: 'pace_km' });
}
wireCompTrios();

// Onglets triathlon : bascule des panneaux + marquage "rempli"
(function wireTriTabs() {
  const tabs = document.getElementById('comp-tri-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tri-tab');
    if (!btn) return;
    tabs.querySelectorAll('.tri-tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('#comp-parcours-tri .tri-pane').forEach(pn => { pn.hidden = pn.dataset.pane !== btn.dataset.pane; });
  });
  // marque les onglets qui contiennent des valeurs
  document.querySelectorAll('#comp-parcours-tri input').forEach(inp => {
    inp.addEventListener('input', () => {
      document.querySelectorAll('#comp-parcours-tri .tri-pane').forEach(pn => {
        const filled = Array.from(pn.querySelectorAll('input')).some(i => i.value && i.type !== 'file');
        const tb = tabs.querySelector(`.tri-tab[data-pane="${pn.dataset.pane}"]`);
        if (tb) tb.classList.toggle('filled', filled);
      });
    });
  });
})();
function resetTriPanes() {
  document.querySelectorAll('#comp-parcours-tri input').forEach(i => { if (i.type !== 'file') { i.value = ''; delete i.dataset.auto; } });
  const g = document.getElementById('comp-tri-gpx'); if (g) g.value = '';
  document.querySelectorAll('#comp-tri-tabs .tri-tab').forEach((b, i2) => { b.classList.toggle('active', i2 === 0); b.classList.remove('filled'); });
  document.querySelectorAll('#comp-parcours-tri .tri-pane').forEach((pn) => { pn.hidden = pn.dataset.pane !== 'nat'; });
}

function openCompModal() {
  const modal = document.getElementById('comp-modal');
  if (!modal) return;
  initFlatpickrAll(); // au cas où
  // Reset éventuels états d'erreur d'une précédente saisie
  if (typeof _clearAllFieldErrors === 'function') _clearAllFieldErrors('#comp-modal');
  // Reset mode édition (sera ré-activé par openCompModalForEdit si applicable)
  window._editingCompId = null;
  // Restaure le titre et le bouton en mode "création" par défaut
  const titleH2 = document.querySelector('#comp-modal .modal-title h2');
  if (titleH2) titleH2.textContent = 'Ajouter une compétition';
  const saveBtn = document.getElementById('comp-modal-save');
  if (saveBtn) saveBtn.textContent = 'Enregistrer';
  // Cache le bouton poubelle par défaut (sera affiché par openCompModalForEdit)
  const delBtn = document.getElementById('comp-modal-delete');
  if (delBtn) delBtn.hidden = true;
  { const _tt = document.getElementById('comp-modal-to-training'); if (_tt) _tt.hidden = true; }
  window._compToTrainingAct = null; window._compToTrainingIso = null;
  // Reset form (sauf "time" qui est géré par le stepper)
  ['name','date','type','km','dplus','target','laps','notes','speed'].forEach(k => {
    const el = document.getElementById('comp-modal-' + k);
    if (el) el.value = '';
  });
  // Reset toggle course par étapes + state stages
  const stagesToggle = document.getElementById('comp-modal-stages-toggle');
  if (stagesToggle) stagesToggle.checked = false;
  stagesData = [];
  activeStageIdx = 0;
  const tabsBar = document.getElementById('comp-stages-tabs');
  if (tabsBar) tabsBar.hidden = true;
  // Reset le stepper d'heure à 12h00 par défaut
  if (window.resetTimeStepper) window.resetTimeStepper('comp-modal-time', 12, 0);
  const prioEl = document.getElementById('comp-modal-priority');
  if (prioEl) {
    prioEl.value = 'principal';
    if (typeof enhanceSelect === 'function') enhanceSelect('comp-modal-priority');
    if (prioEl._customUpdate) prioEl._customUpdate();
  }
  // Peuple le select sport (au cas où SPORTS_CATALOG n'était pas dispo à l'init)
  if (typeof populateSportSelect === 'function') populateSportSelect('comp-modal-sport', 'Ride');
  const sportEl = document.getElementById('comp-modal-sport');
  if (sportEl) sportEl.value = 'Ride';
  if (typeof resetTriPanes === 'function') resetTriPanes();
  window._compEditLegacyStd = false;
  { const sp = document.getElementById('comp-modal-speed'); if (sp) { sp.value = ''; delete sp.dataset.auto; } }
  setTimeout(() => { if (typeof adaptCompSportForm === 'function') adaptCompSportForm(); }, 0);
  if (sportEl && sportEl._customUpdate) sportEl._customUpdate();
  // Peuple le select Type d'épreuve selon le sport actif
  if (typeof populateTypeSelectForSport === 'function') populateTypeSelectForSport('Ride');
  // Reset AGRESSIF du file-picker GPX (l'input file peut garder son state entre ouvertures)
  const gpxEl = document.getElementById('comp-modal-gpx');
  if (gpxEl) {
    try { gpxEl.value = ''; } catch (e) {}
    // Force aussi un FileList vide via DataTransfer (plus fiable que value='')
    try {
      const dt = new DataTransfer();
      gpxEl.files = dt.files;
    } catch (e) { /* navigateurs anciens */ }
    const picker = gpxEl.closest('.file-picker');
    if (picker) {
      picker.classList.remove('has-file');
      const lbl = picker.querySelector('.file-picker-label');
      if (lbl) lbl.textContent = 'Choisir un fichier GPX';
      const clr = picker.querySelector('.file-picker-clear');
      if (clr) clr.hidden = true;
    }
  }
  // Cleanup global de tous les file-pickers de la modal compé (au cas où il y en aurait plusieurs)
  document.querySelectorAll('#comp-modal .file-picker').forEach(p => {
    p.classList.remove('has-file');
    const lbl = p.querySelector('.file-picker-label');
    if (lbl) lbl.textContent = 'Choisir un fichier GPX';
    const clr = p.querySelector('.file-picker-clear');
    if (clr) clr.hidden = true;
    const inp = p.querySelector('input[type="file"]');
    if (inp) {
      try { inp.value = ''; } catch (e) {}
      try { inp.files = new DataTransfer().files; } catch (e) {}
    }
  });
  if (typeof initFilePickers === 'function') initFilePickers();
  modal.classList.add('active');
}
function closeCompModal() {
  const modal = document.getElementById('comp-modal');
  if (modal) modal.classList.remove('active');
}

// Helper validation : marque un champ comme requis manquant + affiche un mini message
function _markFieldError(inputId, message) {
  const el = document.getElementById(inputId);
  if (!el) return;
  // Cherche le form-field parent (peut être un label ou un div)
  const field = el.closest('.form-field') || el.parentElement;
  if (!field) return;
  field.classList.add('field-error');
  // Si un message d'erreur existe déjà, on l'update, sinon on le crée
  let msg = field.querySelector('.field-error-msg');
  if (!msg) {
    msg = document.createElement('div');
    msg.className = 'field-error-msg';
    field.appendChild(msg);
  }
  msg.textContent = message;
  // Cleanup auto au prochain input/change
  const clearOnce = () => {
    field.classList.remove('field-error');
    if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
    el.removeEventListener('input', clearOnce);
    el.removeEventListener('change', clearOnce);
  };
  el.addEventListener('input', clearOnce);
  el.addEventListener('change', clearOnce);
}
function _clearAllFieldErrors(modalSel) {
  document.querySelectorAll(`${modalSel} .field-error`).forEach(f => f.classList.remove('field-error'));
  document.querySelectorAll(`${modalSel} .field-error-msg`).forEach(m => m.remove());
}

// Compet REALISEE = activite (category='competition') dans DASHBOARD_DATA. Ces helpers
// mettent a jour DASHBOARD_DATA en memoire pour un affichage IMMEDIAT (edition/suppression).
function removeCompFromDashboard(comp) {
  if (!window.DASHBOARD_DATA || !Array.isArray(window.DASHBOARD_DATA.days) || !comp) return;
  for (const d of window.DASHBOARD_DATA.days) {
    if (!d.activities) continue;
    d.activities = d.activities.filter(x => !(
      (comp._sbId && String(x._sbId) === String(comp._sbId)) ||
      (comp.id && String(x.client_id) === String(comp.id))
    ));
  }
}
function upsertCompInDashboard(comp) {
  if (!window.DASHBOARD_DATA || !Array.isArray(window.DASHBOARD_DATA.days) || !comp || !comp.date) return;
  const iso = comp.date;
  const row = {
    id: comp._sbId || ('local-' + comp.id),
    _sbId: comp._sbId || null,
    source: 'manual', category: 'competition', client_id: comp.id,
    name: comp.name,
    sport: (typeof getSportCategory === 'function' ? getSportCategory(comp.sport) : comp.sport),
    raw_type: comp.sport,
    start_date_local: iso + 'T' + (comp.time || '12:00') + ':00',
    distance_km: comp.km || null, elevation_gain: comp.dplus || null, course_dplus: comp.dplus || null,
    target: comp.target || null, moving_time: comp.target ? comp.target * 60 : null,
    duration: comp.target || 0,
    priority: comp.priority || null, laps: comp.laps || null,
    notes: comp.notes || '', type: comp.type || null, event: comp.event || null, tss: 0,
  };
  let day = window.DASHBOARD_DATA.days.find(d => String(d.date) === iso);
  if (!day) { day = { date: iso, activities: [] }; window.DASHBOARD_DATA.days.push(day); }
  if (!Array.isArray(day.activities)) day.activities = [];
  // Si la compétition correspond à une VRAIE activité (Strava/import) déjà dans le
  // jour : mise à jour des champs compet uniquement — ne JAMAIS remplacer par le
  // stub (sinon durée/TSS/NP/cardio disparaissent jusqu'au rechargement).
  const existing = day.activities.find(x =>
    (comp._sbId && String(x._sbId) === String(comp._sbId)) ||
    (String(x.client_id) === String(comp.id))
  );
  if (existing && existing.source !== 'manual') {
    existing.name = comp.name;
    existing.category = 'competition';
    existing.priority = comp.priority || null;
    existing.target = comp.target || null;
    existing.laps = comp.laps || null;
    existing.course_dplus = comp.dplus || null;
    if (comp.notes) existing.notes = comp.notes;
    return;
  }
  day.activities = day.activities.filter(x => !(
    (comp._sbId && String(x._sbId) === String(comp._sbId)) ||
    (String(x.client_id) === String(comp.id))
  ));
  day.activities.push(row);
}
async function saveCompFromModal() {
  _clearAllFieldErrors('#comp-modal');
  const name = document.getElementById('comp-modal-name').value.trim();
  const date = document.getElementById('comp-modal-date').value;
  if (!name || !date) {
    if (!name) _markFieldError('comp-modal-name', 'Champ requis');
    if (!date) _markFieldError('comp-modal-date', 'Champ requis');
    // Scroll vers le premier champ en erreur
    const first = document.querySelector('#comp-modal .field-error');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const time = document.getElementById('comp-modal-time').value || '';
  const priority = document.getElementById('comp-modal-priority').value;
  const sport = document.getElementById('comp-modal-sport').value;
  const typeEpr = document.getElementById('comp-modal-type').value.trim();
  let km = (typeof readDistAsKm === 'function') ? readDistAsKm('comp-modal-km') : (parseFloat(document.getElementById('comp-modal-km').value) || null);
  // Triathlon : segments detailles (onglets Nat/T1/Velo/T2/CAP)
  let tri = null;
  let triDplus = null, triTargetMin = null;
  {
    const triWrap = document.getElementById('comp-parcours-tri');
    if (triWrap && !triWrap.hidden) {
      const num = (id) => { const v = parseFloat(String((document.getElementById(id) || {}).value || '').replace(',', '.')); return isNaN(v) || v <= 0 ? null : v; };
      const seg = (tId) => parseSegTime((document.getElementById(tId) || {}).value);
      const swim = { min: seg('comp-tri-nat-time'), dist_m: num('comp-tri-nat-dist'), pace: (document.getElementById('comp-tri-nat-pace') || {}).value || null };
      const bike = { min: seg('comp-tri-bike-time'), dist_km: num('comp-tri-bike-dist'), speed: num('comp-tri-bike-speed'), dplus: num('comp-tri-bike-dplus') };
      const run = { min: seg('comp-tri-run-time'), dist_km: num('comp-tri-run-dist'), pace: (document.getElementById('comp-tri-run-pace') || {}).value || null };
      const t1 = seg('comp-tri-t1-time'), t2 = seg('comp-tri-t2-time');
      const any = swim.min || swim.dist_m || bike.min || bike.dist_km || run.min || run.dist_km || t1 || t2;
      if (any) {
        tri = {
          swim, t1_min: t1, bike, t2_min: t2, run,
          // miroirs legacy (affichage cartes + compat)
          swim_m: swim.dist_m, bike_km: bike.dist_km, run_km: run.dist_km,
        };
        km = +(((swim.dist_m || 0) / 1000) + (bike.dist_km || 0) + (run.dist_km || 0)).toFixed(1) || null;
        triDplus = bike.dplus || null;
        const times = [swim.min, t1, bike.min, t2, run.min];
        if (swim.min && bike.min && run.min) triTargetMin = Math.round(times.reduce((a2, b2) => a2 + (b2 || 0), 0));
      }
    }
  }
  const dplus = parseInt(document.getElementById('comp-modal-dplus').value, 10) || null;
  const target = parseTimeToMin(document.getElementById('comp-modal-target').value);
  const laps = parseInt(document.getElementById('comp-modal-laps').value, 10) || null;
  const notes = document.getElementById('comp-modal-notes').value.trim();
  // (champ Événement supprimé de la modale ; on préserve la valeur existante en édition)
  const event = (window._editingCompId ? ((loadCompetitions().find(c => c.id === window._editingCompId) || {}).event || '') : '');
  const stagesEl = document.getElementById('comp-modal-stages-toggle');
  const stages = !!(stagesEl && stagesEl.checked);

  // Si course par étapes : on récupère la liste des étapes (snapshot du form pour l'étape active)
  let stagesList = null;
  if (stages) {
    stagesData[activeStageIdx] = readFormToStage();
    // Lit les GPX async (chaque étape peut en avoir un)
    stagesList = [];
    for (let i = 0; i < stagesData.length; i++) {
      const s = stagesData[i];
      // Priorité : nouveau fichier > contenu existant en mémoire (édition sans re-upload)
      let gpxContent = s.gpxContent || null;
      if (s.gpxFile) {
        try { gpxContent = await s.gpxFile.text(); } catch (e) { console.warn('GPX étape ' + (i + 1) + ' :', e); }
      }
      stagesList.push({
        date: s.date || null,
        time: s.time || null,
        // priority et sport ne sont PAS stockés par étape (globaux à la compé)
        type: s.type || null,
        km: parseFloat(s.km) || null,
        dplus: parseInt(s.dplus, 10) || null,
        target: s.target || null,
        laps: parseInt(s.laps, 10) || null,
        notes: s.notes || null,
        gpxName: s.gpxName || null,
        gpxContent,
      });
    }
  }

  // GPX (lecture optionnelle) — en mode triathlon, le GPX vient de l'onglet Vélo
  let gpxContent = null;
  let gpxName = null;
  const _triWrapG = document.getElementById('comp-parcours-tri');
  const _gpxSrc = (_triWrapG && !_triWrapG.hidden && document.getElementById('comp-tri-gpx') && document.getElementById('comp-tri-gpx').files[0])
    ? document.getElementById('comp-tri-gpx') : document.getElementById('comp-modal-gpx');
  const gpxFile = _gpxSrc.files[0];
  if (gpxFile) {
    try {
      gpxContent = await gpxFile.text();
      gpxName = gpxFile.name;
    } catch (e) {
      console.warn('Lecture GPX impossible :', e);
    }
  }

  const comps = loadCompetitions();
  // Une compétition à date FUTURE n'est JAMAIS "réalisée", même créée depuis
  // l'onglet Réalisé (sinon elle part dans activities et disparaît du calendrier Prévu).
  const _isFutureComp = date > toIsoDate(today);
  const newEntry = {
    id: window._editingCompId || Date.now().toString(),
    realised: _isFutureComp ? false : (window.coachCalendarMode ? window.coachCalendarMode() === 'realise' : false),
    name, date, time, priority, sport,
    type: typeEpr, km,
    dplus: (tri ? (triDplus != null ? triDplus : null) : dplus),
    target: (tri && triTargetMin ? triTargetMin : target),
    laps: (tri ? null : laps), notes, event,
    tri,
    stages,
    stagesList,
    gpxName, gpxContent
  };
  if (window._editingCompId) {
    // Mode édition : remplace la compé existante
    const idx = comps.findIndex(c => c.id === window._editingCompId);
    if (idx >= 0) {
      // Conserve les éventuels champs GPX existants si non modifiés
      const old = comps[idx];
      // IMPORTANT : conserver l'id Supabase pour METTRE À JOUR la ligne existante
      // (sinon le push crée une nouvelle ligne et la modif est perdue au rechargement)
      if (old._sbId) newEntry._sbId = old._sbId;
      if (old.realised != null && !_isFutureComp) newEntry.realised = old.realised;
      // Conserver aussi la table d'origine + liens : sans _table, le push ne cible
      // plus la bonne ligne (doublon ou écrasement de la vraie activité Strava).
      if (old._table) newEntry._table = old._table;
      if (old.activityIds) newEntry.activityIds = old.activityIds;
      if (!gpxContent && old.gpxContent) {
        newEntry.gpxName = old.gpxName;
        newEntry.gpxContent = old.gpxContent;
      }
      // Conserve gpxContent par étape si l'utilisateur n'a pas ré-uploadé
      if (stagesList && old.stagesList) {
        for (let i = 0; i < stagesList.length; i++) {
          if (!stagesList[i].gpxContent && old.stagesList[i] && old.stagesList[i].gpxContent) {
            stagesList[i].gpxContent = old.stagesList[i].gpxContent;
            stagesList[i].gpxName = old.stagesList[i].gpxName;
          }
        }
        newEntry.stagesList = stagesList;
      }
      comps[idx] = newEntry;
    } else {
      comps.push(newEntry); // au cas où l'ID a disparu, on l'ajoute
    }
    window._editingCompId = null;
  } else {
    comps.push(newEntry);
  }
  saveCompetitions(comps);
  closeCompModal();
  renderCompList();
  if (newEntry.realised) {
    upsertCompInDashboard(newEntry);
    if (typeof window.__applyOverridesAndRerender === 'function') window.__applyOverridesAndRerender();
    else renderCalendar();
  } else {
    renderCalendar();
  }
}

// Wire up modal triggers (défensif)
const openCompBtn = document.getElementById('open-comp-modal');
if (openCompBtn) openCompBtn.addEventListener('click', openCompModal);
// Boutons + des en-têtes "Compétitions à venir" (calendrier + page compétitions)
document.querySelectorAll('.comp-add-btn').forEach(b => b.addEventListener('click', openCompModal));
const compModalClose = document.getElementById('comp-modal-close');
if (compModalClose) compModalClose.addEventListener('click', closeCompModal);
const compModalCancel = document.getElementById('comp-modal-cancel');
if (compModalCancel) compModalCancel.addEventListener('click', closeCompModal);
const compModalSave = document.getElementById('comp-modal-save');
if (compModalSave) compModalSave.addEventListener('click', saveCompFromModal);
const _compToTrainingBtn = document.getElementById('comp-modal-to-training');
if (_compToTrainingBtn) _compToTrainingBtn.addEventListener('click', async () => {
  const act = window._compToTrainingAct, iso = window._compToTrainingIso;
  if (!act || !act._sbId) return;
  if (typeof closeCompModal === 'function') closeCompModal();
  if (typeof setActivityCategory === 'function') await setActivityCategory(act, 'entrainement', iso);
});
const compModalOverlay = document.getElementById('comp-modal');
if (compModalOverlay) compModalOverlay.addEventListener('click', (e) => {
  if (e.target === compModalOverlay) closeCompModal();
});

// Auto-remplit km + D+ depuis le GPX dès qu'un fichier est sélectionné
const _compGpxInput = document.getElementById('comp-modal-gpx');
if (_compGpxInput) {
  _compGpxInput.addEventListener('change', () => {
    // Petit délai pour que le file-picker UI mette d'abord à jour son visuel
    setTimeout(() => { if (typeof _autofillKmDplusFromCompGpx === 'function') _autofillKmDplusFromCompGpx(); }, 50);
  });
}
// Recalcule km + D+ quand le nombre de tours change (si un GPX est présent)
const _compLapsInput = document.getElementById('comp-modal-laps');
if (_compLapsInput) {
  _compLapsInput.addEventListener('input', () => {
    if (typeof _autofillKmDplusFromCompGpx === 'function') _autofillKmDplusFromCompGpx();
  });
}

// ========= MODAL D'AJOUT D'ENTRAÎNEMENT =========
const TRAIN_KEY = 'coach_ia_trainings_v1';
function loadTrainings() {
  try {
    const raw = localStorage.getItem(TRAIN_KEY);
    if (!raw) return [];
    return JSON.parse(raw).filter(t => t.date && t.name);
  } catch (e) { return []; }
}
function saveTrainings(arr) {
  let prev = [];
  try { prev = JSON.parse(localStorage.getItem(TRAIN_KEY) || '[]'); } catch {}
  const ids = new Set(arr.map(t => t.id));
  const deleted = prev.filter(p => !ids.has(p.id));
  localStorage.setItem(TRAIN_KEY, JSON.stringify(arr));
  // La projection de la courbe de charge dépend des prévus → refresh
  if (window.refreshLoadChart) window.refreshLoadChart();
  if (window.cloudSync) {
    for (const t of arr) {
      window.cloudSync.pushTraining(t, 'prevu').then(sbId => {
        if (sbId && !t._sbId) {
          t._sbId = sbId;
          try {
            const cur = JSON.parse(localStorage.getItem(TRAIN_KEY) || '[]');
            const idx = cur.findIndex(x => x.id === t.id);
            if (idx >= 0) { cur[idx]._sbId = sbId; localStorage.setItem(TRAIN_KEY, JSON.stringify(cur)); }
          } catch {}
        }
      });
    }
    for (const d of deleted) window.cloudSync.deleteTraining(d);
  }
}

// État local : mode d'ouverture de la modal entraînement ('prevu' ou 'realise')
let trainModalMode = 'prevu';
const TRAIN_REALISE_KEY = 'coach_ia_trainings_realise_v1';
function loadRealisedTrainings() {
  try {
    const raw = localStorage.getItem(TRAIN_REALISE_KEY);
    if (!raw) return [];
    return JSON.parse(raw).filter(t => t.date && t.name);
  } catch (e) { return []; }
}
function saveRealisedTrainings(arr) {
  let prev = [];
  try { prev = JSON.parse(localStorage.getItem(TRAIN_REALISE_KEY) || '[]'); } catch {}
  const ids = new Set(arr.map(t => t.id));
  const deleted = prev.filter(p => !ids.has(p.id));
  localStorage.setItem(TRAIN_REALISE_KEY, JSON.stringify(arr));
  if (window.cloudSync) {
    for (const t of arr) {
      window.cloudSync.pushTraining(t, 'realise').then(sbId => {
        if (sbId && !t._sbId) {
          t._sbId = sbId;
          try {
            const cur = JSON.parse(localStorage.getItem(TRAIN_REALISE_KEY) || '[]');
            const idx = cur.findIndex(x => x.id === t.id);
            if (idx >= 0) { cur[idx]._sbId = sbId; localStorage.setItem(TRAIN_REALISE_KEY, JSON.stringify(cur)); }
          } catch {}
        }
      });
    }
    for (const d of deleted) window.cloudSync.deleteTraining(d);
  }
}

function openTrainModal(mode) {
  const modal = document.getElementById('train-modal');
  if (!modal) return;
  trainModalMode = (mode === 'realise') ? 'realise' : 'prevu';
  window._trainModalMode = trainModalMode;
  initFlatpickrAll(); // au cas où
  if (typeof _clearAllFieldErrors === 'function') _clearAllFieldErrors('#train-modal');
  // Reset mode édition par défaut (sera ré-activé par openTrainModalForEdit)
  window._editingTrainId = null;
  window._editingTrainMode = null;
  // Sortie du mode "modèle bibliothèque" : réaffiche date/heure/GPX masqués
  window._templateMode = false;
  window._templateEditing = null;
  ['train-modal-date', 'train-modal-time'].forEach(id => {
    const el = document.getElementById(id);
    const lab = el && el.closest('label');
    if (lab) lab.style.display = '';
  });
  { const g = document.getElementById('train-modal-gpx'); const wrap = g && g.closest('.form-field'); if (wrap) wrap.style.display = ''; }
  const titleEl = document.getElementById('train-modal-title');
  if (titleEl) titleEl.textContent = (trainModalMode === 'realise')
    ? 'Ajouter un entraînement réalisé'
    : 'Ajouter un entraînement prévu';
  const _rpeLab = document.getElementById('train-modal-rpe-label');
  if (_rpeLab) _rpeLab.textContent = (trainModalMode === 'realise') ? 'RPE ressenti (1-10)' : 'RPE estimé (1-10)';
  const saveBtn = document.getElementById('train-modal-save');
  if (saveBtn) saveBtn.textContent = 'Enregistrer';
  // Poubelle cachée par défaut (visible seulement en édition)
  const delBtn = document.getElementById('train-modal-delete');
  if (delBtn) delBtn.hidden = true;
  ['train-tri-swim', 'train-tri-bike', 'train-tri-run'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  ['name','date','time','duration','tss','notes','rpe','km','dplus'].forEach(k => {
    const el = document.getElementById('train-modal-' + k);
    if (el) el.value = '';
  });
  { const _c = document.getElementById('train-modal-act-controls'); if (_c) _c.hidden = true; }
  if (window.resetTrainGpx) window.resetTrainGpx();
  // Reset structure (mode création)
  if (typeof window.resetWorkoutStructure === 'function') window.resetWorkoutStructure();
  if (typeof populateSportSelect === 'function') populateSportSelect('train-modal-sport', 'Ride');
  const s = document.getElementById('train-modal-sport');
  if (s) s.value = 'Ride';
  if (s && s._customUpdate) s._customUpdate();
  if (typeof adaptTrainSportForm === 'function') adaptTrainSportForm();
  // Date par défaut : aujourd'hui pour réalisé, demain pour prévu
  const dateInput = document.getElementById('train-modal-date');
  if (dateInput) {
    const d = new Date();
    if (trainModalMode === 'prevu') d.setDate(d.getDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    dateInput.value = iso;
    if (dateInput._flatpickr) dateInput._flatpickr.setDate(d, false);
  }
  modal.classList.add('active');
}
function closeTrainModal() {
  const modal = document.getElementById('train-modal');
  if (modal) modal.classList.remove('active');
}
// Ouvre la modal entraînement en mode édition (pré-remplie)
function openTrainModalForEdit(training, mode) {
  if (!training || typeof openTrainModal !== 'function') return;
  openTrainModal(mode);
  window._editingTrainId = training.id;
  window._editingTrainMode = mode;
  trainModalMode = mode;
  document.getElementById('train-modal-name').value = training.name || '';
  document.getElementById('train-modal-date').value = training.date || '';
  { const _tt = document.getElementById('train-modal-time'); if (_tt) _tt.value = training.time || ''; }
  if (document.getElementById('train-modal-date')._flatpickr && training.date) {
    document.getElementById('train-modal-date')._flatpickr.setDate(training.date, false);
  }
  if (training.sport) {
    const s = document.getElementById('train-modal-sport');
    if (s) { s.value = training.sport; if (s._customUpdate) s._customUpdate(); }
  }
  if (training.type) {
    const t = document.getElementById('train-modal-type');
    if (t) { t.value = training.type; if (t._customUpdate) t._customUpdate(); }
  }
  document.getElementById('train-modal-duration').value = training.duration != null ? training.duration : '';
  document.getElementById('train-modal-tss').value = training.tss != null ? training.tss : '';
  document.getElementById('train-modal-notes').value = training.notes || '';
  document.getElementById('train-modal-rpe').value = training.rpe != null ? training.rpe : '';
  document.getElementById('train-modal-km').value = training.km != null ? training.km : '';
  document.getElementById('train-modal-dplus').value = training.dplus != null ? training.dplus : '';
  {
    const t = training.tri || {};
    const setV = (id, v) => { const e = document.getElementById(id); if (e) e.value = (v != null ? v : ''); };
    setV('train-tri-swim', t.swim_m); setV('train-tri-bike', t.bike_km); setV('train-tri-run', t.run_km);
  }
  if (window.setTrainGpx) window.setTrainGpx(training.gpxName || null, training.gpxContent || null);
  // Charger la structure si présente (mode édition)
  if (typeof window.setWorkoutStructure === 'function') {
    window.setWorkoutStructure(training.structure || []);
  }
  // Adapte le formulaire au sport (convertit l'affichage km->m si natation)
  if (typeof adaptTrainSportForm === 'function') adaptTrainSportForm();
  // Controles "activite" (mode realise edite) : exclusions records + transformer en compet
  {
    const _ctrls = document.getElementById('train-modal-act-controls');
    if (_ctrls) {
      if (mode === 'realise' && training._sbId) {
        _ctrls.hidden = false;
        window._trainEditActId = String(training._sbId);
        window._trainEditIso = training.date;
        const _set = (m, on) => { const b = _ctrls.querySelector('.ae-metric-btn[data-m="' + m + '"]'); if (b) b.classList.toggle('active', !!on); };
        _set('power', training.exclPower); _set('hr', training.exclHr); _set('dist', training.exclDistance);
      } else {
        _ctrls.hidden = true;
        window._trainEditActId = null;
      }
    }
  }
  // Adapter titre + bouton + affiche poubelle
  const titleEl = document.getElementById('train-modal-title');
  if (titleEl) titleEl.textContent = (mode === 'realise')
    ? 'Modifier l\'entraînement réalisé'
    : 'Modifier l\'entraînement prévu';
  const saveBtn = document.getElementById('train-modal-save');
  if (saveBtn) saveBtn.textContent = 'Enregistrer les modifications';
  const delBtn = document.getElementById('train-modal-delete');
  if (delBtn) delBtn.hidden = false;
}

// Handler suppression entraînement depuis la modal d'édition
const _trainModalDelBtn = document.getElementById('train-modal-delete');
if (_trainModalDelBtn) {
  _trainModalDelBtn.addEventListener('click', async () => {
    // Mode "modèle bibliothèque" : suppression du template
    if (window._templateMode) {
      const tpl = window._templateEditing;
      if (!tpl) return;
      const ok = await appConfirm({
        title: 'Supprimer cette séance',
        html: `Supprimer <strong>${window._confirmEscape(tpl.name || 'cette séance')}</strong> de la bibliothèque ?`,
        confirmLabel: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
      if (window.libraryDeleteTemplate) window.libraryDeleteTemplate(tpl.id);
      window._templateMode = false;
      window._templateEditing = null;
      closeTrainModal();
      return;
    }
    const id = window._editingTrainId;
    const mode = window._editingTrainMode || trainModalMode;
    if (!id) return;
    const arr = mode === 'realise' ? loadRealisedTrainings() : loadTrainings();
    const t = arr.find(x => x.id === id);
    const name = t ? t.name : 'cet entraînement';
    const ok = await appConfirm({
      title: 'Supprimer cet entraînement',
      html: `Supprimer <strong>${window._confirmEscape(name)}</strong> ?`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const remaining = arr.filter(x => x.id !== id);
    if (mode === 'realise') saveRealisedTrainings(remaining);
    else saveTrainings(remaining);
    window._editingTrainId = null;
    window._editingTrainMode = null;
    closeTrainModal();
    if (typeof renderCalendar === 'function') renderCalendar();
  });
}

// Met a jour DASHBOARD_DATA (source d'affichage) avec une seance manuelle realisee,
// pour qu'une creation/edition apparaisse IMMEDIATEMENT sans attendre un re-pull cloud.
function upsertManualInDashboard(entry) {
  if (!window.DASHBOARD_DATA || !Array.isArray(window.DASHBOARD_DATA.days) || !entry || !entry.date) return;
  const iso = entry.date;
  const row = {
    id: entry._sbId || ('local-' + entry.id),
    _sbId: entry._sbId || null,
    source: 'manual', _manual: true, _manualId: entry.id,
    category: 'entrainement', client_id: entry.id,
    notes: entry.notes || '', name: entry.name,
    sport: entry.sportCategory || entry.sport, raw_type: entry.sport,
    tss: entry.tss || 0, duration: entry.duration || 0,
    moving_time: (entry.duration || 0) * 60,
    start_date_local: iso + 'T' + (entry.time || '12:00') + ':00',
    distance_km: entry.km || null, elevation_gain: entry.dplus || null,
    rpe: (entry.rpe != null ? entry.rpe : null),
    laps: (entry.laps != null ? entry.laps : null),
    structure: entry.structure || null,
    type: entry.type || '',
    _exclPower: !!entry.exclPower, _exclHr: !!entry.exclHr, _exclDistance: !!entry.exclDistance,
  };
  let day = window.DASHBOARD_DATA.days.find(d => String(d.date) === iso);
  if (!day) { day = { date: iso, activities: [] }; window.DASHBOARD_DATA.days.push(day); }
  if (!Array.isArray(day.activities)) day.activities = [];
  day.activities = day.activities.filter(x => !(
    (entry._sbId && String(x._sbId) === String(entry._sbId)) ||
    (String(x.client_id) === String(entry.id))
  ));
  day.activities.push(row);
}

function saveTrainFromModal() {
  // Mode "modèle bibliothèque" : on enregistre un template, pas un entraînement
  if (window._templateMode) { saveTemplateFromTrainModal(); return; }
  if (typeof _clearAllFieldErrors === 'function') _clearAllFieldErrors('#train-modal');
  const name = document.getElementById('train-modal-name').value.trim();
  const date = document.getElementById('train-modal-date').value;
  if (!name || !date) {
    if (typeof _markFieldError === 'function') {
      if (!name) _markFieldError('train-modal-name', 'Champ requis');
      if (!date) _markFieldError('train-modal-date', 'Champ requis');
      const first = document.querySelector('#train-modal .field-error');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
  const time = (document.getElementById('train-modal-time') || {}).value || '';
  const sport = document.getElementById('train-modal-sport').value;
  const type = (document.getElementById('train-modal-type') || {}).value || '';
  const duration = parseInt(document.getElementById('train-modal-duration').value, 10) || 0;
  const tss = parseInt(document.getElementById('train-modal-tss').value, 10) || 0;
  const notes = document.getElementById('train-modal-notes').value.trim();
  const rpe = parseFloat(document.getElementById('train-modal-rpe').value) || null;
  let km = (typeof readDistAsKm === 'function') ? readDistAsKm('train-modal-km') : (parseFloat(document.getElementById('train-modal-km').value) || null);
  let tri = null;
  {
    const triRow = document.getElementById('train-tri-fields');
    if (triRow && !triRow.hidden) {
      const swim = parseFloat(document.getElementById('train-tri-swim').value) || null;
      const bike = parseFloat(document.getElementById('train-tri-bike').value) || null;
      const run = parseFloat(document.getElementById('train-tri-run').value) || null;
      if (swim || bike || run) {
        tri = { swim_m: swim, bike_km: bike, run_km: run };
        km = +(((swim || 0) / 1000) + (bike || 0) + (run || 0)).toFixed(1) || null;
      }
    }
  }
  const dplus = parseInt(document.getElementById('train-modal-dplus').value, 10) || null;
  const laps = null; // champ 'nombre de tours' retire des entrainements (garde pour les competitions)
  const _gpx = (window.getTrainGpx ? window.getTrainGpx() : { name: null, content: null });
  const editingId = window._editingTrainId;
  // Structure (intervalles) si activée dans la modal — null sinon
  const structure = (typeof window.getCurrentWorkoutStructure === 'function')
    ? window.getCurrentWorkoutStructure()
    : null;
  const _ac = document.getElementById('train-modal-act-controls');
  const _exclOn = (mm) => !!(_ac && !_ac.hidden && _ac.querySelector('.ae-metric-btn[data-m="' + mm + '"].active'));
  const exclPower = _exclOn('power'), exclHr = _exclOn('hr'), exclDistance = _exclOn('dist');
  const entry = {
    id: editingId || Date.now().toString(),
    name, date, time, sport, type, duration, tss, notes,
    rpe, km, dplus, laps, tri, gpxName: _gpx.name, gpxContent: _gpx.content,
    exclPower, exclHr, exclDistance,
    sportCategory: (typeof getSportCategory === 'function' ? getSportCategory(sport) : sport),
    mode: trainModalMode,
    structure, // [] | null | [{dur, target, reps}, ...]
  };

  const loadFn = trainModalMode === 'realise' ? loadRealisedTrainings : loadTrainings;
  const saveFn = trainModalMode === 'realise' ? saveRealisedTrainings : saveTrainings;
  const arr = loadFn();
  if (editingId) {
    // Mode édition : remplace l'entry existante en conservant l'id Supabase
    const idx = arr.findIndex(t => t.id === editingId);
    if (idx >= 0) {
      if (arr[idx]._sbId) entry._sbId = arr[idx]._sbId; // sinon le push crée un doublon
      arr[idx] = entry;
    } else {
      arr.push(entry);
    }
  } else {
    arr.push(entry);
  }
  saveFn(arr);
  window._editingTrainId = null;
  window._editingTrainMode = null;
  closeTrainModal();
  if (trainModalMode === 'realise') {
    upsertManualInDashboard(entry);
    if (typeof window.__applyOverridesAndRerender === 'function') window.__applyOverridesAndRerender();
    else renderCalendar();
  } else {
    renderCalendar();
  }
}

// ============================================================
// Bibliothèque de séances : le modal de création/édition d'un MODÈLE réutilise
// le train-modal (même design + structure d'intervalles), sans date/heure/GPX.
// ============================================================
// Mapping clé bibliothèque -> sport Strava représentatif (pour le select)
const LIB_KEY_TO_RAW = { triathlon: 'Triathlon', cyclisme: 'Ride', vtt: 'MountainBikeRide', course: 'Run', trail: 'TrailRun', natation: 'Swim', musculation: 'WeightTraining', autre: 'Workout' };
// Mapping inverse : sport Strava -> clé de regroupement bibliothèque
function rawToLibKey(rawType) {
  if (rawType === 'MountainBikeRide' || rawType === 'EMountainBikeRide') return 'vtt';
  if (rawType === 'TrailRun') return 'trail';
  const cat = (typeof getSportCategory === 'function') ? getSportCategory(rawType) : 'autre';
  return ['cyclisme', 'course', 'natation', 'musculation', 'triathlon'].includes(cat) ? cat : 'autre';
}

window.openLibraryTemplateModal = function (tpl) {
  openTrainModal('prevu');            // reset complet (champs, structure, GPX)
  window._templateMode = true;
  window._templateEditing = tpl || null;
  // Masque les champs sans objet pour un modèle : date, heure, GPX
  ['train-modal-date', 'train-modal-time'].forEach(id => {
    const el = document.getElementById(id);
    const lab = el && el.closest('label');
    if (lab) lab.style.display = 'none';
  });
  { const g = document.getElementById('train-modal-gpx'); const wrap = g && g.closest('.form-field'); if (wrap) wrap.style.display = 'none'; }
  const titleEl = document.getElementById('train-modal-title');
  if (titleEl) titleEl.textContent = tpl ? 'Modifier la séance (bibliothèque)' : 'Nouvelle séance (bibliothèque)';
  // Pré-remplissage en édition
  if (tpl) {
    document.getElementById('train-modal-name').value = tpl.name || '';
    document.getElementById('train-modal-duration').value = tpl.duration_min || '';
    document.getElementById('train-modal-tss').value = tpl.tss || '';
    document.getElementById('train-modal-notes').value = tpl.description || '';
    document.getElementById('train-modal-rpe').value = tpl.rpe != null ? tpl.rpe : '';
    document.getElementById('train-modal-km').value = tpl.km != null ? tpl.km : '';
    document.getElementById('train-modal-dplus').value = tpl.dplus != null ? tpl.dplus : '';
    const s = document.getElementById('train-modal-sport');
    if (s) { s.value = tpl.sport_raw || LIB_KEY_TO_RAW[tpl.sport] || 'Ride'; if (s._customUpdate) s._customUpdate(); }
    if (typeof window.setWorkoutStructure === 'function') window.setWorkoutStructure(tpl.structure || []);
    if (typeof adaptTrainSportForm === 'function') adaptTrainSportForm();
    const delBtn = document.getElementById('train-modal-delete');
    if (delBtn) delBtn.hidden = false;
  }
  const saveBtn = document.getElementById('train-modal-save');
  if (saveBtn) saveBtn.textContent = tpl ? 'Enregistrer les modifications' : 'Enregistrer';
};

function saveTemplateFromTrainModal() {
  if (typeof _clearAllFieldErrors === 'function') _clearAllFieldErrors('#train-modal');
  const name = document.getElementById('train-modal-name').value.trim();
  if (!name) {
    if (typeof _markFieldError === 'function') _markFieldError('train-modal-name', 'Champ requis');
    return;
  }
  const rawSport = document.getElementById('train-modal-sport').value || 'Ride';
  const prev = window._templateEditing;
  const structure = (typeof window.getCurrentWorkoutStructure === 'function') ? window.getCurrentWorkoutStructure() : null;
  const entry = {
    id: (prev && prev.id) || (Date.now().toString() + Math.random().toString(36).slice(2, 5)),
    _sbId: (prev && prev._sbId) || undefined,
    sort_order: (prev && prev.sort_order) || 0,
    sport: rawToLibKey(rawSport),      // clé de regroupement bibliothèque
    sport_raw: rawSport,               // sport Strava exact (repris à l'insertion calendrier)
    name,
    duration_min: parseInt(document.getElementById('train-modal-duration').value, 10) || 0,
    tss: parseInt(document.getElementById('train-modal-tss').value, 10) || 0,
    description: document.getElementById('train-modal-notes').value.trim(),
    rpe: parseFloat(document.getElementById('train-modal-rpe').value) || null,
    km: (typeof readDistAsKm === 'function') ? readDistAsKm('train-modal-km') : (parseFloat(document.getElementById('train-modal-km').value) || null),
    dplus: parseInt(document.getElementById('train-modal-dplus').value, 10) || null,
    structure: (structure && structure.length) ? structure : null,
  };
  if (window.libraryUpsertTemplate) window.libraryUpsertTemplate(entry);
  window._templateMode = false;
  window._templateEditing = null;
  closeTrainModal();
}

// Insertion d'un modèle de la bibliothèque sur un jour (glisser-déposer).
// mode 'prevu' → entraînement prévu ; mode 'realise' → activité manuelle réalisée.
// Les deux passent par le système d'entraînements existant (sync Supabase incluse).
window.coachInsertTemplate = function (iso, tpl, mode, ia) {
  if (!iso || !tpl) return;
  const m = mode === 'realise' ? 'realise' : 'prevu';
  const entry = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 5),
    name: tpl.name || 'Séance',
    date: iso,
    sport: tpl.sport_raw || tpl.sport || 'cyclisme',
    type: tpl.type || '',
    duration: tpl.duration_min || 0,
    tss: tpl.tss || 0,
    notes: tpl.description || '',
    rpe: (tpl.rpe != null ? tpl.rpe : null),
    km: (tpl.km != null ? tpl.km : null),
    dplus: (tpl.dplus != null ? tpl.dplus : null),
    mode: m,
    structure: tpl.structure || null,
    ia: ia === true,
  };
  const arr = m === 'realise' ? loadRealisedTrainings() : loadTrainings();
  arr.push(entry);
  if (m === 'realise') saveRealisedTrainings(arr); else saveTrainings(arr);
  if (typeof renderCalendar === 'function') renderCalendar();
};
// Sous-mode courant du calendrier (réalisé / prévu) pour le drop.
window.coachCalendarMode = function () {
  const b = document.querySelector('#calendar-subtabs .subtab.active');
  return b && b.dataset.mode === 'realise' ? 'realise' : 'prevu';
};

// Helpers globaux pour edit/delete depuis n'importe où
// Reconstruit un objet "entrainement" depuis DASHBOARD_DATA (pour editer une seance
// presente en base mais pas dans le localStorage de ce navigateur).
function buildTrainingFromData(id) {
  if (!Array.isArray(data)) return null;
  for (const d of data) {
    for (const x of (d.activities || [])) {
      if (String(x._manualId) === String(id) || String(x.client_id) === String(id) || String(x.id) === String(id)) {
        return {
          id: x._manualId || x.client_id || x.id,
          _sbId: x._sbId || null,
          name: x.name || '',
          date: (x.start_date_local ? String(x.start_date_local).slice(0, 10) : toIsoDate(d.date)),
          time: (x.start_date_local ? ((String(x.start_date_local).match(/T(\d{2}:\d{2})/) || [])[1] || '') : ''),
          sport: x.raw_type || x.sport || 'Ride',
          type: x.type || '',
          duration: x.duration || 0,
          tss: x.tss || 0,
          notes: x.notes || '',
          km: (x.distance_km != null ? x.distance_km : null),
          dplus: (x.elevation_gain != null ? x.elevation_gain : null),
          rpe: (x.rpe != null ? x.rpe : null),
          laps: (x.laps != null ? x.laps : null),
          structure: x.structure || null,
          exclPower: !!x._exclPower, exclHr: !!x._exclHr, exclDistance: !!x._exclDistance,
          mode: 'realise',
        };
      }
    }
  }
  return null;
}
window.gpxEditTraining = function(id, mode) {
  const arr = mode === 'realise' ? loadRealisedTrainings() : loadTrainings();
  let t = arr.find(x => x.id === id);
  if (!t) t = buildTrainingFromData(id); // pas de copie locale -> reconstruit depuis la base
  if (t && typeof openTrainModalForEdit === 'function') openTrainModalForEdit(t, mode);
};
window.gpxDeleteTraining = async function(id, mode, sbId) {
  const arr = mode === 'realise' ? loadRealisedTrainings() : loadTrainings();
  const t = arr.find(x => x.id === id || (sbId && x._sbId === sbId));
  const name = t ? t.name : 'cette séance';
  const ok = await appConfirm({
    title: 'Supprimer cette séance',
    html: `Supprimer <strong>${window._confirmEscape(name)}</strong> ?`,
    confirmLabel: 'Supprimer',
    danger: true,
  });
  if (!ok) return;
  // localStorage (si la séance y est présente sur ce navigateur)
  if (t) {
    const remaining = arr.filter(x => x !== t);
    if (mode === 'realise') saveRealisedTrainings(remaining);
    else saveTrainings(remaining);
  }
  // Base : supprime la ligne, sinon elle réapparaît au prochain pull cloud.
  const effSbId = (t && t._sbId) || sbId || null;
  if (window.cloudSync && window.cloudSync.deleteTraining) {
    try { await window.cloudSync.deleteTraining({ mode, _sbId: effSbId, id: (t && t.id) || id }); } catch (_) {}
  }
  // Retire l'activité de DASHBOARD_DATA en mémoire pour qu'elle disparaisse IMMÉDIATEMENT
  // (sinon le prochain rebuild la réaffiche jusqu'au refresh).
  if (window.DASHBOARD_DATA && window.DASHBOARD_DATA.days) {
    for (const d of window.DASHBOARD_DATA.days) {
      if (!d.activities) continue;
      d.activities = d.activities.filter(x => !(
        (effSbId && String(x._sbId) === String(effSbId)) ||
        (id && String(x.client_id) === String(id)) ||
        (id && String(x.id) === String(id))
      ));
    }
  }
  if (typeof closeSessionModal === 'function') closeSessionModal();
  if (typeof window.__applyOverridesAndRerender === 'function') window.__applyOverridesAndRerender();
  else if (typeof renderCalendar === 'function') renderCalendar();
};

// Cablage (une fois) des controles activite de la modale entrainement.
{
  const _c = document.getElementById('train-modal-act-controls');
  if (_c) _c.querySelectorAll('.ae-metric-btn').forEach(b => b.addEventListener('click', () => b.classList.toggle('active')));
  const _tb = document.getElementById('train-modal-transform');
  if (_tb) _tb.addEventListener('click', async () => {
    const id = window._trainEditActId, iso = window._trainEditIso;
    if (!id) return;
    const act = { _sbId: id, category: 'entrainement',
      name: (document.getElementById('train-modal-name').value || 'Competition'),
      sport: document.getElementById('train-modal-sport').value };
    if (typeof closeTrainModal === 'function') closeTrainModal();
    if (typeof setActivityCategory === 'function') await setActivityCategory(act, 'competition', iso);
  });
}
const openTrainBtn = document.getElementById('open-train-modal');
if (openTrainBtn) openTrainBtn.addEventListener('click', () => openTrainModal('prevu'));
const openTrainRealiseBtn = document.getElementById('open-train-realise-modal');
if (openTrainRealiseBtn) openTrainRealiseBtn.addEventListener('click', () => openTrainModal('realise'));
const trainModalClose = document.getElementById('train-modal-close');
if (trainModalClose) trainModalClose.addEventListener('click', closeTrainModal);
const trainModalCancel = document.getElementById('train-modal-cancel');
if (trainModalCancel) trainModalCancel.addEventListener('click', closeTrainModal);
const trainModalSave = document.getElementById('train-modal-save');
if (trainModalSave) trainModalSave.addEventListener('click', saveTrainFromModal);
const trainModalOverlay = document.getElementById('train-modal');
if (trainModalOverlay) trainModalOverlay.addEventListener('click', (e) => {
  if (e.target === trainModalOverlay) closeTrainModal();
});

// Esc ferme les modals d'ajout aussi
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCompModal();
    closeTrainModal();
  }
});

// ========= GÉNÉRATION DU PLAN 7 JOURS =========
function determinePhase(comps, currentTSB) {
  // TSB très bas → forcer décharge avant tout objectif
  if (currentTSB < -30) return { phase: 'recovery', daysUntil: null, comp: null };
  const futureComps = comps.filter(c => c.dateObj >= today).sort((a,b) => a.dateObj - b.dateObj);
  if (futureComps.length === 0) return { phase: 'build', daysUntil: null, comp: null };
  const next = futureComps[0];
  const daysUntil = Math.ceil((next.dateObj - today) / 86400000);
  let phase;
  if (daysUntil <= 7) phase = 'race';
  else if (daysUntil <= 28) phase = 'taper';
  else if (daysUntil <= 56) phase = 'peak';
  else phase = 'build';
  return { phase, daysUntil, comp: next };
}

// Templates par phase × jour de semaine (dow : 1=Lun, 0=Dim)
const PLAN_TEMPLATES = {
  build: {
    1: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Récup post-week-end, repos complet recommandé' },
    2: { type: 'tempo', name: 'Tempo / Sweet Spot', dur: 75, tss: 80, why: 'Volume d\'intensité modérée pour densifier le CTL' },
    3: { type: 'endurance', name: 'Endurance Z2', dur: 90, tss: 60, why: 'Base aérobie, fait grimper le CTL sans coût en fatigue' },
    4: { type: 'seuil', name: 'Seuil 4×8min', dur: 80, tss: 95, why: 'Bloc de seuil pour repousser le FTP' },
    5: { type: 'recup', name: 'Récup active', dur: 45, tss: 25, why: 'Évacuer la fatigue avant le week-end' },
    6: { type: 'vo2', name: 'VO2max 5×4min', dur: 90, tss: 110, why: 'Travail capacité aérobie maximale' },
    0: { type: 'endurance', name: 'Sortie longue Z2', dur: 180, tss: 160, why: 'Construire l\'endurance et la résistance, brique principale du build' }
  },
  peak: {
    1: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Récup totale' },
    2: { type: 'seuil', name: 'Seuil 3×12min', dur: 85, tss: 110, why: 'Renforcer le FTP en phase peak' },
    3: { type: 'endurance', name: 'Endurance Z2', dur: 75, tss: 55, why: 'Récupération active entre les blocs intensifs' },
    4: { type: 'vo2', name: 'VO2max 6×3min', dur: 80, tss: 115, why: 'Pic d\'intensité, le bloc clé du peak' },
    5: { type: 'recup', name: 'Récup active', dur: 40, tss: 20, why: 'Vidange complète avant le simulateur du week-end' },
    6: { type: 'tempo', name: 'Simulation course (sweet spot + sprints)', dur: 100, tss: 120, why: 'Reproduire les efforts de course pour préparer le corps' },
    0: { type: 'endurance', name: 'Sortie longue + 3×8min seuil', dur: 180, tss: 170, why: 'Maintenir l\'endurance avec un peu d\'intensité' }
  },
  taper: {
    1: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Affûtage' },
    2: { type: 'tempo', name: 'Tempo court 2×10min', dur: 50, tss: 50, why: 'Maintenir le tonus sans creuser la fatigue' },
    3: { type: 'endurance', name: 'Endurance Z2 courte', dur: 60, tss: 40, why: 'Volume réduit, faire chuter l\'ATL' },
    4: { type: 'vo2', name: 'VO2max 4×3min', dur: 60, tss: 70, why: 'Petite dose d\'intensité pour rester réactif' },
    5: { type: 'recup', name: 'Récup active', dur: 30, tss: 15, why: 'Décrassage' },
    6: { type: 'tempo', name: 'Openers : 3×30sec sprint', dur: 45, tss: 35, why: 'Activer le système neuromusculaire' },
    0: { type: 'endurance', name: 'Endurance Z2', dur: 90, tss: 60, why: 'Sortie de plaisir, sentir la forme arriver' }
  },
  race: {
    1: { type: 'rest', name: 'Repos complet', dur: 0, tss: 0, why: 'Semaine de course : zéro charge' },
    2: { type: 'recup', name: 'Récup active 30min', dur: 30, tss: 15, why: 'Décrasser sans fatiguer' },
    3: { type: 'tempo', name: 'Openers : 5×30sec sprint', dur: 40, tss: 30, why: 'Réveiller le corps' },
    4: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Veille de veille de course' },
    5: { type: 'tempo', name: 'Openers courts', dur: 30, tss: 25, why: 'Activation neuromusculaire' },
    6: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Repos avant course' },
    0: { type: 'vo2', name: 'Course', dur: 120, tss: 200, why: 'Jour J — donne tout' }
  },
  recovery: {
    1: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Décharge : récupération maximale' },
    2: { type: 'recup', name: 'Récup active', dur: 45, tss: 25, why: 'Décharge active douce' },
    3: { type: 'endurance', name: 'Endurance Z2 courte', dur: 60, tss: 40, why: 'Volume très bas, juste pour bouger' },
    4: { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Récupération continue' },
    5: { type: 'recup', name: 'Récup active', dur: 40, tss: 20, why: 'Maintenir l\'élan sans charger' },
    6: { type: 'endurance', name: 'Endurance courte', dur: 75, tss: 55, why: 'Reprise progressive' },
    0: { type: 'endurance', name: 'Endurance Z2', dur: 90, tss: 60, why: 'Sortie facile pour finir la décharge' }
  }
};

const PHASE_LABELS = {
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race week',
  recovery: 'Décharge'
};

function adjustForRecovery(proposal, recovery) {
  // Récup basse → on adoucit
  if (recovery == null) return proposal;
  if (recovery < 34 && proposal.type !== 'rest') {
    return { ...proposal, type: 'recup', name: 'Récup active (recovery basse)', dur: Math.min(45, proposal.dur), tss: 20, why: `Recovery ${recovery}% : remplacement par récup active pour préserver l'équilibre` };
  }
  if (recovery < 50 && (proposal.type === 'vo2' || proposal.type === 'seuil')) {
    return { ...proposal, name: proposal.name + ' (allégé)', dur: Math.round(proposal.dur * 0.7), tss: Math.round(proposal.tss * 0.7), why: `Recovery ${recovery}% : intensité réduite -30%` };
  }
  return proposal;
}

function determinePhaseForDate(comps, fromDate, currentTSB) {
  if (currentTSB < -30) return 'recovery';
  const futureComps = comps.filter(c => c.dateObj >= fromDate).sort((a,b) => a.dateObj - b.dateObj);
  if (futureComps.length === 0) return 'build';
  const daysUntil = Math.ceil((futureComps[0].dateObj - fromDate) / 86400000);
  if (daysUntil <= 7) return 'race';
  if (daysUntil <= 28) return 'taper';
  if (daysUntil <= 56) return 'peak';
  return 'build';
}

function renderWeekPlan() {
  // En Prévu : seulement les compétitions PLANIFIÉES (futures). Les compés
  // réalisées/passées (_table='activity') s'affichent dans le Réalisé.
  const comps = loadCompetitionsExpanded()
    .filter(c => c._table !== 'activity')
    .map(c => ({ ...c, dateObj: new Date(c.date + 'T12:00:00') }));
  const { phase, daysUntil, comp } = determinePhase(comps, todayData.tsb);

  // Pill de phase supprimée — l'info est dans le sous-titre

  // Sous-titre supprimé
  const subEl = { textContent: '' };
  if (comp) {
    subEl.textContent = `Prochain objectif : ${comp.name} (${compPrio(comp.priority).label}) dans ${daysUntil} jours · phase actuelle ${PHASE_LABELS[phase]}`;
  } else if (phase === 'recovery') {
    subEl.textContent = `TSB actuel ${todayData.tsb.toFixed(0)} : décharge prioritaire avant tout objectif`;
  } else {
    subEl.textContent = `Aucune compétition planifiée · phase ${PHASE_LABELS[phase]} (entretien général)`;
  }

  // Lundi de la semaine courante = première semaine affichée
  const thisMonday = getMondayOfWeek(today);
  const todayIso = toIsoDate(today);

  // Index data par date ISO pour les jours passés
  const dataByIso = {};
  data.forEach(d => { dataByIso[toIsoDate(d.date)] = d; });

  // Dedoublonnage prevu/realise : une seance presente dans les DEUX stocks (meme id /
  // _sbId) ne doit pas apparaitre aussi en prevu -> on masque la copie prevu (le realise prime).
  const _realisedKeySet = new Set();
  try {
    (typeof loadRealisedTrainings === 'function' ? loadRealisedTrainings() : []).forEach(t => {
      if (t && t.id != null) _realisedKeySet.add(String(t.id));
      if (t && t._sbId) _realisedKeySet.add(String(t._sbId));
    });
  } catch (e) {}

  // Mode Prévu : TOUJOURS 4 semaines glissantes en ORDRE CHRONOLOGIQUE
  // (semaine courante / 1ère du mois en haut, semaines suivantes vers le bas)
  let weeksStarts = [];
  const startMonday = selectedMonth
    ? getMondayOfWeek(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1))
    : thisMonday;
  for (let w = 0; w < 4; w++) {
    const ws = new Date(startMonday);
    ws.setDate(startMonday.getDate() + w * 7);
    weeksStarts.push(ws);
  }

  const weeksHtml = [];
  for (let w = 0; w < weeksStarts.length; w++) {
    const weekStart = weeksStarts[w];
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekLabel = `Semaine du ${fmtShortDate(weekStart)} au ${fmtShortDate(weekEnd)}`;

    const dayCards = [];
    let weekTotalDur = 0;
    let weekTotalTss = 0;
    let weekTotalSessions = 0;
    let weekKind = 'past'; // 'past' = entièrement passée, 'current' = en cours, 'future' = à venir

    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = toIsoDate(d);
      const dow = d.getDay();
      const isPast = iso < todayIso;
      const isToday = iso === todayIso;

      let cardHTML;
      let proposal;
      let items = [];

      // 1) Compétitions réelles de ce jour (étapes incluses) — passé / aujourd'hui / futur.
      //    Les jours passés lisent désormais la VRAIE compét depuis la base
      //    (et non plus un snapshot figé), donc les étapes restent correctes.
        const compsForToday = comps.filter(c => toIsoDate(c.dateObj) === iso && !compIsRealised(c));
        for (const c of compsForToday) {
          // Si pas de temps cible saisi → on n'affiche PAS de durée par défaut
          // (on garde un fallback de 120 min en interne pour le calcul TSS)
          let raceDur = null;
          let raceDurForTss = 120;
          {
            const _rm = parseTimeToMin(c.target);
            if (_rm) { raceDur = _rm; raceDurForTss = _rm; }
          }
          const raceTss = Math.round(raceDurForTss * 1.0);
          let raceName, stageInfo = '';
          if (c.stageIdx !== undefined && c.totalStages) {
            raceName = c.name.replace(/ — Étape \d+$/, '');
            stageInfo = `Étape ${c.stageIdx + 1}/${c.totalStages}`;
          } else {
            raceName = c.name;
          }
          items.push({
            type: 'vo2',
            name: raceName,
            stageInfo,
            isRace: true,
            dur: raceDur,
            tss: raceTss,
            sport: c.sport || 'Ride',
            km: c.km || null,
            dplus: c.dplus || null,
            priority: c.priority,
            why: `Compétition · ${compPrio(c.priority).label}${c.km ? ' · ' + Math.round(c.km) + ' km' : ''}`,
          });
        }

        // 2) Tous les entraînements prévus manuels pour ce jour
        const manualTrainings = ((typeof loadTrainings === 'function') ? loadTrainings() : []).filter(t => !window.coachModeKeep || window.coachModeKeep(t.ia));
        const manualForToday = manualTrainings.filter(t => t.date === iso && !_realisedKeySet.has(String(t.id)) && !(t._sbId && _realisedKeySet.has(String(t._sbId))));
        for (const m of manualForToday) {
          items.push({
            type: m.type || 'endurance',
            name: m.name,
            dur: m.duration || 0,
            tss: m.tss || 0,
            sport: m.sport || 'Ride',
            why: m.notes || 'Séance ajoutée manuellement',
            structure: m.structure || null,
            km: m.km || null,
            dplus: m.dplus || null,
            rpe: (m.rpe != null ? m.rpe : null),
            _manual: true,
          });
        }

        // 3) Aucun item réel pour ce jour → uniquement un repos forcé éventuel.
        //    (Plus de séance auto-générée : la planification IA passe par le chat.)
        if (items.length === 0 && !isPast) {
          const _isForcedRest = (typeof isRestDayForMode === 'function') && isRestDayForMode(iso);
          if (_isForcedRest) {
            items.push({ type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Repos forcé (override utilisateur)' });
          }
        }

        // 4) Filtre sport : ne garder que les items dont la catégorie match les sports actifs.
        // Les repos passent toujours (ils n'ont pas de sport propre).
        if (!activeSports.has('tout') && activeSports.size > 0) {
          items = items.filter(it => it.type === 'rest' || activeSports.has(getSportCategory(it.sport)));
        }

        // 5) Si aucun item ne passe le filtre → jour vide, on saute le rendu de la card normale
        if (items.length === 0) {
          cardHTML = `
            <div class="day-card empty-past${isToday ? ' today' : ''}" data-iso="${iso}" data-source="prevu">
              <div class="day-card-dow">${dowFr[dow]}${isToday ? '<span class="dow-suffix"> · auj.</span>' : ''}</div>
              <div class="day-card-date">${d.getDate()}</div>
            </div>
          `;
          dayCards.push(cardHTML);
          continue;
        }

        // Index de l'item actuellement affiché (pour multi-items)
        const curIdx = Math.min(dayPrevuIndex[iso] || 0, items.length - 1);
        proposal = items[curIdx];
        proposal._totalItems = items.length;
        proposal._itemIdx = curIdx;

      // Une séance est "rest" uniquement si son TYPE est 'rest'
      // (un entraînement manuel sans TSS reste un vrai entraînement, pas un repos)
      const isRest = proposal.type === 'rest';
      const todayClass = isToday ? ' today' : '';
      const pastClass = isPast ? ' prevu-past' : '';
      // On comptabilise dans les totaux uniquement aujourd'hui + futur (pas le passé)
      if (!isPast && proposal.tss) {
        weekTotalDur += proposal.dur || 0;
        weekTotalTss += proposal.tss || 0;
        weekTotalSessions += 1;
      }
      // L'item actuellement affiché peut être une compé ou un entraînement manuel
      const isRace = !!proposal.isRace;
      const raceClass = isRace ? ' race' : '';
      const raceAttr = isRace ? ` data-prio="${compPrio(proposal.priority).key}"` : '';
      // Sport label
      let sportLabel = '';
      let sportCat = 'autre';
      if (!isRest) {
        sportLabel = window.sportFr(proposal.sport || 'cyclisme');
        sportCat = window.activitySportColorKey({ sport: proposal.sport || 'cyclisme' }) || 'autre';
      }
      const kmStr = proposal.km ? Math.round(proposal.km) + ' km' : '';
      const durStr = proposal.dur ? fmtDur(proposal.dur) : '';
      const dplusStr = proposal.dplus ? Math.round(proposal.dplus) + ' m D+' : '';
      const rpeStr = (proposal.rpe != null && proposal.rpe !== '') ? 'RPE ' + proposal.rpe : '';
      const metaLine = [durStr, kmStr, dplusStr, rpeStr]
        .filter(Boolean)
        .map(p => `<span class="dst-meta-item">${p}</span>`)
        .join('');
      const sportBlock = sportLabel
        ? `<div class="day-card-sport"><span class="sport-pill" data-sport-cat="${sportCat}">${sportLabel}</span></div>`
        : '';
      const dowSuffix = isToday ? '<span class="dow-suffix"> · auj.</span>'
                       : (isPast ? '<span class="dow-suffix"> · passé</span>' : '');
      const stageInfoLine = (proposal.stageInfo)
        ? `<div class="day-card-stage">${proposal.stageInfo}</div>`
        : '';
      // Meme langage visuel que le Realise : tuile mono / colonnes multi / repos.
      const totalItems = proposal._totalItems || 1;
      const hasMulti = totalItems > 1;
      const _dow = `<div class="day-card-dow">${dowFr[dow]}${dowSuffix}</div>`;
      const _date = `<div class="day-card-date">${d.getDate()}</div>`;

      if (hasMulti) {
        let _list = items.map((it, i) => ({ it, i }));
        if (_list.length > 3) {
          _list = _list.slice().sort((x, y) => (y.it.dur || 0) - (x.it.dur || 0)).slice(0, 3).sort((x, y) => x.i - y.i);
        }
        const cols = _list.map(({ it, i }) => {
          const _r = !!it.isRace;
          const hex = _r ? compPrio(it.priority).color : (window.sportColor ? window.sportColor(it.sport) : '#9ca3af');
          const g = _r ? trophySvg(hex, 16) : (window.sportGlyph ? window.sportGlyph(it.sport, 22) : '');
          // Format compact pour colonnes étroites : "42m" au lieu de "42 min"
          // (évite que "min" parte sur une 2e ligne quand 4-5 activités en parallèle)
          const tRaw = it.dur ? fmtDur(it.dur) : (it.km ? Math.round(it.km) + ' km' : '');
          const t = tRaw.replace(' min', 'm');
          const nm = it.name || 'Séance';
          return `<div class="day-multi-col" data-iso="${iso}" data-source="prevu" data-actidx="${i}" title="${String(nm).replace(/\"/g, '&quot;')}" style="background:${hex}1a">`
            + `<div class="dmc-bar" style="background:${hex}"></div>`
            + `<div class="dmc-body">${g ? `<span class="dmc-glyph" style="line-height:0">${g}</span>` : ''}${t ? `<span class="dmc-time">${t}</span>` : ''}</div>`
            + `</div>`;
        }).join('');
        cardHTML = `
        <div class="day-card${todayClass}${pastClass} day-card--multi" data-iso="${iso}" data-source="prevu">
          ${_dow}
          ${_date}
          <div class="day-multi-grid">${cols}</div>
        </div>`;
      } else if (isRest) {
        cardHTML = `
        <div class="day-card rest${todayClass}${pastClass}" data-iso="${iso}" data-source="prevu">
          ${_dow}
          ${_date}
          ${REST_COUCH_SVG}
        </div>`;
      } else {
        const _hex = isRace ? compPrio(proposal.priority).color : (window.sportColor ? window.sportColor(proposal.sport) : '#9ca3af');
        const _headGlyph = isRace ? trophySvg(_hex, 18) : (window.sportGlyph ? window.sportGlyph(proposal.sport, 20) : '');
        const _fullProfile = (proposal && Array.isArray(proposal.structure) && proposal.structure.length && window.renderWorkoutProfileHTML)
          ? `<div class="dst-profile">${window.renderWorkoutProfileHTML(proposal.structure, { height: 30, labels: false, padding: 0, bg: 'transparent', border: 'none', radius: 0 })}</div>`
          : '';
        const _nm = proposal.name || 'Séance';
        cardHTML = `
        <div class="day-card${todayClass}${pastClass}${raceClass} day-card--single" data-iso="${iso}" data-source="prevu"${raceAttr}>
          ${_dow}
          ${_date}
          <div class="day-single-tile" style="background:${_hex}1a" title="${String(_nm).replace(/\"/g, '&quot;')}">
            <div class="dmc-bar" style="background:${_hex}"></div>
            <div class="dst-body">
              <div class="dst-head">
                ${_headGlyph ? `<span class="dst-glyph" style="line-height:0">${_headGlyph}</span>` : ''}
                <div class="dst-text">
                  <span class="dst-name">${_nm}</span>
                  ${metaLine ? `<span class="dst-meta">${metaLine}</span>` : ''}
                </div>
              </div>
              ${stageInfoLine}
              ${_fullProfile}
            </div>
          </div>
        </div>`;
      }
      dayCards.push(cardHTML);

      // Détermine si la semaine est passée, en cours ou future
      if (isToday) weekKind = 'current';
      else if (!isPast && weekKind === 'past') weekKind = 'current';
    }
    if (weekStart > today) weekKind = 'future';

    // Carte des totaux (réalisé pour passé/courant, prévu pour future)
    const _wh = Math.floor(weekTotalDur / 60);
    const _wm = Math.round(weekTotalDur % 60);
    const totalHours = weekTotalDur < 60
      ? `${Math.round(weekTotalDur)}<span style="font-size:11px;font-weight:500;"> min</span>`
      : `${_wh}<span style="font-size:11px;font-weight:500;">h</span>${_wm.toString().padStart(2, '0')}`;
    const totalsLabel = weekKind === 'future' ? 'Prévu' : (weekKind === 'current' ? 'En cours' : 'Bilan');
    // Prévu : pas de km réels (à venir), pas de CTL/ATL projetés (complexe)
    const totalsCard = `
      <div class="week-totals" data-view="volume">
        <div class="wt-header">
          <button class="wt-arrow wt-prev" title="Vue précédente">‹</button>
          <span class="wt-label">${totalsLabel}</span>
          <button class="wt-arrow wt-next" title="Vue suivante">›</button>
        </div>
        <div class="wt-view wt-view-volume">
          <div class="wt-row"><span class="wt-ic">${_WT_IC.vol}</span><span class="wt-val">${totalHours}</span><span class="wt-lbl">Volume</span></div>
          <div class="wt-row"><span class="wt-ic">${_WT_IC.km}</span><span class="wt-val">—</span><span class="wt-lbl">Km</span></div>
          <div class="wt-row"><span class="wt-ic">${_WT_IC.sea}</span><span class="wt-val">${weekTotalSessions}</span><span class="wt-lbl">Séances</span></div>
        </div>
        <div class="wt-view wt-view-charge">
          <div class="wt-row"><span class="wt-ic">${_WT_IC.tss}</span><span class="wt-val">${weekTotalTss}</span><span class="wt-lbl">TSS prévu</span></div>
          <div class="wt-row"><span class="wt-ic">${_WT_IC.ctl}</span><span class="wt-val">—</span><span class="wt-lbl">CTL</span></div>
          <div class="wt-row"><span class="wt-ic">${_WT_IC.atl}</span><span class="wt-val">—</span><span class="wt-lbl">ATL</span></div>
        </div>
        <div class="wt-dots">
          <span class="wt-dot d-volume"></span>
          <span class="wt-dot d-charge"></span>
        </div>
      </div>
    `;
    dayCards.push(totalsCard);

    const _wsumDur = weekTotalDur <= 0 ? '' : (weekTotalDur < 60 ? `${Math.round(weekTotalDur)}min` : `${Math.floor(weekTotalDur/60)}h${Math.round(weekTotalDur%60).toString().padStart(2,'0')}`);
    const _wsumKm = (typeof totalKm !== 'undefined' && totalKm > 0) ? ` \u00b7 ${totalKm} km` : '';
    const weekSum = weekTotalSessions > 0 ? `<span class="week-row-sum">${weekTotalSessions} s\u00e9ance${weekTotalSessions>1?'s':''}${_wsumDur?` \u00b7 ${_wsumDur}`:''}${_wsumKm}</span>` : '';
    weeksHtml.push(`
      <div class="week-row">
        <div class="week-row-label">${weekLabel}${weekSum}</div>
        <div class="week-row-days">${dayCards.join('')}</div>
      </div>
    `);
  }

  const _dowHead = '<div class="week-dow-head">' + ['L','M','M','J','V','S','D'].map(function(x){return '<span>'+x+'</span>';}).join('') + '</div>';
  document.getElementById('week-calendar').innerHTML = `<div class="month-plan">${_dowHead}${weeksHtml.join('')}</div>`;
}

// ========= MODE PRÉVU vs RÉALISÉ =========
let calendarMode = (window.coachPrefs && window.coachPrefs.default_tab) || 'realise';
// Synchroniser l'onglet calendrier actif avec la préférence (Paramètres → Affichage).
document.querySelectorAll('#calendar-subtabs .subtab').forEach(b => {
  b.classList.toggle('active', b.dataset.mode === calendarMode);
});
let selectedMonth = null; // null = 4 dernières semaines, sinon Date 1er du mois sélectionné
let calendarAnchorDate = null; // si défini : ancre les 4 semaines sur cette date (clic graphe)
// Index de l'activité affichée par jour (pour les jours multi-activités). Clé = ISO date.
const dayActivityIndex = {};
// Index de l'item Prévu affiché par jour (pour jours avec plusieurs compés/entraînements)
const dayPrevuIndex = {};

function getDisplayedActivity(realDay) {
  // Renvoie l'activité actuellement à afficher pour ce jour (selon dayActivityIndex)
  const iso = toIsoDate(realDay.date);
  const acts = realDay.activities;
  if (!acts || acts.length === 0) return null;
  const idx = dayActivityIndex[iso] || 0;
  return { activity: acts[Math.min(idx, acts.length - 1)], idx: Math.min(idx, acts.length - 1), total: acts.length, iso };
}

function renderRealisedDayCard(d, dow, realDay, isToday) {
  const dispo = getDisplayedActivity(realDay);
  // Si pas de tableau activities (ancien data.js), fallback sur les champs racine du day
  let act = dispo ? dispo.activity : realDay;
  const total = dispo ? dispo.total : 1;
  const idx = dispo ? dispo.idx : 0;
  const iso = toIsoDate(d);

  let dur = act.duration || 0;

  let hasMulti = total > 1;

  // Jour multisport COMPLET (triathlon/brick...) : il se comporte comme
  // N'IMPORTE QUEL SPORT -> une seule tuile classique (pastille Triathlon,
  // durée/distance totales). Le détail par discipline vit dans la modale.
  if (hasMulti && window.SportProfiles && window.SportProfiles.detectMultisport) {
    const _g0 = window.SportProfiles.detectMultisport(realDay.activities);
    if (_g0 && _g0.legs.length === realDay.activities.length) {
      hasMulti = false;
      const _triComp = window.__triCompForDate ? window.__triCompForDate(iso) : null;
      act = {
        name: (_triComp && _triComp.name) || _g0.kind,
        raw_type: 'Triathlon', sport: 'Triathlon',
        type: 'vo2', sessionType: 'vo2',
        duration: _g0.totals.durMin,
        distance_km: +(realDay.activities.reduce((s2, a2) => s2 + (+a2.distance_km || 0), 0).toFixed(1)),
        elevation_gain: realDay.activities.reduce((s2, a2) => s2 + (+a2.elevation_gain || 0), 0),
        tss: Math.round(_g0.totals.tss),
        calories: Math.round(_g0.totals.kcal),
        category: (_triComp || realDay.activities.some(a2 => a2.category === 'competition')) ? 'competition' : undefined,
        priority: (_triComp && _triComp.priority) || (realDay.activities.find(a2 => a2.category === 'competition') || {}).priority,
        structure: null,
      };
      dur = act.duration;
    }
  }

  // Jour multi-activites : on divise la 2e partie de la case en colonnes pleine
  // hauteur (1 par activite : liisere couleur du sport + glyph + duree). Clic = ouvre l'activite.
  if (hasMulti) {
    const _acts = (realDay && realDay.activities && realDay.activities.length) ? realDay.activities : [act];
    // Pas la place d'afficher toutes les activites -> on garde les 3 plus longues
    // (evite les icones coupees en bas de case). Le tap ouvre le detail complet.
    // Ordre d'affichage : CHRONOLOGIQUE (heure de depart) — un triathlon se lit
    // natation -> velo -> course, pas par TSS decroissant.
    const _startMin = (a) => { const m = a.start_date_local && String(a.start_date_local).match(/T(\d{2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : 9999; };
    let _list = _acts.map((a, i) => ({ a, i, t: _startMin(a) }));
    if (_list.length > 3) {
      _list = _list.slice().sort((x, y) => (y.a.duration || 0) - (x.a.duration || 0)).slice(0, 3);
    }
    _list.sort((x, y) => (x.t - y.t) || (x.i - y.i));
    const cols = _list.map(({ a, i }) => {
      const isComp = a.category === 'competition';
      const hex = isComp ? compPrio(a.priority).color : (window.sportColor ? window.sportColor(a.raw_type || a.sport) : '#9ca3af');
      const g = isComp ? trophySvg(hex, 16) : (window.sportGlyph ? window.sportGlyph(a.raw_type || a.sport, 22) : '');
      // Format compact pour colonnes étroites : "42m" au lieu de "42 min"
      const _tRaw = a.duration ? fmtDur(a.duration) : (a.distance_km ? Math.round(a.distance_km) + ' km' : '');
      const t = _tRaw.replace(' min', 'm');
      const _nm = a.name || a.sessionName || 'Séance';
      return `<div class="day-multi-col" data-iso="${iso}" data-source="realise" data-actidx="${i}" title="${String(_nm).replace(/"/g, '&quot;')}" style="background:${hex}1a">`
        + `<div class="dmc-bar" style="background:${hex}"></div>`
        + `<div class="dmc-body">${g ? `<span class="dmc-glyph" style="line-height:0">${g}</span>` : ''}${t ? `<span class="dmc-time">${t}</span>` : ''}</div>`
        + `</div>`;
    }).join('');
    // Jour multisport (triathlon/brick...) : badge + attribut pour la couleur dédiée
    let _msAttr = '', _msBadge = '';
    if (window.SportProfiles && window.SportProfiles.detectMultisport) {
      const _g = window.SportProfiles.detectMultisport(_acts);
      if (_g && _g.legs.length === _acts.length) {
        _msAttr = ' data-sport-cat="triathlon"';
        _msBadge = `<span class="day-ms-badge">${_g.kind === 'Triathlon' ? 'TRI' : _g.kind.split(' ')[0].toUpperCase()}</span>`;
      }
    }
    return `
    <div class="day-card past${isToday ? ' today' : ''} day-card--multi"${_msAttr} data-iso="${iso}" data-source="realise">
      <div class="day-card-dow">${dowFr[dow]}${isToday ? '<span class="dow-suffix"> · auj.</span>' : ''}</div>
      <div class="day-card-date">${d.getDate()}${_msBadge}</div>
      <div class="day-multi-grid">${cols}</div>
    </div>
  `;
  }

  const dateRow = hasMulti ? `
    <div class="day-card-date-row">
      <div class="day-card-date">${d.getDate()}</div>
      <div class="day-card-arrows-wrapper">
        <button class="day-card-arrow-inline arrow-prev" data-iso="${iso}" title="Activité précédente">‹</button>
        <button class="day-card-arrow-inline arrow-next" data-iso="${iso}" title="Activité suivante">›</button>
      </div>
    </div>
  ` : `<div class="day-card-date">${d.getDate()}</div>`;

  const counter = hasMulti ? `<div class="day-card-counter">${idx + 1}/${total}</div>` : '';

  // Fallbacks robustes pour data.js ancien format (champs day-level)
  const aType = act.type || act.sessionType || '';
  const aName = act.name || act.sessionName || 'Séance';
  const km = act.distance_km ? Math.round(act.distance_km) + ' km' : '';
  // Nom de sport Strava exact + clé couleur pour la pill
  let sportLabel = window.activitySportLabel ? window.activitySportLabel(act) : '';
  let sportCat = window.activitySportColorKey ? window.activitySportColorKey(act) : 'autre';
  // Jour multisport détecté (enchaînement nat/vélo/course) : le jour EST un
  // triathlon/brick — pastille et couleur du sport Triathlon sur la tuile.
  if (realDay && Array.isArray(realDay.activities) && realDay.activities.length > 1
      && window.SportProfiles && window.SportProfiles.detectMultisport) {
    const _g = window.SportProfiles.detectMultisport(realDay.activities);
    if (_g && _g.legs.length === realDay.activities.length) { sportLabel = _g.kind; sportCat = 'triathlon'; }
  }

  // Jour de compétition : détecté par la CATÉGORIE de l'activité (fiable pour
  // toutes les étapes), avec repli sur la liste compétitions par date.
  const comps = (typeof loadCompetitionsExpanded === 'function') ? loadCompetitionsExpanded() : [];
  const compToday = comps.find(c => c.date === iso);
  const isCompAct = act.category === 'competition';
  const raceClass = isCompAct ? ' race' : '';
  const raceAttr = isCompAct ? ` data-prio="${compPrio(compToday ? compToday.priority : null).key}"` : '';

  // Meta : pilotée par le profil du sport (course → allure, natation → m, muscu → TSS...)
  let metaParts = [];
  if (window.SportProfiles) {
    metaParts = window.SportProfiles.shortMeta(act);
  } else {
    if (dur) metaParts.push(fmtDur(dur));
    if (km) metaParts.push(km);
    else if (act.tss) metaParts.push(act.tss + ' TSS');
    if (act.elevation_gain) metaParts.push(Math.round(act.elevation_gain) + ' m D+');
    if (act.rpe != null && act.rpe !== '') metaParts.push('RPE ' + act.rpe);
  }
  // Chaque item dans son propre span → CSS peut stacker en colonne sur petits écrans
  // sans wrap moche au milieu de "36 km".
  const metaLine = metaParts.map(p => `<span class="dst-meta-item">${p}</span>`).join('');

  // Marqueur si TOUTES les activités du jour sont manuelles (= pas tracké par Strava)
  const allManual = realDay && realDay.activities && realDay.activities.length
    && realDay.activities.every(a => a._manual);
  const manualClass = allManual ? ' manual' : '';

  // Sport block : ne rendre QUE si on a un label (sinon = ligne dashed orpheline qui fait croire à un jour de repos)
  const sportBlock = sportLabel
    ? `<div class="day-card-sport"><span class="sport-pill" data-sport-cat="${sportCat}">${sportLabel}</span></div>`
    : '';

  // Mini-profil d'intervalles dans la carte (si la seance a une structure).
  const _miniProfile = (act && Array.isArray(act.structure) && act.structure.length && window.renderWorkoutProfileHTML)
    ? `<div class="day-card-profile" style="margin-top:8px;">${window.renderWorkoutProfileHTML(act.structure, { height: 30, labels: false, padding: 0, bg: 'transparent', border: 'none', radius: 0 })}</div>`
    : '';

  // Mono-activite : meme look "tuile" que le multi, mais une seule tuile pleine largeur.
  // Glyph en debut de ligne (gagne de la hauteur) + profil d'intervalles toute largeur.
  const _hex = isCompAct
    ? compPrio(compToday ? compToday.priority : null).color
    : (window.sportColor ? window.sportColor(act.raw_type || act.sport) : '#9ca3af');
  const _headGlyph = isCompAct
    ? trophySvg(_hex, 18)
    : (window.sportGlyph ? window.sportGlyph(act.raw_type || act.sport, 20) : '');
  const _fullProfile = (act && Array.isArray(act.structure) && act.structure.length && window.renderWorkoutProfileHTML)
    ? `<div class="dst-profile">${window.renderWorkoutProfileHTML(act.structure, { height: 30, labels: false, padding: 0, bg: 'transparent', border: 'none', radius: 0 })}</div>`
    : '';
  return `
    <div class="day-card past${isToday ? ' today' : ''}${raceClass}${manualClass} day-card--single" data-iso="${iso}" data-source="realise"${raceAttr}>
      <div class="day-card-dow">${dowFr[dow]}${isToday ? '<span class="dow-suffix"> · auj.</span>' : ''}</div>
      <div class="day-card-date">${d.getDate()}</div>
      <div class="day-single-tile" style="background:${_hex}1a" title="${String(aName).replace(/"/g, '&quot;')}">
        <div class="dmc-bar" style="background:${_hex}"></div>
        <div class="dst-body">
          <div class="dst-head">
            ${_headGlyph ? `<span class="dst-glyph" style="line-height:0">${_headGlyph}</span>` : ''}
            <div class="dst-text">
              <span class="dst-name">${aName}</span>
              ${metaLine ? `<span class="dst-meta">${metaLine}</span>` : ''}
            </div>
          </div>
          ${_fullProfile}
        </div>
      </div>
    </div>
  `;
}

function renderCalendar() {
  // Filtre mois visible dans les deux modes
  document.getElementById('month-filter').style.display = 'flex';
  // Reset button label selon le mode
  const resetBtn = document.getElementById('month-reset');
  if (resetBtn) {
    resetBtn.textContent = calendarMode === 'prevu' ? '4 sem. à venir' : '4 dern. sem.';
  }
  if (window.__updateMonthOverlay) window.__updateMonthOverlay();
  if (calendarMode === 'prevu') {
    renderWeekPlan();
  } else {
    renderRealiseCalendar();
  }
}

// Expose les fonctions principales sur window pour que les modules ES6 externes
// (day-extras.js notamment) puissent les appeler.
window.renderCalendar = renderCalendar;
window.openTrainModal = openTrainModal;
window.openCompModal = openCompModal;
window.renderCompList = (typeof renderCompList === 'function') ? renderCompList : (() => {});

function renderRealiseCalendar() {
  // Sous-titre supprimé
  const subEl = { textContent: '' };

  // Index data par ISO
  const dataByIso = {};
  data.forEach(d => { dataByIso[toIsoDate(d.date)] = d; });
  // Competitions RÉALISÉES (créées depuis le calendrier réalisé) à injecter dans les jours.
  const realisedComps = (typeof loadCompetitionsExpanded === 'function')
    ? loadCompetitionsExpanded().filter(compIsRealised) : [];

  // Déterminer les semaines à afficher
  let weeksStarts = [];
  if (selectedMonth) {
    // Mois sélectionné : juste les semaines de ce mois, sans injection de semaine courante
    const firstDay = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
    const lastDay = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);
    const firstMonday = getMondayOfWeek(firstDay);
    let cursor = new Date(firstMonday);
    while (cursor <= lastDay) {
      weeksStarts.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    const monthLabel = selectedMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    subEl.textContent = `Réalisé · ${monthLabel}`;
  } else {
    // 4 semaines se terminant par la semaine d'ancrage (par défaut : aujourd'hui).
    // Si on vient d'un clic sur le graphe, l'ancre = la date de l'activité → sa
    // semaine se retrouve tout en haut après l'inversion.
    const anchor = calendarAnchorDate || today;
    const thisMonday = getMondayOfWeek(anchor);
    for (let i = 3; i >= 0; i--) {
      const w = new Date(thisMonday);
      w.setDate(thisMonday.getDate() - i * 7);
      weeksStarts.push(w);
    }
    subEl.textContent = `Réalisé · 4 dernières semaines`;
  }
  // Inversion : semaine la plus récente du mois en haut
  weeksStarts.reverse();

  const todayIso = toIsoDate(today);
  const weeksHtml = [];
  for (const weekStart of weeksStarts) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekLabel = `Semaine du ${fmtShortDate(weekStart)} au ${fmtShortDate(weekEnd)}`;

    const dayCards = [];
    let weekTotalDur = 0;
    let weekTotalTss = 0;
    let weekTotalSessions = 0;
    let weekTotalKm = 0;
    let lastDayWithMetrics = null; // pour récupérer CTL/ATL en fin de semaine

    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = toIsoDate(d);
      const dow = d.getDay();
      const isFuture = iso > todayIso;
      const isToday = iso === todayIso;

      let cardHTML;
      if (isFuture) {
        // Jour futur : on n'affiche rien (mode réalisé)
        cardHTML = `
          <div class="day-card empty-past" data-iso="${iso}" data-source="realise" style="opacity:0.3;">
            <div class="day-card-dow">${dowFr[dow]}</div>
            <div class="day-card-date">${d.getDate()}</div>
            <div class="day-card-name" style="color:var(--text-mute);font-weight:500;">À venir</div>
          </div>
        `;
      } else {
        let realDay = dataByIso[iso];
        // Filtre les activités Strava masquées par l'utilisateur (suppression locale)
        if (realDay && realDay.activities && typeof isStravaIgnored === 'function') {
          const filtered = realDay.activities.filter(a => {
            if (a._manual) return true;
            const aid = a.id || a.activityId;
            return !aid || !isStravaIgnored(aid);
          });
          if (filtered.length !== realDay.activities.length) {
            realDay = { ...realDay, activities: filtered };
            // Si plus aucune activité après filtrage, on traite comme un jour sans data
            if (filtered.length === 0) realDay = null;
          }
        }
        // Récupère les entraînements MANUELS réalisés (ex: muscu, yoga ajoutés à la main)
        const manualRealised = (typeof loadRealisedTrainings === 'function') ? loadRealisedTrainings().filter(t => t.date === iso) : [];
        // Si on a des manuels et pas de realDay Strava, on en crée un virtuel
        // Si on a déjà un realDay Strava, on merge les activités manuelles dedans
        if (manualRealised.length > 0) {
          // Clone pour NE PAS muter l'objet partage de `data` (sinon les seances
          // manuelles s'accumulent a chaque rendu -> doublons).
          if (!realDay) realDay = { date: iso, activities: [], sessionType: 'autre' };
          else realDay = { ...realDay, activities: [...(realDay.activities || [])] };
          for (const m of manualRealised) {
            // Dedoublonnage : si la meme seance est deja presente via DASHBOARD_DATA (DB),
            // on retire la version DB et on garde la version locale (valeurs a jour).
            // Source unique = base : si la version DB de cette seance est deja la,
            // on l'affiche (la version localStorage ne sert que de tampon non-synchronise).
            const _dbTwin = realDay.activities.some(x => (
              (m._sbId && String(x._sbId) === String(m._sbId)) ||
              (m.id && String(x.client_id) === String(m.id))
            ));
            if (_dbTwin) continue;
            const sportVal = m.sport || 'autre';
            realDay.activities.push({
              name: m.name,
              sport: sportVal,
              raw_type: sportVal, // utilisé par activitySportLabel / Color pour le pill
              type: m.type || 'endurance',
              sessionType: m.type || 'endurance',
              sessionName: m.name,
              duration: m.duration || 0,
              tss: m.tss || 0,
              distance_km: m.km || null,
              elevation_gain: m.dplus || null,
              rpe: (m.rpe != null ? m.rpe : null),
              laps: (m.laps != null ? m.laps : null),
              gpxName: m.gpxName || null,
              gpxContent: m.gpxContent || null,
              structure: m.structure || null,
              _manual: true,
              _manualId: m.id, // id pour edit/delete depuis la modal
              notes: m.notes || '',
            });
          }
          // Recalcule duration et tss au niveau jour si pas déjà set
          if (!realDay.duration) realDay.duration = realDay.activities.reduce((s, a) => s + (a.duration || 0), 0);
          if (!realDay.tss) realDay.tss = realDay.activities.reduce((s, a) => s + (a.tss || 0), 0);
          if (!realDay.sessionType) realDay.sessionType = realDay.activities[0].type || 'endurance';
          if (!realDay.sessionName) realDay.sessionName = realDay.activities[0].name;
        }
        // Compétitions réalisées de ce jour -> injectées comme activités "course".
        const compsRealisedToday = realisedComps.filter(c => c.date === iso);
        if (compsRealisedToday.length > 0) {
          if (!realDay) realDay = { date: iso, activities: [], sessionType: 'vo2' };
          else realDay = { ...realDay, activities: [...(realDay.activities || [])] };
          for (const c of compsRealisedToday) {
            // Mêmes garde-fous que buildRealisedDay : jamais de pseudo-entrée si
            // une vraie activité compétition existe, ni si l'enchaînement tri
            // réalisé EST la compétition ; dédup par nom en secours.
            if (realDay.activities.some(x => x.category === 'competition' && !x._comp)) continue;
            if (typeof getSportCategory === 'function' && getSportCategory(c.sport) === 'triathlon'
                && window.SportProfiles && window.SportProfiles.detectMultisport) {
              const _gg2 = window.SportProfiles.detectMultisport(realDay.activities.filter(x => !x._comp));
              if (_gg2 && _gg2.legs.length >= 2) continue;
            }
            if (realDay.activities.some(x =>
              (x._sbId && ((c._sbId && String(x._sbId) === String(c._sbId)) || (c.id && String(x.client_id) === String(c.id)))) ||
              (x.name && c.name && String(x.name).trim() === String(c.name).trim())
            )) continue;
            const cDur = (typeof parseTimeToMin === 'function' ? parseTimeToMin(c.target) : 0) || 0;
            realDay.activities.push({
              name: c.name, sport: c.sport || 'Ride', raw_type: c.sport || 'Ride',
              type: 'vo2', sessionType: 'vo2', sessionName: c.name,
              duration: cDur, tss: cDur ? Math.round(cDur) : 0,
              distance_km: c.km || null, elevation_gain: c.dplus || null, laps: c.laps || null,
              category: 'competition', priority: c.priority || null,
              _comp: true, _compId: c.id, notes: c.notes || '',
            });
          }
          if (!realDay.sessionName && realDay.activities[0]) realDay.sessionName = realDay.activities[0].name;
          if (!realDay.sessionType) realDay.sessionType = 'vo2';
        }
        // Mémorise le dernier jour avec CTL/ATL
        if (realDay && (realDay.ctl != null || realDay.atl != null)) {
          lastDayWithMetrics = realDay;
        }
        if (realDay && (realDay.sessionType || (realDay.activities && realDay.activities.length))) {
          const dur = realDay.duration || 0;
          weekTotalDur += dur;
          weekTotalTss += realDay.tss || 0;
          weekTotalSessions += (realDay.activities && realDay.activities.length) ? realDay.activities.length : 1;
          if (realDay.activities && realDay.activities.length) {
            for (const a of realDay.activities) weekTotalKm += a.distance_km || 0;
          } else if (realDay.distance_km) {
            weekTotalKm += realDay.distance_km;
          }
          cardHTML = renderRealisedDayCard(d, dow, realDay, isToday);
        } else {
          cardHTML = `
            <div class="day-card empty-past rest-clickable${isToday ? ' today' : ''}" data-iso="${iso}" data-source="realise">
              <div class="day-card-dow">${dowFr[dow]}${isToday ? '<span class="dow-suffix"> · auj.</span>' : ''}</div>
              <div class="day-card-date">${d.getDate()}</div>
              <div class="day-card-name" style="color:var(--text-mute);font-weight:500;">Repos</div>
              ${REST_COUCH_SVG}
            </div>
          `;
        }
      }
      dayCards.push(cardHTML);
    }

    const _rh = Math.floor(weekTotalDur / 60);
    const _rm = Math.round(weekTotalDur % 60);
    const totalHours = weekTotalDur < 60
      ? `${Math.round(weekTotalDur)}<span style="font-size:11px;font-weight:500;"> min</span>`
      : `${_rh}<span style="font-size:11px;font-weight:500;">h</span>${_rm.toString().padStart(2, '0')}`;
    const totalKm = Math.round(weekTotalKm);
    const lastCtl = lastDayWithMetrics && lastDayWithMetrics.ctl != null ? Math.round(lastDayWithMetrics.ctl) : '—';
    const lastAtl = lastDayWithMetrics && lastDayWithMetrics.atl != null ? Math.round(lastDayWithMetrics.atl) : '—';
    const totalsCard = `
      <div class="week-totals" data-view="volume">
        <div class="wt-header">
          <button class="wt-arrow wt-prev" title="Vue précédente">‹</button>
          <span class="wt-label">Bilan</span>
          <button class="wt-arrow wt-next" title="Vue suivante">›</button>
        </div>
        <div class="wt-view wt-view-volume">
          <div class="wt-row"><span class="wt-ic">${_WT_IC.vol}</span><span class="wt-val">${totalHours}</span><span class="wt-lbl">Volume</span></div>
          <div class="wt-row"><span class="wt-ic">${_WT_IC.km}</span><span class="wt-val">${totalKm}<span style="font-size:11px;font-weight:500;">km</span></span><span class="wt-lbl">Distance</span></div>
          <div class="wt-row"><span class="wt-ic">${_WT_IC.sea}</span><span class="wt-val">${weekTotalSessions}</span><span class="wt-lbl">Séances</span></div>
        </div>
        <div class="wt-view wt-view-charge">
          <div class="wt-row"><span class="wt-ic">${_WT_IC.tss}</span><span class="wt-val">${weekTotalTss}</span><span class="wt-lbl">TSS</span></div>
          <div class="wt-row"><span class="wt-ic">${_WT_IC.ctl}</span><span class="wt-val">${lastCtl}</span><span class="wt-lbl">CTL</span></div>
          <div class="wt-row"><span class="wt-ic">${_WT_IC.atl}</span><span class="wt-val">${lastAtl}</span><span class="wt-lbl">ATL</span></div>
        </div>
        <div class="wt-dots">
          <span class="wt-dot d-volume"></span>
          <span class="wt-dot d-charge"></span>
        </div>
      </div>
    `;
    dayCards.push(totalsCard);

    const _wsumDur = weekTotalDur <= 0 ? '' : (weekTotalDur < 60 ? `${Math.round(weekTotalDur)}min` : `${Math.floor(weekTotalDur/60)}h${Math.round(weekTotalDur%60).toString().padStart(2,'0')}`);
    const _wsumKm = (typeof totalKm !== 'undefined' && totalKm > 0) ? ` \u00b7 ${totalKm} km` : '';
    const weekSum = weekTotalSessions > 0 ? `<span class="week-row-sum">${weekTotalSessions} s\u00e9ance${weekTotalSessions>1?'s':''}${_wsumDur?` \u00b7 ${_wsumDur}`:''}${_wsumKm}</span>` : '';
    weeksHtml.push(`
      <div class="week-row">
        <div class="week-row-label">${weekLabel}${weekSum}</div>
        <div class="week-row-days">${dayCards.join('')}</div>
      </div>
    `);
  }

  const _dowHead = '<div class="week-dow-head">' + ['L','M','M','J','V','S','D'].map(function(x){return '<span>'+x+'</span>';}).join('') + '</div>';
  document.getElementById('week-calendar').innerHTML = `<div class="month-plan">${_dowHead}${weeksHtml.join('')}</div>`;
}

// Handler flèches + clic carte (event delegation sur le calendrier)
document.getElementById('week-calendar').addEventListener('click', (e) => {
  // Flèches de switch de vue sur les cartes totaux (Volume ↔ Charge)
  const isWtArrow = e.target.classList.contains('wt-arrow');
  if (isWtArrow) {
    e.stopPropagation();
    const card = e.target.closest('.week-totals');
    if (!card) return;
    const current = card.getAttribute('data-view') || 'volume';
    const views = ['volume', 'charge'];
    const idx = views.indexOf(current);
    const dir = e.target.classList.contains('wt-next') ? 1 : -1;
    let next = (idx + dir + views.length) % views.length;
    card.setAttribute('data-view', views[next]);
    return;
  }

  // Flèches multi-activités sur les cartes jour (mode Réalisé)
  const isPrev = e.target.classList.contains('arrow-prev');
  const isNext = e.target.classList.contains('arrow-next');
  if (isPrev || isNext) {
    e.stopPropagation();
    const iso = e.target.dataset.iso;
    const day = data.find(d => toIsoDate(d.date) === iso);
    if (!day || !day.activities || day.activities.length < 2) return;
    const dir = isNext ? 1 : -1;
    const current = dayActivityIndex[iso] || 0;
    let next = current + dir;
    if (next < 0) next = day.activities.length - 1;
    if (next >= day.activities.length) next = 0;
    dayActivityIndex[iso] = next;
    renderCalendar();
    return;
  }
  // Flèches multi-items sur les cartes Prévu (compés + entraînements manuels)
  const isPrevPrevu = e.target.classList.contains('arrow-prev-prevu');
  const isNextPrevu = e.target.classList.contains('arrow-next-prevu');
  if (isPrevPrevu || isNextPrevu) {
    e.stopPropagation();
    const iso = e.target.dataset.iso;
    // On compte le nombre d'items pour ce jour (compés + manuels)
    const compsExp = (typeof loadCompetitionsExpanded === 'function') ? loadCompetitionsExpanded() : [];
    const nbComps = compsExp.filter(c => c.date === iso).length;
    const manualTr = ((typeof loadTrainings === 'function') ? loadTrainings() : []).filter(t => !window.coachModeKeep || window.coachModeKeep(t.ia));
    const nbManual = manualTr.filter(t => t.date === iso).length;
    const total = nbComps + nbManual;
    if (total < 2) return;
    const dir = isNextPrevu ? 1 : -1;
    const current = dayPrevuIndex[iso] || 0;
    let next = current + dir;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    dayPrevuIndex[iso] = next;
    renderCalendar();
    return;
  }
  // Clic sur une colonne (jour multi-activites) -> ouvre l'activite ciblee
  const _mcol = e.target.closest('.day-multi-col');
  if (_mcol) {
    e.stopPropagation();
    const _ci = parseInt(_mcol.dataset.actidx, 10) || 0;
    const _csrc = _mcol.dataset.source || 'realise';
    if (_csrc === 'prevu') dayPrevuIndex[_mcol.dataset.iso] = _ci;
    else window.__openActIdx = _ci;
    openSessionModal(_mcol.dataset.iso, _csrc);
    return;
  }
  // Clic sur la carte → ouvrir la modal (sauf si c'est une carte totaux)
  const card = e.target.closest('.day-card');
  if (!card) return;
  const iso = card.dataset.iso;
  const source = card.dataset.source;
  if (!iso) return;
  // Jour de repos passé : clic → détail récupération (Whoop) au lieu de rien.
  if (card.classList.contains('empty-past')) {
    if (card.classList.contains('rest-clickable')) openRestDayModal(iso);
    return;
  }
  openSessionModal(iso, source);
});

// ========= API CLIENT INTERVALS.ICU (via Cloudflare Worker proxy) =========
const streamsCache = {};
const activityCache = {};
const STREAMS_LS_KEY = 'coach_ia_streams_cache_v1';
const STREAMS_LS_MAX = 30; // garder les 30 derniers streams en localStorage

async function apiFetch(path) {
  const resp = await fetch(`/api/intervals${path}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

function _lsGet() {
  try { return JSON.parse(localStorage.getItem(STREAMS_LS_KEY) || '{}'); }
  catch { return {}; }
}
function _lsSet(cache) {
  try { localStorage.setItem(STREAMS_LS_KEY, JSON.stringify(cache)); }
  catch (e) {
    console.warn('LS streams cache plein, on vide');
    try { localStorage.removeItem(STREAMS_LS_KEY); } catch {}
  }
}
function loadStreamsFromLS(activityId) {
  const cache = _lsGet();
  return cache[activityId] ? cache[activityId].data : null;
}
function saveStreamsToLS(activityId, data) {
  let cache = _lsGet();
  cache[activityId] = { data, ts: Date.now() };
  const entries = Object.entries(cache);
  if (entries.length > STREAMS_LS_MAX) {
    entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    cache = Object.fromEntries(entries.slice(0, STREAMS_LS_MAX));
  }
  _lsSet(cache);
}

async function loadStreams(activityId) {
  if (!activityId) return null;
  const idKey = String(activityId);
  // 0. Pre-fetched côté serveur (streams.js, dispo dès le chargement)
  if (window.STREAMS_CACHE && window.STREAMS_CACHE[idKey]) {
    return window.STREAMS_CACHE[idKey];
  }
  // 1. Cache mémoire de la session courante
  if (streamsCache[activityId] !== undefined) return streamsCache[activityId];
  // 2. Cache localStorage (persiste entre sessions)
  const cached = loadStreamsFromLS(activityId);
  if (cached) {
    streamsCache[activityId] = cached;
    return cached;
  }
  // 3. Supabase : streams stockés compressés (gzip+base64) dans activities.streams_gz.
  //    On les récupère à la demande pour CETTE activité uniquement.
  try {
    const data = await loadStreamsFromSupabase(activityId);
    if (data) {
      streamsCache[activityId] = data;
      saveStreamsToLS(activityId, data);
      return data;
    }
  } catch (e) {
    console.error('loadStreams (supabase):', e);
  }
  // 4. Pas de streams disponibles (activité sans capteur, ou pas encore syncée)
  streamsCache[activityId] = null;
  return null;
}

// Récupère et décompresse les streams d'une activité depuis Supabase.
// activityId = strava_id (tel que stocké dans DASHBOARD_DATA).
async function loadStreamsFromSupabase(activityId) {
  const sb = window.sb;
  const user = window._coachIaUser || (sb && (await sb.auth.getUser()).data.user);
  if (!sb || !user || activityId == null) return null;
  // strava_id est un bigint : n'utiliser ce filtre QUE pour un id numérique
  // (les entrées manuelles/compétitions ont des UUID -> 400 PostgREST sinon).
  const idStr = String(activityId).replace(/^[si]/, '');
  let q = sb.from('activities').select('streams_gz, streams_format').eq('user_id', user.id);
  if (/^\d+$/.test(idStr)) q = q.eq('strava_id', idStr);
  else q = q.or(`id.eq.${idStr},client_id.eq.${idStr}`);
  const { data, error } = await q.maybeSingle();
  if (error || !data || !data.streams_gz || data.streams_format === 'none') return null;
  return await gunzipBase64ToJson(data.streams_gz);
}

// Décompresse une string base64(gzip(JSON)) → objet JS (via DecompressionStream).
async function gunzipBase64ToJson(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const text = await new Response(ds.readable).text();
  return JSON.parse(text);
}

async function loadActivityFull(activityId) {
  if (!activityId) return null;
  if (activityCache[activityId] !== undefined) return activityCache[activityId];
  try {
    const data = await apiFetch(`/activity/${activityId}`);
    activityCache[activityId] = data;
    return data;
  } catch (e) {
    console.error('loadActivityFull:', e);
    activityCache[activityId] = null;
    return null;
  }
}

// Downsample un tableau pour rendre Chart.js fluide (séances de 3h+ = 10000+ points)
function downsample(arr, targetSize = 600) {
  if (!arr || arr.length <= targetSize) return arr ? [...arr] : [];
  const step = arr.length / targetSize;
  const out = new Array(targetSize);
  for (let i = 0; i < targetSize; i++) {
    const s = Math.floor(i * step);
    const e = Math.min(arr.length, Math.floor((i + 1) * step));
    let sum = 0, count = 0;
    for (let j = s; j < e; j++) {
      const v = arr[j];
      if (v != null && !isNaN(v)) { sum += v; count++; }
    }
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

function formatHMS(seconds) {
  if (seconds == null || isNaN(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2,'0')}`;
  if (m > 0) return `${m}m${s.toString().padStart(2,'0')}`;
  return `${s}s`;
}

// Tracker des charts modal pour les détruire à la prochaine ouverture
// ============================================================
// CATALOGUE DE SPORTS — tous les types reconnus par intervals.icu
// Key = type Strava/intervals.icu, value = { fr, category, icon }
// Utilisé pour : catégorisation activités, sélecteur sport pour
// création d'entraînements futurs, filtres, affichage modal.
// ============================================================
// Catalogue aligné sur les libellés FR officiels Strava (ce que tu vois sur strava.com)
window.SPORTS_CATALOG = {
  // Triathlon & enchaînements (sport à part entière)
  Triathlon: { fr: 'Triathlon', category: 'triathlon', icon: '🏊🚴🏃' },
  Duathlon: { fr: 'Duathlon', category: 'triathlon', icon: '🏃🚴🏃' },
  Aquathlon: { fr: 'Aquathlon', category: 'triathlon', icon: '🏊🏃' },
  Aquabike: { fr: 'Aquabike', category: 'triathlon', icon: '🏊🚴' },
  // Cyclisme
  Ride: { fr: 'Cyclisme', category: 'cyclisme', icon: '🚴' },
  VirtualRide: { fr: 'Cyclisme virtuel', category: 'cyclisme', icon: '🚴' },
  MountainBikeRide: { fr: 'VTT', category: 'cyclisme', icon: '🚵' },
  GravelRide: { fr: 'Gravel', category: 'cyclisme', icon: '🚴' },
  EBikeRide: { fr: 'Vélo électrique', category: 'cyclisme', icon: '🚴' },
  EMountainBikeRide: { fr: 'VTT électrique', category: 'cyclisme', icon: '🚵' },
  Velomobile: { fr: 'Vélomobile', category: 'cyclisme', icon: '🚲' },
  Handcycle: { fr: 'Handbike', category: 'cyclisme', icon: '🚴' },

  // Course à pied
  Run: { fr: 'Course à pied', category: 'course', icon: '🏃' },
  TrailRun: { fr: 'Trail', category: 'course', icon: '🏃' },
  VirtualRun: { fr: 'Course virtuelle', category: 'course', icon: '🏃' },

  // Natation
  Swim: { fr: 'Natation', category: 'natation', icon: '🏊' },
  OpenWaterSwim: { fr: 'Natation en eau libre', category: 'natation', icon: '🏊' },

  // Force / Salle
  WeightTraining: { fr: 'Musculation', category: 'musculation', icon: '🏋️' },
  Workout: { fr: 'Entraînement', category: 'musculation', icon: '💪' },
  Crossfit: { fr: 'CrossFit', category: 'musculation', icon: '🏋️' },
  Elliptical: { fr: 'Vélo elliptique', category: 'musculation', icon: '🏃' },
  StairStepper: { fr: 'Stair-Stepper', category: 'musculation', icon: '🏃' },
  VirtualWorkout: { fr: 'Entraînement virtuel', category: 'musculation', icon: '💪' },

  // Marche / Rando
  Walk: { fr: 'Marche', category: 'autre', icon: '🚶' },
  Hike: { fr: 'Randonnée', category: 'autre', icon: '🥾' },
  Snowshoe: { fr: 'Raquettes', category: 'autre', icon: '🥾' },

  // Neige
  AlpineSki: { fr: 'Ski alpin', category: 'autre', icon: '⛷️' },
  BackcountrySki: { fr: 'Ski hors-piste', category: 'autre', icon: '⛷️' },
  NordicSki: { fr: 'Ski de fond', category: 'autre', icon: '⛷️' },
  Snowboard: { fr: 'Snowboard', category: 'autre', icon: '🏂' },
  IceSkate: { fr: 'Patinage', category: 'autre', icon: '⛸️' },
  InlineSkate: { fr: 'Roller', category: 'autre', icon: '🛼' },

  // Eau
  Rowing: { fr: 'Aviron', category: 'autre', icon: '🚣' },
  Kayaking: { fr: 'Kayak', category: 'autre', icon: '🛶' },
  Canoeing: { fr: 'Canoë', category: 'autre', icon: '🛶' },
  StandUpPaddling: { fr: 'Stand up paddle', category: 'autre', icon: '🏄' },
  Surfing: { fr: 'Surf', category: 'autre', icon: '🏄' },
  Windsurf: { fr: 'Planche à voile', category: 'autre', icon: '🏄' },
  Kitesurf: { fr: 'Kitesurf', category: 'autre', icon: '🪁' },
  Sailing: { fr: 'Voile', category: 'autre', icon: '⛵' },

  // Sports collectifs / raquettes
  Soccer: { fr: 'Football', category: 'autre', icon: '⚽' },
  Basketball: { fr: 'Basketball', category: 'autre', icon: '🏀' },
  Volleyball: { fr: 'Volleyball', category: 'autre', icon: '🏐' },
  Hockey: { fr: 'Hockey', category: 'autre', icon: '🏒' },
  Tennis: { fr: 'Tennis', category: 'autre', icon: '🎾' },
  Squash: { fr: 'Squash', category: 'autre', icon: '🎾' },
  Badminton: { fr: 'Badminton', category: 'autre', icon: '🏸' },
  TableTennis: { fr: 'Tennis de table', category: 'autre', icon: '🏓' },
  Cricket: { fr: 'Cricket', category: 'autre', icon: '🏏' },
  AmericanFootball: { fr: 'Football américain', category: 'autre', icon: '🏈' },

  // Mobilité / Bien-être
  Yoga: { fr: 'Yoga', category: 'autre', icon: '🧘' },
  Pilates: { fr: 'Pilates', category: 'autre', icon: '🧘' },
  Stretching: { fr: 'Étirements', category: 'autre', icon: '🧘' },

  // Divers
  RockClimbing: { fr: 'Escalade', category: 'autre', icon: '🧗' },
  Boxing: { fr: 'Boxe', category: 'autre', icon: '🥊' },
  Dance: { fr: 'Danse', category: 'autre', icon: '💃' },
  Golf: { fr: 'Golf', category: 'autre', icon: '⛳' },
  Skateboard: { fr: 'Skate', category: 'autre', icon: '🛹' },
  Wheelchair: { fr: 'Fauteuil roulant', category: 'autre', icon: '🦽' },
  Transition: { fr: 'Transition', category: 'autre', icon: '🏊' },
};

// Fallback de catégorie → libellé FR (utilisé quand raw_type Strava est absent)
const SPORT_CATEGORY_FR = {
  cyclisme: 'Cyclisme',
  course: 'Course à pied',
  natation: 'Natation',
  musculation: 'Musculation',
  triathlon: 'Triathlon',
  autre: 'Autre',
};

// Catégorie de couleur fine (pour les pills colorées dans le calendrier)
// Bcp plus granulaire que la catégorie interne — chaque "famille" a sa teinte
const SPORT_COLOR_KEY = {
  Triathlon: 'triathlon', Duathlon: 'triathlon', Aquathlon: 'triathlon', Aquabike: 'triathlon',
  Ride: 'cyclisme', VirtualRide: 'cyclisme', GravelRide: 'cyclisme',
  EBikeRide: 'cyclisme', Velomobile: 'cyclisme', Handcycle: 'cyclisme',
  MountainBikeRide: 'vtt', EMountainBikeRide: 'vtt',
  Run: 'course', VirtualRun: 'course',
  TrailRun: 'trail',
  Swim: 'natation', OpenWaterSwim: 'natation',
  WeightTraining: 'musculation', Workout: 'musculation', Crossfit: 'musculation',
  Elliptical: 'musculation', StairStepper: 'musculation', VirtualWorkout: 'musculation',
  Walk: 'marche', Hike: 'marche', Snowshoe: 'marche',
  AlpineSki: 'ski', BackcountrySki: 'ski', NordicSki: 'ski', Snowboard: 'ski',
  IceSkate: 'ski', InlineSkate: 'ski',
  Rowing: 'nautique', Kayaking: 'nautique', Canoeing: 'nautique',
  StandUpPaddling: 'nautique', Surfing: 'nautique', Windsurf: 'nautique',
  Kitesurf: 'nautique', Sailing: 'nautique',
  Soccer: 'football', Basketball: 'collectif', Volleyball: 'collectif',
  Hockey: 'collectif', AmericanFootball: 'collectif', Cricket: 'collectif',
  Tennis: 'raquette', Squash: 'raquette', Badminton: 'raquette', TableTennis: 'raquette',
  Yoga: 'yoga', Pilates: 'yoga', Stretching: 'yoga',
  RockClimbing: 'escalade',
  Boxing: 'combat',
  Dance: 'autre', Golf: 'autre', Skateboard: 'autre',
  Wheelchair: 'autre', Transition: 'autre',
};

// Mapping catégorie interne → couleur (fallback quand pas de raw_type)
const SPORT_COLOR_FROM_CATEGORY = {
  cyclisme: 'cyclisme',
  course: 'course',
  natation: 'natation',
  musculation: 'musculation',
  autre: 'autre',
};

// ============================================================
// Icone "dessin" coloree du sport (petit SVG trait, teinte = couleur du sport).
// Accepte un raw_type Strava (Ride, TrailRun...) OU une categorie interne.
// ============================================================
const SPORT_CAT_COLOR = {
  triathlon: '#f43f5e',
  cyclisme: '#3b82f6', vtt: '#b45309', course: '#fc4c02', trail: '#15803d',
  natation: '#06b6d4', musculation: '#ef4444', marche: '#65a30d', ski: '#60a5fa',
  nautique: '#0284c7', football: '#22c55e', collectif: '#c026d3', raquette: '#eab308',
  yoga: '#a78bfa', escalade: '#c2410c', combat: '#b91c1c', autre: '#9ca3af',
};
function _sportCatKey(v) {
  if (!v) return 'autre';
  if (SPORT_COLOR_KEY[v]) return SPORT_COLOR_KEY[v];                 // raw_type -> categorie
  if (SPORT_CAT_COLOR[v]) return v;                                  // deja une categorie
  if (SPORT_COLOR_FROM_CATEGORY[v]) return SPORT_COLOR_FROM_CATEGORY[v];
  return 'autre';
}
const _SPORT_ICON_GROUP = {
  triathlon: 'run',
  cyclisme: 'bike', vtt: 'bike',
  course: 'run', trail: 'run', marche: 'walk',
  natation: 'swim', nautique: 'swim',
  musculation: 'gym',
  ski: 'mountain', escalade: 'mountain',
  football: 'ball', collectif: 'ball', raquette: 'ball', combat: 'ball',
  yoga: 'dot', autre: 'dot',
};
const _SPORT_ICON_SVG = {
  bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  run: '<circle cx="13" cy="4" r="1.4"/><path d="M4 17l5 1 .9-1.6"/><path d="M15 21v-4.5l-4-3 1-6"/><path d="M7 12V9l5-1 3 3 3 1"/>',
  walk: '<circle cx="13" cy="4" r="1.4"/><path d="M7 21l3-4"/><path d="M16 21l-2-4-3-3 1-6"/><path d="M6 12l2-3 4-1 3 3 3 1"/>',
  swim: '<path d="M2 8c1 .8 2 .8 3 0s2-.8 3 0 2 .8 3 0 2-.8 3 0 2 .8 3 0 2-.8 3 0"/><path d="M2 13c1 .8 2 .8 3 0s2-.8 3 0 2 .8 3 0 2-.8 3 0 2 .8 3 0 2-.8 3 0"/><path d="M2 18c1 .8 2 .8 3 0s2-.8 3 0 2 .8 3 0 2-.8 3 0 2 .8 3 0 2-.8 3 0"/>',
  gym: '<rect x="1.6" y="8" width="2.6" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="4.4" y="9.6" width="2" height="4.8" rx="0.6" fill="currentColor" stroke="none"/><rect x="6.4" y="11" width="11.2" height="2" fill="currentColor" stroke="none"/><rect x="17.6" y="9.6" width="2" height="4.8" rx="0.6" fill="currentColor" stroke="none"/><rect x="19.8" y="8" width="2.6" height="8" rx="1" fill="currentColor" stroke="none"/>',
  mountain: '<path d="M2 19 8 8l3.5 6 2.5-4.5L22 19Z"/>',
  ball: '<circle cx="12" cy="12" r="8"/><path d="M4.6 9.4c4.9 3 9.9 3 14.8 0"/><path d="M4.6 14.6c4.9-3 9.9-3 14.8 0"/>',
  dot: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
};
window.sportGlyph = function (v, size) {
  size = size || 15;
  const cat = _sportCatKey(v);
  const color = SPORT_CAT_COLOR[cat] || '#9ca3af';
  const inner = _SPORT_ICON_SVG[_SPORT_ICON_GROUP[cat] || 'dot'];
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:' + color + ';display:inline-block;vertical-align:-2px;flex:none">' + inner + '</svg>';
};
// Couleur (hex) du sport — meme palette que les barres laterales.
window.sportColor = function (v) { return SPORT_CAT_COLOR[_sportCatKey(v)] || '#9ca3af'; };

// Helper unique : renvoie le nom Strava FR exact à afficher
//  Priorité : raw_type Strava traduit → catégorie traduite → 'Activité'
window.sportFr = (rawTypeOrCategory) => {
  if (!rawTypeOrCategory) return 'Activité';
  const entry = window.SPORTS_CATALOG[rawTypeOrCategory];
  if (entry) return entry.fr;
  if (SPORT_CATEGORY_FR[rawTypeOrCategory]) return SPORT_CATEGORY_FR[rawTypeOrCategory];
  return rawTypeOrCategory; // type Strava inconnu : on le montre brut
};

// Helper : emoji du sport (accepte un raw_type Strava OU une categorie interne)
const SPORT_CATEGORY_EMOJI = { cyclisme: '🚴', course: '🏃', natation: '🏊', musculation: '🏋️', triathlon: '🏊🚴🏃', autre: '🏅' };
window.sportEmoji = (rawTypeOrCategory) => {
  if (!rawTypeOrCategory) return '';
  const entry = window.SPORTS_CATALOG[rawTypeOrCategory];
  if (entry && entry.icon) return entry.icon;
  return SPORT_CATEGORY_EMOJI[rawTypeOrCategory] || '';
};

// Helper qui prend une activité complète et renvoie le nom de sport à afficher
window.activitySportLabel = (act) => {
  if (!act) return 'Activité';
  // Priorité 1 : raw_type Strava (ex: "Ride" → "Cyclisme")
  if (act.raw_type) return window.sportFr(act.raw_type);
  // Priorité 2 : type brut Strava sur certaines anciennes activités
  if (act.type && window.SPORTS_CATALOG[act.type]) return window.sportFr(act.type);
  // Priorité 3 : catégorie interne
  if (act.sport) return window.sportFr(act.sport);
  return 'Activité';
};

// Helper qui renvoie la "clé couleur" (data-attribute pour CSS)
window.activitySportColorKey = (act) => {
  if (!act) return 'autre';
  if (act.raw_type && SPORT_COLOR_KEY[act.raw_type]) return SPORT_COLOR_KEY[act.raw_type];
  if (act.type && SPORT_COLOR_KEY[act.type]) return SPORT_COLOR_KEY[act.type];
  // sport peut être soit un raw_type Strava (ex: "Ride") soit une catégorie ("cyclisme")
  if (act.sport && SPORT_COLOR_KEY[act.sport]) return SPORT_COLOR_KEY[act.sport];
  if (act.sport && SPORT_COLOR_FROM_CATEGORY[act.sport]) return SPORT_COLOR_FROM_CATEGORY[act.sport];
  return 'autre';
};

let _modalCharts = [];
function destroyModalCharts() {
  _modalCharts.forEach(c => {
    try {
      if (c.canvas && c.canvas._smoothMM) {
        c.canvas.removeEventListener('mousemove', c.canvas._smoothMM);
        c.canvas.removeEventListener('mouseleave', c.canvas._smoothML);
        delete c.canvas._smoothMM;
        delete c.canvas._smoothML;
      }
      if (c._stOverlay && c._stOverlay.parentNode) {
        c._stOverlay.parentNode.removeChild(c._stOverlay);
      }
      c.destroy();
    } catch (e) {}
  });
  _modalCharts = [];
}

// === Crosshair fluide + tooltip interpolé (canvas overlay) ===
// Au lieu de redessiner les charts à chaque mouvement de souris (coûteux),
// on superpose une canvas transparente sur chaque chart et on n'en redessine
// QUE la crosshair. Le chart lui-même n'est plus repeint pendant les hover.
function _ensureOverlay(chart) {
  if (chart._stOverlay && chart._stOverlay.isConnected) return;
  const canvas = chart.canvas;
  const parent = canvas.parentNode;
  if (!parent) return;
  const cs = getComputedStyle(parent);
  if (cs.position === 'static') parent.style.position = 'relative';
  const ov = document.createElement('canvas');
  ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  parent.appendChild(ov);
  chart._stOverlay = ov;
  chart._stOverlayCtx = ov.getContext('2d');
  _resizeOverlay(chart);

  // Listener direct sur la canvas pour suivre le curseur MÊME pendant un drag-zoom
  // (afterEvent peut être bypassé par le plugin zoom pendant la sélection).
  if (!canvas._smoothMM) {
    canvas._smoothMM = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width) / (chart.currentDevicePixelRatio || window.devicePixelRatio || 1);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height) / (chart.currentDevicePixelRatio || window.devicePixelRatio || 1);
      const { left, right, top, bottom } = chart.chartArea;
      if (x < left || x > right || y < top || y > bottom) {
        if (chart._stxv != null) {
          _smoothPendingX = null;
          _scheduleSmoothDraw();
        }
        return;
      }
      _smoothPendingX = chart.scales.x.getValueForPixel(x);
      _scheduleSmoothDraw();
    };
    canvas._smoothML = () => {
      _smoothPendingX = null;
      _scheduleSmoothDraw();
    };
    canvas.addEventListener('mousemove', canvas._smoothMM);
    canvas.addEventListener('mouseleave', canvas._smoothML);
  }
}
function _resizeOverlay(chart) {
  if (!chart._stOverlay) return;
  const c = chart.canvas;
  chart._stOverlay.width = c.width;
  chart._stOverlay.height = c.height;
  // Reset transform pour matcher le DPR utilisé par Chart.js
  const dpr = chart.currentDevicePixelRatio || window.devicePixelRatio || 1;
  chart._stOverlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function _drawOverlay(chart) {
  if (!chart._stOverlay) return;
  // Safety : si une overlay s'est créée par erreur sur un non-stream chart, on la retire
  if (typeof _isStreamChart === 'function' && !_isStreamChart(chart)) {
    try {
      if (chart._stOverlay.parentNode) chart._stOverlay.parentNode.removeChild(chart._stOverlay);
    } catch (e) {}
    chart._stOverlay = null;
    chart._stOverlayCtx = null;
    return;
  }
  const ctx = chart._stOverlayCtx;
  const w = chart._stOverlay.width;
  const h = chart._stOverlay.height;
  // Clear (en coords brutes, pas affecté par le transform DPR)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.restore();

  const xValue = chart._stxv;
  if (xValue == null) return;
  const xScale = chart.scales.x;
  if (!xScale || xValue < xScale.min || xValue > xScale.max) return;
  const pixelX = xScale.getPixelForValue(xValue);
  const { top, bottom, left, right } = chart.chartArea;
  if (pixelX < left - 0.5 || pixelX > right + 0.5) return;

  ctx.save();

  // Ligne verticale (crosshair)
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(180,180,180,0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.moveTo(pixelX, top);
  ctx.lineTo(pixelX, bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // Interpolation linéaire de chaque dataset à xValue
  const items = [];
  chart.data.datasets.forEach((ds, i) => {
    // Skip si la courbe est cachée via la légende
    const meta = chart.getDatasetMeta(i);
    if (meta && meta.hidden) return;
    const data = ds.data;
    if (!data || !data.length) return;
    let y;
    if (xValue <= data[0].x) y = data[0].y;
    else if (xValue >= data[data.length - 1].x) y = data[data.length - 1].y;
    else {
      let lo = 0, hi = data.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (data[mid].x <= xValue) lo = mid;
        else hi = mid;
      }
      const p0 = data[lo], p1 = data[hi];
      const dx = p1.x - p0.x;
      const t = dx === 0 ? 0 : (xValue - p0.x) / dx;
      y = p0.y + t * (p1.y - p0.y);
    }
    const yScale = chart.scales[ds.yAxisID || 'y'];
    if (!yScale) return;
    const pixelY = yScale.getPixelForValue(y);
    ctx.beginPath();
    ctx.fillStyle = ds.borderColor;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.5;
    ctx.arc(pixelX, pixelY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Pente (%) pour l'altitude — uniquement si X est la distance (m)
    // Recherche binaire dans la fenêtre ±100 m. Si vide (gap dans la data),
    // fallback sur les deux points immédiatement autour du curseur.
    let extra = null;
    if (ds.label && ds.label.toLowerCase().includes('altitude') && window._streamsUseDistance) {
      const win = 100;
      const tLo = xValue - win;
      const tHi = xValue + win;
      // Borne basse : premier index avec data[j].x >= tLo
      let lo = 0, hi = data.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (data[m].x < tLo) lo = m + 1;
        else hi = m;
      }
      let i1 = lo;
      // Borne haute : dernier index avec data[j].x <= tHi
      lo = 0; hi = data.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (data[m].x > tHi) hi = m - 1;
        else lo = m;
      }
      let i2 = lo;

      // Fallback : fenêtre vide → utilise les 2 points encadrant xValue
      if (i2 <= i1) {
        lo = 0; hi = data.length - 1;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (data[m].x < xValue) lo = m + 1;
          else hi = m;
        }
        i1 = Math.max(0, lo - 1);
        i2 = Math.min(data.length - 1, lo);
        // Élargir si encore i1 == i2 (xValue exactement sur un point unique)
        if (i2 === i1 && data.length > 1) {
          if (i1 > 0) i1--;
          else if (i2 < data.length - 1) i2++;
        }
      }

      if (i2 > i1) {
        const dD = data[i2].x - data[i1].x;
        const dA = data[i2].y - data[i1].y;
        if (dD > 0) {
          const slope = (dA / dD) * 100;
          extra = `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}%`;
        }
      }
    }
    items.push({ label: ds.label, value: y, color: ds.borderColor, extra });
  });

  if (items.length === 0) { ctx.restore(); return; }

  const fmtX = window._streamsFmtXTooltip || (v => v.toFixed(1));
  const title = fmtX(xValue);
  const fmtV = (v, lbl) => {
    if (lbl && (lbl.includes("W'bal") || lbl.includes('Vitesse'))) return v.toFixed(1);
    return Math.round(v).toString();
  };
  // Reformatage : "Altitude (m)" → label "Altitude" + unité "m" placée après la valeur
  const lines = items.map(it => {
    const m = (it.label || '').match(/^(.*?)\s*\((.+)\)\s*$/);
    const labelPart = m ? m[1].trim() : it.label;
    const unitPart = m ? m[2] : '';
    const valueStr = fmtV(it.value, it.label);
    const formatted = `${labelPart}: ${valueStr}${unitPart ? ' ' + unitPart : ''}`;
    return `${formatted}${it.extra ? ' · pente ' + it.extra : ''}`;
  });
  const allLines = [title, ...lines];

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  const widths = allLines.map(l => ctx.measureText(l).width);
  const boxW = Math.max(...widths) + 16;
  const lineH = 14;
  const boxH = allLines.length * lineH + 12;

  let bx = pixelX + 12;
  let by = top + 8;
  if (bx + boxW > right) bx = pixelX - boxW - 12;
  if (by + boxH > bottom) by = bottom - boxH - 8;
  if (bx < left) bx = left + 4;

  ctx.fillStyle = 'rgba(20,20,20,0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 5);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeRect(bx, by, boxW, boxH);
  }

  ctx.textBaseline = 'top';
  allLines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.65)' : items[i - 1].color;
    ctx.fillText(l, bx + 8, by + 6 + i * lineH);
  });

  ctx.restore();
}

// Throttle via requestAnimationFrame
let _smoothFrame = null;
let _smoothPendingX = undefined;
function _scheduleSmoothDraw() {
  if (_smoothFrame) return;
  _smoothFrame = requestAnimationFrame(() => {
    _smoothFrame = null;
    const v = _smoothPendingX;
    _modalCharts.forEach(c => {
      if (!_isStreamChart(c)) return; // ignore donuts et autres types
      c._stxv = v;
      _drawOverlay(c);
    });
  });
}

// Helper : le crosshair ne s'applique qu'aux line charts streams (pas aux donuts, bars, etc.)
function _isStreamChart(chart) {
  if (!chart || !chart.config || chart.config.type !== 'line') return false;
  if (!chart.canvas) return false;
  const id = chart.canvas.id || '';
  return id.startsWith('streams-');
}
const smoothTooltipPlugin = {
  id: 'smoothTooltip',
  afterInit(chart) { if (_isStreamChart(chart)) _ensureOverlay(chart); },
  afterRender(chart) { if (_isStreamChart(chart)) { _ensureOverlay(chart); _drawOverlay(chart); } },
  resize(chart) { if (_isStreamChart(chart)) { _resizeOverlay(chart); _drawOverlay(chart); } },
  afterEvent(chart, args) {
    if (!_isStreamChart(chart)) return;
    const e = args.event;
    if (e.type === 'mousemove') {
      const { left, right, top, bottom } = chart.chartArea;
      if (e.x < left || e.x > right || e.y < top || e.y > bottom) {
        if (chart._stxv != null) {
          _smoothPendingX = null;
          _scheduleSmoothDraw();
        }
        return;
      }
      _smoothPendingX = chart.scales.x.getValueForPixel(e.x);
      _scheduleSmoothDraw();
    } else if (e.type === 'mouseout') {
      _smoothPendingX = null;
      _scheduleSmoothDraw();
    }
  },
};
if (typeof Chart !== 'undefined') {
  try { Chart.register(smoothTooltipPlugin); } catch (e) { /* déjà enregistré */ }
}

// === Plugin : zone hachurée sous 0 pour W'bal ===
// Dessine un motif rayé rouge dans la partie négative du W'bal (au-dessus du fill normal).
let _hatchPattern = null;
function _getHatchPattern(ctx) {
  if (_hatchPattern) return _hatchPattern;
  const p = document.createElement('canvas');
  p.width = 7; p.height = 7;
  const pc = p.getContext('2d');
  pc.strokeStyle = 'rgba(248, 113, 113, 0.55)';
  pc.lineWidth = 1.2;
  pc.beginPath();
  pc.moveTo(-1, 8); pc.lineTo(8, -1);
  pc.moveTo(0, 14); pc.lineTo(14, 0);
  pc.stroke();
  _hatchPattern = ctx.createPattern(p, 'repeat');
  return _hatchPattern;
}
const wbalNegStripesPlugin = {
  id: 'wbalNegStripes',
  afterDatasetsDraw(chart) {
    if (!chart.canvas || chart.canvas.id !== 'streams-wbal') return;
    const ds = chart.data.datasets[0];
    const data = ds && ds.data;
    if (!data || !data.length) return;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    const zeroY = yScale.getPixelForValue(0);
    const { top, bottom, left, right } = chart.chartArea;
    if (zeroY >= bottom) return; // toute la zone est >= 0

    const ctx = chart.ctx;
    ctx.save();
    // Clip strict à la zone du chart
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();

    // Construit le polygone sous-zéro (suit la courbe en dessous de 0, ferme à y=0)
    const xMin = xScale.min, xMax = xScale.max;
    let inNeg = false;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      if (p.x < xMin || p.x > xMax) continue;
      const px = xScale.getPixelForValue(p.x);
      const py = yScale.getPixelForValue(p.y);
      if (p.y < 0) {
        if (!inNeg) { ctx.moveTo(px, zeroY); inNeg = true; }
        ctx.lineTo(px, py);
      } else if (inNeg) {
        ctx.lineTo(px, zeroY);
        ctx.closePath();
        ctx.fillStyle = _getHatchPattern(ctx) || 'rgba(248,113,113,0.25)';
        ctx.fill();
        ctx.beginPath();
        inNeg = false;
      }
    }
    if (inNeg) {
      const last = data[data.length - 1];
      ctx.lineTo(xScale.getPixelForValue(last.x), zeroY);
      ctx.closePath();
      ctx.fillStyle = _getHatchPattern(ctx) || 'rgba(248,113,113,0.25)';
      ctx.fill();
    }
    ctx.restore();
  }
};
if (typeof Chart !== 'undefined') {
  try { Chart.register(wbalNegStripesPlugin); } catch (e) {}
}

// (Plugin axisVisibility retiré — la synchro axe ↔ dataset est faite dans
// legendConfig.onClick avec un requestAnimationFrame pour éviter les conflits)

// Detecte les sequences d'une sortie a partir du stream de puissance et renvoie des
// blocs AU MEME FORMAT que les seances structurees (int = %FTP), reutilisables par
// renderWorkoutProfileHTML / renderWorkoutDetailHTML. Heuristique (approximatif).
window.detectRideSequences = function (watts, ftp) {
  try {
    ftp = +ftp || 250;
    if (!watts || !watts.length) return [];
    var raw = []; for (var i = 0; i < watts.length; i++) { var v = watts[i]; raw.push((v == null || isNaN(v)) ? 0 : +v); }
    var n = raw.length; if (n < 180) return [];
    // Lissage ~15 s pour stabiliser la "base" (sinon la puissance bruitee sur-segmente)
    function sm(arr, win) { var m = arr.length, o = new Array(m), s = 0, c = 0; for (var x = 0; x <= win && x < m; x++) { s += arr[x]; c++; } for (var x2 = 0; x2 < m; x2++) { if (x2 > 0 && x2 + win < m) { s += arr[x2 + win]; c++; } if (x2 - win - 1 >= 0) { s -= arr[x2 - win - 1]; c--; } o[x2] = c > 0 ? s / c : 0; } return o; }
    var sw = sm(raw, 2);   // +/-2 s = ~5 s : leger, garde les efforts distincts (pas de moyenne coast+sprint)
    var zoneOf = function (w) { var p = w / ftp * 100; if (p < 55) return 0; if (p < 76) return 1; if (p < 91) return 2; if (p < 106) return 3; if (p < 121) return 4; if (p < 151) return 5; return 6; };
    // Binning 5 s, zone par bin (7 zones)
    var BIN = 5, bins = [];
    for (var s2 = 0; s2 < n; s2 += BIN) { var sum = 0, c2 = 0; for (var k = s2; k < Math.min(n, s2 + BIN); k++) { sum += sw[k]; c2++; } var w = c2 ? sum / c2 : 0; bins.push({ w: w, dur: c2, z: zoneOf(w) }); }
    // Segments = bins consecutifs de MEME zone (jamais de moyenne entre zones differentes)
    var remerge = function (arr) {
      var o = [];
      arr.forEach(function (g) { var L = o[o.length - 1]; if (L && L.z === g.z) { L.dur += g.dur; L._sw += g._sw; } else o.push({ z: g.z, dur: g.dur, _sw: g._sw }); });
      o.forEach(function (s) { s.w = s._sw / Math.max(1, s.dur); s.z = zoneOf(s.w); });
      return o;
    };
    var segs = remerge(bins.map(function (b) { return { z: b.z, dur: b.dur, _sw: b.w * b.dur }; }));
    // Absorption des segments < 10 s (bruit) dans le voisin de PUISSANCE la plus proche
    var guard = 0;
    while (segs.length > 1 && guard++ < 5000) {
      var bi = -1, bd = 1e9;
      for (var q = 0; q < segs.length; q++) { var mn = (segs[q].w / ftp * 100) >= 170 ? 10 : 45; if (segs[q].dur < mn && segs[q].dur < bd) { bd = segs[q].dur; bi = q; } }
      if (bi === -1) break;
      var p0 = segs[bi - 1], n0 = segs[bi + 1];
      var into = (!p0) ? n0 : (!n0 ? p0 : (Math.abs(p0.w - segs[bi].w) <= Math.abs(n0.w - segs[bi].w) ? p0 : n0));
      if (!into) break;
      into.dur += segs[bi].dur; into._sw += segs[bi]._sw; segs.splice(bi, 1); segs = remerge(segs);
    }
    if (!segs.length) return [];
    // Chaque segment = un bloc, a sa vraie duree (pas de regroupement en series).
    var pctFtp = function (w) { return Math.round(w / ftp * 100); };
    var blocks = segs.map(function (g) {
      return { type: 'steady', name: null, _z: g.z, _durS: g.dur, metric: 'power', unit: 'percent', work: { min: Math.round(g.dur / 60 * 100) / 100, int: pctFtp(g.w), metric: 'power' } };
    });
    // Zone d'un bloc a partir de son %FTP (memes seuils que la couleur des barres)
    var zp = function (p) { return zoneOf(ftp * p / 100); };
    // 1) Retire les micro-blocs (< 25 s) AVANT de fusionner
    blocks = blocks.filter(function (bl) { var d = bl._durS || ((+bl.work.min || 0) * 60), mn = (+bl.work.int || 0) >= 170 ? 10 : 45; return d >= mn; });
    // 2) Fusionne les blocs adjacents de MEME zone (duree additive, watts moyennes)
    var mg = [];
    blocks.forEach(function (bl) {
      var L = mg[mg.length - 1];
      if (L && zp(L.work.int) === zp(bl.work.int)) {
        var d1 = +L.work.min || 0, d2 = +bl.work.min || 0, dt = d1 + d2;
        L.work.int = dt ? Math.round((L.work.int * d1 + bl.work.int * d2) / dt) : L.work.int;
        L.work.min = Math.round(dt * 100) / 100;
        L._durS = (L._durS || d1 * 60) + (bl._durS || d2 * 60);
      } else { mg.push(bl); }
    });
    blocks = mg;
    // 3) Nommage deduit
    var ZN = ['Récupération', 'Endurance', 'Tempo', 'Seuil', 'VO2max', 'Anaérobie', 'Sprint'];
    blocks.forEach(function (bl, bi2) {
      var z = zp(bl.work.int), durS = bl._durS || ((+bl.work.min || 0) * 60);
      if (bi2 === 0 && z <= 2) { bl.name = 'Échauffement'; return; }
      if (bi2 === blocks.length - 1 && z <= 2) { bl.name = 'Retour au calme'; return; }
      if (z >= 4 && durS <= 50) { bl.name = 'Sprint'; return; }
      bl.name = ZN[z] || 'Bloc';
    });
    return blocks;
  } catch (e) { console.warn('[detect sequences]', e && e.message); return []; }
};

async function renderStreamsSection(container, activityId) {
  destroyModalCharts();
  const cached = streamsCache[activityId] !== undefined || loadStreamsFromLS(activityId);
  container.innerHTML = `<div class="modal-placeholder">${cached ? '📊 Rendu depuis le cache local...' : '⏳ Téléchargement des streams depuis Strava...'}</div>`;

  const streams = await loadStreams(activityId);
  if (!streams) {
    container.innerHTML = '<div class="modal-placeholder">Pas de streams disponibles pour cette activité (ou erreur de chargement).</div>';
    return;
  }
  // Yield to browser pour afficher le message "Rendu..." avant de bloquer sur le render
  container.innerHTML = '<div class="modal-placeholder">📊 Rendu des graphiques...</div>';
  await new Promise(r => requestAnimationFrame(r));

  // intervals.icu peut renvoyer les streams sous 2 formats : array de {type,data} ou objet {watts:[], ...}
  const findStream = (type) => {
    if (Array.isArray(streams)) {
      const s = streams.find(x => x && x.type === type);
      return s ? s.data : null;
    }
    return streams[type] || null;
  };

  let watts = findStream('watts');
  let hr = findStream('heartrate');
  let cadence = findStream('cadence');
  const altitude = findStream('altitude');
  const distance = findStream('distance');
  const time = findStream('time');

  // Lissage 3 s (moyenne glissante centrée ±1 s = 3 points) sur Puissance, FC, Cadence
  // Pour adoucir le bruit instantané sans perdre les variations réelles.
  function smooth3s(arr) {
    if (!arr) return arr;
    const n = arr.length;
    const out = new Array(n);
    const win = 1;
    let sum = 0, count = 0;
    for (let i = 0; i <= win && i < n; i++) {
      if (arr[i] != null && !isNaN(arr[i])) { sum += arr[i]; count++; }
    }
    for (let i = 0; i < n; i++) {
      if (i > 0 && i + win < n && arr[i + win] != null && !isNaN(arr[i + win])) {
        sum += arr[i + win]; count++;
      }
      if (i - win - 1 >= 0 && arr[i - win - 1] != null && !isNaN(arr[i - win - 1])) {
        sum -= arr[i - win - 1]; count--;
      }
      out[i] = count > 0 ? sum / count : null;
    }
    return out;
  }
  // Lissage paramétré : 3s pour watts/FC, 9s pour cadence (plus stable visuellement)
  function smoothWin(arr, win) {
    if (!arr) return arr;
    const n = arr.length;
    const out = new Array(n);
    let sum = 0, count = 0;
    for (let i = 0; i <= win && i < n; i++) {
      if (arr[i] != null && !isNaN(arr[i])) { sum += arr[i]; count++; }
    }
    for (let i = 0; i < n; i++) {
      if (i > 0 && i + win < n && arr[i + win] != null && !isNaN(arr[i + win])) {
        sum += arr[i + win]; count++;
      }
      if (i - win - 1 >= 0 && arr[i - win - 1] != null && !isNaN(arr[i - win - 1])) {
        sum -= arr[i - win - 1]; count--;
      }
      out[i] = count > 0 ? sum / count : null;
    }
    return out;
  }
  var _wattsRaw = watts ? watts.slice() : null;   // brut
  // Watts NON lisses : affichage seconde par seconde (comme records/metriques).
  if (hr) hr = smoothWin(hr, 1);                // ±1 s = 3 s
  if (cadence) cadence = smoothWin(cadence, 4); // ±4 s = 9 s (plus stable)
  try {
    var _hrMaxA = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete && (+window.DASHBOARD_DATA.athlete.hr_max || +window.DASHBOARD_DATA.athlete.hrMax)) || 190;
    var _ftpA = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete && +window.DASHBOARD_DATA.athlete.ftp) || 250;
    window.__lastStreams = { watts: watts ? watts.slice() : null, wattsRaw: _wattsRaw, hr: hr ? hr.slice() : null, cadence: cadence ? cadence.slice() : null, altitude: altitude ? altitude.slice() : null, distance: distance ? distance.slice() : null, time: time ? time.slice() : null, ftp: _ftpA, hrMax: _hrMaxA };
    // Adhérence par intervalle (Prévu vs Réalisé V2) : les streams viennent d'arriver
    if (window.fillAdherenceSlot) setTimeout(window.fillAdherenceSlot, 50);
  } catch (e) { }

  const length = (watts && watts.length) || (hr && hr.length) || (cadence && cadence.length) || 0;
  if (length === 0) {
    container.innerHTML = '<div class="modal-placeholder">Aucun stream haute résolution n\'est disponible pour cette activité (séance peut-être sans capteur).</div>';
    return;
  }

  // Choix de l'axe X : distance (km) si dispo, sinon temps (h/m/s).
  const useDistance = distance && distance.length === length && distance[distance.length - 1] > 0;
  const fullTime = Array.from({ length }, (_, i) => i);
  const fullX = useDistance ? distance : fullTime;

  // PAS de downsampling manuel : on garde la résolution complète seconde par seconde.
  // Chart.js avec le plugin decimation (LTTB) gérera l'affichage : décime à ~1500 points
  // pour la performance, mais redécime à la résolution réelle au zoom in.

  // Formatter de l'axe X selon le mode (2 décimales pour ticks et tooltip)
  const fmtXTick = useDistance
    ? (val) => (val / 1000).toFixed(2) + ' km'
    : (val) => formatHMS(val);
  const fmtXTooltip = useDistance
    ? (val) => (val / 1000).toFixed(2) + ' km'
    : (val) => formatHMS(val);
  const fmtX = fmtXTick;
  // Expose au plugin smoothTooltip pour formater le titre du tooltip
  window._streamsFmtXTooltip = fmtXTooltip;
  // Expose pour le calcul de la pente (% uniquement si X est la distance)
  window._streamsUseDistance = useDistance;

  // Pairs {x,y} pour Chart.js (à connaître avant le template innerHTML)
  const pairs = (yArr) => {
    if (!yArr) return [];
    const out = [];
    for (let i = 0; i < fullX.length; i++) {
      if (yArr[i] != null && !isNaN(yArr[i])) out.push({ x: fullX[i], y: yArr[i] });
    }
    return out;
  };
  // === W'bal (modèle Skiba 2012) : réserve anaérobie au cours de l'effort ===
  // CP ≈ FTP, W' = 20 kJ par défaut (réserve typique cycliste entraîné).
  const cp = (window._athleteMeta && window._athleteMeta.ftp) || 250;
  const wPrime = 20000; // J
  function computeWbal(wattsArr) {
    if (!wattsArr || !cp || cp < 50) return null;
    const n = wattsArr.length;
    const out = new Array(n);
    let wbal = wPrime;
    for (let i = 0; i < n; i++) {
      const p = wattsArr[i] || 0;
      if (p > cp) {
        wbal -= (p - cp);
      } else {
        // Recovery : tau = 546·e^(-0.01·ΔCP) + 316 (Skiba)
        const deltaCP = cp - p;
        const tau = 546 * Math.exp(-0.01 * deltaCP) + 316;
        wbal = wPrime - (wPrime - wbal) * Math.exp(-1 / tau);
      }
      // On ne clampe plus à 0 : si le rider creuse dans la réserve au-delà de W',
      // le W'bal devient négatif (signe qu'il est "dans le rouge" selon le modèle).
      // Plafond max conservé pour pas dépasser W' physiologiquement.
      wbal = Math.min(wPrime, wbal);
      out[i] = wbal;
    }
    return out;
  }

  // === Vitesse instantanée (km/h) doublement lissée pour absorber le bruit GPS ===
  // Pass 1 : moyenne glissante ±15s (smooth les pics GPS courts)
  // Pass 2 : moyenne glissante ±15s sur la sortie du pass 1 (lissage 2nd ordre)
  // → Équivalent à un filtre gaussien plus stable qu'une grosse fenêtre simple
  function computeSpeed(distArr) {
    if (!distArr || distArr.length !== length) return null;
    const raw = new Array(length);
    for (let i = 1; i < length; i++) {
      raw[i] = Math.max(0, (distArr[i] - distArr[i - 1])); // m/s
    }
    raw[0] = raw[1] || 0;

    function smoothPass(arr, win) {
      const n = arr.length;
      const out = new Array(n);
      let sum = 0, count = 0;
      for (let i = 0; i <= win && i < n; i++) { sum += arr[i]; count++; }
      for (let i = 0; i < n; i++) {
        if (i > 0 && i + win < n) { sum += arr[i + win]; count++; }
        if (i - win - 1 >= 0) { sum -= arr[i - win - 1]; count--; }
        out[i] = count > 0 ? sum / count : 0;
      }
      return out;
    }

    const pass1 = smoothPass(raw, 15);
    const pass2 = smoothPass(pass1, 15);
    return pass2.map(v => v * 3.6); // m/s → km/h
  }

  const wbal = computeWbal(watts);
  const speed = computeSpeed(distance);

  const wattsPts = pairs(watts);
  const hrPts = pairs(hr);
  const cadencePts = pairs(cadence);
  const altPts = pairs(altitude);
  const wbalPts = pairs(wbal);
  const speedPts = pairs(speed);

  const _ftp = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete && +window.DASHBOARD_DATA.athlete.ftp) || 250;
  const _detected = (watts && watts.length && window.detectRideSequences) ? window.detectRideSequences(watts, _ftp) : [];
  const _profHTML = (_detected.length && window.renderWorkoutProfileHTML)
    ? '<div class="modal-section"><div class="modal-section-title">Profil de séance</div>'
      + window.renderWorkoutProfileHTML(_detected, { minFlex: 0.004, labels: false, readout: true })
      + '</div>'
    : '';
  const _toggleHTML = _profHTML
    ? '<button id="toggle-detailed" type="button" style="width:100%;background:var(--bg-elev2);border:1px solid var(--border);color:var(--text-dim);border-radius:9px;padding:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;margin:6px 0 14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;">Voir l\'analyse détaillée</button>'
    : '';
  try { var _stray = document.getElementById('detailed-charts'); if (_stray) _stray.remove(); } catch (e) { }
  container.innerHTML = _profHTML + _toggleHTML + '<div id="detailed-charts">' + `
    <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center;margin-bottom:14px;font-size:12px;color:var(--text-dim);">
      <div style="display:inline-flex;gap:6px;align-items:baseline;">Temps : <strong id="stat-temps" style="color:var(--text);font-size:14px;min-width:70px;text-align:left;display:inline-block;">—</strong></div>
      <div style="display:inline-flex;gap:6px;align-items:baseline;">Distance : <strong id="stat-dist" style="color:var(--text);font-size:14px;min-width:80px;text-align:left;display:inline-block;">—</strong></div>
      <button id="streams-zoom-reset" style="margin-left:auto;visibility:hidden;background:var(--bg-elev2);border:1px solid var(--border);color:var(--text-dim);padding:4px 10px;border-radius:5px;font-size:11px;cursor:pointer;font-family:inherit;">Réinitialiser le zoom</button>
    </div>
    ${(wattsPts.length || hrPts.length) ? `
      <div id="power-hr-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:10px;margin-bottom:6px;padding-left:55px;padding-right:60px;gap:8px;overflow:hidden;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);min-width:0;">
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#fbbf24;">moy</span> <strong id="stat-wmoy" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#fbbf24;">max</span> <strong id="stat-wmaxx" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
        </div>
        <div id="custom-legend-powerhr" style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
          ${wattsPts.length ? `<button class="cl-btn-phr" data-idx="0" data-yax="y" data-color="#fbbf24" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#fbbf24;border:1.5px solid #fbbf24;border-radius:2px;display:inline-block;"></span>Puissance
          </button>` : ''}
          ${hrPts.length ? `<button class="cl-btn-phr" data-idx="${wattsPts.length ? 1 : 0}" data-yax="y1" data-color="#f87171" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#f87171;border:1.5px solid #f87171;border-radius:2px;display:inline-block;"></span>FC
          </button>` : ''}
        </div>
        <div style="display:flex;gap:9px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);justify-self:end;">
          <span style="white-space:nowrap;"><span style="color:#f87171;">moy</span> <strong id="stat-fcmoy" style="color:var(--text);font-size:11px;">—</strong></span>
          <span style="white-space:nowrap;"><span style="color:#f87171;">max</span> <strong id="stat-fcmaxx" style="color:var(--text);font-size:11px;">—</strong></span>
        </div>
      </div>
      <div class="chart-wrap" style="height:180px;margin-bottom:14px;"><canvas id="streams-power-hr"></canvas></div>` : ''}
    ${wbalPts.length ? `
      <div id="wbal-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:10px;margin-bottom:6px;padding-left:55px;padding-right:60px;gap:8px;overflow:hidden;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);min-width:0;">
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#60a5fa;">moy</span> <strong id="stat-wbalmoy" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#60a5fa;">min</span> <strong id="stat-wbalmin" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
        </div>
        <div id="custom-legend-wbal" style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
          <button class="cl-btn-wbal" data-idx="0" data-yax="y" data-color="#60a5fa" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#60a5fa;border:1.5px solid #60a5fa;border-radius:2px;display:inline-block;"></span>W'bal
          </button>
        </div>
        <div style="justify-self:end;"></div>
      </div>
      <div class="chart-wrap" style="height:180px;margin-bottom:14px;"><canvas id="streams-wbal"></canvas></div>` : ''}
    ${cadencePts.length ? `
      <div id="cadence-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:10px;margin-bottom:6px;padding-left:55px;padding-right:60px;gap:8px;overflow:hidden;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);min-width:0;">
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#a78bfa;">moy</span> <strong id="stat-cmoy" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#a78bfa;">max</span> <strong id="stat-cmaxx" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
        </div>
        <div id="custom-legend-cadence" style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
          <button class="cl-btn-cad" data-idx="0" data-yax="y" data-color="#a78bfa" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#a78bfa;border:1.5px solid #a78bfa;border-radius:2px;display:inline-block;"></span>Cadence
          </button>
        </div>
        <div style="justify-self:end;"></div>
      </div>
      <div class="chart-wrap" style="height:180px;margin-bottom:14px;"><canvas id="streams-cadence"></canvas></div>` : ''}
    ${(speedPts.length || altPts.length) ? `
      <div id="speed-alt-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;font-size:10px;margin-bottom:6px;padding-left:55px;padding-right:60px;gap:8px;overflow:hidden;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);min-width:0;">
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#4ade80;">D+</span> <strong id="stat-dplus" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span style="white-space:nowrap;display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#4ade80;">D-</span> <strong id="stat-dminus" style="color:var(--text);font-size:11px;min-width:44px;text-align:left;display:inline-block;">—</strong></span>
          <span id="stat-slope-wrap" style="display:none;white-space:nowrap;gap:6px;align-items:center;">
            <span style="display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#4ade80;">moy</span> <strong id="stat-slopeavg" style="color:var(--text);font-size:11px;min-width:38px;text-align:left;display:inline-block;">—</strong></span>
            <span style="display:inline-flex;gap:4px;align-items:baseline;"><span style="color:#4ade80;">max</span> <strong id="stat-slopemax" style="color:var(--text);font-size:11px;min-width:38px;text-align:left;display:inline-block;">—</strong></span>
          </span>
        </div>
        <div id="custom-legend-altspeed" style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
          ${altPts.length ? `<button class="cl-btn" data-idx="0" data-yax="y1" data-color="#4ade80" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#4ade80;border:1.5px solid #4ade80;border-radius:2px;display:inline-block;"></span>Altitude
          </button>` : ''}
          ${speedPts.length ? `<button class="cl-btn" data-idx="${altPts.length ? 1 : 0}" data-yax="y" data-color="#22d3ee" style="background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit;padding:0;white-space:nowrap;">
            <span class="cl-box" style="width:9px;height:9px;background:#22d3ee;border:1.5px solid #22d3ee;border-radius:2px;display:inline-block;"></span>Vitesse
          </button>` : ''}
        </div>
        <div style="display:flex;gap:9px;align-items:center;flex-wrap:nowrap;color:var(--text-dim);justify-self:end;">
          <span style="white-space:nowrap;"><span style="color:#22d3ee;">moy</span> <strong id="stat-vmoy" style="color:var(--text);font-size:11px;">—</strong></span>
          <span style="white-space:nowrap;"><span style="color:#22d3ee;">max</span> <strong id="stat-vmax" style="color:var(--text);font-size:11px;">—</strong></span>
        </div>
      </div>
      <div class="chart-wrap" style="height:180px;"><canvas id="streams-speed-alt"></canvas></div>` : ''}
  ` + '</div>';

  // Compute stats sur la plage [minX, maxX] (en m si distance, en s si temps)
  // Utilise les FULL streams (pas downsampled) pour la précision.
  function computeStats(minX, maxX) {
    // Trouver les indices borne
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;

    // Temps écoulé = durée entre les deux indices (1 sample/s en général)
    const timeElapsed = lastIdx - firstIdx;

    // Distance parcourue
    let distCov = null;
    if (distance && distance.length === length) {
      distCov = (distance[lastIdx] - distance[firstIdx]) / 1000;
    }

    // Avg watts
    let wSum = 0, wCount = 0;
    if (watts) {
      for (let i = firstIdx; i <= lastIdx; i++) {
        const v = watts[i];
        if (v != null && !isNaN(v)) { wSum += v; wCount++; }
      }
    }
    const avgW = wCount > 0 ? Math.round(wSum / wCount) : null;

    // Avg HR
    let hSum = 0, hCount = 0;
    if (hr) {
      for (let i = firstIdx; i <= lastIdx; i++) {
        const v = hr[i];
        if (v != null && !isNaN(v)) { hSum += v; hCount++; }
      }
    }
    const avgH = hCount > 0 ? Math.round(hSum / hCount) : null;

    return { timeElapsed, distCov, avgW, avgH };
  }

  function renderStats(stats) {
    const tEl = document.getElementById('stat-temps');
    const dEl = document.getElementById('stat-dist');
    if (tEl) tEl.textContent = stats && stats.timeElapsed != null ? formatHMS(stats.timeElapsed) : '—';
    if (dEl) {
      if (stats && stats.distCov != null) {
        dEl.textContent = stats.distCov < 1
          ? Math.round(stats.distCov * 1000) + ' m'
          : stats.distCov.toFixed(2) + ' km';
      } else {
        dEl.textContent = '—';
      }
    }
  }

  // === Stats Altitude + Vitesse (au-dessus du chart speed-alt) ===
  function computeAltSpeedStats(minX, maxX) {
    if (!fullX || !fullX.length) return null;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;

    let dPlus = 0, dMinus = 0, altMax = null;
    let vSum = 0, vCount = 0, vMax = 0;
    let prevAlt = null;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (altitude && altitude[i] != null && !isNaN(altitude[i])) {
        const a = altitude[i];
        if (altMax === null || a > altMax) altMax = a;
        if (prevAlt != null) {
          const dA = a - prevAlt;
          if (dA > 0) dPlus += dA; else dMinus += -dA;
        }
        prevAlt = a;
      }
      if (speed && speed[i] != null && !isNaN(speed[i])) {
        vSum += speed[i]; vCount++;
        if (speed[i] > vMax) vMax = speed[i];
      }
    }

    // Slope stats : uniquement si zoomé (vue restreinte vs activité totale) ET distance dispo
    const fullSpan = fullX[fullX.length - 1] - fullX[0];
    const visSpan = maxX - minX;
    const isZoomed = visSpan < fullSpan * 0.97;
    let slopeAvg = null, slopeMax = null;
    if (useDistance && isZoomed && altitude && distance && lastIdx > firstIdx) {
      // Slope avg = pente nette du début à la fin de la section
      let fv = -1, lv = -1;
      for (let i = firstIdx; i <= lastIdx; i++) {
        if (altitude[i] != null && !isNaN(altitude[i]) && distance[i] != null) {
          if (fv === -1) fv = i;
          lv = i;
        }
      }
      if (fv !== -1 && lv > fv) {
        const dD = distance[lv] - distance[fv];
        if (dD > 0) slopeAvg = (altitude[lv] - altitude[fv]) / dD * 100;
      }
      // Slope max = pente la plus raide sur fenêtre glissante ±50m
      const winM = 50;
      for (let i = firstIdx; i <= lastIdx; i++) {
        if (altitude[i] == null) continue;
        const xVal = fullX[i];
        const tLo = xVal - winM, tHi = xVal + winM;
        let lo = firstIdx, hi = lastIdx;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (fullX[m] < tLo) lo = m + 1; else hi = m;
        }
        const i1 = lo;
        lo = firstIdx; hi = lastIdx;
        while (lo < hi) {
          const m = (lo + hi + 1) >> 1;
          if (fullX[m] > tHi) hi = m - 1; else lo = m;
        }
        const i2 = lo;
        if (i2 > i1 && altitude[i1] != null && altitude[i2] != null) {
          const dD = fullX[i2] - fullX[i1];
          if (dD > 0) {
            const sl = (altitude[i2] - altitude[i1]) / dD * 100;
            if (slopeMax === null || sl > slopeMax) slopeMax = sl;
          }
        }
      }
    }
    return {
      dPlus: Math.round(dPlus),
      dMinus: Math.round(dMinus),
      altMax: altMax !== null ? Math.round(altMax) : null,
      vAvg: vCount > 0 ? vSum / vCount : null,
      vMax: vMax > 0 ? vMax : null,
      slopeAvg, slopeMax, isZoomed
    };
  }

  function renderAltSpeedStats(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!s) {
      ['stat-dplus','stat-dminus','stat-altmax','stat-vmoy','stat-vmax'].forEach(id => set(id, '—'));
      const w = document.getElementById('stat-slope-wrap'); if (w) w.style.display = 'none';
      return;
    }
    set('stat-dplus', s.dPlus + ' m');
    set('stat-dminus', s.dMinus + ' m');
    set('stat-altmax', s.altMax !== null ? s.altMax + ' m' : '—');
    set('stat-vmoy', s.vAvg !== null ? s.vAvg.toFixed(1) + ' km/h' : '—');
    set('stat-vmax', s.vMax !== null ? s.vMax.toFixed(1) + ' km/h' : '—');
    const wrap = document.getElementById('stat-slope-wrap');
    if (wrap) {
      if (s.isZoomed && s.slopeAvg !== null && s.slopeMax !== null) {
        wrap.style.display = 'inline-flex';
        set('stat-slopeavg', (s.slopeAvg >= 0 ? '+' : '') + s.slopeAvg.toFixed(1) + '%');
        set('stat-slopemax', (s.slopeMax >= 0 ? '+' : '') + s.slopeMax.toFixed(1) + '%');
      } else {
        wrap.style.display = 'none';
      }
    }
  }

  // === Stats Puissance + FC ===
  function computePowerHRStats(minX, maxX) {
    if (!fullX || !fullX.length) return null;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;
    let wSum = 0, wCount = 0, wMax = 0;
    let hSum = 0, hCount = 0, hMax = 0;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (watts && watts[i] != null && !isNaN(watts[i])) {
        wSum += watts[i]; wCount++;
        if (watts[i] > wMax) wMax = watts[i];
      }
      if (hr && hr[i] != null && !isNaN(hr[i])) {
        hSum += hr[i]; hCount++;
        if (hr[i] > hMax) hMax = hr[i];
      }
    }
    return {
      wAvg: wCount > 0 ? Math.round(wSum / wCount) : null,
      wMax: wMax > 0 ? Math.round(wMax) : null,
      hAvg: hCount > 0 ? Math.round(hSum / hCount) : null,
      hMax: hMax > 0 ? Math.round(hMax) : null,
    };
  }
  function renderPowerHRStats(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!s) {
      ['stat-wmoy','stat-wmaxx','stat-fcmoy','stat-fcmaxx'].forEach(id => set(id, '—'));
      return;
    }
    set('stat-wmoy', s.wAvg !== null ? s.wAvg + ' w' : '—');
    set('stat-wmaxx', s.wMax !== null ? s.wMax + ' w' : '—');
    set('stat-fcmoy', s.hAvg !== null ? s.hAvg + ' bpm' : '—');
    set('stat-fcmaxx', s.hMax !== null ? s.hMax + ' bpm' : '—');
  }

  // === Stats W'bal (moyenne + min en kJ) ===
  function computeWbalStats(minX, maxX) {
    if (!fullX || !fullX.length || !wbal) return null;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;
    let wSum = 0, wCount = 0, wMin = Infinity;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (wbal[i] != null && !isNaN(wbal[i])) {
        wSum += wbal[i]; wCount++;
        if (wbal[i] < wMin) wMin = wbal[i];
      }
    }
    return {
      avg: wCount > 0 ? wSum / wCount : null,
      min: wMin !== Infinity ? wMin : null,
    };
  }
  function renderWbalStats(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!s) { ['stat-wbalmoy','stat-wbalmin'].forEach(id => set(id, '—')); return; }
    set('stat-wbalmoy', s.avg !== null ? (s.avg / 1000).toFixed(1) + ' kJ' : '—');
    set('stat-wbalmin', s.min !== null ? (s.min / 1000).toFixed(1) + ' kJ' : '—');
  }

  // === Stats Cadence ===
  function computeCadenceStats(minX, maxX) {
    if (!fullX || !fullX.length) return null;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < fullX.length; i++) {
      if (firstIdx === -1 && fullX[i] >= minX) firstIdx = i;
      if (fullX[i] <= maxX) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) return null;
    let cSum = 0, cCount = 0, cMax = 0;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (cadence && cadence[i] != null && !isNaN(cadence[i]) && cadence[i] > 0) {
        cSum += cadence[i]; cCount++;
        if (cadence[i] > cMax) cMax = cadence[i];
      }
    }
    return {
      cAvg: cCount > 0 ? Math.round(cSum / cCount) : null,
      cMax: cMax > 0 ? Math.round(cMax) : null,
    };
  }
  function renderCadenceStats(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!s) { ['stat-cmoy','stat-cmaxx'].forEach(id => set(id, '—')); return; }
    set('stat-cmoy', s.cAvg !== null ? s.cAvg + ' rpm' : '—');
    set('stat-cmaxx', s.cMax !== null ? s.cMax + ' rpm' : '—');
  }

  // Stats initiales : toute la plage
  setTimeout(() => {
    renderStats(computeStats(fullX[0], fullX[fullX.length - 1]));
    renderAltSpeedStats(computeAltSpeedStats(fullX[0], fullX[fullX.length - 1]));
    renderPowerHRStats(computePowerHRStats(fullX[0], fullX[fullX.length - 1]));
    renderCadenceStats(computeCadenceStats(fullX[0], fullX[fullX.length - 1]));
    renderWbalStats(computeWbalStats(fullX[0], fullX[fullX.length - 1]));
  }, 0);

  // Expose pour syncZoomToOthers
  window._streamsComputeStats = computeStats;
  window._streamsRenderStats = renderStats;
  window._streamsComputeAltSpeedStats = computeAltSpeedStats;
  window._streamsRenderAltSpeedStats = renderAltSpeedStats;
  window._streamsComputePowerHRStats = computePowerHRStats;
  window._streamsRenderPowerHRStats = renderPowerHRStats;
  window._streamsComputeCadenceStats = computeCadenceStats;
  window._streamsRenderCadenceStats = renderCadenceStats;
  window._streamsComputeWbalStats = computeWbalStats;
  window._streamsRenderWbalStats = renderWbalStats;

  // Bornes réelles de l'activité (évite l'auto-scaling qui rajoute des km fantômes)
  const xMin = fullX[0];
  const xMax = fullX[fullX.length - 1];

  // Axe X linéaire : positions proportionnelles à la distance (ou au temps)
  const sharedX = {
    type: 'linear',
    min: xMin,
    max: xMax,
    ticks: {
      maxTicksLimit: 8,
      callback: (val) => fmtXTick(val),
      font: { size: 10 }
    },
    grid: { display: false }
  };
  // Tooltip : affiche la valeur réelle de X (km ou temps), pas l'index
  const tooltipTitle = (items) => fmtXTooltip(items[0].parsed.x);

  // Plugin decimation : redécime intelligemment selon la zone visible (LTTB préserve les pics)
  const decimationConfig = {
    enabled: true,
    algorithm: 'lttb',
    samples: 1500,
    threshold: 1500
  };

  // Y axis ticks : valeurs entières (pas de décimales)
  const intY = { ticks: { callback: (v) => Math.round(v) } };
  // Tooltip label : arrondi à l'entier
  const labelInt = (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y)}`;

  // Config zoom : drag pour zoomer, double-clic pour reset, sync entre les 3 charts
  const syncZoomToOthers = (sourceChart) => {
    const { min, max } = sourceChart.scales.x;
    _modalCharts.forEach(c => {
      if (c === sourceChart || !c.scales.x) return;
      c.options.scales.x.min = min;
      c.options.scales.x.max = max;
      c.update('none');
    });
    // Afficher le bouton "Réinitialiser le zoom" si on est zoomé
    const fullSpan = fullX[fullX.length - 1] - fullX[0];
    const visSpan = max - min;
    const isZoomed = visSpan < fullSpan * 0.97;
    const btn = document.getElementById('streams-zoom-reset');
    if (btn) btn.style.visibility = isZoomed ? 'visible' : 'hidden';
    // Recalculer les stats sur la nouvelle plage visible
    if (window._streamsComputeStats && window._streamsRenderStats) {
      window._streamsRenderStats(window._streamsComputeStats(min, max));
    }
    if (window._streamsComputeAltSpeedStats && window._streamsRenderAltSpeedStats) {
      window._streamsRenderAltSpeedStats(window._streamsComputeAltSpeedStats(min, max));
    }
    if (window._streamsComputePowerHRStats && window._streamsRenderPowerHRStats) {
      window._streamsRenderPowerHRStats(window._streamsComputePowerHRStats(min, max));
    }
    if (window._streamsComputeCadenceStats && window._streamsRenderCadenceStats) {
      window._streamsRenderCadenceStats(window._streamsComputeCadenceStats(min, max));
    }
    if (window._streamsComputeWbalStats && window._streamsRenderWbalStats) {
      window._streamsRenderWbalStats(window._streamsComputeWbalStats(min, max));
    }
  };
  const zoomConfig = {
    zoom: {
      drag: {
        enabled: true,
        backgroundColor: 'rgba(74, 222, 128, 0.15)',
        borderColor: 'rgba(74, 222, 128, 0.5)',
        borderWidth: 1
      },
      mode: 'x',
      onZoomComplete: ({ chart }) => syncZoomToOthers(chart)
    },
    pan: {
      enabled: true,
      mode: 'x',
      modifierKey: 'shift', // pan avec Shift+drag (sinon le drag normal zoome)
      onPanComplete: ({ chart }) => syncZoomToOthers(chart)
    },
    limits: { x: { min: 'original', max: 'original' } }
  };

  // Double-clic sur n'importe quel chart → reset zoom partout + stats sur plage complète
  setTimeout(() => {
    const resetAll = () => {
      _modalCharts.forEach(c => { try { c.resetZoom(); } catch (e) {} });
      // Recalculer stats sur la plage complète après reset
      if (window._streamsComputeStats && window._streamsRenderStats) {
        window._streamsRenderStats(window._streamsComputeStats(fullX[0], fullX[fullX.length - 1]));
      }
      if (window._streamsComputeAltSpeedStats && window._streamsRenderAltSpeedStats) {
        window._streamsRenderAltSpeedStats(window._streamsComputeAltSpeedStats(fullX[0], fullX[fullX.length - 1]));
      }
      if (window._streamsComputePowerHRStats && window._streamsRenderPowerHRStats) {
        window._streamsRenderPowerHRStats(window._streamsComputePowerHRStats(fullX[0], fullX[fullX.length - 1]));
      }
      if (window._streamsComputeCadenceStats && window._streamsRenderCadenceStats) {
        window._streamsRenderCadenceStats(window._streamsComputeCadenceStats(fullX[0], fullX[fullX.length - 1]));
      }
      if (window._streamsComputeWbalStats && window._streamsRenderWbalStats) {
        window._streamsRenderWbalStats(window._streamsComputeWbalStats(fullX[0], fullX[fullX.length - 1]));
      }
      // Cacher le bouton "Réinitialiser le zoom" après reset
      const btn = document.getElementById('streams-zoom-reset');
      if (btn) btn.style.visibility = 'hidden';
    };
    ['streams-power-hr', 'streams-wbal', 'streams-cadence', 'streams-speed-alt'].forEach(id => {
      const cv = document.getElementById(id);
      if (cv) cv.addEventListener('dblclick', resetAll);
    });
    const btn = document.getElementById('streams-zoom-reset');
    if (btn) btn.addEventListener('click', resetAll);
  }, 0);

  // Largeurs fixes pour aligner pixel-perfect les chartAreas entre tous les
  // graphiques (sinon le label "900" est plus large que "60" → décalage).
  const LEFT_Y_WIDTH = 55;
  const RIGHT_Y_WIDTH = 60;
  const forceLeftWidth = (scale) => { scale.width = LEFT_Y_WIDTH; };
  const forceRightWidth = (scale) => { scale.width = RIGHT_Y_WIDTH; };

  // Légende : carré plein quand dataset visible, vide quand caché.
  // Toggle visibilité + sync de l'axe Y (titre + ticks) en différé pour ne pas
  // entrer en conflit avec l'update interne de Chart.js déclenché par hide/show.
  const legendConfig = {
    onClick: (e, legendItem, legend) => {
      const chart = legend.chart;
      const i = legendItem.datasetIndex;
      if (chart.isDatasetVisible(i)) chart.hide(i);
      else chart.show(i);
      requestAnimationFrame(() => {
        const ds = chart.data.datasets[i];
        const yAxisID = ds.yAxisID || 'y';
        const sc = chart.options.scales && chart.options.scales[yAxisID];
        if (!sc) return;
        const visible = chart.isDatasetVisible(i);
        if (sc.title) sc.title.display = visible;
        if (sc.ticks) sc.ticks.display = visible;
        chart.update('none');
      });
    },
    labels: {
      boxWidth: 10,
      font: { size: 11 },
      color: '#e6e9ef',
      generateLabels: (chart) => chart.data.datasets.map((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        const hidden = meta.hidden === true;
        return {
          text: ds.label,
          fillStyle: hidden ? 'transparent' : (ds.borderColor || ds.backgroundColor),
          strokeStyle: ds.borderColor || ds.backgroundColor,
          lineWidth: 1.5,
          fontColor: '#e6e9ef',
          hidden: false, // pas de strikethrough
          datasetIndex: i
        };
      })
    }
  };

  // Axe Y droit "fantôme" (invisible mais réserve l'espace) pour les charts
  // qui n'ont qu'un axe Y gauche, afin qu'ils s'alignent sur Watts/FC.
  const phantomY1 = {
    position: 'right',
    display: true,
    ticks: { display: true, color: 'transparent', callback: (v) => v.toFixed(0) },
    grid: { display: false },
    border: { display: false },
    title: { display: false },
    afterFit: forceRightWidth
  };

  // Chart 1 : Watts + FC (double Y, axe X linéaire en distance ou temps)
  if (wattsPts.length || hrPts.length) {
    const datasets = [];
    if (wattsPts.length) datasets.push({
      label: 'Puissance (w)', data: wattsPts,
      borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.12)',
      yAxisID: 'y', pointRadius: 0, borderWidth: 1.2, fill: true, tension: 0.1, spanGaps: true
    });
    if (hrPts.length) datasets.push({
      label: 'FC (bpm)', data: hrPts,
      borderColor: '#f87171', backgroundColor: 'transparent',
      yAxisID: 'y1', pointRadius: 0, borderWidth: 1.5, tension: 0.15, spanGaps: true
    });
    _modalCharts.push(new Chart(document.getElementById('streams-power-hr'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: {
          legend: { display: false }, // remplacée par la barre HTML custom
          tooltip: { enabled: false },
          zoom: zoomConfig,
          decimation: decimationConfig
        },
        scales: {
          x: sharedX,
          y: { position: 'left', title: { display: true, text: 'Watts' }, suggestedMin: 0, suggestedMax: 600, ...intY, afterFit: forceLeftWidth },
          ...(hrPts.length ? { y1: { position: 'right', title: { display: true, text: 'FC' }, grid: { display: false }, suggestedMin: 80, suggestedMax: 200, ...intY, afterFit: forceRightWidth } } : {})
        }
      }
    }));
    // Wire la légende HTML custom pour Puissance + FC
    const powerHrChart = _modalCharts[_modalCharts.length - 1];
    setTimeout(() => {
      document.querySelectorAll('#custom-legend-powerhr .cl-btn-phr').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.idx;
          const yax = btn.dataset.yax;
          const color = btn.dataset.color;
          if (powerHrChart.isDatasetVisible(idx)) powerHrChart.hide(idx);
          else powerHrChart.show(idx);
          requestAnimationFrame(() => {
            const visible = powerHrChart.isDatasetVisible(idx);
            const sc = powerHrChart.options.scales && powerHrChart.options.scales[yax];
            if (sc) {
              if (sc.title) sc.title.display = visible;
              if (sc.ticks) sc.ticks.display = visible;
            }
            powerHrChart.update('none');
            const box = btn.querySelector('.cl-box');
            if (box) box.style.background = visible ? color : 'transparent';
          });
        });
      });
    }, 0);
  }

  // Chart 1.5 : W'bal (réserve anaérobie en kJ)
  if (wbalPts.length) {
    const wbalKJ = wbalPts.map(p => ({ x: p.x, y: p.y / 1000 }));
    _modalCharts.push(new Chart(document.getElementById('streams-wbal'), {
      type: 'line',
      data: { datasets: [{
        label: "W'bal (kJ)", data: wbalKJ,
        borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.15)',
        pointRadius: 0, borderWidth: 1.2, fill: true, tension: 0.1, spanGaps: true,
        // Ligne en pointillé + rouge quand on est franchement sous 0
        // (les segments qui croisent y=0 restent solides pour ne pas "fuir" au-dessus de 0)
        segment: {
          borderDash: ctx => (ctx.p0.parsed.y < 0 && ctx.p1.parsed.y < 0) ? [5, 4] : undefined,
          borderColor: ctx => (ctx.p0.parsed.y < 0 && ctx.p1.parsed.y < 0) ? '#f87171' : '#60a5fa'
        }
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false, parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          zoom: zoomConfig,
          decimation: decimationConfig
        },
        scales: {
          x: sharedX,
          y: { title: { display: true, text: "W'bal (kJ)" }, suggestedMin: 0, suggestedMax: wPrime / 1000, ticks: { callback: (v) => v.toFixed(0) }, afterFit: forceLeftWidth },
          y1: phantomY1
        }
      }
    }));
    // Wire la légende HTML custom pour W'bal
    const wbalChart = _modalCharts[_modalCharts.length - 1];
    setTimeout(() => {
      document.querySelectorAll('#custom-legend-wbal .cl-btn-wbal').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.idx;
          const yax = btn.dataset.yax;
          const color = btn.dataset.color;
          if (wbalChart.isDatasetVisible(idx)) wbalChart.hide(idx);
          else wbalChart.show(idx);
          requestAnimationFrame(() => {
            const visible = wbalChart.isDatasetVisible(idx);
            const sc = wbalChart.options.scales && wbalChart.options.scales[yax];
            if (sc) {
              if (sc.title) sc.title.display = visible;
              if (sc.ticks) sc.ticks.display = visible;
            }
            wbalChart.update('none');
            const box = btn.querySelector('.cl-box');
            if (box) box.style.background = visible ? color : 'transparent';
          });
        });
      });
    }, 0);
  }

  // Chart 2 : Cadence
  if (cadencePts.length) {
    _modalCharts.push(new Chart(document.getElementById('streams-cadence'), {
      type: 'line',
      data: { datasets: [{ label: 'Cadence (rpm)', data: cadencePts, borderColor: '#a78bfa', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.2, tension: 0.1, spanGaps: true }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false }, zoom: zoomConfig, decimation: decimationConfig },
        scales: { x: sharedX, y: { title: { display: true, text: 'rpm' }, suggestedMin: 0, suggestedMax: 110, ...intY, afterFit: forceLeftWidth }, y1: phantomY1 }
      }
    }));
    // Wire la légende HTML custom pour Cadence
    const cadChart = _modalCharts[_modalCharts.length - 1];
    setTimeout(() => {
      document.querySelectorAll('#custom-legend-cadence .cl-btn-cad').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.idx;
          const yax = btn.dataset.yax;
          const color = btn.dataset.color;
          if (cadChart.isDatasetVisible(idx)) cadChart.hide(idx);
          else cadChart.show(idx);
          requestAnimationFrame(() => {
            const visible = cadChart.isDatasetVisible(idx);
            const sc = cadChart.options.scales && cadChart.options.scales[yax];
            if (sc) {
              if (sc.title) sc.title.display = visible;
              if (sc.ticks) sc.ticks.display = visible;
            }
            cadChart.update('none');
            const box = btn.querySelector('.cl-box');
            if (box) box.style.background = visible ? color : 'transparent';
          });
        });
      });
    }, 0);
  }

  // Chart 3 : Altitude (fond) + Vitesse (ligne au-dessus)
  // Altitude en premier dans le tableau → rendue en arrière-plan (profil de montagne).
  if (speedPts.length || altPts.length) {
    const datasets = [];
    if (altPts.length) datasets.push({
      label: 'Altitude (m)', data: altPts,
      borderColor: 'rgba(74,222,128,0.6)', backgroundColor: 'rgba(74,222,128,0.18)',
      yAxisID: 'y1', pointRadius: 0, borderWidth: 1, fill: true, tension: 0.2, spanGaps: true
    });
    if (speedPts.length) datasets.push({
      label: 'Vitesse (km/h)', data: speedPts,
      borderColor: '#22d3ee', backgroundColor: 'transparent',
      yAxisID: 'y', pointRadius: 0, borderWidth: 1.4, fill: false, tension: 0.1, spanGaps: true
    });
    _modalCharts.push(new Chart(document.getElementById('streams-speed-alt'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false, parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: {
          legend: { display: false }, // remplacée par la barre HTML custom
          tooltip: { enabled: false },
          zoom: zoomConfig,
          decimation: decimationConfig
        },
        scales: {
          x: sharedX,
          y: { position: 'left', title: { display: true, text: 'km/h' }, suggestedMin: 0, suggestedMax: 50, afterFit: forceLeftWidth },
          ...(altPts.length ? { y1: { position: 'right', title: { display: true, text: 'm' }, grid: { display: false }, ...intY, afterFit: forceRightWidth } } : { y1: phantomY1 })
        }
      }
    }));

    // Wire la légende HTML custom au-dessus du chart
    const speedAltChart = _modalCharts[_modalCharts.length - 1];
    setTimeout(() => {
      document.querySelectorAll('#custom-legend-altspeed .cl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.idx;
          const yax = btn.dataset.yax;
          const color = btn.dataset.color;
          if (speedAltChart.isDatasetVisible(idx)) speedAltChart.hide(idx);
          else speedAltChart.show(idx);
          requestAnimationFrame(() => {
            const visible = speedAltChart.isDatasetVisible(idx);
            const sc = speedAltChart.options.scales && speedAltChart.options.scales[yax];
            if (sc) {
              if (sc.title) sc.title.display = visible;
              if (sc.ticks) sc.ticks.display = visible;
            }
            speedAltChart.update('none');
            // Toggle visuel : carré plein si visible, vide sinon
            const box = btn.querySelector('.cl-box');
            if (box) box.style.background = visible ? color : 'transparent';
          });
        });
      });
    }, 0);
  }
  // Graphes detailles caches inline : ils s'affichent dans l'analyse plein ecran.
  try { var _dc = document.getElementById('detailed-charts'); if (_dc) _dc.style.display = 'none'; } catch (e) { /* ignore */ }
}

// ============================================================
// Analyse detaillee PLEIN ECRAN : courbes temps (deplacees) + courbe de
// puissance (mean-max) + temps par zone (puissance/FC) + distribution.
// ============================================================
// Calcule les metriques avancees d'une activite a partir des streams.
// S = { watts:[], hr:[], ftp, hrMax } ; ath = objet athlete ; hrRest = FC repos (Whoop si dispo).
// Tout est calculable depuis watts+FC sauf l'equilibre G/D (mesure capteur, pas dans Strava).
window.__computeActivityMetrics = function (S, ath, hrRest) {
  S = S || {}; ath = ath || {};
  var W = S.wattsRaw || S.watts || [], HR = S.hr || [];
  var ftp = +S.ftp || +ath.ftp || 250;
  var hrMax = +S.hrMax || +ath.hr_max || +ath.hrMax || 190;
  var sex = ath.sex || 'M';
  hrRest = +hrRest || +ath.hr_rest || 50;
  var m = { _v: 2 };
  var n = W.length;

  if (n) {
    var ps = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) ps[i + 1] = ps[i] + (+W[i] || 0);
    var bestAvg = function (d) { if (d > n) return 0; var b = 0; for (var s = 0; s + d <= n; s++) { var v = (ps[s + d] - ps[s]) / d; if (v > b) b = v; } return b; };

    var pmax = 0; for (var i2 = 0; i2 < n; i2++) { var w0 = +W[i2] || 0; if (w0 > pmax) pmax = w0; }
    m.pmax = Math.round(pmax);

    var ex = 0; for (var i3 = 0; i3 < n; i3++) { var w1 = +W[i3] || 0; if (w1 > ftp) ex += (w1 - ftp); }
    m.work_over_ftp_kj = Math.round(ex / 100) / 10;

    // NP (moyenne glissante 30s, puissance 4) -> IF -> TSS, calcules nous-memes
    // (utile quand la source ne fournit pas intensity/tss).
    if (n >= 30) {
      var np4 = 0, npc = 0;
      for (var r = 30; r <= n; r++) { var a30 = (ps[r] - ps[r - 30]) / 30; np4 += a30 * a30 * a30 * a30; npc++; }
      if (npc) m.np = Math.round(Math.pow(np4 / npc, 0.25));
    }
    if (m.np && ftp) { var ifr = m.np / ftp; m.if_pct = Math.round(ifr * 100); m.tss = Math.round(n / 3600 * ifr * ifr * 100); }

    // eFTP / CP / W' / W'bal ne sont fiables que si la sortie contient un effort
    // assez dur (sinon le modele puissance-duree donne des valeurs absurdes).
    var hard = (bestAvg(300) >= ftp * 0.86) || (bestAvg(60) >= ftp * 1.15) || (bestAvg(1200) >= ftp * 0.84);

    if (hard) {
    var durs = [120, 180, 240, 300, 420, 600, 720, 900, 1200].filter(function (d) { return d <= n; });
    if (durs.length >= 2) {
      var sx = 0, sy = 0, sxy = 0, sxx = 0, k = durs.length;
      durs.forEach(function (d) { var x = 1 / d, y = bestAvg(d); sx += x; sy += y; sxy += x * y; sxx += x * x; });
      var slope = (k * sxy - sx * sy) / (k * sxx - sx * sx); var inter = (sy - slope * sx) / k;
      if (isFinite(inter) && inter > 0) m.cp = Math.round(inter);
      if (isFinite(slope) && slope > 0) m.w_prime = Math.round(slope);
    }

    var p20 = bestAvg(1200), p5 = bestAvg(300);
    if (p20) m.eftp = Math.round(0.95 * p20);
    else if (p5) m.eftp = Math.round(0.90 * p5);
    else if (m.cp) m.eftp = Math.round(0.97 * m.cp);

    var cp = m.cp || Math.round(0.97 * ftp), wp = m.w_prime || 20000;
    if (cp > 0 && wp > 0) {
      var bSum = 0, bN = 0; for (var b1 = 0; b1 < n; b1++) { var w2 = +W[b1] || 0; if (w2 < cp) { bSum += w2; bN++; } }
      var dcp = bN ? (cp - bSum / bN) : 0; var tau = 546 * Math.exp(-0.01 * dcp) + 316;
      var bal = wp, minb = wp, rec = 1 - Math.exp(-1 / tau);
      for (var b2 = 0; b2 < n; b2++) { var w3 = +W[b2] || 0; if (w3 > cp) bal -= (w3 - cp); else bal += (wp - bal) * rec; if (bal > wp) bal = wp; if (bal < minb) minb = bal; }
      m.wbal_kj = Math.round(Math.min(wp, wp - minb) / 100) / 10;   // deplete <= W'
    }
    }

    var GE_carb = 0, choMech = 0;
    for (var c1 = 0; c1 < n; c1++) { var w4 = +W[c1] || 0; if (w4 <= 0) continue; var I = w4 / ftp; var fr = 1 / (1 + Math.exp(-5 * (I - 0.45))); if (fr < 0.15) fr = 0.15; if (fr > 1) fr = 1; choMech += (w4 / 1000) * fr; }
    m.cho_g = Math.round(choMech / 4.0);

    var z1 = 0, z2 = 0, z3 = 0;
    for (var p1 = 0; p1 < n; p1++) { var ww = W[p1]; if (ww == null) continue; var pr = ww / ftp; if (pr < 0.80) z1++; else if (pr <= 1.05) z2++; else z3++; }
    var zt = z1 + z2 + z3;
    if (zt) {
      var f1 = z1 / zt, f2 = z2 / zt, f3 = z3 / zt;
      if (f2 > 0 && f3 > 0) m.pol_index = Math.round(Math.log10((f1 * f3) / (f2 * f2)) * 100) / 100;
      m.pol_class = (f1 >= f2 && f2 >= f3) ? 'Pyramidal' : (f3 > f2) ? 'Polarisé' : (f2 > f1) ? 'Seuil' : 'Endurance';
    }
  }

  if (HR.length) {
    var hn = HR.length, denom = (hrMax - hrRest) || 1, kk = (sex === 'F') ? 1.67 : 1.92, trimp = 0;
    for (var h1 = 0; h1 < hn; h1++) { var hh = HR[h1]; if (hh == null) continue; var r = (hh - hrRest) / denom; if (r < 0) r = 0; if (r > 1) r = 1; trimp += (1 / 60) * r * 0.64 * Math.exp(kk * r); }
    m.trimp = Math.round(trimp);
    // HRRc : plus forte chute de FC sur 60 s de TEMPS ECOULE reel (gere les pauses),
    // mesuree apres un instant a FC haute. Repli sur l'index si pas de flux temps.
    var drop = 0;
    var T = S.time;
    if (T && T.length === hn) {
      var j = 0;
      for (var h2 = 0; h2 < hn; h2++) {
        if (j < h2) j = h2;
        var target = T[h2] + 60;
        while (j < hn && T[j] < target) j++;
        if (j >= hn) break;
        if (HR[h2] != null && HR[j] != null && HR[h2] >= 0.85 * hrMax) { var d1 = HR[h2] - HR[j]; if (d1 > drop) drop = d1; }
      }
    } else {
      for (var h3 = 0; h3 + 60 < hn; h3++) { if (HR[h3] == null || HR[h3 + 60] == null) continue; if (HR[h3] >= 0.85 * hrMax) { var d2 = HR[h3] - HR[h3 + 60]; if (d2 > drop) drop = d2; } }
    }
    if (drop > 0) m.hrrc = Math.round(drop);
  }
  return m;
};
window.__buildAfOverview = function (act, m) {
  m = m || {};
  if (!act) return '<div class="af-section"><div class="af-h">Aperçu</div><div style="color:var(--text-mute)">Données indisponibles.</div></div>';
  var ath = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete) || {};
  var hrMax = +ath.hr_max || +ath.hrMax || +act.max_hr || 0;
  var durMin = act.duration || (act.moving_time ? Math.round(act.moving_time / 60) : 0);
  var durSec = act.moving_time || act.elapsed_time || (durMin * 60);
  var fmtHMS = function (s) { s = Math.round(s); var h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), x = s % 60; var p = function (n) { return n < 10 ? '0' + n : '' + n; }; return h ? (h + ':' + p(mm) + ':' + p(x)) : (mm + ':' + p(x)); };
  var ifPct = act.ftpPct || (act.intensity ? Math.round(act.intensity * 100) : 0) || m.if_pct || 0;
  var vi = act.variability_index ? +act.variability_index : 0;
  var ef = (act.np && act.hr) ? (act.np / act.hr).toFixed(2) : ((m.np && act.hr) ? (m.np / act.hr).toFixed(2) : null);
  var fcMaxPct = (act.max_hr && hrMax) ? Math.round(act.max_hr / hrMax * 100) : null;
  var np = act.np || m.np || 0;
  var tss = act.tss || m.tss || 0;
  var pmaxW = act.max_watts || m.pmax || 0;
  var ctl = null, atl = null, tsb = null;
  if (Array.isArray(data)) { for (var i = 0; i < data.length; i++) { if (data[i].date === window.__lastActDate) { ctl = data[i].ctl; atl = data[i].atl; tsb = data[i].tsb; break; } } }

  var gauge = function (label, valTxt, w, col) { return '<div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);margin-bottom:4px"><span>' + label + '</span><span style="color:var(--text);font-weight:600">' + valTxt + '</span></div><div style="height:6px;background:var(--bg-elev2);border-radius:99px;overflow:hidden"><div style="width:' + Math.max(0, Math.min(100, w)) + '%;height:100%;background:' + col + '"></div></div></div>'; };
  var row = function (label, val) { return '<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--text-dim)">' + label + '</span><span style="font-weight:600;text-align:right">' + val + '</span></div>'; };
  var mkCard = function (title, col, rows) { if (!rows.length) return ''; return '<div style="background:var(--bg-elev);border:1px solid var(--border);border-radius:12px;padding:14px 16px"><div style="font-size:12px;font-weight:600;margin-bottom:8px;color:' + col + '">' + title + '</div><div style="font-size:13px;line-height:2.05">' + rows.join('') + '</div></div>'; };

  // ---- Header : Retour + identite (gauche) + score cle (droite) ----
  var heroVal = tss ? Math.round(tss) : (np ? Math.round(np) : '–');
  var heroLab = tss ? 'Charge (TSS)' : 'Puiss. norm.';
  var _iso = window.__lastActDate || (act.start_date_local ? String(act.start_date_local).slice(0, 10) : '');
  var _nm = (act.name || 'Activité').replace(/</g, '&lt;');
  var _when = '';
  try {
    if (_iso) _when = new Date(_iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var _hm = (act.start_date_local && String(act.start_date_local).length >= 16) ? String(act.start_date_local).slice(11, 16) : '';
    if (_hm) _when += ' · ' + _hm;
  } catch (e9) {}

  var cg = [];
  if (ifPct) cg.push(gauge('Intensité (IF)', ifPct + '%', ifPct, 'var(--warn)'));
  if (fcMaxPct) cg.push(gauge('FC max', fcMaxPct + '%', fcMaxPct, 'var(--danger)'));
  if (vi) cg.push(gauge('Variabilité', vi.toFixed(2), (vi - 1) * 200, 'var(--info)'));

  var header = '<div class="af-topbar">'
    + '<button class="af-back" type="button">← Retour</button>'
    + '<div class="af-id"><div class="af-id-name">' + _nm + '</div>' + (_when ? '<div class="af-id-sub">' + _when + '</div>' : '') + '</div>'
    + '</div>';

  var chargeCol = '<div style="min-width:200px">'
    + '<div style="display:flex;align-items:baseline;gap:7px;margin-bottom:9px"><span style="font-size:27px;font-weight:700;line-height:1">' + heroVal + '</span><span style="font-size:11px;color:var(--text-dim)">' + heroLab + '</span></div>'
    + (cg.length ? '<div style="display:flex;flex-direction:column;gap:8px">' + cg.join('') + '</div>' : '')
    + (m.pol_class ? '<div style="display:inline-block;margin-top:10px;background:rgba(167,139,250,.15);color:var(--purple);border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600">' + m.pol_class + (m.pol_index != null ? ' · ' + m.pol_index : '') + '</div>' : '')
    + '</div>';

  // ---- Colonnes de detail ----
  var pRows = [];
  if (np) pRows.push(row('NP', Math.round(np) + ' w'));
  if (act.avg_watts || pmaxW) pRows.push(row('Moy / Max', (act.avg_watts ? Math.round(act.avg_watts) : '–') + ' / ' + (pmaxW ? Math.round(pmaxW) : '–') + ' w'));
  if (act.cadence) pRows.push(row('Cadence', Math.round(act.cadence) + ' rpm'));
  if (m.eftp) pRows.push(row('eFTP', m.eftp + ' w'));
  if (m.cp) pRows.push(row('CP' + (m.w_prime ? " · W'" : ''), m.cp + 'w' + (m.w_prime ? ' · ' + (m.w_prime / 1000).toFixed(1) + 'kJ' : '')));
  if (m.wbal_kj) pRows.push(row("W'bal (baisse)", '-' + m.wbal_kj + ' kJ'));

  var cRows = [];
  if (act.hr || act.max_hr) cRows.push(row('Moy / Max', (act.hr || '–') + ' / ' + (act.max_hr || '–') + ' bpm'));
  if (ef) cRows.push(row('P/FC (EF)', ef));
  if (m.trimp) cRows.push(row('TRIMP', m.trimp));
  if (m.hrrc) cRows.push(row('HRRc', m.hrrc + ' bpm'));

  var vRows = [];
  vRows.push(row('Durée', fmtHMS(durSec)));
  if (act.distance_km) vRows.push(row('Distance', (+act.distance_km).toFixed(1) + ' km'));
  if (act.elevation_gain) vRows.push(row('Dénivelé+', Math.round(act.elevation_gain) + ' m'));
  if (act.avg_speed_kmh) vRows.push(row('Vitesse moy', (+act.avg_speed_kmh).toFixed(1) + ' km/h'));

  var eRows = [];
  if (act.kj) eRows.push(row('Travail', Math.round(act.kj) + ' kJ'));
  if (m.work_over_ftp_kj) eRows.push(row('dont &gt;FTP', m.work_over_ftp_kj + ' kJ'));
  if (act.calories) eRows.push(row('Calories', Math.round(act.calories) + ' kcal'));
  if (m.cho_g) eRows.push(row('CHO estimé', m.cho_g + ' g'));

  var fRows = [];
  if (ctl != null) fRows.push(row('Condition phys.', Math.round(ctl)));
  if (atl != null) fRows.push(row('Fatigue', Math.round(atl)));
  if (tsb != null) fRows.push(row('Forme', '<span style="color:' + (tsb >= 0 ? 'var(--accent)' : 'var(--danger)') + '">' + (tsb >= 0 ? '+' : '') + Math.round(tsb) + '</span>'));

  var grp = function (title, col, rows) { if (!rows.length) return ''; return '<div><div style="font-size:11px;font-weight:600;color:' + col + ';margin-bottom:7px;text-transform:uppercase;letter-spacing:.4px">' + title + '</div><div style="font-size:13px;line-height:2.05">' + rows.join('') + '</div></div>'; };

  var band = '<div class="af-band">'
    + chargeCol
    + grp('Puissance', 'var(--warn)', pRows)
    + grp('Cardio', 'var(--danger)', cRows)
    + grp('Volume', 'var(--accent)', vRows)
    + grp('Énergie', 'var(--info)', eRows)
    + grp('Forme', 'var(--purple)', fRows)
    + '</div>';

  var html = header + '<div class="af-section">' + band + '</div>';
  return html;
};
window.openFullAnalysis = function () {
  var S = window.__lastStreams;
  try {
    var _ath = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete) || {};
    var _rhr = 0;
    if (Array.isArray(data)) { for (var _di = 0; _di < data.length; _di++) { if (data[_di].date === window.__lastActDate) { _rhr = +data[_di].rhr || 0; break; } } }
    window.__lastMetrics = window.__computeActivityMetrics(S, _ath, _rhr);
    var _sb = window.__lastActSbId;
    if (_sb && window.__lastMetrics) {
      var _prev = null;
      if (Array.isArray(data)) data.forEach(function (dd) { (dd.activities || []).forEach(function (aa) { if (String(aa._sbId) === String(_sb)) { _prev = aa.metrics; aa.metrics = window.__lastMetrics; } }); });
      if ((!_prev || +_prev._v !== +window.__lastMetrics._v) && window.cloudSync && window.cloudSync.saveActivityMetrics) {
        try { window.cloudSync.saveActivityMetrics(_sb, window.__lastMetrics); } catch (e) {}
      }
    }
  } catch (e) { console.warn('[metrics]', e && e.message); window.__lastMetrics = {}; }
  var container = document.querySelector('.main .container') || document.querySelector('.container');
  if (!container) return;
  var page = document.getElementById('p-analysis');
  if (!page) { page = document.createElement('section'); page.className = 'panel'; page.id = 'p-analysis'; container.appendChild(page); }
  // memorise le panneau courant pour le retour
  var cur = document.querySelector('.panel.active');
  window.__prevPanelId = (cur && cur.id && cur.id !== 'p-analysis') ? cur.id : (window.__prevPanelId || 'p1');
  // ferme la modale d'activite
  var modal = document.getElementById('session-modal'); if (modal) modal.classList.remove('active');
  // structure : Retour + onglets internes + contenus
  page.innerHTML =
    '<div class="af-overview-wrap">' + window.__buildAfOverview(window.__lastAct, window.__lastMetrics) + '</div>'
    + '<div class="af-tabbar">'
    +   '<button class="af-tab active" type="button" data-tab="courbes">Courbes</button>'
    +   '<button class="af-tab" type="button" data-tab="records">Records</button>'
    +   '<button class="af-tab" type="button" data-tab="zones">Zones</button>'
    +   '<button class="af-tab" type="button" data-tab="dist">Distribution</button>'
    + '</div>'
    + '<div class="af-tabc active" id="af-tab-courbes"><div id="af-courbes-slot"></div></div>'
    + '<div class="af-tabc" id="af-tab-records"><div class="af-section"><div class="af-h">Courbe de puissance (mean-max)</div><div class="af-chart"><canvas id="af-pcurve"></canvas></div></div><div class="af-section"><div class="af-h" style="display:flex;align-items:center;justify-content:space-between;gap:10px">Records de puissance <button class="af-recalc af-back" type="button" style="margin:0">Recalculer les records</button></div><div id="af-recalc-status" style="font-size:11px;color:var(--text-mute);margin-bottom:8px;display:none"></div><div id="af-records"></div></div></div>'
    + '<div class="af-tabc" id="af-tab-zones"><div class="af-grid2"><div class="af-section"><div class="af-h">Temps par zone \u2014 Puissance</div><div class="af-chart"><canvas id="af-zpow"></canvas></div></div><div class="af-section"><div class="af-h">Temps par zone \u2014 FC</div><div class="af-chart"><canvas id="af-zhr"></canvas></div></div></div></div>'
    + '<div class="af-tabc" id="af-tab-dist"><div class="af-section"><div class="af-h">Distribution de puissance</div><div class="af-chart"><canvas id="af-dist"></canvas></div></div></div>';
  page.querySelector('.af-back').addEventListener('click', window.closeFullAnalysis);
  // deplace les courbes temps (deja construites dans la modale) dans l'onglet Courbes
  var dc = document.getElementById('detailed-charts');
  if (dc) { dc.style.display = 'block'; var slot = page.querySelector('#af-courbes-slot'); if (slot) slot.appendChild(dc); }
  // bascule d'onglets
  page.querySelectorAll('.af-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      page.querySelectorAll('.af-tab').forEach(function (b) { b.classList.remove('active'); });
      page.querySelectorAll('.af-tabc').forEach(function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      var tc = page.querySelector('#af-tab-' + btn.dataset.tab); if (tc) tc.classList.add('active');
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    });
  });
  var _rc = page.querySelector('.af-recalc');
  if (_rc) _rc.addEventListener('click', async function () {
    var st = document.getElementById('af-recalc-status'); if (st) { st.style.display = 'block'; st.textContent = 'Calcul en cours\u2026'; }
    _rc.disabled = true;
    try { await window.recalcAllPowerCurves(function (done, total) { if (st) st.textContent = 'Traitement ' + done + ' / ' + total + ' sorties\u2026'; }); } catch (e) {}
    if (st) st.textContent = 'Records mis \u00e0 jour.';
    _rc.disabled = false;
    try { var rt = document.getElementById('af-records'); if (rt && window.__lastStreams) rt.innerHTML = _buildRecordsTable(window.__lastStreams); } catch (e) {}
  });
  // active la page (sidebar inchangee)
  document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
  document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
  page.classList.add('active');
  var tb = document.getElementById('topbar-title'); if (tb) tb.textContent = 'Analyse détaillée';
  try { window.scrollTo(0, 0); } catch (e) {}
  window.__afCharts = [];
  setTimeout(function () { try { _buildAfCharts(S); } catch (e) { console.warn('[af charts]', e && e.message); } try { window.dispatchEvent(new Event('resize')); } catch (e2) {} }, 40);
};
window.closeFullAnalysis = function (reopen) {
  (window.__afCharts || []).forEach(function (c) { try { c.destroy(); } catch (e) {} });
  window.__afCharts = [];
  var pid = window.__prevPanelId || 'p1';
  if (typeof activatePanel === 'function') { activatePanel(pid, false); }
  else { var pg = document.getElementById('p-analysis'); if (pg) pg.classList.remove('active'); var pv = document.getElementById(pid); if (pv) pv.classList.add('active'); }
  // Retour -> rouvre la modale detail de l'activite (et non le calendrier)
  if (reopen !== false && window.__currentModalIso && typeof openSessionModal === 'function') {
    if (typeof window.__modalActIdx === 'number') window.__openActIdx = window.__modalActIdx;
    try { openSessionModal(window.__currentModalIso, window.__currentModalSource || 'realise'); } catch (e) {}
  }
};
// Clic sur "Voir l'analyse detaillee" (delegation -> robuste quel que soit le moment de rendu)
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('#toggle-detailed') : null;
  if (!b) return;
  e.preventDefault();
  if (typeof window.openFullAnalysis === 'function') window.openFullAnalysis();
});
// Lignes AFFICHEES dans le tableau des records (lisible, pas trop de lignes).
var __PC_TABLE_DURS = (function () {
  var d = [], s;
  for (s = 1; s <= 10; s++) d.push(s);
  for (s = 15; s <= 30; s += 5) d.push(s);
  d.push(45);
  for (s = 60; s <= 600; s += 60) d.push(s);
  for (s = 900; s <= 3600; s += 300) d.push(s);
  for (s = 4500; s <= 9000; s += 900) d.push(s);
  for (s = 10800; s <= 28800; s += 1800) d.push(s);
  return d;
})();
// Resolution de STOCKAGE / records : dense (vraies valeurs a chaque seconde la ou ca compte).
// chaque seconde jusqu'a 10 min, puis 5 s jusqu'a 30 min, 30 s jusqu'a 1 h, 5 min au-dela.
var __PC_DURS = (function () {
  var d = [], s;
  for (s = 1; s <= 600; s++) d.push(s);
  for (s = 605; s <= 1800; s += 5) d.push(s);
  for (s = 1830; s <= 3600; s += 30) d.push(s);
  for (s = 3900; s <= 28800; s += 300) d.push(s);
  return d;
})();
var __PC_VERSION = 3;   // bumper quand le jeu de durees change -> force le recalcul
window.__powerCurveFromWatts = function (watts) {
  if (!watts || !watts.length) return null;
  var n = watts.length, pref = new Float64Array(n + 1);
  for (var i = 0; i < n; i++) { var w = watts[i]; pref[i + 1] = pref[i] + ((w == null || isNaN(w)) ? 0 : +w); }
  var out = {};
  __PC_DURS.forEach(function (d) { if (d > n) return; var best = 0; for (var s = 0; s + d <= n; s++) { var avg = (pref[s + d] - pref[s]) / d; if (avg > best) best = avg; } out[d] = Math.round(best); });
  out._v = __PC_VERSION;
  return out;
};
// toutes les courbes connues, regroupees par duree -> pour le rang
window.__allPowerCurvesByDur = function (cutoffIso, sportCat) {
  var m = {};
  var catOf = function (x) { return (typeof getSportCategory === 'function') ? getSportCategory(x) : x; };
  if (Array.isArray(data)) data.forEach(function (dd) {
    var diso = (typeof toIsoDate === 'function') ? toIsoDate(dd.date) : null;
    if (cutoffIso && diso && diso > cutoffIso) return;   // sorties POSTERIEURES ignorees (rang fige a la date)
    (dd.activities || []).forEach(function (a) {
      if (!a || a._exclPower) return;                                          // masquee des records
      if (sportCat && catOf(a.raw_type || a.sport) !== sportCat) return;       // autre sport
      var pc = a.power_curve; if (!pc) return;
      for (var k in pc) { if (k === '_v') continue; var v = +pc[k]; if (!isNaN(v)) { (m[k] = m[k] || []).push(v); } }
    });
  });
  return m;
};
// Top N enregistrements {w, nom, date} pour une duree donnee (meme filtre que le rang).
window.__topRecordsForDur = function (dur, cutoffIso, sportCat, limit) {
  var out = [];
  var catOf = function (x) { return (typeof getSportCategory === 'function') ? getSportCategory(x) : x; };
  if (Array.isArray(data)) data.forEach(function (dd) {
    var diso = (typeof toIsoDate === 'function') ? toIsoDate(dd.date) : null;
    if (cutoffIso && diso && diso > cutoffIso) return;
    (dd.activities || []).forEach(function (a) {
      if (!a || a._exclPower) return;
      if (sportCat && catOf(a.raw_type || a.sport) !== sportCat) return;
      var pc = a.power_curve; if (!pc) return;
      var v = +pc[dur]; if (isNaN(v) || v <= 0) return;
      out.push({ w: Math.round(v), name: a.name || 'Activité', date: diso, sbId: (a._sbId != null ? String(a._sbId) : '') });
    });
  });
  out.sort(function (x, y) { return y.w - x.w; });
  return out.slice(0, limit || 30);
};
// recalcul global : parcourt les sorties avec puissance, calcule + sauve la courbe
window.recalcAllPowerCurves = async function (onProgress) {
  var list = [];
  if (Array.isArray(data)) data.forEach(function (dd) { (dd.activities || []).forEach(function (a) { if (a && a._sbId && (a.id || a.activityId) && (a.avg_watts || a.np)) list.push(a); }); });
  var total = list.length, done = 0, ok = 0, errs = 0;
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    if (a.power_curve && +a.power_curve._v === __PC_VERSION) { ok++; done++; if (onProgress) onProgress(done, total, ok); continue; }
    try {
      var sid = a.id || a.activityId;
      // Fetch SANS cache : evite l'accumulation memoire + le depassement de quota localStorage
      // qui faisaient planter le recalcul vers ~500 activites.
      var streams = (typeof loadStreamsFromSupabase === 'function') ? await loadStreamsFromSupabase(sid) : null;
      var watts = streams ? (Array.isArray(streams) ? ((streams.find(function (x) { return x && x.type === 'watts'; }) || {}).data) : streams.watts) : null;
      if (watts && watts.length) {
        var curve = window.__powerCurveFromWatts(watts);
        if (curve) { a.power_curve = curve; if (window.cloudSync && window.cloudSync.savePowerCurve) await window.cloudSync.savePowerCurve(a._sbId, curve); ok++; }
      }
      streams = null; watts = null;                                   // libere la memoire
      try { if (typeof streamsCache !== 'undefined' && streamsCache[sid] !== undefined) delete streamsCache[sid]; } catch (e2) {}
    } catch (e) { errs++; }
    done++; if (onProgress) onProgress(done, total, ok);
    if ((i & 7) === 0) await new Promise(function (r) { setTimeout(r, 0); });   // rend la main au navigateur (UI + GC)
  }
  return { total: total, ok: ok, errors: errs };
};

function _buildRecordsTable(S) {
  var W = S.wattsRaw || S.watts || [], CAD = S.cadence || [], ALT = S.altitude || [], DIST = S.distance || [], n = W.length;
  if (!n) return '';
  var pref = new Float64Array(n + 1);
  for (var i = 0; i < n; i++) { var w = W[i]; pref[i + 1] = pref[i] + ((w == null || isNaN(w)) ? 0 : +w); }
  var bestWin = function (d) { var best = -1, bi = 0; for (var s = 0; s + d <= n; s++) { var avg = (pref[s + d] - pref[s]) / d; if (avg > best) { best = avg; bi = s; } } return { avg: best, start: bi }; };
  // sauve la courbe de l'activite courante (memoire + DB) pour qu'elle compte dans le rang
  var curCurve = window.__powerCurveFromWatts(W);
  if (curCurve && window.__lastActSbId) {
    if (Array.isArray(data)) data.forEach(function (dd) { (dd.activities || []).forEach(function (a) { if (String(a._sbId) === String(window.__lastActSbId)) a.power_curve = curCurve; }); });
    if (window.cloudSync && window.cloudSync.savePowerCurve) { try { window.cloudSync.savePowerCurve(window.__lastActSbId, curCurve); } catch (e) {} }
  }
  var byDur = (typeof window.__allPowerCurvesByDur === 'function') ? window.__allPowerCurvesByDur(window.__lastActDate, window.__lastActSport) : {};
  var distMax = 0; for (var di = 0; di < DIST.length; di++) { var dv = DIST[di]; if (dv != null && dv > distMax) distMax = dv; }
  var toM = distMax > 1000 ? 1 : 1000;
  var distAt = function (idx) { var x = DIST[Math.min(idx, DIST.length - 1)]; return (x == null ? 0 : x) * toM; };
  var altGain = function (s0, s1) { var g = 0, prev = null; for (var k = s0; k < s1; k++) { var x = ALT[k]; if (x == null) continue; if (prev != null && x > prev) g += x - prev; prev = x; } return g; };
  var avgR = function (arr, s0, s1) { var sum = 0, c = 0; for (var k = s0; k < s1; k++) { var x = arr[k]; if (x != null && !isNaN(x)) { sum += x; c++; } } return c ? sum / c : 0; };
  var fmtT = function (sec) { var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60); return (h > 0 ? (h + ':' + String(m).padStart(2, '0')) : ('' + m)) + ':' + String(s).padStart(2, '0'); };
  var fmtDur = function (d) {
    if (d < 60) return d + 's';
    if (d < 3600) return (d % 60 === 0) ? (d / 60 + 'min') : (Math.floor(d / 60) + 'min' + (d % 60) + 's');
    var h = Math.floor(d / 3600), m = Math.round((d % 3600) / 60);
    return m === 0 ? (h + 'h') : (h + 'h' + String(m).padStart(2, '0') + 'm');
  };
  var std = __PC_TABLE_DURS.filter(function (d) { return d <= n; });
  var hasCad = CAD.some(function (x) { return x != null; });
  var rows = std.map(function (d) {
    var bw = bestWin(d), s0 = bw.start, s1 = Math.min(n, s0 + d), cur = Math.round(bw.avg);
    var arr = byDur[d] || []; var greater = 0; for (var z = 0; z < arr.length; z++) { if (arr[z] > cur) greater++; }
    var rank = greater + 1, totalR = arr.length || 1;
    var pct = totalR > 0 ? Math.max(2, Math.round((totalR - rank + 1) / totalR * 100)) : 0;
    var medal = rank === 1 ? '\ud83e\udd47 ' : (rank === 2 ? '\ud83e\udd48 ' : (rank === 3 ? '\ud83e\udd49 ' : ''));
    var rankTxtCol = (rank <= 10) ? '#fbbf24' : 'var(--text-dim,#9aa6b6)';
    var distM = Math.max(0, distAt(s1) - distAt(s0));
    var spd = distM > 0 ? ((distM / 1000) / (d / 3600)) : 0;
    var dplus = altGain(s0, s1);
    var cad = avgR(CAD, s0, s1);
    return '<tr class="rec-row" data-dur="' + d + '" style="cursor:pointer">'
      + '<td><span class="rec-caret">\u25b8</span> ' + fmtDur(d) + '</td>'
      + '<td class="af-tw"><b>' + cur + ' W</b></td>'
      + '<td style="min-width:170px"><div style="display:flex;align-items:center;gap:9px"><span style="color:' + rankTxtCol + ';font-weight:700;white-space:nowrap">' + medal + rank + '<span style="color:var(--text-mute,#6b7686);font-weight:400"> / ' + totalR + '</span></span><div style="flex:1;height:5px;background:var(--bg-elev,#222b3d);border-radius:3px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:#5fb87a"></div></div></div></td>'
      + '<td>' + fmtT(s0) + ' \u2192 ' + fmtT(s1) + '</td>'
      + '</tr>';
  }).join('');
  return '<div class="af-table-wrap"><table class="af-table"><thead><tr><th>Durée</th><th>Puissance</th><th>Rang</th><th>Intervalle</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}
// Clic sur une ligne de record -> deplie le top 30 (rang, W, nom, date) defilable.
if (!window.__recRowWired) {
  window.__recRowWired = true;
  document.addEventListener('click', function (e) {
    var line = e.target.closest ? e.target.closest('.rec-line') : null;
    if (line && line.dataset.sbid) {
      var liso = line.dataset.iso, lsb = line.dataset.sbid, idx = 0;
      if (Array.isArray(data)) { var dday = data.find(function (d) { return ((typeof toIsoDate === 'function') ? toIsoDate(d.date) : d.date) === liso; }); if (dday) { var ii = (dday.activities || []).findIndex(function (a) { return String(a._sbId) === lsb; }); if (ii >= 0) idx = ii; } }
      window.__openActIdx = idx;
      if (typeof closeFullAnalysis === 'function') closeFullAnalysis(false);
      if (typeof openSessionModal === 'function') openSessionModal(liso, 'realise');
      return;
    }
    var row = e.target.closest ? e.target.closest('.rec-row') : null;
    var host = document.getElementById('af-records');
    if (!row || !host || !host.contains(row)) return;
    var dur = +row.dataset.dur;
    var next = row.nextElementSibling;
    var setCaret = function (r, open) { var c = r.querySelector('.rec-caret'); if (c) c.textContent = open ? '▾' : '▸'; };
    if (next && next.classList.contains('rec-exp') && +next.dataset.dur === dur) { next.remove(); setCaret(row, false); return; }
    host.querySelectorAll('.rec-exp').forEach(function (x) { x.remove(); });
    host.querySelectorAll('.rec-caret').forEach(function (c) { c.textContent = '▸'; });
    var list = (typeof window.__topRecordsForDur === 'function') ? window.__topRecordsForDur(dur, window.__lastActDate, window.__lastActSport, 30) : [];
    var fmtDate = function (iso) { if (!iso) return ''; try { return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e2) { return iso; } };
    var inner = list.map(function (r, i) {
      var rkCol = (i < 3) ? '#fbbf24' : 'var(--text-mute,#6b7686)';
      var isCur = r.sbId && window.__lastActSbId && String(r.sbId) === String(window.__lastActSbId);
      var nmStyle = isCur ? ' style="color:var(--accent);font-weight:700"' : '';
      return '<div class="rec-line' + (isCur ? ' rec-line-cur' : '') + '" data-iso="' + (r.date || '') + '" data-sbid="' + (r.sbId || '') + '"><span class="rec-rk" style="color:' + rkCol + '">' + (i + 1) + '</span><span class="rec-w">' + r.w + ' W</span><span class="rec-nm"' + nmStyle + '>' + String(r.name || '').replace(/</g, '&lt;') + '</span><span class="rec-dt">' + fmtDate(r.date) + '</span></div>';
    }).join('');
    if (!inner) inner = '<div style="color:var(--text-mute);padding:10px">Aucun enregistrement sur cette durée.</div>';
    var tr = document.createElement('tr');
    tr.className = 'rec-exp'; tr.dataset.dur = dur;
    tr.innerHTML = '<td colspan="4"><div class="rec-exp-box">' + inner + '</div></td>';
    row.parentNode.insertBefore(tr, row.nextSibling);
    setCaret(row, true);
  });
}

function _buildAfCharts(S) {
  if (!S || !window.Chart) return;
  var grid = 'rgba(255,255,255,0.06)', tick = '#9aa6b6';
  var opts = function (extra) {
    var o = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } } }, y: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } }, beginAtZero: true } } };
    if (extra) { for (var k in extra) o[k] = extra[k]; }
    return o;
  };
  var hide = function (id) { var s = document.getElementById(id); if (s) s.style.display = 'none'; };
  var W = (S.wattsRaw || S.watts || []).map(function (x) { return (x == null || isNaN(x)) ? null : +x; });
  var HR = (S.hr || []).map(function (x) { return (x == null || isNaN(x)) ? null : +x; });
  var ftp = S.ftp || 250, hrMax = S.hrMax || 190;
  var ZHEX = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#ec4899'];
  var hasW = W.some(function (x) { return x != null; });
  var hasH = HR.some(function (x) { return x != null; });
  // Courbe de puissance (mean-max) seconde par seconde + tableau de records
  if (hasW) {
    var n = W.length;
    var pref = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) pref[i + 1] = pref[i] + (W[i] || 0);
    var bestWin = function (d) { var best = -1, bi = 0; for (var s = 0; s + d <= n; s++) { var avg = (pref[s + d] - pref[s]) / d; if (avg > best) { best = avg; bi = s; } } return { avg: best, start: bi }; };
    var durs = [];
    for (var d = 1; d <= 60; d++) durs.push(d);
    for (d = 65; d <= 300; d += 5) durs.push(d);
    for (d = 320; d <= 1200; d += 20) durs.push(d);
    for (d = 1260; d <= 3600; d += 60) durs.push(d);
    for (d = 3900; d <= n; d += 300) durs.push(d);
    durs = durs.filter(function (x) { return x <= n; });
    // Echelle X compressee (donne moins de place aux courtes durees qu'un log pur)
    var PW = 0.32, TX = function (t) { return Math.pow(t, PW); }, iTX = function (v) { return Math.pow(v, 1 / PW); };
    var fmtSec = function (t) { t = Math.round(t); if (t < 60) return t + 's'; if (t < 3600) return Math.round(t / 60) + 'min'; var h = Math.floor(t / 3600), mm = Math.round((t % 3600) / 60); return mm ? (h + 'h' + (mm < 10 ? '0' + mm : mm)) : (h + 'h'); };
    var fmtPrec = function (t) { t = Math.round(t); if (t < 60) return t + 's'; if (t < 3600) { var m = Math.floor(t / 60), s = t % 60; return s ? (m + 'min' + s + 's') : (m + 'min'); } var h = Math.floor(t / 3600), mm = Math.round((t % 3600) / 60); return mm ? (h + 'h' + (mm < 10 ? '0' + mm : mm) + 'm') : (h + 'h'); };
    var pts = durs.map(function (x) { return { x: TX(x), y: Math.round(bestWin(x).avg) }; });
    // Record all-time (envelope des meilleures perfs <= date) par duree standard
    // Utilise la VRAIE courbe (dense, brute) de l'activite courante dans l'agregation
    // (sinon l'ancienne courbe stockee, plus basse/lissee, fausse le record).
    try { var _curC = window.__powerCurveFromWatts(W); if (_curC && window.__lastActSbId && Array.isArray(data)) data.forEach(function (dd) { (dd.activities || []).forEach(function (aa) { if (String(aa._sbId) === String(window.__lastActSbId)) aa.power_curve = _curC; }); }); } catch (e) {}
    var byDur = (typeof window.__allPowerCurvesByDur === 'function') ? window.__allPowerCurvesByDur(window.__lastActDate, window.__lastActSport) : {};
    // Record all-time : VRAIE valeur a chaque point (max sur l'historique a cette duree exacte).
    // Cette sortie fait partie des records -> le Record est au moins egal a "Cette sortie"
    // (evite que le record passe sous la sortie quand la courbe stockee est plus ancienne/lissee).
    var recPts = durs.map(function (x) {
      var arr = byDur[x]; if (!arr || !arr.length) return { x: TX(x), y: null };
      var mx = 0; for (var z = 0; z < arr.length; z++) if (arr[z] > mx) mx = arr[z];
      return { x: TX(x), y: mx > 0 ? Math.round(mx) : null };
    });
    var tickT = [1, 5, 10, 30, 60, 300, 1200, 3600, 9000, 18000].filter(function (t) { return t <= n; });
    window.__afCharts.push(new Chart(document.getElementById('af-pcurve'), {
      type: 'line',
      data: { datasets: [
        { label: 'Record', data: recPts, borderColor: '#7c8698', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, fill: false, tension: 0.2 },
        { label: 'Cette sortie', data: pts, borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,.15)', fill: true, tension: 0.2, pointRadius: 0, borderWidth: 2.5 }
      ] },
      options: opts({
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        scales: {
          x: { type: 'linear', min: TX(1), max: TX(n), grid: { color: grid }, afterBuildTicks: function (ax) { ax.ticks = tickT.map(function (t) { return { value: TX(t) }; }); }, ticks: { color: tick, font: { size: 10 }, autoSkip: false, callback: function (v) { return fmtSec(iTX(v)); } } },
          y: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } }, beginAtZero: true }
        },
        plugins: { legend: { display: true, labels: { color: tick, boxWidth: 14, font: { size: 11 } } }, tooltip: { callbacks: { title: function (c) { return fmtPrec(iTX(c[0].parsed.x)); }, label: function (c) { return c.dataset.label + ' : ' + c.parsed.y + ' W'; } } } }
      })
    }));
    try { var _rt = document.getElementById('af-records'); if (_rt) _rt.innerHTML = _buildRecordsTable(S); } catch (e) { console.warn('[records]', e && e.message); }
  } else { hide('af-s-pc'); }
  // Temps par zone - puissance
  if (hasW) {
    var zsec = [0, 0, 0, 0, 0, 0, 0];
    W.forEach(function (w) { if (w == null) return; var p = w / ftp * 100; var z = p < 55 ? 0 : p < 76 ? 1 : p < 91 ? 2 : p < 106 ? 3 : p < 121 ? 4 : p < 151 ? 5 : 6; zsec[z]++; });
    window.__afCharts.push(new Chart(document.getElementById('af-zpow'), { type: 'bar', data: { labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7'], datasets: [{ data: zsec.map(function (s) { return Math.round(s / 60 * 10) / 10; }), backgroundColor: ZHEX }] }, options: opts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.parsed.x + ' min'; } } } } }) }));
  } else { hide('af-s-zp'); }
  // Temps par zone - FC
  if (hasH) {
    var hsec = [0, 0, 0, 0, 0];
    HR.forEach(function (h) { if (h == null) return; var p = h / hrMax * 100; var z = p < 60 ? 0 : p < 70 ? 1 : p < 82 ? 2 : p < 93 ? 3 : 4; hsec[z]++; });
    window.__afCharts.push(new Chart(document.getElementById('af-zhr'), { type: 'bar', data: { labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'], datasets: [{ data: hsec.map(function (s) { return Math.round(s / 60 * 10) / 10; }), backgroundColor: ['#60a5fa', '#22c55e', '#eab308', '#f97316', '#ef4444'] }] }, options: opts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.parsed.x + ' min'; } } } } }) }));
  } else { hide('af-s-zh'); }
  // Distribution de puissance
  if (hasW) {
    var mx = 0; W.forEach(function (w) { if (w != null && w > mx) mx = w; });
    var bin = 20, nb = Math.floor(mx / bin) + 1, hist = new Array(nb).fill(0);
    W.forEach(function (w) { if (w == null) return; var b = Math.min(nb - 1, Math.floor(w / bin)); hist[b]++; });
    var dl = []; for (var k = 0; k < nb; k++) dl.push('' + (k * bin));
    window.__afCharts.push(new Chart(document.getElementById('af-dist'), { type: 'bar', data: { labels: dl, datasets: [{ data: hist.map(function (s) { return Math.round(s / 60 * 10) / 10; }), backgroundColor: '#3b82f6' }] }, options: opts({ plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (c) { return c[0].label + '-' + (+c[0].label + bin) + ' W'; }, label: function (c) { return c.parsed.y + ' min'; } } } } }) }));
  } else { hide('af-s-di'); }
}

// ========= MODAL DÉTAIL SÉANCE =========
// === Rendu du profil d'altitude d'un GPX en SVG (distance vs élévation) ===
function renderGpxElevation(gpxContent, svgId) {
  const svg = document.getElementById(svgId);
  if (!svg || !gpxContent) return;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Pas de points GPS</text>';
      return;
    }
    // Haversine distance helper (km)
    function dist(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    // Construit la série (cumKm, ele)
    const series = [];
    let cumKm = 0, prevLat = null, prevLon = null;
    let hasEle = false;
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (prevLat !== null) cumKm += dist(prevLat, prevLon, lat, lon);
      prevLat = lat; prevLon = lon;
      const eleEl = pts[i].getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isNaN(ele)) hasEle = true;
      series.push({ km: cumKm, ele: isNaN(ele) ? null : ele });
    }
    if (!hasEle) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Pas de données d\'altitude dans le GPX</text>';
      return;
    }
    // Bounds
    const elevs = series.map(p => p.ele).filter(e => e != null);
    let minEle = Math.min(...elevs);
    let maxEle = Math.max(...elevs);
    const totalKm = series[series.length - 1].km;
    if (totalKm <= 0) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Distance nulle</text>';
      return;
    }
    // Marge pour que la courbe ne touche pas les bords
    const eleRange = Math.max(maxEle - minEle, 10);
    const elePad = eleRange * 0.1;
    minEle -= elePad;
    maxEle += elePad;
    // Calcul D+ total (positive elevation gain)
    let elevGain = 0;
    for (let i = 1; i < series.length; i++) {
      const d = (series[i].ele || 0) - (series[i-1].ele || 0);
      if (d > 0) elevGain += d;
    }

    const W = 900, H = 180, padL = 40, padR = 16, padT = 16, padB = 28;
    const drawW = W - padL - padR;
    const drawH = H - padT - padB;
    // Path area (du bas vers le haut)
    let path = '';
    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      if (p.ele == null) continue;
      const x = padL + (p.km / totalKm) * drawW;
      const y = padT + drawH - ((p.ele - minEle) / (maxEle - minEle)) * drawH;
      path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    // Fermer l'area pour fill
    const lastX = padL + drawW;
    const baseY = padT + drawH;
    const area = path + `L${lastX.toFixed(1)} ${baseY.toFixed(1)} L${padL} ${baseY.toFixed(1)} Z`;

    // Axes labels (3 ticks Y, distance min/mid/max)
    const ticks = [];
    for (let t = 0; t <= 3; t++) {
      const eleT = minEle + (maxEle - minEle) * (1 - t / 3);
      const yT = padT + (drawH * t / 3);
      ticks.push({ y: yT, label: Math.round(eleT) + ' m' });
    }
    const xTicks = [];
    for (let t = 0; t <= 4; t++) {
      const kmT = (totalKm * t) / 4;
      const xT = padL + (drawW * t / 4);
      xTicks.push({ x: xT, label: kmT.toFixed(0) + ' km' });
    }

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="elevGrad-${svgId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(74,222,128,0.7)"/>
          <stop offset="100%" stop-color="rgba(74,222,128,0.05)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(74,222,128,0.03)" rx="8"/>
      ${ticks.map(t => `
        <line x1="${padL}" y1="${t.y}" x2="${W - padR}" y2="${t.y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${padL - 6}" y="${t.y + 4}" text-anchor="end" fill="#64748b" font-size="11">${t.label}</text>
      `).join('')}
      ${xTicks.map(t => `
        <text x="${t.x}" y="${H - 8}" text-anchor="middle" fill="#64748b" font-size="11">${t.label}</text>
      `).join('')}
      <path d="${area}" fill="url(#elevGrad-${svgId})" stroke="none"/>
      <path d="${path}" stroke="#4ade80" stroke-width="2" fill="none" stroke-linejoin="round"/>
      <text x="${W - padR - 8}" y="${padT + 14}" text-anchor="end" fill="#4ade80" font-size="11" font-weight="700">D+ ${Math.round(elevGain)} m</text>
      <line class="cursor-line" id="${svgId}-cursor-line" x1="0" y1="${padT}" x2="0" y2="${baseY}" stroke="#fff" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none"/>
      <circle class="cursor-dot" id="${svgId}-cursor-dot" cx="0" cy="0" r="5" fill="#4ade80" stroke="#062017" stroke-width="2" opacity="0" pointer-events="none"/>
    `;

    // ====== Interactivité curseur (crosshair + tooltip) ======
    const wrap = svg.parentNode;
    const tooltip = wrap ? wrap.querySelector('.gpx-elev-tooltip') : null;
    const cursorLine = svg.querySelector('.cursor-line');
    const cursorDot = svg.querySelector('.cursor-dot');
    if (!wrap || !tooltip || !cursorLine || !cursorDot) return;

    // Trouve l'altitude interpolée à un km donné
    function eleAtKm(km) {
      if (km <= 0) return series[0].ele;
      if (km >= totalKm) return series[series.length - 1].ele;
      // Binary search
      let lo = 0, hi = series.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (series[mid].km < km) lo = mid; else hi = mid;
      }
      const a = series[lo], b = series[hi];
      const t = (km - a.km) / (b.km - a.km || 1);
      return (a.ele || 0) + ((b.ele || 0) - (a.ele || 0)) * t;
    }

    // Pente locale sur fenêtre +/- 100m
    function slopeAtKm(km) {
      const window = 0.1; // km
      const km1 = Math.max(0, km - window);
      const km2 = Math.min(totalKm, km + window);
      const e1 = eleAtKm(km1);
      const e2 = eleAtKm(km2);
      const dx = (km2 - km1) * 1000; // m
      if (dx === 0) return 0;
      return ((e2 - e1) / dx) * 100; // %
    }

    function onMove(e) {
      const rect = wrap.getBoundingClientRect();
      const xPx = e.clientX - rect.left;
      // Mappe xPx (en pixels conteneur) → x SVG (viewBox)
      const xSvg = (xPx / rect.width) * W;
      if (xSvg < padL || xSvg > W - padR) { onLeave(); return; }
      const km = ((xSvg - padL) / drawW) * totalKm;
      const ele = eleAtKm(km);
      const slope = slopeAtKm(km);
      const ySvg = padT + drawH - ((ele - minEle) / (maxEle - minEle)) * drawH;
      cursorLine.setAttribute('x1', xSvg);
      cursorLine.setAttribute('x2', xSvg);
      cursorLine.setAttribute('opacity', '0.5');
      cursorDot.setAttribute('cx', xSvg);
      cursorDot.setAttribute('cy', ySvg);
      cursorDot.setAttribute('opacity', '1');
      // Tooltip en HTML, positionné en pixels conteneur
      tooltip.style.display = 'block';
      tooltip.innerHTML = `
        <div class="t-km">${km.toFixed(2)} km</div>
        <div class="t-ele">Altitude : ${Math.round(ele)} m · pente ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}%</div>
      `;
      // Positionnement : à droite du curseur sauf si trop près du bord
      const tipW = 170;
      let left = xPx + 12;
      if (left + tipW > rect.width) left = xPx - tipW - 12;
      tooltip.style.left = left + 'px';
      tooltip.style.top = '8px';
    }
    function onLeave() {
      cursorLine.setAttribute('opacity', '0');
      cursorDot.setAttribute('opacity', '0');
      tooltip.style.display = 'none';
    }
    // Nettoie d'éventuels listeners précédents
    if (wrap._gpxElevMove) wrap.removeEventListener('mousemove', wrap._gpxElevMove);
    if (wrap._gpxElevLeave) wrap.removeEventListener('mouseleave', wrap._gpxElevLeave);
    wrap._gpxElevMove = onMove;
    wrap._gpxElevLeave = onLeave;
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);
  } catch (e) {
    console.warn('[renderGpxElevation]', e);
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Erreur de lecture de l\'altitude</text>';
  }
}

// === Extraction des MONTÉES significatives (>= minGain m) depuis le GPX ===
// Détecte les portions de montée continue, en ignorant les petites descentes (< 5m)
function extractGpxClimbs(gpxContent, minGain = 30) {
  if (!gpxContent) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) return [];
    function _d(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    // Construit la série (km cumulé, altitude)
    const series = [];
    let cumKm = 0, prevLat = null, prevLon = null;
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (prevLat !== null) cumKm += _d(prevLat, prevLon, lat, lon);
      prevLat = lat; prevLon = lon;
      const eleEl = pts[i].getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isNaN(ele)) series.push({ km: cumKm, ele });
    }
    if (series.length < 2) return [];

    // Helper : pente locale en % sur fenêtre 300m autour de l'index
    function localSlope(idx, halfWin = 0.15) {
      let j1 = idx, j2 = idx;
      while (j1 > 0 && series[idx].km - series[j1-1].km < halfWin) j1--;
      while (j2 < series.length - 1 && series[j2+1].km - series[idx].km < halfWin) j2++;
      const dx = (series[j2].km - series[j1].km) * 1000;
      if (dx <= 0) return 0;
      return ((series[j2].ele - series[j1].ele) / dx) * 100;
    }

    // === NOUVELLE APPROCHE : scan slope-based + merging ===
    // 1. Pour chaque point, calculer la pente locale (300m window)
    // 2. Marquer les points "climbing" (slope >= 2%)
    // 3. Trouver les runs continus + merger ceux séparés par <300m
    // 4. Pour chaque run, calculer D+ réel et garder si >= minGain
    const SLOPE_ENTRY = 2; // % minimum pour entrer en "climbing"
    const MERGE_GAP_KM = 0.3; // on fusionne deux runs séparés de < 300m

    const slopes = series.map((_, i) => localSlope(i));

    // Trouve les runs continus où slope >= SLOPE_ENTRY
    const runs = [];
    let runStart = -1;
    for (let i = 0; i < slopes.length; i++) {
      if (slopes[i] >= SLOPE_ENTRY) {
        if (runStart < 0) runStart = i;
      } else {
        if (runStart >= 0) {
          runs.push({ s: runStart, e: i - 1 });
          runStart = -1;
        }
      }
    }
    if (runStart >= 0) runs.push({ s: runStart, e: slopes.length - 1 });

    // Merge des runs proches (gap < MERGE_GAP_KM)
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && series[r.s].km - series[last.e].km < MERGE_GAP_KM) {
        last.e = r.e;
      } else {
        merged.push({ s: r.s, e: r.e });
      }
    }

    // Pour chaque run mergé : calcul D+ réel + filtre par minGain
    const climbs = [];
    for (const r of merged) {
      let s = r.s, e = r.e;
      // Petite extension en amont/aval tant qu'on continue à monter doucement
      while (s > 0 && series[s].ele - series[s-1].ele > 0 && localSlope(s-1) > 0) s--;
      while (e < series.length - 1 && series[e+1].ele - series[e].ele > 0 && localSlope(e+1) > 0) e++;
      // D+ smart sur la portion [s..e]
      let lastSignif = series[s].ele;
      let gain = 0;
      const TH = 3;
      for (let i = s + 1; i <= e; i++) {
        const dd = series[i].ele - lastSignif;
        if (dd > TH) { gain += dd; lastSignif = series[i].ele; }
        else if (dd < -TH) { lastSignif = series[i].ele; }
      }
      if (gain < minGain) continue;
      const distKm = series[e].km - series[s].km;
      const avgSlope = distKm > 0 ? ((series[e].ele - series[s].ele) / (distKm * 1000)) * 100 : 0;
      // Pente max
      let maxSlope = -Infinity;
      for (let j = s; j <= e; j++) {
        const sl = localSlope(j);
        if (sl > maxSlope) maxSlope = sl;
      }
      climbs.push({
        startKm: series[s].km, endKm: series[e].km,
        startEle: series[s].ele, endEle: series[e].ele,
        distKm, gain, avgSlope,
        maxSlope: isFinite(maxSlope) ? maxSlope : avgSlope,
      });
    }
    return climbs;
  } catch (e) {
    console.warn('[extractGpxClimbs]', e);
    return [];
  }
}

// === Extraction des stats principales (km, D+, D-) depuis le contenu GPX ===
// Utilisé pour override les valeurs manuellement saisies si un GPX est uploadé
// Si laps > 1 : multiplie km/D+/D- (le parcours est répété N fois)
function extractGpxStats(gpxContent, laps = 1) {
  if (!gpxContent) return null;
  laps = Math.max(1, parseInt(laps, 10) || 1);
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) return null;
    function _d(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    let cumKm = 0, prevLat = null, prevLon = null;
    const elevs = [];
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (prevLat !== null) cumKm += _d(prevLat, prevLon, lat, lon);
      prevLat = lat; prevLon = lon;
      const eleEl = pts[i].getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isNaN(ele)) elevs.push(ele);
    }
    // D+ smart avec threshold 3m
    let gain = 0, loss = 0;
    if (elevs.length > 1) {
      let lastSignif = elevs[0];
      const TH = 3;
      for (let i = 1; i < elevs.length; i++) {
        const dd = elevs[i] - lastSignif;
        if (dd > TH) { gain += dd; lastSignif = elevs[i]; }
        else if (dd < -TH) { loss += -dd; lastSignif = elevs[i]; }
      }
    }
    return {
      km: +(cumKm * laps).toFixed(2),
      dplus: Math.round(gain * laps),
      dminus: Math.round(loss * laps),
      laps,
      lapKm: +cumKm.toFixed(2),
      lapDplus: Math.round(gain),
    };
  } catch (e) {
    console.warn('[extractGpxStats]', e);
    return null;
  }
}

// === Rendu du profil d'altitude GPX via Chart.js (même look que les streams réalisés) ===
let _gpxElevChart = null;
function renderGpxElevationChart(gpxContent, canvasId, laps = 1) {
  laps = Math.max(1, parseInt(laps, 10) || 1);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !gpxContent || typeof Chart === 'undefined') return;
  // Detruit le chart précédent si existant
  if (_gpxElevChart) {
    try { _gpxElevChart.destroy(); } catch (e) {}
    _gpxElevChart = null;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) {
      canvas.parentNode.innerHTML = '<div class="modal-placeholder">Pas de points GPS dans le fichier GPX</div>';
      return;
    }
    function dist(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    const series = []; // [{x:km, y:ele}]
    let cumKm = 0, prevLat = null, prevLon = null;
    let hasEle = false;
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (prevLat !== null) cumKm += dist(prevLat, prevLon, lat, lon);
      prevLat = lat; prevLon = lon;
      const eleEl = pts[i].getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isNaN(ele)) hasEle = true;
      series.push({ x: cumKm, y: isNaN(ele) ? null : ele });
    }
    if (!hasEle) {
      canvas.parentNode.innerHTML = '<div class="modal-placeholder">Pas de données d\'altitude dans le GPX</div>';
      return;
    }
    // Calcul D+ total : algo "smart" avec threshold 3m pour filtrer le bruit GPS
    function _smartGainTotal(arr) {
      if (!arr || arr.length < 2) return 0;
      let gain = 0;
      let lastSignif = arr[0].y;
      const TH = 3;
      for (let i = 1; i < arr.length; i++) {
        const d = arr[i].y - lastSignif;
        if (d > TH) { gain += d; lastSignif = arr[i].y; }
        else if (d < -TH) { lastSignif = arr[i].y; }
      }
      return gain;
    }
    const elevGain = _smartGainTotal(series.filter(p => p.y != null));
    // PAS de lissage pour l'affichage : on garde la finesse du GPX
    let basePlot = series.filter(p => p.y != null);
    const lapKm = basePlot.length ? basePlot[basePlot.length - 1].x : 0;

    // Répétition de la série N fois (laps) avec offset de km cumulé
    let plot = [];
    if (laps > 1 && lapKm > 0) {
      for (let L = 0; L < laps; L++) {
        const offset = L * lapKm;
        for (const p of basePlot) {
          plot.push({ x: p.x + offset, y: p.y });
        }
      }
    } else {
      plot = basePlot.slice();
    }

    // Décimation seulement si vraiment beaucoup de points (>2000)
    if (plot.length > 2000) {
      const step = Math.ceil(plot.length / 2000);
      plot = plot.filter((_, i) => i % step === 0);
    }
    const totalKm = plot.length ? plot[plot.length - 1].x : 0;

    // Pour les stats : série brute répétée N fois (laps)
    let rawSeries = series.filter(p => p.y != null);
    if (laps > 1 && lapKm > 0) {
      const baseRaw = rawSeries.slice();
      rawSeries = [];
      for (let L = 0; L < laps; L++) {
        const offset = L * lapKm;
        for (const p of baseRaw) rawSeries.push({ x: p.x + offset, y: p.y });
      }
    }

    // Calcul slope sur fenêtre glissante (~200m) pour éviter le bruit instantané
    function slopeOnWindow(arr, idx, windowKm = 0.2) {
      let i1 = idx, i2 = idx;
      while (i1 > 0 && arr[idx].x - arr[i1-1].x < windowKm/2) i1--;
      while (i2 < arr.length - 1 && arr[i2+1].x - arr[idx].x < windowKm/2) i2++;
      const dx = (arr[i2].x - arr[i1].x) * 1000;
      if (dx <= 0) return 0;
      return ((arr[i2].y - arr[i1].y) / dx) * 100;
    }

    // D+ / D- "smart" : threshold de 3m sur chaque segment monotone (filtre noise GPS)
    function smartElevation(arr) {
      if (arr.length < 2) return { gain: 0, loss: 0 };
      let gain = 0, loss = 0;
      let lastSignif = arr[0].y;
      let trend = 0; // +1 = montée, -1 = descente, 0 = aucune
      const TH = 3; // mètres
      for (let i = 1; i < arr.length; i++) {
        const d = arr[i].y - lastSignif;
        if (d > TH) {
          gain += d;
          lastSignif = arr[i].y;
          trend = 1;
        } else if (d < -TH) {
          loss += -d;
          lastSignif = arr[i].y;
          trend = -1;
        }
      }
      return { gain, loss };
    }

    function computeStats(kmMin, kmMax) {
      const filtered = rawSeries.filter(p => p.x >= kmMin && p.x <= kmMax);
      if (filtered.length < 2) return null;
      const { gain, loss } = smartElevation(filtered);
      // Pente max/min sur fenêtres ~200m
      let maxSlope = -Infinity, minSlope = Infinity;
      for (let i = 0; i < filtered.length; i++) {
        const s = slopeOnWindow(filtered, i, 0.2);
        if (s > maxSlope) maxSlope = s;
        if (s < minSlope) minSlope = s;
      }
      const startEle = filtered[0].y;
      const endEle = filtered[filtered.length - 1].y;
      const distKm = filtered[filtered.length - 1].x - filtered[0].x;
      const avgSlope = distKm > 0 ? ((endEle - startEle) / (distKm * 1000)) * 100 : 0;
      return { distKm, gain, loss, avgSlope, maxSlope, minSlope, startEle, endEle, kmMin: filtered[0].x, kmMax: filtered[filtered.length - 1].x };
    }
    function renderStats(stats, isSelection = false) {
      const row = document.getElementById('gpx-stats-row-prevu');
      if (!row) return;
      if (!stats) {
        row.innerHTML = '';
        window._gpxCurrentSelectionStats = null;
        return;
      }
      // Stocke la sélection courante en global pour que le bouton puisse la lire
      window._gpxCurrentSelectionStats = isSelection ? stats : null;
      const fmtSlope = s => (s >= 0 ? '+' : '') + s.toFixed(1) + '%';
      const addBtn = isSelection
        ? `<button class="add-segment-btn" id="add-segment-btn" title="Sauvegarder cette portion comme segment">+ Ajouter segment</button>`
        : '';
      row.innerHTML = `
        <div class="gpx-stat"><div class="g-l">Distance</div><div class="g-v">${stats.distKm.toFixed(2)} km</div></div>
        <div class="gpx-stat"><div class="g-l">D+</div><div class="g-v">${Math.round(stats.gain)} m</div></div>
        <div class="gpx-stat"><div class="g-l">D−</div><div class="g-v">${Math.round(stats.loss)} m</div></div>
        <div class="gpx-stat"><div class="g-l">Pente moy.</div><div class="g-v">${fmtSlope(stats.avgSlope)}</div></div>
        <div class="gpx-stat"><div class="g-l">Pente max</div><div class="g-v">${fmtSlope(stats.maxSlope)}</div></div>
        <div class="gpx-stat"><div class="g-l">Pente min</div><div class="g-v">${fmtSlope(stats.minSlope)}</div></div>
        ${addBtn}
      `;
      const btn = document.getElementById('add-segment-btn');
      if (btn) btn.addEventListener('click', () => {
        if (typeof window.gpxAddCurrentSelectionAsSegment === 'function') {
          window.gpxAddCurrentSelectionAsSegment();
        }
      });
    }
    // Stats initiales (parcours complet)
    renderStats(computeStats(0, totalKm));

    // Fonction pour highlighter un segment sur la carte Leaflet
    function highlightSegmentOnMap(kmMin, kmMax) {
      const linked = window._gpxLinkedData;
      if (!linked || !linked.map) return;
      // Supprime le précédent highlight
      if (linked._highlightLayer) {
        try { linked.map.removeLayer(linked._highlightLayer); } catch (e) {}
        linked._highlightLayer = null;
        try { linked.map.removeLayer(linked._highlightBg); } catch (e) {}
        linked._highlightBg = null;
      }
      if (kmMin == null || kmMax == null) return;
      // Sélectionne les coords correspondant au range km
      const segCoords = [];
      for (let i = 0; i < linked.cumKmByIdx.length; i++) {
        if (linked.cumKmByIdx[i] >= kmMin && linked.cumKmByIdx[i] <= kmMax) {
          segCoords.push(linked.coords[i]);
        }
      }
      if (segCoords.length < 2) return;
      // Double couche : contour vert épais + intérieur noir → effet "tube vert"
      linked._highlightBg = L.polyline(segCoords, {
        color: '#4ade80', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round',
      }).addTo(linked.map);
      linked._highlightLayer = L.polyline(segCoords, {
        color: '#000', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round',
      }).addTo(linked.map);
      // Recadrage léger
      linked.map.fitBounds(linked._highlightLayer.getBounds(), { padding: [40, 40], maxZoom: 17, animate: true });
    }

    // Chart.js area chart avec drag-select
    _gpxElevChart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Altitude',
          data: plot,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74,222,128,0.20)',
          borderWidth: 1.4,
          pointRadius: 0,
          fill: true,
          tension: 0, // pas de lissage Bezier : on garde la forme exacte du GPX
          parsing: false,
          spanGaps: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        elements: { point: { hoverRadius: 0 } },
        plugins: {
          legend: { display: false },
          // Tooltip Chart.js désactivé : on utilise un tooltip HTML custom interpolé
          tooltip: { enabled: false },
          // Désactive le plugin global verticalHoverLine qui dessinait une 2e ligne
          // snappée au point le plus proche
          verticalHoverLine: false,
          // Drag-select pour sélectionner une portion du parcours (zoom plugin)
          zoom: {
            zoom: {
              drag: {
                enabled: true,
                backgroundColor: 'rgba(74, 222, 128, 0.18)',
                borderColor: 'rgba(74, 222, 128, 0.6)',
                borderWidth: 1,
              },
              mode: 'x',
              onZoomComplete: ({ chart }) => {
                const xScale = chart.scales.x;
                const kmMin = xScale.min;
                const kmMax = xScale.max;
                const stats = computeStats(kmMin, kmMax);
                renderStats(stats, true); // true = c'est une sélection (affiche bouton + ajouter segment)
                if (stats) highlightSegmentOnMap(stats.kmMin, stats.kmMax);
              },
            },
            limits: { x: { min: 'original', max: 'original' } },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max: totalKm,
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: v => v.toFixed(0) + ' km',
              maxTicksLimit: 8,
            },
            grid: { display: false }, // pas de lignes de grille verticales (évite confusion avec le curseur)
            border: { display: false },
          },
          y: {
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: v => Math.round(v) + ' m',
              maxTicksLimit: 4,
            },
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            border: { display: false },
            title: { display: false },
          },
        },
      },
    });

    // Pas de badge D+ : l'info est déjà dans la barre de stats au-dessus du graphique
    const wrap = canvas.parentNode;
    const oldBadge = wrap.querySelector('.gpx-elev-dplus-badge');
    if (oldBadge) oldBadge.remove();

    // === CROSSHAIR INTERPOLÉ (DOM divs, pixel-perfect) ===
    const tooltipEl = wrap.querySelector('.gpx-elev-tooltip');
    // Cleanup AGGRESSIF : retire toutes les crosshair lines/dots/overlays existant
    // dans le document (au cas où d'anciennes instances traînent quelque part)
    document.querySelectorAll('.gpx-elev-line').forEach(n => n.remove());
    document.querySelectorAll('.gpx-elev-dot').forEach(n => n.remove());
    document.querySelectorAll('.gpx-elev-overlay').forEach(n => n.remove());
    // Crosshair vertical (div absolute) + dot — fraîchement créés
    const cursorLine = document.createElement('div');
    cursorLine.className = 'gpx-elev-line';
    wrap.appendChild(cursorLine);
    const cursorDot = document.createElement('div');
    cursorDot.className = 'gpx-elev-dot';
    wrap.appendChild(cursorDot);

    function interpolateY(km) {
      // Binary search dans plot pour interpoler l'altitude au km exact
      if (!plot.length) return null;
      if (km <= plot[0].x) return plot[0].y;
      if (km >= plot[plot.length - 1].x) return plot[plot.length - 1].y;
      let lo = 0, hi = plot.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (plot[mid].x < km) lo = mid; else hi = mid;
      }
      const t = (km - plot[lo].x) / (plot[hi].x - plot[lo].x || 1);
      return plot[lo].y + (plot[hi].y - plot[lo].y) * t;
    }
    function slopeAt(km, win = 0.1) {
      const e1 = interpolateY(km - win);
      const e2 = interpolateY(km + win);
      if (e1 == null || e2 == null) return 0;
      return ((e2 - e1) / (win * 2 * 1000)) * 100;
    }

    function onChartMove(e) {
      const cRect = canvas.getBoundingClientRect();
      const wRect = wrap.getBoundingClientRect();
      const xInCanvas = e.clientX - cRect.left;   // px relatifs au canvas chart
      const yInCanvas = e.clientY - cRect.top;
      const chartArea = _gpxElevChart.chartArea;
      if (xInCanvas < chartArea.left || xInCanvas > chartArea.right ||
          yInCanvas < chartArea.top || yInCanvas > chartArea.bottom) {
        clearCursor();
        return;
      }
      const km = _gpxElevChart.scales.x.getValueForPixel(xInCanvas);
      const ele = interpolateY(km);
      if (ele == null) { clearCursor(); return; }
      const yOnLineInCanvas = _gpxElevChart.scales.y.getPixelForValue(ele);
      const slope = slopeAt(km);

      // Positions converties en coords relatives au WRAP (pour le DOM positioning)
      const xInWrap = (cRect.left - wRect.left) + xInCanvas;
      const yInWrap = (cRect.top - wRect.top) + yOnLineInCanvas;
      const topInWrap = (cRect.top - wRect.top) + chartArea.top;
      const bottomInWrap = (cRect.top - wRect.top) + chartArea.bottom;

      // Ligne verticale (DOM div)
      cursorLine.style.left = xInWrap + 'px';
      cursorLine.style.top = topInWrap + 'px';
      cursorLine.style.height = (bottomInWrap - topInWrap) + 'px';
      cursorLine.style.display = 'block';

      // Dot
      cursorDot.style.left = (xInWrap - 6) + 'px';
      cursorDot.style.top = (yInWrap - 6) + 'px';
      cursorDot.style.display = 'block';

      // Tooltip
      tooltipEl.style.display = 'block';
      tooltipEl.innerHTML = `
        <div class="t-km">${km.toFixed(2)} km</div>
        <div class="t-ele">Altitude : ${Math.round(ele)} m · pente ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}%</div>
      `;
      const tipW = 180;
      let left = xInWrap + 14;
      if (left + tipW > wRect.width) left = xInWrap - tipW - 14;
      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top = '8px';

      // Bike marker sur la carte (interpolation pixel-perfect)
      // Si laps > 1 : on prend km modulo lapKm pour retrouver la position sur la boucle
      const linked = window._gpxLinkedData;
      if (linked && linked.bikeMarker && linked.cumKmByIdx) {
        const arr = linked.cumKmByIdx;
        const lapLen = linked.totalKm || (arr[arr.length - 1] || 0);
        let kmOnLoop = km;
        if (lapLen > 0) kmOnLoop = ((km % lapLen) + lapLen) % lapLen;
        let lo2 = 0, hi2 = arr.length - 1;
        while (lo2 < hi2 - 1) {
          const mid = (lo2 + hi2) >> 1;
          if (arr[mid] < kmOnLoop) lo2 = mid; else hi2 = mid;
        }
        const t2 = (kmOnLoop - arr[lo2]) / (arr[hi2] - arr[lo2] || 1);
        const lat = linked.coords[lo2][0] + (linked.coords[hi2][0] - linked.coords[lo2][0]) * t2;
        const lon = linked.coords[lo2][1] + (linked.coords[hi2][1] - linked.coords[lo2][1]) * t2;
        linked.bikeMarker.setLatLng([lat, lon]);
        linked.bikeMarker.setOpacity(1);
      }
    }
    function clearCursor() {
      cursorLine.style.display = 'none';
      cursorDot.style.display = 'none';
      tooltipEl.style.display = 'none';
      const linked = window._gpxLinkedData;
      if (linked && linked.bikeMarker) linked.bikeMarker.setOpacity(0);
    }
    // Cleanup old listeners
    if (canvas._gpxMove) canvas.removeEventListener('mousemove', canvas._gpxMove);
    if (canvas._gpxLeave) canvas.removeEventListener('mouseleave', canvas._gpxLeave);
    canvas._gpxMove = onChartMove;
    canvas._gpxLeave = clearCursor;
    canvas.addEventListener('mousemove', onChartMove);
    canvas.addEventListener('mouseleave', clearCursor);

    // Double-clic → reset zoom + stats + retire highlight
    canvas.addEventListener('dblclick', () => {
      try { _gpxElevChart.resetZoom(); } catch (e) {}
      renderStats(computeStats(0, totalKm));
      highlightSegmentOnMap(null, null);
    });
  } catch (e) {
    console.warn('[renderGpxElevationChart]', e);
    canvas.parentNode.innerHTML = '<div class="modal-placeholder">Erreur de lecture du GPX</div>';
  }
}

// Helper qui attache le système de crosshair smooth (overlay canvas + interpolation)
// utilisé par les streams realised, sur n'importe quel chart Chart.js
function _attachSmoothCrosshair(chart) {
  if (!chart || !chart.canvas) return;
  const canvas = chart.canvas;
  const parent = canvas.parentNode;
  if (!parent) return;
  // Crée overlay si pas existant
  if (!chart._stOverlay) {
    const cs = getComputedStyle(parent);
    if (cs.position === 'static') parent.style.position = 'relative';
    const ov = document.createElement('canvas');
    ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
    parent.appendChild(ov);
    chart._stOverlay = ov;
    chart._stOverlayCtx = ov.getContext('2d');
    if (typeof _resizeOverlay === 'function') _resizeOverlay(chart);
  }
  // Réutilise _smoothMM / _smoothML déjà définis pour les streams realised
  if (!canvas._smoothMM) {
    canvas._smoothMM = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width) / (chart.currentDevicePixelRatio || window.devicePixelRatio || 1);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height) / (chart.currentDevicePixelRatio || window.devicePixelRatio || 1);
      const { left, right, top, bottom } = chart.chartArea;
      if (x < left || x > right || y < top || y > bottom) {
        if (typeof _smoothPendingX !== 'undefined') {
          _smoothPendingX = null;
          if (typeof _scheduleSmoothDraw === 'function') _scheduleSmoothDraw();
        }
        return;
      }
      if (typeof _smoothPendingX !== 'undefined') {
        _smoothPendingX = chart.scales.x.getValueForPixel(x);
        if (typeof _scheduleSmoothDraw === 'function') _scheduleSmoothDraw();
      }
    };
    canvas._smoothML = () => {
      if (typeof _smoothPendingX !== 'undefined') {
        _smoothPendingX = null;
        if (typeof _scheduleSmoothDraw === 'function') _scheduleSmoothDraw();
      }
    };
    canvas.addEventListener('mousemove', canvas._smoothMM);
    canvas.addEventListener('mouseleave', canvas._smoothML);
  }
}

// === Rendu d'une trace GPX sur une vraie carte Leaflet (OpenStreetMap) ===
let _gpxLeafletMap = null;
function renderGpxLeafletMap(gpxContent, divId) {
  const el = document.getElementById(divId);
  if (!el || !gpxContent || typeof L === 'undefined') return;
  // Cleanup map précédente
  if (_gpxLeafletMap) {
    try { _gpxLeafletMap.remove(); } catch (e) {}
    _gpxLeafletMap = null;
  }
  el.innerHTML = '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    if (!pts.length) {
      el.innerHTML = '<div class="modal-placeholder">Pas de points GPS dans le fichier GPX</div>';
      return;
    }
    const coords = [];
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      coords.push([lat, lon]);
    }
    if (!coords.length) {
      el.innerHTML = '<div class="modal-placeholder">Trace illisible</div>';
      return;
    }

    // Init la carte
    _gpxLeafletMap = L.map(el, {
      zoomControl: true,
      attributionControl: false,
    });

    // 1) Couche de base : hillshade ESRI subtil pour donner du relief
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      opacity: 0.6,
    }).addTo(_gpxLeafletMap);

    // 2) Couche principale : OSM standard quasi opaque → look propre, lisible
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      opacity: 0.88,
    }).addTo(_gpxLeafletMap);

    // Attribution discrète en bas à droite
    L.control.attribution({
      prefix: false,
      position: 'bottomright',
    }).addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · Relief © <a href="https://www.esri.com/" target="_blank">Esri</a>').addTo(_gpxLeafletMap);

    // Trace en double couche : contour noir épais en dessous + vert accent au-dessus
    L.polyline(coords, {
      color: '#000',
      weight: 8,
      opacity: 0.55,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(_gpxLeafletMap);
    const trace = L.polyline(coords, {
      color: '#4ade80',
      weight: 5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(_gpxLeafletMap);

    // === Flèches indiquant le sens du parcours ===
    // On en place une tous les ~N points (ajusté pour avoir 8-12 flèches au total)
    const arrowEvery = Math.max(20, Math.floor(coords.length / 10));
    function bearing(lat1, lon1, lat2, lon2) {
      const toRad = d => d * Math.PI / 180;
      const toDeg = r => r * 180 / Math.PI;
      const φ1 = toRad(lat1), φ2 = toRad(lat2);
      const Δλ = toRad(lon2 - lon1);
      const y = Math.sin(Δλ) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
      return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }
    // SVG d'une vraie flèche (tige + pointe), pointant vers le HAUT par défaut
    // Tige + tête → direction sans ambiguïté possible
    const arrowSvg = `<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2 L18 11 L14 11 L14 22 L10 22 L10 11 L6 11 Z"
            fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`;
    for (let i = arrowEvery; i < coords.length - 1; i += arrowEvery) {
      let prevIdx = i - 1, nextIdx = i + 1;
      while (prevIdx > 0 && Math.abs(coords[prevIdx][0] - coords[i][0]) < 0.0001 && Math.abs(coords[prevIdx][1] - coords[i][1]) < 0.0001) prevIdx--;
      while (nextIdx < coords.length - 1 && Math.abs(coords[nextIdx][0] - coords[i][0]) < 0.0001 && Math.abs(coords[nextIdx][1] - coords[i][1]) < 0.0001) nextIdx++;
      const angle = bearing(coords[prevIdx][0], coords[prevIdx][1], coords[nextIdx][0], coords[nextIdx][1]);
      const arrowIcon = L.divIcon({
        className: 'gpx-arrow',
        html: `<div class="gpx-arrow-wrap" style="transform:rotate(${angle}deg);">${arrowSvg}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      L.marker(coords[i], { icon: arrowIcon, interactive: false, keyboard: false }).addTo(_gpxLeafletMap);
    }

    // === Référence globale pour le curseur du profil → marker mobile sur la carte ===
    // Calcul du cumul de distance par point pour pouvoir mapper km → lat/lon
    const cumKmByIdx = [0];
    for (let i = 1; i < coords.length; i++) {
      cumKmByIdx.push(cumKmByIdx[i-1] + dist(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]));
    }
    const totalKm = cumKmByIdx[cumKmByIdx.length - 1];
    window._gpxLinkedData = { coords, cumKmByIdx, totalKm, map: _gpxLeafletMap };
    // Marker bike (caché par défaut)
    const bikeIcon = L.divIcon({
      className: 'gpx-bike-marker',
      html: `<div class="gpx-bike-dot"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const bikeMarker = L.marker(coords[0], { icon: bikeIcon, interactive: false, keyboard: false, opacity: 0 }).addTo(_gpxLeafletMap);
    window._gpxLinkedData.bikeMarker = bikeMarker;
    // Helper distance pour le linkage
    function dist(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }

    // Markers départ + arrivée (avec gestion boucle)
    const start = coords[0];
    const end = coords[coords.length - 1];
    const isLoop = Math.abs(start[0] - end[0]) < 0.0002 && Math.abs(start[1] - end[1]) < 0.0002;

    // Icônes custom : cercles colorés via DivIcon
    function makeIcon(color, label) {
      return L.divIcon({
        className: 'gpx-marker',
        html: `<div class="gpx-marker-dot" style="background:${color};"></div><div class="gpx-marker-label" style="color:${color};">${label}</div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
    }
    if (isLoop) {
      L.marker(start, { icon: makeIcon('#fbbf24', 'DÉPART / ARRIVÉE') }).addTo(_gpxLeafletMap);
    } else {
      L.marker(start, { icon: makeIcon('#4ade80', 'DÉPART') }).addTo(_gpxLeafletMap);
      L.marker(end, { icon: makeIcon('#ef4444', 'ARRIVÉE') }).addTo(_gpxLeafletMap);
    }

    // Cadre la vue sur la trace avec un peu de padding
    const bounds = trace.getBounds();
    _gpxLeafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });

    // Plusieurs invalidateSize + refit pour gérer le rendu différé de la modal
    // (la modal peut prendre du temps à atteindre sa taille finale après animation)
    const refit = () => {
      if (!_gpxLeafletMap) return;
      _gpxLeafletMap.invalidateSize(true);
      _gpxLeafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    };
    requestAnimationFrame(refit);
    setTimeout(refit, 150);
    setTimeout(refit, 400);
    setTimeout(refit, 800);
  } catch (e) {
    console.warn('[renderGpxLeafletMap]', e);
    el.innerHTML = '<div class="modal-placeholder">Erreur de lecture du GPX</div>';
  }
}

// === Rendu d'une trace GPX en SVG (parse le XML + projette lat/lon en path SVG) — legacy, conservé pour compat ===
function renderGpxTrack(gpxContent, svgId) {
  const svg = document.getElementById(svgId);
  if (!svg || !gpxContent) return;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    const trkpts = doc.getElementsByTagName('trkpt');
    if (!trkpts.length) {
      // Fallback : essaye les routes (rtept) ou waypoints (wpt)
      const alts = doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt');
      if (!alts.length) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Aucun point GPS dans le fichier GPX</text>';
        return;
      }
    }
    const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : doc.getElementsByTagName('wpt'));
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    const coords = [];
    for (let i = 0; i < pts.length; i++) {
      const lat = parseFloat(pts[i].getAttribute('lat'));
      const lon = parseFloat(pts[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      coords.push([lat, lon]);
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    if (!coords.length) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Trace illisible</text>';
      return;
    }

    // Projection simple Mercator-like sur la bounding box
    const W = 900, H = 400, pad = 16;
    const lonRange = maxLon - minLon || 0.0001;
    const latRange = maxLat - minLat || 0.0001;
    const aspect = lonRange / latRange * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    let drawW, drawH;
    if (aspect * (H - 2 * pad) >= (W - 2 * pad)) {
      drawW = W - 2 * pad;
      drawH = drawW / aspect;
    } else {
      drawH = H - 2 * pad;
      drawW = drawH * aspect;
    }
    const offX = (W - drawW) / 2;
    const offY = (H - drawH) / 2;

    const path = coords.map((c, i) => {
      const x = offX + ((c[1] - minLon) / lonRange) * drawW;
      // y inversé (lat croissante vers le haut)
      const y = offY + (1 - (c[0] - minLat) / latRange) * drawH;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');

    const startX = offX + ((coords[0][1] - minLon) / lonRange) * drawW;
    const startY = offY + (1 - (coords[0][0] - minLat) / latRange) * drawH;
    const endX = offX + ((coords[coords.length-1][1] - minLon) / lonRange) * drawW;
    const endY = offY + (1 - (coords[coords.length-1][0] - minLat) / latRange) * drawH;

    // Détection de superposition (boucle) : si départ et arrivée sont proches (< 30px)
    const distPx = Math.hypot(endX - startX, endY - startY);
    const isLoop = distPx < 30;

    // Helper pour placer le label DÉPART/ARRIVÉE en évitant les bords
    function placeLabel(cx, cy, text, color, prefer = 'right') {
      const padX = 12, padY = 4;
      const approxW = text.length * 6.5 + 4; // largeur estimée
      let lx = cx + padX, ly = cy + padY;
      let anchor = 'start';
      // Si trop près du bord droit, place à gauche
      if (lx + approxW > W - 8) { lx = cx - padX; anchor = 'end'; }
      // Si trop près du bord haut, descend
      if (ly < 14) ly = cy + 16;
      // Si trop près du bord bas
      if (ly > H - 8) ly = cy - 10;
      return `<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="${color}" font-size="11" font-weight="700" stroke="#062017" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${text}</text>`;
    }

    let markersSvg;
    if (isLoop) {
      // Cercle unique mi-vert mi-rouge + label combiné
      markersSvg = `
        <circle cx="${startX}" cy="${startY}" r="7" fill="#4ade80" stroke="#062017" stroke-width="2"/>
        <path d="M ${startX - 7} ${startY} A 7 7 0 0 1 ${startX + 7} ${startY} Z" fill="#ef4444" stroke="#062017" stroke-width="0"/>
        <circle cx="${startX}" cy="${startY}" r="7" fill="none" stroke="#062017" stroke-width="2"/>
        ${placeLabel(startX, startY, 'DÉPART / ARRIVÉE', '#fbbf24')}
      `;
    } else {
      markersSvg = `
        <circle cx="${startX}" cy="${startY}" r="6" fill="#4ade80" stroke="#062017" stroke-width="2"/>
        ${placeLabel(startX, startY, 'DÉPART', '#4ade80')}
        <circle cx="${endX}" cy="${endY}" r="6" fill="#ef4444" stroke="#062017" stroke-width="2"/>
        ${placeLabel(endX, endY, 'ARRIVÉE', '#ef4444')}
      `;
    }

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="gpxGrad-${svgId}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#4ade80"/>
          <stop offset="100%" stop-color="#22c55e"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="rgba(74,222,128,0.03)" rx="8"/>
      <path d="${path}" stroke="url(#gpxGrad-${svgId})" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      ${markersSvg}
    `;
  } catch (e) {
    console.warn('[renderGpxTrack] erreur de parsing :', e);
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-size="12">Erreur de lecture du GPX</text>';
  }
}

// Détail d'un jour de repos passé : si Whoop est connecté et qu'on a des données
// de récupération pour ce jour, on les affiche. Sinon message simple.
function openRestDayModal(iso) {
  const date = new Date(iso + 'T12:00:00');
  if (isNaN(date.getTime())) return;
  // Mobile : date compacte ("mer. 1 juil. 2026") pour que l'heure + le sport tiennent sur la même ligne
  const dateStr = (window.innerWidth < 860)
    ? date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const titleEl = document.getElementById('modal-title');
  const metaEl = document.getElementById('modal-meta');
  const bodyEl = document.getElementById('modal-body');
  const _e = document.getElementById('modal-edit-btn'); if (_e) _e.hidden = true;
  const _d = document.getElementById('modal-delete-btn'); if (_d) _d.hidden = true;

  titleEl.innerHTML = 'Repos';
  metaEl.textContent = dateStr;

  const day = data.find(d => toIsoDate(d.date) === iso);
  const hasReco = day && day.recovery != null;
  const whoopConnected = !window.__noWhoopCard;
  const couchBlock = `<div class="rest-modal-couch">${REST_COUCH_SVG}</div>`;

  if (hasReco) {
    const rec = day.recovery;
    const recColor = rec > 66 ? 'var(--accent)' : rec > 33 ? 'var(--warn)' : 'var(--danger)';
    const cards = [];
    cards.push(`<div class="modal-metric"><div class="m-label">Récupération</div><div class="m-value" style="color:${recColor};">${rec}<span style="font-size:14px;">%</span></div></div>`);
    if (day.hrv != null) cards.push(`<div class="modal-metric"><div class="m-label">HRV</div><div class="m-value">${day.hrv}<span style="font-size:14px;"> ms</span></div></div>`);
    if (day.rhr != null) cards.push(`<div class="modal-metric"><div class="m-label">FC repos</div><div class="m-value">${day.rhr}<span style="font-size:14px;"> bpm</span></div></div>`);
    if (day.sleepH != null) cards.push(`<div class="modal-metric"><div class="m-label">Sommeil</div><div class="m-value">${fmtDur(Math.round(day.sleepH * 60))}${day.sleepQ != null ? `<span style="font-size:13px;color:var(--text-dim);"> · ${day.sleepQ}%</span>` : ''}</div></div>`);
    if (day.strain != null) cards.push(`<div class="modal-metric"><div class="m-label">Strain</div><div class="m-value">${typeof day.strain === 'number' ? day.strain.toFixed(1) : day.strain}</div></div>`);
    bodyEl.innerHTML = `
      ${couchBlock}
      <div style="margin-bottom:14px;color:var(--text-dim);font-size:13px;">Jour de repos — récupération Whoop</div>
      <div class="modal-metrics">${cards.join('')}</div>`;
  } else if (whoopConnected) {
    bodyEl.innerHTML = `${couchBlock}<div class="modal-placeholder">Jour de repos. Aucune donnée de récupération Whoop pour ce jour.</div>`;
  } else {
    bodyEl.innerHTML = `${couchBlock}<div class="modal-placeholder">Jour de repos. Connecte Whoop pour voir ta récupération ce jour-là.</div>`;
  }
  document.getElementById('session-modal').classList.add('active');
}

// Modale d'édition d'une activité (calque d'overrides) + transformer en compétition.
function openActivityEditModal(activityId, iso) {
  const day = data.find(d => toIsoDate(d.date) === iso);
  const act = day && day.activities ? day.activities.find(a => String(a.id) === String(activityId)) : null;
  if (!act) return;
  const ov = getActivityEdit(activityId) || {};
  let exclPower = !!ov.excludePower, exclHr = !!ov.excludeHr, exclDist = !!ov.excludeDistance;

  // Course à étapes parente (si cette activité est une étape d'une course multi-activités)
  const _comps = (typeof loadCompetitions === 'function') ? loadCompetitions() : [];
  const _race = act._sbId ? _comps.find(c => Array.isArray(c.activityIds) && c.activityIds.map(String).includes(String(act._sbId)) && c.activityIds.length > 1) : null;
  const _singleComp = act._sbId ? _comps.find(c => String(c.id) === 'act-' + String(act._sbId)) : null;
  const _curPrioKey = compPrio((_race ? _race.priority : (_singleComp ? _singleComp.priority : null))).key;
  let _aePrio = _curPrioKey;

  document.getElementById('_act-edit-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.id = '_act-edit-modal';
  overlay.innerHTML = `
    <div class="day-modal day-modal-note" style="width:880px;max-width:calc(100vw - 32px);">
      <div class="day-modal-header">
        <h3>Modifier l'activité</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        <div class="add-form-grid">
          <label class="form-field form-col-2">
            <span>Nom</span>
            <input type="text" id="_ae-name">
          </label>
          <div class="form-field form-col-2 add-sec">
            <div class="add-sec-h plan">Détails</div>
            <div class="add-sec-grid g3">
              <label class="form-field"><span>Type</span><input type="text" id="_ae-type" placeholder="endurance, seuil…"></label>
              <label class="form-field"><span>Sport</span><select id="_ae-sport"></select></label>
            </div>
          </div>
          <div class="form-field form-col-2 add-sec">
            <div class="add-sec-h charge">Charge</div>
            <div class="add-sec-grid g3">
              <label class="form-field"><span>Durée (min)</span><input type="number" id="_ae-dur" min="0" placeholder="minutes"></label>
              <label class="form-field"><span>TSS</span><input type="number" id="_ae-tss" min="0" placeholder="TSS"></label>
              <label class="form-field"><span>RPE ressenti (1-10)</span><input type="number" id="_ae-rpe" min="0" max="10" step="0.5" placeholder="1 à 10"></label>
            </div>
          </div>
          <div class="form-field form-col-2 add-sec">
            <div class="add-sec-h parc">Parcours</div>
            <div class="add-sec-grid g3">
              <label class="form-field"><span>Distance (km)</span><input type="number" step="0.1" id="_ae-dist" min="0" placeholder="km"></label>
              <label class="form-field"><span>Dénivelé D+ (m)</span><input type="number" id="_ae-dplus" min="0" placeholder="mètres"></label>
              <label class="form-field"><span>Nombre de tours</span><input type="number" id="_ae-laps" min="0" placeholder="tours"></label>
            </div>
          </div>
          <label class="form-field form-col-2">
            <span>Notes</span>
            <textarea id="_ae-notes" rows="2" placeholder="Commentaire…"></textarea>
          </label>
          <div class="form-field form-col-2 add-sec">
            <div class="add-sec-h charge">Retirer des records &amp; statistiques</div>
            <div class="ae-field-hint">La donnée reste sur l'activité, mais n'est plus comptée dans les records / stats.</div>
            <div class="ae-metric-btns">
              <button type="button" class="ae-metric-btn${exclPower ? ' active' : ''}" data-m="power">Puissance</button>
              <button type="button" class="ae-metric-btn${exclHr ? ' active' : ''}" data-m="hr">Cardio</button>
              <button type="button" class="ae-metric-btn${exclDist ? ' active' : ''}" data-m="dist">Distance</button>
            </div>
            <button type="button" class="ae-transform-btn" id="_ae-transform" style="margin-top:12px">
              ${act.category === 'competition'
                ? 'Repasser en entraînement'
                : `${trophySvg('#fbbf24', 15)} Transformer en compétition`}
            </button>
            <div id="_ae-event-wrap" style="${act.category === 'competition' ? 'margin-top:12px' : 'display:none;'}">
              <label class="note-field-label">Priorité</label>
              <div class="note-type-chips" id="_ae-prio">
                <button type="button" class="note-type-chip${_curPrioKey === 'principal' ? ' active' : ''}" data-prio="principal">Objectif</button>
                <button type="button" class="note-type-chip${_curPrioKey === 'secondaire' ? ' active' : ''}" data-prio="secondaire">Préparation</button>
              </div>
              ${_race
                ? `<button type="button" class="ae-stagerace-btn" id="_ae-dissociate">Dissocier de « ${window._confirmEscape ? window._confirmEscape(_race.name) : _race.name} »</button>`
                : `<button type="button" class="ae-stagerace-btn" id="_ae-stagerace">+ Ajouter à une course à étapes</button>`}
            </div>
          </div>
        </div>
      </div>
      <div class="day-modal-footer">
        <button class="day-modal-delete" type="button" id="_ae-reset">Réinitialiser</button>
        <div style="flex:1;"></div>
        <button class="day-modal-cancel" type="button">Annuler</button>
        <button class="day-modal-save" type="button">Enregistrer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Pré-remplissage (via .value pour éviter les soucis d'échappement)
  document.getElementById('_ae-name').value = act.name || '';
  document.getElementById('_ae-type').value = act.type || '';
  if (typeof populateSportSelect === 'function') populateSportSelect('_ae-sport', act.raw_type || act.sport_raw || act.sport || 'Ride');
  document.getElementById('_ae-dur').value = act.duration || 0;
  document.getElementById('_ae-dist').value = act.distance_km != null ? act.distance_km : '';
  document.getElementById('_ae-tss').value = act.tss || 0;
  document.getElementById('_ae-rpe').value = act.rpe != null ? act.rpe : '';
  document.getElementById('_ae-dplus').value = (act.elevation_gain != null ? act.elevation_gain : (act.total_elevation_gain != null ? act.total_elevation_gain : ''));
  document.getElementById('_ae-laps').value = act.laps != null ? act.laps : '';
  document.getElementById('_ae-notes').value = act.notes || ov.notes || '';
  overlay.querySelector('#_ae-stagerace')?.addEventListener('click', () => {
    close();
    openStageRaceBuilder(activityId);
  });
  overlay.querySelector('#_ae-dissociate')?.addEventListener('click', async () => {
    close();
    await dissociateFromStageRace(act, _race, iso);
  });

  overlay.querySelectorAll('.ae-metric-btn').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('active');
    const on = b.classList.contains('active');
    if (b.dataset.m === 'power') exclPower = on;
    if (b.dataset.m === 'hr') exclHr = on;
    if (b.dataset.m === 'dist') exclDist = on;
  }));
  overlay.querySelectorAll('#_ae-prio .note-type-chip').forEach(chip => chip.addEventListener('click', () => {
    overlay.querySelectorAll('#_ae-prio .note-type-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    _aePrio = chip.dataset.prio;
  }));

  const close = () => overlay.remove();
  overlay.querySelector('.day-modal-close').addEventListener('click', close);
  overlay.querySelector('.day-modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('.day-modal-save').addEventListener('click', () => {
    const newOv = {};
    const nameV = document.getElementById('_ae-name').value.trim();
    const typeV = document.getElementById('_ae-type').value.trim();
    const sportV = document.getElementById('_ae-sport').value.trim();
    const durV = parseInt(document.getElementById('_ae-dur').value, 10);
    const distV = parseFloat(document.getElementById('_ae-dist').value);
    const tssV = parseInt(document.getElementById('_ae-tss').value, 10);
    const notesV = document.getElementById('_ae-notes').value.trim();
    const rpeV = parseFloat(document.getElementById('_ae-rpe').value);
    const dplusV = parseInt(document.getElementById('_ae-dplus').value, 10);
    const lapsV = parseInt(document.getElementById('_ae-laps').value, 10);
    if (nameV) newOv.name = nameV;
    if (typeV) newOv.type = typeV;
    if (sportV) newOv.sport = sportV;
    if (!isNaN(durV)) newOv.duration = durV;
    if (!isNaN(distV)) newOv.distance_km = distV;
    if (!isNaN(tssV)) newOv.tss = tssV;
    if (!isNaN(rpeV)) newOv.rpe = rpeV;
    if (!isNaN(dplusV)) newOv.elevation_gain = dplusV;
    if (!isNaN(lapsV)) newOv.laps = lapsV;
    if (notesV) newOv.notes = notesV;
    if (exclPower) newOv.excludePower = true;
    if (exclHr) newOv.excludeHr = true;
    if (exclDist) newOv.excludeDistance = true;
    setActivityEdit(activityId, newOv);
    // Priorité de la compétition (course à étapes → la course ; sinon la compét d'un jour)
    if (act.category === 'competition' && window.sb && _aePrio !== _curPrioKey) {
      // Modele unifie : la priorite est sur la ligne activities (la compet EST l'activite).
      window.sb.from('activities').update({ priority: _aePrio }).eq('id', act._sbId).then(() => {
        if (window.cloudSync && window.cloudSync.pullAllFromCloud) window.cloudSync.pullAllFromCloud().then(() => {
          if (typeof renderCalendar === 'function') renderCalendar();
          if (typeof renderCompList === 'function') renderCompList();
        });
      });
    }
    close();
  });
  overlay.querySelector('#_ae-reset').addEventListener('click', async () => {
    const ok = await appConfirm({ title: 'Réinitialiser', html: "Annuler toutes les modifications de cette activité et revenir aux données Strava ?", confirmLabel: 'Réinitialiser', danger: true });
    if (ok) { setActivityEdit(activityId, null); close(); }
  });
  overlay.querySelector('#_ae-transform').addEventListener('click', async () => {
    const target = (act.category === 'competition') ? 'entrainement' : 'competition';
    close();
    await setActivityCategory(act, target, iso);
  });
}

// Bascule la catégorie d'une activité (entrainement ↔ competition) directement
// en base, sans formulaire. Re-pull + re-render pour refléter le changement.
async function setActivityCategory(act, category, iso) {
  if (!act || !act._sbId || !window.sb) return;
  try {
    const { error } = await window.sb.from('activities').update({ category }).eq('id', act._sbId);
    if (error) throw error;
    act.category = category;
    // Refléter dans DASHBOARD_DATA (source des reconstructions) sinon l'affichage
    // repasse en compétition au prochain rebuild.
    if (window.DASHBOARD_DATA && window.DASHBOARD_DATA.days) {
      for (const d of window.DASHBOARD_DATA.days) {
        for (const a of (d.activities || [])) {
          if (String(a._sbId) === String(act._sbId)) a.category = category;
        }
      }
    }
// Modele unifie : changer category sur l'activite SUFFIT (la compet EST l'activite).
    // Rien d'autre a faire (plus de registre competitions separe -> plus de doublon).
        if (window.cloudSync && window.cloudSync.pullAllFromCloud) await window.cloudSync.pullAllFromCloud();
    if (window.__applyOverridesAndRerender) window.__applyOverridesAndRerender(); // rebuild data depuis DASHBOARD_DATA mis à jour
    if (typeof renderCompList === 'function') renderCompList();
  } catch (e) {
    console.warn('[setActivityCategory]', e.message || e);
  }
}

// Sélecteur d'étapes dans le détail réalisé : si l'activité du jour appartient à
// une course à étapes (competitions.activity_ids > 1), affiche « Étape 1 / 2 … »
// pour naviguer entre les activités-étapes (ordre chronologique).
function _injectRealisedStageTabs(iso, acts) {
  const comps = (typeof loadCompetitions === 'function') ? loadCompetitions() : [];
  const sbIds = (acts || []).map(a => String(a._sbId)).filter(Boolean);
  const race = comps.find(c => Array.isArray(c.activityIds) && c.activityIds.length > 1
    && c.activityIds.map(String).some(id => sbIds.includes(id)));
  if (!race) return;
  const stages = race.activityIds.map(id => _findActBySbId(id)).filter(Boolean)
    .sort((a, b) => (a.iso < b.iso ? -1 : 1));
  if (stages.length < 2) return;
  const curIdx = stages.findIndex(s => s.iso === iso);
  // Le titre garde le vrai nom de l'activité (posé par renderModalActivity).
  // Switcher d'étapes EN HAUT DU CORPS, style identique au prévu (.modal-activity-switch),
  // précédé à gauche par le nom de la course à étapes.
  const body = document.getElementById('modal-body');
  if (!body) return;
  body.querySelector('.rst-switch')?.remove();
  const raceName = window._confirmEscape ? window._confirmEscape(race.name) : race.name;
  const sw = document.createElement('div');
  sw.className = 'rst-switch';
  // Le nom de la course est HORS du carré gris ; seules les pastilles sont dans le carré.
  sw.innerHTML = `<span class="rst-race-label">${raceName}</span>`
    + `<div class="modal-activity-switch">`
    + stages.map((s, i) => `<button type="button" class="${i === curIdx ? 'active' : ''}" data-stageiso="${s.iso}">Étape ${i + 1}</button>`).join('')
    + `</div>`;
  body.prepend(sw);
  sw.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const di = b.dataset.stageiso;
    if (di && di !== iso) openSessionModal(di, 'realise');
  }));
}

// Cherche une activité (chargée) par son id Supabase → { act, iso }.
function _findActBySbId(sbId) {
  for (const d of data) {
    if (!d.activities) continue;
    for (const a of d.activities) {
      if (String(a._sbId) === String(sbId)) return { act: a, iso: toIsoDate(d.date) };
    }
  }
  return null;
}

// Retire une activité d'une course à étapes : elle redevient une compét d'un jour.
async function dissociateFromStageRace(act, race, iso) {
  if (!act || !act._sbId || !race || !window.sb) return;
  try {
    const remaining = (race.activityIds || []).map(String).filter(id => id !== String(act._sbId));
    if (remaining.length >= 2) {
      // La course garde les autres étapes
      await window.sb.from('competitions').update({ activity_ids: remaining }).eq('id', race._sbId);
    } else {
      // Plus assez d'étapes → on supprime la course ; l'étape restante redevient compét d'un jour
      await window.sb.from('competitions').delete().eq('id', race._sbId);
      if (remaining.length === 1) {
        const found = _findActBySbId(remaining[0]);
        if (found && window.cloudSync.pushCompetitionRegistry) {
          await window.cloudSync.pushCompetitionRegistry({
            id: 'act-' + remaining[0], name: found.act.name || 'Compétition',
            date: found.iso, sport: found.act.sport || null, activityIds: [remaining[0]],
          });
        }
      }
    }
    // Cette activité redevient une compét d'un jour autonome
    if (window.cloudSync.pushCompetitionRegistry) {
      await window.cloudSync.pushCompetitionRegistry({
        id: 'act-' + act._sbId, name: act.name || 'Compétition',
        date: iso, sport: act.sport || null, activityIds: [act._sbId],
      });
    }
    if (window.cloudSync.pullAllFromCloud) await window.cloudSync.pullAllFromCloud();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof renderCompList === 'function') renderCompList();
  } catch (e) { console.warn('[dissociate]', e.message || e); }
}

// Constructeur de course à étapes : choisis les activités qui sont les étapes,
// nomme la course → elles deviennent des compétitions partageant la même "épreuve".
// L'ordre des étapes est chronologique (étape 1 = la plus ancienne).
function openStageRaceBuilder(currentActivityId) {
  // Rassemble toutes les activités (réalisées) avec leur date
  const allActs = [];
  for (const d of data) {
    if (!d.activities) continue;
    const iso = toIsoDate(d.date);
    for (const a of d.activities) {
      if (!a._sbId) continue; // seulement les lignes en base
      allActs.push({ sbId: a._sbId, iso, name: a.name || 'Séance', sport: a.sport || '', category: a.category, event: a.event || null });
    }
  }
  allActs.sort((x, y) => (x.iso < y.iso ? 1 : x.iso > y.iso ? -1 : 0)); // récent en haut

  const current = allActs.find(a => a.sbId === currentActivityId);
  const presetEvent = current && current.event ? current.event : '';
  const preChecked = new Set();
  if (current) preChecked.add(current.sbId);
  if (presetEvent) allActs.filter(a => a.event === presetEvent).forEach(a => preChecked.add(a.sbId));

  document.getElementById('_act-edit-modal')?.remove();
  document.getElementById('_stagerace-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.id = '_stagerace-modal';
  const fmtD = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const rows = allActs.map(a => `
    <label class="sr-row">
      <input type="checkbox" data-sbid="${a.sbId}" ${preChecked.has(a.sbId) ? 'checked' : ''}>
      <span class="sr-date">${fmtD(a.iso)}</span>
      <span class="sr-name">${window._confirmEscape ? window._confirmEscape(a.name) : a.name}</span>
      ${a.category === 'competition' ? '<span class="sr-tag">compét</span>' : ''}
    </label>`).join('');

  overlay.innerHTML = `
    <div class="day-modal day-modal-note">
      <div class="day-modal-header">
        <h3>Course à étapes</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        <label class="note-field-label">Nom de la course</label>
        <input type="text" id="_sr-name" placeholder="Ex : Tour de la Région">
        <label class="note-field-label">Priorité</label>
        <div class="note-type-chips" id="_sr-prio">
          <button type="button" class="note-type-chip active" data-prio="principal">Objectif</button>
          <button type="button" class="note-type-chip" data-prio="secondaire">Préparation</button>
        </div>
        <label class="note-field-label">Étapes (coche les activités)</label>
        <div class="ae-field-hint">Les activités cochées deviennent des compétitions de cette course. L'ordre des étapes suit la date (étape 1 = la plus ancienne).</div>
        <div class="sr-list">${rows || '<div class="modal-placeholder">Aucune activité.</div>'}</div>
        <label class="note-field-label">Aperçu des étapes</label>
        <div class="sr-preview" id="_sr-preview"></div>
      </div>
      <div class="day-modal-footer">
        <div style="flex:1;"></div>
        <button class="day-modal-cancel" type="button">Annuler</button>
        <button class="day-modal-save" type="button">Valider</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('_sr-name').value = presetEvent;

  let srPrio = 'principal';
  overlay.querySelectorAll('#_sr-prio .note-type-chip').forEach(chip => chip.addEventListener('click', () => {
    overlay.querySelectorAll('#_sr-prio .note-type-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    srPrio = chip.dataset.prio;
  }));

  const close = () => overlay.remove();
  const refreshPreview = () => {
    const checked = [...overlay.querySelectorAll('.sr-list input:checked')]
      .map(c => allActs.find(a => a.sbId === c.dataset.sbid))
      .filter(Boolean)
      .sort((x, y) => (x.iso < y.iso ? -1 : 1)); // chronologique
    const prev = document.getElementById('_sr-preview');
    prev.innerHTML = checked.length
      ? checked.map((a, i) => `<div class="sr-stage"><strong>Étape ${i + 1}</strong> · ${fmtD(a.iso)} — ${window._confirmEscape ? window._confirmEscape(a.name) : a.name}</div>`).join('')
      : '<div class="modal-placeholder">Coche au moins 2 activités.</div>';
  };
  overlay.querySelectorAll('.sr-list input').forEach(c => c.addEventListener('change', refreshPreview));
  refreshPreview();

  overlay.querySelector('.day-modal-close').addEventListener('click', close);
  overlay.querySelector('.day-modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('.day-modal-save').addEventListener('click', async () => {
    const name = document.getElementById('_sr-name').value.trim();
    if (!name) { if (window.appAlert) await window.appAlert({ title: 'Nom requis', message: 'Donne un nom à la course.' }); return; }
    const selected = [...overlay.querySelectorAll('.sr-list input:checked')].map(c => c.dataset.sbid);
    if (selected.length < 1 || !window.sb) { close(); return; }
    try {
      // Étapes sélectionnées (ordre chronologique) → activités en catégorie compétition
      const selActs = allActs.filter(a => selected.includes(a.sbId)).sort((x, y) => (x.iso < y.iso ? -1 : 1));
      await Promise.all(selActs.map(a => window.sb.from('activities').update({ category: 'competition' }).eq('id', a.sbId)));
      // Supprime les compét "1 jour" (act-…) des activités qui deviennent des étapes
      await Promise.all(selActs.map(a => window.sb.from('competitions').delete().eq('client_id', 'act-' + a.sbId)));
      // UNE ligne dans le registre competitions reliant ces activités
      if (window.cloudSync && window.cloudSync.pushCompetitionRegistry) {
        await window.cloudSync.pushCompetitionRegistry({
          id: 'race-' + selActs[0].sbId,
          name,
          date: selActs[0].iso,                 // date = 1ʳᵉ étape
          sport: selActs[0].sport || null,
          priority: srPrio,
          activityIds: selActs.map(a => a.sbId),
        });
      }
      // Refléter category=competition dans DASHBOARD_DATA (source des rebuilds)
      const selSet = new Set(selActs.map(a => String(a.sbId)));
      if (window.DASHBOARD_DATA && window.DASHBOARD_DATA.days) {
        for (const d of window.DASHBOARD_DATA.days) {
          for (const a of (d.activities || [])) if (selSet.has(String(a._sbId))) a.category = 'competition';
        }
      }
      if (window.cloudSync && window.cloudSync.pullAllFromCloud) await window.cloudSync.pullAllFromCloud();
      if (window.__applyOverridesAndRerender) window.__applyOverridesAndRerender();
      if (typeof renderCompList === 'function') renderCompList();
    } catch (e) { console.warn('[stage race]', e.message || e); }
    close();
  });
}

// Construit le jour REALISE fusionne (data Strava + masquage + seances manuelles +
// competitions realisees), identique a ce qu'affiche le calendrier realise. Permet au
// clic sur un jour d'ouvrir exactement les memes activites que la carte.
function buildRealisedDay(iso) {
  let realDay = (Array.isArray(data) ? data.find(d => toIsoDate(d.date) === iso) : null) || null;
  if (realDay && realDay.activities && typeof isStravaIgnored === 'function') {
    const filtered = realDay.activities.filter(a => {
      if (a._manual) return true;
      const aid = a.id || a.activityId;
      return !aid || !isStravaIgnored(aid);
    });
    if (filtered.length !== realDay.activities.length) realDay = filtered.length ? { ...realDay, activities: filtered } : null;
  }
  const manualRealised = (typeof loadRealisedTrainings === 'function') ? loadRealisedTrainings().filter(t => t.date === iso) : [];
  if (manualRealised.length > 0) {
    if (!realDay) realDay = { date: iso, activities: [], sessionType: 'autre' };
    else realDay = { ...realDay, activities: [...(realDay.activities || [])] };
    for (const m of manualRealised) {
      const _dbTwin = realDay.activities.some(x => (
        (m._sbId && String(x._sbId) === String(m._sbId)) ||
        (m.id && String(x.client_id) === String(m.id))
      ));
      if (_dbTwin) continue;
      const sportVal = m.sport || 'autre';
      realDay.activities.push({
        name: m.name, sport: sportVal, raw_type: sportVal,
        type: m.type || 'endurance', sessionType: m.type || 'endurance', sessionName: m.name,
        duration: m.duration || 0, tss: m.tss || 0,
        distance_km: m.km || null, elevation_gain: m.dplus || null,
        rpe: (m.rpe != null ? m.rpe : null), laps: (m.laps != null ? m.laps : null),
        gpxName: m.gpxName || null, gpxContent: m.gpxContent || null, structure: m.structure || null,
        _manual: true, _manualId: m.id, notes: m.notes || '',
      });
    }
  }
  const realisedComps = (typeof loadCompetitionsExpanded === 'function') ? loadCompetitionsExpanded().filter(compIsRealised) : [];
  const compsToday = realisedComps.filter(c => c.date === iso);
  if (compsToday.length > 0) {
    if (!realDay) realDay = { date: iso, activities: [], sessionType: 'vo2' };
    else realDay = { ...realDay, activities: [...(realDay.activities || [])] };
    for (const c of compsToday) {
      // Une vraie activité 'competition' existe déjà ce jour : le registre n'est
      // qu'un miroir -> ne JAMAIS ajouter de pseudo-entrée (durée 0) en plus.
      if (realDay.activities.some(x => x.category === 'competition' && !x._comp)) continue;
      // Compétition TRIATHLON dont l'enchaînement réalisé couvre le jour :
      // les 3 activités SONT la compétition -> pas de pseudo-entrée non plus.
      if (typeof getSportCategory === 'function' && getSportCategory(c.sport) === 'triathlon'
          && window.SportProfiles && window.SportProfiles.detectMultisport) {
        const _gg = window.SportProfiles.detectMultisport(realDay.activities.filter(x => !x._comp));
        if (_gg && _gg.legs.length >= 2) continue;
      }
      if (realDay.activities.some(x =>
        (x._sbId && ((c._sbId && String(x._sbId) === String(c._sbId)) || (c.id && String(x.client_id) === String(c.id)))) ||
        (x.name && c.name && String(x.name).trim() === String(c.name).trim())
      )) continue;
      const cDur = (typeof parseTimeToMin === 'function' ? parseTimeToMin(c.target) : 0) || 0;
      realDay.activities.push({
        name: c.name, sport: c.sport || 'Ride', raw_type: c.sport || 'Ride',
        type: 'vo2', sessionType: 'vo2', sessionName: c.name,
        duration: cDur, tss: cDur ? Math.round(cDur) : 0,
        distance_km: c.km || null, elevation_gain: c.dplus || null, laps: c.laps || null,
        category: 'competition', priority: c.priority || null,
        _comp: true, _compId: c.id, notes: c.notes || '',
      });
    }
  }
  return realDay;
}
// ============================================================
// Comparaison PRÉVU vs RÉALISÉ (affichée dans la modale du réalisé).
// Rapproche une activité réalisée avec une séance prévue : même jour, même sport,
// et (si plusieurs réalisées le même jour) durée la plus proche (appariement greedy).
// ============================================================
// Rapprochement PREVU<->REALISE : renvoie {planned:[prevus du jour], matched:prevu|null}
// et persiste le lien auto la 1re fois (meme jour + sport + duree la plus proche, greedy).
window.__plannedMatch = function (act, iso) {
  var empty = { planned: [], matched: null };
  try {
    if (!act || act.category === 'competition') return empty;
    var planned = ((typeof loadTrainings === 'function') ? loadTrainings() : [])
      .filter(function (t) { return !window.coachModeKeep || window.coachModeKeep(t.ia); })
      .filter(function (t) { return t.date === iso; });
    var catOf = function (x) { return (typeof getSportCategory === 'function') ? getSportCategory(x) : x; };
    var actCat = catOf(act.raw_type || act.sport);
    var link = act.planned_id;
    var matched = null;
    if (link && link !== 'none') {
      matched = planned.find(function (p) { return String(p._sbId) === String(link); });
      if (!matched) link = null;
    }
    if (!matched && link !== 'none') {
      var cands = planned.filter(function (p) { return catOf(p.sport) === actCat; });
      if (cands.length) {
        var dayObj = (typeof buildRealisedDay === 'function') ? buildRealisedDay(iso) : null;
        var reals = ((dayObj && dayObj.activities) ? dayObj.activities : [act]).filter(function (x) { return catOf(x.raw_type || x.sport) === actCat; });
        var keyOf = function (x) { return String(x._sbId || x.client_id || x._manualId || x.id || (x.name + '|' + (x.duration || 0))); };
        var actKey = keyOf(act);
        var combos = [];
        cands.forEach(function (p, pi) { reals.forEach(function (r, ri) { combos.push({ pi: pi, ri: ri, diff: Math.abs((+p.duration || 0) - (+r.duration || 0)) }); }); });
        combos.sort(function (x, y) { return x.diff - y.diff; });
        var usedP = {}, usedR = {};
        combos.forEach(function (c) {
          if (usedP[c.pi] || usedR[c.ri]) return;
          usedP[c.pi] = 1; usedR[c.ri] = 1;
          if (keyOf(reals[c.ri]) === actKey) matched = cands[c.pi];
        });
        if (matched && matched._sbId && act._sbId) {
          act.planned_id = String(matched._sbId);
          if (typeof window.__setActPlannedLink === 'function') window.__setActPlannedLink(act._sbId, String(matched._sbId));
          if (window.cloudSync && window.cloudSync.linkActivityPlanned) window.cloudSync.linkActivityPlanned(act._sbId, String(matched._sbId));
        }
      }
    }
    return { planned: planned, matched: matched };
  } catch (e) { console.warn('[planned match]', e && e.message); return empty; }
};

// Section comparaison (corps de la modale) : uniquement si une seance prevue est rapprochee.
window.renderPrevuVsRealiseHTML = function (act, iso) {
  try {
    var mm = window.__plannedMatch(act, iso);
    var p = mm.matched;
    if (!p) return '';
    var fmtD = function (min) { return (typeof fmtDur === 'function') ? fmtDur(+min || 0) : (Math.round(+min || 0) + ' min'); };
    // Une barre par metrique : remplissage = realise, repere = cible prevue.
    // Couleur : au-dessus de la cible = vert, en dessous = orange, sans cible = neutre.
    function barRow(label, pv, rv, fmt) {
      var hasP = (pv != null && pv !== ''), hasR = (rv != null && rv !== '');
      if (!hasP && !hasR) return '';
      var pvn = +pv || 0, rvn = +rv || 0, d = rvn - pvn;
      var col = !hasP ? '#9aa6b6' : (d > 0 ? '#5fb87a' : (d < 0 ? '#d08442' : '#9aa6b6'));
      var scale = Math.max(pvn, rvn, 1);
      var fillPct = Math.max(3, Math.min(100, rvn / scale * 100));
      var targetPct = hasP ? Math.max(0, Math.min(100, pvn / scale * 100)) : null;
      var right = '<span style="color:var(--text,#e7ecf3);font-weight:600">' + (hasR ? fmt(rvn) : '—');
      if (hasP) right += ' <span style="color:var(--text-mute,#6b7686);font-weight:400">/ ' + fmt(pvn) + ' prévu</span>';
      if (hasP && hasR && d !== 0) right += ' <span style="color:' + col + '">' + (d > 0 ? '+' : '−') + fmt(Math.abs(d)) + '</span>';
      right += '</span>';
      return '<div style="margin-top:13px">'
        + '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px"><span style="color:var(--text-dim,#9aa6b6)">' + label + '</span>' + right + '</div>'
        + '<div style="position:relative;height:7px;background:var(--bg-elev,#222b3d);border-radius:4px">'
        + '<div style="width:' + fillPct + '%;height:100%;background:' + col + ';border-radius:4px"></div>'
        + (targetPct != null ? '<div style="position:absolute;left:' + targetPct + '%;top:-2px;width:2px;height:11px;background:#cdd5e5"></div>' : '')
        + '</div></div>';
    }
    var _pKj = (p.structure && p.structure.length && window.__estKjFromStructure) ? window.__estKjFromStructure(p.structure) : null;
    var bars = ''
      + barRow('Durée', p.duration, act.duration, function (x) { return fmtD(x); })
      + barRow('Distance', p.km, act.distance_km, function (x) { return Math.round(x) + ' km'; })
      + barRow('Énergie', (_pKj != null ? Math.round(_pKj) : null), act.kj, function (x) { return Math.round(x) + ' kJ'; })
      + barRow('TSS', p.tss, act.tss, function (x) { return '' + Math.round(x); });
    if (!bars) return '';
    var structHTML = '';
    if (Array.isArray(p.structure) && p.structure.length && window.renderWorkoutProfileHTML) {
      structHTML = '<div style="margin-top:16px">'
        + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-mute,#6b7686);margin-bottom:7px">Structure prévue (objectif)</div>'
        + window.renderWorkoutProfileHTML(p.structure, { height: 56, labels: false })
        // Adhérence par intervalle : rempli par fillAdherenceSlot() quand les streams arrivent
        + '<div id="pvr-adherence" data-structure="' + encodeURIComponent(JSON.stringify(p.structure)) + '"></div>'
        + '</div>';
      // Streams déjà en mémoire (réouverture de la même activité) : remplit direct
      setTimeout(function () { if (window.fillAdherenceSlot) window.fillAdherenceSlot(); }, 100);
    }
    return window.__collapsible('pvr', 'Prévu vs Réalisé', bars + structHTML);
  } catch (e) { console.warn('[prevu vs realise]', e && e.message); return ''; }
};


// Bouton/selecteur de lien dans le HEADER de la modale (a cote des "...").
window.__setupModalLinkSelect = function (act, iso) {
  var wrap = document.getElementById('modal-link-wrap');
  var menu = document.getElementById('modal-link-menu');
  var btn = document.getElementById('modal-link-btn');
  if (!wrap || !menu) return;
  if (!act || act.category === 'competition' || !act._sbId) { wrap.hidden = true; return; }
  var mm = window.__plannedMatch(act, iso);
  if (!mm.planned.length) { wrap.hidden = true; return; }
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var opt = function (val, label, sel) { return '<button class="pvr-opt' + (sel ? ' sel' : '') + '" type="button" data-val="' + esc(val) + '">' + label + '<span class="pvr-check">✓</span></button>'; };
  var html = opt('none', 'Aucune', !mm.matched);
  if (mm.planned.length) html += '<div class="pvr-sep"></div>';
  html += mm.planned.map(function (pp) {
    var lab = (pp.name || 'Séance') + ' · ' + ((typeof fmtDur === 'function') ? fmtDur(+pp.duration || 0) : ((+pp.duration || 0) + ' min'));
    var seld = (mm.matched && String(mm.matched._sbId) === String(pp._sbId));
    return opt(pp._sbId, esc(lab), seld);
  }).join('');
  menu.innerHTML = html;
  menu.dataset.sbid = act._sbId;
  menu.hidden = true;
  wrap.classList.remove('open');
  wrap.hidden = false;
  if (btn) btn.style.color = '';
  wrap.title = mm.matched ? ('Séance prévue liée : ' + (mm.matched.name || '')) : 'Aucune séance prévue liée';
};

// Reflete le lien prevu<->realise dans DASHBOARD_DATA (memoire) pour persistance en session.
window.__setActPlannedLink = function (sbId, val) {
  if (!Array.isArray(data) || !sbId) return;
  for (var di = 0; di < data.length; di++) {
    var acts = data[di].activities || [];
    for (var ai = 0; ai < acts.length; ai++) {
      if (String(acts[ai]._sbId) === String(sbId)) acts[ai].planned_id = val;
    }
  }
};

// Menu custom du lien Prevu<->Realise : ouvrir / choisir / fermer
document.addEventListener('click', function (e) {
  var trg = e.target;
  var menu = document.getElementById('modal-link-menu');
  var wrap = document.getElementById('modal-link-wrap');
  var hitBtn = trg.closest ? trg.closest('#modal-link-btn') : null;
  if (hitBtn && menu) {
    e.preventDefault(); e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (wrap) wrap.classList.toggle('open', !menu.hidden);
    return;
  }
  var opt = trg.closest ? trg.closest('.pvr-opt') : null;
  if (opt && menu) {
    e.preventDefault(); e.stopPropagation();
    var sbid = menu.dataset.sbid, val = opt.dataset.val;
    menu.hidden = true; if (wrap) wrap.classList.remove('open');
    if (sbid) {
      if (typeof window.__setActPlannedLink === 'function') window.__setActPlannedLink(sbid, val);
      if (window.cloudSync && window.cloudSync.linkActivityPlanned) window.cloudSync.linkActivityPlanned(sbid, val);
      if (typeof window.__modalActIdx === 'number') window.__openActIdx = window.__modalActIdx;
      if (window.__currentModalIso && typeof openSessionModal === 'function') openSessionModal(window.__currentModalIso, window.__currentModalSource || 'realise');
    }
    return;
  }
  if (menu && !menu.hidden && !(trg.closest && trg.closest('#modal-link-wrap'))) {
    menu.hidden = true; if (wrap) wrap.classList.remove('open');
  }
});

// SVGs + bloc stats reutilisable (heros + tuiles centrees, max 2 rangees).
window.__statSvg = {
  clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  route: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/></svg>',
  mtn: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20 9 8l3.5 6 2.5-4.5L21 20Z"/></svg>',
  bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  speed: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="2"/><path d="M13.4 12.6 19 7"/><path d="M3.6 19a9 9 0 1 1 16.8 0"/></svg>'
};
// Section repliable reutilisable (bouton Masquer/Afficher a droite, etat memorise par cle).
window.__collapsible = function (key, titleInner, contentHTML) {
  var collapsed = false;
  try { collapsed = localStorage.getItem(key + '_collapsed') === '1'; } catch (e) { }
  var chev = collapsed ? '▸' : '▾';
  return '<div class="modal-section">'
    + '<div class="modal-section-title" style="display:flex;align-items:center;gap:10px">'
    +   '<span>' + titleInner + '</span>'
    +   '<button class="coll-toggle" type="button" data-key="' + key + '" style="background:var(--bg-elev2);border:1px solid var(--border2,#374256);color:var(--text-dim,#9aa6b6);border-radius:7px;padding:4px 11px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;text-transform:none;letter-spacing:0;display:inline-flex;align-items:center;gap:6px;flex:none">'
    +     '<span class="coll-label">' + (collapsed ? 'Afficher' : 'Masquer') + '</span><span class="coll-chev" style="display:inline-block;width:9px;text-align:center">' + chev + '</span>'
    +   '</button>'
    + '</div>'
    + '<div class="coll-content"' + (collapsed ? ' hidden' : '') + '>' + contentHTML + '</div>'
    + '</div>';
};
document.addEventListener('click', function (e) {
  var t = e.target.closest ? e.target.closest('.coll-toggle') : null;
  if (!t) return;
  var sec = t.closest('.modal-section');
  var content = sec ? sec.querySelector('.coll-content') : null;
  if (!content) return;
  var nowHidden = !content.hidden;
  content.hidden = nowHidden;
  var chev = t.querySelector('.coll-chev'); if (chev) chev.textContent = nowHidden ? '▸' : '▾';
  var lab = t.querySelector('.coll-label'); if (lab) lab.textContent = nowHidden ? 'Afficher' : 'Masquer';
  try { localStorage.setItem((t.dataset.key || 'coll') + '_collapsed', nowHidden ? '1' : '0'); } catch (e2) { }
});

// Estime l'energie (kJ) d'une structure planifiee : Σ (watts cibles x duree).
window.__estKjFromStructure = function (blks, ftp) {
  if (!Array.isArray(blks) || !blks.length) return null;
  ftp = +ftp || ((window.DASHBOARD_DATA && window.DASHBOARD_DATA.athlete && +window.DASHBOARD_DATA.athlete.ftp) || 250);
  var total = 0;
  blks.forEach(function (b) {
    var reps = Math.max(1, b.reps | 0);
    var segs = [b.work]; if (b.type === 'interval' && b.rec) segs.push(b.rec);
    for (var r = 0; r < reps; r++) segs.forEach(function (s) { if (!s) return; var mid = (s.intHi != null && +s.intHi > 0) ? ((+s.int + +s.intHi) / 2) : (+s.int || 0); total += (ftp * mid / 100) * ((+s.min || 0) * 60); });
  });
  return total / 1000;
};

window.renderStatsBlockHTML = function (heroes, tiles) {
  var mut = 'var(--text-mute,#7c879c)';
  var heroCard = function (hh) {
    return '<div style="flex:1;min-width:0;background:var(--bg-elev2,#1b2230);border-radius:11px;padding:13px;display:flex;align-items:center;justify-content:center;gap:11px;">'
      + (hh.svg ? '<span style="color:' + hh.color + ';flex:none;line-height:0">' + hh.svg + '</span>' : '')
      + '<div style="min-width:0"><div style="font-size:22px;font-weight:700;color:var(--text,#fff);line-height:1;white-space:nowrap">' + hh.val + (hh.unit ? '<span style="font-size:12px;color:' + mut + '"> ' + hh.unit + '</span>' : '') + '</div>'
      + '<div style="font-size:10px;color:' + mut + ';text-transform:uppercase;letter-spacing:.4px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + hh.lab + '</div></div></div>';
  };
  var tileHTML = function (tt, basis) {
    return '<div style="flex:0 1 ' + basis + ';background:' + tt.color + '17;border-radius:9px;padding:10px 12px;text-align:center;min-width:0;">'
      + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:' + tt.color + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + tt.lab + '</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--text,#e7ebf3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + tt.val + '</div></div>';
  };
  heroes = (heroes || []).filter(Boolean); tiles = (tiles || []).filter(Boolean);
  var heroRow = heroes.length ? '<div style="display:flex;gap:11px;margin-bottom:11px;flex-wrap:wrap">' + heroes.slice(0, 4).map(heroCard).join('') + '</div>' : '';
  var n = tiles.length, cols = n <= 4 ? Math.max(1, n) : Math.ceil(n / 2);
  var basis = 'calc((100% - ' + ((cols - 1) * 8) + 'px) / ' + cols + ')';
  var grid = n ? '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px">' + tiles.map(function (t) { return tileHTML(t, basis); }).join('') + '</div>' : '';
  return (heroRow || grid) ? '<div class="modal-section">' + heroRow + grid + '</div>' : '';
};

function openSessionModal(iso, source) {
  window.__currentModalIso = iso; window.__currentModalSource = source;
  { const _lw = document.getElementById('modal-link-wrap'); if (_lw) _lw.hidden = true; }
  // Reconstruire la date depuis l'iso (les jours futurs ne sont PAS dans data)
  const date = new Date(iso + 'T12:00:00');
  if (isNaN(date.getTime())) return;
  // Mobile : date compacte pour que l'heure + le sport tiennent sur la même ligne
  const dateStr = (window.innerWidth < 860)
    ? date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Lookup data uniquement pour le mode Réalisé (les jours futurs ne sont pas dedans).
  // En réalisé, on reconstruit le jour fusionné (manuelles + compétitions) comme la carte.
  const day = (source === 'realise')
    ? buildRealisedDay(iso)
    : (Array.isArray(data) ? data.find(d => toIsoDate(d.date) === iso) : null);

  const titleEl = document.getElementById('modal-title');
  const metaEl = document.getElementById('modal-meta');
  const bodyEl = document.getElementById('modal-body');

  // Cache les boutons d'action par défaut (seront ré-affichés au besoin)
  const _editBtn = document.getElementById('modal-edit-btn');
  const _delBtn = document.getElementById('modal-delete-btn');
  if (_editBtn) {
    _editBtn.hidden = true;
    // Reset des datasets (évite de garder l'état du précédent appel)
    delete _editBtn.dataset.compId;
    delete _editBtn.dataset.trainingId;
    delete _editBtn.dataset.trainingMode;
    delete _editBtn.dataset.templateIso;
    delete _editBtn.dataset.kind;
  }
  if (_delBtn) {
    _delBtn.hidden = true;
    delete _delBtn.dataset.compId;
    delete _delBtn.dataset.trainingId;
    delete _delBtn.dataset.trainingMode;
    delete _delBtn.dataset.activityId;
    delete _delBtn.dataset.sbId;
    delete _delBtn.dataset.kind;
  }

  if (source === 'realise') {
    if (!day) {
      titleEl.innerHTML = 'Aucune donnée';
      metaEl.textContent = dateStr;
      bodyEl.innerHTML = '<div class="modal-placeholder">Pas de données pour ce jour.</div>';
      document.getElementById('session-modal').classList.add('active');
      return;
    }
    // Activités RÉELLES de ce jour
    const acts = day.activities && day.activities.length ? day.activities : (day.sessionType ? [day] : []);
    if (acts.length === 0) {
      titleEl.innerHTML = 'Pas de séance';
      metaEl.textContent = dateStr;
      bodyEl.innerHTML = '<div class="modal-placeholder">Aucune activité enregistrée ce jour-là.</div>';
    } else {
      let currentIdx = 0;
      // Groupe multisport (triathlon, brick...) : détecté une fois pour le jour
      const _msGroup = (acts.length > 1 && window.SportProfiles && window.SportProfiles.detectMultisport)
        ? window.SportProfiles.detectMultisport(acts) : null;
      function renderModalActivity(idx) {
        currentIdx = idx;
        window.__modalActIdx = idx;
        const act = acts[idx];
        // Boutons d'action : seulement pour les activités manuelles (Strava est read-only)
        const _editBtn2 = document.getElementById('modal-edit-btn');
        const _delBtn2 = document.getElementById('modal-delete-btn');
        if (act.category === 'competition') {
          // Competition = activite avec category='competition' : edition via la modale competition.
          const _compId = String(act.client_id || act._sbId || act.id || '');
          if (_editBtn2) {
            _editBtn2.hidden = false;
            _editBtn2.dataset.kind = 'comp';
            _editBtn2.dataset.compId = _compId;
          }
          if (_delBtn2) {
            _delBtn2.hidden = false;
            _delBtn2.dataset.kind = 'comp';
            _delBtn2.dataset.compId = _compId;
          }
        } else if (act._manual) {
          const _lsId = act._manualId || act.client_id || act.id;
          // Entrainement manuel : TOUJOURS la modale complete (tous les champs + structure).
          // Si pas de copie locale, gpxEditTraining reconstruit la seance depuis la base.
          if (_editBtn2) {
            _editBtn2.hidden = false;
            _editBtn2.dataset.kind = 'training';
            _editBtn2.dataset.trainingId = _lsId;
            _editBtn2.dataset.trainingMode = 'realise';
          }
          if (_delBtn2) {
            _delBtn2.hidden = false;
            _delBtn2.dataset.kind = 'training';
            _delBtn2.dataset.trainingId = _lsId;
            _delBtn2.dataset.trainingMode = 'realise';
            _delBtn2.dataset.sbId = act._sbId || '';
          }
        } else {
          // Activité Strava : éditable via calque d'overrides (le crayon ouvre l'éditeur).
          // La poubelle masque l'activité.
          if (_editBtn2) {
            _editBtn2.hidden = false;
            _editBtn2.dataset.kind = 'strava-edit';
            _editBtn2.dataset.activityId = String(act.id || act.activityId || '');
            _editBtn2.dataset.iso = iso;
          }
          if (_delBtn2) {
            _delBtn2.hidden = false;
            _delBtn2.dataset.kind = 'strava';
            _delBtn2.dataset.activityId = String(act.id || act.activityId || '');
          }
        }
        const dur = act.duration || 0;
        const h = Math.floor(dur / 60);
        const m = (dur % 60).toString().padStart(2, '0');
        // Compétition : meme look que la fiche prevu (trophee + couleur de priorite).
        titleEl.innerHTML = (act.category === 'competition')
          ? `${trophySvg(compPrio(act.priority).color, 18)} ${act.name || 'Compétition'}`
          : `${act.name || act.sessionName || 'Séance'}`;
        // Nom de sport Strava exact + clé couleur pour la pill
        const sportLabel = window.activitySportLabel(act);
        const sportCat = window.activitySportColorKey ? window.activitySportColorKey(act) : 'autre';
        const sportPill = sportLabel
          ? `<span class="sport-pill" data-sport-cat="${sportCat}" style="margin-left:8px;vertical-align:middle;">${sportLabel}</span>`
          : '';
        // Heure de début depuis start_date_local (format ISO local)
        let startTime = '';
        if (act.start_date_local) {
          const m = act.start_date_local.match(/T(\d{2}):(\d{2})/);
          if (m) startTime = `${m[1]}h${m[2]}`;
        }
        const textParts = [dateStr];
        if (startTime) textParts.push(startTime);
        metaEl.innerHTML = textParts.join(' · ') + sportPill;

        // Enchaînement multisport détecté : bandeau groupé (segments cliquables)
        // à la place du switch générique ; sinon switch classique.
        const _msComp = _msGroup && window.__triCompForDate ? window.__triCompForDate(iso) : null;
        const groupHTML = _msGroup ? window.SportProfiles.renderMultisportHTML(_msGroup, idx, _msComp) : '';
        const _inGroup = _msGroup ? _msGroup.legs.some(l => l.idx === idx) : false;
        const switchHTML = (acts.length > 1 && !(groupHTML && _inGroup && acts.length === _msGroup.legs.length)) ? `
          <div class="modal-activity-switch">
            ${acts.map((a, i) => `<button class="${i === idx ? 'active' : ''}" data-i="${i}">${a.name || 'Séance'} (${a.tss || 0} TSS)</button>`).join('')}
          </div>` : '';

        // Palettes vertes : 5 nuances pour FC, 7 pour Puissance (Coggan)
        const zoneColorsHR = ['#bbf7d0','#86efac','#4ade80','#16a34a','#14532d'];
        const zoneColorsPow = ['#dcfce7','#bbf7d0','#86efac','#4ade80','#22c55e','#15803d','#14532d'];
        // Plages
        const ftp = (window._athleteMeta && window._athleteMeta.ftp) || 250;
        const hrMax = (window._athleteMeta && window._athleteMeta.hr_max) || (act.max_hr ? Math.max(act.max_hr, 185) : 190);
        // 6 seuils pour 7 zones Coggan : 55/75/90/105/120/150% FTP
        const pZ = [
          Math.round(ftp*0.55), Math.round(ftp*0.75), Math.round(ftp*0.90),
          Math.round(ftp*1.05), Math.round(ftp*1.20), Math.round(ftp*1.50)
        ];
        // 4 seuils pour 5 zones FC : 60/70/80/90% HRmax
        const hZ = [Math.round(hrMax*0.60), Math.round(hrMax*0.70), Math.round(hrMax*0.80), Math.round(hrMax*0.90)];

        // Calcule la répartition % de temps dans chaque zone à partir d'un stream
        // N zones = thresholds.length + 1
        function computeZonesFromStream(values, thresholds) {
          if (!values || !values.length) return null;
          const counts = new Array(thresholds.length + 1).fill(0);
          let total = 0;
          for (const v of values) {
            if (v == null || isNaN(v) || v <= 0) continue;
            total++;
            let placed = false;
            for (let i = 0; i < thresholds.length; i++) {
              if (v < thresholds[i]) { counts[i]++; placed = true; break; }
            }
            if (!placed) counts[thresholds.length]++;
          }
          if (total === 0) return null;
          return counts.map(c => +(c / total * 100).toFixed(1));
        }

        // Récupère les streams en cache si dispo et calcule les zones cohérentes avec les labels
        let zonesHRComputed = null, zonesPowComputed = null;
        try {
          const aid = act.id || act.activityId || day.activityId;
          const cached = aid && window.STREAMS_CACHE ? window.STREAMS_CACHE[String(aid)] : null;
          if (cached && Array.isArray(cached)) {
            let hrData = null, wattsData = null;
            for (const s of cached) {
              if (s.type === 'heartrate') hrData = s.data;
              else if (s.type === 'watts') wattsData = s.data;
            }
            if (hrData) zonesHRComputed = computeZonesFromStream(hrData, hZ);
            if (wattsData) zonesPowComputed = computeZonesFromStream(wattsData, pZ);
          }
        } catch (e) { /* fallback sur les zones de l'API */ }
        // Labels affichés au centre du donut au hover (avec plage bpm/watts)
        const hrCenterLabels = [
          `Z1 (<${hZ[0]})`,
          `Z2 (${hZ[0]}-${hZ[1]})`,
          `Z3 (${hZ[1]}-${hZ[2]})`,
          `Z4 (${hZ[2]}-${hZ[3]})`,
          `Z5 (>${hZ[3]})`
        ];
        const powCenterLabels = [
          `Z1 (<${pZ[0]}w)`,
          `Z2 (${pZ[0]}-${pZ[1]}w)`,
          `Z3 (${pZ[1]}-${pZ[2]}w)`,
          `Z4 (${pZ[2]}-${pZ[3]}w)`,
          `Z5 (${pZ[3]}-${pZ[4]}w)`,
          `Z6 (${pZ[4]}-${pZ[5]}w)`,
          `Z7 (>${pZ[5]}w)`
        ];
        // Labels affichés dans la légende sous le donut (noms de zone)
        const hrNameLabels = ['Z1 récup','Z2 endurance','Z3 tempo','Z4 seuil','Z5 VO2max'];
        const powNameLabels = ['Z1 récup','Z2 endurance','Z3 tempo','Z4 seuil','Z5 VO2max','Z6 anaérobie','Z7 neuromusc.'];
        const zonesHR = zonesHRComputed || act.zones_hr || (act.zones && !act.zones_power ? act.zones : null);
        const zonesPow = zonesPowComputed || act.zones_power || null;
        const hasAnyZones = !!(zonesHR || zonesPow);
        const cols = (zonesHR && zonesPow) ? '1fr 1fr' : '1fr';
        const zonesHTML = hasAnyZones ? `
          <div class="modal-section">
            <div class="modal-section-title">Répartition par zones</div>
            <div style="display:grid;grid-template-columns:${cols};gap:20px;">
              ${zonesHR ? `<div style="text-align:center;min-width:0;">
                <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Zones FC</div>
                <div style="position:relative;height:180px;width:100%;"><canvas id="modal-zones-hr"></canvas></div>
                <div id="legend-zones-hr" style="display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:4px 10px;padding-top:8px;height:46px;font-size:10px;color:var(--text-dim);"></div>
              </div>` : ''}
              ${zonesPow ? `<div style="text-align:center;min-width:0;">
                <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Zones Puissance</div>
                <div style="position:relative;height:180px;width:100%;"><canvas id="modal-zones-power"></canvas></div>
                <div id="legend-zones-power" style="display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:4px 10px;padding-top:8px;height:46px;font-size:10px;color:var(--text-dim);"></div>
              </div>` : ''}
            </div>
          </div>` : '';

        // === Helpers pour bâtir les sections ===
        const card = (label, value, unit, sub) =>
          `<div class="modal-metric" style="text-align:center;">
             <div class="m-label">${label}</div>
             <div class="m-value">${value}${unit ? `<span style="font-size:14px;"> ${unit}</span>` : ''}</div>
             ${sub ? `<div class="m-sub">${sub}</div>` : ''}
           </div>`;
        const section = (title, cards) => {
          const filled = cards.filter(Boolean);
          if (filled.length === 0) return '';
          return `<div class="modal-section">
            <div class="modal-section-title">${title}</div>
            <div class="modal-metrics">${filled.join('')}</div>
          </div>`;
        };
        const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

        // --- 1. Synthèse : durée / distance / dénivelé / vitesse / TSS ---
        // Élapsed (h/m) depuis elapsed_time en secondes
        let elapsedSub = '';
        if (act.elapsed_time && act.elapsed_time > (act.moving_time || 0)) {
          const eh = Math.floor(act.elapsed_time / 3600);
          const em = Math.floor((act.elapsed_time % 3600) / 60).toString().padStart(2, '0');
          elapsedSub = `Élapsed ${eh}h${em}`;
        }
        const vMaxToShow = act.max_speed_smooth_kmh || act.max_speed_kmh;
        // Fallbacks de cles : Strava (distance_km / elevation_gain) ou saisie manuelle (km / dplus).
        const _distKm = act.distance_km || act.km;
        const _dplusM = act.elevation_gain || act.total_elevation_gain || act.dplus;
        // === Bloc stats piloté par le PROFIL DU SPORT (js/sport-profiles.js) ===
        // course -> allure /km, natation -> distance m + /100m, muscu -> pas de
        // distance/vitesse... Ajouter un sport = ajouter un profil dans le module.
        const heroCard = (hh2) =>
          `<div class="act-hero">`
          + `<span class="act-hero-ico" style="color:${hh2.color}">${hh2.svg}</span>`
          + `<div class="act-hero-tx"><div class="act-hero-val">${hh2.val}${hh2.unit ? `<span class="act-hero-unit"> ${hh2.unit}</span>` : ''}</div>`
          + `<div class="act-hero-lab">${hh2.lab}</div></div></div>`;
        const tile = (tt2) =>
          `<div class="act-tile" style="background:${tt2.color}17;--tile-c:${tt2.color}">`
          + `<div class="act-tile-lab">${tt2.lab}</div>`
          + `<div class="act-tile-val">${tt2.val}</div></div>`;
        // < 1h : minutes:secondes exactes (depuis moving_time) ; sinon h/min
        const _durSecTot = act.moving_time || act.elapsed_time || 0;
        // Même langage visuel que "1h46" : grands chiffres, unité en petit -> "44min02"
        const _durStr = dur < 60
          ? (_durSecTot > 0
            ? `${Math.floor(_durSecTot / 60)}<span style="font-size:13px">min</span>${String(Math.round(_durSecTot % 60)).padStart(2, '0')}`
            : `${Math.round(dur)}<span style="font-size:13px"> min</span>`)
          : `${h}<span style="font-size:13px">h</span>${m}`;
        const _spCtx = { durMin: dur, durStr: _durStr, elapsedSub, distKm: _distKm, dplusM: _dplusM };
        const _heroDefs = window.SportProfiles ? window.SportProfiles.heroes(act, _spCtx) : [];
        const _tileDefs = window.SportProfiles ? window.SportProfiles.tiles(act, _spCtx) : [];
        const _heroRow = _heroDefs.length ? `<div class="act-hero-row" data-n="${Math.min(_heroDefs.length, 4)}">${_heroDefs.slice(0, 4).map(heroCard).join('')}</div>` : '';
        const _n = _tileDefs.length;
        const _cols = _n <= 4 ? Math.max(1, _n) : Math.ceil(_n / 2);   // <=4 -> 1 rangee ; sinon 2 rangees equilibrees (desktop)
        const _tileGrid = _n ? `<div class="act-tile-grid" data-n="${_n}" style="--tile-cols:${_cols};--tile-tracks:${_cols * 2}">${_tileDefs.map(tile).join('')}</div>` : '';
        const statsHTML = (_heroRow || _tileGrid) ? `<div class="modal-section">${_heroRow}${_tileGrid}</div>` : '';

        // Id Strava : uniquement pour savoir si des streams existent (section graphique).
        // (le lien externe a été retiré : l'app n'affiche que SA base de données)
        const aId = act.id || act.activityId || day.activityId;
        const stravaId = aId ? String(aId).replace(/^s/, '').replace(/^i/, '') : '';
        const comparHTML = (typeof window.renderPrevuVsRealiseHTML === 'function') ? window.renderPrevuVsRealiseHTML(act, iso) : '';
        const _struct = act.structure;
        const _structDet = (Array.isArray(_struct) && _struct.length && typeof window.renderWorkoutDetailHTML === 'function') ? window.renderWorkoutDetailHTML(_struct) : '';
        const profileHTML = (Array.isArray(_struct) && _struct.length && typeof window.renderWorkoutProfileHTML === 'function')
          ? `<div class="modal-section"><div class="modal-section-title">Profil de séance</div>${window.renderWorkoutProfileHTML(_struct)}${_structDet}</div>`
          : '';
        const _escNote = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
        const notesHTML = (act.notes && String(act.notes).trim())
          ? `<div class="modal-section"><div class="modal-section-title">Notes</div><div class="modal-info-box" style="white-space:pre-wrap;">${_escNote(act.notes)}</div></div>`
          : '';
        // Sections Strava : on n'affiche Graphique / Lien que s'il y a une vraie activite
        // Strava (sinon on n'affiche pas de cases vides).
        const _hasStrava = !!(stravaId && /^\d+$/.test(stravaId));
        const graphHTML = _hasStrava ? `<div class="modal-section"><div id="streams-section"></div></div>` : '';
        const lienHTML = '';
        bodyEl.innerHTML = `
          ${groupHTML}
          ${switchHTML}
          ${statsHTML}
          ${comparHTML}
          ${zonesHTML}
          ${profileHTML}
          ${notesHTML}
          ${graphHTML}
          ${lienHTML}
        `;
        try { window.__setupModalLinkSelect(act, iso); } catch (e) { /* ignore */ }
        // Wire switch buttons (avant le chargement async des streams)
        bodyEl.querySelectorAll('.modal-activity-switch button').forEach(btn => {
          btn.addEventListener('click', () => renderModalActivity(+btn.dataset.i));
        });
        // Segments du bandeau multisport -> bascule sur l'activité du segment
        bodyEl.querySelectorAll('.msg-seg').forEach(btn => {
          btn.addEventListener('click', () => renderModalActivity(+btn.dataset.legIdx));
        });

        // Camemberts des zones FC / Puissance — defer pour laisser le layout se calculer
        setTimeout(() => {
          // Durée totale (minutes) pour calculer le temps passé dans chaque zone
          const totalMin = act.duration || 0;
          const fmtTime = (totalSec) => {
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = Math.floor(totalSec % 60);
            if (h > 0) return `${h}h${m.toString().padStart(2,'0')}`;
            if (m > 0) return `${m}m${s.toString().padStart(2,'0')}`;
            return `${s}s`;
          };

          // Plugin texte central : %, temps passé, label centré (avec plage)
          const centerTextPlugin = {
            id: 'centerText',
            afterDraw(chart) {
              const idx = chart._hoveredIdx;
              if (idx == null) return;
              const ds = chart.data.datasets[0];
              const pct = ds.data[idx];
              // Si le chart a des labels custom pour le centre, les utilise, sinon fallback labels
              const label = (chart._centerLabels && chart._centerLabels[idx]) || chart.data.labels[idx];
              const timeSec = (pct / 100) * totalMin * 60;
              const { ctx, chartArea } = chart;
              const cx = (chartArea.left + chartArea.right) / 2;
              const cy = (chartArea.top + chartArea.bottom) / 2;
              ctx.save();
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              // % en gros
              ctx.fillStyle = ds.backgroundColor[idx];
              ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
              ctx.fillText(pct.toFixed(1) + '%', cx, cy - 14);
              // Temps passé
              ctx.fillStyle = 'var(--text)'; ctx.fillStyle = '#e6e9ef';
              ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
              ctx.fillText(fmtTime(timeSec), cx, cy + 6);
              // Nom de zone (plus petit pour ne pas déborder)
              ctx.fillStyle = 'rgba(230,233,239,0.6)';
              ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
              ctx.fillText(label, cx, cy + 22);
              ctx.restore();
            }
          };

          const doughnutOpts = () => ({
            responsive: true, maintainAspectRatio: false,
            radius: '85%',
            plugins: {
              legend: { display: false }, // remplacée par légende HTML custom (hauteur fixe)
              tooltip: { enabled: false },
              verticalHoverLine: false
            },
            cutout: '62%',
            animation: { duration: 0 },
            interaction: { mode: 'nearest', intersect: true },
            transitions: {
              active: { animation: { duration: 200, easing: 'easeOutCubic' } }
            },
            onHover: (e, els, chart) => {
              const newIdx = (els && els.length) ? els[0].index : null;
              if (newIdx === chart._hoveredIdx) return;
              chart._hoveredIdx = newIdx;
              chart.setActiveElements(newIdx != null ? [{ datasetIndex: 0, index: newIdx }] : []);
              chart.update();
            }
          });
          // hoverOffset doit être sur le dataset en Chart.js v4
          const makeDataset = (data, colors) => ({
            data,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 18,
            hoverBorderWidth: 0
          });
          // Helper : crée un donut + attache un listener mouseleave pour bien reset
          function makeDonut(canvasId, data, legendLabels, centerLabels, colors) {
            const cv = document.getElementById(canvasId);
            if (!cv) return null;
            const chart = new Chart(cv, {
              type: 'doughnut',
              data: { labels: legendLabels, datasets: [makeDataset(data, colors)] },
              options: doughnutOpts(),
              plugins: [centerTextPlugin]
            });
            chart._centerLabels = centerLabels;
            cv.addEventListener('mouseleave', () => {
              if (chart._hoveredIdx != null) {
                chart._hoveredIdx = null;
                chart.setActiveElements([]);
                chart.update();
              }
            });
            return chart;
          }
          // Helper : génère la légende HTML correspondante
          function fillLegend(elId, names, colors) {
            const el = document.getElementById(elId);
            if (!el) return;
            el.innerHTML = names.map((n, i) =>
              `<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">
                <span style="width:9px;height:9px;background:${colors[i]};border-radius:2px;display:inline-block;"></span>${n}
              </span>`
            ).join('');
          }

          if (zonesHR) {
            const c = makeDonut('modal-zones-hr', zonesHR, hrNameLabels, hrCenterLabels, zoneColorsHR);
            if (c) _modalCharts.push(c);
            fillLegend('legend-zones-hr', hrNameLabels, zoneColorsHR);
          }
          if (zonesPow) {
            const is7 = zonesPow.length === 7;
            const powNames = is7 ? powNameLabels : ['Z1 récup','Z2 endurance','Z3 tempo','Z4 seuil','Z5 VO2max'];
            const powCenters = is7 ? powCenterLabels : [
              `Z1 (<${pZ[0]}w)`,
              `Z2 (${pZ[0]}-${pZ[1]}w)`,
              `Z3 (${pZ[1]}-${pZ[2]}w)`,
              `Z4 (${pZ[2]}-${pZ[3]}w)`,
              `Z5 (>${pZ[3]}w)`
            ];
            const powColors = is7 ? zoneColorsPow : zoneColorsHR;
            const c = makeDonut('modal-zones-power', zonesPow, powNames, powCenters, powColors);
            if (c) _modalCharts.push(c);
            fillLegend('legend-zones-power', powNames, powColors);
          }
        }, 0);
        // Lancer le chargement des streams en async (la modal est déjà visible)
        const _streamsEl = document.getElementById('streams-section');
        if (_streamsEl) {
          const streamId = act.id || act.activityId || day.activityId;
          window.__lastActSbId = act._sbId || null;
          window.__lastActDate = iso;
          window.__lastActSport = (typeof getSportCategory === 'function') ? getSportCategory(act.raw_type || act.sport) : null;
          window.__lastAct = act;
          if (streamId) renderStreamsSection(_streamsEl, streamId);
          else _streamsEl.innerHTML = '<div class="modal-placeholder">Pas d\'ID activité disponible pour cette séance.</div>';
        }
      }
      const _startIdx = (window.__openActIdx != null && window.__openActIdx < acts.length) ? window.__openActIdx : 0;
      window.__openActIdx = null;
      renderModalActivity(_startIdx);
      // Sélecteur d'étapes si l'activité fait partie d'une course à étapes
      try { _injectRealisedStageTabs(iso, acts); } catch (e) { /* ignore */ }
    }
  } else {
    // ============= Source = 'prevu' =============
    const compsAll = loadCompetitionsExpanded().map(c => ({ ...c, dateObj: new Date(c.date + 'T12:00:00') }));
    const compsForToday = compsAll.filter(c => toIsoDate(c.dateObj) === iso);
    const manualTrainings = ((typeof loadTrainings === 'function') ? loadTrainings() : []).filter(t => !window.coachModeKeep || window.coachModeKeep(t.ia));
    const manualForToday = manualTrainings.filter(t => t.date === iso);

    // === Items affichables sur la day card (source de vérité pour la sélection clavier/flèches) ===
    // L'ordre DOIT correspondre à la day card : compsForToday + manualForToday
    const dayItems = [];
    compsForToday.forEach(c => dayItems.push({ kind: 'comp', data: c }));
    manualForToday.forEach(t => dayItems.push({ kind: 'manual', data: t }));

    // Item sélectionné par l'utilisateur via les flèches du calendrier
    let dayCurIdx = dayPrevuIndex[iso] || 0;
    if (dayCurIdx >= dayItems.length) dayCurIdx = 0;
    const selectedItem = dayItems[dayCurIdx] || null;

    // Build la liste d'items finale (avec enrichissement étapes si applicable)
    // - Si l'item sélectionné est une étape de stage race : enrichit avec TOUTES les étapes
    //   du parent pour permettre la navigation entre étapes via le switcher de la modal
    // - Sinon : la liste = items du jour
    const items = [];
    let curIdx = 0;
    if (selectedItem && selectedItem.kind === 'comp' && selectedItem.data.parentId) {
      const stageRaceItems = compsAll
        .filter(c => c.parentId === selectedItem.data.parentId)
        .sort((a, b) => (a.stageIdx || 0) - (b.stageIdx || 0));
      stageRaceItems.forEach(c => items.push({ kind: 'comp', data: c }));
      // Insère les autres items du jour (compés non-stage + manuels) qui ne sont pas déjà dedans
      dayItems.forEach(it => {
        if (it.kind !== 'comp' || it.data.parentId !== selectedItem.data.parentId) {
          items.push(it);
        }
      });
      // Trouve l'étape correspondant à l'item sélectionné
      const idx = items.findIndex(it => it.kind === 'comp' && it.data.id === selectedItem.data.id);
      curIdx = idx >= 0 ? idx : 0;
    } else if (dayItems.length > 0) {
      dayItems.forEach(it => items.push(it));
      curIdx = dayCurIdx;
    } else {
      // Rien d'explicite ce jour-là : pas de séance auto-générée (la planif IA
      // passe par le chat). On affiche un repos forcé éventuel, sinon « rien ».
      const _isForcedRest = (typeof isRestDayForMode === 'function') && isRestDayForMode(iso);
      const proposal = _isForcedRest
        ? { type: 'rest', name: 'Repos', dur: 0, tss: 0, why: 'Repos forcé (override utilisateur)' }
        : { type: 'libre', name: 'Aucune séance prévue', dur: 0, tss: 0, why: '' };
      items.push({ kind: 'template', data: proposal, phase: null });
      curIdx = 0;
    }
    if (curIdx >= items.length) curIdx = 0;

    function renderPrevuItem(idx) {
      curIdx = idx;
      const item = items[idx];
      // Mise à jour de la date affichée si l'item est une étape sur une autre date
      let effectiveDateStr = dateStr;
      if (item.kind === 'comp' && item.data.date && item.data.date !== iso) {
        const d2 = new Date(item.data.date + 'T12:00:00');
        if (!isNaN(d2.getTime())) {
          effectiveDateStr = d2.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }
      }
      const switchHTML = items.length > 1 ? `
        <div class="modal-activity-switch">
          ${items.map((it, i) => {
            const label = it.kind === 'comp'
              ? (it.data.stageIdx !== undefined ? `Étape ${it.data.stageIdx + 1}` : it.data.name.split(' — ')[0])
              : (it.kind === 'manual' ? it.data.name : 'IA');
            return `<button class="${i === idx ? 'active' : ''}" data-i="${i}">${label}</button>`;
          }).join('')}
        </div>` : '';

      if (item.kind === 'comp') {
        renderCompModal(item.data, switchHTML, effectiveDateStr);
      } else if (item.kind === 'manual') {
        renderManualTrainingModal(item.data, switchHTML, effectiveDateStr);
      } else {
        renderTemplateModal(item.data, item.phase, switchHTML, effectiveDateStr);
      }
    }

    function renderCompModal(c, switchHTML, dateStrOverride) {
      const _dateStr = dateStrOverride || dateStr;
      const isStage = c.stageIdx !== undefined && c.totalStages;
      // Affiche les boutons "Modifier" et "Supprimer" pour cette compé
      const editBtn = document.getElementById('modal-edit-btn');
      const delBtn = document.getElementById('modal-delete-btn');
      if (editBtn) {
        editBtn.hidden = false;
        editBtn.dataset.kind = 'comp';
        editBtn.dataset.compId = c.parentId || c.id;
      }
      if (delBtn) {
        delBtn.hidden = false;
        delBtn.dataset.kind = 'comp';
        delBtn.dataset.compId = c.parentId || c.id;
      }
      const parentName = isStage ? c.name.replace(/ — Étape \d+$/, '') : c.name;
      const sportLabel = window.sportFr(c.sport || 'Ride');
      const sportCat = window.activitySportColorKey({ sport: c.sport }) || 'autre';
      const sportPill = `<span class="sport-pill" data-sport-cat="${sportCat}" style="margin-left:10px;vertical-align:middle;">${sportLabel}</span>`;

      // Title : juste le nom de la course (pas le numéro d'étape — déjà visible dans le switcher + section dédiée)
      titleEl.innerHTML = `${trophySvg(compPrio(c.priority).color, 18)} ${parentName}`;

      // Meta : date + heure + sport pill
      const timeStr = c.time ? ` · ${c.time.replace(':', 'h')}` : '';
      metaEl.innerHTML = `${_dateStr}${timeStr}${sportPill}`;

      // Parse target → minutes
      let raceMinutes = parseTimeToMin(c.target);

      // Calcule l'allure si km + target dispo (adapté au sport)
      let allure = null, allureLabel = 'Allure';
      if (c.km && raceMinutes) {
        const hours = raceMinutes / 60;
        const cyclingSports = ['Ride','VirtualRide','GravelRide','EBikeRide','MountainBikeRide','EMountainBikeRide','Velomobile','Handcycle'];
        const runSports = ['Run','TrailRun','VirtualRun'];
        const swimSports = ['Swim','OpenWaterSwim'];
        if (cyclingSports.includes(c.sport)) {
          allure = (c.km / hours).toFixed(1) + ' km/h';
        } else if (runSports.includes(c.sport)) {
          const minPerKm = raceMinutes / c.km;
          const mm = Math.floor(minPerKm);
          const ss = Math.round((minPerKm - mm) * 60);
          allure = `${mm}'${ss.toString().padStart(2,'0')}"/km`;
        } else if (swimSports.includes(c.sport)) {
          const minPer100m = (raceMinutes / c.km) / 10;
          const mm = Math.floor(minPer100m);
          const ss = Math.round((minPer100m - mm) * 60);
          allure = `${mm}'${ss.toString().padStart(2,'0')}"/100m`;
        } else {
          allure = (c.km / hours).toFixed(1) + ' km/h';
        }
      }

      // Si GPX présent : on override km / D+ avec les valeurs calculées depuis le fichier
      // (priorité au GPX → vérité terrain — sinon valeurs saisies manuellement)
      // Si nombre de tours défini, on multiplie km/D+/D- par le nombre de tours
      const lapsCount = parseInt(c.laps, 10) || 1;
      const gpxStats = c.gpxContent ? (typeof extractGpxStats === 'function' ? extractGpxStats(c.gpxContent, lapsCount) : null) : null;
      const effectiveKm = (gpxStats && gpxStats.km) || c.km;
      const effectiveDplus = (gpxStats && gpxStats.dplus) || c.dplus;
      // Recalcule l'allure si km vient du GPX
      if (gpxStats && gpxStats.km && raceMinutes) {
        const hours = raceMinutes / 60;
        const cyclingSports = ['Ride','VirtualRide','GravelRide','EBikeRide','MountainBikeRide','EMountainBikeRide','Velomobile','Handcycle'];
        const runSports = ['Run','TrailRun','VirtualRun'];
        const swimSports = ['Swim','OpenWaterSwim'];
        if (cyclingSports.includes(c.sport)) {
          allure = (gpxStats.km / hours).toFixed(1) + ' km/h';
        } else if (runSports.includes(c.sport)) {
          const minPerKm = raceMinutes / gpxStats.km;
          const mm = Math.floor(minPerKm);
          const ss = Math.round((minPerKm - mm) * 60);
          allure = `${mm}'${ss.toString().padStart(2,'0')}"/km`;
        } else if (swimSports.includes(c.sport)) {
          const minPer100m = (raceMinutes / gpxStats.km) / 10;
          const mm = Math.floor(minPer100m);
          const ss = Math.round((minPer100m - mm) * 60);
          allure = `${mm}'${ss.toString().padStart(2,'0')}"/100m`;
        } else {
          allure = (gpxStats.km / hours).toFixed(1) + ' km/h';
        }
      }

      // Ordre demandé : Temps cible → Distance → Dénivelé → Allure
      // Type d'épreuve en titre texte. Tours en complément.
      const cards = [];
      if (c.target != null && c.target !== '') cards.push({ label: 'Temps cible', value: fmtMinToTime(c.target), unit: '' });
      if (effectiveKm != null) cards.push({ label: 'Distance', value: effectiveKm, unit: 'km' });
      // Si GPX → D+ visible dans la barre stats du profil → on ne le montre pas en gros
      if (effectiveDplus != null && !gpxStats) cards.push({ label: 'Dénivelé +', value: effectiveDplus, unit: 'm' });
      if (allure) cards.push({ label: allureLabel, value: allure });
      if (c.laps != null) cards.push({ label: 'Tours', value: c.laps, unit: '' });

      // Sections détaillées
      const sections = [];
      // Section GPX : si content présent → profil d'altitude + trace en grand
      if (c.gpxContent) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Profil d'altitude</div>
          <div class="gpx-stats-row" id="gpx-stats-row-prevu"></div>
          <div class="gpx-elev-wrap" id="gpx-elev-wrap-prevu" style="margin-bottom:14px;">
            <canvas id="gpx-elev-canvas-prevu"></canvas>
            <div class="gpx-elev-tooltip" id="gpx-elev-tooltip-prevu" style="display:none;"></div>
          </div>
          <div class="modal-section-title">Tracé du parcours</div>
          <div class="gpx-map-wrap"><div class="gpx-leaflet" id="gpx-leaflet-prevu"></div></div>
        </div>`);
      } else if (c.gpxName) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Trace GPX</div>
          <div class="modal-info-box">📍 <strong>${c.gpxName}</strong></div>
        </div>`);
      }
      if (c.notes) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Notes / Stratégie</div>
          <div class="modal-info-box" style="white-space:pre-wrap;">${escapeHtml(c.notes)}</div>
        </div>`);
      }
      // Section "Segments" : la liste des segments AJOUTÉS manuellement par l'utilisateur
      // (via drag-select + bouton "Ajouter segment")
      if (c.gpxContent) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Segments</div>
          <div class="climbs-list" id="gpx-segments-list"></div>
        </div>`);
        window._gpxClimbContent = c.gpxContent;
        window._gpxCurrentCompId = c.parentId || c.id;
      }

      // Titre "Type d'épreuve" au-dessus des cards
      const typeTitle = c.type
        ? `<div class="modal-section-title" style="margin-bottom:12px;font-size:18px;color:var(--text);text-transform:none;letter-spacing:0;">${c.type}</div>`
        : '';
      // Triathlon avec segments : timeline du déroulé de course à la place des tuiles génériques
      const triPlanHTML = (typeof getSportCategory === 'function' && getSportCategory(c.sport) === 'triathlon'
        && window.SportProfiles && window.SportProfiles.renderTriPlanHTML) ? window.SportProfiles.renderTriPlanHTML(c) : '';
      bodyEl.innerHTML = `
        ${switchHTML}
        ${typeTitle}
        ${triPlanHTML || `<div class="modal-metrics">
          ${cards.map(card => `<div class="modal-metric${card.accent ? ' accent' : ''}"><div class="m-label">${card.label}</div><div class="m-value" style="${card.isText ? 'font-size:16px;' : ''}">${card.value}${card.unit ? `<span style="font-size:13px;font-weight:500;margin-left:2px;">${card.unit}</span>` : ''}</div></div>`).join('')}
        </div>`}
        ${sections.join('')}
      `;
      wireSwitchButtons();
      // Rendu GPX si présent : profil altitude Chart.js + tracé Leaflet
      if (c.gpxContent) {
        renderGpxElevationChart(c.gpxContent, 'gpx-elev-canvas-prevu', lapsCount);
        renderGpxLeafletMap(c.gpxContent, 'gpx-leaflet-prevu');
        wireClimbsList();
      }
    }

    // === SEGMENTS UTILISATEUR (exposés sur window pour le bouton du chart) ===
    window._gpxSegKey = (compId) => `coach_ia_gpx_segments_${compId || 'global'}`;
    window.gpxLoadSegments = (compId) => {
      try {
        const raw = localStorage.getItem(window._gpxSegKey(compId));
        if (!raw) return [];
        return JSON.parse(raw);
      } catch (e) { return []; }
    };
    window.gpxSaveSegments = (compId, arr) => {
      localStorage.setItem(window._gpxSegKey(compId), JSON.stringify(arr));
    };
    window.gpxRenderSegmentsList = () => {
      const list = document.getElementById('gpx-segments-list');
      if (!list) return;
      const compId = window._gpxCurrentCompId;
      const segs = window.gpxLoadSegments(compId);
      if (segs.length === 0) {
        list.innerHTML = `<div class="comp-empty" style="padding:14px;">Sélectionne une portion du profil pour créer un segment.</div>`;
        return;
      }
      list.innerHTML = segs.map((s, i) => {
        const cat = s.gain >= 1000 ? 'HC' : s.gain >= 600 ? '1' : s.gain >= 300 ? '2' : s.gain >= 150 ? '3' : '4';
        return `<div class="climb-item" data-seg-idx="${i}">
          <div class="climb-row">
            <div class="climb-cat cat-${cat}">${cat}</div>
            <div class="climb-info">
              <div class="climb-range">${s.name || `Segment ${i + 1}`}</div>
              <div class="climb-meta">km ${s.startKm.toFixed(1)} → ${s.endKm.toFixed(1)} · ${s.distKm.toFixed(2)} km · D+ ${Math.round(s.gain)} m · ${s.avgSlope.toFixed(1)}% moy. · ${s.maxSlope.toFixed(1)}% max</div>
            </div>
            <button class="seg-del-btn" data-seg-del="${i}" title="Supprimer">×</button>
            <div class="climb-chevron">▼</div>
          </div>
          <div class="climb-detail" hidden></div>
        </div>`;
      }).join('');
    };
    window.gpxAddCurrentSelectionAsSegment = async () => {
      const sel = window._gpxCurrentSelectionStats;
      if (!sel) {
        await appAlert({
          title: 'Aucune sélection',
          message: 'Sélectionne d\'abord une portion du profil d\'altitude (glisse sur le graphique).',
        });
        return;
      }
      const compId = window._gpxCurrentCompId;
      const segs = window.gpxLoadSegments(compId);
      const idx = segs.length + 1;
      const name = await appPrompt({
        title: 'Nouveau segment',
        message: 'Donne un nom à ce segment du parcours.',
        defaultValue: `Segment ${idx}`,
        placeholder: `Segment ${idx}`,
        okLabel: 'Ajouter',
      });
      if (name === null) return;
      segs.push({
        startKm: sel.kmMin,
        endKm: sel.kmMax,
        distKm: sel.distKm,
        gain: sel.gain,
        loss: sel.loss,
        avgSlope: sel.avgSlope,
        maxSlope: sel.maxSlope,
        minSlope: sel.minSlope,
        name: (name && name.trim()) || `Segment ${idx}`,
        createdAt: new Date().toISOString(),
      });
      window.gpxSaveSegments(compId, segs);
      window.gpxRenderSegmentsList();
    };
    // Aliases pour compat interne (utilisés par wireClimbsList plus bas)
    const loadSegments = window.gpxLoadSegments;
    const saveSegments = window.gpxSaveSegments;
    const renderSegmentsList = window.gpxRenderSegmentsList;

    function wireClimbsList() {
      const list = document.getElementById('gpx-segments-list');
      if (!list) return;
      renderSegmentsList();
      list.addEventListener('click', (e) => {
        // Bouton suppression
        const delBtn = e.target.closest('.seg-del-btn');
        if (delBtn) {
          e.stopPropagation();
          const i = +delBtn.dataset.segDel;
          const compId = window._gpxCurrentCompId;
          const segs = loadSegments(compId);
          segs.splice(i, 1);
          saveSegments(compId, segs);
          renderSegmentsList();
          return;
        }
        const item = e.target.closest('.climb-item');
        if (!item) return;
        const idx = +item.dataset.segIdx;
        const compId = window._gpxCurrentCompId;
        const segs = loadSegments(compId);
        const gpx = window._gpxClimbContent;
        if (!segs[idx] || !gpx) return;
        const detail = item.querySelector('.climb-detail');
        const chevron = item.querySelector('.climb-chevron');
        const isOpen = !detail.hidden;
        list.querySelectorAll('.climb-item').forEach(it => {
          const d = it.querySelector('.climb-detail');
          const c = it.querySelector('.climb-chevron');
          if (d && d !== detail) { d.hidden = true; d.innerHTML = ''; }
          if (c) c.style.transform = '';
          it.classList.remove('expanded');
        });
        if (isOpen) {
          detail.hidden = true;
          detail.innerHTML = '';
          chevron.style.transform = '';
          item.classList.remove('expanded');
        } else {
          detail.innerHTML = renderClimbDetail(segs[idx], gpx);
          detail.hidden = false;
          chevron.style.transform = 'rotate(180deg)';
          item.classList.add('expanded');
        }
      });
    }

    // Rendu HTML du détail d'une bosse : profil découpé en segments coloréés par pente
    function renderClimbDetail(climb, gpxContent) {
      // Re-parse et filtre la série dans [startKm, endKm]
      const parser = new DOMParser();
      const doc = parser.parseFromString(gpxContent, 'application/xml');
      const trkpts = doc.getElementsByTagName('trkpt');
      const pts = trkpts.length ? trkpts : (doc.getElementsByTagName('rtept').length ? doc.getElementsByTagName('rtept') : []);
      function _d(lat1, lon1, lat2, lon2) {
        const R = 6371, toRad = d => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
        return 2 * R * Math.asin(Math.sqrt(a));
      }
      let cumKm = 0, prevLat = null, prevLon = null;
      const fullSeries = [];
      for (let i = 0; i < pts.length; i++) {
        const lat = parseFloat(pts[i].getAttribute('lat'));
        const lon = parseFloat(pts[i].getAttribute('lon'));
        if (isNaN(lat) || isNaN(lon)) continue;
        if (prevLat !== null) cumKm += _d(prevLat, prevLon, lat, lon);
        prevLat = lat; prevLon = lon;
        const eleEl = pts[i].getElementsByTagName('ele')[0];
        const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
        if (!isNaN(ele)) fullSeries.push({ km: cumKm, ele });
      }
      const series = fullSeries.filter(p => p.km >= climb.startKm && p.km <= climb.endKm);
      if (series.length < 2) return '<div class="modal-placeholder">Pas assez de points</div>';

      // Découpage en segments de ~100m
      const segLen = 0.1; // km
      const segments = [];
      let segStart = series[0];
      for (let i = 1; i < series.length; i++) {
        const p = series[i];
        if (p.km - segStart.km >= segLen || i === series.length - 1) {
          const dx = (p.km - segStart.km) * 1000;
          const dy = p.ele - segStart.ele;
          const slope = dx > 0 ? (dy / dx) * 100 : 0;
          segments.push({
            startKm: segStart.km, endKm: p.km,
            startEle: segStart.ele, endEle: p.ele,
            slope,
            dist: p.km - segStart.km,
            gain: Math.max(0, dy),
          });
          segStart = p;
        }
      }

      // Couleur selon pente
      function slopeColor(s) {
        if (s < 3) return '#4ade80';
        if (s < 6) return '#fbbf24';
        if (s < 9) return '#f97316';
        if (s < 12) return '#ef4444';
        return '#b91c1c';
      }

      // SVG du profil découpé
      const W = 900, H = 240, padL = 30, padR = 16, padT = 16, padB = 30;
      const dw = W - padL - padR, dh = H - padT - padB;
      const totalSegKm = climb.endKm - climb.startKm;
      const minE = Math.min(...series.map(p => p.ele));
      const maxE = Math.max(...series.map(p => p.ele));
      const rng = Math.max(maxE - minE, 5);

      // Dessine chaque segment comme un polygone coloré
      const segmentsSvg = segments.map(s => {
        const x1 = padL + ((s.startKm - climb.startKm) / totalSegKm) * dw;
        const x2 = padL + ((s.endKm - climb.startKm) / totalSegKm) * dw;
        const y1 = padT + dh - ((s.startEle - minE) / rng) * dh;
        const y2 = padT + dh - ((s.endEle - minE) / rng) * dh;
        const baseY = padT + dh;
        const color = slopeColor(s.slope);
        return `<polygon points="${x1},${baseY} ${x1},${y1} ${x2},${y2} ${x2},${baseY}" fill="${color}" stroke="rgba(0,0,0,0.2)" stroke-width="0.5">
          <title>km ${s.startKm.toFixed(2)} → ${s.endKm.toFixed(2)} · ${s.slope.toFixed(1)}% · +${s.gain.toFixed(0)}m</title>
        </polygon>`;
      }).join('');

      // Ticks Y (altitude)
      const yTicks = [];
      for (let i = 0; i <= 3; i++) {
        const e = minE + (rng * (1 - i / 3));
        const y = padT + (dh * i / 3);
        yTicks.push(`<text x="${padL - 4}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${Math.round(e)}m</text>`);
      }
      // Ticks X (km depuis début bosse)
      const xTicks = [];
      const nTicks = Math.min(5, Math.max(2, Math.round(totalSegKm)));
      for (let i = 0; i <= nTicks; i++) {
        const km = climb.startKm + (totalSegKm * i / nTicks);
        const x = padL + (dw * i / nTicks);
        xTicks.push(`<text x="${x}" y="${H - 10}" text-anchor="middle" fill="#64748b" font-size="10">${km.toFixed(1)}</text>`);
      }

      // Légende des couleurs de pente
      const legend = `
        <div class="climb-legend">
          <span><span class="dot" style="background:#4ade80;"></span>&lt; 3%</span>
          <span><span class="dot" style="background:#fbbf24;"></span>3-6%</span>
          <span><span class="dot" style="background:#f97316;"></span>6-9%</span>
          <span><span class="dot" style="background:#ef4444;"></span>9-12%</span>
          <span><span class="dot" style="background:#b91c1c;"></span>≥ 12%</span>
        </div>
      `;

      // Liste des segments raides (>= 6%)
      const steepSegs = segments.filter(s => s.slope >= 6);
      const steepList = steepSegs.length ? `
        <div class="climb-steep-list">
          <div class="climb-steep-title">Sections les plus raides</div>
          ${steepSegs.map(s => `
            <div class="climb-steep-item">
              <span class="dot" style="background:${slopeColor(s.slope)};"></span>
              <span class="ss-range">km ${s.startKm.toFixed(2)} → ${s.endKm.toFixed(2)}</span>
              <span class="ss-slope">${s.slope.toFixed(1)}%</span>
              <span class="ss-gain">+${s.gain.toFixed(0)}m</span>
            </div>
          `).join('')}
        </div>
      ` : '';

      return `
        <div class="climb-detail-inner">
          <svg class="climb-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(0,0,0,0.2)" rx="6"/>
            ${segmentsSvg}
            ${yTicks.join('')}
            ${xTicks.join('')}
          </svg>
          ${legend}
          ${steepList}
        </div>
      `;
    }

    function renderManualTrainingModal(t, switchHTML, dateStrOverride) {
      const _dateStr = dateStrOverride || dateStr;
      // Affiche les boutons Modifier + Supprimer pour cet entraînement manuel prévu
      const editBtn = document.getElementById('modal-edit-btn');
      const delBtn = document.getElementById('modal-delete-btn');
      if (editBtn) {
        editBtn.hidden = false;
        editBtn.dataset.kind = 'training';
        editBtn.dataset.trainingId = t.id;
        editBtn.dataset.trainingMode = 'prevu';
      }
      if (delBtn) {
        delBtn.hidden = false;
        delBtn.dataset.kind = 'training';
        delBtn.dataset.trainingId = t.id;
        delBtn.dataset.trainingMode = 'prevu';
      }
      const sportLabel = window.sportFr(t.sport || 'Ride');
      const sportCat = window.activitySportColorKey({ sport: t.sport }) || 'autre';
      const sportPill = `<span class="sport-pill" data-sport-cat="${sportCat}" style="margin-left:8px;vertical-align:middle;">${sportLabel}</span>`;
      titleEl.innerHTML = `${t.name}${sportPill}`;
      // Heure (comme en realise) si la seance en a une ; sinon juste la date.
      let _timeStr = '';
      if (t.time) _timeStr = ' · ' + String(t.time).replace(':', 'h');
      else if (t.start_date_local) {
        const _mt = String(t.start_date_local).match(/T(\d{2}):(\d{2})/);
        if (_mt) _timeStr = ` · ${_mt[1]}h${_mt[2]}`;
      }
      metaEl.innerHTML = `${_dateStr}${_timeStr}`;
      const dur = t.duration || 0;
      const _S = window.__statSvg || {};
      const _heroes = [];
      if (dur) _heroes.push({ svg: _S.clock, val: (dur < 60 ? Math.round(dur) + '<span style="font-size:13px"> min</span>' : (Math.floor(dur / 60) + '<span style="font-size:13px">h</span>' + String(Math.round(dur % 60)).padStart(2, '0'))), unit: '', lab: 'Durée prévue', color: '#60a5fa' });
      if (t.km) _heroes.push({ svg: _S.route, val: Math.round(t.km), unit: 'km', lab: 'Distance prévue', color: '#22d3ee' });
      if (t.km && dur) _heroes.push({ svg: _S.speed, val: (Math.round((t.km / (dur / 60)) * 10) / 10), unit: 'km/h', lab: 'Vitesse prévue', color: '#34d399' });
      if (t.dplus) _heroes.push({ svg: _S.mtn, val: Math.round(t.dplus), unit: 'm D+', lab: 'Dénivelé prévu', color: '#84cc16' });
      if (_heroes.length < 3 && t.tss) _heroes.push({ svg: _S.bolt, val: t.tss, unit: '', lab: 'TSS estimé', color: '#fbbf24' });
      const _tiles = [];
      if (t.tss && _heroes.every(function (h) { return h.lab !== 'TSS estimé'; })) _tiles.push({ lab: 'TSS estimé', val: '' + t.tss, color: '#fbbf24' });
      if (t.rpe != null && t.rpe !== '') _tiles.push({ lab: 'RPE estimé', val: t.rpe + '/10', color: '#f59e0b' });
      var _pKj = (Array.isArray(t.structure) && t.structure.length && window.__estKjFromStructure) ? window.__estKjFromStructure(t.structure) : null;
      if (_pKj != null) _tiles.push({ lab: 'Énergie estimée', val: Math.round(_pKj) + ' kJ', color: '#9ca3af' });
      const statsHTML = window.renderStatsBlockHTML(_heroes, _tiles);

      const sections = [];
      if (Array.isArray(t.structure) && t.structure.length && typeof window.renderWorkoutProfileHTML === 'function') {
        const _det = (typeof window.renderWorkoutDetailHTML === 'function') ? window.renderWorkoutDetailHTML(t.structure) : '';
        sections.push(`<div class="modal-section"><div class="modal-section-title">Profil de séance</div>${window.renderWorkoutProfileHTML(t.structure)}${_det}</div>`);
      }
      if (t.notes) {
        sections.push(`<div class="modal-section">
          <div class="modal-section-title">Notes / Structure</div>
          <div class="modal-info-box" style="white-space:pre-wrap;">${escapeHtml(t.notes)}</div>
        </div>`);
      }
      bodyEl.innerHTML = `
        ${switchHTML}
        ${statsHTML}
        ${sections.join('')}
      `;
      wireSwitchButtons();
    }

    function renderTemplateModal(proposal, phase, switchHTML, dateStrOverride) {
      const _dateStr = dateStrOverride || dateStr;
      const isRest = proposal.type === 'rest' || (proposal.dur === 0 && proposal.tss === 0);
      const editBtn = document.getElementById('modal-edit-btn');
      const delBtn = document.getElementById('modal-delete-btn');

      // === Jour de repos : modal ultra-épurée ===
      if (isRest) {
        // ⋯ "personnaliser" reste utile (ajouter une séance ce jour-là)
        // 🗑️ caché (déjà repos, rien à supprimer)
        if (editBtn) {
          editBtn.hidden = false;
          editBtn.dataset.kind = 'template';
          editBtn.dataset.templateIso = iso;
          editBtn.dataset.templateData = JSON.stringify({
            name: 'Nouvelle séance',
            type: 'endurance',
            duration: 60,
            tss: 50,
            sport: 'Ride',
            notes: ''
          });
        }
        if (delBtn) delBtn.hidden = true;
        titleEl.textContent = 'Jour de repos';
        metaEl.textContent = _dateStr;
        bodyEl.innerHTML = `
          ${switchHTML}
          <div class="modal-rest-state">
            <div class="modal-rest-icon">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            </div>
            <div class="modal-rest-text">Récupération complète.</div>
            <div class="modal-rest-hint">Utilise <strong>⋯</strong> pour ajouter une séance ce jour-là.</div>
          </div>
        `;
        wireSwitchButtons();
        return;
      }

      // === Suggestion IA normale ===
      if (editBtn) {
        editBtn.hidden = false;
        editBtn.dataset.kind = 'template';
        editBtn.dataset.templateIso = iso;
        editBtn.dataset.templateData = JSON.stringify({
          name: proposal.name || 'Séance IA',
          type: proposal.type || 'endurance',
          duration: proposal.dur || 0,
          tss: proposal.tss || 0,
          sport: proposal.sport || 'Ride',
          notes: proposal.why || ''
        });
      }
      if (delBtn) {
        delBtn.hidden = false;
        delBtn.dataset.kind = 'template';
        delBtn.dataset.templateIso = iso;
      }
      const dur = proposal.dur || 0;
      const h = Math.floor(dur / 60), mm = (dur % 60).toString().padStart(2, '0');
      titleEl.innerHTML = `${proposal.name}`;
      metaEl.textContent = `${_dateStr} · ${fmtDur(dur)} · ${proposal.tss || 0} TSS prévus · phase ${PHASE_LABELS[phase] || phase}`;
      bodyEl.innerHTML = `
        ${switchHTML}
        <div class="modal-metrics">
          <div class="modal-metric"><div class="m-label">Durée cible</div><div class="m-value">${dur < 60 ? `${Math.round(dur)}<span style="font-size:14px;"> min</span>` : `${h}<span style="font-size:14px;">h</span>${mm}`}</div></div>
          <div class="modal-metric"><div class="m-label">TSS cible</div><div class="m-value">${proposal.tss || 0}</div></div>
          <div class="modal-metric"><div class="m-label">Phase</div><div class="m-value" style="font-size:15px;">${PHASE_LABELS[phase] || '—'}</div></div>
        </div>
        <div class="modal-section">
          <div class="modal-section-title">Pourquoi cette séance</div>
          <div class="modal-info-box">${proposal.why || '—'}</div>
        </div>
      `;
      wireSwitchButtons();
    }

    function wireSwitchButtons() {
      bodyEl.querySelectorAll('.modal-activity-switch button').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = +btn.dataset.i;
          dayPrevuIndex[iso] = i;
          renderPrevuItem(i);
        });
      });
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    renderPrevuItem(curIdx);
  }
  document.getElementById('session-modal').classList.add('active');
}

function closeSessionModal() {
  document.getElementById('session-modal').classList.remove('active');
}

document.getElementById('modal-close').addEventListener('click', closeSessionModal);

// ========= Modal de confirmation custom (remplace window.confirm) =========
// Usage : const ok = await appConfirm({ title, message, confirmLabel, cancelLabel, danger })
window.appConfirm = function(opts) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const inner = overlay.querySelector('.confirm-modal');
    if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn || !inner) {
      // Fallback ultra-safe
      resolve(window.confirm(opts && opts.message ? opts.message : 'Confirmer ?'));
      return;
    }
    // Configuration
    titleEl.textContent = (opts && opts.title) || 'Confirmer';
    // Support du HTML simple (pour mettre en gras le nom)
    if (opts && opts.html) msgEl.innerHTML = opts.html;
    else msgEl.textContent = (opts && opts.message) || '';
    okBtn.textContent = (opts && opts.confirmLabel) || 'Confirmer';
    cancelBtn.textContent = (opts && opts.cancelLabel) || 'Annuler';
    inner.classList.toggle('is-danger', !!(opts && opts.danger));

    function cleanup() {
      overlay.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }
    function onOverlayClick(e) { if (e.target === overlay) onCancel(); }
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onOk();
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('active');
    // Focus sur le bouton de confirmation pour Enter direct
    setTimeout(() => okBtn.focus(), 50);
  });
};
// Helper d'escape HTML pour les noms d'item dans les messages de confirmation
window._confirmEscape = function(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
};

// ========= Modal de saisie texte (remplace window.prompt) =========
// Usage : const txt = await appPrompt({ title, message, defaultValue, placeholder, okLabel })
// Retourne la string saisie, ou null si annulé.
window.appPrompt = function(opts) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('prompt-modal');
    const titleEl = document.getElementById('prompt-modal-title');
    const msgEl = document.getElementById('prompt-modal-message');
    const input = document.getElementById('prompt-modal-input');
    const okBtn = document.getElementById('prompt-modal-ok');
    const cancelBtn = document.getElementById('prompt-modal-cancel');
    if (!overlay || !titleEl || !msgEl || !input || !okBtn || !cancelBtn) {
      resolve(window.prompt((opts && opts.message) || '', (opts && opts.defaultValue) || ''));
      return;
    }
    titleEl.textContent = (opts && opts.title) || 'Saisir une valeur';
    msgEl.textContent = (opts && opts.message) || '';
    msgEl.style.display = (opts && opts.message) ? '' : 'none';
    input.value = (opts && opts.defaultValue) || '';
    input.placeholder = (opts && opts.placeholder) || '';
    okBtn.textContent = (opts && opts.okLabel) || 'Valider';
    cancelBtn.textContent = (opts && opts.cancelLabel) || 'Annuler';

    function cleanup() {
      overlay.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() { const v = input.value; cleanup(); resolve(v); }
    function onCancel() { cleanup(); resolve(null); }
    function onOverlayClick(e) { if (e.target === overlay) onCancel(); }
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onOk();
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('active');
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
};

// ========= Modal d'alerte (remplace window.alert) =========
// Usage : await appAlert({ title, message, okLabel })
window.appAlert = function(opts) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('alert-modal');
    const titleEl = document.getElementById('alert-modal-title');
    const msgEl = document.getElementById('alert-modal-message');
    const okBtn = document.getElementById('alert-modal-ok');
    if (!overlay || !titleEl || !msgEl || !okBtn) {
      window.alert((opts && opts.message) || '');
      resolve();
      return;
    }
    titleEl.textContent = (opts && opts.title) || 'Information';
    msgEl.textContent = (opts && opts.message) || '';
    okBtn.textContent = (opts && opts.okLabel) || 'OK';

    function cleanup() {
      overlay.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() { cleanup(); resolve(); }
    function onOverlayClick(e) { if (e.target === overlay) onOk(); }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') onOk(); }
    okBtn.addEventListener('click', onOk);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('active');
    setTimeout(() => okBtn.focus(), 50);
  });
};

// ========= STRAVA IGNORE LIST (masquer des activités Strava localement) =========
// « Masquer une activité » = drapeau hidden dans activity_edits (table mutualisée).
function isStravaIgnored(id) { const ov = getActivityEdit(id); return !!(ov && ov.hidden); }
function addStravaIgnored(id) {
  const ov = getActivityEdit(id) || {};
  setActivityEdit(id, { ...ov, hidden: true });
}

// ========= TEMPLATE IA OVERRIDES (marquer un jour en repos / personnalisation) =========
const TEMPLATE_REST_KEY = 'coach_ia_template_rest_days_v1';
const TEMPLATE_REST_IA_KEY = 'coach_ia_template_rest_days_ia_v1'; // sous-ensemble créé par l'IA
function loadTemplateRestDays() {
  try { return JSON.parse(localStorage.getItem(TEMPLATE_REST_KEY) || '[]'); }
  catch { return []; }
}
function loadRestIaSet() {
  try { return JSON.parse(localStorage.getItem(TEMPLATE_REST_IA_KEY) || '[]'); }
  catch { return []; }
}
function isTemplateRestDay(iso) { return loadTemplateRestDays().includes(iso); }
// Repos visible dans le mode courant (Manuel => repos non-IA ; IA => repos IA).
function isRestDayForMode(iso) {
  if (!loadTemplateRestDays().includes(iso)) return false;
  const isIa = loadRestIaSet().includes(iso);
  return window.coachModeKeep ? window.coachModeKeep(isIa) : !isIa;
}
function addTemplateRestDay(iso, ia = false) {
  const arr = loadTemplateRestDays();
  if (!arr.includes(iso)) arr.push(iso);
  localStorage.setItem(TEMPLATE_REST_KEY, JSON.stringify(arr));
  if (ia) {
    const iaArr = loadRestIaSet();
    if (!iaArr.includes(iso)) iaArr.push(iso);
    localStorage.setItem(TEMPLATE_REST_IA_KEY, JSON.stringify(iaArr));
  }
  if (window.cloudSync) window.cloudSync.pushRestDay(iso, true, ia);
}
function removeTemplateRestDay(iso) {
  localStorage.setItem(TEMPLATE_REST_KEY, JSON.stringify(loadTemplateRestDays().filter(d => d !== iso)));
  localStorage.setItem(TEMPLATE_REST_IA_KEY, JSON.stringify(loadRestIaSet().filter(d => d !== iso)));
  if (window.cloudSync) window.cloudSync.pushRestDay(iso, false);
}
function toggleTemplateRestDay(iso) {
  if (isTemplateRestDay(iso)) removeTemplateRestDay(iso);
  else addTemplateRestDay(iso, window.APP_MODE === 'ia'); // toggle manuel en mode IA => repos IA
}
// Expose pour modules ES6 externes (day-extras.js)
window.isTemplateRestDay = isTemplateRestDay;
window.isRestDayForMode = isRestDayForMode;
window.addTemplateRestDay = addTemplateRestDay;
window.removeTemplateRestDay = removeTemplateRestDay;
window.toggleTemplateRestDay = toggleTemplateRestDay;

// ========= Bouton "Modifier" (⋯) dans le header du modal détail =========
// Route selon kind : comp → édition compé, training → édition entraînement, template → matérialiser
const _modalEditBtn = document.getElementById('modal-edit-btn');
if (_modalEditBtn) {
  _modalEditBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const kind = _modalEditBtn.dataset.kind;
    if (kind === 'comp') {
      const compId = _modalEditBtn.dataset.compId;
      if (!compId) return;
      const comp = loadCompetitions().find(c => c.id === compId);
      if (!comp) return;
      closeSessionModal();
      openCompModalForEdit(comp);
    } else if (kind === 'training') {
      const id = _modalEditBtn.dataset.trainingId;
      const mode = _modalEditBtn.dataset.trainingMode || 'prevu';
      if (!id) return;
      closeSessionModal();
      if (typeof window.gpxEditTraining === 'function') window.gpxEditTraining(id, mode);
    } else if (kind === 'strava-edit') {
      const aid = _modalEditBtn.dataset.activityId;
      const iso = _modalEditBtn.dataset.iso;
      closeSessionModal();
      openActivityEditModal(aid, iso);
    } else if (kind === 'template') {
      // Matérialise la suggestion IA en entraînement manuel prévu modifiable
      const isoT = _modalEditBtn.dataset.templateIso;
      let payload = {};
      try { payload = JSON.parse(_modalEditBtn.dataset.templateData || '{}'); } catch {}
      closeSessionModal();
      if (typeof openTrainModal === 'function') {
        openTrainModal('prevu');
        // Préremplit les champs (Date + valeurs du template)
        const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
        setVal('train-modal-name', payload.name);
        setVal('train-modal-date', isoT);
        const dateEl = document.getElementById('train-modal-date');
        if (dateEl && dateEl._flatpickr && isoT) dateEl._flatpickr.setDate(isoT, false);
        setVal('train-modal-duration', payload.duration);
        setVal('train-modal-tss', payload.tss);
        setVal('train-modal-notes', payload.notes);
        const sportEl = document.getElementById('train-modal-sport');
        if (sportEl && payload.sport) { sportEl.value = payload.sport; if (sportEl._customUpdate) sportEl._customUpdate(); }
        const typeEl = document.getElementById('train-modal-type');
        if (typeEl && payload.type) { typeEl.value = payload.type; if (typeEl._customUpdate) typeEl._customUpdate(); }
      }
    }
  });
}

// ========= Bouton "Supprimer" (🗑️) dans le header du modal détail =========
const _modalDelBtn = document.getElementById('modal-delete-btn');
if (_modalDelBtn) {
  _modalDelBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const kind = _modalDelBtn.dataset.kind;
    if (kind === 'comp') {
      const compId = _modalDelBtn.dataset.compId;
      if (!compId) return;
      const comp = loadCompetitions().find(c => c.id === compId);
      const name = comp ? comp.name : 'cette compétition';
      const ok = await appConfirm({
        title: 'Supprimer cette compétition',
        html: `Supprimer <strong>${window._confirmEscape(name)}</strong> ?`,
        confirmLabel: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
      const remaining = loadCompetitions().filter(c => c.id !== compId);
      saveCompetitions(remaining);
      if (comp) removeCompFromDashboard(comp);
      closeSessionModal();
      if (typeof window.__applyOverridesAndRerender === 'function') window.__applyOverridesAndRerender();
      else if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderCompetitionsPage === 'function') renderCompetitionsPage();
    } else if (kind === 'training') {
      const id = _modalDelBtn.dataset.trainingId;
      const mode = _modalDelBtn.dataset.trainingMode || 'prevu';
      const sbId = _modalDelBtn.dataset.sbId || '';
      if (!id && !sbId) return;
      if (typeof window.gpxDeleteTraining === 'function') window.gpxDeleteTraining(id, mode, sbId);
    } else if (kind === 'strava') {
      const aid = _modalDelBtn.dataset.activityId;
      if (!aid) return;
      const ok = await appConfirm({
        title: 'Masquer cette activité',
        message: 'Masquer cette activité Strava du calendrier ?\n\nElle reste sur Strava, c\'est juste un filtre local.',
        confirmLabel: 'Masquer',
        danger: true,
      });
      if (!ok) return;
      addStravaIgnored(aid);
      closeSessionModal();
      if (typeof renderCalendar === 'function') renderCalendar();
    } else if (kind === 'template') {
      const isoT = _modalDelBtn.dataset.templateIso;
      if (!isoT) return;
      const ok = await appConfirm({
        title: 'Marquer ce jour comme repos',
        message: 'Ignorer la suggestion IA et marquer ce jour comme repos ?',
        confirmLabel: 'Marquer en repos',
        danger: true,
      });
      if (!ok) return;
      addTemplateRestDay(isoT);
      closeSessionModal();
      if (typeof renderCalendar === 'function') renderCalendar();
    }
  });
}

// Ouvre la modal d'ajout de compétition en mode édition (préremplie + sauvegarde update)
// Helper : applique l'état visuel "fichier sélectionné" au file-picker compé
function _setCompModalGpxVisual(gpxName) {
  const gpxEl = document.getElementById('comp-modal-gpx');
  if (!gpxEl) return;
  const picker = gpxEl.closest('.file-picker');
  if (!picker) return;
  const lbl = picker.querySelector('.file-picker-label');
  const clr = picker.querySelector('.file-picker-clear');
  if (gpxName) {
    picker.classList.add('has-file');
    if (lbl) lbl.textContent = gpxName;
    if (clr) clr.hidden = false;
  } else {
    picker.classList.remove('has-file');
    if (lbl) lbl.textContent = 'Choisir un fichier GPX';
    if (clr) clr.hidden = true;
  }
}

function openCompModalForEdit(comp) {
  if (typeof openCompModal !== 'function') return;
  openCompModal();
  // Marque le mode édition
  window._editingCompId = comp.id;
  // Pré-remplit les champs principaux
  document.getElementById('comp-modal-name').value = comp.name || '';
  document.getElementById('comp-modal-date').value = comp.date || '';
  if (document.getElementById('comp-modal-date')._flatpickr && comp.date) {
    document.getElementById('comp-modal-date')._flatpickr.setDate(comp.date, false);
  }
  // Time
  if (comp.time && window.resetTimeStepper) {
    const [h, m] = comp.time.split(':').map(n => parseInt(n, 10) || 0);
    window.resetTimeStepper('comp-modal-time', h, m);
  }
  // Selects (priority, sport, type)
  ['priority', 'sport', 'type'].forEach(k => {
    const el = document.getElementById('comp-modal-' + k);
    if (el && comp[k] !== undefined && comp[k] !== null) {
      el.value = (k === 'priority') ? compPrio(comp[k]).key : comp[k];
      if (el._customUpdate) el._customUpdate();
    }
  });
  if (typeof populateTypeSelectForSport === 'function' && comp.sport) {
    populateTypeSelectForSport(comp.sport);
    const t = document.getElementById('comp-modal-type');
    if (t && comp.type) { t.value = comp.type; if (t._customUpdate) t._customUpdate(); }
  }
  // Champs simples — si GPX présent, calcule km/dplus depuis le GPX (vérité terrain)
  // et écrase les valeurs manuelles (l'utilisateur veut que ça reflète le fichier)
  let effKm = comp.km, effDplus = comp.dplus;
  if (comp.gpxContent && typeof extractGpxStats === 'function') {
    const gs = extractGpxStats(comp.gpxContent, parseInt(comp.laps, 10) || 1);
    if (gs) {
      effKm = gs.km;
      effDplus = gs.dplus;
    }
  }
  document.getElementById('comp-modal-km').value = effKm != null ? effKm : '';
  document.getElementById('comp-modal-dplus').value = effDplus != null ? effDplus : '';
  {
    if (typeof resetTriPanes === 'function') resetTriPanes();
    // Tri legacy : donnees globales presentes mais aucun segment -> bloc standard visible
    const _hasSeg = comp.tri && (comp.tri.swim || comp.tri.bike || comp.tri.run || comp.tri.swim_m || comp.tri.bike_km || comp.tri.run_km);
    window._compEditLegacyStd = !_hasSeg && !!(comp.km || comp.target || comp.dplus);
    const t = comp.tri || {};
    const setV = (id, v) => { const e = document.getElementById(id); if (e && v != null && v !== '') e.value = v; };
    const sw = t.swim || {}, bk = t.bike || {}, rn = t.run || {};
    setV('comp-tri-nat-time', sw.min ? fmtSegTime(sw.min) : null);
    setV('comp-tri-nat-dist', sw.dist_m != null ? sw.dist_m : t.swim_m);
    setV('comp-tri-nat-pace', sw.pace);
    setV('comp-tri-t1-time', t.t1_min ? fmtSegTime(t.t1_min) : null);
    setV('comp-tri-bike-time', bk.min ? fmtSegTime(bk.min) : null);
    setV('comp-tri-bike-dist', bk.dist_km != null ? bk.dist_km : t.bike_km);
    setV('comp-tri-bike-speed', bk.speed);
    setV('comp-tri-bike-dplus', bk.dplus);
    setV('comp-tri-t2-time', t.t2_min ? fmtSegTime(t.t2_min) : null);
    setV('comp-tri-run-time', rn.min ? fmtSegTime(rn.min) : null);
    setV('comp-tri-run-dist', rn.dist_km != null ? rn.dist_km : t.run_km);
    setV('comp-tri-run-pace', rn.pace);
    // Vitesse moyenne (std) recalculée si temps + distance connus
    const spd = document.getElementById('comp-modal-speed');
    const tm2 = parseTimeToMin(comp.target), km3 = +comp.km || null;
    if (spd) { spd.value = (tm2 && km3) ? +(km3 / (tm2 / 60)).toFixed(1) : ''; if (spd.value) spd.dataset.auto = '1'; }
  }
  setTimeout(() => { if (typeof adaptCompSportForm === 'function') adaptCompSportForm(); }, 0);
  document.getElementById('comp-modal-target').value = fmtMinToTime(comp.target);
  document.getElementById('comp-modal-laps').value = comp.laps != null ? comp.laps : '';
  document.getElementById('comp-modal-notes').value = comp.notes || '';
  // Toggle stages + remplissage stagesData si applicable
  const stagesToggle = document.getElementById('comp-modal-stages-toggle');
  if (stagesToggle) {
    stagesToggle.checked = !!comp.stages;
    if (comp.stages && Array.isArray(comp.stagesList) && comp.stagesList.length) {
      stagesData = comp.stagesList.map(s => ({
        date: s.date || '',
        time: s.time || '',
        type: s.type || '',
        km: s.km != null ? String(s.km) : '',
        dplus: s.dplus != null ? String(s.dplus) : '',
        target: s.target != null ? s.target : null,
        laps: s.laps != null ? String(s.laps) : '',
        notes: s.notes || '',
        gpxName: s.gpxName || null,
        gpxContent: s.gpxContent || null, // conserve le contenu en mémoire
        gpxFile: null, // les fichiers File API ne peuvent pas être pré-remplis
      }));
      activeStageIdx = 0;
      const tabsBar = document.getElementById('comp-stages-tabs');
      if (tabsBar) tabsBar.hidden = false;
      renderStageTabs();
      writeStageToForm(stagesData[0]);
      // Force l'affichage du nom GPX de l'étape 0 dans le picker
      _setCompModalGpxVisual(stagesData[0].gpxName);
    } else {
      // Compé simple : restaure le picker GPX si présent au niveau racine
      _setCompModalGpxVisual(comp.gpxName);
    }
  } else {
    _setCompModalGpxVisual(comp.gpxName);
  }
  // Adapter le titre + label du bouton "Enregistrer"
  const titleH2 = document.querySelector('#comp-modal .modal-title h2');
  if (titleH2) titleH2.textContent = 'Modifier la compétition';
  const saveBtn = document.getElementById('comp-modal-save');
  if (saveBtn) saveBtn.textContent = 'Enregistrer les modifications';
  // Affiche le bouton poubelle (uniquement en édition)
  const delBtn = document.getElementById('comp-modal-delete');
  if (delBtn) delBtn.hidden = false;
  // Bouton "Transformer en entrainement" : uniquement pour une compet REALISEE (activite en base).
  const _toTrain = document.getElementById('comp-modal-to-training');
  if (_toTrain) {
    const _isRealisedAct = !!(comp._sbId && (comp._table === 'activity' || comp.realised === true));
    _toTrain.hidden = !_isRealisedAct;
    window._compToTrainingAct = _isRealisedAct ? { _sbId: comp._sbId, category: 'competition', name: comp.name, sport: comp.sport } : null;
    window._compToTrainingIso = comp.date || null;
  }
}

// Handler suppression compé depuis la modal d'édition
const _compModalDelBtn = document.getElementById('comp-modal-delete');
if (_compModalDelBtn) {
  _compModalDelBtn.addEventListener('click', async () => {
    const id = window._editingCompId;
    if (!id) return;
    const comp = (typeof loadCompetitions === 'function') ? loadCompetitions().find(c => c.id === id) : null;
    const name = comp ? comp.name : 'cette compétition';
    const ok = await appConfirm({
      title: 'Supprimer cette compétition',
      html: `Supprimer <strong>${window._confirmEscape(name)}</strong> ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const remaining = loadCompetitions().filter(c => c.id !== id);
    saveCompetitions(remaining);
    window._editingCompId = null;
    if (typeof closeCompModal === 'function') closeCompModal();
    if (typeof renderCompList === 'function') renderCompList();
    if (typeof renderCalendar === 'function') renderCalendar();
  });
}
document.getElementById('session-modal').addEventListener('click', (e) => {
  if (e.target.id === 'session-modal') closeSessionModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSessionModal();
});

// Handlers des sous-onglets
document.querySelectorAll('#calendar-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#calendar-subtabs .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    calendarMode = btn.dataset.mode;
    // Reset selectedMonth mais on garde le mois courant affiché dans l'input
    selectedMonth = null;
    calendarAnchorDate = null;
    document.getElementById('month-input').value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}`;
    renderCalendar();
  });
});

// Handlers du filtre mois
const monthInput = document.getElementById('month-input');
// Pré-remplit avec le mois courant à l'init (sans changer selectedMonth = vue par défaut)
monthInput.value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}`;

// Overlay "4 sem" : en vue 4 dernières semaines (selectedMonth null), on masque le mois
// affiché par l'input natif et on superpose "4 sem" pour ne pas tromper l'utilisateur.
(function setupMonthOverlay() {
  const wrap = document.createElement('span');
  wrap.className = 'month-input-wrap';
  monthInput.parentNode.insertBefore(wrap, monthInput);
  wrap.appendChild(monthInput);
  const overlay = document.createElement('span');
  overlay.className = 'month-input-overlay';
  overlay.textContent = '4 sem';
  wrap.appendChild(overlay);
  window.__updateMonthOverlay = function () {
    const fourWeek = (selectedMonth === null);
    overlay.style.display = fourWeek ? '' : 'none';
    monthInput.classList.toggle('hide-value', fourWeek);
  };
  window.__updateMonthOverlay();
})();
document.getElementById('month-prev').addEventListener('click', () => {
  calendarAnchorDate = null;
  const base = selectedMonth || new Date(today.getFullYear(), today.getMonth(), 1);
  selectedMonth = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  monthInput.value = `${selectedMonth.getFullYear()}-${(selectedMonth.getMonth()+1).toString().padStart(2,'0')}`;
  renderCalendar();
});
document.getElementById('month-next').addEventListener('click', () => {
  calendarAnchorDate = null;
  if (selectedMonth === null) {
    // Depuis la vue "4 sem" : le clic → affiche le mois en cours (pas le mois suivant)
    selectedMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  } else {
    selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1);
  }
  monthInput.value = `${selectedMonth.getFullYear()}-${(selectedMonth.getMonth()+1).toString().padStart(2,'0')}`;
  renderCalendar();
});
monthInput.addEventListener('change', () => {
  calendarAnchorDate = null;
  if (!monthInput.value) {
    selectedMonth = null;
  } else {
    const [y, m] = monthInput.value.split('-').map(Number);
    selectedMonth = new Date(y, m - 1, 1);
  }
  renderCalendar();
});
document.getElementById('month-reset').addEventListener('click', () => {
  selectedMonth = null;
  calendarAnchorDate = null;
  // Garde le mois courant affiché visuellement (au lieu de tout vider)
  monthInput.value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}`;
  renderCalendar();
});

// ========= CHAT COACH IA =========
const CHAT_KEY = 'coach_ia_chat_v1';
const PREFS_KEY = 'coach_ia_prefs_v1';

function loadChatMessages() {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || []; }
  catch { return []; }
}
function saveChatMessages(msgs) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-50))); // garder max 50 derniers
}
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
  catch { return {}; }
}
function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

const PREF_LABELS = {
  recoveryMode: 'Mode récup activé',
  hardMode: 'Mode pousser',
  blocked: 'Repos forcé (blessure)',
  focusZone_seuil: 'Focus : Seuil',
  focusZone_vo2: 'Focus : VO2max',
  focusZone_endurance: 'Focus : Endurance',
  focusZone_force: 'Focus : Force',
  sleepConcern: 'Sommeil dégradé',
  stressMode: 'Stress signalé',
};

function renderChatPrefs() {
  const prefs = loadPrefs();
  const el = document.getElementById('chat-prefs');
  if (!el) return; // UI chat retirée
  const tags = [];
  if (prefs.recoveryMode) tags.push(PREF_LABELS.recoveryMode);
  if (prefs.hardMode) tags.push(PREF_LABELS.hardMode);
  if (prefs.blocked) tags.push(PREF_LABELS.blocked);
  if (prefs.focusZone) tags.push(PREF_LABELS['focusZone_' + prefs.focusZone] || `Focus : ${prefs.focusZone}`);
  if (prefs.sleepConcern) tags.push(PREF_LABELS.sleepConcern);
  if (prefs.stressMode) tags.push(PREF_LABELS.stressMode);
  if (tags.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `<span style="color:var(--text-dim);font-size:11px;margin-right:6px;">Préférences actives :</span>` +
    tags.map(t => `<span class="chat-pref-tag">${t}</span>`).join('');
}

function renderChat() {
  const messages = loadChatMessages();
  const container = document.getElementById('chat-messages');
  if (!container) return; // UI chat retirée
  if (messages.length === 0) {
    container.innerHTML = `<div class="chat-empty">
      Démarre la conversation avec ton Coach IA.<br>
      Exemples : "Je me sens fatigué cette semaine" · "Je veux travailler mon seuil" · "J'ai mal au genou" · "Bien dormi, en forme aujourd'hui"
    </div>`;
    return;
  }
  container.innerHTML = messages.map(m => `
    <div class="chat-message ${m.role}">
      <div class="chat-avatar ${m.role}">${m.role === 'user' ? 'TOI' : 'IA'}</div>
      <div class="chat-bubble-wrap">
        <div class="chat-bubble">${m.text}</div>
        <div class="chat-time">${m.time}</div>
      </div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
  renderChatPrefs();
}

function generateCoachResponse(userText) {
  const t = userText.toLowerCase();
  const tsb = todayData?.tsb ?? 0;
  const rec = todayData?.recovery;
  const ctxTSB = tsb < -15 ? ` Ton TSB actuel (${tsb.toFixed(0)}) confirme.` : tsb > 5 ? ` Ton TSB est positif (+${tsb.toFixed(0)}), c'est cohérent.` : '';
  const ctxRec = rec != null ? ` Recovery Whoop du jour : ${rec}%.` : '';

  // Détection d'intentions (ordre de priorité)
  if (/blesse|blessé|blessee|douleur|mal au|mal a la|tendinit|claqu|knee|genou|cheville|dos|épaule|coude|poignet/.test(t)) {
    return {
      message: `Important : ne t'entraîne pas avec une douleur. Repos complet jusqu'à disparition.\n\nSi ça persiste plus de 3-5 jours ou empire, consulte un kiné ou un médecin du sport — c'est non négociable.\n\nJe passe ton plan en mode repos forcé. Quand tu vas mieux, dis-moi pour reprendre progressivement.`,
      prefs: { recoveryMode: true, blocked: true }
    };
  }
  if (/fatig|crevé|crevee|épuis|epuis|nase|usé|usee|kacho|ko|naze/.test(t)) {
    return {
      message: `Compris, fatigue signalée.${ctxTSB}${ctxRec}\n\nJe vais alléger les séances :\n• Pas de blocs VO2max\n• Focus endurance Z2 et récupération active\n• Si la fatigue persiste 2-3 jours, on bascule en semaine de décharge\n\nDors bien, hydrate-toi, mange protéiné.`,
      prefs: { recoveryMode: true, blocked: false }
    };
  }
  if (/frais|en forme|reposé|reposee|pleine forme|envie de pousser|au top|peche|pêche/.test(t)) {
    return {
      message: `Top, tu es frais.${ctxTSB}${ctxRec} Bonne fenêtre pour pousser.\n\nJe peux densifier la semaine avec :\n• Un bloc de seuil supplémentaire\n• Ou un VO2max si ton TSB le permet\n\nTu veux travailler quoi en priorité ? Seuil, VO2max, endurance, force ?`,
      prefs: { hardMode: true, recoveryMode: false, blocked: false }
    };
  }
  if (/seuil|ftp|threshold/.test(t)) {
    return {
      message: `OK, focus sur le seuil.\n\nFormat type : 2 séances/sem de 3×12min ou 4×8min à 95-105% FTP, récup 3-5min.\n\nObjectif : pousser ton FTP dans 4-6 semaines. Re-test FTP dans 4 semaines pour mesurer.`,
      prefs: { focusZone: 'seuil' }
    };
  }
  if (/vo2|vmax|aerobie max|aérobie max/.test(t)) {
    return {
      message: `Compris, VO2max comme axe de travail.\n\nFormat type : 4×4min ou 6×3min à 110-115% FTP, récup 1:1.\nTrès exigeant → 1-2 fois/semaine max, jamais 2 jours de suite.\n\nLa phase Peak de ton plan se déclenche.`,
      prefs: { focusZone: 'vo2' }
    };
  }
  if (/endur|volume|sortie longue|fond|base aerobie|base aérobie/.test(t)) {
    return {
      message: `Bon choix, construire la base aérobie c'est la fondation.\n\nPlan : sorties Z2 longues le week-end (>2h), volume hebdo augmenté de 10% max/semaine. Reste sous 75% FTP, conversation aisée.\n\nC'est moins glamour mais c'est ce qui paie sur la durée.`,
      prefs: { focusZone: 'endurance' }
    };
  }
  if (/force|muscu|musculation|gainage|renfo/.test(t)) {
    return {
      message: `OK, focus force/musculation.\n\n2-3 séances/sem en complément du vélo, format : 4-5 exos polyarticulaires (squat, deadlift, presse, gainage), 3-4 séries de 5-8 reps lourdes.\n\nÉvite le jour avant une grosse séance vélo.`,
      prefs: { focusZone: 'force' }
    };
  }
  if (/sommeil|dormi mal|mal dormi|insomnie|nuit courte|fatigue chronique/.test(t)) {
    return {
      message: `Le sommeil c'est 50% de la récupération.\n\nSi tu dors mal 2+ nuits, j'allège auto le plan : pas plus que Z3 le lendemain.\n\nConseils : couche-toi 30min plus tôt, magnesium le soir, pas d'écran 30min avant. Si chronique, vérifie ton stress et ta charge globale.`,
      prefs: { sleepConcern: true }
    };
  }
  if (/stress|boulot|travail|charge mentale|presse|pressé|pressee/.test(t)) {
    return {
      message: `Stress non-sportif = fatigue cumulative pour le corps.\n\nJe réduis l'intensité cette semaine. Privilégie aussi des séances "plaisir" courtes (1h Z2) au lieu de tout planifier dur.\n\nLa séance dure quand tu es déjà stressé peut empirer les choses.`,
      prefs: { stressMode: true }
    };
  }
  if (/decharge|décharge|recup|récup|récupération|recuperation/.test(t)) {
    return {
      message: `OK, semaine de décharge.\n\nFormat : volume réduit de 30-50%, intensité conservée mais blocs courts. Format type : 3 sorties Z2 courtes + 1 séance modérée.\n\nL'objectif est de surcompenser pour repartir frais la semaine suivante.`,
      prefs: { recoveryMode: true }
    };
  }
  if (/competition|compétition|course|objectif|preparation|préparation/.test(t)) {
    return {
      message: `Pour structurer la prépa, ajoute ta compétition dans la section "Compétitions à venir" en haut de l'onglet.\n\nJe gère ensuite automatiquement les phases :\n• Build (>8 sem)\n• Peak (4-8 sem)\n• Taper (1-4 sem)\n• Race week (< 1 sem)`,
      prefs: {}
    };
  }
  if (/^(merci|ok|d'accord|compris|bien|super|nickel)/.test(t)) {
    return {
      message: `Pas de souci, je note. Si tu changes d'avis ou veux ajuster, dis-le moi à tout moment.`,
      prefs: {}
    };
  }
  if (/^(salut|bonjour|hello|coucou|hey|yo)/.test(t)) {
    return {
      message: `Salut ! Prêt à bosser. Dis-moi comment tu te sens aujourd'hui, ce que tu veux travailler, ou si tu as des douleurs/contraintes.${ctxRec}${ctxTSB}`,
      prefs: {}
    };
  }
  // Réponse par défaut
  return {
    message: `Noté. Je tiens compte pour la suite.\n\nDis-moi par exemple :\n• Ta sensation du jour (frais / fatigué / douleur)\n• Ce que tu veux travailler (seuil / VO2 / endurance / force)\n• Ton sommeil, ton stress, des contraintes spécifiques`,
    prefs: {}
  };
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const messages = loadChatMessages();
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  messages.push({ role: 'user', text, time });

  const { message: response, prefs: newPrefs } = generateCoachResponse(text);
  messages.push({ role: 'coach', text: response, time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) });

  // Sauvegarder préférences extraites
  if (newPrefs && Object.keys(newPrefs).length > 0) {
    const cur = loadPrefs();
    Object.assign(cur, newPrefs);
    savePrefs(cur);
  }

  saveChatMessages(messages);
  input.value = '';
  renderChat();
  // Re-render du calendrier pour appliquer les nouvelles préfs
  if (typeof renderCalendar === 'function') renderCalendar();
}

// Chat handlers — défensifs car le UI chat a été retiré de PANEL 2 (Entraîneur)
const _chatSendBtn = document.getElementById('chat-send');
if (_chatSendBtn) _chatSendBtn.addEventListener('click', sendChatMessage);
const _chatInputEl = document.getElementById('chat-input');
if (_chatInputEl) _chatInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});
const _chatClearBtn = document.getElementById('chat-clear');
if (_chatClearBtn) _chatClearBtn.addEventListener('click', async () => {
  const ok = await appConfirm({
    title: 'Effacer la conversation',
    message: 'Effacer la conversation et les préférences enregistrées ?',
    confirmLabel: 'Effacer',
    danger: true,
  });
  if (!ok) return;
  localStorage.removeItem(CHAT_KEY);
  localStorage.removeItem(PREFS_KEY);
  renderChat();
  if (typeof renderCalendar === 'function') renderCalendar();
});

try { renderChat(); } catch (e) { console.warn('[renderChat]', e); }

// ========= INTÉGRATION DES PRÉFÉRENCES DANS LE PLAN =========
// Patch sur adjustForRecovery pour aussi appliquer les prefs du chat
const _originalAdjustForRecovery = adjustForRecovery;
// eslint-disable-next-line no-func-assign -- monkey-patch volontaire (wrap de la fonction d'origine)
adjustForRecovery = function(proposal, recovery) {
  let p = _originalAdjustForRecovery(proposal, recovery);
  const prefs = loadPrefs();
  if (prefs.blocked && p.type !== 'rest') {
    return { ...p, type: 'rest', name: 'Repos forcé (douleur signalée)', dur: 0, tss: 0, why: 'Repos demandé suite à signalement de douleur — reprendre quand ça va mieux' };
  }
  if (prefs.recoveryMode && (p.type === 'vo2' || p.type === 'seuil')) {
    return { ...p, type: 'endurance', name: 'Endurance Z2 (mode récup activé)', dur: Math.round(p.dur * 0.7), tss: Math.round(p.tss * 0.55), why: 'Mode récup activé via chat — intensité allégée' };
  }
  if (prefs.hardMode && p.type === 'endurance' && p.tss < 80) {
    return { ...p, name: p.name + ' (renforcé)', tss: Math.round(p.tss * 1.2), why: 'Mode pousser activé via chat — un peu plus de stimulation' };
  }
  if (prefs.focusZone === 'seuil' && p.type === 'endurance' && p.tss > 50) {
    return { ...p, type: 'tempo', name: 'Sweet Spot (focus seuil)', tss: Math.round(p.tss * 1.15), why: 'Focus seuil via chat — endurance remplacée par sweet spot' };
  }
  return p;
};

// Init
renderCompList();
renderCalendar();

// ========= PANEL 3: LONG TERME (robuste aux nulls Whoop) =========
// Rolling average qui ignore les nulls (renvoie null si aucun point dans la fenêtre)
const rolling = (arr, n) => arr.map((_, i, a) => {
  const s = a.slice(Math.max(0, i-n+1), i+1).filter(v => v != null);
  if (s.length === 0) return null;
  return +(s.reduce((x,y)=>x+y,0)/s.length).toFixed(1);
});
const hrv7 = rolling(data.map(d=>d.hrv), 7);

new Chart(document.getElementById('chart-hrv'), {
  type: 'line',
  data: { labels, datasets: [{ data: hrv7, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.15)', tension: 0.3, pointRadius: 0, fill: true, spanGaps: false }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { title: { display: true, text: 'ms' } } } }
});

// Sommeil : 30 derniers jours, nulls → barre vide
const sleepSlice = data.slice(-30);
new Chart(document.getElementById('chart-sleep'), {
  type: 'bar',
  data: {
    labels: sleepSlice.map(d => fmtDate(d.date)),
    datasets: [{
      data: sleepSlice.map(d => d.sleepH),
      backgroundColor: sleepSlice.map(d => d.sleepH == null ? '#2a3142' : d.sleepH < 6.5 ? '#f87171' : d.sleepH < 7 ? '#fbbf24' : '#4ade80'),
      borderRadius: 2
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => ctx.parsed.y == null ? 'Pas de donnée Whoop' : ctx.parsed.y + ' h' } }
    },
    scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { min: 0, ticks: { callback: (v) => v + 'h' } } }
  }
});

const ratio = data.map(d => d.ctl > 0 ? +(d.atl / d.ctl).toFixed(2) : 1);
new Chart(document.getElementById('chart-ratio'), {
  type: 'line',
  data: { labels, datasets: [
    { data: ratio, borderColor: '#fbbf24', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0 },
    { data: data.map(()=>1.3), borderColor: 'rgba(248,113,113,0.5)', borderDash: [3,3], pointRadius: 0 },
    { data: data.map(()=>0.8), borderColor: 'rgba(74,222,128,0.5)', borderDash: [3,3], pointRadius: 0 }
  ] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { title: { display: true, text: 'ATL/CTL' }, min: 0.5, max: 1.6 } } }
});

new Chart(document.getElementById('chart-ctl-trend'), {
  type: 'line',
  data: {
    labels,
    datasets: [{ label: 'CTL', data: data.map(d=>d.ctl), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', tension: 0.3, pointRadius: 0, fill: true }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { ticks: { maxTicksLimit: 10 }, grid: { display: false } }, y: { title: { display: true, text: 'CTL (fitness)' } } }
  }
});

// Alertes long-terme — calculées sur les vraies données
const alerts = [];

// 1. Évolution CTL sur 90j
const last90 = data.slice(-90);
if (last90.length >= 30) {
  const ctlStart = last90[0].ctl;
  const ctlEnd = last90[last90.length - 1].ctl;
  const ctlPct = ctlStart > 0 ? Math.round((ctlEnd - ctlStart) / ctlStart * 100) : 0;
  alerts.push({
    class: ctlPct > 5 ? 'good' : ctlPct < -10 ? 'danger' : 'warn',
    title: `Évolution de la forme : ${ctlPct >= 0 ? '+' : ''}${ctlPct}% sur 90 jours`,
    body: `CTL passé de ${ctlStart.toFixed(0)} à ${ctlEnd.toFixed(0)}. ${ctlPct > 10 ? 'Progression saine.' : ctlPct < -10 ? 'Régression — vérifier la cause (blessure, pause, démotivation).' : ctlPct > 0 ? 'Progression légère.' : 'Forme stable.'}`
  });
}

// 2. Ratio ATL/CTL : périodes à risque
const riskDays = data.filter(d => d.ctl > 10 && d.atl / d.ctl > 1.3).length;
if (riskDays > 0) {
  alerts.push({
    class: riskDays > 14 ? 'danger' : 'warn',
    title: `Ratio ATL/CTL > 1.3 sur ${riskDays} jour${riskDays>1?'s':''}`,
    body: riskDays > 14 ? 'Plusieurs périodes de surcharge — risque de blessure majoré. Bien intercaler des semaines de décharge.' : 'Période ponctuelle de surcharge bien gérée.'
  });
} else if (data.length > 30) {
  alerts.push({
    class: 'good',
    title: 'Aucune surcharge aiguë détectée',
    body: 'Ratio ATL/CTL toujours sous 1.3 → tu absorbes ta charge sans pic de risque.'
  });
}

// 3. HRV — seulement si données réelles
const realHrv = data.filter(d => d.whoopSource === 'real' && d.hrv != null);
if (realHrv.length >= 3) {
  const avgHrv = realHrv.reduce((s,d)=>s+d.hrv,0) / realHrv.length;
  const stdHrv = Math.sqrt(realHrv.reduce((s,d)=>s+Math.pow(d.hrv-avgHrv,2),0) / realHrv.length);
  alerts.push({
    class: stdHrv < 8 ? 'good' : 'warn',
    title: `HRV moyenne ${avgHrv.toFixed(0)} ms (σ ${stdHrv.toFixed(1)})`,
    body: stdHrv < 8 ? 'Variabilité faible → état de récup stable.' : 'Variabilité élevée → état fluctuant. Surveiller les soirs avant séance dure.'
  });
} else {
  alerts.push({
    class: 'warn',
    title: 'HRV : pas assez de données Whoop',
    body: `Seulement ${realHrv.length} jour${realHrv.length>1?'s':''} de mesures HRV réelles. Les analyses long-terme demandent 14j+.`
  });
}

// 4. Sommeil — seulement si données réelles
const realSleep = data.filter(d => d.whoopSource === 'real' && d.sleepH != null);
if (realSleep.length >= 3) {
  const avgSleep = realSleep.reduce((s,d)=>s+d.sleepH,0) / realSleep.length;
  const shortNights = realSleep.filter(d => d.sleepH < 7).length;
  alerts.push({
    class: avgSleep >= 7.5 && shortNights < realSleep.length * 0.3 ? 'good' : 'warn',
    title: `Sommeil moyen ${avgSleep.toFixed(1)}h · ${shortNights}/${realSleep.length} nuit${realSleep.length>1?'s':''} < 7h`,
    body: avgSleep >= 7.5 ? 'Volume correct. Les jours après une nuit courte sont à modérer en intensité.' : 'Volume insuffisant — priorité au sommeil pour récupérer.'
  });
}

document.getElementById('alerts-list').innerHTML = alerts.map(a => `
  <div class="insight ${a.class}">
    <div class="insight-title">${a.title}</div>
    <div class="insight-body">${a.body}</div>
  </div>`).join('');

// ========= PANEL 4: SESSIONS =========
let sessions = [];
// Index plat de toutes les activités (une ligne = une activité, pas un jour),
// pour la recherche par titre + filtre sport.
function buildActivityIndex() {
  const out = [];
  for (const d of data) {
    const acts = (d.activities && d.activities.length)
      ? d.activities
      : (d.sessionName ? [{ ...d, name: d.sessionName }] : []);
    for (const a of acts) {
      const dt = a.start_date_local ? new Date(a.start_date_local) : d.date;
      out.push({
        ...a,
        sessionName: a.name || d.sessionName || '—',
        date: (dt instanceof Date && !isNaN(dt)) ? dt : d.date,
        recovery: d.recovery ?? null,
        compliance: null,
      });
    }
  }
  out.sort((x, y) => y.date - x.date);
  return out;
}

function populateActSportFilter(allActs) {
  const sel = document.getElementById('act-sport-filter');
  if (!sel || sel.dataset.filled) return;
  const labels = new Set();
  for (const a of allActs) {
    const label = window.activitySportLabel ? window.activitySportLabel(a) : (a.sport || '');
    if (label) labels.add(label);
  }
  const opts = [...labels].sort((a, b) => a.localeCompare(b, 'fr'));
  sel.innerHTML = '<option value="">Tous les sports</option>'
    + opts.map(o => `<option value="${o}">${o}</option>`).join('');
  sel.dataset.filled = '1';
}

const fmtSearchDate = d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Valeur d'un input (chaîne vide si vide/absent)
const _fv = id => { const el = document.getElementById(id); return el && el.value !== '' ? el.value : ''; };
// val dans [min, max] ? (bornes vides ignorées ; valeur nulle exclue si une borne active)
function _inRange(val, min, max) {
  if (min !== '' && (val == null || val < +min)) return false;
  if (max !== '' && (val == null || val > +max)) return false;
  return true;
}

// Tri du tableau d'activités
let _actSort = { key: 'date', dir: 'desc' };
function _sortVal(a, key) {
  switch (key) {
    case 'sport': return (window.activitySportLabel ? window.activitySportLabel(a) : (a.sport || '')).toLowerCase();
    case 'date': return (a.date instanceof Date) ? a.date.getTime() : 0;
    case 'title': return (a.sessionName || '').toLowerCase();
    case 'duration': return a.duration || 0;
    case 'distance': return a.distance_km || 0;
    case 'elevation': return a.elevation_gain || 0;
    case 'tss': return a.tss || 0;
    default: return 0;
  }
}
function sortActs(arr) {
  const { key, dir } = _actSort;
  const mul = dir === 'asc' ? 1 : -1;
  return arr.sort((x, y) => {
    const vx = _sortVal(x, key), vy = _sortVal(y, key);
    if (vx < vy) return -mul;
    if (vx > vy) return mul;
    return 0;
  });
}
function updateSortIndicators() {
  document.querySelectorAll('.session-table th.th-sort').forEach(th => {
    const isActive = th.dataset.sort === _actSort.key;
    th.classList.toggle('active', isActive);
    th.classList.toggle('sort-asc', isActive && _actSort.dir === 'asc');
    th.classList.toggle('sort-desc', isActive && _actSort.dir === 'desc');
  });
}

let _actSearchInited = false;
function renderSessionsTable() {
  const allActs = buildActivityIndex();
  populateActSportFilter(allActs);

  const sportF = document.getElementById('act-sport-filter')?.value || '';
  const distMin = _fv('act-dist-min'), distMax = _fv('act-dist-max');
  const durMin = _fv('act-dur-min'), durMax = _fv('act-dur-max');
  const dpMin = _fv('act-dplus-min'), dpMax = _fv('act-dplus-max');
  const tssMin = _fv('act-tss-min'), tssMax = _fv('act-tss-max');

  let filtered = allActs;
  if (sportF) filtered = filtered.filter(a => (window.activitySportLabel ? window.activitySportLabel(a) : a.sport) === sportF);
  filtered = filtered.filter(a => _inRange(a.distance_km, distMin, distMax));
  filtered = filtered.filter(a => _inRange(a.duration, durMin, durMax));
  filtered = filtered.filter(a => _inRange(a.elevation_gain, dpMin, dpMax));
  filtered = filtered.filter(a => _inRange(a.tss, tssMin, tssMax));

  const total = filtered.length;
  sortActs(filtered);
  updateSortIndicators();
  sessions = filtered.slice(0, 10);

  const tbody = document.getElementById('sessions-tbody');
  tbody.innerHTML = sessions.map((s, i) => {
    const sportLabel = window.activitySportLabel ? window.activitySportLabel(s) : (s.sport || '—');
    const sportCat = window.activitySportColorKey ? window.activitySportColorKey(s) : 'autre';
    const dist = s.distance_km != null
      ? (s.distance_km >= 100 ? Math.round(s.distance_km) : s.distance_km.toFixed(1)).toString().replace('.', ',') + ' km'
      : '—';
    const dplus = s.elevation_gain != null ? Math.round(s.elevation_gain) + ' m' : '—';
    return `
    <tr data-idx="${i}">
      <td><span class="sport-pill" data-sport-cat="${sportCat}">${sportLabel}</span></td>
      <td>${fmtSearchDate(s.date)}</td>
      <td class="act-title-cell">${s.sessionName}</td>
      <td>${fmtDur(s.duration)}</td>
      <td>${dist}</td>
      <td>${dplus}</td>
      <td>${s.tss || 0}</td>
    </tr>
    `;
  }).join('');

  const countEl = document.getElementById('act-search-count');
  if (countEl) countEl.textContent = total
    ? `${total} activité${total > 1 ? 's' : ''}${total > 10 ? ' · 10 affichées' : ''}`
    : 'Aucune activité ne correspond aux filtres.';

  if (!_actSearchInited) {
    _actSearchInited = true;
    const bar = document.getElementById('act-filter-bar');
    bar?.addEventListener('input', () => renderSessionsTable());
    bar?.addEventListener('change', () => renderSessionsTable());
    document.getElementById('act-filter-reset')?.addEventListener('click', () => {
      bar.querySelectorAll('input').forEach(i => { i.value = ''; });
      const sel = document.getElementById('act-sport-filter');
      if (sel) sel.value = '';
      renderSessionsTable();
    });
    document.querySelector('.session-table thead')?.addEventListener('click', (e) => {
      const th = e.target.closest('.th-sort');
      if (!th) return;
      const key = th.dataset.sort;
      if (_actSort.key === key) {
        _actSort.dir = _actSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _actSort.key = key;
        _actSort.dir = (key === 'title' || key === 'sport') ? 'asc' : 'desc';
      }
      renderSessionsTable();
    });
    // Clic sur une ligne → ouvre le détail de l'activité (sans bouger le calendrier)
    document.getElementById('sessions-tbody')?.addEventListener('click', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const s = sessions[+tr.dataset.idx];
      if (s && typeof openSessionModal === 'function') openSessionModal(toIsoDate(s.date), 'realise');
    });
  }
}
try { renderSessionsTable(); } catch (e) { console.error('[renderSessionsTable]', e); }

// ========= TABS =========
// ========= ONGLETS + routage par ancre (#entraineur, #bilan, #termes) =========
// p1 (Tableau de bord) = pas de hash. #profil est géré par profile-modal.js.
const PANEL_HASH = { p2: '#calendrier', p3: '#statistiques', p4: '#performance', p5: '#termes', p6: '#competitions', p7: '#ia' };
// '#bilan' conservé comme alias (anciens liens/favoris) → pointe toujours sur p3.
const HASH_PANEL = { '#calendrier': 'p2', '#statistiques': 'p3', '#performance': 'p4', '#bilan': 'p3', '#termes': 'p5', '#competitions': 'p6', '#ia': 'p7' };

function activatePanel(panelId, updateHash = true) {
  const panelEl = document.getElementById(panelId);
  const btn = document.querySelector(`.tab[data-panel="${panelId}"]`);
  if (!panelEl || !btn) return;
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  panelEl.classList.add('active');
  // Met à jour le titre de la barre supérieure avec le libellé de l'onglet actif.
  const _tbTitle = document.getElementById('topbar-title');
  if (_tbTitle) { const _lbl = btn.querySelector('span'); _tbTitle.textContent = _lbl ? _lbl.textContent : btn.textContent.trim(); }
  if (updateHash) {
    const h = PANEL_HASH[panelId] || '';
    if (h) {
      if (window.location.hash !== h) history.replaceState(null, '', h);
    } else if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => activatePanel(btn.dataset.panel, true));
});

// Active le bon onglet selon l'ancre (chargement initial + back/forward + lien partagé).
function syncTabFromHash() {
  const panelId = HASH_PANEL[window.location.hash];
  if (panelId) activatePanel(panelId, false); // ancres inconnues / vide / #profil → on ne force rien
}
window.addEventListener('hashchange', syncTabFromHash);
syncTabFromHash();

// Clic sur le logo / "Coach IA" → retour au Tableau de bord (ferme aussi
// profil / paramètres / aide en restaurant le header).
window.goHome = function () {
  document.querySelector('.tabs')?.classList.remove('profile-hidden');
  document.getElementById('sport-filter')?.style.setProperty('display', '');
  document.getElementById('mode-toggle')?.style.setProperty('display', '');
  const hi = document.querySelector('.header-info'); if (hi) hi.style.display = '';
  const ft = document.querySelector('footer'); if (ft) ft.style.display = '';
  const ob = document.getElementById('onboarding-banner'); if (ob) ob.style.display = '';
  ['profile-header-title', 'settings-header-title', 'help-header-title'].forEach(id => {
    const e = document.getElementById(id); if (e) e.style.display = 'none';
  });
  activatePanel('p1', true); // active le tableau de bord + nettoie l'ancre
};
const _logoEl = document.querySelector('header .logo');
if (_logoEl) {
  _logoEl.style.cursor = 'pointer';
  _logoEl.title = 'Retour au tableau de bord';
  _logoEl.addEventListener('click', () => window.goHome());
}

// ========= FILTRES SPORTS (boutons header) =========
document.querySelectorAll('#sport-filter .sport-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sport = btn.dataset.sport;
    if (sport === 'tout') {
      // Clic sur "Tout" : ne sélectionne QUE Tout
      activeSports.clear();
      activeSports.add('tout');
    } else {
      activeSports.delete('tout');
      if (activeSports.has(sport)) {
        activeSports.delete(sport);
      } else {
        activeSports.add(sport);
      }
      // Si plus rien de sélectionné, revenir sur Tout
      if (activeSports.size === 0) activeSports.add('tout');
      // Si TOUS les sports individuels sont sélectionnés → bascule sur Tout
      const individuals = ['cyclisme', 'course', 'musculation', 'natation', 'triathlon', 'autre'];
      if (individuals.every(s => activeSports.has(s))) {
        activeSports.clear();
        activeSports.add('tout');
      }
    }
    // MAJ visuelle des boutons
    document.querySelectorAll('#sport-filter .sport-btn').forEach(b => {
      b.classList.toggle('active', activeSports.has(b.dataset.sport));
    });
    applySportFilter();
  });
});

})(); // fin IIFE async

// ========= BOUTON REFRESH MANUEL =========
// Déclenche workflow_dispatch GitHub Actions via le Worker Cloudflare,
// poll jusqu'à la fin du run, puis recharge la page.
(function setupRefreshButton() {
  const btn = document.getElementById('refresh-btn');
  const icon = document.getElementById('refresh-icon');
  if (!btn || !icon) return;

  // Injecte le @keyframes spin si absent
  if (!document.getElementById('refresh-spin-style')) {
    const style = document.createElement('style');
    style.id = 'refresh-spin-style';
    style.textContent = '@keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  function setLoading(on, label) {
    btn.disabled = on;
    btn.classList.toggle('loading', on);
    if (on) {
      btn.style.color = 'var(--accent)';
      btn.style.borderColor = 'var(--accent)';
      icon.style.animation = 'refresh-spin 0.8s linear infinite';
      btn.title = label || 'Rafraîchissement en cours...';
    } else {
      btn.style.color = 'var(--text-dim)';
      btn.style.borderColor = 'var(--border)';
      icon.style.animation = '';
      btn.title = 'Rafraîchir maintenant';
    }
  }

  async function pollStatus(runId, maxSec = 180) {
    const start = Date.now();
    while ((Date.now() - start) / 1000 < maxSec) {
      try {
        const r = await fetch(`/api/refresh-status?runId=${runId}`, { credentials: 'include' });
        if (r.ok) {
          const j = await r.json();
          if (j.status === 'completed') return j.conclusion === 'success';
        }
      } catch (e) { /* on retente */ }
      await new Promise(res => setTimeout(res, 4000));
    }
    return false;
  }

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    setLoading(true, 'Déclenchement du run...');
    try {
      const resp = await fetch('/api/refresh', { method: 'POST', credentials: 'include' });
      if (!resp.ok) {
        const txt = await resp.text();
        await appAlert({
          title: 'Erreur de déclenchement',
          message: `HTTP ${resp.status}\n${txt.slice(0, 200)}`,
        });
        setLoading(false);
        return;
      }
      const { runId } = await resp.json();
      setLoading(true, 'Récupération Strava + Whoop...');
      const ok = await pollStatus(runId);
      if (ok) {
        // Reload avec cache-bust pour forcer la nouvelle data.js
        location.reload();
      } else {
        await appAlert({
          title: 'Échec du run',
          message: 'Le run GitHub Actions a échoué ou pris trop de temps. Voir https://github.com/Yanisjaber/coach-ia/actions',
        });
        setLoading(false);
      }
    } catch (e) {
      await appAlert({
        title: 'Erreur réseau',
        message: e.message || String(e),
      });
      setLoading(false);
    }
  });
})();
