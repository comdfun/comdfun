"use client";
// The cICM films, on one clock.
//
// The older films switch scenes by toggling which one is displayed, so the outgoing scene vanishes in a single
// frame and nothing can ever crossfade. Here every scene is mounted for the whole film and both its entrance and
// its exit are CSS animations placed at absolute times (`--t0`, `--t1`). Neighbouring scenes overlap by half a
// second, so one dissolves into the next. Every element inside a scene times itself from that scene's `--t0`.
//
// Because everything is a CSS animation on one timeline, a frame is a pure function of T: `__filmSeek(T)` pauses
// every animation and sets its current time to T, which is all scripts/film.mjs needs to render frame-exactly.
// Nothing here uses transitions, counters or timers, because none of those can be seeked.
import { Fragment, useEffect, type CSSProperties, type ReactNode } from "react";
import { Svg } from "../Svg";

import { PRO_LENGTH, type ProKind } from "./proKinds";
export type { ProKind };

const v = (o: Record<string, string | number>) => o as CSSProperties;
const ms = (n: number) => `${n}ms`;

/** A scene: mounted throughout, visible from t0 to t1, with a slow push-in while it is on. */
function Scene({ t0, t1, last, children }: { t0: number; t1: number; last?: boolean; children: ReactNode }) {
  return (
    <section className={last ? "pv-s pv-last" : "pv-s"} style={v({ "--t0": ms(t0), "--t1": ms(t1), "--dur": ms(t1 - t0) })}>
      <div className="pv-cam">{children}</div>
    </section>
  );
}

/** Words that rise one after another. Each word is its own box, so nothing is ever masked or clipped. */
function W({ text, d = 0, step = 75 }: { text: string; d?: number; step?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          <span className="pv-w" style={v({ "--d": ms(d + i * step) })}>{w}</span>
        </Fragment>
      ))}
    </>
  );
}

/** Punctuation after a highlight. Left as bare text it would show before the words it ends. */
function Dot({ d, ch = "." }: { d: number; ch?: string }) {
  return <span className="pv-w" style={v({ "--d": ms(d) })}>{ch}</span>;
}

/** A highlight that sweeps in behind its words. Sized as an inline block around the glyphs, not the line box. */
function HL({ children, d, c = "var(--gold)" }: { children: ReactNode; d: number; c?: string }) {
  return <span className="pv-hl" style={v({ "--hd": ms(d), "--hc": c })}>{children}</span>;
}

/** Text typed out one character at a time. Monospace only: the width steps in `ch`. */
function Type({ text, d, per = 65, caret }: { text: string; d: number; per?: number; caret?: boolean }) {
  return (
    <>
      <span className="pv-type" style={v({ "--n": text.length, "--d": ms(d), "--du": ms(text.length * per) })}>{text}</span>
      {caret && <span className="pv-caret" style={v({ "--d": ms(d) })} />}
    </>
  );
}

/** One value replaced by another in place. */
function Swap({ a, b, d }: { a: ReactNode; b: ReactNode; d: number }) {
  return (
    <span className="pv-swap" style={v({ "--d": ms(d) })}>
      <span className="pv-sa">{a}</span>
      <span className="pv-sb">{b}</span>
    </span>
  );
}

/** The scene head: an eyebrow and a headline, at the same place in every scene so nothing jumps between them. */
function Head({ eyebrow, c, children }: { eyebrow: string; c: string; children: ReactNode }) {
  return (
    <header className="pv-head" style={v({ "--c": c })}>
      <div className="pv-eyebrow a-rise" style={v({ "--d": "120ms" })}><i />{eyebrow}</div>
      <h2 className="pv-h">{children}</h2>
    </header>
  );
}

