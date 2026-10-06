/**
 * Company.md: the website, for real, with a wallet (V4 contracts).
 *
 *   cd e2e && npm run e2e:ui          (node --import tsx ui.ts)
 *
 * Boots the same local stack as run.ts (anvil 46630, Permit2, Deploy.s.sol + SeedPool.s.sol, Chambers with the real
 * services and the keeper, six paired mock-runtime seats), builds apps/web in LIVE mode against it (no
 * NEXT_PUBLIC_MOCK; API, RPC, chain 46630 and every contract address from the deployment) and starts it with
 * `next start`. Chromium gets an injected EIP-1193 wallet (window.ethereum + EIP-6963 announce) whose requests are
 * answered in Node by a viem wallet holding an anvil key, and the test drives the real pages:
 *
 *   connect · /mint free mint · /pair (CLI code → register ERC-8004 → sign WorkerAuthorization) · /swap buy COMD with
 *   ETH · /launch approve 1,000 COMD for Permit2, retain a Report (check → Permit2 + QuoteApproval in COMD → admitted →
 *   job completes) · request a ruling (evidence chain → sealed, attestation) · retainer · /flywheel shows the keeper's
 *   buyback-and-burn · /stake stake + unstake (sCOMD) · /incorporations create + buy with ETH + sell · /agents/[id]
 *   claim COMD seat rewards · /launches/[id] contributor claim after the lock · inventory trim (owner + time) → /bond
 *   enabled by the owner with `cast send`, bought with ETH
 *
 * Every step is asserted in the UI and on chain; screenshots go to e2e/screenshots/. Prints a PASS/FAIL table.
 *
 * Env: everything run.ts takes (ANVIL_BIN, FORGE_BIN, CAST_BIN, SOLC_PATH, …), plus PLAYWRIGHT_MODULE (default
 * `playwright`), CHROMIUM_PATH (default: Playwright's own browser), E2E_WEB_PORT (3210), E2E_RPC_PORT (8545),
 * E2E_API_PORT (8789), E2E_UI_REBUILD=1 to force a fresh `next build`, E2E_HEADED=1.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE_UI = path.dirname(fileURLToPath(import.meta.url));
process.env.E2E_RUN_DIR ??= path.join(HERE_UI, ".run-ui");
process.env.E2E_RPC_PORT ??= "8545";
process.env.E2E_API_PORT ??= "8789";
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 3210);
const WEB = `http://127.0.0.1:${WEB_PORT}`;

const R = await import("./run.ts");
const {
  ROOT, RUN, CHAIN_ID, PERMIT2, ADMIN, CUSTOMER, ADMIN_TOKEN, acct, pk, check, record, assert, until, sleep, background, cleanup, rpc, send, read, get, post, pay,
  bootStack, printResults, waitJob,
} = R;
const { createWalletClient, http, erc20Abi, getAddress, parseAbi, formatUnits, encodeFunctionData, toHex } = await import("viem");
const {
  counselNFTAbi, identityRegistryAbi, bondAbi, stakedComdAbi, incorporationsAbi, rewardDistributorAbi, comdRouterAbi, comdTaxHookAbi, flywheelAbi,
} = await import("@company/abi");
type Address = `0x${string}`;
type Hex = `0x${string}`;

const SHOTS = path.join(HERE_UI, "screenshots");
const USER = acct(12); // the person at the browser
const E18 = 10n ** 18n;

// ============================================================================================ playwright

async function loadPlaywright(): Promise<any> {
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean) as string[];
  const req = createRequire(import.meta.url);
  for (const t of tries) {
    try { return await import(t.startsWith("/") ? t : req.resolve(t)); } catch { /* next */ }
  }
  throw new Error("playwright not found: npm i -D playwright in e2e/ (or set PLAYWRIGHT_MODULE)");
}

// ============================================================================================ the wallet

const D = () => R.D;
const chainDef = () => ({ id: CHAIN_ID, name: "anvil-46630", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [R.RPC] } } }) as const;
const walletLog: string[] = [];

/** Turn the JSON typed data a dapp sends (bigints as strings) into what viem signs. */
function typedValue(types: Record<string, { name: string; type: string }[]>, type: string, v: any): any {
  const arr = /^(.*)\[(\d*)\]$/.exec(type);
  if (arr) return (v as any[]).map((x) => typedValue(types, arr[1], x));
  if (types[type]) return Object.fromEntries(types[type].map((f) => [f.name, typedValue(types, f.type, v?.[f.name])]));
  if (/^u?int\d*$/.test(type)) return BigInt(v);
  return v;
}

