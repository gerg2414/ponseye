create table public.lab_funnel_checkpoints (
  token_address text not null references public.launches(token_address),
  event_id text not null,
  observed_at timestamptz not null,
  launch_age_seconds integer not null,
  trade_count integer not null,
  buys integer not null,
  sells integer not null,
  unique_traders integer not null,
  creator_sells integer not null,
  first_minute_buyers integer not null,
  unit_price_raw numeric not null,
  first_unit_price_raw numeric,
  peak_unit_price_raw numeric,
  volume_usd numeric not null default 0,
  price_usd numeric,
  market_cap_usd numeric,
  primary key (token_address, event_id)
);

create index lab_funnel_checkpoints_gate_idx
  on public.lab_funnel_checkpoints (
    launch_age_seconds,
    trade_count,
    unique_traders,
    creator_sells,
    market_cap_usd,
    token_address,
    observed_at
  );

create index lab_funnel_checkpoints_token_time_idx
  on public.lab_funnel_checkpoints (token_address, observed_at);

alter table public.lab_funnel_checkpoints enable row level security;
revoke all on table public.lab_funnel_checkpoints from public, anon, authenticated;
grant select, insert on table public.lab_funnel_checkpoints to service_role;

with marked as (
  select
    t.token_address,
    t.event_id,
    t.block_time,
    t.side,
    t.trader_address,
    t.quote_amount_raw,
    t.token_amount_raw,
    l.launched_at,
    l.deployer_address,
    r.usd_factor * r.raw_scale as raw_usd_factor,
    row_number() over (
      partition by t.token_address, t.trader_address
      order by t.block_time, t.event_id
    ) as trader_event_number,
    row_number() over (
      partition by t.token_address, t.trader_address
      order by
        case when t.side = 'buy' and t.block_time <= l.launched_at + interval '1 minute' then 0 else 1 end,
        t.block_time,
        t.event_id
    ) as early_buy_number
  from public.trades t
  join public.launches l using (token_address)
  left join public.pair_quote_usd_rates r
    on r.pair_token_address is not distinct from l.pair_token_address
  where t.token_address is not null
    and t.quote_amount_raw > 0
    and t.token_amount_raw > 0
), sequenced as (
  select
    m.*,
    m.quote_amount_raw / m.token_amount_raw as unit_price_raw,
    row_number() over token_path as trade_count,
    count(*) filter (where m.side = 'buy') over token_path as buys,
    count(*) filter (where m.side = 'sell') over token_path as sells,
    sum(case when m.trader_address is not null and m.trader_event_number = 1 then 1 else 0 end) over token_path as unique_traders,
    count(*) filter (where m.side = 'sell' and m.trader_address = m.deployer_address) over token_path as creator_sells,
    sum(case when m.side = 'buy' and m.block_time <= m.launched_at + interval '1 minute' and m.early_buy_number = 1 then 1 else 0 end) over token_path as first_minute_buyers,
    first_value(m.quote_amount_raw / m.token_amount_raw) over token_path as first_unit_price_raw,
    max(m.quote_amount_raw / m.token_amount_raw) over token_path as peak_unit_price_raw,
    sum(m.quote_amount_raw) over token_path as volume_quote_raw
  from marked m
  window token_path as (
    partition by m.token_address
    order by m.block_time, m.event_id
    rows between unbounded preceding and current row
  )
)
insert into public.lab_funnel_checkpoints (
  token_address, event_id, observed_at, launch_age_seconds,
  trade_count, buys, sells, unique_traders, creator_sells,
  first_minute_buyers, unit_price_raw, first_unit_price_raw,
  peak_unit_price_raw, volume_usd, price_usd, market_cap_usd
)
select
  s.token_address,
  s.event_id,
  s.block_time,
  greatest(0, floor(extract(epoch from (s.block_time - s.launched_at)))::integer),
  s.trade_count::integer,
  s.buys::integer,
  s.sells::integer,
  s.unique_traders::integer,
  s.creator_sells::integer,
  s.first_minute_buyers::integer,
  s.unit_price_raw,
  s.first_unit_price_raw,
  s.peak_unit_price_raw,
  coalesce(s.volume_quote_raw * s.raw_usd_factor, 0),
  s.unit_price_raw * s.raw_usd_factor,
  s.unit_price_raw * s.raw_usd_factor * 1000000000::numeric
