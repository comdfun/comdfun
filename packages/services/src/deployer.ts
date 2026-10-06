/**
 * Registrar (deployer): runs a project's launch script with `forge script`, under a launch policy.
 *
 * Addresses in results are lowercase hex (no EIP-55 checksum), like every hash the API returns.
 *
 * Launch script convention (documented in skills/evm-project-launch/SKILL.md):
 *   - `launch.json` at the project root (schema company.launch.v1) names the script, e.g.
 *     "script/Launch.s.sol:Launch".
 *   - The script reads DEPLOYER_PRIVATE_KEY, PROJECT_FACTORY, LAUNCH_MANIFEST, CHAIN_ID from env,
 *     calls vm.startBroadcast(pk), and returns the addresses it deployed as named return values.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { findBinary, makeSandboxCopy, runSandboxed, type RunResult } from "./sandbox.ts";

export const LAUNCH_KINDS = ["custom_token", "evm_project", "univ4_hook", "evm_contracts"] as const;
export type LaunchKind = (typeof LAUNCH_KINDS)[number];

export interface LaunchPolicyParams {
  chainId: number;
  feeTiers?: number[];
  rewardRule?: string;
  totalSupply?: string;
  treasuryBps?: number;
  liquidityBps?: number;
  contributorPoolBps?: number;
  recentContributorBps?: number;
  recentContributorWindowSeconds?: number;
  contributorLockSeconds?: number;
  perWalletCapBps?: number;
  poolFloorBps?: number;
  /** max total gas cost (wei) the Registrar may spend on one launch */
  gasCeilingWei: string;
  /** "eth" / "0x000…0" / token addresses or symbols ("comd") */
  pairedCurrencyAllowlist?: string[];
  owners?: Partial<Record<"token" | "project" | "treasury" | "hookAdmin" | "lpPosition", string>>;
  [k: string]: unknown;
}

export interface LaunchPolicy {
  version: number;
  kind?: LaunchKind;
  note?: string;
  params: LaunchPolicyParams;
}

export interface LaunchManifest {
  schema: "company.launch.v1";
  kind: LaunchKind;
  chainId: number;
  /** forge script target "path:Contract" */
  script: string;
  contracts?: { name: string; path?: string; args?: (string | number | boolean)[] }[];
  token?: { name: string; symbol: string; totalSupply?: string };
  pool?: { pairWith?: string; feeTier?: number; hook?: string; initialMarketCapWei?: string };
  economics?: { poolBps: number; initialMarketCapWei?: string; remainderTo?: string };
  owner?: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Validate a launch.json against the schema and (optionally) a policy. Returns problems (empty = ok). */
export function validateLaunchManifest(m: unknown, policy?: LaunchPolicy): string[] {
  const errs: string[] = [];
  if (!m || typeof m !== "object") return ["launch.json must be an object"];
  const x = m as Record<string, any>;
  if (x.schema !== "company.launch.v1") errs.push('schema must be "company.launch.v1"');
  if (!LAUNCH_KINDS.includes(x.kind)) errs.push(`kind must be one of ${LAUNCH_KINDS.join(", ")}`);
  if (!Number.isInteger(x.chainId) || x.chainId <= 0) errs.push("chainId must be a positive integer");
  if (typeof x.script !== "string" || !/^script\/[A-Za-z0-9_./-]+\.s\.sol:[A-Za-z_][A-Za-z0-9_]*$/.test(x.script)) {
    errs.push('script must look like "script/Launch.s.sol:Launch"');
  } else if (x.script.includes("..")) errs.push("script path may not contain ..");
  if (x.contracts !== undefined) {
    if (!Array.isArray(x.contracts)) errs.push("contracts must be an array");
    else {
      for (const [i, c] of x.contracts.entries()) {
        if (!c || typeof c.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)) errs.push(`contracts[${i}].name invalid`);
        for (const a of c?.args ?? []) {
          if (typeof a === "string" && a.startsWith("$") && a !== "$owner" && !/^\$contract:[A-Za-z_][A-Za-z0-9_]*$/.test(a)) {
            errs.push(`contracts[${i}] arg ${a}: only $owner and $contract:Name placeholders are allowed`);
          }
        }
      }
    }
  }
  if (x.kind === "evm_contracts") {
    const n = Array.isArray(x.contracts) ? x.contracts.length : 0;
    if (n < 1 || n > 8) errs.push("evm_contracts launches deploy 1-8 contracts");
    if (x.token || x.economics) errs.push("evm_contracts launches have no token or economics");
  } else if (LAUNCH_KINDS.includes(x.kind)) {
    if (!x.token || typeof x.token.name !== "string" || typeof x.token.symbol !== "string") errs.push(`${x.kind} launches need token {name, symbol}`);
  }
  if (x.kind === "custom_token") {
    const e = x.economics;
    if (!e) errs.push("custom_token launches need economics {poolBps, initialMarketCapWei, remainderTo}");
    else {
      if (!Number.isInteger(e.poolBps) || e.poolBps < 1000 || e.poolBps > 9000) errs.push("economics.poolBps must be 1000-9000 (10-90% of supply)");
      if (typeof e.initialMarketCapWei !== "string" || !/^\d+$/.test(e.initialMarketCapWei)) errs.push("economics.initialMarketCapWei must be a decimal string");
      if (typeof e.remainderTo !== "string" || !ADDRESS_RE.test(e.remainderTo)) errs.push("economics.remainderTo must be an address");
    }
  }
  if (x.owner !== undefined && (typeof x.owner !== "string" || !ADDRESS_RE.test(x.owner))) errs.push("owner must be an address");

