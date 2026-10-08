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

const require = createRequire(import.meta.url);
// Playwright comes from the workspace, or PLAYWRIGHT_PATH / PLAYWRIGHT_MODULE (same convention as scripts/film.mjs)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || process.env.PLAYWRIGHT_MODULE || "playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZES = { og: [1200, 630, "og.png"], x: [1500, 500, "banner-x.png"], opensea: [1400, 350, "banner-opensea.png"] };

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const base = flag("base", "http://localhost:3000").replace(/\/$/, "");
const out = resolve(flag("out", join(HERE, "..", "public")));
const want = args.filter((a) => !a.startsWith("--") && SIZES[a]);
const presets = want.length ? want : Object.keys(SIZES);

const html = readFileSync(join(HERE, "banner", "template.html"), "utf8").replaceAll("__ART__", `${base}/art`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
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
