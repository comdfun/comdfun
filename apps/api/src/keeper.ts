/**
 * The keeper: the on-chain housekeeping of the Company.md flywheel (Pons mode). Enabled when KEEPER_PRIVATE_KEY is set
 * (and RPC_URL). Tasks, in order each tick:
 *
 *   - Flywheel.buyback(minOut)   keeper/owner only · when the Flywheel has a swapper (`swapper()` != 0, set by the
 *                                owner once the Pons pool exists and the UniswapV4PoolSwapper is pointed at it) and
 *                                the buyback bucket ≥ KEEPER_BUYBACK_MIN_WEI; minOut = simulated buyback(0) output −
 *                                KEEPER_BUYBACK_SLIPPAGE_BPS. Bought COMD goes to the dead address (burned). Until the
 *                                swapper is configured the task is skipped (`swapper_not_set` / `swapper_not_configured`)
 *                                and ETH accumulates.
 *   - RevenueRouter.distribute() anyone · when it holds ≥ KEEPER_DISTRIBUTE_MIN_COMD of job revenue: 80% Counsel
 *                                rewards (RewardDistributor) / 20% firm treasury.
 * Floor sweeps (Flywheel.sweep) stay manual (GET /flywheel/sweep-candidates). Tax arrives as plain ETH from Pons
 * (nothing to flush).
 *
 * Every call is simulated first (a revert is logged, never sent), each task has its own minimum spacing, the whole
 * tick is serialised, and nothing here ever throws into the process. State: GET /services, /health, /flywheel.
 */
import { createPublicClient, createWalletClient, erc20Abi, http, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { flywheelAbi, revenueRouterAbi, uniswapV4PoolSwapperAbi } from "@company/abi";

/** What the keeper needs from a chain; `ViemKeeperPort` is the real one, tests pass a mock. */
export interface KeeperPort {
  readonly address: Address;
  read<T = unknown>(to: Address, abi: Abi, functionName: string, args?: readonly unknown[]): Promise<T>;
  /** eth_call + estimateGas as the keeper; throws with the revert reason. */
  simulate<T = unknown>(to: Address, abi: Abi, functionName: string, args?: readonly unknown[]): Promise<{ result: T; gas: bigint }>;
  send(to: Address, abi: Abi, functionName: string, args?: readonly unknown[]): Promise<{ txHash: Hex; status: "success" | "reverted"; gasUsed: bigint; blockNumber: number }>;
  ethBalance(): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  blockTimestamp(): Promise<number>;
}

export interface KeeperConfig {
  key: Hex | null;
  intervalSeconds: number;
  /** RevenueRouter.distribute() when its COMD balance ≥ this (atomic) */
  distributeMinComd: bigint;
  distributeEverySeconds: number;
  /** automatic buybacks (KEEPER_BUYBACK_AUTO=true). Default false: the owner times buybacks by calling
   *  Flywheel.buyback(minOut) from the Admin wallet (the contract allows keeper or owner). */
  buybackAuto: boolean;
  /** Flywheel.buyback when the buyback bucket ≥ this (wei) */
  buybackMinWei: bigint;
  buybackEverySeconds: number;
  buybackSlippageBps: number;
  minEthWei: bigint;
  revenueRouter: Address | null;
  flywheel: Address | null;
}

export type TaskName = "buyback" | "distribute";

export interface TaskStatus {
  /** enabled = an address is configured for it */
  enabled: boolean;
  runs: number;
  lastCheckAt: string | null;
  /** why the last check did nothing (below_threshold, swapper_not_set, swapper_not_configured, not_keeper, spacing, simulate_reverted, low_gas…) */
  lastSkip: string | null;
  lastRunAt: string | null;
  lastTx: Hex | null;
  lastResult: string | null;
  lastError: string | null;
  errors: number;
}

export interface KeeperStatus {
  enabled: boolean;
  reason: string | null;
  address: Address | null;
  intervalSeconds: number;
  ticks: number;
  lastTickAt: string | null;
  lastError: string | null;
  ethBalance: string | null;
  lowGas: boolean;
  thresholds: { distributeMinComd: string; distributeEverySeconds: number; buybackMinWei: string; buybackEverySeconds: number; buybackSlippageBps: number; minEthWei: string };
  contracts: { revenueRouter: Address | null; flywheel: Address | null };
  tasks: Record<TaskName, TaskStatus>;
}

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => ((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? String(e)).split("\n")[0].slice(0, 300);

export class ViemKeeperPort implements KeeperPort {
  readonly address: Address;
  private readonly wallet: any;
  private readonly pub: PublicClient;
  constructor(rpcUrl: string, chainId: number, key: Hex) {
    const account = privateKeyToAccount(key);
    this.address = account.address;
    const chain = { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } } as const;
    this.wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });
    this.pub = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000, retryCount: 1 }) }) as PublicClient;
  }
  read<T>(to: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
    return this.pub.readContract({ address: to, abi, functionName, args } as any) as Promise<T>;
  }
  async simulate<T>(to: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
    const { result } = await this.pub.simulateContract({ account: this.wallet.account, address: to, abi, functionName, args } as any);
    const gas = await this.pub.estimateContractGas({ account: this.wallet.account, address: to, abi, functionName, args } as any);
    return { result: result as T, gas };
  }
  async send(to: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
    const { request } = await this.pub.simulateContract({ account: this.wallet.account, address: to, abi, functionName, args } as any);
    const hash: Hex = await this.wallet.writeContract(request);
    const r = await this.pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    return { txHash: hash, status: r.status as "success" | "reverted", gasUsed: r.gasUsed, blockNumber: Number(r.blockNumber) };
  }
  ethBalance() { return this.pub.getBalance({ address: this.address }); }
  gasPrice() { return this.pub.getGasPrice(); }
  async blockTimestamp() { return Number((await this.pub.getBlock({ blockTag: "latest" })).timestamp); }
}

