import Image from "next/image";
import { getDashboardData } from "../lib/data";

export const dynamic = "force-dynamic";

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const currentFeeds = new Set(["launch_activity", "curve_trades"]);

export default async function Home() {
  const { launches, streams, launchCount, tradeCount } = await getDashboardData();
  const recorderFeeds = streams.filter((stream) => currentFeeds.has(stream.feed));
  const liveFeeds = recorderFeeds.filter((stream) => stream.status === "connected").length;
  const recorderLive = liveFeeds === currentFeeds.size;
  const newestLaunch = launches[0];

  return (
    <main>
      <header className="header">
        <div className="brand" aria-label="PonsEye">
          <Image
            className="brandLogo"
            src="/ponseye-logo-transparent.webp"
            alt="PonsEye"
            width={2048}
            height={768}
            priority
            sizes="(max-width: 620px) 176px, 208px"
          />
        </div>
        <div className="systemMeta">
          <span>Robinhood Chain</span>
          <div className={`recorder ${recorderLive ? "live" : "offline"}`}>
            <i /> {recorderLive ? "Recorder live" : "Recorder checking"}
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow"><span>01</span> PONS launch intelligence</p>
          <h1>Watch every launch.<br /><em>Find what repeats.</em></h1>
          <p className="lede">PonsEye records launches and curve trades so we can test patterns against evidence, not guesswork.</p>
        </div>
        <div className="eyeConsole" aria-hidden="true">
          <div className="corner topLeft" /><div className="corner topRight" />
          <div className="corner bottomLeft" /><div className="corner bottomRight" />
          <span className="consoleLabel">Market observation unit</span>
          <div className="orb"><div className="orbCore"><i /></div></div>
          <div className="consoleReadout"><span>Feed status</span><strong>{recorderLive ? "Tracking" : "Standby"}</strong></div>
        </div>
      </section>

      <section className="stats">
        <article><span className="statIndex">01</span><div><small>Launches captured</small><strong>{launchCount.toLocaleString("en-GB")}</strong></div><i className="statLight" /></article>
        <article><span className="statIndex">02</span><div><small>Curve trades</small><strong>{tradeCount.toLocaleString("en-GB")}</strong></div><i className="statLight" /></article>
        <article><span className="statIndex">03</span><div><small>Data feeds</small><strong>{liveFeeds}<b> / {currentFeeds.size}</b></strong></div><i className={`statLight ${recorderLive ? "" : "dim"}`} /></article>
        <article><span className="statIndex">04</span><div><small>Latest launch</small><strong className="latestTime">{newestLaunch ? new Date(newestLaunch.launched_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "Waiting"}</strong></div><i className="statLight purple" /></article>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div><p className="eyebrow"><span>02</span> Observation feed</p><h2>Latest PONS launches</h2></div>
          <div className="panelStatus"><i /> Supabase connected</div>
        </div>

        {launches.length === 0 ? (
          <div className="empty"><span className="emptyEye"><i /></span><h3>Watching for the next launch</h3><p>The recorder is connected. New PONS launches will appear here automatically.</p></div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Token</th><th>Launch time</th><th>Creator</th><th>State</th><th>Contract</th></tr></thead>
              <tbody>{launches.map((launch, index) => (
                <tr key={launch.token_address}>
                  <td><div className="token">
                    <span className="rowNumber">{String(index + 1).padStart(2, "0")}</span>
                    <div className="tokenImage">{launch.image_url ? <Image src={launch.image_url} alt="" width={42} height={42} /> : <span>?</span>}</div>
                    <div><strong>{launch.name ?? "Metadata pending"}</strong><span>{launch.symbol ? `$${launch.symbol}` : "Unknown ticker"}</span></div>
                  </div></td>
                  <td><span className="date">{new Date(launch.launched_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Europe/London" })}</span> {new Date(launch.launched_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/London" })}</td>
                  <td className="mono">{short(launch.deployer_address)}</td>
                  <td><span className={`status ${launch.status}`}><i />{launch.status}</span></td>
                  <td className="mono contract">{short(launch.token_address)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <footer className="panelFoot"><span>Showing latest {launches.length} records</span><span>Raw evidence retained</span></footer>
      </section>
    </main>
  );
}
