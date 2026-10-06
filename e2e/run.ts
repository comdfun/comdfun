/**
 * Company.md — end-to-end on a local chain (V5 contracts).
 *
 *   cd e2e && npm run e2e          (node --import tsx run.ts)
 *
 * Nothing is mocked between the HTTP API and the chain:
 *   1. anvil --chain-id 46630 (port 8545); Permit2 (built from github.com/Uniswap/permit2 with solc 0.8.17) placed at
 *      the canonical 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *   2. contracts/script/Deploy.s.sol (test-chain path: a local v4 PoolManager + MockMarketplace) and SeedPool.s.sol
 *      (100% of the COMD supply single-sided into the official COMD/ETH pool of ComdTaxHook)
 *   3. apps/api (built dist, plain node, port 8789) with the real @company/services (Clerk re-runs Foundry in a
 *      sandbox, Records Office dry-run to the local BlobStore, Registrar = forge script broadcast) and the keeper on
 *   4. six free Counsel mints → six ERC-8004 agents → six `comd start --runtime mock` workers paired through the HTTP
 *      pairing flow (EIP-712 WorkerAuthorization, on-chain ownerOf); three advertise a top-tier model at high effort
 *   5. a customer buys COMD through ComdRouter (5% ETH tax → Flywheel), approves Permit2 once and pays in COMD with
 *      x402 + Permit2 (the web's signing code path) for research, an oracle ruling, a 2-run retainer, a launch and a
 *      continuation — settled on chain into the RevenueRouter
 *   6. verifies on chain: keeper flush / buyback-and-burn / RevenueRouter 80/20, a Counsel floor sweep through
 *      MockMarketplace, reputation feedback, the oracle attestation through OracleConsumerExample, seat COMD reward roots and claims, the launch
 *      token from ProjectFactory and a contributor's claim after the lock, and GET /flywheel against the chain
 * Prints a PASS/FAIL table; exit code 1 on any FAIL.
 *
 * Toolchain (env, else found on PATH / in ~/.svm): ANVIL_BIN, FORGE_BIN, CAST_BIN, SOLC_PATH (solc 0.8.26),
 * SOLC_0817_PATH (solc 0.8.17 for Permit2; downloaded into e2e/vendor/ when missing).
 * Other env: E2E_RPC_PORT (8545), E2E_API_PORT (8789), E2E_RUN_DIR (e2e/.run), E2E_KEEP=1 to leave anvil and the
 * processes running, E2E_TSX=1 to run the API from src with tsx instead of the built dist.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, erc20Abi, getAddress, http, keccak256, parseAbi, sha256, toBytes, toHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  comdRouterAbi, comdTaxHookAbi, contributorDistributorAbi, counselNFTAbi, flywheelAbi, identityRegistryAbi, launchTokenAbi, mockMarketplaceAbi,
  oracleConsumerExampleAbi, projectFactoryAbi, reputationRegistryAbi, revenueRouterAbi, rewardDistributorAbi,
} from "@company/abi";

// ============================================================================================ setup

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const RUN = process.env.E2E_RUN_DIR ? path.resolve(process.env.E2E_RUN_DIR) : path.join(HERE, ".run");

/** First existing file named `name` on PATH. */
function onPath(name: string): string | null {
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}
const svm = (v: string) => { const p = path.join(homedir(), ".svm", v, `solc-${v}`); return existsSync(p) ? p : null; };
export const ANVIL = process.env.ANVIL_BIN || onPath("anvil") || "anvil";
export const FORGE = process.env.FORGE_BIN || onPath("forge") || "forge";
export const CAST = process.env.CAST_BIN || onPath("cast") || "cast";
export const SOLC = process.env.SOLC_PATH || svm("0.8.26") || onPath("solc-0.8.26") || onPath("solc") || "";
const SOLC_0817 = process.env.SOLC_0817_PATH || svm("0.8.17") || path.join(HERE, "vendor", "solc-0.8.17");

export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const CHAIN_ID = 46630;
const MNEMONIC = "test test test test test test test test test test test junk";
export const acct = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
export const pk = (i: number) => toHex(acct(i).getHdKey().privateKey!);
export const ADMIN = acct(0); // deployer, admin/owner of everything, POL wallet
export const HOLDERS = [1, 2, 3, 4, 5, 6].map(acct);
export const CUSTOMER = acct(7);
export const REGISTRAR = acct(8); // DEPLOYER_PRIVATE_KEY of the api (ProjectFactory REGISTRAR_ROLE)
export const SETTLER = acct(9); // Permit2 spender, reputation batcher, RewardDistributor SETTLER_ROLE
export const ATTESTER = acct(10); // oracle attestations (signs only)
export const KEEPER = acct(11); // Flywheel.keeper(); the api keeper loop (KEEPER_PRIVATE_KEY)
export const SELLER = acct(13); // lists a Counsel on MockMarketplace for the floor sweep
export const TREASURY = acct(14); // firm treasury: 20% of job revenue
export const ADMIN_TOKEN = randomBytes(16).toString("hex");
const E18 = 10n ** 18n;
const fmt = (v: bigint, d = 18, p = 4) => { const s = Number(v) / 10 ** d; return s.toLocaleString("en-US", { maximumFractionDigits: p }); };

/** Seats: 1–3 premium (top-tier model at high effort), 4–6 standard. Mock work, real advertised runtime names. */
const SEAT_RUNTIMES = [
  { as: "claude", model: "claude-opus-5-5", effort: "high" },
  { as: "codex", model: "gpt-6-astra", effort: "high" },
  { as: "claude", model: "claude-opus-5-5", effort: "xhigh" },
  { as: "claude", model: "claude-sonnet-5-5", effort: "high" },
  { as: "codex", model: "gpt-6", effort: "medium" },
  { as: "claude", model: "claude-opus-5-5", effort: "low" },
];

