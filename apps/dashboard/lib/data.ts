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
  exit_reason?: "target" | "stop" | null;
  target_multiple?: number | null;
  position_status?: "open" | "closed" | null;
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
  exit_reason: "target" | "stop" | null;
  target_multiple: number | string;
  position_status: "open" | "closed";
  closed_at: string | null;
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
    .rpc("get_dashboard_home", { p_limit: 200 })
    .abortSignal(AbortSignal.timeout(20_000));

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
    entry_market_cap_usd: launch.entry_market_cap_usd == null ? null : Number(launch.entry_market_cap_usd),
    sparkline_prices: [],
  })) as Launch[];

  const acquiredAddresses = launches
    .filter((launch) => launch.research_state === "target_locked")
    .map((launch) => launch.token_address);

  if (acquiredAddresses.length) {
    const [curveResult, marketResult, positionsResult] = await Promise.all([
      db.from("trades")
        .select("token_address,block_time,quote_amount_raw,token_amount_raw")
        .in("token_address", acquiredAddresses)
        .order("block_time", { ascending: false })
        .limit(1_000),
      db.from("trade_market_data")
        .select("token_address,block_time,price_usd")
        .in("token_address", acquiredAddresses)
        .order("block_time", { ascending: false })
        .limit(1_000),
      db.from("acquired_positions")
        .select("token_address,acquired_at,entry_market_cap_usd,exit_market_cap_usd,exit_price_usd,exit_reason,target_multiple,position_status,closed_at")
        .in("token_address", acquiredAddresses),
    ]);

    if (curveResult.error) console.error("[dashboard] curve sparkline request failed", curveResult.error.message);
    if (marketResult.error) console.error("[dashboard] market sparkline request failed", marketResult.error.message);
    if (positionsResult.error) console.error("[dashboard] position request failed", positionsResult.error.message);

    const launchesByAddress = new Map(launches.map((launch) => [launch.token_address, launch]));
    for (const position of (positionsResult.data ?? []) as PositionRecord[]) {
      const launch = launchesByAddress.get(position.token_address);
      if (!launch) continue;
      launch.acquired_at = position.acquired_at;
      launch.entry_market_cap_usd = position.entry_market_cap_usd == null ? null : Number(position.entry_market_cap_usd);
      launch.exit_market_cap_usd = position.exit_market_cap_usd == null ? null : Number(position.exit_market_cap_usd);
      launch.exit_price_usd = position.exit_price_usd == null ? null : Number(position.exit_price_usd);
      launch.exit_reason = position.exit_reason;
      launch.target_multiple = Number(position.target_multiple);
      launch.position_status = position.position_status;
      launch.closed_at = position.closed_at;
    }
    const pointsByAddress = new Map<string, Array<{ time: number; price: number }>>();
    const addPoint = (tokenAddress: string, blockTime: string, price: number) => {
      if (!Number.isFinite(price) || price <= 0) return;
      const time = Date.parse(blockTime);
      if (!Number.isFinite(time)) return;
      const points = pointsByAddress.get(tokenAddress) ?? [];
      points.push({ time, price });
      pointsByAddress.set(tokenAddress, points);
    };

    for (const row of (curveResult.data ?? []) as CurveSparkPoint[]) {
      const launch = launchesByAddress.get(row.token_address);
      const quoteAmount = Number(row.quote_amount_raw);
      const tokenAmount = Number(row.token_amount_raw);
      const lastQuoteAmount = Number(launch?.last_quote_amount_raw);
      const lastTokenAmount = Number(launch?.last_token_amount_raw);
      if (!launch?.price_usd || tokenAmount <= 0 || lastTokenAmount <= 0) continue;
      const lastRawPrice = lastQuoteAmount / lastTokenAmount;
      if (!Number.isFinite(lastRawPrice) || lastRawPrice <= 0) continue;
      addPoint(row.token_address, row.block_time, (quoteAmount / tokenAmount) * (launch.price_usd / lastRawPrice));
    }

    for (const row of (marketResult.data ?? []) as MarketSparkPoint[]) {
      addPoint(row.token_address, row.block_time, Number(row.price_usd));
    }

    for (const launch of launches) {
      launch.sparkline_prices = (pointsByAddress.get(launch.token_address) ?? [])
        .sort((a, b) => a.time - b.time)
        .slice(-40)
        .map((point) => point.price);
    }
  }

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
  const [result, dashboard, migrationPriceResult, positionResult] = await Promise.all([
    db.rpc("get_launch_detail", {
      p_token_address: tokenAddress,
      p_trade_limit: 100,
      p_market_limit: 1000,
    }).abortSignal(AbortSignal.timeout(20_000)),
    getDashboardData(),
    db.rpc("get_launch_migration_price_usd", {
      p_token_address: tokenAddress,
    }).abortSignal(AbortSignal.timeout(20_000)),
    db.from("acquired_positions")
      .select("token_address,acquired_at,entry_market_cap_usd,exit_market_cap_usd,exit_price_usd,exit_reason,target_multiple,position_status,closed_at")
      .eq("token_address", tokenAddress)
      .maybeSingle(),
  ]);

  if (result.error || !result.data?.launch) {
    const fallback = dashboard.launches.find((launch) => launch.token_address === tokenAddress);
    if (!fallback) {
      console.error("[launch] detail request failed", result.error?.message ?? "Launch missing");
      return null;
    }
    console.warn("[launch] using dashboard fallback", result.error?.message ?? "Detail response missing");
    return { launch: fallback as LaunchRecord, trades: [] as Trade[], marketTrades: [] as MarketTrade[], chartCandles: [] as ChartCandle[], bondPriceUsd: null as number | null, poolStartedAt: null as string | null };
  }

  const payload = result.data as {
    launch: LaunchRecord;
    trades: Trade[];
    marketTrades: MarketTrade[];
    chartCandles: ChartCandle[];
    bondPriceUsd: number | null;
    poolStartedAt: string | null;
  };
  if (positionResult.error) console.error("[launch] position request failed", positionResult.error.message);
  const position = positionResult.data as PositionRecord | null;
  const launch = {
    ...payload.launch,
    ...(position ? {
      acquired_at: position.acquired_at,
      entry_market_cap_usd: position.entry_market_cap_usd == null ? null : Number(position.entry_market_cap_usd),
      exit_market_cap_usd: position.exit_market_cap_usd == null ? null : Number(position.exit_market_cap_usd),
      exit_price_usd: position.exit_price_usd == null ? null : Number(position.exit_price_usd),
      exit_reason: position.exit_reason,
      target_multiple: Number(position.target_multiple),
      position_status: position.position_status,
      closed_at: position.closed_at,
    } : {}),
  } as LaunchRecord;
  const lastQuoteAmount = Number(launch.last_quote_amount_raw);
  const lastTokenAmount = Number(launch.last_token_amount_raw);
  const lastRawPrice = lastTokenAmount > 0 ? lastQuoteAmount / lastTokenAmount : 0;
  const curveUsdFactor = launch.price_usd && lastRawPrice > 0 ? Number(launch.price_usd) / lastRawPrice : null;
  const curveCandleBuckets = new Map<number, ChartCandle>();

  if (curveUsdFactor) {
    for (const trade of payload.trades ?? []) {
      const quoteAmount = Number(trade.quote_amount_raw);
      const tokenAmount = Number(trade.token_amount_raw);
      const timestamp = Date.parse(trade.block_time);
      if (tokenAmount <= 0 || !Number.isFinite(timestamp)) continue;
      const price = (quoteAmount / tokenAmount) * curveUsdFactor;
      if (!Number.isFinite(price) || price <= 0) continue;
      const bucket = Math.floor(timestamp / 60_000) * 60_000;
      const existing = curveCandleBuckets.get(bucket);
      if (existing) {
        existing.high = Math.max(existing.high, price);
        existing.low = Math.min(existing.low, price);
        existing.close = price;
      } else {
        curveCandleBuckets.set(bucket, {
          time: new Date(bucket).toISOString(),
          open: price,
          high: price,
          low: price,
          close: price,
        });
      }
    }
  }

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
    chartCandles: ([...curveCandleBuckets.values(), ...(payload.chartCandles ?? [])]).map((candle) => ({
      ...candle,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
    })) as ChartCandle[],
    bondPriceUsd: payload.bondPriceUsd != null
      ? Number(payload.bondPriceUsd)
      : migrationPriceResult.data == null ? null : Number(migrationPriceResult.data),
    poolStartedAt: payload.poolStartedAt ?? null,
  };
}
