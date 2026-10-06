import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { harness, seat, worker, pay, until, job, get } from "./helpers.ts";

test("job.continue: only the parent's payer may continue (403 payer_not_owner); the continuation builds on the parent", async () => {
  const h = await harness();
  try {
    const seats = [await seat(h, 1), await seat(h, 2)];
    for (const s of seats) await worker(h, s);
    const owner = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const first = await pay(h, owner, "job.open", { objective: "Build a vesting contract project.", skill: "build-contract-project" });
    const parentId = first.submit.body.admission.result.jobId;

    const early = await pay(h, owner, "job.continue", { objective: "Add a pause guardian.", parentJobId: parentId });
    assert.equal(early.quote.status, 422, "parent still running");
    assert.equal(early.quote.body.problems[0].code, "parent_running");

    await until(() => job(h, parentId).state === "completed", "parent");
    const refused = await pay(h, other, "job.continue", { objective: "Add a pause guardian.", parentJobId: parentId });
    assert.equal(refused.quote.status, 201);
    assert.equal(refused.submit.status, 403);
    assert.equal(refused.submit.body.error, "payer_not_owner");

    const bad = await pay(h, owner, "job.continue", { objective: "x", parentJobId: parentId, repoUrl: "https://github.com/a/b", baseCommit: "0".repeat(40) });
    assert.equal(bad.quote.status, 422);
    assert.ok(bad.quote.body.problems.some((p: any) => p.path === "repoUrl" && p.code === "not_allowed"));

    const check = (await (await fetch(`${h.url}/requests/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "job.continue", input: { objective: "Add a pause guardian.", parentJobId: parentId } }) })).json()) as any;
    assert.equal(check.blockers.length, 0);
    assert.equal(check.project.head, parentId);
    assert.ok(check.project.next.length);

    const ok = await pay(h, owner, "job.continue", { objective: "Add a pause guardian.", parentJobId: parentId });
    assert.equal(ok.submit.status, 200);
    assert.equal(ok.submit.body.admission.result.continues, parentId);
    const childId = ok.submit.body.admission.result.jobId;
    const child = await until(() => job(h, childId).state === "completed" && job(h, childId), "child");
    assert.equal(child.parentJobId, parentId);
    assert.equal(child.project.id, parentId);
    assert.equal(child.template, "skill:build-contract-project", "no skill given: the parent's single skill reruns");
    assert.equal(job(h, parentId).project.head, childId);
    const lease = h.app.store.c<any>("attempts").find((a: any) => a.jobId === childId)!;
    assert.ok(lease);
    const full = (await get(h, `/jobs/${childId}`)).body;
    assert.equal(full.baseJobId, parentId);
    assert.equal(child.delivery.repoUrl, job(h, parentId).delivery.repoUrl, "delivered into the project's repository");
  } finally {
    await h.close();
  }
});
