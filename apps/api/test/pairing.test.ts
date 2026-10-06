import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { decodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { generateDeviceKey, makeSignedEnvelope, signFrame, workerAuthorizationTypedData } from "@company/protocol";
import { harness, seat, worker, post, get, until, type Harness } from "./helpers.ts";

async function startPair(h: Harness, deviceKey: string) {
  return (await post(h, "/pair/start", { deviceKey })).body;
}

describe("pairing, enrollments and ERC-8004 agents", () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h.close(); });

  test("start → page → complete with EIP-712 WorkerAuthorization and on-chain ownerOf", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    h.chain.owners.set("10", owner.address);
    const key = generateDeviceKey();
    const s = await startPair(h, key.deviceKey);
    assert.match(s.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.match(s.nonce, /^0x[0-9a-f]{64}$/);
    assert.equal(s.chainId, 46630);
    assert.equal(s.typedData.domain.name, "Company.md Worker");
    const page = await get(h, `/pair?code=${s.code}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Pair a seat/);
    const message = { deviceKey: `0x${key.deviceKey}`, wallet: owner.address, tokenId: "10", nonce: s.nonce, expiresAt: s.expiresAt, relayOrigin: s.relayOrigin };

    const stranger = privateKeyToAccount(generatePrivateKey());
    const wrongSig = await post(h, "/pair/complete", { code: s.code, message, signature: await stranger.signTypedData(workerAuthorizationTypedData(message as any, 46630) as any) });
    assert.equal(wrongSig.status, 401);
    assert.equal(wrongSig.body.error, "invalid_signature");

    const notOwnerMsg = { ...message, wallet: stranger.address };
    const notOwner = await post(h, "/pair/complete", { code: s.code, message: notOwnerMsg, signature: await stranger.signTypedData(workerAuthorizationTypedData(notOwnerMsg as any, 46630) as any) });
    assert.equal(notOwner.status, 403);
    assert.equal(notOwner.body.error, "not_owner");

    h.chain.failOwnerReads = true;
    const sig = await owner.signTypedData(workerAuthorizationTypedData(message as any, 46630) as any);
    const down = await post(h, "/pair/complete", { code: s.code, message, signature: sig });
    assert.equal(down.status, 503);
    h.chain.failOwnerReads = false;

    const ok = await post(h, "/pair/complete", { code: s.code, message, signature: sig });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.enrolled, true);
    assert.equal(ok.body.registered, false);
    assert.match(ok.body.registerIntent, /register-intent\?tokenId=10/);
    const again = await post(h, "/pair/complete", { code: s.code, message, signature: sig });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "code_consumed");
    assert.equal((await get(h, `/pair/${s.code}`)).body.enrolled, true);
    const enr = (await get(h, `/enrollments/${key.deviceKey}`)).body;
    assert.equal(enr.status, "active");
    assert.equal(enr.tokenId, "10");
    assert.equal((await get(h, `/enrollments/${"0".repeat(64)}`)).body.status, "unknown");
    const wallet = (await get(h, `/pair/wallet/${owner.address}?fresh=1`)).body;
    assert.deepEqual(wallet.seats.map((x: any) => [x.tokenId, x.enrolled]), [["10", true]]);

    // a second device for the same seat and wallet is refused (one active device per NFT)
    const key2 = generateDeviceKey();
    const s2 = await startPair(h, key2.deviceKey);
    const m2 = { ...message, deviceKey: `0x${key2.deviceKey}`, nonce: s2.nonce, expiresAt: s2.expiresAt };
    const dup = await post(h, "/pair/complete", { code: s2.code, message: m2, signature: await owner.signTypedData(workerAuthorizationTypedData(m2 as any, 46630) as any) });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, "token_enrolled");

    // register-intent calldata is IdentityRegistry.register(agentURI)
    const intent = (await get(h, "/agents/register-intent?tokenId=10")).body;
    const dec = decodeFunctionData({ abi: parseAbi(["function register(string agentURI)"]), data: intent.data });
    assert.equal(dec.args[0], `${h.url}/agents/by-token/10.json`);
    assert.equal(intent.to.toLowerCase(), h.app.cfg.identityRegistry!.toLowerCase());
    assert.equal((await post(h, "/agents/bind", { tokenId: "10", agentId: "999" })).status, 202, "not mined yet: pending");
    const wrongUri = h.chain.register(owner.address, "https://elsewhere/1.json");
    assert.equal((await post(h, "/agents/bind", { tokenId: "10", agentId: wrongUri })).body.error, "uri_mismatch");
    const strangers = h.chain.register(stranger.address, `${h.url}/agents/by-token/10.json`);
    assert.equal((await post(h, "/agents/bind", { tokenId: "10", agentId: strangers })).body.error, "not_owner");
    const agentId = h.chain.register(owner.address, `${h.url}/agents/by-token/10.json`);
    const b = await post(h, "/agents/bind", { tokenId: "10", agentId });
    assert.equal(b.status, 200);
    assert.equal(b.body.bound, true);

    const doc = (await get(h, "/agents/by-token/10.json")).body;
    assert.equal(doc.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    assert.match(doc.name, /^Counsel #0010$/);
    assert.equal(doc.x402Support, true, "work is retained through the firm's x402 endpoints");
    assert.ok(doc.services.some((s: { name: string; endpoint: string }) => s.name === "x402" && /\/requests\/quote$/.test(s.endpoint)), "x402 service endpoint listed");
    assert.equal(doc.active, true, "a device is paired, so the agent is active");
    assert.deepEqual(doc.supportedTrust, ["reputation"]);
    assert.equal(doc.registrations[0].agentRegistry, `eip155:46630:${h.app.cfg.identityRegistry!.toLowerCase()}`);
    assert.equal(doc.registrations[0].agentId, Number(agentId));
    assert.equal(doc.enrolled, true);
    assert.ok(Array.isArray(doc.attributes) && doc.attributes.length > 0);
    const svg = await get(h, "/agents/by-token/10.svg");
    assert.equal(svg.headers.get("content-type"), "image/svg+xml");
    assert.match(svg.text, /<svg/);
    const png = await fetch(`${h.url}/agents/by-token/10.png`, { redirect: "manual" });
    assert.ok(png.status === 200 || png.status === 302);
  });

  test("expired codes are refused with 410", async () => {
    const c = h.app.store.c<any>("pairings");
    const s = await startPair(h, generateDeviceKey().deviceKey);
    c.get(s.code).expiresAt = 1;
    const r = await post(h, "/pair/complete", { code: s.code, message: {}, signature: "0x" });
    assert.equal(r.status, 410);
    assert.equal(r.body.error, "pairing_expired");
  });

  test("WS /agent: unregistered seats and unenrolled devices are refused; revoke via signed envelope disconnects", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    h.chain.owners.set("20", owner.address);
    const key = generateDeviceKey();
    const s = await startPair(h, key.deviceKey);
    const message = { deviceKey: `0x${key.deviceKey}`, wallet: owner.address, tokenId: "20", nonce: s.nonce, expiresAt: s.expiresAt, relayOrigin: s.relayOrigin };
    await post(h, "/pair/complete", { code: s.code, message, signature: await owner.signTypedData(workerAuthorizationTypedData(message as any, 46630) as any) });
    const tryHello = (k = key, tokenId = "20") => new Promise<{ code: number; frames: any[] }>((resolve) => {
      const ws = new WebSocket(h.url.replace("http", "ws") + "/agent");
      const frames: any[] = [];
      ws.on("message", (d) => {
        const f = JSON.parse(String(d));
        frames.push(f);
        if (f.type === "challenge") ws.send(JSON.stringify(signFrame(k.privateKeyPem, k.deviceKey, f.nonce, { type: "hello", id: "h", seq: 1, ts: Date.now(), body: { nonce: f.nonce, tokenId, version: "t", runtime: { name: "mock", version: null, model: null, effort: null, premium: false }, concurrency: 1, skills: [], tools: {} } })));
        if (f.type === "welcome") ws.close(1000);
      });
      ws.on("close", (code) => resolve({ code, frames }));
    });
    const unreg = await tryHello();
    assert.equal(unreg.code, 4004);
    assert.ok(unreg.frames.some((f) => f.error === "not_registered"));
    const stranger = await tryHello(generateDeviceKey());
    assert.equal(stranger.code, 4003);
    const agentId = h.chain.register(owner.address, `${h.url}/agents/by-token/20.json`);
    await post(h, "/agents/bind", { tokenId: "20", agentId });
    const welcome = await tryHello();
    assert.ok(welcome.frames.some((f) => f.type === "welcome" && f.agentId === agentId));

    const env = makeSignedEnvelope(key, "enrollment.revoke", { deviceKey: key.deviceKey, reason: "test" });
    const r = await post(h, "/enrollments/revoke", env);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "revoked");
    const replay = await post(h, "/enrollments/revoke", env);
    assert.equal(replay.body.error, "nonce_reused");
    assert.equal((await tryHello()).code, 4003);
    const forged = { ...makeSignedEnvelope(generateDeviceKey(), "enrollment.revoke", {}), deviceKey: key.deviceKey };
    assert.equal((await post(h, "/enrollments/revoke", forged)).status, 401);
  });

  test("a transferred Counsel loses its device at the next connect", async () => {
    const s = await seat(h, 30);
    const w = await worker(h, s);
    await w.stop();
    h.chain.owners.set("30", privateKeyToAccount(generatePrivateKey()).address);
    h.app.store.c<any>("seats").get("30").ownerCheckedAt = 0;
    await assert.rejects(worker(h, s));
    await until(async () => (await get(h, `/enrollments/${s.key.deviceKey}`)).body.status === "revoked", "revocation");
  });
});
