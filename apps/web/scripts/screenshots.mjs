// Screenshot key pages (desktop + mobile). Usage: BASE=http://localhost:3100 node scripts/screenshots.mjs [filter]
// Env: PLAYWRIGHT_MODULE (path or name of the playwright package, default "playwright"),
//      CHROMIUM_PATH (browser binary; default: the one bundled with Playwright).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(pwPath);
const BASE = process.env.BASE || "http://localhost:3100";
const OUT = process.env.OUT || path.resolve("screenshots");
fs.mkdirSync(OUT, { recursive: true });
const filter = process.argv[2];

async function firstHref(page, url, selector) {
  await page.goto(BASE + url, { waitUntil: "load" });
  return page.$eval(selector, (a) => a.getAttribute("href")).catch(() => null);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const job = await firstHref(p, "/jobs", ".rows .rowlink");
const oracle = await firstHref(p, "/oracle?tab=signed", ".rows .rowlink");
const hb = await firstHref(p, "/heartbeats", ".rows .rowlink");
const pub = await firstHref(p, "/published?tab=tokens", "a[href^='/launches/']");
await ctx.close();

const pages = [
  ["home", "/"],
  ["jobs", "/jobs"],
  ["job", job],
  ["oracle", "/oracle"],
  ["oracle-detail", oracle],
  ["published", "/published"],
  ["heartbeats", "/heartbeats"],
  ["heartbeat", hb],
  ["agents", "/agents"],
  ["agent", "/agents/3"],
  ["launch", "/launch"],
  ["launch-oracle", "/launch?mode=oracle"],
  ["launch-retainer", "/launch?mode=retainer"],
  ["launch-detail", pub],
  ["token", "/token"],
  ["docs", "/docs"],
  ["mint", "/mint"],
  ["pair", "/pair?code=K7Q2-M9"],
  ["swap", "/swap"],
  ["flywheel", "/flywheel"],
  ["docs-quickstart", "/docs/quickstart"],
  ["docs-run-an-agent", "/docs/run-an-agent"],
  ["docs-comd", "/docs/comd"],
  ["docs-contracts", "/docs/contracts"],
  ["docs-api", "/docs/api"],
  ["incorporations", "/incorporations"],
  ["incorporation", "/incorporations/0x1a00000000000000000000000000000000000003"],
].filter(([n, u]) => u && (!filter || n.startsWith(filter)));

for (const [vpName, vp, full] of [["desktop", { width: 1360, height: 900 }, true], ["mobile", { width: 390, height: 844 }, true]]) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: vpName === "mobile" ? 2 : 1 });
  const page = await c.newPage();
  for (const [name, url] of pages) {
    try {
      await page.goto(BASE + url, { waitUntil: "load", timeout: 120000 });
      await page.waitForTimeout(1500);
      if (name === "launch" && process.env.CHECK !== "0") {
        await page.fill("#objective", "A staking vault for $BRIEF that pays stakers 50% of swap fees, with tests, and a site showing APR and a connected wallet's position.");
        await page.click("button:has-text('Check')");
        await page.waitForTimeout(2600);
      }
      if (name === "docs-quickstart") {
        await page.fill("#docs-q", "permit2 approval");
        await page.waitForTimeout(400);
      }
      await page.addStyleTag({ content: ".statusbar{position:static!important}" });
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(1200);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (sw > 0) console.warn(`  ! ${vpName} ${name}: horizontal overflow ${sw}px`);
      await page.screenshot({ path: path.join(OUT, `${name}-${vpName}.png`), fullPage: full });
      console.log(`ok ${vpName} ${name}`);
    } catch (e) {
      console.error(`fail ${vpName} ${name}: ${e.message.split("\n")[0]}`);
    }
  }
  await c.close();
}
// hero animation frames (gavel, walkers, scales) to verify motion
if (!filter || filter === "hero") {
  const c = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await c.newPage();
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(3000);
  const fig = await page.$(".scene-frame");
  for (const [i, t] of [[1, 0], [2, 1300], [3, 1500]]) {
    await page.waitForTimeout(t);
    await fig.screenshot({ path: path.join(OUT, `hero-frame-${i}.png`) });
    console.log(`ok hero frame ${i}`);
  }
  await c.close();
}
await browser.close();
