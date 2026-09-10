create table public.holder_snapshots (
  id bigint generated always as identity primary key,
  token_address text not null references public.launches(token_address) on delete cascade,
  observed_at timestamptz not null default now(),
  holder_count integer not null check (holder_count >= 0),
  total_holder_balance numeric,
  largest_holder_pct numeric,
  top_10_holder_pct numeric,
  top_100_holder_pct numeric,
  creator_balance_pct numeric,
  raw_metrics jsonb not null default '{}'::jsonb,
  unique (token_address, observed_at)
);

create index holder_snapshots_token_time_idx
  on public.holder_snapshots (token_address, observed_at desc);

create table public.token_holder_positions (
  token_address text not null references public.launches(token_address) on delete cascade,
  holder_address text not null,
  balance numeric not null check (balance > 0),
  balance_pct numeric,
  holder_rank integer not null check (holder_rank between 1 and 100),
  first_change_at timestamptz,
  last_change_at timestamptz,
  update_count integer,
  refreshed_at timestamptz not null,
  primary key (token_address, holder_address),
  constraint token_holder_positions_address_format
    check (holder_address ~ '^0x[0-9a-f]{40}$')
);

create index token_holder_positions_wallet_idx
  on public.token_holder_positions (holder_address, token_address);

create index token_holder_positions_rank_idx
  on public.token_holder_positions (token_address, holder_rank);

create table public.trade_market_data (
  market_event_id text primary key,
  token_address text not null references public.launches(token_address) on delete cascade,
  transaction_hash text not null,
  block_time timestamptz not null,
  side text not null check (side in ('buy', 'sell')),
  trader_address text,
  price numeric,
  price_usd numeric,
  base_amount numeric,
  quote_amount numeric,
  base_amount_usd numeric,
  quote_amount_usd numeric,
  quote_token_address text,
  quote_symbol text,
  protocol text,
  raw_trade jsonb not null,
  recorded_at timestamptz not null default now()
);

create index trade_market_data_token_time_idx
  on public.trade_market_data (token_address, block_time desc);

create index trade_market_data_transaction_idx
  on public.trade_market_data (transaction_hash);

alter table public.holder_snapshots enable row level security;
alter table public.token_holder_positions enable row level security;
alter table public.trade_market_data enable row level security;

revoke all on table public.holder_snapshots from public, anon, authenticated;
revoke all on table public.token_holder_positions from public, anon, authenticated;
revoke all on table public.trade_market_data from public, anon, authenticated;
grant select, insert, update, delete on table public.holder_snapshots to service_role;
grant select, insert, update, delete on table public.token_holder_positions to service_role;
grant select, insert, update, delete on table public.trade_market_data to service_role;
grant usage, select on sequence public.holder_snapshots_id_seq to service_role;

