/**
 * Compares three ways of using the same checks.
 *
 *   A: wait for all three, enter at five minutes.
 *   B: enter at one minute on the holder check alone, and close at five minutes
 *      if either of the later checks fails.
 *   C: enter at one minute on the holder check alone and never re-check, to show
 *      what the five minute exits are actually worth.
 *
 * Entry timing matters enormously here: the median upside available from one
 * minute is 5.54x against 1.97x from five, so waiting for confirmation is not
 * free.
 */
import { DEFAULT_RULES, simulate, summarise, type TradeResult } from "./backtest.js";
import { assertAddress, fetchAllPages, number } from "./bitquery-client.js";
import { LADDER } from "./positions.js";
import { db } from "./db.js";

const rules = { ...DEFAULT_RULES, ladder: [...LADDER], giveUpAfterMinutes: 20, runnerConfirmAt: 5, runnerFallbackBelow: 1.5 };

type Candidate = {
  token_address: string; symbol: string; migrated_at: string;
  top1_60: number; top1_300: number | null; drawdown_300: number | null;
};

async function candidates(): Promise<Candidate[]> {
  const { data, error } = await db.from("bitquery_holder_snapshots")
    .select("token_address,age_seconds,top_holder_pct,bitquery_migration_test(symbol,migrated_at,peak_multiple)")
    .in("age_seconds", [60, 300]);
  if (error) throw new Error(error.message);

  const byToken = new Map<string, Partial<Candidate>>();
  for (const row of data ?? []) {
    const m = row.bitquery_migration_test as unknown as { symbol: string; migrated_at: string } | null;
    if (!m) continue;
    const e = byToken.get(row.token_address as string) ?? { token_address: row.token_address as string, symbol: m.symbol, migrated_at: m.migrated_at };
    if (Number(row.age_seconds) === 60) e.top1_60 = number(row.top_holder_pct) ?? undefined;
    else e.top1_300 = number(row.top_holder_pct) ?? null;
    byToken.set(row.token_address as string, e);
  }

  const addresses = [...byToken.keys()];
  for (let i = 0; i < addresses.length; i += 200) {
    const { data: draws } = await db.from("bitquery_migration_snapshots")
      .select("token_address,drawdown_from_high")
      .eq("age_seconds", 300).in("token_address", addresses.slice(i, i + 200));
    for (const row of draws ?? []) {
      const e = byToken.get(row.token_address as string);
      if (e) e.drawdown_300 = number(row.drawdown_from_high);
    }
  }

  // Only the holder check is knowable at one minute, so that gates every arm.
  return [...byToken.values()].filter((e): e is Candidate =>
    e.top1_60 != null && e.top1_60 < 15 && !!e.migrated_at);
}

async function candles(token: string, since: string) {
  const rows = await fetchAllPages<{ Block: { Time: string }; Price?: { Ohlc?: Record<string, string | number> } }>(
    (limit, offset) => `query { Trading { Tokens(
      limit: {count: ${limit}, offset: ${offset}} orderBy: {ascending: Block_Time}
      where: { Token: {Address: {is: "${assertAddress(token)}"} Network: {is: "Robinhood"}}
        Interval: {Time: {Duration: {eq: 60}}} Block: {Time: {since: "${since}"}} }
    ) { Block { Time } Price { Ohlc { High Low Close } } } } }`,
    (d) => (d as { Trading?: { Tokens?: never[] } }).Trading?.Tokens ?? [],
    { pageSize: 1000, maxPages: 3, label: `timing ${token}` },
  );
  return rows.map((r) => ({
    at: Date.parse(r.Block.Time),
    high: number(r.Price?.Ohlc?.High) ?? 0,
    low: number(r.Price?.Ohlc?.Low) ?? 0,
    close: number(r.Price?.Ohlc?.Close) ?? 0,
  })).filter((p) => Number.isFinite(p.at) && p.close > 0).sort((a, b) => a.at - b.at);
}

const list = await candidates();
console.log(`${list.length} tokens cleared the one minute holder check\n`);

const arms: Record<string, TradeResult[]> = { A: [], B: [], C: [] };

for (const c of list) {
  const migratedAt = Date.parse(c.migrated_at);
  const points = await candles(c.token_address, new Date(migratedAt).toISOString());
  if (points.length < 3) continue;

  const at = (seconds: number) => points.reduce((best, p, i) => p.at <= migratedAt + seconds * 1000 ? i : best, -1);
  const confirms = (c.top1_300 == null || c.top1_300 - c.top1_60 < 15)
    && (c.drawdown_300 == null || c.drawdown_300 < 0.60);

  // A: wait for confirmation, enter at five minutes.
  const a = at(300);
  if (confirms && a >= 0) {
    const r = simulate(points, a, rules);
    if (r) arms.A.push({ symbol: c.symbol, tokenAddress: "", entryAt: "", entryPrice: 0, ...r });
  }

  // B and C both enter at one minute.
  const b = at(60);
  if (b < 0) continue;

  if (confirms) {
    const r = simulate(points, b, rules);
    if (r) arms.B.push({ symbol: c.symbol, tokenAddress: "", entryAt: "", entryPrice: 0, ...r });
  } else {
    // Failed confirmation: the position is closed at the five minute price,
    // so four minutes of exposure is taken rather than the trade being skipped.
    const exit = at(300);
    const entryPrice = points[b]!.close;
    const exitPrice = exit >= 0 ? points[exit]!.close : entryPrice;
    arms.B.push({
      symbol: c.symbol, tokenAddress: "", entryAt: "", entryPrice: 0,
      peakMultiple: Math.max(...points.slice(b, exit + 1).map((p) => p.high / entryPrice)),
      realised: exitPrice / entryPrice, heldMinutes: 4,
      exitReason: "failed 5m checks", rungsHit: [],
    });
  }

  const r = simulate(points, b, rules);
  if (r) arms.C.push({ symbol: c.symbol, tokenAddress: "", entryAt: "", entryPrice: 0, ...r });
}

console.log("arm                                    trades  avg     median  profit  2x+  lost-half");
for (const [key, label] of [["A", "A: enter at 5m, confirmed"], ["B", "B: enter 1m, 5m checks exit"], ["C", "C: enter 1m, no 5m checks"]] as const) {
  const s = summarise(arms[key]);
  if (!s) continue;
  console.log(
    `${label.padEnd(38)} ${String(s.trades).padStart(4)}  ${s.avgReturn.toFixed(2).padStart(5)}x  ` +
    `${s.medianReturn.toFixed(2).padStart(5)}x  ${String(s.winners).padStart(5)}  ${String(s.doubled).padStart(3)}  ${String(s.wipeouts).padStart(8)}`,
  );
}
process.exit(0);
