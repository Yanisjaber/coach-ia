-- ============================================================
-- Coach IA — Calque de modifications d'activités
-- Les activités Strava sont en lecture seule (re-synchronisées). Ce calque stocke
-- les modifs manuelles (nom/type/sport/durée/distance/TSS/notes) et les masquages
-- de métriques (puissance/cardio/distance) par activité, réappliqués après synchro.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================

create table if not exists public.activity_overrides (
  user_id uuid references auth.users(id) on delete cascade not null,
  activity_id text not null,          -- strava_id de l'activité
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, activity_id)
);

-- updated_at auto
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_activity_overrides_updated_at on public.activity_overrides;
create trigger trg_activity_overrides_updated_at
  before update on public.activity_overrides
  for each row execute function public.set_updated_at();

-- RLS
alter table public.activity_overrides enable row level security;
drop policy if exists "Users can manage their own activity_overrides" on public.activity_overrides;
create policy "Users can manage their own activity_overrides"
  on public.activity_overrides for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
