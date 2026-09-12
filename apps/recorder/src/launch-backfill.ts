import { queryBitquery } from "./bitquery.js";
import { ponsLaunchHistory } from "./queries.js";
import { getMissingLaunchMetadataTimes, saveLaunchCall } from "./store.js";

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

export async function recoverMissingLaunchMetadata(accessToken: string, signal: AbortSignal) {
  const missingTimes = await getMissingLaunchMetadataTimes();
  if (!missingTimes.length) return 0;

  const windows = new Map<number, { start: Date; finish: Date }>();
  for (const value of missingTimes) {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) continue;
    const hour = Math.floor(time / 3_600_000) * 3_600_000;
    windows.set(hour, {
      start: new Date(hour - 60_000),
      finish: new Date(hour + 3_660_000),
    });
  }

  let recovered = 0;
  for (const { start, finish } of windows.values()) {
    if (signal.aborted) break;
    const response = await queryBitquery<LaunchHistoryResponse>(
      accessToken,
      ponsLaunchHistory(start.toISOString(), finish.toISOString()),
      AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    );
    const rows = response.data?.EVM?.Calls ?? [];
    for (const row of rows) {
      if (signal.aborted) break;
      await saveLaunchCall(row);
      recovered += 1;
    }
  }
  console.log(`Launch metadata recovery replayed ${recovered} calls across ${windows.size} historical windows`);
  return recovered;
}
