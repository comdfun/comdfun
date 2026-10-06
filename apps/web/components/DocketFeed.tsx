"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SwarmEvent, Swarm } from "@/lib/types";
import { EVENT_STYLE, eventHref } from "@/lib/events";
import { ago } from "@/lib/format";

export function DocketFeed({ initial, avatarBase }: { initial: SwarmEvent[]; avatarBase: string }) {
  const [events, setEvents] = useState(initial);
  const [now, setNow] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const seen = useRef(new Set(initial.map((e) => `${e.at}|${e.text}`)));
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    setNow(Date.now());
    if (paused) return;
    const tick = async () => {
      try {
        const r = await fetch("/api/swarm", { cache: "no-store" });
        if (!r.ok) return;
        const s = (await r.json()) as Swarm;
        if (s.events?.length) {
          const f = new Set(s.events.map((e) => `${e.at}|${e.text}`).filter((k) => !seen.current.has(k)));
          f.forEach((k) => seen.current.add(k));
          setFresh(f);
          setEvents(s.events);
        }
        setNow(Date.now());
      } catch {}
    };
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [paused]);
  return (
    <div className="rv">
      <div className="split" style={{ marginBottom: 10 }}>
        <span className="small muted"><span className={`dot ${paused ? "off" : "on"}`} /> {paused ? "Paused" : "Live · every 10 seconds"}</span>
        <button type="button" className="copy-btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>{paused ? "Resume" : "Pause"}</button>
      </div>
      <ul className="feed" aria-live={paused ? "off" : "polite"} aria-label="Latest activity on the docket">
        {events.length === 0 && <li><span /><span /><span className="muted">The docket is quiet.</span></li>}
        {events.slice(0, 30).map((e, i) => {
          const h = eventHref(e);
          const st = EVENT_STYLE[e.kind] ?? { c: "parch", w: e.kind };
          const key = `${e.at}|${e.text}`;
          return (
            <li key={`${key}-${i}`} className={`c-${st.c} ${fresh.has(key) ? "fresh" : ""}`}>
              <span>
                <span className="k">{st.w}</span>
                <span className="t">{now ? ago(e.at, now) : ""}</span>
              </span>
              {e.tokenId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="av" src={avatarBase.replace("{id}", String(Number(e.tokenId)))} alt="" width={30} height={30} loading="lazy" />
              ) : (
                <span />
              )}
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{h ? <Link href={h}>{e.text}</Link> : e.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
