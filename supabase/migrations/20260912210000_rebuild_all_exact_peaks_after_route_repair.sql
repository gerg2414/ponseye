with curve_peaks as (
  select token_address,
    max(quote_amount_raw / nullif(token_amount_raw, 0)) as peak_raw
  from public.trades
  where token_amount_raw > 0
  group by token_address
), market_peaks as (
  select token_address, max(price_usd) as peak_usd
  from public.trade_market_data
  where price_usd > 0
  group by token_address
), exact_peaks as (
  select l.token_address,
    nullif(greatest(
      coalesce(market.peak_usd, 0),
      coalesce(curve.peak_raw * rate.usd_factor, 0)
    ), 0) as peak_usd
  from public.launches l
  left join curve_peaks curve using (token_address)
  left join market_peaks market using (token_address)
  left join public.pair_quote_usd_rates rate
    on rate.pair_token_address is not distinct from l.pair_token_address
)
update public.launch_metrics metrics
set peak_price_usd = exact.peak_usd,
    updated_at = now()
from exact_peaks exact
where exact.token_address = metrics.token_address;

with outcomes as (
  select p.token_address,
    max(md.price_usd) as peak_price_usd,
    first_exit.block_time as closed_at,
    first_exit.exit_reason,
    case first_exit.exit_reason
      when 'target' then p.entry_price_usd * p.target_multiple
      when 'stop' then p.entry_price_usd * p.stop_multiple
    end as exit_price_usd,
    case first_exit.exit_reason
      when 'target' then p.entry_market_cap_usd * p.target_multiple
      when 'stop' then p.entry_market_cap_usd * p.stop_multiple
    end as exit_market_cap_usd
  from public.acquired_positions p
  left join public.trade_market_data md
    on md.token_address = p.token_address
   and md.block_time >= p.acquired_at
   and md.price_usd > 0
  left join lateral (
    select priced.block_time,
      case when priced.price_usd >= p.entry_price_usd * p.target_multiple
        then 'target' else 'stop' end as exit_reason
    from public.trade_market_data priced
    where priced.token_address = p.token_address
      and priced.block_time >= p.acquired_at
      and priced.price_usd > 0
      and (
        priced.price_usd >= p.entry_price_usd * p.target_multiple
        or priced.price_usd <= p.entry_price_usd * p.stop_multiple
      )
    order by priced.block_time, priced.market_event_id
    limit 1
  ) first_exit on true
  group by p.token_address, p.entry_price_usd, p.entry_market_cap_usd,
    p.target_multiple, p.stop_multiple, first_exit.block_time,
    first_exit.exit_reason
)
update public.acquired_positions p
set peak_price_usd = greatest(p.entry_price_usd, coalesce(o.peak_price_usd, p.entry_price_usd)),
    position_status = case when o.closed_at is null then 'open' else 'closed' end,
    closed_at = o.closed_at,
    exit_price_usd = o.exit_price_usd,
    exit_market_cap_usd = o.exit_market_cap_usd,
    exit_reason = o.exit_reason,
    updated_at = now()
from outcomes o
where o.token_address = p.token_address;

select public.refresh_ponseye_lab_dataset();
