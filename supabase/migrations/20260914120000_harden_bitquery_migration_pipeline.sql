-- Harden the Bitquery migration pipeline so the recorded dataset can be trusted
-- for strategy backtests.
--
-- Three separate writers (the WebSocket price stream, the batched live metrics
-- poll and the deeper history pass) all update the same row from their own
-- snapshot. Without a guard in the database the slowest writer wins, which
-- silently erases price peaks and replays stale prices over fresh ones.

alter table public.bitquery_migration_test
  -- When the current price was observed at source, so a late write carrying an
  -- older observation cannot overwrite a newer one.
  add column if not exists price_observed_at timestamptz,
  -- The graduation price is historical and measured exactly once per token.
  add column if not exists migration_price_checked_at timestamptz,
  add column if not exists migration_price_attempts integer not null default 0,
  add column if not exists migration_price_source text,
  -- Circulating supply reported by Bitquery. PONS tokens are minted at one
  -- billion, but reading the real value keeps market caps correct if that ever
  -- stops being true for a launch.
  add column if not exists token_supply numeric;

comment on column public.bitquery_migration_test.price_observed_at is
  'Source timestamp of current_price_usd. Used to reject stale price writes.';
comment on column public.bitquery_migration_test.migration_price_checked_at is
  'Last attempt at measuring the graduation price. Null means never attempted.';
comment on column public.bitquery_migration_test.migration_price_source is
  'How migration_price_usd was measured, e.g. graduation_candle_open.';

-- Existing migration prices were measured from the first candle strictly after
-- the graduation timestamp, which is the candle *following* the one containing
-- the graduation. Those values are a minute late and sit on the wrong side of
-- the launch spike. Clear them so the corrected pass measures them again.
update public.bitquery_migration_test
set
  migration_price_usd = null,
  migration_market_cap_usd = null,
  migration_price_checked_at = null,
  migration_price_attempts = 0,
  migration_price_source = null
where migration_price_source is null;

create or replace function public.bitquery_migration_test_price_guard()
returns trigger
language plpgsql
as $$
begin
  -- greatest() ignores nulls in Postgres, so an unmeasured side never wins.
  new.ath_price_usd := greatest(new.ath_price_usd, old.ath_price_usd);
  new.ath_market_cap_usd := greatest(new.ath_market_cap_usd, old.ath_market_cap_usd);
  new.latest_trade_at := greatest(new.latest_trade_at, old.latest_trade_at);

  -- Keep the freshest observation of the live price rather than the last write.
  if new.price_observed_at is not null
     and old.price_observed_at is not null
     and new.price_observed_at < old.price_observed_at then
    new.current_price_usd := old.current_price_usd;
    new.current_market_cap_usd := old.current_market_cap_usd;
    new.price_observed_at := old.price_observed_at;
  end if;

  -- The graduation price never changes once it has been measured properly.
  if old.migration_price_usd is not null and old.migration_price_source is not null then
    new.migration_price_usd := old.migration_price_usd;
    new.migration_market_cap_usd := old.migration_market_cap_usd;
    new.migration_price_source := old.migration_price_source;
    new.migration_price_checked_at := old.migration_price_checked_at;
  end if;

  return new;
end;
$$;

revoke all on function public.bitquery_migration_test_price_guard() from public, anon, authenticated;

drop trigger if exists bitquery_migration_test_price_guard on public.bitquery_migration_test;
create trigger bitquery_migration_test_price_guard
  before update on public.bitquery_migration_test
  for each row execute function public.bitquery_migration_test_price_guard();

-- Queue for tokens whose graduation price has not been measured yet. Partial so
-- it stays small no matter how large the table grows.
create index if not exists bitquery_migration_test_pending_migration_price_idx
  on public.bitquery_migration_test (migration_price_checked_at asc nulls first, migrated_at desc)
  where migration_price_usd is null;

-- Drives the rolling-window scans that refresh live metrics.
create index if not exists bitquery_migration_test_trade_flow_idx
  on public.bitquery_migration_test (trade_flow_updated_at asc nulls first, migrated_at desc);

-- Serves the dashboard, which sorts a time window by peak multiple and size.
create index if not exists bitquery_migration_test_window_idx
  on public.bitquery_migration_test (migrated_at desc, ath_market_cap_usd desc nulls last);

-- The peak multiple is the headline number on the dashboard and was previously
-- recomputed in JavaScript after fetching every row in the window. As a stored
-- column it can be filtered, sorted and indexed in the database instead.
alter table public.bitquery_migration_test
  add column if not exists peak_multiple numeric
  generated always as (
    case
      when migration_market_cap_usd is not null
        and migration_market_cap_usd > 0
        and ath_market_cap_usd is not null
      then ath_market_cap_usd / migration_market_cap_usd
    end
  ) stored;

comment on column public.bitquery_migration_test.peak_multiple is
  'Post-migration peak market cap divided by market cap at graduation.';

create index if not exists bitquery_migration_test_peak_multiple_idx
  on public.bitquery_migration_test (migrated_at desc, peak_multiple desc nulls last);
