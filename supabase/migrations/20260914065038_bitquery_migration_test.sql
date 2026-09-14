create table public.bitquery_migration_test (
  token_address text primary key,
  migrated_at timestamptz not null,
  block_number numeric,
  transaction_hash text not null,
  position_id text,
  token_amount_raw text,
  pair_token_amount_raw text,
  quote_token_address text,
  creator_address text,
  name text,
  symbol text,
  migration_price_usd numeric,
  current_price_usd numeric,
  ath_price_usd numeric,
  migration_market_cap_usd numeric,
  current_market_cap_usd numeric,
  ath_market_cap_usd numeric,
  volume_usd numeric,
  trade_count integer not null default 0,
  latest_trade_at timestamptz,
  metrics_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw_graduation jsonb,
  raw_registration jsonb,
  raw_market jsonb
);

create index bitquery_migration_test_time_idx
  on public.bitquery_migration_test (migrated_at desc);

create index bitquery_migration_test_metrics_idx
  on public.bitquery_migration_test (metrics_updated_at asc nulls first)
  where migrated_at >= timestamptz '2026-08-01 00:00:00+00';

alter table public.bitquery_migration_test enable row level security;
revoke all on public.bitquery_migration_test from anon, authenticated;
grant select, insert, update on public.bitquery_migration_test to service_role;

comment on table public.bitquery_migration_test is
  'Isolated Bitquery-only test of PONS PoolGraduated events and post-migration Trading metrics.';
