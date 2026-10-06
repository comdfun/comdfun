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
    const t = { kind: "custom_token" as const, chainId: 46630, token: { name: "Brief Token", symbol: "brief" }, economics: { poolBps: 8800, initialMarketCapWei: "10000000000000000000", remainderTo: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955" }, pairWith: (h.app.cfg.comd ?? "0x0000000000000000000000000000000000000000") as `0x${string}`, feeTier: 10_000, solc: null };
    assert.deepEqual(validateLaunchManifest(launchManifest(t), policy as any), []);
    const sol = launchScript(t);
    for (const s of ['symbol: "BRIEF"', "poolBps: 8800", "fee: 10000", "initialMarketCap: 10000000000000000000", 'vm.envBytes32("CONTRIBUTOR_ROOT")', 'vm.envUint("LAUNCH_ID")', "launchId moved", "remainderTo: 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"]) assert.ok(sol.includes(s), s);
  } finally {
    await h.close();
  }
});

test("launch defaults (Pons mode): swarm launches pair with $COMD; ETH only with LAUNCH_PAIRINGS; policies exist for every LAUNCH_CHAINS entry", async () => {
  // a local chain (anvil 31337) offered through LAUNCH_CHAINS gets policies too, allowlisting the configured COMD only
  const h = await harness({ env: { CHAIN_ID: "31337", LAUNCH_CHAINS: "31337,46630" } });
  try {
    const policy = h.app.launches.policy("custom_token", 31337);
    assert.ok(policy, "a custom_token policy was seeded for chain 31337");
    assert.deepEqual(policy!.params.pairedCurrencyAllowlist, ["0x00000000000000000000000000000000000c0d0d"]);
    assert.equal(policy!.params.minInitialMarketCapWei, "100000000000000000000000"); // 100k COMD, the factory's COMD floor
    assert.deepEqual(h.app.launches.pairingsFor(31337), ["comd"]);
    assert.equal(h.app.launches.defaultPairing(31337), "comd");
    // other chains: COMD is not configured there, so ETH is the only (and default) pairing
    assert.deepEqual(h.app.launches.pairingsFor(46630), ["eth"]);
    assert.equal(h.app.launches.defaultPairing(46630), "eth");
    const caps = (await get(h, "/requests/capabilities")).body;
    const local = caps.launches.chains.find((c: any) => c.chainId === 31337);
    assert.equal(local.defaultPairWith, "comd");
    assert.deepEqual(local.pairings.map((p: any) => p.pairWith), ["comd"]);
    assert.equal(local.pairings[0].address, "0x00000000000000000000000000000000000c0d0d");
    // POST /requests/check reports the pairing a launch will use when the body omits pairWith; eth is refused here
    const body = { objective: "Launch $BRIEF through ProjectFactory.", skill: "build-contract-project", onchain: "custom_token", chainId: 31337, economics: { poolBps: 8800, remainderTo: "0x14dc79964da2c08b23698b3d3cc7ca32193d9955" } };
    const def = (await post(h, "/requests/check", { action: "launch.open", input: body })).body;
    assert.deepEqual(def.blockers, []);
    assert.equal(def.facts.launch.pairWith, "comd");
    const eth = (await post(h, "/requests/check", { action: "launch.open", input: { ...body, pairWith: "eth" } })).body;
    assert.equal(eth.blockers[0]?.code, "unsupported_pairing");
  } finally {
    await h.close();
  }
});

test("LAUNCH_PAIRINGS=comd,eth keeps ETH selectable (COMD stays the default); the factory's pairedConfig can veto a pairing", async () => {
  const h = await harness({ env: { CHAIN_ID: "31337", LAUNCH_CHAINS: "31337", LAUNCH_PAIRINGS: "comd,eth", PROJECT_FACTORY: "0xfac70fac70fac70fac70fac70fac70fac70fac70" } });
  try {
    assert.deepEqual(h.app.launches.pairingsFor(31337), ["comd", "eth"]);
    assert.equal(h.app.launches.defaultPairing(31337), "comd");
    const caps = (await get(h, "/requests/capabilities")).body.launches.chains[0];
    assert.deepEqual(caps.pairings.map((p: any) => p.pairWith), ["comd", "eth"]);
    assert.equal(caps.defaultPairWith, "comd");
    const body = { objective: "Launch $BRIEF through ProjectFactory.", skill: "build-contract-project", onchain: "custom_token", chainId: 31337, pairWith: "eth", economics: { poolBps: 8800, remainderTo: "0x14dc79964da2c08b23698b3d3cc7ca32193d9955" } };
    const eth = (await post(h, "/requests/check", { action: "launch.open", input: body })).body;
    assert.deepEqual(eth.blockers, []);
    assert.equal(eth.facts.launch.pairWith, "eth");
    // the chain says the factory was deployed without ALLOW_ETH_PAIRING: ETH is dropped, COMD stays
    const f = "0xfac70fac70fac70fac70fac70fac70fac70fac70";
    h.chain.views.set(`${f}:pairedConfig(0x0000000000000000000000000000000000000000)`, [false, 0n, 0n]);
    h.chain.views.set(`${f}:pairedConfig(0x00000000000000000000000000000000000c0d0d)`, [true, 10n ** 23n, 10n ** 26n]);
    const { syncPairingsWithFactory } = await import("../src/launches.ts");
    assert.deepEqual(await syncPairingsWithFactory(h.app), ["0x0000000000000000000000000000000000000000"]);
    assert.deepEqual(h.app.launches.pairingsFor(31337), ["comd"]);
    assert.deepEqual(Object.keys(h.app.launches.policy("custom_token", 31337)!.params.initialMarketCaps!), ["0x00000000000000000000000000000000000c0d0d"]);
    assert.match(h.app.launches.policy("custom_token", 31337)!.note, /paired with \$COMD;/);
    const refused = (await post(h, "/requests/check", { action: "launch.open", input: body })).body;
    assert.equal(refused.blockers[0]?.code, "unsupported_pairing");
  } finally {
    await h.close();
  }
});
