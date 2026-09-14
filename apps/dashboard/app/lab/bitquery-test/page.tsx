import type { Metadata } from "next";
import { getBitqueryMigrationTest, type BitqueryMigrationSort } from "../../../lib/database";
import { AutoRefresh } from "../../auto-refresh";
import { LabHeader } from "../lab-header";
import { DatabaseCopyAddress } from "../database/database-copy-address";
import { TokenImage } from "../../token-image";
import { ClickableTokenRow } from "./clickable-token-row";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bitquery Migration Test | PonsEye Lab",
  description: "A rolling window of Bitquery PONS migration events and post-migration market data.",
};

function money(value: number | null) {
  // Only a missing value is pending. A real zero is a measurement, not an
  // absence, and hiding it makes an untraded token look unrecorded.
  if (value == null) return "Pending";
  if (value === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 100_000 ? 1 : 2,
  }).format(value);
}

function time(value: string | null) {
  if (!value) return "Pending";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/London",
    hour12: false,
  }).format(new Date(value));
}

function shortAddress(value: string | null) {
  if (!value) return "Pending";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function multiple(value: number | null) {
  if (value == null) return "Pending";
  return `${value.toFixed(2)}×`;
}

const SORT_KEYS = [
  "newest", "ath", "multiple", "current", "migration", "volume", "trades", "buys", "sells",
] as const satisfies readonly BitqueryMigrationSort[];

const WINDOW_OPTIONS = [24, 48, 72] as const;

/**
 * Largest-holder thresholds, measured one minute after migration.
 *
 * Under 15% is the filter worth watching: on 520 measured tokens it reached 10x
 * 23.7% of the time against a 5.6% base, and doubled 79% of the time.
 */
const TOP_HOLDER_OPTIONS = [0, 10, 15, 20, 30] as const;

/** Query strings are user input: fall back rather than letting NaN through. */
function positiveNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export default async function BitqueryMigrationTestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const requestedSort = value("sort") as BitqueryMigrationSort;
  const sort: BitqueryMigrationSort = SORT_KEYS.includes(requestedSort) ? requestedSort : "newest";
  const requestedWindow = positiveNumber(value("window"), 48);
  const windowHours = (WINDOW_OPTIONS as readonly number[]).includes(requestedWindow) ? requestedWindow : 48;
  const minAth = positiveNumber(value("minAth"));
  const minMultiple = positiveNumber(value("minMultiple"));
  const readyOnly = value("ready") === "1";
  const requestedTopHolder = positiveNumber(value("maxTop1"));
  const maxTopHolderPct = (TOP_HOLDER_OPTIONS as readonly number[]).includes(requestedTopHolder)
    ? requestedTopHolder
    : 0;

  const { migrations: shown, status, metricsReady, totalInWindow, filteredCount } =
    await getBitqueryMigrationTest({
      windowHours, sort, minAth, minMultiple, readyOnly, maxTopHolderPct, limit: 500,
    });
  const lastMigration = shown.length && sort === "newest"
    ? shown[0].migrated_at
    : shown.reduce<string | null>(
      (latest, row) => !latest || row.migrated_at > latest ? row.migrated_at : latest,
      null,
    );

  return (
    <main className="databasePage bitqueryTestPage">
      <AutoRefresh intervalMs={5_000} />
      <LabHeader current="bitquery" />

      <section className="bitqueryTestIntro">
        <div>
          <small>Isolated source test</small>
          <h1>Bitquery migrations</h1>
          <p>PONS pool graduation events from the last {windowHours} hours, with post-migration market data. No launch feed or bonding curve trades are collected.</p>
        </div>
        <span className={status?.status === "connected" ? "connected" : ""}>
          <i />{status?.status ?? "Waiting"}
        </span>
      </section>

      <section className="databaseStats bitqueryTestStats">
        <article><small>Migrations</small><strong>{totalInWindow.toLocaleString("en-GB")}</strong></article>
        <article><small>Market data ready</small><strong>{metricsReady.toLocaleString("en-GB")}</strong></article>
        <article><small>Latest migration</small><strong>{lastMigration ? time(lastMigration).replace(/^\d{2} \w{3},? /, "") : "Waiting"}</strong></article>
        <article><small>Listener</small><strong>{status?.status === "connected" ? "Live" : status?.status ?? "Waiting"}</strong></article>
      </section>

      <section className="databaseLedger bitqueryTestLedger">
        <header>
          <div><small>Bitquery event rows</small><strong>{shown.length.toLocaleString("en-GB")} shown of {filteredCount.toLocaleString("en-GB")} matching, {totalInWindow.toLocaleString("en-GB")} in window</strong></div>
          <span>{status?.message ?? "Waiting for the first Bitquery scan"}</span>
        </header>
        <form className="bitqueryFilters">
          <label><span>Window</span><select name="window" defaultValue={String(windowHours)}>
            {WINDOW_OPTIONS.map((hours) => <option key={hours} value={hours}>{hours}h</option>)}
          </select></label>
          <label><span>Sort by</span><select name="sort" defaultValue={sort}>
            <option value="newest">Newest</option><option value="ath">Highest ATH</option><option value="multiple">Highest multiple</option>
            <option value="current">Highest current MC</option><option value="migration">Highest migration MC</option>
            <option value="volume">Highest volume</option><option value="trades">Most trades</option>
            <option value="buys">Most buys</option><option value="sells">Most sells</option>
          </select></label>
          <label><span>Minimum ATH</span><select name="minAth" defaultValue={String(minAth)}>
            <option value="0">Any</option><option value="100000">$100K</option><option value="250000">$250K</option>
            <option value="500000">$500K</option><option value="1000000">$1M</option><option value="2000000">$2M</option><option value="5000000">$5M</option>
          </select></label>
          <label><span>Minimum peak</span><select name="minMultiple" defaultValue={String(minMultiple)}>
            <option value="0">Any</option><option value="2">2×</option><option value="3">3×</option><option value="5">5×</option>
            <option value="10">10×</option><option value="25">25×</option>
          </select></label>
          <label><span>Top holder</span><select name="maxTop1" defaultValue={String(maxTopHolderPct)}>
            <option value="0">Any</option>
            {TOP_HOLDER_OPTIONS.filter((pct) => pct > 0).map((pct) => (
              <option key={pct} value={pct}>{`under ${pct}%`}</option>
            ))}
          </select></label>
          <label className="bitqueryReadyFilter"><input type="checkbox" name="ready" value="1" defaultChecked={readyOnly} /><span>Market data ready</span></label>
          <button type="submit">Apply filters</button><a href="/lab/bitquery-test">Clear</a>
        </form>
        <div className="databaseTableWrap">
          <table>
            {/* Widths live beside the columns so inserting one cannot shift the rest. */}
            <colgroup>
              <col style={{ width: 230 }} />{/* Token */}
              <col style={{ width: 150 }} />{/* Migrated */}
              <col style={{ width: 140 }} />{/* Holders @1m */}
              <col style={{ width: 130 }} />{/* Migration MC */}
              <col style={{ width: 130 }} />{/* Current MC */}
              <col style={{ width: 150 }} />{/* Post migration ATH */}
              <col style={{ width: 100 }} />{/* Peak */}
              <col style={{ width: 120 }} />{/* Volume */}
              <col style={{ width: 130 }} />{/* Buys */}
              <col style={{ width: 130 }} />{/* Sells */}
              <col style={{ width: 130 }} />{/* Trades */}
              <col style={{ width: 130 }} />{/* Event details */}
            </colgroup>
            <thead>
              <tr><th>Token</th><th>Migrated</th><th>Holders @1m</th><th>Migration MC</th><th>Current MC</th><th>Post migration ATH</th><th>Peak</th><th>Volume</th><th>Buys</th><th>Sells</th><th>Trades</th><th>Event details</th></tr>
            </thead>
            <tbody>
              {shown.map((token, index) => (
                <ClickableTokenRow key={token.token_address} href={`https://gmgn.ai/robinhood/token/${token.token_address}`}>
                  <td>
                    <div className="bitqueryTokenName">
                      <a className="bitqueryTokenLink" href={`https://gmgn.ai/robinhood/token/${token.token_address}`}>
                        <TokenImage src={token.image_url} alt={token.name ?? token.symbol ?? "Token"} size={52} priority={index < 8} />
                        <span><strong>{token.name ?? shortAddress(token.token_address)}</strong><small>{token.symbol ? `$${token.symbol.replace(/^\$/, "")}` : "Token metadata unavailable"}</small><em>Open GMGN chart ↗</em></span>
                      </a>
                      <div className="databaseActions"><DatabaseCopyAddress address={token.token_address} /></div>
                    </div>
                  </td>
                  <td><time dateTime={token.migrated_at}>{time(token.migrated_at)}</time><small>Seen {time(token.first_seen_at)}</small></td>
                  <td>
                    {token.top_holder_pct == null ? <small>Pending</small> : (
                      <>
                        <strong className={token.top_holder_pct < 15 ? "buyValue" : undefined}>
                          {token.top_holder_pct.toFixed(1)}%
                        </strong>
                        <small>top 10: {token.top10_pct?.toFixed(0) ?? "?"}%</small>
                        <small>{token.holder_count?.toLocaleString("en-GB") ?? "?"} holders</small>
                      </>
                    )}
                  </td>
                  <td><strong>{money(token.migration_market_cap_usd)}</strong></td>
                  <td><strong>{money(token.current_market_cap_usd)}</strong></td>
                  <td><strong className="peakValue">{money(token.ath_market_cap_usd)}</strong></td>
                  <td><strong className="peakValue">{multiple(token.peak_multiple)}</strong></td>
                  <td>{money(token.volume_usd)}</td>
                  <td><strong className="buyValue">{token.buys.toLocaleString("en-GB")}</strong><small>{money(token.buy_volume_usd)}</small></td>
                  <td><strong className="sellValue">{token.sells.toLocaleString("en-GB")}</strong><small>{money(token.sell_volume_usd)}</small></td>
                  <td><strong>{token.trade_count.toLocaleString("en-GB")}</strong><small>{token.unique_traders.toLocaleString("en-GB")} traders</small><small>Latest {time(token.latest_trade_at)}</small></td>
                  <td>
                    <details className="bitqueryEventDetails">
                      <summary>View</summary>
                      <dl>
                        <div><dt>CA</dt><dd>{token.token_address}</dd></div>
                        <div><dt>Transaction</dt><dd>{token.transaction_hash}</dd></div>
                        <div><dt>Block</dt><dd>{token.block_number ?? "Pending"}</dd></div>
                        <div><dt>Creator</dt><dd>{token.creator_address ?? "Pending"}</dd></div>
                        <div><dt>Quote token</dt><dd>{token.quote_token_address ?? "Pending"}</dd></div>
                        <div><dt>Position ID</dt><dd>{token.position_id ?? "Pending"}</dd></div>
                        <div><dt>Seeded token amount</dt><dd>{token.token_amount_raw ?? "Pending"}</dd></div>
                        <div><dt>Seeded quote amount</dt><dd>{token.pair_token_amount_raw ?? "Pending"}</dd></div>
                        <div><dt>Description</dt><dd>{token.description ?? "Pending"}</dd></div>
                        <div><dt>Creator tax</dt><dd>{token.creator_tax_bps == null ? "Pending" : `${token.creator_tax_bps / 100}%`}</dd></div>
                        <div><dt>Buyback</dt><dd>{token.buyback_enabled == null ? "Pending" : token.buyback_enabled ? "Enabled" : "Disabled"}</dd></div>
                        <div><dt>Website</dt><dd>{token.website_url ?? "Pending"}</dd></div>
                        <div><dt>X</dt><dd>{token.twitter_url ?? "Pending"}</dd></div>
                        <div><dt>Telegram</dt><dd>{token.telegram_url ?? "Pending"}</dd></div>
                      </dl>
                    </details>
                  </td>
                </ClickableTokenRow>
              ))}
              {!shown.length ? <tr><td className="databaseEmpty" colSpan={12}>No migrations match these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
