// Browser-safe entry: everything except PNG encoding (which needs node:zlib).
import { composeCounsel } from "./counsel.js";
import { composeCard, CARD_W, CARD_H } from "./card.js";
import { attributesOf, counselName, assertTokenId } from "./traits.js";
import { BRAND } from "./palette.js";

export interface RenderResult {
  svg: string;
  attributes: { trait_type: string; value: string }[];
  name: string;
}

/** 32×32 pixel portrait. `size` sets the SVG width/height attributes (default 32 × 10 = 320). */
export function renderCounsel(tokenId: number, opts: { size?: number } = {}): RenderResult {
  assertTokenId(tokenId);
  const size = opts.size ?? 320;
  const name = counselName(tokenId);
  const svg = composeCounsel(tokenId).toSvg({ width: size, height: size, background: BRAND.black, title: name });
  return { svg, attributes: attributesOf(tokenId), name };
}

/** 64×80 bar card (portrait + brass nameplate). `width` sets the SVG width (height follows 5:4). */
export function renderCard(tokenId: number, opts: { width?: number } = {}): RenderResult {
  assertTokenId(tokenId);
  const width = opts.width ?? 384;
  const name = counselName(tokenId);
  const svg = composeCard(tokenId).toSvg({ width, height: Math.round((width * CARD_H) / CARD_W), background: BRAND.black, title: name });
  return { svg, attributes: attributesOf(tokenId), name };
}

export { composeCounsel, composeCard, CARD_W, CARD_H };
export { logoSvg, wordmarkSvg, icons, iconSvg, ICON_GRIDS, logoRaster, wordmarkRaster, type IconName } from "./brand.js";
export { metadata, describeCounsel, collectionMetadata, COLLECTION_NAME, POSITIONING, DEFAULT_API_URL, DEFAULT_WEB_URL, REGISTRATION_TYPE, type MetadataOptions, type CounselMetadata, type Registration } from "./metadata.js";
export {
  traitsOf, traitTable, attributesOf, counselName, chambersName, chambersOf, comboKey,
  PRACTICES, HEADWEAR, SKINS, EYES, ATTIRE, NECKWEAR, HELD, BACKDROPS, MAX_SUPPLY, FOUNDERS, FOUNDING_PARTNERS,
  type Traits,
} from "./traits.js";
export { BRAND } from "./palette.js";
export { PRACTICE_COLOR, PRACTICE_CODE } from "./counsel.js";
export { Raster } from "./raster.js";
export {
  logoMark, logoHorizontal, logoStacked, squareProfile, appleTouch, favicon,
  heroBanner, ogBanner, discordBanner, xHeader, mark64, mark32, mark16, monoMark, shareCard, type Asset,
} from "./brandkit.js";
export { composeFigure } from "./counsel.js";
export { ARCADE } from "./palette.js";
