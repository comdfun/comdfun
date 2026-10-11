/**
 * The written deliverable. A research matter's whole point is the report, and until there was a route for it the only
 * way to read one was to pick the right hash out of the exhibits. What is worth proving: the report comes back as
 * text, the download carries a sensible file name, a review by-product does not get mistaken for the report, and a
 * matter that produced no document says so rather than serving an empty page.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { harness, seat, worker, until, get, job } from "./helpers.ts";
import { deliverableRef } from "../src/deliverable.ts";

test("a research matter's report comes back as text, and as a named download", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s);
    const j = h.app.engine.admitJob({
      objective: "Which stablecoins are natively issued on Robinhood Chain, who issues each, and what attestation cadence does each publish?",
      skill: "research-report",
      outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }],
    }, { paidBy: null });
    await until(() => job(h, j.id).state === "completed", "research matter", 20_000);

    const d = await get(h, `/jobs/${j.id}/deliverable`);
    assert.equal(d.status, 200, d.text);
    assert.equal(d.body.kind, "artifact");
    assert.match(d.body.path, /report\.md$/);
    assert.ok(d.body.text.trim().length > 0, "the report has text");
    assert.equal(d.body.truncated, false);
    assert.equal(d.body.downloadUrl, `/jobs/${j.id}/deliverable.md`);

    const file = await get(h, `/jobs/${j.id}/deliverable.md`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-type") ?? "", /text\/markdown/);
    assert.match(file.headers.get("content-disposition") ?? "", /attachment; filename="matter-[0-9a-f]{8}-report\.md"/);
    assert.equal(file.text, d.body.text, "the download is the same document the page printed");

    // and the matter view points at it, so a page knows there is one without asking twice
    const view = await get(h, `/jobs/${j.id}`);
    assert.equal(view.body.deliverable.downloadUrl, `/jobs/${j.id}/deliverable.md`);
    assert.equal(view.body.deliverable.kind, "artifact");

    await w.stop();
  } finally {
    await h.close();
  }
});

test("a matter with nothing written says so", async () => {
  const h = await harness();
  try {
    const j = h.app.engine.admitJob({ objective: "A wig, in pixels.", skill: "create-image", outputs: [{ name: "wig", path: "artifacts/wig.png", mediaType: "image/png" }] }, { paidBy: null });
    const d = await get(h, `/jobs/${j.id}/deliverable`);
    assert.equal(d.status, 404);
    assert.match(d.text, /written report/i);
    assert.equal((await get(h, `/jobs/${j.id}`)).body.deliverable, null, "and the matter view does not promise one");
  } finally {
    await h.close();
  }
});

test("report.md wins over a review by-product, and a rejected draft is not the report", async () => {
  const h = await harness();
  try {
    const j = h.app.engine.admitJob({ objective: "Anything, so long as it has nodes.", skill: "research-report", outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }] }, { paidBy: null });
    const rec = job(h, j.id);
    const mk = (hash: string, artifacts: { name: string; path: string; mediaType: string; bytes: number }[]) => {
      h.app.store.c<any>("submissions").save({ id: hash, hash, jobId: j.id, artifacts: artifacts.map((a) => ({ ...a, hash, url: `/artifacts/${hash}` })) });
      return hash;
    };
    const a = mk("a".repeat(64), [{ name: "review", path: "artifacts/review.md", mediaType: "text/markdown", bytes: 9000 }]);
    const b = mk("b".repeat(64), [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown", bytes: 120 }]);
    const c = mk("c".repeat(64), [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown", bytes: 99_999 }]);
    rec.nodes = [
      { key: "n1", state: "accepted", submissionHash: a, dependsOn: [], role: "review", attempt: 1 },
      { key: "n2", state: "accepted", submissionHash: b, dependsOn: [], role: "implement", attempt: 1 },
      { key: "n3", state: "rejected", submissionHash: c, dependsOn: [], role: "implement", attempt: 1 },
    ] as any;
    h.app.store.c<any>("jobs").save(rec);

    const ref = deliverableRef(h.app, rec);
    assert.equal(ref?.path, "artifacts/report.md");
    assert.equal(ref?.bytes, 120, "the big one was rejected, so it is not the report");
  } finally {
    await h.close();
  }
});

test("a panel's losing answers are not the report", async () => {
  const h = await harness();
  try {
    const j = h.app.engine.admitJob({ objective: "Anything, so long as it has nodes.", skill: "research-report", outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }] }, { paidBy: null });
    const rec = job(h, j.id);
    for (const [hash, bytes] of [["d".repeat(64), 500], ["e".repeat(64), 4000]] as [string, number][])
      h.app.store.c<any>("submissions").save({ id: hash, hash, jobId: j.id, artifacts: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown", bytes, hash, url: `/artifacts/${hash}` }] });
    rec.panel = { winner: "p1" } as any;
    rec.nodes = [
      { key: "p1", kind: "panel", state: "accepted", submissionHash: "d".repeat(64), dependsOn: [], role: "implement", attempt: 1 },
      { key: "p2", kind: "panel", state: "accepted", submissionHash: "e".repeat(64), dependsOn: [], role: "implement", attempt: 1 },
    ] as any;
    h.app.store.c<any>("jobs").save(rec);
    assert.equal(deliverableRef(h.app, rec)?.bytes, 500, "only the winning answer counts");
  } finally {
    await h.close();
  }
});

test("a long report is cut for the page but whole in the download", async () => {
  const h = await harness();
  try {
    const long = `# Title\n\n${"Everything that could be said about this, said again. ".repeat(20_000)}`;
    const put = await h.app.blobs.put(long, { mediaType: "text/markdown" });
    const j = h.app.engine.admitJob({ objective: "Anything, so long as it has nodes.", skill: "research-report", outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }] }, { paidBy: null });
    const rec = job(h, j.id);
    const hash = put.hash;
    h.app.store.c<any>("submissions").save({ id: hash, hash, jobId: j.id, artifacts: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown", bytes: long.length, hash, url: `/artifacts/${hash}` }] });
    rec.nodes = [{ key: "n1", state: "accepted", submissionHash: hash, dependsOn: [], role: "implement", attempt: 1 }] as any;
    h.app.store.c<any>("jobs").save(rec);

    const page = await get(h, `/jobs/${j.id}/deliverable`);
    assert.equal(page.status, 200);
    assert.equal(page.body.truncated, true);
    assert.equal(page.body.text.length, 400_000);
    const file = await get(h, `/jobs/${j.id}/deliverable.md`);
    assert.equal(file.text.length, long.length, "the download is not cut");
  } finally {
    await h.close();
  }
});

test("the id has to be a matter id", async () => {
  const h = await harness();
  try {
    assert.equal((await get(h, "/jobs/not-a-uuid/deliverable")).status, 400);
    assert.equal((await get(h, `/jobs/${randomUUID()}/deliverable.md`)).status, 404);
  } finally {
    await h.close();
  }
});

test("a matter's share card is a real 1200×630 PNG drawn from the docket", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s);
    const j = h.app.engine.admitJob({
      objective: "Which stablecoins are natively issued on Robinhood Chain, and what attestation cadence does each publish?",
      skill: "research-report",
      outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }],
    }, { paidBy: null });
    await until(() => job(h, j.id).state === "completed", "research matter", 20_000);

    const res = await fetch(`${h.url}/jobs/${j.id}/share.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const png = Buffer.from(await res.arrayBuffer());
    assert.ok(png.subarray(1, 4).toString() === "PNG", "it is a PNG");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    await w.stop();
  } finally {
    await h.close();
  }
});
