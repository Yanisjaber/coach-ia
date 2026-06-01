-- ============================================================
-- Coach IA — Notes typées sur plage de dates (maladie / blessure / texte)
-- Remplace l'usage de day_notes (texte par jour) par des notes avec type,
-- couleur et plage de dates. À exécuter dans Supabase → SQL Editor.
-- Idempotent : ne casse rien si déjà appliqué.
-- ============================================================

create table if not exists public.day_annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  client_id text,                       -- id local (tracking)
  type text not null check (type in ('maladie', 'blessure', 'texte')),
  text text,
  color text,                           -- couleur hex choisie (#rrggbb)
  from_date date not null,
  to_date date not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_day_annotations_user_range
  on public.day_annotations(user_id, from_date, to_date);

-- updated_at auto
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_day_annotations_updated_at on public.day_annotations;
create trigger trg_day_annotations_updated_at
  before update on public.day_annotations
  for each row execute function public.set_updated_at();

-- RLS : chaque user ne voit que ses notes
alter table public.day_annotations enable row level security;
drop policy if exists "Users can manage their own day_annotations" on public.day_annotations;
create policy "Users can manage their own day_annotations"
  on public.day_annotations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Vérif :
--   select * from public.day_annotations where user_id = auth.uid();
