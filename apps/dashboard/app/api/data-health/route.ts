import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const startedAt = Date.now();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    return Response.json({
      ok: false,
      elapsedMs: Date.now() - startedAt,
      urlPresent: Boolean(url),
      keyPresent: Boolean(key),
      error: "missing_environment",
    });
  }

  let hostname = "invalid_url";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return Response.json({
      ok: false,
      elapsedMs: Date.now() - startedAt,
      urlPresent: true,
      keyPresent: true,
      hostname,
      error: "invalid_url",
    });
  }

  try {
    const db = createClient(url, key, {
      auth: { persistSession: false },
      db: { retry: false },
    });
    const result = await db
      .rpc("get_dashboard_home", { p_limit: 1 })
      .abortSignal(AbortSignal.timeout(5_000));

    return Response.json({
      ok: !result.error,
      elapsedMs: Date.now() - startedAt,
      hostname,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
            hint: result.error.hint,
          }
        : null,
      launchCount: result.data?.launchCount ?? null,
      launchesReturned: Array.isArray(result.data?.launches) ? result.data.launches.length : null,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      elapsedMs: Date.now() - startedAt,
      hostname,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
