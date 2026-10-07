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
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export interface MetadataInput { apiUrl: string; webUrl: string; chainId: number; tokenContract: string; agentId: string | number | null; agentRegistry: string | null }

/** The part of @company/art the api uses (typed here so tsc does not compile the art package's own sources). */
interface ArtModule {
  renderCard(tokenId: number, opts?: { width?: number }): { svg: string; attributes: { trait_type: string; value: string }[]; name: string };
  renderCounsel(tokenId: number, opts?: { size?: number }): { svg: string; attributes: { trait_type: string; value: string }[]; name: string };
  renderCardPNG(tokenId: number, scale?: number): Buffer;
  renderShareCardPNG?(tokenId: number, o?: { status?: string; facts?: string[]; url?: string }): Buffer;
  renderCounselPNG(tokenId: number, scale?: number): Buffer;
  metadata(tokenId: number, o: MetadataInput): Record<string, unknown> & { attributes: { trait_type: string; value: string }[] };
  collectionMetadata?(o: { apiUrl?: string; webUrl?: string; feeRecipient?: string }): Record<string, unknown>;
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

/** 1200×630 share / Open Graph card (portrait, name, traits, a status line, the link). */
export async function counselShareCardPng(tokenId: number, o: { status?: string; facts?: string[]; url?: string } = {}): Promise<Buffer | null> {
  const m = await artModule();
  return m?.renderShareCardPNG ? m.renderShareCardPNG(tokenId, o) : null;
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


/** Collection document for CounselNFT.contractURI (OpenSea / ERC-7572). */
export async function collectionDoc(app: { cfg: { publicApiUrl: string; publicWebUrl: string; treasury?: string | null } }): Promise<Record<string, unknown>> {
  const m = await artModule();
  const o = { apiUrl: app.cfg.publicApiUrl, webUrl: app.cfg.publicWebUrl, feeRecipient: app.cfg.treasury ?? undefined };
  if (m?.collectionMetadata) return m.collectionMetadata(o);
  return {
    name: "Counsel", symbol: "COUNSEL",
    description: "Company.md is a swarm of NFT-identified agents that work together to perform AI tasks on chain. 2,000 Counsel on Robinhood Chain; one NFT is one Counsel. Register it and it starts earning $COMD.",
    image: `${o.apiUrl}/brand/opensea-logo-350.png`, banner_image: `${o.apiUrl}/brand/opensea-banner-1400x350.png`, external_link: o.webUrl,
    seller_fee_basis_points: 500, ...(o.feeRecipient ? { fee_recipient: o.feeRecipient } : {}),
  };
}

const BRAND_TYPES: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
let brandDir: string | null | undefined;
function resolveBrandDir(): string | null {
  if (brandDir !== undefined) return brandDir;
  try {
    const req = createRequire(import.meta.url);
    brandDir = path.join(path.dirname(req.resolve("@company/art/package.json")), "out", "brand");
  } catch { brandDir = null; }
  return brandDir;
}
/** A committed brand asset (packages/art/out/brand/<file>); only plain file names, only png/svg/ico. */
export async function brandFile(file: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(file) || file.includes("..")) return null;
  const type = BRAND_TYPES[path.extname(file).toLowerCase()];
  const dir = resolveBrandDir();
  if (!type || !dir) return null;
  try { return { bytes: await readFile(path.join(dir, file)), type }; } catch { return null; }
}