let authorized = false;
function makeWallet() {
  const w = createWalletClient({ account: USER, chain: chainDef(), transport: http(R.RPC) });
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => undefined); return p; };
  const big = (x: any) => (x === undefined || x === null ? undefined : BigInt(x));
  return async (json: string): Promise<string> => {
    const { method, params } = JSON.parse(json) as { method: string; params: any[] };
    try {
      let result: unknown;
      switch (method) {
        // like a real wallet: no accounts until the site asked once (then remembered across page loads)
        case "eth_requestAccounts": authorized = true; result = [USER.address]; break;
        case "eth_accounts": result = authorized ? [USER.address] : []; break;
        case "eth_chainId": result = toHex(CHAIN_ID); break;
        case "net_version": result = String(CHAIN_ID); break;
        case "wallet_switchEthereumChain": case "wallet_addEthereumChain": case "wallet_watchAsset": result = null; break;
        case "wallet_requestPermissions": authorized = true; result = [{ parentCapability: "eth_accounts" }]; break;
        case "wallet_getPermissions": result = authorized ? [{ parentCapability: "eth_accounts" }] : []; break;
        case "wallet_revokePermissions": authorized = false; result = null; break;
        case "personal_sign": result = await USER.signMessage({ message: { raw: params[0] as Hex } }); break;
        case "eth_signTypedData_v4": case "eth_signTypedData": {
          const td = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
          const { EIP712Domain: _d, ...types } = td.types;
          const domain = { ...td.domain, ...(td.domain.chainId !== undefined ? { chainId: Number(td.domain.chainId) } : {}) };
          result = await USER.signTypedData({ domain, types, primaryType: td.primaryType, message: typedValue(types, td.primaryType, td.message) } as any);
          walletLog.push(`signTypedData ${td.primaryType}`);
          break;
        }
        case "eth_sendTransaction": {
          const t = params[0];
          result = await serial(() => w.sendTransaction({ account: USER, chain: chainDef(), to: t.to, data: t.data ?? t.input, value: big(t.value), gas: big(t.gas) } as any));
          walletLog.push(`sendTransaction to ${t.to} ${String(t.data ?? "").slice(0, 10)}`);
          break;
        }
        default: result = await rpc(method, params ?? []);
      }
      return JSON.stringify({ result: result ?? null });
    } catch (e) {
      const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
      walletLog.push(`ERROR ${method}: ${m.split("\n")[0]}`);
      return JSON.stringify({ error: { code: (e as any).code ?? -32603, message: m } });
    }
  };
}

/** Injected before any page script: an EIP-1193 provider that forwards to Node, announced over EIP-6963. */
const INJECT = `(() => {
  const listeners = {};
  const provider = {
    isE2E: true,
    request: async ({ method, params }) => {
      const j = JSON.parse(await window.__e2eWallet(JSON.stringify({ method, params: params ?? [] })));
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
      return j.result;
    },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return provider; },
    removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); return provider; },
  };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  const info = { uuid: "6f1c9a52-6c0e-4c4e-9a1e-2f7d0d3e2e2e", name: "E2E Wallet", rdns: "fun.comd.e2e",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='%23C9A227'/%3E%3C/svg%3E" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

// ============================================================================================ web build + start

function newestMtime(dir: string): number {
  let m = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", ".next", ".next-e2e", "screenshots", "dist", "out"].includes(e.name) || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else m = Math.max(m, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return m;
}

function webEnv(): Record<string, string> {
  const d = D();
  return {
    NEXT_PUBLIC_API_URL: R.API, NEXT_PUBLIC_RPC_URL: R.RPC, NEXT_PUBLIC_CHAIN_ID: String(CHAIN_ID), NEXT_PUBLIC_SITES_DOMAIN: "sites.localhost",
    NEXT_PUBLIC_EXPLORER_URL: "http://127.0.0.1:1/explorer",
    NEXT_PUBLIC_COUNSEL_NFT: d.counselNFT, NEXT_PUBLIC_COMD_TOKEN: d.comdToken, NEXT_PUBLIC_PERMIT2: PERMIT2,
    NEXT_PUBLIC_COMD_ROUTER: d.comdRouter, NEXT_PUBLIC_COMD_TAX_HOOK: d.comdTaxHook, NEXT_PUBLIC_FLYWHEEL: d.flywheel, NEXT_PUBLIC_BUY_WALL: d.buyWall,
    NEXT_PUBLIC_STAKED_COMD: d.stakedComd, NEXT_PUBLIC_REWARD_DRIPPER: d.rewardDripper, NEXT_PUBLIC_BOND: d.bond,
    NEXT_PUBLIC_INCORPORATIONS: d.incorporations, NEXT_PUBLIC_INCORPORATIONS_FROM_BLOCK: "0", NEXT_PUBLIC_IDENTITY_REGISTRY: d.identityRegistry,
    NEXT_PUBLIC_REVENUE_ROUTER: d.revenueRouter, NEXT_PUBLIC_REWARD_DISTRIBUTOR: d.rewardDistributor, NEXT_PUBLIC_CONTRIBUTOR_DISTRIBUTOR: d.contributorDistributor,
  };
}

async function buildWeb() {
  const web = path.join(ROOT, "apps", "web");
  const env = { ...webEnv(), NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" };
  const key = createHash("sha256").update(JSON.stringify(env)).update(String(Math.max(newestMtime(web), newestMtime(path.join(ROOT, "packages", "abi", "src")), newestMtime(path.join(ROOT, "packages", "art", "src"))))).digest("hex");
  const stamp = path.join(web, ".next-e2e", "e2e-build.key");
  if (process.env.E2E_UI_REBUILD !== "1" && existsSync(stamp) && readFileSync(stamp, "utf8") === key) return "cached build (same env and sources)";
  const delEnv: Record<string, undefined> = { NEXT_PUBLIC_MOCK: undefined };
  const b = await R.run(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], { cwd: web, env: { ...env, ...delEnv, NODE_OPTIONS: "--max-old-space-size=3072" }, logName: "web-build.log" });
  assert(b.code === 0, `next build failed: ${b.out.slice(-800)}`);
  writeFileSync(stamp, key);
  return `next build (LIVE mode) → apps/web/.next-e2e`;
}

async function startWeb() {
  const web = path.join(ROOT, "apps", "web");
  background("web", process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], { cwd: web, env: { ...webEnv(), NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_MOCK: undefined, NODE_OPTIONS: "--max-old-space-size=2048" } });
  await until("web up", async () => (await fetch(`${WEB}/`)).status === 200, 120_000, 1000);
  return `${WEB} (API ${R.API}, RPC ${R.RPC}, chain ${CHAIN_ID})`;
}

/** Real chains predeploy Multicall3 at 0xcA11…CA11 (wagmi batches reads through it); anvil does not. */
async function multicall3() {
  const src = readFileSync(path.join(ROOT, "node_modules", "viem", "_esm", "constants", "contracts.js"), "utf8");
  const code = /multicall3Bytecode\s*=\s*'(0x[0-9a-f]+)'/.exec(src)?.[1];
  assert(code, "viem multicall3Bytecode not found");
  const w = createWalletClient({ account: ADMIN, chain: chainDef(), transport: http(R.RPC) });
  const hash = await w.deployContract({ abi: [], bytecode: code as Hex, account: ADMIN, chain: chainDef() } as any);
  const rc = await R.pub.waitForTransactionReceipt({ hash });
  const runtime = await R.pub.getCode({ address: rc.contractAddress! });
  await rpc("anvil_setCode", ["0xcA11bde05977b3631167028862bE2a173976CA11", runtime]);
  const bn = await R.pub.readContract({ address: "0xcA11bde05977b3631167028862bE2a173976CA11", abi: parseAbi(["function getBlockNumber() view returns (uint256)"]), functionName: "getBlockNumber" });
  return `Multicall3 at 0xcA11…CA11 (getBlockNumber ${bn})`;
}

// ============================================================================================ UI helpers

let browser: any, ctx: any, page: any;
let shotN = 0;
async function shot(name: string) {
  shotN++;
  const f = path.join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`);
  try { await page.screenshot({ path: f, fullPage: true }); } catch { try { await page.screenshot({ path: f }); } catch { /* page gone */ } }
  return path.relative(ROOT, f);
}
const consoleErrors: string[] = [];

