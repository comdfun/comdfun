import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { submissionHash } from "@company/protocol";
import { harness, seat, worker, until, job, get } from "./helpers.ts";

const BUILD = { objective: "Build a capped ERC-20.", skill: "build-contract-project" } as const;

test("lease timeout: a silent seat's lease expires, the seat is excluded and the node is re-posted to another seat", async () => {
  const h = await harness({ env: { LEASE_SCALE: "0.0005" } }); // 45 min × 0.0005 ≈ 1.35 s
  try {
    const lazy = await seat(h, 1);
    const wl = await worker(h, lazy, { mode: "lazy" });
    const j = h.app.engine.admitJob(BUILD, { paidBy: null });
    await until(() => job(h, j.id).nodes[0].state === "leased", "first lease");
    assert.equal(job(h, j.id).nodes[0].seat.tokenId, "1");
    const honest = await seat(h, 2);
    const wh = await worker(h, honest);
    await until(() => job(h, j.id).state === "completed", "re-posted and completed", 15_000);
    const n = job(h, j.id).nodes[0];
    assert.deepEqual(n.excluded, ["1"]);
    assert.equal(n.attempt, 2);
    assert.equal(n.seat.tokenId, "2");
    const atts = (await get(h, `/jobs/${j.id}`)).body.attempts;
    assert.deepEqual(atts.map((a: any) => [a.tokenId, a.state]), [["1", "expired"], ["2", "accepted"]]);
    assert.equal((await get(h, "/seats/1")).body.failed, 1);
    await wl.stop(); await wh.stop();
  } finally {
    await h.close();
  }
});

test("outbox resubmission is idempotent; a closed lease refuses a different result", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s);
    const submitted: any[] = [];
    w.on("submitted", (x) => submitted.push(x));
    const j = h.app.engine.admitJob({ objective: "Write the docs.", skill: "write-readme-and-docs", paths: ["README.md"] }, { paidBy: null });
    await until(() => job(h, j.id).state === "completed", "job");
    const sub = h.app.store.c<any>("submissions").all()[0];
    const session = [...h.app.engine.sessions.values()][0];
    const again = h.app.engine.submit(session, { leaseId: sub.leaseId, hash: sub.hash, bundleHash: sub.bundleHash, files: sub.files, result: sub.result, summary: sub.summary, usage: sub.usage });
    assert.equal(again.duplicate, true);
    const otherHash = submissionHash(sub.leaseId, sub.bundleHash, sub.files, { notes: "different" });
    assert.throws(() => h.app.engine.submit(session, { leaseId: sub.leaseId, hash: otherHash, bundleHash: sub.bundleHash, files: sub.files, result: { notes: "different" } }), /lease is accepted/);
    assert.throws(() => h.app.engine.submit(session, { leaseId: "nope", hash: "x", bundleHash: null, files: [] }), /no such lease/);
    assert.equal(submitted.length, 1);
    await w.stop();
  } finally {
    await h.close();
  }
});

test("reconnect: the outbox replays a result produced while disconnected", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s, { delayMs: 300 });
    const j = h.app.engine.admitJob(BUILD, { paidBy: null });
    await until(() => job(h, j.id).nodes[0].state === "leased", "lease");
    w.drop();
    await until(() => job(h, j.id).state === "completed", "replayed after reconnect", 15_000);
    assert.equal(w.outbox.size, 0);
    await w.stop();
  } finally {
    await h.close();
  }
});

test("concurrency: a seat never holds more leases than it advertised", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s, { concurrency: 1, delayMs: 150 });
    let max = 0;
    const timer = setInterval(() => { max = Math.max(max, h.app.engine.load(s.key.deviceKey)); }, 10);
    const ids = [1, 2, 3].map((i) => h.app.engine.admitJob({ ...BUILD, objective: `Token ${i} with a cap.` }, { paidBy: null }).id);
    await until(() => ids.every((id) => job(h, id).state === "completed"), "three jobs", 15_000);
    clearInterval(timer);
    assert.equal(max, 1);
    await w.stop();
  } finally {
    await h.close();
  }
});

