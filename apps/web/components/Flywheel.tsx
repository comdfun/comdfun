// The two $COMD engines, drawn in pixels.
//   I.  The 5% tax wheel: a gear (rasterised on a 128×112 grid, rotated in 7.5° steps) whose spokes are the two
//       buckets of the ETH tax (buyback-and-burn / Counsel floor sweeps), ETH coins dropping into the hub.
//   II. The capped pool (inspired by IMD's POOL4): the pool's COMD inventory rises past the cap on sells, the hook trims
//       the excess, the COMD splits 85 / 6 / 4.5 / 4.5 into burn / bond reserve / stakers / Counsel seats, and the ETH
//       freed by the trim is posted as the buy wall.
// Server components; numbers count up client-side.
import Link from "next/link";
import type { ReactNode } from "react";
import type { FlywheelStats, HookStats } from "@/lib/flywheel";
import { toUnits, TRIM_DEFAULT } from "@/lib/flywheel";
import { CountUp } from "./fx/CountUp";

type Px = [number, number, string];
const C = { gold: "#ffc83d", goldHi: "#ffe598", goldDk: "#b07a00", goldSh: "#4f3600", crim: "#ff3b5c", crimDk: "#b0123a", vio: "#9b5cff", vioDk: "#5b2bc4", vioHi: "#c9a8ff", lime: "#8cff3a", limeDk: "#49a812", parch: "#f3ebd3", hub: "#2a2433", fill: "#120f18", fill2: "#17131f", cyan: "#2de2e6", cyanDk: "#0f8f96", cyanHi: "#b8fbfc", orange: "#ff8a1f", orangeDk: "#b35500", rule: "#3a3346" };

function gear(cx: number, cy: number, R: number, teeth: number, opts: { rim: number; hub: number; spokes?: { a: number; c: string; d: string }[]; tooth?: number }): Px[] {
  const out: Px[] = [];
  const T = opts.tooth ?? 5;
  for (let y = Math.floor(cy - R - T - 1); y <= cy + R + T + 1; y++) {
    for (let x = Math.floor(cx - R - T - 1); x <= cx + R + T + 1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      const a = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const seg = (a / (Math.PI * 2)) * teeth;
      const inTooth = seg - Math.floor(seg) < 0.5;
      if (r > R && r <= R + T && inTooth) out.push([x, y, r > R + T - 1.2 ? C.goldHi : C.gold]);
      else if (r <= R && r > R - opts.rim) out.push([x, y, r > R - 1.4 ? C.goldHi : r < R - opts.rim + 1.4 ? C.goldDk : C.gold]);
      else if (r <= opts.hub) out.push([x, y, r > opts.hub - 1.4 ? C.goldDk : r < 2.2 ? C.parch : C.hub]);
      else if (r <= R - opts.rim) {
        let painted = false;
        for (const s of opts.spokes ?? []) {
          const sx = Math.cos(s.a), sy = Math.sin(s.a);
          const along = dx * sx + dy * sy;
          const off = Math.abs(-dx * sy + dy * sx);
          if (along > 0 && off < 3.6) { out.push([x, y, off > 2.4 ? s.d : s.c]); painted = true; break; }
        }
        if (!painted) out.push([x, y, (x + y) % 2 ? C.fill : C.fill2]);
      }
    }
  }
  return out;
}

function rects(px: Px[], k: string) {
  // merge horizontal runs of the same colour
  const rows = new Map<number, Px[]>();
  for (const p of px) (rows.get(p[1]) ?? rows.set(p[1], []).get(p[1])!).push(p);
  const out: ReactNode[] = [];
  for (const [y, row] of rows) {
    row.sort((a, b) => a[0] - b[0]);
    let i = 0;
    while (i < row.length) {
      let j = i;
      while (j + 1 < row.length && row[j + 1][0] === row[j][0] + 1 && row[j + 1][2] === row[i][2]) j++;
      out.push(<rect key={`${k}${y}-${i}`} x={row[i][0]} y={y} width={j - i + 1} height={1} fill={row[i][2]} />);
      i = j + 1;
    }
  }
  return out;
}

