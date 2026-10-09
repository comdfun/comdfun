/**
 * Every HTTP route (IMD's API, re-pointed): reads, paid requests, pairing and agents, device calls, sites and
 * names, explorer JSON. Host-header site serving and CORS/rate limits live in `handler`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { CHAINS, DEVICE_KEY_RE, HASH_RE, LIMITS, PROTOCOL_VERSION, UUID_RE, type Attempt, type SubmissionRecord } from "@company/protocol";
import type { App } from "./app.ts";
import { API_VERSION } from "./config.ts";
import { ApiError, E } from "./errors.ts";
import { redactRpc } from "./chain.ts";
import { Router, bearerOf, clientIp, errorRes, json, parseBefore, parseLimit, parseSince, readBody, send, type Req, type Res, type RouteOpts } from "./http.ts";
import type { JobX } from "./engine.ts";
import type { AssuranceRecord, DocumentRecord, FeedbackBatch, LaunchRecord, OracleRecord, OrderRecord, PolicyRecord, RewardEpoch, ScheduleRecord, SeatRecord, SiteRecord, WorkflowRecord } from "./records.ts";
import { iso } from "./store.ts";
import { artStatus, brandFile, collectionDoc, counselCardPng, counselCardSvg, counselShareCardPng, counselPortraitSvg, validTokenId } from "./art.ts";
import { ARTIFACT_LIMIT, BUNDLE_LIMIT } from "./device.ts";
import { pairPage } from "./pairpage.ts";

type A = Attempt & { id: string; createdAt: string };
type S = SubmissionRecord & { id: string };

const DAY = 86_400_000;

export function buildRouter(app: App): Router {
  const r = new Router();
  const jobs = () => app.store.c<JobX>("jobs");
  const attempts = () => app.store.c<A>("attempts");
  const subs = () => app.store.c<S>("submissions");
  const getJob = (id: string) => {
    if (!UUID_RE.test(id)) throw E.invalidId("job id must be a UUID");
    const j = jobs().get(id);
    if (!j) throw E.notFound("no such job");
    return j;
  };
  const read: RouteOpts = { cors: "public", bucket: "read" };
  // token metadata, portraits and brand files: no per-IP limit — marketplace indexers (OpenSea, Blockscout) fetch the
  // whole collection from a handful of addresses in one burst; the responses are deterministic and cached
  const pub: RouteOpts = { cors: "public", bucket: "none" };
  const paid: RouteOpts = { cors: "paid", bucket: "paid", limit: LIMITS.paidBodyBytes };

  // ------------------------------------------------------------------------------------------ basics

  r.get("/version", () => json(200, { name: "Company.md", token: "COMD", contact: app.cfg.contactEmail, web: app.cfg.publicWebUrl, commit: app.cfg.commit, branch: app.cfg.branch, deployedAt: app.cfg.deployedAt, protocolVersion: PROTOCOL_VERSION, version: API_VERSION, features: { scheduling: true, verificationQueue: true, startCommitAttribution: true, sites: true, names: true, ens: false, rewards: true } }), read);
  r.get("/health", async () => json(200, await health(app)), read);
  r.get("/services", () => {
    const st = app.services.status();
    const up = Math.floor((app.now() - app.startedAt) / 1000);
    const row = (kind: string, name: string, s: { up: boolean; version: string; keyPrefix: string | null; mode: string }) => ({ kind, name, keyPrefix: s.keyPrefix, version: s.version, mode: s.mode, up: s.up, uptimeSeconds: up });
    return json(200, {
      services: [
        row("verifier", "The Clerk", st.verifier),
        row("publisher", "Records Office", st.publisher),
        row("deployer", "Registrar", st.deployer),
        row("attester", "Attester", st.attester),
        { kind: "scheduler", name: "Scheduler", keyPrefix: null, version: API_VERSION, mode: "in-process", up: true, uptimeSeconds: up },
        { kind: "settler", name: "Settler", keyPrefix: app.writer?.address.slice(0, 10) ?? null, version: API_VERSION, mode: app.writer ? "chain" : "queue", up: true, uptimeSeconds: up },
        (() => { const k = app.keeper.status(); return { kind: "keeper", name: "Keeper", keyPrefix: k.address?.slice(0, 10) ?? null, version: API_VERSION, mode: k.enabled ? "chain" : "off", up: k.enabled && !k.lowGas && !k.lastError, uptimeSeconds: up, keeper: k }; })(),
      ],
    });
  }, read);
  r.get("/skills", () => {
    const att = attempts().all();
    const nodeSkill = new Map<string, string>();
    for (const j of jobs().all()) for (const n of j.nodes) nodeSkill.set(`${j.id}:${n.key}`, n.skill);
    const rec = new Map<string, { attempts: number; accepted: number; rejected: number; pending: number; wallClockMs: number }>();
    for (const a of att) {
      const s = nodeSkill.get(`${a.jobId}:${a.nodeKey}`);
      if (!s) continue;
      const x = rec.get(s) ?? { attempts: 0, accepted: 0, rejected: 0, pending: 0, wallClockMs: 0 };
      x.attempts++;
      if (a.state === "accepted") x.accepted++;
      else if (a.state === "rejected") x.rejected++;
      else if (a.state === "leased" || a.state === "submitted") x.pending++;
      if (a.finishedAt) x.wallClockMs += Date.parse(a.finishedAt) - Date.parse(a.leasedAt);
      rec.set(s, x);
    }
    return json(200, {
      skills: app.skills.all().map((s) => ({
        id: s.id, version: s.version, description: s.description, role: s.role, kind: "code",
        judge: s.role === "reference" ? null : s.tier === 1 ? "verifier-rerun" : "verifier-paths",
        tier: s.tier, requires: s.requires, inference: s.inference, checks: s.checks.length ? s.checks : s.tier === 1 ? "foundry" : s.role === "reference" ? null : "paths",
        hash: s.hash, upstream: s.upstream, upstreamCommit: null, licence: s.licence,
        record: { ...(rec.get(s.id) ?? { attempts: 0, accepted: 0, rejected: 0, pending: 0, wallClockMs: 0 }), wallClockMs: String(rec.get(s.id)?.wallClockMs ?? 0) },
      })),
    });
  }, read);
  r.get("/reads/:namespace/:name", (q) => json(200, reads(app, q.params.namespace, q.params.name)), read);
  r.get("/steps/hourly", () => {
    const until = Math.floor(app.now() / 3_600_000) * 3_600_000 + 3_600_000;
    const counts = new Array(24).fill(0);
    for (const a of attempts().filter((x) => x.state === "accepted" && !!x.finishedAt)) {
      const t = Date.parse(a.finishedAt!);
      const i = Math.floor((until - t) / 3_600_000);
      if (i >= 0 && i < 24) counts[23 - i]++;
    }
    return json(200, { until: iso(until), hours: 24, accepted: counts }, { "access-control-allow-origin": "*" });
  }, read);

  // ------------------------------------------------------------------------------------------ jobs

  r.get("/jobs", (q) => {
    const limit = parseLimit(q.query, 100);
    const before = parseBefore(q.query);
    const since = parseSince(q.query);
    const text = (q.query.get("q") ?? "").trim().toLowerCase();
    if (text.length > 200) throw E.invalidQuery("q is at most 200 characters");
    // web tabs: running (executing/delivering/planning), incomplete (blocked/cancelled/superseded), completed; or raw states
    const STATE_GROUPS: Record<string, string[]> = { running: ["planning", "executing", "delivering", "pending"], incomplete: ["blocked", "cancelled", "superseded", "failed"], completed: ["completed"] };
    const states = q.query.get("state")?.split(",").filter(Boolean).flatMap((x) => STATE_GROUPS[x] ?? [x]);
    const excludeOracle = q.query.get("exclude") === "oracle";
    const rows = jobs().newest({
      before, limit,
      filter: (j) => (!since || Date.parse(j.createdAt) >= since) && (!excludeOracle || !j.oracleRequestId) && (!states || states.includes(j.state)) && (!text || j.id.includes(text) || j.objective.toLowerCase().includes(text)),
    });
    return json(200, { count: rows.length, jobs: rows.map((j) => jobListItem(app, j)) });
  }, read);
  r.get("/jobs/:id", (q) => json(200, jobView(app, getJob(q.params.id))), read);
  r.get("/jobs/:id/submissions", (q) => {
    const j = getJob(q.params.id);
    const atts = attempts().filter((a) => a.jobId === j.id);
    const rows = subs().filter((s) => s.jobId === j.id).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((s) => {
      const n = j.nodes.find((x) => x.key === s.nodeKey);
      const a = atts.find((x) => x.submissionHash === s.hash);
      return {
        hash: s.hash, nodeKey: s.nodeKey, role: n?.role ?? null, kind: n?.kind ?? null, skill: n?.skill ?? null, attempt: a?.attempt ?? 1, deviceKey: a?.deviceKey ?? null,
        seat: { tokenId: s.tokenId, agentId: s.agentId }, tokenId: s.tokenId, agentId: s.agentId, wallet: s.wallet,
        outcome: s.accepted === true ? "accepted" : s.accepted === false ? "rejected" : "pending", accepted: s.accepted, failureReason: s.accepted === false ? s.verdict?.detail ?? null : null,
        verdict: s.verdict, oracleResult: s.oracleResult, findings: s.findings,
        usage: { ...s.usage, model: s.runtime?.model ?? null, runtime: s.runtime?.name ?? null, effort: s.runtime?.effort ?? null, wallClockMs: s.usage.durationMs ?? 0, cachedInputTokens: (s.usage as any).cachedInputTokens ?? 0 },
        runtime: s.runtime, summary: s.summary, bundleHash: s.bundleHash, files: s.files, artifacts: s.artifacts, changedPaths: s.files.map((f) => f.path), createdAt: s.createdAt,
      };
    });
    return json(200, { jobId: j.id, repoUrl: j.delivery?.repoUrl ?? j.input.repoUrl ?? null, baseCommit: j.input.baseCommit ?? null, count: rows.length, submissions: rows });
  }, read);
  r.get("/jobs/:id/result", (q) => json(200, jobResult(app, getJob(q.params.id))), read);
  r.get("/jobs/:id/report.md", (q) => {
    const j = getJob(q.params.id);
    if (!j.report) throw E.notFound("no audit report for this job");
    return { status: 200, raw: j.report, headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*" } };
  }, read);
  r.get("/jobs/:id/panel", (q) => {
    const j = getJob(q.params.id);
    const members = j.nodes.filter((n) => n.kind === "panel");
    if (!members.length) throw E.notFound("this job has no panel");
    const answers = members.filter((n) => n.submissionHash).map((n) => {
      const s = subs().get(n.submissionHash!)!;
      const res = (s.result ?? {}) as any;
      return { nodeKey: n.key, wallet: s.wallet, tokenId: s.tokenId, runtime: s.runtime, usage: s.usage, answer: res.answer ?? null, citations: res.citations ?? [], refuse: res.refuse ?? null, submissionHash: s.hash, accepted: s.accepted };
    });
    const p = j.panel ?? { state: j.state === "executing" ? "open" : j.state === "completed" ? "agreed" : "disagreed", wanted: members.length, quorum: j.oracleRequestId ? app.store.c<OracleRecord>("oracle").get(j.oracleRequestId)?.quorum ?? 0 : 0, winner: null, closedAt: null };
    return json(200, { jobId: j.id, state: p.state, wanted: p.wanted, quorum: p.quorum, winner: p.winner, closedAt: p.closedAt, answers });
  }, read);
  r.get("/jobs/:id/fuzz", (q) => {
    const j = getJob(q.params.id);
    const v = app.fuzz.view(j.id);
    if (!v) throw E.notFound("no fuzz campaign for this job");
    return json(200, v);
  }, read);
  r.get("/jobs/:id/records", (q) => {
    const j = getJob(q.params.id);
    const batches = app.store.c<FeedbackBatch>("feedback").filter((b) => b.jobId === j.id);
    const records = batches.flatMap((b) => b.entries.map((e) => ({ id: b.id, nodeKey: e.nodeKey, hash: e.feedbackHash, chainId: b.chainId, registry: b.registry, agentId: e.agentId, status: b.status, txHash: e.txHash ?? b.txHash, failure: b.failure })));
    const oracleBatches = j.oracleRequestId ? batches.map((b) => ({ id: b.id, status: b.status, documentHash: b.documentHash, txHash: b.txHash })) : [];
    return json(200, { records, oracleBatches });
  }, read);
  r.get("/jobs/:id/assessments", (q) => {
    const j = getJob(q.params.id);
    return json(200, { assessments: app.store.c<DocumentRecord>("documents").filter((d) => d.jobId === j.id && d.kind === "review-document").map((d) => ({ key: d.key, hash: d.id, document: d.body })) });
  }, read);

  // ------------------------------------------------------------------------------------------ workflows

  r.get("/workflows", (q) => {
    const rows = app.store.c<WorkflowRecord>("workflows").newest({ before: parseBefore(q.query), limit: parseLimit(q.query, 100), filter: (w) => { const s = parseSince(q.query); return !s || Date.parse(w.createdAt) >= s; } });
    return json(200, { count: rows.length, workflows: rows.map((w) => app.workflows.listItem(w)) });
  }, read);
  r.get("/workflows/:id", (q) => {
    if (!UUID_RE.test(q.params.id)) throw E.invalidId();
    const w = app.store.c<WorkflowRecord>("workflows").get(q.params.id);
    if (!w) throw E.notFound("no such workflow");
    return json(200, app.workflows.view(w));
  }, read);

  // ------------------------------------------------------------------------------------------ oracle

  const getReq = (id: string) => {
    if (!UUID_RE.test(id)) throw E.invalidId();
    const x = app.store.c<OracleRecord>("oracle").get(id);
    if (!x) throw E.notFound("no such oracle request");
    return x;
  };
  r.get("/oracle/requests", (q) => {
    const statuses = q.query.get("status")?.split(",").filter(Boolean);
    const jobId = q.query.get("jobId");
    const text = (q.query.get("q") ?? "").toLowerCase();
    if (text.length > 200) throw E.invalidQuery("q is at most 200 characters");
    const rows = app.store.c<OracleRecord>("oracle").newest({ before: parseBefore(q.query), limit: parseLimit(q.query, 100), filter: (x) => (!statuses || statuses.includes(x.status)) && (!jobId || x.jobId === jobId) && (!text || x.question.toLowerCase().includes(text) || x.id.includes(text)) });
    return json(200, { count: rows.length, attester: app.services.status().attester.keyPrefix ? attesterAddress(app) : null, requests: rows.map((x) => app.oracle.listItem(x)) });
  }, read);
  r.get("/oracle/counts", () => {
    const byStatus: Record<string, number> = {};
    for (const x of app.store.c<OracleRecord>("oracle").all()) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    return json(200, { total: app.store.c("oracle").count(), byStatus }, { "access-control-allow-origin": "*" });
  }, read);
  r.get("/oracle/requests/:id", (q) => json(200, app.oracle.view(getReq(q.params.id), q.query.get("members"))), read);
  r.get("/oracle/requests/:id/attestation", (q) => {
    const v = app.oracle.attestationView(getReq(q.params.id));
    if (!v) throw new ApiError(404, "not_attested", "the oracle has not attested this request (yet)");
    return json(200, v);
  }, read);
  r.get("/oracle/requests/:id/pools", (q) => json(200, app.oracle.pools(getReq(q.params.id))), read);

  // ------------------------------------------------------------------------------------------ schedules

  r.get("/schedules", (q) => {
    const owner = q.query.get("owner")?.toLowerCase();
    if (owner && !/^0x[0-9a-f]{40}$/.test(owner)) throw E.invalidQuery("owner must be an address");
    const rows = app.store.c<ScheduleRecord>("schedules").newest({ before: parseBefore(q.query), limit: parseLimit(q.query, 100), filter: (s) => !owner || s.owner === owner });
    return json(200, { count: rows.length, schedules: rows.map((s) => app.scheduler.listItem(s)) });
  }, read);
  r.get("/schedules/:id", (q) => {
    if (!UUID_RE.test(q.params.id)) throw E.invalidId();
    const s = app.store.c<ScheduleRecord>("schedules").get(q.params.id);
    if (!s) throw E.notFound("no such schedule");
    return json(200, app.scheduler.view(s));
  }, read);

  // ------------------------------------------------------------------------------------------ research & fuzz

  r.get("/research/panels", (q) => {
    const limit = parseLimit(q.query, 5, 20);
    const rows = jobs().filter((j) => !!j.panel && j.panel.state !== "open").sort((a, b) => ((a.panel!.closedAt ?? "") < (b.panel!.closedAt ?? "") ? 1 : -1)).slice(0, limit);
    return json(200, { count: rows.length, panels: rows.map((j) => ({ jobId: j.id, objective: j.objective, state: j.panel!.state, wanted: j.panel!.wanted, quorum: j.panel!.quorum, winner: j.panel!.winner, closedAt: j.panel!.closedAt, url: `/jobs/${j.id}/panel` })) });
  }, read);
  r.get("/fuzz/results", (q) => json(200, app.fuzz.list(parseLimit(q.query, 50, 200))), read);

  // ------------------------------------------------------------------------------------------ fleet & seats

  r.get("/swarm", async () => json(200, await swarm(app), { "access-control-allow-origin": "*", "cache-control": "public, max-age=10" }), read);
  r.get("/workers", (q) => {
    const fields = q.query.get("fields")?.split(",").map((s) => s.trim()).filter(Boolean);
    const rows = [...app.engine.sessions.values()].map((s) => {
      const full: Record<string, unknown> = {
        deviceKey: s.deviceKey, tokenId: s.tokenId, agentId: s.agentId, wallet: s.wallet, working: app.engine.load(s.deviceKey) > 0, load: app.engine.load(s.deviceKey), version: s.version,
        // runtime: claude | codex (mock in tests); model id and reasoning effort as advertised; premium = top-tier model at high effort
        runtimes: [s.runtime.name], runtime: s.runtime, runtimeName: s.runtime.name, model: s.runtime.model, effort: s.runtime.effort, premium: s.premium,
        tools: s.tools, skills: [...s.skills].sort(), concurrency: s.concurrency, paused: s.paused,
        connectedAt: iso(s.connectedAt), heartbeat: iso(s.lastHeartbeat),
      };
      return fields ? Object.fromEntries(fields.filter((f) => f in full).map((f) => [f, full[f]])) : full;
    });
    return json(200, { count: rows.length, workers: rows });
  }, read);
  r.get("/workers/:deviceKey/standing", (q) => {
    if (!DEVICE_KEY_RE.test(q.params.deviceKey)) throw E.invalidId("deviceKey must be 64 lowercase hex");
    return json(200, standing(app, q.params.deviceKey, q.query.get("queue") !== "0"));
  }, read);
  r.get("/contributors", () => {
    // one row per Counsel token (its current/latest device): turns and wall-clock time of every attempt
    const by = new Map<string, any>();
    for (const a of attempts().all().sort((x, y) => (x.leasedAt < y.leasedAt ? -1 : 1))) {
      const x = by.get(a.tokenId) ?? { deviceKey: a.deviceKey, tokenId: a.tokenId, agentId: a.agentId ?? null, wallet: a.wallet, attempts: 0, accepted: 0, rejected: 0, failed: 0, pending: 0, turns: 0, inputTokens: 0, outputTokens: 0, wallClockMs: 0, hours: 0, devices: [] as string[] };
      x.deviceKey = a.deviceKey;
      x.wallet = a.wallet;
      if (!x.devices.includes(a.deviceKey)) x.devices.push(a.deviceKey);
      x.attempts++;
      if (a.state === "accepted") x.accepted++;
      else if (a.state === "rejected") x.rejected++;
      else if (a.state === "expired" || a.state === "failed") x.failed++;
      else if (a.state === "leased" || a.state === "submitted") x.pending++;
      if (a.finishedAt) x.wallClockMs += Date.parse(a.finishedAt) - Date.parse(a.leasedAt);
      const s = a.submissionHash ? subs().get(a.submissionHash) : undefined;
      if (s) { x.turns += s.usage.turns ?? 0; x.inputTokens += s.usage.inputTokens ?? 0; x.outputTokens += s.usage.outputTokens ?? 0; }
      x.hours = Math.round((x.wallClockMs / 3_600_000) * 100) / 100;
      by.set(a.tokenId, x);
    }
    return json(200, { count: by.size, contributors: [...by.values()].sort((a, b) => b.accepted - a.accepted || Number(a.tokenId) - Number(b.tokenId)) });
  }, read);
  // the first hundred registered Counsel — a public list and a trait ("Founding Hundred · #n")
  r.get("/seats/founding", () => {
    const f = app.pairing.founding();
    return json(200, { limit: f.limit, registered: f.registered, spotsLeft: f.spotsLeft, seats: f.seats }, { "cache-control": "public, max-age=15" });
  }, read);
  r.get("/seats/records", () => {
    const seats = seatCounters(app);
    return json(200, { count: seats.length, seats }, { "cache-control": "public, max-age=5" });
  }, read);
  r.get("/seats/owners", async () => {
    try { await app.pairing.refreshOwners(); } catch (e) { if (!app.pairing.owners.at) throw E.unavailable("chain_unavailable", redactRpc((e as Error).message)); }
    return json(200, { refreshedAt: iso(app.pairing.owners.at), owners: app.pairing.owners.owners });
  }, read);
  r.get("/seats/:tokenId", (q) => json(200, seatView(app, q.params.tokenId, cap(q.query.get("work"), 50), cap(q.query.get("reviews"), 50))), read);
  r.get("/seats/:tokenId/standing", (q) => {
    const tokenId = tokenParam(q.params.tokenId);
    const s = app.engine.sessionForToken(tokenId);
    const e = app.store.c<any>("enrollments").find((x: any) => x.tokenId === tokenId && x.status === "active");
    return json(200, { tokenId, ...(e ? standing(app, e.deviceKey, true) : { enrollment: { status: "unknown" }, presence: { online: false }, dispatch: { eligible: false, reasons: ["no enrolled device"] } }), running: s ? app.engine.openLeases(s.deviceKey).map((l) => ({ jobId: l.jobId, nodeKey: l.nodeKey, leaseId: l.leaseId, expiresAt: l.expiresAt })) : [] });
  }, read);
  r.get("/wallets/:address/earnings", (q) => {
    const a = q.params.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(a)) throw E.invalidId("address must be 0x + 40 hex");
    const limit = parseLimit(q.query, 50, 200);
    const before = q.query.get("before") ? Number(q.query.get("before")) : Infinity;
    const rows = app.store.c<LaunchRecord>("launches").all().filter((l) => l.launchNumber < before && l.rewardSnapshot?.claims?.some((c) => c.account.toLowerCase() === a)).sort((x, y) => y.launchNumber - x.launchNumber);
    const page = rows.slice(0, limit);
    const earnings = page.map((l) => {
      const c = l.rewardSnapshot!.claims!.find((x) => x.account.toLowerCase() === a)!;
      const e = l.rewardSnapshot!.entries.find((x) => x.account.toLowerCase() === a);
      return { kind: "launch", launchId: l.id, launchNumber: l.launchNumber, chainId: l.chainId, token: l.token, amount: c.amount, workerShare: e?.workerShare ?? "0", connectedShare: e?.connectedShare ?? "0", root: l.rewardSnapshot!.root, proof: c.proof, unlockAt: l.rewardSnapshot!.unlockAt };
    });
    const owned = new Set(app.store.c<SeatRecord>("seats").filter((s) => s.owner === a).map((s) => s.tokenId));
    const rewards = app.store.c<RewardEpoch>("epochs").all().flatMap((ep) => (ep.assets ?? []).flatMap((as) => as.entries.filter((e) => owned.has(e.tokenId)).map((e) => ({ kind: "epoch", epoch: ep.epoch, tokenId: e.tokenId, asset: as.asset, symbol: as.symbol, decimals: as.decimals, amount: e.amount, root: as.root, proof: e.proof, status: as.status, txHash: as.txHash }))));
    return json(200, { wallet: a, count: earnings.length, next: rows.length > limit ? page[page.length - 1].launchNumber : null, earnings, rewards });
  }, read);

  // ------------------------------------------------------------------------------------------ publications, sites, names

  r.get("/publications", (q) => {
    const type = q.query.get("type") ?? "all";
    if (!["all", "tokens", "contracts", "sites", "research", "code", "media", "audits"].includes(type)) throw E.invalidQuery("unknown type");
    const sort = q.query.get("sort") ?? "newest";
    if (sort !== "newest" && sort !== "oldest") throw E.invalidQuery("sort is newest or oldest");
    const pageSize = Math.max(1, Math.min(100, Number(q.query.get("pageSize") ?? 25) || 25));
    const page = Math.max(1, Number(q.query.get("page") ?? 1) || 1);
    const text = (q.query.get("q") ?? "").toLowerCase();
    let items = publications(app).filter((i) => (type === "all" || i.types.includes(type)) && (!text || i.title.toLowerCase().includes(text) || i.id.includes(text)));
    if (sort === "oldest") items = items.reverse();
    return json(200, { q: text, page, sort, type, count: items.length, items: items.slice((page - 1) * pageSize, page * pageSize), pageSize, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) });
  }, read);
  r.get("/publications/counts", () => {
    const counts: Record<string, number> = { all: 0, tokens: 0, contracts: 0, sites: 0, research: 0, code: 0, media: 0, audits: 0 };
    for (const i of publications(app)) { counts.all++; for (const t of i.types) counts[t]++; }
    return json(200, { counts });
  }, read);
  r.get("/sites", () => json(200, app.sites.list()), read);
  r.get("/sites/by-label/:label", (q) => json(200, app.sites.byLabel(q.params.label), { "cache-control": "public, max-age=15" }), read);
  r.get("/sites/:id", (q) => {
    if (!UUID_RE.test(q.params.id)) throw E.invalidId();
    const s = app.store.c<SiteRecord>("sites").get(q.params.id);
    if (!s) throw E.notFound("no such site");
    return json(200, app.sites.view(s));
  }, read);
  r.post("/sites/publish", async (q) => json(201, await app.sites.devicePublish(q.json())), { cors: "none", bucket: "device", limit: 64 * 1024 });
  r.get("/names", () => json(200, app.sites.names()), read);
  r.get("/names/:label", (q) => json(200, app.sites.name(q.params.label)), read);
  for (const p of ["/ens", "/ens/:a", "/ens/:a/:b", "/ens/:a/:b/:c"]) {
    r.get(p, () => { throw E.featureOff("ENS is not used on Robinhood Chain; see /names"); }, read);
    r.post(p, () => { throw E.featureOff("ENS is not used on Robinhood Chain; see /names"); }, read);
  }

  // ------------------------------------------------------------------------------------------ launches

  const getLaunch = (id: string) => {
    const col = app.store.c<LaunchRecord>("launches");
    const l = UUID_RE.test(id) ? col.get(id) : /^[0-9]+$/.test(id) ? col.find((x) => x.launchNumber === Number(id)) : undefined;
    if (!UUID_RE.test(id) && !/^[0-9]+$/.test(id)) throw E.invalidId("launch id is a UUID or launch number");
    if (!l) throw E.notFound("no such launch");
    return l;
  };
  r.get("/launches", (q) => {
    const limit = parseLimit(q.query, 100);
    const before = q.query.get("before") ? Number(q.query.get("before")) : Infinity;
    if (!Number.isFinite(before) && q.query.get("before")) throw E.invalidQuery("before is a launch number");
    const rows = app.store.c<LaunchRecord>("launches").all().filter((l) => l.launchNumber < before).sort((a, b) => b.launchNumber - a.launchNumber).slice(0, limit);
    return json(200, { count: rows.length, launches: rows.map(launchListItem) });
  }, read);
  r.get("/launches/:id", (q) => json(200, launchView(app, getLaunch(q.params.id), q.query.get("work") === "1", q.query.get("claims") === "1")), read);
  r.get("/launches/:id/claims/:address", (q) => {
    const a = q.params.address;
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw E.invalidId("address must be 0x + 40 hex");
    return json(200, app.launches.claimView(getLaunch(q.params.id), a));
  }, read);
  r.get("/launches/:id/assurances", (q) => {
    const l = getLaunch(q.params.id);
    const rows = app.store.c<AssuranceRecord>("assurances").filter((a) => a.launchId === l.id).map(({ id: _i, createdAt: _c, launchId: _l, ...a }) => a);
    return json(200, { launchId: l.id, count: rows.length, assurances: rows });
  }, read);
  r.post("/launches/:id/assurances", (q) => {
    if (!app.cfg.adminToken || q.bearer !== app.cfg.adminToken) throw E.unauthorized("admin_required", "assurances are recorded by admins");
    const l = getLaunch(q.params.id);
    const b = q.json();
    if (!["audit", "bounty", "review", "formal-verification"].includes(b.kind) || typeof b.provider !== "string" || typeof b.url !== "string") throw E.invalidRequest("kind, provider and url are required");
    const now = iso(app.now());
    const rec: AssuranceRecord = { id: app.pairing.newId(), createdAt: now, launchId: l.id, kind: b.kind, provider: b.provider.slice(0, 200), url: b.url.slice(0, 512), commit: typeof b.commit === "string" ? b.commit.slice(0, 64) : null, recordedAt: now, revokedAt: null };
    app.store.c<AssuranceRecord>("assurances").save(rec);
    return json(201, rec);
  }, { cors: "none", bucket: "paid" });
  r.get("/launch/policies", () => {
    const rows = app.store.c<PolicyRecord>("policies").all().sort((a, b) => b.version - a.version).map(({ id: _i, ...p }) => p);
    return json(200, { count: rows.length, policies: rows });
  }, read);

  // ------------------------------------------------------------------------------------------ records

  r.get("/feedback/batches", (q) => {
    const rows = app.store.c<FeedbackBatch>("feedback").newest({ before: parseBefore(q.query), limit: parseLimit(q.query, 50) });
    return json(200, { chainId: app.cfg.chainId, collection: app.cfg.counselNft, count: rows.length, batches: rows });
  }, read);
  for (const [route, kind] of [["/reviews/:hash.json", "review"], ["/work-records/:hash.json", "work-record"], ["/review-documents/:hash.json", "review-document"]] as const) {
    r.get(route, (q) => {
      if (!HASH_RE.test(q.params.hash)) throw E.invalidId("hash must be 64 lowercase hex");
      const d = app.store.c<DocumentRecord>("documents").get(q.params.hash);
      if (!d || d.kind !== kind) throw E.notFound(`no ${kind} with that hash`);
      return json(200, d.body, { "cache-control": "public, max-age=31536000, immutable" });
    }, read);
  }

  // ------------------------------------------------------------------------------------------ rewards (seat epochs)

  r.get("/rewards/epochs", () => json(200, { genesis: iso(app.cfg.rewardGenesisMs), epochSeconds: app.cfg.epochSeconds, current: app.settlement.epochOf(app.now()), distributor: app.cfg.rewardDistributor, epochs: app.store.c<RewardEpoch>("epochs").all().sort((a, b) => b.epoch - a.epoch).map(({ entries, assets, ...e }) => ({ ...e, seats: Object.keys(e.work ?? {}).length, assets: (assets ?? []).map(({ entries: es, ...x }) => ({ ...x, seats: es.length })) })) }), read);
  r.get("/rewards/:tokenId", (q) => {
    if (!/^[0-9]{1,10}$/.test(q.params.tokenId)) throw E.invalidId("tokenId must be a decimal id");
    return json(200, app.settlement.rewardsFor(String(Number(q.params.tokenId))));
  }, read);
  r.get("/rewards/epochs/:epoch", (q) => {
    const ep = app.store.c<RewardEpoch>("epochs").get(String(Number(q.params.epoch)));
    if (!ep) throw E.notFound("epoch not closed");
    return json(200, ep);
  }, read);

  // ------------------------------------------------------------------------------------------ explorer JSON

  r.get("/api/activity", () => {
    const js = jobs().all();
    return json(200, {
      at: app.now(), reachable: true,
      workflows: app.store.c<WorkflowRecord>("workflows").count((w) => !["completed", "blocked", "cancelled", "superseded"].includes(w.status)),
      jobs: js.filter((j) => j.state === "executing" || j.state === "delivering").length,
      oracle: app.store.c<OracleRecord>("oracle").count((x) => x.status === "assessing" || x.status === "reproducing"),
      working: [...app.engine.sessions.values()].filter((s) => app.engine.load(s.deviceKey) > 0).length,
      total: js.length,
    }, { "cache-control": "public, max-age=10" });
  }, read);
  r.get("/api/agents/:tokenId", (q) => {
    const tokenId = tokenParam(q.params.tokenId);
    const c = seatCounters(app).find((s) => s.tokenId === tokenId);
    const seat = app.store.c<SeatRecord>("seats").get(tokenId);
    const myJobs = new Set(attempts().filter((a) => a.tokenId === tokenId && a.state === "accepted").map((a) => a.jobId));
    return json(200, { tokenId, online: !!app.engine.sessionForToken(tokenId), owner: seat?.owner ?? null, ownerName: null, held: !!seat?.owner, attempts: c?.attempts ?? 0, accepted: c?.accepted ?? 0, jobs: myJobs.size, lastAcceptedAt: c?.lastAcceptedAt ?? null });
  }, read);
  r.get("/api/search", (q) => {
    const text = (q.query.get("q") ?? "").trim().toLowerCase();
    if (!text || text.length > 200) throw E.invalidQuery("q is 1–200 characters");
    if (q.query.get("part") === "published") return json(200, { groups: [{ key: "published", label: "Filings", hits: publications(app).filter((i) => i.title.toLowerCase().includes(text)).slice(0, 20) }] });
    const hit = (s: string) => s.toLowerCase().includes(text);
    return json(200, {
      groups: [
        { key: "jobs", label: "Matters", hits: jobs().newest({ filter: (j) => hit(j.id) || hit(j.objective), limit: 10 }).map((j) => jobListItem(app, j)) },
        { key: "oracle", label: "Rulings", hits: app.store.c<OracleRecord>("oracle").newest({ filter: (x) => hit(x.id) || hit(x.question), limit: 10 }).map((x) => app.oracle.listItem(x)) },
        { key: "agents", label: "Counsel", hits: /^#?\d+$/.test(text) ? [{ tokenId: text.replace("#", "") }] : [] },
        { key: "launches", label: "Incorporations", hits: app.store.c<LaunchRecord>("launches").all().filter((l) => hit(l.id) || hit(String(l.launchNumber)) || (l.token ? hit(l.token) : false)).slice(0, 10).map(launchListItem) },
      ],
    });
  }, read);
  r.get("/api/claim", (q) => {
    const launch = q.query.get("launch") ?? "";
    const wallet = q.query.get("wallet") ?? "";
    if (!UUID_RE.test(launch) || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw E.invalidQuery("launch (UUID) and wallet are required");
    return json(200, { claim: app.launches.claimFor(launch, wallet) });
  }, read);

  // ------------------------------------------------------------------------------------------ paid requests

  for (const prefix of ["", "/api"]) {
    r.get(`${prefix}/requests/capabilities`, () => json(200, app.requests.capabilities()), { cors: "public", bucket: "paid" });
    r.post(`${prefix}/requests/check`, (q) => json(200, app.requests.check(q.json())), paid);
    r.post(`${prefix}/requests/import`, async (q) => json(200, await app.requests.importRepo(q.json())), paid);
    r.post(`${prefix}/requests/quote`, (q) => app.requests.quote(q), { ...paid, bucket: "quote" });
    r.post(`${prefix}/requests/:id/submit`, (q) => {
      if (!app.paymentsEnabled) throw E.unavailable("payments_unavailable", "payments are not configured on this control plane");
      return app.requests.submit(q);
    }, paid);
    r.get(`${prefix}/requests/paid-by/:address`, (q) => json(200, app.requests.paidBy(q.params.address)), { cors: "public", bucket: "paid" });
    r.get(`${prefix}/requests/:id`, (q) => app.requests.status(q), paid);
  }
  r.get("/openapi.json", () => json(200, app.requests.openapi(), { "access-control-allow-origin": "*" }), read);

  // ------------------------------------------------------------------------------------------ pairing & agents

  const device: RouteOpts = { cors: "none", bucket: "device" };
  r.post("/pair/start", (q) => json(201, app.pairing.start(q.json())), { cors: "public", bucket: "paid" });
  r.get("/pair", (q) => ({ status: 200, raw: pairPage(app, q.query.get("code")), headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'" } }), read);
  r.get("/pair/wallet/:address", async (q) => json(200, await app.pairing.wallet(q.params.address, q.query.get("fresh") === "1")), read);
  r.get("/pair/:code", (q) => json(200, app.pairing.get(q.params.code)), read);
  r.post("/pair/complete", async (q) => json(200, await app.pairing.complete(q.json())), { cors: "public", bucket: "paid" });
  r.get("/enrollments/:deviceKey", (q) => json(200, app.pairing.enrollment(q.params.deviceKey)), read);
  r.post("/enrollments/revoke", (q) => json(200, app.device.revoke(q.json())), device);
  r.get("/agents/register-intent", (q) => json(200, app.pairing.registerIntent(q.query.get("tokenId"))), read);
  r.post("/agents/bind", async (q) => { const x = await app.pairing.bind(q.json()); return json(x.status, x.body); }, { cors: "public", bucket: "paid" });
  const artId = (t: string) => { const id = Number(tokenParam(t)); if (!validTokenId(id)) throw E.notFound("Counsel token ids are 1–2000"); return id; };
  // Collection-level metadata (CounselNFT.contractURI → baseURI + "collection.json"): OpenSea reads name, image,
  // banner, description, links and royalties from here.
  r.get("/agents/by-token/collection.json", async () => json(200, await collectionDoc(app), { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" }), pub);
  // Brand PNGs/SVGs committed in packages/art/out/brand (logo, banners, favicons) for marketplaces and the metadata.
  r.get("/brand/:file", async (q): Promise<Res> => {
    const b = await brandFile(q.params.file);
    if (!b) return json(404, { error: "unknown_brand_file" });
    return { status: 200, raw: b.bytes, headers: { "content-type": b.type, "access-control-allow-origin": "*", "cache-control": "public, max-age=86400" } };
  }, pub);
  r.get("/agents/by-token/:tokenId.json", async (q) => json(200, await app.pairing.registration(artId(q.params.tokenId)), { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" }), pub);
  // The NFT's tokenURI (CounselNFT.baseURI = …/counsel/): plain ERC-721 metadata with the traits, no ERC-8004 fields —
  // OpenSea renders an 8004 registration file's agent fields (Active, Service, Trust Model) instead of `attributes`.
  r.get("/counsel/collection.json", async () => json(200, await collectionDoc(app), { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" }), pub);
  r.get("/counsel/:tokenId.json", async (q) => json(200, await app.pairing.nftMetadata(artId(q.params.tokenId)), { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" }), pub);
  // .svg = the bar card (portrait + nameplate) as SVG; ?portrait=1 for the bare 32×32 portrait
  r.get("/agents/by-token/:tokenId.svg", async (q) => ({ status: 200, raw: q.query.get("portrait") === "1" ? await counselPortraitSvg(artId(q.params.tokenId)) : await counselCardSvg(artId(q.params.tokenId)), headers: { "content-type": "image/svg+xml", "access-control-allow-origin": "*", "cache-control": "public, max-age=86400" } }), pub);
  // .png = the bar card (renderCardPNG) — the metadata `image`
  r.get("/agents/by-token/:tokenId.png", async (q): Promise<Res> => {
    const scale = Math.max(1, Math.min(16, Number(q.query.get("scale") ?? 8) || 8));
    const id = artId(q.params.tokenId);
    const png = await counselCardPng(id, scale);
    if (!png) return { status: 302, headers: { location: `/agents/by-token/${id}.svg` } };
    return { status: 200, raw: png, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "public, max-age=86400" } };
  }, pub);

  // Share card: the Open Graph image of comd.fun/agents/{id} and the "Share on X" picture — status line from live state
  r.get("/agents/by-token/:tokenId/share.png", async (q): Promise<Res> => {
    const id = artId(q.params.tokenId);
    const reg = await app.pairing.registration(id) as { enrolled?: boolean; paired?: boolean; online?: boolean; founding?: number | null };
    const bits = [reg.enrolled ? "Registered" : "Minted · not registered yet", reg.founding ? `Founding Hundred #${reg.founding}` : "", reg.online ? "at the bar now" : reg.paired ? "paired" : ""].filter(Boolean);
    const png = await counselShareCardPng(id, { status: bits.join(" · ") });
    if (!png) return { status: 302, headers: { location: `/agents/by-token/${id}.png` } };
    return { status: 200, raw: png, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "public, max-age=600" } };
  }, pub);

  // ------------------------------------------------------------------------------------------ bundles, artifacts, fuzz

  r.post("/bundles", async (q) => { const x = await app.device.uploadBundle(q.json()); return json(x.status, x.body); }, { ...device, limit: Math.ceil(BUNDLE_LIMIT * 1.4) + 65536 });
  r.get("/bundles/:hash", (q) => {
    if (!HASH_RE.test(q.params.hash)) throw E.invalidId("bundle hash must be 64 lowercase hex");
    const b = app.store.c<any>("bundles").get(q.params.hash);
    if (!b) throw E.notFound("unknown bundle");
    return json(200, app.device.bundleView(b));
  }, read);
  r.post("/artifacts", async (q) => json(201, await app.device.uploadArtifact(q.headers, q.body)), { ...device, limit: ARTIFACT_LIMIT });
  r.get("/artifacts/:hash", (q) => app.device.getArtifact(q.params.hash), read);
  r.get("/blobs/:hash", (q) => app.device.getArtifact(q.params.hash), read);
  r.post("/fuzz/result", (q) => json(200, app.fuzz.result(q.json())), device);

  // ------------------------------------------------------------------------------------------ flywheel ($COMD)

  r.get("/flywheel", async () => json(200, await app.flywheel.stats(), { "cache-control": "public, max-age=15" }), read);
  r.get("/flywheel/sweep-candidates", async () => json(200, await app.flywheel.sweepCandidates(), { "cache-control": "public, max-age=30" }), read);

  // ------------------------------------------------------------------------------------------ admin (ADMIN_TOKEN)

  const admin = (q: Req) => { if (!app.cfg.adminToken || q.bearer !== app.cfg.adminToken) throw E.unauthorized("admin_required", "Authorization: Bearer <ADMIN_TOKEN>"); };
  /** Run the settler now: close ended epochs, post roots waiting for funds, retry feedback batches. */
  r.post("/admin/settle", async (q) => {
    admin(q);
    await app.settlement.tick();
    await app.idle();
    return json(200, { ok: true, current: app.settlement.epochOf(app.now()), epochs: app.store.c<RewardEpoch>("epochs").all().sort((a, b) => a.epoch - b.epoch).map((e) => ({ epoch: e.epoch, status: e.status, assets: (e.assets ?? []).map((a) => ({ symbol: a.symbol, status: a.status, total: a.total, txHash: a.txHash, failure: a.failure })) })) });
  }, { cors: "none", bucket: "paid" });

  return r;
}

