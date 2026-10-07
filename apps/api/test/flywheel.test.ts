import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { harness, get } from "./helpers.ts";

const FW = "0x00000000000000000000000000000000000000f1";
const SW = "0x00000000000000000000000000000000000000f2";
const RR = "0x00000000000000000000000000000000000000f3";
const E = 10n ** 18n;

test("GET /flywheel (Pons mode): tax in, 2 buckets, swapper, revenue router, swept ids, events; sweep candidates from SWEEP_LISTINGS_URL", async () => {
  const listings = { listings: [
    { tokenId: 9, price: String(E / 2n), marketplace: "opensea", adapter: "0x00000000000000000000000000000000000000ad", data: "0x1234" },
    { tokenId: 7, price: String(E / 10n), marketplace: "opensea", adapter: "0x00000000000000000000000000000000000000ad", data: "0x" },
    { tokenId: 3, price: "1", marketplace: "x" }, // already swept: dropped
    { tokenId: 4000, price: "1" }, // not a Counsel id: dropped
  ] };
  const fakeFetch = (async (url: any, init?: any) => String(url).startsWith("https://listings.test/") ? new Response(JSON.stringify(listings), { status: 200 }) : fetch(url, init)) as typeof fetch;
  const h = await harness({ env: { FLYWHEEL: FW, SWAPPER: SW, REVENUE_ROUTER: RR, PONS_URL: "https://pons.test/token/comd/", SWEEP_LISTINGS_URL: "https://listings.test/counsel", FLYWHEEL_CACHE_SECONDS: "0" }, fetch: fakeFetch });
  try {
    const v = (k: string, fn: string, x: unknown) => h.chain.views.set(`${k}:${fn}`, x);
    v(FW, "totalTaxIn", 10n * E); v(FW, "totalBoughtBack", 4n * E); v(FW, "totalBurned", 123_456n * E); v(FW, "totalSwept", 1n); v(FW, "sweepSpent", E / 5n);
    v(FW, "bucketBalances", [E / 10n, E / 5n]); v(FW, "bps", [5000, 5000]); v(FW, "sweptTokenIds", [3n]);
    v(FW, "maxSweepPrice", E / 4n); v(FW, "keeper", "0x00000000000000000000000000000000000000ee"); v(FW, "owner", "0x00000000000000000000000000000000000000ff");
    v(FW, "swapper", SW); v(SW, "configured", false);
    v(RR, "totalToRewards", 80n * E); v(RR, "totalToTreasury", 20n * E); v(RR, "bps", [8000, 2000]);
    h.chain.logsByAddress.set(FW, [
      { eventName: "TaxIn", args: { eth: E / 100n }, blockNumber: h.chain.head - 5, txHash: `0x${"01".repeat(32)}`, logIndex: 0 },
      { eventName: "Buyback", args: { ethIn: E, comdBurned: 1000n * E }, blockNumber: h.chain.head - 1, txHash: `0x${"02".repeat(32)}`, logIndex: 0 },
    ]);
    const f = (await get(h, "/flywheel")).body;
    assert.equal(f.configured, true);
    assert.deepEqual(f.errors, {});
    // no fee wallet configured in this test: collected = what reached the Flywheel
    assert.deepEqual(f.tax, { totalTaxIn: String(10n * E), toFlywheel: String(10n * E), toFeeWallet: null, collected: String(10n * E), source: "pons" });
    assert.deepEqual(f.pons, { url: "https://pons.test/token/comd" });
    assert.deepEqual(f.swapper, { address: SW, configured: false, onFlywheel: true });
    assert.deepEqual(f.flywheel.bps, { buyback: 5000, sweep: 5000 });
    assert.deepEqual(f.flywheel.buckets, { buyback: String(E / 10n), sweep: String(E / 5n) });
    assert.deepEqual(f.buckets, f.flywheel.buckets, "flat alias");
    assert.equal(f.flywheel.totals.burned, String(123_456n * E));
    assert.equal(f.flywheel.totals.swept, 1);
    assert.deepEqual(f.sweptTokenIds, [3]);
    assert.deepEqual(f.revenueRouter, { totalToRewards: String(80n * E), totalToTreasury: String(20n * E), bps: { rewards: 8000, treasury: 2000 } });
    assert.deepEqual(f.events.map((e: any) => [e.source, e.type]), [["flywheel", "Buyback"], ["flywheel", "TaxIn"]], "newest first");
    assert.equal(f.events[0].comdBurned, String(1000n * E));
    assert.equal(f.flywheel.buckets.rewards, undefined, "no V2 rewards bucket");
    for (const k of ["hook", "buyWall", "staking", "bond"]) assert.equal(k in f, false, `no ${k} section (Pons mode)`);
    v(SW, "configured", true);
    assert.equal((await get(h, "/flywheel")).body.swapper.configured, true, "swapper reports configured after setPoolKey");
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
