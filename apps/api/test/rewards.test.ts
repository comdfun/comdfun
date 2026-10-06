import { test } from "node:test";
import assert from "node:assert/strict";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { harness, seat, worker, until, job, get } from "./helpers.ts";
import { equalConnected } from "../src/launches.ts";

test("equal_connected: 2% to wallets that worked, 8% to connected seats, 30% per-wallet cap, leftovers to treasury", () => {
  const supply = 10n ** 27n;
  const pool = supply / 10n;
  const workersPool = (supply * 200n) / 10_000n;
  const connectedPool = (supply * 800n) / 10_000n;
  const cap = (pool * 3000n) / 10_000n;
  const w = (n: number) => `0x${String(n).padStart(40, "0")}`;
  // 2 workers + 3 connected seats of which one belongs to worker 1
  const out = equalConnected({ workersPool, connectedPool, cap, workers: [w(1), w(2)], connected: [{ tokenId: "1", wallet: w(1) }, { tokenId: "2", wallet: w(3) }, { tokenId: "3", wallet: w(4) }] });
  const amt = Object.fromEntries(out.map((e) => [e.account.toLowerCase(), BigInt(e.amount)]));
  const each = connectedPool / 3n;
  assert.ok(amt[w(1)] <= cap, "capped at 30% of the contributor pool");
  assert.ok(out.find((e) => e.account.toLowerCase() === w(1))!.capped);
  assert.equal(amt[w(2)] + amt[w(3)] + amt[w(4)] + amt[w(1)] <= pool, true);
  assert.ok(amt[w(3)] > each, "the excess over the cap is re-spread to uncapped wallets");
  // a single connected wallet can never take more than the cap; the rest stays with the treasury
  const solo = equalConnected({ workersPool, connectedPool, cap, workers: [w(9)], connected: [{ tokenId: "9", wallet: w(9) }] });
  assert.equal(solo[0].amount, cap.toString());
});

test("launch snapshot root and reward epoch root verify with @openzeppelin/merkle-tree", async () => {
  const h = await harness({ env: { CONTRIBUTOR_DISTRIBUTOR: "0xc0de000000000000000000000000000000000001", REWARD_DISTRIBUTOR: "0xc0de000000000000000000000000000000000002" } });
  try {
    const shared = privateKeyToAccount(generatePrivateKey());
    const seats = [await seat(h, 1), await seat(h, 2), await seat(h, 3), await seat(h, 4, shared), await seat(h, 5, shared), await seat(h, 6)];
    const ws = [];
    for (const s of seats) ws.push(await worker(h, s));
    const j = h.app.engine.admitJob({ objective: "Launch COUNSEL with a staking contract.", shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }], onchain: "evm_project", chainId: 46630, economics: { poolBps: 8800 } }, { paidBy: seats[0].account.address, launch: true });
    const done = await until(() => ["completed", "blocked"].includes(job(h, j.id).state) && job(h, j.id), "launch", 20_000);
    assert.equal(done.state, "completed", done.blockedReason ?? "");
    assert.deepEqual(done.nodes.map((n: any) => n.skill), ["build-contract-project", "audit-specialist", "audit-specialist", "audit-specialist", "audit-specialist", "audit-judge"]);
    const l = (await get(h, `/launches/${done.launch.id}?claims=1&work=1`)).body;
    assert.equal(l.status, "live");
    assert.equal(l.policyVersion > 0, true);
    assert.ok(l.admission.checks.every((c: any) => c.ok));
    assert.equal(l.allocationTotals.contributors, (10n ** 26n).toString(), "10% of 1B");
    assert.equal(l.allocationTotals.pool, ((10n ** 27n * 8800n) / 10_000n).toString());
    assert.deepEqual(l.allocations.map((a: any) => [a.label, a.bps]), [["pool", 8800], ["payer", 200], ["swarm", 1000]]);
    assert.ok(l.admission.checks.every((c: any) => c.status === "pass"));
    assert.ok(Array.isArray(l.lifecycle) && l.lifecycle.map((x: any) => x.status).includes("live"));
    assert.equal(l.token.address, l.tokenAddress);
    const snap = l.rewardSnapshot;
    assert.equal(snap.rule, "equal_connected");
    assert.equal(snap.connectedSeats.length, 6);
    const oz = StandardMerkleTree.of(snap.claims.map((c: any) => [l.launchNumber, c.account, c.amount]), ["uint256", "address", "uint256"]);
    assert.equal(snap.root, oz.root);
    for (const c of snap.claims) assert.ok(StandardMerkleTree.verify(snap.root, ["uint256", "address", "uint256"], [l.launchNumber, c.account, c.amount], c.proof));
    const sharedEntry = snap.entries.find((e: any) => e.account === getAddress(shared.address));
    const solo = snap.entries.find((e: any) => e.account === getAddress(seats[5].account.address));
    assert.ok(BigInt(sharedEntry.connectedShare) === 2n * BigInt(solo.connectedShare), "a wallet with two connected seats gets two seat shares");
    const claim = (await get(h, `/api/claim?launch=${l.id}&wallet=${seats[0].account.address}`)).body.claim;
    assert.equal(claim.root, snap.root);
    const earn = (await get(h, `/wallets/${seats[0].account.address}/earnings`)).body;
    assert.equal(earn.count, 1);
    await h.app.idle();
    // the root is registered by ProjectFactory.launch in the launch transaction, not by a separate settler call
    assert.equal(h.writer.sent.some((t) => t.fn === "setLaunchRoot"), false);
    assert.equal(snap.launchId, l.launchNumber);
    const lv = (await get(h, `/launches/${l.id}`)).body.rewardSnapshot;
    assert.equal(lv.rootStatus, "sent");
    assert.ok(lv.rootTx);
    const cv = (await get(h, `/launches/${l.id}/claims/${seats[0].account.address}`)).body;
    assert.equal(cv.eligible, true);
    assert.equal(cv.root, snap.root);
    assert.ok(StandardMerkleTree.verify(snap.root, ["uint256", "address", "uint256"], [cv.launchId, cv.account, cv.amount], cv.proof));
    assert.equal((await get(h, `/launches/${l.id}/claims/0x000000000000000000000000000000000000dEaD`)).body.eligible, false);

    const e0 = h.app.settlement.epochOf(Date.now());
    h.app.settlement.closeEpoch(e0);
    await h.app.idle();
    const ep = h.app.store.c<any>("epochs").get(String(e0));
    assert.equal(ep.status, "posted");
    const comd = ep.assets[0];
    assert.equal(comd.symbol, "COMD");
    assert.deepEqual(ep.assets.map((a: any) => a.symbol), ["COMD"], "reward epochs are COMD only");
    const ozr = StandardMerkleTree.of(comd.entries.map((e: any) => [ep.epoch, e.tokenId, e.amount]), ["uint256", "uint256", "uint256"]);
    assert.equal(comd.root, ozr.root);
    assert.equal(comd.entries.reduce((s: bigint, e: any) => s + BigInt(e.amount), 0n), BigInt(h.app.cfg.rewardEpochPool!), "pool = min(REWARD_EPOCH_POOL, unallocated)");
    for (const e of comd.entries) assert.ok(StandardMerkleTree.verify(comd.root!, ["uint256", "uint256", "uint256"], [ep.epoch, e.tokenId, e.amount], e.proof));
    const byWork = [...comd.entries].sort((a: any, b: any) => b.accepted - a.accepted);
    assert.ok(BigInt(byWork[0].amount) >= BigInt(byWork[byWork.length - 1].amount), "split by accepted work");
    const posted = h.writer.sent.find((t) => t.fn === "postRoot" && (t.args as any).asset.toLowerCase() === h.app.cfg.comd.toLowerCase())!.args as any;
    assert.equal(h.writer.sent.filter((t) => t.fn === "postRoot").length, 1, "one COMD root, no ETH root");
    assert.equal(posted.root, comd.root);
    assert.equal(posted.asset.toLowerCase(), h.app.cfg.comd.toLowerCase());
    assert.equal(posted.total, BigInt(comd.total));
    assert.equal((await get(h, `/rewards/epochs/${ep.epoch}`)).body.status, "posted");
    const mine = (await get(h, `/rewards/${byWork[0].tokenId}`)).body;
    assert.equal(mine.epochs[0].assets[0].amount, byWork[0].amount);
    assert.deepEqual(mine.epochs[0].assets[0].proof, byWork[0].proof);
    for (const w of ws) await w.stop();
  } finally {
    await h.close();
  }
});

