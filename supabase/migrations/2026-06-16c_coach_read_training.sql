-- Coach IA - Etape 3 : lecture coach sur les donnees d'entrainement.
-- Pour chaque table d'entrainement appartenant a un athlete (colonne user_id),
-- ajoute une policy SELECT autorisant le coach lie et actif (is_coach_of).
-- L'ecriture reste reservee a l'athlete (policies "manage own" inchangees).
-- Exclut les tables sensibles (tokens OAuth) et systeme.
-- A executer dans Supabase SQL Editor apres 2026-06-16b. Idempotent.

do $$
declare
  t text;
  tables text[] := array[
    'activities',
    'activity_planned',
    'activity_edits',
    'activity_template',
    'competitions',
    'trainings',
    'rest_day',
    'day_notes',
    'day_annotations',
    'wellness_days',
    'training_phases',
    'yearly_goals',
    'plan_snapshots',
    'strava_ignored',
    'daily_metrics',
    'power_profile',
    'power_profile_sport',
    'whoop_data'
  ];
begin
  foreach t in array tables loop
    -- la table existe ?
    if to_regclass('public.' || t) is null then
      raise notice 'skip % : table absente', t;
      continue;
    end if;
    -- la table a bien une colonne user_id ?
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      raise notice 'skip % : pas de colonne user_id', t;
      continue;
    end if;
    -- RLS active (au cas ou) + policy de lecture coach (idempotent)
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_coach_read', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_coach_of(user_id))',
      t || '_coach_read', t
    );
    raise notice 'policy coach_read creee sur %', t;
  end loop;
end$$;

-- Verification :
--   select tablename, policyname from pg_policies
--   where policyname like '%_coach_read' order by tablename;
