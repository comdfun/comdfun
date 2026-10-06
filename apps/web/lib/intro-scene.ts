// The intro's office floor: a 384×216 pixel scene rendered once to an SVG string (served from /intro/scene.svg,
// cached forever). Layers pan at different speeds (parallax); counsel walk with 4-frame cycles; lamps, monitors, the
// water cooler and the city outside all animate with CSS steps(). Reduced motion freezes it on a composed frame.

type Key = Record<string, string>;
const K = {
  gold: "#ffc83d", goldHi: "#ffe598", goldDk: "#b07a00", pink: "#ff4fd8", pinkDk: "#b01f93", cyan: "#2de2e6", cyanDk: "#0b8f93",
  lime: "#8cff3a", limeDk: "#49a812", orange: "#ff8a1f", orangeDk: "#b35500", violet: "#9b5cff", violetDk: "#5b2bc4", crimson: "#ff3b5c", crimsonDk: "#b0123a",
  parch: "#f3ebd3", parch2: "#bdb39a", wood: "#6b3f1d", woodHi: "#9a6234", woodLt: "#c98a4f", woodDk: "#3b210e", woodDk2: "#2a170a",
  wall: "#17121f", wall2: "#1e1829", wall3: "#120e18", wain: "#251a14", wainHi: "#33241a",
  steel: "#4d5866", steelHi: "#6e7b8a", steelDk: "#2d343d", green: "#1f9d55", greenHi: "#3fe08a", greenDk: "#0f5c31",
  skin: "#e7b48b", skin2: "#b97a52", skin3: "#7a4b2e", ink: "#000", suit: "#24202e", suitHi: "#363045", sky: "#07060d", city: "#120d22", city2: "#1b1433",
};

