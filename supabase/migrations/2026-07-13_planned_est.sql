-- Données dérivées de la structure (ou de temps+distance) d'une séance PRÉVUE.
-- Une colonne par donnée, remplies au save, affichées telles quelles.
-- est_speed est LA colonne vitesse/allure : numérique en km/h pour tous les
-- sports ; l'affichage convertit (min/km course, min/100m natation, km/h vélo).

alter table activity_planned add column if not exists est_watts int;
alter table activity_planned add column if not exists est_bpm   int;
alter table activity_planned add column if not exists est_kj    int;
alter table activity_planned add column if not exists est_if    numeric;
alter table activity_planned add column if not exists est_speed numeric;

alter table activity_template add column if not exists est_watts int;
alter table activity_template add column if not exists est_bpm   int;
alter table activity_template add column if not exists est_kj    int;
alter table activity_template add column if not exists est_if    numeric;
alter table activity_template add column if not exists est_speed numeric;

-- unification : est_pace (texte) remplacé par est_speed (km/h numérique)
alter table activity_planned drop column if exists est_pace;
alter table activity_template drop column if exists est_pace;

-- nettoyage d'essais précédents
alter table activity_planned drop column if exists est;
alter table activities drop column if exists est;
