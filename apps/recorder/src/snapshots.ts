import { assertAddress, fetchAllPages, number } from "./bitquery-client.js";
import { db } from "./db.js";

/**
 * Ages at which each token is observed, in seconds.
 *
 * Weighted towards the first few minutes because that is where the decision has
 * to be made. Measured on the two largest runners, XL and NOESIS, both were
 * already 15x to 26x by thirty minutes, so a rule that only fires at half an
 * hour is choosing between tokens that have already moved.
 */
export const SNAPSHOT_AGES_SECONDS = [60, 180, 300, 600, 900, 1800, 3600, 7200] as const;

const DEFAULT_SUPPLY = 1_000_000_000;

type Candle = {
  Block: { Time: string };
  Price?: { Ohlc?: { Open?: string | number; High?: string | number; Low?: string | number; Close?: string | number } };
  Volume?: { Usd?: string | number };
};

type SnapshotToken = {
  token_address: string;
  migrated_at: string;
  migration_market_cap_usd: number | string | null;
  token_supply: number | string | null;
};

function historyQuery(tokenAddress: string, since: string, limit: number, offset: number) {
  return `
    query PonsSnapshotHistory {
      Trading {
        Tokens(
          limit: {count: ${limit}, offset: ${offset}}
          orderBy: {ascending: Block_Time}
          where: {
            Token: {Address: {is: "${assertAddress(tokenAddress)}"} Network: {is: "Robinhood"}}
            Interval: {Time: {Duration: {eq: 60}}}
            Block: {Time: {since: "${since}"}}
          }
        ) {
          Block { Time }
          Price { Ohlc { Open High Low Close } }
          Volume { Usd }
        }
      }
    }
  `;
}

async function fetchHistory(token: SnapshotToken) {
  return fetchAllPages<Candle>(
    (limit, offset) => historyQuery(token.token_address, new Date(token.migrated_at).toISOString(), limit, offset),
    (data) => (data as { Trading?: { Tokens?: Candle[] } }).Trading?.Tokens ?? [],
    { pageSize: 1000, maxPages: 12, label: `snapshot history for ${token.token_address}` },
  );
}

/**
 * Builds every snapshot for one token from its candle history.
 *
 * The split is the whole point: everything in the feature half is computed from
 * candles at or before the age, everything in the outcome half from candles
 * strictly after it. A feature can never see its own answer.
 */
export function buildSnapshots(token: SnapshotToken, candles: Candle[]) {
  const migratedAt = Date.parse(token.migrated_at);
  const migrationMc = number(token.migration_market_cap_usd);
  const supply = number(token.token_supply) ?? DEFAULT_SUPPLY;
  if (!candles.length || !migrationMc || migrationMc <= 0) return [];

  const points = candles
    .map((candle) => ({
      at: Date.parse(candle.Block.Time),
      close: number(candle.Price?.Ohlc?.Close),
      high: number(candle.Price?.Ohlc?.High),
      low: number(candle.Price?.Ohlc?.Low),
      volume: number(candle.Volume?.Usd) ?? 0,
    }))
    .filter((point) => Number.isFinite(point.at) && point.close != null)
    .sort((a, b) => a.at - b.at);
  if (!points.length) return [];

  const lastAt = points[points.length - 1]!.at;
  const computedAt = new Date().toISOString();

  return SNAPSHOT_AGES_SECONDS.flatMap((ageSeconds) => {
    const boundary = migratedAt + ageSeconds * 1_000;
    // A snapshot taken beyond the data we hold would be a guess.
    if (lastAt < boundary) return [];

    const past = points.filter((point) => point.at <= boundary);
    const future = points.filter((point) => point.at > boundary);
    if (!past.length) return [];

    const current = past[past.length - 1]!;
    const marketCap = current.close! * supply;
    if (!(marketCap > 0)) return [];

    const volumeUsd = past.reduce((total, point) => total + point.volume, 0);
    const highs = past.map((point) => point.high).filter((value): value is number => value != null);
    const lows = past.map((point) => point.low).filter((value): value is number => value != null);
    const highMc = highs.length ? Math.max(...highs) * supply : null;
    const lowMc = lows.length ? Math.min(...lows) * supply : null;
    const lastMinute = past.filter((point) => point.at > boundary - 60_000)
      .reduce((total, point) => total + point.volume, 0);

    const futureHighs = future.map((point) => point.high ?? point.close!).filter((v): v is number => v != null);
    const futureHigh = futureHighs.length ? Math.max(...futureHighs) * supply : null;
    const futureHighPoint = futureHigh == null
      ? null
      : future.reduce((best, point) =>
        (point.high ?? point.close!) > (best.high ?? best.close!) ? point : best, future[0]!);

    const marketCapAfter = (hours: number) => {
      const target = boundary + hours * 3_600_000;
      if (lastAt < target) return null;
      const point = points.filter((candidate) => candidate.at <= target).at(-1);
      return point?.close != null ? point.close * supply : null;
    };

    return [{
      token_address: token.token_address,
      age_seconds: ageSeconds,

      price_usd: current.close,
      market_cap_usd: marketCap,
      multiple_from_migration: marketCap / migrationMc,
      volume_usd: volumeUsd,
      volume_to_migration_mc: volumeUsd / migrationMc,
      volume_last_minute_usd: lastMinute,
      high_market_cap_usd: highMc,
      low_market_cap_usd: lowMc,
      drawdown_from_high: highMc && highMc > 0 ? 1 - marketCap / highMc : null,
      active_minutes: past.filter((point) => point.volume > 0).length,

      future_high_market_cap_usd: futureHigh,
      future_multiple: futureHigh == null ? null : futureHigh / marketCap,
      minutes_to_future_high: futureHighPoint == null
        ? null
        : Math.round((futureHighPoint.at - boundary) / 60_000),
      market_cap_1h_later: marketCapAfter(1),
      market_cap_6h_later: marketCapAfter(6),
      market_cap_24h_later: marketCapAfter(24),

      observed_horizon_minutes: Math.round((lastAt - boundary) / 60_000),
      candles_seen: past.length,
      last_candle_at: new Date(lastAt).toISOString(),
      computed_at: computedAt,
    }];
  });
}

