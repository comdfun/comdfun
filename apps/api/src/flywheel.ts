/**
 * The $COMD flywheel, for the website (GET /flywheel) and the floor-sweep desk (GET /flywheel/sweep-candidates).
 *
 *   ComdTaxHook   5% of every buy and sell of the COMD/ETH pool, in ETH → Flywheel; plus the inventory cap: COMD
 *                 above the (decaying) cap is trimmed after a swap and split 85% burn / 6% Bond / 4.5% stakers
 *                 (RewardDripper → sCOMD) / 4.5% Counsel seats (RewardDistributor); trimmed ETH funds the BuyWall
 *   Flywheel      buckets (default 50/50): buyback(minOut) burns COMD; sweep(...) buys Company.md Counsel NFTs
 *   BuyWall       the protocol's standing ETH bid below price; keeper rebalance() for a capped tip
 *   StakedComd    sCOMD (ERC-4626), fed by RewardDripper.drip()
 *   Bond          sells the 6% reserve for ETH at priceEth (wei per 1e18 COMD) once enabled
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
import { bondAbi, buyWallAbi, comdTaxHookAbi, flywheelAbi, revenueRouterAbi, rewardDripperAbi, stakedComdAbi } from "@company/abi";
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
    const contracts = { flywheel: cfg.flywheel, comdTaxHook: cfg.comdTaxHook, buyWall: cfg.buyWall, stakedComd: cfg.stakedComd, rewardDripper: cfg.rewardDripper, bond: cfg.bond, comdRouter: cfg.comdRouter, revenueRouter: cfg.revenueRouter, rewardDistributor: cfg.rewardDistributor, comd: cfg.comd, counselNft: cfg.counselNft };
    const keeper = this.app.keeper?.status();
    const keeperView = keeper ? { enabled: keeper.enabled, address: keeper.address, reason: keeper.reason, lastTickAt: keeper.lastTickAt, tasks: Object.fromEntries(Object.entries(keeper.tasks).map(([n, t]) => [n, { enabled: t.enabled, runs: t.runs, lastRunAt: t.lastRunAt, lastTx: t.lastTx, lastSkip: t.lastSkip, lastResult: t.lastResult }])) } : null;
    if (!this.app.chain.configured) return { chainId: cfg.chainId, contracts, configured: false, reason: "RPC_URL not configured", keeper: keeperView };
    const c = this.app.chain;
    const errors: Record<string, string> = {};
    const r = <T>(addr: Address, abi: unknown, fn: string, args: readonly unknown[] = []) => c.readContract<T>(addr, abi as Abi, fn, args);
    const section = async <T>(name: string, addr: Address | null, fn: (a: Address) => Promise<T>): Promise<T | null> => {
      if (!addr) return null;
      try { return await fn(addr); } catch (e) { errors[name] = (e as Error).message.split("\n")[0].slice(0, 200); return null; }
    };
    const field = (o: any, name: string, i: number) => (o && typeof o === "object" ? (o[name] ?? o[i]) : undefined);

    const [flywheel, hook, buyWall, staking, bond, revenueRouter] = await Promise.all([
      section("flywheel", cfg.flywheel, async (fw) => {
        const [taxIn, boughtBack, burned, swept, sweepSpent, buckets, bps, ids, maxSweep, keeperAddr, owner] = await Promise.all([
          r<bigint>(fw, flywheelAbi, "totalTaxIn"), r<bigint>(fw, flywheelAbi, "totalBoughtBack"), r<bigint>(fw, flywheelAbi, "totalBurned"),
          r<bigint>(fw, flywheelAbi, "totalSwept"), r<bigint>(fw, flywheelAbi, "sweepSpent"), r<readonly bigint[]>(fw, flywheelAbi, "bucketBalances"),
          r<readonly number[]>(fw, flywheelAbi, "bps"), r<readonly bigint[]>(fw, flywheelAbi, "sweptTokenIds"), r<bigint>(fw, flywheelAbi, "maxSweepPrice"),
          r<Address>(fw, flywheelAbi, "keeper"), r<Address>(fw, flywheelAbi, "owner"),
        ]);
        return {
          bps: { buyback: Number(bps[0]), sweep: Number(bps[1]) }, buckets: { buyback: s(buckets[0]), sweep: s(buckets[1]) },
          totals: { taxIn: s(taxIn), boughtBack: s(boughtBack), burned: s(burned), swept: Number(swept), sweepSpent: s(sweepSpent) },
          sweptTokenIds: ids.map((x) => Number(x)), maxSweepPrice: s(maxSweep), keeper: keeperAddr, owner,
        };
      }),
      section("hook", cfg.comdTaxHook, async (h) => {
        const [taxBps, totalTaxed, pendingTax, stats, cap, currentCap, inventory, lastInventory, params, claimEth, claimComd] = await Promise.all([
          r<number>(h, comdTaxHookAbi, "taxBps"), r<bigint>(h, comdTaxHookAbi, "totalTaxed"), r<bigint>(h, comdTaxHookAbi, "pendingTax"), r<any>(h, comdTaxHookAbi, "stats"),
          r<bigint>(h, comdTaxHookAbi, "cap"), r<bigint>(h, comdTaxHookAbi, "currentCap"), r<bigint>(h, comdTaxHookAbi, "inventory"), r<bigint>(h, comdTaxHookAbi, "lastInventory"),
          r<any>(h, comdTaxHookAbi, "params"), r<bigint>(h, comdTaxHookAbi, "claimEth"), r<bigint>(h, comdTaxHookAbi, "claimComd"),
        ]);
        const st = ["trimmedComd", "trimmedEth", "split", "burned", "toBond", "toStakers", "toSeats"];
        const pr = ["capFloor", "capDecayPerDay", "burnBps", "bondBps", "stakersBps", "seatsBps", "refStepTicks"];
        return {
          taxBps: Number(taxBps), totalTaxed: s(totalTaxed), pendingTax: s(pendingTax),
          stats: Object.fromEntries(st.map((k, i) => [k, s(field(stats, k, i))])),
          cap: s(cap), currentCap: s(currentCap), inventory: s(inventory), lastInventory: s(lastInventory),
          params: Object.fromEntries(pr.map((k, i) => { const v = field(params, k, i); return [k, k.endsWith("Bps") || k === "refStepTicks" ? Number(v) : s(v)]; })),
          claims: { eth: s(claimEth), comd: s(claimComd) },
        };
      }),
      section("buyWall", cfg.buyWall, async (w) => {
        const [posted, floor, preview, bought, tips, parked, lower, upper, liq, can] = await Promise.all([
          r<bigint>(w, buyWallAbi, "wallEthPosted"), r<number>(w, buyWallAbi, "floorTick"), r<number>(w, buyWallAbi, "previewFloorTick"), r<bigint>(w, buyWallAbi, "totalWallBought"),
          r<bigint>(w, buyWallAbi, "totalTips"), r<bigint>(w, buyWallAbi, "parkedEth"), r<number>(w, buyWallAbi, "wallLower"), r<number>(w, buyWallAbi, "wallUpper"),
          r<bigint>(w, buyWallAbi, "wallLiquidity"), r<boolean>(w, buyWallAbi, "canRebalance"),
        ]);
        return { postedEth: s(posted), floorTick: Number(floor), previewFloorTick: Number(preview), totalBought: s(bought), totalTips: s(tips), parkedEth: s(parked), wallLower: Number(lower), wallUpper: Number(upper), wallLiquidity: s(liq), canRebalance: can };
      }),
      section("staking", cfg.stakedComd ?? cfg.rewardDripper, async () => {
        const out: Record<string, unknown> = {};
        if (cfg.stakedComd) {
          const [assets, shares] = await Promise.all([r<bigint>(cfg.stakedComd, stakedComdAbi, "totalAssets"), r<bigint>(cfg.stakedComd, stakedComdAbi, "totalSupply")]);
          out.totalAssets = s(assets);
          out.totalShares = s(shares);
        }
        if (cfg.rewardDripper) {
          const d = cfg.rewardDripper;
          const [rate, capPerDay, pending, dripped] = await Promise.all([r<bigint>(d, rewardDripperAbi, "ratePerSecond"), r<bigint>(d, rewardDripperAbi, "streamCapPerDay"), r<bigint>(d, rewardDripperAbi, "pending"), r<bigint>(d, rewardDripperAbi, "totalDripped")]);
          Object.assign(out, { ratePerSecond: s(rate), streamCapPerDay: s(capPerDay), pending: s(pending), totalDripped: s(dripped) });
        }
        return out;
      }),
      section("bond", cfg.bond, async (b) => {
        const [enabled, priceEth, reserve, sold, proceeds] = await Promise.all([r<boolean>(b, bondAbi, "enabled"), r<bigint>(b, bondAbi, "priceEth"), r<bigint>(b, bondAbi, "reserve"), r<bigint>(b, bondAbi, "totalSold"), r<bigint>(b, bondAbi, "totalProceeds")]);
        return { enabled, priceEth: s(priceEth), reserve: s(reserve), sold: s(sold), proceeds: s(proceeds) };
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
        [cfg.flywheel, flywheelAbi, "flywheel", ["TaxIn", "Buyback", "Swept", "SweptAwarded", "BpsSet"]],
        [cfg.comdTaxHook, comdTaxHookAbi, "hook", ["Trimmed", "Split", "Flushed", "CapUpdated"]],
        [cfg.buyWall, buyWallAbi, "buyWall", ["Rebalanced", "WallPosted", "WallClosed", "WallParked"]],
        [cfg.rewardDripper, rewardDripperAbi, "rewardDripper", ["Dripped", "RewardNotified"]],
        [cfg.bond, bondAbi, "bond", ["Bonded"]],
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

    const body = {
      chainId: cfg.chainId,
      contracts,
      configured: !!(cfg.flywheel || cfg.comdTaxHook),
      tax: { taxBps: (hook as any)?.taxBps ?? null, totalTaxed: (hook as any)?.totalTaxed ?? null, pending: (hook as any)?.pendingTax ?? null, toFlywheel: flywheel?.totals.taxIn ?? null },
      flywheel, hook, buyWall, staking, bond, revenueRouter,
      // flat aliases kept from V2 for existing readers
      bps: flywheel?.bps ?? null, buckets: flywheel?.buckets ?? null, totals: flywheel?.totals ?? null, sweptTokenIds: flywheel?.sweptTokenIds ?? [], maxSweepPrice: flywheel?.maxSweepPrice ?? null,
      events,
      errors,
      keeper: keeperView,
      units: { eth: "wei", comd: "atomic (18 decimals)", ticks: "COMD per ETH pool ticks (currency0 = ETH)" },
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
