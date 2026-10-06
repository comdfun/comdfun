// npm run brand -w @company/art — logo marks, favicons, lockups, banners and a brand sheet.
// Pure JS; every image is a logical pixel raster scaled by an integer (nearest neighbour).
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG, encodeICO } from "../src/png.js";
import { Raster, T, toCss } from "../src/raster.js";
import { ARCADE as A } from "../src/palette.js";
import { drawText, textWidth } from "../src/font.js";
import { drawText7, titleWidth } from "../src/font7.js";
import { composeFigure } from "../src/counsel.js";
import {
  logoMark, logoHorizontal, logoStacked, squareProfile, appleTouch, favicon,
  heroBanner, ogBanner, githubSocial, discordBanner, xHeader, title, TITLE_RAMP, type Asset,
} from "../src/brandkit.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out", "brand");
mkdirSync(OUT, { recursive: true });
for (const stale of ["og.png", "logo.png"]) rmSync(join(OUT, stale), { force: true });

const written: { file: string; w: number; h: number }[] = [];
function png(file: string, r: Raster, scale: number, transparent = false) {
  const buf = encodePNG(r, scale, transparent ? null : A.black);
  writeFileSync(join(OUT, file), buf);
  written.push({ file, w: r.w * scale, h: r.h * scale });
  return buf;
}
const asset = (file: string, a: Asset) => png(file, a.r, a.unit, a.transparent);

/** Pad a raster onto a canvas (for square marks). */
function onCanvas(src: Raster, w: number, h: number, bg: number = T): Raster {
  const r = new Raster(w, h, bg);
  r.blit(src, Math.floor((w - src.w) / 2), Math.floor((h - src.h) / 2));
  return r;
}

// 1. marks
const color = logoMark("color"), mono = logoMark("mono");
for (const s of [512, 1024, 2048]) png(`logo-mark-${s}.png`, color, s / 64, true);
for (const s of [512, 1024, 2048]) png(`logo-mark-gold-${s}.png`, mono, s / 64, true);
for (const s of [512, 1024]) png(`logo-mark-black-${s}.png`, onCanvas(color, 64, 64, A.black), s / 64);
const f16 = png("favicon-16.png", favicon(16), 1);
const f32 = png("favicon-32.png", favicon(32), 1);
const f48 = encodePNG(favicon(48), 1, A.black);
writeFileSync(join(OUT, "favicon.ico"), encodeICO([{ size: 16, png: f16 }, { size: 32, png: f32 }, { size: 48, png: f48 }]));
written.push({ file: "favicon.ico", w: 48, h: 48 });
png("apple-touch-icon-180.png", appleTouch(), 2);

// 2. lockups
asset("logo-horizontal-2400x600.png", logoHorizontal(true));
asset("logo-horizontal-black-2400x600.png", logoHorizontal(false));
asset("logo-stacked-1600.png", logoStacked());

// 3. banners
const hero = heroBanner(), og = ogBanner(), dc = discordBanner(), x = xHeader(), prof = squareProfile();
asset("hero-1920x1080.png", hero);
asset("og-1200x630.png", og);
asset("github-social-1280x640.png", githubSocial());
asset("discord-banner-960x540.png", dc);
asset("x-header-1500x500.png", x);
asset("square-profile-400.png", prof);

// 4. brand sheet
{
  const W = 1920, H = 2040, M = 60;
  const s = new Raster(W, H, A.black);
  const label = (t: string, x: number, y: number) => drawText(s, t, x, y, A.muted, 3);
  title(s, W / 2, 40, 10, TITLE_RAMP);
  const sub = "A SWARM OF NFT-IDENTIFIED AGENTS · AI TASKS ON CHAIN · COMD.FUN";
  drawText(s, sub, Math.round(W / 2 - (textWidth(sub) * 4) / 2), 176, A.gold, 4);

  // row A: marks, icons, palette
  let y = 250;
  s.blit(color, M, y, 4); label("MARK · COLOUR", M, y + 270);
  s.blit(mono, M + 300, y, 4); label("MARK · GOLD", M + 300, y + 270);
  s.blit(prof.r, M + 600, y + 28, 2); label("PROFILE 400", M + 600, y + 270);
  s.blit(appleTouch(), M + 840, y + 38, 2); label("APPLE 180", M + 840, y + 270);
  s.blit(favicon(32), M + 1060, y + 20, 4); label("FAVICON 32", M + 1060, y + 160);
  s.blit(favicon(16), M + 1060, y + 196, 4); label("16", M + 1136, y + 240);
  s.blit(favicon(32), M + 1200, y + 20, 1); s.blit(favicon(16), M + 1200, y + 60, 1); label("1:1", M + 1192, y + 84);
  const pal: [string, number][] = [["GOLD", A.gold], ["VIOLET", A.violet], ["CYAN", A.cyan], ["LIME", A.lime], ["CRIMSON", A.crimson], ["ORANGE", A.orange], ["PINK", A.pink], ["PARCHMENT", A.parchment], ["MUTED", A.muted]];
  pal.forEach(([n, c], i) => {
    const px = 1400 + (i % 3) * 152, py = y + Math.floor(i / 3) * 96;
    s.rect(px, py, 132, 52, c);
    drawText(s, n, px, py + 60, A.muted, 2);
    drawText(s, toCss(c), px, py + 74, A.parchDk, 2);
  });

  // row B: lockups
  y = 600;
  s.blit(logoHorizontal(false).r, M, y + 40, 3); label("LOCKUP · HORIZONTAL 2400×600".replace("×", "X"), M, y + 300);
  const st = logoStacked();
  s.blit(st.r, 1060, y - 20, 2); label("LOCKUP · STACKED 1600", 1060, y + 390);
  // full-length counsel specimen
  const ids = [12, 1, 26, 6];
  ids.forEach((id, i) => s.blit(composeFigure(id), 1470 + i * 94, y + 20, 3));
  label("COUNSEL · FULL LENGTH", 1470, y + 300);

  // row C: social banners
  y = 1040;
  s.blit(x.r, M, y, 2); label("X HEADER 1500X500", M, y + 262);
  s.blit(dc.r, M + 780, y, 2); label("DISCORD 960X540", M + 780, y + 282);
  s.blit(og.r, M + 1300, y, 2); label("OG 1200X630", M + 1300, y + 264);

  // row D: hero + type specimen
  y = 1360;
  s.blit(hero.r, M, y, 3); label("HERO 1920X1080", M, y + 552);
  const tx = M + 1010;
  drawText7(s, "ABCDEFGHIJKLM", tx, y, A.parchment, 4);
  drawText7(s, "NOPQRSTUVWXYZ", tx, y + 40, A.parchment, 4);
  drawText7(s, "0123456789 $·,.", tx, y + 80, A.gold, 4);
  label("DISPLAY · DOCKET ARCADE 7X7", tx, y + 124);
  drawText(s, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", tx, y + 170, A.parchment, 4);
  label("LABELS · DOCKET 3X5", tx, y + 200);
  { const tw = titleWidth("COMPANY•MD", { k: 4, outline: A.black }); title(s, tx + tw / 2, y + 240, 4); }
  label("TITLE · ARCADE EXTRUDE", tx, y + 340);

  s.rect(M, H - 70, W - 2 * M, 4, A.gold);
  drawText(s, "INTEGER-SCALED PIXELS · NEAREST NEIGHBOUR · PURE BLACK", M, H - 52, A.muted, 3);
  png("brand-sheet.png", s, 1);
}

for (const w of written) console.log(`${w.file.padEnd(40)} ${w.w}×${w.h}`);
