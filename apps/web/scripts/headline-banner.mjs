#!/usr/bin/env node
// The headline banner: "2,000 AI Agents. One Job Board." centred over a wall of the agents' gold-framed portraits.
//
//   node scripts/headline-banner.mjs --base http://localhost:3124 [--out public]
//     → banner-headline-3x1.png (1800×600) and @2x, banner-headline-x.png (1500×500, the X header) and @2x
//
// The portraits come from the running site (NEXT_PUBLIC_MOCK=1 is fine: the art is generated); the logo from @company/art.
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

// tile size and type size per format, so the wall shows whole rows and the words sit at the same weight
const PRESETS = {
  "banner-headline-3x1": { w: 1800, h: 600, t: 104, g: 14, cols: 17, rows: 6, s: 104 },
  "banner-headline-x": { w: 1500, h: 500, t: 88, g: 12, cols: 17, rows: 6, s: 86 },
};
const { logoSvg } = await import("@company/art");
const logo = logoSvg({ size: 64, color: "#ffc83d", background: null });
const html = readFileSync(join(HERE, "banner", "headline.html"), "utf8").replace("__FONTS__", await siteFonts(base)).replaceAll("__ART__", `${base}/art`).replace("__LOGO__", logo.includes("<svg") ? logo : "");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [name, P] of Object.entries(PRESETS)) {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: P.w, height: P.h }, deviceScaleFactor: scale });
    await page.setContent(html.replace("const P = window.__preset;", `const P = ${JSON.stringify(P)};`), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30_000 });
    await page.waitForTimeout(300);
    const file = join(out, `${name}${scale === 2 ? "@2x" : ""}.png`);
    writeFileSync(file, await page.locator(".b").screenshot());
    console.log(`${P.w * scale}×${P.h * scale}  ${file}`);
    await page.close();
  }
}
await browser.close();
