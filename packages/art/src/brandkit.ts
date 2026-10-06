// Brand kit: logo marks, lockups and banner scenes, all as logical rasters in "units".
// Each asset is rendered at an integer pixel scale (nearest neighbour) by the brand script.
import { Raster, T, mix, hex, type Color } from "./raster.js";
import { ARCADE as A } from "./palette.js";
import { rng } from "./hash.js";
import { drawText, textWidth } from "./font.js";
import { drawTitle, titleWidth, titleHeight, drawText7, text7Width, type Ramp } from "./font7.js";
import { mark64, mark32, mark16, monoMark, bayer } from "./mark.js";
import { composeFigure } from "./counsel.js";

export { mark64, mark32, mark16, monoMark };

// ── colour ramps ────────────────────────────────────────────────────────────────────────────
export const RAMPS = {
  parchment: [hex("#FFFFFF"), A.parchment, A.parchLo],
  gold: [A.goldHi, A.gold, A.goldLo],
  orange: [hex("#FFC48A"), A.orange, hex("#C2570A")],
  crimson: [hex("#FFA0B2"), A.crimson, A.crimsonLo],
  pink: [hex("#FFB4F0"), A.pink, A.pinkLo],
  violet: [hex("#CFB2FF"), A.violet, A.violetLo],
  cyan: [hex("#B4FAFB"), A.cyan, A.cyanLo],
  lime: [hex("#D8FFB4"), A.lime, A.limeLo],
} satisfies Record<string, Ramp>;

/** The wordmark as set in the arcade face: "•" renders as the round seal dot. */
export const WORDMARK_TEXT = "COMPANY•MD";
const SEAL = 7; // index of the seal in WORDMARK_TEXT

/** Lockup treatment: COMPANY in gold, a crimson wax-seal dot, MD in cyan. */
export const TITLE_RAMP = (i: number): Ramp => (i < SEAL ? RAMPS.gold : i === SEAL ? RAMPS.crimson : RAMPS.cyan);
/** Banner treatment: one arcade colour per letter of COMPANY, a gold seal dot, MD in parchment. */
const RAINBOW: Ramp[] = [RAMPS.gold, RAMPS.orange, RAMPS.crimson, RAMPS.pink, RAMPS.violet, RAMPS.cyan, RAMPS.lime];
export const RAINBOW_RAMP = (i: number): Ramp => (i < SEAL ? RAINBOW[i % RAINBOW.length] : i === SEAL ? RAMPS.gold : RAMPS.parchment);

export function title(r: Raster, cx: number, y: number, k: number, ramp = RAINBOW_RAMP, text = WORDMARK_TEXT): { w: number; h: number } {
  const o = { k, ramp, shadow: A.violetDk, depth: k, outline: A.black };
  const w = titleWidth(text, o), h = titleHeight(o);
  drawTitle(r, text, Math.round(cx - w / 2), y, o);
  return { w, h };
}

/** Subline in the docket 3×5 face with coloured segments. Returns width. */
export function subline(r: Raster, cx: number, y: number, k = 1, segs: [string, Color][] = SUBLINE, knockout = true): number {
  const full = segs.map((s) => s[0]).join("");
  const w = textWidth(full) * k;
  let x = Math.round(cx - w / 2);
  if (knockout) r.rect(x - 3 * k, y - 2 * k, w + 6 * k, 9 * k, A.black); // knock out the starfield behind the type
  for (const [s, c] of segs) {
    drawText(r, s, x, y, c, k);
    x += (textWidth(s) + 1) * k;
  }
  return w;
}
/** Positioning line + facts line, on one black knock-out plate. Returns the bottom y. */
export function sublines(r: Raster, cx: number, y: number): number {
  const w = Math.max(textWidth(LINE1.map((s) => s[0]).join("")), textWidth(LINE2.map((s) => s[0]).join("")));
  r.rect(Math.round(cx - w / 2) - 4, y - 2, w + 8, 17, A.black);
  subline(r, cx, y, 1, LINE1, false);
  subline(r, cx, y + 8, 1, LINE2, false);
  return y + 15;
}
export const LINE1: [string, Color][] = [
  ["A SWARM OF NFT-IDENTIFIED AGENTS", A.parchment],
  [" · ", A.gold],
  ["AI TASKS ON CHAIN", A.lime],
];
export const LINE2: [string, Color][] = [
  ["2,000 COUNSEL", A.muted],
  [" · ", A.goldLo],
  ["ROBINHOOD CHAIN", A.muted],
  [" · ", A.goldLo],
  ["$COMD", A.gold],
  [" · ", A.goldLo],
  ["COMD.FUN", A.cyan],
];
export const SUBLINE: [string, Color][] = [
  ["2,000 AI COUNSEL", A.parchment],
  [" · ", A.gold],
  ["ON ROBINHOOD CHAIN", A.lime],
  [" · ", A.gold],
  ["$COMD", A.gold],
];

