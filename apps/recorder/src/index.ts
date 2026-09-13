import { createServer } from "node:http";
import type { Client } from "graphql-ws";
import { config } from "./config.js";
import { createBitqueryClient, getAccessToken } from "./bitquery.js";
import { recoverCurveTrades } from "./curve-backfill.js";
import { runHolderCollector } from "./holders.js";
import { recoverMissingLaunchMetadata, recoverRecentLaunches } from "./launch-backfill.js";
import { backfillGraduatedToken, runCompleteMarketHistoryRepair } from "./market-backfill.js";
import { marketTrades, PONS_CURVE_ACTIVITY, PONS_LAUNCH_ACTIVITY } from "./queries.js";
import { getActiveMarketTokens, getLatestCurveTradeTime, getRecorderEnabled, getStreamStatus, markRecorderPaused, rebuildPeakMetricsForTokens, saveFactoryEvent, saveLaunchCall, saveMarketTrades, saveTrades, updateStreamStatus, type EventRow, type MarketTradeRow } from "./store.js";

let healthy = false;
let connectedAt: string | null = null;
const SOURCE_PRICE_REPAIR_FEED = "source_price_history_v11";
const SOURCE_PRICE_REPAIR_TOKENS = [
  "0xd9bb2ea3eb72eafeac18456c6435ad612337d4cf",
  "0x46b6995b02b1e3afa39033243999e00d739615f1",
];
let recorderMode: "paused" | "starting" | "recording" | "reconnecting" = "paused";
let pauseReported = false;
const traffic = {
  launchRows: 0,
  factoryRows: 0,
  curveRowsReceived: 0,
  curveRowsStored: 0,
  marketRowsReceived: 0,
  marketRowsStored: 0,
  subscriptionRestarts: 0,
};
const sourceTimes = {
  curve: null as string | null,
  market: null as string | null,
};

type BatchStatus = { status: string; message?: string } | void;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function delayOrAbort(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function subscribe(
  client: Client,
  feed: string | string[],
  query: string,
  handler: (rows: never[], collection: string) => Promise<BatchStatus>,
  signal: AbortSignal,
) {
  const feeds = Array.isArray(feed) ? feed : [feed];
  const label = feeds.join("+");
  let stopped = false;
  let disposeCurrent: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let processing = Promise.resolve();
  let restartAttempt = 0;

  const reportError = async (error: unknown, context: string) => {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.error(`[${label}] ${context}`, error);
    await Promise.all(feeds.map((name) => updateStreamStatus(name, "error", message)));
  };

  const scheduleRestart = (error?: unknown) => {
    if (stopped || signal.aborted || retryTimer) return;
    if (error !== undefined) void reportError(error, "subscription error");
    traffic.subscriptionRestarts += 1;
    restartAttempt += 1;
    const retryAfter = Math.min(60_000, 5_000 * 2 ** Math.min(restartAttempt - 1, 4));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!stopped && !signal.aborted) start();
    }, retryAfter);
  };

  const start = () => {
    if (stopped || signal.aborted) return;
    void Promise.all(feeds.map((name) => updateStreamStatus(name, "connecting")));
    disposeCurrent = client.subscribe({ query }, {
      next: (result) => {
        restartAttempt = 0;
        processing = processing.then(async () => {
          const data = result.data as { EVM?: Record<string, never[]>; Trading?: Record<string, never[]> } | undefined;
          const root = data?.EVM ?? data?.Trading;
          const collections = root ? Object.entries(root) : [];
          let batchStatus: Exclude<BatchStatus, void> | undefined;
          for (const [collection, rows] of collections) {
            const nextStatus = await handler(rows, collection);
            if (nextStatus) batchStatus = nextStatus;
          }
          await Promise.all(feeds.map((name) => updateStreamStatus(
            name,
            batchStatus?.status ?? "connected",
            batchStatus?.message,
          )));
        }).catch((error) => reportError(error, "processing failed"));
      },
      error: scheduleRestart,
      complete: () => {
        if (!stopped && !signal.aborted) {
          console.warn(`[${label}] subscription completed unexpectedly`);
          scheduleRestart();
        }
      },
    });
  };

  const stop = () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    disposeCurrent?.();
    disposeCurrent = null;
  };

  signal.addEventListener("abort", stop, { once: true });
  start();
  return stop;
}

