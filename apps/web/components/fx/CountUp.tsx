"use client";
import { useEffect, useRef, useState } from "react";
import { compact as fmtCompact } from "@/lib/format";

type Fmt = "int" | "compact" | "fixed1" | "fixed2" | "fixed3" | "pct" | "raw";
const show = (n: number, f: Fmt) =>
  f === "compact" ? fmtCompact(n) : f === "fixed1" ? n.toFixed(1) : f === "fixed2" ? n.toFixed(2) : f === "fixed3" ? n.toFixed(3) : f === "pct" ? `${Math.round(n)}%` : f === "raw" ? String(Math.round(n)) : Math.round(n).toLocaleString("en-US");

/**
 * A number that counts up in 16 visible steps when it scrolls into view, and ticks to new values when they change.
 * SSR renders the final value so no-JS and reduced-motion show the truth immediately.
 */
export function CountUp({ value, format = "int", className, steps = 16, ms = 900 }: { value: number | null | undefined; format?: Fmt; className?: string; steps?: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState<number | null>(value ?? null);
  const shown = useRef<number>(value ?? 0);
  const started = useRef(false);
  useEffect(() => {
    if (value == null) return;
    const el = ref.current;
    if (!el || !document.documentElement.classList.contains("fx")) {
      setN(value);
      return;
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = (from: number) => {
      let i = 0;
      clearInterval(timer);
      timer = setInterval(() => {
        i++;
        const v = from + ((value - from) * i) / steps;
        setN(i >= steps ? value : v);
        if (i >= steps) {
          clearInterval(timer);
          shown.current = value;
        }
      }, ms / steps);
    };
    if (!started.current) {
      const io = new IntersectionObserver((es) => {
        if (es.some((e) => e.isIntersecting)) {
          started.current = true;
          io.disconnect();
          run(0);
        }
      });
      io.observe(el);
      return () => {
        io.disconnect();
        clearInterval(timer);
      };
    }
    run(shown.current);
    return () => clearInterval(timer);
  }, [value, steps, ms]);
  return (
    <span ref={ref} className={className} aria-label={value == null ? undefined : show(value, format)}>
      <span aria-hidden="true">{n == null ? "—" : show(n, format)}</span>
    </span>
  );
}
