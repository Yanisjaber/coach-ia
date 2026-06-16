-- Coach IA - Le coach peut PLANIFIER pour ses athletes (ecriture sur les
-- tables de planification uniquement). Les activites realisees, la forme,
-- le profil, etc. restent en lecture seule cote coach.
-- A executer dans Supabase SQL Editor apres les migrations precedentes. Idempotent.

do $$
declare
  t text;
  tables text[] := array[
    'activity_planned',
    'rest_day',
    'training_phases',
    'activity_template',
    'competitions'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip % : table absente', t;
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      raise notice 'skip % : pas de colonne user_id', t;
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_coach_ins', t);
    execute format('create policy %I on public.%I for insert with check (public.is_coach_of(user_id))', t || '_coach_ins', t);

    execute format('drop policy if exists %I on public.%I', t || '_coach_upd', t);
    execute format('create policy %I on public.%I for update using (public.is_coach_of(user_id)) with check (public.is_coach_of(user_id))', t || '_coach_upd', t);

    execute format('drop policy if exists %I on public.%I', t || '_coach_del', t);
    execute format('create policy %I on public.%I for delete using (public.is_coach_of(user_id))', t || '_coach_del', t);

    raise notice 'policies coach write creees sur %', t;
  end loop;
end$$;
