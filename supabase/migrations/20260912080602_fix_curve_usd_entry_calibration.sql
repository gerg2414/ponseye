create table if not exists public.pair_quote_usd_rates (
  pair_token_address text primary key,
  usd_factor numeric not null check (usd_factor > 0),
  observed_at timestamptz not null,
  source_token_address text not null,
  updated_at timestamptz not null default now()
);

alter table public.pair_quote_usd_rates enable row level security;
revoke all on table public.pair_quote_usd_rates from public, anon, authenticated;
grant select, insert, update, delete on table public.pair_quote_usd_rates to service_role;

insert into public.pair_quote_usd_rates (
  pair_token_address, usd_factor, observed_at, source_token_address
)
select distinct on (l.pair_token_address)
  l.pair_token_address,
  md.price_usd / md.price,
  md.block_time,
  md.token_address
from public.trade_market_data md
join public.launches l on l.token_address = md.token_address
where md.protocol = 'pons_v2'
  and md.price > 0
  and md.price_usd > 0
order by l.pair_token_address, md.block_time desc, md.market_event_id desc
on conflict (pair_token_address) do update set
  usd_factor = excluded.usd_factor,
  observed_at = excluded.observed_at,
  source_token_address = excluded.source_token_address,
  updated_at = now()
where excluded.observed_at >= public.pair_quote_usd_rates.observed_at;

create or replace function public.update_pair_quote_usd_rate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  launch_pair text;
begin
  if new.protocol is distinct from 'pons_v2'
    or new.price is null or new.price <= 0
    or new.price_usd is null or new.price_usd <= 0 then
    return new;
  end if;

  select l.pair_token_address into launch_pair
  from public.launches l
  where l.token_address = new.token_address;

  if launch_pair is null then
    return new;
  end if;

  insert into public.pair_quote_usd_rates (
    pair_token_address, usd_factor, observed_at, source_token_address
  ) values (
    launch_pair, new.price_usd / new.price, new.block_time, new.token_address
  )
  on conflict (pair_token_address) do update set
    usd_factor = excluded.usd_factor,
    observed_at = excluded.observed_at,
    source_token_address = excluded.source_token_address,
    updated_at = now()
  where excluded.observed_at >= public.pair_quote_usd_rates.observed_at;

  return new;
end;
$$;

drop trigger if exists market_trade_00_update_quote_rate on public.trade_market_data;
create trigger market_trade_00_update_quote_rate
after insert or update of price, price_usd on public.trade_market_data
for each row execute function public.update_pair_quote_usd_rate();

revoke execute on function public.update_pair_quote_usd_rate()
  from public, anon, authenticated;
grant execute on function public.update_pair_quote_usd_rate()
  to service_role;

create or replace function public.get_pair_quote_usd_factor(p_token_address text)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select r.usd_factor
  from public.launches l
  join public.pair_quote_usd_rates r
    on r.pair_token_address is not distinct from l.pair_token_address
  where l.token_address = lower(p_token_address);
$$;

revoke execute on function public.get_pair_quote_usd_factor(text)
  from public, anon, authenticated;
grant execute on function public.get_pair_quote_usd_factor(text)
  to service_role;

create or replace function public.apply_curve_usd_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  quote_usd_factor numeric;
begin
  if new.last_unit_price_raw is null then
    return new;
  end if;

  if new.usd_price_at is not null
    and new.usd_price_at >= new.last_trade_at then
    return new;
  end if;

  quote_usd_factor := public.get_pair_quote_usd_factor(new.token_address);
  if quote_usd_factor is null then
    return new;
  end if;

  new.price_usd := new.last_unit_price_raw * quote_usd_factor;
  new.peak_price_usd := case
    when new.peak_unit_price_raw > 0 then new.peak_unit_price_raw * quote_usd_factor
    else null
  end;
  new.volume_usd := coalesce(new.volume_quote_raw, 0)
    * quote_usd_factor / 1000000000000000000::numeric;
  new.usd_price_at := new.last_trade_at;

  return new;
end;
$$;

revoke execute on function public.apply_curve_usd_metrics()
  from public, anon, authenticated;
