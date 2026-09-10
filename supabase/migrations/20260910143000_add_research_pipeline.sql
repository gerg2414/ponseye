alter table public.launch_metrics
  add column research_state text not null default 'sighted'
    check (research_state in ('sighted', 'under_watch', 'target_locked', 'binned')),
  add column research_state_at timestamptz not null default now(),
  add column research_rule_version text not null default 'pons-momentum-v1';

create index launch_metrics_research_activity_idx
  on public.launch_metrics (research_state, last_trade_at desc);

create table public.research_events (
  token_address text not null references public.launches(token_address) on delete cascade,
  stage text not null check (stage in ('sighted', 'under_watch', 'target_locked', 'binned')),
  rule_version text not null,
  observed_at timestamptz not null default now(),
  reason_codes text[] not null default '{}',
  metrics_snapshot jsonb not null default '{}'::jsonb,
  primary key (token_address, stage, rule_version)
);

create index research_events_stage_time_idx
  on public.research_events (stage, observed_at desc);

create index research_events_token_time_idx
  on public.research_events (token_address, observed_at desc);

alter table public.research_events enable row level security;
revoke all on table public.research_events from public, anon, authenticated;
grant select, insert on table public.research_events to service_role;

create function public.classify_launch_research_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior_state text := case when tg_op = 'UPDATE' then old.research_state else 'sighted' end;
  next_state text := prior_state;
begin
  if prior_state = 'binned' then
    next_state := 'binned';
  elsif new.creator_sells > 0
    and new.peak_unit_price_raw > 0
    and new.last_unit_price_raw <= new.peak_unit_price_raw * 0.50 then
    next_state := 'binned';
  elsif prior_state = 'target_locked' then
    next_state := 'target_locked';
  elsif new.trade_count >= 30
    and new.unique_traders >= 15
    and new.buys * 100 >= new.trade_count * 60
    and new.creator_sells = 0
    and new.first_minute_buyers >= 6
    and new.first_unit_price_raw > 0
    and new.last_unit_price_raw >= new.first_unit_price_raw * 1.20
    and (new.peak_unit_price_raw is null or new.last_unit_price_raw >= new.peak_unit_price_raw * 0.60)
    and (new.top_10_holder_pct is null or new.top_10_holder_pct <= 70)
    and (new.creator_balance_pct is null or new.creator_balance_pct <= 5) then
    next_state := 'target_locked';
  elsif prior_state = 'under_watch' then
    next_state := 'under_watch';
  elsif new.trade_count >= 12
    and new.unique_traders >= 6
    and new.buys * 100 >= new.trade_count * 52
    and new.creator_sells = 0 then
    next_state := 'under_watch';
  else
    next_state := 'sighted';
  end if;

  if next_state is distinct from prior_state then
    new.research_state := next_state;
    new.research_state_at := now();
    new.research_rule_version := 'pons-momentum-v1';
  elsif tg_op = 'INSERT' then
    new.research_state := 'sighted';
    new.research_state_at := now();
    new.research_rule_version := 'pons-momentum-v1';
  end if;

  return new;
end;
$$;

create function public.record_launch_research_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reasons text[];
begin
  if tg_op = 'UPDATE' and new.research_state is not distinct from old.research_state then
    return new;
  end if;

  reasons := case new.research_state
    when 'under_watch' then array['activity_floor', 'buyer_majority', 'creator_clear']
    when 'target_locked' then array['trader_depth', 'early_buyer_depth', 'momentum_held', 'creator_clear']
    when 'binned' then array['creator_sell', 'deep_drawdown']
    else array['launch_detected']
  end;

  insert into public.research_events (
    token_address,
    stage,
    rule_version,
    observed_at,
    reason_codes,
    metrics_snapshot
  ) values (
    new.token_address,
    new.research_state,
    new.research_rule_version,
    new.research_state_at,
    reasons,
    jsonb_build_object(
      'trade_count', new.trade_count,
      'buys', new.buys,
      'sells', new.sells,
      'unique_traders', new.unique_traders,
      'buy_pressure_pct', case when new.trade_count > 0 then round(new.buys::numeric * 100 / new.trade_count, 1) else null end,
      'creator_sells', new.creator_sells,
      'first_minute_buyers', new.first_minute_buyers,
      'first_unit_price_raw', new.first_unit_price_raw,
      'last_unit_price_raw', new.last_unit_price_raw,
      'peak_unit_price_raw', new.peak_unit_price_raw,
      'holder_count', new.holder_count,
      'top_10_holder_pct', new.top_10_holder_pct,
      'creator_balance_pct', new.creator_balance_pct,
      'price_usd', new.price_usd,
      'volume_usd', new.volume_usd
    )
  ) on conflict (token_address, stage, rule_version) do nothing;

  return new;
