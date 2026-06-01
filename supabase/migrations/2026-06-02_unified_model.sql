-- ============================================================
-- Coach IA — Modèle unifié activités / prévus
-- 1) activities = TOUTES les activités réalisées (Strava + manuelles),
--    chacune avec source (strava|manual) et category (entrainement|competition).
-- 2) planned_sessions = séances prévues, category (entrainement|competition).
--
-- ⚠️ Migration ADDITIVE : aucune table supprimée (trainings/competitions gardées
--    en backup). À exécuter dans Supabase → SQL Editor. Réexécutable.
--
-- NB : la table activities utilise les noms natifs Strava (start_date_local,
-- moving_time [secondes], distance_km, user_notes…). Pas de colonne date/duration_min.
-- ============================================================

-- ---------- 1. Étendre activities ----------
alter table public.activities alter column strava_id drop not null;     -- manuelles : pas d'id Strava
alter table public.activities add column if not exists category text;   -- 'entrainement' | 'competition'
alter table public.activities add column if not exists source text;     -- 'strava' | 'manual'
alter table public.activities add column if not exists client_id text;  -- id local (manuelles)
alter table public.activities add column if not exists priority text;   -- compétition
alter table public.activities add column if not exists target text;     -- objectif de temps
alter table public.activities add column if not exists course_dplus integer; -- D+ de l'épreuve
alter table public.activities add column if not exists laps integer;
alter table public.activities add column if not exists gpx_name text;
alter table public.activities add column if not exists gpx_content text;
alter table public.activities add column if not exists stages jsonb;

update public.activities set source = 'strava' where source is null;
update public.activities set category = 'entrainement' where category is null;

-- ---------- 2. Table planned_sessions (prévus) ----------
create table if not exists public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text,
  category text not null default 'entrainement' check (category in ('entrainement', 'competition')),
  name text,
  date date not null,
  sport text,
  type text,
  duration integer,        -- minutes
  tss integer,
  notes text,
  structure jsonb,
  priority text,
  target text,
  km numeric,
  d_plus integer,
  laps integer,
  gpx_name text,
  gpx_content text,
  stages jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_planned_user_date on public.planned_sessions(user_id, date);

alter table public.planned_sessions enable row level security;
drop policy if exists "Users manage own planned_sessions" on public.planned_sessions;
create policy "Users manage own planned_sessions" on public.planned_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_planned_updated_at on public.planned_sessions;
create trigger trg_planned_updated_at before update on public.planned_sessions
  for each row execute function public.set_updated_at();

-- ---------- 3. Migration des données ----------

-- a) Entraînements RÉALISÉS → activities (manual / entrainement)
insert into public.activities (user_id, source, category, client_id, start_date_local, name, sport, type, moving_time, tss, user_notes)
select t.user_id, 'manual', 'entrainement', t.client_id, (t.date::timestamp + interval '12 hours'), t.name, t.sport, t.type, coalesce(t.duration, 0) * 60, t.tss, t.notes
from public.trainings t
where t.mode = 'realise'
  and not exists (select 1 from public.activities a where a.source = 'manual' and a.client_id = t.client_id and a.start_date_local::date = t.date);

-- b) Entraînements PRÉVUS → planned_sessions (entrainement)
insert into public.planned_sessions (user_id, category, client_id, name, date, sport, type, duration, tss, notes, structure)
select t.user_id, 'entrainement', t.client_id, t.name, t.date, t.sport, t.type, t.duration, t.tss, t.notes, t.structure
from public.trainings t
where t.mode = 'prevu'
  and not exists (select 1 from public.planned_sessions p where p.client_id = t.client_id and p.date = t.date);

-- c) Compétitions PASSÉES → activities (manual / competition)
insert into public.activities (user_id, source, category, client_id, start_date_local, name, sport, distance_km, user_notes, priority, target, course_dplus, laps, gpx_name, gpx_content, stages)
select c.user_id, 'manual', 'competition', c.client_id, (c.date::timestamp + interval '12 hours'), c.name, c.sport, c.km, c.notes, c.priority, c.target, c.d_plus, c.laps, c.gpx_name, c.gpx_content, c.stages
from public.competitions c
where c.date <= current_date
  and not exists (select 1 from public.activities a where a.category = 'competition' and a.client_id = c.client_id and a.start_date_local::date = c.date);

-- d) Compétitions FUTURES → planned_sessions (competition)
insert into public.planned_sessions (user_id, category, client_id, name, date, sport, km, notes, priority, target, d_plus, laps, gpx_name, gpx_content, stages)
select c.user_id, 'competition', c.client_id, c.name, c.date, c.sport, c.km, c.notes, c.priority, c.target, c.d_plus, c.laps, c.gpx_name, c.gpx_content, c.stages
from public.competitions c
where c.date > current_date
  and not exists (select 1 from public.planned_sessions p where p.category = 'competition' and p.client_id = c.client_id and p.date = c.date);

-- ---------- 4. Vérifications ----------
-- select source, category, count(*) from public.activities group by 1,2;
-- select category, count(*) from public.planned_sessions group by 1;