export function ProFilm({ kind, logo, mode = "auto" }: { kind: ProKind; logo: string; mode?: "auto" | "manual" | "still" }) {
  useEffect(() => {
    const fit = () => document.documentElement.style.setProperty("--k", String(Math.min(innerWidth / 1920, innerHeight / 1080)));
    fit();
    addEventListener("resize", fit);
    const seek = (T: number) => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = T; }
    };
    const w = window as unknown as { __film?: unknown; __filmSeek?: (t: number) => void };
    w.__film = { length: PRO_LENGTH[kind] };
    w.__filmSeek = seek;
    if (mode === "manual") seek(0);
    if (mode === "still") seek(PRO_LENGTH[kind] * 0.18);
    return () => removeEventListener("resize", fit);
  }, [kind, mode]);

  return (
    <div className="pv" data-kind={kind}>
      <div className="pv-stage" style={v({ "--len": ms(PRO_LENGTH[kind]), "--t0": "0ms" })}>
        <div className="pv-bg" aria-hidden="true"><i /><i /><i /></div>
        <div className="pv-grid" aria-hidden="true" />
        <div className="pv-brand" aria-hidden="true"><Svg svg={logo} className="pv-brand-mark" /><span>Company<b>.md</b></span>{kind.startsWith("icm") && <em>cICM</em>}</div>
        <div className="pv-progress" aria-hidden="true"><i /></div>
        {kind === "icmx" && <Intro logo={logo} />}
        {kind === "icmeth" && <Eth logo={logo} />}
        {kind === "icmagents" && <Agents logo={logo} />}
        {kind === "icmburn" && <Burn logo={logo} />}
        {kind === "icmsettle" && <Settle logo={logo} />}
        {kind === "icmmodels" && <Models logo={logo} />}
        {kind === "icmeco" && <Eco logo={logo} />}
        {kind === "burn118" && <SupplyBurn logo={logo} />}
        {kind === "icmlive" && <LiveDesk logo={logo} />}
        {kind === "icmplay" && <Playground logo={logo} />}
        {kind === "icmquick" && <Quickstart logo={logo} />}
        {kind === "icmgithub" && <GitHub logo={logo} />}
        {kind === "inccoins" && <Coins logo={logo} />}
        {kind === "contrib" && <Contrib logo={logo} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ Introducing cICM */

const LEFT = [
  ["Claude Opus 4.1", "anthropic", "var(--orange)"],
  ["GPT-5", "openai", "var(--lime)"],
  ["Gemini 2.5 Pro", "google", "var(--cyan)"],
  ["Grok 4", "x-ai", "var(--parch)"],
  ["DeepSeek R1", "deepseek", "var(--violet)"],
] as const;
const RIGHT = [
  ["Llama 4 Maverick", "meta", "var(--pink)"],
  ["Mistral Large", "mistral", "var(--orange)"],
  ["Qwen3 235B", "qwen", "var(--violet)"],
  ["Kimi K2", "moonshot", "var(--cyan)"],
  ["Claude Sonnet 4", "anthropic", "var(--gold)"],
] as const;
const ROW_Y = [444, 534, 624, 714, 804];

function Intro({ logo }: { logo: string }) {
  return (
    <>
      {/* 01 · the endpoint types itself, then gives way to the name */}
      <Scene t0={0} t1={5200}>
        <div className="i1-url" style={v({ "--d": "2300ms" })}>
          <span className="pv-mono"><Type text="api.comd.fun/icm/v1" d={350} per={75} caret /></span>
        </div>
        <div className="pv-center i1-title">
          <h1 className="pv-h pv-xl"><W text="Introducing" d={2550} /> <span className="pv-w pv-grad" style={v({ "--d": "2700ms" })}>cICM</span></h1>
          <p className="pv-sub a-rise" style={v({ "--d": "3250ms" })}>Company Inference Capital Markets</p>
        </div>
      </Scene>

      {/* 02 · the line */}
      <Scene t0={4700} t1={10600}>
        <div className="pv-glow" style={v({ "--gc": "var(--gold)" })} />
        <div className="pv-center">
          <div className="pv-eyebrow a-rise" style={v({ "--d": "200ms", "--c": "var(--gold)" })}><i />cICM · comd.fun/icm</div>
          <h1 className="pv-h pv-lg i2-lines">
            <span className="pv-line"><W text="Every frontier model." d={350} /></span>
            <span className="pv-line"><W text="One key." d={1000} /></span>
            <span className="pv-line"><HL d={2050}><W text="Paid in $COMD" d={1450} /></HL><Dot d={1680} /></span>
          </h1>
        </div>
      </Scene>

      {/* 03 · every model into one endpoint */}
      <Scene t0={10100} t1={17000}>
        <Head eyebrow="One endpoint" c="var(--gold)"><W text="Every model," d={200} /> <span className="pv-w pv-c" style={v({ "--d": "380ms" })}>one</span> <span className="pv-w pv-c" style={v({ "--d": "455ms" })}>key.</span></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          {ROW_Y.map((y, i) => {
            const cy = y + 32;
            const l = `M 590 ${cy} C 680 ${cy}, 660 660, 750 660`;
            const r = `M 1330 ${cy} C 1240 ${cy}, 1260 660, 1170 660`;
            return (
              <g key={i}>
                <path className="a-draw" pathLength={1} d={l} style={v({ "--d": ms(1250 + i * 80) })} />
                <path className="a-draw" pathLength={1} d={r} style={v({ "--d": ms(1290 + i * 80) })} />
                <path className="a-pulse" pathLength={1} d={l} style={v({ "--d": ms(2300 + i * 260), "--pc": LEFT[i][2] })} />
                <path className="a-pulse" pathLength={1} d={r} style={v({ "--d": ms(2430 + i * 260), "--pc": RIGHT[i][2] })} />
              </g>
            );
          })}
        </svg>
        {LEFT.map(([n, h, c], i) => (
          <div key={n} className="i3-chip a-from" style={v({ left: "290px", top: `${ROW_Y[i]}px`, "--fx": "-460px", "--fy": `${(2 - i) * 40}px`, "--d": ms(380 + i * 110), "--cc": c })}>
            <i /><b>{n}</b><em>{h}</em>
          </div>
        ))}
        {RIGHT.map(([n, h, c], i) => (
          <div key={n} className="i3-chip i3-r a-from" style={v({ left: "1330px", top: `${ROW_Y[i]}px`, "--fx": "460px", "--fy": `${(2 - i) * 40}px`, "--d": ms(440 + i * 110), "--cc": c })}>
            <i /><b>{n}</b><em>{h}</em>
          </div>
        ))}
        <div className="i3-node a-pop" style={v({ "--d": "650ms" })}>
          <b>cICM</b>
          <code>api.comd.fun/icm/v1</code>
          <span>one key</span>
        </div>
        <p className="pv-cap a-rise" style={v({ "--d": "2700ms" })}>Name the model in the request. Nothing else in your code changes.</p>
      </Scene>

      {/* 04 · pay, take a key */}
      <Scene t0={16500} t1={23800}>
        <Head eyebrow="Getting started" c="var(--cyan)"><W text="Pay in $COMD." d={200} /> <span className="pv-c"><W text="Take a key." d={520} /></span></Head>
        <div className="pv-panel i4-panel a-rise" style={v({ "--d": "450ms", "--dy": "40px" })}>
          <div className="pv-panel-h"><b>Buy credit</b><span>Burns $COMD</span></div>
          <div className="pv-tabs"><i className="pv-tab-ind" /><span className="on">$COMD</span><span>ETH</span></div>
          <div className="pv-field">
            <label>You pay</label>
            <div className="pv-frow"><b className="pv-mono"><Swap a={<span className="pv-dim">0</span>} b={<Type text="250,000" d={1250} per={95} caret />} d={1100} /></b><em>COMD</em></div>
          </div>
          <div className="pv-field">
            <label>You get</label>
            <div className="pv-frow pv-get"><b className="pv-mono"><Swap a={<span className="pv-dim">0.00</span>} b="$2.50" d={2250} /></b><em>credit</em></div>
          </div>
          <div className="pv-btn pv-press" style={v({ "--d": "2950ms" })}><Swap a="Buy credit" b={<>Credit added <Tick /></>} d={3150} /></div>
        </div>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          <path className="a-draw pv-dash" pathLength={1} d="M 940 820 C 1010 820, 1010 600, 1080 600" style={v({ "--d": "3350ms", "--lc": "var(--cyan)" })} />
        </svg>
        <div className="i4-key a-from" style={v({ "--d": "3550ms", "--fx": "60px", "--fy": "0px" })}>
          <span className="pv-k">Your API key</span>
          <code className="pv-mono"><Type text="cicm_live_9f2a…7c1d" d={3950} per={45} /></code>
          <p>Shown once. Only a hash of it is kept.</p>
          <div className="i4-keyfoot"><span><Tick /> No card</span><span><Tick /> No subscription</span></div>
        </div>
      </Scene>

      {/* 05 · same code, any model */}
      <Scene t0={23300} t1={29800}>
        <Head eyebrow="Same code, any model" c="var(--violet)"><W text="Point any client at it." d={200} /></Head>
        <div className="pv-term a-rise" style={v({ "--d": "450ms", "--dy": "40px" })}>
          <div className="pv-term-bar"><i /><i /><i /><span>terminal</span></div>
          <pre className="pv-mono">
            <span className="pv-tl a-fade" style={v({ "--d": "650ms" })}><u>$</u> curl https://api.comd.fun/icm/v1/chat/completions \</span>
            <span className="pv-tl a-fade" style={v({ "--d": "800ms" })}>    -H <s>&quot;Authorization: Bearer cicm_live_9f2a…&quot;</s> \</span>
            <span className="pv-tl a-fade" style={v({ "--d": "950ms" })}>    -d <s>&apos;&#123; &quot;messages&quot;: [ … ],</s></span>
            <span className="pv-tl a-fade" style={v({ "--d": "1100ms" })}>{"          "}<s>&quot;model&quot;: </s><span className="i5-slot"><span className="i5-roll"><s>&quot;anthropic/claude-opus-4.1&quot; &#125;&apos;</s><s>&quot;openai/gpt-5&quot; &#125;&apos;</s><s>&quot;google/gemini-2.5-pro&quot; &#125;&apos;</s></span></span></span>
          </pre>
        </div>
        <div className="i5-answers">
          {[["Claude Opus 4.1", "var(--orange)", 1750], ["GPT-5", "var(--lime)", 3150], ["Gemini 2.5 Pro", "var(--cyan)", 4500]].map(([n, c, d]) => (
            <div key={n as string} className="i5-ans" style={v({ "--cc": c as string, "--d": ms(d as number) })}>
              <i /><b>{n}</b><span className="pv-mono">200 OK</span>
            </div>
          ))}
        </div>
      </Scene>

      {/* 06 · the burn */}
      <Scene t0={29300} t1={34900}>
        <Head eyebrow="And the token" c="var(--orange)"><W text="Every $COMD spent is" d={200} /> <HL d={1000} c="var(--orange)"><span className="pv-w" style={v({ "--d": "560ms" })}>burned</span></HL><Dot d={640} /></Head>
        <div className="i6-bar a-rise" style={v({ "--d": "500ms" })}>
          <div className="i6-cap"><span>$COMD supply</span><b>burned on the way in</b></div>
          <div className="i6-track">
            <div className="i6-fill" style={v({ "--d": "1000ms" })}>
              <div className="i6-embers">{Array.from({ length: 14 }, (_, i) => <i key={i} style={v({ "--e": i, top: `${8 + (i * 37) % 84}%` })} />)}</div>
            </div>
          </div>
        </div>
        <div className="pv-tiles">
          {[["Burned", "on the way in, every time"], ["Down only", "supply spent here never comes back"], ["Real demand", "anyone who needs a model needs $COMD"]].map(([b, s], i) => (
            <div key={b} className="pv-tile a-rise" style={v({ "--d": ms(1700 + i * 160) })}><b>{b}</b><span>{s}</span></div>
          ))}
        </div>
      </Scene>

      {/* 07 · out */}
      <Scene t0={34400} t1={38000} last>
        <Outro logo={logo} a="A swarm that works." b="A desk that sells the models." />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ Paying in ETH */

const CHAINS = [["Ethereum", "var(--violet)"], ["Base", "var(--cyan)"], ["Arbitrum", "var(--parch)"], ["Optimism", "var(--pink)"]] as const;
const CHAIN_Y = [470, 560, 650, 740];
const ROUTE = [
  { x: 360, c: "var(--cyan)", k: "You hold", b: "ETH", s: "already in your wallet" },
  { x: 760, c: "var(--pink)", k: "Routed through", b: "The pool", s: "at the market price" },
  { x: 1160, c: "var(--orange)", k: "Arrives as", b: "$COMD", s: "and is burned on the way in" },
  { x: 1560, c: "var(--lime)", k: "You get", b: "Credit", s: "on the wallet that signed" },
];

function Eth({ logo }: { logo: string }) {
  return (
    <>
      {/* 01 · the objection, answered */}
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--cyan)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg e1-lines">
            <span className="pv-line"><W text="Don't hold $COMD?" d={300} /></span>
            <span className="pv-line"><W text="Buy inference" d={950} /> <HL d={1700} c="var(--cyan)"><span className="pv-w" style={v({ "--d": "1100ms" })}>anyway</span></HL><Dot d={1180} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2300ms" })}>Pay in ETH. The swap happens on the way in.</p>
        </div>
      </Scene>

      {/* 02 · from any chain */}
      <Scene t0={4500} t1={10500}>
        <Head eyebrow="From anywhere" c="var(--cyan)"><W text="Bring ETH" d={200} /> <span className="pv-c"><W text="from any chain." d={380} /></span></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          {CHAIN_Y.map((y, i) => {
            const p = `M 600 ${y + 32} C 700 ${y + 32}, 720 640, 820 640`;
            return (
              <g key={i}>
                <path className="a-draw" pathLength={1} d={p} style={v({ "--d": ms(1000 + i * 90) })} />
                <path className="a-pulse" pathLength={1} d={p} style={v({ "--d": ms(1900 + i * 300), "--pc": CHAINS[i][1] })} />
              </g>
            );
          })}
          <path className="a-draw" pathLength={1} d="M 1140 640 L 1290 640" style={v({ "--d": "1800ms" })} />
          <path className="a-pulse" pathLength={1} d="M 1140 640 L 1290 640" style={v({ "--d": "2600ms", "--pc": "var(--cyan)" })} />
        </svg>
        {CHAINS.map(([n, c], i) => (
          <div key={n} className="e2-chain a-from" style={v({ top: `${CHAIN_Y[i]}px`, "--fx": "-380px", "--fy": "0px", "--d": ms(350 + i * 110), "--cc": c })}><i />{n}</div>
        ))}
        <div className="e2-hub a-pop" style={v({ "--d": "700ms" })}>
          <b>Robinhood Chain</b>
          <span className="pv-mono">Relay · Across · canonical bridge</span>
        </div>
        <div className="e2-wallet a-from" style={v({ "--d": "2000ms", "--fx": "60px", "--fy": "0px" })}>
          <span className="pv-k">Your wallet</span>
          <div className="e2-row e2-eth"><span><i />ETH</span><b className="pv-mono"><Swap a="0.00" b="0.42" d={2850} /></b></div>
          <div className="e2-row"><span><i className="e2-dim" />$COMD</span><b className="pv-mono pv-dim">0</b></div>
          <em className="e2-tag a-pop" style={v({ "--d": "3450ms" })}>not needed</em>
        </div>
      </Scene>

      {/* 03 · press buy, sign once */}
      <Scene t0={10000} t1={17800}>
        <Head eyebrow="On comd.fun/icm" c="var(--gold)"><W text="Pick ETH." d={200} /> <span className="pv-c"><W text="Press buy." d={420} /></span></Head>
        <div className="e3-shift" style={v({ "--d": "5100ms" })}>
        <div className="pv-panel e3-panel a-rise" style={v({ "--d": "400ms", "--dy": "40px" })}>
          <div className="pv-panel-h"><b>Buy credit</b><span>Burns $COMD</span></div>
          <div className="pv-tabs"><i className="pv-tab-ind e3-slide" style={v({ "--d": "1050ms" })} /><span className="e3-t1" style={v({ "--d": "1050ms" })}>$COMD</span><span className="e3-t2" style={v({ "--d": "1050ms" })}>ETH</span></div>
          <div className="pv-field">
            <label>You pay</label>
            <div className="pv-frow"><b className="pv-mono"><Swap a={<span className="pv-dim">0</span>} b={<Type text="0.05" d={1650} per={110} caret />} d={1500} /></b><em>ETH</em></div>
          </div>
          <div className="pv-field">
            <label>You get</label>
            <div className="pv-frow pv-get"><b className="pv-mono"><Swap a={<span className="pv-dim">0.00</span>} b={<span className="e3-quote">credit <small>at the pool price</small></span>} d={2350} /></b></div>
          </div>
          <div className="pv-btn pv-press" style={v({ "--d": "3000ms" })}><Swap a="Buy credit" b={<>Credit added <Tick /></>} d={5250} /></div>
        </div>
        </div>
        <div className="e3-wallet" style={v({ "--d": "3300ms", "--d2": "4950ms" })}>
          <div className="e3-wh"><i />Confirm transaction</div>
          <dl>
            <dt>Pay</dt><dd className="pv-mono">0.05 ETH</dd>
            <dt>To</dt><dd>cICM, through the pool</dd>
            <dt>Network</dt><dd>Robinhood Chain</dd>
          </dl>
          <div className="e3-wbtns"><span>Reject</span><span className="pv-press e3-confirm" style={v({ "--d": "4450ms" })}>Confirm</span></div>
        </div>
      </Scene>

      {/* 04 · what one transaction does */}
      <Scene t0={17300} t1={24800}>
        <Head eyebrow="Under the hood" c="var(--pink)"><W text="One transaction" d={200} /> <span className="pv-c"><W text="does the rest." d={420} /></span></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <path key={i} className="a-draw" pathLength={1} d={`M ${ROUTE[i].x + 130} 600 L ${ROUTE[i + 1].x - 130} 600`} style={v({ "--d": ms(900 + i * 220) })} />
          ))}
          <path className="a-draw e4-brace" pathLength={1} d="M 250 770 Q 250 800 280 800 L 1640 800 Q 1670 800 1670 770" style={v({ "--d": "5100ms", "--lc": "var(--lime)" })} />
        </svg>
        {ROUTE.map((r, i) => (
          <div key={r.b} className="e4-node" style={v({ left: `${r.x - 130}px`, "--cc": r.c, "--d": ms(400 + i * 230), "--hit": ms([1840, 2560, 3600, 4720][i]) })}>
            {i === 1 && <div className="e4-rings" aria-hidden="true"><i /><i /></div>}
            {i === 2 && <div className="e4-fire" aria-hidden="true">{Array.from({ length: 9 }, (_, k) => <i key={k} style={v({ "--e": k })} />)}</div>}
            <u>{r.k}</u><b>{r.b}</b><span>{r.s}</span>
            {i === 3 && <span className="e4-done" style={v({ "--d": "5000ms" })}><Tick /></span>}
          </div>
        ))}
        <div className="e4-token" style={v({ "--d": "1600ms" })} aria-hidden="true" />
        <div className="e4-pill a-pop" style={v({ "--d": "5450ms" })}>1 signature · 1 transaction</div>
      </Scene>

      {/* 05 · what it adds up to */}
      <Scene t0={24300} t1={29000}>
        <Head eyebrow="Done" c="var(--lime)"><W text="Credit on the wallet" d={200} /> <span className="pv-c"><W text="that signed." d={480} /></span></Head>
        <div className="pv-tiles e5-tiles">
          {[["1", "press on the page"], ["1", "signature in your wallet"], ["0", "tokens to go and find first"]].map(([b, s], i) => (
            <div key={s} className={i === 2 ? "pv-tile pv-big pv-hot a-rise" : "pv-tile pv-big a-rise"} style={v({ "--d": ms(600 + i * 180) })}><b>{b}</b><span>{s}</span></div>
          ))}
        </div>
        <p className="pv-cap e5-cap a-rise" style={v({ "--d": "1500ms" })}>And the $COMD the swap bought is burned on the way in.</p>
      </Scene>

      {/* 06 · out */}
      <Scene t0={28500} t1={32000} last>
        <Outro logo={logo} a="Bring ETH." b="Leave with inference." />
      </Scene>
    </>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════════════ Built for agents */

const KEYS = [
  ["research-bot", "cicm_live_3a9f…e21c", "ceiling $5"],
  ["support-agent", "cicm_live_b71d…0f4a", "ceiling $20"],
  ["counsel #1776", "cicm_live_c0de…9b2e", "ceiling $10"],
  ["my laptop", "cicm_live_77e1…a5d0", "no ceiling"],
] as const;
const KEY_Y = [372, 482, 592, 702];
const AGENT_LOG = [
  ["planning the task", "claude-opus-4.1", "200"],
  ["searching sources", "gemini-2.5-flash", "200"],
  ["drafting part one", "gpt-5", "200"],
  ["checking the draft", "claude-sonnet-4", "200"],
  ["drafting part two", "gpt-5", "200"],
  ["final review", "claude-opus-4.1", "402"],
] as const;

function Agents({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--cyan)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="Humans buy it." d={300} /></span>
            <span className="pv-line"><span className="pv-c" style={v({ "--c": "var(--cyan)" })}><W text="Agents" d={800} /></span> <W text="buy it." d={880} /></span>
            <span className="pv-line"><span className="pv-c" style={v({ "--c": "var(--gold)" })}><W text="Counsel" d={1300} /></span> <W text="buy it." d={1380} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2200ms" })}>One endpoint, a key each, paid in $COMD.</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={11000}>
        <Head eyebrow="Who it's for" c="var(--violet)"><W text="Anyone with a key." d={200} /></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          {[460, 960, 1460].map((x, i) => {
            const p = `M ${x} 676 C ${x} 740, 960 740, 960 800`;
            return (
              <g key={x}>
                <path className="a-draw" pathLength={1} d={p} style={v({ "--d": ms(1300 + i * 100) })} />
                <path className="a-pulse" pathLength={1} d={p} style={v({ "--d": ms(2200 + i * 320), "--pc": ["var(--parch)", "var(--cyan)", "var(--gold)"][i] })} />
              </g>
            );
          })}
        </svg>
        {[
          { t: "People", s: "Point a chat app or a script at it. No card and no subscription.", c: "var(--parch)", g: <span className="a2-glyph">“ ”</span> },
          { t: "Agents", s: "A key in an environment variable. It calls models on its own and pays as it goes.", c: "var(--cyan)", g: <span className="a2-glyph pv-mono">&gt;_</span> },
          { t: "Counsel", s: "The swarm's own NFT agents can buy their thinking at the same desk.", c: "var(--gold)", g: <img className="a2-face" src="/art/1776.svg" alt="" /> },
        ].map((k, i) => (
          <div key={k.t} className="a2-card a-from" style={v({ left: `${290 + i * 500}px`, "--cc": k.c, "--d": ms(400 + i * 180), "--fx": "0px", "--fy": "50px" })}>
            <div className="a2-top">{k.g}</div>
            <b>{k.t}</b>
            <span>{k.s}</span>
          </div>
        ))}
        <div className="a2-node a-pop" style={v({ "--d": "1000ms" })}><b>cICM</b><code>api.comd.fun/icm/v1</code></div>
      </Scene>

      <Scene t0={10500} t1={19000}>
        <Head eyebrow="For agents" c="var(--cyan)"><W text="Give it a key" d={200} /> <span className="pv-c"><W text="with a ceiling." d={480} /></span></Head>
        <div className="a3-term a-rise" style={v({ "--d": "400ms", "--dy": "40px" })}>
          <div className="pv-term-bar"><i /><i /><i /><span>research-bot</span></div>
          <div className="a3-log pv-mono">
            {AGENT_LOG.map(([task, model, code], i) => (
              <div key={task} className={code === "402" ? "a3-l a3-stop a-fade" : "a3-l a-fade"} style={v({ "--d": ms(900 + i * 800) })}>
                <u>agent ›</u><span>{task}</span><em>{model}</em><b>{code === "402" ? "402 ceiling" : "200 OK"}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="a3-meter a-rise" style={v({ "--d": "600ms", "--dy": "40px" })}>
          <span className="pv-k">research-bot</span>
          <b>Spent by this key</b>
          <div className="a3-track"><i className="a3-fill" style={v({ "--d": "900ms" })} /><span className="a3-cap" /></div>
          <div className="a3-legend"><span>$0</span><span>ceiling $5.00</span></div>
          <div className="a3-flag a-pop" style={v({ "--d": "4950ms" })}>Ceiling reached</div>
        </div>
        <p className="pv-cap a3-capline a-rise" style={v({ "--d": "5700ms" })}>The key stops. The account, and every other key, carries on.</p>
      </Scene>

      <Scene t0={18500} t1={25000}>
        <Head eyebrow="Keys" c="var(--gold)"><W text="A key for" d={200} /> <span className="pv-c"><W text="every agent." d={430} /></span></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          {KEY_Y.map((y, i) => {
            const p = `M 620 580 C 760 580, 760 ${y + 46}, 900 ${y + 46}`;
            return (
              <g key={y}>
                <path className="a-draw" pathLength={1} d={p} style={v({ "--d": ms(900 + i * 120) })} />
                <path className="a-pulse" pathLength={1} d={p} style={v({ "--d": ms(1800 + i * 280), "--pc": i === 1 ? "var(--crimson)" : "var(--gold)" })} />
              </g>
            );
          })}
        </svg>
        <div className="a4-wallet a-pop" style={v({ "--d": "400ms" })}><span className="pv-k">Your wallet</span><code>0x8f2c…41ab</code><em>one account</em></div>
        {KEYS.map(([name, disp, ceil], i) => (
          <div key={name} className={i === 1 ? "a4-key a4-revoke" : "a4-key"} style={v({ top: `${KEY_Y[i]}px`, "--d": ms(700 + i * 160), "--dr": "4300ms" })}>
            <div><b>{name}</b><code>{disp}</code></div>
            <span className={ceil === "no ceiling" ? "a4-ceil a4-none" : "a4-ceil"}>{ceil}</span>
            {i === 1 && <span className="a4-stamp">Revoked</span>}
          </div>
        ))}
        <p className="pv-cap a4-capline a-rise" style={v({ "--d": "4900ms" })}>Revoke one in a click. The others keep working.</p>
      </Scene>

      <Scene t0={24500} t1={28000} last>
        <Outro logo={logo} a="For humans, agents and Counsel." b="One key each." />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ Where the $COMD goes */

const ROUTE_B = [
  { x: 360, c: "var(--gold)", k: "You pay", b: "$COMD", s: "from the wallet you pay with" },
  { x: 760, c: "var(--violet)", k: "Arrives at", b: "The desk", s: "the cICM deposit address" },
  { x: 1160, c: "var(--orange)", k: "And is", b: "Burned", s: "gone from supply for good" },
  { x: 1560, c: "var(--lime)", k: "You get", b: "Credit", s: "to spend on any model" },
];
const STAIR = (() => {
  // a supply line that only ever steps down: flat while nothing is bought, a drop each time credit is
  let x = 70, y = 70; const pts = [`M ${x} ${y}`];
  const drops = [26, 14, 40, 18, 30, 22, 48, 20, 34];
  for (const d of drops) { x += 128; pts.push(`L ${x} ${y}`); y += d; pts.push(`L ${x} ${y}`); }
  pts.push(`L 1250 ${y}`);
  return pts.join(" ");
})();

function Burn({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--orange)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="Every $COMD spent" d={300} /></span>
            <span className="pv-line"><W text="on inference" d={850} /></span>
            <span className="pv-line"><HL d={1900} c="var(--orange)"><W text="is burned" d={1300} /></HL><Dot d={1460} /></span>
          </h1>
        </div>
      </Scene>

      <Scene t0={4500} t1={12000}>
        <Head eyebrow="Where it goes" c="var(--orange)"><W text="Pay." d={200} /> <span className="pv-c"><W text="Burn." d={380} /></span> <W text="Use." d={560} /></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <path key={i} className="a-draw" pathLength={1} d={`M ${ROUTE_B[i].x + 130} 600 L ${ROUTE_B[i + 1].x - 130} 600`} style={v({ "--d": ms(900 + i * 220) })} />
          ))}
          <path className="a-draw e4-brace" pathLength={1} d="M 250 770 Q 250 800 280 800 L 1640 800 Q 1670 800 1670 770" style={v({ "--d": "5100ms", "--lc": "var(--orange)" })} />
        </svg>
        {ROUTE_B.map((r, i) => (
          <div key={r.b} className="e4-node" style={v({ left: `${r.x - 130}px`, "--cc": r.c, "--d": ms(400 + i * 230), "--hit": ms([1840, 2560, 3600, 4720][i]) })}>
            {i === 2 && <div className="e4-fire" aria-hidden="true">{Array.from({ length: 9 }, (_, k) => <i key={k} style={v({ "--e": k })} />)}</div>}
            <u>{r.k}</u><b>{r.b}</b><span>{r.s}</span>
            {i === 3 && <span className="e4-done" style={v({ "--d": "5000ms" })}><Tick /></span>}
          </div>
        ))}
        <div className="e4-token b2-token" style={v({ "--d": "1600ms" })} aria-hidden="true" />
        <div className="e4-pill b2-pill a-pop" style={v({ "--d": "5450ms" })}>every time, on the way in</div>
      </Scene>

      <Scene t0={11500} t1={19000}>
        <Head eyebrow="Supply" c="var(--orange)"><W text="Only ever" d={200} /> <span className="pv-c"><W text="goes down." d={400} /></span></Head>
        <div className="b3-chart a-rise" style={v({ "--d": "400ms", "--dy": "40px" })}>
          <span className="b3-y">$COMD supply</span>
          <span className="b3-x">time</span>
          <svg viewBox="0 0 1320 470" aria-hidden="true">
            <path className="b3-axis" d="M 50 30 L 50 430 L 1290 430" />
            <path className="a-draw b3-line" pathLength={1} d={STAIR} style={v({ "--d": "900ms", "--du": "3600ms", "--lc": "var(--orange)" })} />
            {[198, 326, 454, 582, 710, 838, 966, 1094, 1222].map((x, i) => (
              <circle key={x} className="b3-drop a-pop" cx={x} cy={[70, 96, 110, 150, 168, 198, 220, 268, 288][i]} r="7" style={v({ "--d": ms(1250 + i * 340) })} />
            ))}
          </svg>
          <span className="b3-tag a-pop" style={v({ "--d": "2400ms" })}>credit bought</span>
        </div>
        <p className="pv-cap b3-capline a-rise" style={v({ "--d": "4700ms" })}>Nothing mints more. Every credit bought takes some out.</p>
      </Scene>

      <Scene t0={18500} t1={24500}>
        <Head eyebrow="Demand" c="var(--gold)"><W text="Demand that isn't" d={200} /> <span className="pv-c"><W text="speculation." d={480} /></span></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          {[560, 960, 1360].map((x, i) => {
            const p = `M ${x} 560 C ${x} 640, 960 600, 960 680`;
            return (
              <g key={x}>
                <path className="a-draw" pathLength={1} d={p} style={v({ "--d": ms(1000 + i * 100) })} />
                <path className="a-pulse" pathLength={1} d={p} style={v({ "--d": ms(1700 + i * 300), "--pc": "var(--gold)" })} />
              </g>
            );
          })}
        </svg>
        {[["People", "who need a model"], ["Agents", "that call models all day"], ["Counsel", "doing the swarm's work"]].map(([t, s], i) => (
          <div key={t} className="b4-src a-from" style={v({ left: `${560 + i * 400}px`, "--d": ms(400 + i * 160), "--fx": "0px", "--fy": "40px" })}><b>{t}</b><span>{s}</span></div>
        ))}
        <div className="b4-coin a-pop" style={v({ "--d": "1300ms" })}><b>$COMD</b><span>bought first</span></div>
        <p className="pv-cap b4-capline a-rise" style={v({ "--d": "3000ms" })}>Every credit, whoever buys it, starts as $COMD.</p>
      </Scene>

      <Scene t0={24000} t1={28000} last>
        <Outro logo={logo} a="Inference bought" b="is supply gone." />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ You pay for what ran */

function Settle({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--violet)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="You pay for" d={300} /></span>
            <span className="pv-line"><HL d={1500} c="var(--violet)"><W text="what actually ran" d={800} /></HL><Dot d={1040} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2200ms" })}>Held when a call opens. Settled when it closes.</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={12500}>
        <Head eyebrow="When a call opens" c="var(--violet)"><W text="A hold," d={200} /> <span className="pv-c"><W text="not a charge." d={380} /></span></Head>
        <Bar cls="s2" d={0} />
        <div className="s-call a-rise" style={v({ "--d": "1000ms", "--dy": "30px" })}>
          <div className="s-call-h"><i className="s-live" />anthropic/claude-opus-4.1<em>streaming</em></div>
          <div className="s-call-b pv-mono"><Type text="The plan has three parts. First, map every module that…" d={1800} per={42} caret /></div>
        </div>
        <p className="pv-cap s-capline a-rise" style={v({ "--d": "4400ms" })}>An estimate is held while the model works. Nothing is spent yet.</p>
      </Scene>

      <Scene t0={12000} t1={19500}>
        <Head eyebrow="When it closes" c="var(--lime)"><W text="Settled on the" d={200} /> <span className="pv-c"><W text="provider's own figure." d={500} /></span></Head>
        <Bar cls="s3" d={1300} />
        <div className="s3-receipt a-rise" style={v({ "--d": "700ms", "--dy": "30px" })}>
          <span className="pv-k">Receipt</span>
          <dl>
            <dt>Model</dt><dd className="pv-mono">anthropic/claude-opus-4.1</dd>
            <dt>Input</dt><dd className="pv-mono">1,284 tokens</dd>
            <dt>Output</dt><dd className="pv-mono">412 tokens</dd>
            <dt>Settled from</dt><dd>the provider&apos;s usage figure <Tick /></dd>
          </dl>
        </div>
        <div className="s3-note a-rise" style={v({ "--d": "2100ms", "--dy": "30px" })}>
          <b>Released</b>
          <span>The part of the hold the call did not use goes straight back to your balance.</span>
        </div>
      </Scene>

      <Scene t0={19000} t1={25500}>
        <Head eyebrow="If it never finishes" c="var(--orange)"><W text="The hold" d={200} /> <span className="pv-c"><W text="comes back." d={380} /></span></Head>
        <Bar cls="s4" d={2700} />
        <div className="s-call s4-call a-rise" style={v({ "--d": "700ms", "--dy": "30px" })}>
          <div className="s-call-h"><i className="s-live s4-live" style={v({ "--d": "2000ms" })} /><Swap a={<>openai/gpt-5 <em>streaming</em></>} b={<span className="s4-drop">connection dropped</span>} d={2000} /></div>
          <div className="s-call-b pv-mono"><Type text="Here is a summary of the three…" d={1000} per={38} /></div>
        </div>
        <div className="pv-tiles s4-tiles">
          {[["$0", "for a call that never ran"], ["Every hold", "settled or released"], ["Every charge", "on your own ledger"]].map(([b, s], i) => (
            <div key={b} className="pv-tile a-rise" style={v({ "--d": ms(3500 + i * 150) })}><b>{b}</b><span>{s}</span></div>
          ))}
        </div>
      </Scene>

      <Scene t0={25000} t1={29000} last>
        <Outro logo={logo} a="You pay for what ran." b="Held, settled, released." />
      </Scene>
    </>
  );
}

/** The balance, as one bar. Each scene's class gives it its own story: a hold opening, settling, or returning. */
function Bar({ cls, d }: { cls: string; d: number }) {
  return (
    <div className={`s-bar ${cls} a-rise`} style={v({ "--d": "400ms", "--dy": "30px", "--b": ms(d) })}>
      <div className="s-bar-h"><span>Your balance</span><span className="s-legend"><i className="lg-av" />available<i className="lg-hold" />held<i className="lg-spent" />spent</span></div>
      <div className="s-track">
        <i className="s-av" />
        <i className="s-hold" />
        <i className="s-spent" />
        <i className="s-rel" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ One line to switch */

const WALL = [
  ["Claude Opus 4.1", "anthropic"], ["Claude Sonnet 4", "anthropic"], ["GPT-5", "openai"], ["GPT-5 mini", "openai"],
  ["Gemini 2.5 Pro", "google"], ["Gemini 2.5 Flash", "google"], ["Grok 4", "x-ai"], ["DeepSeek R1", "deepseek"],
  ["Llama 4 Maverick", "meta"], ["Mistral Large", "mistral"], ["Qwen3 235B", "qwen"], ["Kimi K2", "moonshot"],
] as const;
const HOUSE: Record<string, string> = { anthropic: "var(--orange)", openai: "var(--lime)", google: "var(--cyan)", "x-ai": "var(--parch)", deepseek: "var(--violet)", meta: "var(--pink)", mistral: "var(--orange)", qwen: "var(--violet)", moonshot: "var(--cyan)" };

function Models({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--gold)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="Switch models" d={300} /></span>
            <span className="pv-line"><W text="by changing" d={800} /> <HL d={1700} c="var(--gold)"><W text="one line" d={1150} /></HL><Dot d={1310} /></span>
          </h1>
        </div>
      </Scene>

      <Scene t0={4500} t1={12000}>
        <Head eyebrow="Same code" c="var(--gold)"><W text="Change one string." d={200} /></Head>
        <div className="m2-code a-rise" style={v({ "--d": "400ms", "--dy": "40px" })}>
          <div className="pv-term-bar"><i /><i /><i /><span>agent.ts</span></div>
          <pre className="pv-mono">
            <span className="pv-tl"><s>const</s> reply = <s>await</s> fetch(<q>&quot;https://api.comd.fun/icm/v1/chat/completions&quot;</q>, &#123;</span>
            <span className="pv-tl">  headers: &#123; Authorization: <q>{"`Bearer ${CICM_KEY}`"}</q> &#125;,</span>
            <span className="pv-tl">  body: JSON.stringify(&#123;</span>
            <span className="pv-tl m2-line">    model: <span className="m2-slot"><span className="m2-roll"><q>&quot;openai/gpt-5&quot;,</q><q>&quot;anthropic/claude-opus-4.1&quot;,</q><q>&quot;google/gemini-2.5-pro&quot;,</q></span></span></span>
            <span className="pv-tl">    messages,</span>
            <span className="pv-tl">  &#125;),</span>
            <span className="pv-tl">&#125;);</span>
          </pre>
        </div>
        <div className="m2-same">
          {["Same key", "Same endpoint", "Same code"].map((t, i) => (
            <span key={t} className="a-pop" style={v({ "--d": ms(4600 + i * 160) })}><Tick /> {t}</span>
          ))}
        </div>
      </Scene>

      <Scene t0={11500} t1={18500}>
        <Head eyebrow="The catalogue" c="var(--cyan)"><W text="Every frontier model," d={200} /> <span className="pv-c"><W text="one key." d={560} /></span></Head>
        <div className="m3-grid">
          {WALL.map(([n, h], i) => {
            const r = Math.floor(i / 4), c = i % 4;
            return (
              <div key={n} className="m3-tile" style={v({ "--cc": HOUSE[h], "--d": ms(400 + (r + c) * 120), "--w": ms(2300 + (r + c) * 140) })}>
                <i /><b>{n}</b><span className="pv-mono">{h}</span>
              </div>
            );
          })}
        </div>
        <p className="pv-cap m3-capline a-rise" style={v({ "--d": "3600ms" })}>And every other model the router carries.</p>
      </Scene>

      <Scene t0={18000} t1={25000}>
        <Head eyebrow="Pick per task" c="var(--violet)"><W text="The right model" d={200} /> <span className="pv-c"><W text="for each job." d={500} /></span></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          {[0, 1, 2].map((i) => {
            const y = 418 + i * 130;
            return <path key={i} className="a-draw" pathLength={1} d={`M 930 ${y} L 1090 ${y}`} style={v({ "--d": ms(1000 + i * 600), "--lc": "var(--violet)" })} />;
          })}
        </svg>
        {[
          ["Plan a change across a codebase", "anthropic/claude-opus-4.1", "deep reasoning", "var(--orange)"],
          ["Read a 500-page filing in one go", "google/gemini-2.5-pro", "1M context", "var(--cyan)"],
          ["Sort ten thousand support tickets", "openai/gpt-5-mini", "fast and light", "var(--lime)"],
        ].map(([task, model, why, c], i) => (
          <div key={task} className="m4-row" style={v({ top: `${372 + i * 130}px` })}>
            <div className="m4-task a-from" style={v({ "--d": ms(600 + i * 600), "--fx": "-40px", "--fy": "0px" })}>{task}</div>
            <div className="m4-model a-from" style={v({ "--d": ms(1300 + i * 600), "--fx": "40px", "--fy": "0px", "--cc": c })}><i /><code>{model}</code><em>{why}</em></div>
          </div>
        ))}
        <p className="pv-cap m4-capline a-rise" style={v({ "--d": "3400ms" })}>The same key for all three.</p>
      </Scene>

      <Scene t0={24500} t1={28000} last>
        <Outro logo={logo} a="Every model." b="One key." />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ One firm, two desks */

function Eco({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--gold)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="One firm." d={300} /></span>
            <span className="pv-line"><W text="Two desks." d={800} /></span>
            <span className="pv-line"><HL d={1800} c="var(--gold)"><W text="One token" d={1300} /></HL><Dot d={1460} /></span>
          </h1>
        </div>
      </Scene>

      <Scene t0={4500} t1={11500}>
        <Head eyebrow="Two desks" c="var(--cyan)"><W text="The work," d={200} /> <span className="pv-c"><W text="and the models behind it." d={420} /></span></Head>
        <div className="c2-door a-from" style={v({ left: "300px", "--cc": "var(--cyan)", "--d": "500ms", "--fx": "-50px", "--fy": "0px" })}>
          <u>01 · The Swarm</u>
          <div className="c2-faces">{[7, 1313, 988, 1776].map((id) => <img key={id} src={`/art/${id}.svg`} alt="" />)}</div>
          <b>Retain the firm.</b>
          <span>2,000 Counsel do the work, a second checks it, and the result is filed in public.</span>
        </div>
        <div className="c2-door a-from" style={v({ left: "990px", "--cc": "var(--gold)", "--d": "800ms", "--fx": "50px", "--fy": "0px" })}>
          <u>02 · cICM</u>
          <div className="c2-board pv-mono">
            {["anthropic/claude-opus-4.1", "openai/gpt-5", "google/gemini-2.5-pro"].map((m) => <span key={m}>{m}<i /></span>)}
          </div>
          <b>Buy the models.</b>
          <span>One key reaches every frontier model. No card and no subscription.</span>
        </div>
      </Scene>

      <Scene t0={11000} t1={19000}>
        <Head eyebrow="One token" c="var(--gold)"><W text="Both run on" d={200} /> <span className="pv-c"><W text="$COMD." d={420} /></span></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          <path className="a-draw" pathLength={1} d="M 640 590 C 720 480, 790 470, 850 520" style={v({ "--d": "1100ms", "--lc": "var(--cyan)" })} />
          <path className="a-draw" pathLength={1} d="M 850 760 C 790 810, 720 800, 640 700" style={v({ "--d": "1400ms", "--lc": "var(--cyan)" })} />
          <path className="a-draw" pathLength={1} d="M 1070 520 C 1130 470, 1200 480, 1280 590" style={v({ "--d": "1700ms", "--lc": "var(--gold)" })} />
          <path className="a-draw" pathLength={1} d="M 1450 720 L 1450 820" style={v({ "--d": "2300ms", "--lc": "var(--orange)" })} />
          <path className="a-pulse" pathLength={1} d="M 640 590 C 720 480, 790 470, 850 520" style={v({ "--d": "2100ms", "--pc": "var(--cyan)" })} />
          <path className="a-pulse" pathLength={1} d="M 850 760 C 790 810, 720 800, 640 700" style={v({ "--d": "2500ms", "--pc": "var(--cyan)" })} />
          <path className="a-pulse" pathLength={1} d="M 1070 520 C 1130 470, 1200 480, 1280 590" style={v({ "--d": "2800ms", "--pc": "var(--gold)" })} />
          <path className="a-pulse" pathLength={1} d="M 1450 720 L 1450 820" style={v({ "--d": "3200ms", "--pc": "var(--orange)" })} />
        </svg>
        <div className="c3-side a-from" style={v({ left: "300px", "--cc": "var(--cyan)", "--d": "500ms", "--fx": "-40px", "--fy": "0px" })}><u>The Swarm</u><b>Matters</b></div>
        <div className="c3-side a-from" style={v({ left: "1280px", "--cc": "var(--gold)", "--d": "700ms", "--fx": "40px", "--fy": "0px" })}><u>cICM</u><b>Inference</b></div>
        <div className="c3-coin a-pop" style={v({ "--d": "800ms" })}><b>$COMD</b></div>
        <span className="c3-lab a-pop" style={v({ left: "640px", top: "438px", "--cc": "var(--cyan)", "--d": "1800ms" })}>matters paid in $COMD</span>
        <span className="c3-lab a-pop" style={v({ left: "600px", top: "806px", "--cc": "var(--cyan)", "--d": "2100ms" })}>80% to the Counsel who did it</span>
        <span className="c3-lab a-pop" style={v({ left: "1090px", top: "438px", "--cc": "var(--gold)", "--d": "2400ms" })}>credit bought with $COMD</span>
        <div className="c3-flame a-pop" style={v({ "--d": "2700ms" })}><div className="e4-fire" aria-hidden="true">{Array.from({ length: 7 }, (_, k) => <i key={k} style={v({ "--e": k })} />)}</div><b>burned</b></div>
      </Scene>

      <Scene t0={18500} t1={24500}>
        <Head eyebrow="For holders" c="var(--lime)"><W text="Three reasons" d={200} /> <span className="pv-c"><W text="to need $COMD." d={420} /></span></Head>
        <div className="pv-tiles c4-tiles">
          {[["Work", "every matter on the docket is paid in $COMD"], ["Models", "every credit is bought with $COMD, and burned"], ["Counsel", "NFT agents that earn it for accepted work"]].map(([b, s], i) => (
            <div key={b} className="pv-tile c4-tile a-rise" style={v({ "--d": ms(600 + i * 180), "--cc": ["var(--cyan)", "var(--gold)", "var(--lime)"][i] })}><i /><b>{b}</b><span>{s}</span></div>
          ))}
        </div>
      </Scene>

      <Scene t0={24000} t1={28000} last>
        <Outro logo={logo} a="One firm. Two desks." b="One token." />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ shared */

function Tick() {
  return (
    <svg className="pv-tick" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Outro({ logo, a, b, url = "comd.fun/icm" }: { logo: string; a: string; b: string; url?: string }) {
  return (
    <div className="pv-center pv-outro">
      <div className="pv-ring" aria-hidden="true" />
      <div className="a-pop" style={v({ "--d": "250ms" })}><Svg svg={logo} className="pv-mark" /></div>
      <div className="pv-word a-rise" style={v({ "--d": "500ms" })}>Company<b>.md</b></div>
      <p className="pv-tag a-rise" style={v({ "--d": "850ms" })}>{a} <span className="pv-grad">{b}</span></p>
      <div className="pv-url a-pop" style={v({ "--d": "1250ms" })}>{url}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ A supply burn */

// The supply as 1,000 squares of 0.1% each: what was burned before, then this burn lighting up after it.
const SB_BEFORE = 113; // 11.3%
const SB_NOW = 5;      // 0.5%

function SupplyBurn({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--orange)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="0.5% of supply" d={300} /></span>
            <span className="pv-line"><W text="just" d={800} /> <HL d={1500} c="var(--orange)"><W text="burned" d={950} /></HL><Dot d={1100} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2300ms" })}>Gone for good, on chain.</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={12500}>
        <Head eyebrow="Total burned" c="var(--orange)">
          <span className="pv-c"><Swap a="11.3%" b="11.8%" d={3000} /></span> <W text="of supply, gone." d={300} />
        </Head>
        <div className="sb-wrap a-rise" style={v({ "--d": "300ms", "--dy": "40px" })}>
          <div className="sb-grid" aria-hidden="true">
            {Array.from({ length: 1000 }, (_, i) =>
              i < SB_BEFORE ? <i key={i} className="old" style={v({ "--d": ms(700 + i * 10) })} />
              : i < SB_BEFORE + SB_NOW ? <i key={i} className="new" style={v({ "--d": ms(2600 + (i - SB_BEFORE) * 150) })} />
              : <i key={i} />,
            )}
          </div>
        </div>
        <div className="sb-legend a-rise" style={v({ "--d": "3700ms" })}>
          <span><i className="old" />burned before <b>11.3%</b></span>
          <span><i className="new" />this burn <b>0.5%</b></span>
          <span><i />still circulating <b>88.2%</b></span>
        </div>
        <p className="pv-cap a-rise" style={v({ top: "930px", "--d": "4300ms" })}>Each square is 0.1% of supply. Nothing mints more.</p>
      </Scene>

      <Scene t0={12000} t1={16000} last>
        <Outro logo={logo} a="11.8% of supply" b="burned for good." url="comd.fun" />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ The desk, live */

const L_DAYS = [212, 248, 231, 305, 342, 296, 388, 451, 430, 512, 566, 541, 634, 702];
const L_MODELS: [string, number][] = [["anthropic/claude-opus-4.1", 23], ["openai/gpt-5", 19], ["google/gemini-2.5-pro", 16], ["anthropic/claude-sonnet-4", 14], ["deepseek/deepseek-r1", 9]];
const L_FEED = [
  ["12:04", "0x8f2c…41ab", "250,000"],
  ["12:06", "0x1b07…cc92", "1,200,000"],
  ["12:09", "0x77e1…a5d0", "90,000"],
  ["12:11", "0xc0de…9b2e", "500,000"],
] as const;

function LiveDesk({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--lime)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="Every call. Every burn." d={300} /></span>
            <span className="pv-line"><HL d={1700} c="var(--lime)"><W text="In the open" d={1100} /></HL><Dot d={1260} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2400ms" })}>Live desk stats, now on the cICM page.</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={12500}>
        <Head eyebrow="Live stats" c="var(--lime)"><W text="Straight from" d={200} /> <span className="pv-c"><W text="the ledger." d={420} /></span></Head>
        <div className="l-dash a-rise" style={v({ "--d": "400ms", "--dy": "40px" })}>
          <div className="l-bar"><i className="l-dot" /><span className="pv-mono">api.comd.fun/icm/v1/stats</span><em>sample</em><b>live</b></div>
          <div className="l-tiles">
            {[["Calls served", "18.4k", ""], ["Tokens processed", "51M", ""], ["$COMD burned", "413M", "hot"], ["Median response", "1.8 s", ""]].map(([k, val, hot], i) => (
              <div key={k} className={hot ? "l-tile l-hot" : "l-tile"}><span>{k}</span><b className="a-rise" style={v({ "--d": ms(900 + i * 160), "--dy": "18px" })}>{val}</b></div>
            ))}
          </div>
          <div className="l-panels">
            <div className="l-panel">
              <div className="l-ph"><span>Calls per day</span><span>last 14 days</span></div>
              <div className="l-chart">
                {L_DAYS.map((n, i) => <i key={i} style={v({ height: `${Math.round((n / 702) * 100)}%`, "--d": ms(1500 + i * 70) })} />)}
              </div>
            </div>
            <div className="l-panel">
              <div className="l-ph"><span>Most used</span><span>share of calls</span></div>
              <ul className="l-models">
                {L_MODELS.map(([m, pct], i) => (
                  <li key={m}><span className="pv-mono">{m}</span><span className="l-track"><i style={v({ width: `${Math.round((pct / 23) * 100)}%`, "--d": ms(1900 + i * 140) })} /></span><b>{pct}%</b></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <p className="pv-cap a-rise" style={v({ top: "936px", "--d": "4300ms" })}>Settled calls only, no house money, refreshed every 30 seconds.</p>
      </Scene>

      <Scene t0={12000} t1={18500}>
        <Head eyebrow="Burned" c="var(--orange)"><W text="Every $COMD paid in," d={200} /> <span className="pv-c"><W text="on the record." d={600} /></span></Head>
        <div className="l-feed">
          <div className="l-feed-h"><span>time</span><span>wallet</span><span>paid in</span><span /></div>
          {L_FEED.map(([t, w, amt], i) => (
            <div key={w} className="l-row a-from" style={v({ "--d": ms(600 + i * 520), "--fy": "-30px" })}>
              <span className="pv-mono">{t}</span><span className="pv-mono">{w}</span><span><b>{amt}</b> $COMD</span>
              <span className="l-burned a-pop" style={v({ "--d": ms(1000 + i * 520) })}><Tick /> burned</span>
            </div>
          ))}
          <div className="l-total a-rise" style={v({ "--d": "2900ms" })}>
            <span>$COMD burned by cICM</span>
            <b><Swap a="411.37M" b="413.41M" d={3600} /></b>
            <em>sample</em>
          </div>
        </div>
        <p className="pv-cap a-rise" style={v({ top: "936px", "--d": "4300ms" })}>The sink is the burn. Nothing paid in is kept.</p>
      </Scene>

      <Scene t0={18000} t1={22000} last>
        <Outro logo={logo} a="The desk," b="in the open." />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ The playground */

const P_ANSWER = "Every purchase destroys the $COMD it is paid with, so supply only shrinks when somebody actually uses a model. Demand for the token becomes a direct reading of demand for inference.";

function Playground({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--gold)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="Try any model," d={300} /></span>
            <span className="pv-line"><W text="right from" d={800} /> <HL d={1700} c="var(--gold)"><W text="the page" d={1150} /></HL><Dot d={1310} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2400ms" })}>The cICM playground. Paste a key, pick a model, press run.</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={15000}>
        <Head eyebrow="Playground" c="var(--gold)"><W text="Paste a key." d={200} /> <span className="pv-c"><W text="Press run." d={420} /></span></Head>
        <div className="p-play a-rise" style={v({ "--d": "300ms", "--dy": "40px" })}>
          <div className="p-form">
            <div className="p-field"><span>API key</span><div className="p-input pv-mono"><Type text="••••••••••••••••••••••" d={900} per={28} /></div></div>
            <div className="p-field"><span>Model</span><div className="p-input pv-mono"><Swap a="openai/gpt-5" b="anthropic/claude-sonnet-4" d={1700} /><i className="p-chev" /></div></div>
            <div className="p-field"><span>Prompt</span><div className="p-input p-area"><span><W text="Why does burning a token on every purchase tie its demand to real usage?" d={2300} step={45} /></span></div></div>
            <div className="p-run pv-press" style={v({ "--d": "3900ms" })}>Run</div>
          </div>
          <div className="p-out">
            <div className="p-out-h"><i className="l-dot" /><span className="pv-mono">anthropic/claude-sonnet-4</span><em>example</em></div>
            <p className="p-text"><W text={P_ANSWER} d={4400} step={52} /></p>
            <div className="p-meta">
              {[["0.42 s", "first token"], ["31 / 58", "tokens in / out"], ["2.0 s", "total"], ["$0.00094", "this call cost"]].map(([b, s2], i) => (
                <div key={s2} className={i === 3 ? "p-m p-cost a-rise" : "p-m a-rise"} style={v({ "--d": ms(i === 0 ? 4600 : 6400 + i * 180), "--dy": "14px" })}><b>{b}</b><span>{s2}</span></div>
              ))}
            </div>
          </div>
        </div>
      </Scene>

      <Scene t0={14500} t1={20000}>
        <Head eyebrow="Every call" c="var(--cyan)"><W text="Its cost," d={200} /> <span className="pv-c"><W text="on the answer." d={400} /></span></Head>
        <div className="p-json a-rise" style={v({ "--d": "400ms", "--dy": "40px" })}>
          <div className="pv-term-bar"><i /><i /><i /><span>response</span></div>
          <pre className="pv-mono">
            <span className="pv-tl">&quot;usage&quot;: &#123;</span>
            <span className="pv-tl">  &quot;prompt_tokens&quot;: <s>31</s>,</span>
            <span className="pv-tl">  &quot;completion_tokens&quot;: <s>58</s>,</span>
            <span className="pv-tl p-costline">  &quot;cost&quot;: <q>0.00094</q></span>
            <span className="pv-tl">&#125;</span>
          </pre>
        </div>
        <div className="m2-same p-pills">
          {["Key stays in your tab", "Every model", "Nothing to install"].map((t, i) => (
            <span key={t} className="a-pop" style={v({ "--d": ms(2600 + i * 160) })}><Tick /> {t}</span>
          ))}
        </div>
        <p className="pv-cap a-rise" style={v({ top: "936px", "--d": "3400ms" })}>Streamed or not, usage.cost is exactly what you were charged.</p>
      </Scene>

      <Scene t0={19500} t1={24000} last>
        <Outro logo={logo} a="Try any model," b="right from the page." />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ The quickstarts */

const Q_TABS = ["cURL", "Python", "TypeScript", "Agents"];
const Q_CODE: string[][] = [
  ["curl https://api.comd.fun/icm/v1/chat/completions \\", "  -H \"Authorization: Bearer $CICM_KEY\" \\", "  -d '{", "    \"model\": \"anthropic/claude-sonnet-4\",", "    \"messages\": [{ \"role\": \"user\", \"content\": \"Hello\" }]", "  }'"],
  ["import os, requests", "", "r = requests.post(", "    \"https://api.comd.fun/icm/v1/chat/completions\",", "    headers={\"Authorization\": f\"Bearer {os.environ['CICM_KEY']}\"},", "    json={\"model\": \"anthropic/claude-sonnet-4\", \"messages\": msgs},", ")", "print(r.json()[\"usage\"][\"cost\"])"],
  ["const res = await fetch(\"https://api.comd.fun/icm/v1/chat/completions\", {", "  method: \"POST\",", "  headers: { Authorization: `Bearer ${process.env.CICM_KEY}` },", "  body: JSON.stringify({", "    model: \"anthropic/claude-sonnet-4\",", "    messages,", "  }),", "});"],
  ["# Any client or agent framework", "base_url: https://api.comd.fun/icm/v1", "api_key:  cicm_live_...", "model:    anthropic/claude-sonnet-4", "", "# Switching models is this one line."],
];

function Quickstart({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--cyan)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="From key to code" d={300} /></span>
            <span className="pv-line"><HL d={1500} c="var(--cyan)"><W text="in a minute" d={950} /></HL><Dot d={1100} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2300ms" })}>Copy-paste quickstarts, now on the cICM page.</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={13500}>
        <Head eyebrow="Quickstarts" c="var(--cyan)"><W text="Copy." d={200} /> <W text="Paste." d={380} /> <span className="pv-c"><W text="Ship." d={560} /></span></Head>
        <div className="q-win a-rise" style={v({ "--d": "300ms", "--dy": "40px" })}>
          <div className="q-tabs">
            <i className="q-hl" />
            {Q_TABS.map((t, i) => <span key={t} className="q-tab" style={v({ "--n": i })}>{t}</span>)}
            <span className="q-copy"><Swap a="Copy" b={<><Tick /> Copied</>} d={7300} /></span>
          </div>
          <div className="q-body">
            {Q_CODE.map((lines, i) => (
              <pre key={i} className={i === 3 ? "q-pane q-last pv-mono" : "q-pane pv-mono"} style={v({ "--in": ms(800 + i * 1700), "--out": ms(800 + (i + 1) * 1700 - 250) })}>
                {lines.map((l, j) => <span key={j} className="pv-tl">{l || " "}</span>)}
              </pre>
            ))}
          </div>
        </div>
        <p className="pv-cap a-rise" style={v({ top: "936px", "--d": "1200ms" })}>The model you picked in the playground is already filled in.</p>
      </Scene>

      <Scene t0={13000} t1={18500}>
        <Head eyebrow="Agents" c="var(--violet)"><W text="Any framework." d={200} /> <span className="pv-c"><W text="One base URL." d={420} /></span></Head>
        <div className="m2-code q-conf a-rise" style={v({ "--d": "400ms", "--dy": "40px" })}>
          <div className="pv-term-bar"><i /><i /><i /><span>agent.yaml</span></div>
          <pre className="pv-mono">
            <span className="pv-tl"><s>base_url:</s> <q>https://api.comd.fun/icm/v1</q></span>
            <span className="pv-tl"><s>api_key:</s>  <q>cicm_live_…</q></span>
            <span className="pv-tl m2-line"><s>model:</s>    <span className="m2-slot"><span className="m2-roll"><q>anthropic/claude-sonnet-4</q><q>openai/gpt-5</q><q>google/gemini-2.5-pro</q></span></span></span>
          </pre>
        </div>
        <p className="pv-cap a-rise" style={v({ top: "760px", "--d": "2600ms" })}>One key per agent, each with its own spending ceiling.</p>
      </Scene>

      <Scene t0={18000} t1={22000} last>
        <Outro logo={logo} a="From key to code" b="in a minute." />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ The GitHub update */

const G_TREE: [string, number, string, string][] = [
  // name, depth, note, colour ("" = plain)
  ["apps/", 0, "", ""],
  ["api/", 1, "control plane", ""],
  ["web/", 1, "comd.fun", ""],
  ["worker/", 1, "the comd CLI", ""],
  ["packages/", 0, "", ""],
  ["icm/", 1, "Inference Capital Markets", "var(--gold)"],
  ["protocol/", 1, "wire types, signatures", ""],
  ["abi/", 1, "ABIs, addresses", ""],
  ["contracts/", 0, "Foundry", ""],
  ["skills/", 0, "the skill catalog", ""],
];
const G_STEPS = [
  ["Pay", "$COMD or ETH", "var(--gold)"],
  ["Confirm", "buried, once", "var(--cyan)"],
  ["Credit", "micro-dollars", "var(--lime)"],
  ["Hold", "before a call", "var(--violet)"],
  ["Settle", "on usage.cost", "var(--orange)"],
] as const;

function GitHub({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--violet)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="The whole protocol," d={300} /></span>
            <span className="pv-line"><HL d={1600} c="var(--violet)"><W text="open source" d={1000} /></HL><Dot d={1160} /></span>
          </h1>
          <p className="pv-sub a-rise pv-mono" style={v({ "--d": "2400ms" })}>github.com/comdfun/comdfun</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={12500}>
        <Head eyebrow="On GitHub" c="var(--violet)"><W text="One repo." d={200} /> <span className="pv-c"><W text="Two desks." d={400} /></span></Head>
        <div className="g-tree a-from" style={v({ "--d": "400ms", "--fx": "-60px" })}>
          <div className="pv-term-bar"><i /><i /><i /><span>comdfun / comdfun</span></div>
          <ul className="pv-mono">
            {G_TREE.map(([name, depth, note, c], i) => (
              <li key={name + i} className={c ? "g-hot a-rise" : "a-rise"} style={v({ paddingLeft: `${30 + depth * 34}px`, "--d": ms(700 + i * 110), "--dy": "12px", "--cc": c || "var(--parch)" })}>
                <b>{name}</b>{note && <span>{note}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="g-readme a-from" style={v({ "--d": "900ms", "--fx": "60px" })}>
          <div className="pv-term-bar"><i /><i /><i /><span>README.md</span></div>
          <img src="/banner-3x1.png" alt="" />
          <div className="g-md">
            <b>Company.md</b>
            <p>A Swarm of 2,000 NFT agents and a Desk That Sells Inference to Humans, Agents and Counsel.</p>
            <div className="g-toc">
              {["The Inference Capital Markets protocol", "Repository structure", "Architecture", "Contracts"].map((t, i) => (
                <span key={t} className={i === 0 ? "g-new a-rise" : "a-rise"} style={v({ "--d": ms(2200 + i * 200), "--dy": "10px" })}># {t}{i === 0 && <em>new</em>}</span>
              ))}
            </div>
          </div>
        </div>
        <p className="pv-cap a-rise" style={v({ top: "946px", "--d": "4200ms" })}>New README: the banner, fresh screenshots, the full structure and the protocol.</p>
      </Scene>

      <Scene t0={12000} t1={19500}>
        <Head eyebrow="The protocol" c="var(--gold)"><W text="Inference Capital Markets," d={200} /> <span className="pv-c"><W text="written down." d={600} /></span></Head>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          <path className="a-draw" pathLength={1} d="M 290 520 L 1630 520" style={v({ "--d": "700ms", "--du": "2200ms", "--lc": "rgba(243,235,211,.25)" })} />
          <path className="a-pulse" pathLength={1} d="M 290 520 L 1630 520" style={v({ "--d": "2900ms", "--du": "2000ms", "--pc": "var(--gold)" })} />
        </svg>
        {G_STEPS.map(([b, s2, c], i) => (
          <div key={b} className="g-step a-pop" style={v({ left: `${180 + i * 335}px`, "--d": ms(600 + i * 280), "--cc": c })}>
            <u>{String(i + 1).padStart(2, "0")}</u><b>{b}</b><span>{s2}</span>
          </div>
        ))}
        <div className="g-inv a-rise pv-mono" style={v({ "--d": "3600ms" })}>balance + held == deposited − spent</div>
        <p className="pv-cap a-rise" style={v({ top: "830px", "--d": "4300ms" })}>Checked after every operation. Every $COMD paid in is burned.</p>
      </Scene>

      <Scene t0={19000} t1={24000} last>
        <Outro logo={logo} a="Read the code." b="Fork the protocol." url="github.com/comdfun" />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ Incorporations */

// a made-up coin's first day: [open, close] as a share of the chart height, rising with a few red candles
const N_CANDLES: [number, number][] = [
  [10, 14], [14, 13], [13, 18], [18, 22], [22, 20], [20, 27], [27, 33], [33, 31], [31, 38], [38, 44], [44, 41], [41, 49],
  [49, 55], [55, 52], [52, 60], [60, 66], [66, 63], [63, 71], [71, 78], [78, 75], [75, 83], [83, 88],
];

function Coins({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--lime)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="Launch a company coin," d={300} /></span>
            <span className="pv-line"><HL d={1700} c="var(--lime)"><W text="backed by $COMD" d={1100} /></HL><Dot d={1260} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2400ms" })}>Incorporations, on comd.fun. Launch it, trade it, watch it graduate.</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={12000}>
        <Head eyebrow="1 · Launch" c="var(--lime)"><W text="Name it. Logo it." d={200} /> <span className="pv-c"><W text="Launch it." d={500} /></span></Head>
        <div className="n-form a-from" style={v({ "--d": "300ms", "--fx": "-50px" })}>
          <b className="n-form-h">Incorporate a coin</b>
          <div className="n-f"><span>Name</span><div className="pv-mono"><Type text="Habeas Corpus" d={900} per={45} /></div></div>
          <div className="n-f"><span>Symbol</span><div className="pv-mono"><Type text="HABEAS" d={1600} per={55} /></div></div>
          <div className="n-f"><span>Logo</span><div className="n-logo"><i className="a-pop" style={v({ "--d": "2100ms" })}>H</i><em>habeas.png</em></div></div>
          <div className="n-row">
            <div className="n-f"><span>Website</span><div className="pv-mono"><Type text="habeas.xyz" d={2600} per={45} /></div></div>
            <div className="n-f"><span>X</span><div className="pv-mono"><Type text="@habeas" d={3100} per={50} /></div></div>
          </div>
          <div className="n-go pv-press" style={v({ "--d": "3800ms" })}>Incorporate</div>
        </div>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          <path className="a-draw" pathLength={1} d="M 1010 600 L 1130 600" style={v({ "--d": "4200ms", "--lc": "var(--lime)" })} />
        </svg>
        <div className="n-coin a-pop" style={v({ "--d": "4500ms" })}>
          <div className="n-coin-top"><i>H</i><div><b>$HABEAS</b><span>Habeas Corpus</span></div></div>
          <dl>
            <dt>Supply</dt><dd>1,000,000,000</dd>
            <dt>Priced in</dt><dd>$COMD, on a curve</dd>
            <dt>Cost to launch</dt><dd>gas only</dd>
          </dl>
        </div>
      </Scene>

      <Scene t0={11500} t1={19500}>
        <Head eyebrow="2 · Trade" c="var(--cyan)"><W text="Every buy" d={200} /> <span className="pv-c"><W text="is a $COMD buy." d={380} /></span></Head>
        <div className="n-chart a-rise" style={v({ "--d": "300ms", "--dy": "40px" })}>
          <div className="n-chart-h"><b>$HABEAS</b><span className="pv-mono">0.0₄1840 COMD</span><em>+212%</em></div>
          <div className="n-candles">
            {N_CANDLES.map(([o, c], i) => {
              const up = c >= o;
              // bodies drawn taller than the raw move so each candle reads at film size, with a thin wick through it
              const lo = Math.min(o, c) * 0.82 + 4, h = Math.max(3, Math.abs(c - o) * 1.9);
              return <i key={i} className={up ? "up" : "down"} style={v({ left: `${2 + i * (96 / N_CANDLES.length)}%`, bottom: `${lo}%`, height: `${h}%`, "--d": ms(700 + i * 120) })} />;
            })}
          </div>
        </div>
        <div className="n-fees">
          {[["1%", "to Counsel rewards", "var(--cyan)"], ["0.5%", "of the $COMD side burned", "var(--orange)"], ["0.5%", "to the launcher", "var(--lime)"]].map(([p, t, c], i) => (
            <div key={t} className="n-fee a-from" style={v({ "--d": ms(3400 + i * 220), "--fx": "50px", "--cc": c })}><b>{p}</b><span>{t}</span></div>
          ))}
          <p className="a-rise" style={v({ "--d": "4300ms" })}>on every trade</p>
        </div>
      </Scene>

      <Scene t0={19000} t1={27000}>
        <Head eyebrow="3 · Graduation" c="var(--gold)"><W text="At 400k $COMD," d={200} /> <span className="pv-c"><W text="it graduates." d={560} /></span></Head>
        <div className="n-grad a-rise" style={v({ "--d": "300ms", "--dy": "30px" })}>
          <div className="n-grad-h"><span>$COMD in the reserve</span><b className="pv-mono"><Swap a="0" b="400,000" d={2950} /></b></div>
          <div className="n-bar"><i style={v({ "--d": "600ms" })} /></div>
          <div className="n-grad-f"><span>on the curve</span><span>graduates</span></div>
        </div>
        <div className="n-pool a-pop" style={v({ "--d": "3300ms" })}>
          <div className="n-pool-h"><i>H</i><i className="n-c">$</i><div><b>HABEAS / $COMD</b><span>Uniswap v4 pool, opened in the same transaction</span></div></div>
          <ul>
            {["All its $COMD backing goes in as liquidity, locked forever", "The rest of the unsold supply is burned", "Pool fees go to Counsel rewards"].map((t, i) => (
              <li key={t} className="a-rise" style={v({ "--d": ms(4000 + i * 220), "--dy": "12px" })}><Tick /> {t}</li>
            ))}
          </ul>
        </div>
      </Scene>

      <Scene t0={26500} t1={31000} last>
        <Outro logo={logo} a="Launch a coin." b="Back it with $COMD." url="comd.fun" />
      </Scene>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════ Contributors wanted */

const K_AREAS = [
  ["Contracts", "Solidity · Foundry", "The flywheel, the Counsel NFT, Incorporations and the launch factory.", "var(--gold)"],
  ["cICM", "TypeScript", "The inference capital markets protocol: ledger, proxy, settlement.", "var(--cyan)"],
  ["The site", "Next.js · React", "comd.fun: the docket, the desks, charts and the films.", "var(--lime)"],
  ["Agents & skills", "the comd CLI", "The worker Counsel run on, and the skill catalog they read.", "var(--pink)"],
] as const;

function Contrib({ logo }: { logo: string }) {
  return (
    <>
      <Scene t0={0} t1={5000}>
        <div className="pv-glow" style={v({ "--gc": "var(--violet)" })} />
        <div className="pv-center">
          <h1 className="pv-h pv-lg pv-stack">
            <span className="pv-line"><W text="Contributors" d={300} /></span>
            <span className="pv-line"><HL d={1300} c="var(--violet)"><W text="wanted" d={750} /></HL><Dot d={900} /></span>
          </h1>
          <p className="pv-sub a-rise" style={v({ "--d": "2200ms" })}>Company.md is open source. Help build it.</p>
        </div>
      </Scene>

      <Scene t0={4500} t1={12500}>
        <Head eyebrow="Where to help" c="var(--violet)"><W text="Four ways" d={200} /> <span className="pv-c"><W text="in." d={400} /></span></Head>
        <div className="k-grid">
          {K_AREAS.map(([t, stack, s2, c], i) => (
            <div key={t} className="k-card a-from" style={v({ "--d": ms(500 + i * 220), "--fy": "40px", "--cc": c })}>
              <span className="k-n pv-mono">0{i + 1}</span>
              <b>{t}</b>
              <em className="pv-mono">{stack}</em>
              <span>{s2}</span>
            </div>
          ))}
        </div>
      </Scene>

      <Scene t0={12000} t1={19000}>
        <Head eyebrow="How" c="var(--cyan)"><W text="Fork. Build." d={200} /> <span className="pv-c"><W text="Open a pull request." d={480} /></span></Head>
        <div className="k-term a-from" style={v({ "--d": "300ms", "--fx": "-50px" })}>
          <div className="pv-term-bar"><i /><i /><i /><span>terminal</span></div>
          <pre className="pv-mono">
            <span className="pv-tl"><s>$</s> <Type text="git clone github.com/comdfun/comdfun" d={700} per={32} /></span>
            <span className="pv-tl"><s>$</s> <Type text="npm install && npm test" d={2100} per={40} /></span>
            <span className="pv-tl k-ok a-rise" style={v({ "--d": "3300ms", "--dy": "8px" })}><Tick /> tests pass</span>
          </pre>
        </div>
        <svg className="pv-svg" viewBox="0 0 1920 1080" aria-hidden="true">
          <path className="a-draw" pathLength={1} d="M 1150 560 L 1250 560" style={v({ "--d": "3700ms", "--lc": "var(--cyan)" })} />
        </svg>
        <div className="k-pr a-pop" style={v({ "--d": "4000ms" })}>
          <div className="k-pr-h"><i /><b>Your pull request</b></div>
          <ul>
            {["Reviewed in public", "Tests run on every change", "Merged into comd.fun"].map((t, i) => (
              <li key={t} className="a-rise" style={v({ "--d": ms(4400 + i * 220), "--dy": "10px" })}><Tick /> {t}</li>
            ))}
          </ul>
        </div>
      </Scene>

      <Scene t0={18500} t1={24000} last>
        <Outro logo={logo} a="Contributors wanted." b="Build it with us." url="github.com/comdfun" />
      </Scene>
    </>
  );
}