// ============================================================================================ handler

export function handler(app: App) {
  const sameOrigin = new URL(app.cfg.publicApiUrl).origin;
  return async (req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method ?? "GET").toUpperCase();
    let path = "/";
    let query = new URLSearchParams();
    try {
      const u = new URL(req.url ?? "/", "http://local");
      path = u.pathname;
      query = u.searchParams;
    } catch { /* keep defaults */ }
    try {
      const site = await app.sites.serve(req.headers.host, req.url?.split("?")[0] ?? path, method, typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : undefined);
      if (site) return send(res, { status: site.status, raw: site.body, headers: site.headers }, method === "HEAD");
      const m = app.router.match(method === "OPTIONS" ? "GET" : method, path) ?? (method === "OPTIONS" ? app.router.match("POST", path) : null);
      const origin = typeof req.headers.origin === "string" ? req.headers.origin.replace(/\/$/, "") : null;
      if (method === "OPTIONS") {
        const allowed = !origin || origin === sameOrigin || app.cfg.allowedOrigins.includes(origin);
        const opts = m && "route" in m ? m.route.opts : null;
        const h: Record<string, string> = { "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, payment-signature", "access-control-expose-headers": "PAYMENT-REQUIRED, Retry-After", "access-control-max-age": "600" };
        if (opts?.cors === "public") h["access-control-allow-origin"] = "*";
        else if (opts?.cors === "paid" && allowed && origin) { h["access-control-allow-origin"] = origin; h.vary = "origin"; }
        return send(res, { status: 204, headers: h });
      }
      if (!m) throw E.notFound(`no route ${method} ${path}`);
      if (!("route" in m)) return send(res, { status: 405, body: { error: "method_not_allowed", detail: `use ${m.allowed.join(", ")}` }, headers: { allow: m.allowed.join(", ") } });
      const { route, params } = m;
      const ip = clientIp(req, app.cfg.trustProxy);
      const bearer = bearerOf(req);
      const opts = route.opts;
      const key = `${ip}|${bearer ?? "-"}`;
      if (opts.bucket === "read") { const w = app.limits.reads.hit(ip); if (w) throw E.rate("too_many_reads", w); }
      if (opts.bucket === "paid" || opts.bucket === "quote") { const w = app.limits.paid.hit(key); if (w) throw E.rate("request_limit", w); }
      if (opts.bucket === "quote") { const w = app.limits.quotes.hit(key); if (w) throw E.rate("request_limit", w); }
      const cors: Record<string, string> = {};
      if (opts.cors === "public") cors["access-control-allow-origin"] = "*";
      if (opts.cors === "paid" && origin) {
        if (origin !== sameOrigin && !app.cfg.allowedOrigins.includes(origin)) throw E.forbidden("origin_not_allowed", "paid routes refuse cross-origin browser calls; call from your server");
        cors["access-control-allow-origin"] = origin;
        cors.vary = "origin";
        cors["access-control-expose-headers"] = "PAYMENT-REQUIRED, Retry-After";
      }
      const body = method === "GET" || method === "HEAD" ? Buffer.alloc(0) : await readBody(req, opts.limit ?? 64 * 1024);
      let parsed: unknown;
      const r: Req = {
        method, path, params, query, headers: req.headers, ip, raw: req, body, bearer,
        json<T>() {
          if (parsed !== undefined) return parsed as T;
          if (!body.length) return (parsed = {}) as T;
          try { parsed = JSON.parse(body.toString("utf8")); } catch { throw E.invalidRequest("body must be JSON"); }
          return parsed as T;
        },
      };
      const out: Res = await route.handler(r);
      out.headers = { ...cors, ...(out.headers ?? {}) };
      send(res, out, method === "HEAD");
    } catch (e) {
      const out = errorRes(e);
      if (out.status === 500) console.error(`[http] ${method} ${path}`, e);
      if (!res.headersSent) send(res, { ...out, headers: { "access-control-allow-origin": "*", ...(out.headers ?? {}) } });
      else res.end();
    }
  };
}

