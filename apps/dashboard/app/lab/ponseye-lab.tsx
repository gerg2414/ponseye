"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  positionSizeUsd: number;
  stopLossPct: number;
  creatorGate: boolean;
  concentrationGate: boolean;
  rules: Rule[];
};

type PresetName = "discovery" | "balanced" | "strict" | "early" | "crowd" | "quality" | "steady2x" | "runner3x" | "wide3x";
type ControlTab = "models" | "rules" | "gates";
type SavedModel = { name: string; settings: LabSettings };

type ScoredToken = LabToken & {
  labScore: number;
  selected: boolean;
  blockedBy: string[];
  passedRules: number;
  availableRules: number;
};

const presets: Record<PresetName, LabSettings> = {
  balanced: {
    scoreThreshold: 70,
    runnerTarget: 2,
    positionSizeUsd: 25,
    stopLossPct: 50,
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
    positionSizeUsd: 25,
    stopLossPct: 50,
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
    positionSizeUsd: 25,
    stopLossPct: 50,
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
  early: {
    scoreThreshold: 65,
    runnerTarget: 2,
    positionSizeUsd: 25,
    stopLossPct: 50,
    creatorGate: true,
    concentrationGate: false,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 10, min: 5, max: 60, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 5, min: 2, max: 30, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 55, min: 40, max: 75, step: 1, weight: 15, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 7, min: 1, max: 15, step: 1, weight: 25, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.75, min: 0.4, max: 2, step: 0.05, weight: 25, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 45, min: 20, max: 100, step: 5, weight: 10, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 85, min: 30, max: 95, step: 5, weight: 5, direction: "max", suffix: "%" },
    ],
  },
  crowd: {
    scoreThreshold: 65,
    runnerTarget: 2,
    positionSizeUsd: 25,
    stopLossPct: 50,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 20, min: 5, max: 60, step: 1, weight: 20, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 12, min: 2, max: 30, step: 1, weight: 25, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 52, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 6, min: 1, max: 15, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.7, min: 0.4, max: 2, step: 0.05, weight: 10, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 50, min: 20, max: 100, step: 5, weight: 5, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 80, min: 30, max: 95, step: 5, weight: 20, direction: "max", suffix: "%" },
    ],
  },
  quality: {
    scoreThreshold: 75,
    runnerTarget: 2,
    positionSizeUsd: 25,
    stopLossPct: 50,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 18, min: 5, max: 60, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 10, min: 2, max: 30, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 55, min: 40, max: 75, step: 1, weight: 5, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 5, min: 1, max: 15, step: 1, weight: 5, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.9, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 70, min: 20, max: 100, step: 5, weight: 25, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 60, min: 30, max: 95, step: 5, weight: 25, direction: "max", suffix: "%" },
    ],
  },
  // Best repeatable candidates from the 10 Sep recorded dataset. Each remained
  // positive across all four chronological test periods and under a 5% cost stress.
  steady2x: {
    scoreThreshold: 90,
    runnerTarget: 2,
    positionSizeUsd: 25,
    stopLossPct: 30,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 8, min: 5, max: 60, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 12, min: 2, max: 30, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 58, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 4, min: 1, max: 15, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.9, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 70, min: 20, max: 100, step: 5, weight: 15, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 90, min: 30, max: 95, step: 5, weight: 15, direction: "max", suffix: "%" },
    ],
  },
  runner3x: {
    scoreThreshold: 70,
    runnerTarget: 3,
    positionSizeUsd: 25,
    stopLossPct: 40,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 15, min: 5, max: 60, step: 1, weight: 20, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 12, min: 2, max: 30, step: 1, weight: 25, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 60, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 7, min: 1, max: 15, step: 1, weight: 10, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 1.05, min: 0.4, max: 2, step: 0.05, weight: 10, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 70, min: 20, max: 100, step: 5, weight: 5, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 55, min: 30, max: 95, step: 5, weight: 20, direction: "max", suffix: "%" },
    ],
  },
  wide3x: {
    scoreThreshold: 70,
    runnerTarget: 3,
    positionSizeUsd: 25,
    stopLossPct: 30,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 30, min: 5, max: 60, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 12, min: 2, max: 30, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 60, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 6, min: 1, max: 15, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 1.2, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 50, min: 20, max: 100, step: 5, weight: 15, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 85, min: 30, max: 95, step: 5, weight: 10, direction: "max", suffix: "%" },
    ],
  },
};

