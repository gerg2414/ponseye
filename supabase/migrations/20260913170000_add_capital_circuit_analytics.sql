create or replace function public.get_capital_circuit_analytics()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with launch_daily as (
    select
      (launched_at at time zone 'UTC')::date as day,
      count(*)::integer as launches
    from public.launches
    group by 1
  ),
  event_daily as (
    select
      (observed_at at time zone 'UTC')::date as day,
      count(distinct token_address) filter (where stage = 'sighted')::integer as sighted,
      count(distinct token_address) filter (where stage = 'under_watch')::integer as surveilling
    from public.research_events
    group by 1
  ),
  acquired_daily as (
    select
      (acquired_at at time zone 'UTC')::date as day,
      count(*)::integer as acquired
    from public.acquired_positions
    group by 1
  ),
  days as (
    select day from launch_daily
    union
    select day from event_daily
    union
    select day from acquired_daily
  )
  select jsonb_build_object(
    'dailyFunnel',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', days.day,
          'launches', coalesce(launch_daily.launches, 0),
          'sighted', coalesce(event_daily.sighted, 0),
          'surveilling', coalesce(event_daily.surveilling, 0),
          'acquired', coalesce(acquired_daily.acquired, 0)
        )
        order by days.day
      ),
      '[]'::jsonb
    )
  )
  from days
  left join launch_daily using (day)
  left join event_daily using (day)
  left join acquired_daily using (day);
$$;

revoke all on function public.get_capital_circuit_analytics() from public, anon, authenticated;
grant execute on function public.get_capital_circuit_analytics() to service_role;
