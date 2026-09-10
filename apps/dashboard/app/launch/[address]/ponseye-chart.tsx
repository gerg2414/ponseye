"use client";

import { useMemo, useRef, useState } from "react";
import type { MarketTrade } from "../../../lib/data";
import { compact } from "../../../lib/market";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function intervalFor(spanMs: number) {
  if (spanMs <= 2 * 60 * 60_000) return 60_000;
  if (spanMs <= 12 * 60 * 60_000) return 5 * 60_000;
  if (spanMs <= 2 * 24 * 60 * 60_000) return 15 * 60_000;
  return 60 * 60_000;
}

function buildCandles(trades: MarketTrade[]) {
  const points = trades
    .flatMap((trade) => trade.price_usd && trade.price_usd > 0
      ? [{ time: new Date(trade.block_time).getTime(), value: trade.price_usd * 1_000_000_000, volume: trade.quote_amount_usd ?? trade.base_amount_usd ?? 0 }]
      : [])
    .sort((a, b) => a.time - b.time);
  if (!points.length) return { candles: [] as Candle[], interval: 60_000 };

  const interval = intervalFor(points.at(-1)!.time - points[0].time);
  const buckets = new Map<number, Candle>();
  for (const point of points) {
    const time = Math.floor(point.time / interval) * interval;
    const candle = buckets.get(time);
    if (candle) {
      candle.high = Math.max(candle.high, point.value);
      candle.low = Math.min(candle.low, point.value);
      candle.close = point.value;
      candle.volume += point.volume;
    } else {
      buckets.set(time, { time, open: point.value, high: point.value, low: point.value, close: point.value, volume: point.volume });
    }
  }
  return { candles: [...buckets.values()].slice(-120), interval };
}

function intervalLabel(interval: number) {
  return interval < 60 * 60_000 ? `${interval / 60_000}m` : `${interval / 60 / 60_000}h`;
}

export function PonsEyeChart({ trades }: { trades: MarketTrade[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const { candles, interval } = useMemo(() => buildCandles(trades), [trades]);

  if (candles.length < 2) {
    return (
      <div className="tvChartShell">
        <div className="tvToolbar"><strong>PONS / MCAP</strong><span>USD</span><span>LOG</span><b>LIVE</b></div>
        <div className="chartEmpty"><span>PRICE FEED</span>Waiting for the first dollar priced trades</div>
      </div>
    );
  }

  const width = 1000;
  const height = 470;
  const left = 18;
  const right = 902;
  const top = 34;
  const bottom = 405;
  const logLow = Math.log10(Math.min(...candles.map((candle) => candle.low)));
  const logHigh = Math.log10(Math.max(...candles.map((candle) => candle.high)));
  const padding = Math.max((logHigh - logLow) * 0.12, 0.025);
  const min = logLow - padding;
  const max = logHigh + padding;
  const spread = max - min;
  const step = (right - left) / candles.length;
  const bodyWidth = Math.max(2, Math.min(10, step * 0.62));
  const y = (value: number) => bottom - ((Math.log10(value) - min) / spread) * (bottom - top);
  const x = (index: number) => left + step * index + step / 2;
  const yTicks = Array.from({ length: 6 }, (_, index) => {
    const ratio = index / 5;
    return { y: top + ratio * (bottom - top), value: 10 ** (max - ratio * spread) };
  });
  const xTicks = Array.from({ length: 5 }, (_, index) => {
    const candleIndex = Math.min(candles.length - 1, Math.round((index / 4) * (candles.length - 1)));
    return { x: x(candleIndex), time: candles[candleIndex].time };
  });
  const selectedIndex = hovered ?? candles.length - 1;
  const selected = candles[selectedIndex];
  const selectedX = x(selectedIndex);
  const selectedY = y(selected.close);
  const rising = selected.close >= selected.open;

  function handlePointer(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const chartX = ((event.clientX - bounds.left) / bounds.width) * width;
    const index = Math.max(0, Math.min(candles.length - 1, Math.floor((chartX - left) / step)));
    setHovered(index);
  }

  return (
    <div className="tvChartShell">
      <div className="tvToolbar">
        <strong>PONS / MCAP</strong>
        <span>{intervalLabel(interval)}</span>
        <span>USD</span>
        <span>LOG</span>
        <b><i /> LIVE</b>
      </div>
      <div className="tvOhlc">
        <span>O <b>${compact(selected.open)}</b></span>
        <span>H <b>${compact(selected.high)}</b></span>
        <span>L <b>${compact(selected.low)}</b></span>
        <span>C <b className={rising ? "up" : "down"}>${compact(selected.close)}</b></span>
      </div>
      <svg
        ref={svgRef}
        className="priceChart tvChart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Interactive PonsEye dollar market cap candlestick chart"
        onPointerMove={handlePointer}
        onPointerLeave={() => setHovered(null)}
      >
        <g className="chartGrid">
          {yTicks.map((tick) => <path key={tick.y} d={`M${left} ${tick.y}H${right}`} />)}
          {xTicks.map((tick) => <path key={tick.x} d={`M${tick.x} ${top}V${bottom}`} />)}
        </g>
        <g className="chartWatermark">
          <text x={(left + right) / 2} y="220" textAnchor="middle">PONSEYE</text>
          <text x={(left + right) / 2} y="247" textAnchor="middle">LAUNCH INTELLIGENCE</text>
        </g>
        <g className="chartCandles">
          {candles.map((candle, index) => {
            const candleX = x(index);
            const openY = y(candle.open);
            const closeY = y(candle.close);
            const up = candle.close >= candle.open;
            return (
              <g key={candle.time} className={up ? "up" : "down"}>
                <path d={`M${candleX} ${y(candle.high)}V${y(candle.low)}`} />
                <rect x={candleX - bodyWidth / 2} y={Math.min(openY, closeY)} width={bodyWidth} height={Math.max(2, Math.abs(closeY - openY))} />
              </g>
            );
          })}
        </g>
        <g className="chartLabels">
          {yTicks.map((tick) => <text key={tick.y} x="916" y={tick.y + 4}>${compact(tick.value)}</text>)}
          {xTicks.map((tick) => <text key={tick.x} x={tick.x} y="440" textAnchor="middle">{new Date(tick.time).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</text>)}
        </g>
        <g className="chartCrosshair">
          <path d={`M${selectedX} ${top}V${bottom}`} />
          <path d={`M${left} ${selectedY}H${right}`} />
          <circle cx={selectedX} cy={selectedY} r="4" />
          <rect x="905" y={selectedY - 12} width="88" height="24" />
          <text x="949" y={selectedY + 4} textAnchor="middle">${compact(selected.close)}</text>
        </g>
      </svg>
    </div>
  );
}
