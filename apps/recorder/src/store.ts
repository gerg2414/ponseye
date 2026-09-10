import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { argumentMap, decodeLaunchMetadata, eventId, ipfsUrl, launchAddresses } from "./parser.js";

const db = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { retry: false },
});

const tokenByCurve = new Map<string, string>();
const knownTokens = new Set<string>();
const lastStatusWrite = new Map<string, { status: string; at: number }>();

type LaunchCall = {
  Block: { Time: string; Number?: string };
  Transaction: { Hash: string; From: string };
  Call: { To: string; Value: string; Input: string; Output: string };
};

type EventRow = {
  Block: { Time: string; Number?: string };
  Transaction: { Hash: string; From?: string };
  LogHeader: { Address: string };
  Log: { Signature: { Name: string } };
  Arguments: Array<{ Name: string; Value: { address?: string; bigInteger?: string; integer?: number } }>;
};

type MarketTradeRow = {
  Block: { Time: string };
  Side: string;
  Price?: string | number;
  PriceInUsd?: string | number;
  Amounts?: { Base?: string | number; Quote?: string | number };
  AmountsInUsd?: { Base?: string | number; Quote?: string | number };
  Trader?: { Address?: string };
  TransactionHeader: { Hash: string };
  Pair: {
    Pool?: { Address?: string };
    Token: { Address: string; Symbol?: string };
    QuoteToken?: { Address?: string; Symbol?: string };
    Market?: { Protocol?: string };
  };
};

export type HolderCandidate = {
  token_address: string;
  curve_address: string;
  deployer_address: string;
  status: string;
  launched_at: string;
  last_trade_at: string | null;
  holder_snapshot_at: string | null;
};

export type HolderPosition = {
  holderAddress: string;
  balance: number;
  balancePct: number | null;
  rank: number;
  firstChangeAt: string | null;
  lastChangeAt: string | null;
  updateCount: number | null;
};

export type HolderSnapshot = {
  tokenAddress: string;
  observedAt: string;
  holderCount: number;
  totalHolderBalance: number;
  largestHolderPct: number | null;
  top10HolderPct: number | null;
  top100HolderPct: number | null;
  creatorBalancePct: number | null;
  positions: HolderPosition[];
  rawMetrics: unknown;
};