end;
$$;

create trigger launch_metrics_classify_research
before insert or update on public.launch_metrics
for each row execute function public.classify_launch_research_state();

create trigger launch_metrics_record_research
after insert or update on public.launch_metrics
for each row execute function public.record_launch_research_event();

insert into public.research_events (
  token_address,
  stage,
  rule_version,
  observed_at,
  reason_codes,
  metrics_snapshot
)
select
  m.token_address,
  'sighted',
  'pons-momentum-v1',
  l.launched_at,
  array['launch_detected'],
  jsonb_build_object('historical_import', true)
from public.launch_metrics m
join public.launches l on l.token_address = m.token_address
on conflict (token_address, stage, rule_version) do nothing;

create or replace function public.get_dashboard_home(p_limit integer default 12)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with enriched as (
    select
      b.*,
      coalesce(m.research_state, 'sighted') as research_state,
      coalesce(m.research_state_at, b.launched_at) as research_state_at,
      coalesce(m.research_rule_version, 'pons-momentum-v1') as research_rule_version,
      coalesce(e.reason_codes, array['launch_detected']) as research_reasons
    from public.launch_board b
    left join public.launch_metrics m on m.token_address = b.token_address
    left join lateral (
      select r.reason_codes
      from public.research_events r
      where r.token_address = b.token_address
        and r.stage = coalesce(m.research_state, 'sighted')
      order by r.observed_at desc
      limit 1
    ) e on true
  ), selected as (
    (select * from enriched where research_state = 'sighted' order by launched_at desc limit greatest(1, least(p_limit, 50)))
    union all
    (select * from enriched where research_state = 'under_watch' order by research_state_at desc limit greatest(1, least(p_limit, 50)))
    union all
    (select * from enriched where research_state = 'target_locked' order by research_state_at desc limit greatest(1, least(p_limit, 50)))
  )
  select jsonb_build_object(
    'launches', coalesce((select jsonb_agg(to_jsonb(s) order by s.research_state_at desc) from selected s), '[]'::jsonb),
    'streams', coalesce((
      select jsonb_agg(to_jsonb(st) order by st.feed)
      from (
        select feed, status, last_seen_at
        from public.stream_status
      ) st
    ), '[]'::jsonb),
    'researchCounts', jsonb_build_object(
      'sighted', (select count(*) from public.launch_metrics where research_state = 'sighted'),
      'under_watch', (select count(*) from public.launch_metrics where research_state = 'under_watch'),
      'target_locked', (select count(*) from public.launch_metrics where research_state = 'target_locked')
    ),
    'launchCount', (select launch_count from public.dashboard_totals),
    'tradeCount', (select trade_count from public.dashboard_totals)
  );
$$;

revoke execute on function public.classify_launch_research_state() from public, anon, authenticated;
revoke execute on function public.record_launch_research_event() from public, anon, authenticated;
revoke execute on function public.get_dashboard_home(integer) from public, anon, authenticated;
grant execute on function public.classify_launch_research_state() to service_role;
grant execute on function public.record_launch_research_event() to service_role;
grant execute on function public.get_dashboard_home(integer) to service_role;

comment on table public.research_events is
  'Immutable evidence of each PonsEye research state transition and the metrics visible when it occurred.';

comment on function public.classify_launch_research_state() is
  'Forward-only PonsEye research funnel using the versioned pons-momentum-v1 hypothesis.';
