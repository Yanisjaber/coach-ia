-- Renomme activity_overrides → activity_edits (nom plus explicite).
-- À exécuter dans le SQL Editor de Supabase.
-- Le trigger et la policy restent attachés automatiquement ; on les renomme
-- juste pour la cohérence (sans échouer si déjà absents).

alter table if exists public.activity_overrides rename to activity_edits;

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_activity_overrides_updated_at'
      and tgrelid = 'public.activity_edits'::regclass
  ) then
    alter trigger trg_activity_overrides_updated_at on public.activity_edits
      rename to trg_activity_edits_updated_at;
  end if;
exception when undefined_table then null;
end $$;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activity_edits'
      and policyname = 'Users can manage their own activity_overrides'
  ) then
    alter policy "Users can manage their own activity_overrides" on public.activity_edits
      rename to "Users can manage their own activity_edits";
  end if;
end $$;
