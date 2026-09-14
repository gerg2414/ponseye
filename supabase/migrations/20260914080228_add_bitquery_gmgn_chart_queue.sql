alter table public.bitquery_migration_test
  add column if not exists gmgn_chart_requested_at timestamptz,
  add column if not exists gmgn_chart_updated_at timestamptz;

create table if not exists public.bitquery_migration_test_candles (
  token_address text not null references public.bitquery_migration_test(token_address) on delete cascade,
  resolution text not null default '1m',
  candle_at timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric,
  recorded_at timestamptz not null default now(),
  primary key (token_address, resolution, candle_at)
);

create index if not exists bitquery_migration_test_candles_lookup_idx
  on public.bitquery_migration_test_candles (token_address, resolution, candle_at);

alter table public.bitquery_migration_test_candles enable row level security;
revoke all on public.bitquery_migration_test_candles from public, anon, authenticated;
grant select, insert, update on public.bitquery_migration_test_candles to service_role;

comment on table public.bitquery_migration_test_candles is
  'GMGN one minute candles used only by the isolated Bitquery migration test detail pages.';
