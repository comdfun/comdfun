// The $COMD flywheel for the home section and /flywheel (Pons mode). $COMD is launched and traded on Pons, whose 5%
// tax pays the Flywheel in ETH (receive()). The Flywheel spends it 50% on buyback-and-burn (through a pluggable swapper
// that reaches Pons's graduated pool; burns are transfers to the dead address) and 50% on Counsel NFT floor sweeps.
// Jobs paid in $COMD go through the RevenueRouter (80% Counsel rewards / 20% firm).
// Source order: the API's GET /flywheel (cached chain reads + recent events) → direct chain reads → an
// "awaiting deployment" shape. Amounts are strings in wei (ETH) or atomic COMD (18 decimals).
import { createPublicClient, type Abi, type Address } from "viem";
import { get } from "./api";
import { abiOf, addressOf } from "./contracts";
import { activeChain, rpcTransport } from "./chains";
import { MOCK, PONS_URL, TAX_BPS_DEFAULT } from "./config";

export interface FlywheelEvent {
  type: string;
  source?: string;
  blockNumber?: number;
  txHash?: string;
  at?: string;
  [k: string]: unknown;
}

export interface SwapperState { address: string | null; configured: boolean }
export interface RevenueStats { totalToRewards: string; totalToTreasury: string; bps: { rewards: number; treasury: number } }

export interface BurnRecord { txHash: string; amount: string; blockNumber: number; at: string | null; viaFlywheel: boolean }
export interface BurnSummary {
  tracked: boolean; wallets: number; fromBlock: number | null; scannedToBlock: number | null;
  bought: string; burned: string; burnedByWallets: string; burnedByFlywheel: string;
  supply: string | null; burnedPct: string | null; count: number; burns: BurnRecord[]; error?: string;
}

export interface FeeSummary {
  tracked: boolean; reason?: string; wallets: number; source: "alchemy" | "etherscan" | "blockscout" | null;
  received: string; receivedInternal: string; spent: string; balance: string | null; payouts: number; lastReceivedAt: string | null; scannedToBlock: number | null; internalUnavailable?: boolean; error?: string;
}

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
  swapper: SwapperState;
  pons: { url: string };
  revenueRouter: RevenueStats | null;
  events: FlywheelEvent[];
  burns?: BurnSummary | null;
  fees?: FeeSummary | null;
  computedAt?: string;
}

const EMPTY: Omit<FlywheelStats, "configured" | "source"> = {
  taxBps: TAX_BPS_DEFAULT,
  bps: { buyback: 5000, sweep: 5000 },
  buckets: { buyback: "0", sweep: "0" },
  totals: { taxIn: "0", boughtBack: "0", burned: "0", swept: 0, sweepSpent: "0" },
  sweptTokenIds: [],
  swapper: { address: null, configured: false },
  pons: { url: PONS_URL },
  revenueRouter: null,
  events: [],
};

type ApiBody = {
  configured?: boolean;
  reason?: string;
  tax?: { taxBps?: number | null } | null;
  swapper?: { address?: string | null; configured?: boolean } | null;
  pons?: { url?: string | null } | null;
  flywheel?: { bps: FlywheelStats["bps"]; buckets: FlywheelStats["buckets"]; totals: FlywheelStats["totals"]; sweptTokenIds?: number[]; maxSweepPrice?: string | null } | null;
  bps?: FlywheelStats["bps"] | null;
  buckets?: FlywheelStats["buckets"] | null;
  totals?: FlywheelStats["totals"] | null;
  sweptTokenIds?: number[];
  maxSweepPrice?: string | null;
  revenueRouter?: RevenueStats | null;
  events?: FlywheelEvent[];
  burns?: BurnSummary | null;
  fees?: FeeSummary | null;
  computedAt?: string;
};

