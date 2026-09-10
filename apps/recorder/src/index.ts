import { createServer } from "node:http";
import type { Client } from "graphql-ws";
import { config } from "./config.js";
import { createBitqueryClient, getAccessToken } from "./bitquery.js";
import { runHolderCollector } from "./holders.js";
import { marketTrades, PONS_ACTIVITY } from "./queries.js";
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
  feed: string | string[],
  query: string,
  handler: (row: never, collection: string) => Promise<void>,
) {
  const feeds = Array.isArray(feed) ? feed : [feed];
  const label = feeds.join("+");
  return client.subscribe({ query }, {
    next: async (result) => {
      try {
        const data = result.data as { EVM?: Record<string, never[]>; Trading?: Record<string, never[]> } | undefined;
        const root = data?.EVM ?? data?.Trading;
        const collections = root ? Object.entries(root) : [];
        for (const [collection, rows] of collections) {
          for (const row of rows) await handler(row as never, collection);
        }
        await Promise.all(feeds.map((name) => updateStreamStatus(name, "connected")));
      } catch (error) {
        console.error(`[${label}] processing failed`, error);
        await Promise.all(feeds.map((name) =>
          updateStreamStatus(name, "error", error instanceof Error ? error.message : String(error))));
      }
    },
    error: async (error) => {
      console.error(`[${label}] subscription error`, error);
      await Promise.all(feeds.map((name) => updateStreamStatus(name, "error", JSON.stringify(error))));
    },
    complete: () => console.log(`[${label}] subscription completed`),
  });
}

function createPoolFeedController(client: Client, signal: AbortSignal) {
  let disposeMarketFeed = subscribe(client, "market_trades", marketTrades([]), saveMarketTrade);
  let addressSignature = "";
  let refreshQueue = Promise.resolve();

  const refresh = () => {
    refreshQueue = refreshQueue.then(async () => {
      if (signal.aborted) return;
      const addresses = await getActiveMarketTokens();
      const nextSignature = addresses.join(",");
      if (nextSignature === addressSignature) return;

      disposeMarketFeed();
      disposeMarketFeed = subscribe(client, "market_trades", marketTrades(addresses), saveMarketTrade);
      addressSignature = nextSignature;
      console.log(`Market feed tracking ${addresses.length} Pons tokens in one filtered stream`);
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
      disposeMarketFeed();
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

  subscribe(client, ["launch_activity", "curve_trades"], PONS_ACTIVITY, async (row, collection) => {
    if (collection === "Calls") return saveLaunchCall(row);
    if (collection === "CurveEvents") return saveTrade(row);
    await saveFactoryEvent(row);
    const event = row as { Log?: { Signature?: { Name?: string } } };
    if (event.Log?.Signature?.Name === "PoolGraduated") await poolFeeds.refresh();
  });
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