type ExistingSnapshot = {
  token_address: string;
  age_seconds: number;
  market_cap_usd: number | string | null;
  future_high_market_cap_usd: number | string | null;
  minutes_to_future_high: number | null;
  market_cap_1h_later: number | string | null;
  market_cap_6h_later: number | string | null;
  market_cap_24h_later: number | string | null;
  last_candle_at: string | null;
};

/**
 * Extends the outcome half of existing snapshots using only candles recorded
 * since the last pass.
 *
 * Every candle after the watermark lies after every age boundary already
 * stored, so each one can only raise a future high, never change a feature.
 * That makes the merge a maximum rather than a recomputation, and means the
 * expensive full history never has to be read twice.
 */
export async function refreshSnapshotOutcomes({
  log = console.log,
  limit = 400,
}: { log?: (message: string) => void; limit?: number } = {}) {
  const ages = SNAPSHOT_AGES_SECONDS.length;

  const { data, error } = await db.from("bitquery_migration_snapshots")
    .select("token_address,age_seconds,market_cap_usd,future_high_market_cap_usd,minutes_to_future_high,market_cap_1h_later,market_cap_6h_later,market_cap_24h_later,last_candle_at")
    .order("last_candle_at", { ascending: true, nullsFirst: true })
    .limit(limit * ages);
  if (error) throw new Error(`Read snapshots to refresh: ${error.message}`);

  const byToken = new Map<string, ExistingSnapshot[]>();
  for (const row of (data ?? []) as ExistingSnapshot[]) {
    if (!byToken.has(row.token_address)) byToken.set(row.token_address, []);
    byToken.get(row.token_address)!.push(row);
  }

  const tokenList = [...byToken.keys()];
  const { data: tokenRows, error: tokenError } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,migration_market_cap_usd,token_supply")
    .in("token_address", tokenList.slice(0, 500));
  if (tokenError) throw new Error(`Read tokens to refresh: ${tokenError.message}`);
  const tokens = new Map((tokenRows ?? []).map((row) => [row.token_address as string, row as SnapshotToken]));

  let updated = 0;
  let unchanged = 0;

  for (const [address, rows] of byToken) {
    const token = tokens.get(address);
    if (!token) continue;

    // A token younger than the widest age has not earned all its rows yet, so
    // it still needs the full pass rather than an extension.
    if (rows.length < ages) continue;

    const watermark = rows.reduce<number | null>((oldest, row) => {
      const at = row.last_candle_at ? Date.parse(row.last_candle_at) : null;
      if (at == null) return oldest;
      return oldest == null || at < oldest ? at : oldest;
    }, null);
    if (watermark == null) continue;

    const fresh = await fetchHistory({ ...token, migrated_at: new Date(watermark + 1000).toISOString() });
    if (!fresh.length) { unchanged += 1; continue; }

    const supply = number(token.token_supply) ?? DEFAULT_SUPPLY;
    const migratedAt = Date.parse(token.migrated_at);
    const points = fresh
      .map((candle) => ({
        at: Date.parse(candle.Block.Time),
        close: number(candle.Price?.Ohlc?.Close),
        high: number(candle.Price?.Ohlc?.High),
      }))
      .filter((point) => Number.isFinite(point.at) && point.close != null);
    if (!points.length) { unchanged += 1; continue; }

    const lastAt = Math.max(...points.map((point) => point.at));
    const bestNew = points.reduce((best, point) =>
      (point.high ?? point.close!) > (best.high ?? best.close!) ? point : best, points[0]!);
    const bestNewMc = (bestNew.high ?? bestNew.close!) * supply;

    const capAt = (target: number) => {
      if (lastAt < target) return null;
      const point = points.filter((candidate) => candidate.at <= target).at(-1);
      return point?.close != null ? point.close * supply : null;
    };

    const updates = rows.map((row) => {
      const boundary = migratedAt + row.age_seconds * 1_000;
      const marketCap = number(row.market_cap_usd);
      const oldHigh = number(row.future_high_market_cap_usd);
      const improved = oldHigh == null || bestNewMc > oldHigh;
      const futureHigh = improved ? bestNewMc : oldHigh;

      return {
        token_address: row.token_address,
        age_seconds: row.age_seconds,
        future_high_market_cap_usd: futureHigh,
        future_multiple: marketCap && marketCap > 0 ? futureHigh / marketCap : null,
        minutes_to_future_high: improved
          ? Math.round((bestNew.at - boundary) / 60_000)
          : row.minutes_to_future_high,
        market_cap_1h_later: number(row.market_cap_1h_later) ?? capAt(boundary + 3_600_000),
        market_cap_6h_later: number(row.market_cap_6h_later) ?? capAt(boundary + 6 * 3_600_000),
        market_cap_24h_later: number(row.market_cap_24h_later) ?? capAt(boundary + 24 * 3_600_000),
        observed_horizon_minutes: Math.round((lastAt - boundary) / 60_000),
        last_candle_at: new Date(lastAt).toISOString(),
      };
    });

    const { error: saveError } = await db.from("bitquery_migration_snapshots")
      .upsert(updates, { onConflict: "token_address,age_seconds" });
    if (saveError) throw new Error(`Extend snapshots: ${saveError.message}`);
    updated += 1;
    if (updated % 25 === 0) log(`  ${updated} tokens extended`);
  }

  log(`Snapshot refresh complete: ${updated} tokens extended, ${unchanged} already current`);
  return { updated, unchanged };
}

