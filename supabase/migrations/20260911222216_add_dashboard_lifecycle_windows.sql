create or replace function public.get_dashboard_home(p_limit integer default 12)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with candidates as materialized (
    select m.token_address, m.research_state, m.research_state_at, m.research_rule_version
    from public.launch_metrics m
    join public.launches l on l.token_address = m.token_address
    where m.research_state = 'sighted'
      and l.launched_at >= now() - interval '1 hour'

    union all

    select m.token_address, m.research_state, m.research_state_at, m.research_rule_version
    from public.launch_metrics m
    where m.research_state = 'under_watch'
      and m.research_state_at >= now() - interval '6 hours'

    union all

    select m.token_address, m.research_state, m.research_state_at, m.research_rule_version
    from public.launch_metrics m
    where m.research_state = 'target_locked'
      and m.research_state_at >= now() - interval '24 hours'
  ), selected as materialized (
    select
      b.*,
      c.research_state,
      c.research_state_at,
      c.research_rule_version,
      coalesce(e.reason_codes, array['launch_detected']) as research_reasons,
      case when c.research_state = 'target_locked' then e.observed_at end as acquired_at,
      case when c.research_state = 'target_locked' then coalesce(
        nullif(e.metrics_snapshot ->> 'price_usd', '')::numeric * 1000000000,
        b.market_cap_usd * nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric
          / nullif(
            b.last_quote_amount_raw::numeric / nullif(b.last_token_amount_raw::numeric, 0),
            0
          )
      ) end as entry_market_cap_usd
    from candidates c
    join public.launch_board b on b.token_address = c.token_address
    left join lateral (
      select r.reason_codes, r.metrics_snapshot, r.observed_at
      from public.research_events r
      where r.token_address = c.token_address
        and r.stage = c.research_state
      order by r.observed_at desc
      limit 1
    ) e on true
  ), counts as materialized (
    select
      count(*) filter (where research_state = 'sighted') as sighted,
      count(*) filter (where research_state = 'under_watch') as under_watch,
      count(*) filter (where research_state = 'target_locked') as target_locked
    from candidates
  )
  select jsonb_build_object(
    'launches', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.research_state_at desc)
      from selected s
    ), '[]'::jsonb),
    'streams', coalesce((
      select jsonb_agg(to_jsonb(st) order by st.feed)
      from (
        select feed, status, last_seen_at
        from public.stream_status
      ) st
    ), '[]'::jsonb),
    'researchCounts', jsonb_build_object(
      'sighted', (select sighted from counts),
      'under_watch', (select under_watch from counts),
      'target_locked', (select target_locked from counts)
    ),
    'launchCount', (select launch_count from public.dashboard_totals),
    'tradeCount', (select trade_count from public.dashboard_totals)
  );
$function$;

revoke execute on function public.get_dashboard_home(integer) from public, anon, authenticated;
grant execute on function public.get_dashboard_home(integer) to service_role;

comment on function public.get_dashboard_home(integer) is
  'Returns every active homepage token: Sighted for 1 hour, Surveilling for 6 hours, and Acquired for 24 hours.';
