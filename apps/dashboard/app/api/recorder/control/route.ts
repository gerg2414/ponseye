import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return NextResponse.json({ error: "Database environment is missing" }, { status: 503 });

  const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "Recorder state must be true or false" }, { status: 400 });
  }

  const db = createClient(url, key, { auth: { persistSession: false }, db: { retry: false } });
  const { data, error } = await db
    .from("recorder_control")
    .update({ enabled: body.enabled, updated_at: new Date().toISOString(), updated_by: "lab" })
    .eq("id", 1)
    .select("enabled,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
