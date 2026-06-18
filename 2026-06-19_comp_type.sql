-- ============================================================
-- Persistance du "type d'epreuve" des competitions.
-- activities a deja la colonne `type` (ajoutee precedemment).
-- On l'ajoute a activity_planned pour les competitions PREVUES.
-- Idempotent. A lancer avec/avant le deploiement du code.
-- ============================================================
alter table if exists public.activity_planned add column if not exists type text;
