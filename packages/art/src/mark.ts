// Company.md mark: scales of justice in a pedimented portico, on steps with a crimson carpet.
// Three hand-placed masters: 64×64 (large uses), 32×32 (favicon-32, apple touch), 16×16 (favicon-16).
import { Raster, T, mix, type Color } from "./raster.js";
import { ARCADE as A } from "./palette.js";

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
/** Ordered-dither threshold in [0,1). */
export const bayer = (x: number, y: number) => (BAYER4[y & 3][x & 3] + 0.5) / 16;

const COL_HI = mix(A.parchment, 0xffffff, 0.5);

function hline(r: Raster, x0: number, x1: number, y: number, c: Color) {
  for (let x = x0; x <= x1; x++) r.set(x, y, c);
}
function vline(r: Raster, x: number, y0: number, y1: number, c: Color) {
  for (let y = y0; y <= y1; y++) r.set(x, y, c);
}

/** 64×64 colour master (transparent background). */
export function mark64(): Raster {
  const r = new Raster(64, 64);
  const oy = 2; // vertical centring
  const Y = (y: number) => y + oy;

  // finial
  hline(r, 31, 32, Y(0), A.goldHi);
  hline(r, 30, 33, Y(1), A.gold);
  // pediment y2..y16 (hw grows 2/row)
  for (let y = 2; y <= 16; y++) {
    const hw = 2 * (y - 2) + 2;
    const x0 = 32 - hw, x1 = 31 + hw;
    for (let x = x0; x <= x1; x++) {
      const edgeL = x - x0 < 2, edgeR = x1 - x < 2;
      r.set(x, Y(y), y >= 15 ? (y === 16 ? A.goldLo : A.gold) : edgeL ? A.goldHi : edgeR ? A.goldLo : A.gold);
    }
    // tympanum
    if (y >= 6 && y <= 13) {
      const hi = hw - 6;
      for (let x = 32 - hi; x <= 31 + hi; x++) r.set(x, Y(y), bayer(x, y) < (y - 6) / 10 ? A.violetDk : A.violetDeep);
    }
  }
  // cornice highlight line + shadow under it
  hline(r, 2, 61, Y(15), A.goldHi);
  hline(r, 2, 61, Y(17), A.goldDk);
  // wax seal in the tympanum
  const seal = [".rr.", "rhrr", "rrrl", ".ll."];
  seal.forEach((row, j) => [...row].forEach((ch, i) => ch !== "." && r.set(30 + i, Y(8 + j), ch === "h" ? mix(A.crimson, 0xffffff, 0.45) : ch === "l" ? A.crimsonLo : A.crimson)));

  // interior wall behind the colonnade, with a warm glow behind the scales
  for (let y = 18; y <= 48; y++)
    for (let x = 3; x <= 60; x++) {
      const d = Math.hypot((x - 31.5) / 1.15, y - 35) / 14;
      const stripe = (x % 4 === 0) ? A.violetDk : A.violetDeep;
      r.set(x, Y(y), bayer(x, y) > d * d ? (bayer(x + 1, y) > d * 1.6 ? A.violet : A.violetLo) : stripe);
    }
  // frieze with dentils
  hline(r, 3, 60, Y(18), A.parchment);
  for (let x = 3; x <= 60; x++) r.set(x, Y(19), x % 2 ? A.parchDk : A.parchLo);
  hline(r, 3, 60, Y(20), A.parchLo);

  // four columns
  const shaft = [COL_HI, A.parchment, A.parchLo, A.parchment, A.parchLo, A.parchDk];
  for (const cx of [5, 13, 45, 53]) {
    hline(r, cx - 1, cx + 6, Y(21), A.parchment);
    hline(r, cx, cx + 5, Y(22), A.parchLo);
    for (let y = 23; y <= 47; y++) shaft.forEach((c, i) => r.set(cx + i, Y(y), c));
    hline(r, cx, cx + 5, Y(48), A.parchLo);
    hline(r, cx - 1, cx + 6, Y(49), A.parchment);
  }

  // scales of justice
  hline(r, 31, 32, Y(22), A.goldHi);
  hline(r, 30, 33, Y(23), A.gold);
  hline(r, 31, 32, Y(24), A.goldLo);
  for (let y = 25; y <= 44; y++) { r.set(31, Y(y), A.gold); r.set(32, Y(y), A.goldLo); }
  hline(r, 21, 42, Y(26), A.goldHi);
  hline(r, 21, 42, Y(27), A.goldLo);
  for (const [x, c] of [[20, A.gold], [43, A.goldLo]] as const) vline(r, x, Y(25), Y(28), c);
  for (const pc of [24, 39]) {
    // strings: two diagonals from the hang point to the pan rim
    for (let i = 0; i <= 8; i++) {
      r.set(pc - Math.round(i / 2), Y(28 + i), A.goldLo);
      r.set(pc + Math.round(i / 2), Y(28 + i), A.goldLo);
    }
    hline(r, pc - 5, pc + 5, Y(37), A.goldHi);
    hline(r, pc - 5, pc + 5, Y(38), A.gold);
    hline(r, pc - 4, pc + 4, Y(39), A.goldLo);
    hline(r, pc - 2, pc + 2, Y(40), A.goldDk);
  }
  hline(r, 29, 34, Y(44), A.gold);
  hline(r, 28, 35, Y(45), A.gold);
  hline(r, 27, 36, Y(46), A.goldLo);
  hline(r, 26, 37, Y(47), A.goldDk);

  // steps with crimson carpet
  const steps: [number, number][] = [[2, 50], [1, 53], [0, 56]];
  for (const [inset, y0] of steps) {
    hline(r, inset, 63 - inset, Y(y0), A.parchment);
    hline(r, inset, 63 - inset, Y(y0 + 1), A.parchLo);
    hline(r, inset, 63 - inset, Y(y0 + 2), A.parchDk);
    hline(r, 27, 36, Y(y0), A.crimson);
    hline(r, 27, 36, Y(y0 + 1), A.crimsonLo);
    hline(r, 27, 36, Y(y0 + 2), mix(A.crimsonLo, 0, 0.35));
  }
  r.set(27, Y(50), A.gold); r.set(36, Y(50), A.gold); // brass stair rods
  r.set(27, Y(53), A.gold); r.set(36, Y(53), A.gold);
  r.set(27, Y(56), A.gold); r.set(36, Y(56), A.gold);
  return r;
}

