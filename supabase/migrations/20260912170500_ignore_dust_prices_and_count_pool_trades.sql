create or replace function public.update_launch_market_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  launch_time timestamptz;
  is_early_buyer boolean := false;
  new_trader_count integer := 0;
  new_early_buyer_count integer := 0;
  reliable_price numeric := case when new.price_usd > 0 then new.price_usd else null end;
  count_as_pool_trade boolean := new.protocol = 'uniswap_v4';
begin
  select l.launched_at
  into launch_time
  from public.launches l
  where l.token_address = new.token_address;

  if new.trader_address is not null then
    is_early_buyer := new.side = 'buy'
      and launch_time is not null
      and new.block_time <= launch_time + interval '1 minute';

    insert into public.launch_metric_traders (
      token_address, trader_address, first_minute_buyer
    ) values (
      new.token_address, new.trader_address, is_early_buyer
    )
    on conflict (token_address, trader_address) do nothing;
    get diagnostics new_trader_count = row_count;

    if new_trader_count = 1 and is_early_buyer then
      new_early_buyer_count := 1;
    elsif is_early_buyer then
      update public.launch_metric_traders
      set first_minute_buyer = true
      where token_address = new.token_address
        and trader_address = new.trader_address
        and first_minute_buyer = false;
      get diagnostics new_early_buyer_count = row_count;
    end if;
  end if;

  insert into public.launch_metrics (
    token_address, trade_count, buys, sells, unique_traders,
    price_usd, volume_usd, peak_price_usd, usd_price_at,
    first_minute_buyers
  ) values (
    new.token_address,
    case when count_as_pool_trade then 1 else 0 end,
    case when count_as_pool_trade and new.side = 'buy' then 1 else 0 end,
    case when count_as_pool_trade and new.side = 'sell' then 1 else 0 end,
    new_trader_count,
    reliable_price,
    coalesce(new.quote_amount_usd, 0),
    reliable_price,
    case when reliable_price is not null then new.block_time else null end,
    new_early_buyer_count
  )
  on conflict (token_address) do update set
    trade_count = public.launch_metrics.trade_count
      + case when count_as_pool_trade then 1 else 0 end,
    buys = public.launch_metrics.buys
      + case when count_as_pool_trade and new.side = 'buy' then 1 else 0 end,
    sells = public.launch_metrics.sells
      + case when count_as_pool_trade and new.side = 'sell' then 1 else 0 end,
    unique_traders = public.launch_metrics.unique_traders + new_trader_count,
    price_usd = case
      when reliable_price is not null
        and (public.launch_metrics.usd_price_at is null
          or new.block_time >= public.launch_metrics.usd_price_at)
        then reliable_price
      else public.launch_metrics.price_usd
    end,
    volume_usd = public.launch_metrics.volume_usd
      + coalesce(new.quote_amount_usd, 0),
    peak_price_usd = greatest(
      public.launch_metrics.peak_price_usd,
      reliable_price
    ),
    usd_price_at = case
      when reliable_price is not null then greatest(
        public.launch_metrics.usd_price_at,
        new.block_time
      )
      else public.launch_metrics.usd_price_at
    end,
    first_minute_buyers = public.launch_metrics.first_minute_buyers
      + new_early_buyer_count,
    updated_at = now();

  return new;
end;
$$;

revoke execute on function public.update_launch_market_metrics()
  from public, anon, authenticated;
grant execute on function public.update_launch_market_metrics()
  to service_role;

-- Correct only the investigated XARA and RUFUS rows. Preserve the swaps and
-- their volumes, but prevent their microscopic legs from painting an ATH.
update public.trade_market_data
set price = null,
    price_usd = null
where (
    token_address = '0xd9bb2ea3eb72eafeac18456c6435ad612337d4cf'
    and (
      base_amount < 1
      or (
        transaction_hash = '0xc14761629502cc02a7cb6c5d894310e852fc03461303fb0b3bfb5ad86f4ad7bd'
        and base_amount_usd < 0.10
      )
    )
  )
  or (
    token_address = '0x46b6995b02b1e3afa39033243999e00d739615f1'
    and base_amount < 1
  );

