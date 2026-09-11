create or replace function public.classify_launch_research_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior_state text := case when tg_op = 'UPDATE' then old.research_state else 'sighted' end;
  next_state text := prior_state;
  launch_time timestamptz;
  evidence_time timestamptz;
  current_peak_hold numeric;
  evidence_score integer := 0;
  passed_sighted_gate boolean := false;
begin
  select l.launched_at
  into launch_time
  from public.launches l
  where l.token_address = new.token_address;

  evidence_time := greatest(new.last_trade_at, new.usd_price_at, new.holder_snapshot_at);
  current_peak_hold := case
    when new.peak_price_usd > 0 then new.price_usd / new.peak_price_usd
    when new.peak_unit_price_raw > 0 then new.last_unit_price_raw / new.peak_unit_price_raw
    else null
  end;

  evidence_score :=
    case when new.trade_count >= 50 then 1 else 0 end +
    case when new.unique_traders >= 15 then 1 else 0 end +
    case when new.trade_count > 0 and new.buys * 100 >= new.trade_count * 58 then 1 else 0 end +
    case when new.first_minute_buyers >= 3 then 1 else 0 end +
    case when new.holder_count >= 30 then 1 else 0 end +
    case when new.holder_change_5m > 0 then 1 else 0 end +
    case when new.top_10_holder_pct is not null and new.top_10_holder_pct <= 70 then 1 else 0 end +
    case when new.creator_balance_pct is not null and new.creator_balance_pct <= 5 then 1 else 0 end +
    case when new.first_unit_price_raw > 0 and new.last_unit_price_raw >= new.first_unit_price_raw * 1.20 then 1 else 0 end +
    case
      when new.peak_price_usd > 0 and new.price_usd >= new.peak_price_usd * 0.60 then 1
      when new.peak_price_usd is null and new.peak_unit_price_raw > 0
        and new.last_unit_price_raw >= new.peak_unit_price_raw * 0.60 then 1
      else 0
    end;

  passed_sighted_gate := launch_time is not null
    and evidence_time is not null
    and evidence_time >= launch_time + interval '60 seconds'
    and new.price_usd is not null
    and new.price_usd * 1000000000::numeric >= 10000::numeric;

  if prior_state = 'binned' then
    next_state := 'binned';
  elsif new.creator_sells > 0
    and current_peak_hold is not null
    and current_peak_hold <= 0.50 then
    next_state := 'binned';
  elsif prior_state = 'target_locked' then
    next_state := 'target_locked';
  elsif prior_state = 'under_watch'
    and passed_sighted_gate
    and new.trade_count >= 30
    and new.unique_traders >= 10
    and new.creator_sells = 0
    and current_peak_hold >= 0.50
    and evidence_score >= 8 then
    next_state := 'target_locked';
  elsif prior_state = 'under_watch' then
    next_state := 'under_watch';
  elsif passed_sighted_gate
    and new.trade_count >= 12
    and new.unique_traders >= 6
    and new.buys * 100 >= new.trade_count * 52
    and new.creator_sells = 0 then
    next_state := 'under_watch';
  else
    next_state := 'sighted';
  end if;

  if next_state is distinct from prior_state then
    new.research_state := next_state;
    new.research_state_at := coalesce(evidence_time, now());
    new.research_rule_version := 'pons-momentum-v3';
  elsif tg_op = 'INSERT' then
    new.research_state := 'sighted';
    new.research_state_at := now();
    new.research_rule_version := 'pons-momentum-v3';
  end if;

  return new;
end;
$$;

create or replace function public.record_launch_research_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reasons text[];
  launch_time timestamptz;
  evidence_time timestamptz;
  launch_age_seconds numeric;
  evidence_score integer := 0;
