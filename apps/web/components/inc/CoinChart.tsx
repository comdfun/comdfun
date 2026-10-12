"use client";
// A coin's chart: candles from its own trades on the curve, with volume under them.
//
// Built on TradingView's open-source Lightweight Charts, drawn here from the Incorporations Trade events, so it
// works from the first trade, long before any tracker can see the coin. Price is COMD per coin; the toggle shows
// market cap instead (price × 1,000,000,000 supply).
import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { Tick } from "@/lib/incorporations";

const SUPPLY = 1_000_000_000;
const FRAMES: [number, string][] = [[60, "1m"], [300, "5m"], [900, "15m"], [3600, "1h"], [14_400, "4h"], [86_400, "1D"]];

type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number; vol: number; up: boolean };

/** Bucket trades into candles. Each candle opens where the last one closed, so the chart has no gaps in price. */
function candles(ticks: Tick[], frame: number, k: number): Candle[] {
  const out: Candle[] = [];
  let prev: number | null = null;
  for (const t of ticks) {
    const time = (Math.floor(t.t / frame) * frame) as UTCTimestamp;
    const p = t.price * k;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, p); last.low = Math.min(last.low, p); last.close = p; last.vol += t.comd;
      last.up = last.close >= last.open;
    } else {
      const open = prev ?? p;
      out.push({ time, open, high: Math.max(open, p), low: Math.min(open, p), close: p, vol: t.comd, up: p >= open });
    }
    prev = p;
  }
  return out;
}

/** Small numbers people can read: 0.00002314 → "0.0₄2314", 1234567 → "1.23M". */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (a >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (a >= 0.001) return n.toFixed(5);
  const zeros = Math.floor(-Math.log10(a)) - 1;
  const digits = Math.round(a * 10 ** (zeros + 5)).toString().slice(0, 4);
  const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
  return `${n < 0 ? "-" : ""}0.0${sub}${digits}`;
}