const deg = (d: number) => (d * Math.PI) / 180;
// four spokes, alternating: buyback & burn (crimson) / floor sweep (violet), the 50/50 default
const MAIN = gear(58, 60, 36, 14, { rim: 6, hub: 9, spokes: [{ a: deg(-90), c: C.crim, d: C.crimDk }, { a: deg(0), c: C.vio, d: C.vioDk }, { a: deg(90), c: C.crim, d: C.crimDk }, { a: deg(180), c: C.vio, d: C.vioDk }] });
const SAT1 = gear(112, 20, 11, 8, { rim: 3, hub: 3, tooth: 4 });
const SAT2 = gear(110, 98, 8, 6, { rim: 3, hub: 2, tooth: 3 });

export function WheelSvg({ className }: { className?: string }) {
  return (
    <svg className={`fw-svg ${className ?? ""}`} viewBox="0 0 128 112" shapeRendering="crispEdges" aria-hidden="true">
      <g className="fw-coins">
        {[0, 1, 2].map((i) => (
          <g key={i} className="fw-coin" style={{ animationDelay: `${i * 0.6}s` }}>
            <rect x={56} y={0} width={5} height={4} fill={C.gold} /><rect x={57} y={0} width={3} height={1} fill={C.goldHi} /><rect x={57} y={3} width={3} height={1} fill={C.goldDk} />
          </g>
        ))}
      </g>
      <g className="fw-spin">{rects(MAIN, "m")}</g>
      <g className="fw-spin-r">{rects(SAT1, "a")}</g>
      <g className="fw-spin-r2">{rects(SAT2, "b")}</g>
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------ the capped pool */

const BINS = [
  { x: 63, c: C.crim, d: C.crimDk },
  { x: 79, c: C.orange, d: C.orangeDk },
  { x: 95, c: C.cyan, d: C.cyanDk },
  { x: 111, c: C.lime, d: C.limeDk },
];

function tankWalls(): ReactNode[] {
  const out: ReactNode[] = [];
  // outer walls (gold, 3px) with highlight and shade; bands every 20px
  out.push(<rect key="wl" x={6} y={12} width={3} height={90} fill={C.gold} />, <rect key="wlh" x={6} y={12} width={1} height={90} fill={C.goldHi} />);
  out.push(<rect key="wr" x={53} y={12} width={3} height={90} fill={C.gold} />, <rect key="wrs" x={55} y={12} width={1} height={90} fill={C.goldDk} />);
  out.push(<rect key="wb" x={6} y={99} width={50} height={3} fill={C.goldDk} />, <rect key="wbh" x={6} y={99} width={50} height={1} fill={C.gold} />);
  out.push(<rect key="lip" x={4} y={10} width={54} height={3} fill={C.goldHi} />, <rect key="lips" x={4} y={12} width={54} height={1} fill={C.goldDk} />);
  for (const y of [32, 52, 72, 92]) out.push(<rect key={`band${y}`} x={4} y={y} width={2} height={3} fill={C.goldDk} />, <rect key={`bandr${y}`} x={56} y={y} width={2} height={3} fill={C.goldDk} />);
  // feet
  out.push(<rect key="f1" x={9} y={102} width={6} height={4} fill={C.goldSh} />, <rect key="f2" x={47} y={102} width={6} height={4} fill={C.goldSh} />);
  return out;
}

function liquid(): ReactNode[] {
  // tall column of COMD; the group is translated up/down. Surface at y=60 at rest.
  const out: ReactNode[] = [<rect key="body" x={9} y={60} width={44} height={60} fill={C.cyanDk} />];
  out.push(<rect key="surf" x={9} y={60} width={44} height={2} fill={C.cyanHi} />, <rect key="surf2" x={9} y={62} width={44} height={2} fill={C.cyan} />);
  // dithered depth + bubbles
  for (let y = 66; y < 118; y += 2) for (let x = 9 + ((y / 2) % 2) * 2; x < 53; x += 4) out.push(<rect key={`d${x}-${y}`} x={x} y={y} width={1} height={1} fill={C.cyan} opacity={0.35} />);
  for (const [x, y] of [[16, 72], [30, 80], [42, 70], [22, 90], [38, 96], [47, 86]]) out.push(<rect key={`b${x}${y}`} x={x} y={y} width={2} height={2} fill={C.cyanHi} opacity={0.7} />);
  return out;
}

function pipes(): ReactNode[] {
  const out: ReactNode[] = [];
  const P = (k: string, x: number, y: number, w: number, h: number) => out.push(<rect key={k} x={x} y={y} width={w} height={h} fill={C.rule} />, <rect key={`${k}h`} x={x} y={y} width={w} height={1} fill="#5a5168" />);
  P("p1", 56, 21, 24, 5); // tank spout → junction
  out.push(<rect key="valve" x={64} y={18} width={5} height={11} fill={C.crim} />, <rect key="valveh" x={64} y={18} width={5} height={1} fill="#ff8fa3" />, <rect key="valvec" x={62} y={16} width={9} height={2} fill={C.crimDk} />);
  P("j", 77, 18, 9, 11); // junction
  P("p2", 86, 21, 10, 5); // junction → wall (ETH)
  P("p3", 79, 29, 5, 30); // junction ↓ manifold (COMD)
  P("man", 60, 59, 66, 4); // manifold
  for (const b of BINS) P(`n${b.x}`, b.x + 5, 63, 4, 6);
  return out;
}

function bins(): ReactNode[] {
  const out: ReactNode[] = [];
  for (const [i, b] of BINS.entries()) {
    out.push(<rect key={`bl${i}`} x={b.x} y={70} width={2} height={32} fill={b.c} />, <rect key={`br${i}`} x={b.x + 12} y={70} width={2} height={32} fill={b.d} />, <rect key={`bb${i}`} x={b.x} y={100} width={14} height={2} fill={b.d} />);
    for (let y = 72; y < 100; y += 2) for (let x = b.x + 2 + ((y / 2) % 2); x < b.x + 12; x += 2) out.push(<rect key={`bf${i}-${x}-${y}`} x={x} y={y} width={1} height={1} fill={C.fill2} />);
    // contents (static heap; height hints at the split: burn biggest)
    const h = [14, 6, 5, 5][i];
    out.push(<rect key={`bh${i}`} x={b.x + 2} y={100 - h} width={10} height={h} fill={b.d} />, <rect key={`bht${i}`} x={b.x + 2} y={100 - h} width={10} height={1} fill={b.c} />);
  }
  // flames on the burn bin
  out.push(
    <g key="fl" className="pl-flame">
      <rect x={66} y={78} width={2} height={6} fill={C.orange} /><rect x={69} y={74} width={2} height={10} fill={C.crim} /><rect x={72} y={77} width={2} height={7} fill={C.orange} />
      <rect x={69} y={78} width={2} height={4} fill={C.goldHi} />
    </g>,
  );
  return out;
}

function wall(): ReactNode[] {
  // the buy wall: violet bricks (ETH bid) stacked at the right, below a dashed "price" line
  const out: ReactNode[] = [];
  for (let r = 0; r < 6; r++) {
    const y = 8 + r * 7;
    const off = r % 2 ? 5 : 0;
    for (let x = 96 - off; x < 126; x += 10) {
      const x0 = Math.max(97, x), x1 = Math.min(126, x + 9);
      if (x1 - x0 < 2) continue;
      out.push(<rect key={`w${r}-${x}`} x={x0} y={y} width={x1 - x0} height={6} fill={r === 0 ? C.vioHi : C.vio} />, <rect key={`ws${r}-${x}`} x={x0} y={y + 5} width={x1 - x0} height={1} fill={C.vioDk} />);
    }
  }
  return out;
}

export function PoolSvg({ className }: { className?: string }) {
  return (
    <svg className={`pl-svg ${className ?? ""}`} viewBox="0 0 128 112" shapeRendering="crispEdges" aria-hidden="true">
      <defs>
        <clipPath id="pl-tank"><rect x={9} y={13} width={44} height={86} /></clipPath>
      </defs>
      {/* tank interior */}
      <rect x={9} y={13} width={44} height={86} fill={C.fill} />
      <g clipPath="url(#pl-tank)"><g className="pl-liquid">{liquid()}</g></g>
      {tankWalls()}
      {/* the cap */}
      <g className="pl-cap">
        {Array.from({ length: 13 }, (_, i) => <rect key={i} x={2 + i * 5} y={37} width={3} height={2} fill={C.crim} />)}
      </g>
      {pipes()}
      {wall()}
      <g className="pl-wall-new"><rect x={97} y={44} width={29} height={6} fill={C.vioHi} /><rect x={97} y={49} width={29} height={1} fill={C.vioDk} /></g>
      {bins()}
      {/* moving pieces: trimmed COMD to the four bins, freed ETH to the wall */}
      {BINS.map((b, i) => (
        <g key={i} className={`pl-bit pl-b${i}`}><rect x={55} y={22} width={3} height={3} fill={C.gold} /><rect x={55} y={22} width={2} height={1} fill={C.goldHi} /></g>
      ))}
      <g className="pl-bit pl-eth"><rect x={56} y={21} width={3} height={1} fill={C.vioHi} /><rect x={55} y={22} width={5} height={2} fill={C.vio} /><rect x={56} y={24} width={3} height={1} fill={C.vioDk} /></g>
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------ stats */

const eth = (v?: string | null) => toUnits(v);
const pctVol = (bps: number, taxBps: number) => {
  const v = (bps * taxBps) / 1_000_000;
  return v.toFixed(Number.isInteger(v) ? 0 : 1);
};

export function TaxStage({ s, labels = "short" }: { s: FlywheelStats; labels?: "short" | "long" }) {
  return (
    <div className="fw-stage rv">
      <WheelSvg />
      <div className="fw-hub" aria-hidden="true"><b>{(s.taxBps / 100).toFixed(0)}%</b><span>tax</span></div>
      <span className="fw-tag t-in">{labels === "long" ? "ETH in from every trade" : "Every buy & sell · ETH in"}</span>
      <span className="fw-tag t-burn c-crimson">Buyback &amp; burn · {pctVol(s.bps.buyback, s.taxBps)}%</span>
      <span className="fw-tag t-sweep c-violet">Floor sweeps · {pctVol(s.bps.sweep, s.taxBps)}%</span>
    </div>
  );
}

export function PoolStage({ s }: { s: FlywheelStats }) {
  return (
    <div className="pl-stage rv">
      <PoolSvg />
      <span className="pl-tag t-inv c-cyan">Pool inventory</span>
      <span className="pl-tag t-cap c-crimson">Cap</span>
      <span className="pl-tag t-wall c-violet">Buy wall · ETH</span>
      <span className="pl-trim" aria-hidden="true">Trim!</span>
      <span className="pl-bins" aria-hidden="true">
        <span className="c-crimson">{split(s.hook).burnBps / 100}</span>
        <span className="c-orange">{split(s.hook).bondBps / 100}</span>
        <span className="c-cyan">{split(s.hook).stakersBps / 100}</span>
        <span className="c-lime">{split(s.hook).seatsBps / 100}</span>
      </span>
    </div>
  );
}

export const split = (h: HookStats | null) => (h?.params?.burnBps ? h.params : TRIM_DEFAULT);

export function FlywheelStatsGrid({ s, compact }: { s: FlywheelStats; compact?: boolean }) {
  const portraits = s.sweptTokenIds.slice(-8).reverse();
  return (
    <div className="fw-stats rv-kids">
      <div className="stat rv c-gold"><CountUp className="v" value={eth(s.totals.taxIn)} format="fixed2" /><span className="k">ETH tax collected</span></div>
      <div className="stat rv c-crimson"><CountUp className="v" value={toUnits(s.totals.burned)} format="compact" /><span className="k">$COMD bought back &amp; burned</span></div>
      <div className="stat rv c-violet">
        <CountUp className="v" value={s.totals.swept} /><span className="k">Counsel NFTs swept</span>
        {portraits.length > 0 && (
          <span className="fw-swept">
            {portraits.slice(0, compact ? 5 : 8).map((id) => (
              <Link key={id} href={`/agents/${id}`} title={`Counsel #${String(id).padStart(4, "0")}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/art/${id}.svg`} alt="" width={26} height={26} loading="lazy" />
              </Link>
            ))}
          </span>
        )}
      </div>
      <div className="stat rv c-pink"><CountUp className="v" value={eth(s.buckets.buyback) + eth(s.buckets.sweep)} format="fixed3" /><span className="k">ETH waiting in the buckets</span></div>
    </div>
  );
}

export function PoolStatsGrid({ s }: { s: FlywheelStats }) {
  const h = s.hook;
  const inv = toUnits(h?.inventory), cap = toUnits(h?.currentCap ?? h?.cap);
  return (
    <div className="fw-stats rv-kids">
      <div className="stat rv c-cyan"><CountUp className="v" value={inv} format="compact" /><span className="k">COMD in the pool · cap {cap ? fmtCompact(cap) : "—"}</span></div>
      <div className="stat rv c-crimson"><CountUp className="v" value={toUnits(h?.stats.burned)} format="compact" /><span className="k">$COMD burned by trims &amp; the wall</span></div>
      <div className="stat rv c-orange"><CountUp className="v" value={toUnits(h?.stats.trimmedComd)} format="compact" /><span className="k">$COMD trimmed</span></div>
      <div className="stat rv c-violet"><CountUp className="v" value={eth(s.buyWall?.postedEth)} format="fixed3" /><span className="k">ETH on the buy wall</span></div>
    </div>
  );
}

function fmtCompact(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : n.toFixed(0);
}

/** Inventory against the cap: a pixel meter with the cap marker. */
export function CapMeter({ h }: { h: HookStats | null }) {
  const inv = toUnits(h?.inventory), cap = toUnits(h?.currentCap ?? h?.cap);
  const top = Math.max(inv, cap) * 1.25 || 1;
  return (
    <div className="capm rv" role="img" aria-label={`Pool inventory ${fmtCompact(inv)} COMD against a cap of ${fmtCompact(cap)} COMD`}>
      <div className="capm-bar">
        <span className="capm-fill" style={{ width: `${(inv / top) * 100}%` }} />
        <span className="capm-cap" style={{ left: `${(cap / top) * 100}%` }}><b>cap</b></span>
      </div>
      <div className="capm-k"><span className="c-cyan">Inventory {fmtCompact(inv)}</span><span className="c-crimson">Cap {fmtCompact(cap)} · floor {fmtCompact(toUnits(h?.params?.capFloor))}</span></div>
    </div>
  );
}

/** The 85 / 6 / 4.5 / 4.5 split of every trimmed (or wall-bought) COMD, with the running totals. */
export function TrimSplit({ h, totals = true }: { h: HookStats | null; totals?: boolean }) {
  const p = split(h);
  const rows = [
    { k: "burnBps", t: "Burned", c: "crimson", v: h?.stats.burned, d: "Leaves supply for good." },
    { k: "bondBps", t: "Bond reserve", c: "orange", v: h?.stats.toBond, d: "Sold for ETH on /bond." },
    { k: "stakersBps", t: "Stakers (sCOMD)", c: "cyan", v: h?.stats.toStakers, d: "Streamed by the RewardDripper." },
    { k: "seatsBps", t: "Counsel seats", c: "lime", v: h?.stats.toSeats, d: "Claimed per epoch, in COMD." },
  ] as const;
  return (
    <div className="tsplit rv">
      <div className="taxbar tsplit-bar" aria-hidden="true">
        {rows.map((r) => <span key={r.k} className={`c-${r.c}`} style={{ width: `${p[r.k] / 100}%` }} />)}
      </div>
      <ul className="tsplit-rows">
        {rows.map((r) => (
          <li key={r.k} className={`c-${r.c}`}>
            <b>{p[r.k] / 100}%</b>
            <span><span className="t">{r.t}</span><span className="d">{r.d}</span></span>
            {totals && <span className="num">{fmtCompact(toUnits(r.v))}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FlywheelSection({ s }: { s: FlywheelStats }) {
  return (
    <div className="engines">
      <p className="lede rv" style={{ marginTop: 0 }}>
        <strong>100% of $COMD sits in one pool, and two engines run on it.</strong> A <strong>{(s.taxBps / 100).toFixed(0)}% tax in ETH</strong> on every buy and sell turns the flywheel: half buys $COMD back and burns it, half sweeps the Counsel NFT floor. And the pool keeps a <strong>cap</strong> on the COMD it holds: whatever sells push past it is trimmed, mostly burned, and the ETH freed becomes a buy wall under the price.
      </p>
      <div className="engine-grid">
        <div className="engine c-gold">
          <div className="engine-h"><span className="engine-n">I</span><span><b>The tax wheel</b><span>5% of every trade, in ETH</span></span></div>
          <TaxStage s={s} />
          <FlywheelStatsGrid s={s} compact />
        </div>
        <div className="engine c-cyan">
          <div className="engine-h"><span className="engine-n">II</span><span><b>The capped pool</b><span>Trims · buy wall · inspired by IMD</span></span></div>
          <PoolStage s={s} />
          <PoolStatsGrid s={s} />
        </div>
      </div>
      {!s.configured && <p className="small muted" style={{ marginTop: 10 }}>{s.reason} Totals start at zero on deployment.</p>}
      {s.source === "mock" && <p className="small muted" style={{ marginTop: 10 }}><span className="tag c-orange">mock</span> Fixture numbers until the contracts are live.</p>}
      <div className="btn-row" style={{ marginTop: 18 }}>
        <Link className="btn primary gold" href="/swap">Buy $COMD ›</Link>
        <Link className="btn cyan" href="/stake">Stake for sCOMD</Link>
        <Link className="btn violet" href="/flywheel">Inside the engines</Link>
      </div>
    </div>
  );
}
