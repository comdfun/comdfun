// Trait vocabulary (SPEC §4), rarity weights, and the deterministic uniqueness table.
import { rng, pickWeighted } from "./hash.js";
import { ROMAN } from "./font.js";

export const MAX_SUPPLY = 2000;
export const FOUNDERS = 10;

export const PRACTICES = ["Corporate", "Securities", "Litigation", "Contracts", "Tax", "IP", "Regulatory", "Arbitration", "Bankruptcy", "Admiralty"] as const;
export const HEADWEAR = ["Barrister wig", "Full-bottom wig", "Bald", "Slick", "Bun", "Curls", "Hat", "Bob"] as const;
export const SKINS = ["Porcelain", "Fair", "Olive", "Tan", "Brown", "Deep", "Chrome robot", "Gold robot"] as const;
export const EYES = ["Plain", "Spectacles", "Pince-nez", "Monocle", "Shades", "Visor", "Laser"] as const;
export const ATTIRE = ["Black robe", "Navy suit", "Charcoal suit", "Pinstripe", "Tweed", "Gown with bands"] as const;
export const NECKWEAR = ["Tie", "Bow tie", "Jabot", "Bands", "None"] as const;
export const HELD = ["Gavel", "Quill", "Briefcase", "Scales", "Law book", "Pen", "None"] as const;
export const BACKDROPS = ["Black", "Chamber wood", "Library", "Courtroom", "Vault brass"] as const;

export type Practice = (typeof PRACTICES)[number];
export type Headwear = (typeof HEADWEAR)[number];
export type Skin = (typeof SKINS)[number];
export type Eyes = (typeof EYES)[number];
export type Attire = (typeof ATTIRE)[number];
export type Neckwear = (typeof NECKWEAR)[number];
export type Held = (typeof HELD)[number];
export type Backdrop = (typeof BACKDROPS)[number];

/** Non-trait cosmetic variation (hair colour, tie colour, etc.). Seeded, but not part of uniqueness. */
export type Hair = "Raven" | "Chestnut" | "Auburn" | "Flaxen" | "Silver" | "Snow" | "Copper";
export type Accent = "Oxblood" | "Brass" | "Verdigris" | "Navy" | "Parchment";
export type Scheme = "Brass" | "Oxblood" | "Verdigris" | "Parchment" | "Ink" | "Gilt" | "Ember" | "Night" | "Ivory" | "Natural";

export interface Traits {
  practice: Practice;
  headwear: Headwear;
  skin: Skin;
  eyes: Eyes;
  attire: Attire;
  neckwear: Neckwear;
  held: Held;
  backdrop: Backdrop;
  hair: Hair;
  accent: Accent;
  /** Founding Partners only. */
  founder?: { title: string; scheme: Scheme };
}

const W = {
  practice: [["Corporate", 14], ["Securities", 12], ["Litigation", 14], ["Contracts", 12], ["Tax", 10], ["IP", 10], ["Regulatory", 9], ["Arbitration", 8], ["Bankruptcy", 6], ["Admiralty", 5]],
  headwear: [["Barrister wig", 24], ["Full-bottom wig", 6], ["Bald", 10], ["Slick", 16], ["Bun", 11], ["Curls", 11], ["Hat", 7], ["Bob", 15]],
  skin: [["Porcelain", 16], ["Fair", 16], ["Olive", 16], ["Tan", 16], ["Brown", 16], ["Deep", 16], ["Chrome robot", 3.2], ["Gold robot", 0.8]],
  eyes: [["Plain", 40], ["Spectacles", 18], ["Pince-nez", 10], ["Monocle", 8], ["Shades", 10], ["Visor", 5], ["Laser", 1.4]],
  attire: [["Black robe", 28], ["Navy suit", 18], ["Charcoal suit", 16], ["Pinstripe", 12], ["Tweed", 10], ["Gown with bands", 8]],
  held: [["Gavel", 16], ["Quill", 16], ["Briefcase", 13], ["Scales", 9], ["Law book", 16], ["Pen", 12], ["None", 18]],
  backdrop: [["Black", 42], ["Chamber wood", 18], ["Library", 16], ["Courtroom", 16], ["Vault brass", 6]],
  hair: [["Raven", 22], ["Chestnut", 22], ["Auburn", 12], ["Flaxen", 12], ["Silver", 14], ["Snow", 8], ["Copper", 8]],
  accent: [["Oxblood", 30], ["Brass", 20], ["Verdigris", 15], ["Navy", 20], ["Parchment", 15]],
} as const;

