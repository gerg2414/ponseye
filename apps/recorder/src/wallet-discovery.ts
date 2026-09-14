import { assertAddress, fetchAllPages, number, queryBitquery } from "./bitquery-client.js";
import { db } from "./db.js";

/**
 * Finds wallets that actually make money trading on this chain.
 *
 * The expensive way would be to pull every trade for every wallet: Uniswap v3
 * and v4 alone carry over two million trades a day here. Instead Bitquery
 * aggregates for us. Per-wallet totals come back in one page, and a wallet's
 * per-token buy and sell totals in two more, which is enough for profit and
 * loss without ever reading an individual trade.
 *
 * Nothing here is a signal on its own. A wallet ranked on one window has to be
 * judged on what it does in the next one, which is the whole point of storing
 * the window alongside the score.
 */

const PROTOCOLS = ["uniswap_v4", "uniswap_v3", "uniswap_v2"];

/**
 * Bot thresholds, set from what the chain actually looks like.
 *
 * The largest wallet by volume traded 7,430 times across two tokens in a day,
 * flipping the same pair back and forth within a second. Arbitrage and MEV are
 * profitable but the edge is latency, which cannot be copied, so they are
 * excluded rather than ranked.
 */
const BOT_TRADES_PER_TOKEN = 100;
const BOT_MIN_TRADES = 500;
const MIN_TRADES = 10;
const MIN_TOKENS = 4;
const MIN_VOLUME_USD = 2_000;

type WalletRow = {
  Transaction?: { From?: string };
  volume?: string | number;
  trades?: string | number;
  tokens?: string | number;
};

type SideRow = {
  Trade?: { Buy?: { Currency?: { SmartContract?: string } }; Sell?: { Currency?: { SmartContract?: string } } };
  usd?: string | number;
  amount?: string | number;
};

function protocolFilter() {
  return `Trade: {Dex: {ProtocolName: {in: [${PROTOCOLS.map((p) => `"${p}"`).join(",")}]}}}`;
}

/** Wallets active in the window, ranked by what they put through. */
function candidateQuery(since: string, till: string, limit: number, offset: number) {
  return `
    query WalletCandidates {
      EVM(network: robinhood) {
        DEXTrades(
          limit: {count: ${limit}, offset: ${offset}}
          orderBy: {descendingByField: "volume"}
          where: {
            Block: {Time: {since: "${since}", till: "${till}"}}
            ${protocolFilter()}
          }
        ) {
          Transaction { From }
          volume: sum(of: Trade_Buy_AmountInUSD)
          trades: count
          tokens: count(distinct: Trade_Buy_Currency_SmartContract)
        }
      }
    }
  `;
}

/** One wallet's buying and selling, totalled per token. */
function walletSidesQuery(wallet: string, since: string, till: string) {
  const address = assertAddress(wallet);
  const where = `Transaction: {From: {is: "${address}"}} Block: {Time: {since: "${since}", till: "${till}"}} ${protocolFilter()}`;
  return `
    query WalletSides {
      EVM(network: robinhood) {
        Bought: DEXTrades(limit: {count: 200} orderBy: {descendingByField: "usd"} where: {${where}}) {
          Trade { Buy { Currency { SmartContract } } }
          usd: sum(of: Trade_Buy_AmountInUSD)
          amount: sum(of: Trade_Buy_Amount)
        }
        Sold: DEXTrades(limit: {count: 200} orderBy: {descendingByField: "usd"} where: {${where}}) {
          Trade { Sell { Currency { SmartContract } } }
          usd: sum(of: Trade_Sell_AmountInUSD)
          amount: sum(of: Trade_Sell_Amount)
        }
      }
    }
  `;
}

function classify(trades: number, tokens: number) {
  // A wallet hammering a handful of pairs is arbitraging, not picking.
  if (trades >= BOT_MIN_TRADES && tokens > 0 && trades / tokens >= BOT_TRADES_PER_TOKEN) {
    return { isBot: true, reason: `${trades} trades across ${tokens} tokens` };
  }
  if (tokens <= 1 && trades >= BOT_MIN_TRADES) {
    return { isBot: true, reason: `${trades} trades on a single token` };
  }
  return { isBot: false, reason: null as string | null };
}

