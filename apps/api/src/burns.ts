/**
 * BurnTracker — every $COMD that has gone to the dead address, and the buybacks behind it.
 *
 * The Flywheel contract counts only what it burns itself. Before the Pons graduation (no pool key yet) the firm buys
 * back by hand: ETH from the tax → a buy on Pons → a transfer to 0x…dEaD. This tracker reads those from the token's
 * Transfer logs so GET /flywheel (and the website) show the whole picture:
 *   - burns:  Transfer(*, 0x…dEaD)        — any sender; amount, tx, block, time. Covers manual and Flywheel burns.
 *   - buys:   Transfer(*, buyback wallet) — inbound $COMD to the wallets listed in BURN_WALLETS (server-side only).
 * The buyback wallets are never part of the output: only totals and the burn transactions themselves are public.
 *
 * The running total must never go down, so the burns, the buyback total and the scan cursor are written to the kv
 * store and read back on boot: a restart resumes the scan instead of re-anchoring it. Without that a default
 * "scan the last N blocks" anchor slides forward with the head and silently drops older burns.
 *
 * Env: BURN_WALLETS (comma-separated; optional — without it only burns are tracked), BURN_FROM_BLOCK (the first block
 * to scan — set it to the block the token launched in and the figure is exact and reproducible; only used when
 * nothing is stored yet, default: 5,000,000 blocks before the head), BURN_CACHE_SECONDS (60).
 * Scans are incremental: each refresh continues from the last scanned block.
 */
import { getAddress, keccak256, pad, toHex, type Address, type Hex } from "viem";
import type { App } from "./app.ts";

const DEAD = "0x000000000000000000000000000000000000dEaD" as Address;
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)")) as Hex;
const topicAddr = (a: Address) => pad(a.toLowerCase() as Hex, { size: 32 }) as Hex;
const fromTopic = (t: Hex) => getAddress(`0x${t.slice(26)}`);

export type Burn = { txHash: Hex; amount: string; blockNumber: number; at: string | null; viaFlywheel: boolean };
export type BurnSummary = {
  tracked: boolean;
  wallets: number;
  fromBlock: number | null;
  scannedToBlock: number | null;
  bought: string; // $COMD received by the buyback wallets (atomic)
  burned: string; // $COMD sent to 0x…dEaD by anyone (atomic)
  burnedByWallets: string; // of which from the buyback wallets
  burnedByFlywheel: string; // of which from the Flywheel contract
  supply: string | null; // token totalSupply (atomic), for the percentage
  burnedPct: string | null; // "3.63"
  count: number;
  burns: Burn[]; // newest first, at most 50
  error?: string;
};

export class BurnTracker {
  private readonly app: App;
  private burns: (Burn & { from: Address })[] = [];
  private bought = 0n;
  private scannedTo: number | null = null;
  private fromBlock: number | null = null;
  private supply: bigint | null = null;
  private last = 0;
  private refreshing: Promise<void> | null = null;
  private error: string | null = null;
  private readonly times = new Map<number, string>();
  private loaded = false;
  constructor(app: App) { this.app = app; }

  // ------------------------------------------------------------------------------------ persistence (kv)
  private static readonly KEY = "burns:state";
  private load() {
    if (this.loaded) return;
    this.loaded = true;
    const st = this.app.kv.get(BurnTracker.KEY) as
      | { fromBlock?: number; scannedTo?: number; bought?: string; burns?: (Burn & { from: Address })[] }
      | undefined;
    if (!st) return;
    if (Number.isFinite(st.fromBlock)) this.fromBlock = Number(st.fromBlock);
    if (Number.isFinite(st.scannedTo)) this.scannedTo = Number(st.scannedTo);
    if (st.bought) try { this.bought = BigInt(st.bought); } catch { /* keep 0 */ }
    if (Array.isArray(st.burns)) this.burns = st.burns.filter((b) => b && b.txHash && b.amount);
  }
  private persist() {
    try {
      this.app.kv.set(BurnTracker.KEY, { fromBlock: this.fromBlock, scannedTo: this.scannedTo, bought: this.bought.toString(), burns: this.burns });
    } catch { /* a lost write only costs a rescan */ }
  }

