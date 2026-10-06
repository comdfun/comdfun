/**
 * Back-office services the control plane calls: the Clerk (verifier), the Records Office (publisher), the
 * Registrar (deployer), site hosting and the Attester.
 *
 *   production (`loadServices`)  the real `@company/services`: verifySubmission (sandboxed Foundry / npm re-runs,
 *                                content checks), publishRepo (GitHub org, or a dry run with a tarball in the
 *                                BlobStore when GITHUB_TOKEN is unset), publishSite / serveSite (sites on our
 *                                BlobStore, served by Host header), deployLaunch (`forge script` with the
 *                                Registrar's DEPLOYER_PRIVATE_KEY through ProjectFactory, gas ceiling enforced).
 *                                Attestations are signed here with ATTESTER_PRIVATE_KEY.
 *   tests/demos (`MockServices`) deterministic and offline. SERVICES_MODE=mock forces it.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { encodeAbiParameters, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { canonicalJson, type LaunchKind, type LaunchPolicy, type OutputSpec } from "@company/protocol";
import type { BlobStore } from "./storage.ts";
import { publishSiteFiles } from "./sites-host.ts";

export interface VerifyInput {
  workspaceDir: string;
  /** the tree the seat started from (accepted ancestors + inputs) */
  baseDir: string;
  allowedPaths: string[];
  skill: string;
  outputs: OutputSpec[];
  /** paths written by this submission */
  changed: string[];
  kind: string;
  minCitations?: number;
  rubricContains?: string[];
}
export interface VerifyResult {
  ok: boolean;
  profile: string;
  evaluation: "rerun" | "structural" | "none";
  detail: string;
  failedChecks: string[];
  treeHash: string | null;
  version: string;
}
export interface PublishRepoResult { repoUrl: string; commit: string; pullRequestUrl: string | null; branch: string | null }
export interface PublishSiteResult { label: string; url: string; version: string; files: number; bytes: number }
export interface DeployedArtifact { role: "token" | "hook" | "distributor" | "pool" | "other"; name: string; address: Address; txHash: Hex; blockNumber: number }
export interface DeployResult {
  artifacts: DeployedArtifact[];
  transactions: { txHash: Hex; label: string; gasUsed?: string }[];
  /** set by registrars that know them without the chain (mock); the real one is read from ProjectFactory.Launched */
  token: Address | null;
  poolId: Hex | null;
  mode?: string;
  gasUsed?: string | null;
  costWei?: string | null;
  notes?: string[];
}
export interface AttestInput { typedData: { domain: any; types: any; primaryType: string; message: any } }

export interface Services {
  readonly name: string;
  verify(input: VerifyInput): Promise<VerifyResult>;
  publishRepo(input: { jobId: string; title: string; dir: string; baseRepo?: { repoUrl: string; commit: string } | null }): Promise<PublishRepoResult>;
  publishSite(input: { label: string; distDir: string }): Promise<PublishSiteResult>;
  deployLaunch(input: { policy: LaunchPolicy; projectDir: string; chainId: number; launchId: string; launchNumber: number; kind: LaunchKind; payer: Address | null; economics: Record<string, unknown>; scriptEnv?: Record<string, string> }): Promise<DeployResult>;
  /** Host-header site serving (null = this services object does not serve sites; the api falls back to sites-host) */
  serveSite?(label: string, reqPath: string, opts: { method: string; ifNoneMatch?: string }): Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
  attestOracle(input: AttestInput): Promise<{ signature: Hex; signer: Address }>;
  status(): { verifier: ServiceStatus; publisher: ServiceStatus; deployer: ServiceStatus; attester: ServiceStatus };
}
export interface ServiceStatus { up: boolean; version: string; keyPrefix: string | null; mode: string }

// --------------------------------------------------------------------------------------------- helpers

export async function walk(root: string): Promise<{ path: string; abs: string }[]> {
  const out: { path: string; abs: string }[] = [];
  async function rec(dir: string) {
    let entries: string[] = [];
    try { entries = await readdir(dir); } catch { return; }
    for (const name of entries.sort()) {
      if (name === ".git" || name === "node_modules") continue;
      const abs = path.join(dir, name);
      const st = await stat(abs);
      if (st.isDirectory()) await rec(abs);
      else if (st.isFile()) out.push({ path: path.relative(root, abs).split(path.sep).join("/"), abs });
    }
  }
  await rec(root);
  return out;
}

