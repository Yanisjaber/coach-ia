-- ============================================================
-- Compétitions : structuration détaillée pour filtres futurs.
--   federation : FFC / UFOLEP / FSGT / FFA / FFTri / FFN / Autre
--   race_level : niveau/catégorie d'épreuve (Open 1-3, Access 3-4,
--                2e-3e cat UFOLEP, label FFA...)
--   tri_format : XS / S / M / L / XL (triathlon et enchaînements)
-- Sur les deux tables (prévu + réalisé), modèle source unique.
-- ============================================================

alter table public.activity_planned
  add column if not exists federation text,
  add column if not exists race_level text,
  add column if not exists tri_format text;

alter table public.activities
  add column if not exists federation text,
  add column if not exists race_level text,
  add column if not exists tri_format text;
