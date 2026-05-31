/* ============================================================
   js/data-loader.js — Chargement des données depuis data.js

   data.js est chargé en amont (balise <script src="data.js">)
   et expose window.DASHBOARD_DATA. Ce module valide la donnée,
   met à jour quelques éléments d'UI (badge, en-tête, mise à jour)
   et retourne la liste des jours convertie (date string → Date).
   ============================================================ */

// Dataset de secours au boot : 90 jours vides (Date objects) pour que les
// vues ne crashent pas AVANT que Supabase n'injecte les vraies données au login.
// Permet de supprimer data.js (mode Supabase-only) sans casser le démarrage.
function emptyBootDays() {
  const days = [];
  const today = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    d.setHours(12, 0, 0, 0);
    days.push({
      date: d, tss: 0, ctl: 0, atl: 0, tsb: 0, duration: 0,
      sessionName: null, sessionType: null, sport: null,
      np: 0, avgW: 0, hr: 0, ftpPct: 0, intensity: 0,
      compliance: null, zones: null, zones_hr: null, zones_power: null,
      activities: [],
      recovery: null, hrv: null, sleepH: null, sleepQ: null, whoopSource: null,
      rhr: null, strain: null, deepH: null, remH: null,
    });
  }
  return days;
}

export async function loadData() {
  try {
    const json = window.DASHBOARD_DATA;
    // Mode Supabase-only : pas de data.js statique. On boote sur un dataset vide ;
    // supabase-data-loader.js remplacera DASHBOARD_DATA dès le login.
    if (!json || !json.days || !json.days.length) {
      window._planFromAPI = [];
      window._athleteMeta = null;
      return emptyBootDays();
    }

    // Mise à jour de l'en-tête avec l'athlète réel (le <p> a peut-être été supprimé du DOM)
    if (json.athlete) {
      const a = json.athlete;
      const sub = document.querySelector('.logo-text p');
      if (sub) {
        const ftpStr = a.ftp ? ` · FTP ${a.ftp}W` : '';
        sub.textContent = `${a.name}${ftpStr}`;
      }
    }
    // Badge : nombre de jours réels Whoop disponibles
    const badge = document.querySelector('header .badge');
    if (badge) {
      const realDays = (json.source && json.source.whoop_real_days) || 0;
      if (realDays > 0) {
        badge.textContent = `Strava · Whoop : ${realDays}j réels`;
        badge.style.background = 'rgba(74, 222, 128, 0.1)';
        badge.style.borderColor = 'rgba(74, 222, 128, 0.3)';
        badge.style.color = 'var(--accent)';
      } else {
        badge.textContent = 'Strava · Whoop indisponible';
      }
    }

    // Indicateur "dernière mise à jour" — placé dans .badge-stack (sous le badge)
    if (json.generated_at) {
      const gen = new Date(json.generated_at);
      const now = new Date();
      const minAgo = Math.round((now - gen) / 60000);
      let fresh;
      if (minAgo < 1) fresh = 'à l\'instant';
      else if (minAgo < 60) fresh = `il y a ${minAgo} min`;
      else if (minAgo < 1440) fresh = `il y a ${Math.round(minAgo/60)} h`;
      else fresh = `il y a ${Math.round(minAgo/1440)} j`;
      const dot = minAgo < 30 ? 'var(--accent)' : minAgo < 120 ? 'var(--warn)' : 'var(--danger)';
      const updateEl = document.getElementById('last-update');
      if (updateEl) {
        updateEl.style.color = 'var(--text-dim)';
        updateEl.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${dot};display:inline-block;"></span><span>Mis à jour ${fresh}</span>`;
      }
    }

    // Convertir dates string → Date pour compatibilité avec le code existant
    const days = json.days.map(d => ({ ...d, date: new Date(d.date + 'T12:00:00') }));
    // Garder le plan réel pour usage ultérieur
    window._planFromAPI = json.plan || [];
    window._athleteMeta = json.athlete;
    return days;
  } catch (e) {
    console.error('⚠️ Chargement data.json impossible :', e.message);
    const badge = document.querySelector('header .badge');
    if (badge) {
      badge.te