// Compose a 32×32 Counsel portrait from the sprite layers.
import { Raster, hex, mix, luma, T, type Color, type Key, type Tex } from "./raster.js";
import { P, BRAND } from "./palette.js";
import { rng, noise2 } from "./hash.js";
import * as S from "./sprites.js";
import { traitsOf, type Traits, type Scheme, type Practice } from "./traits.js";

type Ramp4 = readonly [Color, Color, Color, Color]; // hi, base, lo, deep

const r4 = (a: string, b: string, c: string, d: string): Ramp4 => [hex(a), hex(b), hex(c), hex(d)];

export const SKIN: Record<Traits["skin"], Ramp4> = {
  Porcelain: r4("#FCEADF", "#F2D3BE", "#D7AA90", "#A9765E"),
  Fair: r4("#F8DCC0", "#E8B990", "#C68F67", "#93603F"),
  Olive: r4("#E6C095", "#C99A68", "#A3744A", "#714C2E"),
  Tan: r4("#D6A374", "#B27A4A", "#8A5731", "#5E3A1E"),
  Brown: r4("#B07A52", "#8A5636", "#683F25", "#45291A"),
  Deep: r4("#86553A", "#653D29", "#4B2C1D", "#2F1A10"),
  "Chrome robot": [P.steelHi, P.steel, P.steelLo, P.steelDk],
  "Gold robot": [P.goldHi, P.gold, P.goldLo, hex("#5A420A")],
};

const HAIR: Record<Traits["hair"], readonly [Color, Color, Color]> = {
  Raven: [hex("#625A70"), hex("#3C3644"), hex("#25212B")],
  Chestnut: [hex("#9A6840"), hex("#6E4426"), hex("#4A2C17")],
  Auburn: [hex("#C8673A"), hex("#933C1F"), hex("#622510")],
  Flaxen: [hex("#F6DE9A"), hex("#D6B464"), hex("#A3843A")],
  Silver: [hex("#E2E2E6"), hex("#ABABB4"), hex("#76767F")],
  Snow: [hex("#FFFFFF"), hex("#E4E2DC"), hex("#ACA9A2")],
  Copper: [hex("#EA8A48"), hex("#BD5E25"), hex("#843D14")],
};

const ACCENT: Record<Traits["accent"], readonly [Color, Color, Color]> = {
  Oxblood: [P.oxHi, P.ox, P.oxLo],
  Brass: [P.brassHi, P.brass, P.brassLo],
  Verdigris: [P.vdHi, P.vd, P.vdLo],
  Navy: [hex("#5A74BE"), hex("#2F4380"), hex("#1C2850")],
  Parchment: [P.parchHi, P.parch, P.parchLo],
};

export const PRACTICE_COLOR: Record<Practice, Color> = {
  Corporate: BRAND.brass,
  Securities: BRAND.verdigris,
  Litigation: hex("#D2453F"),
  Contracts: BRAND.parchment,
  Tax: hex("#8DB255"),
  IP: hex("#9C82E0"),
  Regulatory: hex("#5B8FD6"),
  Arbitration: hex("#E08A4A"),
  Bankruptcy: hex("#B3AD9E"),
  Admiralty: hex("#3FB6C8"),
};
export const PRACTICE_CODE: Record<Practice, string> = {
  Corporate: "CORP", Securities: "SEC", Litigation: "LIT", Contracts: "CONT", Tax: "TAX",
  IP: "IP", Regulatory: "REG", Arbitration: "ARB", Bankruptcy: "BKR", Admiralty: "ADM",
};

