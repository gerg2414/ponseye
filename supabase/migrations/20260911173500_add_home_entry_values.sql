create or replace function public.get_dashboard_home(p_limit integer default 12)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  with candidates as materialized (
    (select m.token_address, m.research_state, m.research_state_at, m.research_rule_version
     from public.launch_metrics m
     where m.research_state = 'sighted'
     order by m.research_state_at desc
     limit greatest(1, least(p_limit, 50)))
    union all
    (select m.token_address, m.research_state, m.research_state_at, m.research_rule_version
     from public.launch_metrics m
     where m.research_state = 'under_watch'
     order by m.research_state_at desc
     limit greatest(1, least(p_limit, 50)))
    union all
    (select m.token_address, m.research_state, m.research_state_at, m.research_rule_version
     from public.launch_metrics m
     where m.research_state = 'target_locked'
     order by m.research_state_at desc
     limit greatest(1, least(p_limit, 50)))
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
    from public.launch_metrics
    where research_state <> 'binned'
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
