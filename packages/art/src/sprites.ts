// Hand-drawn 32×32 sprite layers. Every grid row is padded to 32 columns by `row(x0, s)`,
// so the number before each string is the absolute x of its first character.
// '.' = transparent. Letters are keyed per layer (see counsel.ts for the colour keys).

const pad = (x0: number, s: string) => (".".repeat(x0) + s).padEnd(32, ".");
/** Build a full-width layer starting at row y0. */
export function layer(y0: number, rows: ReadonlyArray<readonly [number, string]>): { y: number; g: string[] } {
  return { y: y0, g: rows.map(([x, s]) => pad(x, s)) };
}

// ── HEAD ── s skin, h highlight, S shadow, D deep shadow ────────────────────────────────────
export const HEAD = layer(5, [
  [13, "hhssss"], //            y5
  [11, "hhhssssssS"], //          y6
  [10, "hhssssssssSS"], //       y7
  [10, "hsssssssssSS"], //       y8
  [10, "hsssssssssSS"], //       y9
  [10, "hsssssssssSS"], //       y10
  [10, "hsssssssssSS"], //       y11
  [9, "shsssssssssSSS"], //      y12 ears
  [9, "ShssssssssssSD"], //      y13
  [9, "shsssssssssSSS"], //      y14
  [10, "hsssssssssSS"], //       y15
  [10, "hsssssssssSS"], //       y16
  [10, "ssssssssssSS"], //       y17
  [11, "sssssssSSS"], //          y18
  [12, "SsssssSS"], //             y19
  [13, "SSSSSS"], //                y20
]);

export const HEAD_ROBOT = layer(2, [
  [15, "hS"], //                 y2 antenna tip
  [15, "sS"], //                 y3
  [14, "hssS"], //               y4 antenna base
  [11, "hhhhhhhhsS"], //         y5
  [10, "hhsssssssssS"], //       y6
  [10, "hsssssssssSS"], //       y7
  [10, "hsssssssssSS"], //       y8
  [10, "hsssssssssSS"], //       y9
  [10, "hsssssssssSS"], //       y10
  [8, "DDhsssssssssSSDD"], //    y11 bolts
  [8, "DShsssssssssSSSD"], //    y12
  [8, "DShsssssssssSSSD"], //    y13
  [8, "DDhsssssssssSSDD"], //    y14
  [10, "hsssssssssSS"], //       y15
  [10, "hsssssssssSS"], //       y16
  [10, "SSSSSSSSSSSS"], //       y17 jaw hinge
  [10, "hsssssssssSS"], //       y18
  [10, "SSSSSSSSSSSD"], //       y19 flat chin
]);

export const NECK = layer(19, [
  [13, "SSSSSS"],
  [13, "DDDDDD"],
  [13, "SSSSSS"],
  [13, "ssssss"],
]);

// b brow, S nose shadow, h nose light, m mouth, M lip shadow
export const FACE_HUMAN = layer(11, [
  [12, "bb....bb"], // y11 brows
  [0, ""], //          y12
  [0, ""], //          y13 (eyes layer)
  [16, "S"], //        y14
  [15, "hS"], //       y15
  [0, ""], //          y16
  [14, "mmmm"], //     y17
  [15, "MM"], //       y18 lower-lip light
]);

// k dark recess, S seam, h rivet light, g grille
export const FACE_ROBOT = layer(6, [
  [11, "h........h"], // y6 rivets
  [0, ""], //            y7
  [0, ""], //            y8
  [0, ""], //            y9
  [0, ""], //            y10
  [11, "kkkk..kkkk"], // y11 eye sockets
  [11, "k..k..k..k"], // y12
  [11, "k..k..k..k"], // y13
  [11, "kkkk..kkkk"], // y14
  [0, ""], //            y15
  [13, "gkgkgk"], //     y16 speaker grille
  [0, ""],
  [11, "h........h"], // y18 rivets
]);

