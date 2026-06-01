/* ============================================================
   js/cloud-sync.js — Sync bidirectionnelle entre localStorage et Supabase

   Stratégie :
   - Au login : on télécharge TOUT depuis Supabase et on écrit dans localStorage
     (les modules existants continuent à lire localStorage comme avant)
   - À chaque save() d'un module : il appelle pushXxxToCloud() en plus de son
     écriture localStorage (asynchrone, fire-and-forget)

   Tables couvertes :
   - wellness_days, day_notes, training_phases, yearly_goals,
   - competitions, trainings (prevu + realise),
   - template_rest_days, strava_ignored, plan_snapshots
   ============================================================ */

let _currentUser = null;

window.addEventListener('coach-ia-auth', async (e) => {
  _currentUser = e.detail.user || null;
  if (_currentUser) {
    // Au login : sync complète depuis le cloud vers localStorage
    try {
      await pullAllFromCloud();
      console.log('[cloud-sync] Pull depuis Supabase terminé');
      // Re-render des vues qui dépendent des données
      setTimeout(() => {
        if (window.renderCalendar) window.renderCalendar();
        if (window.renderCompList) window.renderCompList();
        if (window.renderBilan) window.renderBilan();
        if (window.renderWellnessTrend) window.renderWellnessTrend();
        if (window.refreshCta) window.refreshCta();
      }, 100);
    } catch (e) {
      console.error('[cloud-sync] Pull error:', e);
    }
  }
});

function uid() { return _currentUser ? _currentUser.id : null; }
function isAuthed() { return !!_currentUser && !!window.sb; }