function assertOk(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export async function saveLaunchCall(row: LaunchCall) {
  const addresses = launchAddresses(row.Call.Output);
  const metadata = decodeLaunchMetadata(row.Call.Input);
  const payload = {
    token_address: addresses.tokenAddress,
    curve_address: addresses.curveAddress,
    deployer_address: row.Transaction.From.toLowerCase(),
    transaction_hash: row.Transaction.Hash.toLowerCase(),
    launched_at: row.Block.Time,
    block_number: row.Block.Number ?? null,
    factory_or_router: row.Call.To.toLowerCase(),
    attached_value_raw: row.Call.Value,
    name: metadata.name ?? null,
    symbol: metadata.symbol ?? null,
    image_uri: metadata.logo ?? null,
    image_url: ipfsUrl(metadata.logo),
    description: metadata.description ?? null,
    twitter_url: metadata.twitter ?? null,
    telegram_url: metadata.telegram ?? null,
    discord_url: metadata.discord ?? null,
    website_url: metadata.website ?? null,
    farcaster_url: metadata.farcaster ?? null,
    creator_fee_recipient: metadata.creatorFeeRecipient?.toLowerCase() ?? null,
    creator_tax_bps: metadata.creatorTaxBps ?? null,
    buyback_enabled: metadata.buybackEnabled ?? null,
    pair_token_address: metadata.pairToken ?? null,
    launch_config_id: metadata.launchConfigId ?? null,
    initial_quote_in_raw: metadata.initialQuoteIn ?? null,
    raw_launch_call: row,
  };
  const { error } = await db.from("launches").upsert(payload, { onConflict: "curve_address" });
  assertOk(error, "save launch");
  tokenByCurve.set(addresses.curveAddress, addresses.tokenAddress);
  knownTokens.add(addresses.tokenAddress);
}

export async function saveFactoryEvent(row: EventRow) {
  const args = argumentMap(row.Arguments);
  const name = row.Log.Signature.Name;
  const token = String(args.token ?? "").toLowerCase();
  if (!token) return;

  if (name === "TokenLaunched") {
    const { error } = await db.from("launches").upsert({
      token_address: token,
      curve_address: String(args.curve).toLowerCase(),
      deployer_address: String(args.deployer).toLowerCase(),
      pair_token_address: String(args.pairToken).toLowerCase(),
      launch_config_id: String(args.launchConfigId),
      graduation_threshold_raw: String(args.graduationThreshold),
      transaction_hash: row.Transaction.Hash.toLowerCase(),
      launched_at: row.Block.Time,
      block_number: row.Block.Number ?? null,
      raw_factory_event: row,
    }, { onConflict: "curve_address", ignoreDuplicates: false });
    assertOk(error, "save TokenLaunched");
    tokenByCurve.set(String(args.curve).toLowerCase(), token);
    knownTokens.add(token);
    return;
  }

  const update = name === "PoolGraduated"
    ? { status: "graduated", graduated_at: row.Block.Time, graduation_transaction_hash: row.Transaction.Hash.toLowerCase() }
    : { status: "swept", swept_at: row.Block.Time };
  const { error } = await db.from("launches").update(update).eq("token_address", token);
  assertOk(error, `save ${name}`);
}

export async function saveTrade(row: EventRow) {
  const args = argumentMap(row.Arguments);
  const side = row.Log.Signature.Name === "CurveBuy" ? "buy" : "sell";
  const curve = row.LogHeader.Address.toLowerCase();
  const trader = String(args.buyer ?? args.seller ?? row.Transaction.From ?? "").toLowerCase();
  const id = eventId([row.Transaction.Hash, curve, side, row.Arguments]);
  let tokenAddress = tokenByCurve.get(curve);
  if (!tokenAddress) {
    const { data: launch } = await db
      .from("launches")
      .select("token_address")
      .eq("curve_address", curve)
      .maybeSingle();
    tokenAddress = launch?.token_address;
    if (tokenAddress) {
      tokenByCurve.set(curve, tokenAddress);
      knownTokens.add(tokenAddress);
    }
  }

  // Ignore older or unrelated curves that are not part of this fresh PonsEye run.
  if (!tokenAddress) return;

  const { error } = await db.from("trades").upsert({
    event_id: id,
    token_address: tokenAddress,
    curve_address: curve,
    transaction_hash: row.Transaction.Hash.toLowerCase(),
    block_time: row.Block.Time,
    block_number: row.Block.Number ?? null,
    side,
    trader_address: trader || null,
    recipient_address: args.recipient ? String(args.recipient).toLowerCase() : null,
    quote_amount_raw: String(side === "buy" ? args.quoteIn : args.quoteOut),
    token_amount_raw: String(side === "buy" ? args.tokensOut : args.tokensIn),
    fee_raw: String(args.fee ?? "0"),
    tax_raw: String(args.tax ?? "0"),
    raw_event: row,
  }, { onConflict: "event_id", ignoreDuplicates: true });
  assertOk(error, "save trade");
}

export async function saveMarketTrade(row: MarketTradeRow) {
  const tokenAddress = row.Pair.Token.Address?.toLowerCase();
  if (!tokenAddress) return;
  if (!knownTokens.has(tokenAddress)) return;

  const side = row.Side.toLowerCase() === "buy" ? "buy" : "sell";
  const transactionHash = row.TransactionHeader.Hash.toLowerCase();
  const traderAddress = row.Trader?.Address?.toLowerCase() ?? null;
  const marketEventId = eventId([
    transactionHash,
    tokenAddress,
    row.Pair.Pool?.Address,
    row.Pair.Market?.Protocol,
    side,
    traderAddress,
    row.Amounts?.Base,
    row.Amounts?.Quote,
    row.Pair.QuoteToken?.Address,
  ]);

  const { error } = await db.from("trade_market_data").upsert({
    market_event_id: marketEventId,
    token_address: tokenAddress,
    transaction_hash: transactionHash,
    block_time: row.Block.Time,
    side,
    trader_address: traderAddress,
    price: row.Price ?? null,
    price_usd: row.PriceInUsd ?? null,
    base_amount: row.Amounts?.Base ?? null,
    quote_amount: row.Amounts?.Quote ?? null,
    base_amount_usd: row.AmountsInUsd?.Base ?? null,
    quote_amount_usd: row.AmountsInUsd?.Quote ?? null,
    quote_token_address: row.Pair.QuoteToken?.Address?.toLowerCase() ?? null,
    quote_symbol: row.Pair.QuoteToken?.Symbol ?? null,
    protocol: row.Pair.Market?.Protocol ?? null,
    raw_trade: row,
  }, { onConflict: "market_event_id", ignoreDuplicates: true });
  assertOk(error, "save market trade");
}

export async function warmTokenCache() {
  const tokens = await getActiveMarketTokens();
  console.log(`Loaded ${tokens.length} active tokens (${knownTokens.size} total tracked) into memory`);
}

export async function getActiveMarketTokens(): Promise<string[]> {
  const activeSince = new Date(Date.now() - 60 * 60_000).toISOString();
  const activeResult = await db
    .from("launch_metrics")
    .select("token_address")
    .gte("last_trade_at", activeSince)
    .order("last_trade_at", { ascending: false })
    .limit(1000)
    .abortSignal(AbortSignal.timeout(10_000));
  assertOk(activeResult.error, "warm active token cache");

  const tokens = [...new Set((activeResult.data ?? []).map((launch) => String(launch.token_address).toLowerCase()))]
    .sort();
  for (const token of tokens) knownTokens.add(token);

  return tokens;
}

export async function updateStreamStatus(feed: string, status: string, message?: string) {
  const now = Date.now();
  const prior = lastStatusWrite.get(feed);
  if (status === "connected" && prior?.status === status && now - prior.at < 30_000) return;
  lastStatusWrite.set(feed, { status, at: now });

  const { error } = await db.from("stream_status").upsert({
    feed,
    status,
    message: message ?? null,
    last_seen_at: new Date().toISOString(),
  });
  if (error) lastStatusWrite.delete(feed);
  assertOk(error, "update stream status");
}

export async function getHolderCandidates(): Promise<HolderCandidate[]> {
  const activeSince = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data, error } = await db
    .from("launch_metrics")
    .select("token_address,last_trade_at,holder_snapshot_at,launches!inner(curve_address,deployer_address,status,launched_at)")
    .gte("last_trade_at", activeSince)
    .order("last_trade_at", { ascending: false })
    .limit(1000)
    .abortSignal(AbortSignal.timeout(10_000));
  assertOk(error, "load holder candidates");
  return (data ?? []).flatMap((row) => {
    const launch = Array.isArray(row.launches) ? row.launches[0] : row.launches;
    if (!launch) return [];
    return [{
      token_address: row.token_address,
      curve_address: launch.curve_address,
      deployer_address: launch.deployer_address,
      status: launch.status,
      launched_at: launch.launched_at,
      last_trade_at: row.last_trade_at,
      holder_snapshot_at: row.holder_snapshot_at,
    }];
  });
}

