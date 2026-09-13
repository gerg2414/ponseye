import { queryBitquery } from "./bitquery.js";
import { ponsCurveHistory } from "./queries.js";
import { saveTrades, type EventRow } from "./store.js";

type CurveHistoryResponse = {
  data?: { EVM?: { CurveEvents?: EventRow[] } };
};

const WINDOW_MS = 5 * 60_000;
const MAX_RECOVERY_MS = 12 * 60 * 60_000;

export async function recoverCurveTrades(
  accessToken: string,
  signal: AbortSignal,
  since: string | null,
) {
  const finish = Date.now();
  const parsedStart = since ? new Date(since).getTime() - 60_000 : finish - 10 * 60_000;
  let cursor = Math.max(
    Number.isFinite(parsedStart) ? parsedStart : finish - 10 * 60_000,
    finish - MAX_RECOVERY_MS,
  );
  let received = 0;
  let stored = 0;

  while (!signal.aborted && cursor < finish) {
    const windowEnd = Math.min(finish, cursor + WINDOW_MS);
    const response = await queryBitquery<CurveHistoryResponse>(
      accessToken,
      ponsCurveHistory(new Date(cursor).toISOString(), new Date(windowEnd).toISOString()),
      AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    );
    const rows = response.data?.EVM?.CurveEvents ?? [];
    if (rows.length >= 10_000) {
      throw new Error(`Curve history exceeded 10,000 rows between ${new Date(cursor).toISOString()} and ${new Date(windowEnd).toISOString()}`);
    }
    received += rows.length;
    stored += await saveTrades(rows);
    cursor = windowEnd + 1;
  }

  console.log(`Curve history recovery processed ${received} events and matched ${stored} Pons trades since ${since ?? "recent fallback"}`);
  return stored;
}
