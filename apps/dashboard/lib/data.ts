import { createClient } from "@supabase/supabase-js";

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
};

export type StreamStatus = {
  feed: string;
  status: string;
  last_seen_at: string;
};

const emptyData = {
  launches: [] as Launch[],
  streams: [] as StreamStatus[],
  launchCount: 0,
  tradeCount: 0,
  dataConnected: false,
};

export async function getDashboardData() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return emptyData;

  const db = createClient(url, key, { auth: { persistSession: false } });
  const [launchesResult, launchCountResult, streamsResult, tradesResult] = await Promise.all([
    db.from("launch_board").select("*").order("launched_at", { ascending: false }).limit(200),
    db.from("launches").select("token_address", { count: "exact", head: true }),
    db.from("stream_status").select("feed,status,last_seen_at").order("feed"),
    db.from("trades").select("event_id", { count: "exact", head: true }),
  ]);

  const launches = (launchesResult.data ?? []).map((launch) => ({
    ...launch,
    progress_pct: launch.progress_pct == null ? null : Number(launch.progress_pct),
  })) as Launch[];

  return {
    launches,
    streams: (streamsResult.data ?? []) as StreamStatus[],
    launchCount: launchCountResult.count ?? 0,
    tradeCount: tradesResult.count ?? 0,
    dataConnected: !launchesResult.error && !launchCountResult.error && !streamsResult.error && !tradesResult.error,
  };
}
