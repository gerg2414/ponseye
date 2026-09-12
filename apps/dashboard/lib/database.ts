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
      .in("feed", ["launch_activity", "curve_trades", "market_trades", "holder_snapshots"])
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
    .from("launch_board")
    .select(columns, { count: "exact" })
    .order(sortColumns[sort], { ascending: false, nullsFirst: false })
    .order("launched_at", { ascending: false })
    .range(from, to);

  if (safeSearch) {
    tokenQuery = tokenQuery.or(
      `name.ilike.%${safeSearch}%,symbol.ilike.%${safeSearch}%,token_address.ilike.%${safeSearch}%`,
    );
  }

  const tokenResult = await tokenQuery;

  if (tokenResult.error) throw new Error(tokenResult.error.message);

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
    filteredCount: tokenResult.count ?? 0,
  };
}
