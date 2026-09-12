alter table public.stream_status
  drop constraint if exists stream_status_status_check;

alter table public.stream_status
  add constraint stream_status_status_check
  check (status in ('connecting', 'connected', 'error', 'stopped', 'running', 'completed'));

create or replace function public.rebuild_peak_metrics_batch(
  p_after_token text default '',
  p_limit integer default 100
)
returns table(processed integer, last_token text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bounded_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  return query
  with target_tokens as materialized (
    select l.token_address, l.pair_token_address
    from public.launches l
    where l.token_address > lower(coalesce(p_after_token, ''))
    order by l.token_address
    limit bounded_limit
  ), curve_peaks as (
    select t.token_address,
      max(t.quote_amount_raw / nullif(t.token_amount_raw, 0)) as peak_unit_price_raw
    from public.trades t
    join target_tokens target on target.token_address = t.token_address
    where t.token_amount_raw > 0
    group by t.token_address
  ), market_peaks as (
    select md.token_address, max(md.price_usd) as peak_price_usd
    from public.trade_market_data md
    join target_tokens target on target.token_address = md.token_address
    where md.price_usd > 0
    group by md.token_address
  ), exact_peaks as (
    select target.token_address,
      nullif(greatest(
        coalesce(market.peak_price_usd, 0),
        coalesce(curve.peak_unit_price_raw * rate.usd_factor, 0)
      ), 0) as peak_price_usd
    from target_tokens target
    left join curve_peaks curve on curve.token_address = target.token_address
    left join market_peaks market on market.token_address = target.token_address
    left join public.pair_quote_usd_rates rate
      on rate.pair_token_address is not distinct from target.pair_token_address
  ), updated as (
    update public.launch_metrics metrics
    set peak_price_usd = exact.peak_price_usd,
        updated_at = now()
    from exact_peaks exact
    where metrics.token_address = exact.token_address
    returning metrics.token_address
  )
  select
    (select count(*)::integer from target_tokens),
    (select max(target.token_address) from target_tokens target);
end;
$$;

revoke execute on function public.rebuild_peak_metrics_batch(text, integer)
  from public, anon, authenticated;
grant execute on function public.rebuild_peak_metrics_batch(text, integer)
  to service_role;

comment on function public.rebuild_peak_metrics_batch(text, integer) is
  'Replaces stored ATH values in bounded batches using the maximum reliable USD market trade or USD-converted PONS curve trade.';