async function open(p: string) {
  await page.goto(`${WEB}${p}`, { waitUntil: "domcontentloaded" });
  // hydrated: the header's connect button is enabled (it renders disabled until mounted)
  await page.locator("header .connect button:not([disabled])").first().waitFor({ timeout: 60_000 });
}

/** Run `step` and, PASS or FAIL, take a screenshot named after it. */
async function ui(step: string, name: string, fn: () => Promise<string | void>) {
  return check(step, async () => {
    try {
      const d = await fn();
      const f = await shot(name);
      return `${d ?? ""} [${f}]`;
    } catch (e) {
      const f = await shot(`${name}-FAIL`);
      const tail = walletLog.slice(-3).join(" | ");
      throw new Error(`${(e as Error).message.split("\n")[0]} [${f}]${tail ? ` wallet: ${tail}` : ""}${consoleErrors.length ? ` console: ${consoleErrors.slice(-2).join(" | ").slice(0, 300)}` : ""}`);
    }
  });
}

const btn = (name: string | RegExp) => page.getByRole("button", { name });
async function clickTx(name: string | RegExp, scope: any = page) {
  // the action buttons are .btn; segmented toggles with the same words ("Stake", "Buy") are not
  const b = scope.locator("button.btn").filter({ hasText: typeof name === "string" ? new RegExp(`^${name}$`) : name }).first();
  await b.waitFor({ timeout: 30_000 });
  await until(`"${name}" enabled`, async () => !(await b.isDisabled()), 60_000, 300);
  const before = walletLog.length;
  await b.click();
  await until(`wallet tx for "${name}"`, async () => walletLog.slice(before).some((l) => l.startsWith("sendTransaction")) || walletLog.slice(before).find((l) => l.startsWith("ERROR")) ? true : null, 60_000, 200);
  const err = walletLog.slice(before).find((l) => l.startsWith("ERROR eth_sendTransaction"));
  if (err) throw new Error(err);
}
async function waitText(t: string | RegExp, timeout = 60_000) {
  await page.getByText(t).first().waitFor({ timeout });
}
const comdOf = (a: Address) => read<bigint>(D().comdToken, erc20Abi, "balanceOf", [a]);
const sComdOf = (a: Address) => read<bigint>(D().stakedComd, stakedComdAbi, "balanceOf", [a]);
const chainNow = async () => Number((await R.pub.getBlock()).timestamp);
const fmt = (v: bigint, d = 18, p = 4) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: p });

// ============================================================================================ steps

let tokenId = 0;
let agentId = "";
let researchJob = "";
let launchId = "";

async function connect() {
  await open("/");
  await page.locator("header .connect").getByRole("button", { name: "Connect" }).click();
  const menu = page.locator("header .connect [role=menu]");
  await menu.waitFor();
  const names = await menu.getByRole("menuitem").allInnerTexts();
  const pick = names.find((n: string) => /E2E Wallet/i.test(n)) ?? names.find((n: string) => /Browser wallet/i.test(n));
  assert(pick, `no injected connector offered (${names.join(", ")})`);
  await menu.getByRole("menuitem", { name: new RegExp(pick, "i") }).click();
  const short = USER.address.slice(2, 6).toLowerCase();
  await until("header shows the address", async () => (await page.locator("header .connect").innerText()).toLowerCase().includes(short), 30_000, 300);
  await open("/mint"); // a reload keeps the connection (wagmi reconnect)
  await until("still connected after reload", async () => (await page.locator("header .connect").innerText()).toLowerCase().includes(short), 30_000, 300);
  return `connectors offered: ${names.join(" / ")}; connected ${USER.address} via "${pick}" and reconnected after a reload`;
}

async function mint() {
  await open("/mint");
  await waitText("Public");
  const before = await read<bigint>(D().counselNFT, counselNFTAbi, "balanceOf", [USER.address]);
  await clickTx(/Free mint · 1 seat/);
  await waitText("Filed.");
  const after = await read<bigint>(D().counselNFT, counselNFTAbi, "balanceOf", [USER.address]);
  assert(after === before + 1n, `balanceOf ${after}`);
  const logs = await R.pub.getContractEvents({ address: D().counselNFT, abi: counselNFTAbi, eventName: "Transfer", args: { to: USER.address }, fromBlock: 0n });
  tokenId = Number((logs.at(-1) as any).args.tokenId);
  assert(tokenId >= 1 && tokenId <= 2000, `token id ${tokenId}`);
  assert(getAddress(await read(D().counselNFT, counselNFTAbi, "ownerOf", [BigInt(tokenId)])) === USER.address, "ownerOf");
  return `minted Counsel #${tokenId} (free) — "Filed." shown`;
}

