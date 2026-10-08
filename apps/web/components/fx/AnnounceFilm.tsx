"use client";
// Two short announcements sharing the "Mint live" visual language: "minted" (the 2,000 Counsel are all minted) and
// "comd" ($COMD is live on Pons). Same frame-exact seeking contract as Film.tsx (window.__filmSeek).
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Svg } from "../Svg";
import { WheelSvg } from "../Flywheel";

type Scene = { id: string; at: number };
export type AnnounceKind = "minted" | "comd" | "register" | "tasks" | "steps" | "build" | "imd" | "fomo" | "wheel" | "dev" | "gm" | "burn" | "backend" | "receipt" | "working" | "major" | "burn2" | "traits" | "trades" | "fwtrack" | "versus" | "pushed" | "burn3" | "burn4" | "burn5" | "burn6" | "burn7" | "burn8" | "burn9" | "contest" | "matters" | "today" | "agentfi" | "activity" | "oracle" | "coins" | "clerk" | "x402";
const SCENES: Record<AnnounceKind, Scene[]> = {
  minted: [{ id: "count", at: 0 }, { id: "stamp", at: 5_200 }, { id: "next", at: 9_600 }, { id: "end", at: 14_200 }],
  comd: [{ id: "coin", at: 0 }, { id: "loop", at: 5_000 }, { id: "use", at: 10_600 }, { id: "end", at: 15_400 }],
  register: [
    { id: "r-title", at: 0 }, { id: "r-what", at: 4_500 }, { id: "r-install", at: 12_000 }, { id: "r-pair", at: 20_000 },
    { id: "r-register", at: 28_000 }, { id: "r-online", at: 35_500 }, { id: "r-need", at: 43_000 }, { id: "end", at: 50_500 },
  ],
  tasks: [
    { id: "t-title", at: 0 }, { id: "t-code", at: 4_000 }, { id: "t-audit", at: 11_000 }, { id: "t-web", at: 18_000 },
    { id: "t-research", at: 25_000 }, { id: "t-launch", at: 32_000 }, { id: "t-media", at: 39_000 }, { id: "end", at: 45_500 },
  ],
  imd: [
    { id: "i-title", at: 0 }, { id: "i-thanks", at: 4_500 }, { id: "i-register", at: 11_500 }, { id: "i-chain", at: 19_000 },
    { id: "i-loop", at: 25_500 }, { id: "i-coins", at: 32_500 }, { id: "i-face", at: 39_000 }, { id: "i-open", at: 45_000 }, { id: "end", at: 51_000 },
  ],
  build: [
    { id: "b-title", at: 0 }, { id: "b-open", at: 4_500 }, { id: "b-ideas", at: 12_000 }, { id: "b-rewards", at: 21_000 }, { id: "b-how", at: 28_000 }, { id: "end", at: 34_500 },
  ],
  steps: [
    { id: "s-title", at: 0 }, { id: "s-retain", at: 4_000 }, { id: "s-plan", at: 10_500 }, { id: "s-draft", at: 17_000 },
    { id: "s-clerk", at: 24_000 }, { id: "s-cross", at: 31_000 }, { id: "s-file", at: 38_000 }, { id: "s-pay", at: 45_000 }, { id: "end", at: 52_000 },
  ],
  fomo: [
    { id: "f-title", at: 0 }, { id: "f-what", at: 4_500 }, { id: "f-topics", at: 12_000 }, { id: "f-how", at: 21_000 }, { id: "end", at: 28_500 },
  ],
  contest: [
    { id: "c-title", at: 0 }, { id: "c-prize", at: 5_000 }, { id: "c-how", at: 12_500 }, { id: "c-judge", at: 21_000 }, { id: "end", at: 28_500 },
  ],
  wheel: [
    { id: "w-title", at: 0 }, { id: "w-tax", at: 4_500 }, { id: "w-split", at: 11_500 }, { id: "w-work", at: 19_500 },
    { id: "w-timing", at: 27_000 }, { id: "w-why", at: 34_000 }, { id: "end", at: 41_500 },
  ],
  dev: [
    { id: "d-title", at: 0 }, { id: "d-today", at: 4_500 }, { id: "d-next", at: 12_500 }, { id: "d-how", at: 21_000 }, { id: "end", at: 28_500 },
  ],
  gm: [{ id: "g-title", at: 0 }, { id: "g-back", at: 4_500 }, { id: "end", at: 12_500 }],
  burn: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  burn2: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  burn3: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  burn4: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  burn5: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  burn6: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  burn7: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  burn8: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  burn9: [{ id: "x-title", at: 0 }, { id: "x-what", at: 4_500 }, { id: "x-loop", at: 12_500 }, { id: "end", at: 19_500 }],
  matters: [{ id: "m-title", at: 0 }, { id: "m-docket", at: 4_500 }, { id: "m-day", at: 13_000 }, { id: "m-money", at: 21_000 }, { id: "end", at: 29_000 }],
  today: [{ id: "t-title", at: 0 }, { id: "t-paper", at: 4_500 }, { id: "t-what", at: 14_000 }, { id: "t-copy", at: 22_000 }, { id: "end", at: 29_500 }],
  traits: [{ id: "tr-title", at: 0 }, { id: "tr-what", at: 4_500 }, { id: "tr-how", at: 12_500 }, { id: "end", at: 19_500 }],
  trades: [{ id: "td-title", at: 0 }, { id: "td-market", at: 4_500 }, { id: "td-why", at: 12_000 }, { id: "end", at: 19_000 }],
  fwtrack: [{ id: "fw-title", at: 0 }, { id: "fw-what", at: 4_500 }, { id: "fw-nums", at: 12_000 }, { id: "fw-how", at: 19_000 }, { id: "end", at: 26_000 }],
  versus: [{ id: "v-title", at: 0 }, { id: "v-a", at: 4_500 }, { id: "v-b", at: 15_000 }, { id: "v-sum", at: 25_500 }, { id: "end", at: 31_500 }],
  pushed: [{ id: "ps-title", at: 0 }, { id: "ps-log", at: 4_000 }, { id: "ps-you", at: 16_500 }, { id: "end", at: 23_500 }],
  agentfi: [{ id: "af-title", at: 0 }, { id: "af-trap", at: 4_500 }, { id: "af-needs", at: 12_500 }, { id: "af-us", at: 22_000 }, { id: "end", at: 30_000 }],
  activity: [{ id: "ac-title", at: 0 }, { id: "ac-bar", at: 4_000 }, { id: "ac-docket", at: 11_500 }, { id: "ac-money", at: 20_000 }, { id: "end", at: 28_000 }],
  oracle: [{ id: "or-title", at: 0 }, { id: "or-q", at: 4_500 }, { id: "or-panel", at: 11_500 }, { id: "or-seal", at: 19_000 }, { id: "end", at: 27_000 }],
  coins: [{ id: "co-title", at: 0 }, { id: "co-curve", at: 4_500 }, { id: "co-grad", at: 14_000 }, { id: "co-why", at: 21_500 }, { id: "end", at: 28_500 }],
  clerk: [{ id: "ck-title", at: 0 }, { id: "ck-list", at: 4_500 }, { id: "ck-why", at: 17_000 }, { id: "end", at: 24_000 }],
  x402: [{ id: "x-title2", at: 0 }, { id: "x-http", at: 4_500 }, { id: "x-why", at: 17_500 }, { id: "end", at: 25_000 }],
  backend: [
    { id: "k-title", at: 0 }, { id: "k-rpc", at: 4_500 }, { id: "k-owners", at: 11_500 }, { id: "k-index", at: 18_500 }, { id: "k-tests", at: 25_000 }, { id: "end", at: 31_500 },
  ],
  receipt: [{ id: "r-title", at: 0 }, { id: "r-paper", at: 4_500 }, { id: "end", at: 17_500 }],
  working: [
    { id: "p-title", at: 0 }, { id: "p-0", at: 4_500 }, { id: "p-1", at: 10_500 }, { id: "p-2", at: 16_500 }, { id: "p-3", at: 22_500 }, { id: "p-4", at: 28_500 }, { id: "end", at: 34_500 },
  ],
  major: [
    { id: "p-title", at: 0 }, { id: "p-0", at: 4_500 }, { id: "p-1", at: 11_000 }, { id: "p-2", at: 17_500 }, { id: "p-3", at: 24_000 }, { id: "end", at: 30_500 },
  ],
};
export const ANNOUNCE_LENGTH: Record<AnnounceKind, number> = { minted: 17_500, comd: 19_000, register: 55_000, tasks: 50_000, steps: 56_500, build: 39_000, imd: 55_500, fomo: 33_000, wheel: 46_000, dev: 33_000, gm: 17_000, burn: 24_000, backend: 36_000, receipt: 22_000, working: 39_000, major: 35_000, burn2: 24_000, traits: 24_000, trades: 23_500, fwtrack: 30_500, versus: 36_000, pushed: 28_000, burn3: 24_000, burn4: 24_000, burn5: 24_000, burn6: 24_000, burn7: 24_000, burn8: 24_000, burn9: 24_000, contest: 33_500, today: 34_500, matters: 34_000, agentfi: 34_500, activity: 32_500, oracle: 31_500, coins: 33_000, clerk: 28_500, x402: 29_500 };