// ── scene pieces ────────────────────────────────────────────────────────────────────────────
export function sky(r: Raster, y0: number, y1: number, stops: Color[] = [A.night0, A.night1, A.night2, A.night3]): void {
  for (let y = y0; y < y1; y++) {
    const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    const f = t - i;
    for (let x = 0; x < r.w; x++) r.set(x, y, bayer(x, y) < f ? stops[i + 1] : stops[i]);
  }
}

export function stars(r: Raster, seed: string, x0: number, y0: number, x1: number, y1: number, density = 1 / 70): void {
  const R = rng(`stars:${seed}`);
  const n = Math.round((x1 - x0) * (y1 - y0) * density);
  const cols = [A.parchment, A.parchment, A.parchLo, A.muted, A.cyan, A.pink, A.gold];
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.floor(R() * (x1 - x0)), y = y0 + Math.floor(R() * (y1 - y0));
    const roll = R();
    if (roll < 0.06) {
      // twinkle: plus-shaped sparkle
      const c = R() < 0.5 ? A.gold : A.cyan;
      r.set(x, y, 0xffffff);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) r.set(x + dx, y + dy, c);
      if (R() < 0.5) for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) r.set(x + dx, y + dy, mix(c, 0, 0.5));
    } else {
      r.set(x, y, mix(cols[Math.floor(R() * cols.length)], 0, roll < 0.5 ? 0.45 : 0));
    }
  }
}

export function moon(r: Raster, cx: number, cy: number, rad: number): void {
  // halo
  for (let y = cy - rad - 6; y <= cy + rad + 6; y++)
    for (let x = cx - rad - 6; x <= cx + rad + 6; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > rad && d < rad + 6 && bayer(x, y) < 0.55 * (1 - (d - rad) / 6)) r.set(x, y, A.night3);
    }
  for (let y = cy - rad; y <= cy + rad; y++)
    for (let x = cx - rad; x <= cx + rad; x++) {
      const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
      const bite = Math.hypot(x - (cx + rad * 0.55), y - (cy - rad * 0.3));
      if (d <= rad && bite > rad * 0.85) {
        const edge = rad - d;
        r.set(x, y, edge < 1.2 ? A.goldHi : bite < rad * 0.85 + 1.5 ? A.goldLo : A.gold);
      }
    }
}

export function city(r: Raster, seed: string, x0: number, x1: number, baseY: number, hMin: number, hMax: number, body: Color, litP = 0.28): void {
  const R = rng(`city:${seed}`);
  const lights = [A.gold, A.gold, A.gold, A.orange, A.cyan, A.pink, A.lime, A.violet];
  let x = x0;
  while (x < x1) {
    const w = 6 + Math.floor(R() * 12);
    const h = hMin + Math.floor(R() * (hMax - hMin));
    const top = baseY - h;
    r.rect(x, top, Math.min(w, x1 - x), h, body);
    // rooftop details
    if (R() < 0.35) { const ax = x + 1 + Math.floor(R() * (w - 2)); for (let y = top - 4; y < top; y++) r.set(ax, y, body); r.set(ax, top - 5, R() < 0.5 ? A.crimson : A.gold); }
    if (R() < 0.25) r.rect(x + 1, top - 1, Math.max(1, w - 2), 1, body);
    // windows
    const lc = lights[Math.floor(R() * lights.length)];
    for (let wy = top + 2; wy < baseY - 2; wy += 3)
      for (let wx = x + 2; wx < x + w - 1 && wx < x1; wx += 2)
        if (R() < litP) r.set(wx, wy, R() < 0.8 ? mix(lc, body, 0.25) : mix(lc, body, 0.6));
    x += w + (R() < 0.3 ? 1 : 0);
  }
}

