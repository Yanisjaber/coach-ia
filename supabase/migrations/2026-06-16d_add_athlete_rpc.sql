-- Coach IA - RPC : ajouter un athlete par email (modele lien direct).
-- Un client ne peut pas lire auth.users ; cette fonction security definer
-- resout l'email -> user et cree le lien coach_athlete actif.
-- A executer dans Supabase SQL Editor. Idempotent.

create or replace function public.add_athlete_by_email(_email text)
  returns table(athlete_id uuid, display_name text)
  language plpgsql security definer set search_path = public, auth as $$
#variable_conflict use_column
declare
  _coach   uuid := auth.uid();
  _athlete uuid;
begin
  if _coach is null then
    raise exception 'Non authentifie';
  end if;

  select id into _athlete
  from auth.users
  where lower(email) = lower(trim(_email))
  limit 1;

  if _athlete is null then
    raise exception 'Aucun compte avec cet email';
  end if;
  if _athlete = _coach then
    raise exception 'Vous ne pouvez pas vous ajouter vous-meme';
  end if;

  -- garantit l'existence des profils (au cas ou)
  insert into public.profiles (id) values (_coach)   on conflict (id) do nothing;
  insert into public.profiles (id) values (_athlete) on conflict (id) do nothing;

  insert into public.coach_athlete (coach_id, athlete_id, status, accepted_at)
  values (_coach, _athlete, 'active', now())
  on conflict (coach_id, athlete_id)
    do update set status = 'active', accepted_at = now();

  return query
    select p.id, coalesce(p.display_name, _email)
    from public.profiles p
    where p.id = _athlete;
end;
$$;

-- PUBLIC couvre tous les roles (dont anon) : on retire l'execution par defaut
-- puis on l'accorde uniquement aux comptes connectes.
revoke all on function public.add_athlete_by_email(text) from public;
grant execute on function public.add_athlete_by_email(text) to authenticated;