// ── EYES ── w white, k pupil, f frame, l lens, r red, R hot red, g glow, G glow hot, d dark ──
export const EYES_PLAIN = layer(13, [[12, "wk....wk"]]);
export const EYES_SPECTACLES = layer(12, [
  [11, "ffff..ffff"],
  [10, "ffwkfffwkff"],
  [11, "ffff..ffff"],
]);
export const EYES_PINCENEZ = layer(12, [
  [15, "ff"],
  [11, "fwkf..fwkf"],
  [12, "ll....llf"],
  [21, "c"],
  [21, "c"],
  [22, "c"],
  [22, "c"],
  [22, "c"],
]);
export const EYES_MONOCLE = layer(12, [
  [18, "ff"], //          y12
  [12, "kk...fwkf"], //   y13 left eye squints, right eye behind the glass
  [18, "ffc"], //         y14
  [21, "c"],
  [21, "c"],
  [22, "c"],
  [22, "c"],
  [22, "c"],
  [21, "c"],
]);
export const EYES_SHADES = layer(12, [
  [10, "dddddddddddd"],
  [11, "dhdddddhdd"],
  [11, "ddd....ddd"],
]);
export const EYES_VISOR = layer(12, [
  [9, "ffffffffffffff"],
  [9, "fggGgggggggGgf"],
  [9, "ffffffffffffff"],
]);
export const EYES_LASER = layer(12, [
  [1, "rr.r.rr.rr.Rr....rR.rr.rr.r.rr"],
  [1, "RRRRRRRRRRRRR....RRRRRRRRRRRRR"],
  [1, "rr.r.rr.rr.Rr....rR.rr.rr.r.rr"],
]);
// Laser eye sockets (drawn under the beam row so the eyes themselves glow white-hot).
export const EYES_LASER_CORE = layer(13, [[12, "WW....WW"]]);

// ── HEADWEAR ── w base, h hi, l lo, d deep; hair: a base, A hi, z lo; band/hat: t,T,q ──────
export const WIG_BARRISTER = layer(2, [
  [12, "hhwwwwww"], //          y2
  [10, "hwwhwwhwwhww"], //      y3
  [9, "lwlllwlllwlllw"], //     y4
  [9, "hwwhwwhwwhwwhw"], //     y5
  [9, "llwlllwlllwlll"], //     y6
  [8, "hwhwwhwwhwwhwwhw"], //   y7
  [8, "llllllllllllllll"], //   y8
  [8, "hwh..........hwh"], //   y9  side rolls
  [8, "lll..........lll"], //   y10
  [8, "hwh..........hwh"], //   y11
  [8, "lll..........lll"], //   y12
  [8, "hwh..........hwh"], //   y13
  [8, "lll..........lll"], //   y14
  [8, "dd............dd"], //   y15 curl ends
]);

/** Mirror-symmetric mass: each entry is [outer x, inner x] for the left half (inner = first hole column, or 16 for solid). */
function mirrored(y0: number, spans: ReadonlyArray<readonly [number, number]>, ch = "C"): { y: number; g: string[] } {
  return {
    y: y0,
    g: spans.map(([o, i]) => {
      const row = Array<string>(32).fill(".");
      for (let x = o; x < Math.min(i, 16); x++) row[x] = row[31 - x] = ch;
      return row.join("");
    }),
  };
}

export const WIG_FULLBOTTOM = mirrored(1, [
  [11, 16], [9, 16], [8, 16], [7, 16], [6, 16], [6, 16], [5, 16], // y1..y7
  [5, 10], [5, 10], [5, 10], [5, 10], // y8..y11 face window x10..21
  [4, 10], [4, 10], [4, 10], [4, 10], // y12..y15
  [4, 11], [4, 11], [4, 11], // y16..y18
  [4, 12], [4, 12], [4, 12], [4, 12], [4, 12], [4, 12], // y19..y24 lappets over the shoulders
  [5, 12], [5, 12], [6, 12], [7, 11], // y25..y28
]);

