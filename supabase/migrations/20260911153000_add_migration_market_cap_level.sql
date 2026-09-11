create or replace function public.get_launch_migration_price_usd(p_token_address text)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select md.price_usd
      from public.trade_market_data md
      join public.launches l on l.token_address = md.token_address
      where md.token_address = lower(p_token_address)
        and l.graduated_at is not null
        and md.protocol = 'pons_v2'
        and md.price_usd > 0
        and md.block_time <= l.graduated_at + interval '5 seconds'
      order by md.block_time desc, md.market_event_id desc
      limit 1
    ),
    (
      select md.price_usd
      from public.trade_market_data md
      where md.token_address = lower(p_token_address)
        and md.protocol = 'uniswap_v4'
        and md.price_usd > 0
      order by md.block_time, md.market_event_id
      limit 1
    )
  );
$$;

revoke execute on function public.get_launch_migration_price_usd(text)
  from public, anon, authenticated;
grant execute on function public.get_launch_migration_price_usd(text)
  to service_role;

comment on function public.get_launch_migration_price_usd(text) is
  'Returns the confirmed bond price, falling back to the first migrated-pool price for a horizontal market-cap marker.';