let uiWorker: { code?: string; url?: string } = {};
async function pairSeat() {
  const home = path.join(RUN, "worker-ui");
  rmSync(home, { recursive: true, force: true });
  const forgeDir = path.dirname(R.FORGE);
  background("worker-ui", process.execPath, ["--import", "tsx", path.join(ROOT, "apps", "worker", "src", "cli.ts"), "start", "--runtime", "mock", "--concurrency", "2", "--server", R.API, "--home", home], {
    cwd: path.join(ROOT, "apps", "worker"),
    env: { PATH: `${forgeDir}:${process.env.PATH}`, COMD_MOCK_AS: "claude", COMD_MOCK_MODEL: "claude-opus-5-5", COMD_MOCK_EFFORT: "high", COMD_MOCK_DELAY_MS: "200", GITHUB_TOKEN: undefined },
    onLine: (l) => { const m = /Code ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(l); if (m) uiWorker.code = m[1]; const u = /Open (\S+)/.exec(l); if (u) uiWorker.url = u[1]; },
  });
  const code = await until("CLI pairing code", async () => uiWorker.code, 60_000, 200);
  await open(`/pair?code=${code}`);
  await waitText(/Device /);
  await page.getByRole("radio", { name: new RegExp(`#${String(tokenId).padStart(4, "0")}`) }).first().click().catch(() => undefined);
  await clickTx("Register agent");
  await waitText(/Registered as agent/, 90_000);
  agentId = (await page.getByText(/Registered as agent/).first().innerText()).match(/agent (\d+)/)![1];
  const sigs = walletLog.length;
  await btn("Sign and bind").click();
  await waitText("Seated.", 60_000);
  assert(walletLog.slice(sigs).some((l) => l === "signTypedData WorkerAuthorization"), "WorkerAuthorization signed in the wallet");
  assert(getAddress(await read(D().identityRegistry, identityRegistryAbi, "ownerOf", [BigInt(agentId)])) === USER.address, "IdentityRegistry.ownerOf(agentId)");
  const online = await until("seat online in /workers", async () => ((await get("/workers")).body.workers as any[]).find((w) => Number(w.tokenId) === tokenId), 90_000, 1000);
  const seat = (await get(`/seats/${tokenId}`)).body;
  return `CLI printed ${code} (${uiWorker.url ?? "no url"}); registered agent ${agentId} (ERC-8004), signed WorkerAuthorization, "Seated."; /workers shows #${tokenId} ${online.runtime?.name}/${online.model}/${online.effort}${seat.premium ? " premium" : ""}`;
}

/** The customer (API-side payer) buys COMD and approves Permit2 so a launch can be paid in the background. */
let launchJob = "";
async function startLaunch() {
  const deadline = BigInt((await chainNow()) + 3600);
  await send(7, D().comdRouter, comdRouterAbi, "swapExactETHForComd", [0n, CUSTOMER.address, deadline], E18 / 2n);
  await send(7, D().comdToken, erc20Abi, "approve", [PERMIT2, 1_000n * E18]);
  const p = await pay("launch.open", {
    objective: "Launch $DOCKET, a fixed-supply token for the Company.md UI e2e, through ProjectFactory.",
    skill: "build-contract-project", onchain: "custom_token", chainId: CHAIN_ID, pairWith: "eth",
    economics: { poolBps: 8800, initialMarketCapWei: "10000000000000000000", remainderTo: CUSTOMER.address.toLowerCase() },
  });
  launchJob = p.result.jobId;
  return `customer bought COMD, approved Permit2, paid launch.open in COMD (job ${launchJob.slice(0, 8)}); runs in the background`;
}

async function swap() {
  await open("/swap");
  const c0 = await comdOf(USER.address);
  const taxed0 = await read<bigint>(D().comdTaxHook, comdTaxHookAbi, "totalTaxed");
  await page.locator("#swap-in").fill("1");
  await until("quote", async () => !/—/.test(await page.getByText(/You receive, after the tax/).locator("..").innerText()), 30_000, 500);
  await waitText(/2\.5% buyback & burn · 2\.5% Counsel floor sweeps/);
  await clickTx(/^Buy \$COMD$/);
  await waitText("Filed.", 60_000);
  await until("COMD arrived", async () => (await comdOf(USER.address)) > c0, 30_000, 500);
  const c1 = await comdOf(USER.address);
  const tax = (await read<bigint>(D().comdTaxHook, comdTaxHookAbi, "totalTaxed")) - taxed0;
  assert(tax === E18 / 20n, `5% tax in ETH (${tax})`);
  return `bought ${fmt(c1 - c0, 18, 0)} COMD for 1 ETH through ComdRouter; hook took ${fmt(tax)} ETH tax`;
}

async function approveComd() {
  await open("/launch");
  await waitText(/First, one approval\. It lets Permit2 move up to 1,000 COMD/);
  await clickTx(/^Approve 1,000 COMD$/);
  await waitText(/Approved\./, 60_000);
  const allowance = await read<bigint>(D().comdToken, erc20Abi, "allowance", [USER.address, PERMIT2]);
  assert(allowance === 1_000n * E18, `Permit2 allowance ${allowance}`);
  return `Permit2 allowance 1,000 COMD on chain; page says "Approved."`;
}

