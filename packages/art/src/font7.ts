// "Docket Arcade 7×7" — a chunky display face (2px stems) in the spirit of Press Start 2P,
// plus an arcade title renderer (stepped colour bands, extruded shadow, 1-unit outline).
import { Raster, T, mix, type Color } from "./raster.js";

const G7: Record<string, string> = {
  A: "..###.. .##.##. ##...## ##...## ####### ##...## ##...##",
  B: "######. ##...## ##...## ######. ##...## ##...## ######.",
  C: "..####. .##..## ##..... ##..... ##..... .##..## ..####.",
  D: "#####.. ##..##. ##...## ##...## ##...## ##..##. #####..",
  E: "####### ##..... ##..... ######. ##..... ##..... #######",
  F: "####### ##..... ##..... ######. ##..... ##..... ##.....",
  G: "..##### .##.... ##..... ##..### ##...## .##..## ..#####",
  H: "##...## ##...## ##...## ####### ##...## ##...## ##...##",
  I: "######. ..##... ..##... ..##... ..##... ..##... ######.",
  J: "....### .....## .....## .....## ##...## ##...## .#####.",
  K: "##...## ##..##. ##.##.. ####... #####.. ##..##. ##...##",
  L: "##..... ##..... ##..... ##..... ##..... ##..... #######",
  M: "##...## ###.### ####### ####### ##.#.## ##...## ##...##",
  N: "##...## ###..## ####.## ####### ##.#### ##..### ##...##",
  O: ".#####. ##...## ##...## ##...## ##...## ##...## .#####.",
  P: "######. ##...## ##...## ##...## ######. ##..... ##.....",
  Q: ".#####. ##...## ##...## ##...## ##.#### ##..##. .####.#",
  R: "######. ##...## ##...## ##..### #####.. ##.###. ##..###",
  S: ".####.. ##..##. ##..... .#####. .....## ##...## .#####.",
  T: "######. ..##... ..##... ..##... ..##... ..##... ..##...",
  U: "##...## ##...## ##...## ##...## ##...## ##...## .#####.",
  V: "##...## ##...## ##...## ###.### .#####. ..###.. ...#...",
  W: "##...## ##...## ##.#.## ####### ####### ###.### ##...##",
  X: "##...## ###.### .#####. ..###.. .#####. ###.### ##...##",
  Y: "##..##. ##..##. ##..##. .####.. ..##... ..##... ..##...",
  Z: "####### ....### ...###. ..###.. .###... ###.... #######",
  "0": ".#####. ##...## ##..### ##.#.## ###..## ##...## .#####.",
  "1": "..##... .###... ..##... ..##... ..##... ..##... ######.",
  "2": ".#####. ##...## ....### ..####. .###... ###.... #######",
  "3": "####### ....##. ...##.. ..####. .....## ##...## .#####.",
  "4": "...###. ..####. .##.##. ##..##. ####### ....##. ....##.",
  "5": "######. ##..... ######. .....## .....## ##...## .#####.",
  "6": "..####. .##.... ##..... ######. ##...## ##...## .#####.",
  "7": "####### ##...## ....##. ...##.. ..##... ..##... ..##...",
  "8": ".####.. ##..##. ###.##. .####.. ##..### ##...## .#####.",
  "9": ".#####. ##...## ##...## .###### .....## ....##. .####..",
  $: "...#... .#####. ##.#... .#####. ...#.## .#####. ...#...",
  ",": "....... ....... ....... ....... ..##... ..##... .##....",
  ".": "....... ....... ....... ....... ....... ..##... ..##...",
  "·": "....... ....... ..##... ..##... ....... ....... .......",
  "-": "....... ....... ....... .#####. ....... ....... .......",
  ":": "....... ..##... ..##... ....... ..##... ..##... .......",
  "!": "..##... ..##... ..##... ..##... ..##... ....... ..##...",
  "#": ".##.##. ####### .##.##. .##.##. .##.##. ####### .##.##.",
  "/": ".....## ....##. ...##.. ..##... .##.... ##..... #......",
  "&": ".###... ##.##.. .###... .###.## ##.###. ##..##. .###.##",
  "'": "..##... ..##... .##.... ....... ....... ....... .......",
  // "•" — the Company.md seal dot (rendered as a round wax seal by drawTitle)
  "•": "....... ....... ....... .###... #####.. #####.. .###...",
};

const GLYPHS7: Record<string, boolean[][]> = Object.fromEntries(
  Object.entries(G7).map(([k, v]) => [k, v.split(" ").map((row) => [...row].map((c) => c === "#"))]),
);
for (const [k, g] of Object.entries(GLYPHS7)) if (g.length !== 7 || g.some((r) => r.length !== 7)) throw new Error(`font7 glyph ${k}`);

const adv7 = (ch: string) => (ch === " " ? 4 : ch === "•" ? 6 : ch === "·" || ch === "," || ch === "." || ch === "'" || ch === ":" || ch === "!" ? 5 : 8);
const offs7 = (ch: string) => (ch === "•" ? 0 : ch === "·" || ch === "," || ch === "." || ch === "'" || ch === ":" || ch === "!" ? -1 : 0);

