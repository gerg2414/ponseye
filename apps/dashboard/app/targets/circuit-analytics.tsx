import type { CSSProperties } from "react";
import type { CapitalCircuitDaily, LabToken } from "../../lib/lab-data";

type FunnelKey = "sighted" | "surveilling" | "acquired";

const funnelSeries: Array<{ key: FunnelKey; label: string }> = [
  { key: "sighted", label: "Sighted" },
  { key: "surveilling", label: "Surveilling" },
  { key: "acquired", label: "Acquired" },
];

const runnerLevels = [2, 5, 10, 20, 50, 100] as const;

function compact(value: number) {
  return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function fullDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function CircuitAnalytics({ daily, tokens }: { daily: CapitalCircuitDaily[]; tokens: LabToken[] }) {
  const peaks = tokens.map((token) => token.future_peak_multiple ?? 0);
  const runnerCounts = runnerLevels.map((level) => ({
    level,
    count: peaks.filter((peak) => peak >= level).length,
  }));
  const bestPeak = Math.max(0, ...peaks);
  const funnelMaximum = Math.max(10, ...daily.flatMap((day) => funnelSeries.map((series) => day[series.key])));
  const funnelPower = Math.ceil(Math.log10(funnelMaximum));
  const funnelScaleMaximum = 10 ** funnelPower;
  const funnelTicks = [
    ...Array.from({ length: funnelPower }, (_, index) => 10 ** (funnelPower - index)),
    0,
  ];

  return (
    <section className="signalAnalytics" aria-label="PonsEye signal analytics">
      <article className="analyticsPanel funnelPanel">
        <header className="analyticsPanelHead">
          <div>
            <span>Daily funnel</span>
            <h1>Calls through the system</h1>
          </div>
          <p>Unique tokens per stage · UTC</p>
        </header>

        {daily.length ? (
          <>
            <div className="funnelLegend" aria-label="Funnel chart legend">
              {funnelSeries.map((series) => <span className={series.key} key={series.key}><i />{series.label}</span>)}
            </div>
            <div className="funnelChartScroll">
              <div className="funnelChart" style={{ "--funnel-days": daily.length } as CSSProperties}>
                <div className="funnelYAxis" aria-hidden="true">
                  {funnelTicks.map((tick) => <span key={tick}>{compact(tick)}</span>)}
                </div>
                <div className="funnelPlot">
                  <div className="funnelGrid" aria-hidden="true">
                    {funnelTicks.map((tick) => <i key={tick} />)}
                  </div>
                  <div className="funnelDays">
                    {daily.map((day) => (
                      <div className="funnelDay" key={day.date}>
                        <div className="funnelDayBars">
                          {funnelSeries.map((series) => {
                            const value = day[series.key];
                            const height = value ? Math.max(3, (Math.log10(Math.max(1, value)) / Math.log10(funnelScaleMaximum)) * 100) : 0;
                            return (
                              <div className={`funnelVerticalBar ${series.key}`} key={series.key} title={`${series.label} · ${fullDate(day.date)}: ${value.toLocaleString("en-GB")}`}>
                                <i style={{ height: `${height}%` }}><b>{compact(value)}</b></i>
                              </div>
                            );
                          })}
                        </div>
                        <time>{fullDate(day.date)}</time>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : <p className="analyticsEmpty">No funnel activity in this period.</p>}
      </article>

      <article className="analyticsPanel runnerPanel">
        <header className="analyticsPanelHead">
          <div>
            <span>Call performance</span>
            <h2>Acquired tokens that reached</h2>
          </div>
          <p>{tokens.length} acquired calls · best peak {bestPeak ? `${bestPeak.toFixed(bestPeak >= 10 ? 1 : 2)}x` : "pending"}</p>
        </header>

        <div className="runnerChart" aria-label="Acquired token peak multiples">
          {runnerCounts.map(({ level, count }) => {
            const rate = tokens.length ? (count / tokens.length) * 100 : 0;
            return (
              <div className="runnerColumn" key={level} title={`${count} of ${tokens.length} acquired tokens reached at least ${level}x`}>
                <div className="runnerValue">
                  <strong>{count}</strong>
                  <span>{rate.toFixed(1)}%</span>
                </div>
                <div className="runnerTrack"><i style={{ height: `${Math.max(rate ? 5 : 0, rate)}%` }} /></div>
                <b>{level}x+</b>
              </div>
            );
          })}
        </div>
        <footer>Measured from each call&apos;s recorded peak after acquisition. A larger runner is counted in every level it crossed.</footer>
      </article>
    </section>
  );
}
