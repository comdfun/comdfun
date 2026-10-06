/**
 * Launches. After a launch job's work and the Bench are accepted: admission checks against the versioned policy
 * → build attestation (tree hash of the attested workspace) → the Registrar deploys through ProjectFactory → live.
 * The swarm takes 10% of a launched token (rewardRule "equal_connected"):
 *   2% (contributorPoolBps − recentContributorBps) equally among wallets that did accepted work on the launch,
 *   8% (recentContributorBps) equally among seats connected within recentContributorWindowSeconds,
 *   no wallet above perWalletCapBps of the contributor pool (excess re-spread; leftover to the treasury),
 * claimable from ContributorDistributor after contributorLockSeconds (leaf (launchId, account, amount)).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { getAddress, keccak256, toHex, zeroAddress, type Address } from "viem";
import { buildContributorTree, type LaunchKind, type LaunchPolicy, type LaunchPolicyParams } from "@company/protocol";
import type { App } from "./app.ts";
import type { JobX } from "./engine.ts";
import type { LaunchRecord, PolicyRecord, RewardSnapshot } from "./records.ts";
import { iso } from "./store.ts";
import { treeHash } from "./services.ts";
import { writeLaunchTemplate } from "./launch-template.ts";
import type { LaunchedEvent } from "./chain.ts";

const KINDS: LaunchKind[] = ["custom_token", "evm_project", "univ4_hook", "evm_contracts"];

export function seedPolicies(app: App) {
  const col = app.store.c<PolicyRecord>("policies");
  if (col.count() > 0) return;
  const cfg = app.cfg;
  const owner = cfg.treasury;
  let version = 0;
  const createdAt = iso(Date.UTC(2026, 9, 5));
  for (const chainId of [46630, 4663]) {
    const testnet = chainId === 46630;
    // V2 launch pairing allowlist: ETH and COMD
    const comd = chainId === cfg.chainId ? cfg.comd : zeroAddress;
    const allow = [zeroAddress, comd].filter((a, i, xs) => xs.indexOf(a) === i).map((a) => a.toLowerCase() as Address);
    for (const kind of KINDS) {
      const params: LaunchPolicyParams = {
        kind,
        chainId,
        owners: kind === "evm_contracts" ? { treasury: owner, project: owner } : { token: owner, project: owner, treasury: owner, hookAdmin: owner, lpPosition: owner },
        feeTiers: [500, 3000, 10000],
        rewardRule: "equal_connected",
        ...(kind === "evm_contracts" ? {} : { totalSupply: "1000000000000000000000000000", treasuryBps: 1000, liquidityBps: 8000 }),
        contributorPoolBps: 1000,
        recentContributorBps: 800,
        recentContributorWindowSeconds: testnet ? 43200 : 86400,
        contributorLockSeconds: 3600,
        perWalletCapBps: 3000,
        poolFloorBps: 1000,
        gasCeilingWei: testnet ? "10000000000000000" : "50000000000000000",
        pairedCurrencyAllowlist: allow,
        ...(kind === "evm_contracts" ? {} : {
          initialMarketCaps: Object.fromEntries(allow.map((a) => [a, a === zeroAddress ? "10000000000000000000" : "1000000000000000000000000"])),
          initialMarketCapRanges: Object.fromEntries(allow.map((a) => [a, a === zeroAddress ? { min: "1000000000000000000", max: "1000000000000000000000" } : { min: "100000000000000000000000", max: "100000000000000000000000000" }])), // = ProjectFactory.setPairedConfig(COMD, 100k–100M COMD)
          minInitialMarketCapWei: "1000000000000000000",
          maxInitialMarketCapWei: "1000000000000000000000",
        }),
      };
      version++;
      col.save({ id: String(version), version, kind, note: `${testnet ? "Robinhood Chain Testnet" : "Robinhood Chain"} ${kind} terms, paired with ETH or $COMD; swarm 10% equal_connected (2% workers, 8% connected seats), cap 30% per wallet`, params, createdAt });
    }
  }
}

export class Launches {
  private readonly app: App;
  constructor(app: App) { this.app = app; }

  private get col() { return this.app.store.c<LaunchRecord>("launches"); }

  policy(kind: LaunchKind, chainId: number): LaunchPolicy | null {
    const rows = this.app.store.c<PolicyRecord>("policies").filter((p) => p.kind === kind && p.params.chainId === chainId).sort((a, b) => b.version - a.version);
    return rows[0] ?? null;
  }

  kindsFor(chainId: number): string[] {
    return KINDS.filter((k) => this.policy(k, chainId));
  }

  pairingsFor(chainId: number): string[] {
    const p = this.policy("evm_project", chainId) ?? this.policy("custom_token", chainId);
    if (!p) return ["eth"];
    const out = ["eth"];
    const allow = p.params.pairedCurrencyAllowlist.map((a) => a.toLowerCase());
    if (!/^0x0{40}$/i.test(this.app.cfg.comd) && allow.includes(this.app.cfg.comd.toLowerCase())) out.push("comd");
    return out;
  }

  /**
   * Run admission → build attestation → contributor snapshot → deployment for a launch job.
   *
   * The swarm's 10% is registered by ProjectFactory.launch in the same transaction that creates the token, so the
   * equal_connected root is built BEFORE deploying, over leaves (launchId, account, amount) with
   * launchId = ProjectFactory.launchCount() + 1 read from the chain. The launch script receives it as
   * CONTRIBUTOR_ROOT and LAUNCH_ID and must refuse to broadcast if the factory's count moved (the Registrar's own
   * template does). After the broadcast the `Launched` event confirms launchId, token and pool id.
   */
  async run(job: JobX, dir: string): Promise<LaunchRecord> {
    const now = this.app.now();
    const kind = (job.launch.kind ?? "evm_project") as LaunchKind;
    const chainId = job.launch.chainId ?? this.app.cfg.launchChains[0];
    const n = (this.col.all().reduce((m, l) => Math.max(m, l.launchNumber), 0) || 0) + 1;
    const policy = this.policy(kind, chainId);
    const econ = job.input.economics ?? {};
    const poolBps = econ.poolBps ?? 8800;
    const l: LaunchRecord = {
      id: randomUUID(),
      createdAt: iso(now),
      updatedAt: iso(now),
      launchNumber: n,
      onchainLaunchId: null,
      kind,
      status: "admission",
      chainId,
      jobId: job.id,
      workflowId: job.workflow?.id ?? null,
      policyVersion: policy?.version ?? 0,
      payer: job.paidBy,
      sourceRepoUrl: job.delivery?.repoUrl ?? null,
      sourceCommit: job.delivery?.commit ?? null,
      parkedReason: null,
      economics: { poolBps, payerBps: 9000 - poolBps, pairWith: job.input.pairWith ?? "eth", initialMarketCapWei: econ.initialMarketCapWei ?? null, remainderTo: (econ.remainderTo as Address) ?? null },
      admission: null,
      attestation: null,
      artifacts: [],
      transactions: [],
      allocations: null,
      rewardSnapshot: null,
      token: null,
      tokenInfo: null,
      poolId: null,
      lifecycle: [{ status: "admission", at: iso(now) }],
    };
    this.col.save(l);
    job.launch = { ...job.launch, id: l.id, status: l.status };
    this.app.store.c("jobs").save(job as any);
    this.app.event("launch.admission", { launchId: l.id, launchNumber: n, kind, chainId });

    // admission checks
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    checks.push({ name: "policy", ok: !!policy, detail: policy ? `policy v${policy.version}` : `no ${kind} policy for chain ${chainId}` });
    checks.push({ name: "bench", ok: job.nodes.filter((x) => x.kind === "judge").some((x) => x.state === "accepted"), detail: "the Bench sat and its judge's verdict is on the record" });
    const pairAddr = l.economics.pairWith === "comd" ? this.app.cfg.comd : zeroAddress;
    if (policy && kind !== "evm_contracts") {
      checks.push({ name: "poolBps", ok: poolBps >= policy.params.poolFloorBps && poolBps <= 9000, detail: `poolBps ${poolBps} within [${policy.params.poolFloorBps}, 9000]` });
      checks.push({ name: "pairing", ok: !!pairAddr && policy.params.pairedCurrencyAllowlist.map((a) => a.toLowerCase()).includes(pairAddr.toLowerCase()), detail: `pairWith ${l.economics.pairWith}` });
    }
    const ownScript = existsSync(path.join(dir, "launch.json"));
    if (kind !== "custom_token") checks.push({ name: "launch.json", ok: ownScript, detail: "the project declares launch.json and its launch script" });
    l.admission = { checks, at: iso(this.app.now()) };
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) return this.park(l, job, `admission refused: ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}`);

    // attestation of the build
    this.status(l, "attesting");
    const th = await treeHash(dir);
    l.attestation = { treeHash: th, buildHash: th.slice(0, 40), attestedAt: iso(this.app.now()) };
    this.save(l, job);

    if (this.app.deployBreaker.open) return this.park(l, job, `deploy breaker open: ${this.app.deployBreaker.reason}`);

    // contributor snapshot BEFORE the deployment: the root goes into ProjectFactory.launch
    const supply = BigInt(policy?.params.totalSupply ?? "1000000000000000000000000000");
    let expectedId: number | null = null;
    if (kind !== "evm_contracts" && policy) {
      const chain = this.app.chainFor(chainId);
      try {
        expectedId = chain && this.app.cfg.projectFactory ? (await chain.factoryLaunchCount()) + 1 : n;
      } catch (e) {
        return this.park(l, job, `could not read ProjectFactory.launchCount(): ${(e as Error).message.slice(0, 200)}`);
      }
      l.onchainLaunchId = expectedId;
      l.rewardSnapshot = this.snapshot(l, job, policy, supply, expectedId);
      const bps = (x: number) => ((supply * BigInt(x)) / 10_000n).toString();
      l.allocations = { totalSupply: supply.toString(), pool: bps(poolBps), payer: bps(9000 - poolBps), contributors: bps(policy.params.contributorPoolBps), poolBps: String(poolBps), payerBps: String(9000 - poolBps), contributorBps: String(policy.params.contributorPoolBps) };
      if (!l.rewardSnapshot.root) return this.park(l, job, "no contributor root: nobody did accepted work and no seat was connected in the window");
    }

    // deployment (gas ceiling and the breaker are enforced by the Registrar)
    this.status(l, "deploying");
    this.save(l, job);
    this.app.event("launch.deploying", { launchId: l.id, launchNumber: n, onchainLaunchId: expectedId });
    let deployDir = dir;
    let template = false;
    try {
      const token = this.tokenFor(job, dir);
      l.tokenInfo = { name: token.name, symbol: token.symbol, totalSupply: supply.toString() };
      if (kind === "custom_token" || !ownScript) {
        deployDir = await writeLaunchTemplate({ kind, chainId, token, economics: { poolBps, initialMarketCapWei: this.marketCap(policy, pairAddr, l.economics.initialMarketCapWei), remainderTo: l.economics.remainderTo ?? job.paidBy ?? this.app.cfg.treasury }, pairWith: pairAddr ?? zeroAddress, feeTier: this.feeTier(policy, dir), solc: this.app.cfg.launchSolc });
        template = true;
      }
      const scriptEnv: Record<string, string> = {
        LAUNCH_ID: String(expectedId ?? n),
        CONTRIBUTOR_ROOT: l.rewardSnapshot?.root ?? `0x${"0".repeat(64)}`,
        LAUNCH_SALT: keccak256(toHex(l.id)),
        LAUNCH_PAYER: job.paidBy ?? "",
        LAUNCH_OWNER: (policy?.params.owners?.project as string | undefined) ?? this.app.cfg.treasury,
        LP_OWNER: (policy?.params.owners?.lpPosition as string | undefined) ?? zeroAddress,
      };
      const r = await this.app.services.deployLaunch({ policy: policy!, projectDir: deployDir, chainId, launchId: l.id, launchNumber: n, kind, payer: job.paidBy, economics: l.economics, scriptEnv });
      l.transactions = r.transactions;
      l.deployment = { mode: r.mode ?? "broadcast", template, gasUsed: r.gasUsed ?? null, costWei: r.costWei ?? null, notes: r.notes ?? [] };
      let ev: LaunchedEvent | null = null;
      const chain = this.app.chainFor(chainId);
      if (kind !== "evm_contracts" && chain) {
        for (const t of r.transactions) {
          if (!/^0x[0-9a-f]{64}$/i.test(t.txHash)) continue;
          ev = await chain.launchedEvent(t.txHash).catch(() => null);
          if (ev) break;
        }
      }
      if (ev) {
        if (expectedId !== null && ev.launchId !== expectedId) throw new Error(`ProjectFactory assigned launchId ${ev.launchId}, the contributor root was built for ${expectedId}`);
        l.onchainLaunchId = ev.launchId;
        l.token = ev.token;
        l.poolId = ev.poolId;
        l.launchedEvent = ev;
        const f = this.app.cfg.projectFactory;
        l.artifacts = [
          { role: "token", name: "LaunchToken", address: ev.token, txHash: ev.txHash, blockNumber: ev.blockNumber },
          ...(this.app.cfg.contributorDistributor ? [{ role: "distributor", name: "ContributorDistributor", address: getAddress(this.app.cfg.contributorDistributor), txHash: ev.txHash, blockNumber: ev.blockNumber }] : []),
          ...(f ? [{ role: "other", name: "ProjectFactory", address: getAddress(f), txHash: ev.txHash, blockNumber: ev.blockNumber }] : []),
          ...r.artifacts.filter((a) => a.role !== "token").map((a) => ({ ...a, address: getAddress(a.address), txHash: a.txHash === `0x${"0".repeat(64)}` ? ev!.txHash : a.txHash })),
        ];
        if (l.rewardSnapshot) {
          l.rewardSnapshot.rootStatus = "sent";
          l.rewardSnapshot.rootTx = ev.txHash;
          // the lock runs from the launch block (ContributorDistributor.unlockAt(launchId))
          const b = await chain!.block(ev.blockNumber).catch(() => null);
          if (b && policy) l.rewardSnapshot.unlockAt = b.timestamp + policy.params.contributorLockSeconds;
        }
      } else if (kind !== "evm_contracts" && r.token) {
        // no chain to read (tests / mock Registrar): trust the Registrar's report
        l.token = r.token;
        l.poolId = r.poolId;
        l.artifacts = r.artifacts.map((a) => ({ ...a, address: getAddress(a.address) }));
        if (l.rewardSnapshot) { l.rewardSnapshot.rootStatus = "sent"; l.rewardSnapshot.rootTx = r.transactions[0]?.txHash ?? null; }
      } else if (kind !== "evm_contracts") {
        throw new Error(`the launch broadcast ${r.transactions.length} transaction(s) but none emitted ProjectFactory.Launched`);
      } else {
        l.artifacts = r.artifacts.map((a) => ({ ...a, address: getAddress(a.address) }));
      }
      this.app.deployBreaker.failures = 0;
    } catch (e) {
      const b = this.app.deployBreaker;
      b.failures++;
      if (b.failures >= 3) { b.open = true; b.reason = `3 consecutive deploy failures; last: ${(e as Error).message}`; b.openedAt = iso(this.app.now()); }
      this.status(l, "failed", (e as Error).message.slice(0, 300));
      l.parkedReason = `deployment failed: ${(e as Error).message.slice(0, 1500)}`;
      if (l.rewardSnapshot) l.rewardSnapshot.rootStatus = "failed";
      this.save(l, job);
      this.app.event("launch.failed", { launchId: l.id, reason: l.parkedReason.slice(0, 300) });
      return l;
    } finally {
      if (template && deployDir !== dir) await rm(deployDir, { recursive: true, force: true }).catch(() => undefined);
    }
    this.status(l, "live");
    this.save(l, job);
    this.app.event("launch.live", { launchId: l.id, launchNumber: n, onchainLaunchId: l.onchainLaunchId, token: l.token, root: l.rewardSnapshot?.root ?? null });
    return l;
  }

  private status(l: LaunchRecord, status: LaunchRecord["status"], note?: string) {
    l.status = status;
    (l.lifecycle ??= []).push({ status, at: iso(this.app.now()), ...(note ? { note } : {}) });
  }

  /** Token name/symbol: the project's launch.json when it has one, else from the objective ($SYM / (SYM)). */
  tokenFor(job: JobX, dir: string): { name: string; symbol: string } {
    try {
      const m = JSON.parse(readFileSync(path.join(dir, "launch.json"), "utf8"));
      if (typeof m?.token?.name === "string" && typeof m?.token?.symbol === "string" && /^[A-Za-z0-9]{1,11}$/.test(m.token.symbol)) return { name: m.token.name.slice(0, 64), symbol: m.token.symbol };
    } catch { /* no manifest */ }
    const first = job.objective.split("\n")[0];
    const symbol = (/\$([A-Z][A-Z0-9]{1,10})\b/.exec(first)?.[1] ?? /\(([A-Z][A-Z0-9]{1,10})\)/.exec(first)?.[1] ?? "MATTER").toUpperCase();
    const name = (/(?:token|coin)\s+(?:called|named)\s+"?([A-Za-z0-9 ]{2,40})"?/i.exec(first)?.[1] ?? first.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).slice(0, 4).join(" ") ?? symbol).trim().slice(0, 64) || symbol;
    return { name, symbol };
  }

  private marketCap(policy: LaunchPolicy | null, paired: Address | null, requested: string | null): string {
    if (requested) return requested;
    const caps = (policy?.params as any)?.initialMarketCaps as Record<string, string> | undefined;
    return caps?.[(paired ?? zeroAddress).toLowerCase()] ?? "10000000000000000000";
  }

  private feeTier(policy: LaunchPolicy | null, dir: string): number {
    try {
      const m = JSON.parse(readFileSync(path.join(dir, "launch.json"), "utf8"));
      if (policy?.params.feeTiers?.includes(m?.pool?.feeTier)) return m.pool.feeTier;
    } catch { /* default */ }
    return policy?.params.feeTiers?.includes(10_000) ? 10_000 : policy?.params.feeTiers?.[0] ?? 10_000;
  }

  private save(l: LaunchRecord, job: JobX) {
    l.updatedAt = iso(this.app.now());
    this.col.save(l);
    job.launch = { ...job.launch, id: l.id, status: l.status };
    this.app.store.c("jobs").save(job as any);
  }

  private park(l: LaunchRecord, job: JobX, reason: string): LaunchRecord {
    l.status = "parked";
    l.parkedReason = reason;
    this.save(l, job);
    this.app.event("launch.parked", { launchId: l.id, reason });
    return l;
  }

  /** equal_connected snapshot → ContributorDistributor Merkle root. */
  snapshot(l: LaunchRecord, job: JobX, policy: LaunchPolicy, supply: bigint, launchId: number = l.onchainLaunchId ?? l.launchNumber): RewardSnapshot {
    const p = policy.params;
    const pool = (supply * BigInt(p.contributorPoolBps)) / 10_000n;
    const connectedPool = (supply * BigInt(p.recentContributorBps)) / 10_000n;
    const workersPool = pool - connectedPool;
    const cap = (pool * BigInt(p.perWalletCapBps)) / 10_000n;
    const now = this.app.now();

    const workers = [...new Set(this.app.store.c<any>("submissions").filter((s) => s.jobId === job.id && s.accepted).map((s) => String(s.wallet).toLowerCase()))].sort();
    const since = now - p.recentContributorWindowSeconds * 1000;
    const seats = this.app.store.c<any>("seats").filter((s) => s.wallet && s.lastSeenAt && Date.parse(s.lastSeenAt) >= since).map((s) => ({ tokenId: String(s.tokenId), wallet: String(s.wallet).toLowerCase() }));
    const connected = [...new Map(seats.map((s) => [s.tokenId, s])).values()].sort((a, b) => Number(BigInt(a.tokenId) - BigInt(b.tokenId)));
    const entries = equalConnected({ workersPool, connectedPool, cap, workers, connected });
    const total = entries.reduce((a, e) => a + BigInt(e.amount), 0n);
    const leftover = pool - total;
    const tree = entries.length ? buildContributorTree(entries.map((e) => ({ launchId, account: e.account, amount: e.amount }))) : null;
    return {
      rule: "equal_connected",
      takenAt: iso(now),
      totalSupply: supply.toString(),
      contributorPool: pool.toString(),
      workersPool: workersPool.toString(),
      connectedPool: connectedPool.toString(),
      perWalletCap: cap.toString(),
      workers,
      connectedSeats: connected,
      launchId,
      root: tree?.root ?? null,
      total: total.toString(),
      unlockAt: Math.floor(now / 1000) + p.contributorLockSeconds,
      leftoverToTreasury: leftover.toString(),
      entries,
      claims: tree?.claims.map((c) => ({ account: c.account, amount: c.amount, proof: c.proof, leaf: c.leaf })),
      rootTx: null,
      rootStatus: tree ? "queued" : "none",
    };
  }

  claimFor(launchId: string, wallet: string) {
    const l = this.col.get(launchId);
    const c = l?.rewardSnapshot?.claims?.find((x) => x.account.toLowerCase() === wallet.toLowerCase());
    return c && l ? { root: l.rewardSnapshot!.root, amount: c.amount, proof: c.proof, launchNumber: l.launchNumber, onchainLaunchId: l.rewardSnapshot!.launchId ?? l.onchainLaunchId, unlockAt: l.rewardSnapshot!.unlockAt } : null;
  }

  /** GET /launches/:id/claims/:address — ContributorDistributor.claim(launchId, account, amount, proof) arguments. */
  claimView(l: LaunchRecord, wallet: string) {
    const snap = l.rewardSnapshot;
    const c = snap?.claims?.find((x) => x.account.toLowerCase() === wallet.toLowerCase());
    const e = snap?.entries.find((x) => x.account.toLowerCase() === wallet.toLowerCase());
    const launchId = snap?.launchId ?? l.onchainLaunchId;
    return {
      launch: l.id, launchNumber: l.launchNumber, launchId, chainId: l.chainId, token: l.token, distributor: this.app.cfg.contributorDistributor,
      account: wallet.toLowerCase(), eligible: !!c, amount: c?.amount ?? "0", workerShare: e?.workerShare ?? "0", connectedShare: e?.connectedShare ?? "0",
      proof: c?.proof ?? [], leaf: c?.leaf ?? null, root: snap?.root ?? null, rootStatus: snap?.rootStatus ?? "none", unlockAt: snap?.unlockAt ?? null,
      unlocked: snap ? Math.floor(this.app.now() / 1000) >= snap.unlockAt : false,
      call: c && launchId !== null ? { function: "claim(uint256 launchId, address account, uint256 amount, bytes32[] proof)", args: [String(launchId), c.account, c.amount, c.proof] } : null,
    };
  }
}

