-- ============================================================
-- daily_metrics = vue dérivée AUTOMATIQUE de activities.
--
-- Problème résolu : une activité supprimée/modifiée via l'app laissait
-- sa ligne daily_metrics intacte (« TSS fantôme », ex. 100 TSS le
-- 2026-07-02 après suppression). Seule la fonction Edge strava-ingest
-- recalculait, et uniquement lors d'une synchro Strava.
--
-- Solution : fonction SQL de recalcul (sémantique IDENTIQUE à l'étape 7
-- de strava-ingest : somme TSS/durée par jour, série continue, EWMA
-- alpha = 2/(N+1) avec N=42 (CTL) et N=7 (ATL), TSB = CTL-ATL) +
-- triggers statement-level sur activities -> tout chemin d'écriture
-- (app, webhook, SQL manuel) maintient daily_metrics à jour.
-- ============================================================

-- ---------- 1) Fonction de recalcul pour un utilisateur ----------
create or replace function public.recalc_daily_metrics(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d_first date;
  d_last  date;
  r record;
  v_ctl numeric := 0;
  v_atl numeric := 0;
begin
  select min(start_date_local::date), max(start_date_local::date)
    into d_first, d_last
  from activities
  where user_id = p_user
    and start_date_local is not null
    and start_date_local::date >= date '2000-01-01';  -- ignore dates aberrantes (epoch 1970)

  -- Plus aucune activité : on vide les métriques de l'utilisateur.
  if d_first is null then
    delete from daily_metrics where user_id = p_user;
    return;
  end if;

  -- Purge des lignes hors plage (avant la 1re activité / après la dernière).
  delete from daily_metrics
  where user_id = p_user
    and (iso_date < d_first or iso_date > d_last);

  -- Série continue jour par jour + EWMA (même formule que strava-ingest).
  for r in
    with agg as (
      select start_date_local::date as iso,
             sum(coalesce(tss, 0)) as tss,
             sum(round(coalesce(moving_time, elapsed_time, 0) / 60.0)) as dur,
             count(*) as cnt
      from activities
      where user_id = p_user
        and start_date_local is not null
        and start_date_local::date >= date '2000-01-01'
      group by 1
    )
    select gs::date as iso,
           coalesce(a.tss, 0) as tss,
           coalesce(a.dur, 0) as dur,
           coalesce(a.cnt, 0) as cnt
    from generate_series(d_first, d_last, interval '1 day') gs
    left join agg a on a.iso = gs::date
    order by gs::date
  loop
    v_ctl := v_ctl + (r.tss - v_ctl) * 2 / 43.0;
    v_atl := v_atl + (r.tss - v_atl) * 2 / 8.0;
    insert into daily_metrics (user_id, iso_date, tss, ctl, atl, tsb, duration_min, activity_count)
    values (p_user, r.iso, round(r.tss), round(v_ctl, 1), round(v_atl, 1),
            round(v_ctl - v_atl, 1), r.dur, r.cnt)
    on conflict (user_id, iso_date) do update
      set tss            = excluded.tss,
          ctl            = excluded.ctl,
          atl            = excluded.atl,
          tsb            = excluded.tsb,
          duration_min   = excluded.duration_min,
          activity_count = excluded.activity_count;
  end loop;
end;
$$;

-- ---------- 2) Trigger statement-level (transition tables) ----------
-- Un seul recalcul par statement et par utilisateur touché, même pour
-- les upserts en batch de l'ingest (pas un recalcul par ligne).
create or replace function public.trg_recalc_daily_metrics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid;
begin
  for u in select distinct user_id from changed_rows where user_id is not null loop
    perform public.recalc_daily_metrics(u);
  end loop;
  return null;
end;
$$;

drop trigger if exists activities_recalc_metrics_ins on public.activities;
create trigger activities_recalc_metrics_ins
  after insert on public.activities
  referencing new table as changed_rows
  for each statement
  execute function public.trg_recalc_daily_metrics();

drop trigger if exists activities_recalc_metrics_upd on public.activities;
create trigger activities_recalc_metrics_upd
  after update on public.activities
  referencing new table as changed_rows
  for each statement
  execute function public.trg_recalc_daily_metrics();

drop trigger if exists activities_recalc_metrics_del on public.activities;
create trigger activities_recalc_metrics_del
  after delete on public.activities
  referencing old table as changed_rows
  for each statement
  execute function public.trg_recalc_daily_metrics();

-- ---------- 3) Backfill : recalcul immédiat pour tous les utilisateurs ----------
-- (corrige au passage les TSS fantômes existants, ex. 2026-07-02)
do $$
declare
  u uuid;
begin
  for u in select distinct user_id from public.activities loop
    perform public.recalc_daily_metrics(u);
  end loop;
end;
$$;
