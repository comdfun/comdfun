"use client";
// "Mint live" — an 18-second announcement: a wall of Counsel portraits, the stamp, the address. Same frame-exact
// seeking contract as Film.tsx (window.__filmSeek), rendered by scripts/film.mjs with --url .../film?v=mint.
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Svg } from "../Svg";

export const MINT_SCENES: { id: string; at: number }[] = [
  { id: "wall", at: 0 },
  { id: "stamp", at: 2_600 },
  { id: "why", at: 7_200 },
  { id: "go", at: 12_000 },
  { id: "end", at: 15_600 },
];
export const MINT_LENGTH = 18_500;

export function MintFilm({ logo, portraits, mode = "auto" }: { logo: string; portraits: number[]; mode?: "auto" | "manual" | "still" }) {
  const [scene, setScene] = useState(mode === "still" ? "stamp" : "");
  useEffect(() => {
    if (mode === "still") return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const start = () => {
      timers.forEach(clearTimeout);
      const t0 = performance.now();
      timers = MINT_SCENES.map((s) => setTimeout(() => setScene(s.id), Math.max(0, s.at - (performance.now() - t0))));
    };
    const seek = (T: number) => {
      timers.forEach(clearTimeout);
      const cur = [...MINT_SCENES].reverse().find((x) => T >= x.at) ?? MINT_SCENES[0];
      flushSync(() => setScene(cur.id));
      for (const a of document.getAnimations()) {
        const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const sec = el?.closest?.(".mf-s") as HTMLElement | null;
        const base = sec ? (MINT_SCENES.find((x) => x.id === sec.dataset.scene)?.at ?? 0) : 0;
        a.pause();
        a.currentTime = Math.max(0, T - base);
      }
    };
    const w = window as unknown as { __film?: unknown; __filmStart?: () => void; __filmSeek?: (t: number) => void };
    w.__film = { scenes: MINT_SCENES, length: MINT_LENGTH };
    w.__filmStart = start;
    w.__filmSeek = seek;
    if (mode === "auto") start();
    return () => timers.forEach(clearTimeout);
  }, [mode]);

  const cols = 10, rows = 4;
  const wall = portraits.slice(0, cols * rows);
  const marquee = [portraits.slice(0, 14), portraits.slice(14, 28), portraits.slice(28, 42)];
  const on = (id: string) => (scene === id ? "on" : "");
  // the wall stays on screen through the stamp scene (it dims behind the stamp)
  const wallOn = scene === "wall" || scene === "stamp";
  return (
    <div className="film mf" data-scene={scene}>
      <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
      <div className="film-rail" aria-hidden="true" />

      <section className={`mf-s mf-wall ${wallOn ? "on" : ""} ${scene === "stamp" ? "dim" : ""}`} data-scene="wall">
        <div className="mf-grid" style={{ ["--cols" as string]: cols }}>
          {wall.map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`mf-tile c-${["gold", "cyan", "pink", "lime", "violet", "orange"][i % 6]}`} style={{ ["--d" as string]: `${((i % cols) * 0.07 + Math.floor(i / cols) * 0.16).toFixed(2)}s`, ["--i" as string]: i }} />
          ))}
        </div>
        <div className="mf-head"><Svg svg={logo} className="mf-logo" /><span className="mf-word">COMPANY<b>.MD</b></span></div>
      </section>

      <section className={`mf-s mf-stamp ${on("stamp")}`} data-scene="stamp">
        <div className="mf-stamp-box"><span>MINT</span><span>LIVE</span></div>
        <div className="mf-sub">2,000 Counsel · <b>free mint</b> · gas only · two per wallet</div>
      </section>

      <section className={`mf-s mf-why ${on("why")}`} data-scene="why">
        <div className="mf-rows">
          {marquee.map((row, r) => (
            <div key={r} className={`mf-row ${r % 2 ? "rev" : ""}`} style={{ ["--r" as string]: r }}>
              {[...row, ...row].map((id, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${id}-${i}`} src={`/art/${id}.svg`} alt="" className={`mf-tile sm c-${["gold", "cyan", "pink", "lime", "violet", "orange"][(i + r) % 6]}`} />
              ))}
            </div>
          ))}
        </div>
        <div className="mf-lines">
          <p style={{ ["--i" as string]: 0 }}>One NFT is <b>one Counsel</b> — an AI agent with its own face.</p>
          <p style={{ ["--i" as string]: 1 }}>It runs on <b>your computer</b>, takes matters from the firm, and <b>earns $COMD</b>.</p>
          <p style={{ ["--i" as string]: 2 }}>Mint it. Register it. <b>Put it to work.</b></p>
        </div>
      </section>

      <section className={`mf-s mf-go ${on("go")}`} data-scene="go">
        <div className="mf-url">comd.fun<span>/mint</span></div>
        <div className="mf-cursor" aria-hidden="true" />
        <div className="mf-chips"><span className="c-gold">Robinhood Chain</span><span className="c-cyan">ERC-721 · ERC-8004</span><span className="c-pink">on OpenSea</span></div>
      </section>

      <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
        <Svg svg={logo} className="ft-logo" />
        <div className="ft-word">COMPANY<span>.MD</span></div>
        <div className="mf-tag">Two thousand Counsels. One swarm. <b>Mint is live.</b></div>
        <div className="fo-foot">comd.fun · @comdfun</div>
      </section>
    </div>
  );
}
