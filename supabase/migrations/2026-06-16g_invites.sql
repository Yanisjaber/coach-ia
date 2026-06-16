-- Coach IA - Invitations avec acceptation + surnom coach.
-- - coach_label : surnom donne par le coach a l'athlete.
-- - add_athlete_by_email cree desormais un lien 'pending' (en attente) et
--   retourne l'id du lien (pour construire le lien d'invitation).
-- - my_pending_invites : invitations recues par l'athlete connecte.
-- A executer dans Supabase SQL Editor apres les migrations precedentes. Idempotent.

alter table public.coach_athlete add column if not exists coach_label text;
alter table public.coach_athlete add column if not exists invited_email text;

-- ---- Inviter par email : cree un lien EN ATTENTE ----
-- DROP requis : le type de retour change (ajout invite_id / link_status).
drop function if exists public.add_athlete_by_email(text);
create or replace function public.add_athlete_by_email(_email text)
  returns table(athlete_id uuid, display_name text, invite_id uuid, link_status text)
  language plpgsql security definer set search_path = public, auth as $$
#variable_conflict use_column
declare
  _coach   uuid := auth.uid();
  _athlete uuid;
  _id      uuid;
  _st      text;
begin
  if _coach is null then raise exception 'Non authentifie'; end if;

  select id into _athlete from auth.users where lower(email) = lower(trim(_email)) limit 1;
  if _athlete is null then raise exception 'Aucun compte avec cet email'; end if;
  if _athlete = _coach then raise exception 'Vous ne pouvez pas vous ajouter vous-meme'; end if;

  insert into public.profiles (id) values (_coach)   on conflict (id) do nothing;
  insert into public.profiles (id) values (_athlete) on conflict (id) do nothing;

  -- Nouveau lien => 'pending'. Si un lien existe deja, on NE retrograde PAS un
  -- lien actif ; un lien revoque/absent repasse en 'pending' (re-invitation).
  insert into public.coach_athlete (coach_id, athlete_id, status, invited_at, invited_email)
  values (_coach, _athlete, 'pending', now(), lower(trim(_email)))
  on conflict (coach_id, athlete_id) do update
    set status = case when public.coach_athlete.status = 'active' then 'active' else 'pending' end,
        invited_at = now(),
        invited_email = lower(trim(_email))
  returning id, status into _id, _st;

  return query
    select p.id, coalesce(p.display_name, _email), _id, _st
    from public.profiles p where p.id = _athlete;
end;
$$;
revoke all on function public.add_athlete_by_email(text) from public;
grant execute on function public.add_athlete_by_email(text) to authenticated;

-- ---- Invitations recues par l'athlete connecte (avec infos du coach) ----
drop function if exists public.my_pending_invites();
create or replace function public.my_pending_invites()
  returns table(invite_id uuid, coach_id uuid, coach_name text, coach_email text, invited_at timestamptz)
  language sql security definer set search_path = public, auth as $$
  select ca.id, ca.coach_id,
         coalesce(p.display_name, u.email),
         u.email,
         ca.invited_at
  from public.coach_athlete ca
  join auth.users u on u.id = ca.coach_id
  left join public.profiles p on p.id = ca.coach_id
  where ca.athlete_id = auth.uid() and ca.status = 'pending';
$$;
revoke all on function public.my_pending_invites() from public;
grant execute on function public.my_pending_invites() to authenticated;