export async function saveHolderSnapshot(snapshot: HolderSnapshot) {
  const { error: snapshotError } = await db.from("holder_snapshots").insert({
    token_address: snapshot.tokenAddress,
    observed_at: snapshot.observedAt,
    holder_count: snapshot.holderCount,
    total_holder_balance: snapshot.totalHolderBalance,
    largest_holder_pct: snapshot.largestHolderPct,
    top_10_holder_pct: snapshot.top10HolderPct,
    top_100_holder_pct: snapshot.top100HolderPct,
    creator_balance_pct: snapshot.creatorBalancePct,
    raw_metrics: snapshot.rawMetrics,
  });
  assertOk(snapshotError, "save holder snapshot");

  if (snapshot.positions.length) {
    const rows = snapshot.positions.map((position) => ({
      token_address: snapshot.tokenAddress,
      holder_address: position.holderAddress,
      balance: position.balance,
      balance_pct: position.balancePct,
      holder_rank: position.rank,
      first_change_at: position.firstChangeAt,
      last_change_at: position.lastChangeAt,
      update_count: position.updateCount,
      refreshed_at: snapshot.observedAt,
    }));
    const { error: positionsError } = await db
      .from("token_holder_positions")
      .upsert(rows, { onConflict: "token_address,holder_address" });
    assertOk(positionsError, "save holder positions");
  }

  const { error: cleanupError } = await db
    .from("token_holder_positions")
    .delete()
    .eq("token_address", snapshot.tokenAddress)
    .lt("refreshed_at", snapshot.observedAt);
  assertOk(cleanupError, "remove stale holder positions");
}
