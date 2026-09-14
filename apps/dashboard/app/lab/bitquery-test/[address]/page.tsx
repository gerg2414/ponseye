import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBitqueryMigrationToken } from "../../../../lib/database";
import { AutoRefresh } from "../../../auto-refresh";
import { TokenImage } from "../../../token-image";
import { LabHeader } from "../../lab-header";
import { DatabaseCopyAddress } from "../../database/database-copy-address";
import { GmgnChart } from "./gmgn-chart";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "GMGN Token Chart | PonsEye Lab", description: "GMGN one minute market chart for a migrated PONS token." };

function money(value: number | null) {
  if (value == null || value <= 0) return "Pending";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function time(value: string | null) {
  if (!value) return "Pending";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London", hour12: false }).format(new Date(value));
}

export default async function BitqueryMigrationTokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(address)) notFound();
  const detail = await getBitqueryMigrationToken(address.toLowerCase());
  if (!detail) notFound();
  const { token, candles } = detail;
  const peak = token.migration_market_cap_usd && token.ath_market_cap_usd ? token.ath_market_cap_usd / token.migration_market_cap_usd : null;

  return (
    <main className="databasePage gmgnTokenPage">
      <AutoRefresh intervalMs={5_000} />
      <LabHeader current="bitquery" />
      <a className="gmgnChartBack" href="/lab/bitquery-test">← Back to migrations</a>
      <section className="gmgnTokenHero">
        <div className="gmgnTokenIdentity">
          <TokenImage src={token.image_url} alt={token.name ?? token.symbol ?? "Token"} size={76} priority />
          <div><small>Migrated PONS token</small><h1>{token.name ?? token.symbol ?? `${token.token_address.slice(0, 8)}…${token.token_address.slice(-6)}`}</h1><span>{token.symbol ? `$${token.symbol.replace(/^\$/, "")}` : "Robinhood Chain"}</span></div>
        </div>
        <div className="gmgnTokenActions"><DatabaseCopyAddress address={token.token_address} /><a href={`https://gmgn.ai/robinhood/token/${token.token_address}`} target="_blank" rel="noreferrer">Open on GMGN ↗</a></div>
      </section>
      <section className="gmgnTokenStats">
        <article><small>Migration MC</small><strong>{money(token.migration_market_cap_usd)}</strong></article>
        <article><small>Current MC</small><strong>{money(token.current_market_cap_usd)}</strong></article>
        <article><small>Post migration ATH</small><strong>{money(token.ath_market_cap_usd)}</strong></article>
        <article><small>Peak</small><strong>{peak ? `${peak.toFixed(2)}×` : "Pending"}</strong></article>
        <article><small>Buys</small><strong className="buyValue">{token.buys.toLocaleString("en-GB")}</strong></article>
        <article><small>Sells</small><strong className="sellValue">{token.sells.toLocaleString("en-GB")}</strong></article>
      </section>
      <section className="gmgnChartPanel">
        <header><div><small>GMGN market data</small><strong>1 minute market cap</strong></div><span><i />{candles.length ? `${candles.length} candles` : "Requested"}</span></header>
        <GmgnChart candles={candles} />
      </section>
      <section className="gmgnTokenFoot">
        <article><small>Migrated</small><strong>{time(token.migrated_at)}</strong></article>
        <article><small>Volume</small><strong>{money(token.volume_usd)}</strong></article>
        <article><small>Trades</small><strong>{token.trade_count.toLocaleString("en-GB")}</strong></article>
        <article><small>Unique traders</small><strong>{token.unique_traders.toLocaleString("en-GB")}</strong></article>
      </section>
    </main>
  );
}
