import { defineChain, fallback, http } from "viem";
import { CHAIN_ID } from "./config";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const CHAINS = [robinhood, robinhoodTestnet] as const;
export const activeChain = CHAIN_ID === 4663 ? robinhood : robinhoodTestnet;
/** `NEXT_PUBLIC_RPC_URL` may list several endpoints (comma separated); the first is primary, the rest are fallbacks. */
export const RPC_URLS: string[] = (process.env.NEXT_PUBLIC_RPC_URL || "").split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
if (!RPC_URLS.length) RPC_URLS.push(activeChain.rpcUrls.default.http[0]);
export const RPC_URL = RPC_URLS[0];
/** viem transport over every configured endpoint, in order (no ranking): a blocked public RPC fails over to the next. */
export function rpcTransport(opts: { timeout?: number } = {}) {
  const ts = RPC_URLS.map((u) => http(u, { timeout: opts.timeout ?? 10_000, retryCount: 1 }));
  return ts.length === 1 ? ts[0] : fallback(ts, { rank: false, retryCount: 0 });
}

/** Names for chain ids that appear in API data (oracle questions can read other chains). */
export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum mainnet",
  10: "OP Mainnet",
  56: "BNB Chain",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum One",
  4663: "Robinhood Chain",
  46630: "Robinhood Chain Testnet",
};
export const chainName = (id?: number | string | null) =>
  id == null ? "—" : CHAIN_NAMES[Number(id)] ?? `Chain ${id}`;

const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  8453: "https://basescan.org",
  4663: "https://robinhoodchain.blockscout.com",
  46630: "https://explorer.testnet.chain.robinhood.com",
};
const EXPLORER_OVERRIDE = process.env.NEXT_PUBLIC_EXPLORER_URL;
export function explorerUrl(kind: "tx" | "address" | "block" | "token", value: string | number, chainId: number = activeChain.id) {
  const base = (Number(chainId) === activeChain.id && EXPLORER_OVERRIDE) || EXPLORERS[Number(chainId)] || EXPLORERS[activeChain.id];
  return `${base}/${kind}/${value}`;
}
