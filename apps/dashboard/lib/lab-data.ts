import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

export type LabToken = {
  token_address: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  launched_at: string;
  signal_at: string;
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
};

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  })) as LabToken[];
}

const getCachedPonsEyeLabData = unstable_cache(
  loadPonsEyeLabData,
  ["ponseye-lab-dataset-v2"],
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
