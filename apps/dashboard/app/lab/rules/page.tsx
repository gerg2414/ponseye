import type { Metadata } from "next";
import { getRulesLiveData } from "../../../lib/rules-data";
import { AutoRefresh } from "../../auto-refresh";
import { LabHeader } from "../lab-header";
import styles from "./rules.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Research Rules | PonsEye Lab",
  description: "The active PonsEye research funnel, gates and position exits.",
};

const evidenceScore = [
  "50 or more trades",
  "15 or more unique traders",
  "Buy pressure at least 58%",
  "3 or more first minute buyers",
  "30 or more holders",
  "Holder count rising over 5 minutes",
  "Top 10 holders at or below 70%",
  "Creator balance at or below 5%",
  "Price at least 1.20x its first price",
  "Price holding at least 60% of peak",
];

function count(value: number) {
  return value.toLocaleString("en-GB");
}

function time(value: string | null) {
  if (!value) return "No transition recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "UTC", hour12: false,
  }).format(new Date(value)) + " UTC";
}

export default async function RulesPage() {
  const live = await getRulesLiveData();

  return (
    <main className={styles.page}>
      <AutoRefresh intervalMs={5_000} />
      <LabHeader current="rules" />

      <section className={styles.hero}>
        <div>
          <small>Production decision map</small>
          <h1>Live research rules</h1>
          <p>This is the exact funnel currently classifying tokens. Counts update from the live database every five seconds.</p>
        </div>
        <dl className={styles.liveMeta}>
          <div><dt>Recorder</dt><dd className={live.recorderEnabled ? styles.live : styles.paused}>{live.recorderEnabled ? "Live" : "Paused"}</dd></div>
          <div><dt>Rule version</dt><dd>{live.ruleVersion}</dd></div>
          <div><dt>Last transition</dt><dd>{time(live.latestTransitionAt)}</dd></div>
        </dl>
      </section>

      <section className={styles.flow} aria-label="PonsEye research flow">
        <article className={`${styles.track} ${styles.sighted}`}>
          <header><span>01</span><div><small>All new launches</small><h2>Sighted</h2></div><strong>{count(live.counts.sighted)}</strong></header>
          <p>Every detected token starts here. It moves only while its evidence is inside the live entry window.</p>
          <div className={styles.gate}>
            <h3>All required for Surveillance</h3>
            <ul>
              <li>At least 60 seconds old</li>
              <li>No more than 15 minutes old</li>
              <li>Evidence refreshed within 2 minutes</li>
              <li>Market cap at least $10,000</li>
              <li>At least 12 trades</li>
              <li>At least 6 unique traders</li>
              <li>Buy pressure at least 52%</li>
              <li>No creator sells</li>
            </ul>
          </div>
          <footer>Not all passed <b>Stay Sighted</b></footer>
        </article>

        <div className={styles.arrow}><span>All pass</span><b>→</b></div>

        <article className={`${styles.track} ${styles.surveillance}`}>
          <header><span>02</span><div><small>Minimum Lab population</small><h2>Surveillance</h2></div><strong>{count(live.counts.surveillance)}</strong></header>
          <p>Once a token reaches Surveillance it stays under watch. It does not fall back to Sighted.</p>
          <div className={styles.gate}>
            <h3>Normal route to Acquired</h3>
            <ul>
              <li>Sighted timing, freshness and $10k gate still pass</li>
              <li>At least 30 trades</li>
              <li>At least 10 unique traders</li>
              <li>No creator sells</li>
              <li>Price holds at least 50% of peak</li>
              <li>At least 8 of 10 evidence points</li>
            </ul>
          </div>
          <footer>Not all passed <b>Stay in Surveillance</b></footer>
        </article>

        <div className={styles.arrow}><span>Full evidence</span><b>→</b></div>

        <article className={`${styles.track} ${styles.acquired}`}>
          <header><span>03</span><div><small>Paper position opened</small><h2>Acquired</h2></div><strong>{count(live.counts.acquired)}</strong></header>
          <p>The entry price and market cap are locked when the target is acquired. Both curve and market trades track the position.</p>
          <div className={styles.gate}>
            <h3>Live exit model</h3>
            <ul>
              <li>Close at 3.00x entry for the target</li>
              <li>Close at 0.90x entry for the stop</li>
              <li>Peak price continues updating while open</li>
              <li>First qualifying trade after entry closes it</li>
            </ul>
          </div>
          <footer>Position result <b>Target or Stop</b></footer>
        </article>
      </section>

      <section className={styles.branches}>
        <article>
          <span className={styles.branchLabel}>Fast route</span>
          <h2>Sighted or Surveillance → Acquired</h2>
          <p>The fast route bypasses the holder score when all of these stronger signals pass inside the same live entry window.</p>
          <ul>
            <li>Market cap at least $30,000</li><li>50 trades</li><li>15 unique traders</li><li>58% buy pressure</li>
            <li>No creator sells</li><li>3 first minute buyers</li><li>Price at least 1.20x first price</li><li>At least 60% of peak held</li>
          </ul>
        </article>

        <article>
          <span className={`${styles.branchLabel} ${styles.red}`}>Terminal route</span>
          <h2>Any active track → Binned</h2>
          <p>A token is binned when the creator has sold and price has fallen to 50% or less of its peak. Binned is permanent.</p>
          <strong>{count(live.counts.binned)} currently binned</strong>
        </article>
      </section>

      <section className={styles.score}>
        <header><div><small>Normal acquisition route</small><h2>Evidence score</h2></div><strong>8 / 10 required</strong></header>
        <ol>{evidenceScore.map((rule, index) => <li key={rule}><span>{String(index + 1).padStart(2, "0")}</span>{rule}</li>)}</ol>
      </section>

      <aside className={styles.note}>
        <strong>Testing Lab population</strong>
        <p>The Lab now includes every token that has ever reached Surveillance, plus current live Surveillance and Acquired rows. Sighted tokens are excluded because they have not passed the minimum activity gate.</p>
      </aside>
    </main>
  );
}
