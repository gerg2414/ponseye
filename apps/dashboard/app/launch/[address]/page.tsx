import type { Metadata } from "next";
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
  const usd = (value: number | null) => value && value > 0 ? quoteValue(value, "USDG") : "No price yet";
  const requestedEntryAt = query.entry && Number.isFinite(Date.parse(query.entry)) ? query.entry : null;
  const requestedEntryMarketCap = query.entryMc && Number(query.entryMc) > 0 ? Number(query.entryMc) : null;
  const entryMarketCap = requestedEntryMarketCap ?? launch.entry_market_cap_usd ?? null;
  const entryAt = requestedEntryAt ?? launch.acquired_at ?? (launch.research_state === "target_locked" ? launch.research_state_at : null);
  const currentMarketCap = launch.market_cap_usd ?? null;
  const gainMultiple = entryMarketCap && currentMarketCap ? currentMarketCap / entryMarketCap : null;
  const peakMultiple = entryMarketCap && launch.ath_market_cap_usd ? launch.ath_market_cap_usd / entryMarketCap : null;
  const closed = launch.position_status === "closed" || Boolean(launch.closed_at);
  const acquired = Boolean(entryAt && entryMarketCap && entryMarketCap > 0);
  const gainTone = gainMultiple != null && gainMultiple < 1 ? "negative" : "positive";
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
      <header className="launchNav">
        <LaunchBackLink />
        <div className={`positionNavStatus ${closed ? "closed" : acquired ? "live" : "watching"}`}><i /> {closed ? "Position closed" : acquired ? "Position live" : "Tracked token"}</div>
      </header>

      <section className="positionHero">
        <div className="launchIdentity">
          <div className="detailTokenImage">
            <TokenImage src={launch.image_url} alt={launch.name ?? "Token image"} size={92} priority />
          </div>
          <div className="launchIdentityCopy">
            <span className="positionEyebrow">{acquired ? "PonsEye acquired" : "PonsEye tracked"}</span>
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
        {acquired ? (
          <aside className={`positionMultiple ${gainTone}`}>
            <span>{closed ? "Final return" : "Current return"}</span>
            <strong>{gainMultiple ? `${gainMultiple.toFixed(2)}x` : "No return yet"}</strong>
            <small>{closed ? "Position banked" : "Ponseye is still holding"}</small>
          </aside>
        ) : (
          <aside className="positionMultiple">
            <span>Peak market cap</span>
            <strong>{usd(launch.ath_market_cap_usd)}</strong>
            <small>Observed by PonsEye</small>
          </aside>
        )}
      </section>

      <section className="positionStats">
        {acquired ? <>
          <article><span>Entry MC</span><strong>{usd(entryMarketCap)}</strong></article>
          <article><span>{closed ? "Exit MC" : "Current MC"}</span><strong>{usd(currentMarketCap)}</strong></article>
          <article className={gainTone}><span>{closed ? "Banked" : "Gains"}</span><strong>{gainMultiple ? `${gainMultiple.toFixed(2)}x` : "No return yet"}</strong></article>
          <article><span>Peak MC</span><strong>{usd(launch.ath_market_cap_usd)}</strong><small>{peakMultiple ? `${peakMultiple.toFixed(2)}x from entry` : "Peak tracking"}</small></article>
        </> : <>
          <article><span>Current MC</span><strong>{usd(currentMarketCap)}</strong></article>
          <article><span>Peak MC</span><strong>{usd(launch.ath_market_cap_usd)}</strong></article>
          <article><span>Trades</span><strong>{launch.trade_count.toLocaleString("en-GB")}</strong></article>
          <article><span>Holders</span><strong>{launch.holder_count?.toLocaleString("en-GB") ?? "Not recorded"}</strong></article>
        </>}
      </section>

      <section className="positionChartPanel">
        <header>
          <div>
            <span className="positionChartKicker">{acquired ? "PonsEye position tracker" : "PonsEye market tracker"}</span>
            <strong>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Token"} / Market cap</strong>
          </div>
          <div className="positionLegend" aria-label="Position chart markers">
            {acquired ? <span className="buy"><i>↑</i> Ponseye buy</span> : null}
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
    </main>
  );
}
