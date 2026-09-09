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
  initial_quote_in_raw: string | null;
};

export type StreamStatus = {
  feed: string;
  status: string;
  last_seen_at: string;
};

export async function getDashboardData() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { launches: [] as Launch[], streams: [] as StreamStatus[], launchCount: 0, tradeCount: 0 };

  const db = createClient(url, key, { auth: { persistSession: false } });
  const [launchesResult, launchCountResult, streamsResult, tradesResult] = await Promise.all([
    db.from("launches").select("token_address,curve_address,name,symbol,image_url,deployer_address,pair_token_address,status,launched_at,initial_quote_in_raw").order("launched_at", { ascending: false }).limit(50),
    db.from("launches").select("token_address", { count: "exact", head: true }),
    db.from("stream_status").select("feed,status,last_seen_at").order("feed"),
    db.from("trades").select("event_id", { count: "exact", head: true }),
  ]);

  return {
    launches: (launchesResult.data ?? []) as Launch[],
    streams: (streamsResult.data ?? []) as StreamStatus[],
    launchCount: launchCountResult.count ?? 0,
    tradeCount: tradesResult.count ?? 0,
  };
}
