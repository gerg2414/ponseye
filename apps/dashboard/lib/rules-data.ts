import { createClient } from "@supabase/supabase-js";

export type RulesLiveData = {
  counts: { sighted: number; surveillance: number; acquired: number; binned: number };
  ruleVersion: string;
  latestTransitionAt: string | null;
  recorderEnabled: boolean;
};

export async function getRulesLiveData(): Promise<RulesLiveData> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Rules database environment is missing");
  const db = createClient(url, key, { auth: { persistSession: false }, db: { retry: false } });

  const [sighted, surveillance, acquired, binned, latest, recorder] = await Promise.all([
    db.from("launch_metrics").select("token_address", { count: "exact", head: true }).eq("research_state", "sighted"),
    db.from("launch_metrics").select("token_address", { count: "exact", head: true }).eq("research_state", "under_watch"),
    db.from("launch_metrics").select("token_address", { count: "exact", head: true }).eq("research_state", "target_locked"),
    db.from("launch_metrics").select("token_address", { count: "exact", head: true }).eq("research_state", "binned"),
    db.from("research_events").select("rule_version,observed_at").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("recorder_control").select("enabled").eq("id", 1).single(),
  ]);

  for (const result of [sighted, surveillance, acquired, binned, latest, recorder]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    counts: {
      sighted: sighted.count ?? 0,
      surveillance: surveillance.count ?? 0,
      acquired: acquired.count ?? 0,
      binned: binned.count ?? 0,
    },
    ruleVersion: latest.data?.rule_version ?? "pons-momentum-v4",
    latestTransitionAt: latest.data?.observed_at ?? null,
    recorderEnabled: recorder.data?.enabled === true,
  };
}