function task(enabled: boolean): TaskStatus {
  return { enabled, runs: 0, lastCheckAt: null, lastSkip: null, lastRunAt: null, lastTx: null, lastResult: null, lastError: null, errors: 0 };
}

export class Keeper {
  readonly cfg: KeeperConfig;
  readonly port: KeeperPort | null;
  private readonly now: () => number;
  private readonly log: (m: string) => void;
  private st: KeeperStatus;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastAttempt: Partial<Record<TaskName, number>> = {};
  private role: { ok: boolean; checkedAt: number } | null = null;
  private comd: Address | null = null;

  constructor(cfg: KeeperConfig, port: KeeperPort | null, o: { now?: () => number; log?: (m: string) => void; reason?: string | null } = {}) {
    this.cfg = cfg;
    this.port = port;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((m) => console.log(`[keeper] ${m}`));
    const enabled = !!port;
    this.st = {
      enabled,
      reason: enabled ? null : o.reason ?? "KEEPER_PRIVATE_KEY not set",
      address: port?.address ?? null,
      intervalSeconds: cfg.intervalSeconds,
      ticks: 0,
      lastTickAt: null,
      lastError: null,
      ethBalance: null,
      lowGas: false,
      thresholds: {
        distributeMinComd: cfg.distributeMinComd.toString(), distributeEverySeconds: cfg.distributeEverySeconds,
        buybackMinWei: cfg.buybackMinWei.toString(), buybackEverySeconds: cfg.buybackEverySeconds, buybackSlippageBps: cfg.buybackSlippageBps,
        minEthWei: cfg.minEthWei.toString(),
      },
      contracts: { revenueRouter: cfg.revenueRouter, flywheel: cfg.flywheel },
      tasks: {
        buyback: task(enabled && !!cfg.flywheel && cfg.buybackAuto),
        distribute: task(enabled && !!cfg.revenueRouter),
      },
    };
  }

  status(): KeeperStatus {
    return JSON.parse(JSON.stringify(this.st));
  }

