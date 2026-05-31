-- ============================================================
-- 2026-06-01_supabase_only.sql
-- Migration "Supabase-only" — sécurité + colonnes pour streams & power profile.
--
-- À appliquer dans Supabase : SQL Editor → coller → Run.
-- Idempotent : peut être relancé sans danger.
--
-- Ce que fait cette migration :
--   1. SÉCURITÉ : les tokens OAuth (Strava/Whoop) ne sont plus jamais
--      lisibles côté navigateur. Le client n'a accès qu'aux colonnes "safe".
--      Les edge functions (service_role) gardent l'accès complet.
--   2. STREAMS : nouvelles colonnes pour stocker les streams compressés
--      (gzip+base64 dans une colonne texte, portable et sans piège bytea).
--   3. POWER PROFILE : colonne power_curve par activité (MMP), base du
--      recalcul des agrégats alltime / 90 jours.
--   4. RLS : garantit des policies "own rows" sur les tables Whoop si absentes.
-- ============================================================

begin;

-- ============================================================
-- 1) NOUVELLES COLONNES sur activities
-- ============================================================
alter table public.activities
  add column if not exists streams_gz       text,          -- base64(gzip(JSON [{type,data}]))
  add column if not exists streams_synced_at timestamptz,   -- null = streams pas encore récupérés
  add column if not exists power_curve       jsonb;         -- {"60":320,"300":280,...} MMP de CETTE activité

comment on column public.activities.streams_gz is
  'Streams (watts/hr/cadence/altitude/distance) en JSON gzip+base64. Format dans streams_format.';
comment on column public.activities.power_curve is
  'Mean Maximal Power par durée pour cette activité. Sert à recalculer power_profile.';

-- Index pour le backfill : retrouver vite les activités sans streams
create index if not exists idx_activities_streams_todo
  on public.activities (user_id, start_date_local desc)
  where streams_synced_at is null;

-- ============================================================
-- 2) SÉCURITÉ : verrouillage des colonnes sensibles (tokens)
-- ------------------------------------------------------------
-- Principe : on RÉVOQUE le SELECT global sur les tables de connexion,
-- puis on RE-GRANT uniquement les colonnes non sensibles au rôle
-- 'authenticated'. Résultat : un select('*') côté client échouera,
-- et access_token / refresh_token ne peuvent JAMAIS sortir.
-- Les edge functions utilisent la service_role_key qui ignore ces grants.
-- ============================================================

-- --- strava_connections ---
revoke select on public.strava_connections from anon, authenticated;
grant  select (
  user_id, strava_athlete_id, athlete_name, scope,
  first_connected_at, last_sync_at, last_sync_status,
  last_sync_error, total_activities_synced
) on public.strava_connections to authenticated;

-- --- whoop_connections ---
revoke select on public.whoop_connections from anon, authenticated;
grant  select (
  user_id, whoop_user_id,
  first_connected_at, last_sync_at, last_sync_status, last_sync_error
) on public.whoop_connections to authenticated;

-- Le client n'écrit jamais dans ces tables (seules les edge functions le font).
-- On retire donc aussi insert/update/delete au cas où.
revoke insert, update, delete on public.strava_connections from anon, authenticated;
revoke insert, update, delete on public.whoop_connections  from anon, authenticated;

-- ============================================================
-- 3) RLS sur les tables Whoop (idempotent, n'écrase pas l'existant)
-- ============================================================
alter table public.whoop_data        enable row level security;
alter table public.whoop_connections  enable row level security;

-- whoop_data : lecture de ses propres lignes uniquement.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'whoop_data' and cmd = 'SELECT'
  ) then
    create policy whoop_data_select_own on public.whoop_data
      for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;

-- whoop_connections : lecture de sa propre ligne (les colonnes tokens
-- restent masquées par les grants ci-dessus, donc invisibles même ici).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'whoop_connections' and cmd = 'SELECT'
  ) then
    create policy whoop_connections_select_own on public.whoop_connections
      for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;

commit;

-- ============================================================
-- VÉRIFICATIONS (à lancer après le commit, lecture seule) :
--
--   -- les colonnes existent ?
--   select column_name from information_schema.columns
--   where table_name='activities' and column_name in
--     ('streams_gz','streams_synced_at','power_curve');
--
--   -- 'authenticated' ne voit plus les tokens ?
--   select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_name='strava_connections' and grantee='authenticated'
--   order by column_name;
--   -- access_token / refresh_token NE DOIVENT PAS apparaître.
-- ============================================================
