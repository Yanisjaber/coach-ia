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

window.addEventListener('coach-ia-auth', async (e) => {
  _currentUser = e.detail.user || null;
  if (_currentUser) {
    // Laisse le temps au cloud-sync de finir le pull localStorage avant
    setTimeout(() => loadFromSupabase().catch(err => console.error('[sb-data]', err)), 600);
  }
});

// Fetch paginé : Supabase limite à 1000 lignes par requête, on boucle si besoin.
async function fetchAllPaged(table, userId, orderCol) {
  const PAGE = 1000;
  const sb = window.sb;
  const out = [];
  let from = 0;
  while (true) {
    let q = sb.from(table).select('*').eq('user_id', userId).range(from, from + PAGE - 1);
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
    ] = await Promise.all([
      sb.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
      fetchAllPaged('activities', userId, 'start_date_local'),
      fetchAllPaged('daily_metrics', userId, 'iso_date'),
      fetchAllPaged('power_profile', userId, 'duration_s'),
      fetchAllPaged('whoop_data', userId, 'iso_date'),
      sb.from('strava_connections').select('*').eq('user_id', userId).maybeSingle(),
    ]);

    // Si la BDD est vide pour cet user, on REMPLACE DASHBOARD_DATA par un dataset
    // vide-mais-valide pour ne pas montrer les données statiques de data.js (= celles
    // de l'owner originel). Multi-user safe.
    if (!activities || activities.length === 0) {
      console.log('[sb-data] Aucune activité en BDD pour cet user — affichage compte vide');
      window.DASHBOARD_DATA = buildEmptyDataset(_currentUser, profile);
      triggerFullReload();
      showOnboardingBanner();
      _loadInProgress = false;
      return;
    }

    // Compte vu = compte propriétaire des données : on retire la bannière si présente
    hideOnboardingBanner();

    const reconstituted = reconstituteData({
      profile, activities, dailyMetrics, powerProfile, whoopData, stravaConnection,
    });

    // Remplace window.DASHBOARD_DATA
    window.DASHBOARD_DATA = reconstituted;
    console.log(`[sb-data] Chargé : ${activities.length} activités, ${dailyMetrics?.length || 0} jours, ${powerProfile?.length || 0} records puissance`);

    // Re-render complet de l'app
    triggerFullReload();
  } catch (e) {
    console.error('[sb-data] Erreur chargement Supabase:', e);
  } finally {
    _loadInProgress = false;
  }
}

// ============ RECONSTITUTION FORMAT DASHBOARD_DATA ============
function reconstituteData({ profile, activities, dailyMetrics, powerProfile, whoopData, stravaConnection }) {
  // 1) Athlete
  const athlete = {
    id: stravaConnection?.strava_athlete_id ? String(stravaConnection.strava_athlete_id) : '',
    name: profile?.display_name || stravaConnection?.athlete_name || 'Athlete',
    ftp: profile?.ftp || 0,
    hr_max: profile?.hr_max || 0,
    lthr: profile?.lthr || 0,
    weight: profile?.weight || 0,
  };

  // 2) Index activités par iso_date
  const actsByDate = {};
  for (const a of activities || []) {
    const iso = a.start_date_local ? String(a.start_date_local).slice(0, 10) : null;
    if (!iso) continue;
    if (!actsByDate[iso]) actsByDate[iso] = [];
    actsByDate[iso].push({
      id: String(a.strava_id),
      name: a.name,
      type: a.type,
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
  const days = (dailyMetrics || []).map(m => {
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
      sessionType: main.type || null,
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

  // 5) Power profile
  const ppAlltime = {};
  const ppRecent = {};
  const durations = [];
  for (const p of powerProfile || []) {
    const k = String(p.duration_s);
    if (p.watts_alltime != null) ppAlltime[k] = p.watts_alltime;
    if (p.watts_90d != null) ppRecent[k] = p.watts_90d;
    durations.push(k);
  }
  const power_profile = (powerProfile && powerProfile.length > 0) ? {
    alltime: ppAlltime,
    last_90d: ppRecent,
    durations,
  } : null;

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
function showOnboardingBanner() {
  let banner = document.getElementById('onboarding-banner');
  if (banner) { banner.classList.add('active'); return; }
  banner = document.createElement('div');
  banner.id = 'onboarding-banner';
  banner.className = 'onboarding-banner active';
  banner.innerHTML = `
    <div class="onboarding-banner-inner">
      <div class="onboarding-banner-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div class="onboarding-banner-body">
        <strong>Ton compte est vide.</strong>
        Connecte ton compte Strava pour récupérer toutes tes activités automatiquement.
      </div>
      <button class="onboarding-strava-btn" id="onboarding-connect-strava" type="button">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
        </svg>
        <span>Connecter Strava</span>
      </button>
    </div>
  `;
  // Wire le bouton
  banner.querySelector('#onboarding-connect-strava').addEventListener('click', () => {
    if (window.startStravaOAuth) window.startStravaOAuth();
    else alert('Module Strava OAuth non chargé');
  });
  document.body.appendChild(banner);
  injectOnboardingStyles();
}
function hideOnboardingBanner() {
  const banner = document.getElementById('onboarding-banner');
  if (banner) banner.classList.remove('active');
}
function injectOnboardingStyles() {
  if (document.getElementById('onboarding-banner-styles')) return;
  const s = document.createElement('style');
  s.id = 'onboarding-banner-styles';
  s.textContent = `
    .onboarding-banner {
      position: fixed; top: 0; left: 0; right: 0;
      background: linear-gradient(135deg, rgba(96, 165, 250, 0.18), rgba(74, 222, 128, 0.12));
      border-bottom: 1px solid rgba(96, 165, 250, 0.35);
      color: var(--text);
      z-index: 8800;
      display: none;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .onboarding-banner.active { display: block; animation: ob-slide 0.3s ease-out; }
    @keyframes ob-slide { from { transform: translateY(-100%); } to { transform: translateY(0); } }
    .onboarding-banner-inner {
      max-width: 1200px; margin: 0 auto;
      display: flex; gap: 14px; align-items: center;
      padding: 12px 24px;
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
    .onboarding-banner-inner { flex-wrap: wrap; }
    .onboarding-banner-body { flex: 1; min-width: 250px; }
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
    if (window.renderWellnessTrend) window.renderWellnessTrend();
    if (window.renderCalendar) window.renderCalendar();
    if (window.renderCompList) window.renderCompList();
  }, 100);
  // Pour les KPI hero + charts du tableau de bord (qui sont dans le MAIN closure
  // et difficiles à re-trigger depuis l'extérieur), on émet un event que d'autres
  // modules peuvent écouter.
  window.dispatchEvent(new CustomEvent('dashboardDataReplaced', { detail: { data } }));
}

// Expose pour debug
window.reloadDataFromSupabase = loadFromSupabase;
