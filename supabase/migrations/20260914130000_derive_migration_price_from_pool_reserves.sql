-- Derive the graduation price from the pool reserves recorded in the graduation
-- event instead of reading it from the first candle.
--
-- PONS seeds every graduating pool with a near-constant 204.08M tokens, so the
-- graduation market cap is a constant that moves only with the quote token's USD
-- price. Measured across 188 native-quote migrations the derived value is
-- $51,681 on every row (coefficient of variation 0.000), against 0.375 for the
-- value read from the first candle.
--
-- The first candle's Open is the bonding curve exit price, not the seeded pool
-- price. Its High is the seeded price. Recording the Open understated the
-- graduation market cap by up to 12x and inflated the peak multiple by the same
-- factor, so tokens that never exceeded their graduation price were recorded as
-- large winners. CROSSPAD was stored as a 31.69x peak against a true 2.62x, and
-- TESTICLES as 11.7x against a true 0.99x.

alter table public.bitquery_migration_test
  -- USD price of the quote token at the graduation minute, kept so a derived
  -- price can be audited without re-querying Bitquery.
  add column if not exists quote_usd_rate numeric,
  -- 10^(18 - quote decimals), which converts the raw reserve ratio into a
  -- decimal-adjusted price. Inferred per token by rounding to the nearest power
  -- of ten, since the true value is always a power of ten.
  add column if not exists quote_raw_scale numeric;

comment on column public.bitquery_migration_test.quote_usd_rate is
  'Quote token USD price at graduation, from the ratio of the USD-quoted and quote-denominated pair prices.';
comment on column public.bitquery_migration_test.quote_raw_scale is
  'Power-of-ten scale applied to pair_token_amount_raw / token_amount_raw.';

-- Values still carrying the untrusted label are re-measured by the recorder.
-- Clearing the checkpoint puts them back on the queue; the price guard only
-- freezes a row once its source is 'pool_reserves'.
update public.bitquery_migration_test
set migration_price_checked_at = null,
    migration_price_attempts = 0
where migration_price_source is distinct from 'pool_reserves';

-- The pending queue keys off a null price, but rows carrying an untrusted price
-- also need re-measuring, so index on the source instead.
drop index if exists public.bitquery_migration_test_pending_migration_price_idx;
create index if not exists bitquery_migration_test_pending_migration_price_idx
  on public.bitquery_migration_test (migration_price_checked_at asc nulls first, migrated_at desc)
  where migration_price_source is distinct from 'pool_reserves';
