import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, seat, worker, until, job, get } from "./helpers.ts";

test("a single-skill job runs on a mock seat, is verified, published and recorded", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s);
    const j = h.app.engine.admitJob({ objective: "Build an ERC-20 with a capped supply", skill: "build-contract-project" }, { paidBy: s.account.address });
    const done = await until(() => ["completed", "blocked"].includes(job(h, j.id).state) && job(h, j.id), "job to finish");
    assert.equal(done.state, "completed", done.blockedReason ?? "");
    assert.ok(done.delivery?.repoUrl);
    const r = await get(h, `/jobs/${j.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.nodes[0].state, "accepted");
    const batches = await get(h, "/feedback/batches");
    assert.equal(batches.body.count, 1);
    await w.stop();
  } finally {
    await h.close();
  }
});