/** Neckwear depends on attire: barristers wear bands, suits wear ties. Silk gowns always carry bands. */
const NECK_BY_ATTIRE: Record<Attire, ReadonlyArray<readonly [Neckwear, number]>> = {
  "Black robe": [["Bands", 40], ["Jabot", 25], ["Bow tie", 15], ["Tie", 10], ["None", 10]],
  "Gown with bands": [["Bands", 1]],
  "Navy suit": [["Tie", 50], ["Bow tie", 20], ["None", 22], ["Jabot", 8]],
  "Charcoal suit": [["Tie", 50], ["Bow tie", 20], ["None", 22], ["Jabot", 8]],
  Pinstripe: [["Tie", 55], ["Bow tie", 25], ["None", 20]],
  Tweed: [["Tie", 35], ["Bow tie", 40], ["None", 25]],
};

function roll(r: () => number): Traits {
  const skin = pickWeighted(r, W.skin);
  const robot = skin === "Chrome robot" || skin === "Gold robot";
  // Robots are three times as likely to wear a visor.
  const eyesTable = robot ? W.eyes.map(([k, w]) => [k, k === "Visor" ? w * 3 : w] as const) : W.eyes;
  const attire = pickWeighted(r, W.attire);
  return {
    practice: pickWeighted(r, W.practice),
    headwear: pickWeighted(r, W.headwear),
    skin,
    eyes: pickWeighted(r, eyesTable),
    attire,
    neckwear: pickWeighted(r, NECK_BY_ATTIRE[attire]),
    held: pickWeighted(r, W.held),
    backdrop: pickWeighted(r, W.backdrop),
    hair: pickWeighted(r, W.hair),
    accent: pickWeighted(r, W.accent),
  };
}

/** The ten hand-tuned 1/1 Founding Partners. Every one has a colour scheme no other seat can roll. */
export const FOUNDING_PARTNERS: ReadonlyArray<Traits> = [
  { practice: "Corporate", headwear: "Full-bottom wig", skin: "Gold robot", eyes: "Laser", attire: "Gown with bands", neckwear: "Bands", held: "Gavel", backdrop: "Vault brass", hair: "Snow", accent: "Brass", founder: { title: "Managing Partner", scheme: "Gilt" } },
  { practice: "Litigation", headwear: "Full-bottom wig", skin: "Deep", eyes: "Monocle", attire: "Black robe", neckwear: "Jabot", held: "Scales", backdrop: "Courtroom", hair: "Snow", accent: "Oxblood", founder: { title: "Senior Partner", scheme: "Oxblood" } },
  { practice: "Securities", headwear: "Slick", skin: "Chrome robot", eyes: "Visor", attire: "Pinstripe", neckwear: "Tie", held: "Briefcase", backdrop: "Vault brass", hair: "Silver", accent: "Verdigris", founder: { title: "Partner, Markets", scheme: "Verdigris" } },
  { practice: "Contracts", headwear: "Barrister wig", skin: "Porcelain", eyes: "Pince-nez", attire: "Gown with bands", neckwear: "Bands", held: "Quill", backdrop: "Library", hair: "Snow", accent: "Parchment", founder: { title: "Partner, Drafting", scheme: "Parchment" } },
  { practice: "Arbitration", headwear: "Hat", skin: "Brown", eyes: "Shades", attire: "Charcoal suit", neckwear: "Bow tie", held: "Gavel", backdrop: "Black", hair: "Raven", accent: "Brass", founder: { title: "Partner, Disputes", scheme: "Ink" } },
  { practice: "IP", headwear: "Bun", skin: "Olive", eyes: "Spectacles", attire: "Tweed", neckwear: "Bow tie", held: "Law book", backdrop: "Library", hair: "Copper", accent: "Oxblood", founder: { title: "Partner, Patents", scheme: "Ember" } },
  { practice: "Regulatory", headwear: "Bob", skin: "Fair", eyes: "Visor", attire: "Navy suit", neckwear: "Tie", held: "Scales", backdrop: "Courtroom", hair: "Raven", accent: "Navy", founder: { title: "Partner, Compliance", scheme: "Night" } },
  { practice: "Tax", headwear: "Bald", skin: "Tan", eyes: "Monocle", attire: "Pinstripe", neckwear: "Bow tie", held: "Pen", backdrop: "Vault brass", hair: "Silver", accent: "Brass", founder: { title: "Partner, Revenue", scheme: "Brass" } },
  { practice: "Admiralty", headwear: "Curls", skin: "Chrome robot", eyes: "Laser", attire: "Black robe", neckwear: "Jabot", held: "Quill", backdrop: "Chamber wood", hair: "Snow", accent: "Verdigris", founder: { title: "Partner, Maritime", scheme: "Ivory" } },
  { practice: "Bankruptcy", headwear: "Barrister wig", skin: "Gold robot", eyes: "Plain", attire: "Black robe", neckwear: "Bands", held: "Law book", backdrop: "Chamber wood", hair: "Snow", accent: "Oxblood", founder: { title: "Partner, Restructuring", scheme: "Natural" } },
];

