/**
 * The $COMD flywheel, for the website (GET /flywheel) and the floor-sweep desk (GET /flywheel/sweep-candidates).
 *
 *   Pons          mints and trades $COMD (5% tax set in Pons); it pays the creator wallet in ETH, which lands in the
 *                 Flywheel (receive()) and is counted as totalTaxIn
 *   Flywheel      two buckets (default 50/50): buyback(minOut) swaps ETH → COMD through its IBuybackSwapper
 *                 (UniswapV4PoolSwapper, pointed at the Pons pool after graduation) and sends it to the dead address;
 *                 sweep(...) buys Company.md Counsel NFTs
 *   RevenueRouter job revenue in COMD: 80% Counsel rewards / 20% firm treasury
 *
 * Every section is read independently (a missing or failing contract yields `null` + an error, never a 500).
 * Cached for FLYWHEEL_CACHE_SECONDS (15 s); events cover the last FLYWHEEL_EVENT_BLOCKS blocks (50,000).
 *
 * Sweep candidates: the API does not scrape marketplaces. Set SWEEP_LISTINGS_URL to any JSON endpoint that lists
 * Company.md Counsel for sale (your own indexer, a marketplace API proxy, a Seaport order book) returning
 *   {"listings": [{"tokenId": 42, "price": "<wei>", "marketplace": "opensea", "adapter": "0x…", "data": "0x…",
 *                  "expiresAt": 1790000000, "url": "https://…"}]}            (a bare array works too)
 * `adapter` + `data` are what Flywheel.sweep(adapter, data, tokenId, maxPrice) needs (the adapter must be
 * allowlisted with setAdapter). The route filters out tokens the Flywheel already holds and marks each listing
 * `withinMaxPrice` (≤ maxSweepPrice) and `affordable` (≤ the sweep bucket). Sweeping stays an owner/keeper action.
 */
import { getAddress, type Abi, type Address } from "viem";
import { flywheelAbi, revenueRouterAbi, uniswapV4PoolSwapperAbi } from "@company/abi";
import type { App } from "./app.ts";
import type { ChainEvent } from "./chain.ts";

const s = (v: unknown) => (typeof v === "bigint" ? v.toString() : v === undefined || v === null ? null : String(v));

export class FlywheelView {
  private readonly app: App;
  private cache: { at: number; body: Record<string, unknown> } | null = null;
  constructor(app: App) { this.app = app; }

  private get ttlMs() { return Math.max(0, Number(this.app.cfg.storage.FLYWHEEL_CACHE_SECONDS ?? 15)) * 1000; }

