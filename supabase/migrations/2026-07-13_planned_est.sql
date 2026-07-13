-- Données dérivées de la structure d'une séance PRÉVUE — une colonne chacune.
-- Dérivées par StructEd.summary à CHAQUE save, puis affichées telles quelles
-- (modal, aperçu, édition). duration / tss / km existent déjà et sont
-- également écrasées par les valeurs dérivées quand une structure existe.

alter table activity_planned add column if not exists est_watts int;      -- watts moyens
alter table activity_planned add column if not exists est_bpm   int;      -- bpm moyens
alter table activity_planned add column if not exists est_pace  text;     -- allure moyenne ("4:49")
alter table activity_planned add column if not exists est_kj    int;      -- énergie estimée
alter table activity_planned add column if not exists est_if    numeric;  -- intensity factor

-- nettoyage de l'essai précédent (colonne jsonb), si appliqué
alter table activity_planned drop column if exists est;
alter table activities drop column if exists est;
