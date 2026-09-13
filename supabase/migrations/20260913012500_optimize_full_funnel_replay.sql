create or replace function public.get_ponseye_full_funnel_dataset(
  p_min_age_seconds integer default 60,
  p_max_age_seconds integer default 900,
  p_min_market_cap_usd numeric default 10000,
  p_min_trades integer default 12,
  p_min_unique_traders integer default 6,
  p_min_buy_pressure_pct numeric default 52,
  p_require_no_creator_sales boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '55s'
as $$
  with signals as (
    select *
    from public.get_ponseye_full_funnel_signals(
      p_min_age_seconds,
      p_max_age_seconds,
      p_min_market_cap_usd,
      p_min_trades,
      p_min_unique_traders,
      p_min_buy_pressure_pct,
      p_require_no_creator_sales
    )
  ), price_path as materialized (
    select
      s.token_address,
      p.observed_second,
      p.close_at,
      p.close_event_key,
      p.high_price / nullif(case when p.source = 'curve' then s.unit_price_raw else s.signal_price_usd end, 0) as high_multiple,
      p.low_price / nullif(case when p.source = 'curve' then s.unit_price_raw else s.signal_price_usd end, 0) as low_multiple,
      p.close_price / nullif(case when p.source = 'curve' then s.unit_price_raw else s.signal_price_usd end, 0) as close_multiple,
      p.trade_count,
      p.source = 'market' as market_trade
    from signals s
    join public.lab_price_seconds p
      on p.token_address = s.token_address
     and p.observed_second > date_trunc('second', s.signal_at)
  ), valid_path as materialized (
    select p.*
    from price_path p
    where p.high_multiple > 0 and p.low_multiple > 0 and p.close_multiple > 0
  ), hits as (
    select
      p.token_address,
      min(p.observed_second) filter (where p.high_multiple >= 1.5) as hit_1_5,
      min(p.observed_second) filter (where p.high_multiple >= 2) as hit_2,
      min(p.observed_second) filter (where p.high_multiple >= 3) as hit_3,
      min(p.observed_second) filter (where p.high_multiple >= 5) as hit_5,
      min(p.observed_second) filter (where p.high_multiple >= 10) as hit_10,
      min(p.observed_second) filter (where p.high_multiple >= 20) as hit_20,
      min(p.observed_second) filter (where p.high_multiple >= 50) as hit_50,
      min(p.observed_second) filter (where p.high_multiple >= 100) as hit_100
    from valid_path p
    group by p.token_address
  ), journeys as (
    select
      p.token_address,
      sum(p.trade_count) filter (where not p.market_trade)::integer as followup_trades,
      sum(p.trade_count) filter (where p.market_trade)::integer as market_followup_trades,
      greatest(1::numeric, coalesce(max(p.high_multiple), 1::numeric)) as future_peak_multiple,
      min(p.low_multiple) as future_low_multiple,
      (array_agg(p.close_multiple order by p.close_at desc, p.close_event_key desc))[1] as final_multiple,
      jsonb_build_object(
        '1.5', min(p.low_multiple) filter (where p.observed_second < coalesce(h.hit_1_5, 'infinity'::timestamptz)),
        '2', min(p.low_multiple) filter (where p.observed_second < coalesce(h.hit_2, 'infinity'::timestamptz)),
        '3', min(p.low_multiple) filter (where p.observed_second < coalesce(h.hit_3, 'infinity'::timestamptz)),
        '5', min(p.low_multiple) filter (where p.observed_second < coalesce(h.hit_5, 'infinity'::timestamptz)),
        '10', min(p.low_multiple) filter (where p.observed_second < coalesce(h.hit_10, 'infinity'::timestamptz)),
        '20', min(p.low_multiple) filter (where p.observed_second < coalesce(h.hit_20, 'infinity'::timestamptz)),
        '50', min(p.low_multiple) filter (where p.observed_second < coalesce(h.hit_50, 'infinity'::timestamptz)),
        '100', min(p.low_multiple) filter (where p.observed_second < coalesce(h.hit_100, 'infinity'::timestamptz))
      ) as pre_target_low_multiples,
      jsonb_build_object(
        '3', min(p.low_multiple) filter (where p.observed_second > coalesce(h.hit_2, 'infinity'::timestamptz) and p.observed_second < coalesce(h.hit_3, 'infinity'::timestamptz)),
        '5', min(p.low_multiple) filter (where p.observed_second > coalesce(h.hit_2, 'infinity'::timestamptz) and p.observed_second < coalesce(h.hit_5, 'infinity'::timestamptz)),
        '10', min(p.low_multiple) filter (where p.observed_second > coalesce(h.hit_2, 'infinity'::timestamptz) and p.observed_second < coalesce(h.hit_10, 'infinity'::timestamptz)),
        '20', min(p.low_multiple) filter (where p.observed_second > coalesce(h.hit_2, 'infinity'::timestamptz) and p.observed_second < coalesce(h.hit_20, 'infinity'::timestamptz)),
        '50', min(p.low_multiple) filter (where p.observed_second > coalesce(h.hit_2, 'infinity'::timestamptz) and p.observed_second < coalesce(h.hit_50, 'infinity'::timestamptz)),
        '100', min(p.low_multiple) filter (where p.observed_second > coalesce(h.hit_2, 'infinity'::timestamptz) and p.observed_second < coalesce(h.hit_100, 'infinity'::timestamptz))
      ) as post_2x_pre_target_low_multiples
    from valid_path p
    join hits h using (token_address)
    group by p.token_address
  ), outcomes as (
    select
      s.*,
      holder.holder_count,
      holder.top_10_holder_pct,
      holder.creator_balance_pct,
      journey.followup_trades,
      journey.market_followup_trades,
      journey.future_peak_multiple,
      journey.future_low_multiple,
      journey.final_multiple,
      journey.pre_target_low_multiples,
      journey.post_2x_pre_target_low_multiples
    from signals s
    left join lateral (
      select h.holder_count, h.top_10_holder_pct, h.creator_balance_pct
      from public.holder_snapshots h
      where h.token_address = s.token_address
        and h.observed_at <= s.signal_at
      order by h.observed_at desc
      limit 1
    ) holder on true
    left join journeys journey on journey.token_address = s.token_address
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'token_address', s.token_address,
    'name', l.name,
    'symbol', l.symbol,
    'image_url', l.image_url,
    'launched_at', l.launched_at,
    'signal_at', s.signal_at,
    'signal_age_seconds', round(extract(epoch from (s.signal_at - l.launched_at))::numeric, 2),
    'status', l.status,
    'actual_state', m.research_state,
    'actual_acquired', exists (
      select 1 from public.research_events acquired
      where acquired.token_address = s.token_address
        and acquired.stage = 'target_locked'
        and acquired.observed_at >= s.signal_at
    ),
    'actual_binned', exists (
      select 1 from public.research_events binned
      where binned.token_address = s.token_address
        and binned.stage = 'binned'
        and binned.observed_at >= s.signal_at
    ),
    'trade_count', s.trade_count,
    'buys', s.buys,
    'sells', s.sells,
    'unique_traders', s.unique_traders,
    'buy_pressure_pct', s.buy_pressure_pct,
    'creator_sells', s.creator_sells,
    'first_minute_buyers', s.first_minute_buyers,
    'momentum_multiple', case when s.first_unit_price_raw > 0 then round(s.unit_price_raw / s.first_unit_price_raw, 4) else null end,
    'peak_hold_pct', case when s.peak_unit_price_raw > 0 then round(s.unit_price_raw * 100 / s.peak_unit_price_raw, 2) else null end,
    'holder_count', s.holder_count,
    'top_10_holder_pct', s.top_10_holder_pct,
    'creator_balance_pct', s.creator_balance_pct,
    'signal_price_usd', s.signal_price_usd,
    'signal_market_cap_usd', s.signal_market_cap_usd,
    'signal_volume_usd', s.signal_volume_usd,
    'followup_trades', coalesce(s.followup_trades, 0) + coalesce(s.market_followup_trades, 0),
    'outcome_scope', case when coalesce(s.market_followup_trades, 0) > 0 then 'full_market' else 'curve_only' end,
    'future_peak_multiple', round(s.future_peak_multiple, 4),
    'future_low_multiple', round(s.future_low_multiple, 4),
    'final_multiple', round(s.final_multiple, 4),
    'pre_target_low_multiples', coalesce(s.pre_target_low_multiples, '{}'::jsonb),
    'post_2x_pre_target_low_multiples', coalesce(s.post_2x_pre_target_low_multiples, '{}'::jsonb)
  ) order by s.signal_at), '[]'::jsonb)
  from outcomes s
  join public.launches l on l.token_address = s.token_address
  join public.launch_metrics m on m.token_address = s.token_address;
$$;

revoke execute on function public.get_ponseye_full_funnel_dataset(integer, integer, numeric, integer, integer, numeric, boolean)
  from public, anon, authenticated;
grant execute on function public.get_ponseye_full_funnel_dataset(integer, integer, numeric, integer, integer, numeric, boolean)
  to service_role;

comment on function public.get_ponseye_full_funnel_dataset(integer, integer, numeric, integer, integer, numeric, boolean) is
  'Replays the full Sighted to Surveilling gate and all later entry and exit evidence from the first qualifying checkpoint, using a single pass over each future price path.';
