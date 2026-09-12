create or replace function public.suppress_market_price_outlier()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.is_price_outlier then
    new.source_price := coalesce(new.source_price, new.price);
    new.source_price_usd := coalesce(new.source_price_usd, new.price_usd);
    new.price := null;
    new.price_usd := null;
  end if;
  return new;
end;
$$;

drop trigger if exists market_trade_zz_suppress_outlier on public.trade_market_data;
create trigger market_trade_zz_suppress_outlier
before insert or update of is_price_outlier, source_price, source_price_usd,
  price, price_usd
on public.trade_market_data
for each row execute function public.suppress_market_price_outlier();

revoke execute on function public.suppress_market_price_outlier()
  from public, anon, authenticated;
grant execute on function public.suppress_market_price_outlier()
  to service_role;

update public.trade_market_data
set price = null,
    price_usd = null
where is_price_outlier;
