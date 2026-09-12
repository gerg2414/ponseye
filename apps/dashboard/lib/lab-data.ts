import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

export type LabToken = {
  token_address: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  launched_at: string;
  signal_at: string;
  signal_age_seconds: number | null;
  status: string;
  actual_state: string;
  actual_acquired: boolean;
  actual_binned: boolean;
  trade_count: number;
  buys: number;
  sells: number;
  unique_traders: number;
  buy_pressure_pct: number | null;
  creator_sells: number;
  first_minute_buyers: number;
  momentum_multiple: number | null;
  peak_hold_pct: number | null;
  holder_count: number | null;
  top_10_holder_pct: number | null;
  creator_balance_pct: number | null;
  signal_price_usd: number | null;
  signal_market_cap_usd: number | null;
  signal_volume_usd: number;
  followup_trades: number;
  outcome_scope: "full_market" | "curve_only";
  future_peak_multiple: number | null;
  future_low_multiple: number | null;
  final_multiple: number | null;
  closed_at?: string | null;
  position_status?: "open" | "closed" | null;
  entry_market_cap_usd?: number | null;
  exit_market_cap_usd?: number | null;
  target_multiple?: number | null;
  stop_multiple?: number | null;
  exit_reason?: "target" | "stop" | null;
  pre_target_low_multiples: Record<string, number | null>;
  post_2x_pre_target_low_multiples: Record<string, number | null>;
};

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericRecord(value: unknown) {
  if (!value || typeof value !== "object") return {} as Record<string, number | null>;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, numberOrNull(item)]));
}

async function loadPonsEyeLabData(): Promise<LabToken[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Lab database environment is missing");

  const db = createClient(url, key, {
    auth: { persistSession: false },
    db: { retry: false },
  });
  const result = await db
    .rpc("get_ponseye_lab_dataset")
    .abortSignal(AbortSignal.timeout(60_000));

  if (result.error || !Array.isArray(result.data)) {
    throw new Error(result.error?.message ?? "No Lab dataset returned");
  }

  return result.data.map((token) => ({
    ...token,
    signal_age_seconds: numberOrNull(token.signal_age_seconds),
    trade_count: Number(token.trade_count ?? 0),
    buys: Number(token.buys ?? 0),
    sells: Number(token.sells ?? 0),
    unique_traders: Number(token.unique_traders ?? 0),
    buy_pressure_pct: numberOrNull(token.buy_pressure_pct),
    creator_sells: Number(token.creator_sells ?? 0),
    first_minute_buyers: Number(token.first_minute_buyers ?? 0),
    momentum_multiple: numberOrNull(token.momentum_multiple),
    peak_hold_pct: numberOrNull(token.peak_hold_pct),
    holder_count: numberOrNull(token.holder_count),
    top_10_holder_pct: numberOrNull(token.top_10_holder_pct),
    creator_balance_pct: numberOrNull(token.creator_balance_pct),
    signal_price_usd: numberOrNull(token.signal_price_usd),
    signal_market_cap_usd: numberOrNull(token.signal_market_cap_usd),
    signal_volume_usd: Number(token.signal_volume_usd ?? 0),
    followup_trades: Number(token.followup_trades ?? 0),
    outcome_scope: token.outcome_scope === "full_market" ? "full_market" : "curve_only",
    future_peak_multiple: numberOrNull(token.future_peak_multiple),
    future_low_multiple: numberOrNull(token.future_low_multiple),
    final_multiple: numberOrNull(token.final_multiple),
    pre_target_low_multiples: numericRecord(token.pre_target_low_multiples),
    post_2x_pre_target_low_multiples: numericRecord(token.post_2x_pre_target_low_multiples),
  })) as LabToken[];
}

const getCachedPonsEyeLabData = unstable_cache(
  loadPonsEyeLabData,
  ["ponseye-lab-dataset-v4"],
  { revalidate: 600 },
);

export async function getPonsEyeLabData() {
  try {
    return await getCachedPonsEyeLabData();
  } catch (error) {
    console.error("[lab] data request failed", error instanceof Error ? error.message : String(error));
    return [] as LabToken[];
  }
}

type CapitalPosition = {
  token_address: string;
  acquired_at: string;
  entry_price_usd: number | string | null;
  entry_market_cap_usd: number | string | null;
  exit_market_cap_usd: number | string | null;
  peak_price_usd: number | string | null;
  target_multiple: number | string;
  stop_multiple: number | string;
  position_status: "open" | "closed";
  closed_at: string | null;
  exit_reason: "target" | "stop" | null;
};

type CapitalLaunch = {
  token_address: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  launched_at: string;
  status: string;
};

type CapitalMetric = { token_address: string; price_usd: number | string | null };