export function comboKey(t: Traits): string {
  return [t.practice, t.headwear, t.skin, t.eyes, t.attire, t.neckwear, t.held, t.backdrop].join("|");
}

let TABLE: Traits[] | null = null;

/**
 * Built once: tokens 1..2000 in order. Each token rolls from sfc32(sha256("the-company:counsel:<id>"));
 * on a combo collision it re-rolls from "the-company:counsel:<id>:<attempt>" until unique.
 */
export function traitTable(): readonly Traits[] {
  if (TABLE) return TABLE;
  const seen = new Set<string>();
  const out: Traits[] = [];
  FOUNDING_PARTNERS.forEach((t) => seen.add(comboKey(t)));
  for (let id = 1; id <= MAX_SUPPLY; id++) {
    if (id <= FOUNDERS) {
      out.push(FOUNDING_PARTNERS[id - 1]);
      continue;
    }
    let t = roll(rng(`the-company:counsel:${id}`));
    for (let attempt = 1; seen.has(comboKey(t)); attempt++) t = roll(rng(`the-company:counsel:${id}:${attempt}`));
    seen.add(comboKey(t));
    out.push(t);
  }
  TABLE = out;
  return out;
}

export function assertTokenId(tokenId: number): void {
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > MAX_SUPPLY) throw new RangeError(`tokenId must be an integer in 1..${MAX_SUPPLY}`);
}

export function traitsOf(tokenId: number): Traits {
  assertTokenId(tokenId);
  return traitTable()[tokenId - 1];
}

/** Chambers I..XX: groups of 100 by tokenId. */
export function chambersOf(tokenId: number): number {
  return Math.floor((tokenId - 1) / 100) + 1;
}
export function chambersName(tokenId: number): string {
  return `Chambers ${ROMAN(chambersOf(tokenId))}`;
}
export function counselName(tokenId: number): string {
  return `Counsel #${String(tokenId).padStart(4, "0")}`;
}

export function attributesOf(tokenId: number): { trait_type: string; value: string }[] {
  const t = traitsOf(tokenId);
  const a = [
    { trait_type: "Practice", value: t.practice },
    { trait_type: "Headwear", value: t.headwear },
    { trait_type: "Skin", value: t.skin },
    { trait_type: "Eyes", value: t.eyes },
    { trait_type: "Attire", value: t.attire },
    { trait_type: "Neckwear", value: t.neckwear },
    { trait_type: "Held", value: t.held },
    { trait_type: "Backdrop", value: t.backdrop },
    { trait_type: "Chambers", value: chambersName(tokenId) },
  ];
  if (t.founder) {
    a.push({ trait_type: "Founding Partner", value: t.founder.title });
    a.push({ trait_type: "Scheme", value: t.founder.scheme });
  }
  return a;
}
