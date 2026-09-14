import { createClient } from "@supabase/supabase-js";

export type DatabaseSort = "newest" | "peak" | "current" | "multiple" | "trades" | "volume";

export type DatabaseToken = {
  token_address: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  status: string;
  launched_at: string;
  graduated_at: string | null;
  market_cap_usd: number | null;
  ath_market_cap_usd: number | null;
  peak_multiple: number | null;
  trade_count: number;
  buys: number;
  sells: number;
  unique_traders: number;
  buy_pressure_pct: number | null;
  volume_usd: number | null;
  holder_count: number | null;
};

export type DatabaseResult = {
  tokens: DatabaseToken[];
  filteredCount: number;
};

export type RecorderFeed = {
  feed: string;
  status: string;
  message: string | null;
  last_seen_at: string;
};

export type RecorderControlState = {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  feeds: RecorderFeed[];
};

export type BitqueryMigrationTestRow = {
  token_address: string;
  migrated_at: string;
  block_number: string | null;
  transaction_hash: string;
  position_id: string | null;
  token_amount_raw: string | null;
  pair_token_amount_raw: string | null;
  quote_token_address: string | null;
  creator_address: string | null;
  name: string | null;
  symbol: string | null;
  migration_market_cap_usd: number | null;
  current_market_cap_usd: number | null;
  ath_market_cap_usd: number | null;
  volume_usd: number | null;
  trade_count: number;
  latest_trade_at: string | null;
  metrics_updated_at: string | null;
  first_seen_at: string;
};

export type BitqueryMigrationTestResult = {
  migrations: BitqueryMigrationTestRow[];
  status: RecorderFeed | null;
  metricsReady: number;
};

// Keep this as a literal so Supabase can infer the selected row shape at build time.
const columns = "token_address,name,symbol,image_url,status,launched_at,graduated_at,market_cap_usd,ath_market_cap_usd,peak_multiple,trade_count,buys,sells,unique_traders,buy_pressure_pct,volume_usd,holder_count";

const sortColumns: Record<DatabaseSort, string> = {
  newest: "launched_at",
  peak: "ath_market_cap_usd",
  current: "market_cap_usd",
  multiple: "peak_multiple",
  trades: "trade_count",
  volume: "volume_usd",
};

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function databaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Database environment is missing");
  return createClient(url, key, {
    auth: { persistSession: false },
    db: { retry: false },
  });
}

export async function getRecorderControlState(): Promise<RecorderControlState> {
  const db = databaseClient();
  const [controlResult, feedsResult] = await Promise.all([
    db.from("recorder_control").select("enabled,updated_at,updated_by").eq("id", 1).single(),
    db.from("stream_status")
      .select("feed,status,message,last_seen_at")
      .eq("feed", "gmgn_trenches")
      .order("feed"),
  ]);

  if (controlResult.error) throw new Error(controlResult.error.message);
  if (feedsResult.error) throw new Error(feedsResult.error.message);
  return {
    enabled: controlResult.data.enabled === true,
    updatedAt: controlResult.data.updated_at,
    updatedBy: controlResult.data.updated_by,
    feeds: (feedsResult.data ?? []) as RecorderFeed[],
  };
}

export async function getTokenDatabase({
  page,
  pageSize,
  search,
  sort,
}: {
  page: number;
  pageSize: number;
  search: string;
  sort: DatabaseSort;
}): Promise<DatabaseResult> {
  const db = databaseClient();

  const safeSearch = search.trim().replace(/[^a-zA-Z0-9 _.$-]/g, "").slice(0, 80);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let tokenQuery = db
    .from("gmgn_launch_board")
    .select(columns)
    .order(sortColumns[sort], { ascending: false, nullsFirst: false })
    .order("launched_at", { ascending: false })
    .range(from, to);

  let countQuery = db
    .from("gmgn_launches")
    .select("token_address", { count: "exact", head: true });

  if (safeSearch) {
    tokenQuery = tokenQuery.or(
      `name.ilike.%${safeSearch}%,symbol.ilike.%${safeSearch}%,token_address.ilike.%${safeSearch}%`,
    );
    countQuery = countQuery.or(
      `name.ilike.%${safeSearch}%,symbol.ilike.%${safeSearch}%,token_address.ilike.%${safeSearch}%`,
    );
  }

  const [tokenResult, countResult] = await Promise.all([tokenQuery, countQuery]);

  if (tokenResult.error) throw new Error(tokenResult.error.message);
  if (countResult.error) throw new Error(countResult.error.message);

  const tokens = (tokenResult.data ?? []).map((token) => ({
    ...token,
    market_cap_usd: numberOrNull(token.market_cap_usd),
    ath_market_cap_usd: numberOrNull(token.ath_market_cap_usd),
    peak_multiple: numberOrNull(token.peak_multiple),
    trade_count: Number(token.trade_count ?? 0),
    buys: Number(token.buys ?? 0),
    sells: Number(token.sells ?? 0),
    unique_traders: Number(token.unique_traders ?? 0),
    buy_pressure_pct: numberOrNull(token.buy_pressure_pct),
    volume_usd: numberOrNull(token.volume_usd),
    holder_count: numberOrNull(token.holder_count),
  })) as DatabaseToken[];

  return {
    tokens,
    filteredCount: countResult.count ?? 0,
  };
}

export async function getBitqueryMigrationTest(): Promise<BitqueryMigrationTestResult> {
  const db = databaseClient();
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [migrationResult, statusResult] = await Promise.all([
    db.from("bitquery_migration_test")
      .select("token_address,migrated_at,block_number,transaction_hash,position_id,token_amount_raw,pair_token_amount_raw,quote_token_address,creator_address,name,symbol,migration_market_cap_usd,current_market_cap_usd,ath_market_cap_usd,volume_usd,trade_count,latest_trade_at,metrics_updated_at,first_seen_at")
      .gte("migrated_at", since)
      .order("migrated_at", { ascending: false }),
    db.from("stream_status")
      .select("feed,status,message,last_seen_at")
      .eq("feed", "bitquery_migration_test")
      .maybeSingle(),
  ]);
  if (migrationResult.error) throw new Error(migrationResult.error.message);
  if (statusResult.error) throw new Error(statusResult.error.message);

  const migrations = (migrationResult.data ?? []).map((row) => ({
    ...row,
    migration_market_cap_usd: numberOrNull(row.migration_market_cap_usd),
    current_market_cap_usd: numberOrNull(row.current_market_cap_usd),
    ath_market_cap_usd: numberOrNull(row.ath_market_cap_usd),
    volume_usd: numberOrNull(row.volume_usd),
    trade_count: Number(row.trade_count ?? 0),
  })) as BitqueryMigrationTestRow[];
  return {
    migrations,
    status: statusResult.data as RecorderFeed | null,
    metricsReady: migrations.filter((row) => row.metrics_updated_at != null).length,
  };
}
