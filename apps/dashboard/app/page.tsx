import Image from "next/image";
import Link from "next/link";
import type { Launch } from "../lib/data";
import { getDashboardData } from "../lib/data";
import { quoteValue } from "../lib/market";
import { AutoRefresh } from "./auto-refresh";
import { LaunchMotionController, LaunchMotionPreview } from "./launch-motion";
import { MobileLaneTabs } from "./mobile-lane-tabs";
import { TokenImage } from "./token-image";

export const dynamic = "force-dynamic";

const currentFeeds = new Set(["bitquery_migration_test"]);
const targetMeterColours = [
  "#552a94", "#6230a8", "#7036bc", "#7e3ccf",
  "#8c43e1", "#9a49ef", "#aa4ff1", "#ba54e8",
  "#ca58da", "#d95dc7", "#e663b1", "#f06b99",
  "#f6767e", "#fb8265", "#fe914f", "#ff9f43",
];

function age(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function targetLockScore(launch: Launch, mode: "sighted" | "surveillance" | "acquired") {
  if (launch.research_state === "target_locked") return 100;

  if (mode === "sighted") {
    // Sighted represents progress towards the first surveillance gate. Avoid
    // awarding near-complete scores for a single buy simply because pressure,
    // peak hold and creator safety all look perfect on a one-trade sample.
    const tradeProgress = Math.min(1, launch.trade_count / 12) * 14;
    const traderProgress = Math.min(1, launch.unique_traders / 6) * 14;
    const earlyProgress = Math.min(1, launch.first_minute_buyers / 3) * 8;
    const pressureProgress = launch.trade_count >= 3
      ? Math.min(1, Math.max(0, ((launch.buy_pressure_pct ?? 0) - 40) / 12)) * 8
      : 0;
    const creatorProgress = launch.trade_count >= 3 && launch.creator_sells === 0 ? 5 : 0;
    return Math.min(49, Math.round(tradeProgress + traderProgress + earlyProgress + pressureProgress + creatorProgress));
  }

  const peakHoldPct = launch.drawdown_from_peak_pct == null ? null : 100 - launch.drawdown_from_peak_pct;
  const momentumMultiple = launch.peak_multiple != null && peakHoldPct != null
    ? launch.peak_multiple * peakHoldPct / 100
    : null;
  const earlyBuyerShare = launch.unique_traders > 0
    ? launch.first_minute_buyers * 100 / launch.unique_traders
    : null;
  let availableWeight = 105;
  if (momentumMultiple != null) availableWeight += 20;
  if (peakHoldPct != null) availableWeight += 15;
  if (launch.top_10_holder_pct != null) availableWeight += 10;
  const passedWeight =
    (launch.trade_count >= 12 ? 15 : 0) +
    (launch.unique_traders >= 12 ? 15 : 0) +
    ((launch.buy_pressure_pct ?? 0) >= 65 ? 10 : 0) +
    (launch.first_minute_buyers >= 8 ? 15 : 0) +
    (momentumMultiple != null && momentumMultiple >= .75 ? 20 : 0) +
    (peakHoldPct != null && peakHoldPct >= 70 ? 15 : 0) +
    (launch.top_10_holder_pct != null && launch.top_10_holder_pct <= 90 ? 10 : 0) +
    ((launch.market_cap_usd ?? 0) >= 5_000 ? 25 : 0) +
    (earlyBuyerShare != null && earlyBuyerShare >= 50 ? 25 : 0);
  const score = availableWeight ? passedWeight * 100 / availableWeight : 0;

  const rawScore = Math.min(99, Math.round(score));
  if (mode === "surveillance") return rawScore;
  return rawScore;
}

function lockLabel(launch: Launch, score: number, mode: "sighted" | "surveillance" | "acquired") {
  if (launch.research_state === "target_locked") return "Target locked";
  if (mode === "sighted") return "Sighted";
  if (score >= 80) return "Final checks";
  if (score >= 48) return "Tracking";
  return "Scanning";
}

function TokenCard({ launch, mode, imagePriority = false }: { launch: Launch; mode: "sighted" | "surveillance" | "acquired"; imagePriority?: boolean }) {
  const lockScore = targetLockScore(launch, mode);
  const acquired = mode === "acquired";
  const positionClosed = launch.position_status === "closed" || Boolean(launch.closed_at);
  const valuationMarketCap = positionClosed ? launch.exit_market_cap_usd : launch.market_cap_usd;
  const usdMarketCap = valuationMarketCap ? quoteValue(valuationMarketCap, "USDG") : launch.trade_count ? "Pending USD" : "Measuring";
  const entryMarketCap = launch.entry_market_cap_usd ? quoteValue(launch.entry_market_cap_usd, "USDG") : null;
  const priceGainMultiple = launch.entry_market_cap_usd && valuationMarketCap
    ? valuationMarketCap / launch.entry_market_cap_usd
    : null;
  const gainMultiple = launch.position_value_multiple ?? priceGainMultiple;
  const positionLoss = gainMultiple != null && gainMultiple < 1;
  const filledSegments = Math.ceil(lockScore / 6.25);

  const card = (
      <article className={`launchCard ${acquired ? "isAcquired" : "isCompact"}`}>
        <div className="cardTop">
          <div className="tokenImage">
            <TokenImage src={launch.image_url} alt={launch.name ?? "Token image"} size={64} priority={imagePriority} />
          </div>
          <div className="cardContent">
            <div className="cardTitleRow">
              <div className="tokenIdentity">
                <strong>{launch.name ?? "Metadata pending"}</strong>
                <span>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Unknown ticker"}</span>
              </div>
              <div className="cardMetaStack">
                <time>{age(launch.launched_at)}</time>
                {acquired ? <span className={`positionBadge ${positionClosed ? "closed" : "live"}`}>{positionClosed ? "Closed" : "Open"}</span> : null}
              </div>
            </div>
          </div>
        </div>

        {acquired ? (
          <div className="acquiredMetrics">
            <div><span>Entry MC</span><strong>{entryMarketCap ?? "Pending"}</strong></div>
            <div><span>{positionClosed ? "Exit MC" : "Current MC"}</span><strong>{usdMarketCap}</strong></div>
            <div className="gainMetric"><span>Gains</span><strong>{gainMultiple ? `${gainMultiple.toFixed(2)}x` : "Pending"}</strong></div>
          </div>
        ) : (
          <div className="cardMarketCap">
            <span>Market cap</span>
            <strong>{usdMarketCap}</strong>
          </div>
        )}

        {acquired ? (
          <div className={`positionMonitor ${positionClosed ? "closed" : "live"} ${positionLoss ? "loss" : "profit"}`}>
            <div className="positionMonitorFooter">
              <span><i />{positionClosed ? "Position closed" : "Position open"}</span>
              <strong className={positionLoss ? "gainDown" : "gainUp"}>{positionLoss ? "↓" : "↑"} {gainMultiple ? `${gainMultiple.toFixed(2)}x` : "Pending"}</strong>
            </div>
          </div>
        ) : (
          <div className="targetLock">
            <div className="targetLockHead">
              <strong>{lockLabel(launch, lockScore, mode)}</strong>
              <b>{lockScore}<small>%</small></b>
            </div>
            <div className="lockSegments" aria-label={`Target lock ${lockScore}%`}>
              {Array.from({ length: 16 }, (_, index) => {
                const filled = index < filledSegments;
                const active = index === filledSegments - 1;
                const colour = targetMeterColours[index];
                return <i className={`${filled ? "filled" : ""}${active ? " active" : ""}`} style={filled ? { backgroundColor: colour, borderColor: colour, boxShadow: active ? `0 0 9px ${colour}88` : undefined } : undefined} key={index} />;
              })}
            </div>
            <div className="lockFooter">
              <span>{launch.research_state === "target_locked" ? "Awaiting execution" : "Ponseye monitoring"}</span>
              <span className="signalPrivate">{mode === "sighted" ? "Watching post migration" : "Surveillance active"}</span>
            </div>
          </div>
        )}
      </article>
  );

  const motionData = {
    "data-token": launch.token_address,
    "data-state": launch.research_state,
    "data-launched-at": launch.launched_at,
  };

  return <div className="launchCardLink launchCardStatic" {...motionData}>{card}</div>;
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
    <section className={`launchLane ${tone}`} id={`lane-${mode}`}>
      <header className="laneHead">
        <div><Image src={icon} alt="" width={38} height={38} /><strong>{title}</strong></div>
        <span>{count}</span>
      </header>
      <div className="launchLaneBody">
        {launches.length ? launches.map((launch, index) => <TokenCard key={launch.token_address} launch={launch} mode={mode} imagePriority={index < 2} />) : (
          <div className="laneEmpty">{empty}</div>
        )}
      </div>
    </section>
  );
}

