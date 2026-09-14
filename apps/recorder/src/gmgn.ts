import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REQUEST_GAP_MS = 1_100;
let requestQueue = Promise.resolve();
let lastRequestStartedAt = 0;

export type GmgnLifecycleStage = "new_creation" | "near_completion" | "completed";
export type GmgnToken = Record<string, unknown> & { lifecycle_stage: GmgnLifecycleStage };

export type GmgnCandle = {
  candleAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asIsoTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  const numeric = asNumber(value);
  const milliseconds = numeric == null
    ? Date.parse(String(value))
    : numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

async function runRawJson(args: string[]) {
  const run = requestQueue.then(async () => {
    const waitMs = Math.max(0, lastRequestStartedAt + REQUEST_GAP_MS - Date.now());
    if (waitMs) await delay(waitMs);
    lastRequestStartedAt = Date.now();
    const { stdout } = await execFileAsync("gmgn-cli", [...args, "--raw"], {
      env: process.env,
      timeout: 30_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout.trim()) as unknown;
  });
  requestQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function fetchPonsTrenches(): Promise<GmgnToken[]> {
  const response = await runRawJson([
    "market", "trenches",
    "--chain", "robinhood",
    "--type", "completed",
    "--launchpad-platform", "pons",
    "--limit", "80",
  ]);
  const root = asObject(response);
  const data = asObject(root.data ?? response);
  const categories: Array<[string, GmgnLifecycleStage]> = [["completed", "completed"]];
  const tokens = new Map<string, GmgnToken>();

  for (const [key, lifecycleStage] of categories) {
    const rows = Array.isArray(data[key]) ? data[key] as unknown[] : [];
    for (const row of rows) {
      const token = asObject(row);
      const address = String(token.address ?? token.token_address ?? "").toLowerCase();
      if (!address) continue;
      tokens.set(address, { ...token, address, lifecycle_stage: lifecycleStage });
    }
  }
  return [...tokens.values()];
}

export async function fetchTokenInfo(tokenAddress: string) {
  const response = await runRawJson([
    "token", "info",
    "--chain", "robinhood",
    "--address", tokenAddress,
  ]);
  const root = asObject(response);
  return asObject(root.data ?? response);
}

export async function fetchOneMinuteCandles(tokenAddress: string, from: Date, to: Date) {
  const response = await runRawJson([
    "market", "kline",
    "--chain", "robinhood",
    "--address", tokenAddress,
    "--resolution", "1m",
    "--from", String(Math.floor(from.getTime() / 1_000)),
    "--to", String(Math.floor(to.getTime() / 1_000)),
  ]);
  const root = asObject(response);
  const data = root.data ?? response;
  const dataObject = asObject(data);
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(dataObject.list)
      ? dataObject.list
      : Array.isArray(dataObject.kline)
        ? dataObject.kline
        : Array.isArray(dataObject.candles)
          ? dataObject.candles
          : [];

  return rows.flatMap((value): GmgnCandle[] => {
    if (Array.isArray(value)) {
      const candleAt = asIsoTime(value[0]);
      const open = asNumber(value[1]);
      const high = asNumber(value[2]);
      const low = asNumber(value[3]);
      const close = asNumber(value[4]);
      if (!candleAt || open == null || high == null || low == null || close == null) return [];
      return [{ candleAt, open, high, low, close, volume: asNumber(value[5]) }];
    }
    const row = asObject(value);
    const candleAt = asIsoTime(row.time ?? row.timestamp ?? row.t);
    const open = asNumber(row.open ?? row.o);
    const high = asNumber(row.high ?? row.h);
    const low = asNumber(row.low ?? row.l);
    const close = asNumber(row.close ?? row.c);
    if (!candleAt || open == null || high == null || low == null || close == null) return [];
    return [{ candleAt, open, high, low, close, volume: asNumber(row.volume ?? row.v) }];
  });
}
