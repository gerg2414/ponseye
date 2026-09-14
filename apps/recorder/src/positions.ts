import { number } from "./bitquery-client.js";
import { config } from "./config.js";
import { db } from "./db.js";

/**
 * Opens a position when the entry filter clears, then walks it up the ladder.
 *
 * Paper only: nothing here places an order. It records what the rules would
 * have done, so the funnel's acquired lane shows a position with a real entry
 * price and a live return rather than a suggestion.
 */

/** Sell this fraction of the original stake when the multiple is reached. */
export const LADDER = [
  { at: 2, sell: 0.5 },
  { at: 3, sell: 0.25 },
  { at: 5, sell: 0.15 },
  { at: 10, sell: 0.1 },
] as const;

export const STRATEGY = "ladder-2-3-5-10";

/**
 * Protection rules, in the order they are checked.
 *
 * Measured over 28 replayed trades: a first rung at 10x left twenty-four of
 * them taking no profit at all, because the median peak from a one minute entry
 * is 3.4x. Starting at 2x turns four profitable trades into nineteen for almost
 * the same expected value.
 */
const GIVE_UP_AFTER_MINUTES = 20;
// Losing tokens drop 50-90% inside a single minute, but that candle lands three
// to twenty minutes after entry and the price drifts down before it. A stop at
// 0.7 acted on immediately fills during the drift: wipeouts fall from eight in
// thirty-two to three, while the median return holds at 1.70x. Tighter stops
// start cutting trades that recover, dropping the median to 1.55x.
const EARLY_EXIT_BELOW = 0.7;
const EARLY_EXIT_READINGS = 1;
const STALL_CONFIRM_AT = 5;
const STALL_WINDOW_MINUTES = 3;
const STALL_FALLBACK_BELOW = 1.5;
const MAX_HOLD_MINUTES = 24 * 60;

type OpenRow = {
  token_address: string;
  opened_at: string;
  entry_price_usd: number | string;
  remaining_fraction: number | string;
  realised_multiple: number | string;
  rungs_filled: number[];
  peak_multiple_seen: number | string;
  current_price_usd: number | string | null;
};

/**
 * Tokens showing an entry signal that have no position yet.
 *
 * The window matches the funnel's: entry edge decays quickly, so a token that
 * has already been trading for half an hour is not opened late.
 */
