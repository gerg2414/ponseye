import { queryBitquery } from "./bitquery.js";
import { marketTradeHistory } from "./queries.js";
import {
  getMarketBackfillCandidate,
  getMarketBackfillCandidates,
  getCompleteMarketBackfillCandidates,
  saveMarketHistoryRepair,
  saveMarketTrades,
  type MarketBackfillCandidate,
  type MarketTradeRow,
} from "./store.js";

type MarketHistoryResponse = {
  data?: { Trading?: { Trades?: MarketTradeRow[] } };
};

const WINDOW_MS = 60 * 60_000;
const completed = new Set<string>();
const running = new Map<string, Promise<number>>();

async function storeWindow(
  accessToken: string,
  tokenAddress: string,
  start: number,
  finish: number,
  signal: AbortSignal,
  repairMode = false,
): Promise<number> {
  const response = await queryBitquery<MarketHistoryResponse>(
    accessToken,
    marketTradeHistory(tokenAddress, new Date(start).toISOString(), new Date(finish).toISOString()),
    AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  );
  const rows = response.data?.Trading?.Trades ?? [];
  if (rows.length >= 5_000 && finish - start > 2_000) {
    const midpoint = Math.floor((start + finish) / 2);
    return await storeWindow(accessToken, tokenAddress, start, midpoint, signal, repairMode)
      + await storeWindow(accessToken, tokenAddress, midpoint + 1, finish, signal, repairMode);
  }
  if (rows.length >= 5_000) {
    console.warn(`Market history reached its limit inside a two second window for ${tokenAddress}`);
  }
  return repairMode ? saveMarketHistoryRepair(rows) : saveMarketTrades(rows);
}

async function backfillCandidate(
  accessToken: string,
  candidate: MarketBackfillCandidate,
  signal: AbortSignal,
  repairMode = false,
) {
  if (completed.has(candidate.token_address)) return 0;
  const existing = running.get(candidate.token_address);
  if (existing) return existing;

  const task = (async () => {
    let stored = 0;
    let cursor = new Date(candidate.launched_at).getTime() - 5_000;
    const finish = candidate.finish_at ? new Date(candidate.finish_at).getTime() : Date.now();

    while (!signal.aborted && cursor < finish) {
      const windowEnd = Math.min(finish, cursor + WINDOW_MS);
      stored += await storeWindow(accessToken, candidate.token_address, cursor, windowEnd, signal, repairMode);
      cursor = windowEnd + 1;
    }

    if (!signal.aborted) completed.add(candidate.token_address);
    console.log(`Market history backfill stored ${stored} rows for ${candidate.token_address}`);
    return stored;
  })().finally(() => running.delete(candidate.token_address));

  running.set(candidate.token_address, task);
  return task;
}

export async function runCompleteMarketHistoryRepair(accessToken: string, signal: AbortSignal) {
  const candidates = await getCompleteMarketBackfillCandidates();
  let stored = 0;
  const failures: string[] = [];
  for (const candidate of candidates) {
    if (signal.aborted) break;
    try {
      stored += await backfillCandidate(accessToken, candidate, signal, true);
    } catch (error) {
      if (!signal.aborted) {
        failures.push(candidate.token_address);
        console.error(`Complete market history failed for ${candidate.token_address}`, error);
      }
    }
  }
  if (signal.aborted) throw new Error("Complete market history replay did not reach the dataset cutoff");
  if (failures.length) throw new Error(`Complete market history failed for ${failures.length} tokens: ${failures.join(",")}`);
  console.log(`Complete market history replay stored ${stored} rows across ${candidates.length} migrated tokens`);
  return stored;
}

export async function backfillGraduatedToken(accessToken: string, tokenAddress: string, signal: AbortSignal) {
  const candidate = await getMarketBackfillCandidate(tokenAddress);
  return candidate ? backfillCandidate(accessToken, candidate, signal) : 0;
}

export async function runMarketHistoryRepair(accessToken: string, signal: AbortSignal) {
  const candidates = await getMarketBackfillCandidates();
  let stored = 0;
  for (const candidate of candidates) {
    if (signal.aborted) break;
    try {
      stored += await backfillCandidate(accessToken, candidate, signal);
    } catch (error) {
      if (!signal.aborted) console.error(`Market history backfill failed for ${candidate.token_address}`, error);
    }
  }
  console.log(`Market history repair completed with ${stored} stored rows across ${candidates.length} tokens`);
  return stored;
}
