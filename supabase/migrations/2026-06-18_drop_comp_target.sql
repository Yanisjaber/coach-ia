-- ============================================================
-- Supprime definitivement la colonne `target` (texte) des competitions :
--  1) backfill `duration` (minutes) depuis l'ancien `target` texte
--     ("2h" -> 120, "1h40" -> 100, "5h30" -> 330, "90" -> 90)
--  2) drop de la colonne `target`
-- A executer APRES 2026-06-18_comp_duration.sql.
-- ============================================================

-- competitions (compet passees)
update public.competitions
set duration = case
  when target ~ '^\s*\d+\s*h' then
    (regexp_replace(target, '^\s*(\d+)\s*h.*$', '\1'))::int * 60
    + coalesce(nullif(regexp_replace(target, '^\s*\d+\s*h\s*(\d*).*$', '\1'), ''), '0')::int
  when target ~ '^\s*\d+\s*$' then trim(target)::int
  else duration
end
where duration is null and target is not null and btrim(target) <> '';

alter table if exists public.competitions drop column if exists target;

-- activity_planned (compet futures ; les entrainements ont target NULL)
update public.activity_planned
set duration = case
  when target ~ '^\s*\d+\s*h' then
    (regexp_replace(target, '^\s*(\d+)\s*h.*$', '\1'))::int * 60
    + coalesce(nullif(regexp_replace(target, '^\s*\d+\s*h\s*(\d*).*$', '\1'), ''), '0')::int
  when target ~ '^\s*\d+\s*$' then trim(target)::int
  else duration
end
where category = 'competition' and duration is null and target is not null and btrim(target) <> '';

alter table if exists public.activity_planned drop column if exists target;