/**
 * Tokens with a trusted graduation price and no snapshots at all.
 *
 * Distinct from refreshing: refresh extends rows that exist, and without this
 * a newly graduated token never gets its first row, so the research dataset
 * quietly stops growing while every other stage looks healthy.
 */
export async function tokensMissingSnapshots(limit: number) {
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,migration_market_cap_usd,token_supply")
    .eq("migration_price_source", "pool_reserves")
    // Old enough for the widest age to be measurable.
    .lte("migrated_at", new Date(Date.now() - Math.max(...SNAPSHOT_AGES_SECONDS) * 1_000).toISOString())
    .order("migrated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Choose tokens missing snapshots: ${error.message}`);
  if (!data?.length) return [];

  const have = new Set<string>();
  for (let index = 0; index < data.length; index += 200) {
    const chunk = data.slice(index, index + 200).map((row) => row.token_address as string);
    const { data: rows, error: haveError } = await db.from("bitquery_migration_snapshots")
      .select("token_address").eq("age_seconds", 60).in("token_address", chunk);
    if (haveError) throw new Error(`Read existing snapshots: ${haveError.message}`);
    for (const row of rows ?? []) have.add(row.token_address as string);
  }

  return (data.filter((row) => !have.has(row.token_address as string)).slice(0, limit)) as SnapshotToken[];
}

/** Builds the first set of snapshots for tokens that have none. */
export async function buildMissingSnapshots(limit = 3) {
  const tokens = await tokensMissingSnapshots(limit);
  if (!tokens.length) return 0;

  let written = 0;
  for (const token of tokens) {
    const rows = buildSnapshots(token, await fetchHistory(token));
    if (!rows.length) continue;
    const { error } = await db.from("bitquery_migration_snapshots")
      .upsert(rows, { onConflict: "token_address,age_seconds" });
    if (error) throw new Error(`Save snapshots: ${error.message}`);
    written += rows.length;
  }
  return written;
}

async function snapshotCandidates(limit: number) {
  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,migration_market_cap_usd,token_supply")
    .eq("migration_price_source", "pool_reserves")
    .order("migrated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Choose snapshot candidates: ${error.message}`);
  return (data ?? []) as SnapshotToken[];
}

/**
 * Rebuilds snapshots for every token with a trusted graduation price.
 *
 * Safe to re-run: rows are replaced, and a token whose history has grown since
 * the last run gains longer outcome horizons.
 */
export async function backfillSnapshots({
  log = console.log,
  limit = 2000,
}: { log?: (message: string) => void; limit?: number } = {}) {
  const tokens = await snapshotCandidates(limit);
  log(`Building snapshots for ${tokens.length} tokens at ages ${SNAPSHOT_AGES_SECONDS.join(", ")}s`);

  let written = 0;
  let skipped = 0;

  for (const [index, token] of tokens.entries()) {
    try {
      const rows = buildSnapshots(token, await fetchHistory(token));
      if (!rows.length) { skipped += 1; continue; }
      const { error } = await db.from("bitquery_migration_snapshots")
        .upsert(rows, { onConflict: "token_address,age_seconds" });
      if (error) throw new Error(error.message);
      written += rows.length;
    } catch (error) {
      skipped += 1;
      console.error(`Snapshot failed for ${token.token_address}`, error);
    }
    if ((index + 1) % 25 === 0) {
      log(`  ${index + 1}/${tokens.length} tokens, ${written} snapshot rows written, ${skipped} skipped`);
    }
  }

  log(`Snapshots complete: ${written} rows from ${tokens.length} tokens, ${skipped} skipped`);
  return { written, skipped, tokens: tokens.length };
}
