// $COMD engines for the home section, /flywheel, /stake and /bond. Two engines run on the one official COMD/ETH pool:
//   1. the 5% ETH tax → Flywheel: 50% buyback-and-burn / 50% Counsel NFT floor sweeps (bps owner-settable);
//   2. the capped pool (inspired by IMD's POOL4): inventory cap + trims after sells, the BuyWall, sCOMD staking, the Bond.
// Source order: the API's GET /flywheel (cached chain reads + recent events) → direct chain reads → an
// "awaiting deployment" shape. Amounts are strings in wei (ETH) or atomic COMD (18 decimals).
import { createPublicClient, http, type Abi, type Address } from "viem";
import { get } from "./api";
import { abiOf, addressOf } from "./contracts";
import { activeChain, RPC_URL } from "./chains";
import { MOCK, TAX_BPS_DEFAULT } from "./config";

export interface FlywheelEvent {
  type: string;
  source?: string;
  blockNumber?: number;
  txHash?: string;
  at?: string;
  [k: string]: unknown;
}

export interface HookStats {
  taxBps: number;
  totalTaxed: string;
  pendingTax: string;
  stats: { trimmedComd: string; trimmedEth: string; split: string; burned: string; toBond: string; toStakers: string; toSeats: string };
  cap: string;
  currentCap: string;
  inventory: string;
  lastInventory: string;
  params: { capFloor: string; capDecayPerDay: string; burnBps: number; bondBps: number; stakersBps: number; seatsBps: number; refStepTicks: number };
}
export interface BuyWallStats { postedEth: string; floorTick: number; previewFloorTick: number; totalBought: string; totalTips: string; parkedEth: string; wallLower: number; wallUpper: number; canRebalance: boolean }
export interface StakingStats { totalAssets?: string; totalShares?: string; ratePerSecond?: string; streamCapPerDay?: string; pending?: string; totalDripped?: string }
export interface BondStats { enabled: boolean; priceEth: string; reserve: string; sold: string; proceeds: string }
export interface RevenueStats { totalToRewards: string; totalToTreasury: string; bps: { rewards: number; treasury: number } }

export interface FlywheelStats {
  configured: boolean;
  source: "api" | "chain" | "mock" | "none";
  reason?: string;
  taxBps: number;
  bps: { buyback: number; sweep: number };
  buckets: { buyback: string; sweep: string };
  totals: { taxIn: string; boughtBack: string; burned: string; swept: number; sweepSpent: string };
  sweptTokenIds: number[];
  maxSweepPrice?: string | null;
  hook: HookStats | null;
  buyWall: BuyWallStats | null;
  staking: StakingStats | null;
  bond: BondStats | null;
  revenueRouter: RevenueStats | null;
  events: FlywheelEvent[];
  computedAt?: string;
}

/** Trim split defaults (bps of every trimmed or wall-bought COMD). */
export const TRIM_DEFAULT = { burnBps: 8500, bondBps: 600, stakersBps: 450, seatsBps: 450 };

const EMPTY: Omit<FlywheelStats, "configured" | "source"> = {
  taxBps: TAX_BPS_DEFAULT,
  bps: { buyback: 5000, sweep: 5000 },
  buckets: { buyback: "0", sweep: "0" },
  totals: { taxIn: "0", boughtBack: "0", burned: "0", swept: 0, sweepSpent: "0" },
  sweptTokenIds: [],
  hook: null,
  buyWall: null,
  staking: null,
  bond: null,
  revenueRouter: null,
  events: [],
};

type ApiBody = {
  configured?: boolean;
  reason?: string;
  tax?: { taxBps?: number | null } | null;
  flywheel?: { bps: FlywheelStats["bps"]; buckets: FlywheelStats["buckets"]; totals: FlywheelStats["totals"]; sweptTokenIds?: number[]; maxSweepPrice?: string | null } | null;
  bps?: FlywheelStats["bps"] | null;
  buckets?: FlywheelStats["buckets"] | null;
  totals?: FlywheelStats["totals"] | null;
  sweptTokenIds?: number[];
  maxSweepPrice?: string | null;
  hook?: HookStats | null;
  buyWall?: BuyWallStats | null;
  staking?: StakingStats | null;
  bond?: BondStats | null;
  revenueRouter?: RevenueStats | null;
  events?: FlywheelEvent[];
  computedAt?: string;
};

function fromApi(a: ApiBody, source: FlywheelStats["source"]): FlywheelStats {
  const fw = a.flywheel ?? null;
  return {
    configured: true,
    source,
    taxBps: Number(a.tax?.taxBps ?? a.hook?.taxBps ?? TAX_BPS_DEFAULT),
    bps: fw?.bps ?? a.bps ?? EMPTY.bps,
    buckets: fw?.buckets ?? a.buckets ?? EMPTY.buckets,
    totals: fw?.totals ?? a.totals ?? EMPTY.totals,
    sweptTokenIds: (fw?.sweptTokenIds ?? a.sweptTokenIds ?? []).map(Number),
    maxSweepPrice: fw?.maxSweepPrice ?? a.maxSweepPrice ?? null,
    hook: a.hook ?? null,
    buyWall: a.buyWall ?? null,
    staking: a.staking && Object.keys(a.staking).length ? a.staking : null,
    bond: a.bond ?? null,
    revenueRouter: a.revenueRouter ?? null,
    events: a.events ?? [],
    computedAt: a.computedAt,
  };
}

const s = (v: unknown) => (v == null ? "0" : String(v));
const pick = (o: unknown, k: string, i: number) => (Array.isArray(o) ? o[i] : (o as Record<string, unknown> | undefined)?.[k]);

