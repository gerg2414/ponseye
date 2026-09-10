import Image from "next/image";
import Link from "next/link";
import type { Launch } from "../lib/data";
import { getDashboardData } from "../lib/data";
import { safeImageUrl } from "../lib/images";
import { launchMarket, quoteValue } from "../lib/market";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

const currentFeeds = new Set(["launch_activity", "curve_trades"]);
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

function age(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function MetricIcon({ type }: { type: "cap" | "volume" | "tx" | "traders" | "buy" | "sell" }) {
  if (type === "cap") return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13V9l3-3 3 2 5-5" /><path d="M10 3h3v3" /></svg>;
  if (type === "volume") return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13V9M8 13V4M13 13V7" /></svg>;
  if (type === "traders") return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5" r="2" /><path d="M2.5 13c.3-2.5 1.5-4 3.5-4s3.2 1.5 3.5 4M11 5.5c1.5.2 2.3 1.3 2.5 3" /></svg>;
  if (type === "buy") return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg>;
  if (type === "sell") return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4" /></svg>;
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h9M8 2l3 3-3 3M14 11H5M8 8l-3 3 3 3" /></svg>;
}

function TokenCard({ launch }: { launch: Launch }) {
  const imageUrl = safeImageUrl(launch.image_url);
  const progress = launch.progress_pct;
  const market = launchMarket(launch);

  return (
    <Link className="launchCardLink" href={`/launch/${launch.token_address}`}>
      <article className="launchCard">
        <div className="cardTop">
          <div className="tokenImage">
            {imageUrl ? <Image src={imageUrl} alt="" width={64} height={64} unoptimized /> : <span>?</span>}
          </div>
          <div className="tokenIdentity">
            <div><strong>{launch.name ?? "Metadata pending"}</strong><time>{age(launch.launched_at)}</time></div>
            <span>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Unknown ticker"}</span>
          </div>
        </div>

        <div className="metrics">
          <div><small><MetricIcon type="cap" /> MC</small><strong>{quoteValue(market.marketCap, market.asset.symbol)}</strong></div>
          <div><small><MetricIcon type="volume" /> Volume</small><strong>{quoteValue(market.volume, market.asset.symbol)}</strong></div>
          <div><small><MetricIcon type="tx" /> TX</small><strong>{launch.trade_count}</strong></div>
          <div><small><MetricIcon type="traders" /> Traders</small><strong>{launch.unique_traders}</strong></div>
          <div><small><MetricIcon type="buy" /> Buys</small><strong className="buyMetric">{launch.buys}</strong></div>
          <div><small><MetricIcon type="sell" /> Sells</small><strong className="sellMetric">{launch.sells}</strong></div>
        </div>

        <div className="bonding">
          <div><span>Bonding</span><strong>{progress == null ? "Awaiting threshold" : `${progress.toFixed(1)}%`}</strong></div>
          <div className="progressTrack"><i style={{ width: `${progress ?? 0}%` }} /></div>
        </div>

        <footer className="cardFoot">
          <span>{market.asset.symbol} pair</span>
          <span>CA {short(launch.token_address)}</span>
        </footer>
      </article>
    </Link>
  );
}

function LaunchLane({ title, count, tone, launches, empty }: {
  title: string;
  count: number;
  tone: "new" | "completing" | "completed";
  launches: Launch[];
  empty: string;
}) {
  return (
    <section className={`launchLane ${tone}`}>
      <header className="laneHead">
        <div><i /><strong>{title}</strong></div>
        <span>{count}</span>
      </header>
      <div className="launchLaneBody">
        {launches.length ? launches.map((launch) => <TokenCard key={launch.token_address} launch={launch} />) : (
          <div className="laneEmpty">{empty}</div>
        )}
      </div>
    </section>
  );
}

export default async function Home() {
  const { launches, streams, launchCount, tradeCount } = await getDashboardData();
  const recorderFeeds = streams.filter((stream) => currentFeeds.has(stream.feed));
  const liveFeeds = recorderFeeds.filter((stream) => stream.status === "connected").length;
  const recorderLive = liveFeeds === currentFeeds.size;
  const newestLaunch = launches[0];

  const completed = launches
    .filter((launch) => launch.status === "graduated")
    .sort((a, b) => new Date(b.graduated_at ?? b.launched_at).getTime() - new Date(a.graduated_at ?? a.launched_at).getTime());
  const completing = launches
    .filter((launch) => launch.status !== "graduated" && (launch.status === "swept" || (launch.progress_pct ?? 0) >= 10))
    .sort((a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0));
  const newCreations = launches
    .filter((launch) => launch.status !== "graduated" && launch.status !== "swept" && (launch.progress_pct == null || launch.progress_pct < 10))
    .sort((a, b) => new Date(b.launched_at).getTime() - new Date(a.launched_at).getTime());

  return (
    <main>
      <AutoRefresh />
      <header className="header">
        <div className="systemMeta">
          <span>Robinhood Chain</span>
          <div className={`recorder ${recorderLive ? "live" : "offline"}`}><i /> {recorderLive ? "Recorder live" : "Recorder paused"}</div>
        </div>
      </header>

      <section className="hero">
        <div className="heroCopy">
          <div className="heroBrand">
            <Image className="heroRobot" src="/ponseye-robot-scanning.gif" alt="" width={512} height={512} priority unoptimized />
            <Image className="heroWordmark" src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
          </div>
          <h1>Watch every launch.<br /><em>Find what repeats.</em></h1>
        </div>
      </section>

      <section className="stats">
        <article><span className="statIndex">01</span><div><small>Launches captured</small><strong>{launchCount.toLocaleString("en-GB")}</strong></div><i className="statLight" /></article>
        <article><span className="statIndex">02</span><div><small>Curve trades</small><strong>{tradeCount.toLocaleString("en-GB")}</strong></div><i className="statLight" /></article>
        <article><span className="statIndex">03</span><div><small>Data feeds</small><strong>{liveFeeds}<b> / {currentFeeds.size}</b></strong></div><i className={`statLight ${recorderLive ? "" : "dim"}`} /></article>
        <article><span className="statIndex">04</span><div><small>Latest launch</small><strong className="latestTime">{newestLaunch ? `${age(newestLaunch.launched_at)} ago` : "Waiting"}</strong></div><i className="statLight purple" /></article>
      </section>

      <section className="boardSection">
        {launches.length === 0 ? (
          <div className="empty"><span className="emptyEye"><i /></span><h3>Watching for the next launch</h3><p>New PONS launches will appear here automatically when the recorder is running.</p></div>
        ) : (
          <div className="launchBoard">
            <LaunchLane title="New Creation" count={newCreations.length} tone="new" launches={newCreations.slice(0, 12)} empty="No fresh launches yet" />
            <LaunchLane title="Completing" count={completing.length} tone="completing" launches={completing.slice(0, 12)} empty="No launches near graduation" />
            <LaunchLane title="Completed" count={completed.length} tone="completed" launches={completed.slice(0, 12)} empty="Graduated launches will appear here" />
          </div>
        )}
        <footer className="panelFoot"><span>Tracking {launches.length} recent launches</span><span>Raw evidence retained</span></footer>
      </section>
    </main>
  );
}