const presetDetails: Array<{ name: PresetName; label: string; description: string }> = [
  { name: "discovery", label: "Discovery", description: "Wide net for finding missed runners" },
  { name: "balanced", label: "Balanced", description: "Current all-round signal model" },
  { name: "strict", label: "Strict", description: "Fewer signals with every rule passed" },
  { name: "early", label: "Early velocity", description: "Weights first-minute pace and momentum" },
  { name: "crowd", label: "Crowd strength", description: "Weights trader depth and distribution" },
  { name: "quality", label: "Quality hold", description: "Weights retention and holder spread" },
  { name: "steady2x", label: "Tested 2x", description: "30 signals · all four periods positive" },
  { name: "runner3x", label: "Tested 3x", description: "35 signals · selective runner search" },
  { name: "wide3x", label: "Wider 3x", description: "56 signals · broader tested search" },
];

const savedModelsKey = "ponseye-lab-saved-models-v1";
const currentModelKey = "ponseye-lab-current-model-v1";

const runnerOptions = [1.5, 2, 3, 5, 10, 20, 50, 100];
const runnerLadderTargets = [2, 5, 10, 20, 50, 100];

function cloneSettings(settings: LabSettings): LabSettings {
  return { ...settings, rules: settings.rules.map((rule) => ({ ...rule })) };
}

function isLabSettings(value: unknown): value is LabSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LabSettings>;
  return typeof candidate.scoreThreshold === "number"
    && typeof candidate.runnerTarget === "number"
    && typeof candidate.positionSizeUsd === "number"
    && typeof candidate.stopLossPct === "number"
    && typeof candidate.creatorGate === "boolean"
    && typeof candidate.concentrationGate === "boolean"
    && Array.isArray(candidate.rules)
    && candidate.rules.length === presets.balanced.rules.length
    && candidate.rules.every((rule) => rule && typeof rule.threshold === "number" && typeof rule.weight === "number");
}

function normaliseLabSettings(value: unknown): LabSettings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LabSettings>;
  const migrated = {
    ...candidate,
    positionSizeUsd: typeof candidate.positionSizeUsd === "number" ? candidate.positionSizeUsd : 25,
    stopLossPct: typeof candidate.stopLossPct === "number" ? candidate.stopLossPct : 50,
  };
  return isLabSettings(migrated) ? cloneSettings(migrated) : null;
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

function formatMarketCap(value: number | null) {
  if (value == null || value <= 0) return "Pending";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
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
      <div><small>Signal market cap</small><strong>{formatMarketCap(token.signal_market_cap_usd)}</strong></div>
      <div><small>Peak after signal</small><strong className={isRunner ? "labRunnerValue" : ""}>{formatMultiple(token.future_peak_multiple)}</strong></div>
      <div><small>Recorded state</small><strong>{token.actual_acquired ? "Acquired" : token.actual_binned ? "Terminated" : "Surveillance"}</strong></div>
      <b>→</b>
    </Link>
  );
}

