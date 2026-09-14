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
  acquired_at?: string | null;
  closed_at?: string | null;
  entry_market_cap_usd?: number | null;
  exit_market_cap_usd?: number | null;
  exit_price_usd?: number | null;
  exit_reason?: "target" | "stop" | "failure_8m" | "failure_sustained" | "post_10x_below_3x" | null;
  target_multiple?: number | null;
  position_status?: "open" | "closed" | null;
  position_size_usd?: number | null;
  remaining_pct?: number | null;
  realised_return_multiple?: number | null;
  position_value_multiple?: number | null;
  strategy_version?: string | null;
  hit_10x_at?: string | null;
  hit_20x_at?: string | null;
  hit_50x_at?: string | null;
  hit_100x_at?: string | null;
  sparkline_prices?: number[];
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
  acquired_at?: string | null;
  closed_at?: string | null;
  entry_market_cap_usd?: number | null;
  position_status?: "open" | "closed" | null;
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

export type ChartCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
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

type CurveSparkPoint = {
  token_address: string;
  block_time: string;
  quote_amount_raw: string;
  token_amount_raw: string;
};

type MarketSparkPoint = {
  token_address: string;
  block_time: string;
  price_usd: number | string | null;
};

type PositionRecord = {
  token_address: string;
  acquired_at: string;
  entry_market_cap_usd: number | string | null;
  exit_market_cap_usd: number | string | null;
  exit_price_usd: number | string | null;
  exit_reason: "target" | "stop" | "failure_8m" | "failure_sustained" | "post_10x_below_3x" | null;
  target_multiple: number | string;
  position_status: "open" | "closed";
  closed_at: string | null;
  position_size_usd: number | string;
  remaining_pct: number | string;
  realised_return_multiple: number | string;
  strategy_version: string;
  hit_10x_at: string | null;
  hit_20x_at: string | null;
  hit_50x_at: string | null;
  hit_100x_at: string | null;
};

type ResearchStateRecord = {
  research_state: "sighted" | "under_watch" | "target_locked";
  research_state_at: string;
  research_rule_version: string;
};

const emptyData = {
  launches: [] as Launch[],
  streams: [] as StreamStatus[],
  launchCount: 0,
  tradeCount: 0,
  researchCounts: { sighted: 0, under_watch: 0, target_locked: 0 },
  dataConnected: false,
};

/**
 * The three lanes, fed from the live migration funnel.
 *
 * The lane names on the page predate the Bitquery pipeline and are kept, since
 * they already carry the animation and layout: sighted is a fresh migration
 * still being measured, under_watch is one whose largest holder cleared 15% at
 * a minute and is awaiting the five minute confirmation, target_locked is one
 * that cleared both checks while the entry window is still open.
 */
type FunnelRow = {
  token_address: string;
  symbol: string | null;
  name: string | null;
  image_url: string | null;
  migrated_at: string;
  age_seconds: number | string | null;
  migration_market_cap_usd: number | string | null;
  current_market_cap_usd: number | string | null;
  ath_market_cap_usd: number | string | null;
  peak_multiple: number | string | null;
  top1_at_1m: number | string | null;
  holders_at_1m: number | string | null;
  top10_at_1m: number | string | null;
  top1_growth_pp: number | string | null;
  stage: "sighted" | "surveilling" | "acquired" | "passed";
  reason: string | null;
};

/**
 * Position fields for a token the filter actually opened on.
 *
 * Kept separate from the funnel row because a position is a record of something
 * that happened: changing a threshold reclassifies the funnel but must never
 * rewrite a trade already taken.
 */
function positionFields(position: Record<string, unknown> | undefined) {
  if (!position) return {};
  const entry = toNumber(position.entry_market_cap_usd);
  const realised = toNumber(position.realised_multiple) ?? 0;
  const remaining = toNumber(position.remaining_fraction) ?? 0;
  return {
    acquired_at: position.opened_at as string,
    entry_market_cap_usd: entry,
    // The card values a closed position at its exit rather than the token's
    // price now, which may be days of decay later and says nothing about the
    // trade.
    exit_market_cap_usd: toNumber(position.exit_market_cap_usd),
    position_status: position.closed_at ? "closed" : "open",
    closed_at: position.closed_at as string | null,
    exit_reason: (position.close_reason ?? null) as string | null,
    remaining_pct: remaining * 100,
    realised_return_multiple: realised,
    position_value_multiple: toNumber(position.position_value_multiple) ?? realised + remaining,
    strategy_version: position.strategy as string | undefined,
    rungs_filled: (position.rungs_filled ?? []) as number[],
  };
}

