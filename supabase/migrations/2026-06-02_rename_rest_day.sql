-- Renomme template_rest_days → rest_day.
-- Le statut passé/prévu n'est PAS stocké (il deviendrait faux en vieillissant) :
-- il est DÉRIVÉ de la date à l'affichage (iso_date < aujourd'hui → passé).
-- À exécuter dans le SQL Editor de Supabase.

alter table if exists public.template_rest_days rename to rest_day;

-- Si une version précédente avait ajouté une colonne kind figée, on l'enlève.
alter table public.rest_day drop column if exists kind;

-- Cohérence des objets liés (sans échouer si absents).
alter index if exists public.idx_template_rest_days_user rename to idx_rest_day_user;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'rest_day'
      and policyname = 'template_rest_days_all_own'
  ) then
    alter policy "template_rest_days_all_own" on public.rest_day
      rename to "rest_day_all_own";
  end if;
end $$;