  async stats(): Promise<Record<string, unknown>> {
    const cfg = this.app.cfg;
    if (this.cache && this.app.now() - this.cache.at < this.ttlMs) return this.cache.body;
    const contracts = { flywheel: cfg.flywheel, swapper: cfg.swapper, revenueRouter: cfg.revenueRouter, rewardDistributor: cfg.rewardDistributor, incorporations: cfg.incorporations, comd: cfg.comd, counselNft: cfg.counselNft };
    const pons = { url: cfg.ponsUrl };
    const keeper = this.app.keeper?.status();
    const keeperView = keeper ? { enabled: keeper.enabled, address: keeper.address, reason: keeper.reason, lastTickAt: keeper.lastTickAt, tasks: Object.fromEntries(Object.entries(keeper.tasks).map(([n, t]) => [n, { enabled: t.enabled, runs: t.runs, lastRunAt: t.lastRunAt, lastTx: t.lastTx, lastSkip: t.lastSkip, lastResult: t.lastResult }])) } : null;
    if (!this.app.chain.configured) return { chainId: cfg.chainId, contracts, configured: false, reason: "RPC_URL not configured", pons, swapper: { address: cfg.swapper, configured: false }, keeper: keeperView };
    const c = this.app.chain;
    const errors: Record<string, string> = {};
    const r = <T>(addr: Address, abi: unknown, fn: string, args: readonly unknown[] = []) => c.readContract<T>(addr, abi as Abi, fn, args);
    const section = async <T>(name: string, addr: Address | null, fn: (a: Address) => Promise<T>): Promise<T | null> => {
      if (!addr) return null;
      try { return await fn(addr); } catch (e) { errors[name] = (e as Error).message.split("\n")[0].slice(0, 200); return null; }
    };

    const [flywheel, revenueRouter] = await Promise.all([
      section("flywheel", cfg.flywheel, async (fw) => {
        const [taxIn, boughtBack, burned, swept, sweepSpent, buckets, bps, ids, maxSweep, keeperAddr, owner, swapperAddr] = await Promise.all([
          r<bigint>(fw, flywheelAbi, "totalTaxIn"), r<bigint>(fw, flywheelAbi, "totalBoughtBack"), r<bigint>(fw, flywheelAbi, "totalBurned"),
          r<bigint>(fw, flywheelAbi, "totalSwept"), r<bigint>(fw, flywheelAbi, "sweepSpent"), r<readonly bigint[]>(fw, flywheelAbi, "bucketBalances"),
          r<readonly number[]>(fw, flywheelAbi, "bps"), r<readonly bigint[]>(fw, flywheelAbi, "sweptTokenIds"), r<bigint>(fw, flywheelAbi, "maxSweepPrice"),
          r<Address>(fw, flywheelAbi, "keeper"), r<Address>(fw, flywheelAbi, "owner"), r<Address>(fw, flywheelAbi, "swapper").catch(() => null as Address | null),
        ]);
        return {
          bps: { buyback: Number(bps[0]), sweep: Number(bps[1]) }, buckets: { buyback: s(buckets[0]), sweep: s(buckets[1]) },
          totals: { taxIn: s(taxIn), boughtBack: s(boughtBack), burned: s(burned), swept: Number(swept), sweepSpent: s(sweepSpent) },
          sweptTokenIds: ids.map((x) => Number(x)), maxSweepPrice: s(maxSweep), keeper: keeperAddr, owner, swapper: swapperAddr,
        };
      }),
      section("revenueRouter", cfg.revenueRouter, async (rr) => {
        const [toRewards, toTreasury, bps] = await Promise.all([r<bigint>(rr, revenueRouterAbi, "totalToRewards"), r<bigint>(rr, revenueRouterAbi, "totalToTreasury"), r<readonly number[]>(rr, revenueRouterAbi, "bps")]);
        return { totalToRewards: s(toRewards), totalToTreasury: s(toTreasury), bps: { rewards: Number(bps[0]), treasury: Number(bps[1]) } };
      }),
    ]);

    let events: Record<string, unknown>[] = [];
    try {
      const head = await c.blockNumber();
      const span = Math.max(1, Number(cfg.storage.FLYWHEEL_EVENT_BLOCKS ?? 50_000));
      const sources: [Address | null, unknown, string, string[]][] = [
        [cfg.flywheel, flywheelAbi, "flywheel", ["TaxIn", "Buyback", "Swept", "SweptAwarded", "BpsSet", "SwapperSet"]],
        [cfg.revenueRouter, revenueRouterAbi, "revenueRouter", ["Distributed"]],
      ];
      const all: (ChainEvent & { source: string })[] = [];
      for (const [addr, abi, source, names] of sources) {
        if (!addr) continue;
        try { for (const e of await c.events(addr, abi as Abi, Math.max(0, head - span), head)) if (names.includes(e.eventName)) all.push({ ...e, source }); } catch (e) { errors[`events.${source}`] = (e as Error).message.slice(0, 200); }
      }
      events = all.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex).slice(0, 50)
        .map((e) => ({ type: e.eventName, source: e.source, blockNumber: e.blockNumber, txHash: e.txHash, ...Object.fromEntries(Object.entries(e.args).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])) }));
    } catch (e) { errors.events = (e as Error).message.slice(0, 200); }

    // the swapper the Flywheel actually uses (its swapper() wins over SWAPPER / the deployment key); configured once
    // the owner has pointed it at the Pons pool (UniswapV4PoolSwapper.setPoolKey after graduation)
    const isZero = (a: Address | null | undefined) => !a || /^0x0{40}$/i.test(a);
    const swapperAddr: Address | null = !isZero(flywheel?.swapper) ? flywheel!.swapper! : !isZero(cfg.swapper) ? cfg.swapper : null;
    let swapperConfigured = false;
    if (swapperAddr) {
      try { swapperConfigured = await r<boolean>(swapperAddr, uniswapV4PoolSwapperAbi, "configured"); } catch { swapperConfigured = true; /* another IBuybackSwapper without configured(): assume ready */ }
    }
    const swapper = { address: swapperAddr, configured: swapperConfigured, onFlywheel: !isZero(flywheel?.swapper) };
    // every $COMD sent to the dead address (manual buybacks included) + buys by the buyback wallets; see burns.ts
    const burns = await this.app.burns.summary();
    // ETH the fee wallet received from Pons (the creator tax) and spent on buybacks; see fees.ts
    const fees = await this.app.fees.summary();

    const body = {
      chainId: cfg.chainId,
      contracts,
      configured: !!cfg.flywheel,
      pons,
      swapper,
      // Pons sets and collects the 5% tax; what reaches the Flywheel (receive()/notifyTax) is totalTaxIn
      tax: { totalTaxIn: flywheel?.totals.taxIn ?? null, toFlywheel: flywheel?.totals.taxIn ?? null, toFeeWallet: fees.tracked ? fees.received : null, collected: fees.tracked ? (BigInt(fees.received) + BigInt(flywheel?.totals.taxIn ?? "0")).toString() : (flywheel?.totals.taxIn ?? null), source: "pons" },
      flywheel, revenueRouter,
      // flat aliases kept from V2 for existing readers
      bps: flywheel?.bps ?? null, buckets: flywheel?.buckets ?? null, totals: flywheel?.totals ?? null, sweptTokenIds: flywheel?.sweptTokenIds ?? [], maxSweepPrice: flywheel?.maxSweepPrice ?? null,
      burns,
      fees,
      events,
      errors,
      keeper: keeperView,
      units: { eth: "wei", comd: "atomic (18 decimals)" },
      computedAt: new Date(this.app.now()).toISOString(),
    };
    this.cache = { at: this.app.now(), body };
    return body;
  }

  /** Listings from SWEEP_LISTINGS_URL (see the module comment); [] when no source is configured. */
  async sweepCandidates(): Promise<Record<string, unknown>> {
    const url = this.app.cfg.sweepListingsUrl;
    if (!url) return { source: null, count: 0, candidates: [], note: "no listing source configured: set SWEEP_LISTINGS_URL (see apps/api/README.md, Flywheel)" };
    let raw: unknown;
    try {
      const res = await this.app.fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (e) {
      return { source: new URL(url).host, count: 0, candidates: [], error: `listing source unavailable: ${(e as Error).message.slice(0, 200)}` };
    }
    const list: any[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.listings) ? (raw as any).listings : [];
    let held = new Set<number>();
    let maxSweep: bigint | null = null;
    let bucket: bigint | null = null;
    const st = await this.stats().catch(() => null) as any;
    if (st?.configured) {
      held = new Set<number>(st.sweptTokenIds ?? []);
      maxSweep = st.maxSweepPrice ? BigInt(st.maxSweepPrice) : null;
      bucket = st.buckets?.sweep ? BigInt(st.buckets.sweep) : null;
    }
    const nowS = Math.floor(this.app.now() / 1000);
    const candidates = list.flatMap((l) => {
      const tokenId = Number(l?.tokenId);
      const price = typeof l?.price === "string" && /^[0-9]+$/.test(l.price) ? BigInt(l.price) : typeof l?.price === "number" && Number.isSafeInteger(l.price) ? BigInt(l.price) : null;
      if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > this.app.cfg.maxSupply || price === null || held.has(tokenId)) return [];
      if (Number.isInteger(l.expiresAt) && l.expiresAt <= nowS) return [];
      const adapter = typeof l.adapter === "string" && /^0x[0-9a-fA-F]{40}$/.test(l.adapter) ? getAddress(l.adapter) : null;
      return [{
        tokenId, price: price.toString(), marketplace: typeof l.marketplace === "string" ? l.marketplace.slice(0, 40) : null, adapter,
        data: typeof l.data === "string" && /^0x[0-9a-fA-F]*$/.test(l.data) ? l.data : null, expiresAt: Number.isInteger(l.expiresAt) ? l.expiresAt : null,
        url: typeof l.url === "string" && /^https?:\/\//.test(l.url) ? l.url.slice(0, 512) : null,
        withinMaxPrice: maxSweep === null ? null : price <= maxSweep, affordable: bucket === null ? null : price <= bucket,
        call: adapter ? { function: "sweep(address adapter, bytes data, uint256 tokenId, uint256 maxPrice)", args: [adapter, l.data ?? "0x", String(tokenId), price.toString()] } : null,
      }];
    }).sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1)).slice(0, 50);
    return { source: new URL(url).host, count: candidates.length, maxSweepPrice: maxSweep?.toString() ?? null, sweepBucket: bucket?.toString() ?? null, candidates };
  }
}