function fromApi(a: ApiBody, source: FlywheelStats["source"]): FlywheelStats {
  const fw = a.flywheel ?? null;
  return {
    configured: true,
    source,
    taxBps: Number(a.tax?.taxBps ?? TAX_BPS_DEFAULT),
    bps: fw?.bps ?? a.bps ?? EMPTY.bps,
    buckets: fw?.buckets ?? a.buckets ?? EMPTY.buckets,
    totals: fw?.totals ?? a.totals ?? EMPTY.totals,
    sweptTokenIds: (fw?.sweptTokenIds ?? a.sweptTokenIds ?? []).map(Number),
    maxSweepPrice: fw?.maxSweepPrice ?? a.maxSweepPrice ?? null,
    swapper: { address: a.swapper?.address ?? null, configured: !!a.swapper?.configured },
    pons: { url: a.pons?.url || PONS_URL },
    revenueRouter: a.revenueRouter ?? null,
    events: a.events ?? [],
    burns: a.burns ?? null,
    fees: a.fees ?? null,
    computedAt: a.computedAt,
  };
}

const s = (v: unknown) => (v == null ? "0" : String(v));

const ZERO = /^0x0{40}$/i;

async function fromChain(): Promise<FlywheelStats | null> {
  const fw = addressOf("Flywheel");
  if (!fw) return null;
  const c = createPublicClient({ chain: activeChain, transport: rpcTransport() });
  const read = <T,>(name: Parameters<typeof abiOf>[0], address: Address, fn: string) => c.readContract({ address, abi: abiOf(name) as Abi, functionName: fn }) as Promise<T>;
  try {
    const r = <T,>(fn: string) => read<T>("Flywheel", fw, fn);
    const [taxIn, boughtBack, burned, swept, sweepSpent, buckets, bps, ids, sw] = await Promise.all([
      r<bigint>("totalTaxIn"), r<bigint>("totalBoughtBack"), r<bigint>("totalBurned"), r<bigint>("totalSwept"), r<bigint>("sweepSpent"),
      r<readonly bigint[]>("bucketBalances"), r<readonly number[]>("bps"), r<readonly bigint[]>("sweptTokenIds"), r<string>("swapper").catch(() => null),
    ]);
    const swapperAddr = sw && !ZERO.test(sw) ? sw : addressOf("Swapper") ?? null;
    let configured = false;
    if (swapperAddr) configured = await read<boolean>("Swapper", swapperAddr as Address, "configured").catch(() => true);
    const out: FlywheelStats = {
      ...EMPTY, configured: true, source: "chain",
      bps: { buyback: Number(bps[0]), sweep: Number(bps[1]) },
      buckets: { buyback: s(buckets[0]), sweep: s(buckets[1]) },
      totals: { taxIn: s(taxIn), boughtBack: s(boughtBack), burned: s(burned), swept: Number(swept), sweepSpent: s(sweepSpent) },
      sweptTokenIds: ids.map(Number),
      swapper: { address: swapperAddr, configured },
    };
    const rr = addressOf("RevenueRouter");
    if (rr) {
      try {
        const [toRewards, toTreasury, rbps] = await Promise.all([read<bigint>("RevenueRouter", rr, "totalToRewards"), read<bigint>("RevenueRouter", rr, "totalToTreasury"), read<readonly number[]>("RevenueRouter", rr, "bps")]);
        out.revenueRouter = { totalToRewards: s(toRewards), totalToTreasury: s(toTreasury), bps: { rewards: Number(rbps[0]), treasury: Number(rbps[1]) } };
      } catch { /* optional */ }
    }
    return out;
  } catch {
    return null;
  }
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


/** ETH the firm has collected in tax: what reached the Flywheel contract plus what Pons paid the fee wallet. */
export function taxCollectedWei(s: FlywheelStats): bigint {
  return BigInt(s.totals.taxIn || "0") + (s.fees?.tracked ? BigInt(s.fees.received || "0") : 0n);
}
/** $COMD burned: everything sent to the dead address when the tracker runs (it includes the Flywheel's own burns), else the contract's count. */
export function burnedWei(s: FlywheelStats): bigint {
  return s.burns?.tracked ? BigInt(s.burns.burned || "0") : BigInt(s.totals.burned || "0");
}
/** ETH spent buying back: the fee wallet's outgoing value (manual buybacks) plus the Flywheel's. */
export function boughtBackWei(s: FlywheelStats): bigint {
  return BigInt(s.totals.boughtBack || "0") + (s.fees?.tracked ? BigInt(s.fees.spent || "0") : 0n);
}