grant execute on function public.apply_curve_usd_metrics()
  to service_role;

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
  elsif new.creator_sells > 0
    and current_peak_hold is not null
    and current_peak_hold <= 0.50 then
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
    new.research_rule_version := 'pons-momentum-v4';
  elsif tg_op = 'INSERT' then
    new.research_state := 'sighted';
    new.research_state_at := now();
    new.research_rule_version := 'pons-momentum-v4';
  end if;

  return new;
end;
$$;

revoke execute on function public.classify_launch_research_state()
  from public, anon, authenticated;
grant execute on function public.classify_launch_research_state()
  to service_role;

create or replace view public.launch_board
with (security_invoker = true)
as
select
  l.token_address, l.curve_address, l.name, l.symbol, l.image_url,
  l.deployer_address, l.pair_token_address, l.status, l.launched_at,
  l.swept_at, l.graduated_at,
  coalesce(m.trade_count, 0) as trade_count,
  coalesce(m.buys, 0) as buys,
  coalesce(m.sells, 0) as sells,
  coalesce(m.unique_traders, 0) as unique_traders,
  greatest(coalesce(m.net_quote_raw, 0), 0) as net_quote_raw,
  m.last_trade_at,
  coalesce(l.graduation_threshold_raw,
    case when l.pair_token_address = '0x0000000000000000000000000000000000000000'
      then 4200000000000000000::numeric else null end
  ) as graduation_threshold_raw,
  case
    when coalesce(l.graduation_threshold_raw,
      case when l.pair_token_address = '0x0000000000000000000000000000000000000000'
        then 4200000000000000000::numeric else null end) > 0
      then least(100::numeric, round(
        greatest(coalesce(m.net_quote_raw, 0), 0) * 100
          / coalesce(l.graduation_threshold_raw, 4200000000000000000::numeric), 1))
    else null
  end as progress_pct,
  coalesce(m.volume_quote_raw, 0) as volume_quote_raw,
  m.last_quote_amount_raw::numeric(78, 0) as last_quote_amount_raw,
  m.last_token_amount_raw::numeric(78, 0) as last_token_amount_raw,
  case when m.first_unit_price_raw > 0
    then round(m.peak_unit_price_raw / m.first_unit_price_raw, 2) else null end as peak_multiple,
  case when m.peak_unit_price_raw > 0 and m.last_unit_price_raw is not null
    then round(greatest(0::numeric, (1 - m.last_unit_price_raw / m.peak_unit_price_raw) * 100), 1)
    else null end as drawdown_from_peak_pct,
  case when m.trade_count > 0
    then round(m.buys::numeric * 100 / m.trade_count, 1) else null end as buy_pressure_pct,
  coalesce(m.creator_trades, 0) as creator_trades,
  coalesce(m.creator_sells, 0) as creator_sells,
  coalesce(m.first_minute_buyers, 0) as first_minute_buyers,
  m.largest_buy_quote_raw, m.holder_snapshot_at, m.holder_count,
  m.holder_change_5m, m.largest_holder_pct, m.top_10_holder_pct,
  m.top_100_holder_pct, m.creator_balance_pct,
  coalesce(m.price_usd, m.last_unit_price_raw * q.usd_factor) as price_usd,
  coalesce(m.volume_usd, 0) as volume_usd,
  case when coalesce(m.price_usd, m.last_unit_price_raw * q.usd_factor) > 0
    then coalesce(m.price_usd, m.last_unit_price_raw * q.usd_factor) * 1000000000::numeric
    else null end as market_cap_usd,
  case when coalesce(m.peak_price_usd, m.peak_unit_price_raw * q.usd_factor) > 0
    then coalesce(m.peak_price_usd, m.peak_unit_price_raw * q.usd_factor) * 1000000000::numeric
    else null end as ath_market_cap_usd,
  coalesce(m.usd_price_at, m.last_trade_at) as usd_price_at
from public.launches l
left join public.launch_metrics m on m.token_address = l.token_address
left join lateral (
  select public.get_pair_quote_usd_factor(l.token_address) as usd_factor
) q on true;

revoke all on table public.launch_board from public, anon, authenticated;
grant select on table public.launch_board to service_role;

