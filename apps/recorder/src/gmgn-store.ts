import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import type { GmgnCandle, GmgnLifecycleStage, GmgnToken } from "./gmgn.js";

const db = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { retry: false },
});

function assertOk(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function pick(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (row[key] != null && row[key] !== "") return row[key];
  return null;
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: unknown) {
  const parsed = numberOrNull(value);
  return parsed == null ? null : Math.max(0, Math.round(parsed));
}

function booleanOrNull(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalised = String(value).toLowerCase();
  if (value === 1 || normalised === "1" || normalised === "yes" || normalised === "true") return true;
  if (value === 0 || normalised === "0" || normalised === "no" || normalised === "false") return false;
  return null;
}

function timestampOrNow(value: unknown) {
  const numeric = numberOrNull(value);
  const milliseconds = numeric == null
    ? Date.parse(String(value ?? ""))
    : numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : new Date().toISOString();
}

function percent(value: unknown) {
  const parsed = numberOrNull(value);
  if (parsed == null) return null;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function stageState(stage: GmgnLifecycleStage) {
  return stage === "new_creation" ? "sighted" : "under_watch";
}

function launchPayload(row: GmgnToken, observedAt: string) {
  const createdAt = timestampOrNow(pick(row, "created_timestamp", "creation_timestamp", "created_at"));
  const progress = numberOrNull(pick(row, "progress", "bonding_curve_progress"));
  const marketCap = numberOrNull(pick(row, "usd_market_cap", "market_cap"));
  return {
    token_address: String(pick(row, "address", "token_address") ?? "").toLowerCase(),
    name: pick(row, "name"),
    symbol: pick(row, "symbol"),
    image_url: pick(row, "logo", "image", "image_url"),
    description: pick(row, "description"),
    creator_address: String(pick(row, "creator", "creator_address") ?? "").toLowerCase() || null,
    launchpad_platform: String(pick(row, "launchpad_platform", "platform") ?? "pons"),
    exchange: pick(row, "exchange"),
    lifecycle_stage: row.lifecycle_stage,
    research_state: stageState(row.lifecycle_stage),
    created_at: createdAt,
    opened_at: pick(row, "open_timestamp") == null ? null : timestampOrNow(pick(row, "open_timestamp")),
    completed_at: pick(row, "complete_timestamp") == null ? null : timestampOrNow(pick(row, "complete_timestamp")),
    last_seen_at: observedAt,
    price_usd: numberOrNull(pick(row, "price")),
    market_cap_usd: marketCap,
    ath_market_cap_usd: numberOrNull(pick(row, "history_highest_market_cap", "ath_market_cap")) ?? marketCap,
    initial_liquidity_usd: numberOrNull(pick(row, "initial_liquidity")),
    liquidity_usd: numberOrNull(pick(row, "liquidity")),
    progress_pct: progress == null ? null : progress <= 1 ? progress * 100 : progress,
    total_supply: numberOrNull(pick(row, "total_supply")),
    holder_count: integerOrNull(pick(row, "holder_count", "holders")),
    swaps_1m: integerOrNull(pick(row, "swaps_1m")) ?? 0,
    swaps_1h: integerOrNull(pick(row, "swaps_1h")) ?? 0,
    swaps_24h: integerOrNull(pick(row, "swaps_24h", "swaps")) ?? 0,
    buys_24h: integerOrNull(pick(row, "buys_24h", "buys")) ?? 0,
    sells_24h: integerOrNull(pick(row, "sells_24h", "sells")) ?? 0,
    volume_1h_usd: numberOrNull(pick(row, "volume_1h")) ?? 0,
    volume_24h_usd: numberOrNull(pick(row, "volume_24h", "volume")) ?? 0,
    price_change_1m_pct: percent(pick(row, "price_change_percent1m", "price_change_1m")),
    price_change_5m_pct: percent(pick(row, "price_change_percent5m", "price_change_5m")),
    price_change_1h_pct: percent(pick(row, "price_change_percent1h", "price_change_1h")),
    top_10_holder_pct: percent(pick(row, "top_10_holder_rate", "top10_holder_rate")),
    creator_balance_pct: percent(pick(row, "creator_balance_rate")),
    creator_token_status: pick(row, "creator_token_status"),
    smart_money_count: integerOrNull(pick(row, "smart_degen_count")),
    renowned_count: integerOrNull(pick(row, "renowned_count")),
    sniper_count: integerOrNull(pick(row, "sniper_count")),
    rug_ratio: numberOrNull(pick(row, "rug_ratio")),
    insider_ratio: numberOrNull(pick(row, "rat_trader_amount_rate", "suspected_insider_hold_rate")),
    bundler_ratio: numberOrNull(pick(row, "bundler_trader_amount_rate", "bundler_rate")),
    fresh_wallet_ratio: numberOrNull(pick(row, "fresh_wallet_rate")),
    dev_team_hold_ratio: numberOrNull(pick(row, "dev_team_hold_rate")),
    liquidity_lock_pct: percent(pick(row, "lock_percent")),
    burn_status: pick(row, "burn_status"),
    open_source_status: pick(row, "open_source", "is_open_source"),
    owner_renounced_status: pick(row, "owner_renounced", "is_renounced"),
    is_honeypot: booleanOrNull(pick(row, "is_honeypot")),
    is_wash_trading: booleanOrNull(pick(row, "is_wash_trading")),
    buy_tax: numberOrNull(pick(row, "buy_tax")),
    sell_tax: numberOrNull(pick(row, "sell_tax")),
    twitter_url: pick(row, "twitter"),
    telegram_url: pick(row, "telegram"),
    website_url: pick(row, "website"),
    raw_payload: row,
    updated_at: observedAt,
  };
}

export async function getRecorderEnabled() {
  const { data, error } = await db.from("recorder_control").select("enabled").eq("id", 1).single();
  assertOk(error, "read recorder control");
  return data?.enabled === true;
}

export async function setGmgnStatus(status: "connecting" | "connected" | "error" | "stopped", message: string | null = null) {
  const { error } = await db.from("stream_status").upsert({
    feed: "gmgn_trenches",
    status,
    message,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "feed" });
  assertOk(error, "write GMGN status");
}

export async function saveTrenches(rows: GmgnToken[]) {
  if (!rows.length) return 0;
  const observedAt = new Date().toISOString();
  const payloads = rows.map((row) => launchPayload(row, observedAt)).filter((row) => row.token_address);
  const addresses = payloads.map((row) => row.token_address);
  const { data: existing, error: existingError } = await db
    .from("gmgn_launches")
    .select("token_address,research_state")
    .in("token_address", addresses);
  assertOk(existingError, "read existing GMGN launches");
  const existingState = new Map((existing ?? []).map((row) => [row.token_address, row.research_state]));

  const firstRows = payloads.map((row) => ({
    ...row,
    first_seen_at: observedAt,
    initial_market_cap_usd: row.market_cap_usd,
  }));
  const { error: insertError } = await db.from("gmgn_launches")
    .upsert(firstRows, { onConflict: "token_address", ignoreDuplicates: true });
  assertOk(insertError, "insert new GMGN launches");

  const updateRows = payloads.map((row) => ({
    ...row,
    research_state: ["target_locked", "binned"].includes(existingState.get(row.token_address) ?? "")
      ? existingState.get(row.token_address)
      : row.research_state,
  }));
  const { error: updateError } = await db.from("gmgn_launches")
    .upsert(updateRows, { onConflict: "token_address" });
  assertOk(updateError, "update GMGN launches");

  const observedMinute = new Date(Math.floor(Date.parse(observedAt) / 60_000) * 60_000).toISOString();
  const snapshots = updateRows.map((row) => ({
    token_address: row.token_address,
    observed_minute: observedMinute,
    observed_at: observedAt,
    lifecycle_stage: row.lifecycle_stage,
    price_usd: row.price_usd,
    market_cap_usd: row.market_cap_usd,
    ath_market_cap_usd: row.ath_market_cap_usd,
    liquidity_usd: row.liquidity_usd,
    holder_count: row.holder_count,
    swaps_1m: row.swaps_1m,
    swaps_1h: row.swaps_1h,
    volume_1h_usd: row.volume_1h_usd,
    price_change_1m_pct: row.price_change_1m_pct,
    price_change_5m_pct: row.price_change_5m_pct,
    price_change_1h_pct: row.price_change_1h_pct,
    rug_ratio: row.rug_ratio,
    insider_ratio: row.insider_ratio,
    bundler_ratio: row.bundler_ratio,
    smart_money_count: row.smart_money_count,
    raw_payload: row.raw_payload,
  }));
  const { error: snapshotError } = await db.from("gmgn_snapshots")
    .upsert(snapshots, { onConflict: "token_address,observed_minute" });
  assertOk(snapshotError, "save GMGN snapshots");
  return updateRows.length;
}

export async function getNextCandleCandidate() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await db.from("gmgn_launches")
    .select("token_address,created_at,candles_checked_at")
    .gte("created_at", cutoff)
    .neq("research_state", "binned")
    .order("candles_checked_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  assertOk(error, "choose GMGN candle candidate");
  return data as { token_address: string; created_at: string; candles_checked_at: string | null } | null;
}

export async function saveCandles(tokenAddress: string, candles: GmgnCandle[]) {
  if (candles.length) {
    const { error } = await db.from("gmgn_candles").upsert(candles.map((candle) => ({
      token_address: tokenAddress,
      resolution: "1m",
      candle_at: candle.candleAt,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })), { onConflict: "token_address,resolution,candle_at" });
    assertOk(error, "save GMGN candles");
  }
  const { error } = await db.from("gmgn_launches")
    .update({ candles_checked_at: new Date().toISOString() })
    .eq("token_address", tokenAddress);
  assertOk(error, "mark GMGN candle check");
}