// ============================================================================================ views

function cap(v: string | null, d: number) {
  if (v === null) return d;
  const n = Number(v);
  return Number.isInteger(n) ? Math.max(0, Math.min(1000, n)) : d;
}

function tokenParam(t: string): string {
  if (!/^[0-9]{1,10}$/.test(t)) throw E.invalidId("tokenId must be a decimal id");
  return String(Number(t));
}

function attesterAddress(app: App): string | null {
  const last = app.store.c<OracleRecord>("oracle").newest({ filter: (x) => !!x.signer, limit: 1 })[0];
  return last?.signer?.toLowerCase() ?? null;
}

/** Explorer stage: building / reviewed / N done / review failed / runtime error. */
function stage(j: JobX): string {
  if (j.state === "completed") return `${j.nodes.filter((n) => n.state === "accepted").length} done`;
  if (j.state === "blocked") return j.blockedReason?.startsWith("review failed") || j.blockedReason?.startsWith("rejected") ? "review failed" : j.blockedReason?.startsWith("runtime error") ? "runtime error" : "blocked";
  if (j.nodes.some((n) => n.kind !== "work" && n.state === "accepted")) return "reviewed";
  return j.state === "delivering" ? "delivering" : "building";
}

function jobListItem(app: App, j: JobX) {
  const seats = [...new Set(j.nodes.filter((n) => n.seat).map((n) => n.seat!.tokenId))];
  return { id: j.id, state: j.state, template: j.template, objective: j.objective, originalRequest: j.originalRequest, blockedReason: j.blockedReason, delivery: j.delivery, createdAt: j.createdAt, updatedAt: j.updatedAt, project: j.project, stage: stage(j), seats, oracleRequestId: j.oracleRequestId, createdBy: j.createdBy, launch: j.launch.requested ? j.launch : undefined };
}

