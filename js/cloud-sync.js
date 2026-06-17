/* ============================================================
   js/cloud-sync.js — Sync bidirectionnelle entre localStorage et Supabase

   Stratégie :
   - Au login : on télécharge TOUT depuis Supabase et on écrit dans localStorage
     (les modules existants continuent à lire localStorage comme avant)
   - À chaque save() d'un module : il appelle pushXxxToCloud() en plus de son
     écriture localStorage (asynchrone, fire-and-forget)

   Tables couvertes :
   - day_notes, training_phases, yearly_goals,
   - competitions, activity_planned, activities,
   - rest_day, activity_edits, connexions_app
   ============================================================ */

let _currentUser = null;
let _pulledUserId = null;     // dernier user pour qui le pull complet a déjà été fait
let _pullInProgress = false;  // évite deux pulls concurrents

window.addEventListener('coach-ia-auth', async (e) => {
  _currentUser = e.detail.user || null;
  if (!_currentUser) { _pulledUserId = null; return; }  // logout : on réarme
  // Déjà pull pour cet utilisateur (refresh jeton / retour d'onglet) → on ne re-pull PAS.
  if (_currentUser.id === _pulledUserId || _pullInProgress) return;
  _pulledUserId = _currentUser.id;
  _pullInProgress = true;
  {
    // Au login : sync complète depuis le cloud vers localStorage
    try {
      await pullAllFromCloud();
      console.log('[cloud-sync] Pull depuis Supabase terminé');
      // Re-render des vues qui dépendent des données
      setTimeout(() => {
        if (window.renderCalendar) window.renderCalendar();
        if (window.renderCompList) window.renderCompList();
        if (window.renderCompetitionsPage) window.renderCompetitionsPage();
        if (window.renderBilan) window.renderBilan();
        if (window.renderSeanceLibrary) window.renderSeanceLibrary();
        if (window.renderIaPage) window.renderIaPage();
      }, 100);
    } catch (e) {
      console.error('[cloud-sync] Pull error:', e);
      _pulledUserId = null; // échec : on autorise une nouvelle tentative au prochain event
    } finally {
      _pullInProgress = false;
    }
  }
});

window.addEventListener('coach-view-changed', async () => {
  try {
    await pullAllFromCloud();
    setTimeout(() => {
      if (window.renderCalendar) window.renderCalendar();
      if (window.renderCompList) window.renderCompList();
      if (window.renderCompetitionsPage) window.renderCompetitionsPage();
      if (window.renderSeanceLibrary) window.renderSeanceLibrary();
    }, 50);
  } catch (e) { console.warn('[cloud-sync] view-changed', e); }
});

function uid() {
  const v = (window.getViewingAthleteId && window.getViewingAthleteId());
  if (v) return v;            // mode coach : ecrit pour l'athlete consulte
  return _currentUser ? _currentUser.id : null;
}
function isAuthed() { return !!_currentUser && !!window.sb; }

// Mode coach « lecture seule » : quand on consulte les données d'un AUTRE
// athlète, toute écriture cloud est bloquée (on ne modifie jamais les données
// de l'athlète depuis le compte coach). La RLS Supabase la refuserait de toute
// façon ; ce garde évite des erreurs et des écritures localStorage parasites.
function readOnly() {
  return !!(window.isViewingOtherAthlete && window.isViewingOtherAthlete());
}

