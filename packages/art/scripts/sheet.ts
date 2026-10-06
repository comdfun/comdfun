// Dev helper: contact sheet of cards for an id range. Usage: tsx scripts/sheet.ts out.png from count [scale]
import { writeFileSync } from "node:fs";
import { composeCard, CARD_W, CARD_H } from "../src/card.js";
import { Raster } from "../src/raster.js";
import { encodePNG } from "../src/png.js";
const [out, from = "1", count = "40", sc = "2"] = process.argv.slice(2);
const n = Number(count), s = Number(sc), cols = 10, gap = 6;
const sheet = new Raster(cols * (CARD_W * s + gap) + gap, Math.ceil(n / cols) * (CARD_H * s + gap) + gap, 0);
for (let i = 0; i < n; i++) sheet.blit(composeCard(Number(from) + i), gap + (i % cols) * (CARD_W * s + gap), gap + Math.floor(i / cols) * (CARD_H * s + gap), s);
writeFileSync(out, encodePNG(sheet, 1));
