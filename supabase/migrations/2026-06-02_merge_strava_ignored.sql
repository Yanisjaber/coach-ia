-- Mutualise strava_ignored dans activity_edits : « masquer une activité » devient
-- un drapeau hidden:true dans la colonne JSONB data (aucune nouvelle colonne).
-- À exécuter dans le SQL Editor de Supabase.

-- 1) Reporter chaque activité ignorée en activity_edits.data.hidden = true,
--    en fusionnant avec un éventuel override existant.
insert into public.activity_edits (user_id, activity_id, data)
select si.user_id, si.activity_id::text, jsonb_build_object('hidden', true)
from public.strava_ignored si
on conflict (user_id, activity_id) do update
  set data = public.activity_edits.data || jsonb_build_object('hidden', true);

-- 2) Supprimer l'ancienne table.
drop table if exists public.strava_ignored;
