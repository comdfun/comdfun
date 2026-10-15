/**
 * The job board in a real browser, against a running API and website.
 *
 *   cd e2e && npm run e2e:board        (E2E_WEB=http://localhost:3000 E2E_API=http://localhost:8787 by default)
 *
 * Chromium gets an injected EIP-1193 wallet (EIP-6963 announce) answered in Node by a fresh viem account. The test
 * opens /jobs, connects, posts a job through the form (a signature, no gas), checks the API recorded it as posted by
 * that wallet, opens the job's page, and fails on any uncaught page error.
 *
 * Env: E2E_WEB, E2E_API, PLAYWRIGHT_MODULE (default `playwright`), CHROMIUM_PATH, E2E_SHOTS (a folder for screenshots).
 */
import { createRequire } from "node:module";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { toHex, type Hex } from "viem";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const WEB = (process.env.E2E_WEB || "http://localhost:3000").replace(/\/$/, "");
const API = (process.env.E2E_API || "http://localhost:8787").replace(/\/$/, "");
const SHOTS = process.env.E2E_SHOTS;
const CHAIN_ID = Number(process.env.E2E_CHAIN_ID || 4663);

const USER = privateKeyToAccount(generatePrivateKey());
let authorized = false;
const fail = (m: string) => { console.error(`FAIL ${m}`); process.exit(1); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.exposeFunction("__e2eWallet", async (json: string) => {
  const { method, params } = JSON.parse(json);
  try {
    let result: unknown = null;
    switch (method) {
      case "eth_requestAccounts": case "wallet_requestPermissions": authorized = true; result = method === "eth_requestAccounts" ? [USER.address] : [{ parentCapability: "eth_accounts" }]; break;
      case "eth_accounts": result = authorized ? [USER.address] : []; break;
      case "wallet_getPermissions": result = authorized ? [{ parentCapability: "eth_accounts" }] : []; break;
      case "eth_chainId": result = toHex(CHAIN_ID); break;
      case "net_version": result = String(CHAIN_ID); break;
      case "personal_sign": result = await USER.signMessage({ message: { raw: params[0] as Hex } }); break;
      case "wallet_switchEthereumChain": case "wallet_revokePermissions": result = null; break;
      case "eth_blockNumber": result = "0x1"; break;
      default: return JSON.stringify({ error: { code: 4200, message: `unsupported ${method}` } });
    }
    return JSON.stringify({ result });
  } catch (e) { return JSON.stringify({ error: { code: -32603, message: (e as Error).message } }); }
});
await ctx.addInitScript(`(() => {
  const provider = { request: async ({ method, params }) => { const j = JSON.parse(await window.__e2eWallet(JSON.stringify({ method, params: params ?? [] }))); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } return j.result; }, on() { return provider; }, removeListener() { return provider; } };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  const info = { uuid: "6f1c9a52-6c0e-4c4e-9a1e-2f7d0d3e2e2e", name: "Test Wallet", rdns: "fun.comd.test", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce); announce();
})();`);

const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e: Error) => errors.push(e.message));
const title = `Summarise this week's burns in one tweet ${Date.now().toString(36)}`;

await page.goto(`${WEB}/jobs`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Post a job" }).click();
await page.getByRole("button", { name: "Connect a wallet" }).first().click();
await page.getByRole("menuitem", { name: "Test Wallet" }).click();
await page.getByPlaceholder(/Write a five/).fill(title);
await page.getByPlaceholder("What done looks like, links, deadline.").fill("Under 280 characters, no emojis.");
await page.locator(".pj-unit input").fill("750");
await page.getByRole("button", { name: "Post the job" }).click();
await page.getByText(`Posted “${title}”.`).waitFor({ timeout: 20_000 });
if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-posted.png` });

const open = (await (await fetch(`${API}/board/jobs?status=open`)).json()) as { jobs: { id: string; title: string; reward: string; poster: { wallet: string } }[] };
const job = open.jobs.find((j) => j.title === title);
if (!job) fail("the posted job is not on the API");
if (job!.poster.wallet !== USER.address.toLowerCase()) fail("the job was not posted by the connected wallet");
if (job!.reward !== "750") fail(`reward ${job!.reward}`);
console.log(`PASS posted ${job!.id} through the form, signed by ${USER.address}`);

await page.goto(`${WEB}/jobs/${job!.id}`, { waitUntil: "networkidle" });
await page.getByText("Waiting for an agent").waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Cancel the job" }).waitFor();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-job.png` });
console.log("PASS the job page shows it open, with the poster's own actions");

if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
console.log("PASS no page errors");
await browser.close();
