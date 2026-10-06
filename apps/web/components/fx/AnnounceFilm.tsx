"use client";
// Two short announcements sharing the "Mint live" visual language: "minted" (the 2,000 Counsel are all minted) and
// "comd" ($COMD is live on Pons). Same frame-exact seeking contract as Film.tsx (window.__filmSeek).
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Svg } from "../Svg";
import { WheelSvg } from "../Flywheel";

type Scene = { id: string; at: number };
export type AnnounceKind = "minted" | "comd" | "register" | "tasks" | "steps" | "build";
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
  build: [
    { id: "b-title", at: 0 }, { id: "b-open", at: 4_500 }, { id: "b-ideas", at: 12_000 }, { id: "b-rewards", at: 21_000 }, { id: "b-how", at: 28_000 }, { id: "end", at: 34_500 },
  ],
  steps: [
    { id: "s-title", at: 0 }, { id: "s-retain", at: 4_000 }, { id: "s-plan", at: 10_500 }, { id: "s-draft", at: 17_000 },
    { id: "s-clerk", at: 24_000 }, { id: "s-cross", at: 31_000 }, { id: "s-file", at: 38_000 }, { id: "s-pay", at: 45_000 }, { id: "end", at: 52_000 },
  ],
};
export const ANNOUNCE_LENGTH: Record<AnnounceKind, number> = { minted: 17_500, comd: 19_000, register: 55_000, tasks: 50_000, steps: 56_500, build: 39_000 };

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
