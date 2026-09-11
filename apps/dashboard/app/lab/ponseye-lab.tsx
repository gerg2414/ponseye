"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LabToken } from "../../lib/lab-data";
import { TokenImage } from "../token-image";

type RuleKey = "trade_count" | "unique_traders" | "buy_pressure_pct" | "first_minute_buyers" | "momentum_multiple" | "peak_hold_pct" | "top_10_holder_pct" | "signal_market_cap_usd" | "early_buyer_share_pct";
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
  fastConvictionOverride?: boolean;
  rules: Rule[];
};

type PresetName = "discovery" | "balanced" | "strict" | "early" | "crowd" | "quality" | "steady2x" | "runner3x" | "wide3x" | "tight3x" | "market3x" | "fast3x";
type ControlTab = "models" | "rules" | "gates";
type ExitModel = "fixed" | "nostop" | "breakeven" | "initials";
type ExitProfile = { exitModel: ExitModel; runnerTarget: number; stopLossPct: number; positionSizeUsd: number };
type SavedModel = { name: string; settings: LabSettings };
type SavedExitProfile = { name: string; settings: ExitProfile };

type ScoredToken = LabToken & {
  labScore: number;
  selected: boolean;
  blockedBy: string[];
  passedRules: number;
  availableRules: number;
};

const additionalRules: Rule[] = [
  { key: "signal_market_cap_usd", label: "Signal market cap", short: "market cap", threshold: 5000, min: 1000, max: 30000, step: 500, weight: 0, direction: "min", suffix: "$" },
  { key: "early_buyer_share_pct", label: "Early buyer share", short: "early share", threshold: 50, min: 10, max: 100, step: 5, weight: 0, direction: "min", suffix: "%" },
];

const basePresets: Record<PresetName, LabSettings> = {
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
    stopLossPct: 20,
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
  tight3x: {
    scoreThreshold: 85,
    runnerTarget: 3,
    positionSizeUsd: 25,
    stopLossPct: 10,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 12, min: 5, max: 60, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 12, min: 2, max: 30, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 65, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 8, min: 1, max: 15, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.75, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 70, min: 20, max: 100, step: 5, weight: 15, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 90, min: 30, max: 95, step: 5, weight: 10, direction: "max", suffix: "%" },
    ],
  },
  market3x: {
    scoreThreshold: 90,
    runnerTarget: 3,
    positionSizeUsd: 25,
    stopLossPct: 10,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 12, min: 5, max: 60, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 12, min: 2, max: 30, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 65, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 8, min: 1, max: 15, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.75, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 70, min: 20, max: 100, step: 5, weight: 15, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 90, min: 30, max: 95, step: 5, weight: 10, direction: "max", suffix: "%" },
    ],
  },
  fast3x: {
    fastConvictionOverride: true,
    scoreThreshold: 90,
    runnerTarget: 3,
    positionSizeUsd: 25,
    stopLossPct: 10,
    creatorGate: true,
    concentrationGate: true,
    rules: [
      { key: "trade_count", label: "Trade depth", short: "trades", threshold: 12, min: 5, max: 60, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 12, min: 2, max: 30, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 65, min: 40, max: 75, step: 1, weight: 10, direction: "min", suffix: "%" },
      { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 8, min: 1, max: 15, step: 1, weight: 15, direction: "min", suffix: "" },
      { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 0.75, min: 0.4, max: 2, step: 0.05, weight: 20, direction: "min", suffix: "x" },
      { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 70, min: 20, max: 100, step: 5, weight: 15, direction: "min", suffix: "%" },
      { key: "top_10_holder_pct", label: "Top 10 holders", short: "holder spread", threshold: 90, min: 30, max: 95, step: 5, weight: 10, direction: "max", suffix: "%" },
    ],
  },
};