function createPoolFeedController(client: Client, signal: AbortSignal) {
  let disposeMarketFeed: (() => void) | null = null;
  let addressSignature: string | null = null;
  let refreshQueue = Promise.resolve();

  const refresh = () => {
    refreshQueue = refreshQueue.then(async () => {
      if (signal.aborted) return;
      const addresses = await getActiveMarketTokens();
      const nextSignature = addresses.join(",");
      if (nextSignature === addressSignature) return;

      disposeMarketFeed?.();
      disposeMarketFeed = addresses.length
        ? subscribe(client, "market_trades", marketTrades(addresses), async (rows) => {
          const marketRows = rows as MarketTradeRow[];
          traffic.marketRowsReceived += marketRows.length;
          traffic.marketRowsStored += await saveMarketTrades(marketRows);
          const latest = marketRows.reduce<string | null>((value, row) =>
            !value || row.Block.Time > value ? row.Block.Time : value, sourceTimes.market);
          sourceTimes.market = latest;
        }, signal)
        : null;
      addressSignature = nextSignature;
      if (!addresses.length) await updateStreamStatus("market_trades", "connected", "No active watchlist tokens");
      console.log(`Market feed tracking ${addresses.length} watched Pons tokens in one filtered stream`);
    }).catch(async (error) => {
      console.error("Pool market feed refresh failed", error);
      await updateStreamStatus("market_trades", "error", error instanceof Error ? error.message : String(error));
    });
    return refreshQueue;
  };

  const maintenance = (async () => {
    await refresh();
    while (!signal.aborted) {
      await delayOrAbort(addressSignature === null ? 10_000 : 30_000, signal);
      if (!signal.aborted) await refresh();
    }
  })();

  return {
    refresh,
    async stop() {
      await refreshQueue;
      disposeMarketFeed?.();
      await maintenance;
    },
  };
}

async function recordingCycle() {
  const auth = await getAccessToken();
  const curveRecoveryStart = await getLatestCurveTradeTime();
  const collectorAbort = new AbortController();
  const client = createBitqueryClient(auth.access_token, () => {
    healthy = true;
    recorderMode = "recording";
    connectedAt = new Date().toISOString();
    console.log("Bitquery WebSocket connected");
  });
  const poolFeeds = createPoolFeedController(client, collectorAbort.signal);

  subscribe(client, "launch_activity", PONS_LAUNCH_ACTIVITY, async (rows, collection) => {
    for (const row of rows) {
      if (collection === "Calls") {
        traffic.launchRows += 1;
        await saveLaunchCall(row);
        continue;
      }
      traffic.factoryRows += 1;
      const tokenAddress = await saveFactoryEvent(row);
      const event = row as { Log?: { Signature?: { Name?: string } } };
      if (event.Log?.Signature?.Name === "PoolGraduated") {
        await poolFeeds.refresh();
        if (tokenAddress) {
          void delayOrAbort(5_000, collectorAbort.signal)
            .then(() => backfillGraduatedToken(auth.access_token, tokenAddress, collectorAbort.signal))
            .catch((error) => console.error(`Graduation backfill failed for ${tokenAddress}`, error));
        }
      }
    }
  }, collectorAbort.signal);
  subscribe(client, "curve_trades", PONS_CURVE_ACTIVITY, async (rows) => {
    const curveRows = rows as EventRow[];
    traffic.curveRowsReceived += curveRows.length;
    traffic.curveRowsStored += await saveTrades(curveRows);
    const latest = curveRows.reduce<string | null>((value, row) =>
      !value || row.Block.Time > value ? row.Block.Time : value, sourceTimes.curve);
    sourceTimes.curve = latest;
    const lagSeconds = latest ? Math.max(0, Math.round((Date.now() - new Date(latest).getTime()) / 1_000)) : null;
    return lagSeconds != null && lagSeconds > 120
      ? { status: "lagging", message: `Processing source data ${lagSeconds}s behind live` }
      : { status: "connected" };
  }, collectorAbort.signal);
  void recoverRecentLaunches(auth.access_token, collectorAbort.signal)
    .then(() => recoverCurveTrades(auth.access_token, collectorAbort.signal, curveRecoveryStart))
    .catch((error) => console.error("Launch or curve history recovery failed", error));
  const launchHistoryRepair = (async () => {
    while (!collectorAbort.signal.aborted) {
      await delayOrAbort(10 * 60_000, collectorAbort.signal);
      if (collectorAbort.signal.aborted) break;
      try {
        await recoverRecentLaunches(auth.access_token, collectorAbort.signal);
        await recoverCurveTrades(
          auth.access_token,
          collectorAbort.signal,
          new Date(Date.now() - 12 * 60_000).toISOString(),
        );
      } catch (error) {
        console.error("Launch or curve history recovery failed", error);
      }
    }
  })();
  const holderCollector = runHolderCollector(auth.access_token, collectorAbort.signal);
  const refreshAfter = Math.max(60, auth.expires_in - 120) * 1_000;
  const pauseMonitor = (async () => {
    while (!collectorAbort.signal.aborted) {
      await delayOrAbort(2_000, collectorAbort.signal);
      if (collectorAbort.signal.aborted) return "cycle-ended" as const;
      try {
        if (!await getRecorderEnabled()) return "paused" as const;
      } catch (error) {
        console.error("Recorder control check failed", error);
      }
    }
    return "cycle-ended" as const;
  })();
  const cycleResult = await Promise.race([
    delayOrAbort(refreshAfter, collectorAbort.signal).then(() => "refresh" as const),
    pauseMonitor,
  ]);
  collectorAbort.abort();
  await holderCollector;
  await launchHistoryRepair;
  await poolFeeds.stop();
  await client.dispose();
  if (cycleResult === "paused") {
    recorderMode = "paused";
    connectedAt = null;
    await markRecorderPaused();
    pauseReported = true;
  } else {
    recorderMode = "reconnecting";
  }
}

