create or replace function public.get_ponseye_lab_dataset()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with signals as (
    select
      e.token_address,
      e.observed_at as signal_at,
      e.metrics_snapshot,
      nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric as signal_price
    from public.research_events e
    where e.stage = 'under_watch'
      and e.rule_version = 'pons-momentum-v1'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'token_address', s.token_address,
    'name', l.name,
    'symbol', l.symbol,
    'image_url', l.image_url,
    'launched_at', l.launched_at,
    'signal_at', s.signal_at,
    'status', l.status,
    'actual_state', m.research_state,
    'actual_acquired', exists (
      select 1
      from public.research_events acquired
      where acquired.token_address = s.token_address
        and acquired.stage = 'target_locked'
        and acquired.rule_version = 'pons-momentum-v1'
    ),
    'actual_binned', exists (
      select 1
      from public.research_events binned
      where binned.token_address = s.token_address
        and binned.stage = 'binned'
        and binned.rule_version = 'pons-momentum-v1'
    ),
    'trade_count', coalesce((s.metrics_snapshot ->> 'trade_count')::integer, 0),
    'buys', coalesce((s.metrics_snapshot ->> 'buys')::integer, 0),
    'sells', coalesce((s.metrics_snapshot ->> 'sells')::integer, 0),
    'unique_traders', coalesce((s.metrics_snapshot ->> 'unique_traders')::integer, 0),
    'buy_pressure_pct', nullif(s.metrics_snapshot ->> 'buy_pressure_pct', '')::numeric,
    'creator_sells', coalesce((s.metrics_snapshot ->> 'creator_sells')::integer, 0),
    'first_minute_buyers', coalesce((s.metrics_snapshot ->> 'first_minute_buyers')::integer, 0),
    'momentum_multiple', case
      when nullif(s.metrics_snapshot ->> 'first_unit_price_raw', '')::numeric > 0
      then round(
        nullif(s.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric /
        nullif(s.metrics_snapshot ->> 'first_unit_price_raw', '')::numeric,
        4
      )
      else null
    end,
    'peak_hold_pct', case
      when nullif(s.metrics_snapshot ->> 'peak_unit_price_raw', '')::numeric > 0
      then round(
        nullif(s.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric * 100 /
        nullif(s.metrics_snapshot ->> 'peak_unit_price_raw', '')::numeric,
        2
      )
      else null
    end,
    'holder_count', nullif(s.metrics_snapshot ->> 'holder_count', '')::integer,
    'top_10_holder_pct', nullif(s.metrics_snapshot ->> 'top_10_holder_pct', '')::numeric,
    'creator_balance_pct', nullif(s.metrics_snapshot ->> 'creator_balance_pct', '')::numeric,
    'signal_price_usd', nullif(s.metrics_snapshot ->> 'price_usd', '')::numeric,
    'signal_market_cap_usd', case
      when nullif(s.metrics_snapshot ->> 'price_usd', '')::numeric > 0
      then nullif(s.metrics_snapshot ->> 'price_usd', '')::numeric * 1000000000::numeric
      else null
    end,
    'signal_volume_usd', coalesce(nullif(s.metrics_snapshot ->> 'volume_usd', '')::numeric, 0),
    'followup_trades', coalesce(outcome.followup_trades, 0),
    'future_peak_multiple', case
      when s.signal_price > 0 then round(
        greatest(s.signal_price, coalesce(outcome.future_peak_price, s.signal_price)) / s.signal_price,
        4
      )
      else null
    end
  ) order by s.signal_at), '[]'::jsonb)
  from signals s
  join public.launches l on l.token_address = s.token_address
  join public.launch_metrics m on m.token_address = s.token_address
  left join lateral (
    select
      count(*)::integer as followup_trades,
      max(t.quote_amount_raw / nullif(t.token_amount_raw, 0)) as future_peak_price
    from public.trades t
    where t.token_address = s.token_address
      and t.block_time > s.signal_at
      and t.token_amount_raw > 0
  ) outcome on true;
$$;

revoke execute on function public.get_ponseye_lab_dataset() from public, anon, authenticated;
grant execute on function public.get_ponseye_lab_dataset() to service_role;

comment on function public.get_ponseye_lab_dataset() is
  'Compact, time-aware Surveillance checkpoint dataset for the interactive PonsEye Lab.';
