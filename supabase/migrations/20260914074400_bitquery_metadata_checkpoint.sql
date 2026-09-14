alter table public.bitquery_migration_test
  add column if not exists metadata_updated_at timestamptz,
  add column if not exists metadata_source text;

