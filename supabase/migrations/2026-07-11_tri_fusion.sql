-- ============================================================
-- Fusion multisport : un triathlon réalisé (3 activités Strava)
-- devient UNE activité. La ligne fusionnée est une activité
-- normale (sport Triathlon, jsonb tri rempli) ; les étapes
-- d'origine restent en base (streams intacts) mais pointent
-- vers leur parent via merged_into et sont exclues de
-- l'affichage et des daily_metrics.
--
-- on delete set null : supprimer la ligne fusionnée refait
-- automatiquement apparaître les 3 étapes.
-- ============================================================

alter table public.activities
  add column if not exists merged_into uuid references public.activities(id) on delete set null;

create index if not exists activities_merged_into_idx
  on public.activities(merged_into) where merged_into is not null;
