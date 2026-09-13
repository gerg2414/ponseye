alter table public.acquired_positions
  alter column target_multiple set default 100,
  alter column stop_multiple drop not null,
  alter column stop_multiple drop default;

alter table public.acquired_positions
  add column if not exists strategy_version text not null default 'strict-quiet-staggered-v1',
  add column if not exists position_size_usd numeric not null default 25,
  add column if not exists remaining_pct numeric not null default 100,
  add column if not exists realised_return_multiple numeric not null default 0,
  add column if not exists hit_10x_at timestamptz,
  add column if not exists hit_20x_at timestamptz,
  add column if not exists hit_50x_at timestamptz,
  add column if not exists hit_100x_at timestamptz;

alter table public.acquired_positions
  drop constraint if exists acquired_positions_remaining_pct_check,
  add constraint acquired_positions_remaining_pct_check check (remaining_pct >= 0 and remaining_pct <= 100),
  drop constraint if exists acquired_positions_position_size_usd_check,
  add constraint acquired_positions_position_size_usd_check check (position_size_usd > 0),
  drop constraint if exists acquired_positions_realised_return_multiple_check,
  add constraint acquired_positions_realised_return_multiple_check check (realised_return_multiple >= 0);

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
  elsif prior_state = 'under_watch' then
    next_state := 'under_watch';
  elsif passed_strict_entry or passed_quiet_peak_entry then
    next_state := 'target_locked';
  elsif passed_surveillance_gate then
    next_state := 'under_watch';
  else
    next_state := 'sighted';
  end if;

  if next_state is distinct from prior_state then
    new.research_state := next_state;
    new.research_state_at := coalesce(evidence_time, now());
    new.research_rule_version := 'pons-momentum-v6';
  elsif tg_op = 'INSERT' then
    new.research_state := 'sighted';
    new.research_state_at := now();
    new.research_rule_version := 'pons-momentum-v6';
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
    'entry_score_required', 90, 'quiet_peak_score_required', 50
  );

  if new.research_rule_version = 'pons-momentum-v6' and new.research_state = 'target_locked' then
    insert into public.research_events (
      token_address, stage, rule_version, observed_at, reason_codes, metrics_snapshot
    ) values (
      new.token_address, 'under_watch', new.research_rule_version, new.research_state_at,
      array['minimum_age_60s', 'market_cap_10k', 'activity_floor', 'buyer_majority', 'creator_clear'], snapshot
    ) on conflict (token_address, stage, rule_version) do nothing;
  end if;

  reasons := case
    when new.research_state = 'under_watch' then array['surveillance_gate', 'strict_quiet_rejected']
    when new.research_state = 'target_locked' and entry_lane = 'quiet_peak' then array['quiet_peak', 'entry_score_50', 'peak_held_100', 'recent_buys_20s_max_2']
    when new.research_state = 'target_locked' then array['strict_entry', 'entry_score_90']
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

