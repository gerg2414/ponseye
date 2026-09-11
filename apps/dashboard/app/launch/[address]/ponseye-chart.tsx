"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  createChart,
  createTextWatermark,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartCandle, MarketTrade } from "../../../lib/data";
import { compact } from "../../../lib/market";

const INTERVALS = [
  { label: "1m", value: 60_000 },
  { label: "5m", value: 5 * 60_000 },
  { label: "15m", value: 15 * 60_000 },
  { label: "1h", value: 60 * 60_000 },
] as const;

function buildCandles(seedCandles: ChartCandle[], trades: MarketTrade[], interval: number) {
  const buckets = new Map<number, CandlestickData<UTCTimestamp>>();

  for (const seed of seedCandles) {
    const timestamp = new Date(seed.time).getTime();
    const bucket = Math.floor(timestamp / interval) * interval;
    const time = Math.floor(bucket / 1_000) as UTCTimestamp;
    const open = seed.open * 1_000_000_000;
    const high = seed.high * 1_000_000_000;
    const low = seed.low * 1_000_000_000;
    const close = seed.close * 1_000_000_000;
    const candle = buckets.get(bucket);

    if (candle) {
      candle.high = Math.max(candle.high, high);
      candle.low = Math.min(candle.low, low);
      candle.close = close;
    } else {
      buckets.set(bucket, { time, open, high, low, close });
    }
  }

  for (const trade of [...trades].sort((a, b) => new Date(a.block_time).getTime() - new Date(b.block_time).getTime())) {
    if (!trade.price_usd || trade.price_usd <= 0) continue;
    const price = trade.price_usd * 1_000_000_000;
    const timestamp = new Date(trade.block_time).getTime();
    const bucket = Math.floor(timestamp / interval) * interval;
    const time = Math.floor(bucket / 1_000) as UTCTimestamp;
    const candle = buckets.get(bucket);

    if (candle) {
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
    } else {
      buckets.set(bucket, { time, open: price, high: price, low: price, close: price });
    }
  }

  const candles = [...buckets.values()].sort((a, b) => Number(a.time) - Number(b.time));

  for (let index = 1; index < candles.length; index += 1) {
    const previousClose = candles[index - 1].close;
    candles[index].open = previousClose;
    candles[index].high = Math.max(candles[index].high, previousClose);
    candles[index].low = Math.min(candles[index].low, previousClose);
  }

  return candles;
}

function mergeTrades(current: MarketTrade[], incoming: MarketTrade[]) {
  const byId = new Map(current.map((trade) => [trade.market_event_id, trade]));
  for (const trade of incoming) {
    byId.set(trade.market_event_id, {
      ...trade,
      price_usd: trade.price_usd == null ? null : Number(trade.price_usd),
      base_amount_usd: trade.base_amount_usd == null ? null : Number(trade.base_amount_usd),
      quote_amount_usd: trade.quote_amount_usd == null ? null : Number(trade.quote_amount_usd),
    });
  }
  return [...byId.values()]
    .sort((a, b) => new Date(a.block_time).getTime() - new Date(b.block_time).getTime())
    .slice(-2_500);
}

