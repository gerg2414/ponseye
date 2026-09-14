import { config } from "./config.js";

/** Thrown when Bitquery rejects our credentials, so only then do we re-authenticate. */
export class BitqueryAuthError extends Error {}

export type GraphQLPayload<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;

// Bitquery limits how many queries one account may have in flight and rejects
// the excess with "access restricted by session limit". A rejection is not just
// a retry, it leaves whatever the caller was measuring unmeasured, so every
// request in this process goes through one queue rather than relying on each
// caller to restrain itself.
const pendingRequests: Array<() => void> = [];
let activeRequests = 0;
let lastRequestStartedAt = 0;

async function acquireRequestSlot() {
  if (activeRequests >= config.BITQUERY_MAX_CONCURRENT_QUERIES) {
    await new Promise<void>((resolve) => pendingRequests.push(resolve));
  }
  activeRequests += 1;

  const wait = lastRequestStartedAt + config.BITQUERY_MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await delay(wait);
  lastRequestStartedAt = Date.now();
}

function releaseRequestSlot() {
  activeRequests -= 1;
  pendingRequests.shift()?.();
}

// Bitquery bills on request volume, so the only way to control it is to know
// which stage is spending it. Counted here because this is the single choke
// point every query already passes through.
const queryCounts = new Map<string, number>();
const rowCounts = new Map<string, number>();
let queryTotal = 0;
let rowTotal = 0;
let countingSince = Date.now();
let currentLabel = "unlabelled";

/** Names the stage responsible for queries issued until the next call. */
export function labelQueries(label: string) {
  currentLabel = label;
}

export function queryStats() {
  const minutes = Math.max((Date.now() - countingSince) / 60_000, 1 / 60);
  return {
    queries: queryTotal,
    queriesPerMinute: Number((queryTotal / minutes).toFixed(1)),
    // Bitquery charges on the work a query does, not on the number of requests,
    // so rows returned tracks the bill far better than request count. A single
    // thousand-row page costs what a thousand single-row lookups would.
    rows: rowTotal,
    rowsPerMinute: Math.round(rowTotal / minutes),
    projectedRowsPerDay: Math.round((rowTotal / minutes) * 1440),
    queriesByStage: Object.fromEntries([...queryCounts.entries()].sort((a, b) => b[1] - a[1])),
    rowsByStage: Object.fromEntries([...rowCounts.entries()].sort((a, b) => b[1] - a[1])),
    since: new Date(countingSince).toISOString(),
  };
}

/** Counts the rows a response carried, however deeply they are nested. */
function countRows(value: unknown): number {
  if (Array.isArray(value)) return value.length + value.reduce<number>((t, v) => t + countRows(v), 0);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>((t, v) => t + countRows(v), 0);
  }
  return 0;
}

export function resetQueryStats() {
  queryCounts.clear();
  rowCounts.clear();
  queryTotal = 0;
  rowTotal = 0;
  countingSince = Date.now();
}

/** True for the errors that mean "you asked for too much at once", not "this is wrong". */
function isThrottleMessage(message: string) {
  return /session limit|too many concurrent|rate limit|too many requests/i.test(message);
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

/**
 * Bitquery has no variable binding for the fields we filter on, so addresses are
 * interpolated into the query text. Refuse anything that is not an address
 * rather than letting it reach the query.
 */
export function assertAddress(value: string) {
  const address = value.toLowerCase();
  if (!ADDRESS.test(address)) throw new Error(`Refusing to query malformed address: ${value}`);
  return address;
}

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS.test(value.toLowerCase());
}

export async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;
  if (!config.BITQUERY_CLIENT_ID || !config.BITQUERY_CLIENT_SECRET) {
    throw new BitqueryAuthError("Bitquery migration test credentials are missing");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.BITQUERY_CLIENT_ID,
    client_secret: config.BITQUERY_CLIENT_SECRET,
    scope: "api",
  });
  const response = await fetch("https://oauth2.bitquery.io/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new BitqueryAuthError(`Bitquery OAuth failed with ${response.status}`);
  const payload = await response.json() as { access_token: string; expires_in: number };
  accessToken = payload.access_token;
  accessTokenExpiresAt = Date.now() + payload.expires_in * 1_000;
  return accessToken;
}

