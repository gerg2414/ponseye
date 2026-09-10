import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLaunchDetail } from "../../../lib/data";
import { launchMarket, quoteAsset, quoteValue } from "../../../lib/market";
import { AutoRefresh } from "../../auto-refresh";
import { TokenImage } from "../../token-image";
import { CopyField } from "./copy-field";
import { PonsEyeChart } from "./ponseye-chart";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Launch Research | PonsEye",
  description: "Recorded PONS launch data and trade evidence.",
};

function short(value: string) {
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

function PixelIcon({ type }: { type: "contract" | "curve" | "wallet" | "clock" | "cap" | "peak" | "drop" | "volume" | "holders" | "traders" | "buy" | "creator" | "web" | "x" | "telegram" }) {
  const paths = {
    contract: "M3 2h8l4 4v10H3zM11 2v4h4M6 10h6M6 13h4",
    curve: "M2 14h3V9h3V6h3V3h4M12 3h3v3",
    wallet: "M2 5h13v10H2zM4 5V3h9v2M11 9h4v3h-4z",
    clock: "M9 2a7 7 0 1 0 0 14A7 7 0 0 0 9 2zM9 5v4l3 2",
    cap: "M2 15V9l4-4 3 3 6-6M11 2h4v4",
    peak: "M2 14l4-8 3 4 3-7 4 11",
    drop: "M3 4l5 6 3-4 4 6M12 12h3V9",
    volume: "M3 15V9h3v6M8 15V4h3v11M13 15V7h3v8",
    holders: "M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 16c0-4 2-6 5-6s5 2 5 6M13 4a2 2 0 1 1 0 4M12 11c3 0 4 2 4 5",
    traders: "M2 5h12M10 2l4 3-4 3M16 13H4M8 10l-4 3 4 3",
    buy: "M9 16V3M4 8l5-5 5 5",
    creator: "M9 2l2 4 4 1-3 3 1 5-4-2-4 2 1-5-3-3 4-1z",
    web: "M9 2a7 7 0 1 0 0 14A7 7 0 0 0 9 2zM2 9h14M9 2c2 2 3 4 3 7s-1 5-3 7M9 2C7 4 6 6 6 9s1 5 3 7",
    x: "M3 3l12 12M15 3L3 15",
    telegram: "M2 8l14-5-4 13-3-5-3 2 1-3zM7 10l5-4",
  };
  return <svg className="pixelIcon" viewBox="0 0 18 18" aria-hidden="true"><path d={paths[type]} /></svg>;
}

export default async function LaunchPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(address)) notFound();

  const detail = await getLaunchDetail(address.toLowerCase());
  if (!detail) notFound();

  const { launch, trades, marketTrades } = detail;
  const market = launchMarket(launch);
  const recentTrades = trades.slice(-30).reverse();
  const marketByHash = new Map(marketTrades.map((trade) => [trade.transaction_hash, trade]));
  const usd = (value: number | null) => value && value > 0 ? quoteValue(value, "USDG") : "Pending price";
  const percent = (value: number | null, fallback = "Pending data") => value == null ? fallback : `${value.toFixed(1)}%`;
  const holderDelta = launch.holder_change_5m == null
    ? "First snapshot due"
    : `${launch.holder_change_5m >= 0 ? "+" : ""}${launch.holder_change_5m}`;

  return (
    <main className="launchPage">
      <AutoRefresh />
      <header className="launchNav">
        <Link href="/" className="backLink"><span>←</span> All launches</Link>
        <div className="detailLive"><i /> Live record</div>
      </header>

      <section className="launchTitle">
        <div className="launchIdentity">
          <div className="detailTokenImage">
            <TokenImage src={launch.image_url} alt={launch.name ?? "Token image"} size={92} priority />
          </div>
          <div className="launchIdentityCopy">
            <span className="detailStatus">{launch.status}</span>
            <h1>{launch.name ?? "Metadata pending"}</h1>
            <p>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Unknown ticker"} <b>•</b> {market.asset.symbol} pair</p>
            {launch.description ? <p className="tokenDescription">{launch.description}</p> : null}
            <div className="titleBonding"><i style={{ width: `${launch.progress_pct ?? 0}%` }} /><span>{launch.progress_pct?.toFixed(1) ?? "0.0"}% bonded</span></div>
          </div>
        </div>
        <aside className="launchMeta">
          <dl>
            <div><dt><PixelIcon type="contract" /> Contract address</dt><dd><CopyField value={launch.token_address} /></dd></div>
            <div><dt><PixelIcon type="curve" /> Bonding curve</dt><dd><CopyField value={launch.curve_address} /></dd></div>
            <div><dt><PixelIcon type="wallet" /> Deployer wallet</dt><dd><CopyField value={launch.deployer_address} /></dd></div>
            <div><dt><PixelIcon type="clock" /> Launched</dt><dd className="launchDate">{new Date(launch.launched_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</dd></div>
          </dl>
          <nav className="launchLinks">
            {launch.website_url && <a href={launch.website_url} target="_blank" rel="noreferrer"><PixelIcon type="web" /> Website <span>↗</span></a>}
            {launch.twitter_url && <a href={launch.twitter_url} target="_blank" rel="noreferrer"><PixelIcon type="x" /> X <span>↗</span></a>}
            {launch.telegram_url && <a href={launch.telegram_url} target="_blank" rel="noreferrer"><PixelIcon type="telegram" /> Telegram <span>↗</span></a>}
          </nav>
        </aside>
      </section>

      <section className="marketWorkspace">
        <div className="chartPanel">
          <header>
            <div><small>Live market cap</small><strong>{usd(launch.market_cap_usd)}</strong></div>
            <span>{marketTrades.length ? `${new Date(marketTrades[0].block_time).toLocaleDateString("en-GB")} to ${new Date(marketTrades.at(-1)?.block_time ?? marketTrades[0].block_time).toLocaleDateString("en-GB")}` : "Waiting for dollar priced trade"}</span>
          </header>
          <PonsEyeChart trades={marketTrades} />
        </div>
        <aside className="metricRail">
          <header><span>Token telemetry</span><b><i /> Live</b></header>
          <div className="metricRailGrid">
            <article><small><PixelIcon type="cap" /> Market cap</small><strong>{usd(launch.market_cap_usd)}</strong></article>
            <article><small><PixelIcon type="cap" /> ATH market cap</small><strong>{usd(launch.ath_market_cap_usd)}</strong></article>
            <article><small><PixelIcon type="peak" /> Peak</small><strong>{launch.peak_multiple ? `${launch.peak_multiple.toFixed(2)}x` : "No trades yet"}</strong></article>
            <article><small><PixelIcon type="drop" /> Drawdown</small><strong className="negative">{percent(launch.drawdown_from_peak_pct, "No peak yet")}</strong></article>
            <article><small><PixelIcon type="volume" /> Volume</small><strong>{usd(launch.volume_usd)}</strong></article>
            <article><small><PixelIcon type="holders" /> Holders</small><strong>{launch.holder_count?.toLocaleString("en-GB") ?? "Snapshot due"}</strong></article>
            <article><small><PixelIcon type="holders" /> Holders 5m</small><strong className={(launch.holder_change_5m ?? 0) >= 0 ? "positive" : "negative"}>{holderDelta}</strong></article>
            <article><small><PixelIcon type="holders" /> Top 10</small><strong>{percent(launch.top_10_holder_pct, "Snapshot due")}</strong></article>
            <article><small><PixelIcon type="traders" /> Traders</small><strong>{launch.unique_traders.toLocaleString("en-GB")}</strong></article>
            <article><small><PixelIcon type="buy" /> Buy pressure</small><strong className="positive">{percent(launch.buy_pressure_pct, "No trades yet")}</strong></article>
            <article><small><PixelIcon type="traders" /> First minute</small><strong>{launch.first_minute_buyers.toLocaleString("en-GB")}</strong></article>
            <article><small><PixelIcon type="creator" /> Creator sells</small><strong className={launch.creator_sells ? "negative" : "positive"}>{launch.creator_sells.toLocaleString("en-GB")}</strong></article>
          </div>
        </aside>
      </section>

      <section className="tradeTape detailTradeTape">
          <header><h2>Latest trades</h2><span>{recentTrades.length} shown</span></header>
          <div className="tradeRows">
            {recentTrades.length ? recentTrades.map((trade) => {
              const asset = quoteAsset(launch.pair_token_address);
              const quoteAmount = Number(trade.quote_amount_raw) / 10 ** asset.decimals;
              const dollarTrade = marketByHash.get(trade.transaction_hash);
              const dollarAmount = dollarTrade?.quote_amount_usd ?? dollarTrade?.base_amount_usd;
              return (
                <div className="tradeRow" key={trade.event_id}>
                  <b className={trade.side}>{trade.side}</b>
                  <span>{dollarAmount ? quoteValue(dollarAmount, "USDG") : quoteValue(quoteAmount, asset.symbol)}</span>
                  <span>{trade.trader_address ? short(trade.trader_address) : "Unknown wallet"}</span>
                  <time>{new Date(trade.block_time).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })}</time>
                </div>
              );
            }) : <div className="chartEmpty">No trades recorded yet</div>}
          </div>
      </section>
    </main>
  );
}
