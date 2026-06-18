-- ============================================================
-- Bascule "base = source unique" pour les seances manuelles realisees.
-- La table activities porte TOUS les parametres d'un entrainement :
--   date, sport, type, duree, tss, rpe, distance, denivele, gpx, notes, structure,
--   + drapeaux de masquage des donnees (watt / fc / distance).
--
-- + Simplification sport : UNE seule colonne `sport` = le type exact (Ride, TrailRun,
--   Swim, WeightTraining...). La categorie (cyclisme/course/...) est derivee a la volee
--   cote app. On supprime sport_raw.
--
-- Idempotent. ORDRE : deployer le code (web + edge functions strava-ingest/webhook)
-- AVANT d'executer ce script (le code n'utilise plus sport_raw ; le drop est la derniere etape).
-- ============================================================

-- Infos seance
alter table if exists public.activities       add column if not exists structure     jsonb;
alter table if exists public.activities       add column if not exists rpe           numeric;
alter table if exists public.activities       add column if not exists type          text;

-- Drapeaux "retirer des records & statistiques"
alter table if exists public.activities       add column if not exists excl_power     boolean;
alter table if exists public.activities       add column if not exists excl_hr        boolean;
alter table if exists public.activities       add column if not exists excl_distance  boolean;

-- Cote planifie (prevu)
alter table if exists public.activity_planned add column if not exists rpe           numeric;
alter table if exists public.activity_planned add column if not exists structure     jsonb;

-- Sport : une seule colonne = type exact. On bascule sport_raw -> sport puis on drop sport_raw.
update public.activities set sport = sport_raw
  where sport_raw is not null and btrim(sport_raw) <> '';
alter table if exists public.activities drop column if exists sport_raw;
