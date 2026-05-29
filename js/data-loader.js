/* ============================================================
   js/data-loader.js — Chargement des données depuis data.js

   data.js est chargé en amont (balise <script src="data.js">)
   et expose window.DASHBOARD_DATA. Ce module valide la donnée,
   met à jour quelques éléments d'UI (badge, en-tête, mise à jour)
   et retourne la liste des jours convertie (date string → Date).
   ============================================================ */

export async function loadData() {
  try {
    const json = window.DASHBOARD_DATA;
    if (!json) throw new Error('window.DASHBOARD_DATA absent (data.js non chargé)');
    if (!json.days || !json.days.length) throw new Error('data.js vide');

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
      badge.textContent = '⚠ data.js absent — relancer fetch_data.py';
      badge.style.background = 'rgba(248, 113, 113, 0.15)';
      badge.style.borderColor = 'rgba(248, 113, 113, 0.4)';
      badge.style.color = 'var(--danger)';
    }
    // Afficher message d'aide dans le corps
    document.querySelector('.container').insertAdjacentHTML('beforeend',
      `<div style="background:#1c2230;border:1px solid #f87171;border-radius:10px;padding:20px;margin-top:20px;">
        <h3 style="color:#f87171;margin-bottom:8px;">data.js introuvable</h3>
        <p style="color:#8b94a8;font-size:13px;">Le dashboard a besoin du fichier <code>data.js</code> dans le même dossier. Pour le générer :</p>
        <pre style="background:#0b0e14;padding:12px;border-radius:6px;margin-top:10px;font-size:12px;overflow-x:auto;">cd "C:\\Users\\Cybertek\\Documents\\Claude\\Projects\\Coach IA"
python fetch_data.py</pre>
        <p style="color:#8b94a8;font-size:12px;margin-top:8px;">Puis rafraîchir cette page (F5).</p>
       </div>`);
    throw e;
  }
}