function jobView(app: App, j: JobX) {
  const at = app.store.c<A>("attempts").filter((a) => a.jobId === j.id).sort((a, b) => (a.leasedAt < b.leasedAt ? -1 : 1));
  const reviews = app.store.c<FeedbackBatch>("feedback").filter((b) => b.jobId === j.id).map((b) => ({ status: b.status, chainId: b.chainId, txHash: b.txHash, blockNumber: b.blockNumber, sentAt: b.sentAt, documentHash: b.documentHash, entries: b.entries.map((e) => ({ nodeKey: e.nodeKey, agentId: e.agentId, value: e.value, role: e.tag1 })) }));
  const usage = { inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0 };
  for (const n of j.nodes) if (n.submissionHash) { const s = app.store.c<S>("submissions").get(n.submissionHash); if (s) { usage.inputTokens += s.usage.inputTokens ?? 0; usage.outputTokens += s.usage.outputTokens ?? 0; usage.turns += s.usage.turns ?? 0; usage.durationMs += s.usage.durationMs ?? 0; } }
  const { input, panel, baseJobId, launchInput: _li, ...rest } = j;
  return {
    ...rest,
    stage: stage(j),
    nodes: j.nodes.map(({ wallet: _w, leaseId: _l, ...n }: any) => n),
    dependencies: Object.fromEntries(j.nodes.map((n) => [n.key, n.dependsOn])),
    scope: { contracts: input.contracts ?? [], paths: input.paths ?? [], repoUrl: input.repoUrl ?? null, baseCommit: input.baseCommit ?? null, references: j.references },
    attempts: at.map(({ id: _i, createdAt: _c, deviceKey: _d, ...a }) => a),
    reviews,
    usage,
    panel: panel ?? null,
    baseJobId: baseJobId ?? null,
    reportUrl: j.report ? `/jobs/${j.id}/report.md` : null,
    resultUrl: `/jobs/${j.id}/result`,
  };
}