// ============ PULL DEPUIS SUPABASE ============
// Télécharge tout et remplit localStorage (format identique à l'ancien)
async function pullAllFromCloud() {
  if (!isAuthed()) return;
  const sb = window.sb;
  const userId = uid();

  // ----- wellness_days → {iso: {weight, mood, ...}} -----
  try {
    const { data } = await sb.from('wellness_days').select('*').eq('user_id', userId);
    if (data) {
      const dict = {};
      for (const r of data) {
        dict[r.iso_date] = {
          weight: r.weight, mood: r.mood, fatigue: r.fatigue,
          soreness: r.soreness, motivation: r.motivation, notes: r.notes,
          ts: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
        };
      }
      localStorage.setItem('coach_ia_wellness_v1', JSON.stringify(dict));
    }
  } catch (e) { console.warn('[pull wellness]', e); }

  // ----- activity_overrides → { activityId: {...override} } -----
  try {
    const { data } = await sb.from('activity_overrides').select('*').eq('user_id', userId);
    if (data) {
      const map = {};
      for (const r of data) map[r.activity_id] = r.data || {};
      localStorage.setItem('coach_ia_activity_overrides_v1', JSON.stringify(map));
    }
  } catch (e) { console.warn('[pull activity overrides]', e); }

  // ----- day_notes (typées) → notes v2 [{id, type, text, color, from, to}] -----
  try {
    const { data } = await sb.from('day_notes').select('*').eq('user_id', userId);
    if (data) {
      const arr = data.map(r => ({
        id: r.client_id || r.id,
        _sbId: r.id,
        type: r.type,
        text: r.text || '',
        color: r.color,
        from: r.from_date,
        to: r.to_date,
      }));
      localStorage.setItem('coach_ia_notes_v2', JSON.stringify(arr));
    }
  } catch (e) { console.warn('[pull notes v2]', e); }

  // ----- training_phases → [{id, phase, from, to, name}] -----
  try {
    const { data } = await sb.from('training_phases').select('*').eq('user_id', userId);
    if (data) {
      const arr = data.map(r => ({
        id: r.client_id || r.id,
        _sbId: r.id,  // pour pouvoir update/delete par id Supabase
        phase: r.phase,
        from: r.from_date,
        to: r.to_date,
        name: r.name || undefined,
      }));
      localStorage.setItem('coach_ia_phases_v1', JSON.stringify(arr));
    }
  } catch (e) { console.warn('[pull phases]', e); }

  // ----- yearly_goals → {year: [{id, sport, template, target, currentManual}]} -----
  try {
    const { data } = await sb.from('yearly_goals').select('*').eq('user_id', userId);
    if (data) {
      const dict = {};
      for (const r of data) {
        const y = String(r.year);
        if (!dict[y]) dict[y] = [];
        dict[y].push({
          id: r.client_id || r.id,
          _sbId: r.id,
          sport: r.sport,
          template: r.template,
          target: r.target,
          currentManual: r.current_manual ?? undefined,
        });
      }
      localStorage.setItem('coach_ia_yearly_goals_v2', JSON.stringify(dict));
    }
  } catch (e) { console.warn('[pull goals]', e); }

  // ----- compétitions → planned_sessions(competition) + activities(competition) -----
  try {
    const comps = [];
    const { data: pc } = await sb.from('planned_sessions').select('*').eq('user_id', userId).eq('category', 'competition');
    for (const r of (pc || [])) comps.push({
      id: r.client_id || r.id, _sbId: r.id, _table: 'planned',
      name: r.name, date: r.date, sport: r.sport ?? null,
      priority: r.priority ?? null, km: r.km ?? null, dplus: r.d_plus ?? null,
      target: r.target ?? null, laps: r.laps ?? null, notes: r.notes ?? null,
      gpxName: r.gpx_name ?? null, gpxContent: r.gpx_content ?? null, stages: r.stages ?? null,
    });
    const { data: ac } = await sb.from('activities')
      .select('id,client_id,name,start_date_local,sport,priority,target,distance_km,course_dplus,laps,user_notes,gpx_name,gpx_content,stages')
      .eq('user_id', userId).eq('category', 'competition');
    for (const r of (ac || [])) comps.push({
      id: r.client_id || r.id, _sbId: r.id, _table: 'activity',
      name: r.name, date: (r.start_date_local || '').slice(0, 10), sport: r.sport ?? null,
      priority: r.priority ?? null, km: r.distance_km ?? null, dplus: r.course_dplus ?? null,
      target: r.target ?? null, laps: r.laps ?? null, notes: r.user_notes ?? null,
      gpxName: r.gpx_name ?? null, gpxContent: r.gpx_content ?? null, stages: r.stages ?? null,
    });
    // Dédoublonnage par id effectif (client_id) — garde une seule entrée
    const seen = new Set();
    const deduped = comps.filter(c => { const k = c.id; if (seen.has(k)) return false; seen.add(k); return true; });
    localStorage.setItem('coach_ia_competitions_v1', JSON.stringify(deduped));
  } catch (e) { console.warn('[pull comps]', e); }

  // ----- prévus → planned_sessions(entrainement) ; réalisés = activities (via le loader) -----
  try {
    const { data } = await sb.from('planned_sessions').select('*').eq('user_id', userId).eq('category', 'entrainement');
    const prevu = (data || []).map(r => ({
      id: r.client_id || r.id, _sbId: r.id,
      name: r.name, date: r.date, sport: r.sport ?? null, type: r.type ?? null,
      duration: r.duration ?? 0, tss: r.tss ?? 0, notes: r.notes ?? '', mode: 'prevu',
      structure: r.structure ?? null,
    }));
    localStorage.setItem('coach_ia_trainings_v1', JSON.stringify(prevu));
    localStorage.setItem('coach_ia_trainings_realise_v1', JSON.stringify([]));
  } catch (e) { console.warn('[pull planned]', e); }

  // ----- template_rest_days → array d'isos -----
  try {
    const { data } = await sb.from('template_rest_days').select('*').eq('user_id', userId);
    if (data) {
      const arr = data.map(r => r.iso_date);
      localStorage.setItem('coach_ia_template_rest_days_v1', JSON.stringify(arr));
    }
  } catch (e) { console.warn('[pull rest days]', e); }

  // ----- strava_ignored → array d'ids -----
  try {
    const { data } = await sb.from('strava_ignored').select('*').eq('user_id', userId);
    if (data) {
      const arr = data.map(r => r.activity_id);
      localStorage.setItem('coach_ia_strava_ignore_v1', JSON.stringify(arr));
    }
  } catch (e) { console.warn('[pull strava ignored]', e); }

  // ----- plan_snapshots → {iso: proposal} -----
  try {
    const { data } = await sb.from('plan_snapshots').select('*').eq('user_id', userId);
    if (data) {
      const dict = {};
      for (const r of data) dict[r.iso_date] = r.proposal;
      localStorage.setItem('coach_ia_plan_snapshots_v1', JSON.stringify(dict));
    }
  } catch (e) { console.warn('[pull snapshots]', e); }
}

