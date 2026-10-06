import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { MemoryStore } from "../src/store.ts";
import { MemoryBlobStore } from "../src/storage.ts";
import { harness, seat, worker, until, job, get, post } from "./helpers.ts";

test("GET /health works with no chain, no database and no keys, and says what is degraded", async () => {
  const app = await App.create({ cfg: loadConfig({ PORT: "0" }), store: new MemoryStore(), blobs: new MemoryBlobStore(), timers: false });
  try {
    const port = await app.listen(0, "127.0.0.1");
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status, 200);
    const h: any = await r.json();
    assert.equal(h.status, "degraded");
    assert.ok(h.degraded.includes("chain_not_configured"));
    assert.ok(h.degraded.includes("payments_mock"));
    assert.equal(h.chain.configured, false);
    assert.equal(h.database.driver, "memory");
    assert.equal(h.identity.chainId, 4663, "Robinhood Chain mainnet is the default");
    for (const k of ["connectedDaemons", "dispatch", "workingNow", "acceptedLastDay", "activeEnrollments", "pendingVerification", "pendingAttestation", "pendingDeployment", "pendingDeploymentByChain", "deployBreaker", "pendingDelivery", "pendingFeedback", "pendingOracle", "pendingFuzz", "pendingSites", "verifierUp", "publisherUp", "deployerUp", "computedAt"]) assert.ok(k in h, k);
    const pair = await fetch(`http://127.0.0.1:${port}/pair/wallet/0x0000000000000000000000000000000000000001`);
    assert.equal(pair.status, 503, "chain reads report 503 when no RPC is configured");
    const q = await fetch(`http://127.0.0.1:${port}/requests/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "oracle.request", input: { v: 1, question: "How many swaps happened in the window?", chainId: 46630, window: { hours: 1 }, answerType: "uint256", panelSize: 5, quorum: 3, validForSeconds: 600 } }) });
    assert.equal(((await q.json()) as any).blockers[0].code, "unsupported_chain");
  } finally {
    await app.close();
  }
});

test("read routes: version, services, skills, policies, reads, explorer JSON, pagination and errors", async () => {
  const h = await harness({
    env: { READS_PER_MINUTE: "400" },
    fetch: (async (url: string) => {
      const u = String(url);
      const body = u.endsWith("/repos/owner/repo") ? { private: false, size: 1024, default_branch: "main" } : u.includes("/commits/") ? { sha: "0123456789abcdef0123456789abcdef01234567" } : u.includes("/contents") ? [{ name: "package.json" }, { name: "index.html" }] : null;
      return new Response(body ? JSON.stringify(body) : "{}", { status: body ? 200 : 404 });
    }) as any,
  });
  try {
    assert.equal((await get(h, "/version")).body.protocolVersion, 1);
    const services = (await get(h, "/services")).body.services;
    assert.deepEqual(services.map((s: any) => s.name), ["The Clerk", "Records Office", "Registrar", "Attester", "Scheduler", "Settler", "Keeper"]);
    const skills = (await get(h, "/skills")).body.skills;
    assert.ok(skills.length >= 51, `${skills.length} skills`);
    const web = skills.find((s: any) => s.id === "build-website");
    assert.equal(web.inference, "premium");
    assert.deepEqual(web.requires, ["network"]);
    assert.equal(skills.find((s: any) => s.id === "defi-native").role, "reference");
    const pol = (await get(h, "/launch/policies")).body;
    assert.equal(pol.count, 8);
    const t = pol.policies.find((p: any) => p.params.chainId === 46630 && p.kind === "univ4_hook").params;
    assert.equal(t.rewardRule, "equal_connected");
    assert.equal(t.totalSupply, "1000000000000000000000000000");
    assert.deepEqual([t.treasuryBps, t.liquidityBps, t.contributorPoolBps, t.recentContributorBps, t.perWalletCapBps, t.poolFloorBps, t.contributorLockSeconds], [1000, 8000, 1000, 800, 3000, 1000, 3600]);
    assert.equal(t.recentContributorWindowSeconds, 43200);
    assert.equal(pol.policies.find((p: any) => p.params.chainId === 4663).params.recentContributorWindowSeconds, 86400);
    assert.deepEqual(t.feeTiers, [500, 3000, 10000]);
    assert.equal((await get(h, "/reads/skill/adversarial-review")).body.files[0].path, "SKILL.md");
    assert.equal((await get(h, "/reads/rpcs/all")).body.files[0].path, "rpcs.json");
    assert.equal((await get(h, "/reads/nope/x")).status, 404);

    const s = await seat(h, 1);
    const w = await worker(h, s);
    const j = h.app.engine.admitJob({ objective: "Write docs for the vault.", skill: "write-readme-and-docs", paths: ["README.md"], outputs: [{ name: "notes", path: "artifacts/notes.md", mediaType: "text/markdown" }] }, { paidBy: s.account.address });
    await until(() => job(h, j.id).state === "completed", "job");
    const list = (await get(h, "/jobs?limit=1")).body;
    assert.equal(list.count, 1);
    for (const k of ["id", "state", "template", "objective", "blockedReason", "delivery", "createdAt", "updatedAt", "project"]) assert.ok(k in list.jobs[0], k);
    assert.equal((await get(h, `/jobs?before=${encodeURIComponent(list.jobs[0].createdAt)}`)).body.count, 0);
    assert.equal((await get(h, "/jobs?q=vault")).body.count, 1);
    assert.equal((await get(h, "/jobs?limit=x")).body.error, "invalid_query");
    const result = (await get(h, `/jobs/${j.id}/result`)).body;
    assert.equal(result.complete, true);
    assert.equal(result.files[0].name, "notes");
    assert.match(result.files[0].submissionHash, /^[0-9a-f]{64}$/);
    const art = await fetch(result.files[0].url.replace(/^http:\/\/127\.0\.0\.1(:\d+)?/, h.url));
    assert.equal(art.status, 200);
    const subsView = (await get(h, `/jobs/${j.id}/submissions`)).body;
    assert.equal(subsView.count, 1);
    assert.equal(subsView.submissions[0].accepted, true);
    assert.equal(subsView.submissions[0].outcome, "accepted");
    assert.equal((await get(h, "/jobs?state=completed")).body.count, 1);
    assert.equal((await get(h, "/jobs?state=running")).body.count, 0);
    assert.equal((await get(h, "/jobs?state=incomplete")).body.count, 0);
    assert.equal((await get(h, "/jobs/not-a-uuid")).body.error, "invalid_id");
    assert.equal((await get(h, "/jobs/3b589ab6-de1e-416c-ac37-1fca5aef3179")).status, 404);
    assert.equal((await get(h, "/no/such/route")).status, 404);
    assert.equal((await post(h, "/health", {})).status, 405);
    assert.equal((await get(h, "/swarm")).body.health.agentsOnline, 1);
    assert.equal((await get(h, "/workers?fields=tokenId,skills")).body.workers[0].tokenId, "1");
    const standing = (await get(h, `/workers/${s.key.deviceKey}/standing`)).body;
    assert.equal(standing.dispatch.eligible, true);
    assert.equal((await get(h, "/seats/records")).body.seats[0].accepted, 1);
    assert.equal((await get(h, "/seats/owners")).body.owners[1], s.account.address.toLowerCase());
    assert.equal((await get(h, "/seats/1?work=5")).body.work.length, 1);
    assert.equal((await get(h, "/seats/1/standing")).body.presence.online, true);
    const contrib = (await get(h, "/contributors")).body.contributors[0];
    assert.equal(contrib.accepted, 1);
    assert.equal(contrib.tokenId, "1");
    assert.equal(typeof contrib.turns, "number");
    assert.equal(typeof contrib.hours, "number");
    const sw = (await get(h, "/swarm")).body;
    assert.ok(sw.counts.jobStates.completed >= 1);
    assert.ok(sw.events.length > 0 && sw.events.every((e: any) => typeof e.at === "string" && typeof e.kind === "string" && typeof e.text === "string"));
    assert.ok(sw.events.some((e: any) => e.kind === "accepted" && e.jobId === j.id));
    const wk = (await get(h, "/workers")).body.workers[0];
    for (const k of ["runtime", "model", "effort", "premium", "runtimeName"]) assert.ok(k in wk, k);
    const seatV = (await get(h, "/seats/1")).body;
    for (const k of ["runtime", "model", "effort", "premium", "runtimes", "chainId", "collection", "status", "devices", "turns", "wallClockMs"]) assert.ok(k in seatV, k);
    assert.equal((await get(h, "/api/agents/1")).body.accepted, 1);
    assert.equal((await get(h, "/api/activity")).body.total, 1);
    assert.equal((await get(h, "/api/search?q=vault")).body.groups[0].hits.length, 1);
    const pubs = (await get(h, "/publications?type=code")).body;
    assert.equal(pubs.count, 1);
    assert.deepEqual(Object.keys((await get(h, "/publications/counts")).body.counts), ["all", "tokens", "contracts", "sites", "research", "code", "media", "audits"]);
    assert.equal((await get(h, "/steps/hourly")).body.accepted.reduce((a: number, b: number) => a + b, 0), 1);
    const assessments = (await get(h, `/jobs/${j.id}/assessments`)).body;
    assert.deepEqual(assessments.assessments, []);

    const imp = await post(h, "/requests/import", { url: "https://github.com/owner/repo", kind: "site" });
    assert.equal(imp.body.ok, true);
    assert.equal(imp.body.source.baseCommit, "0123456789abcdef0123456789abcdef01234567");
    assert.equal(imp.body.source.site.framework, "node");
    assert.equal((await post(h, "/requests/import", { url: "https://github.com/owner/missing", kind: "code" })).body.problems[0].code, "not_found");
    assert.equal((await post(h, "/requests/import", { url: "https://gitlab.com/x/y", kind: "code" })).body.ok, false);
    const chk = (await post(h, "/requests/check", { action: "launch.open", input: { objective: "Token.", shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }], onchain: "univ4_hook" } })).body;
    assert.deepEqual(chk.blockers, []);
    assert.ok(chk.plan.some((l: string) => l.startsWith("audit_judge")));
    const sch = (await post(h, "/requests/check", { action: "schedule.create", input: { action: "job.open", input: { objective: "Weekly brief.", skill: "research-report" }, cadence: { every: "P1W" }, runs: 4 } })).body;
    assert.equal(sch.amount, String(4n * 100n * 10n ** 18n));

    // reads are capped per IP (too_many_reads)
    let last: any;
    for (let i = 0; i < 400; i++) { last = await get(h, "/version"); if (last.status === 429) break; }
    assert.equal(last.status, 429);
    assert.equal(last.body.error, "too_many_reads");
    await w.stop();
  } finally {
    await h.close();
  }
});
