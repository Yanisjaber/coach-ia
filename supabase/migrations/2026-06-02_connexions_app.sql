-- ============================================================
--  Mutualise strava_connections + whoop_connections dans une
--  table unique connexions_app (1 ligne par user + app).
--  Ajouter une app plus tard = une nouvelle valeur de `app`,
--  sans nouvelle table.
--  À exécuter dans le SQL Editor de Supabase.
--  ⚠ Redéployer les 7 edge functions AVANT/AVEC cette migration.
-- ============================================================

create table if not exists public.connexions_app (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  app                     text not null check (app in ('strava', 'whoop')),
  external_id             text,           -- athlete_id Strava / user_id Whoop
  athlete_name            text,
  access_token            text not null,
  refresh_token           text not null,
  expires_at              timestamptz not null,
  scope                   text,
  first_connected_at      timestamptz not null default now(),
  last_sync_at            timestamptz,
  last_sync_status        text,
  last_sync_error         text,
  total_activities_synced integer,
  unique (user_id, app)
);

create index if not exists idx_connexions_app_user    on public.connexions_app(user_id);
create index if not exists idx_connexions_app_app_ext  on public.connexions_app(app, external_id);

alter table public.connexions_app enable row level security;

drop policy if exists "connexions_app_select_own" on public.connexions_app;
create policy "connexions_app_select_own" on public.connexions_app
  for select using (auth.uid() = user_id);

-- Écritures réservées au service_role (edge functions).
revoke insert, update, delete on public.connexions_app from anon, authenticated;
-- Tokens jamais exposés au client : select limité aux colonnes non sensibles.
revoke select on public.connexions_app from anon, authenticated;
grant  select (id, user_id, app, external_id, athlete_name, scope,
               first_connected_at, last_sync_at, last_sync_status,
               last_sync_error, total_activities_synced)
  on public.connexions_app to authenticated;

-- ---------- Copie des données existantes ----------
insert into public.connexions_app
  (user_id, app, external_id, athlete_name, access_token,
   refresh_token, expires_at, scope, first_connected_at, last_sync_at,
   last_sync_status, last_sync_error, total_activities_synced)
select user_id, 'strava', strava_athlete_id::text, athlete_name,
       access_token, refresh_token, expires_at, scope, first_connected_at,
       last_sync_at, last_sync_status, last_sync_error, total_activities_synced
from public.strava_connections
on conflict (user_id, app) do nothing;

insert into public.connexions_app
  (user_id, app, external_id, athlete_name, access_token, refresh_token,
   expires_at, first_connected_at, last_sync_at, last_sync_status, last_sync_error)
select user_id, 'whoop', whoop_user_id, athlete_name, access_token, refresh_token,
       expires_at, first_connected_at, last_sync_at, last_sync_status, last_sync_error
from public.whoop_connections
on conflict (user_id, app) do nothing;

-- ---------- À lancer SEULEMENT après avoir vérifié que la synchro
--            Strava ET Whoop fonctionne (fonctions redéployées) : ----------
-- drop table if exists public.strava_connections;
-- drop table if exists public.whoop_connections;