/**
 * Equal shares with a per-wallet cap: workers split workersPool equally; connected seats split connectedPool equally
 * (aggregated to their wallet); any wallet over `cap` is cut to it and the excess is re-spread over uncapped wallets
 * in proportion to their shares, repeatedly; whatever cannot be placed stays with the treasury.
 */
export function equalConnected(x: { workersPool: bigint; connectedPool: bigint; cap: bigint; workers: string[]; connected: { tokenId: string; wallet: string }[] }) {
  const share = new Map<string, { w: bigint; c: bigint }>();
  const get = (a: string) => share.get(a) ?? (share.set(a, { w: 0n, c: 0n }), share.get(a)!);
  if (x.workers.length) {
    const each = x.workersPool / BigInt(x.workers.length);
    for (const w of x.workers) get(w).w += each;
  }
  if (x.connected.length) {
    const each = x.connectedPool / BigInt(x.connected.length);
    for (const s of x.connected) get(s.wallet).c += each;
  }
  const amt = new Map([...share].map(([a, s]) => [a, s.w + s.c]));
  const capped = new Set<string>();
  for (let round = 0; round < 50; round++) {
    let excess = 0n;
    for (const [a, v] of amt) if (v > x.cap) { excess += v - x.cap; amt.set(a, x.cap); capped.add(a); }
    if (excess === 0n) break;
    const open = [...amt].filter(([a]) => !capped.has(a));
    const base = open.reduce((s, [, v]) => s + v, 0n);
    if (!open.length || base === 0n) break;
    let given = 0n;
    for (const [a, v] of open) { const add = (excess * v) / base; amt.set(a, v + add); given += add; }
    if (given === 0n) break;
  }
  return [...amt].filter(([, v]) => v > 0n).sort(([a], [b]) => (a < b ? -1 : 1)).map(([account, v]) => ({
    account: getAddress(account),
    amount: v.toString(),
    workerShare: share.get(account)!.w.toString(),
    connectedShare: share.get(account)!.c.toString(),
    capped: capped.has(account),
  }));
}
