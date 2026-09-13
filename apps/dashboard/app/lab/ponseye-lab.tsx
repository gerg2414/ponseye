"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { LabToken } from "../../lib/lab-data";
import { TokenImage } from "../token-image";
import resultStyles from "./lab-results.module.css";

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
  fastRouteEnabled?: boolean;
  fastRules?: Rule[];
  rules: Rule[];
};

type PresetName = "discovery" | "balanced" | "strict" | "early" | "crowd" | "quality" | "steady2x" | "runner3x" | "wide3x" | "tight3x" | "market3x" | "fast3x";
type ControlTab = "sighted" | "surveilling" | "acquired" | "rejected" | "exit" | "position";
type AcquisitionTab = "score" | "fast" | "rejection";
type ResultSort = "newest" | "score" | "peak" | "market-cap";
type ExitModel = "fixed" | "breakeven" | "initials" | "staggered";
type TakeProfitLevel = { target: number; sellPct: number };
type ExitProfile = {
  exitModel: ExitModel;
  runnerTarget: number;
  stopLossPct: number;
  stopEnabled: boolean;
  positionSizeUsd: number;
  takeProfitLevels: TakeProfitLevel[];
};
type SavedModel = { name: string; settings: LabSettings };
type SavedExitProfile = { name: string; settings: ExitProfile };

type ScoredToken = LabToken & {
  labScore: number;
  selected: boolean;
  blockedBy: string[];
  rejectedOn: string[];
  passedRules: number;
  availableRules: number;
};

const additionalRules: Rule[] = [
  { key: "signal_market_cap_usd", label: "Signal market cap", short: "market cap", threshold: 5000, min: 1000, max: 30000, step: 500, weight: 0, direction: "min", suffix: "$" },
  { key: "early_buyer_share_pct", label: "Early buyer share", short: "early share", threshold: 50, min: 10, max: 100, step: 5, weight: 0, direction: "min", suffix: "%" },
];

const ruleDescriptions: Record<RuleKey, string> = {
  trade_count: "All buy and sell trades recorded by the signal",
  unique_traders: "Different wallets that had traded by the signal",
  buy_pressure_pct: "Buy trades as a percentage of all trades",
  first_minute_buyers: "Different wallets that bought within 60 seconds of launch",
  momentum_multiple: "Signal price divided by the token's first recorded price",
  peak_hold_pct: "How much of the pre-signal peak price was still held",
  top_10_holder_pct: "Percentage of supply held by the ten largest holders",
  signal_market_cap_usd: "USD market cap when the signal was recorded",
  early_buyer_share_pct: "First minute buyers as a percentage of all unique traders",
};

const fastTrackRules: Rule[] = [
  { key: "signal_market_cap_usd", label: "Signal market cap", short: "market cap", threshold: 30000, min: 5000, max: 100000, step: 5000, weight: 0, direction: "min", suffix: "$" },
  { key: "trade_count", label: "Trade depth", short: "trades", threshold: 50, min: 10, max: 100, step: 5, weight: 0, direction: "min", suffix: "" },
  { key: "unique_traders", label: "Trader spread", short: "traders", threshold: 15, min: 5, max: 50, step: 1, weight: 0, direction: "min", suffix: "" },
  { key: "buy_pressure_pct", label: "Buy pressure", short: "buy pressure", threshold: 58, min: 40, max: 90, step: 1, weight: 0, direction: "min", suffix: "%" },
  { key: "first_minute_buyers", label: "Early buyers", short: "early buyers", threshold: 3, min: 1, max: 20, step: 1, weight: 0, direction: "min", suffix: "" },
  { key: "momentum_multiple", label: "Launch momentum", short: "momentum", threshold: 1.2, min: 0.5, max: 3, step: 0.05, weight: 0, direction: "min", suffix: "x" },
  { key: "peak_hold_pct", label: "Peak retained", short: "peak retained", threshold: 60, min: 20, max: 100, step: 5, weight: 0, direction: "min", suffix: "%" },
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
      fastRouteEnabled: settings.fastConvictionOverride === true,
      fastRules: fastTrackRules.map((rule) => ({ ...rule })),
      rules: [
        ...settings.rules,
        ...additionalRules.map((rule) => name === "market3x" || name === "fast3x" ? { ...rule, weight: 25 } : { ...rule }),
      ],
    },
  ]),
) as Record<PresetName, LabSettings>;

const presetDetails: Array<{ name: PresetName; label: string; description: string }> = [
  { name: "steady2x", label: "Balanced Evidence", description: "Broader entry rules with a high score requirement" },
  { name: "market3x", label: "Strict Entry", description: "Stronger buyer, holder and momentum requirements" },
  { name: "fast3x", label: "Strict + Fast", description: "Strict scoring plus the all-pass fast qualification" },

];

const exitModelDetails: Array<{ name: ExitModel; label: string; description: string }> = [
  { name: "fixed", label: "Fixed target", description: "Stop first, then sell everything at target" },
  { name: "breakeven", label: "Break even at 2x", description: "Move the stop to entry after price reaches 2x" },
  { name: "initials", label: "Initials at 2x", description: "Sell half at 2x and leave the rest running" },
  { name: "staggered", label: "Staggered take profit", description: "Sell one third at each of three selected profit levels" },
];

