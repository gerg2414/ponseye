import { queryBitquery } from "./bitquery.js";
import { ponsLaunchHistory } from "./queries.js";
import { saveLaunchCall } from "./store.js";

type LaunchHistoryResponse = {
  data?: { EVM?: { Calls?: never[] } };
};

export async function recoverRecentLaunches(accessToken: string, signal: AbortSignal) {
  const finish = new Date();
  const start = new Date(finish.getTime() - 2 * 60 * 60_000);
  const response = await queryBitquery<LaunchHistoryResponse>(
    accessToken,
    ponsLaunchHistory(start.toISOString(), finish.toISOString()),
    AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  );
  const rows = response.data?.EVM?.Calls ?? [];
  for (const row of rows) {
    if (signal.aborted) break;
    await saveLaunchCall(row);
  }
  console.log(`Launch history recovery checked ${rows.length} calls since ${start.toISOString()}`);
}