const ATTIRE: Record<Traits["attire"], { a: Color | Tex; A: Color; L: Color; F?: Color; G?: Color; v?: Color }> = {
  "Black robe": { a: hex("#1C1C22"), A: hex("#111115"), L: hex("#3C3C48"), F: hex("#2C2C35"), v: hex("#34343E") },
  "Navy suit": { a: hex("#24345F"), A: hex("#18223F"), L: hex("#3C5290") },
  "Charcoal suit": { a: hex("#3C3E45"), A: hex("#28292E"), L: hex("#5E616B") },
  Pinstripe: {
    a: (x) => ((x % 3) === 1 ? hex("#5D6378") : hex("#252A3A")),
    A: hex("#181B26"), L: hex("#4A5372"),
  },
  Tweed: {
    a: (x, y) => { const n = noise2(x, y, 7); return n < 0.22 ? hex("#86683F") : n > 0.82 ? hex("#4E3B25") : hex("#6B5233"); },
    A: hex("#45341E"), L: hex("#9A7C50"),
  },
  "Gown with bands": { a: hex("#15151B"), A: hex("#0C0C10"), L: hex("#4A4A58"), G: hex("#3A3A48"), v: hex("#2A2A34") },
};

const OUTLINE = P.ink;

// ── Backdrops ──────────────────────────────────────────────────────────────────────────────
function backdrop(r: Raster, t: Traits, tokenId: number): void {
  const R = rng(`the-company:backdrop:${tokenId}`);
  const inside = (fn: (x: number, y: number) => Color) => {
    for (let y = 1; y < 31; y++) for (let x = 1; x < 31; x++) r.set(x, y, fn(x, y));
  };
  switch (t.backdrop) {
    case "Black":
      return;
    case "Chamber wood": {
      const plank = 6;
      inside((x, y) => {
        if (y === 20) return hex("#4A3019");
        if (y === 21) return hex("#160D06");
        if (x % plank === 0) return hex("#140B05");
        const g = noise2(x, Math.floor(y / 3), 3);
        const base = y > 21 ? hex("#2E1D0F") : hex("#25170C");
        return g > 0.8 ? mix(base, hex("#3E2814"), 0.7) : base;
      });
      return;
    }
    case "Library": {
      const spines = [hex("#4A1C1C"), hex("#1F2A48"), hex("#1E3A2A"), hex("#4E3E14"), hex("#3E3A33"), hex("#33203A")];
      inside(() => hex("#0B0806"));
      for (const shelfY of [10, 20, 30]) {
        r.rect(1, shelfY, 30, 1, hex("#3A2614"));
        let x = 1;
        while (x < 31) {
          const w = R() < 0.3 ? 2 : 1;
          const h = 5 + Math.floor(R() * 4);
          const c = spines[Math.floor(R() * spines.length)];
          if (R() < 0.12) { x += 1; continue; }
          for (let i = 0; i < w && x + i < 31; i++) {
            r.rect(x + i, shelfY - h, 1, h, i === 0 ? mix(c, hex("#FFFFFF"), 0.08) : c);
            if (R() < 0.5) r.set(x + i, shelfY - h + 1, mix(c, P.brass, 0.45));
          }
          x += w;
        }
      }
      return;
    }
    case "Courtroom": {
      inside(() => hex("#07070A"));
      const stone = [hex("#5E5A50"), hex("#46433B"), hex("#2E2C27")];
      r.rect(1, 1, 30, 2, stone[2]);
      r.rect(1, 3, 30, 1, stone[1]);
      for (const cx of [2, 26]) {
        r.rect(cx - 1, 4, 6, 1, stone[0]); // capital
        r.rect(cx, 5, 4, 1, stone[1]);
        for (let y = 6; y < 29; y++) {
          r.set(cx, y, stone[1]); r.set(cx + 1, y, stone[0]); r.set(cx + 2, y, stone[2]); r.set(cx + 3, y, stone[1]);
        }
        r.rect(cx - 1, 29, 6, 2, stone[1]); // base
      }
      // brass court seal glowing behind the head
      for (let y = 1; y < 31; y++)
        for (let x = 1; x < 31; x++) {
          const d = Math.hypot(x - 15.5, y - 11.5);
          if (d > 10.2 && d < 11.2) r.set(x, y, hex("#3E3110"));
        }
      return;
    }
    case "Vault brass": {
      inside((x, y) => {
        const d = Math.hypot(x - 15.5, y - 13.5);
        if (d > 12.4 && d < 13.4) return hex("#7A5E14");
        if (d > 9.6 && d < 10.4) return hex("#5A4410");
        const base = hex("#2C220A");
        if (x % 10 === 3 && y % 10 === 3) return hex("#8A6A18");
        return (x + y) % 2 === 0 ? base : hex("#2A2009");
      });
      // spokes of the vault wheel
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        for (let d = 10.5; d < 12.5; d += 0.5) r.set(Math.round(15.5 + Math.cos(a) * d), Math.round(13.5 + Math.sin(a) * d), hex("#6A5212"));
      }
      return;
    }
  }
}