export function AnnounceFilm({ kind, logo, portraits, mode = "auto" }: { kind: AnnounceKind; logo: string; portraits: number[]; mode?: "auto" | "manual" | "still" }) {
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
    // the minted counter is driven from the clock (CSS counters cannot be seeked)
    const tick = (T: number) => {
      const el = document.querySelector<HTMLElement>(".af-digits");
      if (!el) return;
      const local = Math.max(0, T - 300);
      const n = Math.min(2000, Math.round((local / 4200) * 2000));
      el.textContent = n.toLocaleString("en-US");
    };
    let raf = 0;
    if (mode === "auto") {
      const t0 = performance.now();
      const loop = () => { tick(performance.now() - t0); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    const seek = (T: number) => {
      timers.forEach(clearTimeout);
      const cur = [...scenes].reverse().find((x) => T >= x.at) ?? scenes[0];
      flushSync(() => setScene(cur.id));
      tick(T);
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
    return () => { timers.forEach(clearTimeout); if (raf) cancelAnimationFrame(raf); };
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
          <div className="af-counter"><span className="af-num"><i className="af-digits">0</i></span><span className="af-of">/ 2,000 Counsel</span></div>
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

  if (kind === "register") {
    const hero = portraits[1];
    return (
      <div className="film mf af-reg" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("r-title")}`} data-scene="r-title">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/art/${hero}.svg`} alt="" className="af-hero c-gold" />
          <div className="af-title af-title-sm">You own a <b>Counsel</b>.</div>
          <div className="mf-sub">Here is how to put it to work — in plain words, four steps.</div>
        </section>

        <section className={`mf-s af-loop ${on("r-what")}`} data-scene="r-what">
          <header className="fs-h c-gold"><span className="fs-no">?</span><h2>What your NFT actually is</h2></header>
          <ul className="fs-lines fs-big c-gold">
            <li style={{ ["--i" as string]: 0 }}>Your Counsel is not just a picture — it is <b>an AI lawyer's badge</b>.</li>
            <li style={{ ["--i" as string]: 1 }}>Whoever holds it can run that lawyer on <b>their own computer</b>.</li>
            <li style={{ ["--i" as string]: 2 }}>While it runs, the firm sends it work. Accepted work <b>pays you in $COMD</b>.</li>
            <li style={{ ["--i" as string]: 3 }}>Registering tells the chain: <b>this Counsel is now a working agent</b>.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop ${on("r-install")}`} data-scene="r-install">
          <header className="fs-h c-cyan"><span className="fs-no">1</span><h2>Install the agent</h2></header>
          <ul className="fs-lines c-cyan">
            <li style={{ ["--i" as string]: 0 }}>Go to <b>comd.fun/pair</b> and copy the install command (it checks a signature before installing).</li>
            <li style={{ ["--i" as string]: 1 }}>You need <b>Node.js</b> and <b>Claude Code or Codex</b> logged in — the agent uses <b>your</b> subscription.</li>
          </ul>
          <div className="fs-term c-cyan">
            <span className="fs-tbar"><i /><i /><i /></span>
            <code>
              <span className="fs-cmd"><span className="fs-p">$</span><span className="fs-type">comd start</span><span className="fs-caret" /></span>
              <span className="fs-out">→ pair at comd.fun/pair · code <b>K7Q2-M9</b></span>
            </code>
          </div>
        </section>

        <section className={`mf-s af-loop ${on("r-pair")}`} data-scene="r-pair">
          <header className="fs-h c-pink"><span className="fs-no">2</span><h2>Pair your computer</h2></header>
          <ol className="fs-steps c-pink">
            <li style={{ ["--i" as string]: 0 }}><i>a</i><b>Open the link</b><span>comd.fun/pair</span></li>
            <li style={{ ["--i" as string]: 1 }}><i>b</i><b>Connect your wallet</b><span>the one holding the Counsel</span></li>
            <li style={{ ["--i" as string]: 2 }}><i>c</i><b>Pick your Counsel</b><span>and type the code from the screen</span></li>
            <li style={{ ["--i" as string]: 3 }}><i>d</i><b>Sign once</b><span>no gas — binds this computer to it</span></li>
          </ol>
        </section>

        <section className={`mf-s af-loop ${on("r-register")}`} data-scene="r-register">
          <header className="fs-h c-lime"><span className="fs-no">3</span><h2>Register it (one click)</h2></header>
          <ul className="fs-lines fs-big c-lime">
            <li style={{ ["--i" as string]: 0 }}>The page prepares the <b>registration</b> for you — the ERC-8004 agent record.</li>
            <li style={{ ["--i" as string]: 1 }}>You click <b>Confirm</b> in your wallet. That is the only transaction. Cents of gas.</li>
            <li style={{ ["--i" as string]: 2 }}>From now on your Counsel has <b>an on-chain identity and a public work record</b>.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop ${on("r-online")}`} data-scene="r-online">
          <header className="fs-h c-gold"><span className="fs-no">4</span><h2>Leave it running</h2></header>
          <div className="af-cards">
            <div className="af-card c-gold" style={{ ["--i" as string]: 0 }}><b>It takes matters</b><span>drafts, reviews, research, code — on your machine</span></div>
            <div className="af-card c-lime" style={{ ["--i" as string]: 1 }}><b>It gets paid</b><span>80% of every accepted job goes to the Counsel who did it</span></div>
            <div className="af-card c-cyan" style={{ ["--i" as string]: 2 }}><b>You claim</b><span>rewards in $COMD each epoch, at comd.fun — whoever holds the NFT</span></div>
          </div>
        </section>

        <section className={`mf-s af-loop ${on("r-need")}`} data-scene="r-need">
          <header className="fs-h c-violet"><span className="fs-no">✓</span><h2>Good to know</h2></header>
          <ul className="fs-lines c-violet">
            <li style={{ ["--i" as string]: 0 }}><b>Use a small VPS, not your personal computer.</b> It is safer (your own files stay out of reach of the agent) and it stays online 24/7 — more work, more $COMD. A $5–10/month Linux box is plenty.</li>
            <li style={{ ["--i" as string]: 1 }}>One computer per Counsel; <b>no open ports</b> needed. Your Counsel never reviews its own work — a different holder's Counsel cross-examines it.</li>
            <li style={{ ["--i" as string]: 2 }}>Stop any time with Ctrl+C. Sell the NFT and the new holder registers their own machine.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/pair</span></div>
          <div className="mf-tag">Register your Counsel. <b className="c-gold">Start earning $COMD.</b></div>
          <div className="fo-foot">docs: comd.fun/docs/run-an-agent · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "tasks") {
    const Task = ({ id, color, no, title, lines, tags, who }: { id: string; color: string; no: string; title: string; lines: string[]; tags: string[]; who: number }) => (
      <section className={`mf-s af-loop af-task c-${color} ${on(id)}`} data-scene={id}>
        <header className={`fs-h c-${color}`}><span className="fs-no">{no}</span><h2>{title}</h2></header>
        <div className="af-taskgrid">
          <ul className={`fs-lines c-${color}`}>
            {lines.map((l, i) => <li key={i} style={{ ["--i" as string]: i }} dangerouslySetInnerHTML={{ __html: l }} />)}
          </ul>
          <div className="af-taskside">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/art/${portraits[who]}.svg`} alt="" className={`af-hero af-hero-sm c-${color}`} />
            <div className="af-tags">{tags.map((t, i) => <span key={t} className={`fs-pill c-${color}`} style={{ ["--i" as string]: i }}>{t}</span>)}</div>
          </div>
        </div>
      </section>
    );
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("t-title")}`} data-scene="t-title">
          <div className="af-jury-sm">{portraits.slice(0, 6).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">What can a <b>Counsel</b> do?</div>
          <div className="mf-sub">51 skills in the catalog · six kinds of work · every result checked and filed on chain</div>
        </section>

        <Task id="t-code" color="gold" no="01" title="Smart contracts & code" who={0}
          lines={["Write a <b>Solidity project</b> from a brief — contracts, Foundry tests, deploy script, docs.", "Implement a <b>Uniswap v4 hook</b>, an <b>ERC-20 / ERC-721</b>, a vault, a vesting contract.", "Fix findings, add tests, produce a <b>gas &amp; size report</b>."]}
          tags={["build-contract-project", "implement-contract", "write-foundry-tests", "uniswap-v4-hooks"]} />
        <Task id="t-audit" color="crimson" no="02" title="Audits & reviews" who={1}
          lines={["A <b>four-specialist audit panel</b> plus a judge rules on a contract before it ships.", "<b>Cross-examination</b>: an independent Counsel reproduces every claim and tries to break it.", "Security reviews for v4 hooks, entry points, property-based testing."]}
          tags={["audit-specialist", "audit-judge", "adversarial-review", "solidity-security-review"]} />
        <Task id="t-web" color="cyan" no="03" title="Websites & front ends" who={2}
          lines={["A <b>responsive website</b>, built, validated in a real browser and hosted at <b>name.sites.comd.fun</b>.", "A <b>front end for a deployed contract</b>: connect wallet, read, write, explain.", "Import and refine an existing site; check its content."]}
          tags={["build-website", "frontend-for-contract", "implement-component", "site-content-check"]} />
        <Task id="t-research" color="lime" no="04" title="Research & rulings" who={3}
          lines={["<b>Research reports</b> with cited sources — markets, protocols, due diligence, standards.", "<b>Oracle rulings</b>: a panel answers an on-chain question from reproducible evidence and signs it.", "Indexers that turn contract events into <b>queryable tables and GraphQL</b>."]}
          tags={["research-report", "oracle-assess", "build-ponder-indexer", "eth-standards"]} />
        <Task id="t-launch" color="pink" no="05" title="Token & project launches" who={4}
          lines={["Launch a <b>token paired with $COMD</b> on Uniswap v4 through the firm's factory — 10% to the swarm.", "<b>Contracts + website</b> in one workflow: the Counsel deploy, then build the front end for it.", "Make an existing Foundry project <b>launch-ready</b>."]}
          tags={["custom-token-launch", "evm-project-launch", "workflow-planner", "deploy-script"]} />
        <Task id="t-media" color="violet" no="06" title="Media & content" who={5}
          lines={["<b>Images, video and audio</b> with the tools the holder has installed on the machine.", "READMEs, documentation, write-ups — <b>as the code actually is</b>.", "Retainers: the same task on a <b>schedule</b>, run after run."]}
          tags={["create-image", "create-video", "create-audio", "write-readme-and-docs"]} />

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/launch</span></div>
          <div className="mf-tag">Retain the firm in $COMD. <b className="c-gold">Two thousand Counsel take it from there.</b></div>
          <div className="fo-foot">full catalog: comd.fun/docs · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "imd") {
    const Cmp = ({ id, color, no, title, before, after, who }: { id: string; color: string; no: string; title: string; before: string[]; after: string[]; who: number }) => (
      <section className={`mf-s af-loop af-task c-${color} ${on(id)}`} data-scene={id}>
        <header className={`fs-h c-${color}`}><span className="fs-no">{no}</span><h2>{title}</h2></header>
        <div className="af-cmp">
          <div className="af-col af-col-before">
            <span className="af-col-h">The idea, as IMD shipped it</span>
            <ul className="fs-lines c-muted">{before.map((l, i) => <li key={i} style={{ ["--i" as string]: i }} dangerouslySetInnerHTML={{ __html: l }} />)}</ul>
          </div>
          <div className={`af-col af-col-after c-${color}`}>
            <span className="af-col-h">Company.md</span>
            <ul className={`fs-lines c-${color}`}>{after.map((l, i) => <li key={i} style={{ ["--i" as string]: i + before.length }} dangerouslySetInnerHTML={{ __html: l }} />)}</ul>
          </div>
          <div className="af-taskside">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/art/${portraits[who]}.svg`} alt="" className={`af-hero af-hero-sm c-${color}`} />
          </div>
        </div>
      </section>
    );
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("i-title")}`} data-scene="i-title">
          <Svg svg={logo} className="ft-logo" />
          <div className="af-title af-title-sm">Inspired by <b>IMD</b>. Built to go further.</div>
          <div className="mf-sub">What we kept, what we changed, and why</div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("i-thanks")}`} data-scene="i-thanks">
          <header className="fs-h c-gold"><span className="fs-no">♥</span><h2>Credit where it is due</h2></header>
          <ul className="fs-lines fs-big c-gold">
            <li style={{ ["--i" as string]: 0 }}>IMD proved the idea: <b>2,000 NFTs that are not pictures but workers</b> — AI agents with on-chain identities, run by their holders, paid for their work.</li>
            <li style={{ ["--i" as string]: 1 }}>We think that idea is right. Company.md is <b>inspired by IMD, not copied</b>: the same standards, rebuilt from the ground up.</li>
            <li style={{ ["--i" as string]: 2 }}>Here is what we did differently, and what it means for a holder.</li>
          </ul>
        </section>

        <Cmp id="i-register" color="cyan" no="01" title="Registering your agent" who={1}
          before={["Several manual steps and registry transactions before a seat can work.", "Easy to get stuck between install and first job."]}
          after={["<b>Free one-click mint</b>, <b>one-command</b> install, a <b>pairing code</b>.", "The site <b>prepares the ERC-8004 registration</b> — one wallet click — then one gas-free signature binds your machine.", "Ten minutes from mint to earning."]} />
        <Cmp id="i-chain" color="lime" no="02" title="Where it lives" who={2}
          before={["Launched on an established L2 with its own crowd and costs."]}
          after={["<b>Robinhood Chain mainnet</b> — ETH gas at fractions of a cent, a chain built for what Robinhood is bringing on-chain.", "Early in an ecosystem that is only starting to fill up."]} />
        <Cmp id="i-loop" color="crimson" no="03" title="The token loop" who={3}
          before={["Several mechanisms layered on the token — more to understand, more to trust."]}
          after={["<b>One loop you can say in a breath</b>: 5% ETH tax → half buys back and burns $COMD, half buys Counsel off the floor.", "Jobs paid in $COMD, <b>80% to the Counsel who did the work</b>, 20% to the firm.", "Buybacks are <b>timed by the firm</b>, not fired blindly by a bot."]} />
        <Cmp id="i-coins" color="pink" no="04" title="Company coins" who={4}
          before={["Community coins as a side feature."]}
          after={["Every Incorporations coin trades on a <b>$COMD bonding curve</b> — every coin bought is $COMD bought.", "At 400k $COMD the coin <b>graduates into Uniswap v4, paired with $COMD</b>, liquidity locked, pool fees to Counsel."]} />
        <Cmp id="i-face" color="violet" no="05" title="A face and a record" who={5}
          before={["A functional interface."]}
          after={["<b>A law firm</b>: 2,000 unique pixel Counsel, an intro, a live docket, filings you can read.", "Every Counsel page shows its traits, its holder, its work and its on-chain reputation."]} />
        <Cmp id="i-open" color="orange" no="06" title="Safety nets and openness" who={0}
          before={["Immutable contracts: if something breaks, it stays broken."]}
          after={["Counsel NFT <b>upgradeable by the owner only</b>; every money contract has <b>pause and recovery</b>; hot keys can be rotated.", "Reviewed before launch, 171 contract tests, <b>all code open</b> at github.com/comdfun/comdfun."]} />

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-tag">Inspired by IMD. <b className="c-gold">Easier to join, simpler to trust, open to build on.</b></div>
          <div className="fo-foot">comd.fun · @comdfun · github.com/comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "fomo") {
    return (
      <div className="film mf af-reg af-tasks af-fomo" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("f-title")}`} data-scene="f-title">
          <div className="af-fomo-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/film/fomo-logo.png" alt="FOMO" className="af-fomo-logo" />
            <span className="fs-coin">$COMD</span>
          </div>
          <div className="af-title af-title-sm">What is your <b>thesis</b> on $COMD?</div>
          <div className="mf-sub">Trading it on <b>FOMO</b>? Write down what you see — in your own words</div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("f-what")}`} data-scene="f-what">
          <header className="fs-h c-cyan"><span className="fs-no">✎</span><h2>Write a thesis</h2></header>
          <ul className="fs-lines fs-big c-cyan">
            <li style={{ ["--i" as string]: 0 }}><b>FOMO</b> is where a big share of Robinhood Chain trades — and every token page has a <b>thesis</b>: your reasoning, right next to the chart.</li>
            <li style={{ ["--i" as string]: 1 }}>Open <b>$COMD</b> on FOMO and write what you think. Bull, bear or just curious — <b>thoughtful beats loud</b>.</li>
            <li style={{ ["--i" as string]: 2 }}>Your thesis sits beside your position, so people see <b>why</b>, not only what.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("f-topics")}`} data-scene="f-topics">
          <header className="fs-h c-gold"><span className="fs-no">?</span><h2>Things worth writing about</h2></header>
          <div className="af-cards af-cards-3x2">
            {[["2,000 Counsel that earn", "NFTs that are workers: register one and it earns $COMD for every accepted matter"], ["A loop you can say in a breath", "5% tax in ETH → half buys back and burns $COMD, half buys Counsel off the floor"], ["80 / 20", "every matter pays 80% to the Counsel who did the work, 20% to the firm treasury"], ["Company coins", "trade on a $COMD curve and graduate into Uniswap paired with $COMD"], ["Robinhood Chain", "early on a chain built for what Robinhood is bringing on-chain"], ["Open and reviewed", "contracts reviewed before launch, 171 tests, all code public on GitHub"]].map(([t, d], i) => (
              <div key={t} className={`af-card c-${colors[i % 6]}`} style={{ ["--i" as string]: i }}><b>{t}</b><span>{d}</span></div>
            ))}
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("f-how")}`} data-scene="f-how">
          <header className="fs-h c-lime"><span className="fs-no">→</span><h2>How to post yours</h2></header>
          <ol className="fs-steps c-lime">
            <li style={{ ["--i" as string]: 0 }}><i>1</i><b>Open FOMO</b><span>search Company.md · $COMD on Robinhood Chain</span></li>
            <li style={{ ["--i" as string]: 1 }}><i>2</i><b>Write your thesis</b><span>what the swarm is, what the loop does, where you think it goes</span></li>
            <li style={{ ["--i" as string]: 2 }}><i>3</i><b>Post it</b><span>public, next to your position — honest beats hype</span></li>
            <li style={{ ["--i" as string]: 3 }}><i>4</i><b>Tag @comdfun</b><span>we read every single one</span></li>
          </ol>
          <div className="fs-term c-lime"><code><span>contract · Robinhood Chain</span><span>0xbFdAc6235dBE77C0CD6EDB01c810c7da858c6c41</span></code></div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-tag">Write it. Post it. <b className="c-gold">Your thesis on $COMD.</b></div>
          <div className="fo-foot">comd.fun · @comdfun · $COMD on FOMO</div>
        </section>
      </div>
    );
  }

  if (kind === "contest") {
    return (
      <div className="film mf af-reg af-tasks af-fomo af-contest" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("c-title")}`} data-scene="c-title">
          <div className="af-fomo-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/film/fomo-logo.png" alt="FOMO" className="af-fomo-logo" />
            <span className="fs-coin">$COMD</span>
          </div>
          <div className="af-title af-title-sm">FOMO <b>contest</b></div>
          <div className="mf-sub">Write a thesis on <b>FOMO</b> · <b>48 hours</b> · $500 in $COMD</div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("c-prize")}`} data-scene="c-prize">
          <header className="fs-h c-gold"><span className="fs-no">$</span><h2>The prize</h2></header>
          <div className="af-prize">
            <div className="af-prize-fig"><b>$500</b><span>worth of $COMD</span></div>
            <ul className="fs-lines fs-big c-gold">
              <li style={{ ["--i" as string]: 0 }}>Write a <b>thesis on $COMD</b> on FOMO in the next <b>48 hours</b> and you are eligible to win.</li>
              <li style={{ ["--i" as string]: 1 }}>Paid in <b>$COMD</b>, straight to the wallet you write from. One entry per person.</li>
              <li style={{ ["--i" as string]: 2 }}>The window closes <b>48 hours</b> after this post. Late entries still get read — they just cannot win.</li>
            </ul>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("c-how")}`} data-scene="c-how">
          <header className="fs-h c-cyan"><span className="fs-no">→</span><h2>How to enter</h2></header>
          <ol className="fs-steps c-cyan">
            <li style={{ ["--i" as string]: 0 }}><i>1</i><b>Open $COMD on FOMO</b><span>search Company.md · Robinhood Chain</span></li>
            <li style={{ ["--i" as string]: 1 }}><i>2</i><b>Write your thesis</b><span>what the swarm is, what the loop does, where you think it goes</span></li>
            <li style={{ ["--i" as string]: 2 }}><i>3</i><b>Post it publicly</b><span>next to your position, in your own words</span></li>
            <li style={{ ["--i" as string]: 3 }}><i>4</i><b>Tag @comdfun</b><span>so we can find it — that is your entry</span></li>
          </ol>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("c-judge")}`} data-scene="c-judge">
          <header className="fs-h c-lime"><span className="fs-no">⚖</span><h2>What wins</h2></header>
          <ul className="fs-lines fs-big c-lime">
            <li style={{ ["--i" as string]: 0 }}><b>Thought, not volume.</b> The clearest reasoning about what Company.md is and why the loop works.</li>
            <li style={{ ["--i" as string]: 1 }}><b>Honest beats hype.</b> Bull, bear or undecided — a good bear case can win this.</li>
            <li style={{ ["--i" as string]: 2 }}>Read and picked <b>by the firm</b>, announced on <b>@comdfun</b> when the 48 hours are up.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-tag">48 hours. One thesis. <b className="c-gold">$500 in $COMD.</b></div>
          <div className="fo-foot">comd.fun · @comdfun · $COMD on FOMO</div>
        </section>
      </div>
    );
  }

  if (kind === "wheel") {
    return (
      <div className="film mf af-reg af-tasks af-wheelfilm" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("w-title")}`} data-scene="w-title">
          <div className="af-wheel af-wheel-title"><WheelSvg /></div>
          <div className="af-title af-title-sm">The <b>Flywheel</b></div>
          <div className="mf-sub">How <b>$COMD</b> feeds itself — in five pictures</div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("w-tax")}`} data-scene="w-tax">
          <header className="fs-h c-gold"><span className="fs-no">01</span><h2>Every trade pays in</h2></header>
          <div className="af-taskgrid">
            <ul className="fs-lines c-gold">
              <li style={{ ["--i" as string]: 0 }}>Every buy and sell of $COMD pays a <b>5% tax, taken in ETH</b>. Pons adds its own 1% on top — that part is Pons&apos;s, not the firm&apos;s.</li>
              <li style={{ ["--i" as string]: 1 }}>Wallet transfers and job payments are <b>never taxed</b>.</li>
              <li style={{ ["--i" as string]: 2 }}>The ETH lands in one contract: the <b>Flywheel</b> — public, on chain, owned by the firm&apos;s Admin.</li>
            </ul>
            <div className="af-taskside"><div className="af-coin3d af-coin-sm"><span>5%</span></div></div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-crimson ${on("w-split")}`} data-scene="w-split">
          <header className="fs-h c-crimson"><span className="fs-no">02</span><h2>Two buckets, half each</h2></header>
          <div className="af-cards af-cards-2">
            <div className="af-card c-crimson" style={{ ["--i" as string]: 0 }}><b>½ Buyback &amp; burn</b><span>The bucket&apos;s ETH buys $COMD on the market and sends it to <b>0x…dEaD</b> — gone for good. The supply only ever shrinks.</span></div>
            <div className="af-card c-violet" style={{ ["--i" as string]: 1 }}><b>½ Floor sweep</b><span>The other half buys the <b>cheapest Counsel listed</b>. The floor rises; swept Counsel are held by the firm and awarded to Counsel with standout work.</span></div>
          </div>
          <ul className="fs-lines c-crimson">
            <li style={{ ["--i" as string]: 2 }}>50 / 50 by default. Every wei is accounted for: <b>tax in = buckets + bought back + swept</b>, checked by an on-chain invariant.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("w-work")}`} data-scene="w-work">
          <header className="fs-h c-lime"><span className="fs-no">03</span><h2>Work feeds it too</h2></header>
          <div className="af-taskgrid">
            <ul className="fs-lines c-lime">
              <li style={{ ["--i" as string]: 0 }}>Every matter is paid in <b>$COMD</b>: 80% to the Counsel who did the work, 20% to the firm treasury.</li>
              <li style={{ ["--i" as string]: 1 }}>Company coins trade on a <b>$COMD bonding curve</b> and graduate into Uniswap <b>paired with $COMD</b> — their pool fees flow to Counsel.</li>
              <li style={{ ["--i" as string]: 2 }}>More work means more $COMD changing hands — and <b>every trade pays the tax</b>.</li>
            </ul>
            <div className="af-taskside">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/art/${portraits[3]}.svg`} alt="" className="af-hero af-hero-sm c-lime" />
            </div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-violet ${on("w-timing")}`} data-scene="w-timing">
          <header className="fs-h c-violet"><span className="fs-no">04</span><h2>Timed by the firm</h2></header>
          <div className="af-taskgrid">
            <ul className="fs-lines c-violet">
              <li style={{ ["--i" as string]: 0 }}>Buybacks are <b>not fired blindly by a bot</b>. The ETH accumulates, and the firm calls <b>buyback</b> when it chooses.</li>
              <li style={{ ["--i" as string]: 1 }}>Every buyback and every sweep is a <b>public transaction</b> — on the explorer and on comd.fun/flywheel.</li>
              <li style={{ ["--i" as string]: 2 }}>Totals you can check any time: <b>ETH in, ETH spent, $COMD burned, Counsel swept</b>.</li>
            </ul>
            <div className="af-taskside">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/art/${portraits[0]}.svg`} alt="" className="af-hero af-hero-sm c-violet" />
            </div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("w-why")}`} data-scene="w-why">
          <header className="fs-h c-gold"><span className="fs-no">05</span><h2>Why it is a wheel</h2></header>
          <div className="af-loopgrid">
            <div className="af-wheel"><WheelSvg /></div>
            <ol className="af-steps">
              <li className="c-gold" style={{ ["--i" as string]: 0 }}><b>Work gets done</b> → paid in $COMD</li>
              <li className="c-crimson" style={{ ["--i" as string]: 1 }}><b>$COMD trades</b> → 5% in ETH into the Flywheel</li>
              <li className="c-violet" style={{ ["--i" as string]: 2 }}><b>Burns</b> shrink the supply · <b>sweeps</b> lift the floor</li>
              <li className="c-lime" style={{ ["--i" as string]: 3 }}><b>Counsel become worth more</b> → more register → more work</li>
            </ol>
          </div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/flywheel</span></div>
          <div className="mf-tag">Trade. Burn. Sweep. <b className="c-gold">Repeat.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "dev") {
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("d-title")}`} data-scene="d-title">
          <div className="af-jury-sm">{portraits.slice(12, 18).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">We keep <b>shipping</b></div>
          <div className="mf-sub">Continuous development updates and <b>technical improvements</b> — from day one</div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("d-today")}`} data-scene="d-today">
          <header className="fs-h c-cyan"><span className="fs-no">✓</span><h2>Shipped on launch day</h2></header>
          <ul className="fs-lines c-cyan">
            <li style={{ ["--i" as string]: 0 }}><b>Graduation</b>: Incorporations coins now graduate into Uniswap v4 <b>paired with $COMD</b>, liquidity locked, pool fees to Counsel.</li>
            <li style={{ ["--i" as string]: 1 }}><b>Counsel pages</b>: every one of the 2,000 listed, holder and traits on chain, one-click metadata refresh for the marketplaces.</li>
            <li style={{ ["--i" as string]: 2 }}><b>Resilience</b>: the API and the site fail over between RPC endpoints when one is blocked; no per-IP limits on metadata for indexers.</li>
            <li style={{ ["--i" as string]: 3 }}><b>Safety nets</b> across every money contract — pause, recovery, key rotation — and 171 contract tests, all public.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("d-next")}`} data-scene="d-next">
          <header className="fs-h c-gold"><span className="fs-no">→</span><h2>What is being built next</h2></header>
          <div className="af-cards af-cards-3x2">
            {[["Treasury controls", "timed buybacks and the Uniswap pool switch, right on comd.fun — no explorer needed"], ["Verified source", "every contract verified on Blockscout and Etherscan, read and write from the explorer"], ["More skills", "51 in the catalog today; new kinds of work for Counsel keep landing"], ["Holder dashboard", "earnings per Counsel, claims, reputation — one page for your seats"], ["Incorporations tools", "charts, graduation trackers and alerts for company coins"], ["Performance", "faster docket, indexing and mobile polish — the unglamorous work, done continuously"]].map(([t, d], i) => (
              <div key={t} className={`af-card c-${colors[i % 6]}`} style={{ ["--i" as string]: i }}><b>{t}</b><span>{d}</span></div>
            ))}
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("d-how")}`} data-scene="d-how">
          <header className="fs-h c-lime"><span className="fs-no">{"</>"}</span><h2>How updates reach you</h2></header>
          <ul className="fs-lines fs-big c-lime">
            <li style={{ ["--i" as string]: 0 }}>Every change is a <b>public commit</b> at github.com/comdfun/comdfun — the site and the API deploy from it.</li>
            <li style={{ ["--i" as string]: 1 }}><b>Agent releases</b> are tagged at github.com/comdfun/worker — re-run the one install command to update your Counsel.</li>
            <li style={{ ["--i" as string]: 2 }}>Contracts change only where designed: the Counsel NFT by the <b>owner, through a proxy</b>; money contracts are paused and migrated, never altered in silence.</li>
            <li style={{ ["--i" as string]: 3 }}>Follow <b>@comdfun</b> for the changelog, and tell us what to build next.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">github.com<span>/comdfun</span></div>
          <div className="mf-tag">Built in public. <b className="c-gold">Shipping continuously.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "gm") {
    return (
      <div className="film mf af-reg af-tasks af-gm" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("g-title")}`} data-scene="g-title">
          <div className="af-sun" aria-hidden="true" />
          <div className="af-jury-sm">{portraits.slice(18, 24).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title">GM<b>.</b></div>
          <div className="mf-sub">Day two at the firm · <b>2,000 Counsel</b> report for duty</div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("g-back")}`} data-scene="g-back">
          <header className="fs-h c-gold"><span className="fs-no">⟳</span><h2>Back to shipping</h2></header>
          <ul className="fs-lines fs-big c-gold">
            <li style={{ ["--i" as string]: 0 }}><b>Day one</b>: 2,000 Counsel minted out, <b>$COMD</b> live on Pons, every contract live on Robinhood Chain.</li>
            <li style={{ ["--i" as string]: 1 }}><b>Today</b>: register your Counsel, retain the firm, watch the docket fill — we keep fixing and building in public.</li>
            <li style={{ ["--i" as string]: 2 }}>Every commit at <b>github.com/comdfun/comdfun</b> · changelog on <b>@comdfun</b>.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-tag">GM. <b className="c-gold">Back to shipping.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "burn" || kind === "burn2" || kind === "burn3" || kind === "burn4" || kind === "burn5" || kind === "burn6" || kind === "burn7" || kind === "burn8" || kind === "burn9") {
    const again = kind !== "burn";
    // figures from the Creator wallet's trades (manual buybacks on Pons, sent to 0x…dEaD)
    const fig: { burned: string; burnedPct?: string; total: string; pct: string; spent: string | null } = kind === "burn9"
      ? { burned: "12M", burnedPct: "1.2%", total: "103M", pct: "10.3%", spent: null }
      : kind === "burn8"
      ? { burned: "10M", burnedPct: "1%", total: "91.5M", pct: "9.15%", spent: null }
      : kind === "burn7"
      ? { burned: "6.5M", burnedPct: "0.65%", total: "81.5M", pct: "8.15%", spent: null }
      : kind === "burn6"
      ? { burned: "8M", burnedPct: "0.8%", total: "75M", pct: "7.5%", spent: null }
      : kind === "burn5"
      ? { burned: "10M", burnedPct: "1%", total: "70M", pct: "7%", spent: null }
      : kind === "burn4"
      ? { burned: "4.3M", burnedPct: "0.43%", total: "58.4M", pct: "5.84%", spent: null }
      : kind === "burn3"
      ? { burned: "17.8M", burnedPct: "1.78%", total: "54.1M", pct: "5.41%", spent: null }
      : again
        ? { burned: "17.8M", total: "36.3M", pct: "3.63%", spent: "~$4.9K" }
        : { burned: "18.5M", total: "18.5M", pct: "1.85%", spent: "~$2.5K" };
    return (
      <div className="film mf af-reg af-tasks af-burn" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle af-coin ${on("x-title")}`} data-scene="x-title">
          <div className="af-coinwrap af-burnwrap"><div className="af-flames" aria-hidden="true"><i /><i /><i /><i /><i /></div><div className="af-coin3d"><span>$</span></div></div>
          <div className="af-title af-title-sm">{again ? "Another" : "First"} <b>buyback &amp; burn</b></div>
          <div className="af-figure"><b>{fig.burned}</b> $COMD burned{fig.burnedPct ? <> · <b>{fig.burnedPct}</b> of supply</> : null}{again ? <> · <b>{fig.total}</b> so far</> : null}</div>
          <div className="mf-sub"><b>Completed</b> · on chain · Robinhood Chain</div>
        </section>

        <section className={`mf-s af-loop af-task c-crimson ${on("x-what")}`} data-scene="x-what">
          <header className="fs-h c-crimson"><span className="fs-no">🔥</span><h2>What just happened</h2></header>
          <ul className="fs-lines fs-big c-crimson">
            <li style={{ ["--i" as string]: 0 }}>The ETH collected from the <b>5% trading tax</b> bought <b>{fig.burned} $COMD</b> on the market{fig.spent ? ` (${fig.spent})` : ""}{again ? " — again" : ""}{fig.burnedPct ? <>: another <b>{fig.burnedPct} of the supply</b></> : null}.</li>
            <li style={{ ["--i" as string]: 1 }}>Every token bought was sent to <b>0x…dEaD</b> — gone for good. <b>{fig.total} $COMD</b> burned so far: <b>{fig.pct}</b> of the supply, never coming back.</li>
            <li style={{ ["--i" as string]: 2 }}><b>Timed by the firm</b>, not fired by a bot. The transaction is public: verify it on the explorer, totals on comd.fun/flywheel.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("x-loop")}`} data-scene="x-loop">
          <header className="fs-h c-gold"><span className="fs-no">⟳</span><h2>The loop is turning</h2></header>
          <div className="af-loopgrid">
            <div className="af-wheel"><WheelSvg /></div>
            <ol className="af-steps">
              <li className="c-gold" style={{ ["--i" as string]: 0 }}><b>Trades</b> pay the 5% tax in ETH</li>
              <li className="c-crimson" style={{ ["--i" as string]: 1 }}><b>Half burns $COMD</b> — {fig.burned} {again ? "this time, " + fig.total + " in all (" + fig.pct + ")" : "done, for the first time"}</li>
              <li className="c-violet" style={{ ["--i" as string]: 2 }}><b>Half buys Counsel</b> off the floor — next</li>
              <li className="c-lime" style={{ ["--i" as string]: 3 }}><b>Work</b> is paid in $COMD → more trades → repeat</li>
            </ol>
          </div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/flywheel</span></div>
          <div className="mf-tag">{fig.total} $COMD burned. <b className="c-gold">{again ? "The loop keeps turning." : "Many more to come."}</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "matters") {
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("m-title")}`} data-scene="m-title">
          <div className="af-jury-sm">{portraits.slice(18, 24).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-kicker c-gold">Activity update</div>
          <div className="af-title af-title-sm">The <b>matters</b></div>
          <div className="mf-sub">Day two · <b>29 matters</b> on the docket since this morning</div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("m-docket")}`} data-scene="m-docket">
          <header className="fs-h c-gold"><span className="fs-no">29</span><h2>The docket today</h2></header>
          <div className="af-cards af-cards-4">
            <div className="af-card c-gold" style={{ ["--i" as string]: 0 }}><b>10 retained</b><span>research reports, 100 $COMD each — paid with one signature, settled on chain</span></div>
            <div className="af-card c-lime" style={{ ["--i" as string]: 1 }}><b>2 filed</b><span>drafted, checked and delivered — about a minute from retainer to filing</span></div>
            <div className="af-card c-cyan" style={{ ["--i" as string]: 2 }}><b>8 drafting</b><span>waiting on the model provider; they pick up again on their own</span></div>
            <div className="af-card c-crimson" style={{ ["--i" as string]: 3 }}><b>19 refused</b><span>a batch that was not work. The intake screen said no; nothing ran, nothing was paid</span></div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("m-day")}`} data-scene="m-day">
          <header className="fs-h c-cyan"><span className="fs-no">⏱</span><h2>How the day went</h2></header>
          <ul className="fs-lines fs-big c-cyan">
            <li style={{ ["--i" as string]: 0 }}><b>11:50 UTC</b> — the first matter is retained: a 200-word report on what Company.md is.</li>
            <li style={{ ["--i" as string]: 1 }}><b>12:09</b> — the first filing lands: drafted, checked by the Clerk, delivered. <b>12:14</b> — the second.</li>
            <li style={{ ["--i" as string]: 2 }}><b>Afternoon</b> — a batch of 19 filings tries to use the firm against its own Counsel. Refused at intake, struck from the docket.</li>
            <li style={{ ["--i" as string]: 3 }}>Every matter, every state, every reason is public at <b>comd.fun/jobs</b>.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-pink ${on("m-money")}`} data-scene="m-money">
          <header className="fs-h c-pink"><span className="fs-no">$</span><h2>$COMD paid and earned</h2></header>
          <ul className="fs-lines fs-big c-pink">
            <li style={{ ["--i" as string]: 0 }}><b>1,000 $COMD paid</b> by clients — 10 matters × 100 $COMD, through the RevenueRouter.</li>
            <li style={{ ["--i" as string]: 1 }}><b>800 $COMD</b> to the Counsel who do the work (80%), <b>200 $COMD</b> to the firm treasury (20%).</li>
            <li style={{ ["--i" as string]: 2 }}><b>80 $COMD per filing</b> earned so far by the Counsel who filed — paid with the next reward epoch, claimable at comd.fun/me.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/jobs</span></div>
          <div className="mf-tag">Twenty-nine on the docket. <b className="c-gold">Retain the firm.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "today") {
    const stats: [string, string][] = [["24", "matters filed"], ["2", "completed"], ["58.4M", "$COMD burned"], ["2", "Counsel online"]];
    const lines: [string, string, string, string][] = [
      ["15:27", "Registered", "gold", "Counsel #1750 registered as an agent · Founding Hundred #6"],
      ["13:49", "Burn", "orange", "4.3M $COMD bought back and burned · 0xa3eb…ee57"],
      ["12:14", "Completed", "lime", "MATTER 2026-0412 completed — what Company.md is, in 200 words"],
      ["11:33", "Burn", "orange", "17.8M $COMD bought back and burned · 0x3776…d052"],
      ["08:29", "Burn", "orange", "17.8M $COMD bought back and burned · 0x8dac…23ee"],
    ];
    const report = [
      "Company.md daily report, 7 October 2026 (day 2)",
      "Matters filed today: 24. Completed: 2. Billable steps accepted: 2.",
      "Buyback and burn: 58.4M $COMD burned today in 8 burns. 58.4M burned in total, 5.84% of supply.",
      "Counsel online now: 2. New registrations today: 6. Founding Hundred: 6 of 100 seats taken.",
      "$COMD paid to Counsel so far: 800.",
      "Full log: comd.fun/today",
    ];
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("t-title")}`} data-scene="t-title">
          <div className="af-jury-sm">{portraits.slice(12, 18).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-kicker c-cyan">New on comd.fun</div>
          <div className="af-title af-title-sm">Today <b>at the firm</b></div>
          <div className="mf-sub">The <b>daily report</b> · the last 24 hours, live · comd.fun/today</div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan af-receipt af-daily ${on("t-paper")}`} data-scene="t-paper">
          <div className="af-paper">
            <div className="rc-h">THE DAILY DOCKET · COMD.FUN/TODAY</div>
            <div className="rc-meta"><span>Day 2 · 7 October 2026 · UTC</span><span>refreshed every minute</span></div>
            <div className="dd-stats">{stats.map(([v, k], i) => <div key={k} style={{ ["--i" as string]: i }}><b>{v}</b><span>{k}</span></div>)}</div>
            <ol className="dd-log">
              {lines.map(([t, tag, c, text], i) => (
                <li key={i} style={{ ["--i" as string]: i + 4 }}><i>{t}</i><em className={`c-${c}`}>{tag}</em><span>{text}</span></li>
              ))}
            </ol>
            <div className="rc-total"><span>LAST 24 HOURS</span><span>FROM THE DOCKET AND THE CHAIN</span></div>
            <div className="rc-stamp dd-stamp">LIVE</div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("t-what")}`} data-scene="t-what">
          <header className="fs-h c-lime"><span className="fs-no">24h</span><h2>What it shows</h2></header>
          <ul className="fs-lines fs-big c-lime">
            <li style={{ ["--i" as string]: 0 }}><b>The work</b>: matters filed and completed, billable steps accepted, rulings sealed — in the last 24 hours.</li>
            <li style={{ ["--i" as string]: 1 }}><b>The money</b>: $COMD bought back and burned today, read from the chain, and every $COMD paid to Counsel.</li>
            <li style={{ ["--i" as string]: 2 }}><b>The bar</b>: who registered, who billed, who is online right now.</li>
            <li style={{ ["--i" as string]: 3 }}><b>The log</b>: every entry linked to its matter or its transaction. Nothing typed by hand.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("t-copy")}`} data-scene="t-copy">
          <header className="fs-h c-gold"><span className="fs-no">⎘</span><h2>The report, as text</h2></header>
          <div className="af-reportgrid">
            <pre className="af-reportbox">{report.map((l, i) => <span key={i} style={{ ["--i" as string]: i }}>{l}{"\n"}</span>)}</pre>
            <ul className="fs-lines c-gold">
              <li style={{ ["--i" as string]: 1.6 }}>Written by the page, <b>from the numbers on it</b>.</li>
              <li style={{ ["--i" as string]: 2.5 }}>Plain text, <b>no emojis</b>. One click to copy.</li>
              <li style={{ ["--i" as string]: 3.4 }}>Paste it into <b>X or Telegram</b>. The daily update, done.</li>
            </ul>
          </div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/today</span></div>
          <div className="mf-tag">The firm, <b className="c-gold">one day at a time.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "backend") {
    const Item = ({ id, color, no, title, lines, who }: { id: string; color: string; no: string; title: string; lines: string[]; who: number }) => (
      <section className={`mf-s af-loop af-task c-${color} ${on(id)}`} data-scene={id}>
        <header className={`fs-h c-${color}`}><span className="fs-no">{no}</span><h2>{title}</h2></header>
        <div className="af-taskgrid">
          <ul className={`fs-lines c-${color}`}>{lines.map((l, i) => <li key={i} style={{ ["--i" as string]: i }} dangerouslySetInnerHTML={{ __html: l }} />)}</ul>
          <div className="af-taskside">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/art/${portraits[who]}.svg`} alt="" className={`af-hero af-hero-sm c-${color}`} />
          </div>
        </div>
      </section>
    );
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("k-title")}`} data-scene="k-title">
          <div className="af-jury-sm">{portraits.slice(24, 30).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">Backend <b>improvements</b></div>
          <div className="mf-sub">Shipped tonight · the machinery behind <b>comd.fun</b></div>
        </section>

        <Item id="k-rpc" color="cyan" no="01" title="Chain access that does not flinch" who={6}
          lines={["The public RPC began answering our servers with a bot wall. The API and the site now use a <b>dedicated endpoint first</b> and <b>fail over</b> to the public one.", "Rate limits are <b>retried</b> before switching; a bot wall is skipped at once.", "No single RPC can take the firm offline again."]} />
        <Item id="k-owners" color="lime" no="02" title="Holder lookups, 250× lighter" who={7}
          lines={["Who holds each Counsel used to take <b>2,000 separate calls</b> every 30 seconds.", "Now: <b>8 batched Multicall3 calls</b>, cached, refreshed in the background — Counsel pages and the directory load instantly.", "A failed lookup <b>keeps the last known holder</b>; a flaky RPC never makes a Counsel look unowned."]} />
        <Item id="k-index" color="gold" no="03" title="Friendlier to indexers" who={8}
          lines={["Token metadata, portraits and brand files carry <b>no per-IP limits</b> — OpenSea and other indexers fetch all 2,000 in one pass.", "One <b>ERC-4906</b> transaction from the Mint page tells every marketplace to re-read the collection.", "Traits, images and the holder are read from the same source the chain points to."]} />
        <Item id="k-tests" color="violet" no="04" title="Checked, not hoped" who={9}
          lines={["<b>171 contract tests</b> · <b>26 end-to-end runs</b> through a real chain · unit suites on every push.", "Every change is a <b>public commit</b>; CI has to be green before anything deploys.", "What broke tonight was fixed tonight — in the open."]} />

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">github.com<span>/comdfun</span></div>
          <div className="mf-tag">Quieter, faster, <b className="c-gold">harder to knock over.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "receipt") {
    const items: [string, string][] = [
      ["Holder home · comd.fun/me", "every Counsel you hold, its stage, the next step, claim your $COMD"],
      ["Health alerts", "the firm pages its team within 10 minutes if anything degrades"],
      ["Live counters", "$COMD paid to Counsel · $COMD burned — on the home page, read from the chain"],
      ["Share cards", "a pixel card for every Counsel; the preview wherever its page is posted"],
      ["Founding Hundred", "the first hundred registered Counsel, on the record for good"],
    ];
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("r-title")}`} data-scene="r-title">
          <div className="af-jury-sm">{portraits.slice(30, 36).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">Today&apos;s <b>shipping receipt</b></div>
          <div className="mf-sub">Day two · <b>five</b> things that went live</div>
        </section>

        <section className={`mf-s af-loop af-task c-gold af-receipt ${on("r-paper")}`} data-scene="r-paper">
          <div className="af-paper">
            <div className="rc-h">COMPANY.MD · SHIPPING RECEIPT</div>
            <div className="rc-meta"><span>comd.fun · Robinhood Chain</span><span>Day 2 · 2026-10-07</span></div>
            <ol>
              {items.map(([t, d], i) => (
                <li key={t} style={{ ["--i" as string]: i }}><i>{String(i + 1).padStart(2, "0")}</i><div><b>{t}</b><span>{d}</span></div><em>✓</em></li>
              ))}
            </ol>
            <div className="rc-total"><span>5 ITEMS</span><span>0 EXCUSES</span></div>
            <div className="rc-stamp">SHIPPED</div>
          </div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-tag">Shipped today. <b className="c-gold">Receipt attached.</b></div>
          <div className="fo-foot">comd.fun · @comdfun · github.com/comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "working" || kind === "major") {
    const plan: { title: string; sub: string; tag: string; items: [string, string, string[]][] } = kind === "working"
      ? { title: "Big improvements <b>we are working on</b>", sub: "In the shop now · landing over the coming days", tag: "Bigger pieces. <b class=\"c-gold\">Landing soon.</b>", items: [
          ["Treasury-seeded matters", "gold", ["The firm <b>retains itself</b> for public-good work — flywheel dashboards, indexers, docs — so early Counsel have matters and the docket is never empty.", "Paid from the <b>20% treasury</b>; every result filed on chain like any other matter."]],
          ["Operator delegation", "cyan", ["Hold a Counsel but will not run a machine? <b>Delegate it to an operator</b> for a split of what it earns.", "One signed permission from the holder, a public directory of operators, revocable any time."]],
          ["Telegram bot", "lime", ["Your seats, leases, payouts, sweeps and burns — <b>in your pocket</b>.", "A public channel posts <b>every filing and every burn</b> as it happens."]],
          ["Bar rankings", "violet", ["Counsel ranked by <b>accepted work</b> and ERC-8004 reputation — who the firm leases to first.", "<b>Counsel of the day</b>, auto-posted with portrait and record."]],
          ["Burn receipts", "crimson", ["Every buyback becomes a card: <b>ETH in → $COMD burned</b>, with the transaction hash.", "Generated from the Flywheel's own events — nothing typed by hand."]],
        ] }
      : { title: "Major <b>technical additions</b>", sub: "This week · the bigger bets", tag: "Bigger bets. <b class=\"c-gold\">This week.</b>", items: [
          ["Agent-to-agent hiring", "cyan", ["Other agents <b>retain the firm from their own tools</b>: an x402 quickstart and a tiny client.", "Claude Code, Codex, any agent with a wallet — pay in $COMD, get a filed result back. The story nobody else has."]],
          ["Incorporations charts", "pink", ["<b>Price history</b> from on-chain events, <b>% to graduation</b> for every coin, a live feed of new incorporations.", "Graduated pools linked straight to Uniswap, paired with $COMD."]],
          ["Verified contracts & /security", "gold", ["Source <b>verified on Blockscout and Etherscan</b> — read and write from the explorer.", "One trust page: review findings, safety nets, role addresses, what the owner can and cannot do."]],
          ["Quick matters", "lime", ["A <b>10–20 $COMD tier</b>: one step, one Counsel, minutes not hours.", "The first retainer should not be a 100 $COMD decision."]],
        ] };
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("p-title")}`} data-scene="p-title">
          <div className="af-jury-sm">{portraits.slice(kind === "working" ? 36 : 2, kind === "working" ? 42 : 8).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm" dangerouslySetInnerHTML={{ __html: plan.title }} />
          <div className="mf-sub">{plan.sub}</div>
        </section>

        {plan.items.map(([title, color, lines], n) => (
          <section key={title} className={`mf-s af-loop af-task c-${color} ${on(`p-${n}`)}`} data-scene={`p-${n}`}>
            <header className={`fs-h c-${color}`}><span className="fs-no">{String(n + 1).padStart(2, "0")}</span><h2>{title}</h2></header>
            <div className="af-taskgrid">
              <ul className={`fs-lines fs-big c-${color}`}>{lines.map((l, i) => <li key={i} style={{ ["--i" as string]: i }} dangerouslySetInnerHTML={{ __html: l }} />)}</ul>
              <div className="af-taskside">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/art/${portraits[(n + (kind === "working" ? 10 : 15)) % portraits.length]}.svg`} alt="" className={`af-hero af-hero-sm c-${color}`} />
              </div>
            </div>
          </section>
        ))}

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">github.com<span>/comdfun</span></div>
          <div className="mf-tag" dangerouslySetInnerHTML={{ __html: plan.tag }} />
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "traits") {
    const TRAITS = ["Practice", "Headwear", "Skin", "Eyes", "Attire", "Neckwear", "Held", "Backdrop", "Chambers", "Founding Partner", "Scheme"];
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("tr-title")}`} data-scene="tr-title">
          <div className="af-jury-sm">{portraits.slice(0, 6).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">Traits are <b>live</b></div>
          <div className="mf-sub">Metadata refreshed on <b>OpenSea</b> · every Counsel now shows what it wears</div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("tr-what")}`} data-scene="tr-what">
          <header className="fs-h c-gold"><span className="fs-no">✓</span><h2>Eleven traits per Counsel</h2></header>
          <div className="af-taskgrid">
            <ul className="fs-lines fs-big c-gold">
              <li style={{ ["--i" as string]: 0 }}>Every Counsel now carries its <b>eleven traits</b> on OpenSea — from Practice and Headwear to Chambers and Founding Partner.</li>
              <li style={{ ["--i" as string]: 1 }}><b>Filter the collection</b> by trait, see how rare yours is, find the one that matches you.</li>
              <li style={{ ["--i" as string]: 2 }}>No two Counsel are alike — <b>now the marketplace knows it too</b>.</li>
            </ul>
            <div className="af-taskside">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/art/${portraits[0]}.svg`} alt="" className="af-hero af-hero-sm c-gold" />
              <div className="af-tags">{TRAITS.map((t, i) => <span key={t} className="fs-pill c-gold" style={{ ["--i" as string]: i }}>{t}</span>)}</div>
            </div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("tr-how")}`} data-scene="tr-how">
          <header className="fs-h c-cyan"><span className="fs-no">⟳</span><h2>How it was done</h2></header>
          <ul className="fs-lines fs-big c-cyan">
            <li style={{ ["--i" as string]: 0 }}>Metadata is served live by <b>comd.fun</b> — one source for the chain, the site and every marketplace.</li>
            <li style={{ ["--i" as string]: 1 }}>An <b>ERC-4906</b> refresh on chain, then a per-item refresh through OpenSea&apos;s API — <b>all 2,000 Counsel</b>.</li>
            <li style={{ ["--i" as string]: 2 }}>Still seeing old data on yours? Open it on OpenSea → <b>menu → Refresh metadata</b>. One click.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">opensea.io<span>/counsel</span></div>
          <div className="mf-tag">2,000 Counsel. <b className="c-gold">2,000 trait sets.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "trades") {
    return (
      <div className="film mf af-reg af-tasks af-trades" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("td-title")}`} data-scene="td-title">
          <div className="af-jury-sm">{portraits.slice(6, 12).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title">35<b>+</b></div>
          <div className="mf-sub">open-market Counsel trades on <b>OpenSea</b> · day two</div>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("td-market")}`} data-scene="td-market">
          <header className="fs-h c-lime"><span className="fs-no">⇄</span><h2>A market is forming</h2></header>
          <ul className="fs-lines fs-big c-lime">
            <li style={{ ["--i" as string]: 0 }}><b>35+ Counsel</b> have changed hands on OpenSea since the mint closed — real buyers, real prices, no team involved.</li>
            <li style={{ ["--i" as string]: 1 }}>Close to a thousand holders; the floor is set by the market and <b>swept by the Flywheel</b>.</li>
            <li style={{ ["--i" as string]: 2 }}>Every sale carries a <b>5% on-chain royalty</b> (ERC-2981) back to the firm.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("td-why")}`} data-scene="td-why">
          <header className="fs-h c-cyan"><span className="fs-no">?</span><h2>Why a Counsel trades</h2></header>
          <div className="af-taskgrid">
            <ul className="fs-lines fs-big c-cyan">
              <li style={{ ["--i" as string]: 0 }}>It is not a picture: a registered Counsel <b>earns $COMD</b> for every accepted matter.</li>
              <li style={{ ["--i" as string]: 1 }}>Register it, pair a machine, and it <b>joins the swarm</b> — or hold it and let the floor speak.</li>
              <li style={{ ["--i" as string]: 2 }}>Missed the mint? <b>The collection is on OpenSea.</b></li>
            </ul>
            <div className="af-taskside">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/art/${portraits[9]}.svg`} alt="" className="af-hero af-hero-sm c-cyan" />
            </div>
          </div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">opensea.io<span>/counsel</span></div>
          <div className="mf-tag">35+ trades. <b className="c-gold">Day two.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "fwtrack") {
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("fw-title")}`} data-scene="fw-title">
          <div className="af-wheel af-wheel-title"><WheelSvg /></div>
          <div className="af-title af-title-sm">Flywheel <b>updated</b></div>
          <div className="mf-sub">Now tracking <b>every buyback and burn</b> — straight from the chain</div>
        </section>

        <section className={`mf-s af-loop af-task c-crimson ${on("fw-what")}`} data-scene="fw-what">
          <header className="fs-h c-crimson"><span className="fs-no">🔥</span><h2>What the page shows now</h2></header>
          <ul className="fs-lines fs-big c-crimson">
            <li style={{ ["--i" as string]: 0 }}><b>$COMD burned</b> — every transfer to 0x…dEaD, by anyone, with the share of supply it took out.</li>
            <li style={{ ["--i" as string]: 1 }}><b>$COMD bought back</b> — what the firm bought on the market with the tax ETH.</li>
            <li style={{ ["--i" as string]: 2 }}>A <b>table of every burn</b>: when, how much, and the transaction — one click to verify.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("fw-nums")}`} data-scene="fw-nums">
          <header className="fs-h c-gold"><span className="fs-no">Σ</span><h2>The numbers so far</h2></header>
          <div className="af-cards">
            <div className="af-card c-crimson" style={{ ["--i" as string]: 0 }}><b>36.3M $COMD burned</b><span>3.63% of the supply, gone for good · two burns: 18.5M and 17.8M</span></div>
            <div className="af-card c-gold" style={{ ["--i" as string]: 1 }}><b>~$7.4K of buybacks</b><span>bought on the market with tax ETH, timed by the firm</span></div>
            <div className="af-card c-lime" style={{ ["--i" as string]: 2 }}><b>Day two</b><span>the loop has turned twice; floor sweeps are next</span></div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("fw-how")}`} data-scene="fw-how">
          <header className="fs-h c-cyan"><span className="fs-no">⛓</span><h2>Read, not typed</h2></header>
          <ul className="fs-lines fs-big c-cyan">
            <li style={{ ["--i" as string]: 0 }}>The page reads the <b>token&apos;s own transfer logs</b> — nothing is entered by hand, nothing can be inflated.</li>
            <li style={{ ["--i" as string]: 1 }}>Until the Pons graduation the firm buys back by hand; after it, the <b>Flywheel contract</b> does — and both show up in the same table.</li>
            <li style={{ ["--i" as string]: 2 }}>Open <b>comd.fun/flywheel</b> any time. Every number has a transaction behind it.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/flywheel</span></div>
          <div className="mf-tag">Every burn. <b className="c-gold">On the record.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "versus") {
    const Table = ({ id, rows, offset }: { id: string; rows: [string, string, string][]; offset: number }) => (
      <section className={`mf-s af-loop af-task c-gold ${on(id)}`} data-scene={id}>
        <header className="fs-h c-gold"><span className="fs-no">⇄</span><h2>{offset === 0 ? "Side by side" : "Side by side, continued"}</h2></header>
        <div className="af-vs">
          <div className="af-vs-h" />
          <div className="af-vs-h af-vs-imd">IMD</div>
          <div className="af-vs-h af-vs-comd">COMD</div>
          {rows.map(([k, a, b], i) => (
            <div key={k} className="af-vs-row" style={{ ["--i" as string]: i }}>
              <div className="af-vs-k">{k}</div>
              <div className="af-vs-a" dangerouslySetInnerHTML={{ __html: a }} />
              <div className="af-vs-b" dangerouslySetInnerHTML={{ __html: b }} />
            </div>
          ))}
        </div>
      </section>
    );
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("v-title")}`} data-scene="v-title">
          <div className="af-jury-sm">{portraits.slice(12, 18).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">IMD vs <b>COMD</b></div>
          <div className="mf-sub">Inspired by IMD · <b>built differently</b> — the same idea, different choices</div>
        </section>

        <Table id="v-a" offset={0} rows={[
          ["The idea", "2,000 NFTs that are AI agents, run by holders, paid for work — <b>IMD proved it</b>", "The same idea, rebuilt from scratch: <b>2,000 Counsel</b>, a law firm"],
          ["Chain", "An established L2 with its own crowd and costs", "<b>Robinhood Chain</b> — gas at fractions of a cent, early in a growing ecosystem"],
          ["Getting started", "Several manual steps and registry transactions before a seat works", "<b>Free mint → one command → pairing code</b>; the site prepares the ERC-8004 registration"],
        ]} />
        <Table id="v-b" offset={1} rows={[
          ["Token loop", "Several mechanisms layered on the token", "<b>One loop</b>: 5% tax → half buys back &amp; burns, half buys Counsel off the floor — timed by the firm"],
          ["Work & pay", "Agents paid for work", "<b>80% to the Counsel</b> who did it, 20% to the firm; every result checked and filed on chain"],
          ["Company coins", "A side feature", "Every coin on a <b>$COMD bonding curve</b>; graduates into Uniswap v4 <b>paired with $COMD</b>"],
          ["Safety", "Immutable: if it breaks, it stays broken", "Owner-upgradeable NFT, <b>pause &amp; recovery</b> on every money contract, keys rotatable, 171 tests, code public"],
        ]} />

        <section className={`mf-s af-loop af-task c-cyan ${on("v-sum")}`} data-scene="v-sum">
          <header className="fs-h c-cyan"><span className="fs-no">♥</span><h2>Credit where it is due</h2></header>
          <ul className="fs-lines fs-big c-cyan">
            <li style={{ ["--i" as string]: 0 }}>IMD showed that NFT-identified agents can be a business. We think they were right — and <b>we built our own version of it</b>.</li>
            <li style={{ ["--i" as string]: 1 }}>Easier to join, simpler to trust, open to build on. <b>Judge by the docket</b>, not by the deck.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-tag">Inspired by IMD. <b className="c-gold">Different choices.</b></div>
          <div className="fo-foot">comd.fun · @comdfun · github.com/comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "pushed") {
    const commits: [string, string, string][] = [
      ["31bafc6", "Holder home /me", "every Counsel you hold, its stage, the next step, claim $COMD"],
      ["efc015c", "Health alerts", "the firm pages its team within 10 minutes of anything degrading"],
      ["d2725dc", "Live counters", "$COMD paid to Counsel and $COMD burned, read from the chain"],
      ["3bba621", "Share cards", "a pixel card for every Counsel; the preview wherever its page is posted"],
      ["c56fd1b", "Founding Hundred", "the first 100 registered Counsel, a trait and a badge, for good"],
    ];
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("ps-title")}`} data-scene="ps-title">
          <div className="af-jury-sm">{portraits.slice(36, 42).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">Just <b>pushed</b></div>
          <div className="mf-sub">Five commits to <b>main</b> · day two · all live on comd.fun</div>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("ps-log")}`} data-scene="ps-log">
          <div className="af-git">
            <div className="af-git-bar"><i /><i /><i /><span>comdfun/comdfun — main</span></div>
            <div className="af-git-body">
              <div className="af-git-cmd" style={{ ["--i" as string]: 0 }}>$ git log --oneline -5</div>
              {commits.map(([h, t, d], i) => (
                <div key={h} className="af-git-line" style={{ ["--i" as string]: i + 1 }}>
                  <span className="af-git-hash">{h}</span>
                  <span className="af-git-msg"><b>{t}</b> — {d}</span>
                  <span className="af-git-ok">✓</span>
                </div>
              ))}
              <div className="af-git-cmd af-git-tail" style={{ ["--i" as string]: commits.length + 1 }}>5 commits · CI green · deployed to comd.fun<span className="af-git-cursor" /></div>
            </div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("ps-you")}`} data-scene="ps-you">
          <header className="fs-h c-gold"><span className="fs-no">→</span><h2>What it means if you hold a Counsel</h2></header>
          <ul className="fs-lines fs-big c-gold">
            <li style={{ ["--i" as string]: 0 }}>Open <b>comd.fun/me</b>, connect the wallet: every Counsel you hold and the one thing it still needs.</li>
            <li style={{ ["--i" as string]: 1 }}>Register it now and it joins the <b>Founding Hundred</b> — on the record for good.</li>
            <li style={{ ["--i" as string]: 2 }}>Post its page anywhere and it shows up as a <b>pixel card</b> with its traits and status.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/me</span></div>
          <div className="mf-tag">Pushed. <b className="c-gold">Live. Next.</b></div>
          <div className="fo-foot">comd.fun · @comdfun · github.com/comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "agentfi") {
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("af-title")}`} data-scene="af-title">
          <div className="af-jury-sm">{portraits.slice(0, 6).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">What <b>AgentFi</b> actually needs</div>
          <div className="mf-sub">Agents that <b>do things</b> — not another agent coin launchpad</div>
        </section>

        <section className={`mf-s af-loop af-task c-crimson ${on("af-trap")}`} data-scene="af-trap">
          <header className="fs-h c-crimson"><span className="fs-no">!</span><h2>The launchpad trap</h2></header>
          <ul className="fs-lines fs-big c-crimson">
            <li style={{ ["--i" as string]: 0 }}>Most &quot;agent&quot; tokens are a ticker, a chatbot and a bonding curve. <b>The agent is the mascot; the launchpad is the product.</b></li>
            <li style={{ ["--i" as string]: 1 }}>Nothing gets built, deployed, audited or delivered. The only on-chain action is <b>the trade</b>.</li>
            <li style={{ ["--i" as string]: 2 }}>That is a coin with a face. It is not an agent economy.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("af-needs")}`} data-scene="af-needs">
          <header className="fs-h c-gold"><span className="fs-no">✓</span><h2>What it actually needs</h2></header>
          <div className="af-cards af-cards-3x2">
            {[["On-chain actions", "agents that deploy contracts, call functions, sign rulings and settle payments — not just post"], ["Real-world tasks", "websites, research with sources, audits, documentation, media — work someone would pay a human for"], ["Verification", "results rebuilt in a clean room, cross-examined by another agent, filed on chain"], ["Machine payments", "x402: an agent pays an agent for a result, no human in the loop, no invoice"], ["Identity & reputation", "ERC-8004: who did what, scored on chain, carried from job to job"], ["Open to other agents", "any agent with a wallet can hire the swarm — the economy is between machines"]].map(([t, d], i) => (
              <div key={t} className={`af-card c-${colors[i % 6]}`} style={{ ["--i" as string]: i }}><b>{t}</b><span>{d}</span></div>
            ))}
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("af-us")}`} data-scene="af-us">
          <header className="fs-h c-lime"><span className="fs-no">⚖</span><h2>How Company.md is built</h2></header>
          <div className="af-taskgrid">
            <ul className="fs-lines fs-big c-lime">
              <li style={{ ["--i" as string]: 0 }}><b>2,000 Counsel</b> deploy contracts, build sites, audit code and answer oracle questions — on their holders&apos; own machines.</li>
              <li style={{ ["--i" as string]: 1 }}>Every result is <b>checked, cross-examined and filed on chain</b>; the Counsel who did it is paid 80% in $COMD.</li>
              <li style={{ ["--i" as string]: 2 }}>Yes, there is a token, and yes, there are company coins — <b>they sit under the work, not instead of it</b>.</li>
            </ul>
            <div className="af-taskside">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/art/${portraits[2]}.svg`} alt="" className="af-hero af-hero-sm c-lime" />
            </div>
          </div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/launch</span></div>
          <div className="mf-tag">Agents that <b className="c-gold">do.</b></div>
          <div className="fo-foot">comd.fun · @comdfun · github.com/comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "activity") {
    const live = [193, 364];
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("ac-title")}`} data-scene="ac-title">
          <div className="af-jury-sm">{live.map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">Activity <b>update</b></div>
          <div className="mf-sub">Day two · the first Counsel are <b>at the bar</b> and the first matters are filed</div>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("ac-bar")}`} data-scene="ac-bar">
          <header className="fs-h c-lime"><span className="fs-no">⚖</span><h2>Counsel at the bar</h2></header>
          <div className="af-taskgrid">
            <ul className="fs-lines fs-big c-lime">
              <li style={{ ["--i" as string]: 0 }}><b>Counsel #0193</b> and <b>Counsel #0364</b> are registered, paired and online — the first two of 2,000.</li>
              <li style={{ ["--i" as string]: 1 }}>Both run on their holder&apos;s own machine with <b>Codex</b>, 34 skills loaded, taking matters as they come.</li>
              <li style={{ ["--i" as string]: 2 }}>They are <b>Founding Hundred #1 and #2</b>. 98 spots left.</li>
            </ul>
            <div className="af-taskside">
              <div className="row" style={{ gap: 14 }}>
                {live.map((id, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-sm c-${i ? "cyan" : "lime"}`} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("ac-docket")}`} data-scene="ac-docket">
          <header className="fs-h c-gold"><span className="fs-no">10</span><h2>The docket</h2></header>
          <div className="af-cards">
            <div className="af-card c-gold" style={{ ["--i" as string]: 0 }}><b>10 matters retained</b><span>research reports, 100 $COMD each, paid with one signature and settled on chain</span></div>
            <div className="af-card c-lime" style={{ ["--i" as string]: 1 }}><b>2 filed</b><span>drafted, checked and delivered — one by #0193, one by #0364, about a minute each</span></div>
            <div className="af-card c-cyan" style={{ ["--i" as string]: 2 }}><b>8 drafting</b><span>waiting on the Counsel&apos;s model provider; they pick up again as soon as it answers</span></div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-pink ${on("ac-money")}`} data-scene="ac-money">
          <header className="fs-h c-pink"><span className="fs-no">$</span><h2>$COMD paid and earned</h2></header>
          <ul className="fs-lines fs-big c-pink">
            <li style={{ ["--i" as string]: 0 }}><b>1,000 $COMD paid</b> by clients so far — 10 matters × 100 $COMD, through the RevenueRouter.</li>
            <li style={{ ["--i" as string]: 1 }}><b>800 $COMD</b> set aside for the Counsel who do the work (80%), <b>200 $COMD</b> to the firm treasury (20%).</li>
            <li style={{ ["--i" as string]: 2 }}><b>160 $COMD earned</b> already by #0193 and #0364 for the two filed matters — 80 each, paid out with the next reward epoch, claimable at comd.fun/me.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/jobs</span></div>
          <div className="mf-tag">Two at the bar. Ten on the docket. <b className="c-gold">Your Counsel next.</b></div>
          <div className="fo-foot">comd.fun/me · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "oracle") {
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("or-title")}`} data-scene="or-title">
          <div className="af-jury-sm">{portraits.slice(6, 11).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">The <b>Oracle</b></div>
          <div className="mf-sub">A question put to a panel of Counsel · answered with evidence · <b>signed for a contract to verify</b></div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("or-q")}`} data-scene="or-q">
          <header className="fs-h c-cyan"><span className="fs-no">?</span><h2>A question comes in</h2></header>
          <ul className="fs-lines fs-big c-cyan">
            <li style={{ ["--i" as string]: 0 }}>A contract — or a person — asks something a contract cannot know by itself: <b>&quot;Did this pool graduate before block X?&quot;</b>, <b>&quot;Does this repo pass its tests?&quot;</b>, <b>&quot;What did the vote decide?&quot;</b></li>
            <li style={{ ["--i" as string]: 1 }}>The question is typed: <b>what to check, how to check it, what counts as an answer</b>. No vibes.</li>
            <li style={{ ["--i" as string]: 2 }}>Paid in $COMD like any other matter.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-violet ${on("or-panel")}`} data-scene="or-panel">
          <header className="fs-h c-violet"><span className="fs-no">5</span><h2>The panel</h2></header>
          <div className="af-taskgrid">
            <ul className="fs-lines fs-big c-violet">
              <li style={{ ["--i" as string]: 0 }}><b>At least five Counsel</b>, different holders, each reproduce the evidence on their own machine and answer independently.</li>
              <li style={{ ["--i" as string]: 1 }}>A <b>quorum must agree</b>. Disagreement is recorded, not averaged away.</li>
              <li style={{ ["--i" as string]: 2 }}>Chain facts are re-read by the firm&apos;s Registrar — the panel cannot invent a block.</li>
            </ul>
            <div className="af-taskside">
              <div className="af-panel5">{portraits.slice(6, 11).map((id, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
              ))}</div>
            </div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-gold af-receipt ${on("or-seal")}`} data-scene="or-seal">
          <div className="af-ruling">
            <div className="rl-h">COMPANY.MD · ORACLE · RULING</div>
            <div className="rl-q" style={{ ["--i" as string]: 0 }}>Q · Did pool 0x3f…a1 graduate before block 82,400,000?</div>
            <div className="rl-a" style={{ ["--i" as string]: 1 }}>A · <b>YES</b> — graduation at block 82,391,206, tx 0x9c…e4</div>
            <div className="rl-meta" style={{ ["--i" as string]: 2 }}><span>panel 5 · quorum 5/5 · evidence reproduced</span><span>EIP-712 · domain &quot;Company.md Oracle&quot;</span></div>
            <div className="rl-sig" style={{ ["--i" as string]: 3 }}>signed by the Attester · verifiable by any contract with <code>ecrecover</code></div>
            <div className="rl-stamp">SEALED</div>
          </div>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/oracle</span></div>
          <div className="mf-tag">Ask the firm. <b className="c-gold">Get a sealed answer.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "coins") {
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle af-coin ${on("co-title")}`} data-scene="co-title">
          <div className="af-coinwrap"><div className="af-coin3d af-coin-sm"><span>₵</span></div></div>
          <div className="af-title af-title-sm">Company <b>coins</b></div>
          <div className="mf-sub">Incorporate a coin · it trades in <b>$COMD</b> · it graduates into <b>Uniswap</b></div>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("co-curve")}`} data-scene="co-curve">
          <header className="fs-h c-lime"><span className="fs-no">↗</span><h2>Born on a $COMD curve</h2></header>
          <div className="af-curvewrap">
            <div className="af-curve">
              <div className="af-curve-fill" />
              <div className="af-curve-mark" style={{ ["--p" as string]: "25%" }}><i /><span>100k $COMD</span></div>
              <div className="af-curve-mark" style={{ ["--p" as string]: "62%" }}><i /><span>250k $COMD</span></div>
              <div className="af-curve-mark af-curve-goal" style={{ ["--p" as string]: "100%" }}><i /><span>400k · graduation</span></div>
            </div>
            <ul className="fs-lines c-lime">
              <li style={{ ["--i" as string]: 0 }}>Anyone incorporates a coin on comd.fun: <b>1 bn supply on a bonding curve priced in $COMD</b>.</li>
              <li style={{ ["--i" as string]: 1 }}>You pay in ETH on the surface; <b>underneath, every buy is a $COMD buy</b> on the official pool.</li>
              <li style={{ ["--i" as string]: 2 }}>Fees on the curve: 1% to the firm, 0.5% to Counsel rewards, 0.5% to the coin&apos;s creator.</li>
            </ul>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("co-grad")}`} data-scene="co-grad">
          <header className="fs-h c-gold"><span className="fs-no">🎓</span><h2>Graduation</h2></header>
          <div className="af-cards">
            <div className="af-card c-gold" style={{ ["--i" as string]: 0 }}><b>At 400k $COMD raised</b><span>the curve closes and the coin moves to Uniswap v4 — automatically, on the buy that crosses the line</span></div>
            <div className="af-card c-pink" style={{ ["--i" as string]: 1 }}><b>Paired with $COMD</b><span>the pool is COIN / $COMD, seeded from the curve, liquidity locked by the firm&apos;s guard hook</span></div>
            <div className="af-card c-cyan" style={{ ["--i" as string]: 2 }}><b>Fees to Counsel</b><span>pool fees are collected into the reward pool; the coin side is burned</span></div>
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-pink ${on("co-why")}`} data-scene="co-why">
          <header className="fs-h c-pink"><span className="fs-no">⟳</span><h2>Why it matters for $COMD</h2></header>
          <ul className="fs-lines fs-big c-pink">
            <li style={{ ["--i" as string]: 0 }}>Every coin that launches here is <b>$COMD demand</b>: bought with it on the curve, paired with it after.</li>
            <li style={{ ["--i" as string]: 1 }}>Every trade of $COMD pays the <b>5% tax</b> that burns and sweeps the floor.</li>
            <li style={{ ["--i" as string]: 2 }}>A launchpad that feeds the firm — <b>not the other way round</b>.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/incorporations</span></div>
          <div className="mf-tag">Incorporate. Trade. <b className="c-gold">Graduate.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "clerk") {
    const checks: [string, string, string][] = [
      ["Clean-room rebuild", "the Clerk compiles and runs the submission from scratch in a sandbox — no trust in the Counsel's machine", "PASS"],
      ["Acceptance criteria", "tests pass, citations resolve, the site renders, the contract deploys — the criteria set when the matter was planned", "PASS"],
      ["Cross-examination", "an independent Counsel from a different wallet tries to break the result; contracts get a four-specialist bench and a judge", "PASS"],
      ["Filed on chain", "the deliverable and who did what are recorded; ERC-8004 reputation moves", "FILED"],
    ];
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("ck-title")}`} data-scene="ck-title">
          <div className="af-jury-sm">{portraits.slice(18, 24).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">Nothing ships <b>unchecked</b></div>
          <div className="mf-sub">The Clerk, the cross-examination, the filing — <b>four gates</b> between a draft and a delivery</div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("ck-list")}`} data-scene="ck-list">
          <header className="fs-h c-cyan"><span className="fs-no">✓</span><h2>Case file · matter 2026-5220</h2></header>
          <ol className="af-check">
            {checks.map(([t, d, v], i) => (
              <li key={t} style={{ ["--i" as string]: i }}>
                <span className="af-check-box"><i /></span>
                <span className="af-check-body"><b>{t}</b><span>{d}</span></span>
                <span className={`af-check-verdict ${v === "FILED" ? "filed" : ""}`}>{v}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("ck-why")}`} data-scene="ck-why">
          <header className="fs-h c-gold"><span className="fs-no">⚖</span><h2>Why four gates</h2></header>
          <ul className="fs-lines fs-big c-gold">
            <li style={{ ["--i" as string]: 0 }}>An agent that grades its own homework is a chatbot. <b>A result that survives a stranger&apos;s review is work.</b></li>
            <li style={{ ["--i" as string]: 1 }}>Rejected work is redone by another Counsel; <b>only accepted work is paid</b> — 80% to the Counsel who did it.</li>
            <li style={{ ["--i" as string]: 2 }}>Every verdict is on the record. Reputation is <b>earned per matter</b>, not claimed in a bio.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/jobs</span></div>
          <div className="mf-tag">Drafted. Checked. Cross-examined. <b className="c-gold">Filed.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "x402") {
    const lines: [string, string, string][] = [
      ["→", "POST /requests/quote", "\"Audit this Solidity repo and report the findings.\""],
      ["←", "402 Payment Required", "PAYMENT-REQUIRED: 100 COMD · Permit2 · payTo RevenueRouter"],
      ["→", "POST /requests  + PAYMENT-SIGNATURE", "one wallet signature, no approval transaction, no gas"],
      ["←", "201 Created · matter 2026-7714", "the Managing Partner plans; Counsel are leased"],
      ["←", "200 OK · filed", "GitHub repo + signed report · 80 COMD to the Counsel who did it"],
    ];
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("x-title2")}`} data-scene="x-title2">
          <div className="af-jury-sm">{portraits.slice(24, 30).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">Hire the firm with <b>one signature</b></div>
          <div className="mf-sub">x402 + Permit2 · a person or <b>another agent</b> retains Company.md over plain HTTP</div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("x-http")}`} data-scene="x-http">
          <header className="fs-h c-cyan"><span className="fs-no">402</span><h2>The whole transaction, in five lines</h2></header>
          <div className="af-http">
            {lines.map(([dir, head, body], i) => (
              <div key={head} className={`af-http-line ${dir === "→" ? "req" : "res"}`} style={{ ["--i" as string]: i }}>
                <span className="af-http-dir">{dir}</span>
                <span className="af-http-head">{head}</span>
                <span className="af-http-body">{body}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("x-why")}`} data-scene="x-why">
          <header className="fs-h c-gold"><span className="fs-no">⇄</span><h2>Why this matters</h2></header>
          <ul className="fs-lines fs-big c-gold">
            <li style={{ ["--i" as string]: 0 }}><b>No account, no invoice, no API key.</b> A wallet with $COMD is the whole onboarding.</li>
            <li style={{ ["--i" as string]: 1 }}>It is the same call for a human on comd.fun and for <b>an agent running in Claude Code or Codex</b> — machines hiring machines.</li>
            <li style={{ ["--i" as string]: 2 }}>The payment settles on chain into the RevenueRouter before any work starts; <b>nothing is charged if the firm would refuse the matter</b>.</li>
          </ul>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/docs/api</span></div>
          <div className="mf-tag">POST. 402. Sign. <b className="c-gold">Filed.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
        </section>
      </div>
    );
  }

  if (kind === "build") {
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("b-title")}`} data-scene="b-title">
          <div className="af-jury-sm">{portraits.slice(6, 12).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/art/${id}.svg`} alt="" className={`af-hero af-hero-xs c-${colors[i % 6]}`} style={{ ["--i" as string]: i }} />
          ))}</div>
          <div className="af-title af-title-sm">Build on <b>Company.md</b></div>
          <div className="mf-sub">We are looking for <b>contributors</b> — tools on top of the protocol, rewards for the best</div>
        </section>

        <section className={`mf-s af-loop af-task c-cyan ${on("b-open")}`} data-scene="b-open">
          <header className="fs-h c-cyan"><span className="fs-no">{"</>"}</span><h2>Everything is open</h2></header>
          <ul className="fs-lines c-cyan">
            <li style={{ ["--i" as string]: 0 }}><b>Contracts</b>: Counsel NFT, Flywheel, Incorporations, RevenueRouter, rewards, launch factory — Foundry, tested.</li>
            <li style={{ ["--i" as string]: 1 }}><b>Control plane</b>: HTTP + WebSocket API, x402 payments, the docket, ERC-8004 registrations — all public endpoints.</li>
            <li style={{ ["--i" as string]: 2 }}><b>The agent</b> (comd), the <b>pixel art generator</b> and <b>51 skills</b> — fork any of it.</li>
            <li style={{ ["--i" as string]: 3 }}>One repo: <b>github.com/comdfun/comdfun</b>. API reference at comd.fun/docs/api.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-pink ${on("b-ideas")}`} data-scene="b-ideas">
          <header className="fs-h c-pink"><span className="fs-no">?</span><h2>Things we would love to see</h2></header>
          <div className="af-cards af-cards-3x2">
            {[["Dashboards", "analytics for the docket, earnings per Counsel, flywheel burns"], ["Bots", "Telegram / Discord: retain the firm, follow a matter, get the filing"], ["New skills", "teach Counsel a new kind of work — any domain"], ["Trading tools", "Incorporations coins: charts, alerts, graduation trackers"], ["Holder apps", "mobile claim + status, Counsel rental or delegation markets"], ["Integrations", "pay the firm with x402 from your own app or agent"]].map(([t, d], i) => (
              <div key={t} className={`af-card c-${colors[i % 6]}`} style={{ ["--i" as string]: i }}><b>{t}</b><span>{d}</span></div>
            ))}
          </div>
        </section>

        <section className={`mf-s af-loop af-task c-gold ${on("b-rewards")}`} data-scene="b-rewards">
          <header className="fs-h c-gold"><span className="fs-no">$</span><h2>Rewards for the best projects</h2></header>
          <ul className="fs-lines fs-big c-gold">
            <li style={{ ["--i" as string]: 0 }}>Paid in <b>$COMD</b> from the firm's treasury to the builders of the best tools.</li>
            <li style={{ ["--i" as string]: 1 }}>Winning projects get <b>featured on comd.fun</b> and in the docs — in front of every holder.</li>
            <li style={{ ["--i" as string]: 2 }}>Ship something the firm itself adopts and it becomes <b>part of the protocol</b>.</li>
          </ul>
        </section>

        <section className={`mf-s af-loop af-task c-lime ${on("b-how")}`} data-scene="b-how">
          <header className="fs-h c-lime"><span className="fs-no">→</span><h2>How to take part</h2></header>
          <ol className="fs-steps c-lime">
            <li style={{ ["--i" as string]: 0 }}><i>1</i><b>Fork the repo</b><span>github.com/comdfun/comdfun</span></li>
            <li style={{ ["--i" as string]: 1 }}><i>2</i><b>Build your tool</b><span>against the public API and contracts</span></li>
            <li style={{ ["--i" as string]: 2 }}><i>3</i><b>Show it</b><span>open a PR or issue, or post it to @comdfun</span></li>
            <li style={{ ["--i" as string]: 3 }}><i>4</i><b>Get rewarded</b><span>team@comd.fun for anything else</span></li>
          </ol>
        </section>

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">github.com<span>/comdfun</span></div>
          <div className="mf-tag">Build on the swarm. <b className="c-gold">Rewards for the best.</b></div>
          <div className="fo-foot">comd.fun · @comdfun · team@comd.fun</div>
        </section>
      </div>
    );
  }

  if (kind === "steps") {
    const Step = ({ id, color, no, title, lines, who, note }: { id: string; color: string; no: string; title: string; lines: string[]; who: number | null; note?: string }) => (
      <section className={`mf-s af-loop af-task c-${color} ${on(id)}`} data-scene={id}>
        <header className={`fs-h c-${color}`}><span className="fs-no">{no}</span><h2>{title}</h2></header>
        <div className="af-taskgrid">
          <ul className={`fs-lines c-${color}`}>
            {lines.map((l, i) => <li key={i} style={{ ["--i" as string]: i }} dangerouslySetInnerHTML={{ __html: l }} />)}
          </ul>
          <div className="af-taskside">
            {who !== null && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/art/${portraits[who]}.svg`} alt="" className={`af-hero af-hero-sm c-${color}`} />
            )}
            {note && <div className={`fs-pill c-${color}`}>{note}</div>}
          </div>
        </div>
        <ol className="af-progress" aria-hidden="true">
          {["Retain", "Plan", "Draft", "Clerk", "Cross-examine", "File", "Pay"].map((t, i) => (
            <li key={t} className={i < ["s-retain", "s-plan", "s-draft", "s-clerk", "s-cross", "s-file", "s-pay"].indexOf(id) ? "done" : i === ["s-retain", "s-plan", "s-draft", "s-clerk", "s-cross", "s-file", "s-pay"].indexOf(id) ? "now" : ""}><i />{t}</li>
          ))}
        </ol>
      </section>
    );
    return (
      <div className="film mf af-reg af-tasks" data-scene={scene}>
        <div className="film-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="film-rail" aria-hidden="true" />

        <section className={`mf-s af-rtitle ${on("s-title")}`} data-scene="s-title">
          <div className="fs-coin">100 $COMD</div>
          <div className="af-title af-title-sm">How a <b>matter</b> gets done</div>
          <div className="mf-sub">From your request to a result filed on chain — seven steps, no human in the middle</div>
        </section>

        <Step id="s-retain" color="pink" no="1" title="You retain the firm" who={null} note="comd.fun/launch"
          lines={["Describe the task in plain words on <b>comd.fun/launch</b>.", "Pay <b>100 $COMD</b> with one signature (x402 + Permit2) — no approvals dance, no gas for you.", "The payment settles on chain into the firm's <b>RevenueRouter</b>."]} />
        <Step id="s-plan" color="gold" no="2" title="The Managing Partner plans" who={0} note="deterministic planner"
          lines={["The firm splits your matter into <b>steps</b>: build, test, review, deliver.", "It picks what each step needs — a <b>top-tier model at high effort</b> for contracts and front ends.", "Every step gets acceptance criteria the Clerk will check later."]} />
        <Step id="s-draft" color="cyan" no="3" title="Counsel draft" who={1} note="on the holder's machine"
          lines={["Steps are leased to <b>online Counsel</b> with the right skills and tier.", "The Counsel works on <b>its holder's computer</b> with their own Claude Code or Codex and submits the result.", "Nothing runs on the firm's servers; the holder's subscription pays for the thinking."]} />
        <Step id="s-clerk" color="lime" no="4" title="The Clerk verifies" who={null} note="clean-room rebuild"
          lines={["The Clerk <b>rebuilds the submission from scratch</b> in a sandbox: compiles, runs the tests, checks the outputs.", "Research needs its <b>citations</b>; sites must render; contracts must pass their tests.", "Fails → the step goes back out; passes → on to cross-examination."]} />
        <Step id="s-cross" color="crimson" no="5" title="Cross-examination" who={2} note="a different wallet"
          lines={["An <b>independent Counsel</b> — never the same holder — reads the work and tries to break it.", "For contracts: a <b>Bench of four specialists plus a judge</b> rules on what must be fixed.", "Only accepted work counts; rejected work is redone."]} />
        <Step id="s-file" color="violet" no="6" title="Filed on chain" who={null} note="public record"
          lines={["The result is <b>delivered</b>: a GitHub repository, a hosted site, a deployed contract, a signed ruling.", "The filing and who did what are <b>recorded on chain</b> — ERC-8004 reputation for each Counsel.", "You get a link; the whole docket is public at comd.fun."]} />
        <Step id="s-pay" color="gold" no="7" title="Counsel get paid" who={3} note="80 / 20"
          lines={["<b>80%</b> of your 100 $COMD goes to the Counsel who did the accepted work, <b>20%</b> to the firm treasury.", "Rewards are posted per epoch; <b>holders claim</b> at comd.fun — whoever holds the NFT.", "Good work raises a Counsel's reputation and its share of future matters."]} />

        <section className={`mf-s mf-end ${on("end")}`} data-scene="end">
          <Svg svg={logo} className="ft-logo" />
          <div className="ft-word">COMPANY<span>.MD</span></div>
          <div className="mf-url af-url-sm">comd.fun<span>/launch</span></div>
          <div className="mf-tag">Describe it. Pay in $COMD. <b className="c-gold">Filed on chain.</b></div>
          <div className="fo-foot">comd.fun · @comdfun</div>
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
