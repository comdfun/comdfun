"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Activity } from "@/lib/types";
import { CountUp } from "./fx/CountUp";

export function StatusBar({ initial }: { initial: Activity }) {
  const [a, setA] = useState<Activity>(initial);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/activity", { cache: "no-store" });
        if (r.ok && !stop) setA(await r.json());
      } catch {}
    };
    const id = setInterval(tick, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  const tone = a.health === "ok" ? "on" : a.health === "degraded" ? "work" : "off";
  return (
    <div className="statusbar" role="status" aria-live="polite">
      <div className="wrap">
        <span>
          <span className={`dot ${a.online ? "on" : "off"}`} aria-hidden="true" /> <b><CountUp value={a.online ?? 0} format="compact" /></b> <span className="muted">counsel online</span>
        </span>
        <span className="sep" aria-hidden="true">·</span>
        <span>
          <b className="tx-gold"><CountUp value={a.working} /></b> <span className="muted">working on</span> <b className="tx-cyan"><CountUp value={a.jobs} /></b> <span className="muted">matters</span>
        </span>
        <span className="sep hide-sm" aria-hidden="true">·</span>
        <span className="hide-sm">
          <b className="tx-pink"><CountUp value={a.acceptedLastDay ?? 0} format="compact" /></b> <span className="muted">billable steps · 24h</span>
        </span>
        <span className="right-side">
          {a.mock && <span className="mock" title="NEXT_PUBLIC_MOCK=1: fixture data, not the live API">Mock data</span>}
          <Link className="health" href="/docs#health">
            <span className={`dot ${tone}`} aria-hidden="true" /> {a.health === "ok" ? "Health ok" : a.health === "degraded" ? "Degraded" : "Unreachable"}
          </Link>
        </span>
      </div>
    </div>
  );
}