export const results: { step: string; ok: boolean; detail: string }[] = [];
export const procs: ChildProcess[] = [];
export const t0 = Date.now();
export const log = (m: string) => console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
export function record(step: string, ok: boolean, detail = "") {
  results.push({ step, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${step}${detail ? ` — ${detail}` : ""}`);
}
export async function check(step: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    const d = await fn();
    record(step, true, d ?? "");
    return true;
  } catch (e) {
    record(step, false, ((e as Error).message ?? String(e)).split("\n").slice(0, 3).join(" ").slice(0, 400));
    return false;
  }
}
export function assert(c: unknown, msg: string): asserts c { if (!c) throw new Error(msg); }
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 300_000, everyMs = 1000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown = null;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last ? ` (${(last as Error).message})` : ""}`);
    await sleep(everyMs);
  }
}
export function run(cmd: string, args: string[], o: { cwd?: string; env?: Record<string, string | undefined>; logName?: string } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...o.env } as Record<string, string | undefined>;
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const p = spawn(cmd, args, { cwd: o.cwd, env: env as any, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const file = o.logName ? createWriteStream(path.join(RUN, "logs", o.logName)) : null;
    p.stdout.on("data", (d) => { out += d; file?.write(d); });
    p.stderr.on("data", (d) => { out += d; file?.write(d); });
    p.on("error", (e) => { out += String(e); });
    p.on("close", (code) => { file?.end(); resolve({ code: code ?? 1, out }); });
  });
}
export function background(name: string, cmd: string, args: string[], o: { cwd?: string; env?: Record<string, string | undefined>; onLine?: (l: string) => void } = {}): ChildProcess {
  const file = createWriteStream(path.join(RUN, "logs", `${name}.log`));
  const env = { ...process.env, ...o.env } as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const p = spawn(cmd, args, { cwd: o.cwd, env: env as any, stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  const onData = (d: Buffer) => {
    file.write(d);
    if (!o.onLine) return;
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { o.onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
  };
  p.stdout!.on("data", onData);
  p.stderr!.on("data", onData);
  procs.push(p);
  return p;
}
export function cleanup() {
  if (process.env.E2E_KEEP === "1") return;
  for (const p of procs) { try { p.kill("SIGTERM"); } catch { /* gone */ } }
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ============================================================================================ chain helpers

export let RPC = "";
export let pub: PublicClient;
export const chain = () => ({ id: CHAIN_ID, name: "anvil-46630", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }) as const;
export const wallet = (i: number) => createWalletClient({ account: acct(i), chain: chain(), transport: http(RPC) });
export async function rpc(method: string, params: unknown[] = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j: any = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
export async function send(i: number, address: Address, abi: any, functionName: string, args: unknown[] = [], value?: bigint) {
  const w = wallet(i);
  const { request, result } = await pub.simulateContract({ account: acct(i), address, abi, functionName, args, value } as any);
  const hash = await w.writeContract(request as any);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return Object.assign(rc, { result: result as any });
}
export const read = <T = any>(address: Address, abi: any, functionName: string, args: unknown[] = []) => pub.readContract({ address, abi, functionName, args } as any) as Promise<T>;
export const ethOf = (a: Address) => pub.getBalance({ address: a });
export const comdOf = (a: Address) => read<bigint>(D.comdToken, erc20Abi, "balanceOf", [a]);
const chainNow = async () => Number((await pub.getBlock({ blockTag: "latest" })).timestamp);
const transferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
/** Sum of ERC-20 Transfer(_, to, v) of `token` in a set of logs. */
export function transfersTo(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[], token: Address, to: string, from?: string): bigint {
  let sum = 0n;
  for (const l of logs) {
    if (getAddress(l.address) !== getAddress(token)) continue;
    try {
      const ev: any = decodeEventLog({ abi: transferEvent, data: l.data, topics: l.topics as any });
      if (getAddress(ev.args.to) === getAddress(to) && (!from || getAddress(ev.args.from) === getAddress(from))) sum += ev.args.value;
    } catch { /* other event */ }
  }
  return sum;
}
async function eventsOf(address: Address, abi: any, eventName: string): Promise<any[]> {
  return pub.getContractEvents({ address, abi, eventName, fromBlock: 0n, toBlock: "latest" } as any) as Promise<any[]>;
}
async function keeperTasks() {
  const svc = (await get("/services")).body.services.find((x: any) => x.kind === "keeper");
  return svc.keeper.tasks as Record<string, { runs: number; lastSkip: string | null; lastError: string | null; lastTx: Hex | null }>;
}

// ============================================================================================ API helpers

export let API = "";
export async function api(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API}${p}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json, text, headers: r.headers };
}
export const get = (p: string) => api("GET", p);
export const post = (p: string, b: unknown, h?: Record<string, string>) => api("POST", p, b, h);

/** Canonical JSON exactly as apps/web/lib/paid.ts: keys sorted at every depth, no whitespace. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/**
 * The paid flow, the way the web app does it (apps/web/lib/paid.ts): quote → 402 challenge (PAYMENT-REQUIRED) →
 * Permit2 PermitWitnessTransferFrom with witness {to, validAfter} naming accepts[0].extra.spender + EIP-712
 * QuoteApproval over paymentHash = sha256(canonical JSON) → submit → poll until admitted.
 */
export async function pay(action: string, input: unknown) {
  const token = randomBytes(32).toString("hex");
  const auth = { authorization: `Bearer ${token}` };
  const q = await post("/requests/quote", { requestKey: randomUUID(), action, input }, auth);
  if (q.status !== 200 && q.status !== 201) throw new Error(`quote ${action}: ${q.status} ${JSON.stringify(q.body).slice(0, 300)}`);
  const orderId = q.body.order.id as string;
  const c = await post(`/requests/${orderId}/submit`, undefined as any, auth);
  if (c.status !== 402) throw new Error(`expected 402, got ${c.status} ${c.text.slice(0, 200)}`);
  const ch = JSON.parse(Buffer.from(c.headers.get("payment-required")!, "base64").toString("utf8"));
  const req = ch.accepts[0];
  const chainId = Number(req.network.split(":")[1]);
  const spender = req.extra.spender as Address;
  assert(spender, "challenge has no accepts[0].extra.spender");
  const now = Math.floor(Date.now() / 1000);
  const deadline = Math.min(ch.quote.expiresAt - 10, now + (req.maxTimeoutSeconds || 600));
  const validAfter = now - 60;
  const nonce = BigInt(`0x${randomBytes(32).toString("hex")}`);
  const w = wallet(7);
  const signature = await w.signTypedData({
    account: CUSTOMER,
    domain: { name: "Permit2", chainId, verifyingContract: PERMIT2 },
    primaryType: "PermitWitnessTransferFrom",
    types: {
      PermitWitnessTransferFrom: [{ name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "witness", type: "Witness" }],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
      Witness: [{ name: "to", type: "address" }, { name: "validAfter", type: "uint256" }],
    },
    message: { permitted: { token: req.asset, amount: BigInt(req.amount) }, spender, nonce, deadline: BigInt(deadline), witness: { to: req.payTo, validAfter: BigInt(validAfter) } },
  });
  const payment = {
    x402Version: 2,
    resource: ch.resource ?? { url: ch.resourceUrl, description: `Company.md ${ch.quote.action}`, mimeType: "application/json" },
    accepted: req,
    payload: { signature, permit2Authorization: { from: CUSTOMER.address.toLowerCase(), permitted: { token: req.asset, amount: req.amount }, spender, nonce: nonce.toString(), deadline: String(deadline), witness: { to: req.payTo, validAfter: String(validAfter) } } },
    extensions: {},
  };
  const json = canonical(payment);
  const header = Buffer.from(json, "utf8").toString("base64");
  const paymentHash = sha256(toBytes(json));
  const pq = ch.quote;
  const quoteSignature = await w.signTypedData({
    account: CUSTOMER,
    domain: { name: "Company.md Paid Action", version: "1", chainId },
    primaryType: "QuoteApproval",
    types: { QuoteApproval: [{ name: "resource", type: "string" }, { name: "requesterScopeHash", type: "bytes32" }, { name: "quoteId", type: "string" }, { name: "quoteHash", type: "bytes32" }, { name: "paymentHash", type: "bytes32" }, { name: "action", type: "string" }, { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "payTo", type: "address" }, { name: "expiresAt", type: "uint256" }] },
    message: {
      resource: ch.resourceUrl, requesterScopeHash: `0x${ch.requesterScopeHash.replace(/^0x/, "")}`, quoteId: pq.id, quoteHash: `0x${pq.quoteHash.replace(/^0x/, "")}`, paymentHash,
      action: pq.action, asset: pq.payment.asset, amount: BigInt(pq.payment.amount), payTo: pq.payment.payTo, expiresAt: BigInt(pq.expiresAt),
    },
  });
  const s = await post(`/requests/${orderId}/submit`, { quoteSignature }, { ...auth, "payment-signature": header });
  if (s.status !== 200 && s.status !== 202) throw new Error(`submit ${action}: ${s.status} ${JSON.stringify(s.body).slice(0, 400)}`);
  const st = await until(`${action} admitted`, async () => {
    const r = await api("GET", `/requests/${orderId}`, undefined, auth);
    if (["payment_failed", "expired"].includes(r.body?.status)) throw new Error(`${action}: ${r.body.status} ${JSON.stringify(r.body.payment)}`);
    return r.body?.status === "admitted" ? r.body : null;
  }, 120_000, 500);
  return { orderId, amount: BigInt(req.amount), payTo: getAddress(req.payTo), spender, status: st, result: st.admission?.result, txHash: st.payment?.transactionHash as Hex };
}

// ============================================================================================ boot steps

export async function tools() {
  const found = (p: string) => (p && (path.isAbsolute(p) ? existsSync(p) : !!onPath(p)));
  for (const [n, p, env] of [["anvil", ANVIL, "ANVIL_BIN"], ["forge", FORGE, "FORGE_BIN"], ["solc 0.8.26", SOLC, "SOLC_PATH"]] as const) assert(found(p), `${n} not found (set ${env} or put it on PATH)`);
  if (!existsSync(SOLC_0817)) {
    log("solc 0.8.17 not found; downloading the static build from GitHub releases into e2e/vendor/");
    mkdirSync(path.dirname(SOLC_0817), { recursive: true });
    const r = await fetch("https://github.com/ethereum/solidity/releases/download/v0.8.17/solc-static-linux");
    assert(r.ok, `download solc 0.8.17: ${r.status} (or set SOLC_0817_PATH)`);
    writeFileSync(SOLC_0817, Buffer.from(await r.arrayBuffer()));
    chmodSync(SOLC_0817, 0o755);
  }
  const v = await run(FORGE, ["--version"]);
  assert(v.code === 0, `forge --version: ${v.out.slice(0, 200)}`);
  return `anvil, ${v.out.split("\n")[0].trim()}, solc 0.8.26 + 0.8.17`;
}

/** Permit2 from source (solc 0.8.17, via-IR as upstream), its runtime code placed at the canonical address. */
export async function permit2() {
  const dir = path.join(HERE, "vendor", "permit2");
  if (!existsSync(path.join(dir, "src", "Permit2.sol"))) {
    mkdirSync(path.dirname(dir), { recursive: true });
    const r = await run("git", ["clone", "--depth", "1", "https://github.com/Uniswap/permit2", dir]);
    assert(r.code === 0, `git clone permit2: ${r.out.slice(-300)}`);
  }
  const art = path.join(dir, "out", "Permit2.sol", "Permit2.json");
  if (!existsSync(art)) {
    const r = await run(FORGE, ["build", "--offline", "--use", SOLC_0817, "--skip", "test", "--skip", "script", "--remappings", `solmate/=${ROOT}/contracts/lib/v4-core/lib/solmate/`, "src/Permit2.sol"], { cwd: dir, logName: "permit2-build.log" });
    assert(r.code === 0 && existsSync(art), `forge build permit2: ${r.out.slice(-400)}`);
  }
  const j = JSON.parse(readFileSync(art, "utf8"));
  // EIP712 caches (chainId, domainSeparator) as immutables at construction; zero them so DOMAIN_SEPARATOR() is
  // rebuilt from block.chainid and address(this) = the canonical address (exactly what a real deployment yields).
  let code: string = j.deployedBytecode.object.replace(/^0x/, "");
  for (const refs of Object.values<any[]>(j.deployedBytecode.immutableReferences ?? {})) for (const r of refs) code = code.slice(0, r.start * 2) + "0".repeat(r.length * 2) + code.slice((r.start + r.length) * 2);
  await rpc("anvil_setCode", [PERMIT2, `0x${code}`]);
  const ds = await read<Hex>(PERMIT2, parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]), "DOMAIN_SEPARATOR");
  const want = keccak256(`0x${[keccak256(toHex("EIP712Domain(string name,uint256 chainId,address verifyingContract)")), keccak256(toHex("Permit2")), toHex(BigInt(CHAIN_ID), { size: 32 }), `0x${"0".repeat(24)}${PERMIT2.slice(2).toLowerCase()}`].map((x) => x.slice(2)).join("")}` as Hex);
  assert(ds === want, `Permit2 DOMAIN_SEPARATOR ${ds} != ${want}`);
  return `runtime ${code.length / 2} B at ${PERMIT2}, DOMAIN_SEPARATOR ok`;
}

export interface Deployment { [k: string]: any }
export let D: Deployment = {};
const forgeEnv = () => ({ FOUNDRY_PROFILE: "local", FOUNDRY_SOLC: SOLC, FOUNDRY_OFFLINE: "true", FOUNDRY_BROADCAST: path.join(RUN, "broadcast") });
const between = (out: string, a: string, b: string) => { const i = out.indexOf(a); const j = out.indexOf(b, i + 1); return i >= 0 && j > i ? out.slice(i + a.length, j).trim() : null; };

export async function deploy(apiUrl: string) {
  // the address book is read from stdout (WRITE_DEPLOYMENTS=false): a local-anvil deployments/<chainId>.json must
  // never land in the repo (packages/abi generates from contracts/deployments); restored defensively anyway
  const depFile = path.join(ROOT, "contracts", "deployments", `${CHAIN_ID}.json`);
  const backup = existsSync(depFile) ? readFileSync(depFile) : null;
  const env = {
    ...forgeEnv(), DEPLOYER_PRIVATE_KEY: pk(0), TREASURY: TREASURY.address, SETTLER: SETTLER.address, REGISTRAR: REGISTRAR.address, KEEPER: KEEPER.address,
    COUNSEL_BASE_URI: `${apiUrl}/agents/by-token/`, WRITE_DEPLOYMENTS: "false",
  };
  const r = await run(FORGE, ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC, "--broadcast", "--slow"], { cwd: path.join(ROOT, "contracts"), env, logName: "deploy.log" });
  try {
    assert(r.code === 0, `Deploy.s.sol failed: ${r.out.slice(-600)}`);
    const json = between(r.out, "DEPLOYMENTS_JSON_BEGIN", "DEPLOYMENTS_JSON_END");
    assert(json, "no DEPLOYMENTS_JSON_BEGIN/END block in the Deploy.s.sol output");
    D = JSON.parse(json);
    writeFileSync(path.join(RUN, `deployments-${CHAIN_ID}.json`), JSON.stringify(D, null, 2));
  } finally {
    if (backup) writeFileSync(depFile, backup); else rmSync(depFile, { force: true });
  }
  assert(D.deployedPoolManager === true, "test-chain path deploys a v4 PoolManager");
  for (const k of ["usdg", "mockUsdg", "buyWall", "stakedComd", "rewardDripper", "bond"]) assert(!(k in D), `${k} is gone from the address book`);
  const keys = ["comdToken", "counselNFT", "identityRegistry", "reputationRegistry", "rewardDistributor", "revenueRouter", "flywheel", "comdTaxHook", "comdRouter", "projectFactory", "contributorDistributor", "mockMarketplace"];
  for (const k of keys) {
    const code = await pub.getCode({ address: D[k] });
    assert(code && code.length > 2, `${k} has no code`);
  }
  assert(getAddress(await read(D.flywheel, flywheelAbi, "keeper")) === KEEPER.address, "Flywheel.keeper() = KEEPER");
  assert(await read<boolean>(D.flywheel, flywheelAbi, "adapterAllowed", [D.mockMarketplace]), "MockMarketplace allowlisted as a sweep adapter");
  const supply = await read<bigint>(D.comdToken, erc20Abi, "totalSupply");
  assert(supply === 10n ** 27n && (await comdOf(ADMIN.address)) === supply, "100% of the 1B COMD to the POL wallet");
  const [rb, tb] = await read<readonly number[]>(D.revenueRouter, revenueRouterAbi, "bps");
  assert(Number(rb) === 8000 && Number(tb) === 2000, `RevenueRouter bps ${rb}/${tb}`);
  return `${keys.length} contracts with code; 1B COMD to POL; RevenueRouter 80/20 → treasury ${TREASURY.address.slice(0, 10)}…; Flywheel keeper ${KEEPER.address.slice(0, 10)}…`;
}

