-- ============================================================
-- schema_v2.sql — Schéma étendu Coach IA (multi-user Strava + Whoop)
--
-- Ce schéma complète schema.sql en ajoutant :
--   - strava_connections (tokens OAuth par user)
--   - activities (toutes les activités Strava)
--   - daily_metrics (CTL/ATL/TSB calculés)
--   - power_profile (records de puissance)
--   - whoop_data, whoop_connections
--   - Extension de user_profiles : ftp, hr_max, lthr, weight, strava_athlete_id
--
-- ⚠ IMPORTANT : strava_athlete_id n'est PAS UNIQUE.
--   Un même compte Strava peut être lié à plusieurs utilisateurs Coach IA
--   (ex : compte famille, comptes test). L'unicité est garantie par user_id
--   uniquement (chaque user a au plus 1 connexion Strava).
-- ============================================================

-- ============ EXTENSION user_profiles ============
-- extras jsonb : stocke tous les champs du profil athlète étendu (sports, équipement,
-- objectifs, dispo, santé, coaching, records…) sans avoir à créer 50+ colonnes.
alter table if exists user_profiles
  add column if not exists ftp integer,
  add column if not exists hr_max integer,
  add column if not exists lthr integer,
  add column if not exists weight numeric,
  add column if not exists strava_athlete_id bigint,
  add column if not exists extras jsonb default '{}'::jsonb;

-- ============ TABLE strava_connections ============
create table if not exists strava_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  strava_athlete_id bigint not null,  -- pas UNIQUE : plusieurs users peuvent partager 1 compte Strava
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz
);

alter table strava_connections enable row level security;

drop policy if exists "strava_connections_select_own" on strava_connections;
create policy "strava_connections_select_own" on strava_connections
  for select using (auth.uid() = user_id);

drop policy if exists "strava_connections_insert_own" on strava_connections;
create policy "strava_connections_insert_own" on strava_connections
  for insert with check (auth.uid() = user_id);

drop policy if exists "strava_connections_update_own" on strava_connections;
create policy "strava_connections_update_own" on strava_connections
  for update using (auth.uid() = user_id);

drop policy if exists "strava_connections_delete_own" on strava_connections;
create policy "strava_connections_delete_own" on strava_connections
  for delete using (auth.uid() = user_id);

create index if not exists idx_strava_connections_user on strava_connections(user_id);
create index if not exists idx_strava_connections_athlete on strava_connections(strava_athlete_id);

-- ============ TABLE activities ============
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strava_id bigint not null,
  date date not null,
  start_time timestamptz,
  name text,
  sport text,
  type text,
  category text,
  duration_min integer,
  distance_km numeric,
  elevation_m integer,
  avg_hr integer,
  max_hr integer,
  avg_power integer,
  max_power integer,
  normalized_power integer,
  intensity_factor numeric,
  tss numeric,
  kcal integer,
  effort integer,
  description text,
  raw jsonb,
  inserted_at timestamptz not null default now(),
  unique (user_id, strava_id)
);

alter table activities enable row level security;

drop policy if exists "activities_select_own" on activities;
create policy "activities_select_own" on activities
  for select using (auth.uid() = user_id);

drop policy if exists "activities_insert_own" on activities;
create policy "activities_insert_own" on activities
  for insert with check (auth.uid() = user_id);

drop policy if exists "activities_update_own" on activities;
create policy "activities_update_own" on activities
  for update using (auth.uid() = user_id);

drop policy if exists "activities_delete_own" on activities;
create policy "activities_delete_own" on activities
  for delete using (auth.uid() = user_id);

create index if not exists idx_activities_user_date on activities(user_id, date);
create index if not exists idx_activities_strava_id on activities(strava_id);

-- ============ TABLE daily_metrics ============
create table if not exists daily_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  tss_day numeric default 0,
  ctl numeric,
  atl numeric,
  tsb numeric,
  computed_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table daily_metrics enable row level security;

drop policy if exists "daily_metrics_select_own" on daily_metrics;
create policy "daily_metrics_select_own" on daily_metrics
  for select using (auth.uid() = user_id);

drop policy if exists "daily_metrics_insert_own" on daily_metrics;
create policy "daily_metrics_insert_own" on daily_metrics
  for insert with check (auth.uid() = user_id);

drop policy if exists "daily_metrics_update_own" on daily_metrics;
create policy "daily_metrics_update_own" on daily_metrics
  for update using (auth.uid() = user_id);

drop policy if exists "daily_metrics_delete_own" on daily_metrics;
create policy "daily_metrics_delete_own" on daily_metrics
  for delete using (auth.uid() = user_id);

create index if not exists idx_daily_metrics_user_date on daily_metrics(user_id, date);

-- ============ TABLE power_profile ============
create table if not exists power_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  duration_s integer not null,
  best_watts integer not null,
  activity_id bigint,
  date date,
  updated_at timestamptz not null default now(),
  unique (user_id, duration_s)
);

alter table power_profile enable row level security;

drop policy if exists "power_profile_select_own" on power_profile;
create policy "power_profile_select_own" on power_profile
  for select using (auth.uid() = user_id);

drop policy if exists "power_profile_insert_own" on power_profile;
create policy "power_profile_insert_own" on power_profile
  for insert with check (auth.uid() = user_id);

drop policy if exists "power_profile_update_own" on power_profile;
create policy "power_profile_update_own" on power_profile
  for update using (auth.uid() = user_id);

drop policy if exists "power_profile_delete_own" on power_profile;
create policy "power_profile_delete_own" on power_profile
  for delete using (auth.uid() = user_id);

create index if not exists idx_power_profile_user on power_profile(user_id);

-- ============ TABLE whoop_connections ============
create table if not exists whoop_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  whoop_user_id text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz
);

alter table whoop_connections enable row level security;

drop policy if exists "whoop_connections_all_own" on whoop_connections;
create policy "whoop_connections_all_own" on whoop_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ TABLE whoop_data ============
create table if not exists whoop_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  recovery integer,
  strain numeric,
  hrv_ms numeric,
  rhr integer,
  sleep_hours numeric,
  sleep_perf integer,
  raw jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table whoop_data enable row level security;

drop policy if exists "whoop_data_select_own" on whoop_data;
create policy "whoop_data_select_own" on whoop_data
  for select using (auth.uid() = user_id);

drop policy if exists "whoop_data_insert_own" on whoop_data;
create policy "whoop_data_insert_own" on whoop_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "whoop_data_update_own" on whoop_data;
create policy "whoop_data_update_own" on whoop_data
  for update using (auth.uid() = user_id);

drop policy if exists "whoop_data_delete_own" on whoop_data;
create policy "whoop_data_delete_own" on whoop_data
  for delete using (auth.uid() = user_id);

create index if not exists idx_whoop_data_user_date on whoop_data(user_id, date);

-- ============ MIGRATION : retirer UNIQUE de strava_athlete_id si déjà créé ============
-- À exécuter si la base a déjà été créée avec l'ancienne version (qui avait UNIQUE)
alter table if exists strava_connections
  drop constraint if exists strava_connections_strava_athlete_id_key;
