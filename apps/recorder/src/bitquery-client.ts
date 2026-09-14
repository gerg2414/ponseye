import { config } from "./config.js";

/** Thrown when Bitquery rejects our credentials, so only then do we re-authenticate. */
export class BitqueryAuthError extends Error {}

export type GraphQLPayload<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;

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
        throw new Error(`Bitquery query failed with ${response.status}`);
      }
      if (!response.ok) {
        // A 4xx that is not auth or rate limiting is our own malformed query.
        // Retrying cannot help, so surface it immediately.
        throw Object.assign(new Error(`Bitquery query failed with ${response.status}`), { fatal: true });
      }

      const payload = await response.json() as GraphQLPayload<T>;
      if (payload.errors?.length) {
        const message = payload.errors.map((error) => error.message ?? "Unknown Bitquery error").join("; ");
        if (payload.data == null) throw new Error(message);
        console.warn(`Bitquery returned a partial result: ${message}`);
      }
      return (payload.data ?? {}) as T;
    } catch (error) {
      lastError = error;
      if ((error as { fatal?: boolean }).fatal) break;
      if (attempt === attempts - 1) break;
      // Back off 1s, 2s, 4s so a rate limit or blip does not stall the stage.
      await delay(1_000 * 2 ** attempt);
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
