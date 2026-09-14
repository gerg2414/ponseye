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
  image_url: string | null;
  description: string | null;
  twitter_url: string | null;
  telegram_url: string | null;
  discord_url: string | null;
  website_url: string | null;
  farcaster_url: string | null;
  creator_tax_bps: number | null;
  buyback_enabled: boolean | null;
  metadata_source: string | null;
  migration_market_cap_usd: number | null;
  current_market_cap_usd: number | null;
  ath_market_cap_usd: number | null;
  volume_usd: number | null;
  trade_count: number;
  buys: number;
  sells: number;
  buy_volume_usd: number | null;
  sell_volume_usd: number | null;
  unique_traders: number;
  latest_trade_at: string | null;
  metrics_updated_at: string | null;
  first_seen_at: string;
  peak_multiple: number | null;
  migration_price_source: string | null;
  top_holder_pct: number | null;
  top10_pct: number | null;
  holder_count: number | null;
};

export type BitqueryMigrationSort =
  | "newest" | "ath" | "multiple" | "current" | "migration" | "volume" | "trades" | "buys" | "sells";

export type BitqueryMigrationFilters = {
  windowHours: number;
  sort: BitqueryMigrationSort;
  minAth: number;
  minMultiple: number;
  readyOnly: boolean;
  /** Only tokens whose largest holder was under this share of supply at 1 minute. */
  maxTopHolderPct: number;
  limit: number;
};

export type BitqueryMigrationTestResult = {
  migrations: BitqueryMigrationTestRow[];
  status: RecorderFeed | null;
  metricsReady: number;
  totalInWindow: number;
  filteredCount: number;
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

const holderEmbed = "bitquery_holder_snapshots(age_seconds,top_holder_pct,top10_pct,holder_count)";

const bitqueryColumns = "token_address,migrated_at,block_number,transaction_hash,position_id,token_amount_raw,pair_token_amount_raw,quote_token_address,creator_address,name,symbol,image_url,description,twitter_url,telegram_url,discord_url,website_url,farcaster_url,creator_tax_bps,buyback_enabled,metadata_source,migration_market_cap_usd,current_market_cap_usd,ath_market_cap_usd,volume_usd,trade_count,buys,sells,buy_volume_usd,sell_volume_usd,unique_traders,latest_trade_at,metrics_updated_at,first_seen_at,peak_multiple,migration_price_source";

const bitquerySortColumns: Record<BitqueryMigrationSort, string> = {
  newest: "migrated_at",
  ath: "ath_market_cap_usd",
  multiple: "peak_multiple",
  current: "current_market_cap_usd",
  migration: "migration_market_cap_usd",
  volume: "volume_usd",
  trades: "trade_count",
  buys: "buys",
  sells: "sells",
};

function toBitqueryRow(row: Record<string, unknown>) {
  // The embed is an array because a token has one row per snapshot age.
  const snapshots = (row.bitquery_holder_snapshots ?? []) as Array<Record<string, unknown>>;
  const atOneMinute = snapshots.find((snapshot) => Number(snapshot.age_seconds) === 60);
  return {
    ...row,
    top_holder_pct: numberOrNull(atOneMinute?.top_holder_pct),
    top10_pct: numberOrNull(atOneMinute?.top10_pct),
    holder_count: numberOrNull(atOneMinute?.holder_count),
    migration_market_cap_usd: numberOrNull(row.migration_market_cap_usd),
    current_market_cap_usd: numberOrNull(row.current_market_cap_usd),
    ath_market_cap_usd: numberOrNull(row.ath_market_cap_usd),
    peak_multiple: numberOrNull(row.peak_multiple),
    volume_usd: numberOrNull(row.volume_usd),
    trade_count: Number(row.trade_count ?? 0),
    buys: Number(row.buys ?? 0),
    sells: Number(row.sells ?? 0),
    buy_volume_usd: numberOrNull(row.buy_volume_usd),
    sell_volume_usd: numberOrNull(row.sell_volume_usd),
    unique_traders: Number(row.unique_traders ?? 0),
  } as BitqueryMigrationTestRow;
}

export async function getBitqueryMigrationTest(
  filters: BitqueryMigrationFilters,
): Promise<BitqueryMigrationTestResult> {
  const db = databaseClient();
  const since = new Date(Date.now() - filters.windowHours * 60 * 60_000).toISOString();

  // Filtering and sorting happen in the database. This page refreshes every few
  // seconds, so pulling the whole window back to sort it in JavaScript got more
  // expensive with every migration recorded.
  let rowQuery = db.from("bitquery_migration_test")
    .select(`${bitqueryColumns},${holderEmbed}`, { count: "exact" })
    .gte("migrated_at", since)
    .order(bitquerySortColumns[filters.sort], { ascending: false, nullsFirst: false })
    .order("migrated_at", { ascending: false })
    .limit(filters.limit);

  if (filters.readyOnly) rowQuery = rowQuery.not("metrics_updated_at", "is", null);
  if (filters.minAth > 0) rowQuery = rowQuery.gte("ath_market_cap_usd", filters.minAth);
  if (filters.minMultiple > 0) rowQuery = rowQuery.gte("peak_multiple", filters.minMultiple);
  // Sorting by peak requires a peak to exist, otherwise the top of the list is
  // filled with rows that have no market data yet.
  if (filters.sort === "ath") rowQuery = rowQuery.not("ath_market_cap_usd", "is", null);
  if (filters.sort === "multiple") rowQuery = rowQuery.not("peak_multiple", "is", null);
  // Filtering on an embedded table needs an inner join, otherwise rows without
  // a snapshot come back with the embed empty rather than being excluded.
  if (filters.maxTopHolderPct > 0) {
    rowQuery = rowQuery
      .not("bitquery_holder_snapshots", "is", null)
      .eq("bitquery_holder_snapshots.age_seconds", 60)
      .lt("bitquery_holder_snapshots.top_holder_pct", filters.maxTopHolderPct);
  }

  const [rowResult, totalResult, readyResult, statusResult] = await Promise.all([
    rowQuery,
    db.from("bitquery_migration_test")
      .select("token_address", { count: "exact", head: true })
      .gte("migrated_at", since),
    db.from("bitquery_migration_test")
      .select("token_address", { count: "exact", head: true })
      .gte("migrated_at", since)
      .not("metrics_updated_at", "is", null),
    db.from("stream_status")
      .select("feed,status,message,last_seen_at")
      .eq("feed", "bitquery_migration_test")
      .maybeSingle(),
  ]);

  if (rowResult.error) throw new Error(rowResult.error.message);
  if (totalResult.error) throw new Error(totalResult.error.message);
  if (readyResult.error) throw new Error(readyResult.error.message);
  if (statusResult.error) throw new Error(statusResult.error.message);

  return {
    migrations: (rowResult.data ?? []).map((row) => toBitqueryRow(row as Record<string, unknown>)),
    status: statusResult.data as RecorderFeed | null,
    metricsReady: readyResult.count ?? 0,
    totalInWindow: totalResult.count ?? 0,
    filteredCount: rowResult.count ?? 0,
  };
}

export async function getBitqueryMigrationToken(tokenAddress: string) {
  const db = databaseClient();
  const tokenResult = await db.from("bitquery_migration_test")
    .select(`${bitqueryColumns},${holderEmbed}`)
    .eq("token_address", tokenAddress)
    .maybeSingle();
  if (tokenResult.error) throw new Error(tokenResult.error.message);
  if (!tokenResult.data) return null;

  const token = toBitqueryRow(tokenResult.data as Record<string, unknown>);
  return { token };
}
