/**
 * Replays several rule sets over the same price history.
 *
 * Candles are fetched once and reused, so comparing twenty variants costs the
 * same in Bitquery points as running one.
 */
import { DEFAULT_RULES, filteredTokens, simulate, summarise, type StrategyRules, type TradeResult } from "./backtest.js";
import { assertAddress, fetchAllPages, number } from "./bitquery-client.js";

type Point = { at: number; high: number; low: number; close: number };

async function candles(tokenAddress: string, since: string): Promise<Point[]> {
  const rows = await fetchAllPages<{ Block: { Time: string }; Price?: { Ohlc?: Record<string, string | number> } }>(
    (limit, offset) => `query { Trading { Tokens(
      limit: {count: ${limit}, offset: ${offset}} orderBy: {ascending: Block_Time}
      where: { Token: {Address: {is: "${assertAddress(tokenAddress)}"} Network: {is: "Robinhood"}}
        Interval: {Time: {Duration: {eq: 60}}} Block: {Time: {since: "${since}"}} }
    ) { Block { Time } Price { Ohlc { High Low Close } } } } }`,
    (data) => (data as { Trading?: { Tokens?: never[] } }).Trading?.Tokens ?? [],
    { pageSize: 1000, maxPages: 4, label: `compare ${tokenAddress}` },
  );
  return rows
    .map((row) => ({
      at: Date.parse(row.Block.Time),
      high: number(row.Price?.Ohlc?.High) ?? 0,
      low: number(row.Price?.Ohlc?.Low) ?? 0,
      close: number(row.Price?.Ohlc?.Close) ?? 0,
    }))
    .filter((p) => Number.isFinite(p.at) && p.close > 0)
    .sort((a, b) => a.at - b.at);
}

const tokens = await filteredTokens();
console.log(`Loading price history for ${tokens.length} tokens...`);
const history: Array<{ symbol: string; points: Point[] }> = [];
for (const token of tokens) {
  const points = await candles(token.token_address, new Date(token.migrated_at).toISOString());
  if (points.length >= 3) history.push({ symbol: token.symbol, points, ...{ migratedAt: Date.parse(token.migrated_at) } } as never);
}
console.log(`Loaded ${history.length}\n`);

const variants: Array<{ name: string; rules: StrategyRules }> = [
  { name: "yours (10/20/50/100)", rules: DEFAULT_RULES },
  { name: "ladder 2/5/10/20", rules: { ...DEFAULT_RULES, ladder: [{at:2,sell:.4},{at:5,sell:.3},{at:10,sell:.2},{at:20,sell:.1}], runnerConfirmAt: 5, runnerFallbackBelow: 1.5 } },
  { name: "ladder 2/3/5/10", rules: { ...DEFAULT_RULES, ladder: [{at:2,sell:.5},{at:3,sell:.25},{at:5,sell:.15},{at:10,sell:.1}], runnerConfirmAt: 3, runnerFallbackBelow: 1.2 } },
  { name: "ladder 3/6/12/25", rules: { ...DEFAULT_RULES, ladder: [{at:3,sell:.4},{at:6,sell:.3},{at:12,sell:.2},{at:25,sell:.1}], runnerConfirmAt: 6, runnerFallbackBelow: 1.5 } },
  { name: "2/5/10/20, no 8m rule", rules: { ...DEFAULT_RULES, ladder: [{at:2,sell:.4},{at:5,sell:.3},{at:10,sell:.2},{at:20,sell:.1}], runnerConfirmAt: 5, runnerFallbackBelow: 1.5, giveUpAfterMinutes: 999 } },
  { name: "2/5/10/20, give up at 20m", rules: { ...DEFAULT_RULES, ladder: [{at:2,sell:.4},{at:5,sell:.3},{at:10,sell:.2},{at:20,sell:.1}], runnerConfirmAt: 5, runnerFallbackBelow: 1.5, giveUpAfterMinutes: 20 } },
  { name: "all out at 2x", rules: { ...DEFAULT_RULES, ladder: [{at:2,sell:1}] } },
  { name: "all out at 3x", rules: { ...DEFAULT_RULES, ladder: [{at:3,sell:1}] } },
  { name: "all out at 5x", rules: { ...DEFAULT_RULES, ladder: [{at:5,sell:1}] } },
];

console.log("strategy                       trades  avg    median  profit  2x+  <0.5x  best");
for (const variant of variants) {
  const results: TradeResult[] = [];
  for (const item of history) {
    const migratedAt = (item as never as { migratedAt: number }).migratedAt;
    const boundary = migratedAt + variant.rules.entryAgeSeconds * 1000;
    const entryIndex = item.points.reduce((best, p, i) => p.at <= boundary ? i : best, -1);
    if (entryIndex < 0) continue;
    const outcome = simulate(item.points, entryIndex, variant.rules);
    if (outcome) results.push({ symbol: item.symbol, tokenAddress: "", entryAt: "", entryPrice: 0, ...outcome });
  }
  const s = summarise(results);
  if (!s) continue;
  console.log(
    `${variant.name.padEnd(30)} ${String(s.trades).padStart(5)}  ` +
    `${s.avgReturn.toFixed(2).padStart(5)}x ${s.medianReturn.toFixed(2).padStart(6)}x ` +
    `${String(s.winners).padStart(5)}  ${String(s.doubled).padStart(3)}  ${String(s.wipeouts).padStart(5)}  ${s.bestTrade.toFixed(1)}x`,
  );
}
process.exit(0);
