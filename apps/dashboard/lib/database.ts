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
  stats: {
    total: number;
    priced: number;
    over100k: number;
    highestPeak: number | null;
  };
};

const columns = [
  "token_address",
  "name",
  "symbol",
  "image_url",
  "status",
  "launched_at",
  "graduated_at",
  "market_cap_usd",
  "ath_market_cap_usd",
  "peak_multiple",
  "trade_count",
  "buys",
  "sells",
  "unique_traders",
  "buy_pressure_pct",
  "volume_usd",
  "holder_count",
].join(",");

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
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Database environment is missing");

  const db = createClient(url, key, {
    auth: { persistSession: false },
    db: { retry: false },
  });

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

  const [tokenResult, totalResult, pricedResult, over100kResult, highestResult] = await Promise.all([
    tokenQuery,
    db.from("launch_board").select("token_address", { count: "exact", head: true }),
    db.from("launch_board").select("token_address", { count: "exact", head: true }).not("market_cap_usd", "is", null),
    db.from("launch_board").select("token_address", { count: "exact", head: true }).gte("ath_market_cap_usd", 100_000),
    db.from("launch_board").select("ath_market_cap_usd").not("ath_market_cap_usd", "is", null).order("ath_market_cap_usd", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (tokenResult.error) throw new Error(tokenResult.error.message);
  if (totalResult.error) throw new Error(totalResult.error.message);
  if (pricedResult.error) throw new Error(pricedResult.error.message);
  if (over100kResult.error) throw new Error(over100kResult.error.message);
  if (highestResult.error) throw new Error(highestResult.error.message);

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
    stats: {
      total: totalResult.count ?? 0,
      priced: pricedResult.count ?? 0,
      over100k: over100kResult.count ?? 0,
      highestPeak: numberOrNull(highestResult.data?.ath_market_cap_usd),
    },
  };
}