async function main() {
  createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    const lagSeconds = (value: string | null) => value
      ? Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000))
      : null;
    response.end(JSON.stringify({
      healthy,
      recorderMode,
      connectedAt,
      traffic,
      sourceTimes,
      sourceLagSeconds: {
        curve: lagSeconds(sourceTimes.curve),
        market: lagSeconds(sourceTimes.market),
      },
    }));
  }).listen(config.PORT, "0.0.0.0", () => console.log(`Health server listening on ${config.PORT}`));

  const trafficLog = setInterval(() => console.log("Recorder traffic", traffic), 60_000);
  trafficLog.unref();

  // Complete the comparable market dataset first. Metadata recovery follows so
  // slow historical launch-call queries cannot hold up peak and rule repairs.
  void getAccessToken()
    .then(async (auth) => {
      const prior = await getStreamStatus(SOURCE_PRICE_REPAIR_FEED);
      if (prior?.status !== "completed") {
        await updateStreamStatus(SOURCE_PRICE_REPAIR_FEED, "running", "Restoring raw source prices previously removed by dust filtering");
        const repairSignal = AbortSignal.timeout(90 * 60_000);
        const stored = await runCompleteMarketHistoryRepair(auth.access_token, repairSignal, SOURCE_PRICE_REPAIR_TOKENS);
        if (repairSignal.aborted) throw new Error("Complete market history replay timed out before reaching the dataset cutoff");
        const rebuilt = await rebuildPeakMetricsForTokens(SOURCE_PRICE_REPAIR_TOKENS);
        await updateStreamStatus(SOURCE_PRICE_REPAIR_FEED, "completed", `Complete: replayed ${stored} historical market rows and rebuilt ${rebuilt} token peaks`);
      }
      await recoverMissingLaunchMetadata(auth.access_token, AbortSignal.timeout(30 * 60_000));
    })
    .catch(async (error) => {
      console.error("Paused dataset repair failed", error);
      await updateStreamStatus(SOURCE_PRICE_REPAIR_FEED, "error", error instanceof Error ? error.message : String(error));
    });

  while (true) {
    try {
      if (!await getRecorderEnabled()) {
        healthy = true;
        recorderMode = "paused";
        connectedAt = null;
        if (!pauseReported) {
          await markRecorderPaused();
          pauseReported = true;
        }
        await delay(2_000);
        continue;
      }
      pauseReported = false;
      recorderMode = "starting";
      await recordingCycle();
    } catch (error) {
      healthy = false;
      recorderMode = "reconnecting";
      console.error("Recorder cycle failed", error);
      await delay(10_000);
    }
  }
}

void main();