begin
  if tg_op = 'UPDATE' and new.research_state is not distinct from old.research_state then
    return new;
  end if;

  select l.launched_at
  into launch_time
  from public.launches l
  where l.token_address = new.token_address;

  evidence_time := greatest(new.last_trade_at, new.usd_price_at, new.holder_snapshot_at);
  launch_age_seconds := case
    when launch_time is not null and evidence_time is not null
      then greatest(0::numeric, extract(epoch from (evidence_time - launch_time)))
    else null
  end;
  evidence_score :=
    case when new.trade_count >= 50 then 1 else 0 end +
    case when new.unique_traders >= 15 then 1 else 0 end +
    case when new.trade_count > 0 and new.buys * 100 >= new.trade_count * 58 then 1 else 0 end +
    case when new.first_minute_buyers >= 3 then 1 else 0 end +
    case when new.holder_count >= 30 then 1 else 0 end +
    case when new.holder_change_5m > 0 then 1 else 0 end +
    case when new.top_10_holder_pct is not null and new.top_10_holder_pct <= 70 then 1 else 0 end +
    case when new.creator_balance_pct is not null and new.creator_balance_pct <= 5 then 1 else 0 end +
    case when new.first_unit_price_raw > 0 and new.last_unit_price_raw >= new.first_unit_price_raw * 1.20 then 1 else 0 end +
    case
      when new.peak_price_usd > 0 and new.price_usd >= new.peak_price_usd * 0.60 then 1
      when new.peak_price_usd is null and new.peak_unit_price_raw > 0
        and new.last_unit_price_raw >= new.peak_unit_price_raw * 0.60 then 1
      else 0
    end;

  reasons := case
    when new.research_state = 'under_watch' and new.research_rule_version = 'pons-momentum-v3'
      then array['minimum_age_60s', 'market_cap_10k', 'activity_floor', 'buyer_majority', 'creator_clear']
    when new.research_state = 'target_locked' and new.research_rule_version = 'pons-momentum-v3'
      then array['evidence_score_8', 'activity_depth', 'trader_depth', 'peak_held', 'creator_clear']
    when new.research_state = 'under_watch'
      then array['activity_floor', 'buyer_majority', 'creator_clear']
    when new.research_state = 'target_locked'
      then array['trader_depth', 'early_buyer_depth', 'momentum_held', 'creator_clear']
    when new.research_state = 'binned'
      then array['creator_sell', 'deep_drawdown']
    else array['launch_detected']
  end;

  insert into public.research_events (
    token_address, stage, rule_version, observed_at, reason_codes, metrics_snapshot
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
      'holder_change_5m', new.holder_change_5m,
      'top_10_holder_pct', new.top_10_holder_pct,
      'creator_balance_pct', new.creator_balance_pct,
      'price_usd', new.price_usd,
      'market_cap_usd', case when new.price_usd > 0 then new.price_usd * 1000000000::numeric else null end,
      'peak_price_usd', new.peak_price_usd,
      'volume_usd', new.volume_usd,
      'launch_age_seconds', launch_age_seconds,
      'minimum_age_seconds', 60,
      'market_cap_floor_usd', 10000,
      'evidence_score', evidence_score,
      'evidence_score_required', 8
    )
  ) on conflict (token_address, stage, rule_version) do nothing;

  return new;
end;
$$;

create or replace function public.update_launch_market_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  launch_time timestamptz;
  early_buyer_total integer;
begin
  select l.launched_at
  into launch_time
  from public.launches l
  where l.token_address = new.token_address;

  if new.side = 'buy'
    and new.trader_address is not null
    and launch_time is not null
    and new.block_time <= launch_time + interval '1 minute' then
    insert into public.launch_metric_traders (token_address, trader_address, first_minute_buyer)
    values (new.token_address, new.trader_address, true)
    on conflict (token_address, trader_address) do update
    set first_minute_buyer = true;

    select count(*) filter (where t.first_minute_buyer)::integer
    into early_buyer_total
    from public.launch_metric_traders t
    where t.token_address = new.token_address;
  end if;

  insert into public.launch_metrics (
    token_address, price_usd, volume_usd, peak_price_usd, usd_price_at, first_minute_buyers
  ) values (
    new.token_address, new.price_usd, coalesce(new.quote_amount_usd, 0),
    case when new.price_usd > 0 then new.price_usd else null end, new.block_time,
    coalesce(early_buyer_total, 0)
  )
  on conflict (token_address) do update set
    price_usd = case when public.launch_metrics.usd_price_at is null or new.block_time >= public.launch_metrics.usd_price_at then new.price_usd else public.launch_metrics.price_usd end,
    volume_usd = public.launch_metrics.volume_usd + coalesce(new.quote_amount_usd, 0),
    peak_price_usd = greatest(public.launch_metrics.peak_price_usd, case when new.price_usd > 0 then new.price_usd else null end),
    usd_price_at = greatest(public.launch_metrics.usd_price_at, new.block_time),
    first_minute_buyers = greatest(public.launch_metrics.first_minute_buyers, coalesce(early_buyer_total, 0)),
    updated_at = now();
  return new;
end;
$$;

revoke execute on function public.classify_launch_research_state() from public, anon, authenticated;
revoke execute on function public.record_launch_research_event() from public, anon, authenticated;
revoke execute on function public.update_launch_market_metrics() from public, anon, authenticated;
grant execute on function public.classify_launch_research_state() to service_role;
grant execute on function public.record_launch_research_event() to service_role;
grant execute on function public.update_launch_market_metrics() to service_role;

comment on function public.classify_launch_research_state() is
  'PonsEye v3 sequential funnel. Acquired requires hard safety floors plus 8 of 10 evidence checks; first-minute buyers are one optional point.';
comment on function public.update_launch_market_metrics() is
  'Updates USD market metrics and recovers first-minute buyer evidence from the priced trade feed.';

do $$
declare
  function_definition text;
  old_filter constant text := 'and e.rule_version in (''pons-momentum-v1'', ''pons-momentum-v2'')';
  new_filter constant text := 'and e.rule_version in (''pons-momentum-v1'', ''pons-momentum-v2'', ''pons-momentum-v3'')';
begin
  select pg_get_functiondef('public.build_ponseye_lab_dataset()'::regprocedure)
  into function_definition;

  if position(old_filter in function_definition) > 0 then
    execute replace(function_definition, old_filter, new_filter);
  elsif position(new_filter in function_definition) = 0 then
    raise exception 'Could not locate the Lab rule-version filter';
  end if;

  perform public.refresh_ponseye_lab_dataset();
end;
$$;