const presets = Object.fromEntries(
  (Object.entries(basePresets) as Array<[PresetName, LabSettings]>).map(([name, settings]) => [
    name,
    {
      ...settings,
      rules: [
        ...settings.rules,
        ...additionalRules.map((rule) => name === "market3x" || name === "fast3x" ? { ...rule, weight: 25 } : { ...rule }),
      ],
    },
  ]),
) as Record<PresetName, LabSettings>;

const presetDetails: Array<{ name: PresetName; label: string; description: string }> = [
  { name: "steady2x", label: "Tested 2x", description: "Most consistent 2x model" },
  { name: "market3x", label: "Market 3x", description: "Best strict 3x model" },
  { name: "fast3x", label: "Fast Conviction", description: "Market 3x plus exceptional fast launches" },

];

const savedModelsKey = "ponseye-lab-saved-models-v1";
const currentModelKey = "ponseye-lab-current-model-v1";
const savedExitProfilesKey = "ponseye-lab-saved-exits-v1";
const currentExitProfileKey = "ponseye-lab-current-exit-v1";

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
  const savedRules = Array.isArray(candidate.rules) ? candidate.rules : [];
  const rules = presets.balanced.rules.map((template) => {
    const saved = savedRules.find((rule) => rule?.key === template.key);
    if (!saved || typeof saved.threshold !== "number" || typeof saved.weight !== "number") return { ...template };
    return { ...template, threshold: saved.threshold, weight: saved.weight };
  });
  const migrated = {
    ...candidate,
    positionSizeUsd: typeof candidate.positionSizeUsd === "number" ? candidate.positionSizeUsd : 25,
    stopLossPct: typeof candidate.stopLossPct === "number" ? candidate.stopLossPct : 50,
    rules,
  };
  return isLabSettings(migrated) ? cloneSettings(migrated) : null;
}

