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
    max(block_time) as last_trade_at
  from public.trades
  group by curve_address
),
enriched as (
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
    ) as graduation_threshold_raw
  from public.launches l
  left join trade_totals t on t.curve_address = l.curve_address
)
select
  enriched.*,
  case
    when graduation_threshold_raw > 0 then
      least(100::numeric, round((net_quote_raw * 100) / graduation_threshold_raw, 1))
    else null
  end as progress_pct
from enriched;

revoke all on table public.launch_board from public, anon, authenticated;
grant select on table public.launch_board to service_role;

comment on view public.launch_board is
  'Server-only launch board metrics for the PonsEye dashboard.';
