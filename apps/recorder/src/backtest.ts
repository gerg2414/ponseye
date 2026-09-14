import { assertAddress, fetchAllPages, number } from "./bitquery-client.js";
import { db } from "./db.js";

/**
 * Replays the entry filter and exit ladder against recorded price history.
 *
 * Entry is taken at the close of the minute the filter clears, and every later
 * decision is made from candles after that. Take-profits are tested against the
 * candle high and stops against the close, which is the pessimistic reading of
 * each: a target is only counted as hit if the price genuinely traded there,
 * while a stop is not dodged by an intrabar wick.
 */

export type Ladder = { at: number; sell: number }[];

export type StrategyRules = {
  entryAgeSeconds: number;
  ladder: Ladder;
  /** Exit everything if still under entry after this many minutes. */
  giveUpAfterMinutes: number;
  /** Before the first ladder step, exit after this many consecutive closes below the level. */
  earlyExitBelow: number;
  earlyExitConsecutive: number;
  /** Once the first rung is hit, the runner must double again within this window. */
  runnerConfirmMinutes: number;
  runnerConfirmAt: number;
  /** If it fails to confirm, exit the remainder when price falls back below this. */
  runnerFallbackBelow: number;
  /** Stop holding at all after this long. */
  maxHoldMinutes: number;
};

export const DEFAULT_RULES: StrategyRules = {
  entryAgeSeconds: 60,
  ladder: [
    { at: 10, sell: 0.2 },
    { at: 20, sell: 0.2 },
    { at: 50, sell: 0.5 },
    { at: 100, sell: 0.1 },
  ],
  giveUpAfterMinutes: 8,
  earlyExitBelow: 0.5,
  earlyExitConsecutive: 2,
  runnerConfirmMinutes: 3,
  runnerConfirmAt: 20,
  runnerFallbackBelow: 3,
  maxHoldMinutes: 24 * 60,
};

type Candle = {
  Block: { Time: string };
  Price?: { Ohlc?: { Open?: string | number; High?: string | number; Low?: string | number; Close?: string | number } };
};

type Point = { at: number; high: number; low: number; close: number };

export type TradeResult = {
  symbol: string;
  tokenAddress: string;
  entryAt: string;
  entryPrice: number;
  peakMultiple: number;
  realised: number;
  heldMinutes: number;
  exitReason: string;
  rungsHit: number[];
};

function historyQuery(tokenAddress: string, since: string, limit: number, offset: number) {
  return `
    query PonsBacktestHistory {
      Trading {
        Tokens(
          limit: {count: ${limit}, offset: ${offset}}
          orderBy: {ascending: Block_Time}
          where: {
            Token: {Address: {is: "${assertAddress(tokenAddress)}"} Network: {is: "Robinhood"}}
            Interval: {Time: {Duration: {eq: 60}}}
            Block: {Time: {since: "${since}"}}
          }
        ) { Block { Time } Price { Ohlc { Open High Low Close } } }
      }
    }
  `;
}

/**
 * Runs one token through the rules.
 *
 * Position is tracked as a fraction remaining so partial take-profits compound
 * correctly: selling a fifth at ten times contributes 0.2 * 10 to the return,
 * and whatever is left rides on.
 */
export function simulate(
  points: Point[],
  entryIndex: number,
  rules: StrategyRules,
): Omit<TradeResult, "symbol" | "tokenAddress" | "entryAt" | "entryPrice"> | null {
  const entry = points[entryIndex];
  if (!entry || !(entry.close > 0)) return null;

  const entryPrice = entry.close;
  let remaining = 1;
  let realised = 0;
  let peak = 1;
  let belowRun = 0;
  let firstRungAt: number | null = null;
  const rungsHit: number[] = [];
  const pending = [...rules.ladder];

  const close = (index: number, price: number, reason: string) => ({
    peakMultiple: peak,
    realised: realised + remaining * (price / entryPrice),
    heldMinutes: Math.round((points[index]!.at - entry.at) / 60_000),
    exitReason: reason,
    rungsHit,
  });

  for (let index = entryIndex + 1; index < points.length; index += 1) {
    const point = points[index]!;
    const heldMinutes = Math.round((point.at - entry.at) / 60_000);
    const highMultiple = point.high / entryPrice;
    const closeMultiple = point.close / entryPrice;
    if (highMultiple > peak) peak = highMultiple;

    // Take profits first: a rung reached inside the bar is filled there.
    while (pending.length && highMultiple >= pending[0]!.at) {
      const rung = pending.shift()!;
      const size = Math.min(rung.sell, remaining);
      realised += size * rung.at;
      remaining -= size;
      rungsHit.push(rung.at);
      if (firstRungAt == null) firstRungAt = heldMinutes;
      if (remaining <= 0.0001) {
        return { peakMultiple: peak, realised, heldMinutes, exitReason: "ladder complete", rungsHit };
      }
    }

    if (firstRungAt == null) {
      // Never got going: close out rather than hold a position doing nothing.
      if (heldMinutes >= rules.giveUpAfterMinutes && closeMultiple < 1) {
        return close(index, point.close, `flat after ${rules.giveUpAfterMinutes}m`);
      }
      // Halved and stayed there.
      belowRun = closeMultiple < rules.earlyExitBelow ? belowRun + 1 : 0;
      if (belowRun >= rules.earlyExitConsecutive) {
        return close(index, point.close, `below ${rules.earlyExitBelow}x for ${belowRun}m`);
      }
    } else {
      // A runner that stalls gives the gain back, so require a second leg.
      const confirmed = rungsHit.some((rung) => rung >= rules.runnerConfirmAt);
      const pastWindow = heldMinutes - firstRungAt > rules.runnerConfirmMinutes;
      if (!confirmed && pastWindow && closeMultiple < rules.runnerFallbackBelow) {
        return close(index, point.close, `stalled after ${rungsHit[0]}x`);
      }
    }

    if (heldMinutes >= rules.maxHoldMinutes) return close(index, point.close, "max hold");
  }

  return close(points.length - 1, points[points.length - 1]!.close, "ran out of data");
}