export async function discoverWallets({
  hours = 24,
  maxWallets = 150,
  log = console.log,
}: { hours?: number; maxWallets?: number; log?: (message: string) => void } = {}) {
  const till = new Date();
  const since = new Date(till.getTime() - hours * 3_600_000);

  log(`Ranking wallets over the last ${hours}h on ${PROTOCOLS.join(", ")}`);
  const candidates = await fetchAllPages<WalletRow>(
    (limit, offset) => candidateQuery(since.toISOString(), till.toISOString(), limit, offset),
    (data) => (data as { EVM?: { DEXTrades?: WalletRow[] } }).EVM?.DEXTrades ?? [],
    { pageSize: 500, maxPages: 3, label: "wallet candidates" },
  );

  const rows = [];
  let scanned = 0;
  let bots = 0;

  for (const candidate of candidates) {
    const wallet = candidate.Transaction?.From?.toLowerCase();
    const trades = Math.round(number(candidate.trades) ?? 0);
    const tokens = Math.round(number(candidate.tokens) ?? 0);
    const volume = number(candidate.volume) ?? 0;
    if (!wallet) continue;

    const { isBot, reason } = classify(trades, tokens);
    // Bots are recorded rather than dropped, so the exclusion can be audited
    // and so a wallet is not re-examined every run.
    if (isBot) {
      bots += 1;
      rows.push({
        wallet, window_start: since.toISOString(), window_end: till.toISOString(),
        trades, distinct_tokens: tokens, buy_volume_usd: volume,
        is_bot: true, bot_reason: reason, scored_at: new Date().toISOString(),
      });
      continue;
    }

    // Too small or too narrow to separate skill from luck.
    if (trades < MIN_TRADES || tokens < MIN_TOKENS || volume < MIN_VOLUME_USD) continue;
    if (scanned >= maxWallets) continue;
    scanned += 1;

    const data = await queryBitquery<{ EVM?: { Bought?: SideRow[]; Sold?: SideRow[] } }>(
      walletSidesQuery(wallet, since.toISOString(), till.toISOString()),
    );

    const add = (map: Map<string, { usd: number; amount: number }>, token: string | undefined, row: SideRow) => {
      const key = token?.toLowerCase();
      if (!key) return;
      const entry = map.get(key) ?? { usd: 0, amount: 0 };
      entry.usd += number(row.usd) ?? 0;
      entry.amount += number(row.amount) ?? 0;
      map.set(key, entry);
    };

    const bought = new Map<string, { usd: number; amount: number }>();
    for (const row of data.EVM?.Bought ?? []) add(bought, row.Trade?.Buy?.Currency?.SmartContract, row);
    const sold = new Map<string, { usd: number; amount: number }>();
    for (const row of data.EVM?.Sold ?? []) add(sold, row.Trade?.Sell?.Currency?.SmartContract, row);

    // Profit is proceeds minus the cost of what was actually sold, not minus
    // everything bought. Comparing total spend against total proceeds makes a
    // wallet that is still holding look ruined and one selling a bag bought
    // before the window look brilliant, which is an artefact of where the window
    // was cut rather than anything the wallet did.
    let realised = 0;
    let closed = 0;
    let winners = 0;
    for (const [token, buy] of bought) {
      const sell = sold.get(token);
      if (!sell || buy.amount <= 0 || buy.usd <= 0 || sell.amount <= 0) continue;
      // Selling more than was bought in the window means the rest came from
      // before it, and its cost is unknown, so only the matched part counts.
      const matched = Math.min(sell.amount, buy.amount);
      const costOfMatched = buy.usd * (matched / buy.amount);
      const proceedsOfMatched = sell.usd * (matched / sell.amount);
      closed += 1;
      const pnl = proceedsOfMatched - costOfMatched;
      realised += pnl;
      if (pnl > 0) winners += 1;
    }

    const buyTotal = [...bought.values()].reduce((total, value) => total + value.usd, 0);
    const sellTotal = [...sold.values()].reduce((total, value) => total + value.usd, 0);

    rows.push({
      wallet,
      window_start: since.toISOString(),
      window_end: till.toISOString(),
      trades,
      distinct_tokens: tokens,
      buy_volume_usd: buyTotal,
      sell_volume_usd: sellTotal,
      realised_pnl_usd: realised,
      open_value_usd: null,
      tokens_closed: closed,
      tokens_profitable: winners,
      win_rate: closed ? winners / closed : null,
      is_bot: false,
      bot_reason: null,
      scored_at: new Date().toISOString(),
    });

    if (scanned % 25 === 0) log(`  scored ${scanned} wallets, skipped ${bots} bots`);
  }

  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await db.from("wallet_scores")
      .upsert(rows.slice(index, index + 200), { onConflict: "wallet,window_start" });
    if (error) throw new Error(`Save wallet scores: ${error.message}`);
  }

  log(`Scored ${scanned} wallets, classified ${bots} as bots, from ${candidates.length} candidates`);
  return { scored: scanned, bots, candidates: candidates.length, windowStart: since.toISOString() };
}
