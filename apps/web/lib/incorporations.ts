"use client";
// Chain reads for Incorporations (company coins). Mock-mode stand-ins come from mock-chain.ts.
import type { Abi, Address, PublicClient } from "viem";
import { erc20Abi } from "viem";
import { contract } from "./contracts";
import { MOCK_CHAIN } from "./mock-chain";

export interface Coin {
  address: Address;
  name: string;
  symbol: string;
  creator: string;
  metadataURI: string;
  image?: string;
  description?: string;
  createdBlock?: bigint;
  supplySold?: number; // 0..1 (mock only)
  createdAgo?: number;
  comdReserve?: number;
  trades?: number;
  mock?: boolean;
}

export interface TradeRow {
  trader: string;
  isBuy: boolean;
  comdAmount: bigint;
  coinAmount: bigint;
  ethAmount: bigint;
  block: bigint;
  tx: string;
}

export const fromBlock = BigInt(process.env.NEXT_PUBLIC_INCORPORATIONS_FROM_BLOCK || "0");

export function parseMeta(uri: string): { image?: string; description?: string } {
  try {
    if (uri.startsWith("data:application/json;base64,")) return JSON.parse(atob(uri.split(",")[1]));
    if (uri.startsWith("data:application/json,")) return JSON.parse(decodeURIComponent(uri.split(",")[1]));
  } catch {}
  return {};
}

export function metaURI(m: { name: string; symbol: string; image?: string; description?: string }) {
  const json = JSON.stringify({ name: m.name, symbol: m.symbol, image: m.image || undefined, description: m.description || undefined });
  return `data:application/json;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(json)))}`;
}

export function mockCoins(): Coin[] {
  return MOCK_CHAIN.incorporations.map((c) => ({ ...c, address: c.address as Address, mock: true }));
}

export async function loadCoins(client: PublicClient): Promise<Coin[]> {
  const inc = contract("Incorporations");
  if (!inc.address) return [];
  const logs = await client.getContractEvents({ address: inc.address, abi: inc.abi as Abi, eventName: "CoinCreated", fromBlock, toBlock: "latest" });
  return (logs as unknown as { args: { coin: Address; creator: string; name: string; symbol: string; metadataURI: string }; blockNumber: bigint }[])
    .map((l) => ({ address: l.args.coin, name: l.args.name, symbol: l.args.symbol, creator: l.args.creator, metadataURI: l.args.metadataURI, createdBlock: l.blockNumber, ...parseMeta(l.args.metadataURI) }))
    .reverse();
}

export async function loadTrades(client: PublicClient, coin: Address): Promise<TradeRow[]> {
  const inc = contract("Incorporations");
  if (!inc.address) return [];
  const logs = await client.getContractEvents({ address: inc.address, abi: inc.abi as Abi, eventName: "Trade", args: { coin }, fromBlock, toBlock: "latest" } as never);
  return (logs as unknown as { args: Omit<TradeRow, "block" | "tx">; blockNumber: bigint; transactionHash: string }[]).map((l) => ({ ...l.args, block: l.blockNumber, tx: l.transactionHash }));
}

export async function coinInfo(client: PublicClient, coin: Address) {
  const [name, symbol, totalSupply] = await Promise.all([
    client.readContract({ address: coin, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: coin, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: coin, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  return { name, symbol, totalSupply };
}

/** Synthetic curve for mock mode: price in COMD per coin as a function of the fraction sold. */
export const mockPrice = (s: number) => 0.00002 * Math.pow(1 + 9 * s, 2);
