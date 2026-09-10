import Image from "next/image";
import Link from "next/link";
import type { Launch } from "../lib/data";
import { getDashboardData } from "../lib/data";
import { quoteValue } from "../lib/market";
import { AutoRefresh } from "./auto-refresh";
import { TokenImage } from "./token-image";

export const dynamic = "force-dynamic";

const currentFeeds = new Set(["launch_activity", "curve_trades", "market_trades", "holder_snapshots"]);
const targetMeterColours = [
  "#552a94", "#6230a8", "#7036bc", "#7e3ccf",
  "#8c43e1", "#9a49ef", "#aa4ff1", "#ba54e8",
  "#ca58da", "#d95dc7", "#e663b1", "#f06b99",
  "#f6767e", "#fb8265", "#fe914f", "#ff9f43",
];

function previewLaunch(overrides: Partial<Launch> & Pick<Launch, "token_address" | "name" | "symbol" | "research_state">): Launch {
  const now = new Date();
  return {
    curve_address: "0x0000000000000000000000000000000000000000",
    image_url: null,
    deployer_address: "0x0000000000000000000000000000000000000000",
    pair_token_address: null,
    status: "active",
    launched_at: new Date(now.getTime() - 4 * 60_000).toISOString(),
    swept_at: null,
    graduated_at: null,
    trade_count: 5,
    buys: 4,
    sells: 1,
    unique_traders: 3,
    net_quote_raw: "0",
    last_trade_at: now.toISOString(),
    graduation_threshold_raw: null,
    progress_pct: null,
    volume_quote_raw: "0",
    last_quote_amount_raw: null,
    last_token_amount_raw: null,
    peak_multiple: 0.45,
    drawdown_from_peak_pct: 12,
    buy_pressure_pct: 58,
    creator_trades: 0,
    creator_sells: 0,
    first_minute_buyers: 2,
    largest_buy_quote_raw: null,
    holder_snapshot_at: null,
    holder_count: null,
    holder_change_5m: null,
    largest_holder_pct: null,
    top_10_holder_pct: 64,
    top_100_holder_pct: null,
    creator_balance_pct: 3,
    price_usd: null,
    volume_usd: null,
    market_cap_usd: 18_400,
    ath_market_cap_usd: null,
    usd_price_at: now.toISOString(),
    research_state_at: now.toISOString(),
    research_rule_version: "design-preview",
    research_reasons: [],
    ...overrides,
  };
}

function designPreviewLaunches() {
  return [
    previewLaunch({ token_address: "preview-sighted-one", name: "Neural Frog", symbol: "NFRG", research_state: "sighted", market_cap_usd: 18_400 }),
    previewLaunch({ token_address: "preview-sighted-two", name: "Blind Spot", symbol: "BLIND", research_state: "sighted", market_cap_usd: 11_900, trade_count: 2, unique_traders: 2, first_minute_buyers: 1 }),
    previewLaunch({ token_address: "preview-watch-one", name: "Signal Ghost", symbol: "EYE", research_state: "under_watch", market_cap_usd: 31_700, trade_count: 22, unique_traders: 11, first_minute_buyers: 5, peak_multiple: 1.05, buy_pressure_pct: 64 }),
    previewLaunch({ token_address: "preview-watch-two", name: "Night Circuit", symbol: "NITE", research_state: "under_watch", market_cap_usd: 26_300, trade_count: 16, unique_traders: 8, first_minute_buyers: 3, peak_multiple: 0.82, buy_pressure_pct: 59, drawdown_from_peak_pct: 24 }),
    previewLaunch({ token_address: "preview-acquired-one", name: "Open Signal", symbol: "OPEN", research_state: "target_locked", market_cap_usd: 48_600, entry_market_cap_usd: 33_200, position_status: "open" }),
    previewLaunch({ token_address: "preview-acquired-two", name: "Watchtower", symbol: "WATCH", research_state: "target_locked", market_cap_usd: 72_100, entry_market_cap_usd: 41_800, position_status: "closed" }),
  ];
}

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