const STAGE_TO_LANE = {
  sighted: "sighted",
  surveilling: "under_watch",
  acquired: "target_locked",
} as const;

function toNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadDashboardData() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Dashboard database environment is missing");

  const db = createClient(url, key, { auth: { persistSession: false } });

  const [funnelResult, flowResult, statusResult, positionResult, totalsResult] = await Promise.all([
    db.from("ponseye_funnel")
      .select("*")
      .in("stage", ["sighted", "surveilling", "acquired"])
      .order("migrated_at", { ascending: false })
      .limit(200)
      .abortSignal(AbortSignal.timeout(20_000)),
    // Trade flow is on the migration table rather than the funnel view.
    db.from("bitquery_migration_test")
      .select("token_address,trade_count,unique_traders,buys,sells")
      .gte("migrated_at", new Date(Date.now() - 2 * 60 * 60_000).toISOString()),
    db.from("stream_status").select("feed,status,last_seen_at"),
    db.from("ponseye_positions_live")
      .select("token_address,opened_at,entry_price_usd,entry_market_cap_usd,exit_market_cap_usd,position_size_usd,remaining_fraction,realised_multiple,rungs_filled,peak_multiple_seen,closed_at,close_reason,current_multiple,position_value_multiple"),
    db.from("bitquery_migration_test").select("token_address", { count: "exact", head: true }),
  ]);

  if (funnelResult.error) throw new Error(funnelResult.error.message);

  const flow = new Map(((flowResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => [row.token_address as string, row]));
  const positions = new Map(((positionResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => [row.token_address as string, row]));

  const launches = ((funnelResult.data ?? []) as unknown as FunnelRow[]).map((row) => {
    const trade = flow.get(row.token_address);
    const buys = Number(trade?.buys ?? 0);
    const sells = Number(trade?.sells ?? 0);
    const current = toNumber(row.current_market_cap_usd);
    const peak = toNumber(row.ath_market_cap_usd);

    return {
      token_address: row.token_address,
      name: row.name,
      symbol: row.symbol,
      image_url: row.image_url,
      // The lanes were built around launches; a migration is the equivalent
      // event here, so its timestamp drives the age and ordering.
      launched_at: row.migrated_at,
      research_state: STAGE_TO_LANE[row.stage as keyof typeof STAGE_TO_LANE] ?? "sighted",
      research_state_at: row.migrated_at,
      research_reasons: row.reason ? [row.reason] : [],
      market_cap_usd: current,
      ath_market_cap_usd: peak,
      entry_market_cap_usd: toNumber(row.migration_market_cap_usd),
      peak_multiple: toNumber(row.peak_multiple),
      drawdown_from_peak_pct: peak && current && peak > 0 ? (1 - current / peak) * 100 : null,
      trade_count: Number(trade?.trade_count ?? 0),
      unique_traders: Number(trade?.unique_traders ?? 0),
      buy_pressure_pct: buys + sells > 0 ? (buys / (buys + sells)) * 100 : null,
      // The lane cards show holder concentration in place of the old curve
      // metrics, which is what the entry filter actually turns on.
      largest_holder_pct: toNumber(row.top1_at_1m),
      top_10_holder_pct: toNumber(row.top10_at_1m),
      holder_count: toNumber(row.holders_at_1m),
      first_minute_buyers: Number(toNumber(row.holders_at_1m) ?? 0),
      sparkline_prices: [],
      ...positionFields(positions.get(row.token_address)),
    } as unknown as Launch;
  });

  const counts = { sighted: 0, under_watch: 0, target_locked: 0 };
  for (const launch of launches) {
    const state = launch.research_state as keyof typeof counts;
    if (state in counts) counts[state] += 1;
  }

  return {
    launches,
    streams: (statusResult.data ?? []) as StreamStatus[],
    researchCounts: counts,
    launchCount: totalsResult.count ?? 0,
    tradeCount: launches.reduce((total, launch) => total + (launch.trade_count ?? 0), 0),
    dataConnected: (statusResult.data ?? []).some((row) => (row as { status?: string }).status === "connected"),
  };
}

const getCachedDashboardData = unstable_cache(
  loadDashboardData,
  ["dashboard-home-funnel-v1"],
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
  const result = await db.rpc("get_launch_detail", {
    p_token_address: tokenAddress,
    p_trade_limit: 1,
    p_market_limit: 250,
  }).abortSignal(AbortSignal.timeout(12_000));

  if (result.error || !result.data?.launch) {
    const dashboard = await getDashboardData();
    const fallback = dashboard.launches.find((launch) => launch.token_address === tokenAddress);
    if (!fallback) {
      console.error("[launch] detail request failed", result.error?.message ?? "Launch missing");
      return null;
    }
    console.warn("[launch] using dashboard fallback", result.error?.message ?? "Detail response missing");
    return { launch: fallback as LaunchRecord, trades: [] as Trade[], marketTrades: [] as MarketTrade[], chartCandles: [] as ChartCandle[], bondPriceUsd: null as number | null, poolStartedAt: null as string | null };
  }

  const [positionResult, researchStateResult] = await Promise.all([
    db.from("acquired_positions")
      .select("token_address,acquired_at,entry_market_cap_usd,exit_market_cap_usd,exit_price_usd,exit_reason,target_multiple,position_status,closed_at,position_size_usd,remaining_pct,realised_return_multiple,strategy_version,hit_10x_at,hit_20x_at,hit_50x_at,hit_100x_at")
      .eq("token_address", tokenAddress)
      .maybeSingle(),
    db.from("launch_metrics")
      .select("research_state,research_state_at,research_rule_version")
      .eq("token_address", tokenAddress)
      .maybeSingle(),
  ]);

  const payload = result.data as {
    launch: LaunchRecord;
    trades: Trade[];
    marketTrades: MarketTrade[];
    chartCandles: ChartCandle[];
    bondPriceUsd: number | null;
    poolStartedAt: string | null;
  };
  if (positionResult.error) console.error("[launch] position request failed", positionResult.error.message);
  if (researchStateResult.error) console.error("[launch] research state request failed", researchStateResult.error.message);
  const position = positionResult.data as PositionRecord | null;
  const researchState = researchStateResult.data as ResearchStateRecord | null;
  const launch = {
    ...payload.launch,
    ...(researchState ? {
      research_state: researchState.research_state,
      research_state_at: researchState.research_state_at,
      research_rule_version: researchState.research_rule_version,
    } : {}),
    ...(position ? {
      acquired_at: position.acquired_at,
      entry_market_cap_usd: position.entry_market_cap_usd == null ? null : Number(position.entry_market_cap_usd),
      exit_market_cap_usd: position.exit_market_cap_usd == null ? null : Number(position.exit_market_cap_usd),
      exit_price_usd: position.exit_price_usd == null ? null : Number(position.exit_price_usd),
      exit_reason: position.exit_reason,
      target_multiple: Number(position.target_multiple),
      position_status: position.position_status,
      closed_at: position.closed_at,
      position_size_usd: Number(position.position_size_usd),
      remaining_pct: Number(position.remaining_pct),
      realised_return_multiple: Number(position.realised_return_multiple),
      strategy_version: position.strategy_version,
      hit_10x_at: position.hit_10x_at,
      hit_20x_at: position.hit_20x_at,
      hit_50x_at: position.hit_50x_at,
      hit_100x_at: position.hit_100x_at,
      position_value_multiple: Number(position.realised_return_multiple) + Number(position.remaining_pct) * (
        Number(position.entry_market_cap_usd) > 0 && Number(payload.launch.market_cap_usd) > 0
          ? Number(payload.launch.market_cap_usd) / Number(position.entry_market_cap_usd)
          : 1
      ) / 100,
    } : {}),
  } as LaunchRecord;
  return {
    launch: {
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
    } as LaunchRecord,
    trades: payload.trades ?? [],
    marketTrades: (payload.marketTrades ?? []).map((trade) => ({
      ...trade,
      price_usd: trade.price_usd == null ? null : Number(trade.price_usd),
      base_amount_usd: trade.base_amount_usd == null ? null : Number(trade.base_amount_usd),
      quote_amount_usd: trade.quote_amount_usd == null ? null : Number(trade.quote_amount_usd),
    })) as MarketTrade[],
    chartCandles: (payload.chartCandles ?? []).map((candle) => ({
      ...candle,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
    })) as ChartCandle[],
    bondPriceUsd: payload.bondPriceUsd == null ? null : Number(payload.bondPriceUsd),
    poolStartedAt: payload.poolStartedAt ?? null,
  };
}
