-- Bibliothèque de séances : modèles réutilisables, glissés-déposés dans le calendrier.
-- Cohérent avec le schéma activity_* (activity_planned, activity_edits).

create table if not exists public.activity_template (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text,                -- id local (mapping localStorage ↔ cloud)
  sport        text,                -- catégorie : cyclisme, course, natation, musculation, autre…
  name         text not null,
  duration_min integer,
  tss          integer,
  description  text,
  sort_order   integer default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists activity_template_user_idx on public.activity_template (user_id);

alter table public.activity_template enable row level security;

create policy "tpl_select_own" on public.activity_template
  for select using (auth.uid() = user_id);
create policy "tpl_insert_own" on public.activity_template
  for insert with check (auth.uid() = user_id);
create policy "tpl_update_own" on public.activity_template
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tpl_delete_own" on public.activity_template
  for delete using (auth.uid() = user_id);
