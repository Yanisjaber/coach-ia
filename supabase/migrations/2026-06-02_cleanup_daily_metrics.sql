-- Nettoie daily_metrics : supprime les lignes antérieures à la première VRAIE
-- activité de chaque user (élimine la série aberrante remontant jusqu'en 1970).
-- À exécuter dans le SQL Editor de Supabase.

-- 1) (Diagnostic facultatif) repérer les activités à date aberrante :
-- select id, name, start_date_local, source
-- from public.activities
-- where start_date_local::date < '2000-01-01';

-- 2) Supprimer les activités à date aberrante (ex. epoch 1970), toutes sources.
delete from public.activities
where start_date_local::date < '2000-01-01';

-- 3) Purge des daily_metrics antérieurs à la 1ʳᵉ activité restante :
delete from public.daily_metrics dm
where dm.iso_date < (
  select min(a.start_date_local::date)
  from public.activities a
  where a.user_id = dm.user_id
);
