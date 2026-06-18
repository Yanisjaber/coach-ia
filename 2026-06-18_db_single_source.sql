-- ============================================================
-- Bascule "base = source unique" pour les seances manuelles realisees.
-- La table activities porte desormais TOUTES les infos d'une seance :
--   - structure (profil d'intervalles)  -> colonne jsonb
--   - rpe (ressenti)                     -> colonne numeric
-- activity_planned a deja une colonne structure ; on lui ajoute rpe si besoin.
--
-- Idempotent : peut etre relance sans risque.
-- A EXECUTER AVANT de deployer la nouvelle version du code (sinon le chargement
-- des activites echoue car il selectionne ces colonnes).
-- ============================================================

alter table if exists public.activities       add column if not exists structure jsonb;
alter table if exists public.activities       add column if not exists rpe       numeric;
alter table if exists public.activity_planned add column if not exists rpe       numeric;
alter table if exists public.activity_planned add column if not exists structure jsonb;
