import { createServer } from "node:http";
import { runBitqueryMigrationTest, stopBitqueryMigrationTest } from "./bitquery-migration-test.js";
import { config } from "./config.js";

type RecorderMode = "stopped" | "starting" | "recording" | "error" | "draining";

let healthy = true;
let recorderMode: RecorderMode = config.BITQUERY_MIGRATION_TEST_ENABLED ? "starting" : "stopped";
let connectedAt: string | null = null;
let lastError: string | null = null;

const server = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
  response.end(JSON.stringify({
    healthy,
    recorderMode,
    source: "bitquery-migration-test",
    connectedAt,
    lastError,
    backfillHours: config.BITQUERY_BACKFILL_HOURS,
    trackingWindowHours: config.BITQUERY_TRACKING_WINDOW_HOURS,
  }));
});

server.listen(config.PORT, "0.0.0.0", () => {
  console.log(`Bitquery migration recorder listening on ${config.PORT}`);
});

const recorder = config.BITQUERY_MIGRATION_TEST_ENABLED
  ? (() => {
    recorderMode = "recording";
    connectedAt = new Date().toISOString();
    return runBitqueryMigrationTest().catch((error: unknown) => {
      healthy = false;
      recorderMode = "error";
      lastError = error instanceof Error ? error.message : String(error);
      console.error("Bitquery migration recorder stopped", error);
    });
  })()
  : Promise.resolve(console.warn("Bitquery migration recorder is disabled"));

// Railway sends SIGTERM on every redeploy. Without this the process is killed
// mid-write, losing whatever the stream had buffered and leaving the status row
// claiming the feed is still connected.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    recorderMode = "draining";
    console.log(`${signal} received, finishing in-flight Bitquery work`);

    stopBitqueryMigrationTest();
    server.close();

    const forceExit = setTimeout(() => {
      console.warn("Shutdown timed out, exiting anyway");
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    void recorder.then(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}