const savedModelsKey = "ponseye-lab-saved-models-v1";
const currentModelKey = "ponseye-lab-current-model-v1";
const savedExitProfilesKey = "ponseye-lab-saved-exits-v1";
const currentExitProfileKey = "ponseye-lab-current-exit-v1";

const runnerOptions = [1.5, 2, 3, 5, 10, 20, 50, 100];
const runnerLadderTargets = [2, 5, 10, 20, 50, 100];
const defaultTakeProfitLevels: TakeProfitLevel[] = [
  { target: 2, sellPct: 50 },
  { target: 5, sellPct: 25 },
  { target: 10, sellPct: 25 },
];

function normaliseExitProfile(value: unknown): ExitProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Omit<Partial<ExitProfile>, "exitModel"> & { exitModel?: ExitModel | "nostop" };
  if (![candidate.runnerTarget, candidate.stopLossPct, candidate.positionSizeUsd].every((number) => typeof number === "number")) return null;
  const storedModel = String(candidate.exitModel);
  const exitModel: ExitModel = storedModel === "nostop" ? "fixed" : ["fixed", "breakeven", "initials", "staggered"].includes(storedModel) ? storedModel as ExitModel : "fixed";
  const storedLevels = Array.isArray(candidate.takeProfitLevels) ? candidate.takeProfitLevels.slice(0, 3) : [];
  const hasLegacyLevels = storedLevels.some((level) => typeof level === "number");
  const levels = hasLegacyLevels ? [] : storedLevels.flatMap((level) => {
    if (level && typeof level === "object") {
      const item = level as Partial<TakeProfitLevel>;
      if (typeof item.target === "number" && runnerOptions.includes(item.target) && typeof item.sellPct === "number") {
        return [{ target: item.target, sellPct: Math.max(0, Math.min(100, item.sellPct)) }];
      }
    }
    return [];
  });
  const wasTemporaryStaggeredDefault = levels.length === 3
    && levels.map((level) => level.target).join(",") === "2,3,5"
    && levels.every((level) => Math.abs(level.sellPct - 100 / 3) < 0.01);
  return {
    exitModel,
    runnerTarget: candidate.runnerTarget as number,
    stopLossPct: candidate.stopLossPct as number,
    stopEnabled: storedModel === "nostop" ? false : candidate.stopEnabled !== false,
    positionSizeUsd: candidate.positionSizeUsd as number,
    takeProfitLevels: levels.length === 3 && !wasTemporaryStaggeredDefault ? levels : defaultTakeProfitLevels.map((level) => ({ ...level })),
  };
}

