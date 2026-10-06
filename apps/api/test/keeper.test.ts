import test from "node:test";
import assert from "node:assert/strict";
import type { Abi, Address, Hex } from "viem";
import { Keeper, keeperConfig, type KeeperPort } from "../src/keeper.ts";
import { harness, get } from "./helpers.ts";

const RR = "0x00000000000000000000000000000000000000a1" as Address;
const FW = "0x00000000000000000000000000000000000000a2" as Address;
const HOOK = "0x00000000000000000000000000000000000000a3" as Address;
const COMD = "0x00000000000000000000000000000000000000c0" as Address;
const ME = "0x00000000000000000000000000000000000000ee" as Address;
const E = 10n ** 18n;

const WALL = "0x00000000000000000000000000000000000000a4" as Address;
const DRIP = "0x00000000000000000000000000000000000000a5" as Address;

/** A scriptable chain: views come from `state`, simulations fail when `revert[fn]` is set, sends are recorded. */
class MockPort implements KeeperPort {
  readonly address = ME;
  state = {
    rrComd: 0n, buybackBucket: 0n, keeper: ME as Address, owner: "0x00000000000000000000000000000000000000ff" as Address,
    balance: 10n ** 18n, buybackOut: 1_000_000n,
    pendingTax: 0n, claimEth: 0n, claimComd: 0n, canRebalance: false, tip: 0n, dripPending: 0n,
  };
  revert: Record<string, string> = {};
  sent: { to: Address; fn: string; args: readonly unknown[] }[] = [];
  failReads = false;
  async read<T>(to: Address, _abi: Abi, fn: string, args: readonly unknown[] = []): Promise<T> {
    if (this.failReads) throw new Error("rpc down");
    const s = this.state;
    const v: Record<string, unknown> = {
      comd: COMD, balanceOf: to === COMD && args[0] === RR ? s.rrComd : 0n,
      buybackBucket: s.buybackBucket, keeper: s.keeper, owner: s.owner,
      pendingTax: s.pendingTax, claimEth: s.claimEth, claimComd: s.claimComd,
      canRebalance: s.canRebalance, pending: s.dripPending,
    };
    if (!(fn in v)) throw new Error(`unexpected read ${fn} on ${to}`);
    return v[fn] as T;
  }
  async simulate<T>(_to: Address, _abi: Abi, fn: string): Promise<{ result: T; gas: bigint }> {
    if (this.revert[fn]) throw new Error(this.revert[fn]);
    const result = fn === "buyback" ? this.state.buybackOut : fn === "rebalance" ? this.state.tip : undefined;
    return { result: result as T, gas: 100_000n };
  }
  async send(to: Address, _abi: Abi, fn: string, args: readonly unknown[] = []) {
    this.sent.push({ to, fn, args });
    const s = this.state;
    if (to === RR && fn === "distribute") s.rrComd = 0n;
    if (fn === "buyback") s.buybackBucket = 0n;
    if (fn === "flush") { s.pendingTax = 0n; s.claimEth = 0n; s.claimComd = 0n; }
    if (fn === "rebalance") s.canRebalance = false;
    if (fn === "drip") s.dripPending = 0n;
    return { txHash: `0x${String(this.sent.length).padStart(64, "0")}` as Hex, status: "success" as const, gasUsed: 50_000n, blockNumber: 1 };
  }
  async ethBalance() { return this.state.balance; }
  async gasPrice() { return 1_000_000_000n; }
  async blockTimestamp() { return 1_700_000_000; }
}

