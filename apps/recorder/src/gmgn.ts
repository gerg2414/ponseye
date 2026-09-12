import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const cliPath = join(dirname(require.resolve("gmgn-cli/package.json")), "dist", "index.js");

type GmgnResponse = {
  code?: number;
  message?: string;
  data?: { rank?: Array<{ symbol?: string }> };
};

export async function verifyGmgnReadAccess(apiKey: string) {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "market",
    "trending",
    "--chain",
    "robinhood",
    "--interval",
    "1h",
    "--limit",
    "1",
  ], {
    env: { ...process.env, GMGN_API_KEY: apiKey },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });

  const result = JSON.parse(stdout) as GmgnResponse;
  if (result.code !== 0) {
    throw new Error(result.message || "GMGN returned an unsuccessful response");
  }

  return result.data?.rank?.[0]?.symbol ?? null;
}
