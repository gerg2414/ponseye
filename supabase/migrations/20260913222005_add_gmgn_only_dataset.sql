create table public.gmgn_launches (
  token_address text primary key,
  name text,
  symbol text,
  image_url text,
  description text,
  creator_address text,
  launchpad_platform text not null default 'pons',
  exchange text,
  lifecycle_stage text not null default 'new_creation'
    check (lifecycle_stage in ('new_creation', 'near_completion', 'completed')),
  research_state text not null default 'sighted'
    check (research_state in ('sighted', 'under_watch', 'target_locked', 'binned')),
  created_at timestamptz not null,
  opened_at timestamptz,
  completed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  price_usd numeric,
  initial_market_cap_usd numeric,
  market_cap_usd numeric,
  ath_market_cap_usd numeric,
  initial_liquidity_usd numeric,
  liquidity_usd numeric,
  progress_pct numeric,
  total_supply numeric,
  holder_count integer,
  swaps_1m integer not null default 0,
  swaps_1h integer not null default 0,
  swaps_24h integer not null default 0,
  buys_24h integer not null default 0,
  sells_24h integer not null default 0,
  volume_1h_usd numeric not null default 0,
  volume_24h_usd numeric not null default 0,
  price_change_1m_pct numeric,
  price_change_5m_pct numeric,
  price_change_1h_pct numeric,
  top_10_holder_pct numeric,
  creator_balance_pct numeric,
  creator_token_status text,
  smart_money_count integer,
  renowned_count integer,
  sniper_count integer,
  rug_ratio numeric,
  insider_ratio numeric,
  bundler_ratio numeric,
  fresh_wallet_ratio numeric,
  dev_team_hold_ratio numeric,
  liquidity_lock_pct numeric,
  burn_status text,
  open_source_status text,
  owner_renounced_status text,
  is_honeypot boolean,
  is_wash_trading boolean,
  buy_tax numeric,
  sell_tax numeric,
  twitter_url text,
  telegram_url text,
  website_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  candles_checked_at timestamptz,
  updated_at timestamptz not null default now()
);

create index gmgn_launches_recent_idx on public.gmgn_launches (created_at desc);
create index gmgn_launches_state_idx on public.gmgn_launches (research_state, last_seen_at desc);
create index gmgn_launches_stage_idx on public.gmgn_launches (lifecycle_stage, last_seen_at desc);
create index gmgn_launches_market_cap_idx on public.gmgn_launches (market_cap_usd desc);

create table public.gmgn_snapshots (
  token_address text not null references public.gmgn_launches(token_address) on delete cascade,
  observed_minute timestamptz not null,
  observed_at timestamptz not null,
  lifecycle_stage text not null,
  price_usd numeric,
  market_cap_usd numeric,
  ath_market_cap_usd numeric,
  liquidity_usd numeric,
  holder_count integer,
  swaps_1m integer not null default 0,
  swaps_1h integer not null default 0,
  volume_1h_usd numeric not null default 0,
  price_change_1m_pct numeric,
  price_change_5m_pct numeric,
  price_change_1h_pct numeric,
  rug_ratio numeric,
  insider_ratio numeric,
  bundler_ratio numeric,
  smart_money_count integer,
  raw_payload jsonb not null default '{}'::jsonb,
  primary key (token_address, observed_minute)
);

create index gmgn_snapshots_time_idx on public.gmgn_snapshots (observed_at desc);

create table public.gmgn_candles (
  token_address text not null references public.gmgn_launches(token_address) on delete cascade,
  resolution text not null,
  candle_at timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric,
  recorded_at timestamptz not null default now(),
  primary key (token_address, resolution, candle_at)
);

create index gmgn_candles_lookup_idx on public.gmgn_candles (token_address, resolution, candle_at);

alter table public.gmgn_launches enable row level security;
alter table public.gmgn_snapshots enable row level security;
alter table public.gmgn_candles enable row level security;

revoke all on public.gmgn_launches, public.gmgn_snapshots, public.gmgn_candles
  from public, anon, authenticated;
grant select, insert, update on public.gmgn_launches, public.gmgn_snapshots, public.gmgn_candles
  to service_role;

create view public.gmgn_launch_board
with (security_invoker = true)
as
select
  g.token_address,
  ''::text as curve_address,
  g.name,
  g.symbol,
  g.image_url,
  coalesce(g.creator_address, '') as deployer_address,
  null::text as pair_token_address,
  case when g.lifecycle_stage = 'completed' then 'graduated' else 'active' end as status,
  g.created_at as launched_at,
  null::timestamptz as swept_at,
  g.completed_at as graduated_at,
  g.swaps_24h as trade_count,
  g.buys_24h as buys,
  g.sells_24h as sells,
  0::integer as unique_traders,
  '0'::numeric as net_quote_raw,
  g.last_seen_at as last_trade_at,
  null::numeric as graduation_threshold_raw,
  g.progress_pct,
  g.volume_24h_usd as volume_quote_raw,
  null::numeric as last_quote_amount_raw,
  null::numeric as last_token_amount_raw,
  case when g.initial_market_cap_usd > 0 then g.ath_market_cap_usd / g.initial_market_cap_usd end as peak_multiple,
  case when g.ath_market_cap_usd > 0 then greatest(0, (1 - g.market_cap_usd / g.ath_market_cap_usd) * 100) end as drawdown_from_peak_pct,
  case when g.buys_24h + g.sells_24h > 0 then g.buys_24h::numeric * 100 / (g.buys_24h + g.sells_24h) end as buy_pressure_pct,
  0::integer as creator_trades,
  case when g.creator_token_status = 'creator_close' then 1 else 0 end as creator_sells,
  0::integer as first_minute_buyers,
  null::numeric as largest_buy_quote_raw,
  g.last_seen_at as holder_snapshot_at,
  g.holder_count,
  null::integer as holder_change_5m,
  null::numeric as largest_holder_pct,
  g.top_10_holder_pct,
  null::numeric as top_100_holder_pct,
  g.creator_balance_pct,
  g.price_usd,
  g.volume_24h_usd as volume_usd,
  g.market_cap_usd,
  g.ath_market_cap_usd,
  g.last_seen_at as usd_price_at,
  g.research_state,
  g.last_seen_at as research_state_at,
  'gmgn-clean-v1'::text as research_rule_version,
  array['gmgn_' || g.lifecycle_stage]::text[] as research_reasons