export const HAIR_CURLS = mirrored(1, [
  [11, 16], [9, 16], [8, 16], [7, 16], [7, 16], [6, 16], [6, 16], // y1..y7
  [6, 10], [6, 10], [6, 10], [6, 10], [7, 10], [7, 10], [8, 10], [8, 10], // y8..y15
]);

export const HAIR_BALD = layer(9, [
  [9, "zz..........zz"],
  [9, "aa..........aa"],
  [9, "az..........za"],
  [10, "z..........z"],
]);

export const HAIR_SLICK = layer(3, [
  [12, "aaAAAaaa"], //          y3
  [10, "aaAAAaaaaaaa"], //      y4
  [9, "aaAAaaaaaaaaaz"], //     y5
  [9, "aAAaaaaaaaaaaz"], //     y6
  [9, "aAaazzzaaaaaaz"], //     y7
  [9, "aa.z...zaaaaaz"], //     y8  part + sweep
  [9, "az.......zzaaz"], //     y9
  [9, "a..........zaz"], //     y10
  [9, "z............z"], //     y11 sideburns
  [10, "z..........z"], //      y12
]);

export const HAIR_BUN = layer(0, [
  [0, ""],
  [13, "aAAaaz"], //           y1
  [12, "aAAAaaaz"], //         y2
  [12, "zaaaaazz"], //         y3
  [13, "ttttTT"], //           y4 tie
  [11, "aaAAaaaaaa"], //       y5
  [10, "aAAaaaaaaaaz"], //     y6
  [9, "aAAaaaazaaaaaz"], //    y7
  [9, "aAaaaaz.zaaaaz"], //    y8 centre part
  [9, "aaaz.......zaz"], //    y9
  [9, "aaz.........az"], //    y10
  [9, "az..........zz"], //    y11
  [9, "z............z"], //    y12
]);

export const HAT_TOP = layer(1, [
  [11, "TttttttttT"], //        y1
  [11, "Ttttttttqq"], //        y2
  [11, "Ttttttttqq"], //        y3
  [11, "Ttttttttqq"], //        y4
  [11, "Ttttttttqq"], //        y5
  [11, "bbbbbbbbbB"], //        y6 band
  [11, "Ttttttttqq"], //        y7
  [7, "TtttttttttttttttqQ"], // y8 brim
  [8, "qqqqqqqqqqqqqqqq"], //   y9 brim underside
  [9, "aa..........aa"], //     y10 hair at temples
  [9, "az..........za"], //     y11
  [10, "z..........z"], //      y12
]);

export const HAIR_BOB = layer(3, [
  [12, "aAAAaaaa"], //            y3
  [10, "aAAAAaaaaaaz"], //        y4
  [9, "aAAaaaaaaaaaaz"], //       y5
  [8, "aAAaaaaaaaaaaaaz"], //     y6
  [8, "aAaaaaaaaaaaaaaz"], //     y7
  [8, "aaaazazaazazaaaz"], //     y8 bangs
  [8, "aaz..........zaz"], //     y9
  [8, "aaz..........zaz"], //     y10
  [8, "aa............az"], //     y11
  [8, "aa............az"],
  [8, "aa............az"],
  [8, "aa............az"],
  [8, "aa............az"],
  [8, "az............zz"], //     y16
  [8, "az............zz"],
  [9, "z............z"], //       y18
]);

// ── ATTIRE ── a base, A shadow, L lapel/edge light, c shirt, C shirt shade, v waistcoat, F fold, B button
export const SUIT = layer(21, [
  [11, "acc....cca"], //                          y21
  [8, "aaaLccccccccLaaa"], //                     y22
  [6, "aaaaaaLccccccLaaaaaa"], //                 y23
  [4, "AaaaaaaaLccccccLaaaaaaaA"], //             y24
  [3, "AaaaaaaaaaLccccLaaaaaaaaaA"], //           y25
  [3, "AaaaAaaaaaLccccLaaaaaAaaaA"], //           y26
  [3, "AaaaAaaaaaaLccLaaaaaaAaaaA"], //           y27
  [3, "AaaaAaaaaaaLccLaaaaaaAaaaA"], //           y28
  [3, "AaaaAaaaaaaaLaaaaaaaaAaaaA"], //           y29
  [3, "AaaaAaaaaaaBLaaaaaaaaAaaaA"], //           y30
]);

