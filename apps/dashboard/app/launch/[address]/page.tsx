import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLaunchDetail } from "../../../lib/data";
import { launchMarket, quoteValue } from "../../../lib/market";
import { TokenImage } from "../../token-image";
import { CopyField } from "./copy-field";
import { PonsEyeChart } from "./ponseye-chart";

export const revalidate = 5;

export const metadata: Metadata = {
  title: "Launch Research | PonsEye",
  description: "Recorded PONS launch data and trade evidence.",
};

function PixelIcon({ type }: { type: "contract" | "curve" | "wallet" | "clock" | "cap" | "peak" | "drop" | "volume" | "holders" | "traders" | "buy" | "creator" }) {
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
  };
  return <svg className="pixelIcon" viewBox="0 0 18 18" aria-hidden="true"><path d={paths[type]} /></svg>;
}

function SocialIcon({ type }: { type: "website" | "x" | "telegram" }) {
  if (type === "x") {
    return <svg className="socialIcon socialIconX" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.24 2.25h3.31l-7.23 8.26 8.51 11.24h-6.66l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" /></svg>;
  }
  if (type === "telegram") {
    return <svg className="socialIcon socialIconTelegram" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 21 3l-4 18-6-5-4 3 1-5 9-7-11 6-3-2Z" /></svg>;
  }
  return <svg className="socialIcon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9M12 3c-3 3-4 6-4 9s1 6 4 9" /></svg>;
}

export default async function LaunchPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-f]{40}$/i.test(address)) notFound();

  const detail = await getLaunchDetail(address.toLowerCase());
  if (!detail) notFound();

  const { launch, marketTrades } = detail;
  const market = launchMarket(launch);
  const usd = (value: number | null) => value && value > 0 ? quoteValue(value, "USDG") : "Pending price";
  const percent = (value: number | null, fallback = "Pending data") => value == null ? fallback : `${value.toFixed(1)}%`;
  const holderDelta = launch.holder_change_5m == null
    ? "Pending"
    : `${launch.holder_change_5m >= 0 ? "+" : ""}${launch.holder_change_5m}`;
  const bondingTone = launch.status === "graduated"
    ? "completed"
    : launch.status === "swept" || (launch.progress_pct ?? 0) >= 10
      ? "completing"
      : "new";

  return (
    <main className="launchPage">
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
            <div className="tokenSubline">
              <span>{launch.symbol ? `$${launch.symbol.replace(/^\$/, "")}` : "Unknown ticker"}</span>
              <b>•</b>
              <span>{market.asset.symbol} pair</span>
              {(launch.website_url || launch.twitter_url || launch.telegram_url) ? (
                <nav className="identityLinks" aria-label="Token links">
                  {launch.website_url ? <a href={launch.website_url} target="_blank" rel="noreferrer" aria-label="Website" title="Website"><SocialIcon type="website" /></a> : null}
                  {launch.twitter_url ? <a href={launch.twitter_url} target="_blank" rel="noreferrer" aria-label="X" title="X"><SocialIcon type="x" /></a> : null}
                  {launch.telegram_url ? <a href={launch.telegram_url} target="_blank" rel="noreferrer" aria-label="Telegram" title="Telegram"><SocialIcon type="telegram" /></a> : null}
                </nav>
              ) : null}
            </div>
            {launch.description ? <p className="tokenDescription">{launch.description}</p> : null}
          </div>
        </div>
        <aside className="launchMeta">
          <dl>
            <div><dt><PixelIcon type="contract" /> Contract address</dt><dd><CopyField value={launch.token_address} /></dd></div>
            <div><dt><PixelIcon type="curve" /> Bonding curve</dt><dd><CopyField value={launch.curve_address} /></dd></div>
            <div><dt><PixelIcon type="wallet" /> Deployer wallet</dt><dd><CopyField value={launch.deployer_address} /></dd></div>
            <div><dt><PixelIcon type="clock" /> Launched</dt><dd className="launchDate">{new Date(launch.launched_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</dd></div>
          </dl>
        </aside>
      </section>

      <section className="marketWorkspace">
        <div className="chartPanel">
          <header>
            <div><small>Live market cap</small><strong>{usd(launch.market_cap_usd)}</strong></div>
            <div className={`marketBonding ${bondingTone}`}>
              <div><small>Bonding progress</small><strong>{launch.progress_pct == null ? "Awaiting threshold" : `${launch.progress_pct.toFixed(1)}%`}</strong></div>
              <div className="progressTrack"><i style={{ width: `${launch.progress_pct ?? 0}%` }} /></div>
            </div>
          </header>
          <PonsEyeChart
            trades={marketTrades}
            tokenAddress={launch.token_address}
            graduatedAt={launch.graduated_at}
            acquiredAt={launch.acquired_at ?? (launch.research_state === "target_locked" ? launch.research_state_at : null)}
            closedAt={launch.closed_at ?? null}
          />
        </div>
        <aside className="metricRail">
          <header><span>Token telemetry</span><b><i /> Live</b></header>
          <div className="metricRailGrid">
            <article><small><PixelIcon type="cap" /> Market cap</small><strong>{usd(launch.market_cap_usd)}</strong></article>
            <article><small><PixelIcon type="cap" /> ATH market cap</small><strong>{usd(launch.ath_market_cap_usd)}</strong></article>
            <article><small><PixelIcon type="peak" /> Peak</small><strong>{launch.peak_multiple ? `${launch.peak_multiple.toFixed(2)}x` : "No trades yet"}</strong></article>
            <article><small><PixelIcon type="drop" /> Drawdown</small><strong className="negative">{percent(launch.drawdown_from_peak_pct, "No peak yet")}</strong></article>
            <article><small><PixelIcon type="volume" /> Volume</small><strong>{usd(launch.volume_usd)}</strong></article>
            <article><small><PixelIcon type="holders" /> Holders</small><strong>{launch.holder_count?.toLocaleString("en-GB") ?? "Pending"}</strong></article>
            <article><small><PixelIcon type="holders" /> Holders 5m</small><strong className={(launch.holder_change_5m ?? 0) >= 0 ? "positive" : "negative"}>{holderDelta}</strong></article>
            <article><small><PixelIcon type="holders" /> Top 10</small><strong>{percent(launch.top_10_holder_pct, "Pending")}</strong></article>
            <article><small><PixelIcon type="traders" /> Traders</small><strong>{launch.unique_traders.toLocaleString("en-GB")}</strong></article>
            <article><small><PixelIcon type="buy" /> Buy pressure</small><strong className="positive">{percent(launch.buy_pressure_pct, "No trades yet")}</strong></article>
            <article><small><PixelIcon type="traders" /> First minute</small><strong>{launch.first_minute_buyers.toLocaleString("en-GB")}</strong></article>
            <article><small><PixelIcon type="creator" /> Creator sells</small><strong className={launch.creator_sells ? "negative" : "positive"}>{launch.creator_sells.toLocaleString("en-GB")}</strong></article>
          </div>
        </aside>
      </section>

    </main>
  );
}
