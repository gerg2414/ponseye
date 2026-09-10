"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LabToken } from "../../lib/lab-data";
import { TokenImage } from "../token-image";

type RuleKey = "trade_count" | "unique_traders" | "buy_pressure_pct" | "first_minute_buyers" | "momentum_multiple" | "peak_hold_pct" | "top_10_holder_pct";
type Rule = {
  key: RuleKey;
  label: string;
  short: string;
  threshold: number;
  min: number;
  max: number;
  step: number;
  weight: number;
  direction: "min" | "max";
  suffix: string;
};

type LabSettings = {
  scoreThreshold: number;
  runnerTarget: number;
  creatorGate: boolean;
  concentrationGate: boolean;
  rules: Rule[];
};

type ScoredToken = LabToken & {
  labScore: number;
  selected: boolean;
  blockedBy: string[];
  passedRules: number;
  availableRules: number;
};

const presets: Record<"balanced" | "discovery" | "strict", LabSettings> = {
  balanced: {
    scoreThreshold: 70,
    runnerTarget: 2,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 12, min: 5, max: 60, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 6, min: 2, max: 30, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 52, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 5, min: 1, max: 15, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.8, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 60, min: 20, max: 100, step: 5, weight: 15, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 70, min: 30, max: 95, step: 5, weight: 15, direction: "max", suffix: "%" },
    ],
  },
  discovery: {
    scoreThreshold: 55,
    runnerTarget: 2,
    creatorGate: true,
    concentrationGate: false,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 10, min: 5, max: 60, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 5, min: 2, max: 30, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 50, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 4, min: 1, max: 15, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.65, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 50, min: 20, max: 100, step: 5, weight: 15, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 80, min: 30, max: 95, step: 5, weight: 15, direction: "max", suffix: "%" },
    ],
  },
  strict: {
    scoreThreshold: 100,
    runnerTarget: 2,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 30, min: 5, max: 60, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 15, min: 2, max: 30, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 60, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 6, min: 1, max: 15, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 1.2, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 60, min: 20, max: 100, step: 5, weight: 15, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 70, min: 30, max: 95, step: 5, weight: 15, direction: "max", suffix: "%" },
    ],
  },
};

const runnerOptions = [1.5, 2, 3, 5];

function cloneSettings(settings: LabSettings): LabSettings {
  return { ...settings, rules: settings.rules.map((rule) => ({ ...rule })) };
}

function valueFor(token: LabToken, key: RuleKey) {
  return token[key];
}

function scoreToken(token: LabToken, settings: LabSettings): ScoredToken {
  const blockedBy: string[] = [];
  if (settings.creatorGate && token.creator_sells > 0) blockedBy.push("creator sold");

  const concentrationRule = settings.rules.find((rule) => rule.key === "top_10_holder_pct");
  if (
    settings.concentrationGate &&
    concentrationRule &&
    token.top_10_holder_pct != null &&
    token.top_10_holder_pct > concentrationRule.threshold
  ) blockedBy.push("holder concentration");

  let availableWeight = 0;
  let passedWeight = 0;
  let passedRules = 0;
  let availableRules = 0;

  for (const rule of settings.rules) {
    const value = valueFor(token, rule.key);
    if (value == null) continue;
    availableWeight += rule.weight;
    availableRules += 1;
    const passed = rule.direction === "min" ? value >= rule.threshold : value <= rule.threshold;
    if (passed) {
      passedWeight += rule.weight;
      passedRules += 1;
    }
  }

  const labScore = availableWeight > 0 ? (passedWeight / availableWeight) * 100 : 0;
  return {
    ...token,
    labScore,
    selected: blockedBy.length === 0 && labScore >= settings.scoreThreshold,
    blockedBy,
    passedRules,
    availableRules,
  };
}

function formatMultiple(value: number | null) {
  return value == null ? "Unknown" : `${value.toFixed(value >= 10 ? 1 : 2)}x`;
}

