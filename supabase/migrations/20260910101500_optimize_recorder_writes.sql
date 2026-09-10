create or replace function public.update_launch_trade_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  launch_deployer text;
  launch_time timestamptz;
  unit_price numeric;
  new_trader_count integer := 0;
  new_early_buyer_count integer := 0;
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
    net_quote_raw, volume_quote_raw, first_trade_at, last_trade_at,
    first_unit_price_raw, peak_unit_price_raw, last_unit_price_raw,
    last_quote_amount_raw, last_token_amount_raw, creator_trades,
    creator_sells, first_minute_buyers, largest_buy_quote_raw
  ) values (
    new.token_address, 1,
    case when new.side = 'buy' then 1 else 0 end,
    case when new.side = 'sell' then 1 else 0 end,
    new_trader_count,
    case when new.side = 'buy' then new.quote_amount_raw else -new.quote_amount_raw end,
    new.quote_amount_raw, new.block_time, new.block_time,
    unit_price, unit_price, unit_price,
    new.quote_amount_raw, new.token_amount_raw,
    case when new.trader_address = launch_deployer then 1 else 0 end,
    case when new.side = 'sell' and new.trader_address = launch_deployer then 1 else 0 end,
    new_early_buyer_count,
    case when new.side = 'buy' then new.quote_amount_raw else null end
  )
  on conflict (token_address) do update set
    trade_count = public.launch_metrics.trade_count + 1,
    buys = public.launch_metrics.buys + case when new.side = 'buy' then 1 else 0 end,
    sells = public.launch_metrics.sells + case when new.side = 'sell' then 1 else 0 end,
    unique_traders = public.launch_metrics.unique_traders + new_trader_count,
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
    first_minute_buyers = public.launch_metrics.first_minute_buyers + new_early_buyer_count,
    largest_buy_quote_raw = case when new.side = 'buy' then greatest(public.launch_metrics.largest_buy_quote_raw, new.quote_amount_raw) else public.launch_metrics.largest_buy_quote_raw end,
    updated_at = now();

  return new;
end;
$$;

revoke execute on function public.update_launch_trade_metrics() from public, anon, authenticated;
grant execute on function public.update_launch_trade_metrics() to service_role;
