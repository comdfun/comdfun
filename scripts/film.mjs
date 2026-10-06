#!/usr/bin/env node
// Render the explainer film (apps/web/app/film) to MP4: frame-exact capture by seeking the page's animations, then ffmpeg.
//
//   node scripts/film.mjs [--url http://localhost:3000/film] [--out docs/media/film.mp4] [--fps 30] [--seconds 69]
//
// Needs: the web app running (any mode; `NEXT_PUBLIC_MOCK=1 npm run build -w @company/web && npm run start -w ...`),
// Playwright (`npm i -D playwright` or PLAYWRIGHT_PATH), Chromium (CHROMIUM_PATH or Playwright's), and ffmpeg on PATH.
import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const url = opt("url", "http://localhost:3000/film");
const out = resolve(opt("out", "docs/media/film.mp4"));
const fps = Number(opt("fps", "30"));
const seconds = Number(opt("seconds", "69"));
const width = 1920, height = 1080;

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const frames = join(tmpdir(), `comd-film-${Date.now()}`);
mkdirSync(frames, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--disable-gpu-vsync", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const cdp = await page.context().newCDPSession(page);
// Load normally (fonts, portraits, hydration), then drive the film frame by frame through window.__filmSeek(T):
// every CSS animation is paused and placed at its local time, so a frame is a pure function of T.
const sep = url.includes("?") ? "&" : "?";
await page.goto(url + sep + "manual=1", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => typeof window.__filmSeek === "function");
const total = Math.round(seconds * fps);
const step = 1000 / fps;
const t0 = Date.now();
const { writeFileSync } = await import("node:fs");
for (let i = 0; i < total; i++) {
  await page.evaluate((T) => window.__filmSeek(T), i * step);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(frames, `f${String(i).padStart(5, "0")}.png`), Buffer.from(shot.data, "base64"));
  if (i % (fps * 5) === 0) console.log(`frame ${i}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
await browser.close();

mkdirSync(resolve(out, ".."), { recursive: true });
const ff = spawnSync("ffmpeg", ["-y", "-framerate", String(fps), "-i", join(frames, "f%05d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "inherit" });
if (ff.status !== 0) { console.error("ffmpeg failed"); process.exit(1); }
rmSync(frames, { recursive: true, force: true });
console.log(`wrote ${out} (${seconds}s @ ${fps}fps, ${width}x${height})`);
