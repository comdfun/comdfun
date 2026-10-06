import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, seat, worker, until, job } from "./helpers.ts";

let available = true;
try { await import("@company/services"); } catch { available = false; }

test("the real Clerk (@company/services verifySubmission) accepts mock seats' structured outputs", { skip: !available && "@company/services not installed" }, async () => {
  const h = await harness({ realServices: true });
  try {
    assert.equal(h.app.services.status().verifier.mode, "company-services");
    const ws = [];
    for (let i = 1; i <= 3; i++) ws.push(await worker(h, await seat(h, i)));
    const research = h.app.engine.admitJob({ objective: "Which L2s post proofs to Ethereum?", skill: "research-report", minCitations: 2, github: false }, { paidBy: null });
    const docs = h.app.engine.admitJob({ objective: "Document the vault.", shape: "chain", steps: [{ skill: "write-readme-and-docs", paths: ["README.md", "docs"] }, { skill: "adversarial-review" }], github: false }, { paidBy: null });
    const r = await until(() => ["completed", "blocked"].includes(job(h, research.id).state) && job(h, research.id), "research", 20_000);
    assert.equal(r.state, "completed", JSON.stringify(r.nodes.map((n: any) => [n.key, n.state, n.verdict?.detail])));
    assert.match(r.nodes[0].verdict.detail, /research-citations|check/);
    const d = await until(() => ["completed", "blocked"].includes(job(h, docs.id).state) && job(h, docs.id), "docs", 20_000);
    assert.equal(d.state, "completed", JSON.stringify(d.nodes.map((n: any) => [n.key, n.state, n.verdict?.detail, n.failureReason])));
    for (const w of ws) await w.stop();
  } finally {
    await h.close();
  }
});
