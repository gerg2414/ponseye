do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.build_ponseye_lab_dataset()'::regprocedure)
  into definition;

  if position('recent_buys_20s' in definition) = 0 then
    definition := replace(
      definition,
      'nullif(e.metrics_snapshot ->> ''last_unit_price_raw'', '''')::numeric as signal_price',
      'nullif(e.metrics_snapshot ->> ''last_unit_price_raw'', '''')::numeric as signal_price,
      (select count(*)::integer
       from public.trades recent
       where recent.token_address = e.token_address
         and lower(recent.side) = ''buy''
         and recent.block_time >= e.observed_at - interval ''20 seconds''
         and recent.block_time <= e.observed_at) as recent_buys_20s'
    );
    definition := replace(
      definition,
      '''buys'', coalesce((s.metrics_snapshot ->> ''buys'')::integer, 0),',
      '''buys'', coalesce((s.metrics_snapshot ->> ''buys'')::integer, 0),
    ''recent_buys_20s'', coalesce(s.recent_buys_20s, 0),'
    );
    execute definition;
  end if;

  perform public.refresh_ponseye_lab_dataset();
end;
$$;

comment on function public.build_ponseye_lab_dataset() is
  'Builds Lab signals and outcomes with point in time recent buy activity for Quiet Peak testing.';
