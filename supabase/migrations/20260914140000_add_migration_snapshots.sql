-- Point-in-time snapshots of each migrated token at fixed ages.
--
-- The columns on bitquery_migration_test are cumulative from migration to now
-- and are updated in place, so they already contain the outcome: a token that
-- ran has enormous volume *because* it ran. Selecting on them finds that the
-- outcome predicts the outcome. Nothing on that table can answer "what did this
-- look like ten minutes in", because that was never recorded.
--
-- Each row here is one token observed at one age, holding only what was
-- knowable at that moment, alongside what happened afterwards. Features come
-- from before the observation, outcomes from after it, and the two never mix.

create table if not exists public.bitquery_migration_snapshots (
  token_address text not null references public.bitquery_migration_test(token_address) on delete cascade,
  -- Age of the token at observation, in seconds since graduation.
  age_seconds integer not null,

  -- ---- Observable at age_seconds -----------------------------------------
  price_usd numeric,
  market_cap_usd numeric,
  -- Market cap divided by the graduation market cap.
  multiple_from_migration numeric,
  -- Cumulative traded volume from graduation to this age.
  volume_usd numeric,
  -- Volume over graduation market cap. The strongest separator found so far:
  -- around 0.49 at one minute for tokens that later reached 10x, against 0.25
  -- for those that did not, while price at one minute separates not at all.
  volume_to_migration_mc numeric,
  -- Volume in the single minute ending at this age, for burst detection.
  volume_last_minute_usd numeric,
  -- Highest and lowest market cap seen between graduation and this age.
  high_market_cap_usd numeric,
  low_market_cap_usd numeric,
  -- Drawdown from the high seen so far, as a fraction.
  drawdown_from_high numeric,
  -- Minutes between graduation and this age that recorded any trade.
  active_minutes integer,

  -- ---- Outcome, strictly after age_seconds --------------------------------
  -- Highest market cap recorded after this observation.
  future_high_market_cap_usd numeric,
  -- Future high over the market cap at this age. This is the honest label: the
  -- return available to someone entering here, not from the graduation price.
  future_multiple numeric,
  -- Minutes from this observation to that high.
  minutes_to_future_high integer,
  -- Market cap a fixed distance ahead, for holding-period questions.
  market_cap_1h_later numeric,
  market_cap_6h_later numeric,
  market_cap_24h_later numeric,

  -- ---- Bookkeeping --------------------------------------------------------
  -- How much history existed when this row was built. A snapshot whose horizon
  -- is short has not had time to reach its high, so comparing it against a
  -- fully matured one biases the result downwards.
  observed_horizon_minutes integer,
  candles_seen integer,
  computed_at timestamptz not null default now(),

  primary key (token_address, age_seconds)
);

comment on table public.bitquery_migration_snapshots is
  'One row per token per age. Features are measured strictly before age_seconds, outcomes strictly after, so a rule tested here cannot see its own answer.';
comment on column public.bitquery_migration_snapshots.future_multiple is
  'Highest market cap after this age divided by the market cap at this age.';
comment on column public.bitquery_migration_snapshots.observed_horizon_minutes is
  'Minutes of history available after this age. Filter on it before comparing outcomes.';

create index if not exists bitquery_migration_snapshots_age_idx
  on public.bitquery_migration_snapshots (age_seconds, future_multiple desc nulls last);

create index if not exists bitquery_migration_snapshots_signal_idx
  on public.bitquery_migration_snapshots (age_seconds, volume_to_migration_mc desc nulls last);

alter table public.bitquery_migration_snapshots enable row level security;
revoke all on public.bitquery_migration_snapshots from anon, authenticated;
grant select, insert, update, delete on public.bitquery_migration_snapshots to service_role;