export async function seedPool() {
  const env = { ...forgeEnv(), POL_PRIVATE_KEY: pk(0), HOOK: D.comdTaxHook, INITIAL_MARKET_CAP_WEI: String(10n * E18) };
  const r = await run(FORGE, ["script", "script/SeedPool.s.sol:SeedPool", "--rpc-url", RPC, "--broadcast", "--slow"], { cwd: path.join(ROOT, "contracts"), env, logName: "seedpool.log" });
  assert(r.code === 0, `SeedPool.s.sol failed: ${r.out.slice(-500)}`);
  assert(await read<boolean>(D.comdTaxHook, comdTaxHookAbi, "seeded"), "hook seeded");
  const dust = await comdOf(ADMIN.address);
  const inPool = await comdOf(await read<Address>(D.comdTaxHook, comdTaxHookAbi, "poolManager"));
  assert(inPool + dust === 10n ** 27n, `pool ${inPool} + POL dust ${dust} = supply`);
  const tax = await read<number>(D.comdTaxHook, comdTaxHookAbi, "taxBps");
  return `100% of supply seeded single-sided at a 10 ETH opening market cap (${fmt(inPool, 18, 0)} COMD in the pool, dust ${dust}); tax ${Number(tax) / 100}%`;
}

export async function startApi(port: number, extraEnv: Record<string, string | undefined> = {}) {
  const home = path.join(RUN, "home");
  mkdirSync(path.join(home, ".svm", "0.8.26"), { recursive: true });
  copyFileSync(SOLC, path.join(home, ".svm", "0.8.26", "solc-0.8.26")); // Clerk sandboxes build offline from $HOME/.svm
  chmodSync(path.join(home, ".svm", "0.8.26", "solc-0.8.26"), 0o755);
  const env: Record<string, string | undefined> = {
    NODE_ENV: "test", HOME: home, PORT: String(port), HOST: "127.0.0.1", PUBLIC_API_URL: API, PUBLIC_WEB_URL: "http://127.0.0.1:3000", SITES_DOMAIN: "sites.localhost",
    CHAIN_ID: String(CHAIN_ID), RPC_URL: RPC, DEPLOYMENTS_FILE: path.join(RUN, `deployments-${CHAIN_ID}.json`), PERMIT2_ADDRESS: PERMIT2, LAUNCH_CHAINS: String(CHAIN_ID),
    SETTLER_PRIVATE_KEY: pk(9), ATTESTER_PRIVATE_KEY: pk(10), DEPLOYER_PRIVATE_KEY: pk(8), ADMIN_TOKEN,
    STORAGE_DRIVER: "local", STORAGE_DIR: path.join(RUN, "storage"), SKILLS_DIR: path.join(ROOT, "skills"),
    FORGE_BIN: FORGE, LAUNCH_SOLC: SOLC, SANDBOX_NET: "env",
    SCHEDULE_MIN_INTERVAL_SECONDS: "10", REWARD_GENESIS: new Date(Date.now() - 1000).toISOString(), REWARD_EPOCH_SECONDS: "40", REWARD_EPOCH_COMD_POOL: String(1000n * E18),
    HEARTBEAT_MS: "3000", READS_PER_MINUTE: "100000", REQUESTS_PER_MINUTE: "100000", QUOTES_PER_MINUTE: "1000", SETTLE_WAIT_MS: "30000", FLYWHEEL_CACHE_SECONDS: "0",
    // keeper: every task on, small thresholds and spacing for a test chain (anvil gas is cheap, tips are tiny)
    KEEPER_PRIVATE_KEY: pk(11), KEEPER_INTERVAL_SECONDS: "2", KEEPER_DISTRIBUTE_MIN_COMD: "1", KEEPER_DISTRIBUTE_EVERY_SECONDS: "1",
    KEEPER_BUYBACK_MIN_WEI: "1000000000000", KEEPER_BUYBACK_EVERY_SECONDS: "1", KEEPER_FLUSH_EVERY_SECONDS: "1",
    // Records Office stays dry-run: never hand the sandbox's GitHub credentials to the api
    DATABASE_URL: undefined, GITHUB_TOKEN: undefined, GH_TOKEN: undefined, PAYTO_ADDRESS: undefined, ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, SERVICES_MODE: undefined,
    ...extraEnv,
  };
  let cmd: string, args: string[];
  if (process.env.E2E_TSX === "1") { cmd = process.execPath; args = ["--import", "tsx", "src/main.ts"]; }
  else {
    const b = await run("npm", ["run", "build"], { cwd: path.join(ROOT, "apps", "api"), logName: "api-build.log" });
    assert(b.code === 0, `api build failed: ${b.out.slice(-400)}`);
    cmd = process.execPath; args = ["dist/main.js"];
  }
  background("api", cmd, args, { cwd: path.join(ROOT, "apps", "api"), env });
  const h = await until("api /health", async () => (await get("/health")).body, 60_000, 500);
  assert(h.chain.ok && h.chain.blockNumber > 0, `chain not reachable from api: ${JSON.stringify(h.chain)}`);
  assert(h.services.verifier === "company-services" && h.services.deployer === "company-services:forge", `services ${JSON.stringify(h.services)}`);
  assert(h.skills.source === "catalog" && h.skills.count >= 50, `skills ${JSON.stringify(h.skills)}`);
  assert(h.art === "art", `art ${h.art}`);
  assert(h.payments.mode === "chain" && h.payments.symbol === "COMD" && getAddress(h.payments.asset) === getAddress(D.comdToken), `payments ${JSON.stringify(h.payments)}`);
  assert(getAddress(h.contracts.payTo) === getAddress(D.revenueRouter), "payTo must be the RevenueRouter");
  for (const k of ["flywheel", "comdTaxHook", "comdRouter"]) assert(h.contracts[k] && getAddress(h.contracts[k]) === getAddress(D[k]), `/health contracts.${k}`);
  assert(h.keeper?.enabled === true && getAddress(h.keeper.address) === KEEPER.address, `keeper ${JSON.stringify(h.keeper)}`);
  return `${process.env.E2E_TSX === "1" ? "tsx" : "node dist/main.js"} · block ${h.chain.blockNumber} · services ${h.services.verifier}/${h.services.publisher}/${h.services.deployer} · ${h.skills.count} skills · ${fmt(BigInt(h.payments.amount), 18, 0)} COMD per action → RevenueRouter · keeper on`;
}

