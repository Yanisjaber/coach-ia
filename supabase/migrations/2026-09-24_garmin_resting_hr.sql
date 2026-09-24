-- ============================================================
-- 2026-09-24_garmin_resting_hr.sql — FC de repos (RHR) Garmin
--
-- avg_heart_rate (déjà en base) = FC moyenne pendant la fenêtre de
-- sommeil (endpoint dailySleepData). resting_heart_rate = FC de repos
-- au sens Garmin (endpoint usersummary/daily, champ restingHeartRate),
-- une métrique distincte — généralement la valeur la plus basse
-- soutenue sur la journée, pas juste la moyenne nocturne.
-- ============================================================

alter table public.garmin_sleep add column if not exists resting_heart_rate integer;
