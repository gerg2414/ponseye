import { assertAddress, number, queryBitquery } from "./bitquery-client.js";
import { db } from "./db.js";

/**
 * Ages at which holder distribution is measured, in seconds.
 *
 * Early, because the decision has to be made early. Concentration a day later
 * describes what happened rather than what was about to.
 */
export const HOLDER_AGES_SECONDS = [60, 300] as const;

const DEFAULT_SUPPLY = 1_000_000_000;
const TOP_N = 10;

type BalanceRow = { BalanceUpdate?: { Address?: string }; balance?: string | number };
type CountRow = { holders?: string | number };

type HolderToken = {
  token_address: string;
  migrated_at: string;
  token_supply: number | string | null;
  creator_address: string | null;
};

/**
 * Balances as of a moment, and the number of wallets holding.
 *
 * TokenHolders would give this directly but needs the archive dataset, which
 * the plan does not cover. Summing balance deltas up to the cut-off is
 * equivalent, and Bitquery does the summing, so the response stays small no
 * matter how heavily the token traded.
 */
function holderQuery(tokenAddress: string, till: string) {
  const address = assertAddress(tokenAddress);
  const where = `Currency: {SmartContract: {is: "${address}"}} Block: {Time: {till: "${till}"}}`;
  return `
    query PonsHolderSnapshot {
      EVM(network: robinhood) {
        Top: BalanceUpdates(
          limit: {count: ${TOP_N}}
          orderBy: {descendingByField: "balance"}
          where: {${where}}
        ) {
          BalanceUpdate { Address }
          balance: sum(of: BalanceUpdate_Amount)
        }
        Totals: BalanceUpdates(where: {${where}}) {
          holders: count(distinct: BalanceUpdate_Address)
        }
      }
    }
  `;
}

export async function measureHolders(token: HolderToken, ageSeconds: number) {
  const till = new Date(Date.parse(token.migrated_at) + ageSeconds * 1_000).toISOString();
  const data = await queryBitquery<{ EVM?: { Top?: BalanceRow[]; Totals?: CountRow[] } }>(
    holderQuery(token.token_address, till),
  );

  const top = data.EVM?.Top ?? [];
  const supply = number(token.token_supply) ?? DEFAULT_SUPPLY;
  if (!top.length || !(supply > 0)) return null;

  const holders = top
    .map((row) => ({
      address: row.BalanceUpdate?.Address?.toLowerCase() ?? null,
      // A wallet that has sold more than it bought nets negative; it is not a
      // holder and must not offset the wallets that are.
      amount: Math.max(0, number(row.balance) ?? 0),
    }))
    .filter((row): row is { address: string; amount: number } => row.address != null && row.amount > 0);
  if (!holders.length) return null;

  const creator = token.creator_address?.toLowerCase() ?? null;
  const creatorHolding = creator ? holders.find((row) => row.address === creator) : undefined;

  return {
    token_address: token.token_address,
    age_seconds: ageSeconds,
    holder_count: Math.round(number(data.EVM?.Totals?.[0]?.holders) ?? 0) || null,
    top_holder_pct: (holders[0]!.amount / supply) * 100,
    top10_pct: (holders.reduce((total, row) => total + row.amount, 0) / supply) * 100,
    // Null rather than zero: absent from the top ten is not the same as holding
    // nothing, and treating it as zero would understate creator retention.
    creator_pct: creatorHolding ? (creatorHolding.amount / supply) * 100 : null,
    top_holders: holders.map((row) => ({ address: row.address, pct: (row.amount / supply) * 100 })),
    computed_at: new Date().toISOString(),
  };
}

/**
 * Tokens ready for one particular age.
 *
 * Split by age deliberately. Waiting until a token is old enough for the widest
 * age before measuring anything delayed the one-minute reading by five minutes,
 * which is the reading the entry filter is built on. Each age is now claimed as
 * soon as it is reachable, newest first, so a fresh migration is scored about a
 * minute after it graduates rather than after the backlog clears.
 */
export async function holderCandidatesForAge(ageSeconds: number, limit: number) {
  const cutoff = new Date(Date.now() - ageSeconds * 1_000).toISOString();

  const done = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("bitquery_holder_snapshots")
      .select("token_address")
      .eq("age_seconds", ageSeconds)
      .range(from, from + 999);
    if (error) throw new Error(`Read completed holder snapshots: ${error.message}`);
    for (const row of data ?? []) done.add(row.token_address as string);
    if (!data || data.length < 1000) break;
  }

  const { data, error } = await db.from("bitquery_migration_test")
    .select("token_address,migrated_at,token_supply,creator_address")
    .lte("migrated_at", cutoff)
    .order("migrated_at", { ascending: false })
    .limit(limit + done.size);
  if (error) throw new Error(`Choose holder candidates: ${error.message}`);

  return (data ?? [])
    .filter((row) => !done.has(row.token_address as string))
    .slice(0, limit) as HolderToken[];
}

/** Every age, freshest first, so live scoring never queues behind a backfill. */
export async function holderCandidates(limit: number) {
  const work: Array<{ token: HolderToken; age: number }> = [];
  for (const age of [...HOLDER_AGES_SECONDS].sort((a, b) => a - b)) {
    for (const token of await holderCandidatesForAge(age, limit)) {
      work.push({ token, age });
    }
  }
  return work;
}

export async function updateHolders(work: Array<{ token: HolderToken; age: number }>) {
  const rows = [];
  for (const item of work) {
    const row = await measureHolders(item.token, item.age);
    if (row) rows.push(row);
  }
  if (!rows.length) return 0;
  const { error } = await db.from("bitquery_holder_snapshots")
    .upsert(rows, { onConflict: "token_address,age_seconds" });
  if (error) throw new Error(`Save holder snapshots: ${error.message}`);
  return rows.length;
}

export async function backfillHolders({
  log = console.log,
  batch = 4,
  maxTokens = Infinity,
}: { log?: (message: string) => void; batch?: number; maxTokens?: number } = {}) {
  let done = 0;
  let failures = 0;

  for (let round = 0; round < 5000; round += 1) {
    if (done >= maxTokens) { log(`Holder backfill stopped at ${done} tokens`); return done; }

    const tokens = await holderCandidates(500);
    if (!tokens.length) { log(`Holder backfill complete, ${done} measurements taken`); return done; }

    const slice = tokens.slice(0, Math.min(batch, maxTokens - done));
    try {
      await updateHolders(slice);
      done += slice.length;
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= 5) { console.error("Holder backfill stopping after 5 failures", error); return done; }
      const wait = ((error as { throttled?: boolean }).throttled ? 15_000 : 5_000) * failures;
      log(`  batch failed (${failures}/5), waiting ${wait / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    if (done % 25 < batch) log(`  ${done} tokens measured, ${Math.max(0, tokens.length - slice.length)} pending`);
  }
  return done;
}