create or replace function public.register_acquired_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  entry_price numeric := nullif(new.metrics_snapshot ->> 'price_usd', '')::numeric;
  entry_raw numeric := nullif(new.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric;
  entry_market_cap numeric := nullif(new.metrics_snapshot ->> 'market_cap_usd', '')::numeric;
begin
  if new.stage <> 'target_locked' then return new; end if;
  if entry_market_cap is null and entry_price is not null then entry_market_cap := entry_price * 1000000000::numeric; end if;

  insert into public.acquired_positions (
    token_address, acquired_at, entry_price_usd, entry_unit_price_raw,
    entry_market_cap_usd, peak_price_usd, target_multiple, stop_multiple,
    strategy_version, position_size_usd, remaining_pct, realised_return_multiple
  ) values (
    new.token_address, new.observed_at, entry_price, entry_raw,
    entry_market_cap, entry_price, 100, null,
    'strict-quiet-staggered-v1', 25, 100, 0
  )
  on conflict (token_address) do update set
    entry_price_usd = coalesce(public.acquired_positions.entry_price_usd, excluded.entry_price_usd),
    entry_unit_price_raw = coalesce(public.acquired_positions.entry_unit_price_raw, excluded.entry_unit_price_raw),
    entry_market_cap_usd = coalesce(public.acquired_positions.entry_market_cap_usd, excluded.entry_market_cap_usd),
    updated_at = now();

  return new;
end;
$function$;

revoke execute on function public.register_acquired_position() from public, anon, authenticated;
grant execute on function public.register_acquired_position() to service_role;

create or replace function public.apply_staggered_position_tick(
  p_token_address text,
  p_observed_at timestamptz,
  p_multiple numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_multiple is null or p_multiple <= 0 then return; end if;

  update public.acquired_positions p
  set peak_price_usd = case when p.entry_price_usd > 0
        then greatest(coalesce(p.peak_price_usd, p.entry_price_usd), p.entry_price_usd * p_multiple)
        else p.peak_price_usd end,
      hit_10x_at = case when p.hit_10x_at is null and p_multiple >= 10 then p_observed_at else p.hit_10x_at end,
      hit_20x_at = case when p.hit_20x_at is null and p_multiple >= 20 then p_observed_at else p.hit_20x_at end,
      hit_50x_at = case when p.hit_50x_at is null and p_multiple >= 50 then p_observed_at else p.hit_50x_at end,
      hit_100x_at = case when p.hit_100x_at is null and p_multiple >= 100 then p_observed_at else p.hit_100x_at end,
      realised_return_multiple =
        case when p.hit_10x_at is not null or p_multiple >= 10 then 2 else 0 end +
        case when p.hit_20x_at is not null or p_multiple >= 20 then 4 else 0 end +
        case when p.hit_50x_at is not null or p_multiple >= 50 then 25 else 0 end +
        case when p.hit_100x_at is not null or p_multiple >= 100 then 10 else 0 end,
      remaining_pct = 100
        - case when p.hit_10x_at is not null or p_multiple >= 10 then 20 else 0 end
        - case when p.hit_20x_at is not null or p_multiple >= 20 then 20 else 0 end
        - case when p.hit_50x_at is not null or p_multiple >= 50 then 50 else 0 end
        - case when p.hit_100x_at is not null or p_multiple >= 100 then 10 else 0 end,
      position_status = case when p.hit_100x_at is not null or p_multiple >= 100 then 'closed' else 'open' end,
      closed_at = case when p.hit_100x_at is null and p_multiple >= 100 then p_observed_at else p.closed_at end,
      exit_price_usd = case when p_multiple >= 100 and p.entry_price_usd is not null then p.entry_price_usd * 100 else p.exit_price_usd end,
      exit_market_cap_usd = case when p_multiple >= 100 and p.entry_market_cap_usd is not null then p.entry_market_cap_usd * 100 else p.exit_market_cap_usd end,
      exit_reason = case when p_multiple >= 100 then 'target' else p.exit_reason end,
      updated_at = now()
  where p.token_address = p_token_address
    and p.strategy_version = 'strict-quiet-staggered-v1'
    and p.position_status = 'open'
    and p_observed_at >= p.acquired_at;
end;
$function$;

revoke execute on function public.apply_staggered_position_tick(text, timestamptz, numeric) from public, anon, authenticated;
grant execute on function public.apply_staggered_position_tick(text, timestamptz, numeric) to service_role;

create or replace function public.track_curve_position_exit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  entry_raw numeric;
  observed_multiple numeric;
begin
  if new.token_amount_raw is null or new.token_amount_raw <= 0 then return new; end if;
  select p.entry_unit_price_raw into entry_raw
  from public.acquired_positions p
  where p.token_address = new.token_address and p.position_status = 'open';
  if entry_raw > 0 then
    observed_multiple := (new.quote_amount_raw / new.token_amount_raw) / entry_raw;
    perform public.apply_staggered_position_tick(new.token_address, new.block_time, observed_multiple);
  end if;
  return new;
end;
$function$;

create or replace function public.track_market_position_exit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  entry_price numeric;
begin
  if new.price_usd is null or new.price_usd <= 0 or not new.is_launch_price or new.is_price_outlier then return new; end if;
  select p.entry_price_usd into entry_price
  from public.acquired_positions p
  where p.token_address = new.token_address and p.position_status = 'open';
  if entry_price > 0 then
    perform public.apply_staggered_position_tick(new.token_address, new.block_time, new.price_usd / entry_price);
  end if;
  return new;
end;
$function$;

revoke execute on function public.track_curve_position_exit() from public, anon, authenticated;
revoke execute on function public.track_market_position_exit() from public, anon, authenticated;
grant execute on function public.track_curve_position_exit() to service_role;
grant execute on function public.track_market_position_exit() to service_role;

with path as (
  select
    p.token_address,
    max(case
      when s.source = 'curve' and p.entry_unit_price_raw > 0 then s.high_price / p.entry_unit_price_raw
      when s.source = 'market' and p.entry_price_usd > 0 then s.high_price / p.entry_price_usd
    end) as peak_multiple,
    min(s.close_at) filter (where case
      when s.source = 'curve' and p.entry_unit_price_raw > 0 then s.high_price / p.entry_unit_price_raw
      when s.source = 'market' and p.entry_price_usd > 0 then s.high_price / p.entry_price_usd
      else 0 end >= 10) as hit_10x_at,
    min(s.close_at) filter (where case
      when s.source = 'curve' and p.entry_unit_price_raw > 0 then s.high_price / p.entry_unit_price_raw
      when s.source = 'market' and p.entry_price_usd > 0 then s.high_price / p.entry_price_usd
      else 0 end >= 20) as hit_20x_at,
    min(s.close_at) filter (where case
      when s.source = 'curve' and p.entry_unit_price_raw > 0 then s.high_price / p.entry_unit_price_raw
      when s.source = 'market' and p.entry_price_usd > 0 then s.high_price / p.entry_price_usd
      else 0 end >= 50) as hit_50x_at,
    min(s.close_at) filter (where case
      when s.source = 'curve' and p.entry_unit_price_raw > 0 then s.high_price / p.entry_unit_price_raw
      when s.source = 'market' and p.entry_price_usd > 0 then s.high_price / p.entry_price_usd
      else 0 end >= 100) as hit_100x_at
  from public.acquired_positions p
  left join public.lab_price_seconds s
    on s.token_address = p.token_address
   and s.close_at >= p.acquired_at
  group by p.token_address
)
update public.acquired_positions p
set strategy_version = 'strict-quiet-staggered-v1',
    target_multiple = 100,
    stop_multiple = null,
    position_size_usd = 25,
    hit_10x_at = path.hit_10x_at,
    hit_20x_at = path.hit_20x_at,
    hit_50x_at = path.hit_50x_at,
    hit_100x_at = path.hit_100x_at,
    realised_return_multiple =
      case when path.hit_10x_at is not null then 2 else 0 end +
      case when path.hit_20x_at is not null then 4 else 0 end +
      case when path.hit_50x_at is not null then 25 else 0 end +
      case when path.hit_100x_at is not null then 10 else 0 end,
    remaining_pct = 100
      - case when path.hit_10x_at is not null then 20 else 0 end
      - case when path.hit_20x_at is not null then 20 else 0 end
      - case when path.hit_50x_at is not null then 50 else 0 end
      - case when path.hit_100x_at is not null then 10 else 0 end,
    peak_price_usd = case when p.entry_price_usd > 0 and path.peak_multiple > 0
      then greatest(coalesce(p.peak_price_usd, p.entry_price_usd), p.entry_price_usd * path.peak_multiple)
      else p.peak_price_usd end,
    position_status = case when path.hit_100x_at is not null then 'closed' else 'open' end,
    closed_at = path.hit_100x_at,
    exit_price_usd = case when path.hit_100x_at is not null and p.entry_price_usd is not null then p.entry_price_usd * 100 end,
    exit_market_cap_usd = case when path.hit_100x_at is not null and p.entry_market_cap_usd is not null then p.entry_market_cap_usd * 100 end,
    exit_reason = case when path.hit_100x_at is not null then 'target' end,
    updated_at = now()
from path
where path.token_address = p.token_address;

do $function_patch$
declare
  function_name regprocedure;
  definition text;
begin
  foreach function_name in array array[
    'public.build_ponseye_lab_dataset()'::regprocedure,
    'public.get_ponseye_full_funnel_dataset(integer,integer,numeric,integer,integer,numeric,boolean)'::regprocedure
  ] loop
    select pg_get_functiondef(function_name) into definition;
    if position('''pons-momentum-v6''' in definition) = 0 then
      definition := replace(
        definition,
        '''pons-momentum-v1'', ''pons-momentum-v2'', ''pons-momentum-v3'', ''pons-momentum-v4'', ''pons-momentum-v5''',
        '''pons-momentum-v1'', ''pons-momentum-v2'', ''pons-momentum-v3'', ''pons-momentum-v4'', ''pons-momentum-v5'', ''pons-momentum-v6'''
      );
      execute definition;
    end if;
  end loop;
end;
$function_patch$;

comment on function public.classify_launch_research_state() is
  'PonsEye v6 live funnel using the tested Strict score or Quiet Peak route at the first Surveillance checkpoint.';
comment on table public.acquired_positions is
  'Paper positions using $25 entries, no stop, and staged exits of 20% at 10x, 20% at 20x, 50% at 50x and 10% at 100x.';
