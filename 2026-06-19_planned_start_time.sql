-- ============================================================
-- Heure d'une seance PREVUE (entrainement manuel).
-- activity_planned utilise une colonne `date` (jour) sans heure.
-- On ajoute `start_time` (texte "HH:MM") pour stocker l'heure optionnelle.
--
-- Cote REALISE, l'heure est deja portee par activities.start_date_local
-- (le code la met desormais a la vraie heure au lieu de T12:00:00).
--
-- Idempotent. A executer apres deploiement du code.
-- ============================================================

alter table if exists public.activity_planned
  add column if not exists start_time text;