export const ROBE = layer(21, [
  [11, "acc....cca"], //                          y21
  [7, "aaaaLccccccccLaaaa"], //                   y22
  [5, "aaaaaaaLccccccLaaaaaaa"], //               y23
  [3, "AaaaaaaaaLccccccLaaaaaaaaA"], //           y24
  [2, "AaaaFaaaaaLvccccvLaaaaaFaaaA"], //         y25
  [2, "AaaaFaaFaaLvvccvvLaaFaaFaaaA"], //         y26
  [2, "AaaaFaaFaaLvvvvvvLaaFaaFaaaA"], //         y27
  [2, "AaaaFaaFaaLvvBvvvLaaFaaFaaaA"], //         y28
  [2, "AaaaFaaFaaLvvvvvvLaaFaaFaaaA"], //         y29
  [2, "AaaaFaaFaaLvvBvvvLaaFaaFaaaA"], //         y30
]);

export const GOWN = layer(21, [
  [11, "acc....cca"], //                          y21
  [7, "aaaaLccccccccLaaaa"], //                   y22
  [5, "aaaaaaaLccccccLaaaaaaa"], //               y23
  [3, "AaaaGaaaaLccccccLaaaaGaaaA"], //           y24
  [2, "AaaaaGaaaaLvccccvLaaaaGaaaaA"], //         y25
  [2, "AaaaaGaaaaLvvvvvvLaaaaGaaaaA"], //         y26
  [2, "AaaaaaGaaaLvvvvvvLaaaGaaaaaA"], //         y27
  [2, "AaaaaaGaaaLvvvvvvLaaaGaaaaaA"], //         y28
  [2, "AaaaaaaGaaLvvvvvvLaaGaaaaaaA"], //         y29
  [2, "AaaaaaaGaaLvvvvvvLaaGaaaaaaA"], //         y30
]);

// ── NECKWEAR ── t base, T shade, k knot hi / w white, l lace shade ──────────────────────────
export const TIE = layer(22, [
  [15, "kk"],
  [15, "tT"],
  [15, "tT"],
  [15, "tT"],
  [14, "ttTT"],
  [14, "ttTT"],
  [15, "tT"],
]);
export const BOWTIE = layer(22, [
  [13, "t....t"],
  [13, "ttkkTT"],
  [13, "T....T"],
]);
export const JABOT = layer(21, [
  [14, "wwww"],
  [13, "wwwwww"],
  [13, "llwwll"],
  [13, "wwwwww"],
  [14, "llll"],
  [14, "wwww"],
  [15, "ll"],
]);
export const BANDS = layer(22, [
  [14, "wwww"],
  [14, "wlwl"],
  [14, "wlwl"],
  [14, "wlwl"],
  [14, "wlwl"],
  [14, "wlwl"],
]);
export const OPEN_COLLAR = layer(22, [
  [14, "SssS"],
  [15, "SS"],
]);

// ── HELD ── f skin, F skin shade; items use their own keys ─────────────────────────────────
export const HAND = layer(24, [
  [24, "hfff"],
  [23, "fffffF"],
  [23, "fFfFfF"],
  [24, "FFFF"],
  [23, "cccccC"],
]);

// g wood, G wood lo, h wood hi, y brass, Y brass lo
export const GAVEL = layer(15, [
  [23, "yhhhhhhy"], //  y15
  [23, "yggggggy"], //  y16
  [23, "yggggggy"], //  y17
  [23, "YGGGGGGY"], //  y18
  [26, "hG"], //        y19
  [26, "hG"],
  [26, "hG"],
  [26, "hG"],
  [26, "hG"], //        y23
  [0, ""],
  [0, ""],
  [0, ""],
  [0, ""],
  [26, "hG"], //        y28
]);

