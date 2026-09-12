"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LabToken } from "../../lib/lab-data";
import { TokenImage } from "../token-image";

type View = "all" | "closed" | "open" | "runners";
type CircuitItem = {
  token: LabToken;
  outcome: { closed: boolean; exitMultiple: number; label: string; tone: "loss" | "win" | "open" };
  pnlUsd: number;
};

const viewLabels: Array<[View, string]> = [["all", "All acquired"], ["runners", "2x+ runners"], ["closed", "Closed"], ["open", "Still tracking"]];

function compactMoney(value: number | null) {
  if (!value || !Number.isFinite(value)) return "Pending";
  return `$${new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function multiple(value: number | null) {
  return value == null || !Number.isFinite(value) ? "Pending" : `${value.toFixed(value >= 10 ? 1 : 2)}x`;
}

export function CircuitLedger({ items }: { items: CircuitItem[] }) {
  const [view, setView] = useState<View>("all");
  const counts = useMemo(() => ({
    all: items.length,
    runners: items.filter((item) => (item.token.future_peak_multiple ?? 0) >= 2).length,
    closed: items.filter((item) => item.outcome.closed).length,
    open: items.filter((item) => !item.outcome.closed).length,
  }), [items]);
  const visible = useMemo(() => items
    .filter((item) => view === "all"
      || (view === "runners" && (item.token.future_peak_multiple ?? 0) >= 2)
      || (view === "closed" && item.outcome.closed)
      || (view === "open" && !item.outcome.closed))
    .sort((a, b) => view === "runners"
      ? (b.token.future_peak_multiple ?? 0) - (a.token.future_peak_multiple ?? 0)
      : new Date(b.token.signal_at).getTime() - new Date(a.token.signal_at).getTime()), [items, view]);

  return (
    <section className="circuitLedger">
      <header>
        <div><span>Position ledger</span><h2>Every acquired target</h2></div>
        <p><b>{counts.closed}</b> positions closed <i /> <b>{counts.open}</b> still tracking</p>
      </header>
      <nav className="circuitViews" aria-label="Position view">
        {viewLabels.map(([value, label]) => (
          <button type="button" className={view === value ? "active" : ""} onClick={() => setView(value)} key={value}>{label}<b>{counts[value]}</b></button>
        ))}
      </nav>

      <div className="circuitTableHead" aria-hidden="true">
        <span>Target</span><span>Acquired</span><span>Entry MC</span><span>Exit MC</span><span>P&amp;L</span><span>Result</span>
      </div>
      <div className="circuitRows">
        {visible.length ? visible.map(({ token, outcome, pnlUsd }) => {
          const resultMultiple = outcome.closed ? outcome.exitMultiple : token.final_multiple;
          const exitMarketCap = outcome.closed && token.signal_market_cap_usd
            ? token.signal_market_cap_usd * outcome.exitMultiple
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
              <strong>{outcome.closed ? compactMoney(exitMarketCap) : "Open"}</strong>
              <strong className={`circuitPnl ${pnlUsd >= 0 ? "positive" : "negative"}`}>{pnlUsd >= 0 ? "+" : ""}{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(pnlUsd)}</strong>
              <span className={`circuitOutcome ${outcome.tone}`} aria-label={`${outcome.label}: ${multiple(resultMultiple)}`}><b>{multiple(resultMultiple)}</b></span>
            </Link>
          );
        }) : <div className="circuitEmpty">No positions match this view yet.</div>}
      </div>
    </section>
  );
}
