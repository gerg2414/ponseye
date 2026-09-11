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
  passed_sighted_gate boolean := false;
begin
  select l.launched_at
  into launch_time
  from public.launches l
  where l.token_address = new.token_address;

  passed_sighted_gate := launch_time is not null
    and new.last_trade_at is not null
    and new.last_trade_at >= launch_time + interval '60 seconds'
    and new.price_usd is not null
    and new.price_usd * 1000000000::numeric >= 10000::numeric;

  if prior_state = 'binned' then
    next_state := 'binned';
  elsif new.creator_sells > 0
    and new.peak_unit_price_raw > 0
    and new.last_unit_price_raw <= new.peak_unit_price_raw * 0.50 then
    next_state := 'binned';
  elsif prior_state = 'target_locked' then
    next_state := 'target_locked';
  elsif prior_state = 'under_watch'
    and passed_sighted_gate
    and new.trade_count >= 30
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
    new.research_state_at := coalesce(new.last_trade_at, now());
    new.research_rule_version := 'pons-momentum-v2';
  elsif tg_op = 'INSERT' then
    new.research_state := 'sighted';
    new.research_state_at := now();
    new.research_rule_version := 'pons-momentum-v2';
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
  launch_age_seconds numeric;
begin
  if tg_op = 'UPDATE' and new.research_state is not distinct from old.research_state then
    return new;
  end if;

  select l.launched_at
  into launch_time
  from public.launches l
  where l.token_address = new.token_address;

  launch_age_seconds := case
    when launch_time is not null and new.last_trade_at is not null
      then greatest(0::numeric, extract(epoch from (new.last_trade_at - launch_time)))
    else null
  end;

  reasons := case
    when new.research_state = 'under_watch' and new.research_rule_version = 'pons-momentum-v2'
      then array['minimum_age_60s', 'market_cap_10k', 'activity_floor', 'buyer_majority', 'creator_clear']
    when new.research_state = 'under_watch'
      then array['activity_floor', 'buyer_majority', 'creator_clear']
    when new.research_state = 'target_locked' and new.research_rule_version = 'pons-momentum-v2'
      then array['minimum_age_60s', 'market_cap_10k', 'trader_depth', 'early_buyer_depth', 'momentum_held', 'creator_clear']
    when new.research_state = 'target_locked'
      then array['trader_depth', 'early_buyer_depth', 'momentum_held', 'creator_clear']
    when new.research_state = 'binned'
      then array['creator_sell', 'deep_drawdown']
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
      'market_cap_usd', case when new.price_usd > 0 then new.price_usd * 1000000000::numeric else null end,
      'volume_usd', new.volume_usd,
      'launch_age_seconds', launch_age_seconds,
      'minimum_age_seconds', case when new.research_rule_version = 'pons-momentum-v2' then 60 else null end,
      'market_cap_floor_usd', case when new.research_rule_version = 'pons-momentum-v2' then 10000 else null end
    )
  ) on conflict (token_address, stage, rule_version) do nothing;

  return new;
end;
$$;

comment on function public.classify_launch_research_state() is
  'PonsEye v2 sequential funnel. Launches remain Sighted for at least 60 seconds and must still hold a $10k market cap before Surveillance or Acquired.';

comment on function public.record_launch_research_event() is
  'Records versioned PonsEye funnel transitions with the market age and market cap gate captured in each v2 snapshot.';
