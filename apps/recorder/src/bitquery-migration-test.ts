import {
  BitqueryAuthError,
  assertAddress,
  delay,
  fetchAllPages,
  getAccessToken,
  invalidateAccessToken,
  isAddress,
  labelQueries,
  mapWithConcurrency,
  number,
  queryBitquery,
} from "./bitquery-client.js";
import { BACKFILL_WINDOW_MS, TRACKING_WINDOW_MS, config } from "./config.js";
import { db } from "./db.js";
import { curveCandidates, updateCurveStats } from "./curve.js";
import { holderCandidates, updateHolders } from "./holders.js";
import { entrySignals, openPositions, updatePositions } from "./positions.js";
import { budgetLevel, getBitqueryUsage, stageAllowed, type BudgetLevel } from "./usage.js";
import { refreshSnapshotOutcomes } from "./snapshots.js";

const PONS_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
const POOL_REGISTERED_TOPIC = "01bf263a1db1652580721573296e1a1fa70b3d4c87f61d02a69c4e1109d2d573";
/** PONS mints one billion tokens. Used only when Bitquery reports no supply. */
const DEFAULT_SUPPLY = 1_000_000_000;
/** Tokens that never trade would otherwise be retried forever. */
const MAX_HISTORY_ATTEMPTS = 5;

type BitqueryArgument = {
  Name: string;
  Value: { address?: string; bigInteger?: string; integer?: number };
};

type GraduationEvent = {
  Block: { Time: string; Number?: string };
  Transaction: { Hash: string };
  Arguments: BitqueryArgument[];
};

type RegistrationEvent = {
  Block: { Time: string; Number?: string };
  Transaction: { Hash: string };
  LogHeader: { Data: string };
};

type LaunchCall = {
  Block?: { Time?: string };
  Transaction: { Hash: string; From?: string };
  Call: { Input: string; Output: string };
};

type MarketRow = {
  Block: { Time: string };
  Token?: { Address?: string; Symbol?: string; Name?: string };
  Volume?: { Usd?: string | number };
  Price?: { Ohlc?: { Open?: string | number; High?: string | number; Low?: string | number; Close?: string | number } };
  Supply?: { TotalSupply?: string | number };
  trades?: string | number;
};

type TradeFlowRow = {
  buys?: string | number;
  sells?: string | number;
  buyVolume?: string | number;
  sellVolume?: string | number;
  uniqueTraders?: string | number;
};

type MigrationData = {
  EVM?: { Graduations?: GraduationEvent[]; Registrations?: RegistrationEvent[] };
};

type LaunchData = { EVM?: { Launches?: LaunchCall[] } };

type HistoryData = { Trading?: { Tokens?: MarketRow[] } };

type LiveMarketData = { Trading?: Record<string, MarketRow[] | TradeFlowRow[] | undefined> };

type TrackedToken = {
  token_address: string;
  migrated_at: string;
  transaction_hash: string;
  token_supply: number | string | null;
};

type HistoryCandidate = TrackedToken & { migration_price_attempts: number | null };

type MigrationPriceCandidate = {
  token_address: string;
  migrated_at: string;
  transaction_hash: string;
  quote_token_address: string | null;
  token_amount_raw: string | null;
  pair_token_amount_raw: string | null;
  migration_price_attempts: number | null;
};

type PairRow = { Block?: { Time?: string }; Price?: { Ohlc?: { High?: string | number; Close?: string | number } } };

type MigrationPriceData = { Trading?: Record<string, PairRow[] | MarketRow[] | undefined> };

type LivePriceRow = {
  Block?: { Time?: string };
  Token?: { Address?: string; Symbol?: string; Name?: string };
  Price?: { Ohlc?: { High?: string | number; Close?: string | number } };
};

type LivePricePayload = {
  data?: { Trading?: { Pairs?: LivePriceRow[] } };
  errors?: Array<{ message?: string }>;
};

let running = true;

export function stopBitqueryMigrationTest() {
  running = false;
}

function supplyOf(token: { token_supply: number | string | null }) {
  return positiveSupply(token.token_supply) ?? DEFAULT_SUPPLY;
}

/**
 * Bitquery reports CirculatingSupply as 0 for PONS tokens on Robinhood chain.
 * TotalSupply carries the real figure, but guard anyway: treating a reported 0
 * as a value would drive every market cap to zero.
 */
