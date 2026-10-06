/** Regressions found by the anvil e2e (e2e/run.ts) and web-shape contracts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { generateDeviceKey, workerAuthorizationTypedData } from "@company/protocol";
import { validateLaunchManifest } from "@company/services";
import { harness, post, get } from "./helpers.ts";
import { launchManifest, launchScript } from "../src/launch-template.ts";

test("identical bundles uploaded concurrently by two leases are attached to both (panel members agreeing)", async () => {
  const h = await harness({ listen: false });
  try {
    const dev: any = h.app.device;
    // stand-ins for the envelope checks: each call names its own lease
    dev.auth = (body: any) => ({ env: { payload: body.payload }, enrollment: { tokenId: body.tokenId } });
    dev.lease = (leaseId: string, enr: any) => ({ leaseId, jobId: "j", nodeKey: leaseId, tokenId: enr.tokenId, deviceKey: `d-${leaseId}` });
    // a slow blob store widens the window in which both uploads miss each other
    const put = h.app.blobs.put.bind(h.app.blobs);
    (h.app.blobs as any).put = async (d: any, o: any) => { await new Promise((r) => setTimeout(r, 30)); return put(d, o); };
    const files = [{ path: "artifacts/answer.json", data: Buffer.from('{"answer":"42"}').toString("base64") }];
    const [a, b] = await Promise.all([dev.uploadBundle({ tokenId: "1", payload: { leaseId: "lease-a", files } }), dev.uploadBundle({ tokenId: "2", payload: { leaseId: "lease-b", files } })]);
    assert.equal(a.body.hash, b.body.hash);
    const rec = h.app.store.c<any>("bundles").get(a.body.hash);
    assert.deepEqual([...rec.leaseIds].sort(), ["lease-a", "lease-b"]);
    assert.deepEqual([...rec.tokenIds].sort(), ["1", "2"]);
  } finally {
    await h.close();
  }
});

test("POST /pair/complete accepts the web's message form (bytes32 without 0x, expiresAt as number)", async () => {
  const h = await harness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());
    h.chain.owners.set("7", account.address);
    const key = generateDeviceKey();
    const start = (await post(h, "/pair/start", { deviceKey: key.deviceKey })).body;
    const st = (await get(h, `/pair/${start.code}`)).body;
    for (const k of ["deviceKey", "nonce", "expiresAt", "relayOrigin", "chainId"]) assert.ok(st[k] !== undefined, k);
    const signed = { deviceKey: `0x${st.deviceKey}` as `0x${string}`, wallet: account.address, tokenId: "7", nonce: st.nonce, expiresAt: st.expiresAt, relayOrigin: st.relayOrigin };
    const signature = await account.signTypedData(workerAuthorizationTypedData(signed, st.chainId) as any);
    const web = { deviceKey: st.deviceKey.replace(/^0x/, ""), wallet: account.address.toLowerCase(), tokenId: "7", nonce: st.nonce.replace(/^0x/, ""), expiresAt: Number(st.expiresAt), relayOrigin: st.relayOrigin };
    const r = await post(h, "/pair/complete", { code: start.code, message: web, signature });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const w = (await get(h, `/pair/wallet/${account.address}`)).body;
    assert.equal(w.seats[0].tokenId, "7");
    assert.equal(w.seats[0].devices[0].status, "active");
  } finally {
    await h.close();
  }
});

test("Registrar launch template: manifest passes the Registrar's validator; script carries the paid terms and env inputs", async () => {
  const h = await harness({ listen: false });
  try {
    const policy = h.app.launches.policy("custom_token", 46630)!;
    const t = { kind: "custom_token" as const, chainId: 46630, token: { name: "Brief Token", symbol: "brief" }, economics: { poolBps: 8800, initialMarketCapWei: "10000000000000000000", remainderTo: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955" }, pairWith: "0x0000000000000000000000000000000000000000" as const, feeTier: 10_000, solc: null };
    assert.deepEqual(validateLaunchManifest(launchManifest(t), policy as any), []);
    const sol = launchScript(t);
    for (const s of ['symbol: "BRIEF"', "poolBps: 8800", "fee: 10000", "initialMarketCap: 10000000000000000000", 'vm.envBytes32("CONTRIBUTOR_ROOT")', 'vm.envUint("LAUNCH_ID")', "launchId moved", "remainderTo: 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"]) assert.ok(sol.includes(s), s);
  } finally {
    await h.close();
  }
});
