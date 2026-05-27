/* ============================================================
   js/wellness.js — Tracking wellness manuel quotidien

   Stocke en localStorage les saisies subjectives de l'athlète :
   poids, mood, fatigue, soreness (courbatures), motivation, notes.
   Affichées sous forme de courbes dans Tendances long-terme.

   Format storage :
   {
     "YYYY-MM-DD": {
       weight: 72.5,   // kg
       mood: 4,        // 1-5 (1=morose, 5=enthousiaste)
       fatigue: 2,     // 1-5 (1=frais, 5=épuisé)
       soreness: 1,    // 1-5 (1=aucune, 5=courbatures sévères)
       motivation: 4,  // 1-5 (1=sans envie, 5=très motivé)
       notes: "...",   // texte libre
       ts: 1716700000  // timestamp de saisie
     },
     ...
   }
   ============================================================ */

const WELLNESS_KEY = 'coach_ia_wellness_v1';

export function loadWellness() {
  try {
    return JSON.parse(localStorage.getItem(WELLNESS_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

export function saveWellnessDay(isoDate, data) {
  const all = loadWellness();
  // Merge : on ne remplace que les champs fournis (pas null/undefined/'')
  const existing = all[isoDate] || {};
  const merged = { ...existing };
  for (const k of ['weight', 'mood', 'fatigue', 'soreness', 'motivation', 'notes']) {
    const v = data[k];
    if (v !== undefined && v !== null && v !== '') merged[k] = v;
  }
  merged.ts = Date.now();
  all[isoDate] = merged;
  try {
    localStorage.setItem(WELLNESS_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('[wellness] Erreur sauvegarde :', e.message);
  }
  // Mirror cloud (fire-and-forget si connecté)
  if (window.cloudSync) window.cloudSync.pushWellness(isoDate, merged);
  // Broadcast pour que les vues qui en dépendent puissent re-render
  window.dispatchEvent(new CustomEvent('wellnessChange', { detail: { date: isoDate, data: merged } }));
  return merged;
}

export function getWellnessDay(isoDate) {
  return loadWellness()[isoDate] || null;
}

export function deleteWellnessDay(isoDate) {
  const all = loadWellness();
  delete all[isoDate];
  try {
    localStorage.setItem(WELLNESS_KEY, JSON.stringify(all));
  } catch (e) { /* ignore */ }
  if (window.cloudSync) window.cloudSync.deleteWellness(isoDate);
  window.dispatchEvent(new CustomEvent('wellnessChange', { detail: { date: isoDate, data: null } }));
}

// Renvoie [{date: "YYYY-MM-DD", weight, mood, ...}, ...] trié par date asc
export function getWellnessRange(fromIso, toIso) {
  const all = loadWellness();
  return Object.keys(all)
    .filter(d => (!fromIso || d >= fromIso) && (!toIso || d <= toIso))
    .sort()
    .map(d => ({ date: d, ...all[d] }));
}

// Helpers exposés pour les fonctions globales (compat avec le code existant)
window.loadWellness = loadWellness;
window.saveWellnessDay = saveWellnessDay;
window.getWellnessDay = getWellnessDay;
window.deleteWellnessDay = deleteWellnessDay;
window.getWellnessRange = getWellnessRange;