-- Market cube rows expose the real trader address more reliably than some
-- curve events. Merge them into the existing exact distinct-trader table.
insert into public.launch_metric_traders (
  token_address, trader_address, first_minute_buyer
)
select
  md.token_address,
  md.trader_address,
  bool_or(
    md.side = 'buy'
    and md.block_time <= l.launched_at + interval '1 minute'
  )
from public.trade_market_data md
join public.launches l on l.token_address = md.token_address
where md.trader_address is not null
  and md.token_address in (
    '0xd9bb2ea3eb72eafeac18456c6435ad612337d4cf',
    '0x46b6995b02b1e3afa39033243999e00d739615f1',
    '0x10b409f69989bc34e36a5105874f6d64e3eb0bff'
  )
group by md.token_address, md.trader_address
on conflict (token_address, trader_address) do update
set first_minute_buyer = public.launch_metric_traders.first_minute_buyer
  or excluded.first_minute_buyer;

set local ponseye.repair_mode = 'on';

with curve_counts as (
  select
    token_address,
    count(*)::integer as trade_count,
    count(*) filter (where side = 'buy')::integer as buys,
    count(*) filter (where side = 'sell')::integer as sells
  from public.trades
  group by token_address
), pool_counts as (
  select
    token_address,
    count(*)::integer as trade_count,
    count(*) filter (where side = 'buy')::integer as buys,
    count(*) filter (where side = 'sell')::integer as sells
  from public.trade_market_data
  where protocol = 'uniswap_v4'
  group by token_address
), trader_counts as (
  select
    token_address,
    count(*)::integer as unique_traders,
    count(*) filter (where first_minute_buyer)::integer as first_minute_buyers
  from public.launch_metric_traders
  group by token_address
), priced as (
  select distinct on (token_address)
    token_address,
    price_usd,
    block_time as usd_price_at
  from public.trade_market_data
  where price_usd > 0
  order by token_address, block_time desc, market_event_id desc
), peaks as (
  select token_address, max(price_usd) as peak_price_usd
  from public.trade_market_data
  where price_usd > 0
  group by token_address
)
update public.launch_metrics m
set trade_count = coalesce(c.trade_count, 0) + coalesce(p.trade_count, 0),
    buys = coalesce(c.buys, 0) + coalesce(p.buys, 0),
    sells = coalesce(c.sells, 0) + coalesce(p.sells, 0),
    unique_traders = coalesce(t.unique_traders, 0),
    first_minute_buyers = coalesce(t.first_minute_buyers, 0),
    price_usd = coalesce(latest.price_usd, m.price_usd),
    peak_price_usd = coalesce(
      greatest(
        peak.peak_price_usd,
        m.peak_unit_price_raw * quote_rate.usd_factor
      ),
      peak.peak_price_usd,
      m.peak_unit_price_raw * quote_rate.usd_factor,
      m.peak_price_usd
    ),
    usd_price_at = coalesce(latest.usd_price_at, m.usd_price_at),
    updated_at = now()
from public.launches l
left join curve_counts c on c.token_address = l.token_address
left join pool_counts p on p.token_address = l.token_address
left join trader_counts t on t.token_address = l.token_address
left join priced latest on latest.token_address = l.token_address
left join peaks peak on peak.token_address = l.token_address
left join public.pair_quote_usd_rates quote_rate
  on quote_rate.pair_token_address is not distinct from l.pair_token_address
where m.token_address = l.token_address
  and l.token_address in (
    '0xd9bb2ea3eb72eafeac18456c6435ad612337d4cf',
    '0x46b6995b02b1e3afa39033243999e00d739615f1',
    '0x10b409f69989bc34e36a5105874f6d64e3eb0bff'
  );

comment on function public.update_launch_market_metrics() is
  'Updates USD pricing and counts post-migration pool trades without double-counting PONS curve rows. Distinct traders are shared across both feeds.';