from sequenced s;

create or replace function public.record_lab_funnel_checkpoint()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  launch_time timestamptz;
  metrics public.launch_metrics%rowtype;
  raw_usd_factor numeric;
  unit_price numeric;
begin
  if new.token_address is null or new.quote_amount_raw <= 0 or new.token_amount_raw <= 0 then
    return new;
  end if;

  select l.launched_at, r.usd_factor * r.raw_scale
  into launch_time, raw_usd_factor
  from public.launches l
  left join public.pair_quote_usd_rates r
    on r.pair_token_address is not distinct from l.pair_token_address
  where l.token_address = new.token_address;

  select * into metrics
  from public.launch_metrics m
  where m.token_address = new.token_address;

  unit_price := new.quote_amount_raw / new.token_amount_raw;

  insert into public.lab_funnel_checkpoints (
    token_address, event_id, observed_at, launch_age_seconds,
    trade_count, buys, sells, unique_traders, creator_sells,
    first_minute_buyers, unit_price_raw, first_unit_price_raw,
    peak_unit_price_raw, volume_usd, price_usd, market_cap_usd
  ) values (
    new.token_address,
    new.event_id,
    new.block_time,
    greatest(0, floor(extract(epoch from (new.block_time - launch_time)))::integer),
    metrics.trade_count,
    metrics.buys,
    metrics.sells,
    metrics.unique_traders,
    metrics.creator_sells,
    metrics.first_minute_buyers,
    unit_price,
    metrics.first_unit_price_raw,
    metrics.peak_unit_price_raw,
    coalesce(metrics.volume_quote_raw * raw_usd_factor, 0),
    unit_price * raw_usd_factor,
    unit_price * raw_usd_factor * 1000000000::numeric
  ) on conflict (token_address, event_id) do nothing;

  return new;
end;
$$;

create trigger zz_trades_record_lab_funnel_checkpoint
after insert on public.trades
for each row execute function public.record_lab_funnel_checkpoint();

revoke execute on function public.record_lab_funnel_checkpoint()
  from public, anon, authenticated;
grant execute on function public.record_lab_funnel_checkpoint()
  to service_role;