async function loadCapitalCircuitData(): Promise<LabToken[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Capital Circuit database environment is missing");

  const db = createClient(url, key, { auth: { persistSession: false }, db: { retry: false } });
  const [labTokens, positionsResult, launchesResult, metricsResult] = await Promise.all([
    getPonsEyeLabData(),
    db.from("acquired_positions").select("token_address,acquired_at,entry_price_usd,entry_market_cap_usd,exit_market_cap_usd,peak_price_usd,target_multiple,stop_multiple,position_status,closed_at,exit_reason"),
    db.from("launches").select("token_address,name,symbol,image_url,launched_at,status"),
    db.from("launch_metrics").select("token_address,price_usd"),
  ]);

  if (positionsResult.error) throw new Error(positionsResult.error.message);
  if (launchesResult.error) throw new Error(launchesResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);

  const positions = (positionsResult.data ?? []) as CapitalPosition[];
  const launches = new Map(((launchesResult.data ?? []) as CapitalLaunch[]).map((launch) => [launch.token_address, launch]));
  const metrics = new Map(((metricsResult.data ?? []) as CapitalMetric[]).map((metric) => [metric.token_address, metric]));
  const existing = new Map(labTokens.map((token) => [token.token_address, token]));

  return positions.map((position) => {
    const prior = existing.get(position.token_address);
    const launch = launches.get(position.token_address);
    const metric = metrics.get(position.token_address);
    const entryPrice = numberOrNull(position.entry_price_usd);
    const currentPrice = numberOrNull(metric?.price_usd);
    const peakPrice = numberOrNull(position.peak_price_usd);
    const entryMarketCap = numberOrNull(position.entry_market_cap_usd);
    const exitMarketCap = numberOrNull(position.exit_market_cap_usd);
    const targetMultiple = numberOrNull(position.target_multiple);
    const stopMultiple = numberOrNull(position.stop_multiple);
    const liveMultiple = entryPrice && currentPrice ? currentPrice / entryPrice : null;
    const peakMultiple = entryPrice && peakPrice ? peakPrice / entryPrice : null;

    return {
      token_address: position.token_address,
      name: prior?.name ?? launch?.name ?? null,
      symbol: prior?.symbol ?? launch?.symbol ?? null,
      image_url: prior?.image_url ?? launch?.image_url ?? null,
      launched_at: prior?.launched_at ?? launch?.launched_at ?? position.acquired_at,
      signal_at: position.acquired_at,
      signal_age_seconds: prior?.signal_age_seconds ?? null,
      status: launch?.status ?? prior?.status ?? "active",
      actual_state: "target_locked",
      actual_acquired: true,
      actual_binned: false,
      trade_count: prior?.trade_count ?? 0,
      buys: prior?.buys ?? 0,
      sells: prior?.sells ?? 0,
      unique_traders: prior?.unique_traders ?? 0,
      buy_pressure_pct: prior?.buy_pressure_pct ?? null,
      creator_sells: prior?.creator_sells ?? 0,
      first_minute_buyers: prior?.first_minute_buyers ?? 0,
      momentum_multiple: prior?.momentum_multiple ?? null,
      peak_hold_pct: prior?.peak_hold_pct ?? null,
      holder_count: prior?.holder_count ?? null,
      top_10_holder_pct: prior?.top_10_holder_pct ?? null,
      creator_balance_pct: prior?.creator_balance_pct ?? null,
      signal_price_usd: entryPrice,
      signal_market_cap_usd: entryMarketCap,
      signal_volume_usd: prior?.signal_volume_usd ?? 0,
      followup_trades: prior?.followup_trades ?? 0,
      outcome_scope: prior?.outcome_scope ?? "full_market",
      future_peak_multiple: peakMultiple ?? prior?.future_peak_multiple ?? null,
      future_low_multiple: prior?.future_low_multiple ?? null,
      final_multiple: position.position_status === "closed" && entryMarketCap && exitMarketCap
        ? exitMarketCap / entryMarketCap
        : liveMultiple ?? prior?.final_multiple ?? null,
      closed_at: position.closed_at,
      position_status: position.position_status,
      entry_market_cap_usd: entryMarketCap,
      exit_market_cap_usd: exitMarketCap,
      target_multiple: targetMultiple,
      stop_multiple: stopMultiple,
      exit_reason: position.exit_reason,
      pre_target_low_multiples: prior?.pre_target_low_multiples ?? {},
      post_2x_pre_target_low_multiples: prior?.post_2x_pre_target_low_multiples ?? {},
    } satisfies LabToken;
  });
}

const getCachedCapitalCircuitData = unstable_cache(
  loadCapitalCircuitData,
  ["ponseye-capital-circuit-v1"],
  { revalidate: 5 },
);

export async function getCapitalCircuitData() {
  try {
    return await getCachedCapitalCircuitData();
  } catch (error) {
    console.error("[capital-circuit] data request failed", error instanceof Error ? error.message : String(error));
    return [] as LabToken[];
  }
}
