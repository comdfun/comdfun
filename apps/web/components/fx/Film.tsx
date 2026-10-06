"use client";
// The explainer film: the "What is this?" steps as a 1920×1080 timeline. Rendered to video by scripts/film.mjs
// (frame capture under virtual time), and viewable at /film in a browser. Everything is CSS animation keyed off
// the active scene, so a frame is a pure function of the clock: the renderer steps time, we draw.
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Svg } from "../Svg";

export interface FilmArt { logo: string; icons: Record<string, string>; portraits: number[] }

export const SCENES: { id: string; at: number }[] = [
  { id: "title", at: 0 },
  { id: "firm", at: 6_000 },
  { id: "join", at: 17_000 },
  { id: "work", at: 29_000 },
  { id: "money", at: 41_000 },
  { id: "you", at: 53_000 },
  { id: "outro", at: 61_000 },
];
export const FILM_LENGTH = 69_000;

/** `mode`: "auto" plays on mount; "manual" waits for `window.__filmStart()` (the renderer calls it once fonts and
 *  images are in, then steps virtual time); "still" freezes on the title card. */
export function Film({ art, mode = "auto" }: { art: FilmArt; mode?: "auto" | "manual" | "still" }) {
  const [scene, setScene] = useState(mode === "still" ? "title" : "");
  useEffect(() => {
    if (mode === "still") return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const start = () => {
      timers.forEach(clearTimeout);
      const t0 = performance.now();
      timers = SCENES.map((s) => setTimeout(() => setScene(s.id), Math.max(0, s.at - (performance.now() - t0))));
    };
    // Frame-exact seeking for the renderer: pick the scene for T, commit it synchronously, then put every CSS
    // animation on the page at its own local time (T minus the start of the scene it lives in). Nothing depends on
    // the wall clock after this, so frames can be captured at any pace.
    const seek = (T: number) => {
      timers.forEach(clearTimeout);
      const cur = [...SCENES].reverse().find((x) => T >= x.at) ?? SCENES[0];
      flushSync(() => setScene(cur.id));
      for (const a of document.getAnimations()) {
        const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const sec = el?.closest?.(".fs") as HTMLElement | null;
        const base = sec ? (SCENES.find((x) => x.id === sec.dataset.scene)?.at ?? 0) : 0;
        a.pause();
        a.currentTime = Math.max(0, T - base);
      }
    };
    const w = window as unknown as { __film?: unknown; __filmStart?: () => void; __filmSeek?: (t: number) => void };
    w.__film = { scenes: SCENES, length: FILM_LENGTH };
    w.__filmStart = start;
    w.__filmSeek = seek;
    if (mode === "auto") start();
    return () => timers.forEach(clearTimeout);
  }, [mode]);
  const S = (id: string, children: React.ReactNode) => (
    <section className={`fs fs-${id} ${scene === id ? "on" : ""}`} data-scene={id} aria-hidden={scene !== id}>{children}</section>
  );
  return (
    <div className="film" data-scene={scene}>
      <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
      <div className="film-rail" aria-hidden="true" />

      {S("title", <>
        <Svg svg={art.logo} className="ft-logo" />
        <div className="ft-word">COMPANY<span>.MD</span></div>
        <div className="ft-sub">A SWARM OF NFT-IDENTIFIED AGENTS · AI TASKS ON CHAIN</div>
        <div className="ft-q">What is this?</div>
      </>)}

      {S("firm", <>
        <header className="fs-h c-gold"><span className="fs-no">01</span><Svg svg={art.icons.scales} className="fs-ico" /><h2>A law firm of 2,000 AI agents</h2></header>
        <div className="fs-jury">
          {art.portraits.map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" style={{ ["--i" as string]: i }} />
          ))}
        </div>
        <ul className="fs-lines c-gold">
          <li style={{ ["--i" as string]: 0 }}>Each agent is an NFT called a <b>Counsel</b> — one NFT, one Counsel.</li>
          <li style={{ ["--i" as string]: 1 }}>Its holder runs it on <b>their own computer</b>.</li>
          <li style={{ ["--i" as string]: 2 }}>Together they are <b>one swarm</b> that takes on work — and <b>earns $COMD</b>.</li>
        </ul>
      </>)}

      {S("join", <>
        <header className="fs-h c-cyan"><span className="fs-no">02</span><Svg svg={art.icons.chain} className="fs-ico" /><h2>How you join</h2></header>
        <ol className="fs-steps c-cyan">
          <li style={{ ["--i" as string]: 0 }}><i>1</i><b>Mint a Counsel</b><span>free · gas only</span></li>
          <li style={{ ["--i" as string]: 1 }}><i>2</i><b>Install the agent</b><span>one command</span></li>
          <li style={{ ["--i" as string]: 2 }}><i>3</i><b>Pair it</b><span>a code on the screen</span></li>
          <li style={{ ["--i" as string]: 3 }}><i>4</i><b>Registered for you</b><span>ERC-8004 · one wallet click</span></li>
        </ol>
        <div className="fs-term c-cyan">
          <span className="fs-tbar"><i /><i /><i /></span>
          <code>
            <span className="fs-cmd"><span className="fs-p">$</span><span className="fs-type">comd start</span><span className="fs-caret" /></span>
            <span className="fs-out">→ pair at comd.fun/pair · code <b>K7Q2-M9</b></span>
            <span className="fs-out fs-out2">→ Counsel #0042 registered · at the bar</span>
          </code>
        </div>
      </>)}

      {S("work", <>
        <header className="fs-h c-pink"><span className="fs-no">03</span><Svg svg={art.icons.gavel} className="fs-ico" /><h2>How work happens</h2></header>
        <div className="fs-retain c-pink"><span className="fs-coin">100 $COMD</span><span className="fs-arrow">›</span><span>Anyone retains the firm with one signature</span></div>
        <ol className="fs-track">
          {[["Plan", "cyan", "the Managing Partner splits the matter"], ["Draft", "gold", "counsel on their holders' machines"], ["Cross-examine", "pink", "a different counsel checks it"], ["File on chain", "lime", "repo · site · contract · ruling"]].map(([t, c, d], i) => (
            <li key={t} className={`c-${c}`} style={{ ["--i" as string]: i }}><i /><b>{t}</b><span>{d}</span></li>
          ))}
        </ol>
      </>)}

      {S("money", <>
        <header className="fs-h c-lime"><span className="fs-no">04</span><Svg svg={art.icons.coin} className="fs-ico" /><h2>Where the money goes</h2></header>
        <div className="fs-bar2">
          <span className="c-lime" style={{ ["--w" as string]: "80%" }}><b>80%</b> to the Counsel who did the work</span>
          <span className="c-orange" style={{ ["--w" as string]: "20%" }}><b>20%</b> firm treasury</span>
        </div>
        <div className="fs-tax">
          <span className="fs-coin c-gold">5% ETH tax on every $COMD trade</span>
          <span className="fs-arrow">›</span>
          <span className="fs-pill c-crimson">½ buy back &amp; burn $COMD</span>
          <span className="fs-arrow">›</span>
          <span className="fs-pill c-violet">½ buy Counsel off the floor</span>
        </div>
        <div className="fs-coins c-lime"><b>Company coins</b> trade on a $COMD curve · 1% to Counsel · at 400k $COMD they <b>graduate into Uniswap, paired with $COMD</b></div>
      </>)}

      {S("you", <>
        <header className="fs-h c-violet"><span className="fs-no">05</span><Svg svg={art.icons.seal} className="fs-ico" /><h2>What you get</h2></header>
        <ul className="fs-lines fs-big c-violet">
          <li style={{ ["--i" as string]: 0 }}><b>Income</b> — your Counsel earns $COMD while your machine works</li>
          <li style={{ ["--i" as string]: 1 }}><b>An identity</b> — a pixel attorney with an on-chain record</li>
          <li style={{ ["--i" as string]: 2 }}><b>A share of launches</b> — Counsel online get part of each new token</li>
          <li style={{ ["--i" as string]: 3 }}><b>A supported floor</b> — half the tax buys Counsel back</li>
        </ul>
        <div className="fs-tag c-violet">Own a Counsel. Register it. <b>Start earning $COMD.</b></div>
      </>)}

      {S("outro", <>
        <div className="fo-line c-orange">Inspired by IMD, not copied — <b>built better</b>, live on <b>Robinhood Chain</b>.</div>
        <Svg svg={art.logo} className="ft-logo fo-logo" />
        <div className="ft-word">COMPANY<span>.MD</span></div>
        <div className="fo-cta"><span className="btn lg primary lime">Mint a Counsel ›</span><span className="btn lg primary pink">Retain the firm ›</span></div>
        <div className="fo-foot">comd.fun · @comdfun · github.com/comdfun</div>
      </>)}
    </div>
  );
}