test("reputation: feedback batches queue without a settler key, send giveFeedback with one, chain previous hashes", async () => {
  const h = await harness({ env: { REPUTATION_REGISTRY: "0x8004000000000000000000000000000000000002" } });
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s);
    const a = h.app.engine.admitJob({ objective: "Docs one.", skill: "write-readme-and-docs", paths: ["README.md"] }, { paidBy: null });
    const b = h.app.engine.admitJob({ objective: "Docs two.", skill: "write-readme-and-docs", paths: ["README.md"] }, { paidBy: null });
    await until(() => job(h, a.id).state === "completed" && job(h, b.id).state === "completed", "jobs");
    await h.app.idle();
    await until(() => h.app.store.c<any>("feedback").all().every((x: any) => x.status === "sent"), "sent");
    const batches = (await get(h, "/feedback/batches")).body.batches;
    assert.equal(batches.length, 2);
    // follow the hash chain (two batches created in the same millisecond tie in newest-first order)
    const newer = batches.find((b: any) => batches.some((o: any) => o !== b && o.documentHash === b.previousHash));
    const older = batches.find((b: any) => b !== newer);
    assert.ok(newer, "one batch chains to the other");
    assert.equal(newer.previousHash, older.documentHash);
    assert.equal(newer.entries[0].agentId, s.agentId);
    assert.equal(newer.entries[0].tag2, "acceptance-v1");
    const gf = h.writer.sent.filter((t) => t.fn === "giveFeedback");
    assert.equal(gf.length, 2);
    assert.match((gf[0].args as any).feedbackURI, /\/work-records\/[0-9a-f]{64}\.json$/);
    const wr = await get(h, `/work-records/${newer.entries[0].feedbackHash}.json`);
    assert.equal(wr.body.schema, "company.work-record.v1");
    const rec = (await get(h, `/jobs/${a.id}/records`)).body.records;
    assert.equal(rec[0].status, "sent");
    await w.stop();
  } finally {
    await h.close();
  }
});
