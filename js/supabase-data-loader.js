/* ============================================================
   js/supabase-data-loader.js — Charge les données depuis Supabase

   Au login : tente de charger toutes les données de l'utilisateur
   depuis les tables Supabase (activities, daily_metrics, power_profile,
   whoop_data, user_profile, strava_connections), reconstitue un objet
   identique à window.DASHBOARD_DATA et le set sur window.

   Fallback : si l'utilisateur n'est pas connecté OU si la BDD est vide
   pour cet user, on garde window.DASHBOARD_DATA chargé depuis data.js
   (le comportement legacy).

   Trigger un re-render complet de l'app après la load.
   ============================================================ */

let _currentUser = null;
let _loadInProgress = false;
let _loadedUserId = null;

window.addEventListener('coach-ia-auth', async (e) => {
  _currentUser = e.detail.user || null;
  if (!_currentUser) { _loadedUserId = null; return; }

  // Déjà chargé pour cet utilisateur (ex : rafraîchissement de jeton au retour
  // d'onglet) → on ne recharge PAS et on n'affiche pas le voile (évite le flash).
  if (_currentUser.id === _loadedUserId) {
    if (window.hideBootOverlay) window.hideBootOverlay();
    return;
  }
  _loadedUserId = _currentUser.id;

  // Premier chargement (ou nouvel utilisateur) : on masque le dashboard pendant
  // le chargement pour ne pas laisser voir des zéros, puis on révèle.
  showLoadingOverlay();
  try {
    await loadFromSupabase();
  } catch (err) {
    console.error('[sb-data]', err);
  } finally {
    hideLoadingOverlay();
    if (window.hideBootOverlay) window.hideBootOverlay();
  }
});

// ============ OVERLAY DE CHARGEMENT ============
function showLoadingOverlay() {
  let el = document.getElementById('sb-loading-overlay');
  if (el) { el.classList.add('active'); return; }
  el = document.createElement('div');
  el.id = 'sb-loading-overlay';
  el.className = 'sb-loading-overlay active';
  el.innerHTML = `
    <div class="sb-loading-inner">
      <div class="sb-loading-spinner"></div>
      <div class="sb-loading-text">Chargement de tes données…</div>
    </div>
  `;
  document.body.appendChild(el);
  if (!document.getElementById('sb-loading-style')) {
    const s = document.createElement('style');
    s.id = 'sb-loading-style';
    s.textContent = `
      .sb-loading-overlay {
        position: fixed; inset: 0; background: var(--bg);
        z-index: 95000;
        display: none; align-items: center; justify-content: center;
        animation: sbFade 0.15s ease-out;
      }
      .sb-loading-overlay.active { display: flex; }
      @keyframes sbFade { from { opacity: 0; } to { opacity: 1; } }
      .sb-loading-inner {
        display: flex; flex-direction: column; align-items: center; gap: 16px;
      }
      .sb-loading-spinner {
        width: 42px; height: 42px;
        border: 3px solid var(--bg-elev2);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: sbSpin 0.7s linear infinite;
      }
      @keyframes sbSpin { to { transform: rotate(360deg); } }
      .sb-loading-text {
        color: var(--text-dim);
        font-size: 13px;
        font-weight: 500;
      }
    `;
    document.head.appendChild(s);
  }
}
function hideLoadingOverlay() {
  const el = document.getElementById('sb-loading-overlay');
  if (el) el.classList.remove('active');
}

// Colonnes "légères" des activités pour le chargement de masse.
// On EXCLUT volontairement streams_gz / streams_blob / gpx_blob / power_curve :
// ces blobs sont lourds (Mo par activité) et chargés à la demande seulement
// (voir loadStreams dans app.js). Charger tout d'un coup ferait des dizaines de Mo.
const ACTIVITY_LIGHT_COLS = [
  'id', 'strava_id', 'name', 'sport', 'sport_raw', 'tss',
  'moving_time', 'elapsed_time', 'start_date_local',
  'distance_km', 'total_elevation_gain', 'total_elevation_loss',
  'avg_speed_kmh', 'max_speed_kmh', 'max_speed_smooth_kmh',
  'np', 'avg_watts', 'max_watts', 'avg_heartrate', 'max_heartrate',
  'avg_cadence', 'max_cadence', 'kj', 'calories',
  'intensity', 'variability_index', 'zones_hr', 'zones_power',
  // Modèle unifié : catégorie + source + champs manuels/compétition
  'category', 'source', 'client_id', 'user_notes',
  'priority', 'target', 'course_dplus', 'laps', 'gpx_name', 'stages', 'event',
].join(',');