export async function mintSeats() {
  await send(0, D.counselNFT, counselNFTAbi, "setPhase", [2]);
  const price = await read<bigint>(D.counselNFT, counselNFTAbi, "price");
  assert(price === 0n, `mint price ${price} (must be free)`);
  const ids: number[] = [];
  for (let i = 0; i < 6; i++) {
    const rc = await send(i + 1, D.counselNFT, counselNFTAbi, "mint", [1n], 0n);
    for (const l of rc.logs) {
      try { const ev: any = decodeEventLog({ abi: counselNFTAbi, data: l.data, topics: l.topics }); if (ev.eventName === "Transfer") ids.push(Number(ev.args.tokenId)); } catch { /* other */ }
    }
  }
  assert(ids.length === 6, "6 Transfer events");
  for (let i = 0; i < 6; i++) assert(getAddress(await read(D.counselNFT, counselNFTAbi, "ownerOf", [BigInt(ids[i])])) === HOLDERS[i].address, `ownerOf(${ids[i]})`);
  const uri = await read<string>(D.counselNFT, counselNFTAbi, "tokenURI", [BigInt(ids[0])]);
  assert(uri === `${API}/agents/by-token/${ids[0]}.json`, `tokenURI ${uri}`);
  seatIds = ids;
  return `free mints, token ids ${ids.join(",")}; tokenURI → ${uri}`;
}
export let seatIds: number[] = [];
export const agentIds: Record<number, string> = {};

export async function registerAgents() {
  for (let i = 0; i < 6; i++) {
    const tokenId = seatIds[i];
    const intent = (await get(`/agents/register-intent?tokenId=${tokenId}`)).body;
    assert(getAddress(intent.to) === getAddress(D.identityRegistry), "register-intent targets the IdentityRegistry");
    const hash = await wallet(i + 1).sendTransaction({ to: intent.to, data: intent.data, account: HOLDERS[i], chain: chain() });
    const rc = await pub.waitForTransactionReceipt({ hash });
    assert(rc.status === "success", `register tx ${hash}`);
    let agentId: string | null = null;
    for (const l of rc.logs) {
      try { const ev: any = decodeEventLog({ abi: identityRegistryAbi, data: l.data, topics: l.topics }); if (ev.eventName === "Registered") agentId = String(ev.args.agentId); } catch { /* other */ }
    }
    assert(agentId !== null, "Registered event");
    const b = await post("/agents/bind", { tokenId: String(tokenId), agentId });
    assert(b.status === 200 && b.body.bound, `bind ${tokenId}: ${b.status} ${JSON.stringify(b.body)}`);
    agentIds[tokenId] = agentId!;
  }
  const meta = (await get(`/agents/by-token/${seatIds[0]}.json`)).body;
  assert(meta.registrations?.[0]?.agentRegistry === `eip155:${CHAIN_ID}:${String(D.identityRegistry).toLowerCase()}`, "registration-v1 names the registry");
  return `agents ${Object.entries(agentIds).map(([t, a]) => `#${t}→${a}`).join(" ")}; metadata registrations ok`;
}

export const workers: { tokenId: number; code?: string; ready: boolean; premium: boolean }[] = [];
export async function pairWorkers() {
  const forgeDir = path.dirname(FORGE);
  for (let i = 0; i < 6; i++) {
    const w = { tokenId: seatIds[i], ready: false, premium: SEAT_RUNTIMES[i].effort === "high" || SEAT_RUNTIMES[i].effort === "xhigh" ? /opus|gpt-6-astra/.test(SEAT_RUNTIMES[i].model) : false } as (typeof workers)[number];
    workers.push(w);
    const home = path.join(RUN, `worker-${i + 1}`);
    rmSync(home, { recursive: true, force: true });
    background(`worker-${i + 1}`, process.execPath, ["--import", "tsx", path.join(ROOT, "apps", "worker", "src", "cli.ts"), "start", "--runtime", "mock", "--concurrency", "2", "--server", API, "--home", home], {
      cwd: path.join(ROOT, "apps", "worker"),
      env: { PATH: `${forgeDir}:${process.env.PATH}`, COMD_MOCK_AS: SEAT_RUNTIMES[i].as, COMD_MOCK_MODEL: SEAT_RUNTIMES[i].model, COMD_MOCK_EFFORT: SEAT_RUNTIMES[i].effort, COMD_MOCK_DELAY_MS: "200", GITHUB_TOKEN: undefined },
      onLine: (l) => { const m = /Code ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(l); if (m) w.code = m[1]; if (/connected|welcome|runtime .* model/i.test(l)) w.ready = true; },
    });
  }
  for (let i = 0; i < 6; i++) {
    const w = workers[i];
    const code = await until(`pairing code of worker ${i + 1}`, async () => w.code, 60_000, 200);
    // the browser's side of /pair: read the code, sign WorkerAuthorization with the holder's wallet
    const st = (await get(`/pair/${code}`)).body;
    for (const k of ["deviceKey", "nonce", "expiresAt", "relayOrigin", "chainId"]) assert(st[k] !== undefined, `GET /pair/:code lacks ${k}`);
    const message = { deviceKey: `0x${st.deviceKey.replace(/^0x/, "")}` as Hex, wallet: HOLDERS[i].address.toLowerCase() as Address, tokenId: BigInt(w.tokenId), nonce: st.nonce as Hex, expiresAt: BigInt(st.expiresAt), relayOrigin: st.relayOrigin };
    const signature = await wallet(i + 1).signTypedData({
      account: HOLDERS[i], domain: { name: "Company.md Worker", version: "1", chainId: st.chainId }, primaryType: "WorkerAuthorization",
      types: { WorkerAuthorization: [{ name: "deviceKey", type: "bytes32" }, { name: "wallet", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "expiresAt", type: "uint64" }, { name: "relayOrigin", type: "string" }] },
      message,
    });
    const done = await post("/pair/complete", { code, message: { deviceKey: st.deviceKey.replace(/^0x/, ""), wallet: HOLDERS[i].address.toLowerCase(), tokenId: String(w.tokenId), nonce: st.nonce.replace(/^0x/, ""), expiresAt: Number(st.expiresAt), relayOrigin: st.relayOrigin }, signature });
    assert(done.status === 200 && done.body.enrolled, `pair/complete ${w.tokenId}: ${done.status} ${JSON.stringify(done.body)}`);
  }
  // a second device for an already-seated Counsel is refused (one device per NFT)
  const extra = await post("/pair/start", { deviceKey: randomBytes(32).toString("hex") });
  const st = (await get(`/pair/${extra.body.code}`)).body;
  const m2 = { deviceKey: `0x${st.deviceKey}` as Hex, wallet: HOLDERS[0].address.toLowerCase() as Address, tokenId: BigInt(seatIds[0]), nonce: st.nonce as Hex, expiresAt: BigInt(st.expiresAt), relayOrigin: st.relayOrigin };
  const sig2 = await wallet(1).signTypedData({ account: HOLDERS[0], domain: { name: "Company.md Worker", version: "1", chainId: st.chainId }, primaryType: "WorkerAuthorization", types: { WorkerAuthorization: [{ name: "deviceKey", type: "bytes32" }, { name: "wallet", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "expiresAt", type: "uint64" }, { name: "relayOrigin", type: "string" }] }, message: m2 });
  const dup = await post("/pair/complete", { code: extra.body.code, message: { ...m2, deviceKey: st.deviceKey, tokenId: String(seatIds[0]), nonce: st.nonce.replace(/^0x/, ""), expiresAt: Number(st.expiresAt) }, signature: sig2 });
  assert(dup.status === 409 && dup.body.error === "token_enrolled", `second device for #${seatIds[0]} should be refused, got ${dup.status} ${JSON.stringify(dup.body)}`);
  // a wallet that does not hold the token is refused by the on-chain ownerOf check
  const extra2 = await post("/pair/start", { deviceKey: randomBytes(32).toString("hex") });
  const st2 = (await get(`/pair/${extra2.body.code}`)).body;
  const m3 = { deviceKey: `0x${st2.deviceKey}` as Hex, wallet: CUSTOMER.address.toLowerCase() as Address, tokenId: BigInt(seatIds[1]), nonce: st2.nonce as Hex, expiresAt: BigInt(st2.expiresAt), relayOrigin: st2.relayOrigin };
  const sig3 = await wallet(7).signTypedData({ account: CUSTOMER, domain: { name: "Company.md Worker", version: "1", chainId: st2.chainId }, primaryType: "WorkerAuthorization", types: { WorkerAuthorization: [{ name: "deviceKey", type: "bytes32" }, { name: "wallet", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "expiresAt", type: "uint64" }, { name: "relayOrigin", type: "string" }] }, message: m3 });
  const notOwner = await post("/pair/complete", { code: extra2.body.code, message: { ...m3, deviceKey: st2.deviceKey, tokenId: String(seatIds[1]), nonce: st2.nonce.replace(/^0x/, ""), expiresAt: Number(st2.expiresAt) }, signature: sig3 });
  assert(notOwner.status === 403 && notOwner.body.error === "not_owner", `non-holder should be refused, got ${notOwner.status}`);

  const online = await until("6 workers online", async () => { const w = (await get("/workers")).body; return w.count === 6 ? w : null; }, 120_000, 1000);
  const prem = online.workers.filter((x: any) => x.premium).map((x: any) => Number(x.tokenId)).sort();
  const wantPrem = seatIds.slice(0, 3).sort();
  assert(JSON.stringify(prem) === JSON.stringify(wantPrem), `premium seats ${prem} != ${wantPrem} (top-tier model at high effort)`);
  const names = online.workers.map((x: any) => `#${x.tokenId}:${x.runtime.name}/${x.model}/${x.effort}${x.premium ? "*" : ""}`).sort();
  const wallets = (await get(`/pair/wallet/${HOLDERS[0].address}`)).body;
  assert(wallets.seats?.[0]?.devices?.[0]?.status === "active", "/pair/wallet/:address seats[].devices");
  return `6 seats online via CLI pairing; one device per NFT and ownerOf enforced; runtimes ${names.join(" ")} (* premium)`;
}