// ============ PUSH VERS SUPABASE (par entité, fire-and-forget) ============
// Toutes ces fonctions sont async mais on les appelle SANS await (fire-and-forget).
// Si erreur réseau, le localStorage garde la donnée et on log dans la console.

export async function pushWellness(isoDate, data) {
  if (!isAuthed()) return;
  try {
    await window.sb.from('wellness_days').upsert({
      user_id: uid(), iso_date: isoDate,
      weight: data.weight ?? null,
      mood: data.mood ?? null,
      fatigue: data.fatigue ?? null,
      soreness: data.soreness ?? null,
      motivation: data.motivation ?? null,
      notes: data.notes ?? null,
    }, { onConflict: 'user_id,iso_date' });
  } catch (e) { console.warn('[push wellness]', e.message); }
}
export async function deleteWellness(isoDate) {
  if (!isAuthed()) return;
  try { await window.sb.from('wellness_days').delete().eq('user_id', uid()).eq('iso_date', isoDate); }
  catch (e) { console.warn('[del wellness]', e.message); }
}

export async function pushNote(isoDate, text) {
  if (!isAuthed()) return;
  try {
    if (text && text.trim()) {
      await window.sb.from('day_notes').upsert({
        user_id: uid(), iso_date: isoDate, note: text.trim(),
      }, { onConflict: 'user_id,iso_date' });
    } else {
      await window.sb.from('day_notes').delete().eq('user_id', uid()).eq('iso_date', isoDate);
    }
  } catch (e) { console.warn('[push note]', e.message); }
}

export async function pushActivityOverride(activityId, data) {
  if (!isAuthed()) return;
  try {
    await window.sb.from('activity_overrides').upsert(
      { user_id: uid(), activity_id: String(activityId), data },
      { onConflict: 'user_id,activity_id' }
    );
  } catch (e) { console.warn('[push activity override]', e.message); }
}
export async function deleteActivityOverride(activityId) {
  if (!isAuthed()) return;
  try {
    await window.sb.from('activity_overrides').delete().eq('user_id', uid()).eq('activity_id', String(activityId));
  } catch (e) { console.warn('[del activity override]', e.message); }
}

export async function pushNoteRange(note) {
  // note: {id, type, text, color, from, to, _sbId?}
  if (!isAuthed()) return;
  try {
    const row = {
      user_id: uid(), client_id: note.id,
      type: note.type, text: note.text ?? null, color: note.color ?? null,
      from_date: note.from, to_date: note.to,
    };
    if (note._sbId) row.id = note._sbId;
    if (!row.id) row.id = await _resolveId('day_notes', note.id);
    if (!row.id) delete row.id;
    const { data, error } = await window.sb.from('day_notes').upsert(row).select().single();
    if (error) throw error;
    return data && data.id;
  } catch (e) { console.warn('[push note range]', e.message); }
}
export async function deleteNoteRange(note) {
  if (!isAuthed()) return;
  try {
    if (note._sbId) await window.sb.from('day_notes').delete().eq('id', note._sbId).eq('user_id', uid());
    else if (note.id) await window.sb.from('day_notes').delete().eq('client_id', note.id).eq('user_id', uid());
  } catch (e) { console.warn('[del note range]', e.message); }
}

