create table public.gmgn_shadow_launches (
  token_address text primary key,
  category text not null check (category in ('new_creation', 'near_completion', 'completed')),
  launchpad_platform text,
  launched_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  name text,
  symbol text,
  image_url text,
  creator_address text,
  price_usd numeric,
  market_cap_usd numeric,
  liquidity_usd numeric,
  progress numeric,
  holder_count integer,
  raw_token jsonb not null default '{}'::jsonb,
  constraint gmgn_shadow_token_address_format check (token_address ~ '^0x[0-9a-f]{40}$'),
  constraint gmgn_shadow_creator_address_format check (
    creator_address is null or creator_address ~ '^0x[0-9a-f]{40}$'
  ),
  constraint gmgn_shadow_progress_range check (progress is null or progress between 0 and 1),
  constraint gmgn_shadow_holder_count_nonnegative check (holder_count is null or holder_count >= 0),
  constraint gmgn_shadow_seen_order check (last_seen_at >= first_seen_at)
);

create index gmgn_shadow_first_seen_idx
  on public.gmgn_shadow_launches (first_seen_at desc);

create index gmgn_shadow_category_seen_idx
  on public.gmgn_shadow_launches (category, last_seen_at desc);

comment on table public.gmgn_shadow_launches is
  'Latest read-only GMGN Trenches record for each Pons token, kept separate from Bitquery evidence for feed comparison.';

alter table public.gmgn_shadow_launches enable row level security;
revoke all on table public.gmgn_shadow_launches from anon, authenticated;

create view public.gmgn_shadow_comparison
with (security_invoker = true)
as
select
  g.token_address,
  g.category as gmgn_category,
  g.launchpad_platform,
  g.launched_at as gmgn_launched_at,
  g.first_seen_at as gmgn_first_seen_at,
  g.last_seen_at as gmgn_last_seen_at,
  g.name as gmgn_name,
  g.symbol as gmgn_symbol,
  g.image_url as gmgn_image_url,
  l.created_at as bitquery_first_seen_at,
  l.launched_at as chain_launched_at,
  l.token_address is not null as matched_by_bitquery,
  case
    when l.created_at is null then null
    else extract(epoch from (l.created_at - g.first_seen_at))
  end as bitquery_minus_gmgn_seconds
from public.gmgn_shadow_launches g
left join public.launches l using (token_address);

revoke all on table public.gmgn_shadow_comparison from anon, authenticated;

comment on view public.gmgn_shadow_comparison is
  'Compares GMGN first detection with the matching Bitquery-backed PonsEye launch record.';