// ============================================================================================ flows

let paid: Record<string, Awaited<ReturnType<typeof pay>>> = {};
const BUY_ETH = 1n * E18;
const LIST_PRICE = E18 / 1000n; // 0.001 ETH
let heldTax = false;
let swept = 0;
let launchView: any = null;

/** The customer buys COMD with ETH through the official ComdRouter (5% ETH tax), then approves Permit2 once. */
async function buyComd() {
  const taxed0 = await read<bigint>(D.comdTaxHook, comdTaxHookAbi, "totalTaxed");
  const deadline = BigInt((await chainNow()) + 3600);
  const { result: quoted } = await pub.simulateContract({ account: CUSTOMER, address: D.comdRouter, abi: comdRouterAbi, functionName: "swapExactETHForComd", args: [0n, CUSTOMER.address, deadline], value: BUY_ETH } as any);
  const c0 = await comdOf(CUSTOMER.address);
  await send(7, D.comdRouter, comdRouterAbi, "swapExactETHForComd", [((quoted as bigint) * 99n) / 100n, CUSTOMER.address, deadline], BUY_ETH);
  const got = (await comdOf(CUSTOMER.address)) - c0;
  const tax = (await read<bigint>(D.comdTaxHook, comdTaxHookAbi, "totalTaxed")) - taxed0;
  assert(got > 0n, "no COMD received");
  assert(tax === (BUY_ETH * 500n) / 10_000n, `tax ${tax} != 5% of ${BUY_ETH}`);
  heldTax = (await read<bigint>(D.comdTaxHook, comdTaxHookAbi, "pendingTax")) > 0n;
  await send(7, D.comdToken, erc20Abi, "approve", [PERMIT2, 1_000n * E18]); // "one approval: up to 1,000 COMD, ten requests"
  return `${fmt(got, 18, 0)} COMD for ${fmt(BUY_ETH)} ETH; tax ${fmt(tax)} ETH ${heldTax ? "held as claims for flush()" : "forwarded to the Flywheel"}; Permit2 allowance 1,000 COMD`;
}

/** Keeper: ComdTaxHook.flush() (when tax is held) and Flywheel.buyback(minOut), which burns what it buys. */
async function keeperFlushBuyback() {
  const taxed = await read<bigint>(D.comdTaxHook, comdTaxHookAbi, "totalTaxed");
  await until("tax reached the Flywheel", async () => (await read<bigint>(D.comdTaxHook, comdTaxHookAbi, "pendingTax")) === 0n && (await read<bigint>(D.flywheel, flywheelAbi, "totalTaxIn")) === taxed, 120_000, 1000);
  const burned = await until("keeper buyback", async () => { const b = await read<bigint>(D.flywheel, flywheelAbi, "totalBurned"); return b > 0n ? b : null; }, 120_000, 1000);
  const bb = await eventsOf(D.flywheel, flywheelAbi, "Buyback");
  for (const e of bb) assert(getAddress((await pub.getTransactionReceipt({ hash: e.transactionHash })).from) === KEEPER.address, "buyback() sent by the keeper");
  const t = await keeperTasks();
  assert(t.buyback.runs >= 1, `keeper buyback runs ${JSON.stringify(t.buyback)}`);
  if (heldTax) {
    assert(t.flush.runs >= 1, `tax was held but flush ran ${t.flush.runs}×`);
    const fl = await eventsOf(D.comdTaxHook, comdTaxHookAbi, "Flushed");
    assert(fl.length >= 1, "Flushed event");
  }
  const supply = await read<bigint>(D.comdToken, erc20Abi, "totalSupply");
  assert(supply === 10n ** 27n - burned, `totalSupply ${supply} = 1B − burned ${burned}`);
  const [bk, sw] = await read<readonly bigint[]>(D.flywheel, flywheelAbi, "bucketBalances");
  return `${heldTax ? `flush() ${t.flush.runs}× → ` : ""}Flywheel took ${fmt(taxed)} ETH tax (50/50); keeper buyback ${t.buyback.runs}× burned ${fmt(burned, 18, 0)} COMD (supply ${fmt(supply, 18, 0)}); buckets buyback ${fmt(bk)} / sweep ${fmt(sw)} ETH`;
}

async function payAll() {
  const recipe = { kind: "eth-call", to: D.counselNFT, data: encodeFunctionData({ abi: counselNFTAbi, functionName: "MAX_SUPPLY" }), decode: "uint256" };
  const answer = await read<bigint>(D.counselNFT, counselNFTAbi, "MAX_SUPPLY");
  paid.research = await pay("job.open", { objective: "Research report: how do x402 Permit2 payments settle on Robinhood Chain, and what does the payer sign?", template: "research", minCitations: 2 });
  paid.oracle = await pay("oracle.request", {
    v: 1, question: "What is MAX_SUPPLY of the Company.md Counsel collection, read on chain at the end of the window?", chainId: CHAIN_ID, window: { hours: 1 }, answerType: "uint256",
    panelSize: 5, quorum: 3, validForSeconds: 7200, evidence: "chain", recipe,
    definitions: { "mock.answer": answer.toString(), "mock.recipe": JSON.stringify(recipe) },
  });
  paid.schedule = await pay("schedule.create", { action: "job.open", input: { objective: "Retainer: weekly research note on COMD liquidity on Robinhood Chain, with sources.", template: "research", minCitations: 2 }, cadence: { every: "PT15S" }, runs: 2, label: "e2e retainer" });
  paid.launch = await pay("launch.open", {
    objective: "Launch $BRIEF, a fixed-supply token for the Company.md e2e matter, through ProjectFactory.",
    skill: "build-contract-project", onchain: "custom_token", chainId: CHAIN_ID, pairWith: "eth",
    economics: { poolBps: 8800, initialMarketCapWei: "10000000000000000000", remainderTo: CUSTOMER.address.toLowerCase() },
  });
  let toRouter = 0n;
  for (const [k, p] of Object.entries(paid)) {
    const rc = await pub.getTransactionReceipt({ hash: p.txHash });
    assert(rc.status === "success" && getAddress(rc.from) === SETTLER.address && getAddress(rc.to!) === PERMIT2, `${k}: settlement tx ${p.txHash} not a successful Permit2 call from the settler`);
    assert(getAddress(p.payTo) === getAddress(D.revenueRouter), `${k}: payTo ${p.payTo}`);
    // the keeper may already have distributed, so count the COMD Transfer into the RevenueRouter in each settlement
    toRouter += transfersTo(rc.logs, D.comdToken, D.revenueRouter);
  }
  const amounts = Object.values(paid).reduce((s, p) => s + p.amount, 0n);
  assert(toRouter === amounts, `settlements moved ${toRouter} COMD into the RevenueRouter, expected ${amounts}`);
  return `4 paid actions settled in COMD (${Object.entries(paid).map(([k, p]) => `${k} ${fmt(p.amount, 18, 0)}`).join(", ")}); RevenueRouter +${fmt(amounts, 18, 0)} COMD`;
}

export const jobOf = async (id: string) => (await get(`/jobs/${id}`)).body;
export async function waitJob(id: string, what: string, timeoutMs = 600_000) {
  return until(what, async () => {
    const j = await jobOf(id);
    if (j.state === "blocked" || j.state === "cancelled") throw new Error(`${what} ${j.state}: ${j.blockedReason}`);
    return j.state === "completed" ? j : null;
  }, timeoutMs, 2000);
}

