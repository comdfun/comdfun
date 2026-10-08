"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Swarm, SwarmEvent } from "@/lib/types";
import { EVENT_STYLE, eventHref } from "@/lib/events";
import { ago } from "@/lib/format";

/** The live docket: a marquee of /swarm events under the header. Pauses on hover; scrolls by hand without motion. */
export function Ticker({ initial }: { initial: SwarmEvent[] }) {
  const [events, setEvents] = useState<SwarmEvent[]>(initial);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = async () => {
      try {
        const r = await fetch("/api/swarm", { cache: "no-store" });
        if (!r.ok) return;
        const s = (await r.json()) as Swarm;
        if (s.events?.length) setEvents(s.events.slice(0, 24));
        setNow(Date.now());
      } catch {}
    };
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, []);
  const list = events.length ? events.slice(0, 18) : [{ at: new Date().toISOString(), kind: "opened", text: "The docket is quiet. Retain the firm to open the first matter." } as SwarmEvent];
  const row = (k: string) =>
    list.map((e, i) => {
      const st = EVENT_STYLE[e.kind] ?? { c: "parch", w: e.kind };
      const href = eventHref(e);
      const inner = (
        <>
          <b>{st.w}</b>
          <span>{e.text}</span>
          {now && <span className="t">{ago(e.at, now)}</span>}
        </>
      );
      return href ? (
        <Link key={`${k}${i}`} href={href} className={`tk-item c-${st.c}`} tabIndex={k === "b" ? -1 : undefined}>{inner}</Link>
      ) : (
        <span key={`${k}${i}`} className={`tk-item c-${st.c}`}>{inner}</span>
      );
    });
  return (
    <div className="ticker" role="region" aria-label="Live docket">
      <div className="tk-label"><i aria-hidden="true" /><span>Live docket</span></div>
      <div className="tk-view">
        <div className="tk-track" style={{ ["--tk-dur" as string]: `${Math.max(40, list.length * 7)}s` }}>
          <span className="row" style={{ gap: 0, flexWrap: "nowrap" }}>{row("a")}</span>
          <span className="row" style={{ gap: 0, flexWrap: "nowrap" }} aria-hidden="true">{row("b")}</span>
        </div>
      </div>
    </div>
  );
}
