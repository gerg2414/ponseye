create or replace function public.get_launch_detail(
  p_token_address text,
  p_trade_limit integer default 100,
  p_market_limit integer default 1000
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'launch', (
      select to_jsonb(b) || jsonb_build_object(
        'description', l.description,
        'twitter_url', l.twitter_url,
        'telegram_url', l.telegram_url,
        'discord_url', l.discord_url,
        'website_url', l.website_url
      )
      from public.launch_board b
      join public.launches l on l.token_address = b.token_address
      where b.token_address = lower(p_token_address)
    ),
    'trades', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.block_time, t.event_id)
      from (
        select event_id, transaction_hash, block_time, side, trader_address,
          recipient_address, quote_amount_raw, token_amount_raw, fee_raw, tax_raw
        from public.trades
        where token_address = lower(p_token_address)
        order by block_time desc, event_id desc
        limit greatest(1, least(p_trade_limit, 500))
      ) t
    ), '[]'::jsonb),
    'marketTrades', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.block_time, m.market_event_id)
      from (
        select market_event_id, transaction_hash, block_time, side, trader_address,
          price_usd, base_amount_usd, quote_amount_usd, protocol
        from public.trade_market_data
        where token_address = lower(p_token_address)
        order by block_time desc, market_event_id desc
        limit greatest(1, least(p_market_limit, 1500))
      ) m
    ), '[]'::jsonb),
    'chartCandles', coalesce((
      with raw_curve_points as (
        select
          t.event_id as sort_id,
          t.transaction_hash,
          t.block_time,
          t.side,
          case
            when t.token_amount_raw > 0 and t.side = 'buy' then
              greatest(t.quote_amount_raw - coalesce(t.fee_raw, 0) - coalesce(t.tax_raw, 0), 0)
                / t.token_amount_raw
            when t.token_amount_raw > 0 then
              (t.quote_amount_raw + coalesce(t.fee_raw, 0) + coalesce(t.tax_raw, 0))
                / t.token_amount_raw
          end as raw_quote_price
        from public.trades t
        where t.token_address = lower(p_token_address)
      ),
      quote_scale as (
        select percentile_cont(0.5) within group (
          order by md.price_usd / rcp.raw_quote_price
        ) as scale
        from raw_curve_points rcp
        join public.trade_market_data md
          on md.token_address = lower(p_token_address)
         and md.transaction_hash = rcp.transaction_hash
         and md.side = rcp.side
         and md.protocol = 'pons_v2'
        where rcp.raw_quote_price > 0
          and md.price_usd > 0
      ),
      chart_points as (
        select
          rcp.block_time,
          rcp.sort_id,
          rcp.raw_quote_price * qs.scale as price_usd
        from raw_curve_points rcp
        cross join quote_scale qs
        where rcp.raw_quote_price > 0
          and qs.scale > 0

        union all

        select md.block_time, md.market_event_id, md.price_usd
        from public.trade_market_data md
        where md.token_address = lower(p_token_address)
          and md.protocol is distinct from 'pons_v2'
          and md.price_usd > 0

        union all

        select md.block_time, md.market_event_id, md.price_usd
        from public.trade_market_data md
        where md.token_address = lower(p_token_address)
          and md.protocol = 'pons_v2'
          and md.price_usd > 0
          and not exists (select 1 from quote_scale qs where qs.scale > 0)
      )
      select jsonb_agg(to_jsonb(c) order by c.time)
      from (
        select
          date_bin('1 minute', cp.block_time, timestamptz '1970-01-01') as time,
          (array_agg(cp.price_usd order by cp.block_time, cp.sort_id))[1] as open,
          max(cp.price_usd) as high,
          min(cp.price_usd) as low,
          (array_agg(cp.price_usd order by cp.block_time desc, cp.sort_id desc))[1] as close
        from chart_points cp
        where cp.price_usd > 0
        group by date_bin('1 minute', cp.block_time, timestamptz '1970-01-01')
      ) c
    ), '[]'::jsonb),
    'bondPriceUsd', (
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
    'poolStartedAt', (
      select min(md.block_time)
      from public.trade_market_data md
      where md.token_address = lower(p_token_address)
        and md.protocol = 'uniswap_v4'
        and md.price_usd > 0
    )
  );
$$;

revoke execute on function public.get_launch_detail(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_launch_detail(text, integer, integer)
  to service_role;

comment on function public.get_launch_detail(text, integer, integer) is
  'Returns bounded token data and true OHLC candles reconstructed from the complete curve event stream plus migrated pool trades.';