export async function entrySignals(limit = 10) {
  const { data, error } = await db.from("ponseye_funnel")
    .select("token_address,migrated_at,top1_at_1m,holders_at_1m,current_market_cap_usd")
    .eq("stage", "surveilling")
    .order("migrated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Read entry signals: ${error.message}`);
  if (!data?.length) return [];

  const addresses = data.map((row) => row.token_address as string);
  const { data: existing, error: existingError } = await db.from("ponseye_positions")
    .select("token_address").in("token_address", addresses);
  if (existingError) throw new Error(`Read open positions: ${existingError.message}`);
  const held = new Set((existing ?? []).map((row) => row.token_address as string));

  return data.filter((row) => !held.has(row.token_address as string));
}

export async function openPositions(signals: Awaited<ReturnType<typeof entrySignals>>) {
  if (!signals.length) return 0;

  const addresses = signals.map((row) => row.token_address as string);
  const { data: prices, error } = await db.from("bitquery_migration_test")
    .select("token_address,current_price_usd,current_market_cap_usd")
    .in("token_address", addresses);
  if (error) throw new Error(`Read entry prices: ${error.message}`);

  const rows = [];
  for (const signal of signals) {
    const price = number(prices?.find((row) => row.token_address === signal.token_address)?.current_price_usd);
    // Without a price there is no entry, and inventing one would poison every
    // return computed from it.
    if (price == null || price <= 0) continue;
    rows.push({
      token_address: signal.token_address as string,
      entry_price_usd: price,
      entry_market_cap_usd: number(signal.current_market_cap_usd),
      entry_top_holder_pct: number(signal.top1_at_1m),
      entry_holder_count: number(signal.holders_at_1m),
      strategy: STRATEGY,
      position_size_usd: config.POSITION_SIZE_USD,
      last_price_usd: price,
      last_seen_at: new Date().toISOString(),
    });
  }

  if (!rows.length) return 0;
  const { error: saveError } = await db.from("ponseye_positions")
    .upsert(rows, { onConflict: "token_address", ignoreDuplicates: true });
  if (saveError) throw new Error(`Open positions: ${saveError.message}`);
  for (const row of rows) console.log(`Opened ${row.token_address} at ${row.entry_price_usd}`);
  return rows.length;
}

/** Walks every open position against the latest price. */
export async function updatePositions() {
  const { data, error } = await db.from("ponseye_positions_live")
    .select("token_address,opened_at,entry_price_usd,remaining_fraction,realised_multiple,rungs_filled,peak_multiple_seen,current_price_usd")
    .is("closed_at", null);
  if (error) throw new Error(`Read live positions: ${error.message}`);
  if (!data?.length) return 0;

  const now = Date.now();
  const updates = [];

  for (const row of data as unknown as OpenRow[]) {
    const entry = number(row.entry_price_usd);
    const price = number(row.current_price_usd);
    if (entry == null || entry <= 0 || price == null || price <= 0) continue;

    const multiple = price / entry;
    const heldMinutes = (now - Date.parse(row.opened_at)) / 60_000;
    const filled = new Set((row.rungs_filled ?? []).map(Number));
    let remaining = number(row.remaining_fraction) ?? 1;
    let realised = number(row.realised_multiple) ?? 0;
    const peak = Math.max(number(row.peak_multiple_seen) ?? 1, multiple);

    for (const rung of LADDER) {
      if (filled.has(rung.at) || multiple < rung.at || remaining <= 0.0001) continue;
      const size = Math.min(rung.sell, remaining);
      realised += size * rung.at;
      remaining -= size;
      filled.add(rung.at);
      console.log(`${row.token_address} hit ${rung.at}x, sold ${(size * 100).toFixed(0)}%`);
    }

    let closeReason: string | null = null;
    if (remaining <= 0.0001) closeReason = "ladder complete";
    else if (heldMinutes >= MAX_HOLD_MINUTES) closeReason = "max hold";
    else if (!filled.size && heldMinutes >= GIVE_UP_AFTER_MINUTES && multiple < 1) {
      closeReason = `flat after ${GIVE_UP_AFTER_MINUTES}m`;
    } else if (!filled.size && multiple < EARLY_EXIT_BELOW && heldMinutes >= EARLY_EXIT_READINGS) {
      closeReason = `below ${EARLY_EXIT_BELOW}x`;
    } else if (filled.size && !filled.has(STALL_CONFIRM_AT)
      && heldMinutes > STALL_WINDOW_MINUTES && multiple < STALL_FALLBACK_BELOW) {
      closeReason = "stalled after first rung";
    }

    if (closeReason && closeReason !== "ladder complete") {
      realised += remaining * multiple;
      remaining = 0;
    }

    updates.push({
      token_address: row.token_address,
      // Upserts insert on conflict, so not-null columns must be present even
      // though every row here already exists.
      entry_price_usd: entry,
      opened_at: row.opened_at,
      remaining_fraction: remaining,
      realised_multiple: realised,
      rungs_filled: [...filled],
      peak_multiple_seen: peak,
      last_price_usd: price,
      last_seen_at: new Date().toISOString(),
      ...(closeReason ? { closed_at: new Date().toISOString(), close_reason: closeReason } : {}),
      updated_at: new Date().toISOString(),
    });
    if (closeReason) console.log(`Closed ${row.token_address}: ${closeReason}, realised ${realised.toFixed(2)}x`);
  }

  if (!updates.length) return 0;
  const { error: saveError } = await db.from("ponseye_positions")
    .upsert(updates, { onConflict: "token_address" });
  if (saveError) throw new Error(`Update positions: ${saveError.message}`);
  return updates.length;
}
