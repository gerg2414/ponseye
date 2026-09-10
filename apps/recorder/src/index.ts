import { createServer } from "node:http";
import type { Client } from "graphql-ws";
import { config } from "./config.js";
import { createBitqueryClient, getAccessToken } from "./bitquery.js";
import { CURVE_TRADES, LAUNCH_ACTIVITY } from "./queries.js";
import { saveFactoryEvent, saveLaunchCall, saveTrade, updateStreamStatus } from "./store.js";

let healthy = false;
let connectedAt: string | null = null;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function subscribe(
  client: Client,
  feed: string,
  query: string,
  handler: (row: never, collection: string) => Promise<void>,
) {
  client.subscribe({ query }, {
    next: async (result) => {
      try {
        const evm = (result.data as { EVM?: Record<string, never[]> } | undefined)?.EVM;
        const collections = evm ? Object.entries(evm) : [];
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
  const client = createBitqueryClient(auth.access_token, () => {
    healthy = true;
    connectedAt = new Date().toISOString();
    console.log("Bitquery WebSocket connected");
  });

  subscribe(client, "launch_activity", LAUNCH_ACTIVITY, (row, collection) =>
    collection === "Events" ? saveFactoryEvent(row) : saveLaunchCall(row));
  subscribe(client, "curve_trades", CURVE_TRADES, saveTrade);

  const refreshAfter = Math.max(60, auth.expires_in - 120) * 1_000;
  await delay(refreshAfter);
  healthy = false;
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
