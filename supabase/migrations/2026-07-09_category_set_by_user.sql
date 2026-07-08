-- ============================================================
-- Catégorie choisie par l'utilisateur vs posée automatiquement.
--
-- La synchro Strava peut reclasser en 'competition' les activités
-- marquées « Course » sur Strava (workout_type Ride 11 / Run 1),
-- mais UNIQUEMENT celles dont la catégorie n'a jamais été choisie
-- explicitement par l'utilisateur (transformation manuelle).
--
-- Backfill : les compétitions actuelles sont toutes issues de
-- transformations manuelles -> protégées.
-- ============================================================

alter table public.activities
  add column if not exists category_set_by_user boolean not null default false;

update public.activities
  set category_set_by_user = true
  where category = 'competition' and category_set_by_user = false;