async function candlesFrom(tokenAddress: string, since: string) {
  const rows = await fetchAllPages<Candle>(
    (limit, offset) => historyQuery(tokenAddress, since, limit, offset),
    (data) => (data as { Trading?: { Tokens?: Candle[] } }).Trading?.Tokens ?? [],
    { pageSize: 1000, maxPages: 4, label: `backtest history for ${tokenAddress}` },
  );
  return rows
    .map((row) => ({
      at: Date.parse(row.Block.Time),
      high: number(row.Price?.Ohlc?.High) ?? 0,
      low: number(row.Price?.Ohlc?.Low) ?? 0,
      close: number(row.Price?.Ohlc?.Close) ?? 0,
    }))
    .filter((point) => Number.isFinite(point.at) && point.close > 0)
    .sort((a, b) => a.at - b.at);
}

/** Tokens that cleared the entry filter, oldest first so outcomes are mature. */
export async function filteredTokens(maxTopHolderPct = 15, maxGrowthPp = Infinity, invert = false) {
  const { data, error } = await db.from("bitquery_holder_snapshots")
    .select("token_address,age_seconds,top_holder_pct,bitquery_migration_test(symbol,migrated_at,peak_multiple)")
    .in("age_seconds", [60, 300]);
  if (error) throw new Error(`Read filter inputs: ${error.message}`);

  const byToken = new Map<string, { at60?: number; at300?: number; symbol: string; migratedAt: string }>();
  for (const row of data ?? []) {
    const migration = row.bitquery_migration_test as unknown as { symbol: string; migrated_at: string } | null;
    if (!migration) continue;
    const entry = byToken.get(row.token_address as string)
      ?? { symbol: migration.symbol, migratedAt: migration.migrated_at };
    if (Number(row.age_seconds) === 60) entry.at60 = number(row.top_holder_pct) ?? undefined;
    else entry.at300 = number(row.top_holder_pct) ?? undefined;
    byToken.set(row.token_address as string, entry);
  }

  return [...byToken.entries()]
    .filter(([, v]) => {
      if (v.at60 == null) return false;
      const passes = v.at60 < maxTopHolderPct && (v.at300 == null || v.at300 - v.at60 < maxGrowthPp);
      // Inverted gives the control group: the same ladder on tokens the filter
      // rejected, which is the only way to tell selection from a rising tide.
      return invert ? !passes : passes;
    })
    .map(([token_address, v]) => ({ token_address, symbol: v.symbol, migrated_at: v.migratedAt }))
    .sort((a, b) => Date.parse(a.migrated_at) - Date.parse(b.migrated_at));
}

export async function runBacktest(rules: StrategyRules = DEFAULT_RULES, log = console.log) {
  const tokens = await filteredTokens();
  log(`Replaying ${tokens.length} tokens that cleared the filter\n`);

  const results: TradeResult[] = [];
  for (const token of tokens) {
    const migratedAt = Date.parse(token.migrated_at);
    const points = await candlesFrom(token.token_address, new Date(migratedAt).toISOString());
    if (points.length < 3) continue;

    // Entry is the last candle at or before the filter's age.
    const boundary = migratedAt + rules.entryAgeSeconds * 1_000;
    const entryIndex = points.reduce((best, point, index) => point.at <= boundary ? index : best, -1);
    if (entryIndex < 0) continue;

    const outcome = simulate(points, entryIndex, rules);
    if (!outcome) continue;
    results.push({
      symbol: token.symbol,
      tokenAddress: token.token_address,
      entryAt: new Date(points[entryIndex]!.at).toISOString(),
      entryPrice: points[entryIndex]!.close,
      ...outcome,
    });
  }
  return results;
}

export function summarise(results: TradeResult[]) {
  if (!results.length) return null;
  const returns = results.map((result) => result.realised);
  const sorted = [...returns].sort((a, b) => a - b);
  const total = returns.reduce((sum, value) => sum + value, 0);
  return {
    trades: results.length,
    // Equal stake in every trade, which is what the ladder assumes.
    avgReturn: total / results.length,
    medianReturn: sorted[Math.floor(sorted.length / 2)]!,
    winners: results.filter((result) => result.realised > 1).length,
    doubled: results.filter((result) => result.realised >= 2).length,
    wipeouts: results.filter((result) => result.realised < 0.5).length,
    bestTrade: Math.max(...returns),
    worstTrade: Math.min(...returns),
    avgHeldMinutes: Math.round(results.reduce((sum, r) => sum + r.heldMinutes, 0) / results.length),
    peakAvailable: results.reduce((sum, r) => sum + r.peakMultiple, 0) / results.length,
  };
}