async function checkAndPay(): Promise<string> {
  await btn(/^Check$/).first().click();
  await waitText(/Nothing would stop this request/, 90_000);
  const c0 = await comdOf(USER.address);
  const sigs = walletLog.length;
  const payBtn = btn(/^Pay .* COMD$/);
  await until("Pay enabled", async () => !(await payBtn.isDisabled()), 30_000, 300);
  await payBtn.click();
  await waitText(/Admitted/, 180_000);
  const signed = walletLog.slice(sigs).filter((l) => l.startsWith("signTypedData")).join(", ");
  assert(/PermitWitnessTransferFrom/.test(signed) && /QuoteApproval/.test(signed), `wallet signed ${signed}`);
  const c1 = await comdOf(USER.address);
  assert(c0 - c1 >= 100n * E18, `COMD moved ${c0 - c1}`);
  const href = await page.getByRole("link", { name: /Open it on the docket/ }).getAttribute("href");
  assert(href, "docket link");
  return href!;
}

async function retainReport() {
  await open("/launch");
  await page.getByRole("radio", { name: /Report/ }).click();
  await page.locator("#objective").fill("Research report: how do x402 Permit2 payments in COMD settle on Robinhood Chain, and what does the payer sign? Cite sources.");
  const href = await checkAndPay();
  assert(href.startsWith("/jobs/"), `result ${href}`);
  researchJob = href.split("/")[2];
  await shot("retain-report-admitted");
  await page.getByRole("link", { name: /Open it on the docket/ }).click();
  await page.waitForURL(`**${href}`);
  await until("job page shows the matter on the record", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    return (await page.getByText("On the record").count()) > 0;
  }, 300_000, 4000);
  const j = (await get(`/jobs/${researchJob}`)).body;
  assert(j.state === "completed", `job ${j.state}`);
  return `Report tile → Check → Pay (Permit2 + QuoteApproval signed, 100 COMD moved) → Admitted → /jobs/${researchJob.slice(0, 8)} reached "On the record" (${j.nodes.length} nodes)`;
}

async function ruling() {
  await open("/launch");
  await page.getByRole("radio", { name: /Request a ruling/ }).click();
  const supply = await read<bigint>(D().counselNFT, counselNFTAbi, "MAX_SUPPLY");
  const recipe = { kind: "eth-call", to: D().counselNFT, data: encodeFunctionData({ abi: counselNFTAbi, functionName: "MAX_SUPPLY" }), decode: "uint256" };
  await page.getByLabel("The question").fill("What is MAX_SUPPLY of the Company.md Counsel collection, read on chain at the end of the window?");
  await page.getByLabel("Answer type").selectOption("uint256");
  await btn("Add definition").click();
  await btn("Add definition").click();
  await page.getByLabel("Definition 1 key").fill("mock.answer");
  await page.getByLabel("Definition 1 meaning").fill(supply.toString());
  await page.getByLabel("Definition 2 key").fill("mock.recipe");
  await page.getByLabel("Definition 2 meaning").fill(JSON.stringify(recipe));
  const href = await checkAndPay();
  assert(href.startsWith("/oracle/"), `result ${href}`);
  const id = href.split("/")[2];
  await page.goto(`${WEB}${href}`);
  await until("ruling sealed", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    return (await page.getByText("Attestation (EIP-712)").count()) > 0 && (await page.locator(".seal").count()) > 0;
  }, 300_000, 4000);
  const att = (await get(`/oracle/requests/${id}/attestation`)).body;
  assert(att.signature && BigInt(att.tuple[5]) === supply, `attested figure ${att.tuple?.[5]} != ${supply}`);
  return `ruling ${id.slice(0, 8)} (evidence chain, eth_call MAX_SUPPLY) → wax seal + attestation on the page; signer ${att.signer.slice(0, 10)}…, figure ${supply}`;
}

async function retainer() {
  await open("/launch");
  await page.getByRole("radio", { name: /^Retainer/ }).click();
  await btn("Opens a matter").click();
  await page.getByLabel("Interval").selectOption("PT30M");
  await page.locator("#runs").fill("2");
  await page.locator("#label").fill("e2e weekly note");
  await page.locator("#ret-obj").fill("Retainer: a short research note on COMD liquidity on Robinhood Chain, with sources.");
  const href = await checkAndPay();
  assert(href.startsWith("/heartbeats/"), `result ${href}`);
  const id = href.split("/")[2];
  await page.goto(`${WEB}${href}`);
  await waitText("e2e weekly note");
  const s = (await get(`/schedules/${id}`)).body;
  assert(s.runs?.total === 2 || s.runsTotal === 2 || s.runs === 2 || JSON.stringify(s).includes('"total":2'), `schedule ${JSON.stringify(s).slice(0, 200)}`);
  return `retainer ${id.slice(0, 8)} (2 runs × every 30 min, opens a matter) admitted; /heartbeats page shows its label; status ${s.status}`;
}

/** The keeper's buyback-and-burn shows up on /flywheel (stat + event feed), read live through GET /flywheel. */
async function flywheelPage() {
  const burned = await until("keeper buyback burned COMD", async () => { const b = await read<bigint>(D().flywheel, flywheelAbi, "totalBurned"); return b > 0n ? b : null; }, 180_000, 1000);
  await open("/flywheel");
  await until("buyback on the page", async () => {
    if ((await page.getByText(/bought [\d,]+ \$COMD and burned it/).count()) > 0) return true;
    await sleep(3000);
    await page.reload({ waitUntil: "domcontentloaded" });
    return false;
  }, 120_000, 500);
  await waitText(/The tax wheel/);
  await waitText(/The capped pool/);
  const line = await page.getByText(/bought [\d,]+ \$COMD and burned it/).first().innerText();
  return `Flywheel.totalBurned ${fmt(burned, 18, 0)} COMD on chain; /flywheel shows both engines and "${line.trim()}"`;
}

