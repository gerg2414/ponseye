import { createServer } from "node:http";
import { config } from "./config.js";
import { runBitqueryMigrationTest } from "./bitquery-migration-test.js";
import { fetchOneMinuteCandles, fetchPonsTrenches } from "./gmgn.js";
import { getNextCandleCandidate, getRecorderEnabled, saveCandles, saveTrenches, setGmgnStatus } from "./gmgn-store.js";

type RecorderMode = "stopped" | "starting" | "recording" | "error";

let healthy = true;
let recorderMode: RecorderMode = "stopped";
let connectedAt: string | null = null;
let lastGmgnRequestAt: string | null = null;
let lastError: string | null = null;
let pauseReported = false;

const traffic = {
  discoveryRequests: 0,
  tokensReceived: 0,
  snapshotsStored: 0,
  candleRequests: 0,
  candlesStored: 0,
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function stopRecorder(message = "GMGN recorder is intentionally disabled") {
  recorderMode = "stopped";
  connectedAt = null;
  healthy = true;
  if (!pauseReported) {
    await setGmgnStatus("stopped", message);
    pauseReported = true;
  }
}

async function recordingCycle() {
  pauseReported = false;
  recorderMode = "starting";
  await setGmgnStatus("connecting", "Connecting to GMGN OpenAPI");
  let nextDiscoveryAt = 0;
  let nextKlineAt = 0;

  while (await getRecorderEnabled()) {
    const now = Date.now();
    try {
      if (now >= nextDiscoveryAt) {
        const tokens = await fetchPonsTrenches();
        lastGmgnRequestAt = new Date().toISOString();
        traffic.discoveryRequests += 1;
        traffic.tokensReceived += tokens.length;
        traffic.snapshotsStored += await saveTrenches(tokens);
        nextDiscoveryAt = Date.now() + config.GMGN_DISCOVERY_INTERVAL_MS;
        healthy = true;
        recorderMode = "recording";
        connectedAt ??= lastGmgnRequestAt;
        lastError = null;
        await setGmgnStatus("connected", `Tracking ${tokens.length} migrated PONS tokens from GMGN`);
        continue;
      }

      if (now >= nextKlineAt) {
        const candidate = await getNextCandleCandidate();
        if (candidate) {
          const now = new Date();
          const migrationTime = Date.parse(candidate.completed_at ?? candidate.created_at);
          const latestCandleTime = Date.parse(candidate.latest_candle_at ?? "");
          const earliestAvailable = now.getTime() - 24 * 60 * 60_000;
          const from = new Date(Math.max(
            Number.isFinite(migrationTime) ? migrationTime : earliestAvailable,
            earliestAvailable,
            Number.isFinite(latestCandleTime) ? latestCandleTime - 2 * 60_000 : 0,
          ));
          const to = new Date(Math.min(now.getTime(), from.getTime() + 99 * 60_000));
          const candles = await fetchOneMinuteCandles(candidate.token_address, from, to);
          lastGmgnRequestAt = new Date().toISOString();
          traffic.candleRequests += 1;
          traffic.candlesStored += candles.length;
          await saveCandles(candidate.token_address, candles);
        }
        nextKlineAt = Date.now() + config.GMGN_KLINE_INTERVAL_MS;
        continue;
      }
    } catch (error) {
      lastError = errorMessage(error);
      recorderMode = "error";
      healthy = false;
      console.error("GMGN collection failed", error);
      await setGmgnStatus("error", lastError);
      await delay(10_000);
      nextDiscoveryAt = 0;
    }
    await delay(500);
  }
  await stopRecorder();
}

async function main() {
  createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({
      healthy,
      recorderMode,
      source: "gmgn",
      connectedAt,
      lastGmgnRequestAt,
      lastError,
      traffic,
    }));
  }).listen(config.PORT, "0.0.0.0", () => console.log(`GMGN recorder health server listening on ${config.PORT}`));

  void runBitqueryMigrationTest().catch((error) => {
    console.error("Bitquery migration test stopped", error);
  });

  while (true) {
    try {
      if (!await getRecorderEnabled()) {
        await stopRecorder();
        await delay(2_000);
        continue;
      }
      await recordingCycle();
    } catch (error) {
      healthy = false;
      recorderMode = "error";
      lastError = errorMessage(error);
      console.error("GMGN recorder cycle failed", error);
      await setGmgnStatus("error", lastError).catch(() => undefined);
      await delay(10_000);
    }
  }
}

void main();
