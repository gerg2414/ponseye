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
import { config } from "./config.js";
import { db } from "./db.js";

const rules = {
  ...DEFAULT_RULES,
  ladder: [...LADDER],
  giveUpAfterMinutes: 20,
  earlyExitBelow: 0.7,
  earlyExitConsecutive: 1,
  runnerConfirmAt: 5,
  runnerFallbackBelow: 1.5,
};
const results = await runBacktest(rules);

// Market caps for the ledger. The replay works in price, but the page reports
// entry and exit in market cap, which is what a position is recognisable by.
const caps = new Map<string, number>();
for (let index = 0; index < results.length; index += 200) {
  const { data } = await db.from("bitquery_migration_snapshots")
    .select("token_address,market_cap_usd")
    .eq("age_seconds", 60)
    .in("token_address", results.slice(index, index + 200).map((r) => r.tokenAddress));
  for (const row of data ?? []) {
    const value = Number(row.market_cap_usd);
    if (Number.isFinite(value)) caps.set(row.token_address as string, value);
  }
}

const rows = results.map((result) => ({
  token_address: result.tokenAddress,
  opened_at: result.entryAt,
  entry_price_usd: result.entryPrice,
  entry_market_cap_usd: caps.get(result.tokenAddress) ?? null,
  strategy: STRATEGY,
  position_size_usd: config.POSITION_SIZE_USD,
  remaining_fraction: 0,
  realised_multiple: result.realised,
  rungs_filled: result.rungsHit,
  peak_multiple_seen: result.peakMultiple,
  last_price_usd: result.entryPrice * result.realised,
  last_seen_at: new Date().toISOString(),
  closed_at: new Date(Date.parse(result.entryAt) + result.heldMinutes * 60_000).toISOString(),
  close_reason: result.exitReason,
  // The ladder returns a multiple of the stake, so the exit market cap is the
  // entry scaled by it.
  exit_market_cap_usd: (caps.get(result.tokenAddress) ?? 0) * result.realised || null,
  updated_at: new Date().toISOString(),
}));

if (rows.length) {
  const { error } = await db.from("ponseye_positions").upsert(rows, { onConflict: "token_address" });
  if (error) throw new Error(error.message);
}
console.log(`Seeded ${rows.length} replayed positions`);
process.exit(0);
