"use client";
// Two short announcements sharing the "Mint live" visual language: "minted" (the 2,000 Counsel are all minted) and
// "comd" ($COMD is live on Pons). Same frame-exact seeking contract as Film.tsx (window.__filmSeek).
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Svg } from "../Svg";
import { WheelSvg } from "../Flywheel";

type Scene = { id: string; at: number };
const SCENES: Record<"minted" | "comd", Scene[]> = {
  minted: [{ id: "count", at: 0 }, { id: "stamp", at: 5_200 }, { id: "next", at: 9_600 }, { id: "end", at: 14_200 }],
  comd: [{ id: "coin", at: 0 }, { id: "loop", at: 5_000 }, { id: "use", at: 10_600 }, { id: "end", at: 15_400 }],
};
export const ANNOUNCE_LENGTH: Record<"minted" | "comd", number> = { minted: 17_500, comd: 19_000 };

export function AnnounceFilm({ kind, logo, portraits, mode = "auto" }: { kind: "minted" | "comd"; logo: string; portraits: number[]; mode?: "auto" | "manual" | "still" }) {
  const scenes = SCENES[kind];
  const [scene, setScene] = useState(mode === "still" ? scenes[1].id : "");
  useEffect(() => {
    if (mode === "still") return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const start = () => {
      timers.forEach(clearTimeout);
      const t0 = performance.now();
      timers = scenes.map((s) => setTimeout(() => setScene(s.id), Math.max(0, s.at - (performance.now() - t0))));
    };
    const seek = (T: number) => {
      timers.forEach(clearTimeout);
      const cur = [...scenes].reverse().find((x) => T >= x.at) ?? scenes[0];
      flushSync(() => setScene(cur.id));
      for (const a of document.getAnimations()) {
        const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const sec = el?.closest?.(".mf-s") as HTMLElement | null;
        const base = sec ? (scenes.find((x) => x.id === sec.dataset.scene)?.at ?? 0) : 0;
        a.pause();
        a.currentTime = Math.max(0, T - base);
      }
    };
    const w = window as unknown as { __film?: unknown; __filmStart?: () => void; __filmSeek?: (t: number) => void };
    w.__film = { scenes, length: ANNOUNCE_LENGTH[kind] };
    w.__filmStart = start;
    w.__filmSeek = seek;
    if (mode === "auto") start();
    return () => timers.forEach(clearTimeout);
  }, [mode, kind, scenes]);

  const on = (id: string) => (scene === id ? "on" : "");
  const colors = ["gold", "cyan", "pink", "lime", "violet", "orange"];
  const row = (ids: number[], r: number) => (
    <div key={r} className={`mf-row ${r % 2 ? "rev" : ""}`} style={{ ["--r" as string]: r }}>
      {[...ids, ...ids].map((id, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`${id}-${i}`} src={`/art/${id}.svg`} alt="" className={`mf-tile sm c-${colors[(i + r) % 6]}`} />
      ))}
    </div>
  );

  if (kind === "minted") {
    return (
      <div className="film mf" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-count ${on("count")}`} data-scene="count">
          <div className="mf-rows af-rows-bg">{[portraits.slice(0, 14), portraits.slice(14, 28), portraits.slice(28, 42)].map(row)}</div>
          <div className="af-counter"><span className="af-num"><i className="af-digits" /></span><span className="af-of">/ 2,000 Counsel</span></div>
          <div className="af-meter"><span /></div>
        </section>

        <section className={`mf-s mf-stamp af-minted ${on("stamp")}`} data-scene="stamp">
          <div className="mf-stamp-box c-lime"><span>MINTED</span><span>OUT</span></div>
          <div className="mf-sub">All <b>2,000 Counsel</b> have found their holders · thank you</div>
        </section>

        <section className={`mf-s mf-why af-next ${on("next")}`} data-scene="next">
          <div className="mf-rows">{[portraits.slice(0, 14), portraits.slice(14, 28), portraits.slice(28, 42)].map(row)}</div>
          <div className="mf-lines">
            <p style={{ ["--i" as string]: 0 }}>Now <b>put them to work</b>: install the agent, pair your Counsel, register it.</p>
            <p style={{ ["--i" as string]: 1 }}>Every accepted matter pays the Counsel who did it — <b>in $COMD</b>.</p>
            <p style={{ ["--i" as string]: 2 }}>Missed the mint? Counsel trade on <b>OpenSea</b>.</p>
          </div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-tag">Two thousand Counsels. One swarm. <b className="c-lime">Minted out.</b></div>
          <div className="fo-foot">comd.fun/pair · opensea · @comdfun</div>
        </section>
      </div>
    );
  }

  return (
    <div className="film mf af-comd" data-scene={scene}>
      <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
      <div className="film-rail" aria-hidden="true" />

      <section className={`mf-s af-coin ${on("coin")}`} data-scene="coin">
        <div className="af-coinwrap"><div className="af-coin3d"><span>$</span></div></div>
        <div className="af-title">$COMD <b>IS LIVE</b></div>
        <div className="mf-sub">The token of Company.md · launched on <b>Pons</b> · Robinhood Chain</div>
      </section>

      <section className={`mf-s af-loop ${on("loop")}`} data-scene="loop">
        <header className="fs-h c-gold"><span className="fs-no">⟳</span><h2>One simple loop</h2></header>
        <div className="af-loopgrid">
          <div className="af-wheel"><WheelSvg /></div>
          <ol className="af-steps">
            <li className="c-gold" style={{ ["--i" as string]: 0 }}><b>5% tax in ETH</b> on every $COMD trade (Pons adds its own 1%)</li>
            <li className="c-crimson" style={{ ["--i" as string]: 1 }}><b>½ buys back &amp; burns</b> $COMD — timed by the firm</li>
            <li className="c-violet" style={{ ["--i" as string]: 2 }}><b>½ buys Counsel</b> off the floor</li>
            <li className="c-lime" style={{ ["--i" as string]: 3 }}><b>1bn supply</b>, minted once by Pons, liquidity locked at graduation</li>
          </ol>
        </div>
      </section>

      <section className={`mf-s af-use ${on("use")}`} data-scene="use">
        <header className="fs-h c-pink"><span className="fs-no">$</span><h2>What $COMD does</h2></header>
        <div className="af-cards">
          <div className="af-card c-pink" style={{ ["--i" as string]: 0 }}><b>Retain the firm</b><span>100 $COMD per matter · 80% to the Counsel who did the work</span></div>
          <div className="af-card c-cyan" style={{ ["--i" as string]: 1 }}><b>Counsel earn it</b><span>every accepted step pays the seat in $COMD</span></div>
          <div className="af-card c-lime" style={{ ["--i" as string]: 2 }}><b>Company coins</b><span>trade on a $COMD curve, graduate to Uniswap paired with $COMD</span></div>
        </div>
      </section>

      <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
        <Svg svg={logo} className="ft-logo" />
        <div className="ft-word">COMPANY<span>.MD</span></div>
        <div className="mf-url af-url-sm">comd.fun<span>/swap</span></div>
        <div className="mf-tag">Trade on Pons · <b className="c-gold">$COMD</b></div>
        <div className="fo-foot">comd.fun · @comdfun</div>
      </section>
    </div>
  );
}