  start() {
    if (!this.port || this.timer) return;
    this.log(`enabled as ${this.port.address} every ${this.cfg.intervalSeconds}s (flywheel ${this.cfg.flywheel ?? "—"}, revenue router ${this.cfg.revenueRouter ?? "—"})`);
    const t = setInterval(() => void this.tick(), Math.max(1, this.cfg.intervalSeconds) * 1000);
    t.unref();
    this.timer = t;
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every task. Serialised (a slow tick is not overlapped) and never rejects. */
  tick(): Promise<void> {
    if (!this.port) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.pass().catch((e) => { this.st.lastError = msg(e); this.log(`tick failed: ${msg(e)}`); }).finally(() => { this.running = null; });
    return this.running;
  }

  private due(name: TaskName, every: number): boolean {
    const last = this.lastAttempt[name];
    return last === undefined || this.now() - last >= every * 1000;
  }

  private skip(name: TaskName, why: string) {
    const t = this.st.tasks[name];
    t.lastCheckAt = iso(this.now());
    t.lastSkip = why;
  }

  private async pass() {
    const port = this.port!;
    this.st.ticks++;
    this.st.lastTickAt = iso(this.now());
    try {
      const bal = await port.ethBalance();
      this.st.ethBalance = bal.toString();
      this.st.lowGas = bal < this.cfg.minEthWei;
    } catch (e) {
      this.st.lastError = `balance: ${msg(e)}`;
      return;
    }
    if (this.st.lowGas) {
      for (const k of Object.keys(this.st.tasks) as TaskName[]) if (this.st.tasks[k].enabled) this.skip(k, "low_gas");
      return;
    }
    this.st.lastError = null;
    if (this.st.tasks.buyback.enabled) await this.guard("buyback", () => this.buyback());
    if (this.st.tasks.distribute.enabled) await this.guard("distribute", () => this.distribute());
  }

  private async guard(name: TaskName, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      const t = this.st.tasks[name];
      t.lastError = msg(e);
      t.errors++;
      t.lastCheckAt = iso(this.now());
      this.log(`${name}: ${t.lastError}`);
    }
  }

  /** Simulate, then send; records the outcome on `name`. Returns false when the simulation reverted. */
  private async exec(name: TaskName, to: Address, abi: Abi, fn: string, args: readonly unknown[], what: string): Promise<boolean> {
    const port = this.port!;
    this.lastAttempt[name] = this.now();
    const t = this.st.tasks[name];
    try {
      await port.simulate(to, abi, fn, args);
    } catch (e) {
      this.skip(name, `simulate_reverted: ${msg(e)}`);
      return false;
    }
    const r = await port.send(to, abi, fn, args);
    t.lastCheckAt = t.lastRunAt = iso(this.now());
    t.lastTx = r.txHash;
    if (r.status !== "success") {
      t.errors++;
      t.lastError = `${fn} reverted in ${r.txHash}`;
      this.log(t.lastError);
      return false;
    }
    t.runs++;
    t.lastSkip = null;
    t.lastError = null;
    t.lastResult = what;
    this.log(`${fn}(): ${what} · tx ${r.txHash} · gas ${r.gasUsed}`);
    return true;
  }

  /** Flywheel.buyback is keeper-or-owner only. Re-checked hourly so a later setKeeper is picked up without a restart. */
  private async isFlywheelKeeper(): Promise<boolean> {
    if (this.role && (this.role.ok || this.now() - this.role.checkedAt < 3_600_000)) return this.role.ok;
    const fw = this.cfg.flywheel!;
    const me = this.port!.address.toLowerCase();
    const [k, o] = await Promise.all([this.port!.read<Address>(fw, flywheelAbi as Abi, "keeper"), this.port!.read<Address>(fw, flywheelAbi as Abi, "owner")]);
    const ok = k.toLowerCase() === me || o.toLowerCase() === me;
    this.role = { ok, checkedAt: this.now() };
    if (!ok) this.log(`${this.port!.address} is not Flywheel.keeper() (${k}); buybacks are skipped until setKeeper`);
    return ok;
  }

