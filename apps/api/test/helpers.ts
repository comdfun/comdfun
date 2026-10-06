/** Test harness: an in-process control plane on a random port with a mock chain, plus paired mock workers. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { generateDeviceKey, workerAuthorizationTypedData, type DeviceKeyPair } from "@company/protocol";
import { App } from "../src/app.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { MemoryStore } from "../src/store.ts";
import { MemoryBlobStore } from "../src/storage.ts";
import { MockServices, loadServices } from "../src/services.ts";
import { MockChain, MockWriter } from "../src/chain.ts";
import { MockSettler } from "../src/payments.ts";
import { Daemon, MockRuntime, type MockMode } from "@company/worker";

export interface Clock { now: () => number; advance(ms: number): void; set(ms: number): void }
export function clock(start = Date.now()): Clock {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (ms) => { t = ms; } };
}

export const COMD = "0x00000000000000000000000000000000000c0d0d" as const;
export const PAYTO = "0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e" as const;

export interface Harness {
  app: App;
  chain: MockChain;
  settler: MockSettler;
  writer: MockWriter;
  services: MockServices;
  url: string;
  clock: Clock | null;
  close(): Promise<void>;
}

export async function harness(o: { env?: Record<string, string>; clock?: Clock; fetch?: typeof fetch; listen?: boolean; realServices?: boolean; keeperPort?: import("../src/keeper.ts").KeeperPort | null } = {}): Promise<Harness> {
  const env: Record<string, string> = {
    CHAIN_ID: "46630", PUBLIC_API_URL: "http://127.0.0.1:0", SITES_DOMAIN: "sites.test", COMD_TOKEN: COMD, PAYTO_ADDRESS: PAYTO,
    COUNSEL_NFT: "0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0", IDENTITY_REGISTRY: "0x8004800480048004800480048004800480048004",
    READS_PER_MINUTE: "100000", PRICE_COMD: "100000000000000000000", HEARTBEAT_MS: "500", LAUNCH_CHAINS: "46630,4663", REWARD_EPOCH_POOL: "1000000000",
    ...(o.env ?? {}),
  };
  let cfg: Config = loadConfig(env);
  const chain = new MockChain(46630);
  const blobs = new MemoryBlobStore("http://127.0.0.1");
  const services = new MockServices({ store: blobs, sitesDomain: cfg.sitesDomain, attesterKey: generatePrivateKey() });
  const writer = new MockWriter();
  const settler = new MockSettler(writer.address);
  const real = o.realServices ? await loadServices({ store: blobs, sitesDomain: cfg.sitesDomain, githubOrg: cfg.githubOrg, attesterKey: generatePrivateKey(), env: cfg.storage }) : null;
  const app = await App.create({ cfg, store: new MemoryStore(), blobs, services: real ?? services, chain, writer, settler, now: o.clock?.now, fetch: o.fetch, timers: false, keeperPort: o.keeperPort ?? null });
  let url = "http://127.0.0.1";
  if (o.listen !== false) {
    const port = await app.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${port}`;
    (app.cfg as any).publicApiUrl = url;
  }
  const t = setInterval(() => app.engine.tick(), 50);
  t.unref();
  return { app, chain, settler, writer, services, url, clock: o.clock ?? null, async close() { clearInterval(t); await app.close(); } };
}

export interface Seat { tokenId: string; account: PrivateKeyAccount; key: DeviceKeyPair; agentId: string }

/** Mint (mock), pair through the HTTP routes, register + bind the ERC-8004 agent. */
export async function seat(h: Harness, tokenId: number, account: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey())): Promise<Seat> {
  h.chain.owners.set(String(tokenId), account.address);
  const key = generateDeviceKey();
  const start = await post(h, "/pair/start", { deviceKey: key.deviceKey });
  const message = { deviceKey: `0x${key.deviceKey}` as `0x${string}`, wallet: account.address, tokenId: String(tokenId), nonce: start.body.nonce, expiresAt: start.body.expiresAt, relayOrigin: start.body.relayOrigin };
  const signature = await account.signTypedData(workerAuthorizationTypedData(message, 46630) as any);
  const done = await post(h, "/pair/complete", { code: start.body.code, message, signature });
  if (done.status !== 200) throw new Error(`pair failed: ${JSON.stringify(done.body)}`);
  const agentId = h.chain.register(account.address, `${h.url}/agents/by-token/${tokenId}.json`);
  const b = await post(h, "/agents/bind", { tokenId: String(tokenId), agentId });
  if (b.status !== 200) throw new Error(`bind failed: ${JSON.stringify(b.body)}`);
  return { tokenId: String(tokenId), account, key, agentId };
}