export function PonsEyeLab({ tokens }: { tokens: LabToken[] }) {
  const [settings, setSettings] = useState<LabSettings>(() => cloneSettings(presets.balanced));
  const [activePreset, setActivePreset] = useState<PresetName | "custom">("balanced");
  const [controlTab, setControlTab] = useState<ControlTab>("models");
  const [savedModels, setSavedModels] = useState<SavedModel[]>([]);
  const [modelName, setModelName] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [resultView, setResultView] = useState<"signals" | "misses">("signals");

  useEffect(() => {
    try {
      const current = JSON.parse(window.localStorage.getItem(currentModelKey) ?? "null") as unknown;
      const saved = JSON.parse(window.localStorage.getItem(savedModelsKey) ?? "[]") as unknown;
      const restoredCurrent = normaliseLabSettings(current);
      if (restoredCurrent) {
        setSettings(restoredCurrent);
        setActivePreset("custom");
      }
      if (Array.isArray(saved)) {
        setSavedModels(saved.flatMap((item) => {
          if (!item || typeof item !== "object" || typeof (item as SavedModel).name !== "string") return [];
          const restoredSettings = normaliseLabSettings((item as SavedModel).settings);
          return restoredSettings ? [{ name: (item as SavedModel).name, settings: restoredSettings }] : [];
        }));
      }
    } catch {
      // Ignore malformed browser storage and start with the balanced model.
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(currentModelKey, JSON.stringify(settings));
  }, [settings, storageReady]);

  const analysis = useMemo(() => {
    const scored = tokens.map((token) => scoreToken(token, settings));
    const selected = scored.filter((token) => token.selected);
    const rejected = scored.filter((token) => !token.selected);
    const hits = selected.filter((token) => (token.future_peak_multiple ?? 0) >= settings.runnerTarget);
    const misses = rejected.filter((token) => (token.future_peak_multiple ?? 0) >= settings.runnerTarget);
    const falsePositives = selected.filter((token) => (token.future_peak_multiple ?? 0) < 1.2);
    const graduated = selected.filter((token) => token.status === "graduated");
    const replayable = selected.filter((token) => token.future_peak_multiple != null && token.final_multiple != null);
    const stopMultiple = 1 - settings.stopLossPct / 100;
    const strategyOutcomes = replayable.map((token) => {
      const lowBeforeTarget = token.pre_target_low_multiples[String(settings.runnerTarget)];
      const stopped = lowBeforeTarget != null && lowBeforeTarget <= stopMultiple;
      const targetReached = (token.future_peak_multiple ?? 0) >= settings.runnerTarget;
      const exitMultiple = stopped ? stopMultiple : targetReached ? settings.runnerTarget : Math.max(0, token.final_multiple ?? 0);
      return { token, stopped, targetReached: targetReached && !stopped, openAtEnd: !stopped && !targetReached, exitMultiple };
    });
    const stopHits = strategyOutcomes.filter((outcome) => outcome.stopped).length;
    const targetExits = strategyOutcomes.filter((outcome) => outcome.targetReached).length;
    const openAtEnd = strategyOutcomes.filter((outcome) => outcome.openAtEnd).length;
    const capitalTested = strategyOutcomes.length * settings.positionSizeUsd;
    const simulatedEndValue = strategyOutcomes.reduce((total, outcome) => total + settings.positionSizeUsd * outcome.exitMultiple, 0);
    const simulatedPnl = simulatedEndValue - capitalTested;
    const simulatedRoi = capitalTested ? simulatedPnl * 100 / capitalTested : 0;
    const orderedSignals = [...selected].sort((a, b) => (b.future_peak_multiple ?? 0) - (a.future_peak_multiple ?? 0));
    const orderedMisses = [...misses].sort((a, b) => (b.future_peak_multiple ?? 0) - (a.future_peak_multiple ?? 0));
    const bands = [
      selected.filter((token) => (token.future_peak_multiple ?? 0) >= 5).length,
      selected.filter((token) => (token.future_peak_multiple ?? 0) >= 3 && (token.future_peak_multiple ?? 0) < 5).length,
      selected.filter((token) => (token.future_peak_multiple ?? 0) >= 2 && (token.future_peak_multiple ?? 0) < 3).length,
      selected.filter((token) => (token.future_peak_multiple ?? 0) >= 1.5 && (token.future_peak_multiple ?? 0) < 2).length,
      selected.filter((token) => (token.future_peak_multiple ?? 0) < 1.5).length,
    ];
    const runnerLadder = runnerLadderTargets.map((target) => ({
      target,
      caught: selected.filter((token) => {
        const lowBeforeTarget = token.pre_target_low_multiples[String(target)];
        return (token.future_peak_multiple ?? 0) >= target && (lowBeforeTarget == null || lowBeforeTarget > stopMultiple);
      }).length,
      total: scored.filter((token) => (token.future_peak_multiple ?? 0) >= target).length,
    }));
    return { selected, hits, misses, falsePositives, graduated, replayable, stopHits, targetExits, openAtEnd, capitalTested, simulatedEndValue, simulatedPnl, simulatedRoi, orderedSignals, orderedMisses, bands, runnerLadder };
  }, [tokens, settings]);

  function choosePreset(name: PresetName) {
    setSettings(cloneSettings(presets[name]));
    setActivePreset(name);
  }

  function saveModel() {
    const fallbackName = `My setup ${savedModels.length + 1}`;
    const name = modelName.trim() || fallbackName;
    const next = [
      ...savedModels.filter((model) => model.name.toLocaleLowerCase() !== name.toLocaleLowerCase()),
      { name, settings: cloneSettings(settings) },
    ];
    setSavedModels(next);
    setModelName("");
    window.localStorage.setItem(savedModelsKey, JSON.stringify(next));
  }

  function loadModel(model: SavedModel) {
    setSettings(cloneSettings(model.settings));
    setActivePreset("custom");
  }

  function deleteModel(name: string) {
    const next = savedModels.filter((model) => model.name !== name);
    setSavedModels(next);
    window.localStorage.setItem(savedModelsKey, JSON.stringify(next));
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
          <div><small>Signal model</small><h2>{activePreset === "custom" ? "Custom setup" : presetDetails.find((preset) => preset.name === activePreset)?.label}</h2></div>
          <button type="button" onClick={() => choosePreset("balanced")}>Reset</button>
        </header>

        <nav className="labControlTabs" aria-label="Lab controls">
          {(["models", "rules", "gates"] as const).map((tab) => (
            <button key={tab} type="button" className={controlTab === tab ? "active" : ""} onClick={() => setControlTab(tab)}>{tab}</button>
          ))}
        </nav>

        {controlTab === "models" && (
          <section className="labModelsPanel">
            <div className="labPresetGrid" aria-label="Model presets">
              {presetDetails.map((preset) => (
                <button key={preset.name} type="button" className={activePreset === preset.name ? "active" : ""} onClick={() => choosePreset(preset.name)}>
                  <strong>{preset.label}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>

            <div className="labSavedModels">
              <header><div><small>Saved setups</small><strong>This browser</strong></div></header>
              <form onSubmit={(event) => { event.preventDefault(); saveModel(); }}>
                <input aria-label="Setup name" placeholder={`My setup ${savedModels.length + 1}`} value={modelName} onChange={(event) => setModelName(event.target.value)} />
                <button type="submit">Save current</button>
              </form>
              {savedModels.length ? (
                <div className="labSavedList">
                  {savedModels.map((model) => (
                    <article key={model.name}>
                      <button type="button" onClick={() => loadModel(model)}><strong>{model.name}</strong><small>{model.settings.scoreThreshold}% score · {model.settings.runnerTarget}x target</small></button>
                      <button type="button" aria-label={`Delete ${model.name}`} onClick={() => deleteModel(model.name)}>×</button>
                    </article>
                  ))}
                </div>
              ) : <p>No saved setups yet.</p>}
            </div>
          </section>
        )}

        {controlTab === "rules" && (
          <>
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
          </>
        )}

        {controlTab === "gates" && (
          <section className="labSafety">
            <div><small>Safety gates</small><strong>Automatic rejection</strong></div>
            <p>Gates reject a token before its weighted score is considered.</p>
            <label><span><b>No creator sales</b><small>Reject any creator sell before signal</small></span><input type="checkbox" checked={settings.creatorGate} onChange={(event) => { setSettings({ ...settings, creatorGate: event.target.checked }); setActivePreset("custom"); }} /></label>
            <label><span><b>Holder concentration</b><small>Reject above the Top 10 rule limit</small></span><input type="checkbox" checked={settings.concentrationGate} onChange={(event) => { setSettings({ ...settings, concentrationGate: event.target.checked }); setActivePreset("custom"); }} /></label>
          </section>
        )}
      </aside>

      <section className="labOutput">
        <section className="labStrategyPanel">
          <header><div><small>Trade replay</small><h2>Test the entry and exit</h2></div><span>From the Surveillance price</span></header>
          <div className="labStrategyControls">
            <div className="target">
              <label>Take profit</label>
              <strong>{settings.runnerTarget}x</strong>
              <div>{runnerOptions.map((target) => <button type="button" className={settings.runnerTarget === target ? "active" : ""} key={target} onClick={() => { setSettings({ ...settings, runnerTarget: target }); setActivePreset("custom"); }}>{target}x</button>)}</div>
            </div>
            <div className="stop">
              <label htmlFor="stopLoss">Stop loss</label>
              <strong>−{settings.stopLossPct}%</strong>
              <input id="stopLoss" aria-label="Stop loss percentage" type="range" min="10" max="90" step="5" value={settings.stopLossPct} onChange={(event) => { setSettings({ ...settings, stopLossPct: Number(event.target.value) }); setActivePreset("custom"); }} />
            </div>
            <label className="stake">
              <span>Position size</span>
              <strong><b>$</b><input aria-label="Position size in dollars" type="number" min="1" step="1" value={settings.positionSizeUsd} onChange={(event) => { setSettings({ ...settings, positionSizeUsd: Math.max(1, Number(event.target.value) || 1) }); setActivePreset("custom"); }} /></strong>
              <small>Placed on every token that reaches Acquired</small>
            </label>
          </div>
          <div className="labReplayCounts">
            <article className="stopped"><small>Stop hit first</small><strong>{analysis.stopHits}</strong><span>sold at −{settings.stopLossPct}%</span></article>
            <article className="target"><small>{settings.runnerTarget}x hit first</small><strong>{analysis.targetExits}</strong><span>sold at target</span></article>
            <article className="open"><small>Neither hit</small><strong>{analysis.openAtEnd}</strong><span>valued at final recorded price</span></article>
            <article className="unknown"><small>No replay data</small><strong>{analysis.selected.length - analysis.replayable.length}</strong><span>excluded from money result</span></article>
          </div>
        </section>

        <div className="labSummaryGrid">
          <article className="primary"><small>Would reach Acquired</small><strong>{analysis.selected.length}</strong><span>from {tokens.length} Surveillance tokens</span></article>
          <article><small>{settings.runnerTarget}x peak reached</small><strong>{analysis.hits.length}</strong><span>before applying the stop</span></article>
          <article><small>Hit rate</small><strong>{hitRate.toFixed(1)}%</strong><span>including stalled tokens</span></article>
          <article><small>Missed runners</small><strong>{analysis.misses.length}</strong><span>rejected by this model</span></article>
          <article><small>Under 1.2x</small><strong>{analysis.falsePositives.length}</strong><span>selected but stalled</span></article>
          <article><small>Graduated</small><strong>{analysis.graduated.length}</strong><span>selected signals</span></article>
        </div>

        <section className="labRunnerLadder">
          <header><div><small>Runner ladder</small><h2>Runners surviving the {settings.stopLossPct}% stop</h2></div><span>Caught from all Surveillance runners</span></header>
          <div>
            {analysis.runnerLadder.map((level) => {
              const catchRate = level.total ? level.caught * 100 / level.total : 0;
              return (
                <article key={level.target}>
                  <small>{level.target}x+</small>
                  <strong>{level.caught}</strong>
                  <span>of {level.total} runners</span>
                  <i><b style={{ width: `${catchRate}%` }} /></i>
                </article>
              );
            })}
          </div>
        </section>

        <section className="labMoneyPanel">
          <header><div><small>Strategy result</small><h2>{formatUsd(settings.positionSizeUsd)} per acquired token</h2></div><span>{settings.runnerTarget}x target · {settings.stopLossPct}% stop</span></header>
          <div className="labMoneyGrid">
            <article><small>Capital tested</small><strong>{formatUsd(analysis.capitalTested)}</strong><span>{analysis.replayable.length} replayed positions</span></article>
            <article><small>End value</small><strong>{formatUsd(analysis.simulatedEndValue)}</strong><span>Targets, stops and open positions</span></article>
            <article className={analysis.simulatedPnl >= 0 ? "positive" : "negative"}><small>Strategy P&amp;L</small><strong>{analysis.simulatedPnl >= 0 ? "+" : ""}{formatUsd(analysis.simulatedPnl)}</strong><span>{analysis.simulatedRoi >= 0 ? "+" : ""}{analysis.simulatedRoi.toFixed(1)}% return</span></article>
          </div>
          <p>Each position exits when the stop or take profit is reached first. Positions hitting neither are valued at their final recorded price. Figures exclude fees and slippage.</p>
        </section>

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
              <button type="button" className={resultView === "signals" ? "active" : ""} onClick={() => setResultView("signals")}>Would reach Acquired <span>{analysis.selected.length}</span></button>
              <button type="button" className={resultView === "misses" ? "active" : ""} onClick={() => setResultView("misses")}>Rejected runners <span>{analysis.misses.length}</span></button>
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
