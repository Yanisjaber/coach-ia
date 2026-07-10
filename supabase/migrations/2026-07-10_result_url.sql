-- ============================================================
-- Résultat manuel : lien vers les résultats officiels (page web).
-- Complète result_place / result_total / result_catev (2026-07-09b).
-- ============================================================

alter table public.activities
  add column if not exists result_url text;
