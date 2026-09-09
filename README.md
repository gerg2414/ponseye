# PonsEye

PonsEye records PONS V2 launches and bonding curve trades on Robinhood Chain so launch behaviour can be measured and tested rather than guessed.

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

Create a service from this repository and set the root directory to `apps/recorder`. Add the four required secrets shown in `.env.example`. Railway uses `npm run start` and the recorder exposes `/health` on `PORT`.

## Vercel

Import the same repository and set the root directory to `apps/dashboard`. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-only environment variables.

## Data policy

Raw Bitquery payloads are retained alongside parsed fields. This lets us improve parsers and test new research ideas without losing the original evidence.
