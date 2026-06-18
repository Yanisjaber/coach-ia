-- ============================================================
-- Nettoyage final du refactor competitions.
-- Tout ce qui reste dans `competitions` est deplace vers `activities`
-- (category='competition', stages jsonb preserve), puis on DROPPE la table.
-- Le code ne lit/ecrit plus `competitions`.
-- A LANCER APRES avoir deploye le code (sinon le pull lirait une table absente).
-- Idempotent.
-- ============================================================

insert into public.activities
  (user_id, source, category, client_id, name, start_date_local, sport, priority,
   distance_km, course_dplus, target, moving_time, laps, user_notes, gpx_name, gpx_content, stages)
select
  c.user_id, 'manual', 'competition', c.client_id, c.name,
  (c.date::text || ' 12:00')::timestamp, c.sport, c.priority,
  c.km, c.d_plus, c.duration, coalesce(c.duration, 0) * 60,
  c.laps, c.notes, c.gpx_name, c.gpx_content, c.stages
from public.competitions c
where not exists (
  select 1 from public.activities a
  where a.user_id = c.user_id and a.category = 'competition' and a.client_id = c.client_id
);

drop table if exists public.competitions;