function valueFor(token: LabToken, key: RuleKey) {
  if (key === "early_buyer_share_pct") {
    return token.unique_traders > 0 ? token.first_minute_buyers * 100 / token.unique_traders : null;
  }
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
  const fastConviction = settings.fastConvictionOverride === true
    && token.signal_age_seconds != null
    && token.signal_age_seconds <= 3
    && token.trade_count >= 12
    && token.unique_traders >= 10
    && (token.buy_pressure_pct ?? 0) >= 80
    && token.first_minute_buyers >= 8
    && (token.momentum_multiple ?? 0) >= 2
    && (token.peak_hold_pct ?? 0) >= 65
    && (token.signal_market_cap_usd ?? 0) >= 10_000
    && token.first_minute_buyers * 100 / Math.max(1, token.unique_traders) >= 75;
  return {
    ...token,
    labScore,
    selected: blockedBy.length === 0 && (labScore >= settings.scoreThreshold || fastConviction),
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
  if (suffix === "$") return formatMarketCap(value);
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
  const entryQuery = new URLSearchParams({ entry: token.signal_at });
  if (token.signal_market_cap_usd && token.signal_market_cap_usd > 0) entryQuery.set("entryMc", String(token.signal_market_cap_usd));
  return (
    <Link className="labResultRow" href={`/launch/${token.token_address}?${entryQuery.toString()}`}>
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
  const [settings, setSettings] = useState<LabSettings>(() => cloneSettings(presets.market3x));
  const [activePreset, setActivePreset] = useState<PresetName | "custom">("market3x");
  const [controlTab, setControlTab] = useState<ControlTab>("models");
  const [exitSettings, setExitSettings] = useState<ExitProfile>({ exitModel: "fixed", runnerTarget: 3, stopLossPct: 10, positionSizeUsd: 25 });
  const exitModel = exitSettings.exitModel;
  const [savedModels, setSavedModels] = useState<SavedModel[]>([]);
  const [savedExitProfiles, setSavedExitProfiles] = useState<SavedExitProfile[]>([]);
  const [modelName, setModelName] = useState("");
  const [exitProfileName, setExitProfileName] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [resultView, setResultView] = useState<"signals" | "misses">("signals");

  useEffect(() => {
    try {
      const current = JSON.parse(window.localStorage.getItem(currentModelKey) ?? "null") as unknown;
      const saved = JSON.parse(window.localStorage.getItem(savedModelsKey) ?? "[]") as unknown;
      const currentExit = JSON.parse(window.localStorage.getItem(currentExitProfileKey) ?? "null") as Partial<ExitProfile> | null;
      const savedExits = JSON.parse(window.localStorage.getItem(savedExitProfilesKey) ?? "[]") as unknown;
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
      if (
        currentExit &&
        ["fixed", "nostop", "breakeven", "initials"].includes(String(currentExit.exitModel)) &&
        typeof currentExit.runnerTarget === "number" &&
        typeof currentExit.stopLossPct === "number" &&
        typeof currentExit.positionSizeUsd === "number"
      ) setExitSettings(currentExit as ExitProfile);
      if (Array.isArray(savedExits)) {
        setSavedExitProfiles(savedExits.flatMap((item) => {
          const profile = item as SavedExitProfile;
          if (!profile || typeof profile.name !== "string" || !profile.settings) return [];
          const value = profile.settings;
          if (!["fixed", "nostop", "breakeven", "initials"].includes(String(value.exitModel))) return [];
          if (![value.runnerTarget, value.stopLossPct, value.positionSizeUsd].every((number) => typeof number === "number")) return [];
          return [{ name: profile.name, settings: value }];
        }));
      }
    } catch {
      // Ignore malformed browser storage and start with the recommended models.
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(currentModelKey, JSON.stringify(settings));
  }, [settings, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(currentExitProfileKey, JSON.stringify(exitSettings));
  }, [exitSettings, storageReady]);

  const analysis = useMemo(() => {
    const scored = tokens.map((token) => scoreToken(token, settings));
    const selected = scored.filter((token) => token.selected);
    const rejected = scored.filter((token) => !token.selected);
    const hits = selected.filter((token) => (token.future_peak_multiple ?? 0) >= exitSettings.runnerTarget);
    const misses = rejected.filter((token) => (token.future_peak_multiple ?? 0) >= exitSettings.runnerTarget);
    const falsePositives = selected.filter((token) => (token.future_peak_multiple ?? 0) < 1.2);
    const graduated = selected.filter((token) => token.status === "graduated");
    const replayable = selected.filter((token) => token.future_peak_multiple != null && token.final_multiple != null);
    const stopMultiple = 1 - exitSettings.stopLossPct / 100;
    const strategyOutcomes = replayable.map((token) => {
      const target = exitSettings.runnerTarget;
      const lowBeforeTarget = token.pre_target_low_multiples[String(target)];
      const lowBeforeTwo = token.pre_target_low_multiples["2"];
      const targetReachedRaw = (token.future_peak_multiple ?? 0) >= target;
      const twoReachedBeforeStop = (token.future_peak_multiple ?? 0) >= 2
        && (exitModel === "nostop" || lowBeforeTwo == null || lowBeforeTwo > stopMultiple);
      const stoppedBeforeTarget = exitModel !== "nostop"
        && lowBeforeTarget != null
        && lowBeforeTarget <= stopMultiple;

      if (exitModel === "initials" && twoReachedBeforeStop) {
        const runnerValue = Math.max(0, token.final_multiple ?? 0);
        return {
          token,
          stopped: false,
          targetReached: true,
          openAtEnd: true,
          exitMultiple: 1 + runnerValue / 2,
        };
      }

      if (exitModel === "breakeven" && twoReachedBeforeStop && target > 2) {
        const lowAfterTwoBeforeTarget = token.post_2x_pre_target_low_multiples[String(target)];
        const breakevenHit = lowAfterTwoBeforeTarget != null && lowAfterTwoBeforeTarget <= 1;
        if (breakevenHit) {
          return { token, stopped: true, targetReached: false, openAtEnd: false, exitMultiple: 1 };
        }
      }

      const stopped = stoppedBeforeTarget;
      const targetReached = targetReachedRaw && !stopped;
      const exitMultiple = stopped ? stopMultiple : targetReached ? target : Math.max(0, token.final_multiple ?? 0);
      return { token, stopped, targetReached, openAtEnd: !stopped && !targetReached, exitMultiple };
    });
    const stopHits = strategyOutcomes.filter((outcome) => outcome.stopped).length;
    const targetExits = strategyOutcomes.filter((outcome) => outcome.targetReached).length;
    const openAtEnd = strategyOutcomes.filter((outcome) => outcome.openAtEnd).length;
    const capitalTested = strategyOutcomes.length * exitSettings.positionSizeUsd;
    const simulatedEndValue = strategyOutcomes.reduce((total, outcome) => total + exitSettings.positionSizeUsd * outcome.exitMultiple, 0);
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
  }, [tokens, settings, exitSettings]);

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

  function chooseExitModel(model: ExitModel) {
    setExitSettings((current) => ({ ...current, exitModel: model }));
  }

  function saveExitProfile() {
    const name = exitProfileName.trim() || `Exit setup ${savedExitProfiles.length + 1}`;
    const next = [
      ...savedExitProfiles.filter((profile) => profile.name.toLocaleLowerCase() !== name.toLocaleLowerCase()),
      { name, settings: { ...exitSettings } },
    ];
    setSavedExitProfiles(next);
    setExitProfileName("");
    window.localStorage.setItem(savedExitProfilesKey, JSON.stringify(next));
  }

  function loadExitProfile(profile: SavedExitProfile) {
    setExitSettings({ ...profile.settings });
  }

  function deleteExitProfile(name: string) {
    const next = savedExitProfiles.filter((profile) => profile.name !== name);
    setSavedExitProfiles(next);
    window.localStorage.setItem(savedExitProfilesKey, JSON.stringify(next));
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
  const entryLabel = activePreset === "custom" ? "Custom setup" : presetDetails.find((preset) => preset.name === activePreset)?.label;
  const exitLabel = {
    fixed: "Fixed target",
    nostop: "No initial stop",
    breakeven: "Break even at 2x",
    initials: "Initials at 2x",
  }[exitModel];

  return (
    <>
      <section className="labModelDock">
        <details className="labDrawer entry">
          <summary>
            <div><small>Entry model</small><strong>{entryLabel}</strong><span>{analysis.selected.length} acquired · {hitRate.toFixed(1)}% hit rate</span></div>
            <b>Settings</b>
          </summary>
          <aside className="labControls">
        <header>
          <div><small>Signal model</small><h2>{activePreset === "custom" ? "Custom setup" : presetDetails.find((preset) => preset.name === activePreset)?.label}</h2></div>
          <button type="button" onClick={() => choosePreset("market3x")}>Reset</button>
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
                      <button type="button" onClick={() => loadModel(model)}><strong>{model.name}</strong><small>{model.settings.scoreThreshold}% score · {model.exitSettings.runnerTarget}x target</small></button>
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
        </details>

        <details className="labDrawer exit">
          <summary>
            <div><small>Exit model</small><strong>{exitLabel}</strong><span>{exitSettings.runnerTarget}x target · {exitModel === "nostop" ? "no stop" : `${exitSettings.stopLossPct}% stop`}</span></div>
            <aside className={analysis.simulatedPnl >= 0 ? "positive" : "negative"}>
              <small>Simulated result</small>
              <strong>{analysis.simulatedPnl >= 0 ? "+" : ""}{formatUsd(analysis.simulatedPnl)}</strong>
              <span>{analysis.simulatedRoi >= 0 ? "+" : ""}{analysis.simulatedRoi.toFixed(1)}% ROI</span>
            </aside>
            <b>Settings</b>
          </summary>
          <section className="labStrategyPanel">
          <header><div><small>Trade replay</small><h2>Test the exit</h2></div><span>Using the selected Entry Model</span></header>
          <nav className="labExitModels" aria-label="Exit model">
            <button type="button" className={exitModel === "fixed" ? "active" : ""} onClick={() => chooseExitModel("fixed")}><strong>Fixed target</strong><small>Stop first, then sell everything at target</small></button>
            <button type="button" className={exitModel === "nostop" ? "active" : ""} onClick={() => chooseExitModel("nostop")}><strong>No initial stop</strong><small>Hold until target or the recorded end price</small></button>
            <button type="button" className={exitModel === "breakeven" ? "active" : ""} onClick={() => chooseExitModel("breakeven")}><strong>Break even at 2x</strong><small>Move the stop to entry after price reaches 2x</small></button>
            <button type="button" className={exitModel === "initials" ? "active" : ""} onClick={() => chooseExitModel("initials")}><strong>Initials at 2x</strong><small>Sell half at 2x and leave the rest running</small></button>
          </nav>
          <div className="labStrategyControls">
            <div className="target">
              <label>Take profit</label>
              <strong>{exitSettings.runnerTarget}x</strong>
              <div>{runnerOptions.map((target) => <button type="button" className={exitSettings.runnerTarget === target ? "active" : ""} key={target} onClick={() => setExitSettings({ ...exitSettings, runnerTarget: target })}>{target}x</button>)}</div>
            </div>
            <div className="stop">
              <label htmlFor="stopLoss">Initial stop loss</label>
              <strong>{exitModel === "nostop" ? "OFF" : `−${exitSettings.stopLossPct}%`}</strong>
              <input id="stopLoss" aria-label="Stop loss percentage" type="range" min="10" max="90" step="5" value={exitSettings.stopLossPct} disabled={exitModel === "nostop"} onChange={(event) => setExitSettings({ ...exitSettings, stopLossPct: Number(event.target.value) })} />
            </div>
            <label className="stake">
              <span>Position size</span>
              <strong><b>$</b><input aria-label="Position size in dollars" type="number" min="1" step="1" value={exitSettings.positionSizeUsd} onChange={(event) => setExitSettings({ ...exitSettings, positionSizeUsd: Math.max(1, Number(event.target.value) || 1) })} /></strong>
              <small>Placed on every token that reaches Acquired</small>
            </label>
          </div>
          <div className="labReplayCounts">
            <article className="stopped"><small>Stop hit first</small><strong>{analysis.stopHits}</strong><span>sold at −{exitSettings.stopLossPct}%</span></article>
            <article className="target"><small>{exitSettings.runnerTarget}x hit first</small><strong>{analysis.targetExits}</strong><span>sold at target</span></article>
            <article className="open"><small>Neither hit</small><strong>{analysis.openAtEnd}</strong><span>valued at final recorded price</span></article>
            <article className="unknown"><small>No replay data</small><strong>{analysis.selected.length - analysis.replayable.length}</strong><span>excluded from money result</span></article>
          </div>
          </section>
        </details>
      </section>

      <section className="labOutput">
        <div className="labSummaryGrid">
          <article className="primary"><small>Would reach Acquired</small><strong>{analysis.selected.length}</strong><span>from {tokens.length} Surveillance tokens</span></article>
          <article><small>{exitSettings.runnerTarget}x peak reached</small><strong>{analysis.hits.length}</strong><span>before applying the stop</span></article>
          <article><small>Hit rate</small><strong>{hitRate.toFixed(1)}%</strong><span>including stalled tokens</span></article>
          <article><small>Missed runners</small><strong>{analysis.misses.length}</strong><span>rejected by this model</span></article>
          <article><small>Under 1.2x</small><strong>{analysis.falsePositives.length}</strong><span>selected but stalled</span></article>
          <article><small>Graduated</small><strong>{analysis.graduated.length}</strong><span>selected signals</span></article>
        </div>

        <details className="labMoreAnalysis">
          <summary><div><small>Optional detail</small><strong>More analysis</strong></div><span>Runner ladder, money breakdown and peak bands</span></summary>
          <div className="labMoreAnalysisContent">
        <section className="labRunnerLadder">
          <header><div><small>Runner ladder</small><h2>Runners surviving the {exitSettings.stopLossPct}% stop</h2></div><span>Caught from all Surveillance runners</span></header>
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
          <header><div><small>Strategy result</small><h2>{formatUsd(exitSettings.positionSizeUsd)} per acquired token</h2></div><span>{exitModel === "initials" ? "Initials at 2x · runner held" : exitModel === "breakeven" ? `${exitSettings.runnerTarget}x target · break even after 2x` : exitModel === "nostop" ? `${exitSettings.runnerTarget}x target · no stop` : `${exitSettings.runnerTarget}x target · ${exitSettings.stopLossPct}% stop`}</span></header>
          <div className="labMoneyGrid">
            <article><small>Capital tested</small><strong>{formatUsd(analysis.capitalTested)}</strong><span>{analysis.replayable.length} replayed positions</span></article>
            <article><small>End value</small><strong>{formatUsd(analysis.simulatedEndValue)}</strong><span>Targets, stops and open positions</span></article>
            <article className={analysis.simulatedPnl >= 0 ? "positive" : "negative"}><small>Strategy P&amp;L</small><strong>{analysis.simulatedPnl >= 0 ? "+" : ""}{formatUsd(analysis.simulatedPnl)}</strong><span>{analysis.simulatedRoi >= 0 ? "+" : ""}{analysis.simulatedRoi.toFixed(1)}% return</span></article>
          </div>
          <p>{exitModel === "initials" ? "Half the tokens are sold at 2x to recover the initial stake. The remaining half is valued at the final recorded price." : exitModel === "breakeven" ? "The initial stop applies until 2x. After 2x, the stop moves to the entry price while the selected target remains active." : exitModel === "nostop" ? "Positions are held until the selected target or valued at the final recorded price when the target is not reached." : "Each position exits when the stop or take profit is reached first. Positions hitting neither are valued at their final recorded price."} Figures exclude fees and slippage.</p>
        </section>

        <section className="labBreakdown">
          <header><div><small>Selected performance</small><h2>Peak after signal</h2></div><span>Curve + migrated pool</span></header>
          <div className="labBands">
            {[["5x+", analysis.bands[0]], ["3x to 5x", analysis.bands[1]], ["2x to 3x", analysis.bands[2]], ["1.5x to 2x", analysis.bands[3]], ["Under 1.5x", analysis.bands[4]]].map(([label, count], index) => (
              <article key={String(label)} className={index === 0 ? "best" : ""}><span>{label}</span><strong>{count}</strong><i style={{ height: `${Math.max(5, analysis.selected.length ? Number(count) * 100 / analysis.selected.length : 0)}%` }} /></article>
            ))}
          </div>
        </section>

          </div>
        </details>

        <section className="labResults">
          <header>
            <div className="labResultTabs">
              <button type="button" className={resultView === "signals" ? "active" : ""} onClick={() => setResultView("signals")}>Would reach Acquired <span>{analysis.selected.length}</span></button>
              <button type="button" className={resultView === "misses" ? "active" : ""} onClick={() => setResultView("misses")}>Rejected runners <span>{analysis.misses.length}</span></button>
            </div>
            <small>Sorted by peak performance</small>
          </header>
          <div className="labResultList">
            {visibleResults.length ? visibleResults.slice(0, 40).map((token) => <ResultToken key={token.token_address} token={token} runnerTarget={exitSettings.runnerTarget} />) : (
              <div className="labNoResults">No tokens match this model.</div>
            )}
          </div>
        </section>

        <footer className="labMethodNote">
          <strong>No hindsight in the score.</strong>
          <span>Rules use only metrics recorded when each token first reached Surveillance. Curve and migrated pool prices are joined in USD. Tokens without a safe USD match fall back to curve performance. Holder rules are ignored when no holder snapshot existed at signal time.</span>
        </footer>
      </section>
    </>
  );
}
