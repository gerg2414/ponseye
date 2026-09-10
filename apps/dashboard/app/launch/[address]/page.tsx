import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLaunchDetail, type Trade } from "../../../lib/data";
import { safeImageUrl } from "../../../lib/images";
import { compact, launchMarket, quoteAsset, quoteValue } from "../../../lib/market";
import { AutoRefresh } from "../../auto-refresh";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Launch Research | PonsEye",
  description: "Recorded PONS launch data and trade evidence.",
};

function short(value: string) {
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

function tradePrice(trade: Trade, quoteDecimals: number) {
  const quote = Number(trade.quote_amount_raw) / 10 ** quoteDecimals;
  const tokens = Number(trade.token_amount_raw) / 1e18;
  return tokens > 0 ? quote / tokens : 0;
}

function PriceChart({ trades, quoteDecimals }: { trades: Trade[]; quoteDecimals: number }) {
  const values = trades
    .slice(-300)
    .map((trade) => tradePrice(trade, quoteDecimals))
    .filter((price) => Number.isFinite(price) && price > 0);

  if (values.length < 2) {
    return <div className="chartEmpty">Waiting for enough trades to draw the chart</div>;
  }

  const logs = values.map((value) => Math.log10(value));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  const spread = Math.max(max - min, 0.000001);
  const points = logs.map((value, index) => {
    const x = 18 + (index / (logs.length - 1)) * 764;
    const y = 252 - ((value - min) / spread) * 218;
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L782 270 L18 270 Z`;

  return (
    <svg className="priceChart" viewBox="0 0 800 288" role="img" aria-label="Recorded trade price chart">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a56cff" stopOpacity=".35" />
          <stop offset="1" stopColor="#a56cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="chartGrid">
        <path d="M18 34H782M18 88H782M18 143H782M18 197H782M18 252H782" />
        <path d="M18 34V252M209 34V252M400 34V252M591 34V252M782 34V252" />
      </g>
      <path className="chartArea" d={area} />
      <path className="chartLine" d={line} />
      <circle className="chartPoint" cx={points.at(-1)?.[0]} cy={points.at(-1)?.[1]} r="4" />
    </svg>
  );
}

export default async function LaunchPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(address)) notFound();

  const detail = await getLaunchDetail(address.toLowerCase());
  if (!detail) notFound();

  const { launch, trades } = detail;
  const market = launchMarket(launch);
  const imageUrl = safeImageUrl(launch.image_url);
  const latestPrice = market.price;
  const recentTrades = trades.slice(-30).reverse();

  return (
    <main className="launchPage">
      <AutoRefresh />
      <header className="launchNav">
        <Link href="/" className="backLink"><span>←</span> All launches</Link>
        <div className="detailLive"><i /> Live record</div>
      </header>

      <section className="launchTitle">
        <div className="detailTokenImage">
          {imageUrl ? <Image src={imageUrl} alt="" width={92} height={92} unoptimized priority /> : <span>?</span>}
        </div>
        <div>
          <span className="detailStatus">{launch.status}</span>
          <h1>{launch.name ?? "Metadata pending"}</h1>
          <p>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Unknown ticker"} <b>•</b> {market.asset.symbol} pair</p>
        </div>
      </section>

      <section className="detailStats">
        <article><small>Market cap</small><strong>{quoteValue(market.marketCap, market.asset.symbol)}</strong></article>
        <article><small>Recorded volume</small><strong>{quoteValue(market.volume, market.asset.symbol)}</strong></article>
        <article><small>Transactions</small><strong>{launch.trade_count.toLocaleString("en-GB")}</strong></article>
        <article><small>Traders</small><strong>{launch.unique_traders.toLocaleString("en-GB")}</strong></article>
        <article><small>Buys</small><strong className="positive">{launch.buys.toLocaleString("en-GB")}</strong></article>
        <article><small>Sells</small><strong className="negative">{launch.sells.toLocaleString("en-GB")}</strong></article>
      </section>

      <section className="chartPanel">
        <header>
          <div><small>Recorded price</small><strong>{latestPrice ? `${compact(latestPrice)} ${market.asset.symbol}` : "Waiting"}</strong></div>
          <span>Log scale <b>•</b> latest 300 trades</span>
        </header>
        <PriceChart trades={trades} quoteDecimals={market.asset.decimals} />
      </section>

      <div className="detailColumns">
        <section className="launchInfo">
          <header><h2>Launch record</h2><span>{launch.progress_pct?.toFixed(1) ?? "0.0"}% bonded</span></header>
          <div className="detailProgress"><i style={{ width: `${launch.progress_pct ?? 0}%` }} /></div>
          {launch.description && <p>{launch.description}</p>}
          <dl>
            <div><dt>Token</dt><dd>{short(launch.token_address)}</dd></div>
            <div><dt>Curve</dt><dd>{short(launch.curve_address)}</dd></div>
            <div><dt>Deployer</dt><dd>{short(launch.deployer_address)}</dd></div>
            <div><dt>Launched</dt><dd>{new Date(launch.launched_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</dd></div>
          </dl>
          <nav className="launchLinks">
            {launch.website_url && <a href={launch.website_url} target="_blank" rel="noreferrer">Website</a>}
            {launch.twitter_url && <a href={launch.twitter_url} target="_blank" rel="noreferrer">X</a>}
            {launch.telegram_url && <a href={launch.telegram_url} target="_blank" rel="noreferrer">Telegram</a>}
          </nav>
        </section>

        <section className="tradeTape">
          <header><h2>Latest trades</h2><span>{recentTrades.length} shown</span></header>
          <div className="tradeRows">
            {recentTrades.length ? recentTrades.map((trade) => {
              const asset = quoteAsset(launch.pair_token_address);
              const quoteAmount = Number(trade.quote_amount_raw) / 10 ** asset.decimals;
              return (
                <div className="tradeRow" key={trade.event_id}>
                  <b className={trade.side}>{trade.side}</b>
                  <span>{quoteValue(quoteAmount, asset.symbol)}</span>
                  <span>{trade.trader_address ? short(trade.trader_address) : "Unknown wallet"}</span>
                  <time>{new Date(trade.block_time).toLocaleTimeString("en-GB", { timeZone: "UTC" })}</time>
                </div>
              );
            }) : <div className="chartEmpty">No trades recorded yet</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
