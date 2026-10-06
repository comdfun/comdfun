// ERC-8004 registration-v1 document for a Counsel seat, plus OpenSea-style attributes.
import { attributesOf, counselName, chambersName, traitsOf, assertTokenId } from "./traits.js";

export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

export interface MetadataOptions {
  /** Control-plane base URL (default https://api.comd.fun). */
  apiUrl?: string;
  /** Website base URL (default https://comd.fun). */
  webUrl?: string;
  chainId: number;
  /** CounselNFT address. */
  tokenContract: string;
  /** ERC-8004 agentId once the holder has registered the seat. */
  agentId?: number | string | null;
  /** IdentityRegistry address (bare 0x…) or CAIP-10 "eip155:<chainId>:<addr>". */
  agentRegistry?: string | null;
}

export interface Registration {
  agentId: number | string;
  agentRegistry: string;
  chainId: number;
  tokenContract: string;
  tokenId: number;
}

export interface CounselMetadata {
  type: typeof REGISTRATION_TYPE;
  name: string;
  description: string;
  image: string;
  external_url: string;
  services: { name: string; endpoint: string }[];
  active: boolean;
  x402Support: boolean;
  supportedTrust: string[];
  registrations: Registration[];
  enrolled: boolean;
  attributes: { trait_type: string; value: string }[];
}

const trim = (u: string) => u.replace(/\/+$/, "");

export const COLLECTION_NAME = "Company.md Counsel";
export const DEFAULT_API_URL = "https://api.comd.fun";
export const DEFAULT_WEB_URL = "https://comd.fun";
/** One-line positioning used to open every description. */
export const POSITIONING = "Company.md is a swarm of NFT-identified agents that work together to perform AI tasks on chain.";

export function describeCounsel(tokenId: number): string {
  const t = traitsOf(tokenId);
  const seat = t.founder
    ? `${counselName(tokenId)}, ${t.founder.title}, ${chambersName(tokenId)}. One of ten Founding Partners of Company.md.`
    : `${counselName(tokenId)}, ${chambersName(tokenId)}, ${t.practice} practice. One of 2,000 seats at Company.md.`;
  return [
    `${POSITIONING} ${seat}`,
    "Each Counsel is one of those agents, on Robinhood Chain. It drafts and reviews Solidity, builds and deploys projects, builds sites and indexers, answers typed on-chain questions as a member of a panel with a reproducible recipe, and researches with sources. It works on the holder's own inference budget; matters are paid in $COMD.",
    "Every matter is metered, re-run and cross-examined before it is accepted. Accepted work is recorded on-chain as reputation under ERC-8004. On the record.",
  ].join("\n\n");
}

/** Contract-level (collection) metadata, OpenSea contractURI style. */
export function collectionMetadata(opts: { apiUrl?: string; webUrl?: string; feeRecipient?: string } = {}) {
  const api = trim(opts.apiUrl ?? DEFAULT_API_URL), web = trim(opts.webUrl ?? DEFAULT_WEB_URL);
  return {
    name: COLLECTION_NAME,
    symbol: "COUNSEL",
    description:
      `${POSITIONING} 2,000 Counsel on Robinhood Chain; each Counsel NFT is an agent's identity: register it under ERC-8004, pair a machine, and it takes matters — Solidity, deployments, sites, indexers, rulings and research — paid in $COMD, cross-examined, and filed on-chain. Attorneys at law. comd.fun`,
    image: `${api}/brand/logo-mark-512.png`,
    banner_image: `${api}/brand/x-header-1500x500.png`,
    external_link: web,
    seller_fee_basis_points: 500,
    ...(opts.feeRecipient ? { fee_recipient: opts.feeRecipient } : {}),
  };
}

export function metadata(tokenId: number, opts: MetadataOptions): CounselMetadata {
  assertTokenId(tokenId);
  const api = trim(opts.apiUrl ?? DEFAULT_API_URL);
  const web = trim(opts.webUrl ?? DEFAULT_WEB_URL);
  const enrolled = opts.agentId !== undefined && opts.agentId !== null && opts.agentId !== "";
  const registry = opts.agentRegistry
    ? opts.agentRegistry.startsWith("eip155:") ? opts.agentRegistry : `eip155:${opts.chainId}:${opts.agentRegistry}`
    : "";
  return {
    type: REGISTRATION_TYPE,
    name: counselName(tokenId),
    description: describeCounsel(tokenId),
    image: `${api}/agents/by-token/${tokenId}.png`,
    external_url: `${web}/agents/${tokenId}`,
    services: [{ name: "web", endpoint: `${web}/agents/${tokenId}` }],
    active: true,
    x402Support: false,
    supportedTrust: ["reputation"],
    registrations: enrolled
      ? [{ agentId: opts.agentId as number | string, agentRegistry: registry, chainId: opts.chainId, tokenContract: opts.tokenContract, tokenId }]
      : [],
    enrolled,
    attributes: attributesOf(tokenId),
  };
}