function TokenCard({ launch, mode, preview = false }: { launch: Launch; mode: "sighted" | "surveillance" | "acquired"; preview?: boolean }) {
  const lockScore = targetLockScore(launch);
  const acquired = mode === "acquired";
  const usdMarketCap = launch.market_cap_usd ? quoteValue(launch.market_cap_usd, "USDG") : launch.trade_count ? "Pending USD" : "No trades yet";
  const entryMarketCap = launch.entry_market_cap_usd ? quoteValue(launch.entry_market_cap_usd, "USDG") : null;
  const gainMultiple = launch.entry_market_cap_usd && launch.market_cap_usd
    ? launch.market_cap_usd / launch.entry_market_cap_usd
    : null;
  const filledSegments = Math.ceil(lockScore / 6.25);

  return (
      <article className={`launchCard ${acquired ? "isAcquired" : ""}`}>
        <div className="cardTop">
          <div className="tokenImage">
            {preview ? <span className="tokenFallback">{launch.symbol?.slice(0, 1) ?? "?"}</span> : <TokenImage src={launch.image_url} alt={launch.name ?? "Token image"} size={64} />}
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

        <div className="targetLock">
          <div className="targetLockHead">
            <strong>{lockLabel(launch, lockScore)}</strong>
            <b>{lockScore}<small>%</small></b>
          </div>
          <div className="lockSegments" aria-label={`Target lock ${lockScore}%`}>
            {Array.from({ length: 16 }, (_, index) => {
              const filled = index < filledSegments;
              const active = index === filledSegments - 1;
              const colour = acquired ? "#9aff4f" : targetMeterColours[index];
              return <i className={`${filled ? "filled" : ""}${active ? " active" : ""}`} style={filled ? { backgroundColor: colour, borderColor: colour, boxShadow: active ? `0 0 9px ${colour}88` : undefined } : undefined} key={index} />;
            })}
          </div>
          <div className="lockFooter">
            <span>{launch.research_state === "target_locked" && !acquired ? "Awaiting execution" : acquired ? (launch.position_status === "closed" ? "Position closed" : "Position live") : "Ponseye monitoring"}</span>
            {acquired ? (preview ? <span className="chartLink">View chart <b>↗</b></span> : <Link href={`/launch/${launch.token_address}`} className="chartLink">View chart <b>↗</b></Link>) : <span className="signalPrivate">Signal engine active</span>}
          </div>
        </div>
      </article>
  );
}

function LaunchLane({ title, count, tone, icon, mode, launches, empty, preview = false }: {
  title: string;
  count: number;
  tone: "new" | "completing" | "completed";
  icon: string;
  mode: "sighted" | "surveillance" | "acquired";
  launches: Launch[];
  empty: string;
  preview?: boolean;
}) {
  return (
    <section className={`launchLane ${tone}`}>
      <header className="laneHead">
        <div><Image src={icon} alt="" width={38} height={38} /><strong>{title}</strong></div>
        <span>{count}</span>
      </header>
      <div className="launchLaneBody">
        {launches.length ? launches.map((launch) => <TokenCard key={launch.token_address} launch={launch} mode={mode} preview={preview} />) : (
          <div className="laneEmpty">{empty}</div>
        )}
      </div>
    </section>
  );
}

export default async function Home() {
  const { launches, streams, launchCount, researchCounts } = await getDashboardData();
  const showingPreview = launches.length === 0 && process.env.VERCEL_ENV === "preview";
  const visibleLaunches = showingPreview ? designPreviewLaunches() : launches;
  const recorderFeeds = streams.filter((stream) => currentFeeds.has(stream.feed));
  const liveFeeds = recorderFeeds.filter((stream) => stream.status === "connected").length;
  const recorderLive = liveFeeds === currentFeeds.size;
  const acquired = visibleLaunches
    .filter((launch) => launch.research_state === "target_locked")
    .sort((a, b) => new Date(b.research_state_at).getTime() - new Date(a.research_state_at).getTime());
  const surveillance = visibleLaunches
    .filter((launch) => launch.research_state === "under_watch")
    .sort((a, b) => new Date(b.research_state_at).getTime() - new Date(a.research_state_at).getTime());
  const sightings = visibleLaunches
    .filter((launch) => launch.research_state === "sighted")
    .sort((a, b) => new Date(b.launched_at).getTime() - new Date(a.launched_at).getTime());

  return (
    <main>
      <AutoRefresh intervalMs={3_000} />
      <header className="header">
        <div className="systemMeta">
          <span>Robinhood Chain</span>
          <div className={`recorder ${recorderLive ? "live" : "offline"}`}><i /> {showingPreview ? "Design preview" : recorderLive ? "Recorder live" : "Recorder paused"}</div>
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
        {visibleLaunches.length === 0 ? (
          <div className="empty"><span className="emptyEye"><i /></span><h3>Watching for the next launch</h3><p>New PONS launches will appear here automatically when the recorder is running.</p></div>
        ) : (
          <div className="launchBoard">
            <LaunchLane title="Sighted" count={showingPreview ? sightings.length : researchCounts.sighted} tone="new" icon="/ponseye-sighted-icon.svg" mode="sighted" launches={sightings} empty="Watching for a new launch" preview={showingPreview} />
            <LaunchLane title="Surveillance" count={showingPreview ? surveillance.length : researchCounts.under_watch} tone="completing" icon="/ponseye-surveillance-icon.svg" mode="surveillance" launches={surveillance} empty="No targets under surveillance" preview={showingPreview} />
            <LaunchLane title="Acquired" count={showingPreview ? acquired.length : researchCounts.target_locked} tone="completed" icon="/ponseye-acquired-icon.svg" mode="acquired" launches={acquired} empty="Ponseye has not acquired a position yet" preview={showingPreview} />
          </div>
        )}
        <footer className="panelFoot"><span>{showingPreview ? "Sample tokens shown for design" : `Ponseye is watching ${launchCount.toLocaleString("en-GB")} launches`}</span><span>{showingPreview ? "Interface preview only" : "Buys appear after confirmation"}</span></footer>
      </section>
    </main>
  );
}