// ── Founder colour schemes: remap every non-black pixel by luminance onto a 5-stop ramp ─────
const SCHEMES: Record<Exclude<Scheme, "Natural">, string[]> = {
  Gilt: ["#1A1205", "#5A420A", "#C9A227", "#FFE58A", "#FFFFFF"],
  Oxblood: ["#14050A", "#4A1014", "#9E2A2B", "#E68A72", "#FFF0E4"],
  Verdigris: ["#03120D", "#144434", "#3E9A80", "#A8E6CF", "#F2FFF8"],
  Parchment: ["#0E0B07", "#3A3328", "#7A705C", "#C9BFA6", "#FFFBEF"],
  Ink: ["#050507", "#1E1E26", "#55556A", "#B4B4C8", "#FFFFFF"],
  Ember: ["#140503", "#521A08", "#C24E1A", "#F6AA4E", "#FFF4C8"],
  Night: ["#02040C", "#101D44", "#2F4C96", "#8EAEEA", "#F2F7FF"],
  Brass: ["#120D02", "#4A3808", "#C9A227", "#F0D272", "#FFF8DC"],
  Ivory: ["#0E0C08", "#4E473A", "#A69C84", "#EFE8D6", "#FFFFFF"],
};

const LASER_DIM = hex("#B3201A"), LASER_CORE = hex("#FFE4DC");
const KEEP = new Set<Color>([P.red, LASER_DIM, LASER_CORE]);

function applyScheme(r: Raster, scheme: Scheme): void {
  if (scheme === "Natural") return;
  const stops = SCHEMES[scheme].map(hex);
  r.map((c) => {
    if (c === 0 || KEEP.has(c)) return c;
    const l = Math.min(0.999, luma(c) * 1.15);
    const f = l * (stops.length - 1);
    const i = Math.floor(f);
    return mix(stops[i], stops[i + 1], Math.round((f - i) * 2) / 2); // quantise to keep a pixel palette
  });
}

// ── Composition ─────────────────────────────────────────────────────────────────────────────
function draw(r: Raster, l: { y: number; g: readonly string[] }, key: Key, outline = true): void {
  r.sprite(l.g, 0, l.y, key, outline ? OUTLINE : undefined);
}

export function composeCounsel(tokenId: number, t: Traits = traitsOf(tokenId)): Raster {
  const r = composeBase(tokenId, t, true);
  if (t.founder) applyScheme(r, t.founder.scheme);
  // 1px brass frame; Founding Partners get bright corners
  for (let i = 0; i < 32; i++) { r.set(i, 0, P.brass); r.set(i, 31, P.brass); r.set(0, i, P.brass); r.set(31, i, P.brass); }
  if (t.founder) for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31], [1, 1], [30, 1], [1, 30], [30, 30]]) r.set(x, y, P.brassHi);
  return r;
}

const CHEST_HAND = new Set<Traits["held"]>(["Gavel", "Quill", "Scales", "Pen"]);

/**
 * Full-length Counsel (32×49, transparent) for scenes and banners: the portrait without
 * backdrop or frame, plus jacket or robe, trousers and shoes.
 */
