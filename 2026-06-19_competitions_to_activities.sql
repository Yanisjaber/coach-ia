-- ============================================================
-- Refactor competitions : modele unifie.
-- Les competitions REALISEES vivent desormais dans `activities` (category='competition'),
-- comme les entrainements. La table `competitions` n'est plus ecrite par le code.
--
-- Cette migration deplace les competitions SIMPLES (un jour) de `competitions` -> `activities`,
-- puis les retire de `competitions`. Les courses a etapes (stages jsonb) sont LAISSEES dans
-- `competitions` (rares ; toujours lues/affichees par le code en transition).
--
-- Idempotente (not exists). NON destructive sur `activities`.
-- A lancer APRES avoir deploye le code des phases 1 + 2.
-- ============================================================

-- 1) Competitions simples (sans etapes) -> activities
insert into public.activities
  (user_id, source, category, client_id, name, start_date_local, sport, priority,
   distance_km, course_dplus, target, moving_time, laps, user_notes, gpx_name, gpx_content)
select
  c.user_id, 'manual', 'competition', c.client_id, c.name,
  (c.date::text || ' 12:00')::timestamp, c.sport, c.priority,
  c.km, c.d_plus, c.duration, coalesce(c.duration, 0) * 60,
  c.laps, c.notes, c.gpx_name, c.gpx_content
from public.competitions c
where coalesce(jsonb_array_length(c.stages), 0) = 0
  and not exists (
    select 1 from public.activities a
    where a.user_id = c.user_id and a.category = 'competition' and a.client_id = c.client_id
  );

-- 2) Retirer de `competitions` les compets simples (migrees). On garde les courses a etapes.
delete from public.competitions c
where coalesce(jsonb_array_length(c.stages), 0) = 0;
