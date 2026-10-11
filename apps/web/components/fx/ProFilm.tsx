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

export type ProKind = "icmx" | "icmeth";
export const PRO_LENGTH: Record<ProKind, number> = { icmx: 38_000, icmeth: 32_000 };

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
        <div className="pv-brand" aria-hidden="true"><Svg svg={logo} className="pv-brand-mark" /><span>Company<b>.md</b></span><em>cICM</em></div>
        <div className="pv-progress" aria-hidden="true"><i /></div>
        {kind === "icmx" ? <Intro logo={logo} /> : <Eth logo={logo} />}
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

/* ═══════════════════════════════════════════════════════════════════════════════════ shared */

function Tick() {
  return (
    <svg className="pv-tick" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Outro({ logo, a, b }: { logo: string; a: string; b: string }) {
  return (
    <div className="pv-center pv-outro">
      <div className="pv-ring" aria-hidden="true" />
      <div className="a-pop" style={v({ "--d": "250ms" })}><Svg svg={logo} className="pv-mark" /></div>
      <div className="pv-word a-rise" style={v({ "--d": "500ms" })}>Company<b>.md</b></div>
      <p className="pv-tag a-rise" style={v({ "--d": "850ms" })}>{a} <span className="pv-grad">{b}</span></p>
      <div className="pv-url a-pop" style={v({ "--d": "1250ms" })}>comd.fun/icm</div>
    </div>
  );
}