function positiveSupply(value: unknown) {
  const parsed = number(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function argumentMap(args: BitqueryArgument[] = []) {
  return Object.fromEntries(args.map((arg) => [
    arg.Name,
    arg.Value.address ?? arg.Value.bigInteger ?? arg.Value.integer ?? null,
  ]));
}

function addressWord(word?: string) {
  if (!word || word.length !== 64) return null;
  return `0x${word.slice(24)}`.toLowerCase();
}

function decodeRegistration(data: string) {
  const clean = data.replace(/^0x/, "");
  return {
    tokenAddress: addressWord(clean.slice(0, 64)),
    quoteTokenAddress: addressWord(clean.slice(64, 128)),
    creatorAddress: addressWord(clean.slice(128, 192)),
  };
}

function hexWord(hex: string, byteOffset: number) {
  return hex.slice(byteOffset * 2, byteOffset * 2 + 64);
}

function wordNumber(word: string) {
  if (!/^[0-9a-f]{64}$/i.test(word)) return null;
  const value = Number.parseInt(word, 16);
  return Number.isSafeInteger(value) ? value : null;
}

function dynamicString(hex: string, baseByteOffset: number, offsetWord: string) {
  const relativeOffset = wordNumber(offsetWord);
  if (relativeOffset == null) return null;
  const start = baseByteOffset + relativeOffset;
  const length = wordNumber(hexWord(hex, start));
  if (length == null || length < 0 || length > 100_000) return null;
  const encoded = hex.slice((start + 32) * 2, (start + 32 + length) * 2);
  if (encoded.length !== length * 2) return null;
  try {
    return Buffer.from(encoded, "hex").toString("utf8").replace(/\0/g, "").trim() || null;
  } catch {
    return null;
  }
}

function decodeLaunch(call: LaunchCall) {
  const input = call.Call.Input.replace(/^0x/, "");
  const output = call.Call.Output.replace(/^0x/, "");
  if (input.length < 8 + 64 || output.length < 64) return null;
  const args = input.slice(8);
  const tupleOffset = wordNumber(hexWord(args, 0));
  const tokenAddress = addressWord(hexWord(output, 0));
  if (tupleOffset == null || !tokenAddress) return null;
  const tuple = tupleOffset;
  const socialsOffset = wordNumber(hexWord(args, tuple + 4 * 32));
  const socials = socialsOffset == null ? null : tuple + socialsOffset;
  return {
    tokenAddress,
    name: dynamicString(args, tuple, hexWord(args, tuple)),
    symbol: dynamicString(args, tuple, hexWord(args, tuple + 32)),
    imageUrl: dynamicString(args, tuple, hexWord(args, tuple + 2 * 32)),
    description: dynamicString(args, tuple, hexWord(args, tuple + 3 * 32)),
    twitterUrl: socials == null ? null : dynamicString(args, socials, hexWord(args, socials)),
    telegramUrl: socials == null ? null : dynamicString(args, socials, hexWord(args, socials + 32)),
    discordUrl: socials == null ? null : dynamicString(args, socials, hexWord(args, socials + 2 * 32)),
    websiteUrl: socials == null ? null : dynamicString(args, socials, hexWord(args, socials + 3 * 32)),
    farcasterUrl: socials == null ? null : dynamicString(args, socials, hexWord(args, socials + 4 * 32)),
    creatorFeeRecipient: addressWord(hexWord(args, tuple + 5 * 32)),
    creatorTaxBps: wordNumber(hexWord(args, tuple + 6 * 32)),
    buybackEnabled: wordNumber(hexWord(args, tuple + 7 * 32)) === 1,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function migrationQuery(since: string, till: string, limit: number, offset: number) {
  return `
    query PonsMigrationTest {
      EVM(network: robinhood) {
        Graduations: Events(
          limit: {count: ${limit}, offset: ${offset}}
          orderBy: {ascending: Block_Time}
          where: {
            Block: {Time: {since: "${since}", till: "${till}"}}
            LogHeader: {Address: {is: "${PONS_FACTORY}"}}
            Log: {Signature: {Name: {is: "PoolGraduated"}}}
          }
        ) {
          Block { Time Number }
          Transaction { Hash }
          Arguments {
            Name
            Value {
              ... on EVM_ABI_Address_Value_Arg { address }
              ... on EVM_ABI_BigInt_Value_Arg { bigInteger }
              ... on EVM_ABI_Integer_Value_Arg { integer }
            }
          }
        }
      }
    }
  `;
}

function registrationQuery(since: string, till: string, limit: number, offset: number) {
  return `
    query PonsRegistrationTest {
      EVM(network: robinhood) {
        Registrations: Events(
          limit: {count: ${limit}, offset: ${offset}}
          orderBy: {ascending: Block_Time}
          where: {
            Block: {Time: {since: "${since}", till: "${till}"}}
            LogHeader: {Address: {is: "${PONS_HOOK}"}}
            Topics: {includes: [{Hash: {is: "${POOL_REGISTERED_TOPIC}"}}]}
          }
        ) {
          Block { Time Number }
          Transaction { Hash }
          LogHeader { Data }
        }
      }
    }
  `;
}

function launchMetadataQuery(since: string, till: string, limit: number, offset: number) {
  return `
    query PonsLaunchMetadataTest {
      EVM(network: robinhood) {
        Launches: Calls(
          limit: {count: ${limit}, offset: ${offset}}
          orderBy: {ascending: Block_Time}
          where: {
            Block: {Time: {since: "${since}", till: "${till}"}}
            Call: {
              To: {in: ["0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e", "0xe33e9e479df8802cb0866d5d05258bec4cf62948"]}
              Input: {startsWith: ["0xf35abbcf", "0xa72101af", "0xf85f8e41"]}
              Success: true
            }
          }
        ) {
          Block { Time }
          Transaction { Hash From }
          Call { Input Output }
        }
      }
    }
  `;
}

/**
 * Full one-minute candle history for a token from its graduation onwards.
 *
 * Note that the first candle's Open is NOT the seeded pool price: measured over
 * 355 recorded migrations it is the bonding curve exit price, and the price can
 * move more than tenfold inside that first candle. migration_price_usd is
 * therefore left unmeasured here rather than recorded from a value known to be
 * wrong. See the pool-reserve derivation described in the migration notes.
 */
function historyQuery(tokenAddress: string, since: string, limit: number, offset: number) {
  return `
    query PonsMigrationHistory {
      Trading {
        Tokens(
          limit: {count: ${limit}, offset: ${offset}}
          orderBy: {ascending: Block_Time}
          where: {
            Token: {Address: {is: "${assertAddress(tokenAddress)}"} Network: {is: "Robinhood"}}
            Interval: {Time: {Duration: {eq: 60}}}
            Block: {Time: {since: "${since}"}}
          }
        ) {
          Block { Time }
          Token { Address Symbol Name }
          Volume { Usd }
          Price { Ohlc { Open High Low Close } }
          Supply { TotalSupply }
          trades: count
        }
      }
    }
  `;
}

/**
 * For each candidate, the same minute of trading expressed three ways: the pair
 * price in USD, the pair price in the quote token, and the token candle.
 *
 * Dividing the USD price by the quote-denominated price gives the quote token's
 * USD price at that moment, which is what converts the pool's raw reserve ratio
 * into a USD graduation price. The candle's High is carried only to infer the
 * decimal scale, never as the price itself.
 */
function migrationPriceQuery(candidates: MigrationPriceCandidate[]) {
  const fields = candidates.map((candidate, index) => {
    const address = assertAddress(candidate.token_address);
    const at = Date.parse(candidate.migrated_at);
    // A small window either side: the first trade lands a median 28s after the
    // graduation, and the rate only needs to be right to the minute.
    const since = new Date(at - 120_000).toISOString();
    const till = new Date(at + 300_000).toISOString();
    const pair = (alias: string, usd: boolean) => `
      ${alias}${index}: Pairs(
        limit: {count: 1}
        orderBy: {ascending: Block_Time}
        where: {
          Token: {Address: {is: "${address}"}}
          Market: {Network: {is: "Robinhood"}}
          Interval: {Time: {Duration: {eq: 60}}}
          Price: {IsQuotedInUsd: ${usd}}
          Block: {Time: {since: "${since}", till: "${till}"}}
        }
      ) { Block { Time } Price { Ohlc { High Close } } }`;
    return `
      ${pair("Usd", true)}
      ${pair("Quote", false)}
      Candle${index}: Tokens(
        limit: {count: 1}
        orderBy: {ascending: Block_Time}
        where: {
          Token: {Address: {is: "${address}"} Network: {is: "Robinhood"}}
          Interval: {Time: {Duration: {eq: 60}}}
          Block: {Time: {since: "${since}", till: "${till}"}}
        }
      ) { Block { Time } Price { Ohlc { High } } Supply { TotalSupply } }`;
  }).join("\n");

  return `query PonsMigrationPrice { Trading { ${fields} } }`;
}

function liveMarketQuery(candidates: TrackedToken[]) {
  const fields = candidates.map((candidate, index) => {
    const address = assertAddress(candidate.token_address);
    const since = new Date(candidate.migrated_at).toISOString();
    return `
      Token${index}: Tokens(
        limit: {count: 1}
        orderBy: {descending: Block_Time}
        where: {
          Token: {Address: {is: "${address}"} Network: {is: "Robinhood"}}
          Interval: {Time: {Duration: {eq: 60}}}
          Block: {Time: {since: "${since}"}}
        }
      ) {
        Block { Time }
        Token { Address Symbol Name }
        Price { Ohlc { High Close } }
        Supply { TotalSupply }
      }
      Flow${index}: Trades(
        limit: {count: 1}
        where: {
          Pair: {
            Token: {Address: {is: "${address}"}}
            Market: {Network: {is: "Robinhood"}}
          }
          Block: {Time: {since: "${since}"}}
        }
      ) {
        buys: count(if: {Side: {is: "Buy"}})
        sells: count(if: {Side: {is: "Sell"}})
        buyVolume: sum(of: AmountsInUsd_Quote, if: {Side: {is: "Buy"}})
        sellVolume: sum(of: AmountsInUsd_Quote, if: {Side: {is: "Sell"}})
        uniqueTraders: count(distinct: Trader_Address)
      }
    `;
  }).join("\n");

  return `query PonsMigrationLiveMarketTest { Trading { ${fields} } }`;
}

function livePriceSubscriptionQuery(addresses: string[]) {
  const list = addresses.map((address) => `"${assertAddress(address)}"`).join(",");
  return `
    subscription PonsMigrationLivePrices {
      Trading {
        Pairs(
          where: {
            Interval: {Time: {Duration: {eq: 1}}}
            Price: {IsQuotedInUsd: true}
            Market: {Network: {is: "Robinhood"}}
            Token: {Address: {in: [${list}]}}
            Ranking: {Position: {eq: 1}}
          }
        ) {
          Block { Time }
          Token { Address Symbol Name }
          Price { Ohlc { High Close } }
        }
      }
    }
  `;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Scan positions survive a restart.
 *
 * Without this every deploy restarted each scan at the far edge of its window,
 * so a day of deploys re-read the same forty-eight hours of launches once per
 * deploy. A stored position is only ever used when it sits inside the window;
 * anything older would leave a gap, so the window edge wins in that case.
 */
async function loadCursor(name: string, fallback: Date, earliest: Date) {
  const { data, error } = await db.from("bitquery_recorder_cursors")
    .select("position").eq("name", name).maybeSingle();
  if (error) {
    console.warn(`Could not read cursor "${name}", starting from the window edge: ${error.message}`);
    return fallback;
  }
  if (!data?.position) return fallback;
  const stored = new Date(data.position);
  if (!Number.isFinite(stored.getTime()) || stored < earliest) return fallback;
  // Never resume ahead of now, which a clock skew could otherwise cause.
  return stored > new Date() ? fallback : stored;
}

async function saveCursor(name: string, position: Date) {
  const { error } = await db.from("bitquery_recorder_cursors")
    .upsert({ name, position: position.toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "name" });
  if (error) console.warn(`Could not save cursor "${name}": ${error.message}`);
}

async function setStatus(status: "connecting" | "connected" | "error", message: string) {
  const { error } = await db.from("stream_status").upsert({
    feed: "bitquery_migration_test",
    status,
    message,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "feed" });
  if (error) throw new Error(`Save Bitquery test status: ${error.message}`);
}

async function saveMigrations(graduations: GraduationEvent[], registrationRows: RegistrationEvent[]) {
  if (!graduations.length) return 0;

  const registrations = new Map<string, RegistrationEvent>();
  for (const row of registrationRows) {
    const decoded = decodeRegistration(row.LogHeader.Data);
    if (decoded.tokenAddress) registrations.set(decoded.tokenAddress, row);
  }

  const graduationAddresses = graduations
    .map((graduation) => String(argumentMap(graduation.Arguments).token ?? "").toLowerCase())
    .filter(isAddress);

  const launches = new Map<string, Record<string, unknown>>();
  // Chunked because PostgREST builds an `in` list into the request URL.
  for (let index = 0; index < graduationAddresses.length; index += 200) {
    const chunk = graduationAddresses.slice(index, index + 200);
    const { data, error } = await db.from("bitquery_launch_metadata_test").select("*").in("token_address", chunk);
    if (error) throw new Error(`Read Bitquery launch metadata: ${error.message}`);
    for (const row of data ?? []) launches.set(row.token_address, row);
  }

  const seen = new Set<string>();
  const rows = graduations.flatMap((graduation) => {
    const args = argumentMap(graduation.Arguments);
    const tokenAddress = String(args.token ?? "").toLowerCase();
    // A token address may only appear once per upsert or Postgres rejects the
    // whole batch with "cannot affect row a second time".
    if (!isAddress(tokenAddress) || seen.has(tokenAddress)) return [];
    seen.add(tokenAddress);

    const registration = registrations.get(tokenAddress);
    const decoded = registration ? decodeRegistration(registration.LogHeader.Data) : null;
    const launch = launches.get(tokenAddress);
    const metadata = launch ? {
      name: launch.name,
      symbol: launch.symbol,
      image_url: launch.image_url,
      description: launch.description,
      twitter_url: launch.twitter_url,
      telegram_url: launch.telegram_url,
      discord_url: launch.discord_url,
      website_url: launch.website_url,
      farcaster_url: launch.farcaster_url,
      creator_tax_bps: launch.creator_tax_bps,
      buyback_enabled: launch.buyback_enabled,
      metadata_updated_at: new Date().toISOString(),
      metadata_source: "bitquery_launch_call",
    } : {};
    const creator = decoded?.creatorAddress ?? (launch?.creator_address as string | undefined);

    return [{
      token_address: tokenAddress,
      migrated_at: graduation.Block.Time,
      block_number: graduation.Block.Number ?? registration?.Block.Number ?? null,
      transaction_hash: graduation.Transaction.Hash.toLowerCase(),
      position_id: args.positionId == null ? null : String(args.positionId),
      token_amount_raw: args.tokenAmount == null ? null : String(args.tokenAmount),
      pair_token_amount_raw: args.pairTokenAmount == null ? null : String(args.pairTokenAmount),
      quote_token_address: decoded?.quoteTokenAddress ?? null,
      ...(creator ? { creator_address: creator } : {}),
      ...metadata,
      last_seen_at: new Date().toISOString(),
      raw_graduation: graduation,
      raw_registration: registration ?? null,
    }];
  });

  if (!rows.length) return 0;
  const { error } = await db.from("bitquery_migration_test").upsert(rows, { onConflict: "token_address" });
  if (error) throw new Error(`Save Bitquery migrations: ${error.message}`);
  return rows.length;
}

async function saveLaunchMetadata(calls: LaunchCall[]) {
  const seen = new Set<string>();
  const launchRows: Array<Record<string, unknown>> = [];

  for (const call of calls) {
    const decoded = decodeLaunch(call);
    if (!decoded || seen.has(decoded.tokenAddress)) continue;
    seen.add(decoded.tokenAddress);
    launchRows.push({
      token_address: decoded.tokenAddress,
      launched_at: call.Block?.Time ?? null,
      name: decoded.name,
      symbol: decoded.symbol,
      image_url: decoded.imageUrl,
      description: decoded.description,
      twitter_url: decoded.twitterUrl,
      telegram_url: decoded.telegramUrl,
      discord_url: decoded.discordUrl,
      website_url: decoded.websiteUrl,
      farcaster_url: decoded.farcasterUrl,
      creator_address: decoded.creatorFeeRecipient,
      creator_tax_bps: decoded.creatorTaxBps,
      buyback_enabled: decoded.buybackEnabled,
      raw_call: call,
      updated_at: new Date().toISOString(),
    });
  }

  if (!launchRows.length) return 0;
  const { error } = await db.from("bitquery_launch_metadata_test")
    .upsert(launchRows, { onConflict: "token_address" });
  if (error) throw new Error(`Save Bitquery launch metadata: ${error.message}`);
  return launchRows.length;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

async function collectMigrations(since: Date, till: Date) {
  const [graduations, registrations] = await Promise.all([
    fetchAllPages<GraduationEvent>(
      (limit, offset) => migrationQuery(since.toISOString(), till.toISOString(), limit, offset),
      (data) => (data as MigrationData).EVM?.Graduations ?? [],
      { label: "PONS graduations" },
    ),
    fetchAllPages<RegistrationEvent>(
      (limit, offset) => registrationQuery(since.toISOString(), till.toISOString(), limit, offset),
      (data) => (data as MigrationData).EVM?.Registrations ?? [],
      { label: "PONS registrations" },
    ),
  ]);
  return saveMigrations(graduations, registrations);
}

async function collectLaunchMetadata(since: Date, till: Date) {
  const calls = await fetchAllPages<LaunchCall>(
    (limit, offset) => launchMetadataQuery(since.toISOString(), till.toISOString(), limit, offset),
    (data) => (data as LaunchData).EVM?.Launches ?? [],
    { label: "PONS launches" },
  );
  return saveLaunchMetadata(calls);
}

/**
 * How often a token's trade flow is worth re-reading, by how old it is.
 *
 * Refreshing every token every few seconds is what makes this expensive, and it
 * buys nothing: a token that migrated yesterday does not change minute to
 * minute. Prices still arrive continuously over the WebSocket, which costs one
 * connection rather than one request per token.
 */
const REFRESH_TIERS = [
  { maxAgeMs: 60 * 60_000, everyMs: 30_000 },       // first hour: the decisive window
  { maxAgeMs: 6 * 60 * 60_000, everyMs: 5 * 60_000 },
  { maxAgeMs: Infinity, everyMs: 30 * 60_000 },
] as const;

function refreshIntervalFor(migratedAt: string) {
  const age = Date.now() - Date.parse(migratedAt);
  return (REFRESH_TIERS.find((tier) => age <= tier.maxAgeMs) ?? REFRESH_TIERS.at(-1)!).everyMs;
}

/** Tokens whose trade flow is stale enough, for their age, to be worth re-reading. */
async function staleTrackedTokens(limit: number) {
  const cutoff = new Date(Date.now() - TRACKING_WINDOW_MS).toISOString();
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,transaction_hash,token_supply,trade_flow_updated_at")
    .gte("migrated_at", cutoff)
    .order("trade_flow_updated_at", { ascending: true, nullsFirst: true })
    .limit(limit * 3);
  if (error) throw new Error(`Choose stale tracked tokens: ${error.message}`);

  const now = Date.now();
  return ((data ?? []) as Array<TrackedToken & { trade_flow_updated_at: string | null }>)
    .filter((row) => {
      if (!row.trade_flow_updated_at) return true;
      return now - Date.parse(row.trade_flow_updated_at) >= refreshIntervalFor(row.migrated_at);
    })
    .slice(0, limit) as TrackedToken[];
}

async function trackedTokens(limit: number, order: "trade_flow_updated_at") {
  const cutoff = new Date(Date.now() - TRACKING_WINDOW_MS).toISOString();
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,transaction_hash,token_supply")
    .gte("migrated_at", cutoff)
    .order(order, { ascending: true, nullsFirst: true })
    .order("migrated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Choose tracked tokens: ${error.message}`);
  return (data ?? []) as TrackedToken[];
}

/**
 * Current price and cumulative trade flow for tokens inside the tracking window.
 * Peaks are sent as observed rather than maxed in memory: the database keeps the
 * higher of the two, so a stale read here can no longer erase a recorded spike.
 */
async function updateLiveMetrics(candidates: TrackedToken[]) {
  if (!candidates.length) return;
  const trading = (await queryBitquery<LiveMarketData>(liveMarketQuery(candidates))).Trading ?? {};
  const updatedAt = new Date().toISOString();

  const updates = candidates.map((candidate, index) => {
    const last = ((trading[`Token${index}`] ?? []) as MarketRow[])[0];
    const flow = ((trading[`Flow${index}`] ?? []) as TradeFlowRow[])[0];
    const supply = positiveSupply(last?.Supply?.TotalSupply) ?? supplyOf(candidate);
    const currentPrice = number(last?.Price?.Ohlc?.Close);
    const latestHigh = number(last?.Price?.Ohlc?.High);
    const buys = Math.round(number(flow?.buys) ?? 0);
    const sells = Math.round(number(flow?.sells) ?? 0);
    const buyVolume = number(flow?.buyVolume);
    const sellVolume = number(flow?.sellVolume);

    return {
      token_address: candidate.token_address,
      migrated_at: candidate.migrated_at,
      transaction_hash: candidate.transaction_hash,
      token_supply: supply,
      ...(last?.Token?.Name ? { name: last.Token.Name } : {}),
      ...(last?.Token?.Symbol ? { symbol: last.Token.Symbol } : {}),
      ...(currentPrice == null ? {} : {
        current_price_usd: currentPrice,
        current_market_cap_usd: currentPrice * supply,
        price_observed_at: last?.Block.Time ?? updatedAt,
      }),
      ...(latestHigh == null ? {} : {
        ath_price_usd: latestHigh,
        ath_market_cap_usd: latestHigh * supply,
      }),
      volume_usd: (buyVolume ?? 0) + (sellVolume ?? 0),
      trade_count: buys + sells,
      buys,
      sells,
      buy_volume_usd: buyVolume,
      sell_volume_usd: sellVolume,
      unique_traders: Math.round(number(flow?.uniqueTraders) ?? 0),
      trade_flow_updated_at: updatedAt,
      ...(last?.Block.Time ? { latest_trade_at: last.Block.Time } : {}),
    };
  });

  const { error } = await db.from("bitquery_migration_test")
    .upsert(updates, { onConflict: "token_address" });
  if (error) throw new Error(`Save live Bitquery metrics batch: ${error.message}`);
}

async function migrationPriceCandidates(limit: number) {
  const cutoff = new Date(Date.now() - Math.max(TRACKING_WINDOW_MS, BACKFILL_WINDOW_MS)).toISOString();
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,transaction_hash,quote_token_address,token_amount_raw,pair_token_amount_raw,migration_price_attempts")
    .gte("migrated_at", cutoff)
    // A newly recorded graduation has no source at all, and `neq` in PostgREST
    // follows SQL three-valued logic, so it would filter those rows out and
    // leave every new token without a graduation price.
    .or("migration_price_source.is.null,migration_price_source.neq.pool_reserves")
    .lt("migration_price_attempts", MAX_HISTORY_ATTEMPTS)
    .not("token_amount_raw", "is", null)
    .not("pair_token_amount_raw", "is", null)
    .order("migration_price_checked_at", { ascending: true, nullsFirst: true })
    .order("migrated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Choose migration price candidates: ${error.message}`);
  return (data ?? []) as MigrationPriceCandidate[];
}

/**
 * Rows that need deriving again: either the scale disagrees with the mode for
 * their quote token, or the stored price no longer matches what its own stored
 * inputs recompute to.
 *
 * The second case catches a price written by something other than this stage.
 * A derivation is deterministic, so a row whose price, rate and scale disagree
 * has been overwritten, and re-deriving restores it.
 */
async function mismatchedScaleCandidates(quoteScales: Map<string, number>, limit: number) {
  const cutoff = new Date(Date.now() - Math.max(TRACKING_WINDOW_MS, BACKFILL_WINDOW_MS)).toISOString();
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,transaction_hash,quote_token_address,token_amount_raw,pair_token_amount_raw,migration_price_attempts,quote_raw_scale,quote_usd_rate,migration_price_usd")
    .gte("migrated_at", cutoff)
    .eq("migration_price_source", "pool_reserves")
    .limit(1000);
  if (error) throw new Error(`Read rows needing re-derivation: ${error.message}`);

  return (data ?? [])
    .filter((row) => {
      const scale = number(row.quote_raw_scale);
      const expected = quoteScales.get(row.quote_token_address as string);
      if (expected != null && scale !== expected) return true;

      const stored = number(row.migration_price_usd);
      const rate = number(row.quote_usd_rate);
      const tokenAmount = Number(row.token_amount_raw);
      const pairAmount = Number(row.pair_token_amount_raw);
      if (stored == null || rate == null || scale == null || !(tokenAmount > 0)) return false;
      const recomputed = (pairAmount / tokenAmount) * scale * rate;
      return Math.abs(stored - recomputed) / recomputed > 0.001;
    })
    .slice(0, limit) as MigrationPriceCandidate[];
}

/**
 * The decimal scale already established for each quote token.
 *
 * Every token sharing a quote token graduates against the same seeded reserves,
 * so its derived market cap is a constant and the correct scale is whichever
 * value most rows agree on. Inferring per token gets it right most of the time
 * but misreads a token that sells off hard inside its first candle, which lands
 * the scale a factor of ten out. Taking the mode across the quote token makes a
 * single bad row unable to move the answer.
 */
async function establishedQuoteScales() {
  const { data, error } = await db.from("bitquery_migration_test")
    .select("quote_token_address,quote_raw_scale")
    .eq("migration_price_source", "pool_reserves")
    .not("quote_raw_scale", "is", null);
  if (error) throw new Error(`Read established quote scales: ${error.message}`);

  const tally = new Map<string, Map<number, number>>();
  for (const row of data ?? []) {
    const quote = row.quote_token_address as string | null;
    const scale = number(row.quote_raw_scale);
    if (!quote || scale == null) continue;
    if (!tally.has(quote)) tally.set(quote, new Map());
    const counts = tally.get(quote)!;
    counts.set(scale, (counts.get(scale) ?? 0) + 1);
  }

  const scales = new Map<string, number>();
  for (const [quote, counts] of tally) {
    let best: number | null = null;
    let bestCount = 0;
    let total = 0;
    for (const [scale, count] of counts) {
      total += count;
      if (count > bestCount) { best = scale; bestCount = count; }
    }
    // Only trust a mode with enough agreement behind it to outvote an outlier.
    if (best != null && total >= 3) scales.set(quote, best);
  }
  return scales;
}

/**
 * The graduation price, derived from the reserves the graduation event seeded
 * into the pool rather than read from the first candle.
 *
 * The raw reserve ratio is exact on-chain data. Converting it to USD needs two
 * things: the quote token's USD price, taken from the ratio of the USD-quoted
 * and quote-denominated pair prices at the same minute, and a power-of-ten
 * decimal scale. The scale is inferred by comparing against the first candle's
 * High, which sits at the seeded price: the true scale is always a power of ten
 * and the High is within a small factor of the answer, so rounding the exponent
 * recovers it exactly without needing a decimals lookup per quote token.
 */
async function updateMigrationPrices(candidates: MigrationPriceCandidate[], quoteScales: Map<string, number>) {
  if (!candidates.length) return;
  const trading = (await queryBitquery<MigrationPriceData>(migrationPriceQuery(candidates))).Trading ?? {};
  const checkedAt = new Date().toISOString();

  const updates = candidates.map((candidate, index) => {
    const attempts = (candidate.migration_price_attempts ?? 0) + 1;
    const base = {
      token_address: candidate.token_address,
      // Upserts go through INSERT ... ON CONFLICT, so the not-null columns have
      // to be present even though every candidate row already exists.
      migrated_at: candidate.migrated_at,
      transaction_hash: candidate.transaction_hash,
      migration_price_checked_at: checkedAt,
      migration_price_attempts: attempts,
    };

    const usd = number((((trading[`Usd${index}`] ?? []) as PairRow[])[0])?.Price?.Ohlc?.Close);
    const quote = number((((trading[`Quote${index}`] ?? []) as PairRow[])[0])?.Price?.Ohlc?.Close);
    const candle = ((trading[`Candle${index}`] ?? []) as MarketRow[])[0];
    const seededHigh = number(candle?.Price?.Ohlc?.High);
    const tokenAmount = Number(candidate.token_amount_raw);
    const pairAmount = Number(candidate.pair_token_amount_raw);

    if (!usd || !quote || !seededHigh || !(tokenAmount > 0) || !(pairAmount > 0)) return base;

    // An identical figure on both price bases means Bitquery served the USD
    // series for the quote-denominated query too, so the rate is meaningless.
    if (usd === quote) return base;
    const quoteUsdRate = usd / quote;
    const rawRatio = pairAmount / tokenAmount;
    const unscaled = rawRatio * quoteUsdRate;
    if (!Number.isFinite(unscaled) || unscaled <= 0) return base;

    // The true scale is 10^(18 - quote decimals), so the exponent is a whole
    // number in [0, 18]. Round the gap between the unscaled derivation and the
    // observed price, then clamp: a token that sells off inside its first candle
    // prints a High below the seeded price, and without the clamp that rounds to
    // a negative exponent and scales the graduation price down tenfold.
    const reference = Math.max(seededHigh, usd);
    const inferred = 10 ** Math.min(18, Math.max(0, Math.round(Math.log10(reference / unscaled))));
    const established = candidate.quote_token_address
      ? quoteScales.get(candidate.quote_token_address)
      : undefined;
    const rawScale = established ?? inferred;
    const migrationPrice = unscaled * rawScale;
    if (!Number.isFinite(migrationPrice) || migrationPrice <= 0) return base;

    // The pool opens at the seeded price and the first candle is measured within
    // seconds of it, so a derivation more than a decade away from what actually
    // traded is not a graduation price. Leaving it unmeasured is recoverable;
    // recording it would silently corrupt every multiple computed against it.
    if (Math.abs(Math.log10(migrationPrice / reference)) > 1) return base;

    const supply = positiveSupply(candle?.Supply?.TotalSupply) ?? DEFAULT_SUPPLY;

    return {
      ...base,
      token_supply: supply,
      quote_usd_rate: quoteUsdRate,
      quote_raw_scale: rawScale,
      migration_price_usd: migrationPrice,
      migration_market_cap_usd: migrationPrice * supply,
      migration_price_source: "pool_reserves",
    };
  });

  // Every object in one upsert must carry the same keys. PostgREST fills any it
  // does not see with the column default, so mixing a measured row and a guarded
  // row in a single request writes nulls over values that were just derived.
  // Send the two shapes as separate requests instead.
  const measured = updates.filter((row) => "migration_price_usd" in row);
  const guarded = updates.filter((row) => !("migration_price_usd" in row));

  for (const batch of [measured, guarded]) {
    if (!batch.length) continue;
    const { error } = await db.from("bitquery_migration_test")
      .upsert(batch, { onConflict: "token_address" });
    if (error) throw new Error(`Save derived migration prices: ${error.message}`);
  }
}

async function historyCandidates(limit: number) {
  const cutoff = new Date(Date.now() - Math.max(TRACKING_WINDOW_MS, BACKFILL_WINDOW_MS)).toISOString();
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,transaction_hash,token_supply,migration_price_attempts")
    .gte("migrated_at", cutoff)
    .is("migration_price_usd", null)
    .lt("migration_price_attempts", MAX_HISTORY_ATTEMPTS)
    .order("migration_price_checked_at", { ascending: true, nullsFirst: true })
    .order("migrated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Choose history candidates: ${error.message}`);
  return (data ?? []) as HistoryCandidate[];
}

/**
 * Measures a token's graduation price and the peak it reached, once. The
 * graduation price is historical and never changes, so the database freezes it
 * after the first successful measurement and this never runs for that token
 * again. Everything after the measurement is carried forward by the live stages.
 */
async function measureHistory(candidate: HistoryCandidate) {
  const since = new Date(candidate.migrated_at).toISOString();
  const rows = await fetchAllPages<MarketRow>(
    (limit, offset) => historyQuery(candidate.token_address, since, limit, offset),
    (data) => (data as HistoryData).Trading?.Tokens ?? [],
    { pageSize: 1000, maxPages: 10, label: `history for ${candidate.token_address}` },
  );

  const checkedAt = new Date().toISOString();
  const attempts = (candidate.migration_price_attempts ?? 0) + 1;

  if (!rows.length) {
    // No trades yet. Record the attempt so a token that never trades stops being
    // retried once it reaches the attempt ceiling.
    const { error } = await db.from("bitquery_migration_test").update({
      migration_price_checked_at: checkedAt,
      migration_price_attempts: attempts,
      metrics_updated_at: checkedAt,
    }).eq("token_address", candidate.token_address);
    if (error) throw new Error(`Mark empty Bitquery history: ${error.message}`);
    return;
  }

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const currentPrice = number(last.Price?.Ohlc?.Close);
  const highs = rows.map((row) => number(row.Price?.Ohlc?.High)).filter((value): value is number => value != null);
  const athPrice = highs.length ? Math.max(...highs) : null;
  // One supply for every market cap on the row, so the peak multiple is a ratio
  // of like for like even if Bitquery reports a different supply later.
  const supply = positiveSupply(first.Supply?.TotalSupply) ?? supplyOf(candidate);
  const volumeUsd = rows.reduce((total, row) => total + (number(row.Volume?.Usd) ?? 0), 0);
  const tradeCount = rows.reduce((total, row) => total + (number(row.trades) ?? 0), 0);
  const name = last.Token?.Name ?? first.Token?.Name;
  const symbol = last.Token?.Symbol ?? first.Token?.Symbol;

  const { error } = await db.from("bitquery_migration_test").update({
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
    token_supply: supply,
    ...(currentPrice == null ? {} : {
      current_price_usd: currentPrice,
      current_market_cap_usd: currentPrice * supply,
      price_observed_at: last.Block.Time,
    }),
    ...(athPrice == null ? {} : {
      ath_price_usd: athPrice,
      ath_market_cap_usd: athPrice * supply,
    }),
    volume_usd: volumeUsd,
    trade_count: Math.round(tradeCount),
    latest_trade_at: last.Block.Time,
    migration_price_checked_at: checkedAt,
    migration_price_attempts: attempts,
    metrics_updated_at: checkedAt,
  }).eq("token_address", candidate.token_address);
  if (error) throw new Error(`Save Bitquery history: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Live price stream
// ---------------------------------------------------------------------------

async function streamLivePricesOnce(candidates: Map<string, TrackedToken>) {
  if (!candidates.size) {
    await delay(5_000);
    return;
  }

  const token = await getAccessToken();
  const pending = new Map<string, Record<string, unknown>>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    flushTimer = null;
    const updates = [...pending.values()];
    pending.clear();
    if (!updates.length) return;
    const { error } = await db.from("bitquery_migration_test")
      .upsert(updates, { onConflict: "token_address" });
    if (error) throw new Error(`Save streamed Bitquery prices: ${error.message}`);
  };

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(
      `wss://streaming.bitquery.io/graphql?token=${encodeURIComponent(token)}`,
      "graphql-ws",
    );
    // Re-subscribe periodically so newly migrated tokens join the stream.
    const refreshTimer = setTimeout(() => socket.close(1000, "refresh token list"), 5 * 60_000);
    const shutdownTimer = setInterval(() => {
      if (!running) socket.close(1000, "shutting down");
    }, 1_000);
    let acknowledged = false;
    let finished = false;

    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(refreshTimer);
      clearInterval(shutdownTimer);
      if (flushTimer) clearTimeout(flushTimer);
      // Always drain what was received before settling, so a reconnect does not
      // discard prices that arrived just before the socket closed.
      void flush().then(() => error ? reject(error) : resolve()).catch(reject);
    };

    socket.onopen = () => socket.send(JSON.stringify({ type: "connection_init" }));
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; payload?: LivePricePayload };
        if (message.type === "connection_ack" && !acknowledged) {
          acknowledged = true;
          socket.send(JSON.stringify({
            type: "start",
            id: "live-prices",
            payload: { query: livePriceSubscriptionQuery([...candidates.keys()]) },
          }));
          console.log(`Bitquery live price stream subscribed to ${candidates.size} migrated tokens`);
          return;
        }
        if (message.type !== "data" && message.type !== "next") return;
        if (message.payload?.errors?.length) {
          throw new Error(message.payload.errors.map((error) => error.message ?? "Live price stream error").join("; "));
        }

        for (const row of message.payload?.data?.Trading?.Pairs ?? []) {
          const address = row.Token?.Address?.toLowerCase();
          const candidate = address ? candidates.get(address) : null;
          const currentPrice = number(row.Price?.Ohlc?.Close);
          if (!address || !candidate || currentPrice == null) continue;
          const supply = supplyOf(candidate);
          const observedHigh = number(row.Price?.Ohlc?.High) ?? currentPrice;
          const observedAt = row.Block?.Time ?? new Date().toISOString();
          pending.set(address, {
            token_address: address,
            migrated_at: candidate.migrated_at,
            transaction_hash: candidate.transaction_hash,
            ...(row.Token?.Name ? { name: row.Token.Name } : {}),
            ...(row.Token?.Symbol ? { symbol: row.Token.Symbol } : {}),
            current_price_usd: currentPrice,
            current_market_cap_usd: currentPrice * supply,
            // Sent as observed. The database keeps whichever peak is higher.
            ath_price_usd: observedHigh,
            ath_market_cap_usd: observedHigh * supply,
            price_observed_at: observedAt,
            live_price_updated_at: new Date().toISOString(),
            latest_trade_at: observedAt,
          });
        }

        if (pending.size && !flushTimer) {
          flushTimer = setTimeout(
            () => void flush().catch((error) => console.error("Bitquery live price flush failed", error)),
            1_000,
          );
        }
      } catch (error) {
        socket.close(1011, "stream processing error");
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    socket.onerror = () => finish(new Error("Bitquery live price WebSocket error"));
    socket.onclose = () => finish(acknowledged ? undefined : new Error("Bitquery live price stream closed before acknowledgement"));
  });
}

async function runLivePriceStream() {
  while (running) {
    try {
      labelQueries("live-price-stream");
      const tracked = await trackedTokens(500, "trade_flow_updated_at");
      await streamLivePricesOnce(new Map(tracked.map((row) => [row.token_address, row])));
    } catch (error) {
      console.error("Bitquery live price stream failed", error);
      if (error instanceof BitqueryAuthError) invalidateAccessToken();
      await delay(5_000);
    }
  }
}

/**
 * Derives graduation prices for every row still missing one, then corrects any
 * row whose scale disagrees with the mode for its quote token. Runs the same
 * code the recorder stage runs, so a backfill and a live derivation cannot
 * diverge. Safe to run against a live database and safe to re-run.
 */
export async function backfillMigrationPrices({ log = console.log }: { log?: (message: string) => void } = {}) {
  let derived = 0;
  for (let round = 0; round < 200; round += 1) {
    const quoteScales = await establishedQuoteScales();
    const candidates = [
      ...await migrationPriceCandidates(20),
      ...await mismatchedScaleCandidates(quoteScales, 20),
    ];
    if (!candidates.length) {
      log(`Migration price backfill complete after ${derived} derivations`);
      return derived;
    }
    const batches = Array.from(
      { length: Math.ceil(candidates.length / 10) },
      (_, index) => candidates.slice(index * 10, (index + 1) * 10),
    );
    await Promise.all(batches.map((batch) => updateMigrationPrices(batch, quoteScales)));
    derived += candidates.length;
    log(`Derived ${derived} graduation prices so far`);
  }
  log(`Migration price backfill stopped at the round ceiling after ${derived} derivations`);
  return derived;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type Stage = {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
  nextRunAt: number;
  failures: number;
};

export async function runBitqueryMigrationTest() {
  if (!config.BITQUERY_MIGRATION_TEST_ENABLED) return;

  void runLivePriceStream();

  const startedAt = Date.now();
  await setStatus("connecting", `Backfilling PONS migrations from the last ${config.BITQUERY_BACKFILL_HOURS} hours`);

  // Seed the window once, paging through the whole history rather than relying
  // on a single capped request, then let the forward cursor take over.
  const windowEdge = new Date(startedAt - BACKFILL_WINDOW_MS);
  let migrationCursor = await loadCursor("migrations", windowEdge, windowEdge);
  let launchCursor = await loadCursor("launch-metadata", new Date(startedAt - 60 * 60_000), windowEdge);
  let launchBackfillCursor = await loadCursor("launch-backfill", windowEdge, windowEdge);
  console.log(
    `Resuming scans from migrations ${migrationCursor.toISOString()}, ` +
    `launch backfill ${launchBackfillCursor.toISOString()}`,
  );

  const stages: Stage[] = [
    {
      name: "migrations",
      intervalMs: config.BITQUERY_MIGRATION_POLL_MS,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const till = new Date();
        const count = await collectMigrations(migrationCursor, till);
        // Overlap by a minute so an event landing on the boundary is not missed.
        migrationCursor = new Date(till.getTime() - 60_000);
        await saveCursor("migrations", migrationCursor);
        await setStatus("connected", `${count} migration events received in latest scan`);
      },
    },
    {
      name: "launch-metadata",
      intervalMs: 15_000,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const till = new Date();
        await collectLaunchMetadata(launchCursor, till);
        launchCursor = new Date(till.getTime() - 60_000);
        await saveCursor("launch-metadata", launchCursor);
      },
    },
    {
      name: "launch-backfill",
      intervalMs: 10_000,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const recentCutoff = new Date(Date.now() - 60 * 60_000);
        if (launchBackfillCursor >= recentCutoff) return;
        const till = new Date(Math.min(recentCutoff.getTime(), launchBackfillCursor.getTime() + 30 * 60_000));
        await collectLaunchMetadata(launchBackfillCursor, till);
        launchBackfillCursor = till;
        await saveCursor("launch-backfill", launchBackfillCursor);
      },
    },
    {
      name: "metadata-sync",
      intervalMs: 15_000,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const { error } = await db.rpc("sync_bitquery_migration_metadata");
        if (error) throw new Error(`Sync Bitquery migration metadata: ${error.message}`);
      },
    },
    {
      name: "live-metrics",
      intervalMs: config.BITQUERY_METRICS_POLL_MS,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const candidates = await staleTrackedTokens(75);
        if (!candidates.length) return;
        const batches = Array.from(
          { length: Math.ceil(candidates.length / 25) },
          (_, index) => candidates.slice(index * 25, (index + 1) * 25),
        );
        const results = await mapWithConcurrency(batches, 3, updateLiveMetrics);
        const failed = results.filter((result) => result.status === "rejected");
        // One bad batch must not discard the batches that succeeded.
        if (failed.length === batches.length && batches.length > 0) {
          throw (failed[0] as PromiseRejectedResult).reason;
        }
        for (const failure of failed) {
          console.error("Live metrics batch failed", (failure as PromiseRejectedResult).reason);
        }
      },
    },
    {
      name: "migration-price",
      intervalMs: 3_000,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const quoteScales = await establishedQuoteScales();
        const candidates = [
          ...await migrationPriceCandidates(20),
          ...await mismatchedScaleCandidates(quoteScales, 10),
        ];
        if (!candidates.length) return;
        const batches = Array.from(
          { length: Math.ceil(candidates.length / 10) },
          (_, index) => candidates.slice(index * 10, (index + 1) * 10),
        );
        const results = await mapWithConcurrency(batches, 2, (batch) => updateMigrationPrices(batch, quoteScales));
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length === batches.length) throw (failed[0] as PromiseRejectedResult).reason;
        for (const failure of failed) {
          console.error("Migration price batch failed", (failure as PromiseRejectedResult).reason);
        }
      },
    },
    {
      name: "positions",
      // Opens on a fresh signal and marks open positions to the latest price.
      // Cheap: it reads prices the other stages already wrote, and makes no
      // Bitquery request of its own.
      intervalMs: 5_000,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        await openPositions(await entrySignals());
        await updatePositions();
      },
    },
    {
      name: "curve-stats",
      // Pre-migration curve behaviour is fixed once a token graduates, so this
      // runs once per token and then never again for it.
      intervalMs: 5_000,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const tokens = await curveCandidates(400);
        if (!tokens.length) return;
        await updateCurveStats(tokens.slice(0, 3));
      },
    },
    {
      name: "snapshot-refresh",
      // Outcomes only extend forwards, so this reads new candles only. Pure
      // research upkeep, so it yields first when the budget tightens.
      intervalMs: 10 * 60_000,
      nextRunAt: 60_000,
      failures: 0,
      run: async () => {
        await refreshSnapshotOutcomes({ limit: 60, log: () => undefined });
      },
    },
    {
      name: "holders",
      // Fast, because the one-minute reading is the entry filter and is only
      // useful while the token is still near its migration price.
      intervalMs: 3_000,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const work = await holderCandidates(200);
        if (!work.length) return;
        await updateHolders(work.slice(0, 4));
      },
    },
    {
      name: "history",
      intervalMs: 2_000,
      nextRunAt: 0,
      failures: 0,
      run: async () => {
        const candidates = await historyCandidates(12);
        if (!candidates.length) return;
        const results = await mapWithConcurrency(candidates, 4, measureHistory);
        for (const failure of results.filter((result) => result.status === "rejected")) {
          console.error("History measurement failed", (failure as PromiseRejectedResult).reason);
        }
      },
    },
  ];

  let level: BudgetLevel = "full";
  let nextBudgetCheck = 0;
  let lastLevel: BudgetLevel | null = null;

  while (running) {
    const now = Date.now();

    if (now >= nextBudgetCheck) {
      const usage = await getBitqueryUsage();
      level = budgetLevel(usage);
      nextBudgetCheck = Date.now() + 5 * 60_000;
      if (usage && level !== lastLevel) {
        console.log(
          `Bitquery budget: ${Math.round(usage.pointsFraction * 100)}% of points used ` +
          `with ${Math.round((1 - usage.periodFraction) * 100)}% of the period left, running at "${level}"`,
        );
        lastLevel = level;
      }
    }

    for (const stage of stages) {
      if (!running || now < stage.nextRunAt) continue;
      if (!stageAllowed(stage.name, level)) {
        // Hold the stage rather than dropping it, so it resumes on its own when
        // the next period starts or spend falls back in line.
        stage.nextRunAt = Date.now() + 5 * 60_000;
        continue;
      }
      try {
        labelQueries(stage.name);
        await stage.run();
        stage.failures = 0;
        stage.nextRunAt = Date.now() + stage.intervalMs;
      } catch (error) {
        // Stages are independent. A failure here must not stop the others:
        // losing metadata sync should never stop graduations being recorded.
        stage.failures += 1;
        const backoff = Math.min(stage.intervalMs * 2 ** stage.failures, 5 * 60_000);
        stage.nextRunAt = Date.now() + backoff;
        console.error(`Bitquery stage "${stage.name}" failed (${stage.failures} in a row, retrying in ${Math.round(backoff / 1000)}s)`, error);
        if (error instanceof BitqueryAuthError) invalidateAccessToken();
        if (stage.name === "migrations") {
          await setStatus("error", error instanceof Error ? error.message : String(error)).catch(() => undefined);
        }
      }
    }

    await delay(250);
  }

  console.log("Bitquery migration recorder stopped cleanly");
}