async function stake() {
  await open("/stake");
  await page.locator("#stake-in").waitFor();
  const s0 = await sComdOf(USER.address);
  const inp = page.locator("#stake-in");
  const action = page.locator("button.btn").filter({ hasText: /^(Approve COMD|Stake COMD)$/ });
  // the wallet reconnects after the page hydrates; keep the amount in until the action button is live
  await until("amount entered", async () => {
    if ((await inp.inputValue()) !== "100") await inp.fill("100");
    return (await action.count()) > 0 && !(await action.first().isDisabled()) && (await inp.inputValue()) === "100";
  }, 60_000, 500);
  if ((await read<bigint>(D().comdToken, erc20Abi, "allowance", [USER.address, D().stakedComd])) < 100n * E18) {
    await clickTx(/^Approve COMD$/);
    await until("vault allowance", async () => (await read<bigint>(D().comdToken, erc20Abi, "allowance", [USER.address, D().stakedComd])) >= 100n * E18, 60_000, 500);
  }
  await clickTx(/^Stake COMD$/);
  await until("sCOMD minted", async () => (await sComdOf(USER.address)) > s0, 60_000, 500);
  const s1 = await sComdOf(USER.address);
  await shot("stake-staked");
  await page.getByRole("group", { name: "Direction" }).getByRole("button", { name: "Unstake" }).click();
  await until("Max shows", async () => (await page.getByRole("button", { name: "Max" }).count()) > 0, 30_000, 500);
  await page.getByRole("button", { name: "Max" }).click();
  const c0 = await comdOf(USER.address);
  await clickTx(/^Unstake$/);
  await until("sCOMD redeemed", async () => (await sComdOf(USER.address)) === 0n, 60_000, 500);
  const c1 = await comdOf(USER.address);
  assert(c1 - c0 >= 99n * E18, `redeemed ${c1 - c0}`);
  return `staked 100 COMD → ${fmt(s1 - s0, 24, 2)} sCOMD (24 decimals); unstaked all → ${fmt(c1 - c0, 18, 4)} COMD back`;
}

async function incorporate() {
  await open("/incorporations");
  await page.locator("#cn").fill("Habeas Corpus");
  await page.locator("#cs").fill("HABEAS");
  await page.locator("#cd").fill("A company coin filed by the e2e test.");
  await clickTx("Incorporate");
  await waitText("Filed.", 60_000);
  const n = await read<bigint>(D().incorporations, incorporationsAbi, "coinCount");
  const coin = getAddress(await read<Address>(D().incorporations, incorporationsAbi, "coins", [n - 1n]));
  await until("coin listed", async () => (await page.getByText("$HABEAS").count()) > 0 || (await page.reload(), false), 60_000, 1500);
  await shot("incorporations-listed");
  await page.getByText("$HABEAS").first().click();
  await page.waitForURL(`**/incorporations/${coin}`, { timeout: 30_000 }).catch(async () => { await open(`/incorporations/${coin}`); });
  await waitText("$HABEAS");
  await page.locator("#inc-amt").fill("0.05");
  await until("buy quote", async () => !/about\s*—/.test(await page.getByText(/You receive about/).innerText()), 30_000, 500);
  await clickTx(/^Buy$/);
  await until("coins bought", async () => (await read<bigint>(coin, erc20Abi, "balanceOf", [USER.address])) > 0n, 60_000, 500);
  const bought = await read<bigint>(coin, erc20Abi, "balanceOf", [USER.address]);
  await shot("incorporation-bought");
  await page.getByRole("group", { name: "Buy or sell" }).getByRole("button", { name: "Sell" }).click();
  const half = bought / 2n;
  await page.locator("#inc-amt").fill(formatUnits(half, 18));
  await until("sell quote", async () => !/about\s*—/.test(await page.getByText(/You receive about/).innerText()), 30_000, 500);
  const approve = btn(/^Approve$/);
  if (await approve.count()) { await clickTx(/^Approve$/); await until("approve mined", async () => (await btn(/^Sell$/).count()) > 0, 60_000, 500); }
  const eth0 = await R.pub.getBalance({ address: USER.address });
  await clickTx(/^Sell$/);
  await until("coins sold", async () => (await read<bigint>(coin, erc20Abi, "balanceOf", [USER.address])) < bought, 60_000, 500);
  const left = await read<bigint>(coin, erc20Abi, "balanceOf", [USER.address]);
  const trades = await R.pub.getContractEvents({ address: D().incorporations, abi: incorporationsAbi, eventName: "Trade", args: { coin }, fromBlock: 0n });
  return `created $HABEAS ${coin}; bought ${formatUnits(bought, 18).split(".")[0]} with 0.05 ETH; sold ${formatUnits(bought - left, 18).split(".")[0]} for ETH (balance Δ ${formatUnits((await R.pub.getBalance({ address: USER.address })) - eth0, 18).slice(0, 10)}); ${trades.length} Trade events`;
}