export async function treeHash(root: string): Promise<string> {
  const files = await walk(root);
  const table: [string, string][] = [];
  for (const f of files) table.push([f.path, createHash("sha256").update(await readFile(f.abs)).digest("hex")]);
  return createHash("sha256").update(canonicalJson(table)).digest("hex");
}

/** `src` matches src/**, `src/**` too, `**` everything, exact paths themselves. */
export function pathAllowed(p: string, allowed: string[]): boolean {
  return allowed.some((a) => {
    if (a === "**" || a === "*") return true;
    const base = a.replace(/\/\*\*$/, "").replace(/\/$/, "");
    return p === base || p.startsWith(`${base}/`);
  });
}

// --------------------------------------------------------------------------------------------- mock

export class MockServices implements Services {
  readonly name = "mock";
  private readonly store: BlobStore;
  private readonly sitesDomain: string;
  private readonly githubOrg: string;
  private readonly attester: ReturnType<typeof privateKeyToAccount>;
  readonly ephemeralAttester: boolean;
  failDeploy = false;
  failVerify: ((i: VerifyInput) => string | null) | null = null;

  constructor(opts: { store: BlobStore; sitesDomain: string; githubOrg?: string; attesterKey?: Hex | null }) {
    this.store = opts.store;
    this.sitesDomain = opts.sitesDomain;
    this.githubOrg = opts.githubOrg ?? "comdfun";
    this.ephemeralAttester = !opts.attesterKey;
    this.attester = privateKeyToAccount(opts.attesterKey ?? generatePrivateKey());
  }

  async verify(i: VerifyInput): Promise<VerifyResult> {
    const failed: string[] = [];
    const details: string[] = [];
    const outside = i.changed.filter((p) => !pathAllowed(p, i.allowedPaths));
    if (outside.length) { failed.push("paths"); details.push(`outside allowed paths: ${outside.slice(0, 5).join(", ")}`); }
    if (["review", "audit", "judge"].includes(i.kind) && i.changed.some((p) => !p.startsWith("artifacts/"))) { failed.push("no-writes"); details.push("reviews write nothing outside artifacts/"); }
    const present = new Set((await walk(i.workspaceDir)).map((f) => f.path));
    const missing = i.outputs.filter((o) => !present.has(o.path)).map((o) => o.path);
    if (missing.length) { failed.push("outputs"); details.push(`missing outputs: ${missing.join(", ")}`); }
    const extra = this.failVerify?.(i);
    if (extra) { failed.push("custom"); details.push(extra); }
    return {
      ok: failed.length === 0,
      profile: "mock",
      evaluation: "structural",
      detail: failed.length ? details.join("; ") : "paths and outputs verified; no suite was run (mock Clerk)",
      failedChecks: failed,
      treeHash: (await treeHash(i.workspaceDir)).slice(0, 40),
      version: "mock-0.1.0",
    };
  }

  async publishRepo(i: { jobId: string; title: string; dir: string; baseRepo?: { repoUrl: string; commit: string } | null }): Promise<PublishRepoResult> {
    const commit = (await treeHash(i.dir)).slice(0, 40);
    if (i.baseRepo) return { repoUrl: i.baseRepo.repoUrl, commit, pullRequestUrl: `${i.baseRepo.repoUrl}/pull/1`, branch: `company/${i.jobId.slice(0, 8)}` };
    const slug = `${i.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "matter"}-${i.jobId.slice(0, 8)}`;
    return { repoUrl: `https://github.com/${this.githubOrg}/${slug}`, commit, pullRequestUrl: null, branch: "main" };
  }

  async publishSite(i: { label: string; distDir: string }): Promise<PublishSiteResult> {
    const files = await walk(i.distDir);
    const loaded = await Promise.all(files.map(async (f) => ({ path: f.path, data: await readFile(f.abs) })));
    const r = await publishSiteFiles(this.store, i.label, loaded, this.sitesDomain);
    return { label: r.label, url: r.url, version: r.version, files: r.files, bytes: r.bytes };
  }