export function invalidateAccessToken() {
  accessToken = null;
  accessTokenExpiresAt = 0;
}

/**
 * Runs a query, retrying transient failures. Partial responses are kept: a
 * batched query covering 25 tokens should not lose 24 good results because one
 * alias failed.
 */
export async function queryBitquery<T>(query: string, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // The slot is released as soon as the request finishes, before any
      // backoff, so a waiting request is not blocked by another one sleeping.
      await acquireRequestSlot();
      queryTotal += 1;
      queryCounts.set(currentLabel, (queryCounts.get(currentLabel) ?? 0) + 1);
      try {
        const token = await getAccessToken();
        const response = await fetch("https://streaming.bitquery.io/graphql", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(45_000),
        });

        if (response.status === 401 || response.status === 403) {
          invalidateAccessToken();
          throw new BitqueryAuthError(`Bitquery rejected credentials with ${response.status}`);
        }
        if (response.status === 429 || response.status >= 500) {
          throw Object.assign(new Error(`Bitquery query failed with ${response.status}`), { throttled: response.status === 429 });
        }
        if (!response.ok) {
          // A 4xx that is not auth or rate limiting is our own malformed query.
          // Retrying cannot help, so surface it immediately.
          throw Object.assign(new Error(`Bitquery query failed with ${response.status}`), { fatal: true });
        }

        const payload = await response.json() as GraphQLPayload<T>;
        if (payload.errors?.length) {
          const message = payload.errors.map((error) => error.message ?? "Unknown Bitquery error").join("; ");
          // A throttle arrives as a 200 with an error body, so it has to be
          // recognised here or it looks like a permanent failure.
          if (isThrottleMessage(message)) throw Object.assign(new Error(message), { throttled: true });
          if (payload.data == null) throw new Error(message);
          console.warn(`Bitquery returned a partial result: ${message}`);
        }
        const rows = countRows(payload.data);
        rowTotal += rows;
        rowCounts.set(currentLabel, (rowCounts.get(currentLabel) ?? 0) + rows);
        return (payload.data ?? {}) as T;
      } finally {
        releaseRequestSlot();
      }
    } catch (error) {
      lastError = error;
      if ((error as { fatal?: boolean }).fatal) break;
      if (attempt === attempts - 1) break;
      // Back off 1s, 2s, 4s, and longer when told we are asking for too much.
      const base = (error as { throttled?: boolean }).throttled ? 3_000 : 1_000;
      await delay(base * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Bitquery caps a single response at `pageSize` rows and reports no total, so a
 * window that overflows the cap is silently truncated. Page with an offset until
 * a short page arrives.
 */
export async function fetchAllPages<Row>(
  buildQuery: (limit: number, offset: number) => string,
  extract: (data: unknown) => Row[],
  { pageSize = 1000, maxPages = 25, label = "query" }: { pageSize?: number; maxPages?: number; label?: string } = {},
): Promise<Row[]> {
  const rows: Row[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const data = await queryBitquery<unknown>(buildQuery(pageSize, page * pageSize));
    const batch = extract(data);
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }

  console.warn(
    `${label} hit the ${maxPages}-page ceiling at ${rows.length} rows. ` +
    "Some rows in this window were not read. Narrow the window to recover them.",
  );
  return rows;
}

/** Runs tasks with bounded concurrency so one stage cannot flood Bitquery. */
export async function mapWithConcurrency<Item, Result>(
  items: Item[],
  limit: number,
  worker: (item: Item) => Promise<Result>,
): Promise<Array<PromiseSettledResult<Result>>> {
  const results: Array<PromiseSettledResult<Result>> = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });

  await Promise.all(runners);
  return results;
}