async function researchAndContinue() {
  const j = await waitJob(paid.research.result.jobId, "research job");
  const sub = (await get(`/jobs/${j.id}/submissions`)).body.submissions[0];
  assert(sub.verdict?.evaluation && sub.accepted, "research verified by the Clerk");
  paid.continue = await pay("job.continue", { parentJobId: j.id, objective: "Continue: add a section on QuoteApproval replay protection with sources.", skill: "research-report", minCitations: 2 });
  const c = await waitJob(paid.continue.result.jobId, "continuation");
  assert(c.parentJobId === j.id, "continuation links its parent");
  return `research ${j.id.slice(0, 8)} completed (${sub.verdict.profile}: ${sub.verdict.detail.slice(0, 80)}); job.continue ${c.id.slice(0, 8)} paid ${fmt(paid.continue.amount, 18, 0)} COMD and completed`;
}

async function premiumRouting() {
  const launchJob = await jobOf(paid.launch.result.jobId);
  const work = launchJob.nodes.find((n: any) => n.kind === "work");
  assert(work?.premium === true, "contract work node is premium");
  const seat = await until("launch work leased", async () => (await jobOf(launchJob.id)).nodes.find((n: any) => n.kind === "work")?.seat, 300_000, 1000);
  assert(seatIds.slice(0, 3).includes(Number(seat.tokenId)), `premium work went to #${seat.tokenId}, which is not premium`);
  return `contract work (${work.skill}) routed to premium seat #${seat.tokenId}; standard seats only got reviews/research/panels`;
}

