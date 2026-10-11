#!/usr/bin/env node
// Renders the brand banners from scripts/banner/template.html: a wall of real Counsel portraits behind the
// wordmark, set in IBM Plex Sans. One PNG per preset.
//
//   node scripts/banner.mjs                      # all presets → public/
//   node scripts/banner.mjs og --out /tmp        # one preset, elsewhere
//
// Presets: og 1200×630 (public/og.png, the link preview), x 1500×500 (the X header, centred so the avatar does
// not cover the copy), opensea 1400×350 (the collection banner).
// The portraits are read from a running web server (default http://localhost:3000; --base to change), so start
// `next start` (NEXT_PUBLIC_MOCK=1 is fine — the art is generated, not fetched) before running this.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { siteFonts } from "./banner/fonts.mjs";

const require = createRequire(import.meta.url);
// Playwright comes from the workspace, or PLAYWRIGHT_PATH / PLAYWRIGHT_MODULE (same convention as scripts/film.mjs)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || process.env.PLAYWRIGHT_MODULE || "playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
// og is the link card, x the profile header, opensea the collection banner. The 3:1 promo is its own
// composition, in scripts/promo.mjs.
const SIZES = { og: [1200, 630, "og.png"], x: [1500, 500, "banner-x.png"], opensea: [1400, 350, "banner-opensea.png"] };

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const base = flag("base", "http://localhost:3000").replace(/\/$/, "");
const out = resolve(flag("out", join(HERE, "..", "public")));
const want = args.filter((a) => !a.startsWith("--") && SIZES[a]);
const presets = want.length ? want : Object.keys(SIZES);

let html = readFileSync(join(HERE, "banner", "template.html"), "utf8").replaceAll("__ART__", `${base}/art`);
// Plex is not installed where this runs; without the site's own @font-face rules the banners render in a fallback sans
html = html.replace("</head>", `<style>${await siteFonts(base)}</style></head>`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

// The two desks, photographed from the running site rather than drawn: a banner that shows the actual product
// ages with it, and a mock of a screen is a thing to keep in sync forever. Inlined as data URIs so the template
// needs no second server and the render cannot half-finish with one screen missing.
const DESKS = { swarm: "/jobs", icm: "/icm" };
for (const [key, path] of Object.entries(DESKS)) {
  // A narrow viewport on purpose: shrunk into a 430px frame, a 1340px-wide page is unreadable grey. At 1060
  // the site's own type is large enough that the screen still reads as the product rather than as a texture.
  const page = await browser.newPage({ viewport: { width: 1060, height: 680 }, deviceScaleFactor: 2 });
  try {
    await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
    await page.evaluate(() => document.fonts.ready);
    // the reveal observer animates copy in; give it time, then stop anything still moving so two runs match
    await page.waitForTimeout(1600);
    await page.evaluate(() => {
      document.querySelectorAll("*").forEach((e) => { e.style.animation = "none"; e.style.transition = "none"; });
      document.querySelectorAll("[data-rv], .rv").forEach((e) => { e.style.opacity = "1"; e.style.transform = "none"; });
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(250);
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1060, height: 660 } });
    html = html.replaceAll(`__SHOT_${key.toUpperCase()}__`, `data:image/png;base64,${buf.toString("base64")}`);
    console.log(`shot  ${path}  ${(buf.length / 1024).toFixed(0)}kB`);
  } catch (e) {
    console.error(`[banner] could not photograph ${path}: ${e.message}`);
    console.error(`[banner] is the site running at ${base}? the banner needs it for both the art and the screens.`);
    await browser.close();
    process.exit(1);
  }
  await page.close();
}
for (const p of presets) {
  const [w, h, name] = SIZES[p];
  const page = await browser.newPage({ viewport: { width: w, height: h + 80 }, deviceScaleFactor: 1 });
  await page.setContent(html.replace("</head>", `<script>window.__preset=${JSON.stringify(p)}</script></head>`), { waitUntil: "load" });
  await page.waitForSelector(".b img");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const el = await page.$(".b");
  const file = join(out, name);
  writeFileSync(file, await el.screenshot());
  await page.close();
  console.log(`${p}  ${w}×${h}  ${file}`);
}
await browser.close();