const COL_HI = mix(A.parchment, 0xffffff, 0.5);

/** Scales-of-justice statue (15×12) for rooftops. */
export function statue(r: Raster, cx: number, by: number): void {
  const g = [
    ".......h.......",
    "......hGg......",
    ".hhhhhhGhhhhhh.",
    ".g.....Gg....g.",
    "g.g....Gg...g.g",
    "g..g...Gg..g..g",
    "hGGGg..Gg.hGGGg",
    ".ggg...Gg..ggg.",
    ".......Gg......",
    ".....hGGGg.....",
    "....hGGGGGg....",
    "...ggggggggg...",
  ];
  r.sprite(g, cx - 7, by - g.length, { h: A.goldHi, G: A.gold, g: A.goldLo }, A.black);
}

export interface CourthouseOpts { cols: number; colH: number; steps: number; label?: string }

/** Parametric courthouse centred on cx, with its bottom step on baseY. Returns the top y. */
export function courthouse(r: Raster, cx: number, baseY: number, W: number, o: CourthouseOpts): { top: number; doorX0: number; doorX1: number } {
  const half = Math.floor(W / 2);
  const x0 = cx - half, x1 = cx + half - 1;
  // vertical layout (bottom-up)
  const stepsH = o.steps * 2;
  const colBase = baseY - stepsH;
  const colTop = colBase - o.colH;
  const friezeTop = colTop - 9;
  const slope = 3;
  const ph = Math.ceil((half - 2) / slope);
  const pedTop = friezeTop - 3 - ph;

  // pediment
  for (let i = 0; i < ph; i++) {
    const y = pedTop + i;
    const hw = Math.min(half, 2 + i * slope);
    for (let x = cx - hw; x <= cx + hw - 1; x++) {
      const dl = x - (cx - hw), dr = cx + hw - 1 - x;
      r.set(x, y, dl < 3 ? A.goldHi : dr < 3 ? A.goldLo : A.gold);
    }
    const inner = hw - 8;
    if (i >= 4 && inner > 0)
      for (let x = cx - inner; x <= cx + inner - 1; x++) r.set(x, y, bayer(x, y) < (i - 4) / (ph * 1.4) ? A.violetDk : A.violetDeep);
  }
  // tympanum seal: gold ring with crimson wax
  const sy = pedTop + Math.round(ph * 0.62), sr = Math.max(3, Math.floor(ph / 4));
  for (let y = sy - sr; y <= sy + sr; y++)
    for (let x = cx - sr - 1; x <= cx + sr; x++) {
      const d = Math.hypot(x - cx + 0.5, y - sy);
      if (d <= sr) r.set(x, y, d > sr - 1.2 ? A.gold : d < sr - 2.2 ? (x < cx && y < sy ? mix(A.crimson, 0xffffff, 0.35) : A.crimson) : A.crimsonLo);
    }
  // cornice
  r.rect(x0 - 1, friezeTop - 3, W + 2, 1, A.goldHi);
  r.rect(x0 - 1, friezeTop - 2, W + 2, 1, A.gold);
  r.rect(x0, friezeTop - 1, W, 1, A.goldDk);
  // frieze with engraved label
  r.rect(x0 + 1, friezeTop, W - 2, 7, A.parchment);
  r.rect(x0 + 1, friezeTop, W - 2, 1, COL_HI);
  r.rect(x0 + 1, friezeTop + 6, W - 2, 1, A.parchLo);
  if (o.label) drawText(r, o.label, Math.round(cx - textWidth(o.label) / 2), friezeTop + 1, A.violetDk);
  for (let x = x0 + 1; x < x1; x++) r.set(x, friezeTop + 7, x % 2 ? A.parchDk : A.parchLo);
  r.rect(x0 + 1, friezeTop + 8, W - 2, 1, A.parchLo);

  // interior wall
  for (let y = colTop; y < colBase; y++)
    for (let x = x0 + 2; x <= x1 - 2; x++) r.set(x, y, x % 4 === 0 ? A.violetDk : A.violetDeep);
  // columns
  const cw = 6;
  const span = W - 8 - cw;
  const colXs = Array.from({ length: o.cols }, (_, i) => Math.round(x0 + 4 + (span * i) / (o.cols - 1)));
  // bays: windows and the central door
  const mid = Math.floor((o.cols - 1) / 2);
  let doorX0 = cx - 6, doorX1 = cx + 5;
  for (let i = 0; i < o.cols - 1; i++) {
    const bx0 = colXs[i] + cw + 2, bx1 = colXs[i + 1] - 3;
    if (bx1 - bx0 < 3) continue;
    const isDoor = o.cols % 2 === 0 ? i === mid : i === mid || i === mid - 1 ? i === mid : false;
    if (isDoor) {
      doorX0 = bx0; doorX1 = bx1;
      const dTop = colTop + Math.round(o.colH * 0.3);
      for (let y = dTop; y < colBase; y++)
        for (let x = bx0; x <= bx1; x++) {
          const t = (y - dTop) / (colBase - dTop);
          const e = Math.abs(x - (bx0 + bx1) / 2) / ((bx1 - bx0) / 2 + 0.5);
          const v = 1 - t * 0.5 - e * 0.5;
          r.set(x, y, bayer(x, y) < v - 0.25 ? A.goldHi : bayer(x, y) < v + 0.1 ? A.gold : A.orange);
        }
      // arch
      for (let x = bx0; x <= bx1; x++) r.set(x, dTop - 1, A.goldLo);
      r.rect(Math.round((bx0 + bx1) / 2), dTop, 1, colBase - dTop, A.goldLo);
    } else {
      const wTop = colTop + 4, wBot = colBase - Math.round(o.colH * 0.25);
      for (let y = wTop; y <= wBot; y++)
        for (let x = bx0; x <= bx1; x++) {
          const pane = (x - bx0) % 3 === 2 || (y - wTop) % 4 === 3;
          r.set(x, y, pane ? A.violetDk : bayer(x, y) < 0.35 + (wBot - y) / (wBot - wTop) * 0.4 ? A.cyan : A.cyanLo);
        }
      r.rect(bx0, wTop - 1, bx1 - bx0 + 1, 1, A.parchLo);
      r.rect(bx0 - 1, wBot + 1, bx1 - bx0 + 3, 1, A.parchLo);
    }
  }
  const shaft = [COL_HI, A.parchment, A.parchLo, A.parchment, A.parchLo, A.parchDk];
  for (const cxl of colXs) {
    r.rect(cxl - 1, colTop, cw + 2, 1, A.parchment);
    r.rect(cxl, colTop + 1, cw, 1, A.parchLo);
    for (let y = colTop + 2; y < colBase - 2; y++) shaft.forEach((c, i) => r.set(cxl + i, y, c));
    r.rect(cxl, colBase - 2, cw, 1, A.parchLo);
    r.rect(cxl - 1, colBase - 1, cw + 2, 1, A.parchment);
  }
  // lanterns either side of the door
  for (const lx of [doorX0 - 2, doorX1 + 2]) {
    const ly = colTop + Math.round(o.colH * 0.45);
    for (let y = ly - 4; y <= ly + 5; y++) for (let x = lx - 4; x <= lx + 4; x++) {
      const d = Math.hypot(x - lx, y - ly - 0.5) / 5;
      if (d < 1 && bayer(x, y) < (1 - d) * 0.5 && r.get(x, y) !== A.parchment && r.get(x, y) !== COL_HI) r.set(x, y, A.goldLo);
    }
    r.set(lx, ly - 1, A.goldLo); r.set(lx, ly, A.goldHi); r.set(lx, ly + 1, A.gold);
  }
  // steps with the crimson carpet
  const cw2 = Math.max(4, doorX1 - doorX0 - 1);
  for (let s = 0; s < o.steps; s++) {
    const y = colBase + s * 2;
    const ix = x0 - 2 - s * 3, iw = W + 4 + s * 6;
    r.rect(ix, y, iw, 1, A.parchment);
    r.rect(ix, y + 1, iw, 1, A.parchDk);
    r.rect(Math.round(cx - cw2 / 2), y, cw2, 1, A.crimson);
    r.rect(Math.round(cx - cw2 / 2), y + 1, cw2, 1, A.crimsonLo);
  }
  statue(r, cx, pedTop + 1);
  return { top: pedTop - 12, doorX0, doorX1 };
}

