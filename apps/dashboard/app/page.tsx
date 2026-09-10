import Image from "next/image";
import Link from "next/link";
import type { Launch } from "../lib/data";
import { getDashboardData } from "../lib/data";
import { quoteValue } from "../lib/market";
import { AutoRefresh } from "./auto-refresh";
import { TokenImage } from "./token-image";

export const dynamic = "force-dynamic";

const currentFeeds = new Set(["launch_activity", "curve_trades", "market_trades", "holder_snapshots"]);
function age(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function targetLockScore(launch: Launch) {
  if (launch.acquired_at || launch.research_state === "target_locked") return 100;

  const tradeDepth = Math.min(1, launch.trade_count / 30) * 15;
  const traderDepth = Math.min(1, launch.unique_traders / 15) * 15;
  const pressure = Math.min(1, Math.max(0, (launch.buy_pressure_pct ?? 0) / 60)) * 15;
  const creatorClear = launch.creator_sells === 0 ? 10 : 0;
  const earlyBuyers = Math.min(1, launch.first_minute_buyers / 6) * 15;
  const momentum = Math.min(1, (launch.peak_multiple ?? 0) / 1.2) * 10;
  const peakHeld = launch.drawdown_from_peak_pct == null || launch.drawdown_from_peak_pct <= 40 ? 10 : 0;
  const holderSpread = launch.top_10_holder_pct == null || launch.top_10_holder_pct <= 70 ? 5 : 0;
  const creatorBalance = launch.creator_balance_pct == null || launch.creator_balance_pct <= 5 ? 5 : 0;
  const score = tradeDepth + traderDepth + pressure + creatorClear + earlyBuyers + momentum + peakHeld + holderSpread + creatorBalance;

  return Math.round(launch.research_state === "under_watch" ? Math.max(48, score) : Math.min(47, score));
}

function lockLabel(launch: Launch, score: number) {
  if (launch.acquired_at) return "Position acquired";
  if (launch.research_state === "target_locked") return "Target locked";
  if (score >= 80) return "Final checks";
  if (score >= 48) return "Tracking";
  return "Scanning";
}

function TokenCard({ launch, mode }: { launch: Launch; mode: "sighted" | "surveillance" | "acquired" }) {
  const lockScore = targetLockScore(launch);
  const acquired = mode === "acquired";
  const usdMarketCap = launch.market_cap_usd ? quoteValue(launch.market_cap_usd, "USDG") : launch.trade_count ? "Pending USD" : "No trades yet";
  const entryMarketCap = launch.entry_market_cap_usd ? quoteValue(launch.entry_market_cap_usd, "USDG") : null;
  const filledSegments = Math.ceil(lockScore / 6.25);

  return (
      <article className={`launchCard ${acquired ? "isAcquired" : ""}`}>
        <div className="cardTop">
          <div className="tokenImage">
            <TokenImage src={launch.image_url} alt={launch.name ?? "Token image"} size={64} />
          </div>
          <div className="cardContent">
            <div className="cardTitleRow">
              <div className="tokenIdentity">
                <strong>{launch.name ?? "Metadata pending"}</strong>
                <span>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Unknown ticker"}</span>
              </div>
              <time>{age(launch.launched_at)}</time>
            </div>
          </div>
        </div>

        <div className="cardMarketCap">
          <span>{entryMarketCap ? "Entry market cap" : "Market cap"}</span>
          <strong>{entryMarketCap ?? usdMarketCap}</strong>
        </div>

        <div className="targetLock">
          <div className="targetLockHead">
            <div><span>Target lock</span><strong>{lockLabel(launch, lockScore)}</strong></div>
            <b>{lockScore}<small>%</small></b>
          </div>
          <div className="lockSegments" aria-label={`Target lock ${lockScore}%`}>
            {Array.from({ length: 16 }, (_, index) => <i className={index < filledSegments ? "filled" : ""} key={index} />)}
          </div>
          <div className="lockFooter">
            <span>{launch.research_state === "target_locked" && !acquired ? "Awaiting execution" : acquired ? (launch.position_status === "closed" ? "Position closed" : "Position live") : "Ponseye monitoring"}</span>
            {acquired ? <Link href={`/launch/${launch.token_address}`}>View chart <b>↗</b></Link> : <span className="signalPrivate">Signal engine active</span>}
          </div>
        </div>
      </article>
  );
}

function LaunchLane({ title, count, tone, icon, mode, launches, empty }: {
  title: string;
  count: number;
  tone: "new" | "completing" | "completed";
  icon: string;
  mode: "sighted" | "surveillance" | "acquired";
  launches: Launch[];
  empty: string;
}) {
  return (
    <section className={`launchLane ${tone}`}>
      <header className="laneHead">
        <div><Image src={icon} alt="" width={38} height={38} /><strong>{title}</strong></div>
        <span>{count}</span>
      </header>
      <div className="launchLaneBody">
        {launches.length ? launches.map((launch) => <TokenCard key={launch.token_address} launch={launch} mode={mode} />) : (
          <div className="laneEmpty">{empty}</div>
        )}
      </div>
    </section>
  );
}

export default async function Home() {
  const { launches, streams, launchCount, researchCounts } = await getDashboardData();
  const recorderFeeds = streams.filter((stream) => currentFeeds.has(stream.feed));
  const liveFeeds = recorderFeeds.filter((stream) => stream.status === "connected").length;
  const recorderLive = liveFeeds === currentFeeds.size;
  const acquired = launches
    .filter((launch) => launch.research_state === "target_locked")
    .sort((a, b) => new Date(b.research_state_at).getTime() - new Date(a.research_state_at).getTime());
  const surveillance = launches
    .filter((launch) => launch.research_state === "under_watch")
    .sort((a, b) => new Date(b.research_state_at).getTime() - new Date(a.research_state_at).getTime());
  const sightings = launches
    .filter((launch) => launch.research_state === "sighted")
    .sort((a, b) => new Date(b.launched_at).getTime() - new Date(a.launched_at).getTime());

  return (
    <main>
      <AutoRefresh intervalMs={3_000} />
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
        </div>
      </section>

      <section className="boardSection">
        {launches.length === 0 ? (
          <div className="empty"><span className="emptyEye"><i /></span><h3>Watching for the next launch</h3><p>New PONS launches will appear here automatically when the recorder is running.</p></div>
        ) : (
          <div className="launchBoard">
            <LaunchLane title="Sighted" count={researchCounts.sighted} tone="new" icon="/ponseye-sighted-icon.svg" mode="sighted" launches={sightings} empty="Watching for a new launch" />
            <LaunchLane title="Surveillance" count={researchCounts.under_watch} tone="completing" icon="/ponseye-surveillance-icon.svg" mode="surveillance" launches={surveillance} empty="No targets under surveillance" />
            <LaunchLane title="Acquired" count={researchCounts.target_locked} tone="completed" icon="/ponseye-acquired-icon.svg" mode="acquired" launches={acquired} empty="Ponseye has not acquired a position yet" />
          </div>
        )}
        <footer className="panelFoot"><span>Ponseye is watching {launchCount.toLocaleString("en-GB")} launches</span><span>Buys appear after confirmation</span></footer>
      </section>
    </main>
  );
}
