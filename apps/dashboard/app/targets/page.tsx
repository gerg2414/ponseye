import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { LabToken } from "../../lib/lab-data";
import { getPonsEyeLabData } from "../../lib/lab-data";
import { TokenImage } from "../token-image";

export const metadata: Metadata = {
  title: "Capital Circuit | PonsEye",
  description: "PonsEye signal performance, runner history and modelled equity.",
};

type Period = "1d" | "7d" | "30d" | "all";
type View = "all" | "closed" | "open" | "runners";

const startingEquity = 1_000;
const positionSize = 25;
const targetMultiple = 3;
const stopMultiple = 0.9;

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1_000 ? 0 : 2,
  }).format(value);
}

function compactMoney(value: number | null) {
  if (!value || !Number.isFinite(value)) return "Pending";
  return `$${new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function multiple(value: number | null) {
  return value == null || !Number.isFinite(value) ? "Pending" : `${value.toFixed(value >= 10 ? 1 : 2)}x`;
}

function modelOutcome(token: LabToken) {
  const lowBeforeTarget = token.pre_target_low_multiples[String(targetMultiple)];
  if (lowBeforeTarget != null && lowBeforeTarget <= stopMultiple) {
    return { closed: true, exitMultiple: stopMultiple, label: "Stopped", tone: "loss" };
  }
  if ((token.future_peak_multiple ?? 0) >= targetMultiple) {
    return { closed: true, exitMultiple: targetMultiple, label: "Target hit", tone: "win" };
  }
  return {
    closed: false,
    exitMultiple: Math.max(0, token.final_multiple ?? 1),
    label: "Still tracking",
    tone: "open",
  };
}

function EquityCurve({ values }: { values: number[] }) {
  const width = 1000;
  const height = 300;
  const padX = 28;
  const padY = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = padX + (index / Math.max(1, values.length - 1)) * (width - padX * 2);
    const y = padY + ((max - value) / range) * (height - padY * 2);
    return { x, y };
  });
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)?.x ?? padX} ${height} L${padX} ${height} Z`;
  const last = points.at(-1) ?? { x: padX, y: height - padY };

  return (
    <svg className="equityChart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Modelled PonsEye equity curve">
      <defs>
        <linearGradient id="equityArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a56cff" stopOpacity=".42" />
          <stop offset="72%" stopColor="#7d3eea" stopOpacity=".08" />
          <stop offset="100%" stopColor="#7d3eea" stopOpacity="0" />
        </linearGradient>
        <filter id="equityGlow" x="-20%" y="-30%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {[0, 1, 2, 3, 4].map((row) => <line className="equityGridLine" key={row} x1="0" x2={width} y1={(height / 4) * row} y2={(height / 4) * row} />)}
      <path className="equityArea" d={area} />
      <path className="equityGlow" d={line} />
      <path className="equityLine" d={line} />
      <circle className="equityEndPulse" cx={last.x} cy={last.y} r="11" />
      <circle className="equityEnd" cx={last.x} cy={last.y} r="5" />
    </svg>
  );
}

