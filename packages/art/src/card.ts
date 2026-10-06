// 64×80 "bar card": portrait at 2×, brass nameplate, chambers numeral, practice code, wax seal.
import { Raster, mix, type Color } from "./raster.js";
import { P, BRAND } from "./palette.js";
import { drawText, textWidth, ROMAN } from "./font.js";
import { composeCounsel, PRACTICE_COLOR, PRACTICE_CODE } from "./counsel.js";
import { traitsOf, chambersOf } from "./traits.js";

export const CARD_W = 64;
export const CARD_H = 80;

/** 5×5 wax seal with a stamped mark. */
export function drawSeal(r: Raster, x: number, y: number, base: Color = P.ox): void {
  const hi = mix(base, 0xffffff, 0.35), lo = mix(base, 0x000000, 0.45);
  const g = [".bbb.", "bhbbl", "bbmbl", "bblll", ".lll."];
  r.sprite(g, x, y, { b: base, h: hi, l: lo, m: mix(base, 0x000000, 0.65) });
}

export function composeCard(tokenId: number): Raster {
  const t = traitsOf(tokenId);
  const r = new Raster(CARD_W, CARD_H, BRAND.black);
  const frame = t.founder ? P.brassHi : P.brass;

  // portrait at 2× fills the top 64×64 (its own 1px brass frame becomes the card's 2px border)
  r.blit(composeCounsel(tokenId, t), 0, 0, 2);

  // 2px brass border down the sides and along the bottom
  r.rect(0, 64, 2, 16, P.brass);
  r.rect(62, 64, 2, 16, P.brass);
  r.rect(0, 78, 64, 2, P.brass);
  if (t.founder) {
    r.rect(0, 0, 64, 1, frame); r.rect(0, 0, 1, 80, frame); r.rect(63, 0, 1, 80, frame); r.rect(0, 79, 64, 1, frame);
  }
  // stepped pixel corners
  for (const [x, y] of [[0, 0], [63, 0], [0, 79], [63, 79]]) r.set(x, y, BRAND.black);

  // brass nameplate (engraved text) — y65..71
  r.rect(3, 65, 58, 7, P.brass);
  r.rect(3, 65, 58, 1, P.brassHi);
  r.rect(3, 71, 58, 1, P.brassLo);
  const label = `COUNSEL #${String(tokenId).padStart(4, "0")}`;
  drawText(r, label, 5, 66, P.brassDk);
  drawSeal(r, 55, 66, t.founder ? BRAND.verdigris : P.ox);

  // second line: chambers numeral (muted parchment) + practice code (practice colour)
  drawText(r, `CH. ${ROMAN(chambersOf(tokenId))}`, 4, 73, BRAND.muted);
  const code = t.founder ? "FP" : PRACTICE_CODE[t.practice];
  const pc = t.founder ? P.brassHi : PRACTICE_COLOR[t.practice];
  const cx = 60 - textWidth(code);
  drawText(r, code, cx, 73, pc);
  if (t.founder) {
    // Founding Partners: practice code in brass plus a small star rule
    const pcode = PRACTICE_CODE[t.practice];
    drawText(r, pcode, cx - 4 - textWidth(pcode), 73, PRACTICE_COLOR[t.practice]);
  }
  return r;
}
