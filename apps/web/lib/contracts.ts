// Contract resolver over @company/abi (packages/abi: generated ABIs + per-chain address book). The minimal fragments
// in abi-fallback.ts are only used if the package is absent or lacks an export (WETH and Permit2 use the ERC-20 fragment;
// "Swapper" resolves to the UniswapV4PoolSwapper ABI). Addresses: NEXT_PUBLIC_<NAME> env > @company/abi addresses[chainId] (zero = not deployed) > fallback.
import * as Pkg from "@company/abi";
import * as Fallback from "./abi-fallback";
import type { Abi, Address } from "viem";
import { CHAIN_ID } from "./config";

type Name = Fallback.ContractName;
const pkg = Pkg as unknown as Record<string, unknown>;

function lowerFirst(s: string) {
  return s[0].toLowerCase() + s.slice(1);
}

/** Key in @company/abi's address book / ABI export prefix for each contract name. */
const PKG_KEY: Partial<Record<Name | "ERC20", string>> = { WETH: "weth", Permit2: "permit2", CounselNFT: "counselNFT", ComdToken: "comdToken", Swapper: "swapper" };
export const keyOf = (name: string) => PKG_KEY[name as Name] ?? lowerFirst(name);

export function abiOf(name: Name | "ERC20"): Abi {
  // @company/abi exports `companyRouterAbi`, `counselNFTAbi`, … (viem-ready, `as const`)
  const candidates = [`${keyOf(name)}Abi`, `${lowerFirst(name)}Abi`, `${name}Abi`, name, `${name}ABI`, ...(name === "Swapper" ? ["uniswapV4PoolSwapperAbi"] : [])];
  for (const c of candidates) {
    const v = pkg[c];
    if (Array.isArray(v)) return v as Abi;
    if (v && typeof v === "object" && Array.isArray((v as { abi?: unknown }).abi)) return (v as { abi: Abi }).abi;
  }
  const abis = pkg.abis as Record<string, Abi> | undefined;
  if (abis?.[name]) return abis[name];
  const fb = (Fallback as unknown as Record<string, unknown>)[name === "WETH" || name === "Permit2" ? "ERC20" : name];
  return (fb as Abi) ?? (Fallback.ERC20 as Abi);
}

// env vars must be referenced literally so Next inlines them into the client bundle
const ENV: Partial<Record<Name, string | undefined>> = {
  CounselNFT: process.env.NEXT_PUBLIC_COUNSEL_NFT,
  ComdToken: process.env.NEXT_PUBLIC_COMD_TOKEN,
  Flywheel: process.env.NEXT_PUBLIC_FLYWHEEL,
  Swapper: process.env.NEXT_PUBLIC_SWAPPER,
  Permit2: process.env.NEXT_PUBLIC_PERMIT2,
  Incorporations: process.env.NEXT_PUBLIC_INCORPORATIONS,
  IdentityRegistry: process.env.NEXT_PUBLIC_IDENTITY_REGISTRY,
  RevenueRouter: process.env.NEXT_PUBLIC_REVENUE_ROUTER,
  RewardDistributor: process.env.NEXT_PUBLIC_REWARD_DISTRIBUTOR,
  ContributorDistributor: process.env.NEXT_PUBLIC_CONTRIBUTOR_DISTRIBUTOR,
};

const ZERO = "0x0000000000000000000000000000000000000000";

export function addressOf(name: Name, chainId = CHAIN_ID): Address | undefined {
  const env = ENV[name];
  if (env && /^0x[0-9a-fA-F]{40}$/.test(env)) return env as Address;
  const book = (pkg.addresses as Record<number | string, Record<string, string>> | undefined)?.[chainId];
  const fromPkg = book?.[keyOf(name)] ?? book?.[name];
  if (fromPkg && /^0x[0-9a-fA-F]{40}$/.test(fromPkg) && fromPkg !== ZERO) return fromPkg as Address;
  const fb = Fallback.addresses[chainId]?.[name];
  return fb && fb !== ZERO ? fb : undefined;
}

export const ABI_SOURCE = process.env.NEXT_PUBLIC_ABI_SOURCE || "fallback";

export function contract(name: Name) {
  return { address: addressOf(name), abi: abiOf(name) };
}

export const ADDRESS_BOOK: Name[] = [
  "ComdToken",
  "Flywheel",
  "Swapper",
  "CounselNFT",
  "IdentityRegistry",
  "RevenueRouter",
  "RewardDistributor",
  "ContributorDistributor",
  "Incorporations",
  "Permit2",
  "WETH",
];
