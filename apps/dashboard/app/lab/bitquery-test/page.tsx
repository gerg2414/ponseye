import type { Metadata } from "next";
import { getBitqueryMigrationTest } from "../../../lib/database";
import { AutoRefresh } from "../../auto-refresh";
import { LabHeader } from "../lab-header";
import { DatabaseCopyAddress } from "../database/database-copy-address";

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

export default async function BitqueryMigrationTestPage() {
  const { migrations, status, metricsReady } = await getBitqueryMigrationTest();
  const lastMigration = migrations[0]?.migrated_at ?? null;

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
          <div><small>Bitquery event rows</small><strong>{migrations.length.toLocaleString("en-GB")} migrations</strong></div>
          <span>{status?.message ?? "Waiting for the first Bitquery scan"}</span>
        </header>
        <div className="databaseTableWrap">
          <table>
            <thead>
              <tr><th>Token</th><th>Migrated</th><th>Migration MC</th><th>Current MC</th><th>Post migration ATH</th><th>Peak</th><th>Volume</th><th>Trades</th><th>Event details</th></tr>
            </thead>
            <tbody>
              {migrations.map((token) => (
                <tr key={token.token_address}>
                  <td>
                    <div className="bitqueryTokenName">
                      <strong>{token.name ?? "Metadata pending"}</strong>
                      <small>{token.symbol ? `$${token.symbol.replace(/^\$/, "")}` : shortAddress(token.token_address)}</small>
                      <div className="databaseActions"><DatabaseCopyAddress address={token.token_address} /></div>
                    </div>
                  </td>
                  <td><time dateTime={token.migrated_at}>{time(token.migrated_at)}</time><small>Seen {time(token.first_seen_at)}</small></td>
                  <td><strong>{money(token.migration_market_cap_usd)}</strong></td>
                  <td><strong>{money(token.current_market_cap_usd)}</strong></td>
                  <td><strong className="peakValue">{money(token.ath_market_cap_usd)}</strong></td>
                  <td><strong className="peakValue">{multiple(token.migration_market_cap_usd, token.ath_market_cap_usd)}</strong></td>
                  <td>{money(token.volume_usd)}</td>
                  <td><strong>{token.trade_count.toLocaleString("en-GB")}</strong><small>Latest {time(token.latest_trade_at)}</small></td>
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
                      </dl>
                    </details>
                  </td>
                </tr>
              ))}
              {!migrations.length ? <tr><td className="databaseEmpty" colSpan={9}>Waiting for the first Bitquery migration scan.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
