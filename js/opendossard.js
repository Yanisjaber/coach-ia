/* ============================================================
   js/opendossard.js — Intégration Open Dossard (résultats officiels)

   - Appelle l'edge function `opendossard` (identifiants OD gardés côté serveur)
     avec le JWT Supabase de l'utilisateur.
   - La LIAISON de la licence se fait dans la modale Connexions (avec Strava/Whoop).
   - Une fois la licence liée, on charge le palmarès pour :
       · le récap « Mon palmarès » en haut de l'onglet Compétitions (#od-recap)
       · lier automatiquement (par date) le résultat officiel aux compétitions passées
   ============================================================ */

// IMPORTANT : la licence et le palmarès sont propres à CHAQUE compte.
// On scope les clés localStorage par identifiant utilisateur Supabase pour éviter
// qu'une licence liée sur un compte n'apparaisse sur un autre (même navigateur).
const OD_LIC_BASE = 'coach_ia_od_licence_v1';
const OD_CACHE_BASE = 'coach_ia_od_palmares_v1';
let _odUid = null; // défini à l'authentification

function odKey(base) { return _odUid ? `${base}::${_odUid}` : null; }

// Purge les anciennes clés NON scopées (legacy) : elles pouvaient fuiter entre comptes.
function odPurgeLegacy() {
  try { localStorage.removeItem(OD_LIC_BASE); localStorage.removeItem(OD_CACHE_BASE); } catch {}
}

let _odResults = [];
let _odRecapYear = 'all';

function odLoadCache() {
  const k = odKey(OD_CACHE_BASE); if (!k) return null;
  try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; }
}
function odSaveCache(results) {
  const k = odKey(OD_CACHE_BASE); if (!k) return;
  try { localStorage.setItem(k, JSON.stringify(results || [])); } catch {}
}

function odLoadLicence() {
  const k = odKey(OD_LIC_BASE); if (!k) return null; // pas d'utilisateur connu → on n'affiche rien
  try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; }
}
function odSaveLicence(lic) {
  const k = odKey(OD_LIC_BASE); if (!k) return;
  if (lic) localStorage.setItem(k, JSON.stringify(lic));
  else localStorage.removeItem(k);
}
window.odGetLicence = odLoadLicence;

async function odSessionToken() {
  if (!window.sb) return null;
  try { const { data } = await window.sb.auth.getSession(); return data?.session?.access_token || null; }
  catch { return null; }
}

