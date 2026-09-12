import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

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
const GMGN_SITE = "https://gmgn.ai";
const GMGN_TRENCHES_WS = "wss://ws.gmgn.ai/trs_ws";
const PONSEYE_GMGN_BOOTSTRAP = "https://www.ponseye.io/api/gmgn-trenches-bootstrap";
const GMGN_WEB_VERSION = "20260912-4388-7792ac2";
const ROBINHOOD_QUOTE_TYPES = [11, 20, 24, 12, 0];
const ROBINHOOD_PONS_FILTER_HASH = "395575f86a0b53c3";
const ROBINHOOD_PONS_FALLBACK_SECTIONS: WebsiteTrenchesMeta["sections"] = [
  { category: "new_creation", filterId: `robinhood_nc_${ROBINHOOD_PONS_FILTER_HASH}`, version: "C6A488928FBEF728" },
  { category: "near_completion", filterId: `robinhood_ncp_${ROBINHOOD_PONS_FILTER_HASH}`, version: "C6A4887C86231610" },
  { category: "completed", filterId: `robinhood_cp_${ROBINHOOD_PONS_FILTER_HASH}`, version: "C6A4889D4A407C38" },
];

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

function compactValue(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function parseCompactToken(
  value: unknown,
  category: GmgnShadowToken["category"],
): GmgnShadowToken | null {
  const row = object(value);
  const tokenAddress = text(compactValue(row ?? {}, "address", "a"))?.toLowerCase() ?? "";
  if (!row || !ADDRESS.test(tokenAddress)) return null;

  const platform = text(compactValue(row, "launchpad_platform", "lpp", "lp"));
  if (platform && !platform.toLowerCase().includes("pons")) return null;

  return {
    tokenAddress,
    category,
    launchpadPlatform: platform,
    launchedAt: timestamp(compactValue(row, "created_timestamp", "creation_timestamp", "ct")),
    name: text(compactValue(row, "name", "nm", "n")),
    symbol: text(compactValue(row, "symbol", "s")),
    imageUrl: text(compactValue(row, "logo", "token_logo", "l")),
    creatorAddress: text(compactValue(row, "creator", "ctr"))?.toLowerCase() ?? null,
    priceUsd: number(compactValue(row, "price", "p")),
    marketCapUsd: number(compactValue(row, "usd_market_cap", "market_cap", "mc")),
    liquidityUsd: number(compactValue(row, "liquidity", "lqdt", "lq")),
    progress: number(compactValue(row, "progress", "pg")),
    holderCount: number(compactValue(row, "holder_count", "hc", "hd")),
    rawToken: row,
  };
}

type WebsiteTrenchesSection = {
  filter_id?: string;
  version?: string;
  tokens?: unknown[];
};

type WebsiteTrenchesMeta = {
  chain: string;
  rg: string;
  sections: Array<{ category: GmgnShadowToken["category"]; filterId: string; version: string }>;
};

export function parseGmgnWebsiteTrenches(response: unknown) {
  const envelope = object(response);
  if (number(envelope?.code) !== 0) {
    throw new Error(text(envelope?.message) ?? "GMGN website Trenches returned an unsuccessful response");
  }
  const rows = Array.isArray(envelope?.data) ? envelope.data : [];
  const root = rows.map(object).find((row) => text(row?.chain)?.toLowerCase() === "robinhood")
    ?? rows.map(object).find(Boolean);
  if (!root) throw new Error("GMGN website Trenches response did not contain Robinhood data");

  const definitions: Array<[string, GmgnShadowToken["category"]]> = [
    ["new_creation", "new_creation"],
    ["near_completion", "near_completion"],
    ["completed", "completed"],
  ];
  const tokens: GmgnShadowToken[] = [];
  const sections: WebsiteTrenchesMeta["sections"] = [];
  for (const [key, category] of definitions) {
    const section = object(root[key]) as WebsiteTrenchesSection | null;
    for (const item of section?.tokens ?? []) {
      const token = parseCompactToken(item, category);
      if (token) tokens.push(token);
    }
    if (section?.filter_id && section.version) {
      sections.push({ category, filterId: section.filter_id, version: section.version });
    }
  }
  return {
    tokens,
    meta: {
      chain: text(root.chain) ?? "robinhood",
      rg: text(root.rg) ?? "",
      sections,
    } satisfies WebsiteTrenchesMeta,
  };
}

function categoryFromFilterId(filterId: string): GmgnShadowToken["category"] | null {
  if (filterId.includes("_ncp_")) return "near_completion";
  if (filterId.includes("_nc_")) return "new_creation";
  if (filterId.includes("_cp_")) return "completed";
  return null;
}

export function parseGmgnTrenchesDelta(
  response: unknown,
  cache: Map<string, GmgnShadowToken>,
) {
  const envelope = object(response);
  if (text(envelope?.channel) !== "trenches_delta") return [];
  const payload = envelope?.data;
  const messages = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const changed = new Map<string, GmgnShadowToken>();

  for (const messageValue of messages) {
    const message = object(messageValue);
    const filterId = text(message?.fid) ?? "";
    const category = categoryFromFilterId(filterId);
    if (!message || !category) continue;
    const additions = Array.isArray(message.a) ? message.a : [];
    const updates = Array.isArray(message.t) ? message.t : [];
    const deltas = [...additions, ...updates];
    for (const deltaValue of deltas) {
      const delta = object(deltaValue);
      const fields = object(delta?.f) ?? delta ?? {};
      const address = text(delta?.a ?? fields.address ?? fields.a)?.toLowerCase() ?? "";
      if (!delta || !ADDRESS.test(address)) continue;
      const previous = cache.get(address);
      const rawToken = {
        ...(previous?.rawToken ?? {}),
        ...fields,
        a: address,
        chain: text(delta.c) ?? "robinhood",
      };
      const token = parseCompactToken(rawToken, category);
      if (!token) continue;
      cache.set(address, token);
      changed.set(address, token);
    }
  }
  return [...changed.values()];
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

function websiteTrenchesSection(orderby: "created_timestamp" | "progress") {
  return {
    filters: ["offchain", "onchain"],
    launchpad_platform_v2: true,
    launchpad_platform: ["pons"],
    quote_address_type: ROBINHOOD_QUOTE_TYPES,
    orderby,
    direction: "desc",
    limit: 80,
  };
}

async function getGmgnWebsiteTrenches(connection?: { connId: string; rg: string }) {
  const response = await fetch(`${GMGN_SITE}/trs/api/v1/trenches_rank`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: GMGN_SITE,
      referer: `${GMGN_SITE}/?chain=robinhood`,
      "user-agent": "Mozilla/5.0 (compatible; PonsEye/1.0)",
    },
    body: JSON.stringify({
      ...(connection ? { meta: { rg: connection.rg, conn_id: connection.connId } } : {}),
      params: [{
        chain: "robinhood",
        new_creation: websiteTrenchesSection("created_timestamp"),
        near_completion: websiteTrenchesSection("progress"),
        completed: websiteTrenchesSection("progress"),
      }],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`GMGN website Trenches HTTP ${response.status}`);
  return parseGmgnWebsiteTrenches(await response.json());
}

async function bootstrapGmgnLiveTrenches(connection: { connId: string; rg: string }) {
  try {
    return await getGmgnWebsiteTrenches(connection);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("HTTP 403")) throw error;
    console.warn("GMGN website bootstrap is blocked on Railway; trying the PonsEye metadata relay");
    try {
      const response = await fetch(PONSEYE_GMGN_BOOTSTRAP, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(connection),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`PonsEye GMGN metadata relay HTTP ${response.status}`);
      const meta = object(await response.json());
      const sections = Array.isArray(meta?.sections)
        ? meta.sections.map(object).flatMap((section) => {
          const category = normalizeCategory(text(section?.category) ?? "");
          const filterId = text(section?.filterId);
          const version = text(section?.version);
          return category && filterId && version ? [{ category, filterId, version }] : [];
        })
        : [];
      if (sections.length !== 3) throw new Error("PonsEye GMGN metadata relay returned incomplete data");
      console.log("GMGN live Trenches received regional subscription metadata");
      return {
        tokens: [] as GmgnShadowToken[],
        meta: {
          chain: text(meta?.chain) ?? "robinhood",
          rg: text(meta?.rg) ?? connection.rg,
          sections,
        } satisfies WebsiteTrenchesMeta,
      };
    } catch (relayError) {
      console.warn("PonsEye GMGN metadata relay unavailable; using the last known Pons filter versions", relayError);
    }
    return {
      tokens: [] as GmgnShadowToken[],
      meta: {
        chain: "robinhood",
        rg: connection.rg,
        sections: ROBINHOOD_PONS_FALLBACK_SECTIONS,
      } satisfies WebsiteTrenchesMeta,
    };
  }
}

function gmgnWebSocketUrl() {
  const uuid = randomUUID();
  const params = new URLSearchParams({
    device_id: uuid.replaceAll("-", ""),
    tab_id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    fp_did: "unknown",
    client_id: `gmgn_web_${GMGN_WEB_VERSION}`,
    from_app: "gmgn",
    app_ver: GMGN_WEB_VERSION,
    tz_name: "Etc/UTC",
    tz_offset: "0",
    app_lang: "en",
    os: "web",
    worker: "0",
    uuid,
  });
  return `${GMGN_TRENCHES_WS}?${params}`;
}

export type GmgnLiveTrenchesEvent = {
  source: "snapshot" | "delta";
  tokens: GmgnShadowToken[];
};

export async function connectGmgnLiveTrenches(
  signal: AbortSignal,
  onEvent: (event: GmgnLiveTrenchesEvent) => Promise<void>,
) {
  if (signal.aborted) return;
  const cache = new Map<string, GmgnShadowToken>();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let processing = Promise.resolve();
    let bootstrapStarted = false;
    let diagnosticFramesRemaining = 3;
    const socket = new WebSocket(gmgnWebSocketUrl(), {
      headers: {
        Origin: GMGN_SITE,
        "User-Agent": "Mozilla/5.0 (compatible; PonsEye/1.0)",
      },
    });
    const connectTimeout = setTimeout(() => {
      socket.terminate();
      finish(new Error("GMGN live Trenches connection timed out"));
    }, 25_000);

    const stop = () => {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "PonsEye stopping");
      else socket.terminate();
      finish();
    };
    signal.addEventListener("abort", stop, { once: true });

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimeout);
      signal.removeEventListener("abort", stop);
      if (error) reject(error);
      else resolve();
    }

    socket.on("error", (error) => finish(error));
    socket.on("close", (code, reason) => {
      if (signal.aborted || code === 1000) finish();
      else finish(new Error(`GMGN live Trenches closed (${code} ${reason.toString() || "no reason"})`));
    });
    socket.on("message", (raw) => {
      processing = processing.then(async () => {
        const message = JSON.parse(raw.toString()) as unknown;
        const envelope = object(message);
        if (text(envelope?.type) === "connected" && !bootstrapStarted) {
          clearTimeout(connectTimeout);
          const connId = text(envelope?.conn_id);
          const rg = text(envelope?.rg);
          if (!connId || !rg) throw new Error("GMGN live Trenches did not provide connection metadata");
          bootstrapStarted = true;
          const bootstrap = await bootstrapGmgnLiveTrenches({ connId, rg });
          for (const token of bootstrap.tokens) cache.set(token.tokenAddress, token);
          if (bootstrap.tokens.length) await onEvent({ source: "snapshot", tokens: bootstrap.tokens });
          if (!bootstrap.meta.sections.length) throw new Error("GMGN live Trenches bootstrap returned no subscriptions");
          socket.send(JSON.stringify({
            action: "subscribe",
            channel: "trenches_delta",
            data: {
              id: `${bootstrap.meta.sections[0].filterId}-trenches-batch`,
              rg: bootstrap.meta.rg || rg,
              data: bootstrap.meta.sections.map((section) => ({
                chain: bootstrap.meta.chain,
                filter_id: section.filterId,
                version: section.version,
              })),
            },
          }));
          console.log(`GMGN live Trenches subscribed to ${bootstrap.meta.sections.length} Pons sections`);
          return;
        }
        if (text(envelope?.channel) === "heartbeat") {
          socket.send(JSON.stringify({ action: "heartbeat", channel: "heartbeat", data: envelope?.data }));
          return;
        }
        const tokens = parseGmgnTrenchesDelta(message, cache);
        if (text(envelope?.channel) === "trenches_delta" && diagnosticFramesRemaining > 0) {
          diagnosticFramesRemaining -= 1;
          console.log("GMGN live Trenches frame", JSON.stringify(message).slice(0, 4_000));
        }
        if (tokens.length) await onEvent({ source: "delta", tokens });
      }).catch((error) => {
        socket.terminate();
        finish(error instanceof Error ? error : new Error(String(error)));
      });
    });
  });
}
