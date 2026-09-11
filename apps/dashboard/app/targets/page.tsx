import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Capital Circuit | PonsEye",
  description: "PonsEye position results and verified returns.",
};

type Period = "1d" | "7d" | "30d" | "all";

const summaries: Record<Period, { acquired: number; best: string; counts: string[] }> = {
  "1d": { acquired: 12, best: "18x", counts: ["4", "2", "0", "0", "0"] },
  "7d": { acquired: 64, best: "100x", counts: ["21", "9", "4", "2", "1"] },
  "30d": { acquired: 241, best: "184x", counts: ["76", "31", "14", "6", "2"] },
  all: { acquired: 528, best: "312x", counts: ["164", "72", "33", "14", "5"] },
};

const targets = [
  { name: "Night Shift", symbol: "NIGHT", multiple: 100, entry: "$12.4K", exit: "$1.24M", closed: "2d ago" },
  { name: "Common Ground", symbol: "GROUND", multiple: 63, entry: "$21.8K", exit: "$1.37M", closed: "3d ago" },
  { name: "Velocity", symbol: "VELO", multiple: 51, entry: "$18.1K", exit: "$923K", closed: "4d ago" },
  { name: "Good Company", symbol: "GOOD", multiple: 37, entry: "$15.6K", exit: "$577K", closed: "5d ago" },
  { name: "Open Season", symbol: "OPEN", multiple: 28, entry: "$27.2K", exit: "$762K", closed: "6d ago" },
  { name: "Signal Fire", symbol: "FIRE", multiple: 18, entry: "$31.5K", exit: "$567K", closed: "7d ago" },
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
          <div><p className="eyebrow">Capital circuit</p><h1>Closed positions</h1></div>
          <div className="verifiedKey"><i /> Onchain timestamp verified</div>
        </header>

        <div className="targetHistory" role="table" aria-label="Closed positions">
          <div className="targetHistoryHead" role="row">
            <span role="columnheader">Target</span>
            <span role="columnheader">Entry MC</span>
            <span role="columnheader">Exit MC</span>
            <span role="columnheader">Return</span>
            <span role="columnheader">Closed</span>
            <span role="columnheader" aria-label="Chart" />
          </div>
          {targets.map((target, index) => (
            <Link
              className="targetHistoryRow"
              href={`/launch/preview-acquired-${index % 2 === 0 ? "one" : "two"}`}
              role="row"
              aria-label={`View ${target.name} chart`}
              key={target.symbol}
            >
              <div className="targetHistoryToken" role="cell">
                <div className="historyTokenThumb">{target.symbol.slice(0, 2)}</div>
                <span><strong>{target.name}</strong><small>{"$"}{target.symbol}</small></span>
              </div>
              <strong role="cell" data-label="Entry MC">{target.entry}</strong>
              <strong role="cell" data-label="Exit MC">{target.exit}</strong>
              <strong className="historyReturn" role="cell" data-label="Return">{target.multiple.toFixed(2)}x</strong>
              <span className="historyClosed" role="cell" data-label="Closed"><i />{target.closed}</span>
              <span className="historyChartLink" role="cell">View chart <b>↗</b></span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