  async deployLaunch(i: { policy: LaunchPolicy; projectDir: string; chainId: number; launchId: string; launchNumber: number; kind: LaunchKind }): Promise<DeployResult> {
    if (this.failDeploy) throw new Error("mock deployer: forced failure");
    const at = (name: string) => getAddress(`0x${keccak256(toHex(`${i.launchId}:${name}`)).slice(26)}`);
    const tx = keccak256(toHex(`${i.launchId}:deploy`));
    const names: [DeployedArtifact["role"], string][] = i.kind === "evm_contracts"
      ? [["other", "Contracts"]]
      : i.kind === "univ4_hook"
        ? [["token", "LaunchToken"], ["hook", "LaunchHook"], ["distributor", "ContributorDistributor"]]
        : [["token", "LaunchToken"], ["distributor", "ContributorDistributor"], ["hook", "PoolInitializationGuard"]];
    const artifacts = names.map(([role, name]) => ({ role, name, address: at(name), txHash: tx, blockNumber: 1_000_000 + i.launchNumber }));
    const token = artifacts.find((a) => a.role === "token")?.address ?? null;
    const poolId = token ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint24" }], [token, 3000])) : null;
    return { artifacts, transactions: [{ txHash: tx, label: "ProjectFactory.deploy", gasUsed: "4200000" }], token, poolId };
  }

  async attestOracle(i: AttestInput) {
    const signature = await this.attester.signTypedData(i.typedData as any);
    return { signature, signer: this.attester.address };
  }

  status() {
    const s = (mode: string, keyPrefix: string | null = null): ServiceStatus => ({ up: true, version: "mock-0.1.0", keyPrefix, mode });
    return { verifier: s("mock"), publisher: s("mock"), deployer: s("mock"), attester: s(this.ephemeralAttester ? "ephemeral-key" : "key", this.attester.address.slice(0, 10)) };
  }
}

/**
 * The real `@company/services`. Falls back to MockServices only when the package cannot be imported (and says so
 * in /services and /health); SERVICES_MODE=mock forces the mock.
 */
