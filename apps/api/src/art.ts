/**
 * Counsel art and metadata from `@company/art` (its dist build loads in plain node):
 *
 *   GET /agents/by-token/:id.png   renderCardPNG(id)  — the 64×80 bar card, the NFT image (metadata `image`)
 *   GET /agents/by-token/:id.svg   renderCard(id).svg — the same card as SVG
 *   GET /agents/by-token/:id.json  metadata(id, {apiUrl, webUrl, chainId, tokenContract, agentId, agentRegistry})
 *
 * If the package cannot be imported at all (a broken install), a tiny deterministic placeholder keeps the routes
 * answering and `/health` reports `art_fallback`.
 */
import { createHash } from "node:crypto";

export interface MetadataInput { apiUrl: string; webUrl: string; chainId: number; tokenContract: string; agentId: string | number | null; agentRegistry: string | null }

/** The part of @company/art the api uses (typed here so tsc does not compile the art package's own sources). */
interface ArtModule {
  renderCard(tokenId: number, opts?: { width?: number }): { svg: string; attributes: { trait_type: string; value: string }[]; name: string };
  renderCounsel(tokenId: number, opts?: { size?: number }): { svg: string; attributes: { trait_type: string; value: string }[]; name: string };
  renderCardPNG(tokenId: number, scale?: number): Buffer;
  renderCounselPNG(tokenId: number, scale?: number): Buffer;
  metadata(tokenId: number, o: MetadataInput): Record<string, unknown> & { attributes: { trait_type: string; value: string }[] };
}
let mod: ArtModule | null | undefined;
let loadError: string | null = null;

export async function artModule(): Promise<ArtModule | null> {
  if (mod !== undefined) return mod;
  try {
    const spec = "@company/art"; // dist build (plain node); see packages/art package.json exports
    mod = (await import(spec)) as ArtModule;
    if (typeof mod.renderCardPNG !== "function" || typeof mod.metadata !== "function") throw new Error("@company/art is missing renderCardPNG/metadata");
  } catch (e) {
    loadError = (e as Error).message;
    console.warn(`[art] @company/art unavailable, serving placeholders: ${loadError}`);
    mod = null;
  }
  return mod;
}

export function artStatus(): { source: "art" | "fallback" | "unloaded"; error: string | null } {
  return { source: mod === undefined ? "unloaded" : mod ? "art" : "fallback", error: loadError };
}

const MAX = 2000;
export const validTokenId = (id: number) => Number.isInteger(id) && id >= 1 && id <= MAX;

export async function counselCardSvg(tokenId: number): Promise<string> {
  const m = await artModule();
  return m ? m.renderCard(tokenId).svg : fallbackSvg(tokenId);
}

export async function counselCardPng(tokenId: number, scale = 8): Promise<Buffer | null> {
  const m = await artModule();
  return m ? m.renderCardPNG(tokenId, scale) : null;
}

/** The 32×32 portrait (no nameplate) for small avatars. */
export async function counselPortraitSvg(tokenId: number): Promise<string> {
  const m = await artModule();
  return m ? m.renderCounsel(tokenId).svg : fallbackSvg(tokenId);
}

export async function counselMetadata(tokenId: number, o: MetadataInput) {
  const m = await artModule();
  if (m) return m.metadata(tokenId, o);
  const enrolled = o.agentId !== null && o.agentId !== undefined && o.agentId !== "";
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `Counsel #${String(tokenId).padStart(4, "0")}`,
    description: "A Company.md Counsel seat. Not affiliated with Robinhood.",
    image: `${o.apiUrl}/agents/by-token/${tokenId}.png`,
    external_url: `${o.webUrl}/agents/${tokenId}`,
    services: [{ name: "web", endpoint: `${o.webUrl}/agents/${tokenId}` }],
    active: true,
    x402Support: false,
    supportedTrust: ["reputation"],
    registrations: enrolled && o.agentRegistry ? [{ agentId: o.agentId!, agentRegistry: o.agentRegistry, chainId: o.chainId, tokenContract: o.tokenContract, tokenId }] : [],
    enrolled,
    attributes: [],
  };
}

/** Placeholder used only when @company/art failed to load: black ground, mirrored brass pixels. */
function fallbackSvg(tokenId: number): string {
  const h = createHash("sha256").update(`counsel:${tokenId}`).digest();
  const cells: string[] = [];
  for (let y = 6; y < 28; y++) for (let x = 8; x < 16; x++) {
    if (!((h[(y * 8 + x) % 32] >> (x % 8)) & 1)) continue;
    cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="#C9A227"/><rect x="${31 - x}" y="${y}" width="1" height="1" fill="#C9A227"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="320" height="320" shape-rendering="crispEdges"><rect width="32" height="32" fill="#000"/>${cells.join("")}</svg>`;
}
