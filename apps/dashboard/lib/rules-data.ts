import { createClient } from "@supabase/supabase-js";

export type RulesLiveData = {
  counts: { sighted: number; surveillance: number; acquired: number; binned: number };
  confirmationsPending: number;
  ruleVersion: string;
  latestTransitionAt: string | null;
  recorderEnabled: boolean;
};

export async function getRulesLiveData(): Promise<RulesLiveData> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Rules database environment is missing");
  const db = createClient(url, key, { auth: { persistSession: false }, db: { retry: false } });

  const [sighted, surveillance, acquired, binned, confirmations, latest, recorder] = await Promise.all([
    db.from("gmgn_launches").select("token_address", { count: "exact", head: true }).eq("research_state", "sighted"),
    db.from("gmgn_launches").select("token_address", { count: "exact", head: true }).eq("research_state", "under_watch"),
    db.from("gmgn_launches").select("token_address", { count: "exact", head: true }).eq("research_state", "target_locked"),
    db.from("gmgn_launches").select("token_address", { count: "exact", head: true }).eq("research_state", "binned"),
    db.from("gmgn_launches").select("token_address", { count: "exact", head: true }).eq("token_address", "__no_pending_confirmations__"),
    db.from("gmgn_snapshots").select("observed_at").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("recorder_control").select("enabled").eq("id", 1).single(),
  ]);

  for (const result of [sighted, surveillance, acquired, binned, confirmations, latest, recorder]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    counts: {
      sighted: sighted.count ?? 0,
      surveillance: surveillance.count ?? 0,
      acquired: acquired.count ?? 0,
      binned: binned.count ?? 0,
    },
    confirmationsPending: confirmations.count ?? 0,
    ruleVersion: "gmgn-clean-v1",
    latestTransitionAt: latest.data?.observed_at ?? null,
    recorderEnabled: recorder.data?.enabled === true,
  };
}
