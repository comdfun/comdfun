#!/usr/bin/env node
// The 3:1 promo banner: the name in the middle, the product's own screens set round it, the collection behind.
//
//   node scripts/promo.mjs --base http://localhost:3124        → public/banner-3x1.png (1800×600) and @2x,
//                                                                 plus banner-3x1-text.png: the same without screens
//
// Every screen is photographed from the running site rather than drawn, so the banner shows the product as it
// is and ages with it. Element-level captures (the buy panel, the catalogue, the dashboard) are taken at 2×, so
// they stay sharp at the size they are shown. Needs the site running (NEXT_PUBLIC_MOCK=1 is fine).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { siteFonts } from "./banner/fonts.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || process.env.PLAYWRIGHT_MODULE || "playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const base = flag("base", "http://localhost:3000").replace(/\/$/, "");
const out = resolve(flag("out", join(HERE, "..", "public")));
mkdirSync(out, { recursive: true });

/** Stop everything that moves and show everything that reveals, so a capture is the settled page. */
const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important} .rv,[data-rv]{opacity:1!important;transform:none!important}" });
  await page.waitForTimeout(200);
};

const SHOTS = [
  // Four whole windows at one size, so they sit as a set. 1280×800 is the shape of a laptop screen, which is
  // what a browser window is expected to look like, and small enough that the site's type survives the shrink.
  { key: "GATE", path: "/" },
  { key: "RETAIN", path: "/jobs" },
  { key: "ICM", path: "/icm", prep: async (p) => {
    await p.fill(".buy-row input", "250000");
    await p.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
    await p.waitForTimeout(400);
  } },
  // the collection: all 2,000 agents, live
  { key: "CAT", path: "/agents" },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let html = readFileSync(join(HERE, "banner", "promo.html"), "utf8").replaceAll("__ART__", `${base}/art`).replace("__FONTS__", await siteFonts(base));

for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.vw ?? 1280, height: s.vh ?? 800 }, deviceScaleFactor: 2 });
  await page.goto(`${base}${s.path}`, { waitUntil: "networkidle", timeout: 60_000 });
  if (s.prep) await s.prep(page);
  await settle(page);
  let buf;
  if (s.el) {
    const el = page.locator(s.el).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) throw new Error(`${s.el} not found on ${s.path}`);
    buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, s.maxH ?? box.height) } });
  } else {
    buf = await page.screenshot();
  }
  html = html.replaceAll(`__SHOT_${s.key}__`, `data:image/png;base64,${buf.toString("base64")}`);
  console.log(`shot  ${s.key.padEnd(7)} ${s.path}${s.el ? " " + s.el : ""}  ${(buf.length / 1024).toFixed(0)}kB`);
  await page.close();
}

// the full banner, and a text-only one (no screens, larger type) from the same template
const bare = html.replace('<div class="p">', '<div class="p bare">');
for (const [scale, name, doc] of [[1, "banner-3x1.png", html], [2, "banner-3x1@2x.png", html], [1, "banner-3x1-text.png", bare], [2, "banner-3x1-text@2x.png", bare]]) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 600 }, deviceScaleFactor: scale });
  await page.setContent(doc, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const file = join(out, name);
  writeFileSync(file, await page.locator(".p").screenshot());
  console.log(`promo ${1800 * scale}×${600 * scale}  ${file}`);
  await page.close();
}
await browser.close();