export async function pushPhase(phase) {
  // phase: {id, phase, from, to, name?, _sbId?}
  if (!isAuthed()) return;
  try {
    const row = {
      user_id: uid(), client_id: phase.id,
      phase: phase.phase, from_date: phase.from, to_date: phase.to,
      name: phase.name ?? null,
    };
    if (phase._sbId) row.id = phase._sbId;
    const { data, error } = await window.sb.from('training_phases').upsert(row).select().single();
    if (error) throw error;
    return data && data.id;
  } catch (e) { console.warn('[push phase]', e.message); }
}
export async function deletePhase(phase) {
  if (!isAuthed()) return;
  try {
    if (phase._sbId) {
      await window.sb.from('training_phases').delete().eq('id', phase._sbId).eq('user_id', uid());
    } else if (phase.id) {
      await window.sb.from('training_phases').delete().eq('client_id', phase.id).eq('user_id', uid());
    }
  } catch (e) { console.warn('[del phase]', e.message); }
}

export async function pushGoal(year, goal) {
  if (!isAuthed()) return;
  try {
    const row = {
      user_id: uid(), client_id: goal.id, year: parseInt(year, 10),
      sport: goal.sport, template: goal.template, target: goal.target,
      current_manual: goal.currentManual ?? null,
    };
    if (goal._sbId) row.id = goal._sbId;
    const { data, error } = await window.sb.from('yearly_goals').upsert(row).select().single();
    if (error) throw error;
    return data && data.id;
  } catch (e) { console.warn('[push goal]', e.message); }
}
export async function deleteGoal(goal) {
  if (!isAuthed()) return;
  try {
    if (goal._sbId) await window.sb.from('yearly_goals').delete().eq('id', goal._sbId).eq('user_id', uid());
    else if (goal.id) await window.sb.from('yearly_goals').delete().eq('client_id', goal.id).eq('user_id', uid());
  } catch (e) { console.warn('[del goal]', e.message); }
}

// Aujourd'hui (ISO) pour router compé passée (activities) vs future (planned_sessions).
function _todayIso() { return new Date().toISOString().slice(0, 10); }

// Évite les doublons : si la ligne n'a pas d'id Supabase, on récupère l'id existant
// par client_id avant l'upsert (sinon chaque save réinsère une nouvelle ligne).
async function _resolveId(table, clientId) {
  try {
    const { data } = await window.sb.from(table).select('id').eq('user_id', uid()).eq('client_id', clientId).limit(1).maybeSingle();
    return data && data.id;
  } catch { return null; }
}

export async function pushCompetition(comp) {
  if (!isAuthed()) return;
  try {
    const future = (comp.date || '') > _todayIso();
    if (future) {
      const row = {
        user_id: uid(), client_id: comp.id, category: 'competition',
        name: comp.name, date: comp.date, sport: comp.sport ?? null,
        priority: comp.priority ?? null, km: comp.km ?? null, d_plus: comp.dplus ?? null,
        target: comp.target ?? null, laps: comp.laps ?? null, notes: comp.notes ?? null,
        gpx_name: comp.gpxName ?? null, gpx_content: comp.gpxContent ?? null, stages: comp.stages ?? null,
      };
      if (comp._sbId && comp._table === 'planned') row.id = comp._sbId;
      if (!row.id) row.id = await _resolveId('planned_sessions', comp.id);
      if (!row.id) delete row.id;
      const { data, error } = await window.sb.from('planned_sessions').upsert(row).select().single();
      if (error) throw error;
      return data && data.id;
    } else {
      const row = {
        user_id: uid(), source: 'manual', category: 'competition', client_id: comp.id,
        name: comp.name, start_date_local: comp.date + 'T12:00:00', sport: comp.sport ?? null,
        priority: comp.priority ?? null, distance_km: comp.km ?? null, course_dplus: comp.dplus ?? null,
        target: comp.target ?? null, laps: comp.laps ?? null, user_notes: comp.notes ?? null,
        gpx_name: comp.gpxName ?? null, gpx_content: comp.gpxContent ?? null, stages: comp.stages ?? null,
      };
      if (comp._sbId && comp._table === 'activity') row.id = comp._sbId;
      if (!row.id) row.id = await _resolveId('activities', comp.id);
      if (!row.id) delete row.id;
      const { data, error } = await window.sb.from('activities').upsert(row).select().single();
      if (error) throw error;
      return data && data.id;
    }
  } catch (e) { console.warn('[push comp]', e.message); }
}
export async function deleteCompetition(comp) {
  if (!isAuthed()) return;
  const table = comp._table === 'activity' ? 'activities' : 'planned_sessions';
  try {
    if (comp._sbId) await window.sb.from(table).delete().eq('id', comp._sbId).eq('user_id', uid());
    else if (comp.id) await window.sb.from(table).delete().eq('client_id', comp.id).eq('user_id', uid());
  } catch (e) { console.warn('[del comp]', e.message); }
}

