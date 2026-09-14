/**
 * Runs the same exit ladder on tokens the filter rejected.
 *
 * Without this the filtered result means nothing: if rejected tokens return the
 * same, the filter is selecting nothing and the return is just what this ladder
 * does on any migration.
 */
import { DEFAULT_RULES, filteredTokens, simulate, summarise, type TradeResult } from "./backtest.js";
import { assertAddress, fetchAllPages, number } from "./bitquery-client.js";
import { LADDER } from "./positions.js";

const rules = { ...DEFAULT_RULES, ladder: [...LADDER], giveUpAfterMinutes: 20, runnerConfirmAt: 5, runnerFallbackBelow: 1.5 };

async function candles(token: string, since: string) {
  const rows = await fetchAllPages<{ Block: { Time: string }; Price?: { Ohlc?: Record<string, string | number> } }>(
    (limit, offset) => `query { Trading { Tokens(
      limit: {count: ${limit}, offset: ${offset}} orderBy: {ascending: Block_Time}
      where: { Token: {Address: {is: "${assertAddress(token)}"} Network: {is: "Robinhood"}}
        Interval: {Time: {Duration: {eq: 60}}} Block: {Time: {since: "${since}"}} }
    ) { Block { Time } Price { Ohlc { High Low Close } } } } }`,
    (d) => (d as { Trading?: { Tokens?: never[] } }).Trading?.Tokens ?? [],
    { pageSize: 1000, maxPages: 3, label: `control ${token}` },
  );
  return rows.map((r) => ({
    at: Date.parse(r.Block.Time),
    high: number(r.Price?.Ohlc?.High) ?? 0,
    low: number(r.Price?.Ohlc?.Low) ?? 0,
    close: number(r.Price?.Ohlc?.Close) ?? 0,
  })).filter((p) => Number.isFinite(p.at) && p.close > 0).sort((a, b) => a.at - b.at);
}

async function run(label: string, tokens: Awaited<ReturnType<typeof filteredTokens>>) {
  const results: TradeResult[] = [];
  for (const token of tokens) {
    const migratedAt = Date.parse(token.migrated_at);
    const points = await candles(token.token_address, new Date(migratedAt).toISOString());
    if (points.length < 3) continue;
    const boundary = migratedAt + rules.entryAgeSeconds * 1000;
    const entryIndex = points.reduce((best, p, i) => p.at <= boundary ? i : best, -1);
    if (entryIndex < 0) continue;
    const outcome = simulate(points, entryIndex, rules);
    if (outcome) results.push({ symbol: token.symbol, tokenAddress: token.token_address, entryAt: "", entryPrice: 0, ...outcome });
  }
  const s = summarise(results);
  if (!s) { console.log(`${label}: no results`); return; }
  console.log(
    `${label.padEnd(22)} ${String(s.trades).padStart(4)} trades  ` +
    `avg ${s.avgReturn.toFixed(2)}x  median ${s.medianReturn.toFixed(2)}x  ` +
    `profitable ${s.winners}/${s.trades}  2x+ ${s.doubled}  lost-half ${s.wipeouts}`,
  );
}

const passed = await filteredTokens(15, 15, false);
// Same size sample from the rejected side, spread across the window.
const rejectedAll = await filteredTokens(15, 15, true);
const step = Math.max(1, Math.floor(rejectedAll.length / passed.length));
const rejected = rejectedAll.filter((_, i) => i % step === 0).slice(0, passed.length);

console.log(`filter passed ${passed.length}, rejected pool ${rejectedAll.length}, control sample ${rejected.length}\n`);
await run("PASSED filter", passed);
await run("REJECTED (control)", rejected);
process.exit(0);
