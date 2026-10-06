// The home-page scene: a pixel courthouse at night on a 200×120 grid. Pure SVG rectangles + CSS steps() animation:
// stars twinkle, windows blink, the scales of justice tip, the judge's gavel slams (impact burst + tiny shake),
// counsel walk across the plaza with a two-frame bob. No images, no scripts. Reduced motion freezes every frame.
import type { CSSProperties, ReactNode } from "react";

type R = { x: number; y: number; w: number; h: number; f: string; c?: string; s?: CSSProperties };

const K = {
  gold: "#ffc83d", goldHi: "#ffe598", goldDk: "#b07a00",
  pink: "#ff4fd8", pinkDk: "#b01f93", cyan: "#2de2e6", cyanDk: "#0b8f93", lime: "#8cff3a", limeDk: "#49a812",
  orange: "#ff8a1f", orangeDk: "#b35500", violet: "#9b5cff", violetDk: "#5b2bc4", violetDeep: "#2e1470", crimson: "#ff3b5c", crimsonDk: "#b0123a",
  st1: "#f3ebd3", st2: "#d2c6a5", st3: "#a0957a", st4: "#615847", st5: "#2b2620",
  wall: "#140f20", wall2: "#1d162d", sky2: "#0c0916",
  wood: "#6b3f1d", woodHi: "#9a6234", woodDk: "#3b210e",
  skin: "#e7b48b", skin2: "#b97a52", skin3: "#7a4b2e", wig: "#f3ebd3", wig2: "#bdb39a", robe: "#0d0b12", ink: "#000",
};

/** Merge pixel-art rows into rectangles. `key` maps characters to colours; "." is transparent. */
function art(x0: number, y0: number, rows: string[], key: Record<string, string>, c?: string, s?: CSSProperties): R[] {
  const out: R[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      if (ch !== "." && key[ch]) out.push({ x: x0 + x, y: y0 + y, w, h: 1, f: key[ch], c, s });
      x += w;
    }
  });
  return out;
}

