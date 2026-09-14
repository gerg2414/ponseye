alter table public.bitquery_migration_test
  add column if not exists trade_flow_updated_at timestamptz;

