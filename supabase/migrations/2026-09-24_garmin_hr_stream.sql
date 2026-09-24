-- ============================================================
-- 2026-09-24_garmin_hr_stream.sql — stream FC nocturne Garmin
--
-- hr_stream = tableau [minute_depuis_coucher, bpm][], recoupé sur la
-- fenêtre de sommeil réelle (endpoint dailyHeartRate, ~2 min de résolution).
-- Même convention minute-offset que la colonne segments (hypnogramme).
-- ============================================================

alter table public.garmin_sleep add column if not exists hr_stream jsonb;
