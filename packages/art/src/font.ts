// "Docket 3×5" — a tiny pixel font. Each glyph is 5 rows of 3 bits ('#' on). Advance 4px.
import { Raster, type Color } from "./raster.js";

const G: Record<string, string> = {
  A: "### #.# ### #.# #.#", B: "##. #.# ##. #.# ##.", C: "### #.. #.. #.. ###", D: "##. #.# #.# #.# ##.",
  E: "### #.. ##. #.. ###", F: "### #.. ##. #.. #..", G: "### #.. #.# #.# ###", H: "#.# #.# ### #.# #.#",
  I: "### .#. .#. .#. ###", J: "..# ..# ..# #.# ###", K: "#.# #.# ##. #.# #.#", L: "#.. #.. #.. #.. ###",
  M: "#.# ### ### #.# #.#", N: "##. #.# #.# #.# #.#", O: "### #.# #.# #.# ###", P: "### #.# ### #.. #..",
  Q: "### #.# #.# ### ..#", R: "### #.# ##. #.# #.#", S: "### #.. ### ..# ###", T: "### .#. .#. .#. .#.",
  U: "#.# #.# #.# #.# ###", V: "#.# #.# #.# #.# .#.", W: "#.# #.# ### ### #.#", X: "#.# #.# .#. #.# #.#",
  Y: "#.# #.# ### .#. .#.", Z: "### ..# .#. #.. ###",
  "0": "### #.# #.# #.# ###", "1": ".#. ##. .#. .#. ###", "2": "### ..# ### #.. ###", "3": "### ..# .## ..# ###",
  "4": "#.# #.# ### ..# ..#", "5": "### #.. ### ..# ###", "6": "### #.. ### #.# ###", "7": "### ..# ..# .#. .#.",
  "8": "### #.# ### #.# ###", "9": "### #.# ### ..# ###",
  "#": "#.# ### #.# ### #.#", ".": "... ... ... ... .#.", ",": "... ... ... .#. #..", "-": "... ... ### ... ...",
  ":": "... .#. ... .#. ...", "/": "..# ..# .#. #.. #..", "$": ".## ##. .#. .## ##.", "'": ".#. .#. ... ... ...",
  "(": ".#. #.. #.. #.. .#.", ")": ".#. ..# ..# ..# .#.", "&": ".#. #.# .#. #.# .##", "+": "... .#. ### .#. ...",
  "=": "... ### ... ### ...", "?": "### ..# .## ... .#.", "!": ".#. .#. .#. ... .#.", "§": ".## .#. #.# .#. ##.",
  "·": "... ... .#. ... ...",
  " ": "... ... ... ... ...",
};

const GLYPHS: Record<string, boolean[][]> = Object.fromEntries(
  Object.entries(G).map(([k, v]) => [k, v.split(" ").map((row) => [...row].map((c) => c === "#"))]),
);

export const FONT_H = 5;
export const ADVANCE = 4;

const adv = (ch: string) => (ch === " " ? 2 : ADVANCE);

/** Width in px (glyphs advance 4px, a space advances 2px; no trailing gap). */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += adv(ch);
  return Math.max(0, w - 1);
}

/** Draw text with the 3×5 font. Unknown glyphs render as a filled box. */
export function drawText(r: Raster, s: string, x: number, y: number, c: Color, scale = 1): void {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS["?"];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j][i]) r.rect(cx + i * scale, y + j * scale, scale, scale, c);
    cx += adv(ch) * scale;
  }
}

export const ROMAN = (n: number): string => {
  const t: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, k] of t) while (n >= v) { s += k; n -= v; }
  return s;
};
