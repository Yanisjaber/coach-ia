-- Données dérivées de la structure d'une séance PRÉVUE — une colonne chacune.
-- Dérivées par StructEd.summary à CHAQUE save, puis affichées telles quelles
-- (modal, aperçu, édition). duration / tss / km existent déjà et sont
-- également écrasées par les valeurs dérivées quand une structure existe.

alter table activity_planned add column if not exists est_watts int;      -- watts moyens
alter table activity_planned add column if not exists est_bpm   int;      -- bpm moyens
alter table activity_planned add column if not exists est_pace  text;     -- allure moyenne ("4:49")
alter table activity_planned add column if not exists est_kj    int;      -- énergie estimée
alter table activity_planned add column if not exists est_if    numeric;  -- intensity factor

-- Mêmes colonnes sur les MODÈLES de la bibliothèque : les stats dérivées y
-- sont stockées au save du template, puis TRANSFÉRÉES telles quelles quand
-- le template devient une séance planifiée.
alter table activity_template add column if not exists est_watts int;
alter table activity_template add column if not exists est_bpm   int;
alter table activity_template add column if not exists est_pace  text;
alter table activity_template add column if not exists est_kj    int;
alter table activity_template add column if not exists est_if    numeric;

-- nettoyage de l'essai précédent (colonne jsonb), si appliqué
alter table activity_planned drop column if exists est;
alter table activities drop column if exists est;
