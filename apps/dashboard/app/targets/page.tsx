import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { LabToken } from "../../lib/lab-data";
import { getCapitalCircuitData } from "../../lib/lab-data";
import { AutoRefresh } from "../auto-refresh";
import { CircuitLedger } from "./circuit-ledger";

export const metadata: Metadata = {
  title: "Capital Circuit | PonsEye",
  description: "PonsEye signal performance, runner history and equity.",
};

type Period = "1d" | "7d" | "30d" | "all";

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

function axisMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function multiple(value: number | null) {
  return value == null || !Number.isFinite(value) ? "Pending" : `${value.toFixed(value >= 10 ? 1 : 2)}x`;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  return points.slice(0, -1).reduce((path, point, index) => {
    const previous = points[index - 1] ?? point;
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;
    const controlOneX = point.x + (next.x - previous.x) / 6;
    const controlTwoX = next.x - (afterNext.x - point.x) / 6;
    const lowY = Math.min(point.y, next.y);
    const highY = Math.max(point.y, next.y);
    const controlOneY = Math.max(lowY, Math.min(highY, point.y + (next.y - previous.y) / 6));
    const controlTwoY = Math.max(lowY, Math.min(highY, next.y - (afterNext.y - point.y) / 6));
    return `${path} C${controlOneX.toFixed(1)} ${controlOneY.toFixed(1)},${controlTwoX.toFixed(1)} ${controlTwoY.toFixed(1)},${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }, `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);
}

function modelOutcome(token: LabToken): { closed: boolean; exitMultiple: number; label: string; tone: "loss" | "win" | "open" } {
  if (token.position_status === "closed") {
    const exitMultiple = token.entry_market_cap_usd && token.exit_market_cap_usd
      ? token.exit_market_cap_usd / token.entry_market_cap_usd
      : token.final_multiple ?? (token.exit_reason === "stop" ? stopMultiple : targetMultiple);
    return {
      closed: true,
      exitMultiple,
      label: token.exit_reason === "stop" ? "Stopped" : "Target hit",
      tone: exitMultiple >= 1 ? "win" : "loss",
    };
  }
  if (token.position_status === "open") {
    return {
      closed: false,
      exitMultiple: Math.max(0, token.final_multiple ?? 1),
      label: "Live",
      tone: "open",
    };
  }
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

function EquityCurve({ values, dates }: { values: number[]; dates: string[] }) {
  const width = 1000;
  const height = 330;
  const padLeft = 74;
  const padRight = 28;
  const padTop = 24;
  const padBottom = 42;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = padLeft + (index / Math.max(1, values.length - 1)) * (width - padLeft - padRight);
    const y = padTop + ((max - value) / range) * (height - padTop - padBottom);
    return { x, y };
  });
  const line = smoothPath(points);
  const areaBottom = height - padBottom;
  const area = `${line} L${points.at(-1)?.x ?? padLeft} ${areaBottom} L${padLeft} ${areaBottom} Z`;
  const axisDate = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    ...(dates.length && Date.parse(dates.at(-1) ?? "") - Date.parse(dates[0]) < 172_800_000 ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
  const yTicks = [0, 1, 2, 3, 4].map((row) => max - (range / 4) * row);
  const xTicks = [...new Set([0, Math.round((values.length - 1) * .25), Math.round((values.length - 1) * .5), Math.round((values.length - 1) * .75), values.length - 1])];

  return (
    <div className="equityChartFrame">
      <div className="equityYAxis" aria-hidden="true">{yTicks.map((value) => <span key={value}>{axisMoney(value)}</span>)}</div>
      <svg className="equityChart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="PonsEye equity curve">
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
        {[0, 1, 2, 3, 4].map((row) => {
          const y = padTop + ((height - padTop - padBottom) / 4) * row;
          return <line className="equityGridLine" key={row} x1={padLeft} x2={width - padRight} y1={y} y2={y} />;
        })}
        <path className="equityArea" d={area} />
        <path className="equityGlow" d={line} />
        <path className="equityLine" d={line} />
      </svg>
      <div className="equityXAxis" aria-hidden="true">
        {xTicks.map((index) => dates[index] ? <span key={index}>{axisDate.format(new Date(dates[index]))}</span> : null)}
      </div>
    </div>
  );
}

const periodLabels: Array<[Period, string]> = [["1d", "24H"], ["7d", "7D"], ["30d", "30D"], ["all", "All"]];

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const query = await searchParams;
  const period: Period = query.period === "1d" || query.period === "7d" || query.period === "30d" ? query.period : "all";
  const allTokens = (await getCapitalCircuitData()).filter((token) => token.actual_acquired);
  const cutoff = period === "all" ? 0 : Date.now() - Number.parseInt(period, 10) * 86_400_000;
  const tokens = allTokens
    .filter((token) => new Date(token.signal_at).getTime() >= cutoff)
    .sort((a, b) => new Date(a.signal_at).getTime() - new Date(b.signal_at).getTime());
  const outcomes = tokens.map((token) => {
    const outcome = modelOutcome(token);
    return { token, outcome, pnlUsd: positionSize * (outcome.exitMultiple - 1) };
  });

  let balance = startingEquity;
  const equityValues = [balance];
  const equityDates = [tokens[0]?.signal_at ?? new Date().toISOString()];
  for (const item of outcomes) {
    balance += item.pnlUsd;
    equityValues.push(balance);
    equityDates.push(item.token.signal_at);
  }

  const capitalDeployed = tokens.length * positionSize;
  const pnl = balance - startingEquity;
  const roi = capitalDeployed ? (pnl / capitalDeployed) * 100 : 0;
  const winners = outcomes.filter((item) => item.outcome.closed && item.outcome.exitMultiple > 1).length;
  const runners = outcomes.filter((item) => (item.token.future_peak_multiple ?? 0) >= 2);
  const closed = outcomes.filter((item) => item.outcome.closed);
  const open = outcomes.filter((item) => !item.outcome.closed);
  const bestRunner = Math.max(0, ...tokens.map((token) => token.future_peak_multiple ?? 0));
  return (
    <main className="targetsPage circuitPage">
      <AutoRefresh intervalMs={5_000} />
      <header className="targetsNav">
        <Link href="/" aria-label="PonsEye dashboard">
          <Image src="/ponseye-wordmark-white.png" alt="PonsEye" width={1272} height={266} priority />
        </Link>
        <Link className="backLink" href="/">Launch dashboard <span>↗</span></Link>
      </header>

      <section className="circuitHeading">
        <nav className="circuitPeriods" aria-label="Performance period">
          {periodLabels.map(([value, label]) => (
            <Link className={period === value ? "active" : ""} href={`/targets?period=${value}`} key={value}>{label}</Link>
          ))}
        </nav>
      </section>

      <section className="equityPanel">
        <header className="equityPanelHead">
          <div className="equityRunningTotal">
            <span>Running total</span>
            <strong>{money(balance)}</strong>
            <small className={pnl >= 0 ? "positive" : "negative"}>{pnl >= 0 ? "+" : ""}{money(pnl)}</small>
          </div>
        </header>
        <div className="equityPlot">
          <EquityCurve values={equityValues.length > 1 ? equityValues : [startingEquity, startingEquity]} dates={equityDates.length > 1 ? equityDates : [new Date().toISOString(), new Date().toISOString()]} />
        </div>
      </section>

      <section className="circuitStats">
        <article><span>Net return</span><strong className={pnl >= 0 ? "positive" : "negative"}>{pnl >= 0 ? "+" : ""}{money(pnl)}</strong><small>{roi.toFixed(1)}% on capital deployed</small></article>
        <article><span>Acquired</span><strong>{tokens.length}</strong><small>{money(capitalDeployed)} deployed</small></article>
        <article><span>Winning exits</span><strong>{tokens.length ? ((winners / tokens.length) * 100).toFixed(1) : "0.0"}%</strong><small>{winners} profitable outcomes</small></article>
        <article><span>2x+ runners</span><strong>{runners.length}</strong><small>{tokens.length ? ((runners.length / tokens.length) * 100).toFixed(1) : "0.0"}% of acquired</small></article>
        <article className="best"><span>Best runner</span><strong>{multiple(bestRunner)}</strong><small>Peak after acquisition</small></article>
      </section>

      <CircuitLedger items={outcomes} />
    </main>
  );
}