export async function pushTraining(training, mode) {
  if (!isAuthed()) return;
  mode = mode || training.mode || 'prevu';
  try {
    if (mode === 'prevu') {
      const row = {
        user_id: uid(), client_id: training.id, category: 'entrainement',
        name: training.name, date: training.date, sport: training.sport ?? null,
        type: training.type ?? null, duration: training.duration ?? 0, tss: training.tss ?? 0,
        notes: training.notes ?? '', structure: training.structure ?? null,
      };
      if (training._sbId) row.id = training._sbId;
      if (!row.id) row.id = await _resolveId('planned_sessions', training.id);
      if (!row.id) delete row.id;
      const { data, error } = await window.sb.from('planned_sessions').upsert(row).select().single();
      if (error) throw error;
      return data && data.id;
    } else {
      // réalisé → activity manuelle
      const row = {
        user_id: uid(), source: 'manual', category: 'entrainement', client_id: training.id,
        name: training.name, start_date_local: training.date + 'T12:00:00', sport: training.sport ?? null,
        type: training.type ?? null, moving_time: (training.duration || 0) * 60, tss: training.tss ?? 0,
        user_notes: training.notes ?? null,
      };
      if (training._sbId) row.id = training._sbId;
      if (!row.id) row.id = await _resolveId('activities', training.id);
      if (!row.id) delete row.id;
      const { data, error } = await window.sb.from('activities').upsert(row).select().single();
      if (error) throw error;
      return data && data.id;
    }
  } catch (e) { console.warn('[push training]', e.message); }
}
export async function deleteTraining(training) {
  if (!isAuthed()) return;
  const table = (training.mode === 'realise') ? 'activities' : 'planned_sessions';
  try {
    if (training._sbId) await window.sb.from(table).delete().eq('id', training._sbId).eq('user_id', uid());
    else if (training.id) await window.sb.from(table).delete().eq('client_id', training.id).eq('user_id', uid());
  } catch (e) { console.warn('[del training]', e.message); }
}

export async function pushRestDay(isoDate, isRest) {
  if (!isAuthed()) return;
  try {
    if (isRest) {
      await window.sb.from('template_rest_days').upsert({ user_id: uid(), iso_date: isoDate }, { onConflict: 'user_id,iso_date' });
    } else {
      await window.sb.from('template_rest_days').delete().eq('user_id', uid()).eq('iso_date', isoDate);
    }
  } catch (e) { console.warn('[push restday]', e.message); }
}

export async function pushStravaIgnored(activityId, isIgnored) {
  if (!isAuthed()) return;
  try {
    if (isIgnored) {
      await window.sb.from('strava_ignored').upsert({ user_id: uid(), activity_id: String(activityId) }, { onConflict: 'user_id,activity_id' });
    } else {
      await window.sb.from('strava_ignored').delete().eq('user_id', uid()).eq('activity_id', String(activityId));
    }
  } catch (e) { console.warn('[push strava ignored]', e.message); }
}

export async function pushPlanSnapshot(isoDate, proposal) {
  if (!isAuthed()) return;
  try {
    await window.sb.from('plan_snapshots').upsert({
      user_id: uid(), iso_date: isoDate, proposal,
    }, { onConflict: 'user_id,iso_date' });
  } catch (e) { console.warn('[push snapshot]', e.message); }
}

// Expose globalement pour faciliter l'usage depuis les modules non-ES6
window.cloudSync = {
  pushWellness, deleteWellness,
  pushNote,
  pushActivityOverride, deleteActivityOverride,
  pushNoteRange, deleteNoteRange,
  pushPhase, deletePhase,
  pushGoal, deleteGoal,
  pushCompetition, deleteCompetition,
  pushTraining, deleteTraining,
  pushRestDay,
  pushStravaIgnored,
  pushPlanSnapshot,
  pullAllFromCloud,
};
