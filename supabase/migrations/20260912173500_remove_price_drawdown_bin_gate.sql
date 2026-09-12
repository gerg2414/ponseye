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
  passed_fast_flow_gate boolean := false;
begin
  if current_setting('ponseye.repair_mode', true) = 'on' then
    return new;
  end if;

  select l.launched_at into launch_time
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
    and evidence_time <= launch_time + interval '15 minutes'
    and evidence_time >= now() - interval '2 minutes'
    and new.price_usd is not null
    and new.price_usd * 1000000000::numeric >= 10000::numeric;

  passed_fast_flow_gate := passed_sighted_gate
    and new.price_usd * 1000000000::numeric >= 30000::numeric
    and new.trade_count >= 50
    and new.unique_traders >= 15
    and new.buys * 100 >= new.trade_count * 58
    and new.creator_sells = 0
    and new.first_minute_buyers >= 3
    and new.first_unit_price_raw > 0
    and new.last_unit_price_raw >= new.first_unit_price_raw * 1.20
    and new.peak_unit_price_raw > 0
    and new.last_unit_price_raw >= new.peak_unit_price_raw * 0.60;

  if prior_state = 'binned' then
    next_state := 'binned';
  elsif new.creator_sells > 0 then
    next_state := 'binned';
  elsif prior_state = 'target_locked' then
    next_state := 'target_locked';
  elsif passed_fast_flow_gate then
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
    new.research_rule_version := 'pons-momentum-v5';
  elsif tg_op = 'INSERT' then
    new.research_state := 'sighted';
    new.research_state_at := now();
    new.research_rule_version := 'pons-momentum-v5';
  end if;

  return new;
end;
$$;

revoke execute on function public.classify_launch_research_state()
  from public, anon, authenticated;
grant execute on function public.classify_launch_research_state()
  to service_role;

do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.get_ponseye_lab_dataset()'::regprocedure)
  into definition;

  if position('''pons-momentum-v5''' in definition) = 0 then
    definition := replace(
      definition,
      '''pons-momentum-v1'', ''pons-momentum-v2'', ''pons-momentum-v3'', ''pons-momentum-v4''',
      '''pons-momentum-v1'', ''pons-momentum-v2'', ''pons-momentum-v3'', ''pons-momentum-v4'', ''pons-momentum-v5'''
    );
    execute definition;
  end if;
end;
$$;

comment on function public.classify_launch_research_state() is
  'PonsEye v5 funnel. Price drawdown alone never bins a token; a confirmed creator sale is the terminal condition.';