function jobResult(app: App, j: JobX) {
  const files: any[] = [];
  for (const n of j.nodes) {
    if (n.state !== "accepted" || !n.submissionHash) continue;
    if (n.kind === "panel" && j.panel && j.panel.winner !== n.key) continue;
    const s = app.store.c<S>("submissions").get(n.submissionHash);
    for (const a of s?.artifacts ?? []) files.push({ name: a.name, path: a.path, mediaType: a.mediaType, hash: a.hash, bytes: a.bytes, submissionHash: s!.hash, url: a.url, nodeKey: n.key });
  }
  return {
    jobId: j.id, projectId: j.project?.id ?? j.id, state: j.state, complete: j.state === "completed",
    source: j.delivery?.repoUrl ? [{ repoUrl: j.delivery.repoUrl, commit: j.delivery.commit, pullRequestUrl: j.delivery.pullRequestUrl, branch: j.delivery.branch }] : [],
    files, delivery: j.delivery, site: j.site, media: j.media, report: j.report ? `/jobs/${j.id}/report.md` : null,
  };
}

function seatCounters(app: App) {
  const by = new Map<string, { tokenId: string; agentId: string | null; attempts: number; accepted: number; rejected: number; failed: number; pending: number; lastWorkedAt: string | null; lastAcceptedAt: string | null }>();
  for (const s of app.store.c<SeatRecord>("seats").all()) by.set(s.tokenId, { tokenId: s.tokenId, agentId: s.agentId, attempts: 0, accepted: 0, rejected: 0, failed: 0, pending: 0, lastWorkedAt: null, lastAcceptedAt: null });
  for (const a of app.store.c<A>("attempts").all()) {
    const x = by.get(a.tokenId) ?? { tokenId: a.tokenId, agentId: a.agentId, attempts: 0, accepted: 0, rejected: 0, failed: 0, pending: 0, lastWorkedAt: null, lastAcceptedAt: null };
    x.attempts++;
    if (a.state === "accepted") { x.accepted++; if (!x.lastAcceptedAt || a.finishedAt! > x.lastAcceptedAt) x.lastAcceptedAt = a.finishedAt; }
    else if (a.state === "rejected") x.rejected++;
    else if (a.state === "expired" || a.state === "failed") x.failed++;
    else if (a.state === "leased" || a.state === "submitted") x.pending++;
    const t = a.finishedAt ?? a.leasedAt;
    if (!x.lastWorkedAt || t > x.lastWorkedAt) x.lastWorkedAt = t;
    by.set(a.tokenId, x);
  }
  return [...by.values()].sort((a, b) => Number(BigInt(a.tokenId) - BigInt(b.tokenId)));
}