async function odCall(action, params = {}) {
  const cfg = window.SUPABASE_CONFIG;
  const tok = await odSessionToken();
  if (!cfg || !cfg.url) throw new Error('Configuration Supabase absente.');
  if (!tok) throw new Error('Connecte-toi pour utiliser Open Dossard.');
  const res = await fetch(`${cfg.url}/functions/v1/opendossard`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function odEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function odLicName(r) {
  const n = `${r.firstName || ''} ${r.lastName || r.name || ''}`.trim();
  return n || r.licenceNumber || 'Licence';
}

// ---- Fede par competition (l'objet competition OD porte `fede`,
// le palmares non) : table id -> fede, cache permanent, construite en
// re-questionnant /competitions par date pour les ids manquants. ----
const OD_FEDE_BASE = 'coach_ia_od_fede_v1';
function odFedeMapLoad() {
  try { return JSON.parse(localStorage.getItem(OD_FEDE_BASE) || '{}'); } catch { return {}; }
}
window.odFedeForCompetition = function (competitionId) {
  const v = odFedeMapLoad()[String(competitionId)];
  return v || null;
};
async function odFillFedeMap(results) {
  const map = odFedeMapLoad();
  const byDate = {};
  for (const r of (results || [])) {
    if (r.competitionId == null || map[String(r.competitionId)] !== undefined) continue;
    const iso = String(r.date || '').slice(0, 10);
    if (!iso) continue;
    (byDate[iso] = byDate[iso] || new Set()).add(String(r.competitionId));
  }
  const dates = Object.keys(byDate);
  if (!dates.length) return;
  let changed = false;
  for (const iso of dates) {
    try {
      const data = await odCall('competitions', { filters: { startDate: iso, endDate: iso, limit: 100 } });
      const comps = (data.competitions && (data.competitions.data || data.competitions)) || [];
      (Array.isArray(comps) ? comps : []).forEach(c => {
        if (c && c.id != null) { map[String(c.id)] = c.fede || null; changed = true; }
      });
      // ids toujours introuvables pour cette date : marques null (pas de boucle infinie)
      byDate[iso].forEach(id => { if (map[id] === undefined) { map[id] = null; changed = true; } });
    } catch (e) { console.warn('[od fede]', iso, e.message); }
  }
  if (changed) {
    localStorage.setItem(OD_FEDE_BASE, JSON.stringify(map));
    if (window.renderCompetitionsPage) window.renderCompetitionsPage();
  }
}

// Meilleur résultat officiel OD pour une date donnée (YYYY-MM-DD), ou null.
window.odResultForDate = function (iso) {
  const a = (window.__odByDate && window.__odByDate[iso]) || [];
  if (!a.length) return null;
  let best = a[0];
  for (const r of a) {
    if (r.rankingScratch != null && (best.rankingScratch == null || r.rankingScratch < best.rankingScratch)) best = r;
  }
  return best;
};

// ============ Chargement du palmarès (récap + lien auto) ============
// Applique une liste de résultats (cache ou frais) : index par date + rendu.
function odApplyResults(results) {
  _odResults = results || [];
  window.__odByDate = {};
  for (const r of _odResults) {
    if (!r.date) continue;
    const iso = String(r.date).slice(0, 10);
    (window.__odByDate[iso] = window.__odByDate[iso] || []).push(r);
  }
  renderOdRecap();
  if (window.renderCompetitionsPage) window.renderCompetitionsPage();
  odFillFedeMap(_odResults); // fire-and-forget : re-render quand la table fede est prete
}

// Récupère le palmarès frais depuis l'edge function (réseau) et met à jour le cache.
async function odRefresh() {
  const lic = odLoadLicence();
  if (!lic || !lic.id) {
    odSaveCache([]);
    odApplyResults([]);
    return;
  }
  try {
    const { palmares } = await odCall('palmares', { licenceId: lic.id });
    const results = (palmares && palmares.results) || [];
    odSaveCache(results);
    odApplyResults(results);
  } catch (e) {
    // En cas d'échec (session pas prête, réseau…), on garde l'affichage du cache.
    console.warn('[opendossard] palmares:', e.message);
  }
}
window.odRefresh = odRefresh;

// ============ Récap palmarès (haut de l'onglet Compétitions) ============
function odYears(results) {
  const s = new Set();
  results.forEach(r => { const y = r.date ? new Date(r.date).getFullYear() : null; if (y) s.add(y); });
  return [...s].sort((a, b) => b - a);
}
function odComputeStats(results, year) {
  const list = year === 'all' ? results : results.filter(r => r.date && new Date(r.date).getFullYear() === +year);
  let races = list.length, wins = 0, podiums = 0, top10 = 0, best = null, bestR = null;
  const buckets = { win: 0, pod: 0, t10: 0, rest: 0 };
  for (const r of list) {
    const p = r.rankingScratch;
    if (p == null) { buckets.rest++; continue; }
    if (p === 1) { wins++; buckets.win++; }
    else if (p <= 3) buckets.pod++;
    else if (p <= 10) buckets.t10++;
    else buckets.rest++;
    if (p <= 3) podiums++;
    if (p <= 10) top10++;
    if (best == null || p < best) { best = p; bestR = r; }
  }
  return { races, wins, podiums, top10, best, bestR, buckets };
}
// Palmares AGREGE : resultats Open Dossard + resultats saisis manuellement
// (window.getManualRaceResults, deja dedoublonnes cote app.js). Chaque entree
// est normalisee au format OD : { date, rankingScratch, competitionName, _fede, _cat }.
function odMergedResults() {
  const out = [];
  for (const r of (_odResults || [])) {
    const f = window.odFedeForCompetition ? window.odFedeForCompetition(r.competitionId) : null;
    out.push(Object.assign({}, r, { _fede: (f === 'FFVELO' ? 'FFVélo' : f), _cat: 'cyclisme', _src: 'od' }));
  }
  const manual = (typeof window.getManualRaceResults === 'function') ? window.getManualRaceResults() : [];
  for (const m of manual) {
    out.push({
      date: m.date, rankingScratch: m.place,
      rankingInCategory: m.place, totalInCategory: m.total || null, catev: m.catev || null,
      competitionName: m.name,
      _fede: m.federation || null,
      _cat: (typeof window.getSportCategory === 'function') ? window.getSportCategory(m.sport || '') : null,
      _src: 'manual',
    });
  }
  return out;
}
function renderOdRecap() {
  const wrap = document.getElementById('od-recap');
  if (!wrap) return;
  if (!odMergedResults().length) { wrap.innerHTML = ''; return; }
  // Plus de selecteur d'annee propre : le palmares suit le filtre GLOBAL
  // (barre de la page Competitions : annee + sport + fede).
  wrap.innerHTML = `
    <div class="grid-1 card od-recap-card">
      <div class="od-recap-head">
        <div class="section-title">Mon palmarès</div>
      </div>
      <div id="od-recap-stats"></div>
    </div>`;
  renderOdRecapStats();
}
function renderOdRecapStats() {
  const el = document.getElementById('od-recap-stats');
  if (!el) return;
  // Filtre global de la page Competitions (sport + fede) : le palmares suit.
  // Source = resultats agreges (Open Dossard + saisis manuellement).
  const flt = window._compPageFilter || { cat: 'tout', fed: 'tout' };
  let rs = odMergedResults();
  if (flt.cat !== 'tout') rs = rs.filter(r => !r._cat || r._cat === flt.cat);
  if (flt.fed !== 'tout') rs = rs.filter(r => (r._fede || null) === flt.fed);
  const _gYear = (flt.year !== undefined && String(flt.year) !== 'tout') ? String(flt.year) : 'all';
  const s = odComputeStats(rs, _gYear);
  const fmtD = (d) => { try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d || ''; } };
  const rate = s.races ? Math.round((s.top10 / s.races) * 100) : 0;
  const C = 213.6;
  const off = (C * (1 - rate / 100)).toFixed(1);
  const pct = b => s.races ? (b / s.races) * 100 : 0;
  const seg = (b, cls) => b ? `<span class="od-seg ${cls}" style="width:${pct(b).toFixed(1)}%;" title="${b}"></span>` : '';
  const ord = (n) => n === 1 ? '<sup>er</sup>' : '<sup>e</sup>';
  el.innerHTML = `
    <div class="od-recap-hero">
      <div class="od-ring" title="Part de tes courses terminées dans le top 10">
        <svg viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" stroke-width="8"/>
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 40 40)"/>
        </svg>
        <div class="od-ring-c"><div class="od-ring-pct">${rate}%</div><div class="od-ring-k">Top 10</div></div>
      </div>
      <div class="od-tally">
        <div class="od-tally-row"><span class="od-medal gold"></span><b>${s.wins}</b> victoire${s.wins > 1 ? 's' : ''}</div>
        <div class="od-tally-row"><span class="od-medal silver"></span><b>${s.podiums}</b> podium${s.podiums > 1 ? 's' : ''}</div>
        <div class="od-tally-row"><span class="od-medal green"></span><b>${s.top10}</b> top 10</div>
        <div class="od-tally-row"><span class="od-medal grey"></span><b>${s.races}</b> course${s.races > 1 ? 's' : ''}</div>
      </div>
      <div class="od-best">
        <div class="od-best-lbl">Meilleur résultat</div>
        <div class="od-best-rank">${s.best != null ? s.best + ord(s.best) : '—'}</div>
        <div class="od-best-race">${s.bestR ? odEsc(s.bestR.competitionName || '') + ' · ' + fmtD(s.bestR.date) : 'Pas encore de résultat'}</div>
      </div>
    </div>
    ${s.races ? `<div class="od-dist">
      <div class="od-dist-bar">${seg(s.buckets.win, 'win')}${seg(s.buckets.pod, 'pod')}${seg(s.buckets.t10, 't10')}${seg(s.buckets.rest, 'rest')}</div>
      <div class="od-dist-legend">
        <span><i class="od-dot win"></i>Victoires</span>
        <span><i class="od-dot pod"></i>Podium</span>
        <span><i class="od-dot t10"></i>Top 10</span>
        <span><i class="od-dot rest"></i>Au-delà</span>
      </div>
    </div>` : ''}
    ${_odSeasonsHTML(rs, _gYear)}
    ${_odFedesHTML(rs, flt)}`;
}
// Evolution saison par saison (uniquement quand aucune annee n'est filtree
// et qu'il y a au moins 2 saisons de resultats).
function _odSeasonsHTML(rs, gYear) {
  if (gYear !== 'all') return '';
  const years = odYears(rs);
  if (years.length < 2) return '';
  const rows = years.map(y => {
    const st = odComputeStats(rs, y);
    return `<div class="od-season-row">
      <span class="od-season-y">${y}</span>
      <span class="od-season-v"><b>${st.races}</b> course${st.races > 1 ? 's' : ''}</span>
      <span class="od-season-v"><b>${st.wins}</b> V</span>
      <span class="od-season-v"><b>${st.podiums}</b> podium${st.podiums > 1 ? 's' : ''}</span>
      <span class="od-season-v"><b>${st.top10}</b> top 10</span>
      <span class="od-season-v od-season-best">${st.best != null ? 'best ' + st.best + (st.best === 1 ? '<sup>er</sup>' : '<sup>e</sup>') : ''}</span>
    </div>`;
  }).join('');
  return `<div class="od-seasons"><div class="od-agg-title">Par saison</div>${rows}</div>`;
}
// Repartition par federation (uniquement quand aucune fede n'est filtree
// et qu'il y a au moins 2 federations representees).
function _odFedesHTML(rs, flt) {
  if (flt.fed !== 'tout') return '';
  const byFed = new Map();
  for (const r of rs) {
    const f = r._fede || 'Autre';
    const cur = byFed.get(f) || { races: 0, pod: 0 };
    cur.races++;
    if (r.rankingScratch != null && r.rankingScratch <= 3) cur.pod++;
    byFed.set(f, cur);
  }
  if (byFed.size < 2) return '';
  const chips = [...byFed.entries()].sort((a, b) => b[1].races - a[1].races).map(([f, v]) =>
    `<span class="od-fed-chip"><b>${odEsc(f)}</b> ${v.races} course${v.races > 1 ? 's' : ''}${v.pod ? ' · ' + v.pod + ' podium' + (v.pod > 1 ? 's' : '') : ''}</span>`
  ).join('');
  return `<div class="od-fedes"><div class="od-agg-title">Par fédération</div><div class="od-fed-chips">${chips}</div></div>`;
}

// ============ Liaison de la licence (appelée depuis la modale Connexions) ============
// Recree la carte entiere si elle n'existe pas encore (cas : aucun resultat OD
// mais des resultats manuels -> la carte doit quand meme apparaitre/disparaitre).
window.odRecapRefresh = function () {
  if (!document.getElementById('od-recap-stats')) renderOdRecap();
  else if (!odMergedResults().length) renderOdRecap();
  else renderOdRecapStats();
};

window.odUnlinkLicence = function () {
  odSaveLicence(null);
  odRefresh();
  if (window.refreshConnectionsIfOpen) window.refreshConnectionsIfOpen();
};

window.odOpenLinkModal = function () {
  const overlay = document.createElement('div');
  overlay.className = 'day-modal-overlay active';
  overlay.innerHTML = `
    <div class="day-modal">
      <div class="day-modal-header">
        <h3>Lier ma licence Open Dossard</h3>
        <button class="day-modal-close" type="button" title="Fermer">×</button>
      </div>
      <div class="day-modal-body">
        <div class="od-link-intro">Cherche ta licence par nom pour importer tes résultats officiels.</div>
        <div class="od-search">
          <input type="text" id="od-q" placeholder="Ton nom (ex. Jaber)" autocomplete="off">
          <button type="button" id="od-search-btn">Rechercher</button>
        </div>
        <div class="od-results" id="od-results"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.day-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const input = overlay.querySelector('#od-q');
  const btn = overlay.querySelector('#od-search-btn');
  const doSearch = () => odDoSearch(input.value.trim(), overlay, close);
  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  setTimeout(() => input.focus(), 50);
};

async function odDoSearch(q, overlay, close) {
  const wrap = overlay.querySelector('#od-results');
  if (!wrap) return;
  if (!q || q.length < 2) { wrap.innerHTML = '<div class="od-hint">Saisis au moins 2 caractères.</div>'; return; }
  wrap.innerHTML = '<div class="od-loading">Recherche…</div>';
  try {
    const { results } = await odCall('search-licence', { q });
    const list = Array.isArray(results) ? results : (results && results.data) || [];
    if (!list.length) { wrap.innerHTML = '<div class="od-hint">Aucune licence trouvée.</div>'; return; }
    wrap.innerHTML = list.slice(0, 12).map((r, i) => `
      <div class="od-lic-row">
        <div class="od-lic-main">
          <span class="od-lic-name">${odEsc(odLicName(r))}</span>
          <span class="od-lic-meta">${r.licenceNumber ? 'N° ' + odEsc(r.licenceNumber) : ''}${r.club ? ' · ' + odEsc(r.club) : ''}${r.dept ? ' · ' + odEsc(r.dept) : ''}</span>
        </div>
        <button type="button" class="od-pick" data-i="${i}">Choisir</button>
      </div>`).join('');
    wrap.querySelectorAll('.od-pick').forEach(b => b.addEventListener('click', () => {
      const r = list[+b.dataset.i];
      odSaveLicence({ id: r.id, licenceNumber: r.licenceNumber, firstName: r.firstName, lastName: r.lastName, name: r.name, club: r.club });
      close();
      odRefresh();
      if (window.refreshConnectionsIfOpen) window.refreshConnectionsIfOpen();
    }));
  } catch (e) {
    wrap.innerHTML = `<div class="od-error">${odEsc(e.message)}</div>`;
  }
}

// ============ Init ============
function odInit() {
  // Affichage immédiat depuis le cache (évite l'attente de l'appel réseau),
  const lic = odLoadLicence();
  const cached = odLoadCache();
  if (lic && lic.id && Array.isArray(cached) && cached.length) odApplyResults(cached);
  // puis rafraîchit en arrière-plan.
  odRefresh();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', odInit);
} else {
  odInit();
}
// La session Supabase n'est pas toujours prête au 1er rendu → recharge à l'auth.
// On (re)définit l'utilisateur courant pour cloisonner les données par compte.
window.addEventListener('coach-ia-auth', (e) => {
  const user = e.detail && e.detail.user;
  const newUid = user ? user.id : null;
  if (newUid !== _odUid) {
    _odUid = newUid;
    _odResults = [];          // on ne garde aucune donnée de l'ancien compte
    odPurgeLegacy();          // supprime les anciennes clés globales (fuite possible)
  }
  if (_odUid) {
    odApplyResults(odLoadCache() || []); // affiche d'abord le cache DU compte courant
    odRefresh();                          // puis rafraîchit depuis le serveur
  } else {
    odApplyResults([]);       // déconnexion → on n'affiche rien
  }
});
