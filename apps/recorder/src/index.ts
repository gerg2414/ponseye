import { createServer } from "node:http";
import type { Client } from "graphql-ws";
import { config } from "./config.js";
import { createBitqueryClient, getAccessToken } from "./bitquery.js";
import { runHolderCollector } from "./holders.js";
import { CURVE_MARKET_TRADES, CURVE_TRADES, LAUNCH_ACTIVITY, poolMarketTrades } from "./queries.js";
import { getActiveMarketTokens, saveFactoryEvent, saveLaunchCall, saveMarketTrade, saveTrade, updateStreamStatus } from "./store.js";

let healthy = false;
let connectedAt: string | null = null;

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
  feed: string,
  query: string,
  handler: (row: never, collection: string) => Promise<void>,
) {
  return client.subscribe({ query }, {
    next: async (result) => {
      try {
        const data = result.data as { EVM?: Record<string, never[]>; Trading?: Record<string, never[]> } | undefined;
        const root = data?.EVM ?? data?.Trading;
        const collections = root ? Object.entries(root) : [];
        for (const [collection, rows] of collections) {
          for (const row of rows) await handler(row as never, collection);
        }
        await updateStreamStatus(feed, "connected");
      } catch (error) {
        console.error(`[${feed}] processing failed`, error);
        await updateStreamStatus(feed, "error", error instanceof Error ? error.message : String(error));
      }
    },
    error: async (error) => {
      console.error(`[${feed}] subscription error`, error);
      await updateStreamStatus(feed, "error", JSON.stringify(error));
    },
    complete: () => console.log(`[${feed}] subscription completed`),
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size));
}

function createPoolFeedController(client: Client, signal: AbortSignal) {
  let disposers: Array<() => void> = [];
  let addressSignature = "";
  let refreshQueue = Promise.resolve();

  const refresh = () => {
    refreshQueue = refreshQueue.then(async () => {
      if (signal.aborted) return;
      const addresses = await getActiveMarketTokens();
      const nextSignature = addresses.join(",");
      if (nextSignature === addressSignature) return;

      for (const dispose of disposers) dispose();
      disposers = chunks(addresses, 100).map((batch) =>
        subscribe(client, "market_trades", poolMarketTrades(batch), saveMarketTrade));
      addressSignature = nextSignature;
      console.log(`Pool market feed tracking ${addresses.length} Pons tokens across ${disposers.length} filtered streams`);
    }).catch(async (error) => {
      console.error("Pool market feed refresh failed", error);
      await updateStreamStatus("market_trades", "error", error instanceof Error ? error.message : String(error));
    });
    return refreshQueue;
  };

  const maintenance = (async () => {
    await refresh();
    while (!signal.aborted) {
      await delayOrAbort(addressSignature ? 5 * 60_000 : 10_000, signal);
      if (!signal.aborted) await refresh();
    }
  })();

  return {
    refresh,
    async stop() {
      await refreshQueue;
      for (const dispose of disposers) dispose();
      disposers = [];
      await maintenance;
    },
  };
}

async function recordingCycle() {
  const auth = await getAccessToken();
  const collectorAbort = new AbortController();
  const client = createBitqueryClient(auth.access_token, () => {
    healthy = true;
    connectedAt = new Date().toISOString();
    console.log("Bitquery WebSocket connected");
  });
  const poolFeeds = createPoolFeedController(client, collectorAbort.signal);

  subscribe(client, "launch_activity", LAUNCH_ACTIVITY, async (row, collection) => {
    if (collection !== "Events") return saveLaunchCall(row);
    await saveFactoryEvent(row);
    const event = row as { Log?: { Signature?: { Name?: string } } };
    if (event.Log?.Signature?.Name === "PoolGraduated") await poolFeeds.refresh();
  });
  subscribe(client, "curve_trades", CURVE_TRADES, saveTrade);
  subscribe(client, "market_trades", CURVE_MARKET_TRADES, saveMarketTrade);
  const holderCollector = runHolderCollector(auth.access_token, collectorAbort.signal);

  const refreshAfter = Math.max(60, auth.expires_in - 120) * 1_000;
  await delay(refreshAfter);
  healthy = false;
  collectorAbort.abort();
  await holderCollector;
  await poolFeeds.stop();
  await client.dispose();
}

async function main() {
  createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ healthy, connectedAt }));
  }).listen(config.PORT, "0.0.0.0", () => console.log(`Health server listening on ${config.PORT}`));

  while (true) {
    try {
      await recordingCycle();
    } catch (error) {
      healthy = false;
      console.error("Recorder cycle failed", error);
      await delay(10_000);
    }
  }
}

void main();
