-- Unifie le temps cible des competitions sur la colonne duration (minutes), comme les entrainements.
-- La colonne target (texte) reste pour compat ; le code lit duration en priorite et retombe sur target.
alter table if exists public.competitions add column if not exists duration integer;
-- activity_planned a deja la colonne duration.
