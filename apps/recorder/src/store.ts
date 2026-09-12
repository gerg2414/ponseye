import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { argumentMap, decodeLaunchMetadata, eventId, ipfsUrl, launchAddresses } from "./parser.js";

const db = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { retry: false },
});

const tokenByCurve = new Map<string, string>();
const unknownCurves = new Set<string>();
const knownTokens = new Set<string>();
const lastStatusWrite = new Map<string, { status: string; at: number }>();
const recorderFeeds = ["launch_activity", "curve_trades", "market_trades", "holder_snapshots"];

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

export type MarketTradeRow = {
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

export type MarketBackfillCandidate = {
  token_address: string;
  launched_at: string;
  graduated_at: string;
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
  const { error } = await db.from("launches").upsert(payload, { onConflict: "token_address" });
  assertOk(error, "save launch");
  tokenByCurve.set(addresses.curveAddress, addresses.tokenAddress);
  unknownCurves.delete(addresses.curveAddress);
  knownTokens.add(addresses.tokenAddress);
}

export async function saveFactoryEvent(row: EventRow) {
  const args = argumentMap(row.Arguments);
  const name = row.Log.Signature.Name;
  const token = String(args.token ?? "").toLowerCase();
  if (!token) return null;

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
    }, { onConflict: "token_address", ignoreDuplicates: false });
    assertOk(error, "save TokenLaunched");
    tokenByCurve.set(String(args.curve).toLowerCase(), token);
    unknownCurves.delete(String(args.curve).toLowerCase());
    knownTokens.add(token);
    return token;
  }

  const update = name === "PoolGraduated"
    ? { status: "graduated", graduated_at: row.Block.Time, graduation_transaction_hash: row.Transaction.Hash.toLowerCase() }
    : { status: "swept", swept_at: row.Block.Time };
  const { error } = await db.from("launches").update(update).eq("token_address", token);
  assertOk(error, `save ${name}`);
  return token;
}

export async function saveTrade(row: EventRow) {
  const args = argumentMap(row.Arguments);
  const side = row.Log.Signature.Name === "CurveBuy" ? "buy" : "sell";
  const curve = row.LogHeader.Address.toLowerCase();
  const trader = String(args.buyer ?? args.seller ?? row.Transaction.From ?? "").toLowerCase();
  const id = eventId([row.Transaction.Hash, curve, side, row.Arguments]);
  let tokenAddress = tokenByCurve.get(curve);
  if (!tokenAddress && unknownCurves.has(curve)) return false;
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
    } else {
      // Most CurveBuy/CurveSell events on Robinhood are unrelated to Pons.
      // Remember misses for this recorder cycle instead of querying Supabase on
      // every subsequent trade from the same unrelated curve.
      unknownCurves.add(curve);
    }
  }

  // Ignore older or unrelated curves that are not part of this fresh PonsEye run.
  if (!tokenAddress) return false;

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
  }, { onConflict: "event_id", ignoreDuplicates: true });
  assertOk(error, "save trade");
  return true;
}

function marketTradePayload(row: MarketTradeRow) {
  const tokenAddress = row.Pair.Token.Address?.toLowerCase();
  if (!tokenAddress || !knownTokens.has(tokenAddress)) return null;

  const side = row.Side.toLowerCase() === "buy" ? "buy" : "sell";
  const transactionHash = row.TransactionHeader.Hash.toLowerCase();
  const protocol = row.Pair.Market?.Protocol?.toLowerCase() ?? null;
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
  const baseAmount = Number(row.Amounts?.Base);
  const tradeValueUsd = Number(row.AmountsInUsd?.Base ?? row.AmountsInUsd?.Quote);
  const reliablePrice = !(
    (Number.isFinite(baseAmount) && baseAmount > 0 && baseAmount < 1)
    || (
      Number.isFinite(baseAmount)
      && baseAmount > 0
      && baseAmount < 1_000
      && Number.isFinite(tradeValueUsd)
      && tradeValueUsd >= 0
      && tradeValueUsd < 0.10
    )
  );

  return {
    market_event_id: marketEventId,
    token_address: tokenAddress,
    transaction_hash: transactionHash,
    block_time: row.Block.Time,
    side,
    trader_address: traderAddress,
    // Bitquery occasionally emits microscopic secondary swap legs with a
    // mathematically valid but economically meaningless unit price. Keep the
    // trade and its volume, but do not let those dust legs paint charts, ATHs,
    // or paper-position exits.
    price: reliablePrice ? row.Price ?? null : null,
    price_usd: reliablePrice ? row.PriceInUsd ?? null : null,
    base_amount: row.Amounts?.Base ?? null,
    quote_amount: row.Amounts?.Quote ?? null,
    base_amount_usd: row.AmountsInUsd?.Base ?? null,
    quote_amount_usd: row.AmountsInUsd?.Quote ?? null,
    quote_token_address: row.Pair.QuoteToken?.Address?.toLowerCase() ?? null,
    quote_symbol: row.Pair.QuoteToken?.Symbol ?? null,
    protocol,
  };
}