create or replace view public.launch_board
with (security_invoker = true)
as
with priced_trades as (
  select
    t.*,
    l.deployer_address,
    l.launched_at,
    case when t.token_amount_raw > 0
      then t.quote_amount_raw / t.token_amount_raw
      else null
    end as unit_price_raw
  from public.trades t
  join public.launches l on l.token_address = t.token_address
  where t.token_address is not null
),
trade_totals as (
  select
    curve_address,
    count(*)::integer as trade_count,
    count(*) filter (where side = 'buy')::integer as buys,
    count(*) filter (where side = 'sell')::integer as sells,
    count(distinct trader_address)::integer as unique_traders,
    sum(case when side = 'buy' then quote_amount_raw else -quote_amount_raw end) as net_quote_raw,
    sum(quote_amount_raw) as volume_quote_raw,
    max(block_time) as last_trade_at,
    max(unit_price_raw) as peak_unit_price_raw,
    max(quote_amount_raw) filter (where side = 'buy') as largest_buy_quote_raw,
    count(*) filter (where trader_address = deployer_address)::integer as creator_trades,
    count(*) filter (where side = 'sell' and trader_address = deployer_address)::integer as creator_sells,
    count(distinct trader_address) filter (
      where side = 'buy' and block_time <= launched_at + interval '1 minute'
    )::integer as first_minute_buyers
  from priced_trades
  group by curve_address
),
first_trades as (
  select distinct on (curve_address)
    curve_address,
    unit_price_raw as first_unit_price_raw
  from priced_trades
  where unit_price_raw > 0
  order by curve_address, block_time, recorded_at, event_id
),
latest_trades as (
  select distinct on (curve_address)
    curve_address,
    quote_amount_raw as last_quote_amount_raw,
    token_amount_raw as last_token_amount_raw,
    unit_price_raw as last_unit_price_raw
  from priced_trades
  where unit_price_raw > 0
  order by curve_address, block_time desc, recorded_at desc, event_id desc
),
latest_holders as (
  select distinct on (token_address)
    token_address,
    observed_at,
    holder_count,
    largest_holder_pct,
    top_10_holder_pct,
    top_100_holder_pct,
    creator_balance_pct
  from public.holder_snapshots
  order by token_address, observed_at desc
),
market_totals as (
  select
    token_address,
    sum(coalesce(quote_amount_usd, 0)) as volume_usd,
    max(price_usd) filter (where price_usd > 0) as peak_price_usd
  from public.trade_market_data
  group by token_address
),
latest_market as (
  select distinct on (token_address)
    token_address,
    price_usd,
    block_time
  from public.trade_market_data
  where price_usd > 0
  order by token_address, block_time desc, recorded_at desc, market_event_id desc
),
enriched as (
  select
    l.*,
    coalesce(t.trade_count, 0) as trade_count,
    coalesce(t.buys, 0) as buys,
    coalesce(t.sells, 0) as sells,
    coalesce(t.unique_traders, 0) as unique_traders,
    greatest(coalesce(t.net_quote_raw, 0), 0) as net_quote_raw,
    t.last_trade_at,
    coalesce(
      l.graduation_threshold_raw,
      case
        when l.pair_token_address = '0x0000000000000000000000000000000000000000'
          then 4200000000000000000::numeric
        else null
      end
    ) as resolved_graduation_threshold_raw,
    coalesce(t.volume_quote_raw, 0) as volume_quote_raw,
    lt.last_quote_amount_raw,
    lt.last_token_amount_raw,
    case when ft.first_unit_price_raw > 0
      then round(t.peak_unit_price_raw / ft.first_unit_price_raw, 2)
      else null
    end as peak_multiple,
    case when t.peak_unit_price_raw > 0 and lt.last_unit_price_raw is not null
      then round(greatest(0::numeric, (1 - lt.last_unit_price_raw / t.peak_unit_price_raw) * 100), 1)
      else null
    end as drawdown_from_peak_pct,
    case when t.trade_count > 0
      then round((t.buys::numeric * 100) / t.trade_count, 1)
      else null
    end as buy_pressure_pct,
    coalesce(t.creator_trades, 0) as creator_trades,
    coalesce(t.creator_sells, 0) as creator_sells,
    coalesce(t.first_minute_buyers, 0) as first_minute_buyers,
    t.largest_buy_quote_raw,
    h.observed_at as holder_snapshot_at,
    h.holder_count,
    h.largest_holder_pct,
    h.top_10_holder_pct,
    h.top_100_holder_pct,
    h.creator_balance_pct,
    prior_h.holder_count as holder_count_5m_ago,
    lm.price_usd,
    coalesce(mt.volume_usd, 0) as volume_usd,
    case when lm.price_usd > 0 then lm.price_usd * 1000000000::numeric else null end as market_cap_usd,
    case when mt.peak_price_usd > 0 then mt.peak_price_usd * 1000000000::numeric else null end as ath_market_cap_usd,
    lm.block_time as usd_price_at
  from public.launches l
  left join trade_totals t on t.curve_address = l.curve_address
  left join first_trades ft on ft.curve_address = l.curve_address
  left join latest_trades lt on lt.curve_address = l.curve_address
  left join latest_holders h on h.token_address = l.token_address
  left join market_totals mt on mt.token_address = l.token_address
  left join latest_market lm on lm.token_address = l.token_address
  left join lateral (
    select hs.holder_count
    from public.holder_snapshots hs
    where hs.token_address = l.token_address
      and h.observed_at is not null
      and hs.observed_at <= h.observed_at - interval '5 minutes'
    order by hs.observed_at desc
    limit 1
  ) prior_h on true
)
select
  token_address,
  curve_address,
  name,
  symbol,
  image_url,
  deployer_address,
  pair_token_address,
  status,
  launched_at,
  swept_at,
  graduated_at,
  trade_count,
  buys,
  sells,
  unique_traders,
  net_quote_raw,
  last_trade_at,
  resolved_graduation_threshold_raw as graduation_threshold_raw,
  case
    when resolved_graduation_threshold_raw > 0 then
      least(100::numeric, round((net_quote_raw * 100) / resolved_graduation_threshold_raw, 1))
    else null
  end as progress_pct,
  volume_quote_raw,
  last_quote_amount_raw,
  last_token_amount_raw,
  peak_multiple,
  drawdown_from_peak_pct,
  buy_pressure_pct,
  creator_trades,
  creator_sells,
  first_minute_buyers,
  largest_buy_quote_raw,
  holder_snapshot_at,
  holder_count,
  case when holder_count_5m_ago is not null
    then holder_count - holder_count_5m_ago
    else null
  end as holder_change_5m,
  largest_holder_pct,
  top_10_holder_pct,
  top_100_holder_pct,
  creator_balance_pct,
  price_usd,
  volume_usd,
  market_cap_usd,
  ath_market_cap_usd,
  usd_price_at
from enriched;

revoke all on table public.launch_board from public, anon, authenticated;
grant select on table public.launch_board to service_role;

comment on table public.holder_snapshots is
  'Time-series holder distribution evidence collected from Bitquery for active PONS launches.';

comment on table public.token_holder_positions is
  'Latest top 100 non-protocol holders per tracked token for cross-launch wallet research.';

comment on table public.trade_market_data is
  'Bitquery Trading cube values including USD prices and volumes for PONS curve trades.';

comment on view public.launch_board is
  'Server-only live launch, trade, holder and pattern metrics for the PonsEye dashboard.';