function seatView(app: App, t: string, work: number, reviewsN: number) {
  const tokenId = tokenParam(t);
  const seat = app.store.c<SeatRecord>("seats").get(tokenId);
  const c = seatCounters(app).find((s) => s.tokenId === tokenId);
  const mine = app.store.c<A>("attempts").filter((a) => a.tokenId === tokenId).sort((a, b) => (a.leasedAt < b.leasedAt ? 1 : -1));
  const jobsCol = app.store.c<JobX>("jobs");
  const kindOf = (a: A) => jobsCol.get(a.jobId)?.nodes.find((n) => n.key === a.nodeKey)?.kind ?? "work";
  const workRows = mine.filter((a) => kindOf(a) === "work" || kindOf(a) === "panel").slice(0, work);
  const reviewRows = mine.filter((a) => ["review", "audit", "judge"].includes(kindOf(a))).slice(0, reviewsN);
  const collab = new Map<string, number>();
  for (const jobId of new Set(mine.map((a) => a.jobId))) for (const a of app.store.c<A>("attempts").filter((x) => x.jobId === jobId && x.tokenId !== tokenId && x.state === "accepted")) collab.set(a.tokenId, (collab.get(a.tokenId) ?? 0) + 1);
  const batches = app.store.c<FeedbackBatch>("feedback").all();
  const row = (a: A) => {
    const j = jobsCol.get(a.jobId);
    const n = j?.nodes.find((x) => x.key === a.nodeKey);
    const b = batches.find((x) => x.jobId === a.jobId && x.entries.some((e) => e.nodeKey === a.nodeKey));
    const fe = b?.entries.find((e) => e.nodeKey === a.nodeKey);
    const sub = a.submissionHash ? app.store.c<S>("submissions").get(a.submissionHash) : undefined;
    return {
      jobId: a.jobId, nodeKey: a.nodeKey, skill: n?.skill ?? null, role: n?.role ?? null, kind: n?.kind ?? null, state: a.state, status: a.state, attempt: a.attempt,
      leasedAt: a.leasedAt, finishedAt: a.finishedAt, submittedAt: sub?.createdAt ?? null, acceptedAt: a.state === "accepted" ? a.finishedAt : null,
      submissionHash: a.submissionHash, failure: a.failure, objective: j?.objective.slice(0, 200) ?? null, jobState: j?.state ?? null, launch: j?.launch.requested ? j.launch : null,
      verdict: (sub?.result as any)?.verdict ?? sub?.verdict?.status ?? null, value: fe?.value ?? null, policy: fe?.tag2 ?? null,
      txHash: (fe as any)?.txHash ?? b?.txHash ?? null, chainId: b?.chainId ?? null, sentAt: b?.sentAt ?? null,
    };
  };
  const live = app.engine.sessionForToken(tokenId);
  const rt = (live?.runtime ?? seat?.runtime ?? null) as { name?: string; version?: string | null; model?: string | null; effort?: string | null; premium?: boolean } | null;
  const enrollments = app.store.c<any>("enrollments").filter((e: any) => e.tokenId === tokenId);
  const active = enrollments.find((e: any) => e.status === "active");
  let turns = 0, wallClockMs = 0;
  for (const a of mine) {
    if (a.finishedAt) wallClockMs += Date.parse(a.finishedAt) - Date.parse(a.leasedAt);
    const sub = a.submissionHash ? app.store.c<S>("submissions").get(a.submissionHash) : undefined;
    turns += sub?.usage.turns ?? 0;
  }
  return {
    tokenId, agentId: seat?.agentId ?? null, chainId: app.cfg.chainId, collection: app.cfg.counselNft?.toLowerCase() ?? null, adapter: app.cfg.identityRegistry?.toLowerCase() ?? null,
    status: active ? (live ? "online" : "enrolled") : seat?.agentId ? "registered" : "unpaired",
    owner: seat?.owner ?? null, online: !!live, lastSeenAt: seat?.lastSeenAt ?? null, pairedAt: active?.createdAt ?? null, devices: enrollments.filter((e: any) => e.status === "active").length,
    version: seat?.version ?? null, daemonVersion: seat?.version ?? null,
    // runtime: claude | codex; model id + reasoning effort as advertised; premium = top-tier model at high effort
    runtime: rt, runtimeName: rt?.name ?? null, model: rt?.model ?? null, effort: rt?.effort ?? null, premium: !!rt?.premium,
    runtimes: rt?.name ? [{ id: rt.name, version: rt.version ?? null, model: rt.model ?? null, effort: rt.effort ?? null, premium: !!rt.premium, premiumModel: rt.premium ? { model: rt.model, effort: rt.effort } : null }] : [],
    attempts: c?.attempts ?? 0, accepted: c?.accepted ?? 0, rejected: c?.rejected ?? 0, failed: c?.failed ?? 0, pending: c?.pending ?? 0, lastWorkedAt: c?.lastWorkedAt ?? null, turns, wallClockMs,
    work: workRows.map(row), reviews: reviewRows.map(row), collaborators: [...collab].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tokenId, jobs]) => ({ tokenId, jobs })),
    image: `${app.cfg.publicApiUrl}/agents/by-token/${tokenId}.png`, imageSvg: `${app.cfg.publicApiUrl}/agents/by-token/${tokenId}.svg`, metadata: `${app.cfg.publicApiUrl}/agents/by-token/${tokenId}.json`,
    rewards: `${app.cfg.publicApiUrl}/rewards/${tokenId}`,
  };
}

function standing(app: App, deviceKey: string, withQueue: boolean) {
  const e = app.pairing.enrollment(deviceKey) as any;
  const s = app.engine.sessions.get(deviceKey);
  const reasons: string[] = [];
  if (e.status !== "active") reasons.push(`enrollment ${e.status}`);
  if (!s) reasons.push("not connected");
  if (s?.paused) reasons.push("paused (runtime rate limit)");
  const seat = e.tokenId ? app.store.c<SeatRecord>("seats").get(e.tokenId) : undefined;
  if (app.cfg.requireRegistration && !seat?.agentId) reasons.push("not registered as an ERC-8004 agent");
  let queue: { jobId: string; nodeKey: string; skill: string; eligible: boolean; reason: string | null }[] | undefined;
  if (withQueue && s) {
    queue = [];
    for (const j of app.store.c<JobX>("jobs").filter((x) => x.state === "executing")) for (const n of j.nodes) if (n.state === "ready") { const why = app.engine.ineligible(s, j, n); queue.push({ jobId: j.id, nodeKey: n.key, skill: n.skill, eligible: !why, reason: why }); }
  }
  return {
    deviceKey,
    enrollment: { status: e.status, reason: e.reason, tokenId: e.tokenId ?? null, wallet: e.wallet ?? null, agentId: e.agentId ?? null },
    presence: s ? { online: true, connectedAt: iso(s.connectedAt), heartbeatAt: iso(s.lastHeartbeat), paused: s.paused, working: app.engine.load(deviceKey), concurrency: s.concurrency, runtime: s.runtime, premium: s.premium } : { online: false },
    dispatch: { eligible: reasons.length === 0, reasons, premium: s?.premium ?? false, skills: s ? s.skills.size : 0 },
    ...(queue ? { queue } : {}),
  };
}

async function swarm(app: App) {
  const now = app.now();
  const js = app.store.c<JobX>("jobs").all();
  const at = app.store.c<A>("attempts").all();
  const jobStates: Record<string, number> = {};
  for (const j of js) jobStates[j.state] = (jobStates[j.state] ?? 0) + 1;
  const st = app.services.status();
  let inferenceTokens = 0;
  for (const s of app.store.c<S>("submissions").all()) inferenceTokens += (s.usage.inputTokens ?? 0) + (s.usage.outputTokens ?? 0);
  const seats: Record<string, unknown> = {};
  for (const c of seatCounters(app)) {
    const s = app.engine.sessionForToken(c.tokenId);
    seats[c.tokenId] = { tokenId: Number(c.tokenId), agentId: c.agentId, attempts: c.attempts, accepted: c.accepted, rejected: c.rejected, failed: c.failed, pending: c.pending, last: c.lastWorkedAt, working: s ? app.engine.load(s.deviceKey) > 0 : false, queued: 0, online: !!s };
  }
  return {
    at: now,
    health: {
      reachable: true,
      agentsOnline: app.engine.sessions.size,
      workingNow: [...app.engine.sessions.values()].filter((s) => app.engine.load(s.deviceKey) > 0).length,
      acceptedLastDay: at.filter((a) => a.state === "accepted" && a.finishedAt && now - Date.parse(a.finishedAt) < DAY).length,
      jobsDoneLastDay: js.filter((j) => j.state === "completed" && !j.oracleRequestId && now - Date.parse(j.updatedAt) < DAY).length,
      oraclesDoneLastDay: app.store.c<OracleRecord>("oracle").count((x) => x.status === "attested" && !!x.attestedAt && now - Date.parse(x.attestedAt) < DAY),
      seatsEnrolled: app.pairing.activeCount(),
      pendingVerification: js.reduce((s, j) => s + j.nodes.filter((n) => n.state === "verifying").length, 0),
      pendingDeployment: app.store.c<LaunchRecord>("launches").count((l) => l.status === "deploying" || l.status === "attesting"),
      pendingSites: app.store.c<SiteRecord>("sites").count((s) => s.status === "publishing"),
      verifierUp: st.verifier.up, publisherUp: st.publisher.up, deployerUp: st.deployer.up,
    },
    counts: {
      jobs: js.length,
      jobStates,
      tasksInProgress: at.filter((a) => a.state === "leased" || a.state === "submitted").length,
      launchesLive: app.store.c<LaunchRecord>("launches").count((l) => l.status === "live"),
      sites: app.store.c<SiteRecord>("sites").count((s) => s.status === "live"),
      inferenceTokens,
    },
    seats,
    events: app.store.c<any>("events").newest({ limit: 80 }).map((e: any) => swarmEvent(e)).filter((e) => e.kind !== "noise").slice(0, 50),
  };
}

