/* ============================================================
   js/storage-adapter.js — Abstraction localStorage ↔ Supabase

   Donne une API unique aux modules pour lire/écrire leurs données.
   Stratégie : localStorage en CACHE + source de vérité = Supabase.
   Quand non connecté : on lit/écrit uniquement en localStorage.
   Quand connecté : on lit en cache (rapide), on sync depuis Supabase
   à l'init (overwrite cache), et on écrit dans les deux.

   API exposée :
     - storeKv(key, value, opts?)       : preferences key/value JSON
     - readKv(key, defaultValue)        : retourne la valeur cachée
     - syncKv(key)                      : reload depuis Supabase
     - listRows(table, opts?)           : SELECT * FROM table WHERE user_id = me
     - upsertRow(table, row, pk)        : INSERT ou UPDATE
     - deleteRow(table, pk)             : DELETE WHERE pk match
     - migrateLocalToCloud()            : push tout le localStorage existant vers la BDD

   Tous les modules peuvent simplement importer et utiliser, ils
   marcheront en offline (localStorage) ET avec auth (Supabase).
   ============================================================ */

const CACHE_PREFIX = 'coach_ia_';

let _currentUser = null;
let _migrationDone = false;

window.addEventListener('coach-ia-auth', (e) => {
  _currentUser = e.detail.user || null;
  if (_currentUser && !_migrationDone) {
    _migrationDone = true;
    // Lance la migration en arrière-plan
    migrateLocalToCloud().catch(err => console.error('[migrate]', err));
  }
});

function isAuthed() { return !!_currentUser && !!window.sb; }
function uid() { return _currentUser ? _currentUser.id : null; }

// ============ KV (preferences) ============
export function readKv(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (raw == null) return defaultValue;
    return JSON.parse(raw);
  } catch { return defaultValue; }
}

export async function storeKv(key, value) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); }
  catch (e) { console.warn('[storage] localStorage write fail:', e); }
  if (isAuthed()) {
    try {
      await window.sb.from('preferences').upsert(
        { user_id: uid(), key, value },
        { onConflict: 'user_id,key' }
      );
    } catch (e) { console.warn('[storage] supabase upsert pref:', e); }
  }
}

export async function syncKv(key) {
  if (!isAuthed()) return readKv(key);
  try {
    const { data, error } = await window.sb.from('preferences').select('value').eq('user_id', uid()).eq('key', key).maybeSingle();
    if (error) throw error;
    if (data) {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data.value));
      return data.value;
    }
    return readKv(key);
  } catch (e) {
    console.warn('[storage] syncKv:', e);
    return readKv(key);
  }
}

// ============ LISTES (tables avec id) ============
// Pattern : on stocke en cache localStorage sous la clé `cacheKey` (array),
// on synchronise avec Supabase.
export async function listRows(table, opts = {}) {
  // opts = { cacheKey, orderBy, filter }
  const cacheKey = opts.cacheKey || table;
  // Lecture cache immédiate
  const cached = readKv(cacheKey, []);
  if (!isAuthed()) return cached;
  // Sync depuis Supabase
  try {
    let q = window.sb.from(table).select('*').eq('user_id', uid());
    if (opts.orderBy) q = q.order(opts.orderBy.col, { ascending: opts.orderBy.asc !== false });
    const { data, error } = await q;
    if (error) throw error;
    if (data) {
      localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(data));
      return data;
    }
  } catch (e) {
    console.warn('[storage] listRows', table, ':', e);
  }
  return cached;
}

export async function upsertRow(table, row, opts = {}) {
  // opts = { cacheKey, pk }
  const cacheKey = opts.cacheKey || table;
  const pkCol = opts.pk || 'id';
  // Update cache local immédiatement (optimistic)
  const cached = readKv(cacheKey, []);
  const idx = cached.findIndex(r => r[pkCol] === row[pkCol]);
  if (idx >= 0) cached[idx] = { ...cached[idx], ...row };
  else cached.push(row);
  localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(cached));

  if (!isAuthed()) return row;
  try {
    const toSend = { ...row, user_id: uid() };
    const { data, error } = await window.sb.from(table).upsert(toSend, { onConflict: pkCol }).select().single();
    if (error) throw error;
    // Update cache avec la valeur retournée (peut contenir created_at, updated_at, etc.)
    if (data) {
      const newCached = readKv(cacheKey, []);
      const idx2 = newCached.findIndex(r => r[pkCol] === data[pkCol]);
      if (idx2 >= 0) newCached[idx2] = data; else newCached.push(data);
      localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(newCached));
    }
    return data;
  } catch (e) {
    console.warn('[storage] upsertRow', table, ':', e);
    return row;
  }
}

export async function deleteRow(table, pkValue, opts = {}) {
  const cacheKey = opts.cacheKey || table;
  const pkCol = opts.pk || 'id';
  // Optimistic local
  const cached = readKv(cacheKey, []);
  const filtered = cached.filter(r => r[pkCol] !== pkValue);
  localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(filtered));

  if (!isAuthed()) return true;
  try {
    const { error } = await window.sb.from(table).delete().eq(pkCol, pkValue).eq('user_id', uid());
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[storage] deleteRow', table, ':', e);
    return false;
  }
}