async function claimSeatRewards() {
  // the seat has worked; close epochs and post roots (the settler), then the holder claims COMD on the agent page
  const posted = await until("a COMD epoch with this seat posted", async () => {
    const r = await post("/admin/settle", {}, { authorization: `Bearer ${ADMIN_TOKEN}` });
    for (const e of r.body?.epochs ?? []) for (const a of e.assets ?? []) if (a.status === "posted" && a.symbol === "COMD") {
      const ep = (await get(`/rewards/epochs/${e.epoch}`)).body;
      const as = ep.assets?.find((x: any) => x.symbol === "COMD");
      if (as?.entries?.some((x: any) => Number(x.tokenId) === tokenId)) return { epoch: e.epoch as number };
    }
    return null;
  }, 300_000, 5000);
  await open(`/agents/${tokenId}`);
  await waitText("Claim counsel rewards");
  await waitText(/4\.5% of every COMD the pool trims and 80% of every job payment/);
  const box = page.locator(".folder", { hasText: "Claim counsel rewards" });
  const claimBtns = box.getByRole("button", { name: /^Claim/ });
  await until("claim buttons", async () => (await claimBtns.count()) > 0, 60_000, 1000);
  const n = await claimBtns.count();
  const c0 = await comdOf(USER.address);
  for (let i = 0; i < n; i++) {
    const b = box.getByRole("button", { name: /^Claim/ }).first();
    if (!(await b.count())) break;
    const before = walletLog.length;
    await b.click();
    await until("claim tx", async () => walletLog.slice(before).some((l) => l.startsWith("sendTransaction") || l.startsWith("ERROR")), 60_000, 200);
    const err = walletLog.slice(before).find((l) => l.startsWith("ERROR"));
    if (err) throw new Error(err);
    await sleep(1500);
  }
  await until("claims mined", async () => (await comdOf(USER.address)) > c0, 60_000, 500);
  const dc = (await comdOf(USER.address)) - c0;
  const claimed = await read<boolean>(D().rewardDistributor, rewardDistributorAbi, "claimed", [BigInt(posted.epoch), BigInt(tokenId)]);
  assert(claimed, `RewardDistributor.claimed(${posted.epoch}, ${tokenId})`);
  return `${n} claim(s) on /agents/${tokenId}: +${fmt(dc, 18, 4)} COMD; epoch ${posted.epoch} claimed on chain`;
}

async function contributorClaim() {
  const j = await waitJob(launchJob, "launch job", 900_000);
  launchId = j.launch.id;
  const l = (await get(`/launches/${launchId}?claims=1`)).body;
  assert(l.status === "live", `launch ${l.status}`);
  const view = (await get(`/launches/${launchId}/claims/${USER.address}`)).body;
  assert(view.eligible, "the browser's seat was connected in the window, so its wallet has a share");
  await rpc("evm_increaseTime", [3601]);
  await rpc("evm_mine", []);
  await open(`/launches/${launchId}`);
  await waitText("Claim your share");
  await btn("Look up my claim").click();
  const box = page.locator(".folder", { hasText: "Claim your share" });
  await box.getByRole("button", { name: /^Claim$/ }).waitFor({ timeout: 30_000 });
  const token = getAddress(l.token.address);
  const b0 = await read<bigint>(token, erc20Abi, "balanceOf", [USER.address]);
  await clickTx(/^Claim$/, box);
  await waitText(/Filed:/, 60_000);
  await until("claim mined", async () => (await read<bigint>(token, erc20Abi, "balanceOf", [USER.address])) > b0, 60_000, 500);
  const b1 = await read<bigint>(token, erc20Abi, "balanceOf", [USER.address]);
  assert(b1 - b0 === BigInt(view.amount), `claimed ${b1 - b0} != ${view.amount}`);
  return `/launches/${launchId.slice(0, 8)} ($${l.token.symbol}, on-chain launch ${view.launchId}) → Look up → Claim after evm_increaseTime 3601 → +${formatUnits(b1 - b0, 18).split(".")[0]} ${l.token.symbol}`;
}

/**
 * Inventory trim (fills the Bond reserve): the owner buys COMD, lowers the cap decay (setParams within bounds), time
 * passes so the cap ratchets to the inventory, and a sell pushes inventory above the cap → the hook trims 85/6/4.5/4.5.
 */
async function hookTrim() {
  const H = D().comdTaxHook;
  const SELL = 20_000_000n * E18;
  const deadline = () => chainNow().then((t) => BigInt(t + 3600));
  await send(0, D().comdRouter, comdRouterAbi, "swapExactETHForComd", [0n, ADMIN.address, await deadline()], 3n * E18);
  const p: any = await read(H, comdTaxHookAbi, "params");
  await send(0, H, comdTaxHookAbi, "setParams", [{ capFloor: 1_000n * E18, capDecayPerDay: 1_000_000n * E18, burnBps: p.burnBps, bondBps: p.bondBps, stakersBps: p.stakersBps, seatsBps: p.seatsBps, refStepTicks: p.refStepTicks }]);
  const cap = await read<bigint>(H, comdTaxHookAbi, "cap");
  const lastInv = await read<bigint>(H, comdTaxHookAbi, "lastInventory");
  const days = cap > lastInv ? Number((cap - lastInv) / (1_000_000n * E18)) + 2 : 1;
  await rpc("evm_increaseTime", [days * 86_400]);
  await rpc("evm_mine", []);
  const st0: any = await read(H, comdTaxHookAbi, "stats");
  const bond0 = await read<bigint>(D().bond, bondAbi, "reserve");
  await send(0, D().comdToken, erc20Abi, "approve", [D().comdRouter, SELL]);
  await send(0, D().comdRouter, comdRouterAbi, "swapExactComdForETH", [SELL, 0n, ADMIN.address, await deadline()]);
  const st1: any = await read(H, comdTaxHookAbi, "stats");
  const d = (k: string) => BigInt(st1[k]) - BigInt(st0[k]);
  assert(d("trimmedComd") > 0n, "no trim");
  const reserve = await read<bigint>(D().bond, bondAbi, "reserve");
  assert(reserve - bond0 === d("toBond") && reserve > 0n, `Bond reserve ${reserve}`);
  return `owner bought 3 ETH of COMD, setParams(cap decay 1M/day), +${days} days, sold 20,000,000 COMD → trimmed ${fmt(d("trimmedComd"), 18, 0)} COMD: burn ${fmt(d("burned"), 18, 0)} / Bond ${fmt(d("toBond"), 18, 0)} / stakers ${fmt(d("toStakers"), 18, 0)} / seats ${fmt(d("toSeats"), 18, 0)}`;
}