  if (policy) {
    const p = policy.params;
    if (policy.kind && x.kind !== policy.kind) errs.push(`policy v${policy.version} is for ${policy.kind}, manifest is ${x.kind}`);
    if (p.chainId !== x.chainId) errs.push(`policy chainId ${p.chainId} != manifest chainId ${x.chainId}`);
    if (x.pool?.feeTier !== undefined && p.feeTiers && !p.feeTiers.includes(x.pool.feeTier)) errs.push(`feeTier ${x.pool.feeTier} not in policy ${p.feeTiers.join(",")}`);
    if (x.pool?.pairWith && p.pairedCurrencyAllowlist) {
      const allow = p.pairedCurrencyAllowlist.map((a) => a.toLowerCase());
      const pw = String(x.pool.pairWith).toLowerCase();
      const ethAliases = ["eth", "0x0000000000000000000000000000000000000000"];
      if (!allow.includes(pw) && !(ethAliases.includes(pw) && allow.some((a) => ethAliases.includes(a)))) errs.push(`pairWith ${x.pool.pairWith} not allowed by policy`);
    }
    if (x.economics?.poolBps !== undefined && p.poolFloorBps !== undefined && x.economics.poolBps < p.poolFloorBps) errs.push(`poolBps below policy floor ${p.poolFloorBps}`);
    if (typeof p.gasCeilingWei !== "string" || !/^\d+$/.test(p.gasCeilingWei)) errs.push("policy gasCeilingWei must be a decimal string");
  }
  return errs;
}

export interface DeployLaunchInput {
  policy: LaunchPolicy;
  projectDir: string;
  chainId: number;
  rpcUrl?: string;
  privateKey?: string;
  factoryAddress?: string;
  dryRun?: boolean;
  forgeBin?: string;
  /** gas price used for the ceiling estimate; default eth_gasPrice from rpcUrl */
  gasPriceWei?: bigint;
  timeoutMs?: number;
  /** extra env for the script (e.g. LAUNCH_OWNER) — never secrets other than the deployer key */
  scriptEnv?: Record<string, string>;
}

export interface DeployedTx {
  hash: string | null;
  type: string;
  contractName: string | null;
  contractAddress: string | null;
  function: string | null;
  gasUsed: string | null;
}

