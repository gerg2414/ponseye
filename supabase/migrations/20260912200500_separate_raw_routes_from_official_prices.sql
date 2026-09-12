-- Preserve every reported trade and price for research, while limiting the
-- official valuation series to the token's Pons launch quote route. Bitquery's
-- Trading feed intentionally includes secondary Uniswap routes for a token.
set statement_timeout = '10min';
set lock_timeout = '5s';

alter table public.trade_market_data
  add column if not exists source_price numeric,
  add column if not exists source_price_usd numeric,
  add column if not exists is_launch_price boolean not null default false;

create or replace function public.classify_market_trade_price()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  launch_pair text;
  launch_price boolean := false;
  base_size numeric := new.base_amount;
  usd_size numeric := coalesce(new.base_amount_usd, new.quote_amount_usd);
  reliable_price boolean;
begin
  select l.pair_token_address into launch_pair
  from public.launches l
  where l.token_address = new.token_address;

  new.source_price := coalesce(new.source_price, new.price);
  new.source_price_usd := coalesce(new.source_price_usd, new.price_usd);

  launch_price := new.protocol = 'pons_v2'
    or (
      new.protocol = 'uniswap_v4'
      and (
        (launch_pair = '0x0000000000000000000000000000000000000000'
          and (
            coalesce(new.quote_token_address, '') in ('', '0x0000000000000000000000000000000000000000')
            or upper(coalesce(new.quote_symbol, '')) = 'ETH'
          ))
        or new.quote_token_address = launch_pair
      )
    );

  reliable_price := not (
    coalesce(base_size > 0 and base_size < 1, false)
    or coalesce(base_size > 0 and base_size < 1000 and usd_size >= 0 and usd_size < 0.10, false)
  );

  new.is_launch_price := launch_price;
  new.price := case when launch_price and reliable_price then new.source_price else null end;
  new.price_usd := case when launch_price and reliable_price then new.source_price_usd else null end;
  return new;
end;
$$;

drop trigger if exists market_trade_classify_price on public.trade_market_data;
create trigger market_trade_classify_price
before insert or update of token_address, protocol, quote_token_address,
  quote_symbol, source_price, source_price_usd, price, price_usd,
  base_amount, base_amount_usd, quote_amount_usd
on public.trade_market_data
for each row execute function public.classify_market_trade_price();

revoke execute on function public.classify_market_trade_price()
  from public, anon, authenticated;
grant execute on function public.classify_market_trade_price()
  to service_role;

create or replace function public.classify_market_trade_batch(
  p_after_id text default '',
  p_limit integer default 10000
)
returns table(processed integer, last_id text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bounded_limit integer := least(greatest(coalesce(p_limit, 10000), 1), 50000);
begin
  perform set_config('ponseye.repair_mode', 'on', true);

  return query
  with targets as materialized (
    select md.market_event_id
    from public.trade_market_data md
    where md.market_event_id > coalesce(p_after_id, '')
    order by md.market_event_id
    limit bounded_limit
  ), repaired as (
    update public.trade_market_data md
    set source_price = coalesce(md.source_price, md.price),
        source_price_usd = coalesce(md.source_price_usd, md.price_usd),
        price = md.price,
        price_usd = md.price_usd
    from targets t
    where md.market_event_id = t.market_event_id
    returning md.market_event_id
  )
  select count(*)::integer, max(repaired.market_event_id)
  from repaired;
end;
$$;

revoke execute on function public.classify_market_trade_batch(text, integer)
  from public, anon, authenticated;
grant execute on function public.classify_market_trade_batch(text, integer)
  to service_role;

-- Keep bulk repair idempotent and allow a replay to restore source prices that
-- older dust filtering intentionally nulled in the valuation columns.
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
    trader_address, source_price, source_price_usd, price, price_usd,
    base_amount, quote_amount, base_amount_usd, quote_amount_usd,
    quote_token_address, quote_symbol, protocol, pool_address
  )
  select
    item.market_event_id, item.token_address, item.transaction_hash,
    item.block_time, item.side, item.trader_address,
    item.source_price, item.source_price_usd, item.price, item.price_usd,
    item.base_amount, item.quote_amount, item.base_amount_usd,
    item.quote_amount_usd, item.quote_token_address, item.quote_symbol,
    item.protocol, item.pool_address
  from pg_catalog.jsonb_populate_recordset(
    null::public.trade_market_data,
    rows
  ) as item
  on conflict (market_event_id) do update
  set source_price = coalesce(excluded.source_price, public.trade_market_data.source_price),
      source_price_usd = coalesce(excluded.source_price_usd, public.trade_market_data.source_price_usd),
      price = excluded.price,
      price_usd = excluded.price_usd,
      pool_address = coalesce(public.trade_market_data.pool_address, excluded.pool_address);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.ingest_market_history_repair(jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_market_history_repair(jsonb)
  to service_role;

comment on column public.trade_market_data.source_price is
  'Unmodified price reported by Bitquery, retained for route research and backtesting.';
comment on column public.trade_market_data.source_price_usd is
  'Unmodified USD price reported by Bitquery, retained even when the route is excluded from official valuation.';
comment on column public.trade_market_data.is_launch_price is
  'True for the Pons curve or the graduated Uniswap v4 route quoted in the launch asset; secondary routes remain stored but do not drive official prices.';
