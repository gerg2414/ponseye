create table public.launch_metrics (
  token_address text primary key references public.launches(token_address) on delete cascade,
  trade_count integer not null default 0,
  buys integer not null default 0,
  sells integer not null default 0,
  unique_traders integer not null default 0,
  net_quote_raw numeric not null default 0,
  volume_quote_raw numeric not null default 0,
  first_trade_at timestamptz,
  last_trade_at timestamptz,
  first_unit_price_raw numeric,
  peak_unit_price_raw numeric,
  last_unit_price_raw numeric,
  last_quote_amount_raw numeric,
  last_token_amount_raw numeric,
  creator_trades integer not null default 0,
  creator_sells integer not null default 0,
  first_minute_buyers integer not null default 0,
  largest_buy_quote_raw numeric,
  holder_snapshot_at timestamptz,
  holder_count integer,
  holder_change_5m integer,
  largest_holder_pct numeric,
  top_10_holder_pct numeric,
  top_100_holder_pct numeric,
  creator_balance_pct numeric,
  price_usd numeric,
  volume_usd numeric not null default 0,
  peak_price_usd numeric,
  usd_price_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.launch_metric_traders (
  token_address text not null references public.launches(token_address) on delete cascade,
  trader_address text not null,
  first_minute_buyer boolean not null default false,
  primary key (token_address, trader_address)
);

create function public.ensure_launch_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.launch_metrics (token_address)
  values (new.token_address)
  on conflict (token_address) do nothing;
  return new;
end;
$$;

create function public.update_launch_trade_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  launch_deployer text;
  launch_time timestamptz;
  unit_price numeric;
  trader_total integer := 0;
  early_buyer_total integer := 0;
  is_early_buyer boolean := false;
begin
  select l.deployer_address, l.launched_at
  into launch_deployer, launch_time
  from public.launches l
  where l.token_address = new.token_address;

  if new.token_amount_raw > 0 then
    unit_price := new.quote_amount_raw / new.token_amount_raw;
  end if;

  if new.trader_address is not null then
    is_early_buyer := new.side = 'buy' and new.block_time <= launch_time + interval '1 minute';

    insert into public.launch_metric_traders (token_address, trader_address, first_minute_buyer)
    values (new.token_address, new.trader_address, is_early_buyer)
    on conflict (token_address, trader_address) do update
    set first_minute_buyer = public.launch_metric_traders.first_minute_buyer or excluded.first_minute_buyer;

    select count(*)::integer,
           count(*) filter (where t.first_minute_buyer)::integer
    into trader_total, early_buyer_total
    from public.launch_metric_traders t
    where t.token_address = new.token_address;
  end if;

  insert into public.launch_metrics (
    token_address, trade_count, buys, sells, unique_traders,
    net_quote_raw, volume_quote_raw, first_trade_at, last_trade_at,
    first_unit_price_raw, peak_unit_price_raw, last_unit_price_raw,
    last_quote_amount_raw, last_token_amount_raw, creator_trades,
    creator_sells, first_minute_buyers, largest_buy_quote_raw
  ) values (
    new.token_address, 1,
    case when new.side = 'buy' then 1 else 0 end,
    case when new.side = 'sell' then 1 else 0 end,
    trader_total,
    case when new.side = 'buy' then new.quote_amount_raw else -new.quote_amount_raw end,
    new.quote_amount_raw, new.block_time, new.block_time,
    unit_price, unit_price, unit_price,
    new.quote_amount_raw, new.token_amount_raw,
    case when new.trader_address = launch_deployer then 1 else 0 end,
    case when new.side = 'sell' and new.trader_address = launch_deployer then 1 else 0 end,
    early_buyer_total,
    case when new.side = 'buy' then new.quote_amount_raw else null end
  )
  on conflict (token_address) do update set
    trade_count = public.launch_metrics.trade_count + 1,
    buys = public.launch_metrics.buys + case when new.side = 'buy' then 1 else 0 end,
    sells = public.launch_metrics.sells + case when new.side = 'sell' then 1 else 0 end,
    unique_traders = greatest(public.launch_metrics.unique_traders, trader_total),
    net_quote_raw = public.launch_metrics.net_quote_raw + case when new.side = 'buy' then new.quote_amount_raw else -new.quote_amount_raw end,
    volume_quote_raw = public.launch_metrics.volume_quote_raw + new.quote_amount_raw,
    first_trade_at = least(public.launch_metrics.first_trade_at, new.block_time),
    last_trade_at = greatest(public.launch_metrics.last_trade_at, new.block_time),
    first_unit_price_raw = case
      when public.launch_metrics.first_trade_at is null or new.block_time < public.launch_metrics.first_trade_at then unit_price
      else public.launch_metrics.first_unit_price_raw
    end,
    peak_unit_price_raw = greatest(public.launch_metrics.peak_unit_price_raw, unit_price),
    last_unit_price_raw = case when public.launch_metrics.last_trade_at is null or new.block_time >= public.launch_metrics.last_trade_at then unit_price else public.launch_metrics.last_unit_price_raw end,
    last_quote_amount_raw = case when public.launch_metrics.last_trade_at is null or new.block_time >= public.launch_metrics.last_trade_at then new.quote_amount_raw else public.launch_metrics.last_quote_amount_raw end,
    last_token_amount_raw = case when public.launch_metrics.last_trade_at is null or new.block_time >= public.launch_metrics.last_trade_at then new.token_amount_raw else public.launch_metrics.last_token_amount_raw end,
    creator_trades = public.launch_metrics.creator_trades + case when new.trader_address = launch_deployer then 1 else 0 end,
    creator_sells = public.launch_metrics.creator_sells + case when new.side = 'sell' and new.trader_address = launch_deployer then 1 else 0 end,
    first_minute_buyers = greatest(public.launch_metrics.first_minute_buyers, early_buyer_total),
    largest_buy_quote_raw = case when new.side = 'buy' then greatest(public.launch_metrics.largest_buy_quote_raw, new.quote_amount_raw) else public.launch_metrics.largest_buy_quote_raw end,
    updated_at = now();

  return new;
end;
$$;

create function public.update_launch_market_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.launch_metrics (
    token_address, price_usd, volume_usd, peak_price_usd, usd_price_at
  ) values (
    new.token_address, new.price_usd, coalesce(new.quote_amount_usd, 0),
    case when new.price_usd > 0 then new.price_usd else null end, new.block_time
  )
  on conflict (token_address) do update set
    price_usd = case when public.launch_metrics.usd_price_at is null or new.block_time >= public.launch_metrics.usd_price_at then new.price_usd else public.launch_metrics.price_usd end,
    volume_usd = public.launch_metrics.volume_usd + coalesce(new.quote_amount_usd, 0),
    peak_price_usd = greatest(public.launch_metrics.peak_price_usd, case when new.price_usd > 0 then new.price_usd else null end),
    usd_price_at = greatest(public.launch_metrics.usd_price_at, new.block_time),
    updated_at = now();
  return new;
end;
$$;

create function public.update_launch_holder_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior_holder_count integer;
begin
  select h.holder_count
  into prior_holder_count
  from public.holder_snapshots h
  where h.token_address = new.token_address
    and h.observed_at <= new.observed_at - interval '5 minutes'
  order by h.observed_at desc
  limit 1;

  insert into public.launch_metrics (
    token_address, holder_snapshot_at, holder_count, holder_change_5m,
    largest_holder_pct, top_10_holder_pct, top_100_holder_pct, creator_balance_pct
  ) values (
    new.token_address, new.observed_at, new.holder_count,
    case when prior_holder_count is null then null else new.holder_count - prior_holder_count end,
    new.largest_holder_pct, new.top_10_holder_pct, new.top_100_holder_pct, new.creator_balance_pct
  )
  on conflict (token_address) do update set
    holder_snapshot_at = case when public.launch_metrics.holder_snapshot_at is null or new.observed_at >= public.launch_metrics.holder_snapshot_at then new.observed_at else public.launch_metrics.holder_snapshot_at end,
    holder_count = case when public.launch_metrics.holder_snapshot_at is null or new.observed_at >= public.launch_metrics.holder_snapshot_at then new.holder_count else public.launch_metrics.holder_count end,
    holder_change_5m = case when public.launch_metrics.holder_snapshot_at is null or new.observed_at >= public.launch_metrics.holder_snapshot_at then case when prior_holder_count is null then null else new.holder_count - prior_holder_count end else public.launch_metrics.holder_change_5m end,
    largest_holder_pct = case when public.launch_metrics.holder_snapshot_at is null or new.observed_at >= public.launch_metrics.holder_snapshot_at then new.largest_holder_pct else public.launch_metrics.largest_holder_pct end,
    top_10_holder_pct = case when public.launch_metrics.holder_snapshot_at is null or new.observed_at >= public.launch_metrics.holder_snapshot_at then new.top_10_holder_pct else public.launch_metrics.top_10_holder_pct end,
    top_100_holder_pct = case when public.launch_metrics.holder_snapshot_at is null or new.observed_at >= public.launch_metrics.holder_snapshot_at then new.top_100_holder_pct else public.launch_metrics.top_100_holder_pct end,
    creator_balance_pct = case when public.launch_metrics.holder_snapshot_at is null or new.observed_at >= public.launch_metrics.holder_snapshot_at then new.creator_balance_pct else public.launch_metrics.creator_balance_pct end,
    updated_at = now();
  return new;
end;
$$;

create trigger launches_ensure_metrics
after insert on public.launches
for each row execute function public.ensure_launch_metrics();

create trigger trades_update_launch_metrics
after insert on public.trades
for each row execute function public.update_launch_trade_metrics();

create trigger market_trades_update_launch_metrics
after insert on public.trade_market_data
for each row execute function public.update_launch_market_metrics();

create trigger holder_snapshots_update_launch_metrics
after insert on public.holder_snapshots
for each row execute function public.update_launch_holder_metrics();

insert into public.launch_metrics (token_address)
select token_address from public.launches
on conflict (token_address) do nothing;

insert into public.launch_metric_traders (token_address, trader_address, first_minute_buyer)
select
  t.token_address,
  t.trader_address,
  bool_or(t.side = 'buy' and t.block_time <= l.launched_at + interval '1 minute')
from public.trades t
join public.launches l on l.token_address = t.token_address
where t.token_address is not null and t.trader_address is not null
group by t.token_address, t.trader_address
on conflict (token_address, trader_address) do update
set first_minute_buyer = excluded.first_minute_buyer;

with trade_totals as (
  select
    t.token_address,
    count(*)::integer as trade_count,
    count(*) filter (where t.side = 'buy')::integer as buys,
    count(*) filter (where t.side = 'sell')::integer as sells,
    count(distinct t.trader_address)::integer as unique_traders,
    sum(case when t.side = 'buy' then t.quote_amount_raw else -t.quote_amount_raw end) as net_quote_raw,
    sum(t.quote_amount_raw) as volume_quote_raw,
    min(t.block_time) as first_trade_at,
    max(t.block_time) as last_trade_at,
    max(case when t.token_amount_raw > 0 then t.quote_amount_raw / t.token_amount_raw end) as peak_unit_price_raw,
    count(*) filter (where t.trader_address = l.deployer_address)::integer as creator_trades,
    count(*) filter (where t.side = 'sell' and t.trader_address = l.deployer_address)::integer as creator_sells,
    count(distinct t.trader_address) filter (where t.side = 'buy' and t.block_time <= l.launched_at + interval '1 minute')::integer as first_minute_buyers,
    max(t.quote_amount_raw) filter (where t.side = 'buy') as largest_buy_quote_raw
  from public.trades t
  join public.launches l on l.token_address = t.token_address
  where t.token_address is not null
  group by t.token_address
),
first_trades as (
  select distinct on (t.token_address)
    t.token_address,
    t.quote_amount_raw / t.token_amount_raw as first_unit_price_raw
  from public.trades t
  where t.token_address is not null and t.token_amount_raw > 0
  order by t.token_address, t.block_time, t.recorded_at, t.event_id
),
latest_trades as (
  select distinct on (t.token_address)
    t.token_address,
    t.quote_amount_raw / t.token_amount_raw as last_unit_price_raw,
    t.quote_amount_raw as last_quote_amount_raw,
    t.token_amount_raw as last_token_amount_raw
  from public.trades t
  where t.token_address is not null and t.token_amount_raw > 0
  order by t.token_address, t.block_time desc, t.recorded_at desc, t.event_id desc
)
update public.launch_metrics m set
  trade_count = t.trade_count,
  buys = t.buys,
  sells = t.sells,
  unique_traders = t.unique_traders,
  net_quote_raw = t.net_quote_raw,
  volume_quote_raw = t.volume_quote_raw,
  first_trade_at = t.first_trade_at,
  last_trade_at = t.last_trade_at,
  first_unit_price_raw = f.first_unit_price_raw,
  peak_unit_price_raw = t.peak_unit_price_raw,
  last_unit_price_raw = lt.last_unit_price_raw,
  last_quote_amount_raw = lt.last_quote_amount_raw,
  last_token_amount_raw = lt.last_token_amount_raw,
  creator_trades = t.creator_trades,
  creator_sells = t.creator_sells,
  first_minute_buyers = t.first_minute_buyers,
  largest_buy_quote_raw = t.largest_buy_quote_raw,
  updated_at = now()
from trade_totals t
left join first_trades f on f.token_address = t.token_address
left join latest_trades lt on lt.token_address = t.token_address
where m.token_address = t.token_address;

with market_totals as (
  select
    token_address,
    sum(coalesce(quote_amount_usd, 0)) as volume_usd,
    max(price_usd) filter (where price_usd > 0) as peak_price_usd
  from public.trade_market_data
  group by token_address
),
latest_market as (
  select distinct on (token_address)
    token_address, price_usd, block_time
  from public.trade_market_data
  where price_usd > 0
  order by token_address, block_time desc, recorded_at desc, market_event_id desc
)
update public.launch_metrics m set
  price_usd = lm.price_usd,
  volume_usd = mt.volume_usd,
  peak_price_usd = mt.peak_price_usd,
  usd_price_at = lm.block_time,
  updated_at = now()
from market_totals mt
left join latest_market lm on lm.token_address = mt.token_address
where m.token_address = mt.token_address;

with latest_holders as (
  select distinct on (token_address)
    token_address, observed_at, holder_count, largest_holder_pct,
    top_10_holder_pct, top_100_holder_pct, creator_balance_pct
  from public.holder_snapshots
  order by token_address, observed_at desc
),
holder_values as (
  select h.*,
    p.holder_count as prior_holder_count
  from latest_holders h
  left join lateral (
    select hs.holder_count
    from public.holder_snapshots hs
    where hs.token_address = h.token_address
      and hs.observed_at <= h.observed_at - interval '5 minutes'
    order by hs.observed_at desc
    limit 1
  ) p on true
)
update public.launch_metrics m set
  holder_snapshot_at = h.observed_at,
  holder_count = h.holder_count,
  holder_change_5m = case when h.prior_holder_count is null then null else h.holder_count - h.prior_holder_count end,
  largest_holder_pct = h.largest_holder_pct,
  top_10_holder_pct = h.top_10_holder_pct,
  top_100_holder_pct = h.top_100_holder_pct,
  creator_balance_pct = h.creator_balance_pct,
  updated_at = now()
from holder_values h
where m.token_address = h.token_address;

create or replace view public.launch_board
with (security_invoker = true)
as
select
  l.token_address,
  l.curve_address,
  l.name,
  l.symbol,
  l.image_url,
  l.deployer_address,
  l.pair_token_address,
  l.status,
  l.launched_at,
  l.swept_at,
  l.graduated_at,
  coalesce(m.trade_count, 0) as trade_count,
  coalesce(m.buys, 0) as buys,
  coalesce(m.sells, 0) as sells,
  coalesce(m.unique_traders, 0) as unique_traders,
  greatest(coalesce(m.net_quote_raw, 0), 0) as net_quote_raw,
  m.last_trade_at,
  coalesce(
    l.graduation_threshold_raw,
    case when l.pair_token_address = '0x0000000000000000000000000000000000000000'
      then 4200000000000000000::numeric else null end
  ) as graduation_threshold_raw,
  case
    when coalesce(l.graduation_threshold_raw, case when l.pair_token_address = '0x0000000000000000000000000000000000000000' then 4200000000000000000::numeric else null end) > 0
      then least(100::numeric, round((greatest(coalesce(m.net_quote_raw, 0), 0) * 100) / coalesce(l.graduation_threshold_raw, 4200000000000000000::numeric), 1))
    else null
  end as progress_pct,
  coalesce(m.volume_quote_raw, 0) as volume_quote_raw,
  m.last_quote_amount_raw::numeric(78, 0) as last_quote_amount_raw,
  m.last_token_amount_raw::numeric(78, 0) as last_token_amount_raw,
  case when m.first_unit_price_raw > 0 then round(m.peak_unit_price_raw / m.first_unit_price_raw, 2) else null end as peak_multiple,
  case when m.peak_unit_price_raw > 0 and m.last_unit_price_raw is not null
    then round(greatest(0::numeric, (1 - m.last_unit_price_raw / m.peak_unit_price_raw) * 100), 1) else null end as drawdown_from_peak_pct,
  case when m.trade_count > 0 then round((m.buys::numeric * 100) / m.trade_count, 1) else null end as buy_pressure_pct,
  coalesce(m.creator_trades, 0) as creator_trades,
  coalesce(m.creator_sells, 0) as creator_sells,
  coalesce(m.first_minute_buyers, 0) as first_minute_buyers,
  m.largest_buy_quote_raw,
  m.holder_snapshot_at,
  m.holder_count,
  m.holder_change_5m,
  m.largest_holder_pct,
  m.top_10_holder_pct,
  m.top_100_holder_pct,
  m.creator_balance_pct,
  m.price_usd,
  coalesce(m.volume_usd, 0) as volume_usd,
  case when m.price_usd > 0 then m.price_usd * 1000000000::numeric else null end as market_cap_usd,
  case when m.peak_price_usd > 0 then m.peak_price_usd * 1000000000::numeric else null end as ath_market_cap_usd,
  m.usd_price_at
from public.launches l
left join public.launch_metrics m on m.token_address = l.token_address;

alter table public.launch_metrics enable row level security;
alter table public.launch_metric_traders enable row level security;

revoke all on table public.launch_metrics from public, anon, authenticated;
revoke all on table public.launch_metric_traders from public, anon, authenticated;
grant select, insert, update, delete on table public.launch_metrics to service_role;
grant select, insert, update, delete on table public.launch_metric_traders to service_role;

revoke execute on function public.ensure_launch_metrics() from public, anon, authenticated;
revoke execute on function public.update_launch_trade_metrics() from public, anon, authenticated;
revoke execute on function public.update_launch_market_metrics() from public, anon, authenticated;
revoke execute on function public.update_launch_holder_metrics() from public, anon, authenticated;
grant execute on function public.ensure_launch_metrics() to service_role;
grant execute on function public.update_launch_trade_metrics() to service_role;
grant execute on function public.update_launch_market_metrics() to service_role;
grant execute on function public.update_launch_holder_metrics() to service_role;

revoke all on table public.launch_board from public, anon, authenticated;
grant select on table public.launch_board to service_role;

comment on table public.launch_metrics is
  'Incremental per-token metrics used by the live PonsEye dashboard.';

comment on table public.launch_metric_traders is
  'Distinct traders used to maintain exact live trader counts without rescanning trade history.';
