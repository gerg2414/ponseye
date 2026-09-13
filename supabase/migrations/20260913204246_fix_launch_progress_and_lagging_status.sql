alter table public.stream_status
  drop constraint if exists stream_status_status_check;

alter table public.stream_status
  add constraint stream_status_status_check
  check (status in (
    'connecting',
    'connected',
    'lagging',
    'error',
    'stopped',
    'running',
    'completed'
  ));

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
  r.graduation_threshold_raw,
  case
    when l.status = 'graduated' or l.graduated_at is not null then 100::numeric
    when r.graduation_threshold_raw > 0 then least(100::numeric, round(
      greatest(coalesce(l.initial_quote_in_raw, 0) + coalesce(m.net_quote_raw, 0), 0)
        * 100 / r.graduation_threshold_raw, 1))
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
  p.price_usd,
  coalesce(m.volume_usd, 0) as volume_usd,
  case when p.price_usd > 0 then p.price_usd * 1000000000::numeric else null end as market_cap_usd,
  case
    when coalesce(m.peak_price_usd, m.peak_unit_price_raw * q.usd_factor) > 0
      then coalesce(m.peak_price_usd, m.peak_unit_price_raw * q.usd_factor) * 1000000000::numeric
    when p.price_usd > 0 then p.price_usd * 1000000000::numeric
    else null
  end as ath_market_cap_usd,
  coalesce(m.usd_price_at, m.last_trade_at, l.launched_at) as usd_price_at
from public.launches l
left join public.launch_metrics m on m.token_address = l.token_address
left join public.pair_quote_usd_rates quote_rate
  on coalesce(quote_rate.pair_token_address, '') = coalesce(l.pair_token_address, '')
cross join lateral (
  select coalesce(
    l.graduation_threshold_raw,
    case when l.pair_token_address = '0x0000000000000000000000000000000000000000'
      then 4200000000000000000::numeric else null end
  ) as graduation_threshold_raw
) r
cross join lateral (
  select quote_rate.usd_factor * quote_rate.raw_scale as usd_factor
) q
cross join lateral (
  select coalesce(
    m.price_usd,
    m.last_unit_price_raw * q.usd_factor,
    (
      r.graduation_threshold_raw / 2475000000000000000000000000::numeric
      + coalesce(l.initial_quote_in_raw, 0) / 1000000000000000000000000000::numeric
    ) * q.usd_factor
  ) as price_usd
) p;

revoke all on table public.launch_board from public, anon, authenticated;
grant select on table public.launch_board to service_role;
