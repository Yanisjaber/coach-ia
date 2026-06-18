-- Ajoute la colonne RPE (ressenti percu, 1-10) aux seances planifiees et realisees.
-- En prevu : RPE estime/cible ; en realise : RPE ressenti.
alter table if exists public.activity_planned add column if not exists rpe numeric;
alter table if exists public.activities add column if not exists rpe numeric;
