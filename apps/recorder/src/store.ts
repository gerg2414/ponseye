import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { argumentMap, decodeLaunchMetadata, eventId, ipfsUrl, launchAddresses } from "./parser.js";

const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
    }, { onConflict: "token_address", ignoreDuplicates: false });
    assertOk(error, "save TokenLaunched");
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
  const { data: launch } = await db
    .from("launches")
    .select("token_address")
    .eq("curve_address", curve)
    .maybeSingle();

  const { error } = await db.from("trades").upsert({
    event_id: id,
    token_address: launch?.token_address ?? null,
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

export async function updateStreamStatus(feed: string, status: string, message?: string) {
  const { error } = await db.from("stream_status").upsert({
    feed,
    status,
    message: message ?? null,
    last_seen_at: new Date().toISOString(),
  });
  assertOk(error, "update stream status");
}
