import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    return Response.json({ database: "configuration_missing", elapsedMs: Date.now() - startedAt }, { status: 503 });
  }

  const db = createClient(url, key, { auth: { persistSession: false }, db: { retry: false } });
  const result = await db
    .rpc("get_dashboard_home", { p_limit: 1 })
    .abortSignal(AbortSignal.timeout(25_000));

  if (result.error) {
    return Response.json({ database: "query_failed", code: result.error.code, elapsedMs: Date.now() - startedAt }, { status: 503 });
  }

  return Response.json({ database: "connected", elapsedMs: Date.now() - startedAt });
}
