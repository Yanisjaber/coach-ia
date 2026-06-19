-- ============================================================
-- Heure d'une seance PREVUE (entrainement manuel).
-- Au lieu d'une colonne texte, on stocke un vrai timestamptz
-- `start_date_local` (date + heure), MEME FORMAT que la table activities.
-- La colonne `date` (jour) reste pour compat ; l'heure se lit dans start_date_local.
--
-- Cote REALISE, l'heure est deja portee par activities.start_date_local
-- (le code la met a la vraie heure au lieu de T12:00:00).
--
-- Idempotent. A executer apres deploiement du code.
-- ============================================================

alter table if exists public.activity_planned
  add column if not exists start_date_local timestamptz;

-- Backfill : seances prevues existantes sans heure -> 12:00 du jour `date`.
update public.activity_planned
   set start_date_local = (date::text || 'T12:00:00')::timestamptz
 where start_date_local is null and date is not null;