async function oracleOnChain() {
  const id = paid.oracle.result.requestId;
  const done = await until("oracle attested", async () => {
    const r = (await get(`/oracle/requests/${id}`)).body;
    if (["disagreed", "blocked", "mismatch", "refused", "failed"].includes(r.status)) throw new Error(`oracle ${r.status}: ${r.failure}`);
    return r.status === "attested" ? r : null;
  }, 300_000, 2000);
  const att = (await get(`/oracle/requests/${id}/attestation`)).body;
  assert(getAddress(att.signer) === ATTESTER.address, `signer ${att.signer} is not ATTESTER_PRIVATE_KEY's address`);
  assert(att.domain.name === "Company.md Oracle" && att.domain.verifyingContract === undefined, "domain Company.md Oracle without verifyingContract (OracleAttestationVerifier)");
  // deploy the example consumer trusting our attester, then submit the attestation in a transaction
  const art = JSON.parse(readFileSync(path.join(ROOT, "contracts", "out", "OracleConsumerExample.sol", "OracleConsumerExample.json"), "utf8"));
  const hash = await wallet(0).deployContract({ abi: oracleConsumerExampleAbi, bytecode: art.bytecode.object, args: [ATTESTER.address], account: ADMIN, chain: chain() });
  const consumer = (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  const t = att.tuple;
  const a = { requestId: t[0], chainId: BigInt(t[1]), questionHash: t[2], answerType: t[3], answer: t[4], figure: BigInt(t[5]), fromBlock: BigInt(t[6]), toBlock: BigInt(t[7]), blockHash: t[8], panelJobId: t[9], issuedAt: BigInt(t[10]), expiresAt: BigInt(t[11]) };
  const digest = await read<Hex>(consumer, oracleConsumerExampleAbi, "digest", [a]);
  await send(0, consumer, oracleConsumerExampleAbi, "submit", [a, att.signature]);
  const ruling = await read<any[]>(consumer, oracleConsumerExampleAbi, "rulings", [a.requestId]);
  const figure = BigInt(ruling[2]);
  const want = await read<bigint>(D.counselNFT, counselNFTAbi, "MAX_SUPPLY");
  assert(figure === want, `on-chain ruling figure ${figure} != MAX_SUPPLY ${want}`);
  let refused = false;
  try { await pub.simulateContract({ account: ADMIN, address: consumer, abi: oracleConsumerExampleAbi, functionName: "submit", args: [{ ...a, requestId: keccak256(toHex("other")), figure: a.figure + 1n }, att.signature] } as any); } catch { refused = true; }
  assert(refused, "a tampered attestation must not verify");
  return `panel ${done.agreement.agreed}/${done.quorum} agreed, chain reproduced eth_call MAX_SUPPLY = ${figure}; OracleConsumerExample.submit verified signer ${att.signer.slice(0, 10)}… (digest ${digest.slice(0, 10)}…); tampered copy refused`;
}

async function scheduleRuns() {
  const id = paid.schedule.result.scheduleId;
  const s = await until("schedule exhausted", async () => {
    const v = (await get(`/schedules/${id}`)).body;
    if (["paused", "cancelled", "expired"].includes(v.status)) throw new Error(`schedule ${v.status}: ${v.pausedReason ?? v.statusReason ?? ""}`);
    return v.status === "exhausted" ? v : null;
  }, 300_000, 2000);
  const runs = (s.latest ?? []).filter((r: any) => r.status === "opened");
  assert(runs.length === 2, `2 runs opened (got ${runs.length})`);
  for (const r of runs) await waitJob(r.result.id ?? r.result.jobId, `retainer run ${r.seq}`);
  return `retainer prepaid ${fmt(paid.schedule.amount, 18, 0)} COMD; 2 runs opened ${runs.map((r: any) => r.firedAt?.slice(11, 19)).join(" / ")} and both jobs completed`;
}

async function launchDeployed() {
  const j = await waitJob(paid.launch.result.jobId, "launch job", 900_000);
  const l = (await get(`/launches/${j.launch.id}?claims=1&work=1`)).body;
  launchView = l;
  assert(l.status === "live", `launch ${l.status}: ${l.parkedReason}`);
  assert(l.onchainLaunchId >= 1 && l.token?.address, `on-chain launch id and token: ${JSON.stringify({ id: l.onchainLaunchId, token: l.token })}`);
  const token = getAddress(l.token.address);
  l.tokenAddr = token;
  const onchain = await read<any>(D.projectFactory, projectFactoryAbi, "launches", [BigInt(l.onchainLaunchId)]);
  assert(getAddress(onchain.token) === token, "ProjectFactory.launches(id).token");
  const supply = await read<bigint>(token, launchTokenAbi, "totalSupply");
  assert(supply === 10n ** 27n, `LaunchToken supply ${supply}`);
  const alloc = await read<any>(D.contributorDistributor, contributorDistributorAbi, "allocations", [BigInt(l.onchainLaunchId)]);
  assert(alloc.root === l.rewardSnapshot.root, `ContributorDistributor root ${alloc.root} != snapshot ${l.rewardSnapshot.root}`);
  assert(alloc.total === 10n ** 26n, `contributor allocation ${alloc.total} (10% of supply)`);
  const remainder = await read<bigint>(token, launchTokenAbi, "balanceOf", [CUSTOMER.address]);
  const two = (10n ** 27n * 200n) / 10_000n; // payer gets 2% plus the single-sided seed's rounding dust
  assert(remainder >= two && remainder - two < E18, `payer remainder ${remainder} (2% + dust)`);
  assert(BigInt(l.launchedEvent.poolAmount) + BigInt(l.launchedEvent.contributorAmount) + BigInt(l.launchedEvent.remainderAmount) === 10n ** 27n, "pool + swarm + payer = supply");
  const deployTx = l.transactions.find((t: any) => /launch/i.test(t.label))?.txHash ?? l.rewardSnapshot.rootTx;
  const rc = await pub.getTransactionReceipt({ hash: deployTx });
  assert(getAddress(rc.from) === REGISTRAR.address, "launched by the Registrar's key through forge script");
  const bench = j.nodes.filter((n: any) => ["audit", "judge"].includes(n.kind));
  const wallets = new Set(bench.filter((n: any) => n.kind === "audit").map((n: any) => n.seat?.tokenId));
  assert(bench.length === 5 && wallets.size === 4, "the Bench: 4 specialists on 4 different seats + judge");
  // contributor claims are locked right after launch (claimed later, after time passes)
  const entry = l.rewardSnapshot.claims[0];
  const view = (await get(`/launches/${l.id}/claims/${entry.account}`)).body;
  assert(view.eligible && view.amount === entry.amount, "GET /launches/:id/claims/:address");
  const idx = HOLDERS.findIndex((h) => h.address.toLowerCase() === entry.account.toLowerCase());
  assert(idx >= 0, "a contributor is one of the seat holders");
  let locked = false;
  try { await pub.simulateContract({ account: HOLDERS[idx], address: D.contributorDistributor, abi: contributorDistributorAbi, functionName: "claim", args: [BigInt(view.launchId), view.account, BigInt(view.amount), view.proof] } as any); } catch { locked = true; }
  assert(locked, "claims are locked for contributorLockSeconds");
  return `LaunchToken ${l.token.symbol} ${token} (launchId ${l.onchainLaunchId}, 1e27 supply, 88% pool / 2% payer / 10% swarm) deployed by forge script from ${REGISTRAR.address.slice(0, 10)}…; ContributorDistributor root registered in the launch tx (claims locked); Bench 4+1 on independent seats`;
}

/** Keeper: RevenueRouter.distribute() → 80% RewardDistributor (Counsel rewards, COMD) / 20% firm treasury. */
async function revenueSplit() {
  await until("keeper emptied the RevenueRouter", async () => (await comdOf(D.revenueRouter)) === 0n, 120_000, 1000);
  const t = await keeperTasks();
  assert(t.distribute.runs >= 1, `keeper distribute ${JSON.stringify(t.distribute)}`);
  const dist = await eventsOf(D.revenueRouter, revenueRouterAbi, "Distributed");
  assert(dist.length >= 1, "Distributed events");
  const logs = await pub.getLogs({ address: D.comdToken, fromBlock: 0n, toBlock: "latest" });
  const inflow = transfersTo(logs as any, D.comdToken, D.revenueRouter);
  const toRd = transfersTo(logs as any, D.comdToken, D.rewardDistributor, D.revenueRouter);
  const toTr = transfersTo(logs as any, D.comdToken, TREASURY.address, D.revenueRouter);
  let total = 0n, rewards = 0n, treasury = 0n;
  for (const e of dist) {
    total += e.args.total; rewards += e.args.toRewards; treasury += e.args.toTreasury;
    assert(e.args.toRewards === (e.args.total * 8000n) / 10_000n && e.args.toTreasury === e.args.total - e.args.toRewards, `80/20 split of ${e.args.total}`);
    assert(getAddress((await pub.getTransactionReceipt({ hash: e.transactionHash })).from) === KEEPER.address, "distribute() sent by the keeper");
  }
  const paidIn = Object.values(paid).reduce((s, p) => s + p.amount, 0n);
  assert(total === inflow && inflow === paidIn, `distributed ${total} / paid in ${inflow} / charged ${paidIn}`);
  assert(toRd === rewards && toTr === treasury, `RewardDistributor +${toRd} (events ${rewards}), treasury +${toTr} (events ${treasury})`);
  assert((await read<bigint>(D.revenueRouter, revenueRouterAbi, "totalToRewards")) === rewards, "totalToRewards");
  assert((await comdOf(TREASURY.address)) === treasury, "treasury COMD balance = its 20%");
  return `keeper distribute() ${dist.length}×: ${fmt(total, 18, 0)} COMD → 80% ${fmt(rewards, 18, 0)} to RewardDistributor (Counsel rewards) / 20% ${fmt(treasury, 18, 0)} to the treasury`;
}

/** Floor sweep: a holder lists a Counsel on MockMarketplace; the Flywheel's sweep bucket buys it (owner/keeper). */
async function floorSweep() {
  const rc = await send(13, D.counselNFT, counselNFTAbi, "mint", [1n], 0n);
  let tokenId = 0n;
  for (const l of rc.logs) {
    try { const ev: any = decodeEventLog({ abi: counselNFTAbi, data: l.data, topics: l.topics }); if (ev.eventName === "Transfer") tokenId = ev.args.tokenId; } catch { /* other */ }
  }
  assert(tokenId > 0n, "seller minted a Counsel");
  await send(13, D.counselNFT, counselNFTAbi, "approve", [D.mockMarketplace, tokenId]);
  await send(13, D.mockMarketplace, mockMarketplaceAbi, "list", [D.counselNFT, tokenId, LIST_PRICE]);
  const bucket = await read<bigint>(D.flywheel, flywheelAbi, "sweepBucket");
  assert(bucket >= LIST_PRICE, `sweep bucket ${bucket} < listing ${LIST_PRICE}`);
  const s0 = await ethOf(SELLER.address);
  await send(0, D.flywheel, flywheelAbi, "sweep", [D.mockMarketplace, "0x", tokenId, LIST_PRICE]);
  assert(getAddress(await read(D.counselNFT, counselNFTAbi, "ownerOf", [tokenId])) === getAddress(D.flywheel), "the Flywheel holds the swept Counsel");
  assert((await ethOf(SELLER.address)) - s0 === LIST_PRICE, "seller paid the listing price");
  const ids = (await read<readonly bigint[]>(D.flywheel, flywheelAbi, "sweptTokenIds")).map(Number);
  assert(ids.includes(Number(tokenId)), "sweptTokenIds");
  assert((await read<bigint>(D.flywheel, flywheelAbi, "sweepBucket")) === bucket - LIST_PRICE, "sweep bucket spent");
  swept = Number(tokenId);
  return `Counsel #${tokenId} listed at ${fmt(LIST_PRICE)} ETH on MockMarketplace and swept by Flywheel.sweep (bucket ${fmt(bucket)} → ${fmt(bucket - LIST_PRICE)} ETH)`;
}

async function feedbackOnChain() {
  const batches = await until("feedback batches sent", async () => {
    const b = (await get("/feedback/batches?limit=50")).body.batches;
    const sent = b.filter((x: any) => x.status === "sent");
    return sent.length >= 4 && !b.some((x: any) => x.status === "queued" || x.status === "submitted") ? b : null;
  }, 300_000, 2000);
  let checked = 0;
  for (const b of batches.filter((x: any) => x.status === "sent")) {
    for (const e of b.entries) {
      if (!e.txHash) continue;
      const rc = await pub.getTransactionReceipt({ hash: e.txHash });
      assert(rc.status === "success" && getAddress(rc.to!) === getAddress(D.reputationRegistry), "giveFeedback tx");
      const last = await read<bigint>(D.reputationRegistry, reputationRegistryAbi, "getLastIndex", [BigInt(e.agentId), SETTLER.address]);
      assert(last >= 1n, `no feedback for agent ${e.agentId}`);
      checked++;
    }
  }
  const failed = batches.filter((x: any) => x.status === "failed");
  assert(!failed.length, `failed batches: ${failed.map((f: any) => f.failure).join("; ")}`);
  return `${batches.filter((x: any) => x.status === "sent").length} batches, ${checked} giveFeedback txs to the ReputationRegistry from the settler`;
}

/** Seat rewards are COMD only: the settler posts an epoch root; the top seat claims through GET /rewards/:tokenId. */
async function seatRewards() {
  const posted = await until("COMD epoch root posted", async () => {
    const r = await post("/admin/settle", {}, { authorization: `Bearer ${ADMIN_TOKEN}` });
    return (r.body?.epochs ?? []).find((e: any) => e.assets.some((a: any) => a.symbol === "COMD" && a.status === "posted"));
  }, 300_000, 5000);
  const epoch = posted.epoch;
  const ep = (await get(`/rewards/epochs/${epoch}`)).body;
  assert(ep.assets.length === 1 && ep.assets[0].symbol === "COMD", `epoch assets ${ep.assets.map((a: any) => a.symbol)} (COMD only)`);
  const comd = ep.assets[0];
  const root = await read<any>(D.rewardDistributor, rewardDistributorAbi, "roots", [BigInt(epoch), D.comdToken]);
  assert(root.root === comd.root && root.total === BigInt(comd.total), "RewardDistributor.roots(epoch, COMD) matches");
  const top = [...comd.entries].sort((a: any, b: any) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))[0];
  const i = seatIds.indexOf(Number(top.tokenId));
  const holder = HOLDERS[i];
  const mine = (await get(`/rewards/${top.tokenId}`)).body.epochs.find((e: any) => e.epoch === epoch).assets.find((a: any) => a.symbol === "COMD");
  const b0 = await comdOf(holder.address);
  await send(i + 1, D.rewardDistributor, rewardDistributorAbi, "claim", [BigInt(epoch), BigInt(top.tokenId), BigInt(mine.amount), mine.proof]);
  assert((await comdOf(holder.address)) - b0 === BigInt(mine.amount), "claimed amount");
  let again = false;
  try { await pub.simulateContract({ account: holder, address: D.rewardDistributor, abi: rewardDistributorAbi, functionName: "claim", args: [BigInt(epoch), BigInt(top.tokenId), BigInt(mine.amount), mine.proof] } as any); } catch { again = true; }
  assert(again, "a second claim must revert");
  return `epoch ${epoch}: COMD root ${comd.root.slice(0, 10)}… total ${fmt(BigInt(comd.total), 18, 2)} COMD across ${comd.entries.length} seats; #${top.tokenId} claimed ${fmt(BigInt(mine.amount), 18, 2)} COMD; double claim refused`;
}

