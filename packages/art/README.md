# @company/art

Pixel art for **Company.md** ($COMD, comd.fun): the 2,000 Counsel (portraits, bar cards, full-length figures), ERC-8004 metadata,
the logo mark, lockups, banners and the 16×16 icon set. Pure TypeScript, no native dependencies. Every image
is a logical pixel raster scaled by an **integer** factor with nearest neighbour, so there is no blur or
anti-aliasing anywhere.

```sh
npm run render -w @company/art   # 2,000 cards/portraits/metadata, contact sheet, rarity, icons, logo.svg
npm run brand  -w @company/art   # logo marks, favicons, lockups, banners, brand sheet  → out/brand/
npm test       -w @company/art
npm run build  -w @company/art
```

Import `@company/art` on the server (it includes PNG/ICO encoding via `node:zlib`) or `@company/art/svg` in
the browser.

## Brand files (`out/brand/`)

Palette: gold `#FFC83D`, violet `#9B5CFF`, cyan `#2DE2E6`, lime `#8CFF3A`, crimson `#FF3B5C`, orange `#FF8A1F`,
pink `#FF4FD8`, parchment `#F3EBD3`, muted `#9A9488`, on pure black. Display type is **Docket Arcade 7×7**
(2px stems, after Press Start 2P); labels use **Docket 3×5** (after Silkscreen). Both are drawn in `src/font7.ts` and
`src/font.ts`.

The wordmark is **COMPANY.MD** in the arcade face. In the lockups COMPANY is gold, the dot is a round crimson wax seal (the same
seal as on the mark's pediment) and MD is cyan. On banners COMPANY takes one arcade colour per letter, the seal is gold
and MD is parchment. The subline reads "2,000 AI COUNSEL · ON ROBINHOOD CHAIN · $COMD", and banners carry a small
"COMD.FUN" tag top right.

The mark is scales of justice in a pedimented portico with a crimson carpet on the steps. It has three
hand-placed masters: 64×64 for large uses, 32×32 for favicon-32, and 16×16 for favicon-16. Each is drawn to
stay legible at its own size, not downsampled from the larger one.

| File | Size | Pixel scale | Use |
|---|---|---|---|
| `logo-mark-512.png` · `-1024` · `-2048` | 512² · 1024² · 2048² | 8 · 16 · 32 | Full-colour mark, transparent. App stores, press, slides, print. |
| `logo-mark-gold-512.png` · `-1024` · `-2048` | same | same | Single-colour gold mark, transparent (interior knocked out). For embossing, foil, one-colour merch and watermarks. |
| `logo-mark-black-512.png` · `-1024` | 512² · 1024² | 8 · 16 | Colour mark on black, opaque. Marketplaces and anywhere transparency is flattened to white. |
| `favicon-16.png` | 16² | 1 | Browser tab (16 px master). |
| `favicon-32.png` | 32² | 1 | Browser tab / bookmarks (32 px master). |
| `favicon.ico` | 16, 32, 48 | 1 | Multi-size ICO (PNG-compressed entries). `/favicon.ico`. |
| `apple-touch-icon-180.png` | 180² | 2 | iOS home screen (opaque black; iOS rounds the corners). |
| `logo-horizontal-2400x600.png` | 2400×600 | 8 | Mark + COMPANY.MD wordmark + "ATTORNEYS AT LAW", transparent. Headers, docs, decks. |
| `logo-horizontal-black-2400x600.png` | 2400×600 | 8 | Same on black. |
| `logo-stacked-1600.png` | 1600² | 8 | Stacked lockup on black. Square placements, posters, splash. |
| `square-profile-400.png` | 400² | 4 | Avatar for X, Discord, GitHub, Farcaster. Mark centred inside the circle-crop safe area. |
| `x-header-1500x500.png` | 1500×500 | 4 | X/Twitter header. Courthouse at night with a Counsel lineup; the bottom-left ~400 px is kept clear for the avatar. |
| `og-1200x630.png` | 1200×630 | 5 | Open Graph / Twitter card image for the website (replaces the old `og.png`). |
| `discord-banner-960x540.png` | 960×540 | 4 | Discord server banner / invite splash. |
| `hero-1920x1080.png` | 1920×1080 | 6 | Website hero, video end-card, desktop wallpaper. |
| `brand-sheet.png` | 1920×2040 | mixed | One-page overview of every asset, the palette and the type. |
| `logo.svg` · `wordmark.svg` | vector | — | Pixel-exact SVGs (`logoSvg()`, `wordmarkSvg()`); `crispEdges`. |
| `icons/*.svg`, `icons.png` | 16² | — | 23 pixel icons in `currentColor` (`icons` export), plus a review sheet. |

Banner scenes use a Bayer-dithered night sky, stars and a moon, a two-layer city skyline with lit windows, and
the courthouse with cyan windows and a lit door. In front stands a lineup of real Counsel, drawn full-length by
`composeFigure(tokenId)` from the same trait sprites as the NFTs (Founding Partners keep their colour schemes).
Each banner uses one pixel scale throughout. The title is the 7×7 face at 2–3× with 1-unit outlines and extrusion.

## Counsel files (`out/`)

| Path | Contents |
|---|---|
| `cards/<id>.png` | 512×640 bar card (NFT image), 2,000 files |
| `portraits/<id>.svg` | 32×32 portrait SVG |
| `metadata/<id>.json` | ERC-8004 registration-v1 + OpenSea attributes. Image `https://api.comd.fun/agents/by-token/<id>.png`, external_url `https://comd.fun/agents/<id>` (override with `PUBLIC_API_URL`, `PUBLIC_WEB_URL`; also `CHAIN_ID`, `COUNSEL_NFT`, `IDENTITY_REGISTRY`) |
| `metadata/collection.json` | Collection (contractURI) metadata: "Company.md Counsel", symbol COUNSEL, 5% royalty (`TREASURY_ADDRESS` as fee recipient if set) |
| `contact-sheet.png` | First 100 cards |
| `rarity.json` | Trait counts |
