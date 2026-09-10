import { createServer } from "node:http";
import type { Client } from "graphql-ws";
import { config } from "./config.js";
import { createBitqueryClient, getAccessToken } from "./bitquery.js";
import { runHolderCollector } from "./holders.js";
import { CURVE_TRADES, LAUNCH_ACTIVITY, MARKET_TRADES } from "./queries.js";
import { saveFactoryEvent, saveLaunchCall, saveMarketTrade, saveTrade, updateStreamStatus, warmTokenCache } from "./store.js";

let healthy = false;
let connectedAt: string | null = null;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function warmCacheUntilReady(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      await warmTokenCache();
      return;
    } catch (error) {
      if (!signal.aborted) console.error("Token cache warmup failed", error);
      await delay(10_000);
    }
  }
}

function subscribe(
  client: Client,
  feed: string,
  query: string,
  handler: (row: never, collection: string) => Promise<void>,
) {
  client.subscribe({ query }, {
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

async function recordingCycle() {
  const auth = await getAccessToken();
  const collectorAbort = new AbortController();
  const cacheWarmup = warmCacheUntilReady(collectorAbort.signal);
  const client = createBitqueryClient(auth.access_token, () => {
    healthy = true;
    connectedAt = new Date().toISOString();
    console.log("Bitquery WebSocket connected");
  });

  subscribe(client, "launch_activity", LAUNCH_ACTIVITY, (row, collection) =>
    collection === "Events" ? saveFactoryEvent(row) : saveLaunchCall(row));
  subscribe(client, "curve_trades", CURVE_TRADES, saveTrade);
  subscribe(client, "market_trades", MARKET_TRADES, saveMarketTrade);
  const holderCollector = runHolderCollector(auth.access_token, collectorAbort.signal);

  const refreshAfter = Math.max(60, auth.expires_in - 120) * 1_000;
  await delay(refreshAfter);
  healthy = false;
  collectorAbort.abort();
  await holderCollector;
  await cacheWarmup;
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
