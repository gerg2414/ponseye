import Image from "next/image";
import { getDashboardData } from "../lib/data";

export const dynamic = "force-dynamic";

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export default async function Home() {
  const { launches, streams, launchCount, tradeCount } = await getDashboardData();
  const liveFeeds = streams.filter((stream) => stream.status === "connected").length;

  return (
    <main>
      <header className="header">
        <div className="brand"><span className="eye">◉</span> PonsEye</div>
        <div className={`recorder ${liveFeeds ? "live" : "offline"}`}>
          <span /> {liveFeeds ? "Recorder live" : "Recorder offline"}
        </div>
      </header>

      <section className="intro">
        <p className="eyebrow">PONS LAUNCH RESEARCH</p>
        <h1>Record everything.<br />Find what repeats.</h1>
        <p className="lede">A clean evidence base for testing launch behaviour on Robinhood Chain.</p>
      </section>

      <section className="stats">
        <article><span>Launches recorded</span><strong>{launchCount}</strong><small>Latest 50 shown</small></article>
        <article><span>Trades recorded</span><strong>{tradeCount.toLocaleString("en-GB")}</strong><small>Raw curve events</small></article>
        <article><span>Live feeds</span><strong>{liveFeeds}/{Math.max(streams.length, 3)}</strong><small>Bitquery streams</small></article>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div><p className="eyebrow">LIVE TAPE</p><h2>Latest launches</h2></div>
          <span>{launches.length ? "Updating from Supabase" : "Waiting for first launch"}</span>
        </div>

        {launches.length === 0 ? (
          <div className="empty"><span>◉</span><h3>No launches recorded yet</h3><p>Deploy the recorder to Railway and new PONS launches will appear here automatically.</p></div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Token</th><th>Launched</th><th>Creator</th><th>Status</th><th>Contract</th></tr></thead>
              <tbody>{launches.map((launch) => (
                <tr key={launch.token_address}>
                  <td><div className="token">
                    <div className="tokenImage">{launch.image_url ? <Image src={launch.image_url} alt="" width={38} height={38} /> : "?"}</div>
                    <div><strong>{launch.name ?? "Metadata pending"}</strong><span>{launch.symbol ? `$${launch.symbol}` : "Unknown ticker"}</span></div>
                  </div></td>
                  <td>{new Date(launch.launched_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}</td>
                  <td className="mono">{short(launch.deployer_address)}</td>
                  <td><span className={`status ${launch.status}`}>{launch.status}</span></td>
                  <td className="mono">{short(launch.token_address)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