/** Plaza tiles from y0 down, with the carpet running toward the viewer. */
export function plaza(r: Raster, y0: number, carpet?: { cx: number; w: number }): void {
  for (let y = y0; y < r.h; y++) {
    const band = Math.floor((y - y0) / 4);
    for (let x = 0; x < r.w; x++) {
      const tileEdge = (y - y0) % 4 === 0 || (x + band * 6) % 12 === 0;
      const fade = (y - y0) / (r.h - y0);
      let c = tileEdge ? A.night2 : bayer(x, y) < 0.3 - fade * 0.3 ? A.night2 : A.night1;
      if (y === y0) c = A.violetLo;
      r.set(x, y, c);
    }
  }
  if (carpet) {
    for (let y = y0; y < r.h; y++) {
      const grow = Math.floor((y - y0) / 3);
      const w = carpet.w + grow * 2;
      const xs = Math.round(carpet.cx - w / 2);
      for (let x = xs; x < xs + w; x++) r.set(x, y, (x === xs || x === xs + w - 1) ? A.goldLo : bayer(x, y) < 0.15 ? A.crimson : A.crimsonLo);
    }
  }
}

/** Stand Counsel figures with their feet on baseY. */
export function lineup(r: Raster, ids: number[], xs: number[], baseY: number): void {
  ids.forEach((id, i) => {
    const f = composeFigure(id);
    const x = xs[i];
    // dithered contact shadow
    for (let y = baseY - 1; y <= baseY + 1; y++)
      for (let xx = x + 3; xx <= x + 28; xx++) {
        const d = Math.hypot((xx - (x + 15.5)) / 13, (y - baseY) / 1.6);
        if (d < 1 && bayer(xx, y) < 0.85 - d * 0.5) r.set(xx, y, 0x000000);
      }
    r.blit(f, x, baseY - f.h + 1);
  });
}

