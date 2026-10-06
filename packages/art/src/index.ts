// @company/art — Company.md pixel Counsel generator, bar cards, logo, wordmark, icons, ERC-8004 metadata.
// Import "@company/art/svg" in browsers (no node:zlib); this entry adds PNG output.
import { encodePNG } from "./png.js";
import { composeCounsel, composeCard } from "./svg.js";
import { assertTokenId } from "./traits.js";

export * from "./svg.js";
export { encodePNG, encodeICO, PNG_SIGNATURE } from "./png.js";

/** 32×32 portrait as PNG, nearest-neighbour upscaled (scale 10 → 320×320). */
export function renderCounselPNG(tokenId: number, scale = 10): Buffer {
  assertTokenId(tokenId);
  return encodePNG(composeCounsel(tokenId), scale);
}

/** 64×80 bar card as PNG (scale 8 → 512×640). This is the NFT metadata image. */
export function renderCardPNG(tokenId: number, scale = 8): Buffer {
  assertTokenId(tokenId);
  return encodePNG(composeCard(tokenId), scale);
}
