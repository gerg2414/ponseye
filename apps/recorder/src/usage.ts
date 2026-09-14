import { getAccessToken } from "./bitquery-client.js";

/**
 * Bitquery bills on points, a complexity-weighted measure of the work a query
 * does, not on the number of requests. A single page of a thousand rows costs
 * far more than a thousand single-row lookups, so a recorder can look modest by
 * request count and still exhaust a month's allowance in days.
 *
 * The account API reports the live figure, which is the only way to know where
 * the budget actually stands rather than inferring it.
 */
export type BitqueryUsage = {
  status: string;
  planName: string | null;
  pointsUsed: number;
  pointsLimit: number;
  pointsFraction: number;
  requests: number;
  periodStart: string | null;
  periodEnd: string | null;
  /** Fraction of the period elapsed, for comparing spend against pace. */
  periodFraction: number;
  sessionLimit: number | null;
  fetchedAt: string;
};

let cached: BitqueryUsage | null = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60_000;

export async function getBitqueryUsage(force = false): Promise<BitqueryUsage | null> {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  try {
    const response = await fetch("https://account.bitquery.io/api/usage", {
      headers: { Authorization: `Bearer ${await getAccessToken()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`usage endpoint returned ${response.status}`);

    const payload = await response.json() as {
      status?: string;
      billing_period?: {
        plan_name?: string;
        started_at?: string;
        ended_at?: string;
        limits?: { points_limit?: number; session_limit?: number };
        usage?: { points_usage?: number; requests_usage?: number };
      };
    };

    const period = payload.billing_period ?? {};
    const limit = Number(period.limits?.points_limit ?? 0);
    const used = Number(period.usage?.points_usage ?? 0);
    const start = period.started_at ? Date.parse(period.started_at) : NaN;
    const end = period.ended_at ? Date.parse(period.ended_at) : NaN;
    const periodFraction = Number.isFinite(start) && Number.isFinite(end) && end > start
      ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start)))
      : 0;

    cached = {
      status: payload.status ?? "unknown",
      planName: period.plan_name ?? null,
      pointsUsed: used,
      pointsLimit: limit,
      pointsFraction: limit > 0 ? used / limit : 0,
      requests: Number(period.usage?.requests_usage ?? 0),
      periodStart: period.started_at ?? null,
      periodEnd: period.ended_at ?? null,
      periodFraction,
      sessionLimit: period.limits?.session_limit ?? null,
      fetchedAt: new Date().toISOString(),
    };
    cachedAt = Date.now();
    return cached;
  } catch (error) {
    console.error("Could not read Bitquery usage", error);
    return cached;
  }
}

/**
 * How much of the pipeline should run at the current spend.
 *
 * Capture is what cannot be recovered later: a graduation missed now is gone,
 * whereas anything derived from history can be rebuilt whenever budget allows.
 * So when the allowance runs short, the derived work stops first and recording
 * keeps going.
 */
export type BudgetLevel = "full" | "reduced" | "essential";

export function budgetLevel(usage: BitqueryUsage | null): BudgetLevel {
  if (!usage || usage.pointsLimit <= 0) return "full";

  // Judged on headroom alone, not on pace against the calendar.
  //
  // A pace rule reads a one-off backfill as a permanent burn rate and holds the
  // pipeline down for the rest of the period, long after the spending stopped.
  // Cumulative usage cannot distinguish "still spending fast" from "spent a lot
  // once", so it is the wrong signal; what matters is how much is left.
  if (usage.pointsFraction >= 0.95) return "essential";
  if (usage.pointsFraction >= 0.85) return "reduced";
  return "full";
}

export const STAGE_PRIORITY: Record<string, BudgetLevel> = {
  // Irreplaceable: a graduation not recorded now cannot be recovered.
  migrations: "essential",
  "launch-metadata": "essential",
  // Useful but rebuildable from history at any time.
  "live-metrics": "reduced",
  "migration-price": "reduced",
  "metadata-sync": "reduced",
  // Cheap and needed daily: outcomes take a day to mature, so pausing this
  // quietly stops the research dataset improving while everything still looks
  // healthy. It reads only new candles, so it costs little to keep running.
  "snapshot-refresh": "reduced",
  // Pure backfill of history that is not going anywhere, entirely deferrable.
  "launch-backfill": "full",
  "curve-stats": "full",
  // Carries the entry filter, so it stays up unless the allowance is nearly gone.
  holders: "reduced",
  history: "full",
};

const ORDER: BudgetLevel[] = ["essential", "reduced", "full"];

export function stageAllowed(stageName: string, level: BudgetLevel) {
  const required = STAGE_PRIORITY[stageName] ?? "full";
  return ORDER.indexOf(required) <= ORDER.indexOf(level);
}
