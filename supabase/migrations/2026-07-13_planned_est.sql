-- Moyennes dérivées de la structure d'une séance PRÉVUE (source de vérité : structure)
-- est = { "w": 166, "bpm": 145, "pace": "4:49" } — présent uniquement si structure.
-- Stockées au même titre que km / duration / tss.

alter table activity_planned add column if not exists est jsonb;