from public.gmgn_launches g;

revoke all on public.gmgn_launch_board from public, anon, authenticated;
grant select on public.gmgn_launch_board to service_role;

create or replace function public.get_dashboard_home(p_limit integer default 200)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with selected as (
    select * from public.gmgn_launch_board
    where research_state <> 'binned'
    order by research_state_at desc
    limit greatest(1, least(p_limit, 200))
  ), counts as (
    select
      count(*) filter (where research_state = 'sighted') as sighted,
      count(*) filter (where research_state = 'under_watch') as under_watch,
      count(*) filter (where research_state = 'target_locked') as target_locked
    from public.gmgn_launches
  )
  select jsonb_build_object(
    'launches', coalesce((select jsonb_agg(to_jsonb(s) order by s.research_state_at desc) from selected s), '[]'::jsonb),
    'streams', coalesce((
      select jsonb_agg(to_jsonb(st) order by st.feed)
      from (
        select feed, status, last_seen_at
        from public.stream_status
        where feed like 'gmgn_%'
      ) st
    ), '[]'::jsonb),
    'researchCounts', jsonb_build_object(
      'sighted', (select sighted from counts),
      'under_watch', (select under_watch from counts),
      'target_locked', (select target_locked from counts)
    ),
    'launchCount', (select count(*) from public.gmgn_launches),
    'tradeCount', (select count(*) from public.gmgn_snapshots)
  );
$$;

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
        'description', g.description,
        'twitter_url', g.twitter_url,
        'telegram_url', g.telegram_url,
        'discord_url', null,
        'website_url', g.website_url
      )
      from public.gmgn_launch_board b
      join public.gmgn_launches g on g.token_address = b.token_address
      where b.token_address = lower(p_token_address)
    ),
    'trades', '[]'::jsonb,
    'marketTrades', '[]'::jsonb,
    'chartCandles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'time', c.candle_at,
        'open', c.open,
        'high', c.high,
        'low', c.low,
        'close', c.close
      ) order by c.candle_at)
      from public.gmgn_candles c
      where c.token_address = lower(p_token_address)
        and c.resolution = '1m'
    ), '[]'::jsonb),
    'bondPriceUsd', null,
    'poolStartedAt', (select opened_at from public.gmgn_launches where token_address = lower(p_token_address))
  );
$$;

create or replace function public.get_ponseye_lab_dataset()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select '[]'::jsonb; $$;

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
as $$ select '[]'::jsonb; $$;

create or replace function public.get_capital_circuit_analytics()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select jsonb_build_object('dailyFunnel', '[]'::jsonb); $$;

update public.ponseye_lab_cache
set payload = '[]'::jsonb,
    refreshed_at = now()
where cache_key;

insert into public.stream_status (feed, status, message, last_seen_at)
values ('gmgn_trenches', 'stopped', 'GMGN recorder prepared and intentionally disabled', now())
on conflict (feed) do update
set status = excluded.status,
    message = excluded.message,
    last_seen_at = excluded.last_seen_at;

update public.recorder_control
set enabled = false,
    updated_at = now(),
    updated_by = 'gmgn_clean_slate_migration'
where id = 1;

revoke execute on function public.get_dashboard_home(integer) from public, anon, authenticated;
revoke execute on function public.get_launch_detail(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.get_ponseye_lab_dataset() from public, anon, authenticated;
revoke execute on function public.get_ponseye_full_funnel_dataset(integer, integer, numeric, integer, integer, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.get_capital_circuit_analytics() from public, anon, authenticated;

grant execute on function public.get_dashboard_home(integer) to service_role;
grant execute on function public.get_launch_detail(text, integer, integer) to service_role;
grant execute on function public.get_ponseye_lab_dataset() to service_role;
grant execute on function public.get_ponseye_full_funnel_dataset(integer, integer, numeric, integer, integer, numeric, boolean) to service_role;
grant execute on function public.get_capital_circuit_analytics() to service_role;

comment on table public.gmgn_launches is 'Clean GMGN-only PONS launch dataset. Legacy Bitquery rows remain archived in their original tables.';
comment on table public.gmgn_snapshots is 'Minute snapshots returned directly by GMGN Trenches.';
comment on table public.gmgn_candles is 'Official GMGN market candles used by the chart and future profile testing.';
