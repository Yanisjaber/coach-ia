-- ============================================================
-- Coach IA — Priorité de compétition : nouvelles valeurs
-- L'ancienne contrainte n'autorisait que 'A','B','C'. On passe à
-- 'principal' / 'secondaire' (libellés affichés : Objectif / Préparation).
-- On garde A/B/C tolérés pour les anciennes lignes.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================

alter table public.competitions
  drop constraint if exists competitions_priority_check;

alter table public.competitions
  add constraint competitions_priority_check
  check (priority in ('principal', 'secondaire', 'A', 'B', 'C') or priority is null);

-- (Optionnel) normaliser les anciennes valeurs existantes :
update public.competitions set priority = 'principal'  where priority = 'A';
update public.competitions set priority = 'secondaire' where priority in ('B', 'C');

-- Vérif :
--   select distinct priority from public.competitions;