// ============ MIGRATION INITIALE : localStorage → cloud ============
// Au premier login, on prend tout ce qui existe en localStorage et on l'envoie
// dans Supabase si la BDD est vide pour cet user.
// Stratégie sécuritaire : on ne push QUE si la table cloud est vide pour cet user
// (pour ne pas écraser des données plus récentes).
async function migrateLocalToCloud() {
  if (!isAuthed()) return;
  const sb = window.sb;
  const userId = uid();

  // Liste des migrations : { lsKey, table, transformer(value) → rowsToInsert }
  const migrations = [
    // ----- Wellness -----
    {
      lsKey: 'coach_ia_wellness_v1',
      table: 'wellness_days',
      conflictCol: 'user_id,iso_date',
      transform: (obj) => Object.entries(obj || {}).map(([iso, v]) => ({
        user_id: userId,
        iso_date: iso,
        weight: v.weight ?? null,
        mood: v.mood ?? null,
        fatigue: v.fatigue ?? null,
        soreness: v.soreness ?? null,
        motivation: v.motivation ?? null,
        notes: v.notes ?? null,
      })),
    },
    // ----- Notes -----
    {
      lsKey: 'coach_ia_day_notes_v1',
      table: 'day_notes',
      conflictCol: 'user_id,iso_date',
      transform: (obj) => Object.entries(obj || {}).map(([iso, text]) => ({
        user_id: userId, iso_date: iso, note: text,
      })),
    },
    // ----- Phases -----
    {
      lsKey: 'coach_ia_phases_v1',
      table: 'training_phases',
      conflictCol: 'id',
      transform: (arr) => (arr || []).map(p => ({
        user_id: userId, client_id: p.id || null,
        phase: p.phase, from_date: p.from, to_date: p.to,
        name: p.name ?? null,
      })),
    },
    // ----- Objectifs annuels -----
    {
      lsKey: 'coach_ia_yearly_goals_v2',
      table: 'yearly_goals',
      conflictCol: 'id',
      transform: (obj) => {
        const out = [];
        for (const year of Object.keys(obj || {})) {
          for (const g of obj[year]) {
            out.push({
              user_id: userId, client_id: g.id, year: parseInt(year, 10),
              sport: g.sport, template: g.template, target: g.target,
              current_manual: g.currentManual ?? null,
            });
          }
        }
        return out;
      },
    },
    // ----- Compétitions -----
    {
      lsKey: 'coach_ia_competitions_v1',
      table: 'competitions',
      conflictCol: 'id',
      transform: (arr) => (arr || []).map(c => ({
        user_id: userId, client_id: c.id,
        name: c.name, date: c.date, sport: c.sport ?? null,
        priority: c.priority ?? null, km: c.km ?? null,
        d_plus: c.dplus ?? null, target: c.target ?? null,
        laps: c.laps ?? null, notes: c.notes ?? null,
        gpx_name: c.gpxName ?? null, gpx_content: c.gpxContent ?? null,
        stages: c.stages ?? null,
      })),
    },
    // ----- Entraînements prévus -----
    {
      lsKey: 'coach_ia_trainings_v1',
      table: 'trainings',
      conflictCol: 'id',
      transform: (arr) => (arr || []).map(t => ({
        user_id: userId, client_id: t.id,
        name: t.name, date: t.date, sport: t.sport ?? null,
        type: t.type ?? null, duration: t.duration ?? null,
        tss: t.tss ?? null, notes: t.notes ?? null,
        mode: 'prevu', structure: t.structure ?? null,
      })),
    },
    // ----- Entraînements réalisés -----
    {
      lsKey: 'coach_ia_trainings_realise_v1',
      table: 'trainings',
      conflictCol: 'id',
      transform: (arr) => (arr || []).map(t => ({
        user_id: userId, client_id: t.id,
        name: t.name, date: t.date, sport: t.sport ?? null,
        type: t.type ?? null, duration: t.duration ?? null,
        tss: t.tss ?? null, notes: t.notes ?? null,
        mode: 'realise', structure: t.structure ?? null,
      })),
    },
    // ----- Repos forcés -----
    {
      lsKey: 'coach_ia_template_rest_days_v1',
      table: 'template_rest_days',
      conflictCol: 'user_id,iso_date',
      transform: (arr) => (arr || []).map(iso => ({ user_id: userId, iso_date: iso })),
    },
    // ----- Strava ignored -----
    {
      lsKey: 'coach_ia_strava_ignore_v1',
      table: 'strava_ignored',
      conflictCol: 'user_id,activity_id',
      transform: (arr) => (arr || []).map(id => ({ user_id: userId, activity_id: String(id) })),
    },
    // ----- Snapshots du plan -----
    {
      lsKey: 'coach_ia_plan_snapshots_v1',
      table: 'plan_snapshots',
      conflictCol: 'user_id,iso_date',
      transform: (obj) => Object.entries(obj || {}).map(([iso, proposal]) => ({
        user_id: userId, iso_date: iso, proposal,
      })),
    },
  ];

  for (const m of migrations) {
    try {
      const raw = localStorage.getItem(m.lsKey);
      if (!raw) continue;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const rows = m.transform(parsed);
      if (!rows.length) continue;

      // Check si la table est déjà non vide pour cet user
      const { count } = await sb.from(m.table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
      if (count && count > 0) {
        console.log(`[migrate] ${m.table} : déjà ${count} lignes, skip migration locale`);
        continue;
      }

      const { error } = await sb.from(m.table).upsert(rows, { onConflict: m.conflictCol });
      if (error) {
        console.warn(`[migrate] ${m.table} :`, error.message);
      } else {
        console.log(`[migrate] ${m.table} : ${rows.length} lignes migrées depuis localStorage`);
      }
    } catch (e) {
      console.warn(`[migrate] ${m.lsKey} échec :`, e);
    }
  }

  // Force un re-render des vues qui dépendent des données migrées
  setTimeout(() => {
    if (window.renderCalendar) window.renderCalendar();
    if (window.renderCompList) window.renderCompList();
    if (window.renderBilan) window.renderBilan();
    if (window.renderWellnessTrend) window.renderWellnessTrend();
  }, 500);
}

// Expose pour debug
window.storageAdapter = { readKv, storeKv, syncKv, listRows, upsertRow, deleteRow, migrateLocalToCloud };
