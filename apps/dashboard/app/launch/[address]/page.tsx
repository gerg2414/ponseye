import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLaunchDetail, type LaunchRecord, type MarketTrade } from "../../../lib/data";
import { quoteValue } from "../../../lib/market";
import { TokenImage } from "../../token-image";
import { CopyField } from "./copy-field";
import { LaunchBackLink } from "./launch-back-link";
import { PonsEyeChart } from "./ponseye-chart";

export const revalidate = 5;

export const metadata: Metadata = {
  title: "Position Tracker | PonsEye",
  description: "Follow PonsEye's autonomous position from entry to exit.",
};

type PositionLinkKind = "gmgn" | "website" | "x" | "telegram" | "discord";
type TradeMetricKind = "size" | "entry" | "value" | "pnl" | "roi" | "peak" | "time";

function TradeMetricIcon({ kind }: { kind: TradeMetricKind }) {
  if (kind === "size") return <svg viewBox="0 0 20 20" shapeRendering="crispEdges"><path d="M3 5h14v11H3zM6 3h8v2H6zM5 8h10v2H5zm0 4h5v2H5z" /></svg>;
  if (kind === "entry") return <svg viewBox="0 0 20 20" shapeRendering="crispEdges"><path d="M3 15h14v2H3zM5 13V9h3V6h3V3h4v2h-2v3h-3v3H7v2z" /></svg>;
  if (kind === "value") return <svg viewBox="0 0 20 20" shapeRendering="crispEdges"><path d="M4 3h12v14H4zM6 5v2h8V5zm0 4v2h5V9zm0 4v2h8v-2z" /></svg>;
  if (kind === "pnl") return <svg viewBox="0 0 20 20" shapeRendering="crispEdges"><path d="M3 16V4h2v9l4-4 3 2 4-6h2v4h-2V8l-4 6-3-2-4 4z" /></svg>;
  if (kind === "roi") return <svg viewBox="0 0 20 20" shapeRendering="crispEdges"><path d="M4 4h4v4H4zm8 8h4v4h-4zM14 3h3L6 17H3z" /></svg>;
  if (kind === "peak") return <svg viewBox="0 0 20 20" shapeRendering="crispEdges"><path d="M2 16l5-8 3 4 4-8 4 12h-3l-2-6-3 6-3-4-2 4z" /></svg>;
  return <svg viewBox="0 0 20 20" shapeRendering="crispEdges"><path d="M4 3h12v14H4zM6 1h2v4H6zm6 0h2v4h-2zM6 8h3v3H6zm5 0h3v3h-3zM6 13h3v2H6z" /></svg>;
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function PixelLinkIcon({ kind }: { kind: PositionLinkKind }) {
  if (kind === "gmgn") return <svg viewBox="0 0 16 16" shapeRendering="crispEdges"><path d="M2 2h12v3H5v6h6V9H8V6h6v8H2z" /></svg>;
  if (kind === "website") return <svg viewBox="0 0 16 16" shapeRendering="crispEdges"><path d="M3 1h10v2h2v10h-2v2H3v-2H1V3h2zm2 2v2h6V3zm-2 4v2h10V7zm2 4v2h6v-2z" /></svg>;
  if (kind === "x") return <svg viewBox="0 0 16 16" shapeRendering="crispEdges"><path d="M2 2h3l3 4 3-4h3L9.5 8 14 14h-3l-3-4-3 4H2l4.5-6z" /></svg>;
  if (kind === "telegram") return <svg viewBox="0 0 16 16" shapeRendering="crispEdges"><path d="M1 7l14-6-3 14-4-4-3 3V10zm4 2l3 1 4-5z" /></svg>;
  return <svg viewBox="0 0 16 16" shapeRendering="crispEdges"><path d="M3 3h2V2h6v1h2l2 9h-3v2H4v-2H1zm3 5v2h2V8zm4 0v2h2V8z" /></svg>;
}

const previewPositions = {
  "preview-acquired-one": { name: "Open Signal", symbol: "OPEN", entry: 33_200, current: 48_600, closed: false },
  "preview-acquired-two": { name: "Watchtower", symbol: "WATCH", entry: 41_800, current: 72_100, closed: true },
} as const;

function previewLaunchDetail(address: keyof typeof previewPositions) {
  const position = previewPositions[address];
  const end = Date.now();
  const start = end - 74 * 60_000;
  const acquiredAt = new Date(start + 22 * 60_000).toISOString();
  const closedAt = position.closed ? new Date(start + 62 * 60_000).toISOString() : null;
  const marketTrades: MarketTrade[] = Array.from({ length: 75 }, (_, index) => {
    const progress = index / 74;
    const base = 17_800 + (position.current - 17_800) * progress;
    const pulse = Math.sin(index * 0.72) * 2_600 + Math.sin(index * 0.19) * 1_400;
    const lateMove = position.closed && index > 62 ? -(index - 62) * 320 : 0;
    const marketCap = Math.max(12_000, base + pulse + lateMove);
    return {
      market_event_id: `preview-${index}`,
      transaction_hash: `0x${index.toString(16).padStart(64, "0")}`,
      block_time: new Date(start + index * 60_000).toISOString(),
      side: index % 4 === 0 ? "sell" : "buy",
      trader_address: null,
      price_usd: marketCap / 1_000_000_000,
      base_amount_usd: 250 + index * 11,
      quote_amount_usd: 250 + index * 11,
      protocol: "pons_v2",
    };
  });

  const launch: LaunchRecord = {
    token_address: address,
    curve_address: "0x8e5d2dff0e240f331933c8a839e2df2d65d01ec4",
    name: position.name,
    symbol: position.symbol,
    image_url: null,
    deployer_address: "0x45d416dce3b69353fdbbdc9ebfc6e03194083c11",
    pair_token_address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    status: position.closed ? "closed" : "active",
    launched_at: new Date(start).toISOString(),
    swept_at: null,
    graduated_at: null,
    trade_count: 184,
    buys: 132,
    sells: 52,
    unique_traders: 68,
    net_quote_raw: "0",
    last_trade_at: new Date(end).toISOString(),
    graduation_threshold_raw: null,
    progress_pct: 100,
    volume_quote_raw: "0",
    last_quote_amount_raw: null,
    last_token_amount_raw: null,
    peak_multiple: position.current / position.entry,
    drawdown_from_peak_pct: position.closed ? 8.4 : 3.1,
    buy_pressure_pct: 71.7,
    creator_trades: 0,
    creator_sells: 0,
    first_minute_buyers: 14,
    largest_buy_quote_raw: null,
    holder_snapshot_at: new Date(end).toISOString(),
    holder_count: 347,
    holder_change_5m: 18,
    largest_holder_pct: 8.1,
    top_10_holder_pct: 42.6,
    top_100_holder_pct: 78.4,
    creator_balance_pct: 0,
    price_usd: position.current / 1_000_000_000,
    volume_usd: 186_400,
    market_cap_usd: position.current,
    ath_market_cap_usd: position.current * 1.08,
    usd_price_at: new Date(end).toISOString(),
    research_state: "target_locked",
    research_state_at: acquiredAt,
    research_rule_version: "design-preview",
    research_reasons: [],
    acquired_at: acquiredAt,
    closed_at: closedAt,
    entry_market_cap_usd: position.entry,
    position_status: position.closed ? "closed" : "open",
    description: "A sample PonsEye position showing the autonomous entry and position lifecycle on the market cap chart.",
    twitter_url: null,
    telegram_url: null,
    discord_url: null,
    website_url: null,
  };

  return { launch, trades: [], marketTrades, chartCandles: [], bondPriceUsd: null, poolStartedAt: null };
}

export default async function LaunchPage({ params, searchParams }: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ entry?: string; entryMc?: string }>;
}) {
  const [{ address }, query] = await Promise.all([params, searchParams]);
  const previewAddress = address as keyof typeof previewPositions;
  const isPreview = previewAddress in previewPositions;
  if (!isPreview && !/^0x[0-9a-f]{40}$/i.test(address)) notFound();

  const detail = isPreview ? previewLaunchDetail(previewAddress) : await getLaunchDetail(address.toLowerCase());
  if (!detail) notFound();

  const { launch, marketTrades, chartCandles, bondPriceUsd } = detail;
  const isAcquired = launch.research_state === "target_locked" || Boolean(launch.acquired_at || launch.position_status);
  if (!isPreview && !isAcquired) notFound();
  const usd = (value: number | null) => value && value > 0 ? quoteValue(value, "USDG") : "No price yet";
  const money = (value: number | null) => value == null || !Number.isFinite(value)
    ? "Pending"
    : new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const timestamp = (value: string | null) => value
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value)) + " UTC"
    : "Pending";
  const requestedEntryAt = query.entry && Number.isFinite(Date.parse(query.entry)) ? query.entry : null;
  const requestedEntryMarketCap = query.entryMc && Number(query.entryMc) > 0 ? Number(query.entryMc) : null;
  const entryMarketCap = requestedEntryMarketCap ?? launch.entry_market_cap_usd ?? null;
  const entryAt = requestedEntryAt ?? launch.acquired_at ?? (launch.research_state === "target_locked" ? launch.research_state_at : null);
  const closed = launch.position_status === "closed" || Boolean(launch.closed_at);
  const currentMarketCap = closed ? launch.exit_market_cap_usd ?? launch.market_cap_usd ?? null : launch.market_cap_usd ?? null;
  const gainMultiple = entryMarketCap && currentMarketCap ? currentMarketCap / entryMarketCap : null;
  const peakMultiple = entryMarketCap && launch.ath_market_cap_usd ? launch.ath_market_cap_usd / entryMarketCap : null;
  const acquired = Boolean(entryAt && entryMarketCap && entryMarketCap > 0);
  const gainTone = gainMultiple != null && gainMultiple < 1 ? "negative" : "positive";
  const positionSizeUsd = 25;
  const positionValueUsd = gainMultiple == null ? null : positionSizeUsd * gainMultiple;
  const pnlUsd = positionValueUsd == null ? null : positionValueUsd - positionSizeUsd;
  const roiPct = gainMultiple == null ? null : (gainMultiple - 1) * 100;
  const websiteUrl = safeExternalUrl(launch.website_url);
  const xUrl = safeExternalUrl(launch.twitter_url);
  const telegramUrl = safeExternalUrl(launch.telegram_url);
  const discordUrl = safeExternalUrl(launch.discord_url);
  const positionLinks: Array<{ kind: PositionLinkKind; label: string; href: string }> = [
    { kind: "gmgn", label: "Open on GMGN", href: `https://gmgn.ai/robinhood/token/${launch.token_address}` },
    ...(websiteUrl ? [{ kind: "website" as const, label: "Website", href: websiteUrl }] : []),
    ...(xUrl ? [{ kind: "x" as const, label: "X", href: xUrl }] : []),
    ...(telegramUrl ? [{ kind: "telegram" as const, label: "Telegram", href: telegramUrl }] : []),
    ...(discordUrl ? [{ kind: "discord" as const, label: "Discord", href: discordUrl }] : []),
  ];

  return (
    <main className="launchPage positionPage">
      <header className="labNav launchLabNav">
        <div className="labBrand">
          <Link href="/" aria-label="PonsEye dashboard">
            <Image src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
          </Link>
        </div>
        <nav className="labNavLinks" aria-label="Chart navigation">
          <LaunchBackLink />
          <Link className="backLink" href="/lab">Testing Lab <b>↗</b></Link>
          <Link className="backLink" href="/lab/database">Token database <b>↗</b></Link>
          <Link className="backLink" href="/">Launch dashboard <b>↗</b></Link>
        </nav>
      </header>

      <section className="positionHero">
        <div className="launchIdentity">
          <div className="detailTokenImage">
            <TokenImage src={launch.image_url} alt={launch.name ?? "Token image"} size={92} priority />
          </div>
          <div className="launchIdentityCopy">
            <h1>{launch.name ?? "Unnamed token"}</h1>
            <div className="tokenSubline">
              <span>{launch.symbol ? `${launch.symbol.replace(/^\$/, "")}` : "Unknown ticker"}</span>
              <b>◈</b>
              <span>Robinhood Chain</span>
            </div>
            <div className="positionResources">
              <div className="positionContract">
                <span>CA</span>
                <CopyField value={launch.token_address} />
              </div>
              <nav className="positionLinks" aria-label="Token links">
                {positionLinks.map((link) => (
                  <a key={link.kind} href={link.href} target="_blank" rel="noreferrer" aria-label={link.label} title={link.label}>
                    <PixelLinkIcon kind={link.kind} />
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </section>

      <section className="positionTerminal">
        <section className="positionChartPanel">
          <header>
            <div><strong>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Token"}</strong></div>
            <div className="positionLegend" aria-label="Position chart markers">
              <span className="buy"><i>↑</i> Ponseye buy</span>
              {closed ? <span className="exit"><i>↓</i> Position closed</span> : <span className="tracking"><i /> Tracking live</span>}
            </div>
          </header>
          <div className="positionChartFrame">
            <PonsEyeChart
              trades={marketTrades}
              candles={chartCandles}
              tokenAddress={launch.token_address}
              graduatedAt={launch.graduated_at}
              bondPriceUsd={bondPriceUsd}
              acquiredAt={entryAt}
              closedAt={launch.closed_at ?? null}
              entryMarketCap={entryMarketCap}
            />
          </div>
        </section>

        <aside className="positionTradeRail">
          <header>
            <div><small>Trade summary</small><strong>{closed ? "Closed position" : "Open position"}</strong></div>
            <span className={closed ? "closed" : "live"}><i />{closed ? "Closed" : "Live"}</span>
          </header>
          <div className="positionTradeMetrics">
            <article><i><TradeMetricIcon kind="size" /></i><div><span>Position size</span><strong>{money(positionSizeUsd)}</strong></div></article>
            <article><i><TradeMetricIcon kind="entry" /></i><div><span>Entry market cap</span><strong>{usd(entryMarketCap)}</strong></div></article>
            <article><i><TradeMetricIcon kind="value" /></i><div><span>{closed ? "Returned" : "Current value"}</span><strong>{money(positionValueUsd)}</strong></div></article>
            <article className={gainTone}><i><TradeMetricIcon kind="pnl" /></i><div><span>Net P&amp;L</span><strong>{pnlUsd != null && pnlUsd >= 0 ? "+" : ""}{money(pnlUsd)}</strong></div></article>
            <article className={gainTone}><i><TradeMetricIcon kind="roi" /></i><div><span>ROI</span><strong>{roiPct == null ? "Pending" : `${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(1)}%`}</strong></div></article>
            <article><i><TradeMetricIcon kind="peak" /></i><div><span>Peak market cap</span><strong>{usd(launch.ath_market_cap_usd)}</strong><small>{peakMultiple ? `${peakMultiple.toFixed(2)}x from entry` : "Peak pending"}</small></div></article>
            <article className="tradeTime"><i><TradeMetricIcon kind="time" /></i><div><span>{closed ? "Exited" : "Entered"}</span><strong>{timestamp(closed ? launch.closed_at ?? null : entryAt)}</strong></div></article>
          </div>
        </aside>
      </section>
    </main>
  );
}
