import { createServer } from "node:http";
import { runBitqueryMigrationTest } from "./bitquery-migration-test.js";
import { config } from "./config.js";

type RecorderMode = "stopped" | "starting" | "recording" | "error";

let healthy = true;
let recorderMode: RecorderMode = config.BITQUERY_MIGRATION_TEST_ENABLED ? "starting" : "stopped";
let connectedAt: string | null = null;
let lastError: string | null = null;

createServer((request, response) => {
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
  }));
}).listen(config.PORT, "0.0.0.0", () => console.log(`Bitquery migration recorder listening on ${config.PORT}`));

if (config.BITQUERY_MIGRATION_TEST_ENABLED) {
  recorderMode = "recording";
  connectedAt = new Date().toISOString();
  void runBitqueryMigrationTest().catch((error) => {
    healthy = false;
    recorderMode = "error";
    lastError = error instanceof Error ? error.message : String(error);
    console.error("Bitquery migration recorder stopped", error);
  });
} else {
  console.warn("Bitquery migration recorder is disabled");
}
