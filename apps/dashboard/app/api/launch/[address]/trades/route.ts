import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return Response.json({ error: "Invalid token address" }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return Response.json({ error: "Database unavailable" }, { status: 503 });

  const sinceParam = new URL(request.url).searchParams.get("since");
  const sinceMs = sinceParam ? Date.parse(sinceParam) : Number.NaN;
  const db = createClient(url, key, { auth: { persistSession: false }, db: { retry: false } });
  let query = db
    .from("trade_market_data")
    .select("market_event_id,transaction_hash,block_time,side,trader_address,price_usd,base_amount_usd,quote_amount_usd,protocol")
    .eq("token_address", address.toLowerCase())
    .order("block_time", { ascending: false })
    .limit(250);

  if (Number.isFinite(sinceMs)) {
    query = query.gte("block_time", new Date(sinceMs - 2_000).toISOString());
  }

  const { data, error } = await query.abortSignal(AbortSignal.timeout(3_000));
  if (error) return Response.json({ error: "Trade feed unavailable" }, { status: 503 });

  return Response.json({ trades: data ?? [] }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