// Colonnes "safe" de strava_connections : SURTOUT PAS les tokens.
// La migration SQL révoque l'accès aux colonnes access_token/refresh_token
// pour le rôle authenticated → un select('*') renverrait une erreur 403.
const STRAVA_CONN_SAFE_COLS =
  'user_id, external_id, athlete_name, scope, first_connected_at, last_sync_at, last_sync_status, last_sync_error, total_activities_synced';

// Fetch paginé : Supabase limite à 1000 lignes par requête, on boucle si besoin.
async function fetchAllPaged(table, userId, orderCol, columns = '*') {
  const PAGE = 1000;
  const sb = window.sb;
  const out = [];
  let from = 0;
  while (true) {
    let q = sb.from(table).select(columns).eq('user_id', userId).range(from, from + PAGE - 1);
    if (orderCol) q = q.order(orderCol, { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function loadFromSupabase() {
  if (_loadInProgress || !_currentUser || !window.sb) return;
  _loadInProgress = true;
  console.log('[sb-data] Chargement des données depuis Supabase…');
  const sb = window.sb;
  const userId = _currentUser.id;

  try {
    // Charger les 6 sources en parallèle, avec pagination auto pour les grosses tables
    const [
      { data: profile },
      activities,
      dailyMetrics,
      powerProfile,
      whoopData,
      { data: stravaConnection },
      { data: whoopConnection },
      { data: powerProfileSport },
    ] = await Promise.all([
      sb.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
      fetchAllPaged('activities', userId, 'start_date_local', ACTIVITY_LIGHT_COLS),
      fetchAllPaged('daily_metrics', userId, 'iso_date'),
      fetchAllPaged('power_profile', userId, 'duration_s'),
      fetchAllPaged('whoop_data', userId, 'iso_date'),
      sb.from('connexions_app').select(STRAVA_CONN_SAFE_COLS).eq('user_id', userId).eq('app', 'strava').maybeSingle(),
      sb.from('connexions_app').select('user_id, last_sync_at').eq('user_id', userId).eq('app', 'whoop').maybeSingle(),
      sb.from('power_profile_sport').select('*').eq('user_id', userId),
    ]);

    // Si un import d'activités est en cours côté serveur (ex : rechargement pendant
    // le téléchargement), afficher une barre et attendre sa fin, puis recharger.
    maybeResumeIngest(stravaConnection, userId);

    // Si la BDD est vide pour cet user, on REMPLACE DASHBOARD_DATA par un dataset vide.
    if (!activities || activities.length === 0) {
      console.log('[sb-data] Aucune activité en BDD pour cet user — affichage compte vide');
      window.DASHBOARD_DATA = buildEmptyDataset(_currentUser, profile);
      triggerFullReload();
      // Bandeau d'onboarding UNIQUEMENT si AUCUN compte n'est connecté.
      // Si un compte est connecté (mais 0 activité), pas de bandeau — juste les
      // messages "aucune donnée" ; la (re)synchro se fait via la page Connexions.
      if (!stravaConnection && !whoopConnection) showOnboardingBanner();
      else hideOnboardingBanner();
      setTimeout(() => setEmptyDataOverlays(true), 400);
      _loadInProgress = false;
      return;
    }

    // Bandeau dès qu'AUCUN compte n'est connecté (même s'il reste d'anciennes
    // données en base après une déconnexion douce).
    if (!stravaConnection && !whoopConnection) showOnboardingBanner();
    else hideOnboardingBanner();
    setEmptyDataOverlays(false); // données présentes → on retire les messages vides

    const reconstituted = reconstituteData({
      profile, activities, dailyMetrics, powerProfile, whoopData, stravaConnection, whoopConnection, powerProfileSport,
    });

    // Remplace window.DASHBOARD_DATA
    window.DASHBOARD_DATA = reconstituted;
    console.log(`[sb-data] Chargé : ${activities.length} activités, ${dailyMetrics?.length || 0} jours, ${powerProfile?.length || 0} records puissance`);

    // Re-render complet de l'app
    triggerFullReload();

    // Carte Récupération Whoop : si pas de compte Whoop connecté, on affiche
    // "Aucune donnée Whoop" au lieu des "—".
    setTimeout(() => setWhoopCardEmpty(!whoopConnection), 250);

    // Reprise automatique du power profile : si des activités n'ont pas encore de
    // streams (ex : import interrompu par un rechargement), on relance la boucle
    // de lots de 40 + la barre, tout seul.
    maybeResumeStreams(stravaConnection, userId);

    // Rafraîchissement auto de Whoop (pas de webhook côté Whoop, contrairement à
    // Strava) : si connecté et dernière synchro ancienne, on relance un import
    // SILENCIEUX en arrière-plan, une seule fois par session.
    maybeRefreshWhoop(whoopConnection);
  } catch (e) {
    console.error('[sb-data] Erreur chargement Supabase:', e);
  } finally {
    _loadInProgress = false;
  }
}

// Affiche une barre et surveille un import d'activités en cours côté serveur
// (statut "running"), utile après un rechargement pendant le téléchargement.
let _ingestWatching = false;
function maybeResumeIngest(stravaConnection, userId) {
  if (!stravaConnection || _ingestWatching) return;
  if (window.coachSyncState && window.coachSyncState.strava && window.coachSyncState.strava.active) return; // déjà une synchro active
  const status = stravaConnection.last_sync_status;
  const ageMs = stravaConnection.last_sync_at ? Date.now() - new Date(stravaConnection.last_sync_at).getTime() : Infinity;
  if (status !== 'running' || ageMs > 3 * 60 * 1000) return; // pas d'import récent en cours

  _ingestWatching = true;
  const prog = window.coachBgProgress ? window.coachBgProgress('Import Strava') : null;
  const start = Date.now();
  const setSync = (active, pct, label) => {
    window.coachSyncState = window.coachSyncState || {};
    window.coachSyncState.strava = { active, pct: pct || 0, label: label || '' };
    window.dispatchEvent(new CustomEvent('strava-sync-progress', { detail: window.coachSyncState.strava }));
  };
  const tick = prog ? setInterval(() => {
    const p = Math.min(92, Math.round((Date.now() - start) / 30000 * 92));
    prog.update(p, 'Import des activités…');
    setSync(true, p, 'Import des activités…');
  }, 300) : null;

  const poll = async () => {
    try {
      const { data: conn } = await window.sb.from('connexions_app')
        .select('last_sync_status').eq('user_id', userId).eq('app', 'strava').maybeSingle();
      if (!conn || conn.last_sync_status !== 'running') {
        if (tick) clearInterval(tick);
        prog?.update(100, 'Activités importées');
        setSync(false, 100, '');
        setTimeout(() => prog?.close?.(), 600);
        _ingestWatching = false;
        setTimeout(() => loadFromSupabase(), 800); // recharge → affiche les activités + reprend le power profile
        return;
      }
    } catch (_) { /* on retentera */ }
    setTimeout(poll, 3000);
  };
  setTimeout(poll, 3000);
}

// Relance le backfill power profile s'il reste des activités sans streams.
async function maybeResumeStreams(stravaConnection, userId) {
  if (!stravaConnection || !window.startStravaStreams) return;
  // Pas de double lancement si une synchro tourne déjà.
  if (window.coachSyncState && window.coachSyncState.strava && window.coachSyncState.strava.active) return;
  try {
    const { count } = await window.sb.from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('streams_synced_at', null);
    if ((count || 0) > 0) {
      console.log(`[sb-data] ${count} activités sans streams → reprise auto du power profile`);
      window.startStravaStreams();
    }
  } catch (_) { /* silencieux */ }
}

// Rafraîchit Whoop en arrière-plan si la dernière synchro date de plus de 6h.
// Une seule fois par session (et l'import met à jour last_sync_at → pas de boucle).
let _whoopAutoRefreshed = false;
function maybeRefreshWhoop(whoopConnection) {
  if (!whoopConnection || _whoopAutoRefreshed || !window.startWhoopIngest) return;
  const ageMs = whoopConnection.last_sync_at
    ? Date.now() - new Date(whoopConnection.last_sync_at).getTime()
    : Infinity;
  if (ageMs < 6 * 60 * 60 * 1000) return; // déjà synchro récemment
  _whoopAutoRefreshed = true;
  console.log('[sb-data] Whoop : synchro auto en arrière-plan (dernière > 6h)');
  // 14 jours suffisent pour un refresh courant (recovery/sommeil récents).
  window.startWhoopIngest(14, { silent: true });
}

// ============ RECONSTITUTION FORMAT DASHBOARD_DATA ============
function reconstituteData({ profile, activities, dailyMetrics, powerProfile, whoopData, stravaConnection, whoopConnection, powerProfileSport }) {
  // On n'affiche les données Whoop QUE si un compte Whoop est réellement connecté.
  // (Évite d'afficher d'anciennes données simulées encore présentes en base.)
  if (!whoopConnection) whoopData = [];
  // 1) Athlete (incl. sexe + âge depuis extras → pour W/kg & barèmes)
  const _extras = (profile && profile.extras) || {};
  let _age = null;
  if (_extras.x_birth_date) {
    const b = new Date(_extras.x_birth_date);
    if (!isNaN(b)) { _age = Math.floor((Date.now() - b.getTime()) / (365.25 * 86400000)); }
  }
  const athlete = {
    id: stravaConnection?.external_id ? String(stravaConnection.external_id) : '',
    name: profile?.display_name || stravaConnection?.athlete_name || 'Athlete',
    ftp: profile?.ftp || 0,
    hr_max: profile?.hr_max || 0,
    lthr: profile?.lthr || 0,
    weight: profile?.weight || 0,
    sex: _extras.x_sex || null,          // 'M' | 'F'
    birth_date: _extras.x_birth_date || null,
    age: _age,                            // années (entier) ou null
  };

  // 2) Index activités par iso_date
  const actsByDate = {};
  for (const a of activities || []) {
    const iso = a.start_date_local ? String(a.start_date_local).slice(0, 10) : null;
    if (!iso) continue;
    if (!actsByDate[iso]) actsByDate[iso] = [];
    actsByDate[iso].push({
      id: a.strava_id != null ? String(a.strava_id) : String(a.id),
      _sbId: a.id,                          // uuid (pour update/delete des manuelles)
      source: a.source || 'strava',
      category: a.category || 'entrainement',
      client_id: a.client_id || null,
      notes: a.user_notes || null,
      priority: a.priority || null,
      target: a.target || null,
      course_dplus: a.course_dplus ?? null,
      laps: a.laps ?? null,
      gpx_name: a.gpx_name || null,
      stages: a.stages || null,
      event: a.event || null,
      name: a.name,
      sport: a.sport,
      raw_type: a.sport_raw,
      tss: a.tss || 0,
      duration: a.moving_time ? Math.round(a.moving_time / 60) : (a.elapsed_time ? Math.round(a.elapsed_time / 60) : 0),
      elapsed_time: a.elapsed_time,
      moving_time: a.moving_time,
      start_date_local: a.start_date_local,
      distance_km: a.distance_km,
      elevation_gain: a.total_elevation_gain,
      elevation_loss: a.total_elevation_loss,
      avg_speed_kmh: a.avg_speed_kmh,
      max_speed_kmh: a.max_speed_kmh,
      max_speed_smooth_kmh: a.max_speed_smooth_kmh,
      np: a.np || 0,
      avg_watts: a.avg_watts,
      max_watts: a.max_watts,
      hr: a.avg_heartrate || 0,
      max_hr: a.max_heartrate,
      cadence: a.avg_cadence,
      max_cadence: a.max_cadence,
      kj: a.kj,
      calories: a.calories,
      ftpPct: a.intensity ? Math.round(a.intensity * 100) : 0,
      intensity: a.intensity || 0,
      variability_index: a.variability_index,
      training_load: a.tss,
      zones_hr: a.zones_hr,
      zones_power: a.zones_power,
    });
  }
  // Tri par TSS desc dans chaque jour (cohérent avec build_day_index Python)
  for (const iso in actsByDate) {
    actsByDate[iso].sort((x, y) => (y.tss || 0) - (x.tss || 0));
  }

  // 3) Index whoop par iso_date
  const whoopByDate = {};
  for (const w of whoopData || []) {
    whoopByDate[w.iso_date] = w;
  }

  // 4) Construire days[] depuis daily_metrics (la liste de référence)
  let days = (dailyMetrics || []).map(m => {
    const iso = m.iso_date;
    const acts = actsByDate[iso] || [];
    const main = acts[0] || {};
    const w = whoopByDate[iso] || {};
    return {
      date: iso,
      tss: m.tss || 0,
      ctl: m.ctl || 0,
      atl: m.atl || 0,
      tsb: m.tsb || 0,
      duration: m.duration_min || 0,
      sessionName: main.name || null,
      sessionType: null,
      sport: main.sport || null,
      np: main.np || 0,
      avgW: main.avg_watts || 0,
      hr: main.hr || 0,
      ftpPct: main.ftpPct || 0,
      intensity: main.intensity || 0,
      compliance: null,
      zones: main.zones_hr || main.zones_power || null,
      zones_hr: main.zones_hr || null,
      zones_power: main.zones_power || null,
      activities: acts,
      // Whoop
      recovery: w.recovery ?? null,
      hrv: w.hrv ?? null,
      sleepH: w.sleep_h ?? null,
      sleepQ: w.sleep_q ?? null,
      whoopSource: w.source || null,
      rhr: w.rhr ?? null,
      strain: w.strain ?? null,
      deepH: w.deep_h ?? null,
      remH: w.rem_h ?? null,
    };
  });

  // 4b) Robustesse : si AUCUNE daily_metric (état incohérent — ex : métriques
  // supprimées mais activités encore là), on reconstruit des jours basiques depuis
  // les dates d'activités + les 90 derniers jours, pour ne pas planter le rendu.
  // (Une re-synchro recalculera ensuite les CTL/ATL/TSB côté serveur.)
  if (days.length === 0) {
    const dateSet = new Set(Object.keys(actsByDate));
    const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      dateSet.add(d.toISOString().slice(0, 10));
    }
    days = [...dateSet].sort().map(iso => {
      const acts = actsByDate[iso] || [];
      const main = acts[0] || {};
      const w = whoopByDate[iso] || {};
      return {
        date: iso,
        tss: acts.reduce((s, a) => s + (a.tss || 0), 0),
        ctl: 0, atl: 0, tsb: 0,
        duration: acts.reduce((s, a) => s + (a.duration || 0), 0),
        sessionName: main.name || null, sessionType: null, sport: main.sport || null,
        np: main.np || 0, avgW: main.avg_watts || 0, hr: main.hr || 0,
        ftpPct: main.ftpPct || 0, intensity: main.intensity || 0,
        compliance: null, zones: main.zones_hr || main.zones_power || null,
        zones_hr: main.zones_hr || null, zones_power: main.zones_power || null,
        activities: acts,
        recovery: w.recovery ?? null, hrv: w.hrv ?? null, sleepH: w.sleep_h ?? null, sleepQ: w.sleep_q ?? null,
        whoopSource: w.source || null, rhr: w.rhr ?? null, strain: w.strain ?? null, deepH: w.deep_h ?? null, remH: w.rem_h ?? null,
      };
    });
  }

  // 4c) Garantir un jour pour chaque date d'activité (ex : activité manuelle /
  // compétition sur une date sans daily_metric) — sinon elle n'apparaît pas.
  {
    const have = new Set(days.map(d => d.date));
    for (const iso of Object.keys(actsByDate)) {
      if (have.has(iso)) continue;
      const acts = actsByDate[iso];
      const main = acts[0] || {};
      const w = whoopByDate[iso] || {};
      days.push({
        date: iso,
        tss: acts.reduce((s, a) => s + (a.tss || 0), 0),
        ctl: 0, atl: 0, tsb: 0,
        duration: acts.reduce((s, a) => s + (a.duration || 0), 0),
        sessionName: main.name || null, sessionType: null, sport: main.sport || null,
        np: main.np || 0, avgW: main.avg_watts || 0, hr: main.hr || 0,
        ftpPct: main.ftpPct || 0, intensity: main.intensity || 0,
        compliance: null, zones: main.zones_hr || main.zones_power || null,
        zones_hr: main.zones_hr || null, zones_power: main.zones_power || null,
        activities: acts,
        recovery: w.recovery ?? null, hrv: w.hrv ?? null, sleepH: w.sleep_h ?? null, sleepQ: w.sleep_q ?? null,
        whoopSource: w.source || null, rhr: w.rhr ?? null, strain: w.strain ?? null, deepH: w.deep_h ?? null, remH: w.rem_h ?? null,
      });
    }
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // 4d) Série CONTINUE : un jour pour CHAQUE date de la plage (du 1er jour à
  // aujourd'hui), même sans activité ni métrique. CTL/ATL reportés du jour
  // précédent (courbe de forme continue), TSS = 0 pour les jours vides.
  if (days.length) {
    const pad = n => String(n).padStart(2, '0');
    const fmt = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const byIso = {};
    for (const d of days) byIso[d.date] = d;
    const isos = days.map(d => d.date).sort();
    const todayIso = fmt(new Date());
    const startIso = isos[0];
    let endIso = isos[isos.length - 1];
    if (todayIso > endIso) endIso = todayIso;
    const filled = [];
    let lastCtl = 0, lastAtl = 0;
    for (let dt = new Date(startIso + 'T12:00:00'); fmt(dt) <= endIso; dt.setDate(dt.getDate() + 1)) {
      const iso = fmt(dt);
      let day = byIso[iso];
      if (!day) {
        const w = whoopByDate[iso] || {};
        day = {
          date: iso, tss: 0, ctl: lastCtl, atl: lastAtl, tsb: +(lastCtl - lastAtl).toFixed(1),
          duration: 0, sessionName: null, sessionType: null, sport: null,
          np: 0, avgW: 0, hr: 0, ftpPct: 0, intensity: 0, compliance: null,
          zones: null, zones_hr: null, zones_power: null, activities: [],
          recovery: w.recovery ?? null, hrv: w.hrv ?? null, sleepH: w.sleep_h ?? null, sleepQ: w.sleep_q ?? null,
          whoopSource: w.source || null, rhr: w.rhr ?? null, strain: w.strain ?? null, deepH: w.deep_h ?? null, remH: w.rem_h ?? null,
        };
      }
      lastCtl = day.ctl || 0; lastAtl = day.atl || 0;
      filled.push(day);
    }
    days = filled;
  }

  // 4e) Recalcul PMC (Banister) depuis les TSS : CTL(J)=CTL(J-1)+(TSS-CTL(J-1))/42,
  // ATL(J)=ATL(J-1)+(TSS-ATL(J-1))/7, TSB(J)=CTL(J-1)-ATL(J-1). Le 1er jour sert
  // d'amorce (valeur serveur conservée). daily_metrics n'est plus qu'une source de TSS.
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

  // 5) Power profile
  // Sport de chaque activité (pour étiqueter les records de puissance par discipline).
  const sportById = {};
  for (const a of activities || []) if (a && a.id) sportById[a.id] = a.sport;

  const ppAlltime = {};
  const ppRecent = {};
  const ppDates = {};   // {duration_s: date iso du meilleur effort all-time}
  const ppSports = {};  // {duration_s: sport brut de l'activité du record}
  const durations = [];
  for (const p of powerProfile || []) {
    const k = String(p.duration_s);
    if (p.watts_alltime != null) ppAlltime[k] = p.watts_alltime;
    if (p.watts_90d != null) ppRecent[k] = p.watts_90d;
    if (p.achieved_at_alltime) ppDates[k] = String(p.achieved_at_alltime).slice(0, 10);
    if (p.activity_id_alltime && sportById[p.activity_id_alltime]) ppSports[k] = sportById[p.activity_id_alltime];
    durations.push(k);
  }
  const power_profile = (powerProfile && powerProfile.length > 0) ? {
    alltime: ppAlltime,
    last_90d: ppRecent,
    alltime_dates: ppDates,
    alltime_sports: ppSports,
    durations,
  } : null;

  // Power profile PAR SPORT (table large power_profile_sport).
  // power_by_sport = { cyclisme: { durations:{label:watts}, details:{label:{w90,date,activity_id}}, ... }, ... }
  const PP_META_COLS = ['user_id', 'sport', 'details', 'activities_count', 'longest_activity_s', 'ftp', 'weight', 'updated_at'];
  const power_by_sport = {};
  for (const row of powerProfileSport || []) {
    if (!row || !row.sport) continue;
    const dur = {};
    for (const [col, val] of Object.entries(row)) {
      if (PP_META_COLS.includes(col)) continue;
      if (val != null) dur[col] = val;
    }
    power_by_sport[row.sport] = {
      durations: dur,
      details: row.details || {},
      activities_count: row.activities_count ?? null,
      longest_activity_s: row.longest_activity_s ?? null,
    };
  }

  // 6) Source + meta
  const realDays = (whoopData || []).filter(w => w.source === 'whoop').length;
  return {
    generated_at: new Date().toISOString(),
    athlete,
    source: {
      strava: !!stravaConnection,
      intervals_icu: false,
      whoop_real: realDays > 0,
      whoop_real_days: realDays,
      whoop_simulated_days: Math.max(0, days.length - realDays),
      history_days: days.length,
      activities_count: (activities || []).length,
      planned_events_count: 0,
      backend: 'supabase',
    },
    days,
    plan: [],
    power_profile,
    power_by_sport,
  };
}

// ============ DATASET VIDE pour nouveaux comptes ============
function buildEmptyDataset(user, profile) {
  const days = [];
  const today = new Date();
  // 90 jours vides pour que les charts/calendrier ne crashent pas
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({
      date: iso, tss: 0, ctl: 0, atl: 0, tsb: 0, duration: 0,
      sessionName: null, sessionType: null, sport: null,
      np: 0, avgW: 0, hr: 0, ftpPct: 0, intensity: 0,
      compliance: null, zones: null, zones_hr: null, zones_power: null,
      activities: [],
      recovery: null, hrv: null, sleepH: null, sleepQ: null, whoopSource: null,
      rhr: null, strain: null, deepH: null, remH: null,
    });
  }
  const name = profile?.display_name || (user.email ? user.email.split('@')[0] : 'Athlète');
  return {
    generated_at: new Date().toISOString(),
    athlete: {
      id: '', name,
      ftp: profile?.ftp || 0,
      hr_max: profile?.hr_max || 0,
      lthr: profile?.lthr || 0,
      weight: profile?.weight || 0,
    },
    source: {
      strava: false, intervals_icu: false,
      whoop_real: false, whoop_real_days: 0, whoop_simulated_days: 0,
      history_days: 90, activities_count: 0, planned_events_count: 0,
      backend: 'supabase-empty',
    },
    days, plan: [], power_profile: null,
  };
}

// ============ BANNIÈRE D'ONBOARDING (compte vide) ============
function showOnboardingBanner(opts = {}) {
  const stravaConnected = !!opts.stravaConnected;
  let banner = document.getElementById('onboarding-banner');
  if (banner) banner.remove(); // on régénère pour refléter le bon état
  banner = document.createElement('div');
  banner.id = 'onboarding-banner';
  banner.className = 'onboarding-banner active';

  // Bouton Strava : "Re-synchroniser" si déjà connecté (mais 0 activité), sinon "Connecter".
  const stravaBtn = stravaConnected
    ? `<button class="onboarding-strava-btn" id="onboarding-sync-strava" type="button"><span>Re-synchroniser Strava</span></button>`
    : `<button class="onboarding-strava-btn" id="onboarding-connect-strava" type="button">
         <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
         <span>Connecter Strava</span>
       </button>`;
  const message = stravaConnected ? 'Aucune activité importée.' : 'Aucun compte connecté.';

  banner.innerHTML = `
    <div class="onboarding-banner-inner">
      <div class="onboarding-banner-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div class="onboarding-banner-body"><strong>${message}</strong></div>
      ${stravaBtn}
      <button class="onboarding-whoop-btn" id="onboarding-connect-whoop" type="button"><span>Connecter Whoop</span></button>
    </div>
  `;
  // Wire les boutons
  banner.querySelector('#onboarding-connect-strava')?.addEventListener('click', () => {
    if (window.startStravaOAuth) window.startStravaOAuth(); else alert('Module Strava OAuth non chargé');
  });
  banner.querySelector('#onboarding-sync-strava')?.addEventListener('click', () => {
    if (window.startStravaIngest) window.startStravaIngest(); else alert('Module Strava non chargé');
  });
  banner.querySelector('#onboarding-connect-whoop').addEventListener('click', () => {
    if (window.startWhoopOAuth) window.startWhoopOAuth();
    else alert('Module Whoop OAuth non chargé');
  });
  // Petit "i" cliquable → explication de la situation actuelle
  const icon = banner.querySelector('.onboarding-banner-icon');
  if (icon) {
    icon.style.cursor = 'pointer';
    icon.title = 'En savoir plus';
    icon.addEventListener('click', () => {
      const msg = "Aucun compte Strava ou Whoop n'est relié à Coach IA pour l'instant.\n\n"
        + "• Connecte Strava pour importer tes activités, ta puissance et ta charge (CTL/ATL/TSB).\n"
        + "• Connecte Whoop pour ta récupération, ton sommeil et ton strain.\n\n"
        + "Tant qu'aucun compte n'est connecté, le tableau de bord reste vide. Si d'anciennes "
        + "activités sont encore affichées, tu peux les conserver (elles réapparaîtront à la "
        + "reconnexion) ou les supprimer via la fenêtre Connexions.";
      if (window.appAlert) window.appAlert({ title: 'Aucun compte connecté', message: msg });
      else alert(msg);
    });
  }
  // Intégrer dans la barre d'onglets : onglets à gauche, bannière à droite (même ligne).
  const tabs = document.querySelector('.tabs');
  if (tabs) tabs.appendChild(banner);
  else document.body.appendChild(banner);
  injectOnboardingStyles();
}
function hideOnboardingBanner() {
  const banner = document.getElementById('onboarding-banner');
  if (banner) banner.classList.remove('active');
}

// ============ MESSAGES "AUCUNE DONNÉE" sur les widgets (compte vide) ============
// Liste des cartes/graphiques à recouvrir d'un message au lieu d'afficher des zéros.
function emptyDataTargets() {
  const set = new Set();
  document.querySelectorAll('#p1 .hero .card, #p3 .bilan-kpi').forEach(c => set.add(c));
  document.querySelectorAll('#p1 .chart-wrap, #p3 .chart-wrap').forEach(w => {
    const c = w.closest('.card');
    if (c) set.add(c);
  });
  return [...set];
}

function setEmptyDataOverlays(on) {
  // Nettoyage systématique
  document.querySelectorAll('.empty-data-overlay').forEach(e => e.remove());
  document.querySelectorAll('[data-ed-pos]').forEach(c => { c.style.position = ''; c.removeAttribute('data-ed-pos'); });
  if (!on) return;

  injectEmptyOverlayStyles();
  emptyDataTargets().forEach(card => {
    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
      card.setAttribute('data-ed-pos', '1');
    }
    const o = document.createElement('div');
    o.className = 'empty-data-overlay';
    o.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15V6a2 2 0 0 0-2-2H9l-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6"/><line x1="16" y1="19" x2="22" y2="19"/>
      </svg>
      <div class="ed-title">Aucune donnée importée</div>
      <div class="ed-sub">Connecte Strava ou Whoop</div>`;
    card.appendChild(o);
  });
}

// Quand Whoop n'est pas connecté, la carte "Récupération Whoop" est remplacée par
// la carte "Ratio de charge (ACWR)" (calculée depuis Strava). Le swap est géré par
// renderHeroKpi() dans app.js, via le flag window.__noWhoopCard.
function setWhoopCardEmpty(on) {
  window.__noWhoopCard = !!on;
  // Nettoie un éventuel ancien overlay (versions précédentes).
  document.getElementById('whoop-card')?.querySelector('.empty-data-overlay')?.remove();
  if (typeof window.renderHeroKpi === 'function') window.renderHeroKpi();
}

function injectEmptyOverlayStyles() {
  if (document.getElementById('empty-data-overlay-styles')) return;
  const s = document.createElement('style');
  s.id = 'empty-data-overlay-styles';
  s.textContent = `
    .empty-data-overlay {
      position: absolute; inset: 0; z-index: 6; border-radius: inherit;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 6px; text-align: center; padding: 12px;
      background: color-mix(in srgb, var(--bg-elev, #161b26) 82%, transparent);
      backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
      color: var(--text-mute, #6b7689);
    }
    .empty-data-overlay .ed-title { color: var(--text-dim, #8b94a8); font-size: 12.5px; font-weight: 700; }
    .empty-data-overlay .ed-sub { font-size: 11px; }
  `;
  document.head.appendChild(s);
}
function injectOnboardingStyles() {
  if (document.getElementById('onboarding-banner-styles')) return;
  const s = document.createElement('style');
  s.id = 'onboarding-banner-styles';
  s.textContent = `
    .onboarding-banner {
      background: linear-gradient(135deg, rgba(96, 165, 250, 0.18), rgba(74, 222, 128, 0.12));
      border: 1px solid rgba(96, 165, 250, 0.35);
      border-radius: 12px;
      color: var(--text);
      display: none;
      width: fit-content;
      max-width: 100%;
      margin: 0 0 0 auto;   /* pousse la bannière à droite dans la barre d'onglets */
    }
    .onboarding-banner.active { display: block; animation: ob-fade 0.3s ease-out; }
    @keyframes ob-fade { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    .onboarding-banner-inner {
      display: flex; gap: 12px; align-items: center; justify-content: flex-end;
      padding: 7px 12px; flex-wrap: wrap;
    }
    .onboarding-banner-icon {
      flex-shrink: 0;
      width: 36px; height: 36px;
      background: rgba(96, 165, 250, 0.25);
      color: var(--info);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
    }
    .onboarding-banner-body {
      font-size: 13px; line-height: 1.5;
    }
    .onboarding-banner-body strong { display: inline; margin-right: 8px; color: var(--info); }
    .onboarding-banner-soon { display: block; font-size: 11px; color: var(--text-mute); margin-top: 3px; }
    .onboarding-banner-body { flex: 0 0 auto; }
    .onboarding-strava-btn {
      display: inline-flex; align-items: center; gap: 8px;
      background: #FC4C02;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px 18px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
      box-shadow: 0 2px 8px rgba(252, 76, 2, 0.25);
      flex-shrink: 0;
    }
    .onboarding-strava-btn:hover {
      background: #e34302;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(252, 76, 2, 0.35);
    }
    .onboarding-strava-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .onboarding-whoop-btn {
      display: inline-flex; align-items: center; gap: 8px;
      background: #0bbfa6;
      color: #04211d;
      border: none; border-radius: 8px;
      padding: 10px 18px;
      font-size: 13px; font-weight: 700; cursor: pointer;
      font-family: inherit; transition: all 0.15s;
      box-shadow: 0 2px 8px rgba(11, 191, 166, 0.25);
      flex-shrink: 0;
    }
    .onboarding-whoop-btn:hover { background: #0aa991; transform: translateY(-1px); }
    .onboarding-whoop-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  `;
  document.head.appendChild(s);
}

// ============ TRIGGER RE-RENDER ============
function triggerFullReload() {
  // Met à jour l'en-tête (athlète)
  const data = window.DASHBOARD_DATA;
  if (data && data.athlete) {
    const sub = document.querySelector('.logo-text p');
    if (sub) {
      const ftpStr = data.athlete.ftp ? ` · FTP ${data.athlete.ftp}W` : '';
      sub.textContent = `${data.athlete.name}${ftpStr}`;
    }
  }
  // Re-rend les vues qui peuvent l'être facilement
  setTimeout(() => {
    if (window.renderBilan) window.renderBilan();
    if (window.renderPowerProfile) window.renderPowerProfile();
    if (window.renderCalendar) window.renderCalendar();
    if (window.renderCompList) window.renderCompList();
    if (window.renderCompetitionsPage) window.renderCompetitionsPage();
    if (window.renderIaPage) window.renderIaPage();
  }, 100);
  // Pour les KPI hero + charts du tableau de bord (qui sont dans le MAIN closure
  // et difficiles à re-trigger depuis l'extérieur), on émet un event que d'autres
  // modules peuvent écouter.
  window.dispatchEvent(new CustomEvent('dashboardDataReplaced', { detail: { data } }));
}

// Expose pour debug
window.reloadDataFromSupabase = loadFromSupabase;
