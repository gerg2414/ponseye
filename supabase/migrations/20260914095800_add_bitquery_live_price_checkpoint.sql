alter table public.bitquery_migration_test
  add column if not exists live_price_updated_at timestamptz;

comment on column public.bitquery_migration_test.live_price_updated_at is
  'Last time the Bitquery Trading WebSocket supplied a live price for this token.';