export function composeFigure(tokenId: number, t: Traits = traitsOf(tokenId)): Raster {
  const bust = composeBase(tokenId, t, false);
  const r = new Raster(32, 49);
  const robe = t.attire === "Black robe" || t.attire === "Gown with bands";
  const at = ATTIRE[t.attire];
  const [, ss, sS] = SKIN[t.skin];
  const rightHand = !CHEST_HAND.has(t.held);
  const g: string[] = [];
  for (let y = 31; y <= 48; y++) {
    const row = Array<string>(32).fill(".");
    const put = (x0: number, x1: number, ch: string) => { for (let x = x0; x <= x1; x++) row[x] = ch; };
    if (!robe) {
      if (y <= 36) {
        put(8, 23, "a"); row[8] = "A"; row[23] = "A"; row[15] = "L";
        if (y === 32 || y === 35) row[14] = "B";
        if (y === 36) put(8, 23, "A");
        // sleeves
        if (y <= 33) { put(3, 7, "a"); row[3] = "A"; row[7] = "A"; }
        if (y <= 33 || !rightHand) { if (y <= 33 || y === 34) { put(24, 28, "a"); row[24] = "A"; row[28] = "A"; } }
        if (y === 34) { put(3, 6, "c"); row[7] = "A"; if (rightHand) put(25, 28, "c"); else { put(24, 28, "a"); row[28] = "A"; } }
        if (y === 35 || y === 36) { put(3, 6, y === 35 ? "f" : "G"); if (y === 35) row[6] = "h"; if (rightHand) { put(25, 28, y === 35 ? "f" : "G"); if (y === 35) row[25] = "h"; } }
      } else if (y <= 46) {
        put(9, 14, y === 46 ? "T" : "t"); put(17, 22, y === 46 ? "T" : "t");
        if (y < 46) { row[11] = "T"; row[20] = "T"; }
      } else {
        put(y === 47 ? 8 : 7, 14, "s"); put(17, y === 47 ? 23 : 24, "s");
        if (y === 47) { row[9] = "S"; row[10] = "S"; row[21] = "S"; row[22] = "S"; }
      }
    } else {
      if (y <= 44) {
        const flare = Math.floor((y - 31) / 5);
        const x0 = 3 - flare, x1 = 28 + flare;
        put(x0, x1, "a"); row[x0] = "A"; row[x1] = "A";
        for (const fx of [7, 10, 21, 24]) row[fx] = "F";
        row[12] = "L"; row[19] = "L";
        put(13, 18, y <= 33 ? "v" : "t");
        if (y === 32) row[15] = "B";
        if (y === 44) put(x0, x1, "A");
        if (y === 35) { put(x0, 6, "A"); if (rightHand) put(25, x1, "A"); }
        if (y === 36 || y === 37) {
          put(3, 6, y === 36 ? "f" : "G"); if (y === 36) row[6] = "h";
          if (rightHand) { put(25, 28, y === 36 ? "f" : "G"); if (y === 36) row[25] = "h"; }
        }
      } else if (y <= 46) {
        put(10, 14, "T"); put(17, 21, "T");
      } else {
        put(y === 47 ? 9 : 8, 14, "s"); put(17, y === 47 ? 22 : 23, "s");
        if (y === 47) { row[10] = "S"; row[11] = "S"; row[20] = "S"; row[21] = "S"; }
      }
    }
    g.push(row.join(""));
  }
  const trouser = robe ? hex("#1E1E26") : at.A;
  r.sprite(g, 0, 31, {
    a: at.a, A: at.A, L: at.L, F: at.F ?? at.A, v: at.v ?? at.A, B: P.brass, c: hex("#F2EEE3"),
    f: ss, G: sS, h: SKIN[t.skin][0], t: robe ? trouser : at.a, T: robe ? hex("#121218") : at.A,
    s: hex("#141418"), S: hex("#5A5A6A"),
  }, OUTLINE);
  for (let x = 0; x < 32; x++) bust.px[31 * 32 + x] = T; // drop the bust's bottom outline row: the body continues
  r.blit(bust, 0, 0);
  if (t.founder) applyScheme(r, t.founder.scheme);
  return r;
}