test("premium routing and skills: websites only go to premium runtimes; seats only get skills they advertise", async () => {
  const h = await harness();
  try {
    const plain = await seat(h, 1);
    const wp = await worker(h, plain, { premium: false });
    const j = h.app.engine.admitJob({ objective: "A one-page site for the firm.", skill: "build-website", ipfs: "firm-site" }, { paidBy: null });
    await until(() => job(h, j.id).nodes[0].dispatchNote?.includes("premium"), "waiting note");
    assert.equal(job(h, j.id).nodes[0].state, "ready");
    const noImage = await seat(h, 2);
    const wn = await worker(h, noImage, { premium: true, skills: ["build-contract-project"] });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(job(h, j.id).nodes[0].state, "ready", "premium seat without the skill enabled is not used");
    const prem = await seat(h, 3);
    const wq = await worker(h, prem, { premium: true });
    await until(() => job(h, j.id).state === "completed", "site job", 10_000);
    assert.equal(job(h, j.id).nodes[0].seat.tokenId, "3");
    assert.equal(job(h, j.id).site.label, "firm-site");
    await wp.stop(); await wq.stop(); await wn.stop();
    await until(() => h.app.engine.sessions.size === 0, "sessions closed");
    const img = h.app.engine.admitJob({ objective: "A wig, in pixels.", skill: "create-image", outputs: [{ name: "wig", path: "artifacts/wig.png", mediaType: "image/png" }] }, { paidBy: null });
    const blind = await seat(h, 4);
    const wb = await worker(h, blind, { tools: { image: false } });
    await until(() => job(h, img.id).nodes[0].dispatchNote?.includes("no image tool"), "image tool note");
    const ok = await seat(h, 5);
    const wo = await worker(h, ok);
    await until(() => job(h, img.id).state === "completed", "image");
    assert.equal(job(h, img.id).media[0].mediaType, "image/png");
    await wb.stop(); await wo.stop();
  } finally {
    await h.close();
  }
});

test("rate-limited runtime: the lease is handed back, the seat pauses five minutes, another seat finishes", async () => {
  const h = await harness();
  try {
    const a = await seat(h, 1);
    const wa = await worker(h, a, { mode: "ratelimited-once" });
    const j = h.app.engine.admitJob(BUILD, { paidBy: null });
    await until(() => wa.status.paused, "pause");
    assert.ok(wa.status.pausedUntil! - Date.now() > 4 * 60_000);
    await until(() => h.app.engine.sessions.get(a.key.deviceKey)?.paused, "server sees the pause");
    const b = await seat(h, 2);
    const wb = await worker(h, b);
    await until(() => job(h, j.id).state === "completed", "finished elsewhere");
    assert.equal(job(h, j.id).nodes[0].seat.tokenId, "2");
    assert.ok(h.app.store.c<any>("attempts").find((x: any) => x.tokenId === "1" && x.state === "cancelled" && /rate-limited/.test(x.failure)));
    await wa.stop(); await wb.stop();
  } finally {
    await h.close();
  }
});

test("cross-examination is independent: never assigned to a wallet that worked on the job", async () => {
  const h = await harness();
  try {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const s1 = await seat(h, 1, wallet);
    const s2 = await seat(h, 2, wallet);
    const w1 = await worker(h, s1);
    const w2 = await worker(h, s2);
    const j = h.app.engine.admitJob({ objective: "Vault with review.", shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }] }, { paidBy: null });
    await until(() => job(h, j.id).nodes[1].dispatchNote?.includes("not independent"), "independence note");
    assert.equal(job(h, j.id).nodes[1].state, "ready");
    const s3 = await seat(h, 3);
    const w3 = await worker(h, s3);
    await until(() => job(h, j.id).state === "completed", "reviewed by another wallet");
    const [impl, review] = job(h, j.id).nodes;
    assert.notEqual(impl.seat.tokenId, review.seat.tokenId);
    assert.equal(review.seat.tokenId, "3");
    const doc = h.app.store.c<any>("documents").find((d: any) => d.kind === "review" && d.jobId === j.id);
    assert.equal((await get(h, `/reviews/${doc.id}.json`)).body.reviewer.tokenId, "3");
    await w1.stop(); await w2.stop(); await w3.stop();
  } finally {
    await h.close();
  }
});

test("a rejecting review earns one revision (fix-findings + fresh review); a second rejection blocks: review failed", async () => {
  const h = await harness();
  try {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const builders = [await seat(h, 1, wallet), await seat(h, 2, wallet)];
    for (const b of builders) await worker(h, b);
    const critic = await seat(h, 3);
    const wc = await worker(h, critic, { mode: "contrarian", skills: ["adversarial-review"] });
    const j = h.app.engine.admitJob({ objective: "Vault with review.", shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }] }, { paidBy: null });
    await until(() => job(h, j.id).nodes.some((n: any) => n.skill === "fix-findings"), "fix node");
    await until(() => ["completed", "blocked"].includes(job(h, j.id).state), "outcome", 15_000);
    const done = job(h, j.id);
    const keys = done.nodes.map((n: any) => n.key);
    assert.ok(keys.includes("fix_adversarial_review"));
    assert.ok(keys.includes("adversarial_review_r2"));
    // the only independent reviewer is the contrarian (the builders share a wallet), so the second review rejects too
    assert.equal(done.state, "blocked");
    assert.match(done.blockedReason, /^review failed/);
    assert.equal((await get(h, `/jobs/${j.id}`)).body.stage, "review failed");
    await wc.stop();
  } finally {
    await h.close();
  }
});
