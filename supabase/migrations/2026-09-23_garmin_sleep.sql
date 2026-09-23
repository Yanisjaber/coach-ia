-- ============================================================
-- 2026-09-23_garmin_sleep.sql — Intégration Garmin (sommeil)
--
-- Garmin n'a pas de portail OAuth développeur public comme Strava/Whoop :
-- la connexion se fait une fois via un login manuel (garth/garminconnect),
-- puis le refresh du token d'accès se fait par une signature OAuth1
-- HMAC-SHA1 (oauth1_token/oauth1_secret), pas par un refresh_token
-- classique. D'où les deux colonnes dédiées sur connexions_app.
-- ============================================================

-- 1) connexions_app : autoriser 'garmin' dans la contrainte app,
--    quel que soit son nom généré (recherche dynamique par définition).
do $$
declare
  cons record;
begin
  for cons in
    select conname
    from pg_constraint
    where conrelid = 'public.connexions_app'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%app%strava%whoop%'
  loop
    execute format('alter table public.connexions_app drop constraint %I', cons.conname);
  end loop;
end $$;

alter table public.connexions_app
  add constraint connexions_app_app_check check (app in ('strava', 'whoop', 'garmin'));

alter table public.connexions_app add column if not exists oauth1_token text;
alter table public.connexions_app add column if not exists oauth1_secret text;

-- Garmin n'a pas de refresh_token classique (renouvellement via oauth1_token/
-- oauth1_secret à la place) : la colonne reste utilisée par strava/whoop,
-- juste plus obligatoire pour garmin.
alter table public.connexions_app alter column refresh_token drop not null;

-- 2) garmin_sleep : une ligne par nuit, même convention que whoop_data.
create table if not exists public.garmin_sleep (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  bedtime text,
  wake_time text,
  total_sec integer,
  deep_sec integer,
  light_sec integer,
  rem_sec integer,
  awake_sec integer,
  awake_count integer,
  restless_count integer,
  avg_stress numeric,
  avg_heart_rate numeric,
  body_battery_change integer,
  resp_avg numeric,
  resp_min numeric,
  resp_max numeric,
  spo2_avg numeric,
  spo2_min numeric,
  hrv_avg numeric,
  hrv_status text,
  score integer,
  score_qualifier text,
  score_detail jsonb,
  segments jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.garmin_sleep enable row level security;

drop policy if exists "garmin_sleep_select_own" on public.garmin_sleep;
create policy "garmin_sleep_select_own" on public.garmin_sleep
  for select using (auth.uid() = user_id);

drop policy if exists "garmin_sleep_insert_own" on public.garmin_sleep;
create policy "garmin_sleep_insert_own" on public.garmin_sleep
  for insert with check (auth.uid() = user_id);

drop policy if exists "garmin_sleep_update_own" on public.garmin_sleep;
create policy "garmin_sleep_update_own" on public.garmin_sleep
  for update using (auth.uid() = user_id);

drop policy if exists "garmin_sleep_delete_own" on public.garmin_sleep;
create policy "garmin_sleep_delete_own" on public.garmin_sleep
  for delete using (auth.uid() = user_id);

create index if not exists idx_garmin_sleep_user_date on public.garmin_sleep(user_id, date);
