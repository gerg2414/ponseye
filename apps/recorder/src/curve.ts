import { assertAddress, fetchAllPages, number } from "./bitquery-client.js";
import { db } from "./db.js";

/**
 * Bonding curve behaviour, measured between a token's launch and its
 * graduation. Pons curve trades surface as ordinary DEX trades under the
 * protocol name below, so no log decoding is needed.
 */
const PONS_CURVE_PROTOCOL = "pons_v2";

/**
 * A token with no recorded launch still has a curve; we just do not know when it
 * opened. Look back this far from graduation so those tokens are not skipped.
 */
const FALLBACK_LOOKBACK_MS = 6 * 60 * 60_000;

type DexTrade = {
  Block: { Time: string };
  Transaction?: { From?: string };
  Trade: {
    Buy: { Amount?: string; AmountInUSD?: string; Buyer?: string; Currency?: { SmartContract?: string } };
    Sell: { Amount?: string; AmountInUSD?: string; Buyer?: string; Currency?: { SmartContract?: string } };
  };
};

type CurveToken = {
  token_address: string;
  migrated_at: string;
  creator_address: string | null;
  launched_at: string | null;
};

function curveQuery(tokenAddress: string, since: string, till: string, limit: number, offset: number) {
  const address = assertAddress(tokenAddress);
  return `
    query PonsCurveTrades {
      EVM(network: robinhood) {
        DEXTrades(
          limit: {count: ${limit}, offset: ${offset}}
          orderBy: {ascending: Block_Time}
          where: {
            Block: {Time: {since: "${since}", till: "${till}"}}
            Trade: {Dex: {ProtocolName: {is: "${PONS_CURVE_PROTOCOL}"}}}
            any: [
              {Trade: {Buy: {Currency: {SmartContract: {is: "${address}"}}}}}
              {Trade: {Sell: {Currency: {SmartContract: {is: "${address}"}}}}}
            ]
          }
        ) {
          Block { Time }
          Transaction { From }
          Trade {
            Buy { Amount AmountInUSD Buyer Currency { SmartContract } }
            Sell { Amount AmountInUSD Buyer Currency { SmartContract } }
          }
        }
      }
    }
  `;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

export function summariseCurve(token: CurveToken, trades: DexTrade[], truncated: boolean) {
  const address = token.token_address.toLowerCase();
  const creator = token.creator_address?.toLowerCase() ?? null;
  const migratedAt = Date.parse(token.migrated_at);
  const launchedAt = token.launched_at ? Date.parse(token.launched_at) : null;

  let buys = 0;
  let sells = 0;
  let buyVolume = 0;
  let sellVolume = 0;
  let largestBuy = 0;
  let creatorBuy = 0;
  const wallets = new Set<string>();
  const buyers = new Set<string>();
  const buyByWallet = new Map<string, number>();
  let firstTradeAt: number | null = null;

  for (const trade of trades) {
    const at = Date.parse(trade.Block.Time);
    if (Number.isFinite(at) && (firstTradeAt == null || at < firstTradeAt)) firstTradeAt = at;

    const isBuy = trade.Trade.Buy.Currency?.SmartContract?.toLowerCase() === address;
    // The token side of a trade reports AmountInUSD as 0, so the value of the
    // trade has to come from the stablecoin on the other side.
    const usd = number(isBuy ? trade.Trade.Sell.AmountInUSD : trade.Trade.Buy.AmountInUSD) ?? 0;
    const wallet = (trade.Transaction?.From
      ?? (isBuy ? trade.Trade.Buy.Buyer : trade.Trade.Sell.Buyer)
      ?? "")
      .toLowerCase();
    if (wallet) wallets.add(wallet);

    if (isBuy) {
      buys += 1;
      buyVolume += usd;
      if (usd > largestBuy) largestBuy = usd;
      if (wallet) {
        buyers.add(wallet);
        buyByWallet.set(wallet, (buyByWallet.get(wallet) ?? 0) + usd);
      }
      if (creator && wallet === creator) creatorBuy += usd;
    } else {
      sells += 1;
      sellVolume += usd;
    }
  }

  const trades_count = buys + sells;
  const rankedBuys = [...buyByWallet.values()].sort((a, b) => b - a);
  const curveSeconds = launchedAt == null ? null : Math.max(0, Math.round((migratedAt - launchedAt) / 1000));
  // Below a minute the rate is dominated by rounding, so guard the divisor.
  const minutes = curveSeconds == null ? null : Math.max(curveSeconds, 1) / 60;

  return {
    token_address: address,
    launched_at: token.launched_at,
    migrated_at: token.migrated_at,
    curve_seconds: curveSeconds,
    first_trade_at: firstTradeAt == null ? null : new Date(firstTradeAt).toISOString(),
    seconds_to_first_trade: firstTradeAt == null || launchedAt == null
      ? null
      : Math.max(0, Math.round((firstTradeAt - launchedAt) / 1000)),

    trades: trades_count,
    buys,
    sells,
    buy_trade_share: trades_count ? buys / trades_count : null,
    trades_per_minute: minutes ? trades_count / minutes : null,

    buy_volume_usd: buyVolume,
    sell_volume_usd: sellVolume,
    net_volume_usd: buyVolume - sellVolume,

    unique_wallets: wallets.size,
    unique_buyers: buyers.size,
    usd_per_buyer: buyers.size ? buyVolume / buyers.size : null,
    largest_buy_usd: largestBuy || null,
    top_buyer_share: buyVolume > 0 && rankedBuys.length ? rankedBuys[0]! / buyVolume : null,
    top5_buyer_share: buyVolume > 0 && rankedBuys.length
      ? rankedBuys.slice(0, 5).reduce((total, value) => total + value, 0) / buyVolume
      : null,
    creator_buy_usd: creator ? creatorBuy : null,

    truncated,
    computed_at: new Date().toISOString(),
  };
}

async function fetchCurveTrades(token: CurveToken) {
  const migratedAt = Date.parse(token.migrated_at);
  const since = new Date(token.launched_at ? Date.parse(token.launched_at) : migratedAt - FALLBACK_LOOKBACK_MS)
    .toISOString();
  // Graduation itself trades through the curve, so stop just before it rather
  // than folding the seeding trade into the curve totals.
  const till = new Date(migratedAt).toISOString();

  const trades = await fetchAllPages<DexTrade>(
    (limit, offset) => curveQuery(token.token_address, since, till, limit, offset),
    (data) => (data as { EVM?: { DEXTrades?: DexTrade[] } }).EVM?.DEXTrades ?? [],
    { pageSize: PAGE_SIZE, maxPages: MAX_PAGES, label: `curve trades for ${token.token_address}` },
  );
  return { trades, truncated: trades.length >= PAGE_SIZE * MAX_PAGES };
}

/** Tokens that have migrated but have no curve summary yet. */
export async function curveCandidates(limit: number) {
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,creator_address,bitquery_curve_stats(token_address)")
    .order("migrated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Choose curve candidates: ${error.message}`);

  const pending = (data ?? [])
    .filter((row) => !(row as { bitquery_curve_stats?: unknown[] }).bitquery_curve_stats?.length)
    .map((row) => ({
      token_address: row.token_address as string,
      migrated_at: row.migrated_at as string,
      creator_address: (row.creator_address ?? null) as string | null,
    }));
  if (!pending.length) return [];

  // Launch times live on the metadata table, and not every token has one.
  const launches = new Map<string, string | null>();
  for (let index = 0; index < pending.length; index += 200) {
    const chunk = pending.slice(index, index + 200).map((row) => row.token_address);
    const { data: rows, error: launchError } = await db.from("bitquery_launch_metadata_test")
      .select("token_address,launched_at")
      .in("token_address", chunk);
    if (launchError) throw new Error(`Read launch times: ${launchError.message}`);
    for (const row of rows ?? []) launches.set(row.token_address, row.launched_at);
  }

  return pending.map((row) => ({ ...row, launched_at: launches.get(row.token_address) ?? null })) as CurveToken[];
}

export async function updateCurveStats(tokens: CurveToken[]) {
  if (!tokens.length) return 0;
  const rows = [];
  for (const token of tokens) {
    const { trades, truncated } = await fetchCurveTrades(token);
    rows.push(summariseCurve(token, trades, truncated));
  }
  const { error } = await db.from("bitquery_curve_stats").upsert(rows, { onConflict: "token_address" });
  if (error) throw new Error(`Save curve stats: ${error.message}`);
  return rows.length;
}

/**
 * Fills curve stats for every migrated token that lacks them. Safe to re-run and
 * safe to run while the recorder is live; the two share this code, so a
 * backfilled row and a live one are computed identically.
 */
export async function backfillCurveStats({
  log = console.log,
  batch = 5,
}: { log?: (message: string) => void; batch?: number } = {}) {
  let done = 0;
  for (let round = 0; round < 1000; round += 1) {
    const tokens = await curveCandidates(2000);
    if (!tokens.length) {
      log(`Curve backfill complete, ${done} tokens summarised`);
      return done;
    }
    const slice = tokens.slice(0, batch);
    try {
      done += await updateCurveStats(slice);
    } catch (error) {
      console.error(`Curve batch failed for ${slice.map((t) => t.token_address).join(", ")}`, error);
      return done;
    }
    if (done % 25 < batch) log(`  ${done}/${tokens.length + done} tokens summarised`);
  }
  return done;
}
