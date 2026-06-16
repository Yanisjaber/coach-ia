-- Coach IA - Messagerie coach <-> athlete.
-- Un fil par athlete ; le coach lie et l'athlete peuvent lire et ecrire.
-- A executer dans Supabase SQL Editor apres les migrations precedentes. Idempotent.

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists idx_messages_athlete on public.messages(athlete_id, created_at);

alter table public.messages enable row level security;

-- Lecture : l'athlete concerne OU son coach actif.
drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages for select using (
  athlete_id = auth.uid() or public.is_coach_of(athlete_id)
);

-- Ecriture : l'auteur est soi-meme, et participe au fil (athlete ou coach lie).
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages for insert with check (
  author_id = auth.uid()
  and (athlete_id = auth.uid() or public.is_coach_of(athlete_id))
);

-- Marquer lu (update read_at) : par un participant du fil.
drop policy if exists "messages_update" on public.messages;
create policy "messages_update" on public.messages for update using (
  athlete_id = auth.uid() or public.is_coach_of(athlete_id)
) with check (
  athlete_id = auth.uid() or public.is_coach_of(athlete_id)
);