export function CoinChart({ ticks, symbol, loading, spot, since }: { ticks: Tick[] | null; symbol: string; loading?: boolean; spot?: number | null; since?: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vol = useRef<ISeriesApi<"Histogram"> | null>(null);
  const flat = useRef<ISeriesApi<"Line"> | null>(null);
  const [mode, setMode] = useState<"price" | "mcap">("price");
  const span = ticks && ticks.length > 1 ? ticks[ticks.length - 1].t - ticks[0].t : 0;
  // the smallest frame that keeps the chart to about 120 candles
  const auto = (FRAMES.find(([f]) => span / f <= 120) ?? FRAMES[FRAMES.length - 1])[0];
  const [frame, setFrame] = useState<number | null>(null);
  const [ready, setReady] = useState(0);
  const f = frame ?? auto;
  const k = mode === "mcap" ? SUPPLY : 1;
  const data = useMemo(() => (ticks ? candles(ticks, f, k) : []), [ticks, f, k]);

  // build the chart once
  useEffect(() => {
    let dead = false;
    (async () => {
      const { createChart, CrosshairMode } = await import("lightweight-charts");
      if (dead || !box.current) return;
      const css = getComputedStyle(document.documentElement);
      const c = createChart(box.current, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: "#9a9488", fontFamily: css.getPropertyValue("--font-sans") || "IBM Plex Sans, sans-serif", fontSize: 12 },
        grid: { vertLines: { color: "rgba(243,235,211,.04)" }, horzLines: { color: "rgba(243,235,211,.05)" } },
        rightPriceScale: { borderColor: "#25212e", scaleMargins: { top: 0.12, bottom: 0.26 } },
        timeScale: { borderColor: "#25212e", timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 9 },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#5e584f", labelBackgroundColor: "#17141e" }, horzLine: { color: "#5e584f", labelBackgroundColor: "#17141e" } },
        localization: { priceFormatter: fmtPrice },
      });
      price.current = c.addCandlestickSeries({
        upColor: "#8cff3a", downColor: "#ff3b5c", borderUpColor: "#8cff3a", borderDownColor: "#ff3b5c", wickUpColor: "#8cff3a", wickDownColor: "#ff3b5c",
        priceFormat: { type: "custom", formatter: fmtPrice, minMove: 1e-12 },
      });
      vol.current = c.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "custom", formatter: fmtPrice, minMove: 0.01 }, lastValueVisible: false, priceLineVisible: false });
      c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      // before the first trade: the curve's own price, flat, from the moment the coin was made
      flat.current = c.addLineSeries({ color: "#ffc83d", lineWidth: 2, lineStyle: 0, priceFormat: { type: "custom", formatter: fmtPrice, minMove: 1e-12 }, title: "starting price",
        // a flat line has no range of its own: give it room above and below so the axis reads as prices, not one value
        autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
          const r = base();
          if (!r) return null;
          const v = r.priceRange.maxValue;
          return { priceRange: { minValue: v * 0.5, maxValue: v * 1.5 } };
        } });
      chart.current = c;
      setReady((r) => r + 1);
    })();
    return () => { dead = true; chart.current?.remove(); chart.current = null; price.current = null; vol.current = null; flat.current = null; };
  }, []);

  // feed it
  useEffect(() => {
    if (!price.current || !vol.current) return;
    price.current.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    vol.current.setData(data.map((d) => ({ time: d.time, value: d.vol, color: d.up ? "rgba(140,255,58,.35)" : "rgba(255,59,92,.35)" })));
    const none = !ticks || ticks.length === 0;
    if (flat.current) {
      if (none && spot) {
        const now = Math.floor(Date.now() / 1000);
        const from = Math.min(since ?? now - 3600, now - 60);
        // a point per candle from launch to now, so the line spans the time the coin has existed
        const pts: { time: UTCTimestamp; value: number }[] = [];
        const step = Math.max(f, Math.ceil((now - from) / 200 / f) * f);
        for (let t = Math.floor(from / step) * step; t <= now; t += step) pts.push({ time: t as UTCTimestamp, value: spot * k });
        if (pts.length < 2) pts.push({ time: (pts[0].time + step) as UTCTimestamp, value: spot * k });
        flat.current.setData(pts);
      } else flat.current.setData([]);
    }
    chart.current?.timeScale().fitContent();
  }, [data, ready, spot, since, f, k, ticks]);

  const first = data[0]?.open;
  const lastC = data.length ? data[data.length - 1].close : spot ? spot * k : undefined;
  const change = first && lastC ? ((lastC - first) / first) * 100 : null;
  const hi = data.length ? Math.max(...data.map((d) => d.high)) : null;
  const lo = data.length ? Math.min(...data.map((d) => d.low)) : null;
  const volume = ticks?.reduce((a, t) => a + t.comd, 0) ?? 0;

  return (
    <div className="cchart">
      <div className="cchart-head">
        <div className="cchart-now">
          <b>{lastC != null ? fmtPrice(lastC) : "—"}</b>
          <span>{mode === "mcap" ? "COMD market cap" : `COMD per $${symbol}`}</span>
          {change != null && <em className={change >= 0 ? "up" : "down"}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</em>}
        </div>
        <div className="cchart-tools">
          <div className="seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={mode === "price"} onClick={() => setMode("price")}>Price</button>
            <button type="button" aria-pressed={mode === "mcap"} onClick={() => setMode("mcap")}>MCap</button>
          </div>
          <div className="seg" role="group" aria-label="Candle size">
            {FRAMES.map(([s, label]) => (
              <button key={s} type="button" aria-pressed={f === s} onClick={() => setFrame(s)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="cchart-plot">
        <div ref={box} className="cchart-canvas" />
        {(!ticks || ticks.length === 0) && (
          <div className={spot ? "cchart-empty cchart-note" : "cchart-empty"}>{loading || !ticks ? "Reading trades from the chain…" : spot ? "No trades yet: this is the starting price. The first buy draws the first candle." : "No trades yet. The first buy draws the first candle."}</div>
        )}
      </div>
      <div className="cchart-foot">
        <span>High <b>{hi != null ? fmtPrice(hi) : "—"}</b></span>
        <span>Low <b>{lo != null ? fmtPrice(lo) : "—"}</b></span>
        <span>Volume <b>{fmtPrice(volume)} COMD</b></span>
        <span>Trades <b>{ticks?.length ?? 0}</b></span>
      </div>
    </div>
  );
}
