-- Supprime la colonne `type` (type de séance auto-classé : endurance/vo2/seuil…)
-- des tables activities et planned_sessions. Hors périmètre actuel — sera
-- réimplémenté plus tard si besoin.
-- NB : ne touche PAS day_notes.type (maladie/blessure/texte), ni les colonnes
--      Strava de sport (sport / sport_raw).
-- À exécuter dans le SQL Editor de Supabase AVANT de pousser le front.

-- La vue recent_days dépendait de activities.type et n'est utilisée nulle part
-- dans l'app → on la supprime définitivement (non recréée).
drop view if exists public.recent_days;

alter table if exists public.activities       drop column if exists type;
alter table if exists public.planned_sessions drop column if exists type;
