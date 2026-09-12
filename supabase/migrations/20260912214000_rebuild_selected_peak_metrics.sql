create or replace function public.rebuild_peak_metrics_for_tokens(
  p_token_addresses text[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer := 0;
begin
  with target_tokens as materialized (
    select l.token_address, l.pair_token_address
    from public.launches l
    where l.token_address = any(p_token_addresses)
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
  )
  update public.launch_metrics metrics
  set peak_price_usd = exact.peak_price_usd,
      updated_at = now()
  from exact_peaks exact
  where metrics.token_address = exact.token_address;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.rebuild_peak_metrics_for_tokens(text[])
  from public, anon, authenticated;
grant execute on function public.rebuild_peak_metrics_for_tokens(text[])
  to service_role;

comment on function public.rebuild_peak_metrics_for_tokens(text[]) is
  'Rebuilds exact peak metrics for a selected token list after a bounded history repair.';
