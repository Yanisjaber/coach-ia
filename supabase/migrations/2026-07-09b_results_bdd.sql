-- ============================================================
-- Résultats de course en base (plus seulement en localStorage).
--
-- 1) Résultat saisi MANUELLEMENT : colonnes sur activities
--    (la compétition EST l'activité — modèle source unique).
-- 2) Préférences Open Dossard : associations manuelles
--    compet <-> résultat et résultats masqués, une ligne par user.
-- ============================================================

-- ---------- 1) Résultat manuel sur l'activité ----------
alter table public.activities
  add column if not exists result_place  integer,
  add column if not exists result_total  integer,
  add column if not exists result_catev  text;

-- ---------- 2) Préférences Open Dossard ----------
create table if not exists public.od_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  overrides  jsonb not null default '{}'::jsonb,  -- { compId: odResultId | null }
  hidden     jsonb not null default '[]'::jsonb,  -- [ odResultId, ... ]
  updated_at timestamptz not null default now()
);

alter table public.od_prefs enable row level security;

drop policy if exists "od_prefs_own" on public.od_prefs;
create policy "od_prefs_own" on public.od_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