/** 32×32 colour master, hand-tuned to stay legible at favicon size. */
export function mark32(): Raster {
  const r = new Raster(32, 32);
  const o = 2;
  // finial + pediment
  hline(r, 15, 16, 1 + o, A.goldHi);
  for (let y = 2; y <= 8; y++) {
    const hw = 2 * (y - 2) + 2, x0 = 16 - hw, x1 = 15 + hw;
    for (let x = x0; x <= x1; x++) r.set(x, y + o, y >= 7 ? A.gold : x === x0 ? A.goldHi : x === x1 ? A.goldLo : A.gold);
    if (y >= 4 && y <= 6) { const hi = hw - 4; hline(r, 16 - hi, 15 + hi, y + o, A.violetDeep); }
  }
  hline(r, 2, 29, 7 + o, A.goldHi);
  r.set(15, 5 + o, A.crimson); r.set(16, 5 + o, A.crimson); r.set(15, 4 + o, mix(A.crimson, 0xffffff, 0.4)); r.set(16, 4 + o, A.crimsonLo);
  hline(r, 2, 29, 9 + o, A.goldDk);
  // interior + glow
  for (let y = 10; y <= 22; y++)
    for (let x = 2; x <= 29; x++) {
      r.set(x, y + o, Math.abs(x - 15.5) < 5 && y >= 12 ? A.violetDk : A.violetDeep);
    }
  hline(r, 2, 29, 10 + o, A.parchLo);
  // columns: two per side, 3px (hi, base, lo)
  for (const cx of [3, 7, 22, 26]) {
    hline(r, cx - 1, cx + 3, 11 + o, A.parchment);
    for (let y = 12; y <= 22; y++) { r.set(cx, y + o, COL_HI); r.set(cx + 1, y + o, A.parchment); r.set(cx + 2, y + o, A.parchDk); }
  }
  // scales
  hline(r, 15, 16, 11 + o, A.goldHi);
  hline(r, 15, 16, 12 + o, A.gold);
  hline(r, 11, 20, 13 + o, A.gold);
  for (let y = 14; y <= 20; y++) { r.set(15, y + o, A.gold); r.set(16, y + o, A.goldLo); }
  for (const pc of [12, 19]) {
    r.set(pc, 14 + o, A.goldLo); r.set(pc, 15 + o, A.goldLo);
    hline(r, pc - 2, pc + 2, 16 + o, A.gold);
    hline(r, pc - 1, pc + 1, 17 + o, A.goldLo);
  }
  hline(r, 13, 18, 21 + o, A.gold);
  hline(r, 12, 19, 22 + o, A.goldLo);
  // steps
  const st: [number, number, Color][] = [[2, 23, A.parchment], [1, 24, A.parchLo], [0, 25, A.parchment], [0, 26, A.parchDk]];
  for (const [i, y, c] of st) hline(r, i, 31 - i, y + o, c);
  hline(r, 14, 17, 23 + o, A.crimson); hline(r, 14, 17, 24 + o, A.crimsonLo);
  hline(r, 14, 17, 25 + o, A.crimson); hline(r, 14, 17, 26 + o, A.crimsonLo);
  return r;
}

/** 16×16 favicon master. */
export function mark16(): Raster {
  const rows = [
    "................",
    "................",
    ".......yy.......",
    ".....yGGGGg.....",
    "...yGGGrrGGGg...",
    ".YYYYYYYYYYYYYY.",
    ".dddddddddddddd.",
    ".hpvvvvGgvvvvhp.",
    ".hpvGGGGGGGGvhp.",
    ".hpvgvvGgvvgvhp.",
    ".hpGGGvGgvGGGhp.",
    ".hpvvvvGgvvvvhp.",
    ".hpvvvGGGgvvvhp.",
    ".PPPPPPccPPPPPP.",
    "LLLLLLLccLLLLLLL",
    "................",
  ];
  const key: Record<string, Color> = {
    y: A.goldHi, G: A.gold, g: A.goldLo, r: A.crimson, d: A.goldDk, Y: A.goldHi,
    h: A.parchment, p: A.parchDk, v: A.violetDeep, l: A.violetLo, P: A.parchment, L: A.parchLo, c: A.crimson,
  };
  const r = new Raster(16, 16);
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && r.set(x, y, key[ch])));
  return r;
}

const MONO_DROP = new Set<Color>([A.violetDeep, A.violetDk, A.violetLo, A.violet, A.goldDk, A.parchDk, mix(A.crimsonLo, 0, 0.35)]);

/** Single-colour gold mono version: interior and shadow tones knocked out to transparent. */
export function monoMark(src: Raster, color: Color = A.gold): Raster {
  const r = src.clone();
  r.map((c) => (MONO_DROP.has(c) ? T : color));
  for (let i = 0; i < r.px.length; i++) if (MONO_DROP.has(src.px[i])) r.px[i] = T;
  return r;
}
