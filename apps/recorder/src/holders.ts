import { queryBitquery } from "./bitquery.js";
import {
  getHolderCandidates,
  saveHolderSnapshot,
  updateStreamStatus,
  type HolderCandidate,
  type HolderPosition,
} from "./store.js";

const PONS_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const PONS_LOCKER = "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
const PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const PONS_SUPPLY = 1_000_000_000;

type HolderRow = {
  Holder?: { Address?: string };
  Balance?: {
    Amount?: string | number;
    FirstChangeTime?: string;
    LastChangeTime?: string;
    UpdateCount?: string | number;
  };
};

type HolderResponse = {
  data?: {
    EVM?: {
      holderStats?: Array<{ holders?: string | number; total?: string | number }>;
      topHolders?: HolderRow[];
      creatorHolder?: HolderRow[];
    };
  };
};

const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

function safeAddress(value: string) {
  const address = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`Invalid address ${value}`);
  return address;
}

function holderQuery(candidate: HolderCandidate) {
  const token = safeAddress(candidate.token_address);
  const creator = safeAddress(candidate.deployer_address);
  const excluded = [
    safeAddress(candidate.curve_address),
    PONS_POOL_MANAGER,
    PONS_LOCKER,
    PONS_HOOK,
    ZERO_ADDRESS,
    DEAD_ADDRESS,
  ].map((address) => `"${address}"`).join(",");

  return `
    query PonsEyeHolders {
      EVM(network: robinhood) {
        holderStats: Holders(where: {
          Currency: {SmartContract: {is: "${token}"}}
          Balance: {Amount: {gt: "0"}}
          Holder: {Address: {notIn: [${excluded}]}}
        }) {
          holders: count
          total: sum(of: Balance_Amount)
        }
        topHolders: Holders(
          limit: {count: 100}
          orderBy: {descending: Balance_Amount}
          where: {
            Currency: {SmartContract: {is: "${token}"}}
            Balance: {Amount: {gt: "0"}}
            Holder: {Address: {notIn: [${excluded}]}}
          }
        ) {
          Holder { Address }
          Balance { Amount FirstChangeTime LastChangeTime UpdateCount }
        }
        creatorHolder: Holders(
          limit: {count: 1}
          where: {
            Currency: {SmartContract: {is: "${token}"}}
            Balance: {Amount: {gt: "0"}}
            Holder: {Address: {is: "${creator}"}}
          }
        ) {
          Holder { Address }
          Balance { Amount }
        }
      }
    }
  `;
}

function numberValue(value: string | number | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 10_000) / 100 : null;
}

function due(candidate: HolderCandidate, now: number) {
  if (!candidate.last_trade_at) return false;
  const launchedAt = new Date(candidate.launched_at).getTime();
  const lastTradeAt = candidate.last_trade_at ? new Date(candidate.last_trade_at).getTime() : launchedAt;
  const lastSnapshotAt = candidate.holder_snapshot_at ? new Date(candidate.holder_snapshot_at).getTime() : 0;
  const launchAge = now - launchedAt;
  const tradeAge = now - lastTradeAt;

  if (launchAge > 60 * 60_000 && tradeAge > 60 * 60_000) return false;
  const interval = launchAge <= 15 * 60_000
    ? 5 * 60_000
    : tradeAge <= 15 * 60_000
      ? 10 * 60_000
      : 30 * 60_000;
  return now - lastSnapshotAt >= interval;
}

async function collectOne(accessToken: string, candidate: HolderCandidate, signal: AbortSignal) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const response = await queryBitquery<HolderResponse>(accessToken, holderQuery(candidate), requestSignal);
  const evm = response.data?.EVM;
  const stats = evm?.holderStats?.[0];
  const total = numberValue(stats?.total);
  const topRows = evm?.topHolders ?? [];
  const balances = topRows.map((row) => numberValue(row.Balance?.Amount));
  const creatorBalance = numberValue(evm?.creatorHolder?.[0]?.Balance?.Amount);
  const observedAt = new Date().toISOString();

  const positions = topRows.slice(0, 20).flatMap<HolderPosition>((row, index) => {
    const address = row.Holder?.Address?.toLowerCase();
    const balance = balances[index] ?? 0;
    if (!address || !/^0x[0-9a-f]{40}$/.test(address) || balance <= 0) return [];
    return [{
      holderAddress: address,
      balance,
      balancePct: percentage(balance, total),
      rank: index + 1,
      firstChangeAt: row.Balance?.FirstChangeTime ?? null,
      lastChangeAt: row.Balance?.LastChangeTime ?? null,
      updateCount: row.Balance?.UpdateCount == null ? null : numberValue(row.Balance.UpdateCount),
    }];
  });

  await saveHolderSnapshot({
    tokenAddress: candidate.token_address,
    observedAt,
    holderCount: Math.max(0, Math.trunc(numberValue(stats?.holders))),
    totalHolderBalance: total,
    largestHolderPct: percentage(balances[0] ?? 0, total),
    top10HolderPct: percentage(balances.slice(0, 10).reduce((sum, value) => sum + value, 0), total),
    top100HolderPct: percentage(balances.reduce((sum, value) => sum + value, 0), total),
    creatorBalancePct: percentage(creatorBalance, PONS_SUPPLY),
    positions,
    rawMetrics: response,
  });
}

export async function runHolderCollector(accessToken: string, signal: AbortSignal) {
  await updateStreamStatus("holder_snapshots", "connecting");

  while (!signal.aborted) {
    try {
      const now = Date.now();
      const dueCandidates = (await getHolderCandidates()).filter((candidate) => due(candidate, now));
      const repeats = dueCandidates
        .filter((candidate) => candidate.holder_snapshot_at)
        .sort((a, b) => new Date(b.last_trade_at!).getTime() - new Date(a.last_trade_at!).getTime());
      const firstSnapshots = dueCandidates
        .filter((candidate) => !candidate.holder_snapshot_at)
        .sort((a, b) => new Date(b.last_trade_at!).getTime() - new Date(a.last_trade_at!).getTime());
      const repeatBatch = repeats.slice(0, 12);
      const firstBatch = firstSnapshots.slice(0, 12);
      const candidates = Array.from({ length: Math.max(repeatBatch.length, firstBatch.length) })
        .flatMap((_, index) => [repeatBatch[index], firstBatch[index]])
        .filter((candidate): candidate is HolderCandidate => Boolean(candidate));

      let rateLimited = false;
      for (let index = 0; index < candidates.length; index += 4) {
        if (signal.aborted) break;
        const batch = candidates.slice(index, index + 4);
        const results = await Promise.allSettled(batch.map((candidate) => collectOne(accessToken, candidate, signal)));
        results.forEach((result, resultIndex) => {
          if (result.status === "rejected" && !signal.aborted) {
            console.error(`[holder_snapshots] ${batch[resultIndex].token_address} failed`, result.reason);
            if (result.reason instanceof Error && result.reason.message.includes("429")) rateLimited = true;
          }
        });
        if (rateLimited) break;
        if (index + 4 < candidates.length) await delay(3_000, signal);
      }

      if (!signal.aborted) await updateStreamStatus("holder_snapshots", "connected");
      await delay(rateLimited ? 30_000 : 10_000, signal);
    } catch (error) {
      if (!signal.aborted) {
        console.error("[holder_snapshots] cycle failed", error);
        await updateStreamStatus("holder_snapshots", "error", error instanceof Error ? error.message : String(error));
      }
    }
  }
}