const R = (x: number, y: number, w: number, h: number, f: string, cls = "", style = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"${cls ? ` class="${cls}"` : ""}${style ? ` style="${style}"` : ""}/>`;

function art(x0: number, y0: number, rows: string[], key: Key): string {
  let out = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      if (ch !== "." && key[ch]) out += R(x0 + x, y0 + y, w, 1, key[ch]);
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
function text(x0: number, y0: number, s: string, f: string) {
  let out = "";
  let x = x0;
  for (const ch of s) {
    if (ch === " ") { x += 3; continue; }
    out += art(x, y0, FONT[ch], { "#": f });
    x += ch === "." ? 2 : 4;
  }
  return out;
}

// deterministic noise
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------------------------------------------------------------------------------------------- layers
const WINDOWS = [16, 124, 216, 324];

function skyLayer() {
  let s = R(-30, 0, 450, 124, K.sky);
  // stars
  for (let i = 0; i < 40; i++) s += R(Math.floor(rnd() * 420) - 20, Math.floor(rnd() * 40) + 2, 1, 1, [K.parch, K.cyan, K.pink, K.gold][i % 4], i % 3 ? "" : "tw", `animation-delay:${(i % 7) * 0.4}s`);
  // moon
  s += art(150, 8, ["..gggg..", ".gggGGg.", "gggG....", "gggG....", ".gggGGg.", "..gggg.."], { g: K.gold, G: K.goldHi });
  // skyline
  let x = -24;
  while (x < 420) {
    const w = 10 + Math.floor(rnd() * 16);
    const top = 34 + Math.floor(rnd() * 46);
    s += R(x, top, w, 124 - top, rnd() > 0.5 ? K.city : K.city2);
    if (rnd() > 0.6) s += R(x + Math.floor(w / 2), top - 6, 1, 6, K.city2);
    for (let yy = top + 3; yy < 96; yy += 4) for (let xx = x + 2; xx < x + w - 2; xx += 3) {
      const v = rnd();
      if (v > 0.72) s += R(xx, yy, 1, 2, [K.cyan, K.gold, K.pink, K.lime, K.violet][Math.floor(v * 97) % 5], v > 0.93 ? "tw" : "", v > 0.93 ? `animation-delay:${(xx % 9) * 0.3}s` : "");
    }
    x += w + 1;
  }
  return s;
}

function wallLayer() {
  let s = "";
  // wall with window openings
  s += R(-30, 0, 450, 14, K.wall) + R(-30, 96, 450, 28, K.wall);
  const edges = [-30, ...WINDOWS.flatMap((w) => [w, w + 44]), 420];
  for (let i = 0; i < edges.length; i += 2) s += R(edges[i], 14, edges[i + 1] - edges[i], 82, K.wall);
  // wallpaper stripes
  for (let x = -30; x < 420; x += 6) s += R(x, 0, 1, 124, K.wall2);
  // crown moulding
  s += R(-30, 0, 450, 3, K.wainHi) + R(-30, 3, 450, 1, K.goldDk);
  // windows: frames, mullions, sills
  for (const w of WINDOWS) {
    s += R(w - 2, 12, 48, 2, K.woodDk) + R(w - 2, 12, 2, 86, K.woodDk) + R(w + 44, 12, 2, 86, K.woodDk);
    s += R(w + 21, 14, 2, 82, K.woodDk) + R(w, 52, 44, 2, K.woodDk);
    s += R(w - 4, 96, 52, 2, K.gold) + R(w - 4, 98, 52, 1, K.goldDk);
    // reflections on glass
    s += R(w + 3, 18, 1, 6, "#ffffff22") + R(w + 26, 56, 1, 6, "#ffffff22");
  }
  // wainscot
  s += R(-30, 100, 450, 24, K.wain) + R(-30, 100, 450, 2, K.gold) + R(-30, 102, 450, 1, K.goldDk);
  for (let x = -26; x < 420; x += 22) s += R(x, 106, 18, 14, K.wainHi) + R(x + 1, 107, 16, 12, K.wain);
  // bookshelves between windows
  for (const bx of [66, 266]) {
    s += R(bx, 30, 52, 70, K.woodDk) + R(bx, 30, 52, 3, K.woodHi) + R(bx + 2, 33, 48, 66, K.woodDk2);
    for (const sy of [46, 62, 78, 94]) {
      s += R(bx + 2, sy, 48, 2, K.wood);
      let x = bx + 3;
      while (x < bx + 48) {
        const bw = 2 + Math.floor(rnd() * 3);
        const bh = 9 + Math.floor(rnd() * 5);
        const c = [K.crimson, K.violet, K.cyanDk, K.gold, K.limeDk, K.orange, K.pinkDk, K.crimsonDk, K.violetDk][Math.floor(rnd() * 9)];
        if (x + bw > bx + 49) break;
        s += R(x, sy - bh, bw, bh, c) + R(x, sy - bh + 2, bw, 1, K.goldHi);
        x += bw + (rnd() > 0.85 ? 2 : 0);
      }
    }
  }
  // the door with the brass sign
  s += R(168, 26, 48, 12, K.goldDk) + R(169, 27, 46, 10, K.gold) + R(169, 27, 46, 1, K.goldHi) + text(173, 30, "COMPANY", K.woodDk2) + text(201, 30, ".MD", K.crimsonDk);
  s += R(170, 40, 44, 84, K.woodDk) + R(172, 42, 19, 82, K.wood) + R(193, 42, 19, 82, K.wood);
  for (const dx of [172, 193]) {
    s += R(dx + 3, 46, 13, 26, "#2a3a44") + R(dx + 3, 46, 13, 1, "#5a7a88") + R(dx + 4, 48, 2, 8, "#7aa2b2");
    s += R(dx + 3, 78, 13, 18, K.woodHi) + R(dx + 4, 79, 11, 16, K.wood) + R(dx + 3, 100, 13, 18, K.woodHi) + R(dx + 4, 101, 11, 16, K.wood);
  }
  s += R(189, 82, 2, 4, K.gold) + R(193, 82, 2, 4, K.gold);
  s += R(176, 58, 32, 2, K.goldDk);
  // clock
  s += art(188, 4, [".wwwww.", "wpppppw", "wpppppw", "wpppkpw", "wpppppw", "wpppppw", ".wwwww."], { w: K.gold, p: K.parch, k: K.ink });
  s += `<g class="clock">${R(191, 5, 1, 3, K.ink)}</g>`;
  // pendant lamps
  for (const lx of [92, 292]) s += R(lx, 3, 1, 9, K.steelDk) + R(lx - 4, 12, 9, 3, K.greenDk) + R(lx - 3, 12, 7, 1, K.green) + `<g class="flick">${R(lx - 3, 15, 7, 1, K.goldHi)}${R(lx - 2, 16, 5, 1, K.gold)}</g>`;
  // filing cabinets
  for (const fx of [-18, 372, 396]) {
    s += R(fx, 60, 20, 64, K.steel) + R(fx, 60, 20, 2, K.steelHi) + R(fx + 18, 62, 2, 62, K.steelDk);
    for (let dy = 64; dy < 120; dy += 14) s += R(fx + 2, dy, 15, 12, K.steelHi) + R(fx + 3, dy + 1, 13, 10, K.steel) + R(fx + 7, dy + 4, 5, 2, K.gold) + R(fx + 5, dy + 8, 9, 2, K.parch2);
  }
  return s;
}

function desk(x: number, y: number, screen: string, i: number) {
  // y = floor line under the desk; desk top at y-14
  let s = "";
  s += R(x, y - 14, 34, 3, K.woodHi) + R(x, y - 14, 34, 1, K.woodLt) + R(x + 1, y - 11, 32, 11, K.wood) + R(x + 1, y - 1, 32, 1, K.woodDk);
  s += R(x + 3, y - 9, 12, 7, K.woodDk) + R(x + 4, y - 8, 10, 5, K.wood) + R(x + 8, y - 6, 2, 1, K.gold);
  s += R(x + 19, y - 9, 12, 7, K.woodDk) + R(x + 20, y - 8, 10, 5, K.wood) + R(x + 24, y - 6, 2, 1, K.gold);
  // monitor
  s += R(x + 17, y - 30, 15, 13, K.steelDk) + R(x + 18, y - 29, 13, 10, "#06121a") + R(x + 23, y - 17, 3, 3, K.steelDk) + R(x + 20, y - 15, 9, 1, K.steel);
  for (let l = 0; l < 3; l++) s += R(x + 19, y - 27 + l * 3, [9, 6, 8][l], 1, screen, "ln", `animation-delay:${(i * 0.37 + l * 0.5).toFixed(2)}s`);
  s += R(x + 18, y - 29, 13, 1, "#ffffff18");
  // banker's lamp
  s += R(x + 3, y - 15, 7, 1, K.goldDk) + R(x + 6, y - 21, 1, 6, K.gold) + R(x + 2, y - 24, 10, 3, K.green) + R(x + 3, y - 24, 8, 1, K.greenHi) + R(x + 2, y - 21, 10, 1, K.greenDk);
  s += `<g class="glow" style="animation-delay:${(i * 0.7).toFixed(1)}s">${R(x + 3, y - 20, 8, 1, K.goldHi)}${R(x + 1, y - 16, 2, 1, K.gold)}${R(x + 11, y - 16, 2, 1, K.gold)}${R(x + 4, y - 16, 6, 1, "#ffe59866")}</g>`;
  // papers + chair
  s += R(x + 12, y - 15, 5, 1, K.parch) + R(x + 13, y - 16, 4, 1, K.parch2);
  return s;
}

function cooler(x: number, y: number) {
  let s = art(x, y - 30, [
    "..bbbb..", ".bBBBBb.", ".bBbBBb.", ".bBBBBb.", ".bBBbBb.", ".bBBBBb.", "..bbbb..", "...ss...",
    ".wwwwww.", ".wwwwww.", ".wrwwcw.", ".wwwwww.", ".wwwwww.", ".wwwwww.", ".wwwwww.", ".wwwwww.", ".wwwwww.", ".wwwwww.", ".wwwwww.", ".wwwwww.",
    ".wwwwww.", ".wwwwww.", ".WWWWWW.", ".WWWWWW.", ".WWWWWW.", ".WWWWWW.", ".WWWWWW.", ".kk..kk.", ".kk..kk.", "........",
  ], { b: "#2a7fd0", B: "#6fc3ff", s: K.steel, w: "#e9eef2", W: "#c2cbd2", r: K.crimson, c: K.cyan, k: K.steelDk });
  for (let i = 0; i < 4; i++) s += R(x + 3 + (i % 2), y - 25, 1, 1, "#d6f1ff", "bub", `animation-delay:${i * 0.45}s`);
  return s;
}

function plant(x: number, y: number) {
  return art(x, y - 26, [
    "....g.....", "...gGg..g.", "..gGgg.gGg", "g.gGg.gGg.", "GgGgggGg..", ".gGgGgg.g.", "..gGGgGgGg", ".g.gGgg.g.", "gGg.ggGg..", ".gGggg.gg.",
    "...ggg....", "....g.....", "...ppp....", "..pPPPp...", "..pPPPp...", "..pPPPp...", "..pPPPp...", "...ppp....",
  ].map((r) => r.padEnd(10, ".")), { g: K.greenDk, G: K.green, p: K.woodDk, P: K.orangeDk });
}

// ---------------------------------------------------------------------------------------------- counsel
const BODY = ["..hhhh..", ".hhhhhh.", ".hsssss.", "..sssEs.", "..ssss..", ".rrccrr.", "rrrcTrrB", "rrrrrrrB", "rrrrrrBB", ".rRrrrBB"];
const LEGS = [
  [".rr..rr.", "kk....kk"],
  ["..rrrr..", "..kkkk.."],
  [".rr..rr.", ".kk..kk."],
  ["..rrrr..", "...kk..."],
];
const IDLE = ["..r..r..", "..k..k.."];

type Who = { robe: string; shade: string; hair: string; skin: string; carry: string; tie: string };
const CAST: Who[] = [
  { robe: K.cyan, shade: K.cyanDk, hair: "#2a1a10", skin: K.skin, carry: K.woodHi, tie: K.parch },
  { robe: K.pink, shade: K.pinkDk, hair: K.parch, skin: K.skin2, carry: K.parch, tie: K.parch },
  { robe: K.suit, shade: K.suitHi, hair: "#111", skin: K.skin3, carry: K.gold, tie: K.crimson },
  { robe: K.violet, shade: K.violetDk, hair: "#7a5230", skin: K.skin, carry: K.cyan, tie: K.parch },
  { robe: K.lime, shade: K.limeDk, hair: K.parch, skin: K.skin2, carry: K.woodHi, tie: K.parch },
  { robe: K.suit, shade: K.suitHi, hair: "#3a2a1a", skin: K.skin, carry: K.pink, tie: K.gold },
  { robe: K.orange, shade: K.orangeDk, hair: "#111", skin: K.skin3, carry: K.parch, tie: K.parch },
];

function sprite(w: Who, legs: string[]) {
  const key = { h: w.hair, s: w.skin, E: K.ink, r: w.robe, R: w.shade, c: K.parch, T: w.tie, B: w.carry, k: "#000" };
  return { body: art(0, 0, BODY, key), legs: art(0, 10, legs, key) };
}

function walker(w: Who, lane: number, scale: number, dur: number, delay: number, rtl: boolean, speedCycle = 0.56) {
  const frames = LEGS.map((l, k) => `<g class="fr" style="animation-duration:${speedCycle}s;animation-delay:${(-k * speedCycle / 4).toFixed(3)}s">${sprite(w, l).legs}</g>`).join("");
  const body = sprite(w, LEGS[0]).body;
  const flip = rtl ? ` translate(${8 * scale} 0) scale(-${scale} ${scale})` : ` scale(${scale})`;
  return `<g class="walk${rtl ? " rtl" : ""}" style="animation-duration:${dur}s;animation-delay:${delay}s"><g transform="translate(0 ${lane - 12 * scale})${flip}">${R(1, 12, 7, 1, "#00000088")}<g class="bob" style="animation-duration:${speedCycle / 2}s">${body}</g>${frames}</g></g>`;
}

/** One counsel walks to a desk, stops to read the screen, then carries on. */
function stopper(w: Who, lane: number, scale: number) {
  const walkLegs = LEGS.map((l, k) => `<g class="fr" style="animation-delay:${(-k * 0.14).toFixed(2)}s">${sprite(w, l).legs}</g>`).join("");
  const body = sprite(w, LEGS[0]).body;
  const idle = sprite(w, IDLE).legs;
  return `<g class="stopper"><g transform="translate(0 ${lane - 12 * scale}) scale(${scale})">${R(1, 12, 7, 1, "#00000088")}<g class="stop-body">${body}</g><g class="moving">${walkLegs}</g><g class="still">${idle}</g></g></g>`;
}

/** Counsel seated at a front desk, typing (two-frame bob). */
function sitter(x: number, y: number, w: Who, scale: number) {
  const key = { h: w.hair, s: w.skin, E: K.ink, r: w.robe, R: w.shade, c: K.parch, T: w.tie, B: w.robe, k: "#000" };
  const top = art(0, 0, BODY.slice(0, 9), key);
  return `<g transform="translate(${x} ${y}) scale(${scale})"><g class="type">${top}</g>${R(-1, 9, 10, 5, K.woodDk)}${R(-1, 9, 10, 1, K.woodHi)}</g>`;
}

const STYLE = `
.tw{animation:tw 2.6s steps(1,end) infinite}@keyframes tw{0%,70%,100%{opacity:1}71%,86%{opacity:.25}}
.ln{transform-box:fill-box;transform-origin:left;animation:ln 2.4s steps(6,end) infinite}@keyframes ln{0%{transform:scaleX(0)}60%,100%{transform:scaleX(1)}}
.glow{animation:glow 3.4s steps(1,end) infinite}@keyframes glow{0%,88%,100%{opacity:1}89%,92%{opacity:.4}}
.flick{animation:glow 5s steps(1,end) infinite}
.clock{transform-box:view-box;transform-origin:191.5px 7.5px;animation:clk 12s steps(12,end) infinite}@keyframes clk{to{transform:rotate(360deg)}}
.bub{animation:bub 1.8s steps(6,end) infinite}@keyframes bub{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-5px);opacity:0}}
.fr{animation:fr .56s steps(1,end) infinite}@keyframes fr{0%,24.9%{opacity:1}25%,100%{opacity:0}}
.bob{animation:bob .28s steps(1,end) infinite}@keyframes bob{0%,49%{transform:translateY(0)}50%,100%{transform:translateY(-1px)}}
.walk{animation-name:walk;animation-timing-function:linear;animation-iteration-count:infinite}
.walk.rtl{animation-name:walkr}
@keyframes walk{from{transform:translateX(-40px)}to{transform:translateX(424px)}}
@keyframes walkr{from{transform:translateX(424px)}to{transform:translateX(-40px)}}
.stopper{animation:stopx 14s linear infinite;animation-delay:-3.2s}
@keyframes stopx{0%{transform:translateX(-30px)}36%{transform:translateX(104px)}64%{transform:translateX(104px)}100%{transform:translateX(424px)}}
.stopper .moving{animation:mv 14s steps(1,end) infinite;animation-delay:-3.2s}.stopper .still{animation:st 14s steps(1,end) infinite;animation-delay:-3.2s}
@keyframes mv{0%,35.9%{opacity:1}36%,63.9%{opacity:0}64%,100%{opacity:1}}@keyframes st{0%,35.9%{opacity:0}36%,63.9%{opacity:1}64%,100%{opacity:0}}
.type{animation:bob .4s steps(1,end) infinite}
.L0{animation:pan0 8s steps(80,end) forwards}.L1{animation:pan1 8s steps(80,end) forwards}.L2{animation:pan2 8s steps(80,end) forwards}.L3{animation:pan3 8s steps(80,end) forwards}.L4{animation:pan4 8s steps(80,end) forwards}
@keyframes pan0{to{transform:translateX(-5px)}}@keyframes pan1{to{transform:translateX(-10px)}}@keyframes pan2{to{transform:translateX(-14px)}}@keyframes pan3{to{transform:translateX(-20px)}}@keyframes pan4{to{transform:translateX(-30px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.walk{transform:translateX(120px)}}
`;

export function introSceneSvg(): string {
  seed = 7;
  const floorY = 124;
  let floor = R(-40, floorY, 470, 92, "#1a110b");
  for (let y = floorY; y < 216; y += 4) {
    floor += R(-40, y, 470, 1, y % 8 ? "#21160e" : "#24180f");
    for (let x = -40 + ((y / 4) % 3) * 9; x < 430; x += 27) floor += R(x, y + 1, 1, 3, "#120b06");
  }
  // rug runner under the door
  floor += R(176, floorY, 32, 92, K.crimsonDk) + R(176, floorY, 2, 92, K.gold) + R(206, floorY, 2, 92, K.gold);
  for (let y = floorY + 6; y < 216; y += 10) floor += R(188, y, 8, 2, K.crimson);

  const back = [40, 104, 246, 310].map((x, i) => desk(x, 146, [K.cyan, K.lime, K.pink, K.gold][i], i)).join("");
  const mid = cooler(150, 170) + plant(-4, 168) + plant(228, 170) + plant(362, 172);
  const frontDesks = `<g transform="translate(14 0) scale(1.7)">${desk(0, 126, K.cyan, 5)}</g><g transform="translate(300 0) scale(1.7)">${desk(0, 126, K.orange, 6)}</g>`;

  const backWalkers = [
    walker(CAST[0], 152, 1.25, 17, -6, false),
    walker(CAST[2], 154, 1.25, 21, -15, true),
    walker(CAST[4], 151, 1.25, 19, -2, true),
  ].join("") + stopper(CAST[3], 150, 1.25);
  const frontWalkers = [
    walker(CAST[1], 196, 2, 13, -5.5, false, 0.6),
    walker(CAST[5], 200, 2, 16, -3, true, 0.64),
    walker(CAST[6], 198, 2, 15, -11, false, 0.6),
  ].join("");
  const sitters = sitter(48, 150, CAST[2], 2) + sitter(334, 150, CAST[0], 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 216" width="1536" height="864" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid slice"><style>${STYLE}</style>
<rect width="384" height="216" fill="#000"/>
<g class="L0">${skyLayer()}</g>
<g class="L1">${wallLayer()}</g>
<g class="L2">${floor}${back}${backWalkers}</g>
<g class="L3">${mid}</g>
<g class="L4">${sitters}${frontDesks}${frontWalkers}</g>
</svg>`;
}