export async function loadServices(opts: { store: BlobStore; sitesDomain: string; githubOrg: string; attesterKey: Hex | null; env: Record<string, string | undefined>; skillsDir?: string | null; projectFactory?: Address | null; forgeBin?: string | null }): Promise<Services> {
  const mock = new MockServices(opts);
  if (opts.env.SERVICES_MODE === "mock") return mock;
  let mod: typeof import("@company/services");
  try { mod = await import("@company/services"); } catch (e) {
    console.warn(`[services] @company/services unavailable, using the mock: ${(e as Error).message}`);
    return mock;
  }
  const env = opts.env;
  const skillsDir = opts.skillsDir ?? env.SKILLS_DIR ?? undefined;
  const version = "company-services";
  let deployerKey: string | undefined = env.DEPLOYER_PRIVATE_KEY;
  if (deployerKey && !deployerKey.startsWith("0x")) deployerKey = `0x${deployerKey}`;
  const deployer = deployerKey && /^0x[0-9a-fA-F]{64}$/.test(deployerKey) ? privateKeyToAccount(deployerKey as Hex).address : null;
  return {
    name: "company-services",
    async verify(i) {
      let r: Awaited<ReturnType<typeof mod.verifySubmission>>;
      try {
        r = await mod.verifySubmission({
          workspaceDir: i.workspaceDir, baseDir: i.baseDir, allowedPaths: i.allowedPaths.filter((p) => p !== "**"), skill: i.skill, outputs: i.outputs as any,
          minCitations: i.minCitations, rubricContains: i.rubricContains, skillsDir, forgeBin: opts.forgeBin ?? undefined,
        });
      } catch (e) {
        // a skill the Clerk's catalog does not know: structural check only, and say so
        if (/unknown skill|index\.json|ENOENT|reference skill/i.test((e as Error).message)) return { ...(await mock.verify(i)), profile: "structural-fallback" };
        throw e;
      }
      const checks = r.checks;
      const failed = checks.filter((c) => c.status === "fail" || c.status === "error");
      const reran = checks.some((c) => c.status === "pass" && /^(foundry-(build|test|script)|project-build|web-build|npm-check)$/.test(c.id));
      return {
        ok: Boolean(r.ok),
        profile: String(r.skill ?? i.skill),
        evaluation: reran ? "rerun" : "structural",
        detail: failed.length ? failed.map((c) => `${c.id}: ${c.detail}`).join("; ").slice(0, 1000) : `${checks.filter((c) => c.status === "pass").length} check(s) passed: ${checks.map((c) => c.id).join(", ")}`,
        failedChecks: failed.map((c) => c.id),
        treeHash: (await treeHash(i.workspaceDir)).slice(0, 40),
        version,
      };
    },
    async publishRepo(i) {
      const base = i.baseRepo?.repoUrl;
      const r = await mod.publishRepo({ jobId: i.jobId, title: i.title, dir: i.dir, baseRepo: base, org: opts.githubOrg, store: opts.store as any, env });
      return { repoUrl: String(r.repoUrl), commit: String(r.commit), pullRequestUrl: r.pullRequestUrl ?? null, branch: r.branch ?? null };
    },
    async publishSite(i) {
      const r = await mod.publishSite({ label: i.label, distDir: i.distDir, store: opts.store as any, sitesDomain: opts.sitesDomain });
      return { label: r.label, url: r.url, version: r.version, files: Number(r.files ?? 0), bytes: Number(r.bytes ?? 0) };
    },
    async serveSite(label, reqPath, o) {
      return mod.serveSite(opts.store as any, label, reqPath, { method: o.method, ifNoneMatch: o.ifNoneMatch });
    },
    async deployLaunch(i) {
      const rpcUrl = env[`RPC_URL_${i.chainId}`] ?? (Number(env.CHAIN_ID ?? 4663) === i.chainId ? env.RPC_URL : undefined);
      const factory = opts.projectFactory ?? env.PROJECT_FACTORY;
      const live = !!(deployerKey && rpcUrl && factory);
      const r = await mod.deployLaunch({
        policy: i.policy as any, projectDir: i.projectDir, chainId: i.chainId, rpcUrl, privateKey: deployerKey, factoryAddress: factory ?? undefined,
        dryRun: !live, forgeBin: opts.forgeBin ?? undefined, scriptEnv: i.scriptEnv,
      });
      if (r.mode !== "broadcast") throw new Error(live ? `the Registrar did not broadcast (${r.mode}): ${r.notes.join("; ")}` : `the Registrar is not configured for chain ${i.chainId} (needs DEPLOYER_PRIVATE_KEY, RPC_URL${i.chainId === Number(env.CHAIN_ID) ? "" : `_${i.chainId}`}, PROJECT_FACTORY); ${r.mode} only`);
      const role = (name: string): DeployedArtifact["role"] => (/token/i.test(name) ? "token" : /hook|guard/i.test(name) ? "hook" : /distributor/i.test(name) ? "distributor" : /pool/i.test(name) ? "pool" : "other");
      const txs = r.transactions;
      const artifacts: DeployedArtifact[] = Object.entries(r.addresses ?? {})
        .filter(([name]) => name !== "factory")
        .map(([name, address]) => {
          const tx = txs.find((t) => t.contractAddress?.toLowerCase() === address.toLowerCase());
          return { role: role(name), name, address: getAddress(address), txHash: (tx?.hash ?? `0x${"0".repeat(64)}`) as Hex, blockNumber: 0 };
        });
      const seen = new Set<string>();
      const transactions = txs.filter((t) => t.hash && !seen.has(t.hash) && seen.add(t.hash)).map((t) => ({ txHash: t.hash as Hex, label: t.function ?? t.contractName ?? t.type ?? "tx", gasUsed: t.gasUsed ?? undefined }));
      return { artifacts, transactions, token: null, poolId: null, mode: r.mode, gasUsed: r.gasUsed, costWei: r.costWei, notes: r.notes };
    },
    attestOracle: (i) => mock.attestOracle(i),
    status() {
      const s = mock.status();
      const up = (mode: string): ServiceStatus => ({ up: true, version, keyPrefix: null, mode });
      return {
        verifier: up("company-services"),
        publisher: { ...up(env.GITHUB_TOKEN ? "company-services:github" : "company-services:dry-run"), keyPrefix: env.GITHUB_TOKEN ? opts.githubOrg : null },
        deployer: { ...up(deployer && opts.projectFactory ? "company-services:forge" : "company-services:unconfigured"), keyPrefix: deployer ? deployer.slice(0, 10) : null },
        attester: s.attester,
      };
    },
  };
}
