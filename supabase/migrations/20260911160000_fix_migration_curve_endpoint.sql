create or replace function public.get_launch_migration_price_usd(p_token_address text)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select
      l.token_address,
      l.pair_token_address,
      coalesce(
        l.graduation_threshold_raw,
        case
          when l.pair_token_address = '0x0000000000000000000000000000000000000000'
            then 4200000000000000000::numeric
        end
      ) as graduation_threshold_raw
    from public.launches l
    where l.token_address = lower(p_token_address)
  ),
  completed_curve_highs as (
    select max(md.price) as curve_high
    from target t
    join public.launches peer
      on peer.pair_token_address = t.pair_token_address
     and coalesce(
       peer.graduation_threshold_raw,
       case
         when peer.pair_token_address = '0x0000000000000000000000000000000000000000'
           then 4200000000000000000::numeric
       end
     ) = t.graduation_threshold_raw
    join public.trade_market_data md
      on md.token_address = peer.token_address
     and md.protocol = 'pons_v2'
     and md.price > 0
    where peer.graduated_at is not null or peer.swept_at is not null
    group by peer.token_address
  ),
  curve_endpoint as (
    select percentile_cont(0.9) within group (order by curve_high) as quote_price
    from completed_curve_highs
  ),
  target_quote_rate as (
    select md.price_usd / md.price as quote_usd
    from target t
    join public.trade_market_data md on md.token_address = t.token_address
    where md.protocol = 'pons_v2'
      and md.price > 0
      and md.price_usd > 0
    order by md.block_time desc, md.market_event_id desc
    limit 1
  )
  select ce.quote_price * qr.quote_usd
  from curve_endpoint ce
  cross join target_quote_rate qr
  where ce.quote_price > 0 and qr.quote_usd > 0;
$$;

revoke execute on function public.get_launch_migration_price_usd(text)
  from public, anon, authenticated;
grant execute on function public.get_launch_migration_price_usd(text)
  to service_role;

comment on function public.get_launch_migration_price_usd(text) is
  'Returns the shared Pons bonding-curve endpoint for launches with the same pair and graduation threshold, converted to USD using the launch quote rate.';