export function PonsEyeChart({ trades, candles: seedCandles, tokenAddress, graduatedAt, bondPriceUsd, acquiredAt, closedAt, entryMarketCap }: {
  trades: MarketTrade[];
  candles: ChartCandle[];
  tokenAddress: string;
  graduatedAt: string | null;
  bondPriceUsd: number | null;
  acquiredAt: string | null;
  closedAt: string | null;
  entryMarketCap: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const entryMarkerRef = useRef<HTMLDivElement>(null);
  const exitMarkerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bondLineRef = useRef<IPriceLine | null>(null);
  const entryLineRef = useRef<IPriceLine | null>(null);
  const fittedIntervalRef = useRef<number | null>(null);
  const latestTradeAtRef = useRef<string | null>(trades.at(-1)?.block_time ?? null);
  const pollingRef = useRef(false);
  const [liveTrades, setLiveTrades] = useState(trades);
  const [interval, setInterval] = useState(60_000);
  const candles = useMemo(() => buildCandles(seedCandles, liveTrades, interval), [interval, liveTrades, seedCandles]);
  const nearestCandle = (value: string | null) => {
    if (!value || !candles.length) return null;
    const target = new Date(value).getTime() / 1_000;
    return candles.reduce((closest, candle) => Math.abs(Number(candle.time) - target) < Math.abs(Number(closest.time) - target) ? candle : closest);
  };
  const entryCandle = useMemo(() => nearestCandle(acquiredAt), [acquiredAt, candles]);
  const exitCandle = useMemo(() => nearestCandle(closedAt), [candles, closedAt]);
  const bondMarketCap = useMemo(() => {
    if (bondPriceUsd && bondPriceUsd > 0) return bondPriceUsd * 1_000_000_000;
    if (!graduatedAt) return null;
    const graduationTime = new Date(graduatedAt).getTime();
    for (let index = liveTrades.length - 1; index >= 0; index -= 1) {
      const trade = liveTrades[index];
      if (trade.protocol === "pons_v2" && new Date(trade.block_time).getTime() <= graduationTime + 5_000 && trade.price_usd && trade.price_usd > 0) {
        return trade.price_usd * 1_000_000_000;
      }
    }
    return null;
  }, [bondPriceUsd, graduatedAt, liveTrades]);

  useEffect(() => {
    setLiveTrades((current) => mergeTrades(current, trades));
  }, [trades]);

  useEffect(() => {
    latestTradeAtRef.current = liveTrades.at(-1)?.block_time ?? null;
  }, [liveTrades]);

  useEffect(() => {
    if (tokenAddress.startsWith("preview-")) return;
    const controller = new AbortController();

    async function poll() {
      if (pollingRef.current || document.visibilityState !== "visible") return;
      pollingRef.current = true;
      try {
        const since = latestTradeAtRef.current ? `?since=${encodeURIComponent(latestTradeAtRef.current)}` : "";
        const response = await fetch(`/api/launch/${tokenAddress}/trades${since}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json() as { trades?: MarketTrade[] };
        if (payload.trades?.length) setLiveTrades((current) => mergeTrades(current, payload.trades ?? []));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) console.error("Live chart refresh failed", error);
      } finally {
        pollingRef.current = false;
      }
    }

    void poll();
    const timer = window.setInterval(poll, 1_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      pollingRef.current = false;
    };
  }, [tokenAddress]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 470,
      layout: {
        background: { type: ColorType.Solid, color: "#090b0f" },
        textColor: "#747b89",
        fontFamily: '"SFMono-Regular", Consolas, monospace',
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#181c23", style: 1 },
        horzLines: { color: "#181c23", style: 1 },
      },
      rightPriceScale: {
        mode: PriceScaleMode.Normal,
        borderColor: "#252a34",
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#252a34",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 6,
        minBarSpacing: 3,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#626978", labelBackgroundColor: "#a56cff" },
        horzLine: { color: "#626978", labelBackgroundColor: "#a56cff" },
      },
      localization: {
        priceFormatter: (price: number) => `$${compact(price)}`,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#9aff4f",
      downColor: "#ff5f7f",
      wickUpColor: "#9aff4f",
      wickDownColor: "#ff5f7f",
      wickVisible: true,
      borderVisible: false,
      priceLineColor: "#a56cff",
      priceLineWidth: 1,
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: {
        type: "custom",
        minMove: 0.01,
        formatter: (price: number) => `$${compact(price)}`,
      },
    });

    createTextWatermark(chart.panes()[0], {
      horzAlign: "center",
      vertAlign: "center",
      lines: [
        { text: "PONSEYE", color: "rgba(255,255,255,.045)", fontSize: 58, fontFamily: "Arial, sans-serif", fontStyle: "bold" },
        { text: "LAUNCH INTELLIGENCE", color: "rgba(165,108,255,.16)", fontSize: 10, fontFamily: "Consolas, monospace", fontStyle: "normal" },
      ],
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    seriesRef.current.setData(candles);
    if (candles.length && fittedIntervalRef.current !== interval) {
      if (candles.length < 40) {
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: candles.length - 40,
          to: candles.length + 2,
        });
      } else {
        chartRef.current.timeScale().fitContent();
      }
      fittedIntervalRef.current = interval;
    }
  }, [candles, interval]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current;
    const entryMarker = entryMarkerRef.current;
    const exitMarker = exitMarkerRef.current;
    if (!chart || !series || !container) {
      if (entryMarker) entryMarker.hidden = true;
      if (exitMarker) exitMarker.hidden = true;
      return;
    }

    const updateMarker = () => {
      const position = (marker: HTMLDivElement | null, candle: CandlestickData<UTCTimestamp> | null, price: "low" | "high") => {
        if (!marker || !candle) {
          if (marker) marker.hidden = true;
          return;
        }
        const x = chart.timeScale().timeToCoordinate(candle.time);
        const y = series.priceToCoordinate(candle[price]);
        if (x == null || y == null) {
          marker.hidden = true;
          return;
        }
        marker.hidden = false;
        marker.style.left = `${x}px`;
        marker.style.top = `${container.offsetTop + y}px`;
      };
      position(entryMarker, entryCandle, "low");
      position(exitMarker, exitCandle, "high");
    };

    const frame = window.requestAnimationFrame(updateMarker);
    const resizeObserver = new ResizeObserver(updateMarker);
    resizeObserver.observe(container);
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateMarker);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateMarker);
    };
  }, [entryCandle, exitCandle]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (bondLineRef.current) {
      series.removePriceLine(bondLineRef.current);
      bondLineRef.current = null;
    }
    if (bondMarketCap) {
      bondLineRef.current = series.createPriceLine({
        price: bondMarketCap,
        color: "#ff9f43",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "BOND",
      });
    }
  }, [bondMarketCap]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (entryLineRef.current) {
      series.removePriceLine(entryLineRef.current);
      entryLineRef.current = null;
    }
    if (entryMarketCap) {
      entryLineRef.current = series.createPriceLine({
        price: entryMarketCap,
        color: "#a56cff",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "ENTRY 1.00X",
      });
    }
  }, [entryMarketCap]);

  return (
    <div className="tvChartShell">
      <div className="tvToolbar">
        <strong>PONS / MCAP</strong>
        <div className="tvIntervals" aria-label="Chart interval">
          {INTERVALS.map((option) => (
            <button
              className={interval === option.value ? "active" : ""}
              key={option.value}
              type="button"
              onClick={() => setInterval(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span>USD</span>
        <span>LOG</span>
        <b><i /> LIVE</b>
      </div>
      <div ref={containerRef} className="priceChart tradingViewCanvas" aria-label="TradingView Lightweight Chart showing PonsEye dollar market cap" />
      <div ref={entryMarkerRef} className="chartEntryMarker" hidden>
        <span className="chartEntryChevron">⌃</span>
        <div className="chartEntryBadge">
          <img src="/ponseye-acquired-icon.svg" alt="" />
          <strong>PONSEYE BUY</strong>
        </div>
      </div>
      <div ref={exitMarkerRef} className="chartEntryMarker chartExitMarker" hidden>
        <div className="chartEntryBadge">
          <span className="chartSoldIcon" aria-hidden="true">×</span>
          <strong>PONSEYE SELL</strong>
        </div>
        <span className="chartEntryChevron">⌄</span>
      </div>
      {!candles.length ? <div className="chartEmpty chartEmptyOverlay"><span>PRICE FEED</span>Waiting for the first dollar priced trade</div> : null}
    </div>
  );
}
