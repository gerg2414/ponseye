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
  "12 or more trades · 15 points",
  "12 or more unique traders · 15 points",
  "Buy pressure at least 65% · 10 points",
  "8 or more first minute buyers · 15 points",
  "Price at least 0.75x its first price · 20 points",
  "Price holding at least 70% of peak · 15 points",
  "Top 10 holders at or below 90% · 10 points",
  "Market cap at least $5,000 · 25 points",
  "First minute buyers at least 50% of traders · 25 points",
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
            <h3>Strict route to Acquired</h3>
            <ul>
              <li>Scored at the first Surveillance checkpoint</li>
              <li>At least 90% of available weighted evidence</li>
              <li>Top 10 holders no higher than 90% when known</li>
              <li>No creator sells</li>
            </ul>
          </div>
          <div className={styles.gate}>
            <h3>Young token confirmation</h3>
            <ul>
              <li>Applies when the entry signal arrives at 60 to 89 seconds old</li>
              <li>Remain Surveilling for another 90 seconds</li>
              <li>Price must hold at least 0.5x of the original signal price</li>
              <li>Any creator sale bins the token</li>
              <li>Confirmed entries use the later confirmation price</li>
            </ul>
          </div>
          <p><strong>{count(live.confirmationsPending)}</strong> currently awaiting young token confirmation.</p>
          <footer>Not all passed <b>Stay in Surveillance</b></footer>
        </article>

        <div className={styles.arrow}><span>Full evidence</span><b>→</b></div>

        <article className={`${styles.track} ${styles.acquired}`}>
          <header><span>03</span><div><small>Paper position opened</small><h2>Acquired</h2></div><strong>{count(live.counts.acquired)}</strong></header>
          <p>The entry price and market cap are locked when the target is acquired. Both curve and market trades track the position.</p>
          <div className={styles.gate}>
            <h3>Live exit model</h3>
            <ul>
              <li>Sell 20% of the original position at 10x</li>
              <li>Sell 20% at 20x</li>
              <li>Sell 50% at 50x</li>
              <li>Sell the final 10% at 100x</li>
              <li>At minute 8, exit if still below the entry price</li>
              <li>Before 10x, exit after two consecutive minute checks below 0.5x</li>
              <li>After 10x, exit the remaining 80% below 3x if 20x is not reached within 3 minutes</li>
              <li>No fixed stop loss</li>
            </ul>
          </div>
          <footer>Position result <b>Four staged exits</b></footer>
        </article>
      </section>

      <section className={styles.branches}>
        <article>
          <span className={styles.branchLabel}>Quiet Peak route</span>
          <h2>Surveillance → Acquired</h2>
          <p>The secondary route captures quiet tokens making a fresh peak without a late burst of buyers.</p>
          <ul>
            <li>At least 50% weighted evidence</li><li>Holding 100% of its peak</li><li>No more than 2 buys in the final 20 seconds</li>
            <li>Top 10 holders no higher than 90% when known</li><li>No creator sells</li>
          </ul>
        </article>

        <article>
          <span className={`${styles.branchLabel} ${styles.red}`}>Terminal route</span>
          <h2>Any active track → Binned</h2>
          <p>A confirmed creator sale bins a token immediately. A young token is also binned if it fails its 90 second price confirmation. Binned is permanent.</p>
          <strong>{count(live.counts.binned)} currently binned</strong>
        </article>
      </section>

      <section className={styles.score}>
        <header><div><small>Strict acquisition route</small><h2>Weighted evidence score</h2></div><strong>90% required</strong></header>
        <ol>{evidenceScore.map((rule, index) => <li key={rule}><span>{String(index + 1).padStart(2, "0")}</span>{rule}</li>)}</ol>
      </section>

      <aside className={styles.note}>
        <strong>Testing Lab population</strong>
        <p>The Lab now includes every token that has ever reached Surveillance, plus current live Surveillance and Acquired rows. Sighted tokens are excluded because they have not passed the minimum activity gate.</p>
      </aside>
    </main>
  );
}