// ============ PULL DEPUIS SUPABASE ============
// Télécharge tout et remplit localStorage (format identique à l'ancien)
async function pullAllFromCloud() {
  if (!isAuthed()) return;
  const sb = window.sb;
  const userId = uid();

  // ----- activity_edits → { activityId: {...override} } -----
  try {
    const { data } = await sb.from('activity_edits').select('*').eq('user_id', userId);
    if (data) {
      const map = {};
      for (const r of data) map[r.activity_id] = r.data || {};
      localStorage.setItem('coach_ia_activity_edits_v1', JSON.stringify(map));
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
        ia: r.created_by_ia === true,
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
        ia: r.created_by_ia === true,
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

  // ----- activity_template → [{id, _sbId, sport, name, duration_min, tss, description}] -----
  try {
    const { data } = await sb.from('activity_template').select('*').eq('user_id', userId);
    if (data) {
      const arr = data
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(r => ({
          id: r.client_id || r.id,
          _sbId: r.id,
          sport: r.sport || 'autre',
          name: r.name,
          duration_min: r.duration_min || 0,
          tss: r.tss || 0,
          description: r.description || '',
          sort_order: r.sort_order || 0,
        }));
      localStorage.setItem('coach_ia_templates_v1', JSON.stringify(arr));
    }
  } catch (e) { console.warn('[pull templates]', e); }

  // ----- compétitions → registre competitions (passées) + activity_planned (futures) -----
  try {
    const comps = [];
    const _todayIso = new Date().toISOString().slice(0, 10);
    // competitions = registre des PASSÉES uniquement (les futures sont dans activity_planned)
    const { data: reg } = await sb.from('competitions').select('*').eq('user_id', userId).lte('date', _todayIso);
    for (const r of (reg || [])) comps.push({
      id: r.client_id || r.id, _sbId: r.id, _table: 'competition',
      name: r.name, date: r.date, sport: r.sport ?? null,
      priority: r.priority ?? null, km: r.km ?? null, dplus: r.d_plus ?? null,
      target: r.target ?? null, laps: r.laps ?? null, notes: r.notes ?? null,
      gpxName: r.gpx_name ?? null, gpxContent: r.gpx_content ?? null,
      stages: Array.isArray(r.stages) && r.stages.length > 0,
      stagesList: Array.isArray(r.stages) ? r.stages : null,
      activityIds: r.activity_ids ?? null,
    });
    const { data: pc } = await sb.from('activity_planned').select('*').eq('user_id', userId).eq('category', 'competition');
    for (const r of (pc || [])) comps.push({
      id: r.client_id || r.id, _sbId: r.id, _table: 'planned',
      name: r.name, date: r.date, sport: r.sport ?? null,
      priority: r.priority ?? null, km: r.km ?? null, dplus: r.d_plus ?? null,
      target: r.target ?? null, laps: r.laps ?? null, notes: r.notes ?? null,
      gpxName: r.gpx_name ?? null, gpxContent: r.gpx_content ?? null,
      stages: Array.isArray(r.stages) && r.stages.length > 0,
      stagesList: Array.isArray(r.stages) ? r.stages : null,
    });
    localStorage.setItem('coach_ia_competitions_v1', JSON.stringify(comps));
  } catch (e) { console.warn('[pull comps]', e); }

  // ----- prévus → activity_planned(entrainement) ; réalisés = activities (via le loader) -----
  try {
    const { data } = await sb.from('activity_planned').select('*').eq('user_id', userId).eq('category', 'entrainement');
    const prevu = (data || []).map(r => ({
      id: r.client_id || r.id, _sbId: r.id,
      name: r.name, date: r.date, sport: r.sport ?? null,
      duration: r.duration ?? 0, tss: r.tss ?? 0, notes: r.notes ?? '', mode: 'prevu',
      structure: r.structure ?? null,
      ia: r.created_by_ia === true,
    }));
    localStorage.setItem('coach_ia_trainings_v1', JSON.stringify(prevu));
    localStorage.setItem('coach_ia_trainings_realise_v1', JSON.stringify([]));
  } catch (e) { console.warn('[pull planned]', e); }

  // ----- rest_day → array d'isos (kind passe/prevu ignoré côté client) -----
  try {
    const { data } = await sb.from('rest_day').select('*').eq('user_id', userId);
    if (data) {
      localStorage.setItem('coach_ia_template_rest_days_v1', JSON.stringify(data.map(r => r.iso_date)));
      localStorage.setItem('coach_ia_template_rest_days_ia_v1', JSON.stringify(data.filter(r => r.created_by_ia === true).map(r => r.iso_date)));
    }
  } catch (e) { console.warn('[pull rest days]', e); }

}

// ============ PUSH VERS SUPABASE (par entité, fire-and-forget) ============
// Toutes ces fonctions sont async mais on les appelle SANS await (fire-and-forget).
// Si erreur réseau, le localStorage garde la donnée et on log dans la console.

export async function pushNote(isoDate, text) {
  if (readOnly()) return;
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

export async function pushActivityEdit(activityId, data) {
  if (readOnly()) return;
  if (!isAuthed()) return;
  try {
    await window.sb.from('activity_edits').upsert(
      { user_id: uid(), activity_id: String(activityId), data },
      { onConflict: 'user_id,activity_id' }
    );
  } catch (e) { console.warn('[push activity override]', e.message); }
}
export async function deleteActivityEdit(activityId) {
  if (readOnly()) return;
  if (!isAuthed()) return;
  try {
    await window.sb.from('activity_edits').delete().eq('user_id', uid()).eq('activity_id', String(activityId));
  } catch (e) { console.warn('[del activity override]', e.message); }
}

export async function pushNoteRange(note) {
  if (readOnly()) return;
  // note: {id, type, text, color, from, to, _sbId?}
  if (!isAuthed()) return;
  try {
    const row = {
      user_id: uid(), client_id: note.id,
      type: note.type, text: note.text ?? null, color: note.color ?? null,
      from_date: note.from, to_date: note.to,
      created_by_ia: note.ia === true,
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
  if (readOnly()) return;
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
      created_by_ia: phase.ia === true,
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
  if (readOnly()) return;
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
  if (readOnly()) return;
  if (!isAuthed()) return;
  try {
    if (goal._sbId) await window.sb.from('yearly_goals').delete().eq('id', goal._sbId).eq('user_id', uid());
    else if (goal.id) await window.sb.from('yearly_goals').delete().eq('client_id', goal.id).eq('user_id', uid());
  } catch (e) { console.warn('[del goal]', e.message); }
}

export async function pushTemplate(tpl) {
  if (!isAuthed()) return;
  try {
    const row = {
      user_id: uid(), client_id: tpl.id,
      sport: tpl.sport || 'autre', name: tpl.name,
      duration_min: tpl.duration_min || 0, tss: tpl.tss || 0,
      description: tpl.description || null, sort_order: tpl.sort_order || 0,
      updated_at: new Date().toISOString(),
    };
    if (tpl._sbId) row.id = tpl._sbId;
    const { data, error } = await window.sb.from('activity_template').upsert(row).select().single();
    if (error) throw error;
    return data && data.id;
  } catch (e) { console.warn('[push template]', e.message); }
}
export async function deleteTemplate(tpl) {
  if (!isAuthed()) return;
  try {
    if (tpl._sbId) await window.sb.from('activity_template').delete().eq('id', tpl._sbId).eq('user_id', uid());
    else if (tpl.id) await window.sb.from('activity_template').delete().eq('client_id', tpl.id).eq('user_id', uid());
  } catch (e) { console.warn('[del template]', e.message); }
}

// Aujourd'hui (ISO) pour router compé passée (activities) vs future (activity_planned).
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
        gpx_name: comp.gpxName ?? null, gpx_content: comp.gpxContent ?? null,
        stages: (comp.stages && Array.isArray(comp.stagesList)) ? comp.stagesList : (Array.isArray(comp.stages) ? comp.stages : null),
        event: comp.event ?? null,
      };
      if (comp._sbId && comp._table === 'planned') row.id = comp._sbId;
      if (!row.id) row.id = await _resolveId('activity_planned', comp.id);
      if (!row.id) delete row.id;
      const { data, error } = await window.sb.from('activity_planned').upsert(row).select().single();
      if (error) throw error;
      return data && data.id;
    } else {
      // Compétition passée → registre competitions (relie une ou plusieurs activités)
      const row = {
        user_id: uid(), client_id: comp.id,
        name: comp.name, date: comp.date, sport: comp.sport ?? null,
        priority: comp.priority ?? null, km: comp.km ?? null, d_plus: comp.dplus ?? null,
        target: comp.target ?? null, laps: comp.laps ?? null, notes: comp.notes ?? null,
        gpx_name: comp.gpxName ?? null, gpx_content: comp.gpxContent ?? null,
        stages: (comp.stages && Array.isArray(comp.stagesList)) ? comp.stagesList : (Array.isArray(comp.stages) ? comp.stages : null),
        activity_ids: comp.activityIds ?? [],
      };
      if (comp._sbId && comp._table === 'competition') row.id = comp._sbId;
      if (!row.id) row.id = await _resolveId('competitions', comp.id);
      if (!row.id) delete row.id;
      const { data, error } = await window.sb.from('competitions').upsert(row).select().single();
      if (error) throw error;
      return data && data.id;
    }
  } catch (e) { console.warn('[push comp]', e.message); }
}
export async function deleteCompetition(comp) {
  if (!isAuthed()) return;
  const table = comp._table === 'planned' ? 'activity_planned' : 'competitions';
  try {
    if (comp._sbId) await window.sb.from(table).delete().eq('id', comp._sbId).eq('user_id', uid());
    else if (comp.id) await window.sb.from(table).delete().eq('client_id', comp.id).eq('user_id', uid());
  } catch (e) { console.warn('[del comp]', e.message); }
}

// Crée/maj une compétition (registre) reliant des activités, et supprime par activité.
export async function pushCompetitionRegistry(comp) {
  return await pushCompetition({ ...comp, _table: 'competition' });
}
export async function deleteCompetitionByActivity(activityId) {
  if (!isAuthed()) return;
  try {
    await window.sb.from('competitions').delete().eq('user_id', uid()).contains('activity_ids', [String(activityId)]);
  } catch (e) { console.warn('[del comp by act]', e.message); }
}

export async function pushTraining(training, mode) {
  if (!isAuthed()) return;
  mode = mode || training.mode || 'prevu';
  try {
    if (mode === 'prevu') {
      const row = {
        user_id: uid(), client_id: training.id, category: 'entrainement',
        name: training.name, date: training.date, sport: training.sport ?? null,
        duration: training.duration ?? 0, tss: training.tss ?? 0,
        notes: training.notes ?? '', structure: training.structure ?? null,
        created_by_ia: training.ia === true,
      };
      if (training._sbId) row.id = training._sbId;
      if (!row.id) row.id = await _resolveId('activity_planned', training.id);
      if (!row.id) delete row.id;
      const { data, error } = await window.sb.from('activity_planned').upsert(row).select().single();
      if (error) throw error;
      return data && data.id;
    } else {
      // réalisé → activity manuelle
      const row = {
        user_id: uid(), source: 'manual', category: 'entrainement', client_id: training.id,
        name: training.name, start_date_local: training.date + 'T12:00:00', sport: training.sport ?? null,
        moving_time: (training.duration || 0) * 60, tss: training.tss ?? 0,
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
  const table = (training.mode === 'realise') ? 'activities' : 'activity_planned';
  try {
    if (training._sbId) await window.sb.from(table).delete().eq('id', training._sbId).eq('user_id', uid());
    else if (training.id) await window.sb.from(table).delete().eq('client_id', training.id).eq('user_id', uid());
  } catch (e) { console.warn('[del training]', e.message); }
}

export async function pushRestDay(isoDate, isRest, ia) {
  if (!isAuthed()) return;
  try {
    if (isRest) {
      // passe/prevu n'est PAS stocke : derive de la date a l'affichage.
      await window.sb.from('rest_day').upsert({ user_id: uid(), iso_date: isoDate, created_by_ia: ia === true }, { onConflict: 'user_id,iso_date' });
    } else {
      await window.sb.from('rest_day').delete().eq('user_id', uid()).eq('iso_date', isoDate);
    }
  } catch (e) { console.warn('[push restday]', e.message); }
}

// ============================================================
// Expose toutes les fonctions de sync sur window.cloudSync.
// SANS cette ligne, window.cloudSync est undefined et TOUTES les ecritures
// (activites manuelles, competitions, notes, repos, phases, objectifs, templates)
// restent en localStorage sans jamais remonter dans Supabase.
// ============================================================
window.cloudSync = {
  pushNote, pushActivityEdit, deleteActivityEdit,
  pushNoteRange, deleteNoteRange,
  pushPhase, deletePhase,
  pushGoal, deleteGoal,
  pushTemplate, deleteTemplate,
  pushCompetition, deleteCompetition, pushCompetitionRegistry, deleteCompetitionByActivity,
  pushTraining, deleteTraining,
  pushRestDay,
  pullAllFromCloud,
};