/** Docket feed row: the stored {at, type, data} plus {kind, text, jobId?, requestId?, launchId?, tokenId?}. */
export function swarmEvent(e: { createdAt: string; type: string; data: Record<string, any> }) {
  const d = e.data ?? {};
  const counsel = (t: unknown) => (t ? `Counsel #${String(t).padStart(4, "0")}` : "A seat");
  const short = (x: unknown) => String(x ?? "").slice(0, 8);
  let kind = "noise";
  let text = e.type;
  switch (e.type) {
    case "job.opened": kind = "opened"; text = `Matter ${short(d.jobId)} opened${d.launch ? " (launch)" : ""}: ${(d.nodes ?? []).length} step(s).`; break;
    case "lease.assigned": kind = d.kind === "work" || d.kind === "panel" ? "working" : "review"; text = `${counsel(d.tokenId)} took ${d.skill} on matter ${short(d.jobId)}.`; break;
    case "node.accepted": kind = "accepted"; text = `${counsel(d.tokenId)}: ${d.skill} accepted (${d.evaluation}). Sustained.`; break;
    case "node.rejected": kind = "rejected"; text = `${counsel(d.tokenId)}: ${d.nodeKey} overruled.`; break;
    case "job.completed": kind = "accepted"; text = `Matter ${short(d.jobId)} completed. Filed.`; break;
    case "job.blocked": kind = "rejected"; text = `Matter ${short(d.jobId)} blocked: ${String(d.reason ?? "").slice(0, 120)}`; break;
    case "job.published": kind = "published"; text = `Records Office filed matter ${short(d.jobId)} at ${d.repoUrl}.`; break;
    case "oracle.opened": kind = "opened"; text = `Ruling ${short(d.requestId)} requested: panel of ${d.panelSize}, quorum ${d.quorum}.`; break;
    case "oracle.agreed": kind = "review"; text = `Ruling ${short(d.requestId)}: ${d.agreed} of ${d.quorum} agree.`; break;
    case "oracle.attested": kind = "signed"; text = `Ruling ${short(d.requestId)} signed. On the record.`; break;
    case "launch.deploying": kind = "deployed"; text = `Registrar deploying launch #${d.launchNumber}.`; break;
    case "launch.live": kind = "launched"; text = `Launch #${d.launchNumber} live${d.token ? ` — token ${d.token}` : ""}.`; break;
    case "launch.failed": case "launch.parked": kind = "rejected"; text = `Launch ${short(d.launchId)} ${e.type === "launch.failed" ? "failed" : "parked"}: ${String(d.reason ?? "").slice(0, 120)}`; break;
    case "seat.connected": kind = "connected"; text = `${counsel(d.tokenId)} took its seat (${d.runtime}${d.model ? ` · ${d.model}` : ""}${d.premium ? " · premium" : ""}).`; break;
    case "seat.paired": kind = "connected"; text = `${counsel(d.tokenId)} paired a device.`; break;
    case "seat.registered": kind = "connected"; text = `${counsel(d.tokenId)} registered as ERC-8004 agent ${d.agentId}.`; break;
    case "order.paid": kind = "opened"; text = `${d.action} paid on chain.`; break;
    case "schedule.created": kind = "opened"; text = `Retainer ${short(d.scheduleId)} filed: ${d.runs} run(s).`; break;
    case "schedule.opened": kind = "opened"; text = `Retainer ${short(d.scheduleId)} run ${d.seq} opened.`; break;
    case "feedback.sent": kind = "signed"; text = `Reputation recorded for matter ${short(d.jobId)} (${d.entries} entr${d.entries === 1 ? "y" : "ies"}).`; break;
    case "rewards.posted": kind = "signed"; text = `Seat rewards for epoch ${d.epoch} posted in ${d.asset}.`; break;
    case "site.live": kind = "published"; text = `Site ${d.label} is live.`; break;
  }
  return { at: e.createdAt, type: e.type, data: d, kind, text, jobId: d.jobId ?? null, requestId: d.requestId ?? null, launchId: d.launchId ?? null, tokenId: d.tokenId ? String(d.tokenId) : null };
}

export async function health(app: App) {
  const orders = app.store.c<OrderRecord>("orders").all();
  const counts: Record<string, number> = { quoted: 0, payment_pending: 0, payment_failed: 0, paid: 0, expired: 0 };
  const failedReasons: Record<string, number> = {};
  for (const o of orders) {
    const k = o.status === "admitted" || o.status === "admission_pending" ? "paid" : o.status;
    counts[k] = (counts[k] ?? 0) + 1;
    // Redacted on the way out, not only on the way in: reasons stored before redactRpc() existed still carry the
    // endpoint, and /health is public. Historical rows are cleaned here rather than left to leak for ever.
    if (o.status === "payment_failed" && o.payment.reason) { const r = redactRpc(o.payment.reason); failedReasons[r] = (failedReasons[r] ?? 0) + 1; }
  }
  const degraded: string[] = [];
  const dbOk = await app.store.healthy().catch(() => false);
  if (!dbOk) degraded.push("database");
  // `degraded: ["chain"]` on its own told us nothing for two days while every RPC endpoint was refusing us. Carry the
  // reason: a 403 is a bot wall (the public endpoint), a 429 is a metered endpoint out of credit, a timeout is neither.
  let chain: { configured: boolean; ok: boolean; blockNumber: number | null; chainId: number; error?: string } = { configured: app.chain.configured, ok: false, blockNumber: null, chainId: app.cfg.chainId };
  if (app.chain.configured) {
    try {
      const n = await Promise.race([app.chain.blockNumber(), new Promise<number>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000).unref())]);
      chain = { ...chain, ok: true, blockNumber: n };
    } catch (e) {
      const m = (e as Error).message;
      chain = { ...chain, error: m.slice(0, 300) };
      degraded.push(/\b403\b|forbidden/i.test(m) ? "chain_rpc_forbidden" : /\b429\b|rate limit|too many/i.test(m) ? "chain_rpc_rate_limited" : "chain");
    }
  } else degraded.push("chain_not_configured");
  if (!app.paymentsEnabled) degraded.push("payments_disabled");
  if (app.settler.mode === "mock") degraded.push("payments_mock");
  if (!app.cfg.counselNft) degraded.push("counsel_nft_not_configured");
  if (!app.cfg.identityRegistry) degraded.push("identity_registry_not_configured");
  if (app.services.status().attester.mode === "ephemeral-key") degraded.push("attester_ephemeral_key");
  if (artStatus().source === "fallback") degraded.push("art_fallback");
  if (app.skills.source !== "catalog") degraded.push("skills_builtin");
  if (app.services.name === "mock") degraded.push("services_mock");
  if (app.deployBreaker.open) degraded.push("deploy_breaker_open");
  if (!app.keeper.status().enabled) degraded.push("keeper_off");
  else if (app.keeper.status().lowGas) degraded.push("keeper_low_gas");
  const js = app.store.c<JobX>("jobs").all();
  const at = app.store.c<A>("attempts").all();
  const now = app.now();
  const st = app.services.status();
  const gas = await app.settler.gasWallet().catch(() => null);
  if (gas?.unknown) degraded.push("gas_balance_unreadable");
  else if (gas?.low) degraded.push("settler_low_gas");
  const pendingByChain: Record<string, number> = {};
  for (const l of app.store.c<LaunchRecord>("launches").filter((x) => x.status === "deploying" || x.status === "attesting")) pendingByChain[l.chainId] = (pendingByChain[l.chainId] ?? 0) + 1;
  return {
    status: degraded.some((d) => d === "database") ? "degraded" : degraded.length ? "degraded" : "ok",
    name: "Company.md",
    contact: app.cfg.contactEmail,
    degraded,
    version: `${API_VERSION}+${(app.cfg.commit ?? "dev").slice(0, 8)}`,
    operatorSurface: "public",
    identity: { chainId: app.cfg.chainId, chain: CHAINS[app.cfg.chainId]?.name ?? null, collection: app.cfg.counselNft?.toLowerCase() ?? null, registry: app.cfg.identityRegistry?.toLowerCase() ?? null, reputation: app.cfg.reputationRegistry?.toLowerCase() ?? null },
    taskNetwork: true,
    payments: {
      enabled: app.paymentsEnabled, mode: app.settler.mode, network: `eip155:${app.cfg.chainId}`, asset: app.cfg.comd.toLowerCase(), symbol: "COMD", amount: app.cfg.priceComd, decimals: app.comdDecimals,
      actions: app.cfg.enabledActions, gasWallet: gas, orders: counts,
      attempts: { pending: counts.payment_pending, pendingReasons: {}, confirmed: counts.paid, failed: counts.payment_failed, failedReasons },
      admissions: orders.filter((o) => o.status === "admitted").length, lastQuoteAt: app.kv.get("lastQuoteAt") ?? null, lastPaidAt: app.kv.get("lastPaidAt") ?? null,
    },
    database: { driver: app.store.driver, ok: dbOk },
    storage: { driver: app.blobs.driver },
    chain,
    connectedDaemons: app.engine.sessions.size,
    dispatch: app.engine.dispatchStatus(),
    workingNow: [...app.engine.sessions.values()].filter((s) => app.engine.load(s.deviceKey) > 0).length,
    awaitingVerdict: js.reduce((s, j) => s + j.nodes.filter((n) => n.kind !== "work" && (n.state === "leased" || n.state === "verifying")).length, 0),
    acceptedLastDay: at.filter((a) => a.state === "accepted" && a.finishedAt && now - Date.parse(a.finishedAt) < DAY).length,
    activeEnrollments: app.pairing.activeCount(),
    pendingVerification: js.reduce((s, j) => s + j.nodes.filter((n) => n.state === "verifying").length, 0),
    pendingAttestation: app.store.c<OracleRecord>("oracle").count((x) => x.status === "reproducing"),
    pendingDeployment: app.store.c<LaunchRecord>("launches").count((l) => l.status === "deploying" || l.status === "attesting"),
    pendingDeploymentByChain: pendingByChain,
    deployBreaker: app.deployBreaker.open ? { reason: app.deployBreaker.reason, openedAt: app.deployBreaker.openedAt } : null,
    pendingDelivery: js.filter((j) => j.state === "delivering").length,
    keeper: (() => { const k = app.keeper.status(); return { enabled: k.enabled, reason: k.reason, address: k.address, lastTickAt: k.lastTickAt, lowGas: k.lowGas, lastError: k.lastError, runs: Object.fromEntries(Object.entries(k.tasks).map(([n, t]) => [n, t.runs])) }; })(),
    pendingFeedback: app.store.c<FeedbackBatch>("feedback").count((b) => b.status === "queued" || b.status === "submitted"),
    pendingOracle: app.store.c<OracleRecord>("oracle").count((x) => x.status === "assessing"),
    pendingFuzz: app.store.c<any>("fuzz").count((f: any) => f.state === "running"),
    pendingSites: app.store.c<SiteRecord>("sites").count((s) => s.status === "publishing"),
    verifierUp: st.verifier.up, publisherUp: st.publisher.up, deployerUp: st.deployer.up,
    services: { verifier: st.verifier.mode, publisher: st.publisher.mode, deployer: st.deployer.mode, attester: st.attester.mode },
    art: artStatus().source,
    skills: { source: app.skills.source, dir: app.skills.dir, count: app.skills.all().length },
    contracts: { chainId: app.cfg.chainId, counselNft: app.cfg.counselNft, identityRegistry: app.cfg.identityRegistry, reputationRegistry: app.cfg.reputationRegistry, rewardDistributor: app.cfg.rewardDistributor, contributorDistributor: app.cfg.contributorDistributor, projectFactory: app.cfg.projectFactory, revenueRouter: app.cfg.revenueRouter, comd: app.cfg.comd, flywheel: app.cfg.flywheel, swapper: app.cfg.swapper, incorporations: app.cfg.incorporations, permit2: app.cfg.permit2, payTo: app.cfg.payTo, sources: app.cfg.addressSource },
    computedAt: iso(now),
  };
}

function launchListItem(l: LaunchRecord) {
  return { id: l.id, launchNumber: l.launchNumber, kind: l.kind, status: l.status, chainId: l.chainId, sourceRepoUrl: l.sourceRepoUrl, sourceCommit: l.sourceCommit, parkedReason: l.parkedReason, artifactCount: l.artifacts.length, artifacts: l.artifacts, token: l.token, createdAt: l.createdAt, updatedAt: l.updatedAt };
}