function spread(n: number, x0: number, x1: number, w = 32): number[] {
  if (n === 1) return [Math.round((x0 + x1 - w) / 2)];
  return Array.from({ length: n }, (_, i) => Math.round(x0 + ((x1 - x0 - w) * i) / (n - 1)));
}

/** Small "COMD.FUN" domain tag: gold seal bullet + muted type, right-aligned at (xr, y). */
export function domainTag(r: Raster, xr: number, y: number, k = 1): void {
  const t = "COMD.FUN";
  const w = textWidth(t) * k;
  const x = xr - w;
  r.rect(x - 4 * k, y - 2 * k, w + 6 * k, 9 * k, A.black);
  r.rect(x - 3 * k, y + 1 * k, 2 * k, 3 * k, A.gold);
  r.rect(x - 3 * k, y + 1 * k, 1 * k, 1 * k, A.goldHi);
  drawText(r, t, x, y, A.parchment, k);
}

// A lineup with variety: founders + a spread of everyday Counsel.
export const LINEUP = [12, 1, 26, 6, 3, 21, 99, 2, 31, 150, 9, 42];

// ── assets (logical rasters + recommended unit) ─────────────────────────────────────────────
export interface Asset { r: Raster; unit: number; transparent?: boolean }

export function logoMark(variant: "color" | "mono" = "color"): Raster {
  return variant === "mono" ? monoMark(mark64()) : mark64();
}