// w vane, W vane shade, s shaft, n nib
export const QUILL = layer(9, [
  [30, "w"], //          y9
  [29, "ww"], //         y10
  [28, "wwW"], //        y11
  [28, "wW"], //         y12
  [27, "wwW"], //        y13
  [27, "wWs"], //        y14
  [26, "wwWs"], //       y15
  [26, "wWs"], //        y16
  [25, "wwWs"], //       y17
  [25, "wWs"], //        y18
  [25, "wsW"], //        y19
  [25, "sW"], //         y20
  [25, "s"], //          y21
  [25, "s"], //          y22
  [25, "s"], //          y23
  [0, ""],
  [0, ""],
  [0, ""],
  [0, ""],
  [25, "n"], //          y28
]);

// b leather, B leather lo, h leather hi, y clasp, k handle
export const BRIEFCASE = layer(21, [
  [23, "kkkkk"], //             y21
  [23, "k...k"], //             y22
  [19, "hhhhhhhhhhhh"], //      y23
  [19, "hbbbbbbbbbbB"], //      y24
  [19, "BBBBByyBBBBB"], //      y25
  [19, "hbbbbYYbbbbB"], //      y26
  [19, "hbbbbbbbbbbB"], //      y27
  [19, "hbbbbbbbbbbB"], //      y28
  [19, "hbbbbbbbbbbB"], //      y29
  [19, "BBBBBBBBBBBB"], //      y30
]);

// y brass, Y brass lo, h brass hi
export const SCALES = layer(13, [
  [25, "h"], //                  y13 finial
  [20, "yyyyyhyyyyy"], //        y14 beam
  [21, "Y...y...Y"], //          y15
  [21, "Y...y...Y"], //          y16
  [21, "Y...y..hyY"], //         y17 right pan (lighter, rides high)
  [20, "hyY..y...Y"], //         y18 left pan
  [21, "Y...y"], //              y19
  [25, "y"], //                  y20
  [25, "y"], //                  y21
  [25, "y"], //                  y22
  [25, "y"], //                  y23
  [0, ""],
  [0, ""],
  [0, ""],
  [0, ""],
  [24, "hyY"], //                y28 base
]);

// c cover, C cover lo, h cover hi, y gilt, p pages, P page shade
export const BOOK = layer(19, [
  [21, "hhhhhhhh"], //            y19
  [20, "Chccccccccp"], //         y20
  [20, "Chyyyyyyccp"], //         y21
  [20, "Chccccccccp"], //         y22
  [20, "ChcyyyyyccP"], //         y23
  [20, "ChcyccYyccp"], //         y24
  [20, "ChcyyyyyccP"], //         y25
  [20, "Chccccccccp"], //         y26
  [20, "Chyyyyyyccp"], //         y27
  [20, "ChccccccccP"], //         y28
  [20, "CCCCCCCCCCp"], //         y29
  [21, "pPpPpPpPpP"], //          y30
]);

// k lacquer, K lacquer hi, y brass, n nib
export const PEN = layer(17, [
  [30, "n"], //       y17
  [29, "y"], //       y18
  [28, "kK"], //      y19
  [27, "kK"], //      y20
  [26, "kK"], //      y21
  [25, "yK"], //      y22
  [24, "kK"], //      y23
]);

// Practice pins (3×3), drawn at (8,25). p pin colour, P pin shade.
export const PINS: Record<string, string[]> = {
  Corporate: [".p.", "pPp", ".p."],
  Securities: ["ppp", "p.p", "ppP"],
  Litigation: ["p.p", ".P.", "p.p"],
  Contracts: ["ppp", "PPP", "ppp"],
  Tax: [".p.", "ppp", "pPp"],
  IP: [".p.", "pPp", "ppp"],
  Regulatory: ["ppp", "pPp", ".p."],
  Arbitration: ["ppp", ".P.", "ppp"],
  Bankruptcy: ["p..", "pP.", "ppp"],
  Admiralty: [".p.", "pPp", "p.p"],
};