export async function worker(h: Harness, s: Seat, o: { mode?: MockMode; premium?: boolean; concurrency?: number; delayMs?: number; skills?: string[]; tools?: Partial<Record<string, boolean>> } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), `company-w${s.tokenId}-`));
  // seats are premium (top-tier model at high effort) unless a test says otherwise: contract work needs it
  const runtime = new MockRuntime(o.mode ?? "honest", { premium: o.premium ?? true, delayMs: o.delayMs ?? 10 });
  const skills = o.skills ?? h.app.skills.all().filter((x) => x.role !== "reference").map((x) => x.id);
  const d = new Daemon({
    server: h.url, wsUrl: h.url.replace("http", "ws") + "/agent", tokenId: s.tokenId, key: s.key, runtime, skills, concurrency: o.concurrency ?? 2, home, version: "test",
    tools: { foundry: true, docker: false, image: true, audio: true, video: true, node: process.versions.node, ...(o.tools ?? {}) } as any,
  });
  await d.start();
  return d;
}

export async function post(h: Harness, p: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${h.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json, text, headers: r.headers };
}

export async function get(h: Harness, p: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${h.url}${p}`, { headers });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json, text, headers: r.headers };
}

export async function until<T>(fn: () => T | Promise<T>, what: string, timeoutMs = 10_000, everyMs = 20): Promise<NonNullable<T>> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export function job(h: Harness, id: string) {
  return h.app.store.c<any>("jobs").get(id);
}

import { randomUUID } from "node:crypto";
import { newRequestToken, signPayment, type PaymentRequired } from "@company/protocol";

/** quote → 402 challenge → sign Permit2 + QuoteApproval → paid submit. Returns every step for assertions. */
export async function pay(h: Harness, payer: PrivateKeyAccount, action: string, input: unknown, o: { token?: string; requestKey?: string; mutate?: (p: any, ch: PaymentRequired) => void | Promise<void> } = {}) {
  const token = o.token ?? newRequestToken();
  const auth = { authorization: `Bearer ${token}` };
  const quote = await post(h, "/requests/quote", { requestKey: o.requestKey ?? randomUUID(), action, input }, auth);
  if (quote.status !== 201 && quote.status !== 200) return { token, quote, challenge: null as any, submit: null as any };
  const id = quote.body.order.id;
  const challenge = await post(h, `/requests/${id}/submit`, {}, auth);
  const ch = challenge.body as PaymentRequired;
  const signed = await signPayment(ch, payer);
  if (o.mutate) await o.mutate(signed, ch);
  const submit = await post(h, `/requests/${id}/submit`, { quoteSignature: signed.quoteSignature }, { ...auth, "payment-signature": signed.header });
  return { token, quote, challenge, submit, signed, id };
}

import { request as httpRequest } from "node:http";
/** GET with an explicit Host header (fetch does not let callers set Host). */
export function getWithHost(h: Harness, host: string, p = "/"): Promise<{ status: number; body: string; headers: Record<string, any> }> {
  const u = new URL(h.url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: u.hostname, port: u.port, path: p, method: "GET", headers: { host } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

import { encodeHeaderJson, paymentHash, quoteApprovalTypedData } from "@company/protocol";
/** After mutating signed.payment, re-encode the header and re-sign the QuoteApproval over the new paymentHash. */
export async function resign(signed: any, ch: PaymentRequired, account: PrivateKeyAccount) {
  signed.header = encodeHeaderJson(signed.payment);
  const req = ch.accepts[0];
  signed.quoteSignature = await account.signTypedData(quoteApprovalTypedData({ resource: ch.resourceUrl, requesterScopeHash: `0x${ch.requesterScopeHash}`, quoteId: ch.quote.id, quoteHash: `0x${ch.quote.quoteHash}`, paymentHash: paymentHash(signed.payment), action: ch.quote.action, asset: req.asset, amount: req.amount, payTo: req.payTo, expiresAt: ch.quote.expiresAt }, Number(req.network.split(":")[1])) as any);
}