const periodLabels: Array<[Period, string]> = [["1d", "24H"], ["7d", "7D"], ["30d", "30D"], ["all", "All"]];
const viewLabels: Array<[View, string]> = [["all", "All acquired"], ["runners", "2x+ runners"], ["closed", "Closed replay"], ["open", "Still tracking"]];

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const query = await searchParams;
  const period: Period = query.period === "1d" || query.period === "7d" || query.period === "30d" ? query.period : "all";
  const view: View = query.view === "closed" || query.view === "open" || query.view === "runners" ? query.view : "all";
  const allTokens = (await getPonsEyeLabData()).filter((token) => token.actual_acquired);
  const cutoff = period === "all" ? 0 : Date.now() - Number.parseInt(period, 10) * 86_400_000;
  const tokens = allTokens
    .filter((token) => new Date(token.signal_at).getTime() >= cutoff)
    .sort((a, b) => new Date(a.signal_at).getTime() - new Date(b.signal_at).getTime());
  const outcomes = tokens.map((token) => ({ token, outcome: modelOutcome(token) }));

  let balance = startingEquity;
  const equityValues = [balance];
  for (const item of outcomes) {
    balance += positionSize * (item.outcome.exitMultiple - 1);
    equityValues.push(balance);
  }

  const capitalDeployed = tokens.length * positionSize;
  const pnl = balance - startingEquity;
  const roi = capitalDeployed ? (pnl / capitalDeployed) * 100 : 0;
  const winners = outcomes.filter((item) => item.outcome.exitMultiple > 1).length;
  const runners = outcomes.filter((item) => (item.token.future_peak_multiple ?? 0) >= 2);
  const closed = outcomes.filter((item) => item.outcome.closed);
  const open = outcomes.filter((item) => !item.outcome.closed);
  const bestRunner = Math.max(0, ...tokens.map((token) => token.future_peak_multiple ?? 0));
  const visible = (view === "closed" ? closed : view === "open" ? open : view === "runners" ? runners : outcomes)
    .sort((a, b) => view === "runners"
      ? (b.token.future_peak_multiple ?? 0) - (a.token.future_peak_multiple ?? 0)
      : new Date(b.token.signal_at).getTime() - new Date(a.token.signal_at).getTime());

  return (
    <main className="targetsPage circuitPage">
      <header className="targetsNav">
        <Link href="/" aria-label="PonsEye dashboard">
          <Image src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
        </Link>
        <Link className="backLink" href="/">Launch dashboard <span>↗</span></Link>
      </header>

      <section className="circuitHeading">
        <div>
          <span className="circuitKicker">Signal performance</span>
          <h1>Capital Circuit</h1>
        </div>
        <nav className="circuitPeriods" aria-label="Performance period">
          {periodLabels.map(([value, label]) => (
            <Link className={period === value ? "active" : ""} href={`/targets?period=${value}&view=${view}`} key={value}>{label}</Link>
          ))}
        </nav>
      </section>

      <section className="equityPanel">
        <header className="equityPanelHead">
          <div>
            <span>Model equity</span>
            <strong>{money(balance)}</strong>
            <small className={pnl >= 0 ? "positive" : "negative"}>{pnl >= 0 ? "+" : ""}{money(pnl)} net return</small>
          </div>
          <p><b>Replay settings</b><span>{money(positionSize)} per acquired token</span><span>{targetMultiple}x target</span><span>10% stop</span></p>
        </header>
        <div className="equityPlot">
          <EquityCurve values={equityValues.length > 1 ? equityValues : [startingEquity, startingEquity]} />
          <span className="equityStart">{money(startingEquity)}</span>
          <span className="equityFinish">{money(balance)}</span>
        </div>
        <footer>Model replay using recorded trade order. Open positions are marked at the final recorded value. Fees and slippage are excluded.</footer>
      </section>

      <section className="circuitStats">
        <article><span>Net return</span><strong className={pnl >= 0 ? "positive" : "negative"}>{pnl >= 0 ? "+" : ""}{money(pnl)}</strong><small>{roi.toFixed(1)}% on capital deployed</small></article>
        <article><span>Acquired</span><strong>{tokens.length}</strong><small>{money(capitalDeployed)} deployed</small></article>
        <article><span>Winning exits</span><strong>{tokens.length ? ((winners / tokens.length) * 100).toFixed(1) : "0.0"}%</strong><small>{winners} profitable outcomes</small></article>
        <article><span>2x+ runners</span><strong>{runners.length}</strong><small>{tokens.length ? ((runners.length / tokens.length) * 100).toFixed(1) : "0.0"}% of acquired</small></article>
        <article className="best"><span>Best runner</span><strong>{multiple(bestRunner)}</strong><small>Peak after acquisition</small></article>
      </section>

      <section className="circuitLedger">
        <header>
          <div><span>Position ledger</span><h2>Every acquired target</h2></div>
          <p><b>{closed.length}</b> model exits closed <i /> <b>{open.length}</b> still tracking</p>
        </header>
        <nav className="circuitViews" aria-label="Position view">
          {viewLabels.map(([value, label]) => (
            <Link className={view === value ? "active" : ""} href={`/targets?period=${period}&view=${value}`} key={value}>{label}<b>{value === "all" ? outcomes.length : value === "closed" ? closed.length : value === "open" ? open.length : runners.length}</b></Link>
          ))}
        </nav>

        <div className="circuitTableHead" aria-hidden="true">
          <span>Target</span><span>Acquired</span><span>Entry MC</span><span>Peak MC</span><span>Peak</span><span>Model result</span>
        </div>
        <div className="circuitRows">
          {visible.length ? visible.map(({ token, outcome }) => {
            const peakMarketCap = token.signal_market_cap_usd && token.future_peak_multiple
              ? token.signal_market_cap_usd * token.future_peak_multiple
              : null;
            const href = `/launch/${token.token_address}?from=targets&entry=${encodeURIComponent(token.signal_at)}&entryMc=${token.signal_market_cap_usd ?? ""}`;
            return (
              <Link className="circuitRow" href={href} key={token.token_address}>
                <div className="circuitToken">
                  <TokenImage src={token.image_url} alt="" size={48} />
                  <span><strong>{token.name ?? "Metadata pending"}</strong><small>{token.symbol ? `$${token.symbol.replace(/^\$/, "")}` : token.token_address.slice(0, 10)}</small></span>
                </div>
                <time>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(token.signal_at))}</time>
                <strong>{compactMoney(token.signal_market_cap_usd)}</strong>
                <strong>{compactMoney(peakMarketCap)}</strong>
                <strong className={(token.future_peak_multiple ?? 0) >= 2 ? "runner" : ""}>{multiple(token.future_peak_multiple)}</strong>
                <span className={`circuitOutcome ${outcome.tone}`}><i />{outcome.label}<b>{outcome.closed ? multiple(outcome.exitMultiple) : multiple(token.final_multiple)}</b></span>
              </Link>
            );
          }) : <div className="circuitEmpty">No positions match this view yet.</div>}
        </div>
      </section>
    </main>
  );
}
