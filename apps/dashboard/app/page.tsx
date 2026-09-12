import Image from "next/image";
import Link from "next/link";
import type { Launch } from "../lib/data";
import { getDashboardData } from "../lib/data";
import { quoteValue } from "../lib/market";
import { AutoRefresh } from "./auto-refresh";
import { LaunchMotionController, LaunchMotionPreview } from "./launch-motion";
import { TokenImage } from "./token-image";

export const dynamic = "force-dynamic";

const currentFeeds = new Set(["launch_activity", "curve_trades", "market_trades", "holder_snapshots", "gmgn_shadow"]);
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

function targetLockScore(launch: Launch) {
  if (launch.research_state === "target_locked") return 100;

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

  return Math.round(score);
}

function lockLabel(launch: Launch, score: number) {
  if (launch.research_state === "target_locked") return "Target locked";
  if (score >= 80) return "Final checks";
  if (score >= 48) return "Tracking";
  return "Scanning";
}

function TokenCard({ launch, mode }: { launch: Launch; mode: "sighted" | "surveillance" | "acquired" }) {
  const lockScore = targetLockScore(launch);
  const acquired = mode === "acquired";
  const positionClosed = launch.position_status === "closed" || Boolean(launch.closed_at);
  const usdMarketCap = launch.market_cap_usd ? quoteValue(launch.market_cap_usd, "USDG") : launch.trade_count ? "Pending USD" : "No trades yet";
  const entryMarketCap = launch.entry_market_cap_usd ? quoteValue(launch.entry_market_cap_usd, "USDG") : null;
  const gainMultiple = launch.entry_market_cap_usd && launch.market_cap_usd
    ? launch.market_cap_usd / launch.entry_market_cap_usd
    : null;
  const positionLoss = gainMultiple != null && gainMultiple < 1;
  const positionGradientId = `position-fill-${launch.token_address.replace(/[^a-z0-9-]/gi, "")}`;
  const filledSegments = Math.ceil(lockScore / 6.25);

  const card = (
      <article className={`launchCard ${acquired ? "isAcquired" : "isCompact"}`}>
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
            <div><span>Current MC</span><strong>{usdMarketCap}</strong></div>
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
            <svg viewBox="0 0 320 72" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={positionGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positionLoss ? "#ff718c" : "#9aff4f"} stopOpacity=".34" />
                  <stop offset="100%" stopColor={positionLoss ? "#ff718c" : "#9aff4f"} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className="positionGrid" d="M0 18H320M0 36H320M0 54H320M64 0V72M128 0V72M192 0V72M256 0V72" />
              <path className="positionFill" style={{ fill: `url(#${positionGradientId})` }} d={positionLoss ? "M0 28L32 24L64 31L96 27L128 42L160 36L192 50L224 45L256 56L288 51L320 59V72H0Z" : "M0 58L32 51L64 54L96 40L128 45L160 31L192 36L224 20L256 25L288 13L320 9V72H0Z"} />
              <polyline className="positionLine" points={positionLoss ? "0,28 32,24 64,31 96,27 128,42 160,36 192,50 224,45 256,56 288,51 320,59" : "0,58 32,51 64,54 96,40 128,45 160,31 192,36 224,20 256,25 288,13 320,9"} />
              <circle className="positionEnd" cx="318" cy={positionLoss ? "59" : "9"} r="4" />
            </svg>
            <div className="positionMonitorFooter">
              <span><i />{positionClosed ? "Position closed" : "Position open"}</span>
              <span className="chartLink">View chart <b>↗</b></span>
            </div>
          </div>
        ) : (
          <div className="targetLock">
            <div className="targetLockHead">
              <strong>{lockLabel(launch, lockScore)}</strong>
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
              <span className="signalPrivate">{mode === "sighted" ? "Awaiting surveillance" : "Surveillance active"}</span>
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

  return acquired ? (
    <Link className="launchCardLink" href={`/launch/${launch.token_address}`} {...motionData}>{card}</Link>
  ) : (
    <div className="launchCardLink launchCardStatic" {...motionData}>{card}</div>
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
  const { launches, streams, launchCount } = await getDashboardData();
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
            <a href="https://gmgn.ai/" target="_blank" rel="noreferrer" aria-label="GMGN">
              <Image src="/social-gmgn.png" alt="" width={112} height={112} />
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
                <a href="https://gmgn.ai/" target="_blank" rel="noreferrer" aria-label="GMGN"><Image src="/social-gmgn.png" alt="" width={112} height={112} /></a>
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
          <div className="launchBoard">
            <LaunchLane title="Sighted" count={sightings.length} tone="new" icon="/ponseye-sighted-icon.svg" mode="sighted" launches={sightings} empty="Watching for a new launch" />
            <LaunchLane title="Surveilling" count={surveillance.length} tone="completing" icon="/ponseye-surveillance-icon.svg" mode="surveillance" launches={surveillance} empty="No targets under surveillance" />
            <LaunchLane title="Acquired" count={acquired.length} tone="completed" icon="/ponseye-acquired-icon.svg" mode="acquired" launches={acquired} empty="No targets acquired yet" />
          </div>
          <footer className="panelFoot"><span>Ponseye is watching {launchCount.toLocaleString("en-GB")} launches</span><span>Targets appear after confirmation</span></footer>
        </section>
      </div>
    </main>
  );
}
