create or replace function public.ponseye_live_market_write()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('ponseye.repair_mode', true), '') <> 'on'
$$;

drop trigger if exists market_trade_00_update_quote_rate on public.trade_market_data;
create trigger market_trade_00_update_quote_rate
after insert or update of price, price_usd on public.trade_market_data
for each row
when (public.ponseye_live_market_write())
execute function public.update_pair_quote_usd_rate();

drop trigger if exists market_trade_track_position_exit on public.trade_market_data;
create trigger market_trade_track_position_exit
after insert or update of price_usd on public.trade_market_data
for each row
when (public.ponseye_live_market_write())
execute function public.track_market_position_exit();

drop trigger if exists market_trades_update_launch_metrics on public.trade_market_data;
create trigger market_trades_update_launch_metrics
after insert on public.trade_market_data
for each row
when (public.ponseye_live_market_write())
execute function public.update_launch_market_metrics();

create or replace function public.ingest_market_history_repair(rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer := 0;
begin
  perform set_config('ponseye.repair_mode', 'on', true);

  insert into public.trade_market_data (
    market_event_id, token_address, transaction_hash, block_time, side,
    trader_address, price, price_usd, base_amount, quote_amount,
    base_amount_usd, quote_amount_usd, quote_token_address, quote_symbol,
    protocol, pool_address
  )
  select
    item.market_event_id, item.token_address, item.transaction_hash,
    item.block_time, item.side, item.trader_address, item.price,
    item.price_usd, item.base_amount, item.quote_amount,
    item.base_amount_usd, item.quote_amount_usd, item.quote_token_address,
    item.quote_symbol, item.protocol, item.pool_address
  from pg_catalog.jsonb_populate_recordset(
    null::public.trade_market_data,
    rows
  ) as item
  on conflict (market_event_id) do update
  set pool_address = coalesce(
    public.trade_market_data.pool_address,
    excluded.pool_address
  );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.ingest_market_history_repair(jsonb)
from public, anon, authenticated;
grant execute on function public.ingest_market_history_repair(jsonb)
to service_role;

revoke execute on function public.ponseye_live_market_write()
from public, anon, authenticated;
grant execute on function public.ponseye_live_market_write()
to service_role;

comment on function public.ingest_market_history_repair(jsonb) is
  'Bulk loads historical market rows without firing live scoring, quote-rate or position-exit triggers. Metrics and outcomes are rebuilt after the replay.';