export function logoHorizontal(transparent: boolean): Asset {
  const r = new Raster(300, 75, transparent ? T : A.black);
  const tk = 2, o = { k: tk, outline: A.black };
  const tw = titleWidth(WORDMARK_TEXT, o);
  const gap = 16;
  const total = 64 + gap + tw;
  const x0 = Math.round((300 - total) / 2);
  r.blit(mark64(), x0, 5);
  const th = titleHeight({ k: tk, depth: tk, outline: A.black });
  const blockH = th + 7 + 7;
  const ty = Math.round((75 - blockH) / 2) + 1;
  title(r, x0 + 64 + gap + tw / 2, ty, tk, TITLE_RAMP);
  const sy = ty + th + 6;
  const sub = "ATTORNEYS AT LAW";
  const sw = text7Width(sub);
  r.rect(x0 + 64 + gap + 1, sy + 3, tw - sw - 6 - 2, 1, A.goldLo);
  drawText7(r, sub, x0 + 64 + gap + tw - sw - 1, sy, A.muted);
  return { r, unit: 8, transparent };
}

export function logoStacked(): Asset {
  const r = new Raster(200, 200, A.black);
  r.blit(mark64(), 68, 46);
  const { h } = title(r, 100, 116, 2, TITLE_RAMP);
  const sub = "ATTORNEYS AT LAW";
  const sw = textWidth(sub) * 2;
  const sy = 116 + h + 8;
  drawText(r, sub, Math.round(100 - sw / 2), sy, A.muted, 2);
  r.rect(Math.round(100 - sw / 2) - 14, sy + 4, 8, 2, A.goldLo);
  r.rect(Math.round(100 + sw / 2) + 6, sy + 4, 8, 2, A.goldLo);
  return { r, unit: 8 };
}

function glow(r: Raster, cx: number, cy: number, rad: number, c: Color, strength = 0.6): void {
  for (let y = cy - rad; y <= cy + rad; y++)
    for (let x = cx - rad; x <= cx + rad; x++) {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d < 1 && bayer(x, y) < (1 - d) * strength) r.set(x, y, c);
    }
}

export function squareProfile(): Asset {
  const r = new Raster(100, 100, A.black);
  glow(r, 50, 50, 44, A.violetDeep, 0.7);
  glow(r, 50, 50, 30, A.night3, 0.35);
  r.blit(mark64(), 18, 18);
  return { r, unit: 4 };
}

export function appleTouch(): Raster {
  const r = new Raster(90, 90, A.black);
  glow(r, 45, 45, 40, A.violetDeep, 0.6);
  r.blit(mark64(), 13, 13);
  return r; // rendered at 2× → 180
}

export function favicon(size: 16 | 32 | 48): Raster {
  const r = new Raster(size, size, A.black);
  if (size === 16) r.blit(mark16(), 0, 0);
  else if (size === 32) r.blit(mark32(), 0, 0);
  else r.blit(mark32(), 8, 8);
  return r;
}

// ── banners ─────────────────────────────────────────────────────────────────────────────────
interface SceneSpec { w: number; h: number; horizon: number; seed: string }

function nightScene(s: SceneSpec): Raster {
  const r = new Raster(s.w, s.h, A.black);
  sky(r, 0, s.horizon);
  stars(r, s.seed, 0, 0, s.w, s.horizon - 10);
  return r;
}

export function heroBanner(): Asset {
  const W = 320, H = 180, horizon = 148;
  const r = nightScene({ w: W, h: H, horizon, seed: "hero" });
  moon(r, 292, 74, 9);
  city(r, "hero-back", 0, W, horizon, 24, 52, hex("#0D0828"), 0.2);
  city(r, "hero-front", 0, W, horizon, 10, 30, hex("#160D3A"), 0.32);
  const ch = courthouse(r, W / 2, horizon, 168, { cols: 6, colH: 36, steps: 4, label: "COMPANY.MD · NFT-IDENTIFIED SWARM" });
  plaza(r, horizon, { cx: W / 2, w: ch.doorX1 - ch.doorX0 - 1 });
  const ids = LINEUP.slice(0, 8);
  const left = spread(4, 6, 120), right = spread(4, 200, 314);
  lineup(r, ids, [...left, ...right], 172);
  title(r, W / 2, 6, 3);
  sublines(r, W / 2, 37);
  void ch;
  return { r, unit: 6 };
}

