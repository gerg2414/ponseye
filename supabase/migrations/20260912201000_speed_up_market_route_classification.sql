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
  if coalesce(current_setting('ponseye.classified_batch', true), '') = 'on' then
    return new;
  end if;

  select l.pair_token_address into launch_pair
  from public.launches l
  where l.token_address = new.token_address;

  new.source_price := coalesce(new.source_price, new.price);
  new.source_price_usd := coalesce(new.source_price_usd, new.price_usd);

  launch_price := new.protocol = 'pons_v2'
    or (new.protocol = 'uniswap_v4' and (
      (launch_pair = '0x0000000000000000000000000000000000000000' and (
        coalesce(new.quote_token_address, '') in ('', '0x0000000000000000000000000000000000000000')
        or upper(coalesce(new.quote_symbol, '')) = 'ETH'
      ))
      or new.quote_token_address = launch_pair
    ));

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

create or replace function public.classify_market_trade_batch(
  p_after_id text default '',
  p_limit integer default 10000
)
returns table(processed integer, last_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_limit integer := least(greatest(coalesce(p_limit, 10000), 1), 50000);
begin
  perform set_config('ponseye.repair_mode', 'on', true);
  perform set_config('ponseye.classified_batch', 'on', true);

  return query
  with targets as materialized (
    select md.market_event_id,
      md.protocol = 'pons_v2' or (md.protocol = 'uniswap_v4' and (
        (l.pair_token_address = '0x0000000000000000000000000000000000000000' and (
          coalesce(md.quote_token_address, '') in ('', '0x0000000000000000000000000000000000000000')
          or upper(coalesce(md.quote_symbol, '')) = 'ETH'
        ))
        or md.quote_token_address = l.pair_token_address
      )) as launch_price,
      not (
        coalesce(md.base_amount > 0 and md.base_amount < 1, false)
        or coalesce(md.base_amount > 0 and md.base_amount < 1000
          and coalesce(md.base_amount_usd, md.quote_amount_usd) >= 0
          and coalesce(md.base_amount_usd, md.quote_amount_usd) < 0.10, false)
      ) as reliable_price
    from public.trade_market_data md
    join public.launches l on l.token_address = md.token_address
    where md.market_event_id > coalesce(p_after_id, '')
    order by md.market_event_id
    limit bounded_limit
  ), repaired as (
    update public.trade_market_data md
    set source_price = coalesce(md.source_price, md.price),
        source_price_usd = coalesce(md.source_price_usd, md.price_usd),
        is_launch_price = t.launch_price,
        price = case when t.launch_price and t.reliable_price then coalesce(md.source_price, md.price) else null end,
        price_usd = case when t.launch_price and t.reliable_price then coalesce(md.source_price_usd, md.price_usd) else null end
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
