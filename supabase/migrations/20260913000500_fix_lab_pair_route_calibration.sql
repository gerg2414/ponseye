do $$
declare
  function_definition text;
  old_calibration constant text := $old$
    left join lateral (
      select percentile_cont(0.5) within group (order by matched.usd_factor)::numeric as usd_factor
      from (
        select
          md.price_usd / nullif(t.quote_amount_raw / nullif(t.token_amount_raw, 0), 0) as usd_factor
        from public.trades t
        join public.trade_market_data md
          on md.token_address = t.token_address
         and md.transaction_hash = t.transaction_hash
        where t.token_address = s.token_address
          and t.token_amount_raw > 0
          and t.quote_amount_raw > 0
          and md.price_usd > 0
        order by abs(extract(epoch from (md.block_time - s.signal_at)))
        limit 20
      ) matched
      where matched.usd_factor > 0
    ) calibration on true
$old$;
  new_calibration constant text := $new$
    left join lateral (
      select public.get_pair_quote_usd_factor(s.token_address) as usd_factor
    ) calibration on true
$new$;
begin
  select pg_get_functiondef('public.build_ponseye_lab_dataset()'::regprocedure)
  into function_definition;

  if position(old_calibration in function_definition) = 0 then
    raise exception 'Could not locate the old Lab USD calibration';
  end if;

  execute replace(function_definition, old_calibration, new_calibration);
  perform public.refresh_ponseye_lab_dataset();
end;
$$;

comment on function public.build_ponseye_lab_dataset() is
  'Builds Lab signals and outcomes using the canonical pair quote USD route.';
