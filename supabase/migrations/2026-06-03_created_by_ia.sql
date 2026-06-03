-- Séparation des deux mondes de planification (Manuel vs IA).
-- Drapeau posé à l'écriture : false = créé manuellement, true = créé par l'IA.
-- Le rendu filtre selon le mode courant (Manuel n'affiche que false, IA que true).
-- Les activités RÉALISÉES (table activities) ne sont PAS concernées : toujours visibles.

alter table public.activity_planned  add column if not exists created_by_ia boolean not null default false;
alter table public.rest_day          add column if not exists created_by_ia boolean not null default false;
alter table public.day_notes         add column if not exists created_by_ia boolean not null default false;
alter table public.training_phases   add column if not exists created_by_ia boolean not null default false;
