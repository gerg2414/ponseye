create or replace function public.build_ponseye_lab_dataset()
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
      e.rule_version,
      nullif(e.metrics_snapshot ->> 'last_unit_price_raw', '')::numeric as signal_price
    from public.research_events e
    where e.stage = 'under_watch'
      and e.rule_version in ('pons-momentum-v1', 'pons-momentum-v2')
  ),
  outcomes as (
    select
      s.*,
      calibration.usd_factor,
      curve.followup_trades,
      curve.future_peak_price,
      market.market_followup_trades,
      market.market_peak_price_usd,
      journey.future_low_multiple,
      journey.final_multiple,
      journey.pre_target_low_multiples,
      journey.post_2x_pre_target_low_multiples
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
    left join lateral (
      with price_path as (
        select
          t.block_time,
          'c:' || t.event_id as event_key,
          (t.quote_amount_raw / nullif(t.token_amount_raw, 0)) / nullif(s.signal_price, 0) as multiple
        from public.trades t
        where t.token_address = s.token_address
          and t.block_time > s.signal_at
          and t.quote_amount_raw > 0
          and t.token_amount_raw > 0

        union all

        select
          md.block_time,
          'm:' || md.market_event_id as event_key,
          md.price_usd / nullif(s.signal_price * calibration.usd_factor, 0) as multiple
        from public.trade_market_data md
        where md.token_address = s.token_address
          and md.block_time > s.signal_at
          and md.price_usd > 0
          and calibration.usd_factor > 0
      ),
      valid_path as (
        select p.block_time, p.event_key, p.multiple
        from price_path p
        where p.multiple > 0
      )
      select
        (select min(p.multiple) from valid_path p) as future_low_multiple,
        (select p.multiple from valid_path p order by p.block_time desc, p.event_key desc limit 1) as final_multiple,
        jsonb_build_object(
          '1.5', (select min(p.multiple) from valid_path p where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 1.5), 'infinity'::timestamptz)),
          '2', (select min(p.multiple) from valid_path p where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz)),
          '3', (select min(p.multiple) from valid_path p where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 3), 'infinity'::timestamptz)),
          '5', (select min(p.multiple) from valid_path p where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 5), 'infinity'::timestamptz)),
          '10', (select min(p.multiple) from valid_path p where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 10), 'infinity'::timestamptz)),
          '20', (select min(p.multiple) from valid_path p where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 20), 'infinity'::timestamptz)),
          '50', (select min(p.multiple) from valid_path p where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 50), 'infinity'::timestamptz)),
          '100', (select min(p.multiple) from valid_path p where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 100), 'infinity'::timestamptz))
        ) as pre_target_low_multiples,
        jsonb_build_object(
          '3', (
            select min(p.multiple)
            from valid_path p
            where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz)
              and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 3), 'infinity'::timestamptz)
          ),
          '5', (
            select min(p.multiple)
            from valid_path p
            where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz)
              and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 5), 'infinity'::timestamptz)
          ),
          '10', (
            select min(p.multiple)
            from valid_path p
            where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz)
              and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 10), 'infinity'::timestamptz)
          ),
          '20', (
            select min(p.multiple)
            from valid_path p
            where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz)
              and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 20), 'infinity'::timestamptz)
          ),
          '50', (
            select min(p.multiple)
            from valid_path p
            where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz)
              and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 50), 'infinity'::timestamptz)
          ),
          '100', (
            select min(p.multiple)
            from valid_path p
            where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz)
              and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 100), 'infinity'::timestamptz)
          )
        ) as post_2x_pre_target_low_multiples
    ) journey on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'token_address', s.token_address,
    'name', l.name,
    'symbol', l.symbol,
    'image_url', l.image_url,
    'launched_at', l.launched_at,
    'signal_at', s.signal_at,
    'signal_rule_version', s.rule_version,
    'signal_age_seconds', round(extract(epoch from (s.signal_at - l.launched_at))::numeric, 2),
    'status', l.status,
    'actual_state', m.research_state,
    'actual_acquired', exists (
      select 1
      from public.research_events acquired
      where acquired.token_address = s.token_address
        and acquired.stage = 'target_locked'
        and acquired.observed_at >= s.signal_at
    ),
    'actual_binned', exists (
      select 1
      from public.research_events binned
      where binned.token_address = s.token_address
        and binned.stage = 'binned'
        and binned.observed_at >= s.signal_at
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
    'future_low_multiple', round(s.future_low_multiple, 4),
    'final_multiple', round(s.final_multiple, 4),
    'pre_target_low_multiples', s.pre_target_low_multiples,
    'post_2x_pre_target_low_multiples', s.post_2x_pre_target_low_multiples,
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

revoke execute on function public.build_ponseye_lab_dataset() from public, anon, authenticated;
grant execute on function public.build_ponseye_lab_dataset() to service_role;

comment on function public.build_ponseye_lab_dataset() is
  'Time-aware v1 and v2 Surveillance checkpoints with entry, target, break-even and initials exit paths.';

select public.refresh_ponseye_lab_dataset();
