# PonsEye

PonsEye records PONS launches from GMGN on Robin Hood Chain so launch behaviour can be measured and tested against the same prices shown on GMGN.

## Structure

* `apps/recorder` is the continuous Railway worker.
* `apps/dashboard` is the Next.js research dashboard for Vercel.
* `supabase/migrations` contains the database schema.

## Local setup

1. Copy `.env.example` to `.env` and fill it locally. Never commit this file.
2. Run `npm install`.
3. Apply the Supabase migration.
4. Run `npm run dev:recorder` and `npm run dev:dashboard` in separate terminals.

## Railway

Create a service from this repository and set the root directory to `apps/recorder`. Add the required secrets shown in `.env.example`. Use a current Supabase `sb_secret_...` key, not a browser key. Railway uses `npm run start` and the recorder exposes `/health` on `PORT`.

The recorder uses GMGN Trenches with the `robinhood` chain and `pons` launchpad. All GMGN requests pass through one queue with at least 1.1 seconds between requests. The recorder checks `recorder_control.enabled` before starting any collection and defaults to stopped.

## Vercel

Import the same repository and set the root directory to `apps/dashboard`. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as server-only environment variables.

## Data policy

New data is stored only in `gmgn_launches`, `gmgn_snapshots` and `gmgn_candles`. The previous Bitquery tables remain archived but are not read by the dashboard, Lab, charts or Capital Circuit.
