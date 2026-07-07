-- Bibliothèque de séances : le modal réutilise désormais le train-modal.
-- Nouveaux champs des modèles : sport Strava exact, RPE, distance, D+, structure (intervalles).
alter table public.activity_template
  add column if not exists sport_raw   text,      -- sport Strava exact (ex: 'Ride', 'TrailRun')
  add column if not exists rpe         numeric,   -- RPE estimé (1-10)
  add column if not exists distance_km numeric,
  add column if not exists dplus       integer,
  add column if not exists structure   jsonb;     -- structure d'intervalles (même format que activity_planned)