export async function saveMarketTrade(row: MarketTradeRow) {
  const payload = marketTradePayload(row);
  if (!payload) return false;
  const { error } = await db.from("trade_market_data").upsert(payload, { onConflict: "market_event_id", ignoreDuplicates: true });
  assertOk(error, "save market trade");

  if (payload.protocol === "uniswap_v4") {
    const { error: migrationError } = await db.from("launches").update({
      status: "graduated",
      graduated_at: payload.block_time,
      graduation_transaction_hash: payload.transaction_hash,
    }).eq("token_address", payload.token_address).is("graduated_at", null);
    assertOk(migrationError, "confirm migration from pool trade");
  }
  return true;
}

export async function saveMarketTrades(rows: MarketTradeRow[]) {
  const payloads = rows.flatMap((row) => {
    const payload = marketTradePayload(row);
    return payload ? [payload] : [];
  });
  if (!payloads.length) return 0;

  const { error } = await db.from("trade_market_data")
    .upsert(payloads, { onConflict: "market_event_id", ignoreDuplicates: true });
  assertOk(error, "save market trade batch");

  const firstPoolByToken = new Map<string, (typeof payloads)[number]>();
  for (const payload of payloads) {
    if (payload.protocol !== "uniswap_v4") continue;
    const current = firstPoolByToken.get(payload.token_address);
    if (!current || payload.block_time < current.block_time) firstPoolByToken.set(payload.token_address, payload);
  }
  for (const payload of firstPoolByToken.values()) {
    const { error: migrationError } = await db.from("launches").update({
      status: "graduated",
      graduated_at: payload.block_time,
      graduation_transaction_hash: payload.transaction_hash,
    }).eq("token_address", payload.token_address).is("graduated_at", null);
    assertOk(migrationError, "confirm migration from market trade batch");
  }
  return payloads.length;
}

export async function warmTokenCache() {
  const tokens = await getActiveMarketTokens();
  console.log(`Loaded ${tokens.length} active tokens (${knownTokens.size} total tracked) into memory`);
}

export async function getMarketBackfillCandidate(tokenAddress: string): Promise<MarketBackfillCandidate | null> {
  const token = tokenAddress.toLowerCase();
  const { data, error } = await db
    .from("launches")
    .select("token_address,launched_at,graduated_at")
    .eq("token_address", token)
    .maybeSingle();
  assertOk(error, "load market backfill token");
  if (!data?.graduated_at) return null;
  knownTokens.add(token);
  return data as MarketBackfillCandidate;
}

export async function getMarketBackfillCandidates(): Promise<MarketBackfillCandidate[]> {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await db
    .from("launches")
    .select("token_address,launched_at,graduated_at,launch_metrics!inner(research_state)")
    .not("graduated_at", "is", null)
    .gte("graduated_at", since)
    .in("launch_metrics.research_state", ["under_watch", "target_locked"])
    .order("graduated_at", { ascending: false })
    .limit(100)
    .abortSignal(AbortSignal.timeout(30_000));
  assertOk(error, "load market backfill candidates");

  const candidates = (data ?? []).map((row) => ({
    token_address: String(row.token_address).toLowerCase(),
    launched_at: String(row.launched_at),
    graduated_at: String(row.graduated_at),
  }));
  for (const candidate of candidates) knownTokens.add(candidate.token_address);
  return candidates;
}

export async function getActiveMarketTokens(): Promise<string[]> {
  const activeSince = new Date(Date.now() - 60 * 60_000).toISOString();
  const activeResult = await db
    .from("launch_metrics")
    .select("token_address")
    .in("research_state", ["under_watch", "target_locked"])
    .or(`last_trade_at.gte.${activeSince},usd_price_at.gte.${activeSince}`)
    .order("updated_at", { ascending: false })
    .limit(1000)
    .abortSignal(AbortSignal.timeout(30_000));
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
  if (error) {
    lastStatusWrite.delete(feed);
    console.error(`[${feed}] status update failed`, error.message);
  }
}

export async function getRecorderEnabled() {
  const { data, error } = await db
    .from("recorder_control")
    .select("enabled")
    .eq("id", 1)
    .abortSignal(AbortSignal.timeout(10_000))
    .single();
  if (error || !data) throw new Error(`load recorder control: ${error?.message ?? "control row missing"}`);
  return data.enabled === true;
}

export async function markRecorderPaused(message = "Recorder paused from Lab") {
  await Promise.all(recorderFeeds.map((feed) => updateStreamStatus(feed, "stopped", message)));
}

export async function getHolderCandidates(): Promise<HolderCandidate[]> {
  const activeSince = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data, error } = await db
    .from("launch_metrics")
    .select("token_address,last_trade_at,holder_snapshot_at,launches!inner(curve_address,deployer_address,status,launched_at)")
    .in("research_state", ["under_watch", "target_locked"])
    .or(`last_trade_at.gte.${activeSince},usd_price_at.gte.${activeSince}`)
    .order("updated_at", { ascending: false })
    .limit(1000)
    .abortSignal(AbortSignal.timeout(30_000));
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
