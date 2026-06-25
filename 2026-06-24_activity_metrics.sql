-- ============================================================
-- Metriques avancees par activite, calculees cote client a partir des
-- streams (watts + FC) + parametres athlete (FTP, FC max, FC repos).
-- Stocke un jsonb : { "_v":1, "trimp":168, "eftp":220, "cp":228, "w_prime":21600,
--   "pmax":1500, "wbal_kj":14.1, "work_over_ftp_kj":65, "cho_g":190,
--   "pol_index":1.46, "pol_class":"Pyramidal", "hrrc":31 }
-- Une seule colonne jsonb (souple, pas de migration a chaque nouvelle metrique).
-- Idempotent.
-- ============================================================
alter table if exists public.activities
  add column if not exists metrics jsonb;
