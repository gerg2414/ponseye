import type { Metadata } from "next";
import { getBitqueryMigrationTest } from "../../../lib/database";
import { AutoRefresh } from "../../auto-refresh";
import { LabHeader } from "../lab-header";
import { DatabaseCopyAddress } from "../database/database-copy-address";
import { TokenImage } from "../../token-image";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bitquery Migration Test | PonsEye Lab",
  description: "A separate 24 hour test of Bitquery PONS migration events and market data.",
};

function money(value: number | null) {
  if (value == null || value <= 0) return "Pending";
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

function multiple(entry: number | null, peak: number | null) {
  if (!entry || !peak) return "Pending";
  return `${(peak / entry).toFixed(2)}×`;
}

type SortKey = "newest" | "ath" | "multiple" | "current" | "migration" | "volume" | "trades" | "buys" | "sells";

export default async function BitqueryMigrationTestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { migrations, status, metricsReady } = await getBitqueryMigrationTest();
  const lastMigration = migrations[0]?.migrated_at ?? null;
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const sort = (value("sort") || "newest") as SortKey;
  const minAth = Number(value("minAth") || 0);
  const minMultiple = Number(value("minMultiple") || 0);
  const readyOnly = value("ready") === "1";
  const shown = migrations.filter((token) => {
    const peakMultiple = token.migration_market_cap_usd && token.ath_market_cap_usd
      ? token.ath_market_cap_usd / token.migration_market_cap_usd
      : 0;
    if (readyOnly && !token.metrics_updated_at) return false;
    if ((token.ath_market_cap_usd ?? 0) < minAth) return false;
    return peakMultiple >= minMultiple;
  }).sort((a, b) => {
    const aMultiple = a.migration_market_cap_usd && a.ath_market_cap_usd ? a.ath_market_cap_usd / a.migration_market_cap_usd : 0;
    const bMultiple = b.migration_market_cap_usd && b.ath_market_cap_usd ? b.ath_market_cap_usd / b.migration_market_cap_usd : 0;
    const fields: Record<Exclude<SortKey, "newest" | "multiple">, keyof typeof a> = {
      ath: "ath_market_cap_usd", current: "current_market_cap_usd", migration: "migration_market_cap_usd",
      volume: "volume_usd", trades: "trade_count", buys: "buys", sells: "sells",
    };
    if (sort === "newest") return Date.parse(b.migrated_at) - Date.parse(a.migrated_at);
    if (sort === "multiple") return bMultiple - aMultiple;
    return Number(b[fields[sort]] ?? 0) - Number(a[fields[sort]] ?? 0);
  });

  return (
    <main className="databasePage bitqueryTestPage">
      <AutoRefresh intervalMs={10_000} />
      <LabHeader current="bitquery" />

      <section className="bitqueryTestIntro">
        <div>
          <small>Isolated source test</small>
          <h1>Bitquery migrations</h1>
          <p>Only PONS pool graduation events from the last 24 hours. No launch feed or bonding curve trades are collected.</p>
        </div>
        <span className={status?.status === "connected" ? "connected" : ""}>
          <i />{status?.status ?? "Waiting"}
        </span>
      </section>

      <section className="databaseStats bitqueryTestStats">
        <article><small>Migrations</small><strong>{migrations.length}</strong></article>
        <article><small>Market data ready</small><strong>{metricsReady}</strong></article>
        <article><small>Latest migration</small><strong>{lastMigration ? time(lastMigration).replace(/^\d{2} \w{3},? /, "") : "Waiting"}</strong></article>
        <article><small>Listener</small><strong>{status?.status === "connected" ? "Live" : status?.status ?? "Waiting"}</strong></article>
      </section>

      <section className="databaseLedger bitqueryTestLedger">
        <header>
          <div><small>Bitquery event rows</small><strong>{shown.length.toLocaleString("en-GB")} of {migrations.length.toLocaleString("en-GB")} migrations</strong></div>
          <span>{status?.message ?? "Waiting for the first Bitquery scan"}</span>
        </header>
        <form className="bitqueryFilters">
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
          <label className="bitqueryReadyFilter"><input type="checkbox" name="ready" value="1" defaultChecked={readyOnly} /><span>Market data ready</span></label>
          <button type="submit">Apply filters</button><a href="/lab/bitquery-test">Clear</a>
        </form>
        <div className="databaseTableWrap">
          <table>
            <thead>
              <tr><th>Token</th><th>Migrated</th><th>Migration MC</th><th>Current MC</th><th>Post migration ATH</th><th>Peak</th><th>Volume</th><th>Buys</th><th>Sells</th><th>Trades</th><th>Event details</th></tr>
            </thead>
            <tbody>
              {shown.map((token, index) => (
                <tr key={token.token_address}>
                  <td>
                    <div className="bitqueryTokenName">
                      <a className="bitqueryTokenLink" href={`https://gmgn.ai/robinhood/token/${token.token_address}`} target="_blank" rel="noreferrer">
                        <TokenImage src={token.image_url} alt={token.name ?? token.symbol ?? "Token"} size={52} priority={index < 8} />
                        <span><strong>{token.name ?? "Metadata pending"}</strong><small>{token.symbol ? `$${token.symbol.replace(/^\$/, "")}` : shortAddress(token.token_address)}</small><em>Open GMGN chart</em></span>
                      </a>
                      <div className="databaseActions"><DatabaseCopyAddress address={token.token_address} /></div>
                    </div>
                  </td>
                  <td><time dateTime={token.migrated_at}>{time(token.migrated_at)}</time><small>Seen {time(token.first_seen_at)}</small></td>
                  <td><strong>{money(token.migration_market_cap_usd)}</strong></td>
                  <td><strong>{money(token.current_market_cap_usd)}</strong></td>
                  <td><strong className="peakValue">{money(token.ath_market_cap_usd)}</strong></td>
                  <td><strong className="peakValue">{multiple(token.migration_market_cap_usd, token.ath_market_cap_usd)}</strong></td>
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
                </tr>
              ))}
              {!shown.length ? <tr><td className="databaseEmpty" colSpan={11}>No migrations match these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
