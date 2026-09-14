create table if not exists public.bitquery_launch_metadata_test (
  token_address text primary key,
  launched_at timestamptz,
  name text,
  symbol text,
  image_url text,
  description text,
  twitter_url text,
  telegram_url text,
  discord_url text,
  website_url text,
  farcaster_url text,
  creator_address text,
  creator_tax_bps integer,
  buyback_enabled boolean,
  raw_call jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bitquery_launch_metadata_test enable row level security;
revoke all on public.bitquery_launch_metadata_test from anon, authenticated;
grant all on public.bitquery_launch_metadata_test to service_role;

create index if not exists bitquery_launch_metadata_test_launched_at_idx
  on public.bitquery_launch_metadata_test (launched_at desc);
