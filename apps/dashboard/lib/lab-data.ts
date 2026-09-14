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
  recent_buys_20s: number;
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
  exit_reason?: "target" | "stop" | "failure_8m" | "failure_sustained" | "post_10x_below_3x" | null;
  strategy_version?: string | null;
  position_size_usd?: number | null;
  remaining_pct?: number | null;
  realised_return_multiple?: number | null;
  position_value_multiple?: number | null;
  hit_10x_at?: string | null;
  hit_20x_at?: string | null;
  hit_50x_at?: string | null;
  hit_100x_at?: string | null;
  pre_target_low_multiples: Record<string, number | null>;
  post_2x_pre_target_low_multiples: Record<string, number | null>;
};

export type CapitalCircuitDaily = {
  date: string;
  sighted: number;
  surveilling: number;
  acquired: number;
};

export type SurveillanceGateSettings = {
  minAgeSeconds: number;
  maxAgeSeconds: number;
  minMarketCapUsd: number;
  minTrades: number;
  minUniqueTraders: number;
  minBuyPressurePct: number;
  requireNoCreatorSales: boolean;
};

export const defaultSurveillanceGate: SurveillanceGateSettings = {
  minAgeSeconds: 60,
  maxAgeSeconds: 900,
  minMarketCapUsd: 10_000,
  minTrades: 12,
  minUniqueTraders: 6,
  minBuyPressurePct: 52,
  requireNoCreatorSales: true,
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

export function normaliseLabTokens(data: unknown): LabToken[] {
  if (!Array.isArray(data)) return [];
  return data.map((token) => ({
    ...token,
    signal_age_seconds: numberOrNull(token.signal_age_seconds),
    trade_count: Number(token.trade_count ?? 0),
    buys: Number(token.buys ?? 0),
    recent_buys_20s: Number(token.recent_buys_20s ?? 0),
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

  return normaliseLabTokens(result.data);
}

async function loadPonsEyeFullFunnelData(serialisedSettings: string) {
  const settings = JSON.parse(serialisedSettings) as SurveillanceGateSettings;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Lab database environment is missing");

  const db = createClient(url, key, { auth: { persistSession: false }, db: { retry: false } });
  const result = await db.rpc("get_ponseye_full_funnel_dataset", {
    p_min_age_seconds: settings.minAgeSeconds,
    p_max_age_seconds: settings.maxAgeSeconds,
    p_min_market_cap_usd: settings.minMarketCapUsd,
    p_min_trades: settings.minTrades,
    p_min_unique_traders: settings.minUniqueTraders,
    p_min_buy_pressure_pct: settings.minBuyPressurePct,
    p_require_no_creator_sales: settings.requireNoCreatorSales,
  }).abortSignal(AbortSignal.timeout(240_000));

  if (result.error) throw new Error(result.error.message);
  return normaliseLabTokens(result.data);
}

const getCachedPonsEyeFullFunnelData = unstable_cache(
  loadPonsEyeFullFunnelData,
  ["ponseye-full-funnel-v1"],
  { revalidate: 60 },
);

export async function getPonsEyeFullFunnelData(settings: SurveillanceGateSettings) {
  return getCachedPonsEyeFullFunnelData(JSON.stringify(settings));
}

const getCachedPonsEyeLabData = unstable_cache(
  loadPonsEyeLabData,
  ["ponseye-lab-dataset-v6"],
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
  stop_multiple: number | string | null;
  strategy_version: string;
  position_size_usd: number | string;
  remaining_pct: number | string;
  realised_return_multiple: number | string;
  hit_10x_at: string | null;
  hit_20x_at: string | null;
  hit_50x_at: string | null;
  hit_100x_at: string | null;
  position_status: "open" | "closed";
  closed_at: string | null;
  exit_reason: "target" | "stop" | "failure_8m" | "failure_sustained" | "post_10x_below_3x" | null;
};

type CapitalLaunch = {
  token_address: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  created_at: string;
  lifecycle_stage: string;
  price_usd: number | string | null;
  market_cap_usd: number | string | null;
  ath_market_cap_usd: number | string | null;
  swaps_24h: number | string | null;
  buys_24h: number | string | null;
  sells_24h: number | string | null;
  holder_count: number | string | null;
  top_10_holder_pct: number | string | null;
  creator_balance_pct: number | string | null;
};

async function loadCapitalCircuitData(): Promise<LabToken[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Capital Circuit database environment is missing");

  const db = createClient(url, key, { auth: { persistSession: false } });

  // The full ledger, open and closed. The acquired lane on the home page shows
  // only the last day; everything ever taken lives here.
  const result = await db.from("ponseye_positions_live")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(500)
    .abortSignal(AbortSignal.timeout(30_000));

  if (result.error) throw new Error(result.error.message);

  return ((result.data ?? []) as Array<Record<string, unknown>>).map((position) => {
    const entryMarketCap = numberOrNull(position.entry_market_cap_usd);
    const realised = numberOrNull(position.realised_multiple) ?? 0;
    const remaining = numberOrNull(position.remaining_fraction) ?? 0;
    const rungs = (position.rungs_filled ?? []) as number[];
    // Value per unit staked: what has been banked plus whatever still rides.
    const finalMultiple = numberOrNull(position.position_value_multiple) ?? realised + remaining;

    return {
      token_address: position.token_address as string,
      name: (position.name ?? null) as string | null,
      symbol: (position.symbol ?? null) as string | null,
      image_url: (position.image_url ?? null) as string | null,
      launched_at: position.opened_at as string,
      signal_at: position.opened_at as string,
      signal_age_seconds: 60,
      status: position.closed_at ? "closed" : "open",
      actual_state: "acquired",
      // The ledger filters on this: every row here is a position that was
      // actually taken, as opposed to a signal that merely qualified.
      actual_acquired: true,
      actual_binned: false,
      outcome_scope: "full_market" as const,
      signal_market_cap_usd: entryMarketCap,
      signal_price_usd: numberOrNull(position.entry_price_usd),
      signal_volume_usd: 0,
      followup_trades: 0,
      trade_count: 0,
      buys: 0,
      sells: 0,
      recent_buys_20s: 0,
      unique_traders: 0,
      buy_pressure_pct: null,
      creator_sells: 0,
      first_minute_buyers: numberOrNull(position.entry_holder_count) ?? 0,
      momentum_multiple: null,
      peak_hold_pct: null,
      holder_count: numberOrNull(position.entry_holder_count),
      top_10_holder_pct: null,
      creator_balance_pct: null,
      future_low_multiple: null,
      entry_market_cap_usd: entryMarketCap,
      market_cap_usd: numberOrNull(position.current_market_cap_usd),
      final_multiple: finalMultiple,
      future_peak_multiple: numberOrNull(position.peak_multiple_seen),
      realised_return_multiple: realised,
      remaining_pct: remaining * 100,
      // Paper trading, so every position is the same notional stake and the
      // returns above are per unit rather than in currency.
      position_size_usd: 100,
      position_status: position.closed_at ? "closed" : "open",
      closed_at: (position.closed_at ?? null) as string | null,
      exit_reason: (position.close_reason ?? null) as string | null,
      strategy_version: (position.strategy ?? null) as string | null,
      hit_10x_at: rungs.includes(10) ? (position.closed_at ?? null) : null,
      hit_20x_at: null,
      hit_50x_at: null,
      hit_100x_at: null,
    } as unknown as LabToken;
  });
}

const getCachedCapitalCircuitData = unstable_cache(
  loadCapitalCircuitData,
  ["ponseye-capital-circuit-positions-v1"],
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

async function loadCapitalCircuitAnalytics(): Promise<CapitalCircuitDaily[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Capital Circuit database environment is missing");

  const db = createClient(url, key, { auth: { persistSession: false }, db: { retry: false } });
  const result = await db
    .rpc("get_capital_circuit_analytics")
    .abortSignal(AbortSignal.timeout(30_000));

  if (result.error) throw new Error(result.error.message);
  const payload = result.data && typeof result.data === "object" ? result.data as { dailyFunnel?: unknown } : {};
  if (!Array.isArray(payload.dailyFunnel)) return [];

  return payload.dailyFunnel.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      date: String(row.date ?? ""),
      sighted: Number(row.sighted ?? 0),
      surveilling: Number(row.surveilling ?? 0),
      acquired: Number(row.acquired ?? 0),
    };
  }).filter((row) => row.date);
}

const getCachedCapitalCircuitAnalytics = unstable_cache(
  loadCapitalCircuitAnalytics,
  ["ponseye-capital-circuit-analytics-v1"],
  { revalidate: 60 },
);

export async function getCapitalCircuitAnalytics() {
  try {
    return await getCachedCapitalCircuitAnalytics();
  } catch (error) {
    console.error("[capital-circuit] analytics request failed", error instanceof Error ? error.message : String(error));
    return [] as CapitalCircuitDaily[];
  }
}
