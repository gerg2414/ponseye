/**
 * Tests buying a volume spike after a token has already collapsed.
 *
 * The setup: something ran hard, drew a crowd, then rugged. It sits at a
 * fraction of its peak. Every so often volume returns. The question is whether
 * that returning volume marks a bottom worth buying or just another seller
 * finding a bid.
 *
 * A spike is a minute whose volume is well above the preceding hour's average,
 * measured only on minutes that came before it, and the return is measured
 * only from minutes after it.
 */
import { assertAddress, fetchAllPages, number } from "./bitquery-client.js";
import { db } from "./db.js";

const MIN_PEAK_MC = 300_000;      // it has to have actually run
const CRASH_BELOW = 0.25;         // and then given most of it back
const SPIKE_MULTIPLE = 5;         // volume this many times the trailing average
const LOOKBACK = 60;              // minutes of trailing average
const FORWARD = 120;              // minutes measured after the spike

type Point = { at: number; high: number; close: number; volume: number };

async function candles(token: string, since: string): Promise<Point[]> {
  const rows = await fetchAllPages<{ Block: { Time: string }; Price?: { Ohlc?: Record<string, string | number> }; Volume?: { Usd?: string | number } }>(
    (limit, offset) => `query { Trading { Tokens(
      limit: {count: ${limit}, offset: ${offset}} orderBy: {ascending: Block_Time}
      where: { Token: {Address: {is: "${assertAddress(token)}"} Network: {is: "Robinhood"}}
        Interval: {Time: {Duration: {eq: 60}}} Block: {Time: {since: "${since}"}} }
    ) { Block { Time } Price { Ohlc { High Close } } Volume { Usd } } } }`,
    (d) => (d as { Trading?: { Tokens?: never[] } }).Trading?.Tokens ?? [],
    { pageSize: 1000, maxPages: 4, label: `deadcat ${token}` },
  );
  return rows.map((r) => ({
    at: Date.parse(r.Block.Time),
    high: number(r.Price?.Ohlc?.High) ?? 0,
    close: number(r.Price?.Ohlc?.Close) ?? 0,
    volume: number(r.Volume?.Usd) ?? 0,
  })).filter((p) => Number.isFinite(p.at) && p.close > 0).sort((a, b) => a.at - b.at);
}

const { data, error } = await db.from("bitquery_migration_test")
  .select("token_address,symbol,migrated_at,ath_market_cap_usd,current_market_cap_usd,token_supply")
  .gte("ath_market_cap_usd", MIN_PEAK_MC)
  .lt("migrated_at", new Date(Date.now() - 6 * 3600_000).toISOString())
  .order("migrated_at", { ascending: false })
  .limit(40);
if (error) throw new Error(error.message);

const candidates = (data ?? []).filter((row) =>
  Number(row.current_market_cap_usd) < Number(row.ath_market_cap_usd) * CRASH_BELOW);

console.log(`${candidates.length} tokens peaked above $${(MIN_PEAK_MC/1000)}k then fell below ${CRASH_BELOW*100}% of it\n`);

type Trade = { symbol: string; spikeX: number; forwardPeak: number; forwardClose: number; atMin: number };
const trades: Trade[] = [];

for (const token of candidates) {
  const points = await candles(token.token_address as string, new Date(token.migrated_at as string).toISOString());
  if (points.length < LOOKBACK + FORWARD) continue;

  // Where the peak was: only look for spikes well after it.
  let peakIndex = 0;
  points.forEach((p, i) => { if (p.high > points[peakIndex]!.high) peakIndex = i; });

  for (let i = Math.max(peakIndex + LOOKBACK, LOOKBACK); i < points.length - FORWARD; i += 1) {
    const point = points[i]!;
    if (point.close > points[peakIndex]!.high * CRASH_BELOW) continue;

    const window = points.slice(i - LOOKBACK, i);
    const avg = window.reduce((t, p) => t + p.volume, 0) / LOOKBACK;
    if (!(avg > 0) || point.volume < avg * SPIKE_MULTIPLE) continue;

    const entry = point.close;
    const forward = points.slice(i + 1, i + 1 + FORWARD);
    if (!forward.length || !(entry > 0)) continue;

    trades.push({
      symbol: token.symbol as string,
      spikeX: point.volume / avg,
      forwardPeak: Math.max(...forward.map((p) => p.high)) / entry,
      forwardClose: forward[forward.length - 1]!.close / entry,
      atMin: Math.round((point.at - points[0]!.at) / 60_000),
    });
    i += FORWARD; // one trade per episode rather than every minute of it
  }
}

if (!trades.length) { console.log("no spikes matched"); process.exit(0); }

const med = (a: number[]) => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]!; };
const peaks = trades.map((t) => t.forwardPeak);
const closes = trades.map((t) => t.forwardClose);

console.log(`${trades.length} volume spikes after the crash\n`);
console.log(`  median peak within ${FORWARD}m   ${med(peaks).toFixed(2)}x`);
console.log(`  average peak                ${(peaks.reduce((a,b)=>a+b,0)/peaks.length).toFixed(2)}x`);
console.log(`  reached 2x                 ${peaks.filter((p) => p >= 2).length}/${trades.length}`);
console.log(`  reached 3x                 ${peaks.filter((p) => p >= 3).length}/${trades.length}`);
console.log(`  median close after ${FORWARD}m  ${med(closes).toFixed(2)}x`);
console.log(`  still up at the end        ${closes.filter((c) => c > 1).length}/${trades.length}`);
console.log(`\n  biggest: ${trades.slice().sort((a,b)=>b.forwardPeak-a.forwardPeak).slice(0,5).map((t)=>`${t.symbol} ${t.forwardPeak.toFixed(1)}x`).join(", ")}`);
process.exit(0);
