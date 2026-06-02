-- Power profile au format LARGE, une ligne par (user_id, sport).
-- Une colonne par durée, nommée par son libellé : "1s", "45s", "1min", "1h30"…
-- ⚠ Ces noms commencent par un chiffre → ils DOIVENT être cités entre guillemets
--   doubles dans toute requête SQL : select "1h" from ...  (PostgREST/supabase-js
--   gèrent ça automatiquement quand on passe le nom exact).
-- Plafonné à 8h (colonnes SQL non dynamiques). Valeurs = meilleurs watts (MMP) all-time.
-- (Colonnes "récent 90j" / dates ajoutées plus tard si besoin.)
-- À exécuter dans le SQL Editor de Supabase.

create table if not exists public.power_profile_sport (
  user_id uuid not null references auth.users(id) on delete cascade,
  sport   text not null,

  -- 1s → 15s (chaque seconde)
  "1s" int, "2s" int, "3s" int, "4s" int, "5s" int, "6s" int, "7s" int, "8s" int,
  "9s" int, "10s" int, "11s" int, "12s" int, "13s" int, "14s" int, "15s" int,
  -- paliers courts
  "20s" int, "25s" int, "30s" int, "45s" int,
  -- 1min → 10min
  "1min" int, "2min" int, "3min" int, "4min" int, "5min" int,
  "6min" int, "7min" int, "8min" int, "9min" int, "10min" int,
  -- 12 / 15 / 20 / 25 / 30 / 35 / 40 / 45 min
  "12min" int, "15min" int, "20min" int, "25min" int, "30min" int,
  "35min" int, "40min" int, "45min" int,
  -- 1h → 5h (par demi-heure)
  "1h" int, "1h30" int, "2h" int, "2h30" int, "3h" int,
  "3h30" int, "4h" int, "4h30" int, "5h" int,
  -- 6h / 7h / 8h
  "6h" int, "7h" int, "8h" int,

  -- Métadonnées par durée (date, 90j, activité) sans exploser le nombre de colonnes :
  -- details = { "1h": { "w90": 250, "date": "2025-04-18", "activity_id": "..." }, ... }
  details jsonb not null default '{}'::jsonb,

  -- Infos de niveau ligne
  activities_count   integer,     -- nb d'activités du sport prises en compte
  longest_activity_s integer,     -- durée de la plus longue activité (sens des colonnes)
  ftp                integer,     -- FTP au moment du calcul (pour W/kg, %FTP…)
  weight             numeric,     -- poids (kg) au moment du calcul

  updated_at timestamptz not null default now(),
  primary key (user_id, sport)
);

alter table public.power_profile_sport enable row level security;

drop policy if exists "power_profile_sport_select_own" on public.power_profile_sport;
create policy "power_profile_sport_select_own" on public.power_profile_sport
  for select using (auth.uid() = user_id);

-- Écritures réservées au service_role (edge function de recalcul).
revoke insert, update, delete on public.power_profile_sport from anon, authenticated;