function cloneSettings(settings: LabSettings): LabSettings {
  return {
    ...settings,
    fastRules: (settings.fastRules ?? fastTrackRules).map((rule) => ({ ...rule })),
    rules: settings.rules.map((rule) => ({ ...rule })),
  };
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
    && typeof candidate.fastRouteEnabled === "boolean"
    && Array.isArray(candidate.fastRules)
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
    fastRouteEnabled: typeof candidate.fastRouteEnabled === "boolean" ? candidate.fastRouteEnabled : candidate.fastConvictionOverride === true,
    fastRules: Array.isArray(candidate.fastRules) && candidate.fastRules.length
      ? fastTrackRules.map((template) => {
        const saved = candidate.fastRules?.find((rule) => rule?.key === template.key);
        return saved && typeof saved.threshold === "number" ? { ...template, threshold: saved.threshold } : { ...template };
      })
      : fastTrackRules.map((rule) => ({ ...rule })),
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

function ruleFailure(rule: Rule, value: number) {
  if (rule.key === "trade_count") return `Only ${Math.round(value)} trades. Needs ${rule.threshold} or more.`;
  if (rule.key === "unique_traders") return `Only ${Math.round(value)} unique traders. Needs ${rule.threshold} or more.`;
  if (rule.key === "buy_pressure_pct") return `Buy pressure was ${value.toFixed(1)}%. Needs at least ${rule.threshold}%.`;
  if (rule.key === "first_minute_buyers") return `Only ${Math.round(value)} first minute buyers. Needs ${rule.threshold} or more.`;
  if (rule.key === "momentum_multiple") return `Momentum was ${value.toFixed(2)}x. Needs at least ${rule.threshold.toFixed(2)}x.`;
  if (rule.key === "peak_hold_pct") return `Price held ${value.toFixed(1)}% of its peak. Needs at least ${rule.threshold}%.`;
  if (rule.key === "top_10_holder_pct") return `Top 10 holders owned ${value.toFixed(1)}%. Must be ${rule.threshold}% or less.`;
  if (rule.key === "signal_market_cap_usd") return `Signal market cap was ${formatMarketCap(value)}. Needs at least ${formatMarketCap(rule.threshold)}.`;
  if (rule.key === "early_buyer_share_pct") return `First minute buyers were ${value.toFixed(1)}% of unique traders. Needs at least ${rule.threshold}%.`;
  return `${rule.label} was ${formatMetric(value, rule.suffix)}. Needs ${rule.direction === "min" ? "at least" : "no more than"} ${formatMetric(rule.threshold, rule.suffix)}.`;
}

function scoreToken(token: LabToken, settings: LabSettings): ScoredToken {
  const blockedBy: string[] = [];
  if (settings.creatorGate && token.creator_sells > 0) blockedBy.push(`Creator sold ${token.creator_sells} time${token.creator_sells === 1 ? "" : "s"} before the signal.`);

  const concentrationRule = settings.rules.find((rule) => rule.key === "top_10_holder_pct");
  if (
    settings.concentrationGate &&
    concentrationRule &&
    token.top_10_holder_pct != null &&
    token.top_10_holder_pct > concentrationRule.threshold
  ) blockedBy.push(`Top 10 holders owned ${token.top_10_holder_pct.toFixed(1)}%. Must be ${concentrationRule.threshold}% or less.`);

  let availableWeight = 0;
  let passedWeight = 0;
  let passedRules = 0;
  let availableRules = 0;
  const failedRules: Array<{ label: string; weight: number }> = [];

  for (const rule of settings.rules) {
    const value = valueFor(token, rule.key);
    if (value == null) continue;
    availableWeight += rule.weight;
    availableRules += 1;
    const passed = rule.direction === "min" ? value >= rule.threshold : value <= rule.threshold;
    if (passed) {
      passedWeight += rule.weight;
      passedRules += 1;
    } else if (rule.weight > 0) {
      failedRules.push({ label: ruleFailure(rule, value), weight: rule.weight });
    }
  }

  const labScore = availableWeight > 0 ? (passedWeight / availableWeight) * 100 : 0;
  const fastConviction = settings.fastRouteEnabled === true
    && (settings.fastRules ?? fastTrackRules).every((rule) => {
      const value = valueFor(token, rule.key);
      return value != null && (rule.direction === "min" ? value >= rule.threshold : value <= rule.threshold);
    });
  return {
    ...token,
    labScore,
    selected: blockedBy.length === 0 && (labScore >= settings.scoreThreshold || fastConviction),
    blockedBy,
    rejectedOn: [...new Set([
      ...blockedBy,
      ...failedRules.sort((a, b) => b.weight - a.weight).map((rule) => rule.label),
    ])],
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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatTakeProfitLevels(levels: TakeProfitLevel[]) {
  return levels.map((level) => `${level.sellPct}% at ${level.target}x`).join(" · ");
}

function formatSignalTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}

function ResultToken({ token, runnerTarget }: { token: ScoredToken; runnerTarget: number }) {
  const [reasonPopup, setReasonPopup] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const isRunner = (token.future_peak_multiple ?? 0) >= runnerTarget;
  const recordedState = token.actual_acquired ? "Acquired" : token.actual_binned ? "Binned" : "Surveillance";
  const rejectionReasons = token.rejectedOn.join(" ") || "Insufficient score.";
  const modelStatus = token.selected ? "Would acquire" : "Rejected";
  const peakMarketCap = token.signal_market_cap_usd != null && token.future_peak_multiple != null
    ? token.signal_market_cap_usd * token.future_peak_multiple
    : null;
  const entryQuery = new URLSearchParams({ entry: token.signal_at });
  if (token.signal_market_cap_usd && token.signal_market_cap_usd > 0) entryQuery.set("entryMc", String(token.signal_market_cap_usd));

  function showReasonPopup(element: HTMLSpanElement) {
    const rect = element.getBoundingClientRect();
    const popupWidth = Math.min(300, window.innerWidth - 24);
    setReasonPopup({
      left: Math.max(12, Math.min(window.innerWidth - popupWidth - 12, rect.left + rect.width / 2 - popupWidth / 2)),
      top: rect.top > 150 ? rect.top - 10 : rect.bottom + 10,
      above: rect.top > 150,
    });
  }

  return (
    <>
      <Link className="labResultRow" href={`/launch/${token.token_address}?${entryQuery.toString()}`}>
        <div className="labResultIdentity">
          <TokenImage src={token.image_url} alt={token.name ?? "Token image"} size={48} />
          <span>
            <strong>{token.name ?? "Unknown token"}</strong>
            <small>{token.symbol ? `$${token.symbol.replace(/^\$/, "")}` : "No ticker"}</small>
            <time className={resultStyles.signalTime} dateTime={token.signal_at}>{formatSignalTime(token.signal_at)} UTC</time>
          </span>
        </div>
        <div><small>Lab score</small><strong>{token.labScore.toFixed(0)}%</strong></div>
        <div><small>Signal market cap</small><strong>{formatMarketCap(token.signal_market_cap_usd)}</strong></div>
        <div><small>Peak MC</small><strong>{formatMarketCap(peakMarketCap)}</strong></div>
        <div><small>Gains after signal</small><strong className={isRunner ? "labRunnerValue" : ""}>{formatMultiple(token.future_peak_multiple)}</strong></div>
        <div className={token.selected ? resultStyles.accepted : resultStyles.rejected}>
          <small>Model status</small>
          <strong>
            {modelStatus}
            {!token.selected && (
              <span
                className={resultStyles.reasonHint}
                aria-label={`Rejected on: ${rejectionReasons}`}
                onMouseEnter={(event) => showReasonPopup(event.currentTarget)}
                onMouseLeave={() => setReasonPopup(null)}
              >?</span>
            )}
          </strong>
          <em className={resultStyles.recorded}>Recorded: {recordedState}</em>
        </div>
        <b>→</b>
      </Link>
      {reasonPopup && createPortal(
        <div
          className={`${resultStyles.reasonPopup} ${reasonPopup.above ? resultStyles.above : resultStyles.below}`}
          style={{ left: reasonPopup.left, top: reasonPopup.top }}
          role="tooltip"
        >
          <small>Model rejection</small>
          <ul className={resultStyles.reasonList}>
            {(token.rejectedOn.length ? token.rejectedOn : ["Insufficient score."]).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

export function PonsEyeLab({ tokens }: { tokens: LabToken[] }) {
  const [settings, setSettings] = useState<LabSettings>(() => cloneSettings(presets.market3x));
  const [activePreset, setActivePreset] = useState<PresetName | "custom">("market3x");
  const [controlTab, setControlTab] = useState<ControlTab>("acquired");
  const [acquisitionTab, setAcquisitionTab] = useState<AcquisitionTab>("score");
  const [exitSettings, setExitSettings] = useState<ExitProfile>({
    exitModel: "fixed",
    runnerTarget: 3,
    stopLossPct: 10,
    stopEnabled: true,
    positionSizeUsd: 25,
    takeProfitLevels: defaultTakeProfitLevels.map((level) => ({ ...level })),
  });
  const exitModel = exitSettings.exitModel;
  const [savedModels, setSavedModels] = useState<SavedModel[]>([]);
  const [savedExitProfiles, setSavedExitProfiles] = useState<SavedExitProfile[]>([]);
  const [modelName, setModelName] = useState("");
  const [exitProfileName, setExitProfileName] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [resultView, setResultView] = useState<"signals" | "misses" | "all">("all");
  const [resultSort, setResultSort] = useState<ResultSort>("newest");

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
      const restoredExit = normaliseExitProfile(currentExit);
      if (restoredExit) setExitSettings(restoredExit);
      if (Array.isArray(savedExits)) {
        setSavedExitProfiles(savedExits.flatMap((item) => {
          const profile = item as SavedExitProfile;
          if (!profile || typeof profile.name !== "string" || !profile.settings) return [];
          const value = normaliseExitProfile(profile.settings);
          return value ? [{ name: profile.name, settings: value }] : [];
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
        && (!exitSettings.stopEnabled || lowBeforeTwo == null || lowBeforeTwo > stopMultiple);
      const stoppedBeforeTarget = exitSettings.stopEnabled
        && lowBeforeTarget != null
        && lowBeforeTarget <= stopMultiple;

      if (exitModel === "staggered") {
        const levels = [...exitSettings.takeProfitLevels].sort((a, b) => a.target - b.target);
        let remaining = 1;
        let exitMultiple = 0;
        let levelsHit = 0;
        let stopped = false;

        for (const level of levels) {
          const lowBeforeLevel = token.pre_target_low_multiples[String(level.target)];
          const reached = (token.future_peak_multiple ?? 0) >= level.target
            && (!exitSettings.stopEnabled || lowBeforeLevel == null || lowBeforeLevel > stopMultiple);
          if (reached) {
            const sold = Math.min(level.sellPct / 100, remaining);
            exitMultiple += sold * level.target;
            remaining -= sold;
            if (remaining < 0.000001) remaining = 0;
            levelsHit += 1;
            continue;
          }
          if (exitSettings.stopEnabled && lowBeforeLevel != null && lowBeforeLevel <= stopMultiple) {
            exitMultiple += remaining * stopMultiple;
            remaining = 0;
            stopped = true;
          }
          break;
        }

        if (remaining > 0) exitMultiple += remaining * Math.max(0, token.final_multiple ?? 0);
        return { token, stopped, targetReached: levelsHit > 0, openAtEnd: remaining > 0, exitMultiple, levelsHit };
      }

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

      if (exitModel === "breakeven" && exitSettings.stopEnabled && twoReachedBeforeStop && target > 2) {
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
    const orderedAll = [...scored].sort((a, b) => Date.parse(b.signal_at) - Date.parse(a.signal_at));
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
    return { selected, hits, misses, falsePositives, graduated, replayable, stopHits, targetExits, openAtEnd, capitalTested, simulatedEndValue, simulatedPnl, simulatedRoi, orderedSignals, orderedMisses, orderedAll, bands, runnerLadder };
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
    setExitSettings((current) => ({
      ...current,
      exitModel: model,
      runnerTarget: model === "staggered" ? Math.max(...current.takeProfitLevels.map((level) => level.target)) : current.runnerTarget,
    }));
  }

  function updateTakeProfitTarget(index: number, target: number) {
    setExitSettings((current) => {
      const takeProfitLevels = current.takeProfitLevels.map((level, levelIndex) => levelIndex === index ? { ...level, target } : level);
      return { ...current, takeProfitLevels, runnerTarget: Math.max(...takeProfitLevels.map((level) => level.target)) };
    });
  }

  function updateTakeProfitPercentage(index: number, sellPct: number) {
    setExitSettings((current) => {
      const allocatedElsewhere = current.takeProfitLevels.reduce((total, level, levelIndex) => total + (levelIndex === index ? 0 : level.sellPct), 0);
      const available = Math.max(0, 100 - allocatedElsewhere);
      const takeProfitLevels = current.takeProfitLevels.map((level, levelIndex) => levelIndex === index
        ? { ...level, sellPct: Math.max(0, Math.min(available, sellPct || 0)) }
        : level);
      return { ...current, takeProfitLevels };
    });
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

  function updateFastRule(index: number, value: number) {
    setSettings((current) => ({
      ...current,
      fastRules: (current.fastRules ?? fastTrackRules).map((rule, ruleIndex) => ruleIndex === index ? { ...rule, threshold: value } : rule),
    }));
    setActivePreset("custom");
  }

  const hitRate = analysis.selected.length ? analysis.hits.length * 100 / analysis.selected.length : 0;
  const resultPool = resultView === "signals"
    ? analysis.orderedSignals
    : resultView === "misses"
      ? analysis.orderedMisses
      : analysis.orderedAll;
  const visibleResults = [...resultPool].sort((a, b) => {
    if (resultSort === "score") return b.labScore - a.labScore;
    if (resultSort === "peak") return (b.future_peak_multiple ?? -1) - (a.future_peak_multiple ?? -1);
    if (resultSort === "market-cap") return (b.signal_market_cap_usd ?? -1) - (a.signal_market_cap_usd ?? -1);
    return Date.parse(b.signal_at) - Date.parse(a.signal_at);
  });
  const entryLabel = activePreset === "custom" ? "Custom setup" : presetDetails.find((preset) => preset.name === activePreset)?.label;
  const exitLabel = {
    fixed: "Fixed target",
    breakeven: "Break even at 2x",
    initials: "Initials at 2x",
    staggered: "Staggered take profit",
  }[exitModel];

  return (
    <>
      <section className="labModelDock">
        <header className="labBenchHeader">
          <div><small>Current test</small><strong>{entryLabel} · {exitLabel} · {formatUsd(exitSettings.positionSizeUsd)}</strong></div>
        </header>
        <details className="labDrawer entry">
          <summary>
            <div><small>Funnel, entry and exit</small><strong>Configuration</strong><span>{analysis.selected.length} acquired · {hitRate.toFixed(1)}% hit rate</span></div>
            <b>Open configuration</b>
          </summary>
          <aside className="labControls">
        <div className="labConfigLayout">
        <button type="button" className="labConfigClose" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>Close configuration ×</button>
        <nav className="labConfigNav" aria-label="Configuration sections">
          <header><small>Pipeline</small><strong>Rules by stage</strong></header>
          <button type="button" className={controlTab === "sighted" ? "active" : ""} onClick={() => setControlTab("sighted")}><small>01</small><span>Sighted</span></button>
          <button type="button" className={controlTab === "surveilling" ? "active" : ""} onClick={() => setControlTab("surveilling")}><small>02</small><span>Surveilling</span></button>
          <div className={controlTab === "acquired" ? "active group" : "group"}>
            <button type="button" onClick={() => { setControlTab("acquired"); setAcquisitionTab("score"); }}><small>03</small><span>Acquired</span></button>
            <button type="button" className={controlTab === "acquired" && acquisitionTab === "score" ? "active" : ""} onClick={() => { setControlTab("acquired"); setAcquisitionTab("score"); }}>Score rules</button>
            <button type="button" className={controlTab === "acquired" && acquisitionTab === "fast" ? "active" : ""} onClick={() => { setControlTab("acquired"); setAcquisitionTab("fast"); }}>Fast qualification</button>
            <button type="button" className={controlTab === "acquired" && acquisitionTab === "rejection" ? "active" : ""} onClick={() => { setControlTab("acquired"); setAcquisitionTab("rejection"); }}>Hard rejection</button>
          </div>
          <button type="button" className={controlTab === "rejected" ? "active" : ""} onClick={() => setControlTab("rejected")}><small>04</small><span>Binned</span></button>
          <hr />
          <button type="button" className={controlTab === "exit" ? "active" : ""} onClick={() => setControlTab("exit")}><small>05</small><span>Exit strategy</span></button>
          <button type="button" className={controlTab === "position" ? "active" : ""} onClick={() => setControlTab("position")}><small>06</small><span>Position size</span></button>
        </nav>
        <div className="labConfigPane">
        {controlTab === "acquired" && (<>
        <header>
          <div><small>Entry model</small><h2>{activePreset === "custom" ? "Custom setup" : presetDetails.find((preset) => preset.name === activePreset)?.label}</h2></div>
          <button type="button" onClick={() => choosePreset("market3x")}>Reset</button>
        </header>

        <section className="labEntryModelBar">
          <label className={resultStyles.modelSelect}>
            <span>Load entry model</span>
            <select aria-label="Entry model" value={activePreset} onChange={(event) => event.target.value !== "custom" && choosePreset(event.target.value as PresetName)}>
              {activePreset === "custom" && <option value="custom">Custom setup</option>}
              {presetDetails.map((preset) => <option key={preset.name} value={preset.name}>{preset.label}</option>)}
            </select>
            <small>{activePreset === "custom" ? "Your adjusted entry tracks" : presetDetails.find((preset) => preset.name === activePreset)?.description}</small>
          </label>

          <details className="labSavedModels labSavedCollapse">
            <summary>Saved setups <span>{savedModels.length}</span></summary>
            <form onSubmit={(event) => { event.preventDefault(); saveModel(); }}>
              <input aria-label="Setup name" placeholder={`My setup ${savedModels.length + 1}`} value={modelName} onChange={(event) => setModelName(event.target.value)} />
              <button type="submit">Save current</button>
            </form>
            {savedModels.length ? (
              <div className="labSavedList">
                {savedModels.map((model) => (
                  <article key={model.name}>
                    <button type="button" onClick={() => loadModel(model)}><strong>{model.name}</strong><small>{model.settings.scoreThreshold}% score to acquire</small></button>
                    <button type="button" aria-label={`Delete ${model.name}`} onClick={() => deleteModel(model.name)}>×</button>
                  </article>
                ))}
              </div>
            ) : <p>No saved setups yet.</p>}
          </details>
        </section>
        </>)}

        {controlTab === "sighted" && (
          <section className="labStagePanel">
            <header><div><small>Column 1</small><strong>Sighted</strong></div><span>Automatic</span></header>
            <p>Every detected PONS launch enters Sighted. Nothing is scored or rejected at this point.</p>
            <div className="labStageRuleList">
              <article><span>Launch detected</span><strong>Required</strong></article>
              <article><span>Token identity saved</span><strong>Automatic</strong></article>
              <article><span>Trades, price and holders</span><strong>Start recording</strong></article>
            </div>
          </section>
        )}

        {controlTab === "surveilling" && (
          <section className="labStagePanel">
            <header><div><small>Column 2</small><strong>Sighted → Surveilling</strong></div><span>All must pass</span></header>
            <p>These are the live rules that promote a launch into Surveilling.</p>
            <div className="labStageRuleList twoColumn">
              <article><span>Launch age</span><strong>1 to 15 minutes</strong></article>
              <article><span>Fresh market evidence</span><strong>Within 2 minutes</strong></article>
              <article><span>Market cap</span><strong>$10,000 minimum</strong></article>
              <article><span>Trades</span><strong>12 minimum</strong></article>
              <article><span>Unique traders</span><strong>6 minimum</strong></article>
              <article><span>Buy pressure</span><strong>52% minimum</strong></article>
              <article><span>Creator sales</span><strong>None</strong></article>
            </div>
            <small className="labStageNote">The Lab currently begins with tokens that already reached Surveilling, so changing these would need Sighted snapshots added to the Lab dataset first.</small>
          </section>
        )}

        {controlTab === "acquired" && (
          <>
            <section className="labStageIntro">
              <div><small>Column 3</small><strong>Surveilling → Acquired</strong></div>
              <span>Pass score or fast qualification, then pass hard rejection rules.</span>
            </section>
          </>
        )}

        {controlTab === "acquired" && acquisitionTab === "score" && (
          <>
            <section className="labPrimaryControl">
              <label htmlFor="scoreThreshold"><span>Score required to acquire</span><strong>{settings.scoreThreshold}%</strong></label>
              <input id="scoreThreshold" type="range" min="30" max="100" step="5" value={settings.scoreThreshold} onChange={(event) => { setSettings({ ...settings, scoreThreshold: Number(event.target.value) }); setActivePreset("custom"); }} />
            </section>

            <section className="labRulesHelp"><strong>Score qualification</strong><span>Each passing rule adds to the score. Pass mark is what the token must achieve. Weight controls how much the rule counts.</span></section>
            <div className="labRuleHeading"><span>Rule</span><span>Pass mark</span><span>Weight</span></div>
            <div className="labRules">
              {settings.rules.map((rule, index) => (
                <section className="labRule" key={rule.key}>
                  <div className="labRuleTitle"><strong>{rule.label}</strong><span>{ruleDescriptions[rule.key]}</span><small>{rule.direction === "min" ? "Minimum required" : "Maximum allowed"}</small></div>
                  <label className="labRuleValue">
                    <span>{rule.suffix === "$" ? "$" : ""}<input aria-label={`${rule.label} exact pass mark`} type="number" min={rule.min} max={rule.max} step={rule.step} value={rule.threshold} onChange={(event) => updateRule(index, "threshold", Math.max(rule.min, Math.min(rule.max, Number(event.target.value) || rule.min)))} />{rule.suffix === "$" ? "" : rule.suffix}</span>
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

        {controlTab === "acquired" && acquisitionTab === "fast" && (
          <>
            <section className="labTrackSwitch">
              <span><strong>Fast qualification</strong><small>Acquire when every fast rule passes, even if the main score is too low.</small></span>
              <label><input type="checkbox" checked={settings.fastRouteEnabled === true} onChange={(event) => { setSettings({ ...settings, fastRouteEnabled: event.target.checked }); setActivePreset("custom"); }} /><i /></label>
            </section>
            <div className="labRuleHeading labFastHeading"><span>All rules required</span><span>Pass mark</span></div>
            <div className={`labRules labFastRules ${settings.fastRouteEnabled ? "" : "disabled"}`}>
              {(settings.fastRules ?? fastTrackRules).map((rule, index) => (
                <section className="labRule" key={rule.key}>
                  <div className="labRuleTitle"><strong>{rule.label}</strong><span>{ruleDescriptions[rule.key]}</span><small>{rule.direction === "min" ? "Minimum required" : "Maximum allowed"}</small></div>
                  <label className="labRuleValue">
                    <span>{rule.suffix === "$" ? "$" : ""}<input aria-label={`Fast route ${rule.label} pass mark`} type="number" min={rule.min} max={rule.max} step={rule.step} value={rule.threshold} disabled={!settings.fastRouteEnabled} onChange={(event) => updateFastRule(index, Math.max(rule.min, Math.min(rule.max, Number(event.target.value) || rule.min)))} />{rule.suffix === "$" ? "" : rule.suffix}</span>
                    <input aria-label={`Fast route ${rule.label} slider`} type="range" min={rule.min} max={rule.max} step={rule.step} value={rule.threshold} disabled={!settings.fastRouteEnabled} onChange={(event) => updateFastRule(index, Number(event.target.value))} />
                  </label>
                </section>
              ))}
            </div>
          </>
        )}

        {controlTab === "acquired" && acquisitionTab === "rejection" && (
          <section className="labSafety">
            <div><small>Hard rejection rules</small><strong>Overrides both qualifications</strong></div>
            <p>A token cannot be acquired when one of these enabled rules fails.</p>
            <label><span><b>No creator sales</b><small>Reject any creator sell before signal</small></span><input type="checkbox" checked={settings.creatorGate} onChange={(event) => { setSettings({ ...settings, creatorGate: event.target.checked }); setActivePreset("custom"); }} /></label>
            <label><span><b>Holder concentration</b><small>Reject above the Top 10 rule limit</small></span><input type="checkbox" checked={settings.concentrationGate} onChange={(event) => { setSettings({ ...settings, concentrationGate: event.target.checked }); setActivePreset("custom"); }} /></label>
          </section>
        )}

        {controlTab === "rejected" && (
          <section className="labStagePanel rejected">
            <header><div><small>Removed from active columns</small><strong>Binned</strong></div><span>Permanent</span></header>
            <p>A normal price swing does not bin a token. Both conditions below must happen.</p>
            <div className="labStageRuleList conditionPair">
              <article><small>Condition 1</small><span>Creator has sold</span><strong>Yes</strong></article>
              <b>AND</b>
              <article><small>Condition 2</small><span>Price versus its peak</span><strong>50% or lower</strong></article>
            </div>
            <small className="labStageNote">Once binned, the token stays binned.</small>
          </section>
        )}

        {controlTab === "exit" && (
          <section className="labStrategyPanel">
          <header><div><small>Exit strategy</small><h2>{exitLabel}</h2></div><span>Applied after a token is acquired</span></header>
          <label className={`${resultStyles.modelSelect} ${resultStyles.exitSelect}`}>
            <span>Exit model</span>
            <select aria-label="Exit model" value={exitModel} onChange={(event) => chooseExitModel(event.target.value as ExitModel)}>
              {exitModelDetails.map((model) => <option key={model.name} value={model.name}>{model.label}</option>)}
            </select>
            <small>{exitModelDetails.find((model) => model.name === exitModel)?.description}</small>
          </label>

          <div className="labSavedModels labExitSavedModels">
            <header><div><small>Saved exit profiles</small><strong>This browser</strong></div></header>
            <form onSubmit={(event) => { event.preventDefault(); saveExitProfile(); }}>
              <input aria-label="Exit profile name" placeholder={`Exit setup ${savedExitProfiles.length + 1}`} value={exitProfileName} onChange={(event) => setExitProfileName(event.target.value)} />
              <button type="submit">Save current</button>
            </form>
            {savedExitProfiles.length ? (
              <div className="labSavedList">
                {savedExitProfiles.map((profile) => (
                  <article key={profile.name}>
                    <button type="button" onClick={() => loadExitProfile(profile)}>
                      <strong>{profile.name}</strong>
                      <small>{profile.settings.exitModel === "staggered" ? formatTakeProfitLevels(profile.settings.takeProfitLevels) : `${profile.settings.runnerTarget}x target`} · {profile.settings.stopEnabled ? `${profile.settings.stopLossPct}% stop` : "no stop"}</small>
                    </button>
                    <button type="button" aria-label={`Delete ${profile.name}`} onClick={() => deleteExitProfile(profile.name)}>×</button>
                  </article>
                ))}
              </div>
            ) : <p>No saved exit profiles yet.</p>}
          </div>
          <div className="labStrategyControls">
            {exitModel === "staggered" ? (
              <div className={`target ${resultStyles.staggeredLevels}`}>
                <label>Take profit levels</label>
                <strong>{exitSettings.takeProfitLevels.reduce((total, level) => total + level.sellPct, 0)}% allocated</strong>
                <div>
                  {exitSettings.takeProfitLevels.map((level, index) => (
                    <label key={index}>
                      <span>TP{index + 1}</span>
                      <select aria-label={`Take profit level ${index + 1}`} value={level.target} onChange={(event) => updateTakeProfitTarget(index, Number(event.target.value))}>
                        {runnerOptions.map((target) => <option key={target} value={target}>{target}x</option>)}
                      </select>
                      <span>Sell %</span>
                      <input aria-label={`Sell percentage at take profit ${index + 1}`} type="number" min="0" max="100" step="5" value={level.sellPct} onChange={(event) => updateTakeProfitPercentage(index, Number(event.target.value))} />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="target">
                <label>Take profit</label>
                <strong>{exitSettings.runnerTarget}x</strong>
                <div>{runnerOptions.map((target) => <button type="button" className={exitSettings.runnerTarget === target ? "active" : ""} key={target} onClick={() => setExitSettings({ ...exitSettings, runnerTarget: target })}>{target}x</button>)}</div>
              </div>
            )}
            <div className="stop">
              <label htmlFor="stopLoss">Initial stop loss</label>
              <strong>{exitSettings.stopEnabled ? `−${exitSettings.stopLossPct}%` : "OFF"}</strong>
              <input id="stopLoss" aria-label="Stop loss percentage" type="range" min="10" max="90" step="5" value={exitSettings.stopLossPct} disabled={!exitSettings.stopEnabled} onChange={(event) => setExitSettings({ ...exitSettings, stopLossPct: Number(event.target.value) })} />
              <label className={resultStyles.noStopToggle}>
                <input type="checkbox" checked={!exitSettings.stopEnabled} onChange={(event) => setExitSettings({ ...exitSettings, stopEnabled: !event.target.checked })} />
                <span>No stop loss</span>
              </label>
            </div>
          </div>
          </section>
        )}

        {controlTab === "position" && (
          <section className="labStagePanel labPositionPanel">
            <header><div><small>Trade amount</small><strong>Position size</strong></div><span>Global</span></header>
            <p>This amount is used for every token selected by the current entry rules.</p>
            <label className={resultStyles.positionSize}>
              <span>Dollars per acquired token</span>
              <strong><b>$</b><input aria-label="Position size in dollars" type="number" min="1" step="1" value={exitSettings.positionSizeUsd} onChange={(event) => setExitSettings({ ...exitSettings, positionSizeUsd: Math.max(1, Number(event.target.value) || 1) })} /></strong>
            </label>
          </section>
        )}
        </div>
        </div>
          </aside>
        </details>
      </section>

      <section className="labOutput">
        <div className="labSummaryGrid">
          <article className="primary"><small>Would reach Acquired</small><strong>{analysis.selected.length}</strong><span>from {tokens.length} Surveillance tokens</span></article>
          <article className={`simulatedResult ${analysis.simulatedPnl >= 0 ? "positive" : "negative"}`}><small>P&amp;L</small><strong>{analysis.simulatedPnl >= 0 ? "+" : "−"}{formatUsd(Math.abs(analysis.simulatedPnl))}</strong><span>{formatUsd(analysis.capitalTested)} in · {formatUsd(analysis.simulatedEndValue)} returned</span></article>
          <article className={analysis.simulatedRoi >= 0 ? "positive" : "negative"}><small>ROI</small><strong>{analysis.simulatedRoi >= 0 ? "+" : ""}{analysis.simulatedRoi.toFixed(1)}%</strong><span>on {formatUsd(analysis.capitalTested)} tested</span></article>
          <article><small>Hit rate</small><strong>{hitRate.toFixed(1)}%</strong><span>{analysis.hits.length} reached {exitSettings.runnerTarget}x</span></article>
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
          <header><div><small>Strategy result</small><h2>{formatUsd(exitSettings.positionSizeUsd)} per acquired token</h2></div><span>{exitModel === "staggered" ? formatTakeProfitLevels(exitSettings.takeProfitLevels) : exitModel === "initials" ? "Initials at 2x · runner held" : exitModel === "breakeven" ? `${exitSettings.runnerTarget}x target · break even after 2x` : `${exitSettings.runnerTarget}x target`} · {exitSettings.stopEnabled ? `${exitSettings.stopLossPct}% stop` : "no stop"}</span></header>
          <div className="labMoneyGrid">
            <article><small>Capital tested</small><strong>{formatUsd(analysis.capitalTested)}</strong><span>{analysis.replayable.length} replayed positions</span></article>
            <article><small>End value</small><strong>{formatUsd(analysis.simulatedEndValue)}</strong><span>Targets, stops and open positions</span></article>
            <article className={analysis.simulatedPnl >= 0 ? "positive" : "negative"}><small>Strategy P&amp;L</small><strong>{analysis.simulatedPnl >= 0 ? "+" : ""}{formatUsd(analysis.simulatedPnl)}</strong><span>{analysis.simulatedRoi >= 0 ? "+" : ""}{analysis.simulatedRoi.toFixed(1)}% return</span></article>
          </div>
          <p>{exitModel === "staggered" ? "Each sell percentage is taken from the original position at its selected take profit level. Any unallocated amount is valued at its stop or final recorded price." : exitModel === "initials" ? "Half the tokens are sold at 2x to recover the initial stake. The remaining half is valued at the final recorded price." : exitModel === "breakeven" ? "After price reaches 2x, an enabled stop moves to the entry price while the selected target remains active." : "Each position exits when the selected target or enabled stop is reached first. Positions hitting neither are valued at their final recorded price."} Figures exclude fees and slippage.</p>
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
              <button type="button" className={resultView === "all" ? "active" : ""} onClick={() => setResultView("all")}>View all <span>{tokens.length}</span></button>
              <button type="button" className={resultView === "signals" ? "active" : ""} onClick={() => setResultView("signals")}>Would reach Acquired <span>{analysis.selected.length}</span></button>
              <button type="button" className={resultView === "misses" ? "active" : ""} onClick={() => setResultView("misses")}>Rejected runners <span>{analysis.misses.length}</span></button>
            </div>
            <label className={resultStyles.resultSort}>
              <span>Sort by</span>
              <select aria-label="Sort Lab results" value={resultSort} onChange={(event) => setResultSort(event.target.value as ResultSort)}>
                <option value="newest">Newest signals</option>
                <option value="score">Highest Lab score</option>
                <option value="peak">Highest gains after signal</option>
                <option value="market-cap">Highest signal market cap</option>
              </select>
            </label>
          </header>
          <div className="labResultList">
            {visibleResults.length ? (resultView === "all" ? visibleResults : visibleResults.slice(0, 40)).map((token) => <ResultToken key={token.token_address} token={token} runnerTarget={exitSettings.runnerTarget} />) : (
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
