-- ============================================================
-- Triathlon : colonnes PAR SEGMENT, alignées sur le nouveau panneau
-- (onglets Natation / T1 / Vélo / T2 / CAP de la modale compétition).
--
-- Le front écrit tout dans la colonne jsonb `tri` :
--   { swim:{min,dist_m,pace}, t1_min, bike:{min,dist_km,speed,dplus},
--     t2_min, run:{min,dist_km,pace}, swim_m, bike_km, run_km }
--
-- Ces colonnes sont GÉNÉRÉES (generated always ... stored) : elles se
-- remplissent/mettent à jour toutes seules à chaque écriture du jsonb.
-- Zéro changement côté app, données lisibles et requêtables en SQL.
-- ============================================================

-- ---------- activity_planned (compétitions/séances prévues) ----------
alter table public.activity_planned
  add column if not exists tri_swim_min  numeric generated always as ((tri->'swim'->>'min')::numeric) stored,
  add column if not exists tri_swim_m    numeric generated always as (coalesce((tri->'swim'->>'dist_m')::numeric, (tri->>'swim_m')::numeric)) stored,
  add column if not exists tri_swim_pace text    generated always as (tri->'swim'->>'pace') stored,
  add column if not exists tri_t1_min    numeric generated always as ((tri->>'t1_min')::numeric) stored,
  add column if not exists tri_bike_min  numeric generated always as ((tri->'bike'->>'min')::numeric) stored,
  add column if not exists tri_bike_km   numeric generated always as (coalesce((tri->'bike'->>'dist_km')::numeric, (tri->>'bike_km')::numeric)) stored,
  add column if not exists tri_bike_kmh  numeric generated always as ((tri->'bike'->>'speed')::numeric) stored,
  add column if not exists tri_bike_dplus numeric generated always as ((tri->'bike'->>'dplus')::numeric) stored,
  add column if not exists tri_t2_min    numeric generated always as ((tri->>'t2_min')::numeric) stored,
  add column if not exists tri_run_min   numeric generated always as ((tri->'run'->>'min')::numeric) stored,
  add column if not exists tri_run_km    numeric generated always as (coalesce((tri->'run'->>'dist_km')::numeric, (tri->>'run_km')::numeric)) stored,
  add column if not exists tri_run_pace  text    generated always as (tri->'run'->>'pace') stored;

-- ---------- activities (compétitions/événements réalisés) ----------
alter table public.activities
  add column if not exists tri_swim_min  numeric generated always as ((tri->'swim'->>'min')::numeric) stored,
  add column if not exists tri_swim_m    numeric generated always as (coalesce((tri->'swim'->>'dist_m')::numeric, (tri->>'swim_m')::numeric)) stored,
  add column if not exists tri_swim_pace text    generated always as (tri->'swim'->>'pace') stored,
  add column if not exists tri_t1_min    numeric generated always as ((tri->>'t1_min')::numeric) stored,
  add column if not exists tri_bike_min  numeric generated always as ((tri->'bike'->>'min')::numeric) stored,
  add column if not exists tri_bike_km   numeric generated always as (coalesce((tri->'bike'->>'dist_km')::numeric, (tri->>'bike_km')::numeric)) stored,
  add column if not exists tri_bike_kmh  numeric generated always as ((tri->'bike'->>'speed')::numeric) stored,
  add column if not exists tri_bike_dplus numeric generated always as ((tri->'bike'->>'dplus')::numeric) stored,
  add column if not exists tri_t2_min    numeric generated always as ((tri->>'t2_min')::numeric) stored,
  add column if not exists tri_run_min   numeric generated always as ((tri->'run'->>'min')::numeric) stored,
  add column if not exists tri_run_km    numeric generated always as (coalesce((tri->'run'->>'dist_km')::numeric, (tri->>'run_km')::numeric)) stored,
  add column if not exists tri_run_pace  text    generated always as (tri->'run'->>'pace') stored;
