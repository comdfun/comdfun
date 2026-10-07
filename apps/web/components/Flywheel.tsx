// The $COMD flywheel, drawn in pixels: a gear (rasterised on a 128×112 grid, rotated in 7.5° steps) whose spokes are the
// two buckets of the 5% ETH tax (buyback-and-burn / Counsel floor sweeps), ETH coins dropping into the hub, and the live
// totals. Server components; numbers count up client-side.
import Link from "next/link";
import type { ReactNode } from "react";
import type { FlywheelStats } from "@/lib/flywheel";
import { toUnits, taxCollectedWei, burnedWei } from "@/lib/flywheel";
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
// the hub is wide enough (radius 13 of 128) for the "5% TAX" badge that TaxStage lays over it
export const HUB = { cx: 58, cy: 60, r: 13, w: 128, h: 112 } as const;
const MAIN = gear(HUB.cx, HUB.cy, 36, 14, { rim: 6, hub: HUB.r, spokes: [{ a: deg(-90), c: C.crim, d: C.crimDk }, { a: deg(0), c: C.vio, d: C.vioDk }, { a: deg(90), c: C.crim, d: C.crimDk }, { a: deg(180), c: C.vio, d: C.vioDk }] });
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

/* ------------------------------------------------------------------------------------------------ stats */

const eth = (v?: string | null) => toUnits(v);
const pctVol = (bps: number, taxBps: number) => {
  const v = (bps * taxBps) / 1_000_000;
  return v.toFixed(Number.isInteger(v) ? 0 : 1);
};

export function TaxStage({ s, labels = "short" }: { s: FlywheelStats; labels?: "short" | "long" }) {
  return (
    <div className="fw-stage rv">
      <div className="fw-wheel">
        <WheelSvg />
        {/* the badge sits exactly on the gear's hub; its size and type scale with the wheel (container units) */}
        <div
          className="fw-hub"
          aria-hidden="true"
          style={{ left: `${(HUB.cx / HUB.w) * 100}%`, top: `${(HUB.cy / HUB.h) * 100}%`, width: `${((HUB.r * 2) / HUB.w) * 100}%` }}
        >
          <b>{(s.taxBps / 100).toFixed(0)}%</b><span>tax</span>
        </div>
      </div>
      <span className="fw-tag t-in">{labels === "long" ? "ETH in from Pons · every trade" : "Every buy & sell · ETH in"}</span>
      <span className="fw-tag t-burn c-crimson">Buyback &amp; burn · {pctVol(s.bps.buyback, s.taxBps)}%</span>
      <span className="fw-tag t-sweep c-violet">Floor sweeps · {pctVol(s.bps.sweep, s.taxBps)}%</span>
    </div>
  );
}

export function FlywheelStatsGrid({ s, compact }: { s: FlywheelStats; compact?: boolean }) {
  const portraits = s.sweptTokenIds.slice(-8).reverse();
  return (
    <div className="fw-stats rv-kids">
      <div className="stat rv c-gold"><CountUp className="v" value={eth(taxCollectedWei(s).toString())} format="fixed2" /><span className="k">ETH tax collected{s.fees?.tracked ? "" : " by the Flywheel"}</span></div>
      <div className="stat rv c-crimson"><CountUp className="v" value={toUnits(burnedWei(s).toString())} format="compact" /><span className="k">$COMD bought back &amp; burned (0x…dEaD){s.burns?.burnedPct ? ` · ${s.burns.burnedPct}%` : ""}</span></div>
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

export function FlywheelSection({ s }: { s: FlywheelStats }) {
  const rr = s.revenueRouter?.bps;
  return (
    <div className="fw">
      <TaxStage s={s} />
      <div className="fw-copy">
        <p className="lede rv" style={{ marginTop: 0 }}>
          <strong>$COMD launched on Pons: 1,000,000,000 supply, liquidity locked by Pons at graduation.</strong> Every buy and sell pays a <strong>{(s.taxBps / 100).toFixed(0)}% tax in ETH</strong> that Pons sends to the Flywheel, which spends all of it: half buys $COMD back and burns it to the dead address, half sweeps the Counsel NFT floor into the firm&apos;s vault. Work closes the loop: jobs are paid in $COMD, {rr ? rr.rewards / 100 : 80}% of every payment to the Counsel who did it and {rr ? rr.treasury / 100 : 20}% to the firm treasury.
        </p>
        <FlywheelStatsGrid s={s} compact />
        {!s.configured && <p className="small muted" style={{ marginTop: 10 }}>{s.reason} Totals start at zero on deployment.</p>}
        {s.configured && !s.swapper.configured && <p className="small muted" style={{ marginTop: 10 }}>{s.burns?.tracked && Number(s.burns.burned) > 0 ? <>Until the Pons graduation the firm buys back and burns <strong>by hand</strong> from the tax it collects — {s.burns.count} burn{s.burns.count === 1 ? "" : "s"} so far, every one a public transaction on <Link href="/flywheel">the flywheel page</Link>. The Flywheel contract takes over once the pool is configured.</> : <>Buybacks start after graduation, once the pool is configured.</>}</p>}
        {s.source === "mock" && <p className="small muted" style={{ marginTop: 10 }}><span className="tag c-orange">mock</span> Fixture numbers until the contracts are live.</p>}
        <div className="btn-row" style={{ marginTop: 18 }}>
          <Link className="btn primary gold" href="/swap">Trade $COMD ›</Link>
          <Link className="btn violet" href="/flywheel">Inside the flywheel</Link>
        </div>
      </div>
    </div>
  );
}
