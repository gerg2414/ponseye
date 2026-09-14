import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

const PONS_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
const POOL_REGISTERED_TOPIC = "01bf263a1db1652580721573296e1a1fa70b3d4c87f61d02a69c4e1109d2d573";
const PONS_SUPPLY = 1_000_000_000;

const db = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { retry: false },
});

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
  Supply?: { MarketCap?: string | number; CirculatingSupply?: string | number };
  trades?: string | number;
};

type TradeFlowRow = {
  buys?: string | number;
  sells?: string | number;
  buyVolume?: string | number;
  sellVolume?: string | number;
  uniqueTraders?: string | number;
};

type MigrationPayload = {
  data?: {
    EVM?: {
      Graduations?: GraduationEvent[];
      Registrations?: RegistrationEvent[];
    };
  };
  errors?: Array<{ message?: string }>;
};

type LaunchPayload = {
  data?: { EVM?: { Launches?: LaunchCall[] } };
  errors?: Array<{ message?: string }>;
};

type MarketPayload = {
  data?: { Trading?: { Tokens?: MarketRow[]; Flow?: TradeFlowRow[] } };
  errors?: Array<{ message?: string }>;
};

type LiveMetricsCandidate = {
  token_address: string;
  migrated_at: string;
  transaction_hash: string;
  ath_price_usd: number | string | null;
};

type LiveMarketPayload = {
  data?: { Trading?: Record<string, MarketRow[] | TradeFlowRow[] | undefined> };
  errors?: Array<{ message?: string }>;
};

type LivePriceRow = {
  Block?: { Time?: string };
  Token?: { Address?: string; Symbol?: string; Name?: string };
  Price?: { Ohlc?: { High?: string | number; Close?: string | number } };
};

type LivePricePayload = {
  data?: { Trading?: { Pairs?: LivePriceRow[] } };
  errors?: Array<{ message?: string }>;
};

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;
  if (!config.BITQUERY_CLIENT_ID || !config.BITQUERY_CLIENT_SECRET) {
    throw new Error("Bitquery migration test credentials are missing");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.BITQUERY_CLIENT_ID,
    client_secret: config.BITQUERY_CLIENT_SECRET,
    scope: "api",
  });
  const response = await fetch("https://oauth2.bitquery.io/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Bitquery OAuth failed with ${response.status}`);
  const payload = await response.json() as { access_token: string; expires_in: number };
  accessToken = payload.access_token;
  accessTokenExpiresAt = Date.now() + payload.expires_in * 1_000;
  return accessToken;
}

async function queryBitquery<T>(query: string): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch("https://streaming.bitquery.io/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Bitquery query failed with ${response.status}`);
  const payload = await response.json() as T & { errors?: Array<{ message?: string }> };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown Bitquery error").join("; "));
  }
  return payload;
}

