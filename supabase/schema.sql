-- ============================================================
-- Coach IA — Schema Supabase
-- À exécuter dans Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================
-- Convention :
--   - Chaque table a une colonne user_id qui référence auth.users
--   - RLS (Row Level Security) activé sur toutes les tables
--   - Politique : un user ne peut lire/écrire que SES propres lignes
--   - updated_at est mis à jour automatiquement via trigger
-- ============================================================

-- ============================================================
-- 1. PROFIL UTILISATEUR (préférences générales)
-- ============================================================
create table if not exists public.user_profiles (
  user_id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  app_mode text default 'manual' check (app_mode in ('ia', 'manual')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- 2. COMPÉTITIONS
-- ============================================================
create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  client_id text, -- ID local (pour migration et tracking)
  name text not null,
  date date not null,
  sport text,
  priority text check (priority in ('A', 'B', 'C') or priority is null),
  km numeric,
  d_plus integer,
  d_minus integer,
  target text, -- temps cible "5h30"
  laps integer,
  notes text,
  gpx_name text,
  gpx_content text,
  stages jsonb, -- [{name, date, time, sport, type, km, dplus, target, laps, notes, gpxName, gpxContent}, ...]
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_competitions_user_date on public.competitions(user_id, date);

-- ============================================================
-- 3. ENTRAÎNEMENTS (prévus + réalisés)
-- ============================================================
create table if not exists public.trainings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  client_id text,
  name text not null,
  date date not null,
  sport text,
  type text, -- endurance / tempo / seuil / vo2 / recup / rest / force / mobilite / natation
  duration integer, -- en minutes
  tss integer,
  notes text,
  mode text not null check (mode in ('prevu', 'realise')),
  structure jsonb, -- [{dur, target, reps}, ...]
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_trainings_user_date_mode on public.trainings(user_id, date, mode);

-- ============================================================
-- 4. WELLNESS (saisies quotidiennes : poids, mood, fatigue, etc.)
-- ============================================================
create table if not exists public.wellness_days (
  user_id uuid references auth.users(id) on delete cascade not null,
  iso_date date not null,
  weight numeric,
  mood integer check (mood between 1 and 5),
  fatigue integer check (fatigue between 1 and 5),
  soreness integer check (soreness between 1 and 5),
  motivation integer check (motivation between 1 and 5),
  notes text,
  updated_at timestamptz default now(),
  primary key (user_id, iso_date)
);

-- ============================================================
-- 5. NOTES PAR JOUR
-- ============================================================
create table if not exists public.day_notes (
  user_id uuid references auth.users(id) on delete cascade not null,
  iso_date date not null,
  note text not null,
  updated_at timestamptz default now(),
  primary key (user_id, iso_date)
);

-- ============================================================
-- 6. PHASES D'ENTRAÎNEMENT (cycles)
-- ============================================================
create table if not exists public.training_phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  client_id text,
  phase text not null check (phase in ('base', 'build', 'peak', 'taper', 'recup')),
  from_date date not null,
  to_date date not null,
  name text,
  created_at timestamptz default now()
);
create index if not exists idx_phases_user_range on public.training_phases(user_id, from_date, to_date);

-- ============================================================
-- 7. OBJECTIFS ANNUELS
-- ============================================================
create table if not exists public.yearly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  client_id text,
  year integer not null,
  sport text not null,
  template text not null,
  target numeric not null,
  current_manual numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_goals_user_year on public.yearly_goals(user_id, year);

-- ============================================================
-- 8. SNAPSHOTS DU PLAN PRÉVU (pour archive historique)
-- ============================================================
create table if not exists public.plan_snapshots (
  user_id uuid references auth.users(id) on delete cascade not null,
  iso_date date not null,
  proposal jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, iso_date)
);

-- ============================================================
-- 9. JOURS FORCÉS EN REPOS (override du template AI)
-- ============================================================
create table if not exists public.template_rest_days (
  user_id uuid references auth.users(id) on delete cascade not null,
  iso_date date not null,
  primary key (user_id, iso_date)
);

-- ============================================================
-- 10. ACTIVITÉS STRAVA MASQUÉES (suppression locale)
-- ============================================================
create table if not exists public.strava_ignored (
  user_id uuid references auth.users(id) on delete cascade not null,
  activity_id text not null,
  primary key (user_id, activity_id)
);

-- ============================================================
-- 11. PRÉFÉRENCES GÉNÉRIQUES (clé / valeur JSON)
-- ============================================================
create table if not exists public.preferences (
  user_id uuid references auth.users(id) on delete cascade not null,
  key text not null,
  value jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

-- ============================================================
-- TRIGGER : updated_at auto sur les tables qui l'ont
-- ============================================================
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'user_profiles', 'competitions', 'trainings',
      'wellness_days', 'day_notes', 'yearly_goals',
      'plan_snapshots', 'preferences'
    ])
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end$$;

-- ============================================================
-- ROW LEVEL SECURITY : chaque user ne voit que SES données
-- ============================================================
alter table public.user_profiles enable row level security;
alter table public.competitions enable row level security;
alter table public.trainings enable row level security;
alter table public.wellness_days enable row level security;
alter table public.day_notes enable row level security;
alter table public.training_phases enable row level security;
alter table public.yearly_goals enable row level security;
alter table public.plan_snapshots enable row level security;
alter table public.template_rest_days enable row level security;
alter table public.strava_ignored enable row level security;
alter table public.preferences enable row level security;

-- Politique générique : user_id = auth.uid()
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'user_profiles', 'competitions', 'trainings',
      'wellness_days', 'day_notes', 'training_phases',
      'yearly_goals', 'plan_snapshots', 'template_rest_days',
      'strava_ignored', 'preferences'
    ])
  loop
    execute format('drop policy if exists "Users can manage their own %I" on public.%I', t, t);
    execute format(
      'create policy "Users can manage their own %I" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t, t
    );
  end loop;
end$$;

-- ============================================================
-- TRIGGER : créer automatiquement un user_profiles à l'inscription
-- ============================================================
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.user_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- FIN
-- ============================================================
-- Pour vérifier que tout est OK :
--   select tablename from pg_tables where schemaname = 'public';
-- Doit lister les 11 tables ci-dessus.