export function ogBanner(): Asset {
  const W = 240, H = 126, horizon = 110;
  const r = nightScene({ w: W, h: H, horizon, seed: "og" });
  moon(r, 218, 50, 7);
  city(r, "og-back", 0, W, horizon, 16, 36, hex("#0D0828"), 0.2);
  city(r, "og-front", 0, W, horizon, 8, 22, hex("#160D3A"), 0.3);
  const ch = courthouse(r, W / 2, horizon, 96, { cols: 4, colH: 23, steps: 3 });
  plaza(r, horizon, { cx: W / 2, w: ch.doorX1 - ch.doorX0 - 1 });
  lineup(r, [12, 1, 26, 6, 3, 21], [...spread(3, 2, 92), ...spread(3, 148, 238)], 121);
  title(r, W / 2, 4, 2);
  sublines(r, W / 2, 25);
  return { r, unit: 5 };
}

/** GitHub repository social preview (1280×640): the card GitHub renders when the repo link is shared. */
export function githubSocial(): Asset {
  const W = 256, H = 128, horizon = 112;
  const r = nightScene({ w: W, h: H, horizon, seed: "github" });
  moon(r, 232, 52, 7);
  city(r, "gh-back", 0, W, horizon, 16, 36, hex("#0D0828"), 0.2);
  city(r, "gh-front", 0, W, horizon, 8, 22, hex("#160D3A"), 0.3);
  const ch = courthouse(r, W / 2, horizon, 96, { cols: 4, colH: 23, steps: 3 });
  plaza(r, horizon, { cx: W / 2, w: ch.doorX1 - ch.doorX0 - 1 });
  lineup(r, [12, 1, 26, 6, 3, 21], [...spread(3, 2, 100), ...spread(3, 156, 254)], 123);
  title(r, W / 2, 4, 2);
  sublines(r, W / 2, 25);
  return { r, unit: 5 };
}

export function discordBanner(): Asset {
  const W = 240, H = 135, horizon = 116;
  const r = nightScene({ w: W, h: H, horizon, seed: "discord" });
  moon(r, 214, 58, 7);
  city(r, "dc-back", 0, W, horizon, 16, 38, hex("#0D0828"), 0.2);
  city(r, "dc-front", 0, W, horizon, 8, 24, hex("#160D3A"), 0.3);
  const ch = courthouse(r, W / 2, horizon, 100, { cols: 4, colH: 26, steps: 3 });
  plaza(r, horizon, { cx: W / 2, w: ch.doorX1 - ch.doorX0 - 1 });
  lineup(r, [99, 2, 31, 150, 9, 42], [...spread(3, 2, 92), ...spread(3, 148, 238)], 129);
  title(r, W / 2, 6, 2);
  sublines(r, W / 2, 27);
  return { r, unit: 4 };
}

/** X/Twitter header. The avatar overlaps the bottom-left (~400px = 100 units) — keep it clear. */
export function xHeader(): Asset {
  const W = 375, H = 125, horizon = 100;
  const r = nightScene({ w: W, h: H, horizon, seed: "x" });
  moon(r, 30, 22, 8);
  city(r, "x-back", 0, W, horizon, 16, 40, hex("#0D0828"), 0.2);
  city(r, "x-front", 0, W, horizon, 8, 24, hex("#160D3A"), 0.3);
  const cx = 306;
  const ch = courthouse(r, cx, horizon, 104, { cols: 4, colH: 30, steps: 3 });
  plaza(r, horizon, { cx, w: ch.doorX1 - ch.doorX0 - 1 });
  lineup(r, [12, 1, 26, 6, 3, 21], [...spread(4, 106, 262), ...spread(2, 318, 372)], 120);
  title(r, 152, 8, 2);
  sublines(r, 152, 30);
  return { r, unit: 4 };
}

export { spread };