function migrationQuery(since: string, till: string) {
  return `
    query PonsMigrationTest {
      EVM(network: robinhood) {
        Graduations: Events(
          limit: {count: 1000}
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
        Registrations: Events(
          limit: {count: 1000}
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

function launchMetadataQuery(since: string, till: string) {
  return `
    query PonsLaunchMetadataTest {
      EVM(network: robinhood) {
        Launches: Calls(
          limit: {count: 1000}
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

function marketQuery(tokenAddress: string, migratedAt: string) {
  const since = new Date(migratedAt).toISOString();
  return `
    query PonsMigrationMarketTest {
      Trading {
        Tokens(
          limit: {count: 1500}
          orderBy: {ascending: Block_Time}
          where: {
            Token: {Address: {is: "${tokenAddress}"} Network: {is: "Robinhood"}}
            Interval: {Time: {Duration: {eq: 60}}}
            Block: {Time: {since: "${since}"}}
          }
        ) {
          Block { Time }
          Token { Address Symbol Name }
          Volume { Usd }
          Price { Ohlc { Open High Low Close } }
          Supply { MarketCap CirculatingSupply }
          trades: count
        }
        Flow: Trades(
          limit: {count: 1}
          where: {
            Pair: {
              Token: {Address: {is: "${tokenAddress}"}}
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
      }
    }
  `;
}

function liveMarketQuery(candidates: LiveMetricsCandidate[]) {
  const fields = candidates.map((candidate, index) => {
    const since = new Date(candidate.migrated_at).toISOString();
    return `
      Token${index}: Tokens(
        limit: {count: 1}
        orderBy: {descending: Block_Time}
        where: {
          Token: {Address: {is: "${candidate.token_address}"} Network: {is: "Robinhood"}}
          Interval: {Time: {Duration: {eq: 60}}}
          Block: {Time: {since: "${since}"}}
        }
      ) {
        Block { Time }
        Token { Address Symbol Name }
        Price { Ohlc { High Close } }
      }
      Flow${index}: Trades(
        limit: {count: 1}
        where: {
          Pair: {
            Token: {Address: {is: "${candidate.token_address}"}}
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

  return `
    query PonsMigrationLiveMarketTest {
      Trading {
        ${fields}
      }
    }
  `;
}

function livePriceSubscriptionQuery(addresses: string[]) {
  return `
    subscription PonsMigrationLivePrices {
      Trading {
        Pairs(
          where: {
            Interval: {Time: {Duration: {eq: 1}}}
            Price: {IsQuotedInUsd: true}
            Market: {Network: {is: "Robinhood"}}
            Token: {Address: {in: [${addresses.map((address) => `"${address}"`).join(",")} ]}}
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

async function livePriceCandidates() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,transaction_hash,ath_price_usd")
    .gte("migrated_at", cutoff);
  if (error) throw new Error(`Read live price candidates: ${error.message}`);
  return new Map(((data ?? []) as LiveMetricsCandidate[]).map((row) => [row.token_address, row]));
}

async function streamLivePricesOnce(candidates: Map<string, LiveMetricsCandidate>) {
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
    const refreshTimer = setTimeout(() => socket.close(1000, "refresh token list"), 5 * 60_000);
    let acknowledged = false;
    let finished = false;

    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(refreshTimer);
      if (flushTimer) clearTimeout(flushTimer);
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
          const latestHigh = number(row.Price?.Ohlc?.High) ?? currentPrice;
          const existing = pending.get(address);
          const storedAth = number(existing?.ath_price_usd) ?? number(candidate.ath_price_usd) ?? 0;
          const athPrice = Math.max(storedAth, latestHigh);
          pending.set(address, {
            token_address: address,
            migrated_at: candidate.migrated_at,
            transaction_hash: candidate.transaction_hash,
            ...(row.Token?.Name ? { name: row.Token.Name } : {}),
            ...(row.Token?.Symbol ? { symbol: row.Token.Symbol } : {}),
            current_price_usd: currentPrice,
            current_market_cap_usd: currentPrice * PONS_SUPPLY,
            ath_price_usd: athPrice,
            ath_market_cap_usd: athPrice * PONS_SUPPLY,
            live_price_updated_at: new Date().toISOString(),
            ...(row.Block?.Time ? { latest_trade_at: row.Block.Time } : {}),
          });
        }
        if (pending.size && !flushTimer) {
          flushTimer = setTimeout(() => void flush().catch((error) => console.error("Bitquery live price flush failed", error)), 1_000);
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
  while (config.BITQUERY_MIGRATION_TEST_ENABLED) {
    try {
      await streamLivePricesOnce(await livePriceCandidates());
    } catch (error) {
      console.error("Bitquery live price stream failed", error);
      accessToken = null;
      await delay(5_000);
    }
  }
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

async function saveMigrations(payload: MigrationPayload) {
  const graduations = payload.data?.EVM?.Graduations ?? [];
  const registrations = new Map<string, RegistrationEvent>();
  for (const row of payload.data?.EVM?.Registrations ?? []) {
    const decoded = decodeRegistration(row.LogHeader.Data);
    if (decoded.tokenAddress) registrations.set(decoded.tokenAddress, row);
  }
  const launches = new Map<string, ReturnType<typeof decodeLaunch>>();
  const graduationAddresses = graduations
    .map((graduation) => String(argumentMap(graduation.Arguments).token ?? "").toLowerCase())
    .filter((address) => /^0x[0-9a-f]{40}$/.test(address));
  if (graduationAddresses.length) {
    const { data, error } = await db.from("bitquery_launch_metadata_test")
      .select("*")
      .in("token_address", graduationAddresses);
    if (error) throw new Error(`Read Bitquery launch metadata: ${error.message}`);
    for (const row of data ?? []) {
      launches.set(row.token_address, {
        tokenAddress: row.token_address,
        name: row.name,
        symbol: row.symbol,
        imageUrl: row.image_url,
        description: row.description,
        twitterUrl: row.twitter_url,
        telegramUrl: row.telegram_url,
        discordUrl: row.discord_url,
        websiteUrl: row.website_url,
        farcasterUrl: row.farcaster_url,
        creatorFeeRecipient: row.creator_address,
        creatorTaxBps: row.creator_tax_bps,
        buybackEnabled: row.buyback_enabled,
      });
    }
  }

  const rows = graduations.flatMap((graduation) => {
    const args = argumentMap(graduation.Arguments);
    const tokenAddress = String(args.token ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(tokenAddress)) return [];
    const registration = registrations.get(tokenAddress);
    const decoded = registration ? decodeRegistration(registration.LogHeader.Data) : null;
    const launch = launches.get(tokenAddress);
    const metadata = launch ? {
      name: launch.name,
      symbol: launch.symbol,
      image_url: launch.imageUrl,
      description: launch.description,
      twitter_url: launch.twitterUrl,
      telegram_url: launch.telegramUrl,
      discord_url: launch.discordUrl,
      website_url: launch.websiteUrl,
      farcaster_url: launch.farcasterUrl,
      creator_tax_bps: launch.creatorTaxBps,
      buyback_enabled: launch.buybackEnabled,
      metadata_updated_at: new Date().toISOString(),
      metadata_source: "bitquery_launch_call",
    } : {};
    const creator = decoded?.creatorAddress ?? launch?.creatorFeeRecipient;
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

async function saveLaunchMetadata(payload: LaunchPayload) {
  const launchRows: Array<Record<string, unknown>> = [];
  for (const call of payload.data?.EVM?.Launches ?? []) {
    const decoded = decodeLaunch(call);
    if (!decoded) continue;
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
  if (launchRows.length) {
    const { error } = await db.from("bitquery_launch_metadata_test")
      .upsert(launchRows, { onConflict: "token_address" });
    if (error) throw new Error(`Save Bitquery launch metadata: ${error.message}`);
  }
  return launchRows.length;
}

async function nextMetricsCandidate() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,metrics_updated_at,metadata_updated_at,trade_flow_updated_at")
    .gte("migrated_at", cutoff)
    .order("metrics_updated_at", { ascending: true, nullsFirst: true })
    .order("migrated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Choose Bitquery market candidate: ${error.message}`);
  return data as { token_address: string; migrated_at: string; metrics_updated_at: string | null; metadata_updated_at: string | null; trade_flow_updated_at: string | null } | null;
}

async function nextLiveMetricsCandidates(limit = 150) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,transaction_hash,ath_price_usd")
    .gte("migrated_at", cutoff)
    .order("trade_flow_updated_at", { ascending: true, nullsFirst: true })
    .order("migrated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Choose live Bitquery market candidates: ${error.message}`);
  return (data ?? []) as LiveMetricsCandidate[];
}

async function updateLiveMetrics(candidates: LiveMetricsCandidate[]) {
  if (!candidates.length) return;
  const payload = await queryBitquery<LiveMarketPayload>(liveMarketQuery(candidates));
  const trading = payload.data?.Trading ?? {};
  const updatedAt = new Date().toISOString();

  const updates = candidates.map((candidate, index) => {
    const rows = (trading[`Token${index}`] ?? []) as MarketRow[];
    const flowRows = (trading[`Flow${index}`] ?? []) as TradeFlowRow[];
    const last = rows[0];
    const flow = flowRows[0];
    const currentPrice = number(last?.Price?.Ohlc?.Close);
    const latestHigh = number(last?.Price?.Ohlc?.High);
    const storedAth = number(candidate.ath_price_usd);
    const athPrice = latestHigh == null ? storedAth : Math.max(storedAth ?? 0, latestHigh);
    const buys = Math.round(number(flow?.buys) ?? 0);
    const sells = Math.round(number(flow?.sells) ?? 0);
    const buyVolume = number(flow?.buyVolume);
    const sellVolume = number(flow?.sellVolume);
    const tokenName = last?.Token?.Name;
    const tokenSymbol = last?.Token?.Symbol;

    return {
      token_address: candidate.token_address,
      migrated_at: candidate.migrated_at,
      transaction_hash: candidate.transaction_hash,
      ...(tokenName ? { name: tokenName } : {}),
      ...(tokenSymbol ? { symbol: tokenSymbol } : {}),
      ...(currentPrice == null ? {} : {
        current_price_usd: currentPrice,
        current_market_cap_usd: currentPrice * PONS_SUPPLY,
      }),
      ...(athPrice == null ? {} : {
        ath_price_usd: athPrice,
        ath_market_cap_usd: athPrice * PONS_SUPPLY,
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

async function updateMetrics(candidate: { token_address: string; migrated_at: string; metadata_updated_at: string | null }) {
  const payload = await queryBitquery<MarketPayload>(marketQuery(candidate.token_address, candidate.migrated_at));
  const rows = payload.data?.Trading?.Tokens ?? [];
  if (!rows.length) {
    const { error } = await db.from("bitquery_migration_test").update({
      metrics_updated_at: new Date().toISOString(),
      raw_market: payload,
    }).eq("token_address", candidate.token_address);
    if (error) throw new Error(`Mark empty Bitquery metrics: ${error.message}`);
    return;
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const migrationPrice = number(first.Price?.Ohlc?.Open);
  const currentPrice = number(last.Price?.Ohlc?.Close);
  const highs = rows.map((row) => number(row.Price?.Ohlc?.High)).filter((value): value is number => value != null);
  const athPrice = highs.length ? Math.max(...highs) : null;
  const volumeUsd = rows.reduce((total, row) => total + (number(row.Volume?.Usd) ?? 0), 0);
  const tradeCount = rows.reduce((total, row) => total + (number(row.trades) ?? 0), 0);
  const flow = payload.data?.Trading?.Flow?.[0];
  const tokenName = last.Token?.Name ?? first.Token?.Name;
  const tokenSymbol = last.Token?.Symbol ?? first.Token?.Symbol;
  const { error } = await db.from("bitquery_migration_test").update({
    ...(tokenName ? { name: tokenName } : {}),
    ...(tokenSymbol ? { symbol: tokenSymbol } : {}),
    migration_price_usd: migrationPrice,
    current_price_usd: currentPrice,
    ath_price_usd: athPrice,
    migration_market_cap_usd: migrationPrice == null ? null : migrationPrice * PONS_SUPPLY,
    current_market_cap_usd: currentPrice == null ? null : currentPrice * PONS_SUPPLY,
    ath_market_cap_usd: athPrice == null ? null : athPrice * PONS_SUPPLY,
    volume_usd: volumeUsd,
    trade_count: Math.round(tradeCount),
    buys: Math.round(number(flow?.buys) ?? 0),
    sells: Math.round(number(flow?.sells) ?? 0),
    buy_volume_usd: number(flow?.buyVolume),
    sell_volume_usd: number(flow?.sellVolume),
    unique_traders: Math.round(number(flow?.uniqueTraders) ?? 0),
    trade_flow_updated_at: new Date().toISOString(),
    latest_trade_at: last.Block.Time,
    metrics_updated_at: new Date().toISOString(),
    raw_market: payload,
  }).eq("token_address", candidate.token_address);
  if (error) throw new Error(`Save Bitquery market metrics: ${error.message}`);
}

export async function runBitqueryMigrationTest() {
  if (!config.BITQUERY_MIGRATION_TEST_ENABLED) return;
  void runLivePriceStream();
  await setStatus("connecting", "Backfilling PONS migrations from the last 24 hours");
  let migrationCursor = new Date(Date.now() - 24 * 60 * 60_000);
  // A token can remain on the bonding curve for longer than the 24-hour
  // migration view. Look further back so migrated rows can recover metadata.
  let launchCursor = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  let nextMigrationPoll = 0;
  let nextLaunchPoll = 0;
  let nextMetadataSync = 0;
  let nextMetricsPoll = 0;
  let nextLiveMetricsPoll = 0;

  while (config.BITQUERY_MIGRATION_TEST_ENABLED) {
    const now = Date.now();
    try {
      if (now >= nextMigrationPoll) {
        const till = new Date();
        const payload = await queryBitquery<MigrationPayload>(migrationQuery(migrationCursor.toISOString(), till.toISOString()));
        const count = await saveMigrations(payload);
        migrationCursor = new Date(till.getTime() - 60_000);
        nextMigrationPoll = Date.now() + config.BITQUERY_MIGRATION_POLL_MS;
        await setStatus("connected", `${count} migration events received in latest scan`);
      }

      if (now >= nextLaunchPoll) {
        const current = new Date();
        const windowMs = 30 * 60_000;
        const caughtUp = current.getTime() - launchCursor.getTime() <= windowMs;
        const till = caughtUp
          ? current
          : new Date(Math.min(current.getTime(), launchCursor.getTime() + windowMs));
        const payload = await queryBitquery<LaunchPayload>(launchMetadataQuery(launchCursor.toISOString(), till.toISOString()));
        await saveLaunchMetadata(payload);
        launchCursor = caughtUp ? new Date(till.getTime() - 60_000) : till;
        if (now >= nextMetadataSync) {
          const { error } = await db.rpc("sync_bitquery_migration_metadata");
          if (error) throw new Error(`Sync Bitquery migration metadata: ${error.message}`);
          nextMetadataSync = Date.now() + 15_000;
        }
        nextLaunchPoll = Date.now() + 1_100;
      }

      if (now >= nextLiveMetricsPoll) {
        const candidates = await nextLiveMetricsCandidates();
        const batches = Array.from({ length: Math.ceil(candidates.length / 50) }, (_, index) =>
          candidates.slice(index * 50, (index + 1) * 50));
        await Promise.all(batches.map((batch) => updateLiveMetrics(batch)));
        nextLiveMetricsPoll = Date.now() + config.BITQUERY_METRICS_POLL_MS;
      }

      if (now >= nextMetricsPoll) {
        const candidate = await nextMetricsCandidate();
        if (candidate) await updateMetrics(candidate);
        // Full post-migration history is much heavier than the live summary.
        // Keep it off the critical path used by the dashboard columns.
        nextMetricsPoll = Date.now() + Math.max(30_000, config.BITQUERY_METRICS_POLL_MS * 2);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Bitquery migration test failed", error);
      await setStatus("error", message).catch(() => undefined);
      accessToken = null;
      await delay(10_000);
      nextMigrationPoll = 0;
    }
    await delay(500);
  }
}
