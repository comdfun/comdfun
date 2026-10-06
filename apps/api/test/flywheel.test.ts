import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { harness, get } from "./helpers.ts";

const FW = "0x00000000000000000000000000000000000000f1";
const HOOK = "0x00000000000000000000000000000000000000f2";
const RR = "0x00000000000000000000000000000000000000f3";
const WALL = "0x00000000000000000000000000000000000000f4";
const SC = "0x00000000000000000000000000000000000000f5";
const DRIP = "0x00000000000000000000000000000000000000f6";
const BOND = "0x00000000000000000000000000000000000000f7";
const E = 10n ** 18n;

test("GET /flywheel: tax, 2 buckets, hook stats + cap, buy wall, staking, bond, revenue router, events; sweep candidates from SWEEP_LISTINGS_URL", async () => {
  const listings = { listings: [
    { tokenId: 9, price: String(E / 2n), marketplace: "opensea", adapter: "0x00000000000000000000000000000000000000ad", data: "0x1234" },
    { tokenId: 7, price: String(E / 10n), marketplace: "opensea", adapter: "0x00000000000000000000000000000000000000ad", data: "0x" },
    { tokenId: 3, price: "1", marketplace: "x" }, // already swept: dropped
    { tokenId: 4000, price: "1" }, // not a Counsel id: dropped
  ] };
  const fakeFetch = (async (url: any, init?: any) => String(url).startsWith("https://listings.test/") ? new Response(JSON.stringify(listings), { status: 200 }) : fetch(url, init)) as typeof fetch;
  const h = await harness({ env: { FLYWHEEL: FW, COMD_TAX_HOOK: HOOK, REVENUE_ROUTER: RR, BUY_WALL: WALL, STAKED_COMD: SC, REWARD_DRIPPER: DRIP, BOND: BOND, SWEEP_LISTINGS_URL: "https://listings.test/counsel", FLYWHEEL_CACHE_SECONDS: "0" }, fetch: fakeFetch });
  try {
    const v = (k: string, fn: string, x: unknown) => h.chain.views.set(`${k}:${fn}`, x);
    v(FW, "totalTaxIn", 10n * E); v(FW, "totalBoughtBack", 4n * E); v(FW, "totalBurned", 123_456n * E); v(FW, "totalSwept", 1n); v(FW, "sweepSpent", E / 5n);
    v(FW, "bucketBalances", [E / 10n, E / 5n]); v(FW, "bps", [5000, 5000]); v(FW, "sweptTokenIds", [3n]);
    v(FW, "maxSweepPrice", E / 4n); v(FW, "keeper", "0x00000000000000000000000000000000000000ee"); v(FW, "owner", "0x00000000000000000000000000000000000000ff");
    v(HOOK, "taxBps", 500); v(HOOK, "totalTaxed", 10n * E); v(HOOK, "pendingTax", 0n); v(HOOK, "cap", 1_000_000n * E); v(HOOK, "currentCap", 900_000n * E);
    v(HOOK, "inventory", 950_000n * E); v(HOOK, "lastInventory", 950_000n * E); v(HOOK, "claimEth", 0n); v(HOOK, "claimComd", 0n);
    v(HOOK, "stats", { trimmedComd: 100n * E, trimmedEth: E / 100n, split: 100n * E, burned: 85n * E, toBond: 6n * E, toStakers: 45n * E / 10n, toSeats: 45n * E / 10n });
    v(HOOK, "params", { capFloor: 1000n * E, capDecayPerDay: 10_000n * E, burnBps: 8500, bondBps: 600, stakersBps: 450, seatsBps: 450, refStepTicks: 200 });
    v(WALL, "wallEthPosted", E); v(WALL, "floorTick", -100); v(WALL, "previewFloorTick", -120); v(WALL, "totalWallBought", 7n * E); v(WALL, "totalTips", 1000n);
    v(WALL, "parkedEth", 0n); v(WALL, "wallLower", -2000); v(WALL, "wallUpper", -200); v(WALL, "wallLiquidity", 99n); v(WALL, "canRebalance", true);
    v(SC, "totalAssets", 50n * E); v(SC, "totalSupply", 40n * E);
    v(DRIP, "ratePerSecond", 1000n); v(DRIP, "streamCapPerDay", 10n * E); v(DRIP, "pending", 5n); v(DRIP, "totalDripped", 2n * E);
    v(BOND, "enabled", true); v(BOND, "priceEth", 10n ** 12n); v(BOND, "reserve", 6n * E); v(BOND, "totalSold", 0n); v(BOND, "totalProceeds", 0n);
    v(RR, "totalToRewards", 80n * E); v(RR, "totalToTreasury", 20n * E); v(RR, "bps", [8000, 2000]);
    h.chain.logsByAddress.set(FW, [
      { eventName: "TaxIn", args: { eth: E / 100n }, blockNumber: h.chain.head - 5, txHash: `0x${"01".repeat(32)}`, logIndex: 0 },
      { eventName: "Buyback", args: { ethIn: E, comdBurned: 1000n * E }, blockNumber: h.chain.head - 1, txHash: `0x${"02".repeat(32)}`, logIndex: 0 },
    ]);
    h.chain.logsByAddress.set(HOOK, [
      { eventName: "Trimmed", args: { comd: 100n * E }, blockNumber: h.chain.head - 3, txHash: `0x${"03".repeat(32)}`, logIndex: 0 },
    ]);
    const f = (await get(h, "/flywheel")).body;
    assert.equal(f.configured, true);
    assert.deepEqual(f.errors, {});
    assert.deepEqual(f.tax, { taxBps: 500, totalTaxed: String(10n * E), pending: "0", toFlywheel: String(10n * E) });
    assert.deepEqual(f.flywheel.bps, { buyback: 5000, sweep: 5000 });
    assert.deepEqual(f.flywheel.buckets, { buyback: String(E / 10n), sweep: String(E / 5n) });
    assert.deepEqual(f.buckets, f.flywheel.buckets, "flat alias");
    assert.equal(f.flywheel.totals.burned, String(123_456n * E));
    assert.equal(f.flywheel.totals.swept, 1);
    assert.deepEqual(f.sweptTokenIds, [3]);
    assert.equal(f.hook.stats.toSeats, String(45n * E / 10n));
    assert.equal(f.hook.currentCap, String(900_000n * E));
    assert.equal(f.hook.params.burnBps, 8500);
    assert.equal(f.hook.params.refStepTicks, 200);
    assert.deepEqual([f.buyWall.postedEth, f.buyWall.floorTick, f.buyWall.totalBought, f.buyWall.totalTips, f.buyWall.canRebalance], [String(E), -100, String(7n * E), "1000", true]);
    assert.deepEqual(f.staking, { totalAssets: String(50n * E), totalShares: String(40n * E), ratePerSecond: "1000", streamCapPerDay: String(10n * E), pending: "5", totalDripped: String(2n * E) });
    assert.deepEqual(f.bond, { enabled: true, priceEth: String(10n ** 12n), reserve: String(6n * E), sold: "0", proceeds: "0" });
    assert.deepEqual(f.revenueRouter, { totalToRewards: String(80n * E), totalToTreasury: String(20n * E), bps: { rewards: 8000, treasury: 2000 } });
    assert.deepEqual(f.events.map((e: any) => [e.source, e.type]), [["flywheel", "Buyback"], ["hook", "Trimmed"], ["flywheel", "TaxIn"]], "newest first");
    assert.equal(f.events[0].comdBurned, String(1000n * E));
    assert.equal(f.flywheel.buckets.rewards, undefined, "no V2 rewards bucket");
    const c = (await get(h, "/flywheel/sweep-candidates")).body;
    assert.deepEqual(c.candidates.map((x: any) => x.tokenId), [7, 9], "cheapest first; swept and invalid ids dropped");
    assert.equal(c.candidates[0].withinMaxPrice, true);
    assert.equal(c.candidates[0].affordable, true);
    assert.equal(c.candidates[1].withinMaxPrice, false, "0.5 ETH > maxSweepPrice 0.25");
    assert.deepEqual(c.candidates[0].call.args, [getAddress("0x00000000000000000000000000000000000000ad"), "0x", "7", String(E / 10n)]);
  } finally {
    await h.close();
  }
});