function launchView(app: App, l: LaunchRecord, work: boolean, claims: boolean) {
  const job = app.store.c<JobX>("jobs").get(l.jobId);
  const snap = l.rewardSnapshot;
  const seats = app.store.c<SeatRecord>("seats");
  const accepted = job ? app.store.c<A>("attempts").filter((a) => a.jobId === job.id && a.state === "accepted") : [];
  const ev = l.launchedEvent ?? null;
  const pairedWith = l.economics.pairWith;
  const alloc = l.allocations;
  return {
    ...launchListItem(l),
    jobId: l.jobId, objective: job?.objective ?? null, workflowId: l.workflowId, policyVersion: l.policyVersion, payer: l.payer, economics: l.economics,
    onchainLaunchId: l.onchainLaunchId ?? null,
    lifecycle: l.lifecycle ?? [{ status: l.status, at: l.updatedAt }],
    jobs: job ? [{ id: job.id, state: job.state, url: `/jobs/${job.id}` }] : [],
    admission: l.admission ? { checks: l.admission.checks.map((c) => ({ id: c.name, name: c.name, status: c.ok ? "pass" : "fail", ok: c.ok, detail: c.detail })), admittedAt: l.admission.checks.every((c) => c.ok) ? l.admission.at : null } : null,
    attestation: l.attestation ? { ...l.attestation, attestedBy: "registrar" } : null,
    addresses: Object.fromEntries(l.artifacts.map((a) => [a.name, a.address])),
    transactions: l.transactions.map((t) => ({ ...t, blockNumber: ev && t.txHash === ev.txHash ? ev.blockNumber : null })),
    deployment: l.deployment ?? null,
    token: l.token ? { name: l.tokenInfo?.name ?? null, symbol: l.tokenInfo?.symbol ?? null, address: l.token, totalSupply: l.tokenInfo?.totalSupply ?? alloc?.totalSupply ?? null } : null,
    tokenAddress: l.token,
    pool: l.poolId ? { poolId: l.poolId, pairedWith, paired: ev?.paired ?? null, fee: null, hook: null } : null,
    poolId: l.poolId,
    allocations: alloc ? [
      { label: "pool", bps: Number(alloc.poolBps), to: "pool", amount: alloc.pool },
      { label: "payer", bps: Number(alloc.payerBps), to: l.economics.remainderTo ?? l.payer ?? "", amount: alloc.payer },
      { label: "swarm", bps: Number(alloc.contributorBps), to: app.cfg.contributorDistributor ?? "ContributorDistributor", amount: alloc.contributors },
    ] : null,
    allocationTotals: alloc,
    launchedEvent: ev,
    rewardSnapshot: snap ? {
      ...snap,
      at: snap.takenAt,
      version: l.policyVersion,
      workerWallets: snap.workers,
      workers: snap.workers.map((w) => ({ wallet: w, deviceKey: accepted.find((a) => a.wallet.toLowerCase() === w)?.deviceKey ?? null, work: accepted.filter((a) => a.wallet.toLowerCase() === w).map((a) => ({ hash: a.submissionHash, role: job?.nodes.find((n) => n.key === a.nodeKey)?.role ?? null, jobId: a.jobId, nodeKey: a.nodeKey })) })),
      breakdown: snap.entries.map((e) => ({ wallet: e.account, launchAmount: e.workerShare, recentAmount: e.connectedShare, amount: e.amount, capped: e.capped })),
      connected: snap.connectedSeats.map((c) => { const st = seats.get(c.tokenId); return { wallet: c.wallet, tokenId: c.tokenId, agentId: st?.agentId ?? null, deviceKey: st?.deviceKey ?? null, lastHeartbeatAt: st?.lastSeenAt ?? null }; }),
      workCount: accepted.length,
      claims: claims ? snap.claims : undefined,
    } : null,
    ...(work && job ? { work: accepted.map((a) => ({ nodeKey: a.nodeKey, tokenId: a.tokenId, wallet: a.wallet, finishedAt: a.finishedAt })) } : {}),
  };
}

function publications(app: App) {
  const jobsAll = app.store.c<JobX>("jobs").filter((j) => j.state === "completed" && !j.oracleRequestId);
  const launches = app.store.c<LaunchRecord>("launches").all();
  const byProject = new Map<string, JobX[]>();
  for (const j of jobsAll) { const p = j.project?.id ?? j.id; byProject.set(p, [...(byProject.get(p) ?? []), j]); }
  const items: any[] = [];
  for (const [, js] of byProject) {
    js.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const head = js[0];
    const types = new Set<string>();
    const code: any[] = [], media: any[] = [], sites: any[] = [], research: any[] = [], audits: any[] = [], contracts: any[] = [];
    let release: any = null;
    for (const j of js) {
      const isResearch = j.template === "research" || j.nodes.some((n) => n.skill === "research-report");
      if (j.delivery?.repoUrl) {
        if (isResearch) research.push({ jobId: j.id, panel: j.panel ? `/jobs/${j.id}/panel` : null, steps: j.nodes.length, commit: j.delivery.commit, repoUrl: j.delivery.repoUrl, publishedAt: j.delivery.publishedAt, pullRequestUrl: j.delivery.pullRequestUrl });
        else code.push({ jobId: j.id, repoUrl: j.delivery.repoUrl, commit: j.delivery.commit, pullRequestUrl: j.delivery.pullRequestUrl, publishedAt: j.delivery.publishedAt });
      } else if (isResearch) research.push({ jobId: j.id, panel: j.panel ? `/jobs/${j.id}/panel` : null, steps: j.nodes.length, commit: null, repoUrl: null, publishedAt: j.updatedAt, pullRequestUrl: null });
      for (const m of j.media ?? []) media.push({ jobId: j.id, ...m });
      if (j.site) sites.push({ jobId: j.id, label: j.site.label, url: j.site.url, siteId: j.site.siteId });
      if (j.report) audits.push({ jobId: j.id, reportUrl: `/jobs/${j.id}/report.md` });
      const l = launches.find((x) => x.jobId === j.id && x.status === "live");
      if (l) {
        for (const a of l.artifacts) contracts.push({ chainId: l.chainId, name: a.name, role: a.role, address: a.address, launchId: l.id });
        if (l.token) release = release ?? { launchId: l.id, launchNumber: l.launchNumber, token: l.token, chainId: l.chainId, poolId: l.poolId };
      }
    }
    if (release) types.add("tokens");
    if (contracts.length && !release) types.add("contracts");
    if (contracts.length && release) types.add("contracts");
    if (sites.length) types.add("sites");
    if (research.length) types.add("research");
    if (code.length) types.add("code");
    if (media.length) types.add("media");
    if (audits.length) types.add("audits");
    if (!types.size) continue;
    items.push({
      id: `job:${head.id}`, title: head.objective.split("\n")[0].slice(0, 140), types: [...types], code, media, sites, research, audits, contracts, release,
      paidBy: head.paidBy, versions: js.map((j) => ({ jobId: j.id, publishedAt: j.delivery?.publishedAt ?? j.updatedAt, commit: j.delivery?.commit ?? null })), publishedAt: head.delivery?.publishedAt ?? head.updatedAt,
    });
  }
  return items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

function reads(app: App, ns: string, name: string) {
  const file = (p: string, content: string) => ({ path: p, digest: sha(content), content });
  switch (ns) {
    case "skill": {
      const s = app.skills.get(name);
      if (!s) throw E.notFound("unknown skill");
      const md = app.skills.markdown(name) ?? `---\nid: ${s.id}\nrole: ${s.role}\n---\n\n# ${s.id}\n\n${s.description}\n`;
      return { name, files: [file("SKILL.md", md)] };
    }
    case "launch": {
      const l = app.store.c<LaunchRecord>("launches").get(name) ?? app.store.c<LaunchRecord>("launches").find((x) => String(x.launchNumber) === name);
      if (!l) throw E.notFound("unknown launch");
      return { name, files: [file("launch.json", JSON.stringify({ chainId: l.chainId, kind: l.kind, launchNumber: l.launchNumber, token: l.token, poolId: l.poolId, contracts: l.artifacts, economics: l.economics, policyVersion: l.policyVersion }, null, 2))] };
    }
    case "workflow": {
      const w = app.store.c<WorkflowRecord>("workflows").get(name);
      if (!w) throw E.notFound("unknown workflow");
      return { name, files: [file("brief.md", w.brief), file("handoff.json", JSON.stringify(w.handoff ?? {}, null, 2))] };
    }
    case "oracle-request": {
      const x = app.store.c<OracleRecord>("oracle").get(name);
      if (!x) throw E.notFound("unknown oracle request");
      return { name, files: [file("request.json", JSON.stringify({ question: x.question, chainId: x.chainId, window: x.window, answerType: x.answerType, evidence: x.evidence, panelSize: x.panelSize, quorum: x.quorum, toleranceBps: x.toleranceBps, head: x.head, definitions: x.definitions, guards: x.guards, validForSeconds: x.validForSeconds }, null, 2))] };
    }
    case "project": {
      const j = app.store.c<JobX>("jobs").get(name);
      if (!j) throw E.notFound("unknown project");
      const pid = j.project?.id ?? j.id;
      const all = app.store.c<JobX>("jobs").filter((x) => (x.project?.id ?? x.id) === pid).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      return { name, files: [file("project.json", JSON.stringify({ id: pid, head: all[all.length - 1]?.id, jobs: all.map((x) => ({ id: x.id, state: x.state, objective: x.objective.slice(0, 200), delivery: x.delivery })) }, null, 2))] };
    }
    case "planning-brief": {
      const j = app.store.c<JobX>("jobs").get(name);
      if (!j) throw E.notFound("unknown job");
      return { name, files: [file("plan.json", JSON.stringify({ template: j.template, planning: j.planning, nodes: j.nodes.map((n) => ({ key: n.key, skill: n.skill, kind: n.kind, dependsOn: n.dependsOn })) }, null, 2))] };
    }
    case "rpcs":
      return { name, files: [file("rpcs.json", JSON.stringify(Object.values(CHAINS).map((c) => ({ chainId: c.chainId, name: c.name, rpc: c.rpcUrl, explorer: c.explorer })), null, 2))] };
    case "pinned":
      return { name, files: [file("pinned.json", JSON.stringify({ skills: app.skills.all().map((s) => ({ id: s.id, version: s.version, hash: s.hash })) }, null, 2))] };
    case "suite": {
      const s = app.skills.get(name);
      if (!s) throw E.notFound("unknown skill");
      return { name, files: [file("suite.json", JSON.stringify({ skill: s.id, tier: s.tier, checks: s.checks, judge: s.tier === 1 ? "verifier-rerun" : "verifier-paths" }, null, 2))] };
    }
    default:
      throw E.notFound(`unknown namespace ${ns}`);
  }
}

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