export default async function Home() {
  const { launches, streams, launchCount } = await getDashboardData();
  const recorderFeeds = streams.filter((stream) => currentFeeds.has(stream.feed));
  const liveFeeds = recorderFeeds.filter((stream) => stream.status === "connected").length;
  const recorderLive = liveFeeds === currentFeeds.size;
  const acquired = launches
    // Acquired holds a day. The full ledger lives on Capital Circuit.
    .filter((launch) => launch.research_state === "target_locked" && Date.now() - new Date(launch.launched_at).getTime() < 24 * 60 * 60_000)
    .sort((a, b) => new Date(b.research_state_at).getTime() - new Date(a.research_state_at).getTime());
  const surveillance = launches
    .filter((launch) => launch.research_state === "under_watch")
    .sort((a, b) => new Date(b.research_state_at).getTime() - new Date(a.research_state_at).getTime());
  const sightings = launches
    .filter((launch) => launch.research_state === "sighted")
    .sort((a, b) => new Date(b.launched_at).getTime() - new Date(a.launched_at).getTime());

  return (
    <main className="homePage">
      <AutoRefresh intervalMs={3_000} />
      <LaunchMotionController />
      <header className="header">
        <div className="headerBrand">
          <Image className="headerMark" src="/ponseye-screen-icon-mark.png" alt="" width={256} height={256} priority />
          <Image className="headerWordmark" src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
        </div>
        <div className="headerActions">
          <nav className="headerSocials" aria-label="Market and social links">
            <a href="https://x.com/" target="_blank" rel="noreferrer" aria-label="X">
              <Image src="/social-x.png" alt="" width={112} height={112} />
            </a>
            <a href="https://dexscreener.com/" target="_blank" rel="noreferrer" aria-label="Dexscreener">
              <Image src="/social-dexscreener.png" alt="" width={112} height={112} />
            </a>
          </nav>
          <details className="pixelMenu">
            <summary aria-label="Open navigation"><i /><i /><i /></summary>
            <nav aria-label="Main navigation">
              <Link href="/">Launch board</Link>
              <Link href="/lab">Testing lab</Link>
              <Link href="/lab/database">Token database</Link>
              <Link href="/targets">Capital circuit</Link>
              <LaunchMotionPreview />
              <div className="mobileMenuSocials" aria-label="Market and social links">
                <a href="https://x.com/" target="_blank" rel="noreferrer" aria-label="X"><Image src="/social-x.png" alt="" width={112} height={112} /></a>
                <a href="https://dexscreener.com/" target="_blank" rel="noreferrer" aria-label="Dexscreener"><Image src="/social-dexscreener.png" alt="" width={112} height={112} /></a>
              </div>
            </nav>
          </details>
        </div>
      </header>

      <div className="boardStage">
        <div className="boardUtility">
          <span className="chainLabel"><Image src="/robinhood-feather.svg" alt="" width={24} height={24} />Robinhood Chain</span>
          <span className="consoleAwait"><i />{recorderLive ? "Surveillance continues" : "Waiting for recorder start"}</span>
        </div>
        <Link href="/targets" className="capitalCircuitLink">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 18.5V5.5M3 18.5H21" />
            <path className="circuitTrace" d="M5.5 15.5L9 12l3 2 6.5-7" />
            <path className="circuitArrow" d="M15.5 7h3v3" />
          </svg>
          <span>Capital circuit</span>
        </Link>
        <section className="boardSection">
          <MobileLaneTabs counts={{ sighted: sightings.length, surveillance: surveillance.length, acquired: acquired.length }} />
          <div className="launchBoard">
            <LaunchLane title="Sighted" count={sightings.length} tone="new" icon="/ponseye-sighted-icon.svg" mode="sighted" launches={sightings} empty="Watching for the next PONS migration" />
            <LaunchLane title="Surveilling" count={surveillance.length} tone="completing" icon="/ponseye-surveillance-icon.svg" mode="surveillance" launches={surveillance} empty="No targets under surveillance" />
            <LaunchLane title="Acquired" count={acquired.length} tone="completed" icon="/ponseye-acquired-icon.svg" mode="acquired" launches={acquired} empty="No targets acquired yet" />
          </div>
          <footer className="panelFoot"><span>Ponseye is watching {launchCount.toLocaleString("en-GB")} tokens</span><span>Targets appear after dip confirmation</span></footer>
        </section>
      </div>
    </main>
  );
}