  private async buyback() {
    if (!this.due("buyback", this.cfg.buybackEverySeconds)) return this.skip("buyback", "spacing");
    const fw = this.cfg.flywheel!;
    const bucket = await this.port!.read<bigint>(fw, flywheelAbi as Abi, "buybackBucket");
    if (bucket === 0n || bucket < this.cfg.buybackMinWei) return this.skip("buyback", `below_threshold: ${bucket} < ${this.cfg.buybackMinWei}`);
    // Pons mode: the swapper is configured by the owner after the Pons graduation; until then ETH simply accumulates
    const swapper = await this.port!.read<Address>(fw, flywheelAbi as Abi, "swapper");
    if (!swapper || /^0x0{40}$/i.test(swapper)) return this.skip("buyback", "swapper_not_set");
    // a UniswapV4PoolSwapper knows whether its PoolKey is set; another IBuybackSwapper may not expose configured()
    const configured = await this.port!.read<boolean>(swapper, uniswapV4PoolSwapperAbi as Abi, "configured").catch(() => true);
    if (!configured) return this.skip("buyback", "swapper_not_configured");
    if (!(await this.isFlywheelKeeper())) return this.skip("buyback", "not_keeper");
    let out: bigint;
    try {
      out = (await this.port!.simulate<bigint>(fw, flywheelAbi as Abi, "buyback", [0n])).result;
    } catch (e) {
      this.lastAttempt.buyback = this.now();
      return this.skip("buyback", `simulate_reverted: ${msg(e)}`);
    }
    const minOut = (out * BigInt(10_000 - this.cfg.buybackSlippageBps)) / 10_000n;
    await this.exec("buyback", fw, flywheelAbi as Abi, "buyback", [minOut], `${bucket} wei → ≥${minOut} COMD bought back and sent to the dead address`);
  }

  private async distribute() {
    if (!this.due("distribute", this.cfg.distributeEverySeconds)) return this.skip("distribute", "spacing");
    const rr = this.cfg.revenueRouter!;
    this.comd ??= await this.port!.read<Address>(rr, revenueRouterAbi as Abi, "comd");
    const pending = await this.port!.read<bigint>(this.comd, erc20Abi as Abi, "balanceOf", [rr]);
    if (pending === 0n || pending < this.cfg.distributeMinComd) return this.skip("distribute", `below_threshold: ${pending} < ${this.cfg.distributeMinComd}`);
    await this.exec("distribute", rr, revenueRouterAbi as Abi, "distribute", [], `${pending} COMD (atomic): 80% Counsel rewards / 20% firm treasury`);
  }
}

/** Keeper settings from the environment (names in .env.example). */
export function keeperConfig(env: Record<string, string | undefined>, addrs: { revenueRouter: Address | null; flywheel: Address | null }): KeeperConfig {
  const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  const big = (v: string | undefined, d: bigint) => (v && /^[0-9]+$/.test(v) ? BigInt(v) : d);
  const k = env.KEEPER_PRIVATE_KEY ? (env.KEEPER_PRIVATE_KEY.startsWith("0x") ? env.KEEPER_PRIVATE_KEY : `0x${env.KEEPER_PRIVATE_KEY}`) : "";
  return {
    key: /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null,
    intervalSeconds: Math.max(1, num(env.KEEPER_INTERVAL_SECONDS, 60)),
    distributeMinComd: big(env.KEEPER_DISTRIBUTE_MIN_COMD, 1_000n * 10n ** 18n),
    distributeEverySeconds: num(env.KEEPER_DISTRIBUTE_EVERY_SECONDS, 3600),
    buybackAuto: /^(1|true|yes)$/i.test(String(env.KEEPER_BUYBACK_AUTO ?? "")),
    buybackMinWei: big(env.KEEPER_BUYBACK_MIN_WEI, 50_000_000_000_000_000n),
    buybackEverySeconds: num(env.KEEPER_BUYBACK_EVERY_SECONDS, 900),
    buybackSlippageBps: Math.min(5000, Math.max(0, num(env.KEEPER_BUYBACK_SLIPPAGE_BPS, 300))),
    minEthWei: big(env.KEEPER_MIN_ETH_WEI, 1_000_000_000_000_000n),
    ...addrs,
  };
}
