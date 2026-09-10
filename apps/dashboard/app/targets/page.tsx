import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Targets Acquired | PonsEye",
  description: "Verified runners spotted by PonsEye before they moved.",
};

type Period = "1d" | "7d" | "30d" | "all";

const summaries: Record<Period, { acquired: number; best: string; counts: string[] }> = {
  "1d": { acquired: 12, best: "18x", counts: ["4", "2", "0", "0", "0"] },
  "7d": { acquired: 64, best: "100x", counts: ["21", "9", "4", "2", "1"] },
  "30d": { acquired: 241, best: "184x", counts: ["76", "31", "14", "6", "2"] },
  all: { acquired: 528, best: "312x", counts: ["164", "72", "33", "14", "5"] },
};

const targets = [
  { name: "Night Shift", symbol: "NIGHT", multiple: 100, found: "$12.4K", peak: "$1.24M", spotted: "4m after launch", signal: "Rapid maker expansion", tone: "green" },
  { name: "Common Ground", symbol: "GROUND", multiple: 63, found: "$21.8K", peak: "$1.37M", spotted: "7m after launch", signal: "Wallet cluster return", tone: "purple" },
  { name: "Velocity", symbol: "VELO", multiple: 51, found: "$18.1K", peak: "$923K", spotted: "3m after launch", signal: "Curve acceleration", tone: "pink" },
  { name: "Good Company", symbol: "GOOD", multiple: 37, found: "$15.6K", peak: "$577K", spotted: "6m after launch", signal: "Organic buyer spread", tone: "orange" },
  { name: "Open Season", symbol: "OPEN", multiple: 28, found: "$27.2K", peak: "$762K", spotted: "11m after launch", signal: "Sustained holder growth", tone: "green" },
  { name: "Signal Fire", symbol: "FIRE", multiple: 18, found: "$31.5K", peak: "$567K", spotted: "8m after launch", signal: "Sell pressure absorbed", tone: "purple" },
];

const periodLabels: Array<[Period, string]> = [["1d", "1D"], ["7d", "7D"], ["30d", "30D"], ["all", "All time"]];
const thresholds = ["5x+", "10x+", "25x+", "50x+", "100x+"];

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const requested = (await searchParams).period;
  const period: Period = requested === "1d" || requested === "30d" || requested === "all" ? requested : "7d";
  const summary = summaries[period];

  return (
    <main className="targetsPage">
      <header className="targetsNav">
        <Link href="/" aria-label="PonsEye dashboard">
          <Image src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
        </Link>
        <Link className="backLink" href="/">Launch dashboard <span>↗</span></Link>
      </header>

      <section className="targetsHero">
        <div>
          <p className="previewLabel"><i /> Design preview using sample data</p>
          <p className="eyebrow"><span>03</span> Verified signal archive</p>
          <h1>Targets<br /><em>Acquired.</em></h1>
          <p className="targetsIntro">Spotted by PonsEye before they ran.</p>
        </div>
        <div className="targetScanner" aria-hidden="true">
          <span className="scannerCorner tl" /><span className="scannerCorner tr" />
          <span className="scannerCorner bl" /><span className="scannerCorner br" />
          <div className="scannerRings"><i /><b /></div>
          <small>Signal locked</small>
          <strong>{summary.best}</strong>
        </div>
      </section>

      <nav className="periodTabs" aria-label="Result period">
        {periodLabels.map(([value, label]) => (
          <Link key={value} className={period === value ? "active" : ""} href={`/targets?period=${value}`}>{label}</Link>
        ))}
      </nav>

      <section className="targetOverview">
        <article className="acquiredTotal">
          <span>Targets acquired</span>
          <strong>{summary.acquired}</strong>
          <small>Within selected period</small>
        </article>
        <div className="multipleBreakdown">
          {thresholds.map((threshold, index) => (
            <article key={threshold}>
              <span>{threshold}</span>
              <strong>{summary.counts[index]}</strong>
              <small>runners</small>
            </article>
          ))}
        </div>
      </section>

      <section className="targetsResults">
        <header>
          <div><p className="eyebrow"><span>04</span> Top sightings</p><h2>Biggest verified runners</h2></div>
          <div className="verifiedKey"><i /> Onchain timestamp verified</div>
        </header>

        <div className="targetGrid">
          {targets.map((target, index) => (
            <article className={`targetCard ${target.tone}`} key={target.symbol}>
              <div className="targetCardTop">
                <span className="targetRank">{String(index + 1).padStart(2, "0")}</span>
                <span className="verifiedBadge"><i /> Verified</span>
              </div>
              <div className="multiple"><strong>{target.multiple}</strong><span>x</span></div>
              <div className="targetToken">
                <div>{target.symbol.slice(0, 2)}</div>
                <span><strong>{target.name}</strong><small>{"$"}{target.symbol}</small></span>
              </div>
              <div className="targetValues">
                <div><small>Acquired at</small><strong>{target.found}</strong></div>
                <div><small>Peak market cap</small><strong>{target.peak}</strong></div>
              </div>
              <div className="targetSignal">
                <span>{target.signal}</span>
                <small>{target.spotted}</small>
              </div>
              <footer><span>View evidence</span><b>→</b></footer>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