async function fromChain(): Promise<FlywheelStats | null> {
  const fw = addressOf("Flywheel");
  const hk = addressOf("ComdTaxHook");
  if (!fw && !hk) return null;
  const c = createPublicClient({ chain: activeChain, transport: http(RPC_URL) });
  const read = <T,>(name: Parameters<typeof abiOf>[0], address: Address, fn: string) => c.readContract({ address, abi: abiOf(name) as Abi, functionName: fn }) as Promise<T>;
  const out: FlywheelStats = { ...EMPTY, configured: true, source: "chain" };
  const tries: Promise<void>[] = [];
  if (fw)
    tries.push((async () => {
      const r = <T,>(fn: string) => read<T>("Flywheel", fw, fn);
      const [taxIn, boughtBack, burned, swept, sweepSpent, buckets, bps, ids] = await Promise.all([
        r<bigint>("totalTaxIn"), r<bigint>("totalBoughtBack"), r<bigint>("totalBurned"), r<bigint>("totalSwept"), r<bigint>("sweepSpent"),
        r<readonly bigint[]>("bucketBalances"), r<readonly number[]>("bps"), r<readonly bigint[]>("sweptTokenIds"),
      ]);
      out.bps = { buyback: Number(bps[0]), sweep: Number(bps[1]) };
      out.buckets = { buyback: s(buckets[0]), sweep: s(buckets[1]) };
      out.totals = { taxIn: s(taxIn), boughtBack: s(boughtBack), burned: s(burned), swept: Number(swept), sweepSpent: s(sweepSpent) };
      out.sweptTokenIds = ids.map(Number);
    })());
  if (hk)
    tries.push((async () => {
      const r = <T,>(fn: string) => read<T>("ComdTaxHook", hk, fn);
      const [taxBps, totalTaxed, pendingTax, st, cap, currentCap, inventory, lastInventory, pr] = await Promise.all([
        r<number>("taxBps"), r<bigint>("totalTaxed"), r<bigint>("pendingTax"), r<unknown>("stats"), r<bigint>("cap"), r<bigint>("currentCap"), r<bigint>("inventory"), r<bigint>("lastInventory"), r<unknown>("params"),
      ]);
      const sk = ["trimmedComd", "trimmedEth", "split", "burned", "toBond", "toStakers", "toSeats"] as const;
      const pk = ["capFloor", "capDecayPerDay", "burnBps", "bondBps", "stakersBps", "seatsBps", "refStepTicks"] as const;
      out.taxBps = Number(taxBps);
      out.hook = {
        taxBps: Number(taxBps), totalTaxed: s(totalTaxed), pendingTax: s(pendingTax), cap: s(cap), currentCap: s(currentCap), inventory: s(inventory), lastInventory: s(lastInventory),
        stats: Object.fromEntries(sk.map((k, i) => [k, s(pick(st, k, i))])) as HookStats["stats"],
        params: Object.fromEntries(pk.map((k, i) => [k, k === "capFloor" || k === "capDecayPerDay" ? s(pick(pr, k, i)) : Number(pick(pr, k, i) ?? 0)])) as HookStats["params"],
      };
    })());
  const sc = addressOf("StakedComd");
  const dr = addressOf("RewardDripper");
  if (sc || dr)
    tries.push((async () => {
      const st: StakingStats = {};
      if (sc) { st.totalAssets = s(await read("StakedComd", sc, "totalAssets")); st.totalShares = s(await read("StakedComd", sc, "totalSupply")); }
      if (dr) { st.ratePerSecond = s(await read("RewardDripper", dr, "ratePerSecond")); st.streamCapPerDay = s(await read("RewardDripper", dr, "streamCapPerDay")); st.totalDripped = s(await read("RewardDripper", dr, "totalDripped")); }
      out.staking = st;
    })());
  const bd = addressOf("Bond");
  if (bd)
    tries.push((async () => {
      const [enabled, priceEth, reserve, sold, proceeds] = await Promise.all(["enabled", "priceEth", "reserve", "totalSold", "totalProceeds"].map((f) => read<unknown>("Bond", bd, f)));
      out.bond = { enabled: !!enabled, priceEth: s(priceEth), reserve: s(reserve), sold: s(sold), proceeds: s(proceeds) };
    })());
  const results = await Promise.allSettled(tries);
  return results.some((r) => r.status === "fulfilled") ? out : null;
}

export async function getFlywheel(): Promise<FlywheelStats> {
  const a = await get<ApiBody>("/flywheel", { revalidate: 15 });
  if (a?.configured) return fromApi(a, MOCK ? "mock" : "api");
  const chain = await fromChain();
  if (chain) return chain;
  return { ...EMPTY, configured: false, source: "none", reason: a?.reason ?? "The Flywheel is not deployed on this chain yet." };
}

/** wei/atomic string → number of whole units (display only). */
export const toUnits = (v?: string | null, decimals = 18) => {
  if (!v) return 0;
  try { return Number(BigInt(v) / 10n ** BigInt(decimals - 6)) / 1e6; } catch { return 0; }
};

/** Staking APR (fraction) from the dripper's per-second rate against the vault's assets. */
export function stakingApr(st: StakingStats | null): number | null {
  if (!st?.ratePerSecond || !st.totalAssets) return null;
  const assets = toUnits(st.totalAssets);
  if (assets <= 0) return null;
  return (toUnits(st.ratePerSecond) * 365 * 86_400) / assets;
}

/** Sum of an event field over the last `days` (events carry `at` in mock; otherwise counts all listed). */
export function sumEvents(events: FlywheelEvent[], type: string, field: string, days = 7) {
  const cutoff = Date.now() - days * 86_400_000;
  return events.filter((e) => e.type === type && (!e.at || Date.parse(e.at) >= cutoff)).reduce((a, e) => a + toUnits(e[field] as string | undefined), 0);
}
