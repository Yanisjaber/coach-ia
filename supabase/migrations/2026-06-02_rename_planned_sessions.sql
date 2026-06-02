-- Renomme planned_sessions → activity_planned (aligné sur activities / activity_edits).
-- À exécuter dans le SQL Editor de Supabase.
-- NB : lancer APRÈS 2026-06-02_drop_session_type.sql (qui référence encore
--      planned_sessions sous son ancien nom).

alter table if exists public.planned_sessions rename to activity_planned;

alter index if exists public.idx_planned_user_date rename to idx_activity_planned_user_date;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activity_planned'
      and policyname = 'Users manage own planned_sessions'
  ) then
    alter policy "Users manage own planned_sessions" on public.activity_planned
      rename to "Users manage own activity_planned";
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_planned_updated_at'
      and tgrelid = 'public.activity_planned'::regclass
  ) then
    alter trigger trg_planned_updated_at on public.activity_planned
      rename to trg_activity_planned_updated_at;
  end if;
exception when undefined_table then null;
end $$;
