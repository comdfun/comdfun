"use client";
// Two short announcements sharing the "Mint live" visual language: "minted" (the 2,000 Counsel are all minted) and
// "comd" ($COMD is live on Pons). Same frame-exact seeking contract as Film.tsx (window.__filmSeek).
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Svg } from "../Svg";
import { WheelSvg } from "../Flywheel";

type Scene = { id: string; at: number };
export type AnnounceKind = "minted" | "comd" | "register";
const SCENES: Record<AnnounceKind, Scene[]> = {
  minted: [{ id: "count", at: 0 }, { id: "stamp", at: 5_200 }, { id: "next", at: 9_600 }, { id: "end", at: 14_200 }],
  comd: [{ id: "coin", at: 0 }, { id: "loop", at: 5_000 }, { id: "use", at: 10_600 }, { id: "end", at: 15_400 }],
  register: [
    { id: "r-title", at: 0 }, { id: "r-what", at: 4_500 }, { id: "r-install", at: 12_000 }, { id: "r-pair", at: 20_000 },
    { id: "r-register", at: 28_000 }, { id: "r-online", at: 35_500 }, { id: "r-need", at: 43_000 }, { id: "end", at: 50_500 },
  ],
};
export const ANNOUNCE_LENGTH: Record<AnnounceKind, number> = { minted: 17_500, comd: 19_000, register: 55_000 };

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
