create or replace view public.launch_board
with (security_invoker = true)
as
with trade_totals as (
  select
    curve_address,
    count(*)::integer as trade_count,
    count(*) filter (where side = 'buy')::integer as buys,
    count(*) filter (where side = 'sell')::integer as sells,
    count(distinct trader_address)::integer as unique_traders,
    sum(case when side = 'buy' then quote_amount_raw else -quote_amount_raw end) as net_quote_raw,
    sum(quote_amount_raw) as volume_quote_raw,
    max(block_time) as last_trade_at
  from public.trades
  where token_address is not null
  group by curve_address
),
latest_trades as (
  select distinct on (curve_address)
    curve_address,
    quote_amount_raw as last_quote_amount_raw,
    token_amount_raw as last_token_amount_raw
  from public.trades
  where token_address is not null and token_amount_raw > 0
  order by curve_address, block_time desc, recorded_at desc
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
    lt.last_token_amount_raw
  from public.launches l
  left join trade_totals t on t.curve_address = l.curve_address
  left join latest_trades lt on lt.curve_address = l.curve_address
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
  last_token_amount_raw
from enriched;

revoke all on table public.launch_board from public, anon, authenticated;
grant select on table public.launch_board to service_role;

comment on view public.launch_board is
  'Server-only launch board metrics for the PonsEye dashboard.';