function formatMetric(value: number | null, suffix: string) {
  if (value == null) return "No data";
  const decimals = suffix === "x" ? 2 : Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(decimals)}${suffix}`;
}

function ResultToken({ token, runnerTarget }: { token: ScoredToken; runnerTarget: number }) {
  const isRunner = (token.future_peak_multiple ?? 0) >= runnerTarget;
  return (
    <Link className="labResultRow" href={`/launch/${token.token_address}`}>
      <div className="labResultIdentity">
        <TokenImage src={token.image_url} alt={token.name ?? "Token image"} size={48} />
        <span><strong>{token.name ?? "Unknown token"}</strong><small>{token.symbol ? `$${token.symbol.replace(/^\$/, "")}` : "No ticker"}</small></span>
      </div>
      <div><small>Lab score</small><strong>{token.labScore.toFixed(0)}%</strong></div>
      <div><small>Signal</small><strong>{token.trade_count}T · {token.unique_traders}M</strong></div>
      <div><small>Peak after signal</small><strong className={isRunner ? "labRunnerValue" : ""}>{formatMultiple(token.future_peak_multiple)}</strong></div>
      <div><small>Recorded state</small><strong>{token.actual_acquired ? "Acquired" : token.actual_binned ? "Terminated" : "Surveillance"}</strong></div>
      <b>→</b>
    </Link>
  );
}

export function PonsEyeLab({ tokens }: { tokens: LabToken[] }) {
  const [settings, setSettings] = useState<LabSettings>(() => cloneSettings(presets.balanced));
  const [activePreset, setActivePreset] = useState<keyof typeof presets | "custom">("balanced");
  const [resultView, setResultView] = useState<"signals" | "misses">("signals");

  const analysis = useMemo(() => {
    const scored = tokens.map((token) => scoreToken(token, settings));
    const selected = scored.filter((token) => token.selected);
    const rejected = scored.filter((token) => !token.selected);
    const hits = selected.filter((token) => (token.future_peak_multiple ?? 0) >= settings.runnerTarget);
    const misses = rejected.filter((token) => (token.future_peak_multiple ?? 0) >= settings.runnerTarget);
    const falsePositives = selected.filter((token) => (token.future_peak_multiple ?? 0) < 1.2);
    const graduated = selected.filter((token) => token.status === "graduated");
    const orderedSignals = [...selected].sort((a, b) => (b.future_peak_multiple ?? 0) - (a.future_peak_multiple ?? 0));
    const orderedMisses = [...misses].sort((a, b) => (b.future_peak_multiple ?? 0) - (a.future_peak_multiple ?? 0));
    const bands = [
      selected.filter((token) => (token.future_peak_multiple ?? 0) >= 5).length,
      selected.filter((token) => (token.future_peak_multiple ?? 0) >= 3 && (token.future_peak_multiple ?? 0) < 5).length,
      selected.filter((token) => (token.future_peak_multiple ?? 0) >= 2 && (token.future_peak_multiple ?? 0) < 3).length,
      selected.filter((token) => (token.future_peak_multiple ?? 0) >= 1.5 && (token.future_peak_multiple ?? 0) < 2).length,
      selected.filter((token) => (token.future_peak_multiple ?? 0) < 1.5).length,
    ];
    return { selected, hits, misses, falsePositives, graduated, orderedSignals, orderedMisses, bands };
  }, [tokens, settings]);

  function choosePreset(name: keyof typeof presets) {
    setSettings(cloneSettings(presets[name]));
    setActivePreset(name);
  }

  function updateRule(index: number, field: "threshold" | "weight", value: number) {
    setSettings((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, [field]: value } : rule),
    }));
    setActivePreset("custom");
  }

  const hitRate = analysis.selected.length ? analysis.hits.length * 100 / analysis.selected.length : 0;
  const visibleResults = resultView === "signals" ? analysis.orderedSignals : analysis.orderedMisses;

  return (
    <div className="labWorkspace">
      <aside className="labControls">
        <header>
          <div><small>Signal model</small><h2>{activePreset === "custom" ? "Custom model" : `${activePreset[0].toUpperCase()}${activePreset.slice(1)} preset`}</h2></div>
          <button type="button" onClick={() => choosePreset("balanced")}>Reset</button>
        </header>

        <div className="labPresets" aria-label="Model presets">
          {(["discovery", "balanced", "strict"] as const).map((name) => (
            <button key={name} type="button" className={activePreset === name ? "active" : ""} onClick={() => choosePreset(name)}>{name}</button>
          ))}
        </div>

        <section className="labPrimaryControl">
          <label htmlFor="scoreThreshold"><span>Score to acquire</span><strong>{settings.scoreThreshold}%</strong></label>
          <input id="scoreThreshold" type="range" min="30" max="100" step="5" value={settings.scoreThreshold} onChange={(event) => { setSettings({ ...settings, scoreThreshold: Number(event.target.value) }); setActivePreset("custom"); }} />
        </section>

        <div className="labRuleHeading"><span>Rule</span><span>Pass mark</span><span>Weight</span></div>
        <div className="labRules">
          {settings.rules.map((rule, index) => (
            <section className="labRule" key={rule.key}>
              <div className="labRuleTitle"><strong>{rule.label}</strong><span>{rule.direction === "min" ? "Minimum" : "Maximum"}</span></div>
              <label>
                <span>{formatMetric(rule.threshold, rule.suffix)}</span>
                <input aria-label={`${rule.label} pass mark`} type="range" min={rule.min} max={rule.max} step={rule.step} value={rule.threshold} onChange={(event) => updateRule(index, "threshold", Number(event.target.value))} />
              </label>
              <label>
                <span>{rule.weight}</span>
                <input aria-label={`${rule.label} weight`} type="range" min="0" max="30" step="5" value={rule.weight} onChange={(event) => updateRule(index, "weight", Number(event.target.value))} />
              </label>
            </section>
          ))}
        </div>

        <section className="labSafety">
          <div><small>Safety gates</small><strong>Automatic rejection</strong></div>
          <label><span>No creator sales</span><input type="checkbox" checked={settings.creatorGate} onChange={(event) => { setSettings({ ...settings, creatorGate: event.target.checked }); setActivePreset("custom"); }} /></label>
          <label><span>Block concentrated holders</span><input type="checkbox" checked={settings.concentrationGate} onChange={(event) => { setSettings({ ...settings, concentrationGate: event.target.checked }); setActivePreset("custom"); }} /></label>
        </section>
      </aside>

      <section className="labOutput">
        <div className="labOutcomeTarget">
          <span>Measure a runner at</span>
          <div>{runnerOptions.map((target) => <button type="button" className={settings.runnerTarget === target ? "active" : ""} key={target} onClick={() => setSettings({ ...settings, runnerTarget: target })}>{target}x</button>)}</div>
          <small>Peak reached after the Surveillance timestamp</small>
        </div>

        <div className="labSummaryGrid">
          <article className="primary"><small>Signals fired</small><strong>{analysis.selected.length}</strong><span>from {tokens.length} candidates</span></article>
          <article><small>{settings.runnerTarget}x runners</small><strong>{analysis.hits.length}</strong><span>caught after signal</span></article>
          <article><small>Hit rate</small><strong>{hitRate.toFixed(1)}%</strong><span>including stalled tokens</span></article>
          <article><small>Missed runners</small><strong>{analysis.misses.length}</strong><span>rejected by this model</span></article>
          <article><small>Under 1.2x</small><strong>{analysis.falsePositives.length}</strong><span>selected but stalled</span></article>
          <article><small>Graduated</small><strong>{analysis.graduated.length}</strong><span>selected signals</span></article>
        </div>

        <section className="labBreakdown">
          <header><div><small>Selected performance</small><h2>Peak after signal</h2></div><span>Curve + migrated pool</span></header>
          <div className="labBands">
            {[["5x+", analysis.bands[0]], ["3x to 5x", analysis.bands[1]], ["2x to 3x", analysis.bands[2]], ["1.5x to 2x", analysis.bands[3]], ["Under 1.5x", analysis.bands[4]]].map(([label, count], index) => (
              <article key={String(label)} className={index === 0 ? "best" : ""}><span>{label}</span><strong>{count}</strong><i style={{ height: `${Math.max(5, analysis.selected.length ? Number(count) * 100 / analysis.selected.length : 0)}%` }} /></article>
            ))}
          </div>
        </section>

        <section className="labResults">
          <header>
            <div className="labResultTabs">
              <button type="button" className={resultView === "signals" ? "active" : ""} onClick={() => setResultView("signals")}>Selected signals <span>{analysis.selected.length}</span></button>
              <button type="button" className={resultView === "misses" ? "active" : ""} onClick={() => setResultView("misses")}>Missed runners <span>{analysis.misses.length}</span></button>
            </div>
            <small>Sorted by peak performance</small>
          </header>
          <div className="labResultList">
            {visibleResults.length ? visibleResults.slice(0, 40).map((token) => <ResultToken key={token.token_address} token={token} runnerTarget={settings.runnerTarget} />) : (
              <div className="labNoResults">No tokens match this model.</div>
            )}
          </div>
        </section>

        <footer className="labMethodNote">
          <strong>No hindsight in the score.</strong>
          <span>Rules use only metrics recorded when each token first reached Surveillance. Curve and migrated pool prices are joined in USD. Tokens without a safe USD match fall back to curve performance. Holder rules are ignored when no holder snapshot existed at signal time.</span>
        </footer>
      </section>
    </div>
  );
}
