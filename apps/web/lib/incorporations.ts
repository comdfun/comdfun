"use client";
// Chain reads for Incorporations (company coins). Mock-mode stand-ins come from mock-chain.ts.
import type { Abi, Address, PublicClient } from "viem";
import { erc20Abi } from "viem";
import { contract } from "./contracts";
import { MOCK_CHAIN } from "./mock-chain";
import { isHiddenCoin } from "./hidden-coins";

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

export type CoinMeta = { image?: string; description?: string; website?: string; twitter?: string };

/** The coin's metadata, as written at incorporation. Only https links survive, so nothing else can be rendered. */
export function parseMeta(uri: string): CoinMeta {
  let raw: Record<string, unknown> = {};
  try {
    if (uri.startsWith("data:application/json;base64,")) raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(uri.split(",")[1]), (c) => c.charCodeAt(0))));
    else if (uri.startsWith("data:application/json,")) raw = JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length)));
  } catch { return {}; }
  const https = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : undefined);
  return {
    image: https(raw.image),
    description: typeof raw.description === "string" ? raw.description.slice(0, 400) : undefined,
    website: https(raw.website),
    // "twitter" is the key launchpads already use; "x" is read as well
    twitter: https(raw.twitter) ?? https(raw.x),
  };
}

/** An X account from whatever was typed: "@name", "name", "x.com/name" or "https://twitter.com/name". */
export function xHandle(input: string): string | null {
  const m = input.trim().replace(/^https?:\/\//, "").replace(/^(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(m) ? m : null;
}

/** A website from whatever was typed; "example.com" becomes "https://example.com". Null if it is not one. */
export function website(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    u.protocol = "https:";
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}

export function metaURI(m: { name: string; symbol: string; image?: string; description?: string; website?: string; twitter?: string }) {
  const json = JSON.stringify({ name: m.name, symbol: m.symbol, image: m.image || undefined, description: m.description || undefined, website: m.website || undefined, twitter: m.twitter || undefined });
  return `data:application/json;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(json)))}`;
}

export function mockCoins(): Coin[] {
  return MOCK_CHAIN.incorporations.map((c) => ({ ...c, address: c.address as Address, mock: true })).filter((c) => !isHiddenCoin(c));
}

export async function loadCoins(client: PublicClient): Promise<Coin[]> {
  const inc = contract("Incorporations");
  if (!inc.address) return [];
  const logs = await client.getContractEvents({ address: inc.address, abi: inc.abi as Abi, eventName: "CoinCreated", fromBlock, toBlock: "latest" });
  return (logs as unknown as { args: { coin: Address; creator: string; name: string; symbol: string; metadataURI: string }; blockNumber: bigint }[])
    .map((l) => ({ address: l.args.coin, name: l.args.name, symbol: l.args.symbol, creator: l.args.creator, metadataURI: l.args.metadataURI, createdBlock: l.blockNumber, ...parseMeta(l.args.metadataURI) }))
    .filter((c) => !isHiddenCoin(c))
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

/** One trade as a chart reads it: when, at what price (COMD per coin), and how much COMD moved. */
export type Tick = { t: number; price: number; comd: number; isBuy: boolean };

const blockTimes = new Map<bigint, number>();

/**
 * Trades with their times. A log carries a block number, not a time, so each distinct block is read once and
 * remembered for the session. The most recent `limit` trades are enough for any chart a person looks at.
 */
export async function tradeTicks(client: PublicClient, trades: TradeRow[], limit = 2000): Promise<Tick[]> {
  const recent = trades.slice(-limit);
  const want = [...new Set(recent.map((r) => r.block))].filter((b) => !blockTimes.has(b));
  for (let i = 0; i < want.length; i += 8) {
    await Promise.all(want.slice(i, i + 8).map(async (b) => {
      const blk = await client.getBlock({ blockNumber: b });
      blockTimes.set(b, Number(blk.timestamp));
    }));
  }
  return recent
    .filter((r) => r.coinAmount > 0n)
    .map((r) => {
      const coin = Number(r.coinAmount) / 1e18;
      const comd = Number(r.comdAmount) / 1e18;
      return { t: blockTimes.get(r.block) ?? 0, price: comd / coin, comd, isBuy: r.isBuy };
    })
    .filter((k) => k.t > 0 && Number.isFinite(k.price) && k.price > 0);
}

/** A plausible few days of trades for a mock coin, from a fixed seed so the chart does not change on reload. */
export function mockTicks(seedFrom: string, sold = 0.4): Tick[] {
  let x = [...seedFrom].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7);
  const rnd = () => ((x = (x * 48271) % 2147483647) / 2147483647);
  const now = Math.floor(Date.now() / 1000);
  const n = 260;
  const out: Tick[] = [];
  let s = 0.01;
  for (let i = 0; i < n; i++) {
    const isBuy = rnd() < 0.62;
    s = Math.min(sold, Math.max(0.005, s + (isBuy ? 1 : -1) * rnd() * (sold / 90)));
    const price = mockPrice(s) * (0.985 + rnd() * 0.03);
    out.push({ t: now - Math.round((n - i) * (3 * 86400 / n) * (0.6 + rnd() * 0.8)), price, comd: 200 + rnd() * 9000, isBuy });
  }
  return out.sort((a, b) => a.t - b.t);
}
