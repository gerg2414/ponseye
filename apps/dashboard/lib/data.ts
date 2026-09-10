import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

export type Launch = {
  token_address: string;
  curve_address: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  deployer_address: string;
  pair_token_address: string | null;
  status: string;
  launched_at: string;
  swept_at: string | null;
  graduated_at: string | null;
  trade_count: number;
  buys: number;
  sells: number;
  unique_traders: number;
  net_quote_raw: string;
  last_trade_at: string | null;
  graduation_threshold_raw: string | null;
  progress_pct: number | null;
  volume_quote_raw: string;
  last_quote_amount_raw: string | null;
  last_token_amount_raw: string | null;
  peak_multiple: number | null;
  drawdown_from_peak_pct: number | null;
  buy_pressure_pct: number | null;
  creator_trades: number;
  creator_sells: number;
  first_minute_buyers: number;
  largest_buy_quote_raw: string | null;
  holder_snapshot_at: string | null;
  holder_count: number | null;
  holder_change_5m: number | null;
  largest_holder_pct: number | null;
  top_10_holder_pct: number | null;
  top_100_holder_pct: number | null;
  creator_balance_pct: number | null;
  price_usd: number | null;
  volume_usd: number | null;
  market_cap_usd: number | null;
  ath_market_cap_usd: number | null;
  usd_price_at: string | null;
  research_state: "sighted" | "under_watch" | "target_locked";
  research_state_at: string;
  research_rule_version: string;
  research_reasons: string[];
};

export type Trade = {
  event_id: string;
  transaction_hash: string;
  block_time: string;
  side: "buy" | "sell";
  trader_address: string | null;
  recipient_address: string | null;
  quote_amount_raw: string;
  token_amount_raw: string;
  fee_raw: string;
  tax_raw: string;
};

export type LaunchRecord = Launch & {
  description: string | null;
  twitter_url: string | null;
  telegram_url: string | null;
  discord_url: string | null;
  website_url: string | null;
};

export type MarketTrade = {
  market_event_id: string;
  transaction_hash: string;
  block_time: string;
  side: "buy" | "sell";
  trader_address: string | null;
  price_usd: number | null;
  base_amount_usd: number | null;
  quote_amount_usd: number | null;
  protocol: string | null;
};

export type StreamStatus = {
  feed: string;
  status: string;
  last_seen_at: string;
};

type DashboardPayload = {
  launches: Launch[];
  streams: StreamStatus[];
  researchCounts: {
    sighted: number;
    under_watch: number;
    target_locked: number;
  };
  launchCount: number;
  tradeCount: number;
};

const emptyData = {
  launches: [] as Launch[],
  streams: [] as StreamStatus[],
  launchCount: 0,
  tradeCount: 0,
  researchCounts: { sighted: 0, under_watch: 0, target_locked: 0 },
  dataConnected: false,
};

async function loadDashboardData() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Dashboard database environment is missing");

  const db = createClient(url, key, {
    auth: { persistSession: false },
    db: { retry: false },
  });
  const dashboardResult = await db
    .rpc("get_dashboard_home", { p_limit: 12 })
    .abortSignal(AbortSignal.timeout(8_000));

  if (dashboardResult.error || !dashboardResult.data) {
    throw new Error(dashboardResult.error?.message ?? "No dashboard data returned");
  }

  const payload = dashboardResult.data as DashboardPayload;

  const launches = (payload.launches ?? []).map((launch) => ({
    ...launch,
    progress_pct: launch.progress_pct == null ? null : Number(launch.progress_pct),
    peak_multiple: launch.peak_multiple == null ? null : Number(launch.peak_multiple),
    drawdown_from_peak_pct: launch.drawdown_from_peak_pct == null ? null : Number(launch.drawdown_from_peak_pct),
    buy_pressure_pct: launch.buy_pressure_pct == null ? null : Number(launch.buy_pressure_pct),
    largest_holder_pct: launch.largest_holder_pct == null ? null : Number(launch.largest_holder_pct),
    top_10_holder_pct: launch.top_10_holder_pct == null ? null : Number(launch.top_10_holder_pct),
    top_100_holder_pct: launch.top_100_holder_pct == null ? null : Number(launch.top_100_holder_pct),
    creator_balance_pct: launch.creator_balance_pct == null ? null : Number(launch.creator_balance_pct),
    price_usd: launch.price_usd == null ? null : Number(launch.price_usd),
    volume_usd: launch.volume_usd == null ? null : Number(launch.volume_usd),
    market_cap_usd: launch.market_cap_usd == null ? null : Number(launch.market_cap_usd),
    ath_market_cap_usd: launch.ath_market_cap_usd == null ? null : Number(launch.ath_market_cap_usd),
  })) as Launch[];

  return {
    launches,
    streams: payload.streams ?? [],
    researchCounts: {
      sighted: Number(payload.researchCounts?.sighted ?? 0),
      under_watch: Number(payload.researchCounts?.under_watch ?? 0),
      target_locked: Number(payload.researchCounts?.target_locked ?? 0),
    },
    launchCount: Number(payload.launchCount ?? 0),
    tradeCount: Number(payload.tradeCount ?? 0),
    dataConnected: true,
  };
}

