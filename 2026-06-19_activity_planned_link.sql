-- ============================================================
-- Lien PRÉVU <-> RÉALISÉ stocké en base.
-- Une colonne `planned_id` sur activities relie une activité réalisée à la
-- séance prévue (activity_planned) qui lui correspond.
-- Valeurs : <uuid de l'activity_planned> = rapproché | 'none' = délié manuellement
--           | NULL = pas encore évalué (l'app tentera un auto-rapprochement).
-- Type texte (et pas uuid) pour autoriser le sentinel 'none'.
--
-- Idempotent. À exécuter après déploiement du code.
-- ============================================================

alter table if exists public.activities
  add column if not exists planned_id text;
