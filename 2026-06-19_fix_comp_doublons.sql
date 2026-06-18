-- ============================================================
-- Nettoyage des doublons de competitions cree par la migration drop_competitions.
-- Cause : "Transformer en competition" (ancien modele) creait un REGISTRE separe
--   (client_id = 'act-<id_activite>') pointant vers la vraie activite. La migration
--   a transforme ce registre en une ligne `activities` fantome (0 TSS), en double
--   du vrai ride.
-- Fix : retaguer le vrai ride en competition, puis supprimer les fantomes 'act-%'.
-- Idempotent. NON destructif sur les vraies activites.
-- ============================================================

-- 1) Le vrai ride lie (id = la partie apres 'act-') devient une competition
update public.activities a
set category = 'competition'
from public.activities p
where p.category = 'competition'
  and p.client_id like 'act-%'
  and p.user_id = a.user_id
  and a.id::text = substring(p.client_id, 5);

-- 2) Supprime les lignes fantomes "registre"
delete from public.activities
where category = 'competition' and client_id like 'act-%';