export function text7Width(s: string, k = 1): number {
  let w = 0;
  for (const ch of s.toUpperCase()) w += adv7(ch);
  return Math.max(0, w - 1) * k;
}

/** Plain 7×7 text at integer scale k. `color` may vary per character index. */
export function drawText7(r: Raster, s: string, x: number, y: number, color: Color | ((i: number) => Color), k = 1): void {
  let cx = x;
  [...s.toUpperCase()].forEach((ch, i) => {
    const g = GLYPHS7[ch];
    const c = typeof color === "function" ? color(i) : color;
    if (g) for (let j = 0; j < 7; j++) for (let q = 0; q < 7; q++) if (g[j][q]) r.rect(cx + (q + offs7(ch)) * k, y + j * k, k, k, c);
    cx += adv7(ch) * k;
  });
}

export type Ramp = readonly [Color, Color, Color]; // hi, base, lo

export interface TitleOptions {
  /** Glyph scale (each font pixel = k×k units). */
  k: number;
  /** Colour ramp per character index (spaces included). */
  ramp: (i: number) => Ramp;
  /** Extrusion colour and depth in units (drawn straight down). */
  shadow?: Color;
  depth?: number;
  /** 1-unit outline colour around everything (default black). null = none. */
  outline?: Color | null;
}

/** Height in units including outline and extrusion. */
export function titleHeight(o: Pick<TitleOptions, "k" | "depth" | "outline">): number {
  return 7 * o.k + (o.depth ?? o.k) + (o.outline === null ? 0 : 2);
}
export function titleWidth(s: string, o: Pick<TitleOptions, "k" | "outline">): number {
  return text7Width(s, o.k) + (o.outline === null ? 0 : 2);
}

/** Arcade title: stepped hi/base/lo bands per glyph row, extruded shadow, crisp 1-unit outline. (x,y) = outer top-left. */
export function drawTitle(r: Raster, s: string, x: number, y: number, o: TitleOptions): void {
  const k = o.k, depth = o.depth ?? k, ol = o.outline === null ? 0 : 1;
  const W = text7Width(s, k), H = 7 * k;
  // fill + band index per unit pixel
  const fill = new Raster(W, H);
  let cx = 0;
  [...s.toUpperCase()].forEach((ch, i) => {
    const g = GLYPHS7[ch];
    const [hi, base, lo] = o.ramp(i);
    const mid = mix(base, lo, 0.5);
    if (ch === "•") {
      // round wax seal sitting on the baseline: lit rim, recessed face, a stamped centre
      const rad = 1.9 * k, scx = cx + 2.4 * k, scy = 7 * k - rad;
      for (let yy = Math.floor(scy - rad); yy < Math.ceil(scy + rad); yy++)
        for (let xx = Math.floor(scx - rad); xx < Math.ceil(scx + rad); xx++) {
          const d = Math.hypot(xx + 0.5 - scx, yy + 0.5 - scy);
          if (d > rad) continue;
          const rim = d > rad - Math.max(1, k * 0.75);
          const lit = xx + 0.5 - scx + (yy + 0.5 - scy) < 0;
          let c = rim ? (lit ? hi : lo) : base;
          if (!rim && d < rad * 0.38) c = lit ? lo : mid; // stamped centre
          fill.set(xx, yy, c);
        }
      cx += adv7(ch) * k;
      return;
    }
    if (g)
      for (let j = 0; j < 7; j++)
        for (let q = 0; q < 7; q++) {
          if (!g[j][q]) continue;
          const c = j === 0 ? hi : j <= 3 ? base : j <= 5 ? mid : lo;
          for (let a = 0; a < k; a++)
            for (let b = 0; b < k; b++) {
              // a 1-unit highlight on the top edge of every stroke run, 1-unit lo on the bottom row
              let cc = c;
              const above = j > 0 && g[j - 1][q];
              if (a === 0 && !above && j > 0) cc = hi;
              fill.set(cx + (q + offs7(ch)) * k + b, j * k + a, cc);
            }
        }
    cx += adv7(ch) * k;
  });
  const ox = x + ol, oy = y + ol;
  const solid = (xx: number, yy: number) => fill.get(xx, yy) !== T;
  // extrusion
  if (o.shadow !== undefined)
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) if (solid(xx, yy)) for (let d = 1; d <= depth; d++) r.set(ox + xx, oy + yy + d, o.shadow);
  // outline around fill ∪ extrusion
  if (ol) {
    const occ = (xx: number, yy: number) => {
      for (let d = 0; d <= (o.shadow !== undefined ? depth : 0); d++) if (solid(xx, yy - d)) return true;
      return false;
    };
    const outline = o.outline ?? 0x000000;
    for (let yy = -1; yy <= H + depth; yy++)
      for (let xx = -1; xx <= W; xx++) {
        if (occ(xx, yy)) continue;
        if (occ(xx - 1, yy) || occ(xx + 1, yy) || occ(xx, yy - 1) || occ(xx, yy + 1)) r.set(ox + xx, oy + yy, outline);
      }
  }
  r.blit(fill, ox, oy);
}
