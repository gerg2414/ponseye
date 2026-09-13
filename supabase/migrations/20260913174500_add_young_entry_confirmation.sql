alter table public.launch_metrics
  add column if not exists entry_confirmation_started_at timestamptz,
  add column if not exists entry_confirmation_price_usd numeric;

create or replace function public.classify_launch_research_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  prior_state text := case when tg_op = 'UPDATE' then old.research_state else 'sighted' end;
  next_state text := prior_state;
  launch_time timestamptz;
  evidence_time timestamptz;
  price_evidence_time timestamptz;
  transition_time timestamptz;
  launch_age_seconds numeric;
  momentum_multiple numeric;
  peak_hold_pct numeric;
  market_cap_usd numeric;
  early_buyer_share_pct numeric;
  recent_buys_20s integer := 0;
  available_weight numeric := 105;
  passed_weight numeric := 0;
  entry_score numeric := 0;
  passed_surveillance_gate boolean := false;
  passed_strict_entry boolean := false;
  passed_quiet_peak_entry boolean := false;
begin
  if current_setting('ponseye.repair_mode', true) = 'on' then
    return new;
  end if;

  select l.launched_at into launch_time
  from public.launches l
  where l.token_address = new.token_address;

  evidence_time := greatest(new.last_trade_at, new.usd_price_at, new.holder_snapshot_at);
  price_evidence_time := greatest(new.last_trade_at, new.usd_price_at);
  transition_time := coalesce(evidence_time, now());
  launch_age_seconds := case when launch_time is not null and evidence_time is not null
    then greatest(0::numeric, extract(epoch from (evidence_time - launch_time))) end;
  momentum_multiple := case when new.first_unit_price_raw > 0 then new.last_unit_price_raw / new.first_unit_price_raw end;
  peak_hold_pct := case when new.peak_unit_price_raw > 0 then new.last_unit_price_raw * 100 / new.peak_unit_price_raw end;
  market_cap_usd := case when new.price_usd > 0 then new.price_usd * 1000000000::numeric end;
  early_buyer_share_pct := case when new.unique_traders > 0 then new.first_minute_buyers * 100::numeric / new.unique_traders end;

  if momentum_multiple is not null then available_weight := available_weight + 20; end if;
  if peak_hold_pct is not null then available_weight := available_weight + 15; end if;
  if new.top_10_holder_pct is not null then available_weight := available_weight + 10; end if;

  passed_weight :=
    case when new.trade_count >= 12 then 15 else 0 end +
    case when new.unique_traders >= 12 then 15 else 0 end +
    case when new.trade_count > 0 and new.buys * 100 >= new.trade_count * 65 then 10 else 0 end +
    case when new.first_minute_buyers >= 8 then 15 else 0 end +
    case when momentum_multiple >= 0.75 then 20 else 0 end +
    case when peak_hold_pct >= 70 then 15 else 0 end +
    case when new.top_10_holder_pct is not null and new.top_10_holder_pct <= 90 then 10 else 0 end +
    case when market_cap_usd >= 5000 then 25 else 0 end +
    case when early_buyer_share_pct >= 50 then 25 else 0 end;

  entry_score := case when available_weight > 0 then passed_weight * 100 / available_weight else 0 end;

  passed_surveillance_gate := launch_time is not null
    and evidence_time is not null
    and evidence_time >= launch_time + interval '60 seconds'
    and evidence_time <= launch_time + interval '15 minutes'
    and evidence_time >= now() - interval '2 minutes'
    and market_cap_usd >= 10000
    and new.trade_count >= 12
    and new.unique_traders >= 6
    and new.buys * 100 >= new.trade_count * 52
    and new.creator_sells = 0;

  if passed_surveillance_gate then
    select count(*)::integer into recent_buys_20s
    from public.trades recent
    where recent.token_address = new.token_address
      and lower(recent.side) = 'buy'
      and recent.block_time >= evidence_time - interval '20 seconds'
      and recent.block_time <= evidence_time;
  end if;

  passed_strict_entry := passed_surveillance_gate
    and (new.top_10_holder_pct is null or new.top_10_holder_pct <= 90)
    and entry_score >= 90;

  passed_quiet_peak_entry := passed_surveillance_gate
    and (new.top_10_holder_pct is null or new.top_10_holder_pct <= 90)
    and entry_score >= 50
    and peak_hold_pct >= 100
    and recent_buys_20s <= 2;

  if prior_state = 'binned' then
    next_state := 'binned';
  elsif new.creator_sells > 0 then
    next_state := 'binned';
  elsif prior_state = 'target_locked' then
    next_state := 'target_locked';
  elsif new.entry_confirmation_started_at is not null then
    if price_evidence_time >= new.entry_confirmation_started_at + interval '90 seconds' then
      transition_time := price_evidence_time;
      if new.price_usd >= new.entry_confirmation_price_usd * 0.5 then
        next_state := 'target_locked';
      else
        next_state := 'binned';
      end if;
    else
      next_state := 'under_watch';
    end if;
  elsif prior_state = 'under_watch' then
    next_state := 'under_watch';
  elsif passed_strict_entry or passed_quiet_peak_entry then
    if launch_age_seconds < 90 then
      new.entry_confirmation_started_at := evidence_time;
      new.entry_confirmation_price_usd := new.price_usd;
      next_state := 'under_watch';
    else
      next_state := 'target_locked';
    end if;
  elsif passed_surveillance_gate then
    next_state := 'under_watch';
  else
    next_state := 'sighted';
  end if;

  if next_state is distinct from prior_state then
    new.research_state := next_state;
    new.research_state_at := transition_time;
    new.research_rule_version := 'pons-momentum-v7';
  elsif tg_op = 'INSERT' then
    new.research_state := 'sighted';
    new.research_state_at := now();
    new.research_rule_version := 'pons-momentum-v7';
  end if;

  return new;