create temporary table invalid_curve_promotions on commit drop as
select e.token_address
from public.research_events e
join public.launches l on l.token_address = e.token_address
cross join lateral (
  select public.get_pair_quote_usd_factor(e.token_address) factor
) q
where e.stage = 'target_locked'
  and e.rule_version = 'pons-momentum-v4'
  and e.observed_at >= timestamptz '2026-09-12 01:35:00+00'
  and (
    e.observed_at > l.launched_at + interval '15 minutes'
    or
    (
      q.factor > 0
      and nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric > 0
      and (
        (e.metrics_snapshot ->> 'entry_lane' = 'fast_flow'
          and nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric
            * q.factor * 1000000000::numeric < 30000)
        or
        (e.metrics_snapshot ->> 'entry_lane' = 'full_evidence'
          and nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric
            * q.factor * 1000000000::numeric < 10000)
      )
    )
  );

delete from public.acquired_positions p
using invalid_curve_promotions i
where p.token_address = i.token_address;

delete from public.research_events e
using invalid_curve_promotions i
where e.token_address = i.token_address
  and e.stage = 'target_locked'
  and e.rule_version = 'pons-momentum-v4';

set local ponseye.repair_mode = 'on';
update public.launch_metrics m
set research_state = 'sighted',
    research_state_at = now(),
    updated_at = now()
from invalid_curve_promotions i
where m.token_address = i.token_address
  and m.research_state = 'target_locked';

with corrected as (
  select e.token_address,
    nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric as entry_raw,
    nullif(e.metrics_snapshot ->> 'peak_unit_price_raw', '')::numeric as peak_raw,
    public.get_pair_quote_usd_factor(e.token_address) as factor
  from public.research_events e
  where e.stage = 'target_locked'
    and e.rule_version = 'pons-momentum-v4'
    and e.observed_at >= timestamptz '2026-09-12 01:35:00+00'
)
update public.acquired_positions p
set entry_price_usd = c.entry_raw * c.factor,
    entry_market_cap_usd = c.entry_raw * c.factor * 1000000000::numeric,
    peak_price_usd = greatest(c.entry_raw, coalesce(c.peak_raw, c.entry_raw)) * c.factor,
    updated_at = now()
from corrected c
where p.token_address = c.token_address
  and c.entry_raw > 0
  and c.factor > 0;

with corrected as (
  select e.token_address,
    public.get_pair_quote_usd_factor(e.token_address) factor
  from public.research_events e
  where e.stage = 'target_locked'
    and e.rule_version = 'pons-momentum-v4'
    and e.observed_at >= timestamptz '2026-09-12 01:35:00+00'
)
update public.research_events e
set metrics_snapshot = e.metrics_snapshot || jsonb_build_object(
  'price_usd', nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric * c.factor,
  'market_cap_usd', nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric * c.factor * 1000000000::numeric,
  'peak_price_usd', nullif(e.metrics_snapshot ->> 'peak_unit_price_raw', '')::numeric * c.factor,
  'price_calibration', 'pair_quote_direct'
)
from corrected c
where e.token_address = c.token_address
  and e.stage = 'target_locked'
  and e.rule_version = 'pons-momentum-v4'
  and c.factor > 0;

with factors as (
  select l.token_address, public.get_pair_quote_usd_factor(l.token_address) factor
  from public.launches l
  where l.graduated_at is null
), market_peaks as (
  select md.token_address, max(md.price_usd) peak_price
  from public.trade_market_data md
  where md.protocol = 'pons_v2' and md.price_usd > 0
  group by md.token_address
)
update public.launch_metrics m
set price_usd = case
      when m.usd_price_at is null or m.last_trade_at >= m.usd_price_at
        then m.last_unit_price_raw * f.factor
      else m.price_usd
    end,
    peak_price_usd = greatest(
      m.peak_unit_price_raw * f.factor,
      coalesce(mp.peak_price, 0)
    ),
    usd_price_at = greatest(m.usd_price_at, m.last_trade_at),
    updated_at = now()
from factors f
left join market_peaks mp on mp.token_address = f.token_address
where m.token_address = f.token_address
  and f.factor > 0
  and m.last_unit_price_raw > 0;

comment on function public.get_pair_quote_usd_factor(text) is
  'Returns the latest direct quote-token USD conversion cached for the launch pair.';
comment on function public.apply_curve_usd_metrics() is
  'Prices raw curve metrics using direct quote-token USD rates and never a mismatched token price ratio.';
comment on function public.classify_launch_research_state() is
  'PonsEye v4 funnel with correct curve USD pricing, fresh evidence, and a 15-minute maximum entry age.';