/** GET /flywheel against the chain: tax, 2 buckets, revenue router, swept tokens, events, keeper. */
async function flywheelView() {
  const f = (await get("/flywheel")).body;
  assert(f.configured === true, "configured");
  assert(Object.keys(f.errors ?? {}).length === 0, `section errors ${JSON.stringify(f.errors)}`);
  const hk = D.comdTaxHook;
  assert(f.tax.totalTaxed === String(await read<bigint>(hk, comdTaxHookAbi, "totalTaxed")) && f.tax.taxBps === 500 && f.tax.toFlywheel === String(await read<bigint>(D.flywheel, flywheelAbi, "totalTaxIn")), "tax");
  assert(Object.keys(f.flywheel.buckets).sort().join() === "buyback,sweep" && Object.keys(f.flywheel.bps).sort().join() === "buyback,sweep", "two buckets");
  const [bk, sw] = await read<readonly bigint[]>(D.flywheel, flywheelAbi, "bucketBalances");
  assert(f.flywheel.buckets.buyback === String(bk) && f.flywheel.buckets.sweep === String(sw), "bucket balances");
  assert(f.flywheel.totals.burned === String(await read<bigint>(D.flywheel, flywheelAbi, "totalBurned")) && f.flywheel.sweptTokenIds.includes(swept), "flywheel totals + swept ids");
  assert(f.revenueRouter.totalToRewards === String(await read<bigint>(D.revenueRouter, revenueRouterAbi, "totalToRewards")) && f.revenueRouter.bps.rewards === 8000 && f.revenueRouter.bps.treasury === 2000, "revenue router");
  for (const k of ["buyWall", "staking", "bond"]) assert(!(k in f), `no ${k} section`);
  const kinds = new Set(f.events.map((e: any) => `${e.source}.${e.type}`));
  for (const k of ["flywheel.TaxIn", "flywheel.Buyback", "flywheel.Swept", "revenueRouter.Distributed"]) assert(kinds.has(k), `event ${k} in /flywheel events`);
  assert(f.keeper?.enabled === true && Object.keys(f.keeper.tasks).join() === "flush,buyback,distribute", `keeper ${JSON.stringify(f.keeper?.tasks && Object.keys(f.keeper.tasks))}`);
  return `tax, buckets, totals, swept ids and revenue router match the chain; ${f.events.length} recent events (${[...kinds].sort().join(", ")}); keeper tasks flush/buyback/distribute`;
}

async function webShapes() {
  const sw = (await get("/swarm")).body;
  assert(sw.counts.jobStates && Array.isArray(sw.events) && sw.events.every((e: any) => e.at && e.kind && e.text), "/swarm events + counts.jobStates");
  assert((await get("/jobs?state=completed")).body.count >= 4, "/jobs?state=completed");
  assert(typeof (await get("/oracle/counts")).body.byStatus === "object", "/oracle/counts");
  const c = (await get("/contributors")).body.contributors;
  assert(c.length === 6 && c.every((x: any) => typeof x.turns === "number" && typeof x.hours === "number"), "/contributors per token turns + hours");
  assert(Array.isArray((await get("/names")).body.names), "/names");
  const seat = (await get(`/seats/${seatIds[0]}`)).body;
  assert(seat.runtime?.name === "claude" && seat.model && seat.effort === "high" && seat.premium === true, "/seats/:tokenId runtime/model/effort/premium");
  const png = await fetch(`${API}/agents/by-token/${seatIds[0]}.png`);
  const buf = Buffer.from(await png.arrayBuffer());
  assert(png.status === 200 && buf.subarray(1, 4).toString() === "PNG", "card PNG");
  const svg = await (await fetch(`${API}/agents/by-token/${seatIds[0]}.svg`)).text();
  assert(svg.startsWith("<svg"), "card SVG");
  const pubs = (await get("/publications/counts")).body.counts;
  return `swarm events ${sw.events.length}, jobStates ${JSON.stringify(sw.counts.jobStates)}; card PNG ${buf.length} B; publications ${JSON.stringify(pubs)}`;
}

/** After the lock (time has passed on chain), a contributor claims its share of the launch token. */
async function contributorClaim() {
  const l = launchView;
  assert(l, "launch not live");
  const entry = l.rewardSnapshot.claims[0];
  const idx = HOLDERS.findIndex((h) => h.address.toLowerCase() === entry.account.toLowerCase());
  const view = (await get(`/launches/${l.id}/claims/${entry.account}`)).body;
  await rpc("evm_increaseTime", [3601]);
  await rpc("evm_mine", []);
  const b0 = await read<bigint>(l.tokenAddr, erc20Abi, "balanceOf", [view.account]);
  await send(idx + 1, D.contributorDistributor, contributorDistributorAbi, "claim", [BigInt(view.launchId), view.account, BigInt(view.amount), view.proof]);
  const b1 = await read<bigint>(l.tokenAddr, erc20Abi, "balanceOf", [view.account]);
  assert(b1 - b0 === BigInt(view.amount), "contributor received the claimed amount");
  return `${l.rewardSnapshot.claims.length} contributors (2% workers + 8% connected, cap 30%); after evm_increaseTime 3601 ${view.account.slice(0, 10)}… claimed ${fmt(BigInt(view.amount), 18, 0)} ${l.token.symbol ?? "tokens"}`;
}

// ============================================================================================ main

/**
 * Shared by run.ts and ui.ts: anvil 46630 → Permit2 → Deploy.s.sol + SeedPool.s.sol → the api (real services,
 * keeper on) → six seats minted, registered and paired with `comd start --runtime mock` workers.
 * Returns false (with the failure recorded) when a step that later steps depend on failed.
 */
export async function bootStack(o: { apiEnv?: Record<string, string | undefined>; seats?: boolean } = {}): Promise<boolean> {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(path.join(RUN, "logs"), { recursive: true });
  if (!(await check("toolchain (anvil, forge, solc 0.8.26 + 0.8.17)", tools))) return false;

  const rpcPort = Number(process.env.E2E_RPC_PORT) || 8545;
  const apiPort = Number(process.env.E2E_API_PORT) || 8789;
  RPC = `http://127.0.0.1:${rpcPort}`;
  API = `http://127.0.0.1:${apiPort}`;
  const busy = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }).then(() => true, () => false);
  if (busy) { record("anvil --chain-id 46630", false, `port ${rpcPort} is already in use (set E2E_RPC_PORT)`); return false; }
  background("anvil", ANVIL, ["--chain-id", String(CHAIN_ID), "--port", String(rpcPort), "--accounts", "20", "--balance", "100000"]);
  pub = createPublicClient({ chain: chain(), transport: http(RPC) }) as PublicClient;
  await until("anvil", async () => (await rpc("eth_chainId")) === toHex(CHAIN_ID), 20_000, 200);
  record("anvil --chain-id 46630", true, RPC);

  if (!(await check("Permit2 at the canonical address", permit2))) return false;
  if (!(await check("Deploy.s.sol (v4 PoolManager, COMD, ERC-8004, Counsel, rewards, flywheel, tax hook, router, launches)", () => deploy(API)))) return false;
  if (!(await check("SeedPool.s.sol (100% of COMD into the official COMD/ETH pool)", seedPool))) return false;
  if (!(await check("control plane up with real @company/services, COMD payments and the keeper", () => startApi(apiPort, o.apiEnv)))) return false;
  if (o.seats === false) return true;
  if (!(await check("6 free Counsel mints (phase public, price 0)", mintSeats))) return false;
  if (!(await check("ERC-8004 register(agentURI) + /agents/bind for 6 seats", registerAgents))) return false;
  if (!(await check("6 workers paired over HTTP (EIP-712 WorkerAuthorization, ownerOf)", pairWorkers))) return false;
  return true;
}

export function printResults(title: string, logsDir: string) {
  const w = Math.max(...results.map((r) => r.step.length));
  console.log(`\n${"=".repeat(w + 12)}\n ${title}  ${((Date.now() - t0) / 1000).toFixed(0)} s\n${"=".repeat(w + 12)}`);
  for (const r of results) console.log(` ${r.ok ? "PASS" : "FAIL"}  ${r.step.padEnd(w)}${r.ok ? "" : `\n        ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${"-".repeat(w + 12)}\n ${results.length - failed} passed, ${failed} failed · logs in ${logsDir}\n`);
  try { writeFileSync(path.join(RUN, "results.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2)); } catch { /* run dir gone */ }
  return failed;
}

async function main() {
  if (!(await bootStack())) return;
  if (!(await check("customer buys COMD via ComdRouter (5% ETH tax) and approves Permit2 once", buyComd))) return;
  await check("keeper: ComdTaxHook.flush() + Flywheel.buyback(minOut) burns COMD", keeperFlushBuyback);
  if (!(await check("x402 + Permit2 payments in COMD settled on chain to the RevenueRouter", payAll))) return;
  await check("premium routing (contract work → top-tier model at high effort)", premiumRouting);
  await check("research job + job.continue verified and delivered", researchAndContinue);
  await check("oracle: evidence chain reproduced, attestation verified on chain", oracleOnChain);
  await check("retainer: schedule.create 2 runs fired and completed", scheduleRuns);
  const launched = await check("launch.open custom_token deployed by the Registrar via ProjectFactory", launchDeployed);
  await check("keeper: RevenueRouter.distribute() 80% Counsel rewards / 20% treasury", revenueSplit);
  await check("Flywheel.sweep buys a listed Counsel through MockMarketplace", floorSweep);
  await check("reputation feedback batches on the ReputationRegistry", feedbackOnChain);
  await check("seat COMD reward root posted and claimed", seatRewards);
  await check("GET /flywheel matches the chain (tax, buckets, router, swept ids, events, keeper)", flywheelView);
  await check("web-facing read shapes (swarm, jobs, contributors, seats, art)", webShapes);
  // ---- chain time moves forward from here (no more Permit2 payments after this)
  if (launched) await check("contributor claims the swarm's share after the lock", contributorClaim);
  else record("contributor claims the swarm's share after the lock", false, "skipped: the launch did not go live");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let failed = 1;
  try {
    await main();
  } catch (e) {
    record("harness", false, (e as Error).stack?.split("\n").slice(0, 4).join(" ") ?? String(e));
  } finally {
    cleanup();
    failed = printResults(`COMPANY.MD — E2E ON ANVIL (chain ${CHAIN_ID})`, path.relative(process.cwd(), path.join(RUN, "logs")) || "e2e/.run/logs");
  }
  process.exit(failed ? 1 : 0);
}