  get wallets(): Address[] {
    return (this.app.cfg.storage.BURN_WALLETS ?? "").split(/[\s,]+/).filter((x) => /^0x[0-9a-fA-F]{40}$/.test(x)).map((x) => getAddress(x));
  }
  private get ttlMs() { return Math.max(10, Number(this.app.cfg.storage.BURN_CACHE_SECONDS ?? 60)) * 1000; }

  async summary(): Promise<BurnSummary> {
    const cfg = this.app.cfg;
    this.load();
    const tracked = this.app.chain.configured && !!this.app.chain.rawLogs && !/^0x0{40}$/i.test(cfg.comd);
    if (tracked) {
      const stale = this.app.now() - this.last > this.ttlMs;
      if (stale && !this.refreshing) this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
      // first load waits; afterwards callers get the last snapshot while a refresh runs
      if (this.scannedTo === null && this.refreshing) await this.refreshing.catch(() => undefined);
    }
    const wallets = this.wallets.map((w) => w.toLowerCase());
    const fw = cfg.flywheel?.toLowerCase();
    const burned = this.burns.reduce((a, b) => a + BigInt(b.amount), 0n);
    const byWallets = this.burns.filter((b) => wallets.includes(b.from.toLowerCase())).reduce((a, b) => a + BigInt(b.amount), 0n);
    const byFlywheel = this.burns.filter((b) => fw && b.from.toLowerCase() === fw).reduce((a, b) => a + BigInt(b.amount), 0n);
    const pct = this.supply && this.supply > 0n ? (Number((burned * 10_000n) / this.supply) / 100).toFixed(2) : null;
    return {
      tracked,
      wallets: wallets.length,
      fromBlock: this.fromBlock,
      scannedToBlock: this.scannedTo,
      bought: this.bought.toString(),
      burned: burned.toString(),
      burnedByWallets: byWallets.toString(),
      burnedByFlywheel: byFlywheel.toString(),
      supply: this.supply?.toString() ?? null,
      burnedPct: pct,
      count: this.burns.length,
      burns: [...this.burns].sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 50).map(({ from: _from, ...b }) => b),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private async refresh(): Promise<void> {
    const c = this.app.chain;
    const token = this.app.cfg.comd;
    this.load();
    try {
      const head = await c.blockNumber();
      if (this.fromBlock === null) {
        // chosen once and then stored: the anchor must not slide forward with the head, or old burns fall out
        const env = Number(this.app.cfg.storage.BURN_FROM_BLOCK);
        this.fromBlock = Number.isFinite(env) && env > 0 ? env : Math.max(0, head - 5_000_000);
      }
      const from = this.scannedTo === null ? this.fromBlock : this.scannedTo + 1;
      if (from <= head) {
        const seen = new Set(this.burns.map((b) => `${b.txHash}:${b.blockNumber}`));
        const burnLogs = await c.rawLogs!(token, [TRANSFER, null, topicAddr(DEAD)], from, head);
        for (const l of burnLogs) {
          const key = `${l.txHash}:${l.blockNumber}:${l.logIndex}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const sender = fromTopic(l.topics[1] as Hex);
          this.burns.push({ txHash: l.txHash, amount: BigInt(l.data).toString(), blockNumber: l.blockNumber, at: null, viaFlywheel: !!this.app.cfg.flywheel && sender.toLowerCase() === this.app.cfg.flywheel.toLowerCase(), from: sender });
        }
        for (const w of this.wallets) {
          const buys = await c.rawLogs!(token, [TRANSFER, null, topicAddr(w)], from, head);
          for (const l of buys) if (fromTopic(l.topics[1] as Hex).toLowerCase() !== DEAD.toLowerCase()) this.bought += BigInt(l.data);
        }
        this.scannedTo = head;
      }
      // timestamps for the burns (few; cached per block)
      for (const b of this.burns) {
        if (b.at) continue;
        let t = this.times.get(b.blockNumber);
        if (!t) { try { t = new Date((await c.block(b.blockNumber)).timestamp * 1000).toISOString(); this.times.set(b.blockNumber, t); } catch { /* next time */ } }
        if (t) b.at = t;
      }
      if (this.supply === null || this.last === 0) {
        try { this.supply = await c.erc20TotalSupply(token); } catch { /* keep null */ }
      }
      this.persist();
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message.split("\n")[0].slice(0, 200);
    } finally {
      this.last = this.app.now();
    }
  }
}
