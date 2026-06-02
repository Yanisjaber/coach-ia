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

   Tous les modules peuvent simplement importer et utiliser, ils
   marcheront en offline (localStorage) ET avec auth (Supabase).
   ============================================================ */

const CACHE_PREFIX = 'coach_ia_';

let _currentUser = null;

window.addEventListener('coach-ia-auth', (e) => {
  _currentUser = e.detail.user || null;
  // Le cloud (Supabase) est la source de vérité : le pull au login écrase le
  // localStorage, et chaque modification est poussée individuellement (saveCompetitions, etc.).
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

// Expose pour debug
window.storageAdapter = { readKv, storeKv, syncKv, listRows, upsertRow, deleteRow };
