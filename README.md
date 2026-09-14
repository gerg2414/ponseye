# PonsEye

PonsEye records PONS pool graduations on Robinhood Chain from Bitquery and keeps
a rolling window of migrated tokens updated with market data, so launch
behaviour can be measured and strategies tested against it.

## Structure

* `apps/recorder` is the continuous Railway worker.
* `apps/dashboard` is the Next.js research dashboard for Vercel.
* `supabase/migrations` contains the database schema.

## Local setup

1. Copy `.env.example` to `.env` at the repository root and fill it in. Never
   commit it. `apps/dashboard/.env.local` is a symlink to that file, so the
   dashboard and the recorder read the same values.
2. Run `npm install`.
3. Apply the Supabase migrations.
4. Run `npm run dev:recorder` and `npm run dev:dashboard` in separate terminals.

Leave `BITQUERY_MIGRATION_TEST_ENABLED=false` unless you mean the local recorder
to write to the database Railway is already writing to.

## How the recorder works

One loop runs several independent stages, each with its own interval and its own
backoff. A stage that fails does not stop the others: losing metadata sync must
never stop graduations being recorded.

| Stage | What it does |
| --- | --- |
| `migrations` | PONS `PoolGraduated` events and the matching pool registrations |
| `launch-metadata` | Decodes launch calls for names, images and socials |
| `launch-backfill` | Walks older launches in thirty minute chunks |
| `metadata-sync` | Applies decoded metadata to migration rows |
| `live-metrics` | Current price and cumulative trade flow, batched |
| `migration-price` | Derives the graduation price, once per token |

A WebSocket subscription runs alongside these for sub-minute price updates.

Every windowed query pages to exhaustion. Bitquery caps a response at 1000 rows
and reports no total, so a single request silently truncates a busy window and
the cursor then moves past the rows it never saw.

`BITQUERY_BACKFILL_HOURS` sets how far back the initial seed reaches.
`BITQUERY_TRACKING_WINDOW_HOURS` sets how long a token keeps receiving live
updates after it migrates. Both default to 48. Rows older than the tracking
window stay in the table as historical record.

## The graduation price

**Never read the graduation price from the first candle.** Bitquery's first
candle after a graduation opens at the bonding curve exit price, not the seeded
pool price, and the price can move more than tenfold inside that one candle.
Reading its `Open` understated the graduation market cap by up to twelve times,
which inflated the peak multiple by the same factor — worst on the tokens that
looked like the biggest winners, which is precisely where a strategy backtest
would be misled.

PONS seeds every graduating pool with a near-constant 204.08M tokens, so the
graduation market cap is a constant per quote token. It is derived as:

    migration_price_usd = (pair_token_amount_raw / token_amount_raw)
                          * quote_raw_scale
                          * quote_usd_rate

`pair_token_amount_raw` and `token_amount_raw` come from the graduation event
itself and are exact. `quote_usd_rate` is the quote token's USD price, taken
from the ratio of the USD-quoted and quote-denominated pair prices for the same
minute. `quote_raw_scale` is `10^(18 - quote decimals)`, inferred by rounding
and then resolved to the mode across each quote token.

A derivation more than a decade away from the price that actually traded is
rejected rather than stored. An unmeasured row is recoverable; a wrong entry
price quietly corrupts every multiple computed against it.

To repair rows after a schema or logic change:

```bash
npm run backfill:migration-prices --workspace=@ponseye/recorder
```

## Bitquery notes

Things that are not what they appear, each confirmed against recorded data:

* `Supply.CirculatingSupply` is `0`. Use `Supply.TotalSupply`. Not every token
  has a one billion supply, so it cannot be assumed either.
* `trades: count` on a candle reports `1` on candles carrying tens of thousands
  of dollars of volume. Take trade counts from the `Trades` flow query instead.
* `limit: {count, offset}` paging works and is the only way to read a window
  larger than 1000 rows.
* A graduation event and its pool registration are separate queries. Fetching
  both in one document costs a page of headroom for no benefit.

## PostgREST notes

* `neq` follows SQL three-valued logic, so `.neq(col, value)` excludes rows where
  the column is null. Use `.or("col.is.null,col.neq.value")` when null means
  "not yet set".
* An upsert is `INSERT ... ON CONFLICT`, so not-null columns must be present even
  when the row already exists.
* Every object in one upsert must carry the same keys. PostgREST fills the ones
  it does not see with the column default, so mixing shapes in one request
  writes nulls over existing values.

## Railway

Create a service from this repository with the root directory set to `/` and the
build command scoped to the recorder workspace. Add the secrets shown in
`.env.example`. Use a current Supabase `sb_secret_...` key, not a browser key.
Railway uses `npm run start` and the recorder exposes `/health` on `PORT`. The
recorder drains on `SIGTERM`, so a redeploy does not kill it mid-write.

## Vercel

Import the same repository and set the root directory to `apps/dashboard`. Add
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` as server-only environment variables.

## Data policy

The Bitquery pipeline writes to `bitquery_migration_test` and
`bitquery_launch_metadata_test`. The earlier GMGN tables remain in the database
but nothing writes to them; the dashboard's other pages still read them and are
therefore showing a frozen dataset.
