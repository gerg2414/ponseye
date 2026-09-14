/**
 * Seeds historical positions by replaying prices, not by marking to the latest.
 *
 * updatePositions walks a position forward as prices arrive, which is right for
 * a live position and wrong for a past one: applied once to a token that has
 * already round-tripped it sees only the wreckage, fills no rungs and closes at
 * the bottom. Replaying candle by candle reproduces what the rules would
 * actually have done.
 *
 * Run with: npm run seed:positions --workspace=@ponseye/recorder
 */
import { DEFAULT_RULES, runBacktest } from "./backtest.js";
import { LADDER, STRATEGY } from "./positions.js";
import { db } from "./db.js";

const rules = { ...DEFAULT_RULES, ladder: [...LADDER], giveUpAfterMinutes: 20, runnerConfirmAt: 5, runnerFallbackBelow: 1.5 };
const results = await runBacktest(rules);

const rows = results.map((result) => ({
  token_address: result.tokenAddress,
  opened_at: result.entryAt,
  entry_price_usd: result.entryPrice,
  strategy: STRATEGY,
  remaining_fraction: 0,
  realised_multiple: result.realised,
  rungs_filled: result.rungsHit,
  peak_multiple_seen: result.peakMultiple,
  last_price_usd: result.entryPrice * result.realised,
  last_seen_at: new Date().toISOString(),
  closed_at: new Date(Date.parse(result.entryAt) + result.heldMinutes * 60_000).toISOString(),
  close_reason: result.exitReason,
  updated_at: new Date().toISOString(),
}));

if (rows.length) {
  const { error } = await db.from("ponseye_positions").upsert(rows, { onConflict: "token_address" });
  if (error) throw new Error(error.message);
}
console.log(`Seeded ${rows.length} replayed positions`);
process.exit(0);
