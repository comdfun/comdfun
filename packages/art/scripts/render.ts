// npm run render -w @company/art
// Writes cards, portraits, metadata, contact sheet, rarity table and brand files to packages/art/out.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderCounsel, renderCardPNG, collectionMetadata, composeCard, composeCounsel, metadata, traitTable, attributesOf, MAX_SUPPLY,
  logoSvg, wordmarkSvg, icons, logoRaster, wordmarkRaster, encodePNG, Raster, BRAND, CARD_W, CARD_H, ICON_GRIDS,
} from "../src/index.js";
import { drawText, textWidth } from "../src/font.js";
import { P } from "../src/palette.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const env = process.env;
const opts = {
  apiUrl: env.PUBLIC_API_URL ?? "https://api.comd.fun",
  webUrl: env.PUBLIC_WEB_URL ?? "https://comd.fun",
  chainId: Number(env.CHAIN_ID ?? 4663),
  tokenContract: env.COUNSEL_NFT ?? "0x0000000000000000000000000000000000000000",
  agentRegistry: env.IDENTITY_REGISTRY ?? null,
};

for (const d of ["cards", "portraits", "metadata", "brand/icons"]) {
  rmSync(join(OUT, d), { recursive: true, force: true });
  mkdirSync(join(OUT, d), { recursive: true });
}

const t0 = Date.now();
traitTable();
const counts: Record<string, Record<string, number>> = {};
for (let id = 1; id <= MAX_SUPPLY; id++) {
  writeFileSync(join(OUT, "cards", `${id}.png`), renderCardPNG(id, 8));
  writeFileSync(join(OUT, "portraits", `${id}.svg`), renderCounsel(id, { size: 320 }).svg);
  writeFileSync(join(OUT, "metadata", `${id}.json`), JSON.stringify(metadata(id, opts), null, 2) + "\n");
  for (const { trait_type, value } of attributesOf(id)) {
    (counts[trait_type] ??= {})[value] = (counts[trait_type][value] ?? 0) + 1;
  }
  if (id % 250 === 0) process.stdout.write(`  ${id}/${MAX_SUPPLY}\n`);
}
writeFileSync(join(OUT, "metadata", "collection.json"), JSON.stringify(collectionMetadata({ apiUrl: opts.apiUrl, webUrl: opts.webUrl, feeRecipient: env.TREASURY_ADDRESS }), null, 2) + "\n");
const rarity = Object.fromEntries(
  Object.entries(counts).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort((a, b) => b[1] - a[1]))]),
);
writeFileSync(join(OUT, "rarity.json"), JSON.stringify({ supply: MAX_SUPPLY, traits: rarity }, null, 2) + "\n");

// contact sheet: first 100 cards, 10×10, cards at 2×
{
  const s = 2, gap = 8, cols = 10;
  const W = cols * CARD_W * s + (cols + 1) * gap, H = 10 * CARD_H * s + 11 * gap;
  const sheet = new Raster(W, H, BRAND.black);
  for (let i = 0; i < 100; i++) {
    sheet.blit(composeCard(i + 1), gap + (i % cols) * (CARD_W * s + gap), gap + Math.floor(i / cols) * (CARD_H * s + gap), s);
  }
  writeFileSync(join(OUT, "contact-sheet.png"), encodePNG(sheet, 1));
}

// brand
writeFileSync(join(OUT, "brand", "logo.svg"), logoSvg({ size: 512 }));
writeFileSync(join(OUT, "brand", "wordmark.svg"), wordmarkSvg({ height: 60 }));
for (const [k, svg] of Object.entries(icons)) writeFileSync(join(OUT, "brand", "icons", `${k}.svg`), svg);

// icon sheet (review aid): every icon at 4× with its name
{
  const names = Object.keys(ICON_GRIDS) as (keyof typeof ICON_GRIDS)[];
  const cols = 6, cell = 44;
  const r = new Raster(cols * cell, Math.ceil(names.length / cols) * cell, BRAND.black);
  names.forEach((n, i) => {
    const x = (i % cols) * cell + 6, y = Math.floor(i / cols) * cell + 4;
    ICON_GRIDS[n].forEach((row, yy) => [...row].forEach((c, xx) => c === "#" && r.rect(x + xx * 2, y + yy * 2, 2, 2, P.parch)));
    drawText(r, n.slice(0, 10), x - 4, y + 34, BRAND.muted);
  });
  writeFileSync(join(OUT, "brand", "icons.png"), encodePNG(r, 4));
}

// Banners, lockups, favicons and the OG image are produced by `npm run brand` (scripts/brand.ts).

console.log(`rendered ${MAX_SUPPLY} counsel + brand to ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