function make(env: Record<string, string> = {}, port = new MockPort()) {
  let t = 1_000_000;
  const cfg = keeperConfig({
    KEEPER_PRIVATE_KEY: `0x${"11".repeat(32)}`, KEEPER_DISTRIBUTE_MIN_COMD: String(100n * E), KEEPER_BUYBACK_MIN_WEI: String(E / 10n),
    KEEPER_DISTRIBUTE_EVERY_SECONDS: "60", KEEPER_BUYBACK_EVERY_SECONDS: "60", KEEPER_FLUSH_EVERY_SECONDS: "60",
    KEEPER_REBALANCE_EVERY_SECONDS: "60", KEEPER_DRIP_EVERY_SECONDS: "60", ...env,
  }, { revenueRouter: RR, flywheel: FW, taxHook: HOOK, buyWall: WALL, rewardDripper: DRIP });
  const k = new Keeper(cfg, port, { now: () => t, log: () => undefined });
  return { k, port, advance: (s: number) => { t += s * 1000; } };
}

test("keeper: config defaults (drip at least hourly, profit check on)", () => {
  const c = keeperConfig({ KEEPER_DRIP_EVERY_SECONDS: "86400" }, { revenueRouter: null, flywheel: null, taxHook: null, buyWall: null, rewardDripper: null });
  assert.equal(c.key, null);
  assert.equal(c.dripEverySeconds, 3600, "drip is capped at hourly");
  assert.equal(c.requireProfit, true);
  assert.equal(keeperConfig({ KEEPER_REQUIRE_PROFIT: "false" }, { revenueRouter: null, flywheel: null, taxHook: null, buyWall: null, rewardDripper: null }).requireProfit, false);
});

test("keeper: RevenueRouter.distribute() only at or above the COMD threshold, then respects spacing", async () => {
  const { k, port, advance } = make();
  port.state.rrComd = 99n * E;
  await k.tick();
  assert.equal(port.sent.length, 0);
  assert.match(k.status().tasks.distribute.lastSkip!, /below_threshold/);
  port.state.rrComd = 100n * E;
  await k.tick();
  assert.deepEqual(port.sent.map((s) => [s.to, s.fn]), [[RR, "distribute"]]);
  assert.equal(k.status().tasks.distribute.runs, 1);
  port.state.rrComd = 500n * E;
  advance(10);
  await k.tick();
  assert.equal(port.sent.length, 1, "spacing: no second distribute within 60 s");
  assert.equal(k.status().tasks.distribute.lastSkip, "spacing");
  advance(60);
  await k.tick();
  assert.equal(port.sent.length, 2);
});

test("keeper: Flywheel.buyback(minOut) from the simulated output minus slippage; only as Flywheel.keeper()", async () => {
  const { k, port } = make({ KEEPER_BUYBACK_SLIPPAGE_BPS: "500" });
  port.state.buybackBucket = E / 20n;
  await k.tick();
  assert.match(k.status().tasks.buyback.lastSkip!, /below_threshold/);
  const p = make({ KEEPER_BUYBACK_SLIPPAGE_BPS: "500" });
  p.port.state.buybackBucket = E;
  p.port.state.buybackOut = 1_000_000n;
  await p.k.tick();
  const bb = p.port.sent.find((s) => s.fn === "buyback")!;
  assert.equal(bb.to, FW);
  assert.deepEqual(bb.args, [950_000n]);
  assert.equal(p.k.status().tasks.buyback.runs, 1);

  const n = make();
  n.port.state.keeper = "0x00000000000000000000000000000000000000dd";
  n.port.state.buybackBucket = E;
  await n.k.tick();
  assert.equal(n.port.sent.filter((s) => s.fn === "buyback").length, 0);
  assert.equal(n.k.status().tasks.buyback.lastSkip, "not_keeper");
});

test("keeper: ComdTaxHook.flush() only with pending tax or trim claims", async () => {
  const { k, port, advance } = make();
  await k.tick();
  assert.equal(k.status().tasks.flush.lastSkip, "not_needed");
  assert.equal(port.sent.length, 0);
  port.state.claimComd = 5n * E;
  advance(61);
  await k.tick();
  assert.deepEqual(port.sent.map((s) => [s.to, s.fn]), [[HOOK, "flush"]]);
  port.state.pendingTax = E;
  port.revert.flush = "Locked()";
  advance(61);
  await k.tick();
  assert.equal(port.sent.length, 1, "a reverting simulation is never sent");
  assert.match(k.status().tasks.flush.lastSkip!, /simulate_reverted/);
});

