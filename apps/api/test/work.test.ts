import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSignedEnvelope } from "@company/protocol";
import { harness, seat, worker, until, job, get, post } from "./helpers.ts";
import { planJob } from "../src/planner.ts";

test("planner: templates, shapes, and the Bench replacing the final review on launches", async () => {
  const h = await harness({ listen: false });
  try {
    const sk = h.app.skills;
    const chain = planJob({ objective: "x", shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "write-foundry-tests", paths: ["test"] }, { skill: "adversarial-review" }] }, { skills: sk, launch: false });
    assert.deepEqual(chain.nodes.map((n) => n.dependsOn), [[], ["build_contract_project"], ["write_foundry_tests"]]);
    assert.deepEqual(chain.nodes[2].reviews, ["build_contract_project", "write_foundry_tests"]);
    const fan = planJob({ objective: "x", shape: "fan_out_join", steps: [{ skill: "implement-component", paths: ["a"] }, { skill: "implement-component", paths: ["b"] }, { skill: "integrate-project" }] }, { skills: sk, launch: false });
    assert.deepEqual(fan.nodes[2].dependsOn, ["implement_component", "implement_component_2"]);
    const launch = planJob({ objective: "x", shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }] }, { skills: sk, launch: true });
    assert.deepEqual(launch.nodes.map((n) => n.key), ["build_contract_project", "audit_1", "audit_2", "audit_3", "audit_4", "audit_judge"]);
    assert.deepEqual(launch.nodes[5].dependsOn, ["audit_1", "audit_2", "audit_3", "audit_4"]);
    const multi = planJob({ objective: "x", template: "multi_contract", contracts: ["src/A.sol", "src/B.sol"] }, { skills: sk, launch: false });
    assert.deepEqual(multi.nodes.map((n) => n.key), ["impl_1", "impl_2", "tests", "review"]);
    assert.deepEqual(multi.nodes[0].allowedPaths, ["src/A.sol"]);
    assert.equal(planJob({ objective: "x", template: "audit", repoUrl: "https://github.com/a/b", baseCommit: "0".repeat(40) }, { skills: sk, launch: false }).nodes.length, 5);
  } finally {
    await h.close();
  }
});

test("research panel: members on different wallets, closes on quorum of matching answers, needs citations", async () => {
  const h = await harness();
  try {
    const ws = [];
    for (let i = 1; i <= 3; i++) ws.push(await worker(h, await seat(h, i)));
    const j = h.app.engine.admitJob({ objective: "Which L2s settle to Ethereum with live proofs?", template: "research", panelSize: 3, panelQuorum: 2, minCitations: 2, rubric: { contains: ["one row per L2"] } }, { paidBy: null });
    await until(() => job(h, j.id).state === "completed", "research", 15_000);
    const panel = (await get(h, `/jobs/${j.id}/panel`)).body;
    assert.equal(panel.state, "agreed");
    assert.equal(panel.quorum, 2);
    assert.ok(panel.answers.length >= 2);
    assert.ok(panel.answers.every((a: any) => a.citations.length >= 2));
    assert.equal(new Set(panel.answers.map((a: any) => a.wallet)).size, panel.answers.length);
    const result = (await get(h, `/jobs/${j.id}/result`)).body;
    assert.equal(result.files.length, 1, "the winning member's report is the deliverable");
    assert.equal((await get(h, "/research/panels")).body.panels[0].jobId, j.id);
    for (const w of ws) await w.stop();
  } finally {
    await h.close();
  }
});

test("fuzz campaign: results arrive as a signed device call, campaign state on /jobs/:id/fuzz and /fuzz/results", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s);
    const j = h.app.engine.admitJob({ objective: "Fuzz vault share accounting.", template: "fuzz", repoUrl: "https://github.com/o/r", baseCommit: "0123456789abcdef0123456789abcdef01234567", contracts: ["test/VaultInvariants.t.sol"], projectPath: ".", runs: 100000 }, { paidBy: null });
    await until(() => job(h, j.id).state === "completed", "fuzz job", 15_000);
    const f = (await get(h, `/jobs/${j.id}/fuzz`)).body;
    assert.equal(f.state, "clean");
    assert.equal(f.runs, 100000);
    assert.equal(f.results[0].properties.length, 2);
    assert.equal((await get(h, "/fuzz/results")).body.count, 1);
    const lease = h.app.store.c<any>("attempts").all()[0].leaseId;
    const closed = await post(h, "/fuzz/result", makeSignedEnvelope(s.key, "fuzz.result", { leaseId: lease, runs: 10, properties: [] }));
    assert.equal(closed.status, 409, "results only while the lease is open");
    await w.stop();
  } finally {
    await h.close();
  }
});

test("workflow: contracts (with the Bench) → deployment → front end planned by workflow-planner (Anthropic API) → site → validation", async () => {
  let plannerCalls = 0;
  const h = await harness({
    env: { ANTHROPIC_API_KEY: "test-key", ORCHESTRATOR_RUNTIME: "anthropic-api", ANTHROPIC_MODEL: "claude-test" },
    fetch: (async (url: string, init: any) => {
      if (String(url).startsWith("https://api.anthropic.com/")) {
        plannerCalls++;
        assert.equal(init.headers["x-api-key"], "test-key");
        assert.equal(JSON.parse(init.body).model, "claude-test");
        const plan = { objective: "Members site for the savings club.", shape: "chain", steps: [{ skill: "frontend-for-contract", objective: "Pool page." }, { skill: "site-content-check" }] };
        return new Response(JSON.stringify({ content: [{ type: "text", text: `Here is the plan:\n${JSON.stringify(plan)}` }] }), { status: 200 });
      }
      return fetch(url, init);
    }) as any,
  });
  try {
    const ws = [];
    for (let i = 1; i <= 6; i++) ws.push(await worker(h, await seat(h, i), { premium: i >= 5 }));
    const { workflow } = h.app.workflows.open({
      request: "A savings club token with a site where members see the pool.",
      draft: { objective: "Savings club token and members site.", shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }, { skill: "frontend-for-contract" }], onchain: "evm_project", chainId: 46630, ipfs: "savings-club" },
      permissions: { github: true, ipfs: "savings-club", onchain: { kind: "evm_project", chainId: 46630 } },
    }, { paidBy: "0x000000000000000000000000000000000000beef" });
    const wf = await until(async () => { const x = (await get(h, `/workflows/${workflow.id}`)).body; return ["completed", "blocked"].includes(x.status) && x; }, "workflow", 30_000);
    assert.equal(wf.status, "completed", wf.failure ?? "");
    assert.equal(plannerCalls, 1);
    assert.equal(wf.frontendPlan.planner, "workflow-planner:claude-test");
    assert.equal(wf.site.url, "https://savings-club.sites.test");
    assert.ok(wf.validation.ok);
    const contracts = job(h, wf.contracts.id);
    assert.ok(contracts.nodes.some((n: any) => n.skill === "audit-judge"));
    assert.ok(!contracts.nodes.some((n: any) => n.skill === "frontend-for-contract"), "front-end steps are split off");
    const front = job(h, wf.frontend.id);
    assert.deepEqual(front.nodes.map((n: any) => n.skill), ["frontend-for-contract", "site-content-check"]);
    assert.equal(front.nodes[0].inputs[0].path, "launch.json");
    assert.equal((await get(h, "/workflows")).body.workflows[0].status, "completed");
    for (const w of ws) await w.stop();
  } finally {
    await h.close();
  }
});
