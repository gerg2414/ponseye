"use client";

import { CandlestickSeries, ColorType, CrosshairMode, createChart, type CandlestickData, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { GmgnChartCandle } from "../../../../lib/database";

const TOKEN_SUPPLY = 1_000_000_000;

function compact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function GmgnChart({ candles }: { candles: GmgnChartCandle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !candles.length) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 520,
      layout: { background: { type: ColorType.Solid, color: "#090b0f" }, textColor: "#747b89", fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: "#181c23" }, horzLines: { color: "#181c23" } },
      rightPriceScale: { borderColor: "#252a34", scaleMargins: { top: 0.12, bottom: 0.1 } },
      timeScale: { borderColor: "#252a34", timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 7 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#626978", labelBackgroundColor: "#a56cff" }, horzLine: { color: "#626978", labelBackgroundColor: "#a56cff" } },
      localization: { priceFormatter: (price: number) => `$${compact(price)}` },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#9aff4f", downColor: "#ff5f7f", wickUpColor: "#9aff4f", wickDownColor: "#ff5f7f", borderVisible: false, priceLineColor: "#a56cff",
      priceFormat: { type: "custom", minMove: 1, formatter: (price: number) => `$${compact(price)}` },
    });
    series.setData(candles.map((candle): CandlestickData<UTCTimestamp> => ({
      time: Math.floor(Date.parse(candle.candle_at) / 1_000) as UTCTimestamp,
      open: candle.open * TOKEN_SUPPLY,
      high: candle.high * TOKEN_SUPPLY,
      low: candle.low * TOKEN_SUPPLY,
      close: candle.close * TOKEN_SUPPLY,
    })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles]);

  if (!candles.length) return <div className="gmgnChartWaiting"><span>GMGN chart requested</span><strong>Loading one minute candles…</strong><small>This page refreshes automatically.</small></div>;
  return <div ref={containerRef} className="gmgnChartCanvas" />;
}
