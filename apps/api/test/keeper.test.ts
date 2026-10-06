import test from "node:test";
import assert from "node:assert/strict";
import type { Abi, Address, Hex } from "viem";
import { Keeper, keeperConfig, type KeeperPort } from "../src/keeper.ts";
import { harness, get } from "./helpers.ts";

const RR = "0x00000000000000000000000000000000000000a1" as Address;
const FW = "0x00000000000000000000000000000000000000a2" as Address;
const SWAPPER = "0x00000000000000000000000000000000000000a3" as Address;
const COMD = "0x00000000000000000000000000000000000000c0" as Address;
const ME = "0x00000000000000000000000000000000000000ee" as Address;
const E = 10n ** 18n;


/** A scriptable chain: views come from `state`, simulations fail when `revert[fn]` is set, sends are recorded. */
class MockPort implements KeeperPort {
  readonly address = ME;
  state = {
    rrComd: 0n, buybackBucket: 0n, keeper: ME as Address, owner: "0x00000000000000000000000000000000000000ff" as Address,
    balance: 10n ** 18n, buybackOut: 1_000_000n, swapper: SWAPPER as Address, configured: true,
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
      swapper: s.swapper, configured: s.configured,
    };
    if (!(fn in v)) throw new Error(`unexpected read ${fn} on ${to}`);
    return v[fn] as T;
  }
  async simulate<T>(_to: Address, _abi: Abi, fn: string): Promise<{ result: T; gas: bigint }> {
    if (this.revert[fn]) throw new Error(this.revert[fn]);
    const result = fn === "buyback" ? this.state.buybackOut : undefined;
    return { result: result as T, gas: 100_000n };
  }
  async send(to: Address, _abi: Abi, fn: string, args: readonly unknown[] = []) {
    this.sent.push({ to, fn, args });
    const s = this.state;
    if (to === RR && fn === "distribute") s.rrComd = 0n;
    if (fn === "buyback") s.buybackBucket = 0n;
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
    KEEPER_DISTRIBUTE_EVERY_SECONDS: "60", KEEPER_BUYBACK_EVERY_SECONDS: "60",
    ...env,
  }, { revenueRouter: RR, flywheel: FW });
  const k = new Keeper(cfg, port, { now: () => t, log: () => undefined });
  return { k, port, advance: (s: number) => { t += s * 1000; } };
}

test("keeper: config defaults; only buyback / distribute (Pons mode: nothing to flush)", () => {
  const c = keeperConfig({}, { revenueRouter: null, flywheel: null });
  assert.equal(c.key, null);
  assert.equal(c.distributeMinComd, 1_000n * E);
  const { k } = make();
  assert.deepEqual(Object.keys(k.status().tasks), ["buyback", "distribute"]);
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

test("keeper: no buyback until the Flywheel has a swapper (Pons graduation); ETH accumulates", async () => {
  const { k, port, advance } = make();
  port.state.swapper = "0x0000000000000000000000000000000000000000";
  port.state.buybackBucket = E;
  await k.tick();
  assert.equal(port.sent.filter((s) => s.fn === "buyback").length, 0);
  assert.equal(k.status().tasks.buyback.lastSkip, "swapper_not_set");
  port.state.swapper = SWAPPER;
  port.state.configured = false;
  advance(61);
  await k.tick();
  assert.equal(port.sent.filter((s) => s.fn === "buyback").length, 0);
  assert.equal(k.status().tasks.buyback.lastSkip, "swapper_not_configured", "UniswapV4PoolSwapper.setPoolKey not called yet");
  port.state.configured = true;
  advance(61);
  await k.tick();
  assert.deepEqual(port.sent.filter((s) => s.fn === "buyback").map((s) => s.to), [FW]);
  port.state.buybackBucket = E;
  port.revert.buyback = "SwapperNotSet()";
  advance(61);
  await k.tick();
  assert.equal(port.sent.filter((s) => s.fn === "buyback").length, 1, "a reverting simulation is never sent");
  assert.match(k.status().tasks.buyback.lastSkip!, /simulate_reverted/);
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
