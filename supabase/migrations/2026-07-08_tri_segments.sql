-- Triathlon : distances par discipline sur les compétitions/événements.
-- Format jsonb : { "swim_m": 1500, "bike_km": 40, "run_km": 10 }
alter table public.activity_planned add column if not exists tri jsonb;
alter table public.activities       add column if not exists tri jsonb;
