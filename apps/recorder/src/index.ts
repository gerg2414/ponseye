import { createServer } from "node:http";
import type { Client } from "graphql-ws";
import { config } from "./config.js";
import { createBitqueryClient, getAccessToken } from "./bitquery.js";
import { runHolderCollector } from "./holders.js";
import { marketTrades, PONS_ACTIVITY } from "./queries.js";
import { getActiveMarketTokens, getRecorderEnabled, markRecorderPaused, saveFactoryEvent, saveLaunchCall, saveMarketTrade, saveTrade, updateStreamStatus } from "./store.js";

let healthy = false;
let connectedAt: string | null = null;
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
  handler: (row: never, collection: string) => Promise<unknown>,
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
          for (const [collection, rows] of collections) {
            for (const row of rows) await handler(row as never, collection);
          }
          await Promise.all(feeds.map((name) => updateStreamStatus(name, "connected")));
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
        ? subscribe(client, "market_trades", marketTrades(addresses), async (row) => {
          traffic.marketRowsReceived += 1;
          if (await saveMarketTrade(row)) traffic.marketRowsStored += 1;
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
  const collectorAbort = new AbortController();
  const client = createBitqueryClient(auth.access_token, () => {
    healthy = true;
    recorderMode = "recording";
    connectedAt = new Date().toISOString();
    console.log("Bitquery WebSocket connected");
  });
  const poolFeeds = createPoolFeedController(client, collectorAbort.signal);

  subscribe(client, ["launch_activity", "curve_trades"], PONS_ACTIVITY, async (row, collection) => {
    if (collection === "Calls") {
      traffic.launchRows += 1;
      return saveLaunchCall(row);
    }
    if (collection === "CurveEvents") {
      traffic.curveRowsReceived += 1;
      if (await saveTrade(row)) traffic.curveRowsStored += 1;
      return;
    }
    traffic.factoryRows += 1;
    await saveFactoryEvent(row);
    const event = row as { Log?: { Signature?: { Name?: string } } };
    if (event.Log?.Signature?.Name === "PoolGraduated") await poolFeeds.refresh();
  }, collectorAbort.signal);
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
    response.end(JSON.stringify({ healthy, recorderMode, connectedAt, traffic }));
  }).listen(config.PORT, "0.0.0.0", () => console.log(`Health server listening on ${config.PORT}`));

  const trafficLog = setInterval(() => console.log("Recorder traffic", traffic), 60_000);
  trafficLog.unref();

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