end;
$function$;

revoke execute on function public.classify_launch_research_state() from public, anon, authenticated;
grant execute on function public.classify_launch_research_state() to service_role;

create or replace function public.record_launch_research_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  reasons text[];
  launch_time timestamptz;
  evidence_time timestamptz;
  launch_age_seconds numeric;
  momentum_multiple numeric;
  peak_hold_pct numeric;
  market_cap_usd numeric;
  early_buyer_share_pct numeric;
  recent_buys_20s integer := 0;
  available_weight numeric := 105;
  passed_weight numeric := 0;
  entry_score numeric := 0;
  entry_lane text := null;
  snapshot jsonb;
begin
  if tg_op = 'UPDATE' and new.research_state is not distinct from old.research_state then
    return new;
  end if;

  select l.launched_at into launch_time
  from public.launches l
  where l.token_address = new.token_address;

  evidence_time := greatest(new.last_trade_at, new.usd_price_at, new.holder_snapshot_at);
  launch_age_seconds := case when launch_time is not null and evidence_time is not null
    then greatest(0::numeric, extract(epoch from (evidence_time - launch_time))) end;
  momentum_multiple := case when new.first_unit_price_raw > 0 then new.last_unit_price_raw / new.first_unit_price_raw end;
  peak_hold_pct := case when new.peak_unit_price_raw > 0 then new.last_unit_price_raw * 100 / new.peak_unit_price_raw end;
  market_cap_usd := case when new.price_usd > 0 then new.price_usd * 1000000000::numeric end;
  early_buyer_share_pct := case when new.unique_traders > 0 then new.first_minute_buyers * 100::numeric / new.unique_traders end;

  if momentum_multiple is not null then available_weight := available_weight + 20; end if;
  if peak_hold_pct is not null then available_weight := available_weight + 15; end if;
  if new.top_10_holder_pct is not null then available_weight := available_weight + 10; end if;

  passed_weight :=
    case when new.trade_count >= 12 then 15 else 0 end +
    case when new.unique_traders >= 12 then 15 else 0 end +
    case when new.trade_count > 0 and new.buys * 100 >= new.trade_count * 65 then 10 else 0 end +
    case when new.first_minute_buyers >= 8 then 15 else 0 end +
    case when momentum_multiple >= 0.75 then 20 else 0 end +
    case when peak_hold_pct >= 70 then 15 else 0 end +
    case when new.top_10_holder_pct is not null and new.top_10_holder_pct <= 90 then 10 else 0 end +
    case when market_cap_usd >= 5000 then 25 else 0 end +
    case when early_buyer_share_pct >= 50 then 25 else 0 end;
  entry_score := case when available_weight > 0 then passed_weight * 100 / available_weight else 0 end;

  if evidence_time is not null then
    select count(*)::integer into recent_buys_20s
    from public.trades recent
    where recent.token_address = new.token_address
      and lower(recent.side) = 'buy'
      and recent.block_time >= evidence_time - interval '20 seconds'
      and recent.block_time <= evidence_time;
  end if;

  entry_lane := case
    when entry_score >= 90 then 'strict'
    when entry_score >= 50 and peak_hold_pct >= 100 and recent_buys_20s <= 2 then 'quiet_peak'
    else null
  end;

  snapshot := jsonb_build_object(
    'trade_count', new.trade_count, 'buys', new.buys, 'sells', new.sells,
    'recent_buys_20s', recent_buys_20s, 'unique_traders', new.unique_traders,
    'buy_pressure_pct', case when new.trade_count > 0 then round(new.buys::numeric * 100 / new.trade_count, 1) end,
    'creator_sells', new.creator_sells, 'first_minute_buyers', new.first_minute_buyers,
    'early_buyer_share_pct', early_buyer_share_pct,
    'first_unit_price_raw', new.first_unit_price_raw, 'last_unit_price_raw', new.last_unit_price_raw,
    'peak_unit_price_raw', new.peak_unit_price_raw, 'momentum_multiple', momentum_multiple,
    'peak_hold_pct', peak_hold_pct, 'holder_count', new.holder_count,
    'holder_change_5m', new.holder_change_5m, 'top_10_holder_pct', new.top_10_holder_pct,
    'creator_balance_pct', new.creator_balance_pct, 'price_usd', new.price_usd,
    'market_cap_usd', market_cap_usd, 'peak_price_usd', new.peak_price_usd,
    'volume_usd', new.volume_usd, 'launch_age_seconds', launch_age_seconds,
    'minimum_age_seconds', 60, 'market_cap_floor_usd', 10000,
    'entry_lane', entry_lane, 'entry_score', round(entry_score, 2),
    'entry_score_required', 90, 'quiet_peak_score_required', 50,
    'confirmation_started_at', new.entry_confirmation_started_at,
    'confirmation_price_usd', new.entry_confirmation_price_usd,
    'confirmation_seconds', case when new.entry_confirmation_started_at is not null then 90 else 0 end,
    'confirmation_floor_multiple', case when new.entry_confirmation_started_at is not null then 0.5 end
  );

  if new.research_rule_version = 'pons-momentum-v7' and new.research_state = 'target_locked' then
    insert into public.research_events (
      token_address, stage, rule_version, observed_at, reason_codes, metrics_snapshot
    ) values (
      new.token_address, 'under_watch', new.research_rule_version, new.research_state_at,
      array['minimum_age_60s', 'market_cap_10k', 'activity_floor', 'buyer_majority', 'creator_clear'], snapshot
    ) on conflict (token_address, stage, rule_version) do nothing;
  end if;

  reasons := case
    when new.research_state = 'under_watch' and new.entry_confirmation_started_at is not null
      then array['young_entry_confirmation_90s', 'confirmation_floor_0_5x']
    when new.research_state = 'under_watch' then array['surveillance_gate', 'strict_quiet_rejected']
    when new.research_state = 'target_locked' and new.entry_confirmation_started_at is not null
      then array['young_entry_confirmed', 'price_held_above_0_5x']
    when new.research_state = 'target_locked' and entry_lane = 'quiet_peak'
      then array['quiet_peak', 'entry_score_50', 'peak_held_100', 'recent_buys_20s_max_2']
    when new.research_state = 'target_locked' then array['strict_entry', 'entry_score_90']
    when new.research_state = 'binned' and new.entry_confirmation_started_at is not null
      then array['young_entry_confirmation_failed']
    when new.research_state = 'binned' then array['creator_sell']
    else array['launch_detected']
  end;

  insert into public.research_events (
    token_address, stage, rule_version, observed_at, reason_codes, metrics_snapshot
  ) values (
    new.token_address, new.research_state, new.research_rule_version,
    new.research_state_at, reasons, snapshot
  ) on conflict (token_address, stage, rule_version) do nothing;

  return new;
end;
$function$;

revoke execute on function public.record_launch_research_event() from public, anon, authenticated;
grant execute on function public.record_launch_research_event() to service_role;

comment on column public.launch_metrics.entry_confirmation_started_at is
  'Start of the 90 second confirmation applied only when an entry first qualifies before 90 seconds of token age.';

comment on column public.launch_metrics.entry_confirmation_price_usd is
  'Signal price used by young entry confirmation. Acquisition requires at least 0.5x of this price after 90 seconds.';

comment on function public.classify_launch_research_state() is
  'Applies the strict and quiet entry lanes plus a 90 second confirmation for entry signals first seen between 60 and 89 seconds of token age.';
