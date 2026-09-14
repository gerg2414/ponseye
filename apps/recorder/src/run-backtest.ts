/**
 * Replays the entry filter and exit ladder against recorded prices.
 *
 * Run with: npm run backtest --workspace=@ponseye/recorder
 */
import { DEFAULT_RULES, runBacktest, summarise } from "./backtest.js";

const results = await runBacktest(DEFAULT_RULES);
const summary = summarise(results);

console.log("sym         entry $      peak    realised  held   exit");
for (const r of [...results].sort((a, b) => b.realised - a.realised)) {
  console.log(
    `${r.symbol.slice(0, 10).padEnd(11)} ` +
    `${r.entryPrice.toExponential(2).padStart(9)} ` +
    `${r.peakMultiple.toFixed(1).padStart(8)}x ` +
    `${r.realised.toFixed(2).padStart(8)}x ` +
    `${String(r.heldMinutes).padStart(4)}m  ${r.exitReason}`,
  );
}

if (summary) {
  console.log(`\n${summary.trades} trades, equal stake each`);
  console.log(`  average return   ${summary.avgReturn.toFixed(2)}x`);
  console.log(`  median return    ${summary.medianReturn.toFixed(2)}x`);
  console.log(`  profitable       ${summary.winners}/${summary.trades}`);
  console.log(`  doubled          ${summary.doubled}/${summary.trades}`);
  console.log(`  lost over half   ${summary.wipeouts}/${summary.trades}`);
  console.log(`  best / worst     ${summary.bestTrade.toFixed(2)}x / ${summary.worstTrade.toFixed(2)}x`);
  console.log(`  avg hold         ${summary.avgHeldMinutes}m`);
  console.log(`  avg peak on offer ${summary.peakAvailable.toFixed(2)}x`);
}
process.exit(0);
