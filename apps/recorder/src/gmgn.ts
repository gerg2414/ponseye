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

export type GmgnShadowToken = {
  tokenAddress: string;
  category: "new_creation" | "near_completion" | "completed";
  launchpadPlatform: string | null;
  launchedAt: string | null;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  creatorAddress: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  progress: number | null;
  holderCount: number | null;
  rawToken: Record<string, unknown>;
};

const ADDRESS = /^0x[0-9a-f]{40}$/;

async function runGmgn(apiKey: string, args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, GMGN_API_KEY: apiKey },
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout) as unknown;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown) {
  const seconds = number(value);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeCategory(key: string): GmgnShadowToken["category"] | null {
  if (key === "new_creation") return "new_creation";
  if (key === "pump" || key === "near_completion") return "near_completion";
  if (key === "completed") return "completed";
  return null;
}

function categoryFromToken(row: Record<string, unknown>): GmgnShadowToken["category"] {
  const progress = number(row.progress);
  const completeTimestamp = number(row.complete_timestamp);
  const launchpadStatus = number(row.launchpad_status);
  if ((completeTimestamp ?? 0) > 0 || launchpadStatus === 1 || (progress ?? 0) >= 1) return "completed";
  if ((progress ?? 0) >= 0.8) return "near_completion";
  return "new_creation";
}

function parseSearchToken(response: unknown, tokenAddress: string): GmgnShadowToken | null {
  const envelope = object(response);
  if (number(envelope?.code) !== 0) {
    throw new Error(text(envelope?.message) ?? "GMGN search returned an unsuccessful response");
  }
  const coins = object(envelope?.data)?.coins;
  if (!Array.isArray(coins)) return null;

  const address = tokenAddress.toLowerCase();
  const row = coins
    .map(object)
    .find((coin) => text(coin?.chain)?.toLowerCase() === "robinhood"
      && text(coin?.address)?.toLowerCase() === address);
  if (!row) return null;

  return {
    tokenAddress: address,
    category: categoryFromToken(row),
    launchpadPlatform: text(row.launchpad_platform ?? row.launchpad),
    launchedAt: timestamp(row.created_timestamp ?? row.created_at),
    name: text(row.name),
    symbol: text(row.symbol),
    imageUrl: text(row.logo),
    creatorAddress: text(row.creator)?.toLowerCase() ?? null,
    priceUsd: number(row.price),
    marketCapUsd: number(row.mcp ?? row.usd_market_cap ?? row.market_cap),
    liquidityUsd: number(row.liquidity),
    progress: number(row.progress),
    holderCount: number(row.holder_count),
    rawToken: row,
  };
}

export function parseGmgnTrenches(response: unknown): GmgnShadowToken[] {
  const envelope = object(response);
  const root = object(envelope?.data) ?? envelope;
  if (!root) throw new Error("GMGN trenches response was not an object");

  const tokens = new Map<string, GmgnShadowToken>();
  for (const [key, value] of Object.entries(root)) {
    const category = normalizeCategory(key);
    if (!category || !Array.isArray(value)) continue;
    for (const item of value) {
      const row = object(item);
      const tokenAddress = text(row?.address)?.toLowerCase() ?? "";
      if (!row || !ADDRESS.test(tokenAddress)) continue;

      const platform = text(row.launchpad_platform);
      if (platform && !platform.toLowerCase().includes("pons")) continue;

      tokens.set(tokenAddress, {
        tokenAddress,
        category,
        launchpadPlatform: platform,
        launchedAt: timestamp(row.created_timestamp ?? row.creation_timestamp),
        name: text(row.name),
        symbol: text(row.symbol),
        imageUrl: text(row.logo),
        creatorAddress: text(row.creator)?.toLowerCase() ?? null,
        priceUsd: number(row.price),
        marketCapUsd: number(row.usd_market_cap ?? row.market_cap),
        liquidityUsd: number(row.liquidity),
        progress: number(row.progress),
        holderCount: number(row.holder_count),
        rawToken: row,
      });
    }
  }
  return [...tokens.values()];
}

export async function verifyGmgnReadAccess(apiKey: string) {
  const result = await runGmgn(apiKey, [
    "market",
    "trending",
    "--chain",
    "robinhood",
    "--interval",
    "1h",
    "--limit",
    "1",
  ]) as GmgnResponse;
  if (result.code !== 0) {
    throw new Error(result.message || "GMGN returned an unsuccessful response");
  }

  return result.data?.rank?.[0]?.symbol ?? null;
}

export async function getGmgnShadowTokens(apiKey: string) {
  const response = await runGmgn(apiKey, [
    "market",
    "trenches",
    "--chain",
    "robinhood",
    "--type",
    "new_creation",
    "--type",
    "near_completion",
    "--type",
    "completed",
    "--launchpad-platform",
    "pons",
    "--limit",
    "80",
    "--raw",
  ]);
  return parseGmgnTrenches(response);
}

export async function getGmgnTokenByAddress(apiKey: string, tokenAddress: string) {
  if (!ADDRESS.test(tokenAddress)) throw new Error("Invalid GMGN search token address");
  const response = await runGmgn(apiKey, [
    "market",
    "search",
    "--query",
    tokenAddress,
    "--chain",
    "robinhood",
    "--raw",
  ]);
  return parseSearchToken(response, tokenAddress);
}
