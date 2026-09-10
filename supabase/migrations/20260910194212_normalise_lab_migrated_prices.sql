create index if not exists trades_token_transaction_idx
  on public.trades (token_address, transaction_hash);

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
  ),
  outcomes as (
    select
      s.*,
      calibration.usd_factor,
      curve.followup_trades,
      curve.future_peak_price,
      market.market_followup_trades,
      market.market_peak_price_usd
    from signals s
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
    left join lateral (
      select
        count(*)::integer as followup_trades,
        max(t.quote_amount_raw / nullif(t.token_amount_raw, 0)) as future_peak_price
      from public.trades t
      where t.token_address = s.token_address
        and t.block_time > s.signal_at
        and t.token_amount_raw > 0
    ) curve on true
    left join lateral (
      select
        count(*)::integer as market_followup_trades,
        max(md.price_usd) filter (where md.price_usd > 0) as market_peak_price_usd
      from public.trade_market_data md
      where md.token_address = s.token_address
        and md.block_time > s.signal_at
    ) market on true
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
    'signal_price_usd', case
      when s.signal_price > 0 and s.usd_factor > 0 then s.signal_price * s.usd_factor
      else nullif(s.metrics_snapshot ->> 'price_usd', '')::numeric
    end,
    'signal_market_cap_usd', case
      when s.signal_price > 0 and s.usd_factor > 0
        then s.signal_price * s.usd_factor * 1000000000::numeric
      when nullif(s.metrics_snapshot ->> 'price_usd', '')::numeric > 0
        then nullif(s.metrics_snapshot ->> 'price_usd', '')::numeric * 1000000000::numeric
      else null
    end,
    'signal_volume_usd', coalesce(nullif(s.metrics_snapshot ->> 'volume_usd', '')::numeric, 0),
    'followup_trades', coalesce(s.followup_trades, 0) + coalesce(s.market_followup_trades, 0),
    'outcome_scope', case
      when s.usd_factor > 0 and s.market_peak_price_usd > 0 then 'full_market'
      else 'curve_only'
    end,
    'future_peak_multiple', case
      when s.signal_price > 0 and s.usd_factor > 0 then round(
        greatest(
          s.signal_price * s.usd_factor,
          coalesce(s.future_peak_price * s.usd_factor, s.signal_price * s.usd_factor),
          coalesce(s.market_peak_price_usd, s.signal_price * s.usd_factor)
        ) / (s.signal_price * s.usd_factor),
        4
      )
      when s.signal_price > 0 then round(
        greatest(s.signal_price, coalesce(s.future_peak_price, s.signal_price)) / s.signal_price,
        4
      )
      else null
    end
  ) order by s.signal_at), '[]'::jsonb)
  from outcomes s
  join public.launches l on l.token_address = s.token_address
  join public.launch_metrics m on m.token_address = s.token_address;
$$;

revoke execute on function public.get_ponseye_lab_dataset() from public, anon, authenticated;
grant execute on function public.get_ponseye_lab_dataset() to service_role;

comment on function public.get_ponseye_lab_dataset() is
  'Time-aware Surveillance checkpoints with curve and migrated-pool outcomes normalised to USD.';