test("keeper: BuyWall.rebalance() when canRebalance, gated on tip ≥ gas cost unless KEEPER_REQUIRE_PROFIT=false", async () => {
  const { k, port, advance } = make();
  await k.tick();
  assert.equal(k.status().tasks.rebalance.lastSkip, "not_needed");
  port.state.canRebalance = true;
  port.state.tip = 1n; // gas 100k × 1 gwei = 1e14 wei
  advance(61);
  await k.tick();
  assert.equal(port.sent.length, 0);
  assert.match(k.status().tasks.rebalance.lastSkip!, /unprofitable/);
  port.state.tip = 2n * 10n ** 14n;
  advance(61);
  await k.tick();
  assert.deepEqual(port.sent.map((s) => [s.to, s.fn]), [[WALL, "rebalance"]]);

  const np = make({ KEEPER_REQUIRE_PROFIT: "false" });
  np.port.state.canRebalance = true;
  await np.k.tick();
  assert.deepEqual(np.port.sent.map((s) => s.fn), ["rebalance"]);
});

test("keeper: RewardDripper.drip() when pending > 0", async () => {
  const { k, port, advance } = make();
  await k.tick();
  assert.equal(k.status().tasks.drip.lastSkip, "not_needed");
  port.state.dripPending = 3n * E;
  advance(61);
  await k.tick();
  assert.deepEqual(port.sent.map((s) => [s.to, s.fn]), [[DRIP, "drip"]]);
  assert.equal(k.status().tasks.drip.runs, 1);
});

test("keeper: low gas pauses every task; RPC failures never throw; concurrent ticks share one pass", async () => {
  const { k, port } = make();
  port.state.balance = 1n;
  port.state.rrComd = 1_000n * E;
  await k.tick();
  assert.equal(port.sent.length, 0);
  assert.equal(k.status().lowGas, true);
  assert.equal(k.status().tasks.distribute.lastSkip, "low_gas");
  port.state.balance = 10n ** 18n;
  port.failReads = true;
  await assert.doesNotReject(k.tick());
  assert.match(k.status().tasks.distribute.lastError!, /rpc down/);
  port.failReads = false;
  await Promise.all([k.tick(), k.tick(), k.tick()]);
  assert.equal(port.sent.filter((s) => s.fn === "distribute" && s.to === RR).length, 1);
});

test("keeper: off without KEEPER_PRIVATE_KEY; /services, /health and /flywheel report it", async () => {
  const off = await harness();
  try {
    const s = await (await fetch(`${off.url}/services`)).json();
    const row = s.services.find((x: any) => x.kind === "keeper");
    assert.equal(row.mode, "off");
    assert.equal(row.keeper.enabled, false);
    const h = await (await fetch(`${off.url}/health`)).json();
    assert.ok(h.degraded.includes("keeper_off"));
    const fw = (await get(off, "/flywheel")).body;
    assert.equal(fw.configured, false);
    assert.deepEqual((await get(off, "/flywheel/sweep-candidates")).body.candidates, []);
  } finally { await off.close(); }
  const port = new MockPort();
  port.state.rrComd = 3_000n * E; // default threshold KEEPER_DISTRIBUTE_MIN_COMD = 1,000 COMD
  const on = await harness({ env: { KEEPER_PRIVATE_KEY: `0x${"22".repeat(32)}`, REVENUE_ROUTER: RR }, keeperPort: port });
  try {
    await on.app.keeper.tick();
    const s = await (await fetch(`${on.url}/services`)).json();
    const row = s.services.find((x: any) => x.kind === "keeper");
    assert.equal(row.mode, "chain");
    assert.equal(row.keeper.tasks.distribute.runs, 1);
    assert.equal(row.keeper.tasks.buyback.enabled, false, "no flywheel configured");
    const h = await (await fetch(`${on.url}/health`)).json();
    assert.equal(h.keeper.runs.distribute, 1);
  } finally { await on.close(); }
});