function composeBase(tokenId: number, t: Traits, withBackdrop: boolean): Raster {
  const r = new Raster(32, 32, withBackdrop ? BRAND.black : T);
  if (withBackdrop) backdrop(r, t, tokenId);

  const [sh, ss, sS, sD] = SKIN[t.skin];
  const robot = t.skin === "Chrome robot" || t.skin === "Gold robot";
  const [hA, ha, hz] = HAIR[t.hair];
  const [aHi, aBase, aLo] = ACCENT[t.accent];
  const skinKey: Key = { h: sh, s: ss, S: sS, D: sD };

  // Full-bottom wig hangs behind the shoulders too: draw its mass first, then again on top.
  const wigWhite: readonly [Color, Color, Color, Color] = [hex("#FFFFFF"), hex("#ECE7D9"), hex("#BDB6A3"), hex("#8C877A")];
  // Ringlets: 2px-wide columns of stacked curls, each column phase-shifted so the curls interlock.
  const curlTex = (hi: Color, base: Color, lo: Color): Tex => (x, y) => {
    const col = Math.floor(x / 2), lx = x % 2;
    const ly = (y + col * 2) % 3;
    if (ly === 0) return lx === 0 ? hi : base;
    if (ly === 1) return lx === 0 ? base : lo;
    return lo;
  };

  // neck + attire
  draw(r, S.NECK, skinKey);
  const at = ATTIRE[t.attire];
  const shirt: Key = { c: hex("#F2EEE3"), C: hex("#C9C2AE") };
  const attireKey: Key = { a: at.a, A: at.A, L: at.L, F: at.F ?? at.A, G: at.G ?? at.L, v: at.v ?? at.A, B: P.brass, ...shirt };
  const body = t.attire === "Black robe" ? S.ROBE : t.attire === "Gown with bands" ? S.GOWN : S.SUIT;
  draw(r, body, attireKey);

  // neckwear
  const white: Key = { w: hex("#F7F4EC"), l: hex("#BDB6A3") };
  const tieKey: Key = { t: aBase, T: aLo, k: aHi };
  switch (t.neckwear) {
    case "Tie": draw(r, S.TIE, tieKey); break;
    case "Bow tie": draw(r, S.BOWTIE, tieKey); break;
    case "Jabot": draw(r, S.JABOT, white); break;
    case "Bands": draw(r, S.BANDS, white); break;
    case "None": draw(r, S.OPEN_COLLAR, skinKey, false); break;
  }

  // head + face
  draw(r, robot ? S.HEAD_ROBOT : S.HEAD, skinKey);
  if (robot) draw(r, S.FACE_ROBOT, { k: sD, g: t.skin === "Gold robot" ? P.ox : P.vd, S: sS, h: sh }, false);
  else draw(r, S.FACE_HUMAN, { b: hz, S: sS, h: sh, m: mix(sD, P.ox, 0.25), M: mix(ss, sh, 0.5) }, false);

  // headwear
  const hairKey: Key = { a: ha, A: hA, z: hz };
  switch (t.headwear) {
    case "Barrister wig": {
      const [wh, ww, wl, wd] = [hex("#F4EFE2"), hex("#D9D2C0"), hex("#A59D88"), hex("#7A7364")];
      draw(r, S.WIG_BARRISTER, { h: wh, w: ww, l: wl, d: wd });
      break;
    }
    case "Full-bottom wig":
      draw(r, S.WIG_FULLBOTTOM, { C: curlTex(wigWhite[0], wigWhite[1], wigWhite[2]), d: wigWhite[3] });
      break;
    case "Bald":
      draw(r, S.HAIR_BALD, hairKey, false);
      r.set(13, 6, sh === P.steelHi || sh === P.goldHi ? P.white : mix(sh, P.white, 0.6)); // scalp shine
      break;
    case "Slick": draw(r, S.HAIR_SLICK, hairKey); break;
    case "Bun": draw(r, S.HAIR_BUN, { ...hairKey, t: aBase, T: aLo }); break;
    case "Curls": draw(r, S.HAIR_CURLS, { C: curlTex(hA, ha, hz) }); break;
    case "Hat":
      draw(r, S.HAT_TOP, { t: hex("#2E2E37"), T: hex("#55556A"), q: hex("#1B1B22"), Q: hex("#121217"), b: aBase, B: aLo, ...hairKey });
      break;
    case "Bob": draw(r, S.HAIR_BOB, hairKey); break;
  }

  // eyes
  const eyeWhite = robot ? (t.skin === "Gold robot" ? hex("#FFF6D0") : hex("#DFF6FF")) : hex("#F7F4EC");
  const pupil = robot ? (t.skin === "Gold robot" ? P.ox : hex("#2A6FD6")) : hex("#16110E");
  const frame = t.accent === "Brass" || t.accent === "Oxblood" ? P.brass : P.steel;
  switch (t.eyes) {
    case "Plain": draw(r, S.EYES_PLAIN, { w: eyeWhite, k: pupil }, false); break;
    case "Spectacles": draw(r, S.EYES_SPECTACLES, { f: frame, w: eyeWhite, k: pupil }, false); break;
    case "Pince-nez": draw(r, S.EYES_PINCENEZ, { f: P.brass, w: eyeWhite, k: pupil, l: hex("#9FC7D6"), c: P.brassLo }, false); break;
    case "Monocle": draw(r, S.EYES_MONOCLE, { f: P.brassHi, w: hex("#CFE6EE"), k: pupil, c: P.brassLo }, false); break;
    case "Shades": draw(r, S.EYES_SHADES, { d: hex("#0E0E12"), h: hex("#6A6A80") }, false); break;
    case "Visor": draw(r, S.EYES_VISOR, { f: hex("#2A2D33"), g: P.vd, G: P.vdHi }, false); break;
    case "Laser":
      draw(r, S.EYES_LASER, { r: LASER_DIM, R: P.red }, false);
      draw(r, S.EYES_LASER_CORE, { W: LASER_CORE }, false);
      break;
  }

  // held item (+ hand)
  const handKey: Key = { f: ss, F: sS, h: sh, c: hex("#F2EEE3"), C: hex("#C9C2AE") };
  const brass: Key = { y: P.brass, Y: P.brassLo, h: P.brassHi };
  switch (t.held) {
    case "Gavel":
      draw(r, S.GAVEL, { g: P.wood, G: P.woodLo, h: P.woodHi, y: P.brass, Y: P.brassLo });
      draw(r, S.HAND, handKey);
      break;
    case "Quill":
      draw(r, S.QUILL, { w: hex("#F7F4EC"), W: hex("#BDB6A3"), s: hex("#8C877A"), n: P.brass });
      draw(r, S.HAND, handKey);
      break;
    case "Briefcase":
      draw(r, S.BRIEFCASE, { b: hex("#6E3A22"), h: hex("#8E5232"), B: hex("#48240F"), y: P.brass, Y: P.brassHi, k: hex("#3A2414") });
      break;
    case "Scales":
      draw(r, S.SCALES, brass);
      draw(r, S.HAND, handKey);
      break;
    case "Law book": {
      const [ch, cb, cl] = t.accent === "Verdigris" ? [P.vdHi, P.vd, P.vdLo] : t.accent === "Navy" ? ACCENT.Navy : [P.oxHi, P.ox, P.oxLo];
      draw(r, S.BOOK, { c: cb, C: cl, h: ch, y: P.brass, Y: P.brassLo, p: P.parch, P: P.parchLo });
      break;
    }
    case "Pen":
      draw(r, S.PEN, { k: hex("#1A1A20"), K: hex("#5A5A6E"), y: P.brass, n: P.brassHi });
      draw(r, S.HAND, handKey);
      break;
    case "None":
      break;
  }

  // practice pin on the lapel
  const pc = PRACTICE_COLOR[t.practice];
  r.sprite(S.PINS[t.practice], 7, 24, { p: pc, P: mix(pc, 0x000000, 0.45) });

  return r;
}

export { T };