const FONT: Record<string, string[]> = {
  T: ["###", ".#.", ".#.", ".#.", ".#."], H: ["#.#", "#.#", "###", "#.#", "#.#"], E: ["###", "#..", "##.", "#..", "###"],
  C: [".##", "#..", "#..", "#..", ".##"], O: [".#.", "#.#", "#.#", "#.#", ".#."], M: ["#.#", "###", "###", "#.#", "#.#"],
  P: ["##.", "#.#", "##.", "#..", "#.."], A: [".#.", "#.#", "###", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"], Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  D: ["##.", "#.#", "#.#", "#.#", "##."], ".": [".", ".", ".", ".", "#"],
};
function text(x0: number, y0: number, s: string, f: string): R[] {
  const out: R[] = [];
  let x = x0;
  for (const ch of s) {
    if (ch === " ") { x += 3; continue; }
    out.push(...art(x, y0, FONT[ch], { "#": f }));
    x += ch === "." ? 2 : 4;
  }
  return out;
}

const rect = (x: number, y: number, w: number, h: number, f: string, c?: string, s?: CSSProperties): R => ({ x, y, w, h, f, c, s });

// ---------------------------------------------------------------------------------------------- static layers
function sky(): R[] {
  const r: R[] = [];
  // moon (crescent)
  r.push(...art(14, 6, [
    "..gggg..",
    ".ggGGgg.",
    "gggG....",
    "ggg.....",
    "ggg.....",
    "gggG....",
    ".ggGGgg.",
    "..gggg..",
  ], { g: K.gold, G: K.goldHi }));
  // far skyline
  const sk: [number, number, number][] = [[0, 46, 9], [9, 38, 7], [16, 44, 10], [26, 34, 6], [33, 42, 8], [158, 40, 8], [166, 33, 7], [173, 44, 9], [182, 37, 8], [190, 45, 10]];
  for (const [x, y, w] of sk) {
    r.push(rect(x, y, w, 98 - y, K.sky2));
    for (let yy = y + 3; yy < 52; yy += 4) for (let xx = x + 2; xx < x + w - 1; xx += 3) if ((xx * 7 + yy * 3) % 5 === 0) r.push(rect(xx, yy, 1, 1, ["#0b6f72", "#7a1f68", "#7a5c12", "#3d6b14"][(xx + yy) % 4]));
  }
  return r;
}

function stars(): ReactNode[] {
  const pts: [number, number, string, number][] = [
    [40, 6, K.st1, 0], [52, 14, K.cyan, 0.6], [63, 4, K.st1, 1.2], [75, 11, K.pink, 1.8], [128, 5, K.st1, 0.3], [139, 15, K.gold, 0.9], [151, 8, K.st1, 1.5],
    [166, 18, K.cyan, 2.1], [182, 6, K.st1, 0.4], [193, 21, K.lime, 1.1], [6, 22, K.st1, 1.7], [31, 26, K.violet, 0.2], [118, 2, K.st1, 2.3], [88, 3, K.cyan, 1.4],
    [47, 30, K.st1, 0.8], [157, 28, K.pink, 1.9], [176, 28, K.st1, 0.5], [3, 3, K.gold, 1.3], [110, 9, K.st1, 0.7], [70, 24, K.st1, 2.0],
  ];
  return pts.map(([x, y, f, d], i) => (
    <rect key={`s${i}`} x={x} y={y} width={i % 4 === 0 ? 2 : 1} height={i % 4 === 0 ? 2 : 1} fill={f} className="sc-star" style={{ ["--dl" as string]: `${d}s`, ["--tw" as string]: `${2 + (i % 5) * 0.6}s` } as CSSProperties} />
  ));
}

function scales(): ReactNode {
  // pole + finial (static)
  const pole = [...art(97, 3, ["..G..", ".GgG.", "GgggG", ".GgG.", "..G.."], { G: K.goldDk, g: K.gold }), rect(99, 8, 2, 14, K.gold), rect(100, 8, 1, 14, K.goldDk), rect(96, 20, 8, 2, K.goldDk), rect(97, 19, 6, 1, K.gold)];
  const beam = [rect(87, 12, 26, 2, K.gold), rect(87, 13, 26, 1, K.goldDk), rect(86, 11, 2, 4, K.goldHi), rect(112, 11, 2, 4, K.goldHi), rect(98, 10, 4, 5, K.goldHi)];
  const pan = (x: number) => [rect(x, 14, 1, 5, K.goldDk), rect(x + 6, 14, 1, 5, K.goldDk), rect(x - 1, 19, 9, 1, K.gold), rect(x, 20, 7, 1, K.gold), rect(x + 1, 21, 5, 1, K.goldDk)];
  const draw = (rs: R[], k: string) => rs.map((q, i) => <rect key={`${k}${i}`} x={q.x} y={q.y} width={q.w} height={q.h} fill={q.f} />);
  return (
    <g>
      {draw(pole, "sp")}
      <g className="sc-beam">
        {draw(beam, "sb")}
        <g className="sc-panL">{draw(pan(85), "pl")}</g>
        <g className="sc-panR">{draw(pan(108), "pr")}</g>
      </g>
    </g>
  );
}

function building(): R[] {
  const r: R[] = [];
  // wings
  for (const [x, w] of [[6, 36], [158, 36]] as const) {
    r.push(rect(x, 52, w, 46, K.st3), rect(x, 52, w, 2, K.gold), rect(x, 54, w, 1, K.goldDk), rect(x + 1, 55, w - 2, 1, K.st2));
    for (let yy = 60; yy < 98; yy += 6) r.push(rect(x, yy, w, 1, K.st4));
    r.push(rect(x, 94, w, 4, K.st4));
  }
  // portico back wall
  r.push(rect(40, 48, 120, 40, K.wall));
  // pediment (stepped triangle) with gold rake
  for (let y = 22; y < 40; y++) {
    const hw = Math.round((y - 21) * 3.55);
    r.push(rect(100 - hw, y, hw * 2, 1, y < 24 ? K.gold : K.st2));
    if (y >= 24) r.push(rect(100 - hw, y, 3, 1, K.gold), rect(100 + hw - 3, y, 3, 1, K.gold), rect(100 - hw + 3, y, 1, 1, K.goldDk), rect(100 + hw - 4, y, 1, 1, K.goldDk));
  }
  // tympanum seal
  r.push(...art(94, 28, [
    "..gggggg..",
    ".gvvvvvvg.",
    "gvvvgg vvg".replace(" ", "v"),
    "gvgvggvgvg",
    "gvvvggvvvg",
    ".gvvggvvg.",
    "..gggggg..",
  ], { g: K.gold, v: K.violetDk }));
  // cornice + frieze + architrave
  r.push(rect(34, 40, 132, 1, K.goldHi), rect(34, 41, 132, 1, K.gold), rect(36, 42, 128, 6, K.st2), rect(36, 47, 128, 1, K.st3));
  for (let x = 37; x < 164; x += 4) r.push(rect(x, 47, 2, 1, K.st4));
  r.push(...text(81, 42, "COMPANY", K.violetDk), ...text(109, 42, ".MD", K.crimsonDk));
  // columns
  for (const x of [44, 58, 72, 120, 134, 148]) {
    r.push(rect(x - 1, 48, 10, 2, K.st1), rect(x - 1, 50, 10, 1, K.st3));
    r.push(rect(x, 51, 8, 33, K.st2), rect(x, 51, 1, 33, K.st3), rect(x + 1, 51, 2, 33, K.st1), rect(x + 4, 51, 1, 33, K.st3), rect(x + 6, 51, 1, 33, K.st3), rect(x + 7, 51, 1, 33, K.st4));
    r.push(rect(x - 1, 84, 10, 1, K.st3), rect(x - 2, 85, 12, 3, K.st1), rect(x - 2, 87, 12, 1, K.st3));
  }
  // stairs
  for (let k = 0; k < 5; k++) {
    const y = 88 + k * 2;
    r.push(rect(38 - k * 2, y, 124 + k * 4, 2, k % 2 ? K.st3 : K.st2), rect(38 - k * 2, y, 124 + k * 4, 1, k % 2 ? K.st2 : K.st1));
  }
  return r;
}

function interior(): R[] {
  const r: R[] = [];
  // drape
  r.push(rect(80, 48, 40, 40, K.violetDeep));
  for (let x = 81; x < 120; x += 4) r.push(rect(x, 51, 2, 37, K.violetDk));
  r.push(rect(80, 48, 40, 3, K.gold), rect(80, 51, 40, 1, K.goldDk));
  for (let x = 82; x < 120; x += 6) r.push(rect(x, 52, 2, 2, K.gold));
  // seal on drape
  r.push(...art(96, 54, ["..gggg..", ".gg..gg.", "gg.gg.gg", "gg.gg.gg", ".gg..gg.", "..gggg.."], { g: K.gold }));
  // the judge (wig, face, robe)
  r.push(...art(95, 59, [
    "..wwwwww..",
    ".wwwwwwww.",
    "wwWssssWww",
    "wwsesseswW",
    "wWssssssWw",
    "ww.sxxs.ww",
    "wW.ssss.Ww",
    ".rrrccrrr.",
    "rrrrccrrrr",
    "rrrrrrrrrr",
  ], { w: K.wig, W: K.wig2, s: K.skin, e: K.ink, x: K.crimsonDk, r: K.robe, c: K.st1 }));
  // bench
  r.push(rect(82, 69, 36, 2, K.woodHi), rect(83, 71, 34, 15, K.wood), rect(83, 85, 34, 1, K.woodDk));
  for (const x of [86, 97, 108]) r.push(rect(x, 74, 7, 9, K.woodDk), rect(x + 1, 75, 5, 7, K.wood));
  r.push(rect(95, 77, 10, 3, K.gold), rect(96, 78, 8, 1, K.goldDk));
  // sound block
  r.push(rect(111, 66, 8, 3, K.woodDk), rect(111, 66, 8, 1, K.woodHi));
  // side lamps on the bench
  r.push(rect(84, 65, 2, 4, K.st4), rect(83, 63, 4, 2, K.lime));
  return r;
}

function plaza(): R[] {
  const r: R[] = [];
  for (let y = 98; y < 120; y += 4) for (let x = 0; x < 200; x += 4) r.push(rect(x, y, 4, 4, ((x + y) / 4) % 2 ? "#0e0b16" : "#15111f"));
  r.push(rect(0, 98, 200, 1, "#2a2238"));
  // red carpet
  r.push(rect(90, 98, 20, 22, K.crimsonDk), rect(90, 98, 2, 22, K.gold), rect(108, 98, 2, 22, K.gold));
  for (let y = 101; y < 120; y += 5) r.push(rect(98, y, 4, 2, K.crimson));
  // lamp posts
  for (const x of [26, 172]) r.push(rect(x, 84, 2, 14, "#3b3647"), rect(x - 2, 97, 6, 1, "#3b3647"), rect(x - 2, 80, 6, 1, "#3b3647"));
  return r;
}

// ---------------------------------------------------------------------------------------------- animated bits
function windows(): ReactNode[] {
  const W: [number, number, string, number, number][] = [
    [11, 60, K.gold, 0, 5], [21, 60, K.cyan, 1.2, 6.5], [11, 76, K.pink, 2.5, 7], [21, 76, K.gold, 0.6, 4.6],
    [173, 60, K.lime, 1.8, 5.8], [183, 60, K.gold, 0.2, 6.1], [173, 76, K.gold, 3.1, 7.4], [183, 76, K.cyan, 1.4, 5.2],
    [53, 56, K.gold, 0.9, 8], [67, 56, K.pink, 2.2, 6.8], [129, 56, K.cyan, 1.6, 7.2], [143, 56, K.gold, 0.4, 6],
  ];
  return W.map(([x, y, c, d, dur], i) => {
    const tall = y === 56;
    const h = tall ? 26 : 9;
    const w = tall ? 4 : 6;
    return (
      <g key={`w${i}`}>
        <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill={K.st4} />
        <rect x={x} y={y} width={w} height={h} className="sc-win" fill={c} style={{ ["--wc" as string]: c, ["--dl" as string]: `${d}s`, ["--wd" as string]: `${dur}s` } as CSSProperties} />
        <rect x={x + Math.floor(w / 2)} y={y} width={1} height={h} fill={K.st4} />
        {!tall && <rect x={x} y={y + 4} width={w} height={1} fill={K.st4} />}
      </g>
    );
  });
}

function banners(): ReactNode[] {
  const one = (x: number, c: string, dk: string, k: string) => {
    const body = art(x, 58, ["ccccc", "ccccc", "cgggc", "cgcgc", "cgggc", "ccgcc", "cgggc", "ccccc", "ccccc", "ccccc", "ccccc"], { c, g: K.gold });
    const tailA = art(x, 69, ["ccccc", "cc.cc", "c...c"], { c: dk });
    const tailB = art(x, 69, ["ccccc", "ccccc", ".c.c."], { c: dk });
    const d = (rs: R[], kk: string) => rs.map((q, i) => <rect key={`${kk}${i}`} x={q.x} y={q.y} width={q.w} height={q.h} fill={q.f} />);
    return (
      <g key={k}>
        <rect x={x - 1} y={57} width={7} height={1} fill={K.goldDk} />
        {d(body, `${k}b`)}
        <g className="sc-flag">{d(tailA, `${k}a`)}</g>
        <g className="sc-flag2">{d(tailB, `${k}t`)}</g>
      </g>
    );
  };
  return [one(31, K.cyan, K.cyanDk, "bnL"), one(163, K.pink, K.pinkDk, "bnR")];
}

function flags(): ReactNode[] {
  const one = (x: number, c: string, k: string) => {
    const a = art(x + 1, 38, ["cccccc", "cccccc", "cccc..", "cc...."], { c });
    const b = art(x + 1, 38, ["cccc..", "cccccc", "cccccc", "..cccc"], { c });
    const d = (rs: R[], kk: string) => rs.map((q, i) => <rect key={`${kk}${i}`} x={q.x} y={q.y} width={q.w} height={q.h} fill={q.f} />);
    return (
      <g key={k}>
        <rect x={x} y={37} width={1} height={15} fill={K.st3} />
        <rect x={x} y={36} width={1} height={1} fill={K.gold} />
        <g className="sc-flag">{d(a, `${k}a`)}</g>
        <g className="sc-flag2">{d(b, `${k}b`)}</g>
      </g>
    );
  };
  return [one(24, K.lime, "fL"), one(176, K.orange, "fR")];
}

function lamps(): ReactNode[] {
  return [26, 172].map((x, i) => (
    <g key={`l${i}`} className="sc-lamp" style={{ ["--dl" as string]: `${i * 1.3}s` } as CSSProperties}>
      <rect x={x - 1} y={76} width={4} height={4} fill={K.gold} />
      <rect x={x} y={75} width={2} height={1} fill={K.goldHi} />
      <rect x={x - 3} y={77} width={1} height={1} fill={K.gold} />
      <rect x={x + 4} y={77} width={1} height={1} fill={K.gold} />
      <rect x={x} y={73} width={2} height={1} fill={K.gold} />
    </g>
  ));
}

function gavel(): ReactNode {
  // head at the left, handle running right to the judge's hand (pivot = bottom-right of the group)
  return (
    <g className="sc-gavel">
      <rect x={105} y={63} width={2} height={3} fill={K.skin} />
      <rect x={107} y={64} width={5} height={1} fill={K.wood} />
      <rect x={112} y={62} width={6} height={4} fill={K.woodHi} />
      <rect x={112} y={62} width={6} height={1} fill="#c98a4f" />
      <rect x={112} y={65} width={6} height={1} fill={K.woodDk} />
      <rect x={111} y={62} width={1} height={4} fill={K.gold} />
      <rect x={118} y={62} width={1} height={4} fill={K.gold} />
    </g>
  );
}

function impact(): ReactNode {
  const p: [number, number, string][] = [[115, 59, K.goldHi], [115, 57, K.gold], [110, 62, K.gold], [108, 61, K.pink], [121, 62, K.gold], [123, 61, K.cyan], [111, 58, K.gold], [119, 58, K.gold], [109, 65, K.lime], [121, 65, K.orange], [115, 55, K.st1]];
  return (
    <g className="sc-impact">
      {p.map(([x, y, f], i) => <rect key={`i${i}`} x={x} y={y} width={i < 2 ? 2 : 1} height={i < 2 ? 1 : 1} fill={f} />)}
    </g>
  );
}

function dust(): ReactNode[] {
  const d: [number, number, number, number][] = [[84, 80, 0, 6], [92, 84, 1.5, 7], [113, 82, 3, 5.5], [118, 86, 0.8, 6.5], [88, 70, 2.2, 8], [111, 74, 4, 7.2]];
  return d.map(([x, y, dl, dd], i) => (
    <rect key={`d${i}`} x={x} y={y} width={1} height={1} fill={i % 2 ? K.gold : K.st1} className="sc-dust" style={{ ["--dl" as string]: `${dl}s`, ["--dd" as string]: `${dd}s` } as CSSProperties} />
  ));
}

// counsel walker: 8×12 sprite; body bobs, legs alternate between two frames
const BODY = [
  "..hhhh..",
  ".hhhhhh.",
  ".hsssss.",
  "..sssEs.",
  "..ssss..",
  ".rrccrr.",
  "rrrccrrB",
  "rrrrrrrB",
  "rrrrrrBB",
  ".rRrrrBB",
];
const LEGS_A = [".rr..rr.", ".kk..kk."];
const LEGS_B = ["..rrrr..", "..kkkk.."];

function walker(i: number, robe: string, shade: string, hair: string, skin: string, carry: string, lane: number, dur: number, delay: number, rtl: boolean, sx: number): ReactNode {
  const key = { h: hair, s: skin, E: K.ink, r: robe, R: shade, c: K.st1, B: carry, k: "#000" };
  const d = (rs: R[], k: string) => rs.map((q, j) => <rect key={`${k}${j}`} x={q.x} y={q.y} width={q.w} height={q.h} fill={q.f} />);
  return (
    <g key={`wk${i}`} className={`sc-walk ${rtl ? "rtl" : ""}`} style={{ ["--wdur" as string]: `${dur}s`, ["--dl" as string]: `${delay}s`, ["--sx" as string]: `${sx}px` } as CSSProperties}>
      <g transform={`translate(0 ${lane})`}>
        <rect x={1} y={12} width={7} height={1} fill="#000" opacity={0.6} />
        <g className="sc-bob" style={{ animationDelay: `${(i % 3) * 0.17}s` }}>{d(art(0, 0, BODY, key), `b${i}`)}</g>
        <g className="sc-fa" style={{ animationDelay: `${(i % 3) * 0.17}s` }}>{d(art(0, 10, LEGS_A, key), `a${i}`)}</g>
        <g className="sc-fb" style={{ animationDelay: `${(i % 3) * 0.17}s` }}>{d(art(0, 10, LEGS_B, key), `c${i}`)}</g>
      </g>
    </g>
  );
}

function walkers(): ReactNode[] {
  return [
    walker(0, K.cyan, K.cyanDk, "#2a1a10", K.skin, K.woodHi, 100, 21, -3, false, 52),
    walker(1, K.pink, K.pinkDk, K.wig, K.skin2, K.st1, 101, 25, -14, true, 150),
    walker(2, K.violet, K.violetDk, "#111", K.skin3, K.gold, 105, 18, -9, false, 70),
    walker(3, K.lime, K.limeDk, "#7a5230", K.skin, K.woodHi, 106, 23, -18, true, 132),
    walker(4, K.orange, K.orangeDk, K.wig, K.skin2, K.st1, 104, 27, -22, false, 30),
  ];
}

const STATIC_BACK = [...sky()];
const STATIC_MAIN = [...building(), ...interior(), ...plaza()];

const draw = (rs: R[], k: string) => rs.map((q, i) => <rect key={`${k}${i}`} x={q.x} y={q.y} width={Math.max(0, q.w)} height={q.h} fill={q.f} className={q.c} style={q.s} />);

export function Courtroom() {
  return (
    <figure className="scene-frame" aria-label="A pixel courthouse at night: the scales of justice tip on the roof, the judge strikes the gavel inside the open doors, counsel in bright robes cross the plaza.">
      <svg viewBox="0 0 200 120" shapeRendering="crispEdges" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={200} height={120} fill="#000" />
        {draw(STATIC_BACK, "bk")}
        {stars()}
        <rect className="sc-shooting" x={150} y={4} width={3} height={1} fill={K.st1} />
        <g className="sc-shake">
          {draw(STATIC_MAIN, "m")}
          {scales()}
          {windows()}
          {banners()}
          {flags()}
          {lamps()}
          {dust()}
          {gavel()}
          {impact()}
          {walkers()}
        </g>
      </svg>
      <figcaption className="scene-cap">
        <span><b>In re:</b> Company.md · Docket 2026-0001</span>
        <span><span className="dot on" aria-hidden="true" /> In session</span>
      </figcaption>
    </figure>
  );
}
