create table public.launches (
  token_address text primary key,
  curve_address text not null unique,
  deployer_address text not null,
  transaction_hash text not null,
  launched_at timestamptz not null,
  block_number bigint,
  factory_or_router text,
  attached_value_raw numeric(78, 0),
  pair_token_address text,
  launch_config_id numeric(78, 0),
  graduation_threshold_raw numeric(78, 0),
  initial_quote_in_raw numeric(78, 0),
  name text,
  symbol text,
  description text,
  image_uri text,
  image_url text,
  twitter_url text,
  telegram_url text,
  discord_url text,
  website_url text,
  farcaster_url text,
  creator_fee_recipient text,
  creator_tax_bps integer,
  buyback_enabled boolean,
  status text not null default 'bonding' check (status in ('bonding', 'swept', 'graduated', 'failed')),
  swept_at timestamptz,
  graduated_at timestamptz,
  graduation_transaction_hash text,
  raw_launch_call jsonb,
  raw_factory_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint launches_token_address_format check (token_address ~ '^0x[0-9a-f]{40}$'),
  constraint launches_curve_address_format check (curve_address ~ '^0x[0-9a-f]{40}$'),
  constraint launches_deployer_address_format check (deployer_address ~ '^0x[0-9a-f]{40}$')
);

create index launches_launched_at_idx on public.launches (launched_at desc);
create index launches_deployer_idx on public.launches (deployer_address, launched_at desc);
create index launches_status_idx on public.launches (status, launched_at desc);

create table public.trades (
  event_id text primary key,
  token_address text,
  curve_address text not null,
  transaction_hash text not null,
  block_time timestamptz not null,
  block_number bigint,
  side text not null check (side in ('buy', 'sell')),
  trader_address text,
  recipient_address text,
  quote_amount_raw numeric(78, 0) not null,
  token_amount_raw numeric(78, 0) not null,
  fee_raw numeric(78, 0) not null default 0,
  tax_raw numeric(78, 0) not null default 0,
  raw_event jsonb not null,
  recorded_at timestamptz not null default now(),
  constraint trades_curve_address_format check (curve_address ~ '^0x[0-9a-f]{40}$')
);

create index trades_token_time_idx on public.trades (token_address, block_time);
create index trades_curve_time_idx on public.trades (curve_address, block_time);
create index trades_trader_time_idx on public.trades (trader_address, block_time desc);
create index trades_block_time_idx on public.trades (block_time desc);

create table public.candles (
  token_address text not null,
  timeframe_seconds integer not null check (timeframe_seconds in (60, 300)),
  bucket_time timestamptz not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  buy_volume_raw numeric(78, 0) not null default 0,
  sell_volume_raw numeric(78, 0) not null default 0,
  buys integer not null default 0,
  sells integer not null default 0,
  unique_traders integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (token_address, timeframe_seconds, bucket_time)
);

create index candles_lookup_idx on public.candles (token_address, timeframe_seconds, bucket_time desc);

create table public.research_snapshots (
  token_address text not null,
  horizon_seconds integer not null,
  observed_at timestamptz not null,
  price numeric,
  market_cap numeric,
  drawdown_from_ath_pct numeric,
  return_from_launch_pct numeric,
  holders integer,
  unique_buyers integer,
  buys integer,
  sells integer,
  buy_volume_raw numeric(78, 0),
  sell_volume_raw numeric(78, 0),
  top_10_holder_pct numeric,
  creator_balance_pct numeric,
  raw_metrics jsonb,
  primary key (token_address, horizon_seconds)
);

create index research_snapshots_horizon_idx on public.research_snapshots (horizon_seconds, observed_at desc);

create table public.stream_status (
  feed text primary key,
  status text not null check (status in ('connecting', 'connected', 'error', 'stopped')),
  message text,
  last_seen_at timestamptz not null default now()
);

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger launches_set_updated_at
before update on public.launches
for each row execute function public.set_updated_at();

alter table public.launches enable row level security;
alter table public.trades enable row level security;
alter table public.candles enable row level security;
alter table public.research_snapshots enable row level security;
alter table public.stream_status enable row level security;

revoke all on table public.launches from anon, authenticated;
revoke all on table public.trades from anon, authenticated;
revoke all on table public.candles from anon, authenticated;
revoke all on table public.research_snapshots from anon, authenticated;
revoke all on table public.stream_status from anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
