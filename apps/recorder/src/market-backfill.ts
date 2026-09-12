import { queryBitquery } from "./bitquery.js";
import { marketTradeHistory } from "./queries.js";
import {
  getMarketBackfillCandidate,
  getMarketBackfillCandidates,
  saveMarketTrades,
  type MarketBackfillCandidate,
  type MarketTradeRow,
} from "./store.js";

type MarketHistoryResponse = {
  data?: { Trading?: { Trades?: MarketTradeRow[] } };
};

const WINDOW_MS = 15 * 60_000;
const completed = new Set<string>();
const running = new Map<string, Promise<number>>();

async function backfillCandidate(accessToken: string, candidate: MarketBackfillCandidate, signal: AbortSignal) {
  if (completed.has(candidate.token_address)) return 0;
  const existing = running.get(candidate.token_address);
  if (existing) return existing;

  const task = (async () => {
    let stored = 0;
    let cursor = new Date(candidate.launched_at).getTime() - 5_000;
    const finish = Date.now();

    while (!signal.aborted && cursor < finish) {
      const windowEnd = Math.min(finish, cursor + WINDOW_MS);
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      const response = await queryBitquery<MarketHistoryResponse>(
        accessToken,
        marketTradeHistory(candidate.token_address, new Date(cursor).toISOString(), new Date(windowEnd).toISOString()),
        requestSignal,
      );
      const rows = response.data?.Trading?.Trades ?? [];
      if (rows.length >= 5_000) {
        console.warn(`Market history window reached its limit for ${candidate.token_address}`);
      }
      stored += await saveMarketTrades(rows);
      cursor = windowEnd + 1;
    }

    if (!signal.aborted) completed.add(candidate.token_address);
    console.log(`Market history backfill stored ${stored} rows for ${candidate.token_address}`);
    return stored;
  })().finally(() => running.delete(candidate.token_address));

  running.set(candidate.token_address, task);
  return task;
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