async function bond() {
  // the owner opens the bond from the command line, as an operator would
  const r = await R.run(R.CAST, ["send", D().bond, "setEnabled(bool)", "true", "--private-key", pk(0), "--rpc-url", R.RPC], { logName: "cast-bond.log" });
  assert(r.code === 0, `cast send setEnabled failed: ${r.out.slice(-300)}`);
  assert(await read<boolean>(D().bond, bondAbi, "enabled"), "Bond.enabled()");
  await open("/bond");
  await until("bond shows Open", async () => (await page.locator(".stat", { hasText: "Status" }).innerText()).includes("Open"), 60_000, 1000);
  const c0 = await comdOf(USER.address);
  const ethIn = E18 / 10_000n;
  const quoted = await read<bigint>(D().bond, bondAbi, "quote", [ethIn]);
  await page.locator("#bond-in").fill(formatUnits(ethIn, 18));
  await until("bond quote", async () => !/—/.test(await page.getByText(/You receive, at the fixed price/).locator("..").innerText()), 30_000, 500);
  await clickTx(/^Bond ETH$/);
  await until("bonded", async () => (await comdOf(USER.address)) > c0, 60_000, 500);
  const got = (await comdOf(USER.address)) - c0;
  assert(got === quoted, `got ${got} != quote ${quoted}`);
  const ev = await R.pub.getContractEvents({ address: D().bond, abi: bondAbi, eventName: "Bonded", args: { buyer: USER.address }, fromBlock: 0n });
  assert(ev.length === 1, "Bonded(buyer = browser wallet)");
  return `\`cast send setEnabled(true)\` by the owner; /bond shows Open; paid ${formatUnits(ethIn, 18)} ETH → ${fmt(got, 18, 2)} COMD (= quote(ethIn)); Bonded event`;
}

// ============================================================================================ main

async function main() {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  if (!(await bootStack({ apiEnv: { PUBLIC_WEB_URL: WEB, ALLOWED_ORIGINS: WEB } }))) return;
  if (!(await check("Multicall3 at its canonical address (as on Robinhood Chain)", multicall3))) return;
  if (!(await check("apps/web built in LIVE mode for the local stack", buildWeb))) return;
  if (!(await check("apps/web started (next start)", startWeb))) return;

  const pw = await loadPlaywright();
  const chromium = pw.chromium ?? pw.default?.chromium;
  const exe = process.env.CHROMIUM_PATH || undefined;
  browser = await chromium.launch({ executablePath: exe, headless: process.env.E2E_HEADED !== "1", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.exposeFunction("__e2eWallet", makeWallet());
  await ctx.addInitScript(INJECT);
  page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on("console", (m: any) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e: Error) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));

  if (!(await ui("connect the injected wallet (EIP-6963)", "connect", connect))) return;
  const minted = await ui("/mint: free mint 1 Counsel", "mint", mint);
  const paired = minted && (await ui("/pair: CLI code → register ERC-8004 → sign WorkerAuthorization → seated", "pair", pairSeat));
  const launching = paired && (await check("launch.open paid in COMD (background) for the contributor claim", startLaunch));
  const bought = await ui("/swap: buy COMD with ETH (5% tax in ETH)", "swap", swap);
  const approved = bought && (await ui("/launch: approve 1,000 COMD for Permit2", "launch-approve", approveComd));
  if (approved) {
    await ui("/launch: retain a Report → check → pay in COMD → admitted → job completed", "retain-report", retainReport);
    await ui("/launch: request a ruling (evidence chain) → sealed + attestation", "ruling", ruling);
    await ui("/launch: retainer created", "retainer", retainer);
  } else for (const s of ["/launch: retain a Report → check → pay in COMD → admitted → job completed", "/launch: request a ruling (evidence chain) → sealed + attestation", "/launch: retainer created"]) record(s, false, "skipped: no COMD approval");
  await ui("/flywheel: keeper buyback-and-burn shown (both engines)", "flywheel", flywheelPage);
  if (bought) await ui("/stake: stake 100 COMD → sCOMD, unstake all", "stake", stake);
  else record("/stake: stake 100 COMD → sCOMD, unstake all", false, "skipped: no COMD");
  await ui("/incorporations: create a coin, buy with ETH, sell", "incorporations", incorporate);
  if (paired) await ui("/agents/[id]: claim COMD counsel rewards after an epoch is posted", "agent-claim", claimSeatRewards);
  else record("/agents/[id]: claim COMD counsel rewards after an epoch is posted", false, "skipped: no paired seat");
  if (launching) await ui("/launches/[id]: contributor claim after the lock", "launch-claim", contributorClaim);
  else record("/launches/[id]: contributor claim after the lock", false, "skipped: launch not started");
  // ---- below moves chain time forward by days (no Permit2 payments after this point)
  const trimmed = await check("inventory trim (owner + time + a sell) fills the Bond reserve", hookTrim);
  if (trimmed) await ui("/bond: owner enables with cast, buy COMD with ETH", "bond", bond);
  else record("/bond: owner enables with cast, buy COMD with ETH", false, "skipped: empty reserve");
}

let failed = 1;
try {
  await main();
} catch (e) {
  record("harness", false, (e as Error).stack?.split("\n").slice(0, 4).join(" ") ?? String(e));
} finally {
  try { await browser?.close(); } catch { /* closed */ }
  cleanup();
  failed = printResults(`COMPANY.MD — WEBSITE E2E WITH A WALLET (chain ${CHAIN_ID}) · screenshots in e2e/screenshots`, path.relative(process.cwd(), path.join(RUN, "logs")) || "e2e/.run-ui/logs");
}
process.exit(failed ? 1 : 0);