const getCachedDashboardData = unstable_cache(
  loadDashboardData,
  ["dashboard-home-v2"],
  { revalidate: 5 },
);

export async function getDashboardData() {
  try {
    return await getCachedDashboardData();
  } catch (error) {
    console.error("[dashboard] data request failed", error instanceof Error ? error.message : String(error));
    return emptyData;
  }
}

export async function getLaunchDetail(tokenAddress: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;

  const db = createClient(url, key, {
    auth: { persistSession: false },
    db: { retry: false },
  });
  const [boardResult, launchResult, tradesResult, curveMarketTradesResult, poolMarketTradesResult] = await Promise.all([
    db.from("launch_board").select("*").eq("token_address", tokenAddress).maybeSingle(),
    db.from("launches").select("description,twitter_url,telegram_url,discord_url,website_url").eq("token_address", tokenAddress).maybeSingle(),
    db.from("trades")
      .select("event_id,transaction_hash,block_time,side,trader_address,recipient_address,quote_amount_raw,token_amount_raw,fee_raw,tax_raw")
      .eq("token_address", tokenAddress)
      .order("block_time", { ascending: false })
      .limit(1000),
    db.from("trade_market_data")
      .select("market_event_id,transaction_hash,block_time,side,trader_address,price_usd,base_amount_usd,quote_amount_usd,protocol")
      .eq("token_address", tokenAddress)
      .eq("protocol", "pons_v2")
      .order("block_time", { ascending: false })
      .limit(2000),
    db.from("trade_market_data")
      .select("market_event_id,transaction_hash,block_time,side,trader_address,price_usd,base_amount_usd,quote_amount_usd,protocol")
      .eq("token_address", tokenAddress)
      .eq("protocol", "uniswap_v4")
      .order("block_time", { ascending: false })
      .limit(2000),
  ]);

  if (!boardResult.data || boardResult.error) return null;

  return {
    launch: {
      ...boardResult.data,
      ...launchResult.data,
      progress_pct: boardResult.data.progress_pct == null ? null : Number(boardResult.data.progress_pct),
      peak_multiple: boardResult.data.peak_multiple == null ? null : Number(boardResult.data.peak_multiple),
      drawdown_from_peak_pct: boardResult.data.drawdown_from_peak_pct == null ? null : Number(boardResult.data.drawdown_from_peak_pct),
      buy_pressure_pct: boardResult.data.buy_pressure_pct == null ? null : Number(boardResult.data.buy_pressure_pct),
      largest_holder_pct: boardResult.data.largest_holder_pct == null ? null : Number(boardResult.data.largest_holder_pct),
      top_10_holder_pct: boardResult.data.top_10_holder_pct == null ? null : Number(boardResult.data.top_10_holder_pct),
      top_100_holder_pct: boardResult.data.top_100_holder_pct == null ? null : Number(boardResult.data.top_100_holder_pct),
      creator_balance_pct: boardResult.data.creator_balance_pct == null ? null : Number(boardResult.data.creator_balance_pct),
      price_usd: boardResult.data.price_usd == null ? null : Number(boardResult.data.price_usd),
      volume_usd: boardResult.data.volume_usd == null ? null : Number(boardResult.data.volume_usd),
      market_cap_usd: boardResult.data.market_cap_usd == null ? null : Number(boardResult.data.market_cap_usd),
      ath_market_cap_usd: boardResult.data.ath_market_cap_usd == null ? null : Number(boardResult.data.ath_market_cap_usd),
    } as LaunchRecord,
    trades: [...(tradesResult.data ?? [])].reverse() as Trade[],
    marketTrades: [...(curveMarketTradesResult.data ?? []), ...(poolMarketTradesResult.data ?? [])]
      .sort((a, b) => new Date(a.block_time).getTime() - new Date(b.block_time).getTime())
      .map((trade) => ({
      ...trade,
      price_usd: trade.price_usd == null ? null : Number(trade.price_usd),
      base_amount_usd: trade.base_amount_usd == null ? null : Number(trade.base_amount_usd),
      quote_amount_usd: trade.quote_amount_usd == null ? null : Number(trade.quote_amount_usd),
      })) as MarketTrade[],
  };
}
