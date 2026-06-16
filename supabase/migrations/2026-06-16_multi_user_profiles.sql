-- ============================================================
--  Coach IA — Étape 1 du passage multi-utilisateur (cf. MODELE_DONNEES.md)
--
--  Crée 3 tables : profiles, coach_athlete (pivot), athlete_settings.
--  + 1 helper SQL réutilisable : public.is_coach_of(athlete uuid)
--
--  INVISIBLE pour l'usage solo actuel : chaque utilisateur devient son
--  propre coach (ligne coach_athlete où coach_id = athlete_id). Rien ne
--  change dans l'app tant qu'on n'invite pas un vrai 2e utilisateur.
--
--  À exécuter dans Supabase → SQL Editor. Idempotent (relançable sans risque).
-- ============================================================

-- ---------- Fonction utilitaire updated_at (peut déjà exister) ----------
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ============================================================
-- ① profiles — prolonge auth.users avec les infos applicatives
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'both' check (role in ('athlete', 'coach', 'both')),
  display_name text,
  avatar_url   text,
  locale       text default 'fr',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Remplit profiles depuis les comptes existants
insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email)
from auth.users
on conflict (id) do nothing;

-- Crée automatiquement un profil à chaque nouvelle inscription
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',
                           new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- ② coach_athlete — pivot central coach ↔ athlètes
-- ============================================================
create table if not exists public.coach_athlete (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.profiles(id) on delete cascade,
  athlete_id  uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'active' check (status in ('pending', 'active', 'revoked')),
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (coach_id, athlete_id)
);

create index if not exists idx_coach_athlete_coach   on public.coach_athlete(coach_id);
create index if not exists idx_coach_athlete_athlete on public.coach_athlete(athlete_id);

-- Chaque utilisateur existant devient son propre coach (lien neutre)
insert into public.coach_athlete (coach_id, athlete_id, status, accepted_at)
select id, id, 'active', now() from public.profiles
on conflict (coach_id, athlete_id) do nothing;


-- ============================================================
--  Helper : auth.uid() est-il coach actif de _athlete ?
--  security definer => contourne la RLS pour éviter toute récursion.
--  Réutilisé par les policies de toutes les tables de données.
-- ============================================================
create or replace function public.is_coach_of(_athlete uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.coach_athlete
    where coach_id = auth.uid()
      and athlete_id = _athlete
      and status = 'active'
  );
$$;


-- ============================================================
-- ③ athlete_settings — réglages physiologiques (1 par athlète)
-- ============================================================
create table if not exists public.athlete_settings (
  athlete_id      uuid primary key references public.profiles(id) on delete cascade,
  sport_principal text,
  ftp             integer,
  hr_max          integer,
  hr_rest         integer,
  weight_kg       numeric,
  zones           jsonb,
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_athlete_settings_updated_at on public.athlete_settings;
create trigger trg_athlete_settings_updated_at
  before update on public.athlete_settings
  for each row execute function public.set_updated_at();

-- Crée une ligne de réglages vide pour chaque athlète existant
insert into public.athlete_settings (athlete_id)
select id from public.profiles
on conflict (athlete_id) do nothing;


-- ============================================================
--  Row Level Security
-- ============================================================

-- ---- profiles : je vois mon profil + ceux liés (mes athlètes / mes coachs)
alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (
  id = auth.uid()
  or public.is_coach_of(id)
  or exists (
    select 1 from public.coach_athlete
    where athlete_id = auth.uid() and coach_id = profiles.id and status = 'active'
  )
);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- (pas de policy insert : géré par le trigger handle_new_user en security definer)


-- ---- coach_athlete : je vois/gère les liens où je suis impliqué
alter table public.coach_athlete enable row level security;

drop policy if exists "coach_athlete_select" on public.coach_athlete;
create policy "coach_athlete_select" on public.coach_athlete for select
  using (coach_id = auth.uid() or athlete_id = auth.uid());

-- Un coach crée une invitation (il est coach_id) ; l'athlète pourra l'accepter.
drop policy if exists "coach_athlete_insert" on public.coach_athlete;
create policy "coach_athlete_insert" on public.coach_athlete for insert
  with check (coach_id = auth.uid() or athlete_id = auth.uid());

drop policy if exists "coach_athlete_update" on public.coach_athlete;
create policy "coach_athlete_update" on public.coach_athlete for update
  using (coach_id = auth.uid() or athlete_id = auth.uid())
  with check (coach_id = auth.uid() or athlete_id = auth.uid());

drop policy if exists "coach_athlete_delete" on public.coach_athlete;
create policy "coach_athlete_delete" on public.coach_athlete for delete
  using (coach_id = auth.uid() or athlete_id = auth.uid());


-- ---- athlete_settings : l'athlète gère ; le coach lit
alter table public.athlete_settings enable row level security;

drop policy if exists "athlete_settings_select" on public.athlete_settings;
create policy "athlete_settings_select" on public.athlete_settings for select
  using (athlete_id = auth.uid() or public.is_coach_of(athlete_id));

drop policy if exists "athlete_settings_modify" on public.athlete_settings;
create policy "athlete_settings_modify" on public.athlete_settings for all
  using (athlete_id = auth.uid() or public.is_coach_of(athlete_id))
  with check (athlete_id = auth.uid() or public.is_coach_of(athlete_id));


-- ============================================================
--  Vérifications (à lancer après la migration) :
--    select count(*) from public.profiles;          -- = nb de comptes
--    select count(*) from public.coach_athlete;      -- idem (self-liens)
--    select count(*) from public.athlete_settings;   -- idem
--    select * from public.profiles where id = auth.uid();
-- ============================================================