export interface DeployLaunchResult {
  mode: "plan" | "dry-run" | "broadcast";
  kind: LaunchKind;
  chainId: number;
  policyVersion: number;
  script: string;
  addresses: Record<string, string>;
  transactions: DeployedTx[];
  /** decimal string */
  gasUsed: string;
  /** decimal string, when a gas price is known */
  costWei: string | null;
  gasCeilingWei: string;
  withinCeiling: boolean | null;
  command: string;
  notes: string[];
}

export class LaunchRefusedError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`launch refused: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

/** Well-known first anvil key; only ever used for keyless in-memory simulation. */
const SIMULATION_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function lastJsonLine(stdout: string): any | null {
  const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function redact(cmd: string, secrets: (string | undefined)[]): string {
  let out = cmd;
  for (const s of secrets) if (s) out = out.split(s).join("<redacted>");
  return out;
}

/** Extract named addresses (from `returns`) and created contracts (from traces) of `forge script --json`. */
export function parseScriptJson(json: any): { addresses: Record<string, string>; created: DeployedTx[]; gasUsed: bigint } {
  const addresses: Record<string, string> = {};
  for (const [name, v] of Object.entries<any>(json?.returns ?? {})) {
    if (v?.internal_type === "address" && typeof v.value === "string") addresses[name] = v.value.toLowerCase();
  }
  const created: DeployedTx[] = [];
  for (const [phase, t] of json?.traces ?? []) {
    if (phase !== "Execution") continue;
    for (const node of t?.arena ?? []) {
      const tr = node.trace;
      if (!tr || tr.depth !== 1 || (tr.kind !== "CREATE" && tr.kind !== "CREATE2") || !tr.success) continue;
      created.push({ hash: null, type: tr.kind, contractName: tr.decoded?.label ?? null, contractAddress: String(tr.address).toLowerCase(), function: null, gasUsed: String(tr.gas_used ?? "") || null });
    }
  }
  return { addresses, created, gasUsed: BigInt(json?.gas_used ?? 0) };
}

/** Parse forge's broadcast/<script>/<chainId>/run-latest.json (or dry-run/run-latest.json). */
export function parseBroadcast(json: any): { addresses: Record<string, string>; transactions: DeployedTx[]; gasUsed: bigint; costWei: bigint; estimatedGas: bigint } {
  const receipts = new Map<string, any>();
  for (const r of json?.receipts ?? []) if (r?.transactionHash) receipts.set(String(r.transactionHash).toLowerCase(), r);
  const addresses: Record<string, string> = {};
  const transactions: DeployedTx[] = [];
  let gasUsed = 0n;
  let cost = 0n;
  let estimated = 0n;
  const counts: Record<string, number> = {};
  for (const tx of json?.transactions ?? []) {
    const r = tx.hash ? receipts.get(String(tx.hash).toLowerCase()) : undefined;
    const used = r?.gasUsed !== undefined ? BigInt(r.gasUsed) : null;
    if (used !== null) {
      gasUsed += used;
      if (r.effectiveGasPrice !== undefined) cost += used * BigInt(r.effectiveGasPrice);
    }
    if (tx.transaction?.gas !== undefined) estimated += BigInt(tx.transaction.gas);
    const rawAddr = tx.contractAddress ?? r?.contractAddress ?? null;
    const addr = rawAddr ? String(rawAddr).toLowerCase() : null;
    if (addr && tx.contractName && (tx.transactionType === "CREATE" || tx.transactionType === "CREATE2")) {
      const n = (counts[tx.contractName] = (counts[tx.contractName] ?? 0) + 1);
      addresses[n === 1 ? tx.contractName : `${tx.contractName}_${n}`] = addr;
    }
    transactions.push({
      hash: tx.hash ?? null,
      type: tx.transactionType ?? "CALL",
      contractName: tx.contractName ?? null,
      contractAddress: addr,
      function: tx.function ?? null,
      gasUsed: used === null ? null : used.toString(),
    });
    for (const extra of tx.additionalContracts ?? []) {
      transactions.push({ hash: tx.hash ?? null, type: extra.transactionType ?? "CREATE2", contractName: null, contractAddress: String(extra.address).toLowerCase(), function: null, gasUsed: null });
    }
  }
  return { addresses, transactions, gasUsed, costWei: cost, estimatedGas: estimated };
}

async function rpcGasPrice(rpcUrl: string): Promise<bigint> {
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }) });
  const j: any = await res.json();
  if (!j?.result) throw new Error(`eth_gasPrice failed: ${JSON.stringify(j?.error ?? j)}`);
  return BigInt(j.result);
}

async function readBroadcastFile(dir: string, script: string, chainId: number, dry: boolean): Promise<any | null> {
  const file = path.basename(script.split(":")[0]);
  const p = path.join(dir, "broadcast", file, String(chainId), ...(dry ? ["dry-run"] : []), "run-latest.json");
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Deploy (or simulate) a launch.
 *  - dryRun without rpcUrl: compile + run the script in forge's in-memory EVM; returns simulated
 *    gas and created contracts. Without forge: returns a plan only.
 *  - dryRun with rpcUrl: on-chain simulation (no --broadcast), gas estimated against the ceiling.
 *  - live: simulate, check ceiling, then --broadcast; parse broadcast JSON.
 */
export async function deployLaunch(input: DeployLaunchInput): Promise<DeployLaunchResult> {
  const { policy, chainId } = input;
  const notes: string[] = [];
  let manifest: LaunchManifest;
  try {
    manifest = JSON.parse(await readFile(path.join(input.projectDir, "launch.json"), "utf8"));
  } catch (e: any) {
    throw new LaunchRefusedError([`launch.json unreadable: ${e.message}`]);
  }
  const problems = validateLaunchManifest(manifest, policy);
  if (manifest.chainId !== chainId) problems.push(`requested chainId ${chainId} != manifest chainId ${manifest.chainId}`);
  if (!input.dryRun) {
    if (!input.rpcUrl) problems.push("rpcUrl is required for a live deployment");
    if (!input.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(input.privateKey)) problems.push("a 32-byte hex privateKey is required for a live deployment");
    if (!input.factoryAddress || !ADDRESS_RE.test(input.factoryAddress)) problems.push("factoryAddress is required for a live deployment");
  }
  if (problems.length) throw new LaunchRefusedError(problems);

  const ceiling = BigInt(policy.params.gasCeilingWei);
  const scriptRel = manifest.script.split(":")[0];
  const base: DeployLaunchResult = {
    mode: "plan",
    kind: manifest.kind,
    chainId,
    policyVersion: policy.version,
    script: manifest.script,
    addresses: {},
    transactions: [],
    gasUsed: "0",
    costWei: null,
    gasCeilingWei: ceiling.toString(),
    withinCeiling: null,
    command: "",
    notes,
  };
  const forge = await findBinary("forge", { explicit: input.forgeBin, envVar: "FORGE_BIN" });
  const args = ["script", manifest.script, "--json"];
  if (input.rpcUrl) args.push("--rpc-url", input.rpcUrl);
  base.command = redact(`forge ${args.join(" ")}${input.dryRun ? "" : " --broadcast --slow"}`, [input.rpcUrl && new URL(input.rpcUrl).password ? input.rpcUrl : undefined]);
  if (!forge) {
    notes.push("forge not found (set FORGE_BIN); returning a plan without simulation");
    return base;
  }
  try {
    await readdir(path.join(input.projectDir, path.dirname(scriptRel)));
  } catch {
    throw new LaunchRefusedError([`script ${scriptRel} not found`]);
  }

  const { dir, cleanup } = await makeSandboxCopy(input.projectDir, [".git", "node_modules", "broadcast"]);
  try {
    const env: Record<string, string> = {
      ...(input.scriptEnv ?? {}),
      DEPLOYER_PRIVATE_KEY: input.privateKey ?? SIMULATION_KEY,
      PROJECT_FACTORY: input.factoryAddress ?? "0x0000000000000000000000000000000000000000",
      LAUNCH_MANIFEST: path.join(dir, "launch.json"),
      CHAIN_ID: String(chainId),
    };
    const timeoutMs = input.timeoutMs ?? 600_000;
    const network = Boolean(input.rpcUrl);
    const run = (extra: string[]): Promise<RunResult> => runSandboxed(forge, [...args, ...extra], { cwd: dir, env, timeoutMs, network });
    const fail = (r: RunResult, what: string) => {
      const msg = redact(`${what} failed (exit ${r.code}${r.timedOut ? ", timed out" : ""}): ${(r.stderr || r.stdout).slice(-2000)}`, [input.privateKey]);
      return new Error(msg);
    };

    // 1. simulate
    const sim = await run([]);
    if (sim.code !== 0) throw fail(sim, "forge script simulation");
    const simJson = lastJsonLine(sim.stdout);
    const parsed = parseScriptJson(simJson);
    let estimatedGas = parsed.gasUsed;
    let created = parsed.created;
    if (input.rpcUrl) {
      const dry = await readBroadcastFile(dir, manifest.script, chainId, true);
      if (dry) {
        const pb = parseBroadcast(dry);
        if (pb.estimatedGas > 0n) estimatedGas = pb.estimatedGas;
        if (pb.transactions.length) created = pb.transactions;
      }
    }
    let gasPrice = input.gasPriceWei ?? null;
    if (gasPrice === null && input.rpcUrl) gasPrice = await rpcGasPrice(input.rpcUrl);
    const estCost = gasPrice === null ? null : estimatedGas * gasPrice;
    const within = estCost === null ? null : estCost <= ceiling;
    const simResult: DeployLaunchResult = {
      ...base,
      mode: "dry-run",
      addresses: { ...Object.fromEntries(created.filter((c) => c.contractName && c.contractAddress).map((c) => [c.contractName!, c.contractAddress!])), ...parsed.addresses },
      transactions: created,
      gasUsed: estimatedGas.toString(),
      costWei: estCost === null ? null : estCost.toString(),
      withinCeiling: within,
    };
    if (!input.rpcUrl) notes.push("simulated in forge's in-memory EVM (no RPC); addresses are simulation addresses, not chain addresses");
    if (gasPrice === null) notes.push("no gas price known; ceiling not evaluated (pass gasPriceWei or rpcUrl)");
    if (input.dryRun) return simResult;

    // 2. ceiling gate
    if (within === false) throw new LaunchRefusedError([`estimated cost ${estCost} wei exceeds gasCeilingWei ${ceiling}`]);

    // 3. broadcast
    const extra = ["--broadcast", "--slow"];
    if (gasPrice !== null) extra.push("--with-gas-price", gasPrice.toString());
    const live = await run(extra);
    const bjson = await readBroadcastFile(dir, manifest.script, chainId, false);
    if (live.code !== 0 && !bjson) throw fail(live, "forge script broadcast");
    if (!bjson) throw new Error("broadcast finished but broadcast/run-latest.json is missing");
    const pb = parseBroadcast(bjson);
    const named = parseScriptJson(lastJsonLine(live.stdout)).addresses;
    if (live.code !== 0) notes.push(`forge exited ${live.code} after broadcasting ${pb.transactions.length} transaction(s); inspect before retrying`);
    if (pb.costWei > ceiling) notes.push(`actual cost ${pb.costWei} wei exceeded the ceiling ${ceiling}; trip the breaker`);
    return {
      ...base,
      mode: "broadcast",
      addresses: { ...pb.addresses, ...named },
      transactions: pb.transactions,
      gasUsed: pb.gasUsed.toString(),
      costWei: pb.costWei.toString(),
      withinCeiling: pb.costWei <= ceiling,
    };
  } finally {
    await cleanup();
  }
}
