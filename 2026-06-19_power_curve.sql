-- ============================================================
-- Records de puissance : meilleur effort (W moy) par duree standard, par activite.
-- Stocke une "courbe de puissance" jsonb : { "1":461, "5":442, "10":434, ... }
-- (cles = duree en secondes). Permet de classer chaque effort vs l'historique.
-- Calcule cote client (bouton "Recalculer les records") a partir des streams.
-- Idempotent.
-- ============================================================
alter table if exists public.activities
  add column if not exists power_curve jsonb;
