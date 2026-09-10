import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLaunchDetail, type MarketTrade } from "../../../lib/data";
import { compact, launchMarket, quoteAsset, quoteValue } from "../../../lib/market";
import { AutoRefresh } from "../../auto-refresh";
import { TokenImage } from "../../token-image";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Launch Research | PonsEye",
  description: "Recorded PONS launch data and trade evidence.",
};

function short(value: string) {
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

function MarketCapChart({ trades }: { trades: MarketTrade[] }) {
  const values = trades
    .slice(-600)
    .flatMap((trade) => trade.price_usd && trade.price_usd > 0
      ? [{ value: trade.price_usd * 1_000_000_000, time: new Date(trade.block_time).getTime() }]
      : []);

  if (values.length < 2) {
    return <div className="chartEmpty">Collecting dollar market cap data</div>;
  }

  const logs = values.map((point) => Math.log10(point.value));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  const spread = Math.max(max - min, 0.000001);
  const firstTime = values[0].time;
  const lastTime = values.at(-1)?.time ?? firstTime;
  const timeSpread = Math.max(lastTime - firstTime, 1);
  const left = 94;
  const right = 1170;
  const top = 30;
  const bottom = 348;
  const points = logs.map((value, index) => {
    const x = left + ((values[index].time - firstTime) / timeSpread) * (right - left);
    const y = bottom - ((value - min) / spread) * (bottom - top);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${right} ${bottom} L${left} ${bottom} Z`;
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const y = top + ratio * (bottom - top);
    const value = 10 ** (max - ratio * spread);
    return { y, value };
  });
  const xTicks = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const x = left + ratio * (right - left);
    const time = firstTime + ratio * timeSpread;
    return { x, label: new Date(time).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) };
  });

  return (
    <svg className="priceChart" viewBox="0 0 1200 410" role="img" aria-label="Dollar market cap chart">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a56cff" stopOpacity=".35" />
          <stop offset="1" stopColor="#a56cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="chartGrid">
        {yTicks.map((tick) => <path key={tick.y} d={`M${left} ${tick.y}H${right}`} />)}
        {xTicks.map((tick) => <path key={tick.x} d={`M${tick.x} ${top}V${bottom}`} />)}
      </g>
      <g className="chartLabels">
        {yTicks.map((tick) => <text key={tick.y} x="78" y={tick.y + 4} textAnchor="end">${compact(tick.value)}</text>)}
        {xTicks.map((tick, index) => <text key={tick.x} x={tick.x} y="382" textAnchor={index === 0 ? "start" : index === 3 ? "end" : "middle"}>{tick.label}</text>)}
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

  const { launch, trades, marketTrades } = detail;
  const market = launchMarket(launch);
  const recentTrades = trades.slice(-30).reverse();
  const marketByHash = new Map(marketTrades.map((trade) => [trade.transaction_hash, trade]));
  const usd = (value: number | null) => value && value > 0 ? quoteValue(value, "USDG") : "Collecting";
  const percent = (value: number | null) => value == null ? "Collecting" : `${value.toFixed(1)}%`;
  const holderDelta = launch.holder_change_5m == null
    ? "Collecting"
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
          <div>
            <span className="detailStatus">{launch.status}</span>
            <h1>{launch.name ?? "Metadata pending"}</h1>
            <p>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Unknown ticker"} <b>•</b> {market.asset.symbol} pair</p>
            <div className="titleBonding"><i style={{ width: `${launch.progress_pct ?? 0}%` }} /><span>{launch.progress_pct?.toFixed(1) ?? "0.0"}% bonded</span></div>
          </div>
        </div>
        <aside className="launchMeta">
          {launch.description && <p>{launch.description}</p>}
          <dl>
            <div><dt>CA</dt><dd title={launch.token_address}>{short(launch.token_address)}</dd></div>
            <div><dt>Curve</dt><dd title={launch.curve_address}>{short(launch.curve_address)}</dd></div>
            <div><dt>Deployer</dt><dd title={launch.deployer_address}>{short(launch.deployer_address)}</dd></div>
            <div><dt>Launched</dt><dd>{new Date(launch.launched_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</dd></div>
          </dl>
          <nav className="launchLinks">
            {launch.website_url && <a href={launch.website_url} target="_blank" rel="noreferrer">Website</a>}
            {launch.twitter_url && <a href={launch.twitter_url} target="_blank" rel="noreferrer">X</a>}
            {launch.telegram_url && <a href={launch.telegram_url} target="_blank" rel="noreferrer">Telegram</a>}
          </nav>
        </aside>
      </section>

      <section className="detailStats">
        <article><small>Market cap</small><strong>{usd(launch.market_cap_usd)}</strong></article>
        <article><small>ATH market cap</small><strong>{usd(launch.ath_market_cap_usd)}</strong></article>
        <article><small>Peak</small><strong>{launch.peak_multiple ? `${launch.peak_multiple.toFixed(2)}x` : "Collecting"}</strong></article>
        <article><small>Drawdown</small><strong className="negative">{percent(launch.drawdown_from_peak_pct)}</strong></article>
        <article><small>Volume</small><strong>{usd(launch.volume_usd)}</strong></article>
        <article><small>Holders</small><strong>{launch.holder_count?.toLocaleString("en-GB") ?? "Collecting"}</strong></article>
        <article><small>Holders 5m</small><strong className={(launch.holder_change_5m ?? 0) >= 0 ? "positive" : "negative"}>{holderDelta}</strong></article>
        <article><small>Top 10</small><strong>{percent(launch.top_10_holder_pct)}</strong></article>
        <article><small>Traders</small><strong>{launch.unique_traders.toLocaleString("en-GB")}</strong></article>
        <article><small>Buy pressure</small><strong className="positive">{percent(launch.buy_pressure_pct)}</strong></article>
        <article><small>First minute buyers</small><strong>{launch.first_minute_buyers.toLocaleString("en-GB")}</strong></article>
        <article><small>Creator sells</small><strong className={launch.creator_sells ? "negative" : "positive"}>{launch.creator_sells.toLocaleString("en-GB")}</strong></article>
      </section>

      <section className="chartPanel">
        <header>
          <div><small>Market cap</small><strong>{usd(launch.market_cap_usd)}</strong></div>
          <span>{marketTrades.length ? `${new Date(marketTrades[0].block_time).toLocaleDateString("en-GB")} to ${new Date(marketTrades.at(-1)?.block_time ?? marketTrades[0].block_time).toLocaleDateString("en-GB")}` : "Waiting for dollar data"} <b>•</b> log scale</span>
        </header>
        <MarketCapChart trades={marketTrades} />
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