create or replace function public.get_ponseye_full_funnel_signals(
  p_min_age_seconds integer default 60,
  p_max_age_seconds integer default 900,
  p_min_market_cap_usd numeric default 10000,
  p_min_trades integer default 12,
  p_min_unique_traders integer default 6,
  p_min_buy_pressure_pct numeric default 52,
  p_require_no_creator_sales boolean default true
)
returns table (
  token_address text,
  signal_at timestamptz,
  trade_count integer,
  buys integer,
  sells integer,
  unique_traders integer,
  buy_pressure_pct numeric,
  creator_sells integer,
  first_minute_buyers integer,
  unit_price_raw numeric,
  first_unit_price_raw numeric,
  peak_unit_price_raw numeric,
  signal_price_usd numeric,
  signal_market_cap_usd numeric,
  signal_volume_usd numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (c.token_address)
    c.token_address,
    c.observed_at,
    c.trade_count,
    c.buys,
    c.sells,
    c.unique_traders,
    round(c.buys::numeric * 100 / nullif(c.trade_count, 0), 2),
    c.creator_sells,
    c.first_minute_buyers,
    c.unit_price_raw,
    c.first_unit_price_raw,
    c.peak_unit_price_raw,
    c.price_usd,
    c.market_cap_usd,
    c.volume_usd
  from public.lab_funnel_checkpoints c
  where c.launch_age_seconds >= greatest(0, p_min_age_seconds)
    and c.launch_age_seconds <= greatest(p_min_age_seconds, p_max_age_seconds)
    and c.market_cap_usd >= greatest(0, p_min_market_cap_usd)
    and c.trade_count >= greatest(1, p_min_trades)
    and c.unique_traders >= greatest(1, p_min_unique_traders)
    and c.buys::numeric * 100 >= c.trade_count::numeric * greatest(0, least(100, p_min_buy_pressure_pct))
    and (not p_require_no_creator_sales or c.creator_sells = 0)
  order by c.token_address, c.observed_at, c.event_id;
$$;

revoke execute on function public.get_ponseye_full_funnel_signals(integer, integer, numeric, integer, integer, numeric, boolean)
  from public, anon, authenticated;
grant execute on function public.get_ponseye_full_funnel_signals(integer, integer, numeric, integer, integer, numeric, boolean)
  to service_role;

comment on table public.lab_funnel_checkpoints is
  'Per-trade, point-in-time evidence used to replay the Sighted to Surveilling gate without hindsight.';
comment on function public.get_ponseye_full_funnel_signals(integer, integer, numeric, integer, integer, numeric, boolean) is
  'Returns the first historical checkpoint that passes a configurable Sighted to Surveilling gate.';

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
    left join lateral (
      with price_path as (
        select
          t.block_time,
          'c:' || t.event_id as event_key,
          (t.quote_amount_raw / nullif(t.token_amount_raw, 0)) / nullif(s.unit_price_raw, 0) as multiple,
          false as market_trade
        from public.trades t
        where t.token_address = s.token_address
          and t.block_time > s.signal_at
          and t.quote_amount_raw > 0
          and t.token_amount_raw > 0

        union all

        select
          md.block_time,
          'm:' || md.market_event_id as event_key,
          md.price_usd / nullif(s.signal_price_usd, 0) as multiple,
          true as market_trade
        from public.trade_market_data md
        where md.token_address = s.token_address
          and md.block_time > s.signal_at
          and md.price_usd > 0
          and md.is_launch_price
          and not md.is_price_outlier
      ), valid_path as (
        select p.block_time, p.event_key, p.multiple, p.market_trade
        from price_path p
        where p.multiple > 0
      )
      select
        count(*) filter (where not p.market_trade)::integer as followup_trades,
        count(*) filter (where p.market_trade)::integer as market_followup_trades,
        greatest(1::numeric, coalesce(max(p.multiple), 1::numeric)) as future_peak_multiple,
        min(p.multiple) as future_low_multiple,
        (array_agg(p.multiple order by p.block_time desc, p.event_key desc))[1] as final_multiple,
        jsonb_build_object(
          '1.5', min(p.multiple) filter (where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 1.5), 'infinity'::timestamptz)),
          '2', min(p.multiple) filter (where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz)),
          '3', min(p.multiple) filter (where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 3), 'infinity'::timestamptz)),
          '5', min(p.multiple) filter (where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 5), 'infinity'::timestamptz)),
          '10', min(p.multiple) filter (where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 10), 'infinity'::timestamptz)),
          '20', min(p.multiple) filter (where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 20), 'infinity'::timestamptz)),
          '50', min(p.multiple) filter (where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 50), 'infinity'::timestamptz)),
          '100', min(p.multiple) filter (where p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 100), 'infinity'::timestamptz))
        ) as pre_target_low_multiples,
        jsonb_build_object(
          '3', min(p.multiple) filter (where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz) and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 3), 'infinity'::timestamptz)),
          '5', min(p.multiple) filter (where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz) and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 5), 'infinity'::timestamptz)),
          '10', min(p.multiple) filter (where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz) and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 10), 'infinity'::timestamptz)),
          '20', min(p.multiple) filter (where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz) and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 20), 'infinity'::timestamptz)),
          '50', min(p.multiple) filter (where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz) and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 50), 'infinity'::timestamptz)),
          '100', min(p.multiple) filter (where p.block_time > coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 2), 'infinity'::timestamptz) and p.block_time < coalesce((select min(hit.block_time) from valid_path hit where hit.multiple >= 100), 'infinity'::timestamptz))
        ) as post_2x_pre_target_low_multiples
      from valid_path p
    ) journey on true
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
  'Replays the full Sighted to Surveilling gate and all later entry and exit evidence from the first qualifying checkpoint.';
