/**
 * Chambers' engine: job graphs → leases on connected seats → submissions → the Clerk → cross-examination →
 * delivery. Transport-agnostic: ws.ts feeds it sessions and frames, the tests drive it directly.
 *
 * Node lifecycle: pending → ready (dependencies accepted) → leased → verifying → accepted | rejected → (re-posted
 * to another seat, up to 3 attempts) | failed. A lease that times out is re-posted and the seat is excluded from
 * that node. Reviews (adversarial-review, the Bench) are never assigned to a wallet that did work on the job; panel
 * members (oracle, research) are one per wallet.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canonicalHash, submissionHash, bundleHashOf, isPremium as _isPremium, type Address, type Attempt, type Finding, type Job, type JobBody, type JobNode, type Lease, type RuntimeInfo,
  type ServerFrame, type SubmissionBody, type SubmissionRecord, type ToolInfo, type Verdict,
} from "@company/protocol";
import type { App } from "./app.ts";
import { iso } from "./store.ts";
import { screenObjective } from "./intake.ts";
import { bench, node as makeNode, planJob, workAncestors, type Plan } from "./planner.ts";
import type { BundleRecord } from "./records.ts";

void _isPremium;

export const MAX_ATTEMPTS = 3;
/** Runtime hand-backs (provider errors, timeouts) get more room than rejections: they are not verdicts on the work. */
export const MAX_RUNTIME_ATTEMPTS = 6;
export const MAX_REVISIONS = 1;

export interface Session {
  id: string;
  deviceKey: string;
  tokenId: string;
  wallet: Address;
  agentId: string | null;
  runtime: RuntimeInfo;
  tools: ToolInfo;
  skills: Set<string>;
  concurrency: number;
  premium: boolean;
  paused: boolean;
  version: string;
  connectedAt: number;
  lastHeartbeat: number;
  lastAssignedAt: number;
  send(f: ServerFrame): void;
  close(code: number, reason: string): void;
}

/** Internal node fields kept alongside the API shape. */
type NodeX = JobNode & { wallet?: string | null; leaseId?: string | null };
export type JobX = Job & {
  baseJobId?: string | null;
  panel?: { state: "open" | "agreed" | "disagreed"; wanted: number; quorum: number; winner: string | null; closedAt: string | null } | null;
  launchInput?: Record<string, unknown> | null;
};

export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.code = code;
  }
}

export class Engine {
  readonly sessions = new Map<string, Session>();
  private readonly app: App;
  private dispatching = false;
  private lastDispatch = { finishedAt: null as string | null, ms: 0, error: null as string | null };

  constructor(app: App) {
    this.app = app;
  }

  private get jobs() { return this.app.store.c<JobX>("jobs"); }
  private get attempts() { return this.app.store.c<Attempt & { id: string; createdAt: string }>("attempts"); }
  private get subs() { return this.app.store.c<SubmissionRecord & { id: string }>("submissions"); }
  private get bundles() { return this.app.store.c<BundleRecord>("bundles"); }

  dispatchStatus() {
    return { runningSince: null, runningMs: null, lastFinishedAt: this.lastDispatch.finishedAt, lastMs: this.lastDispatch.ms, lastError: this.lastDispatch.error, stalled: false };
  }

  // ============================================================================================ admission

  /** Plan and store a job; it starts executing at once. */
  admitJob(body: JobBody, meta: {
    paidBy: Address | null; orderId?: string | null; createdBy?: Job["createdBy"]; scheduleId?: string | null; launch?: boolean;
    parent?: JobX | null; workflow?: Job["workflow"]; plan?: Plan; originalRequest?: string | null; oracleRequestId?: string | null;
  }): JobX {
    const now = this.app.now();
    const plan = meta.plan ?? planJob(body, { skills: this.app.skills, launch: !!meta.launch, parentSkill: meta.parent ? singleSkill(meta.parent) : null });
    const id = randomUUID();
    const parent = meta.parent ?? null;
    const launchKind = meta.launch ? (body.onchain === true || body.onchain === undefined ? "evm_project" : body.onchain) : null;
    const isCode = plan.nodes.some((n) => n.kind === "work" && n.allowedPaths.some((p) => p !== "artifacts"));
    const research = body.template === "research" || body.skill === "research-report";
    const deliver = body.github ?? (meta.launch ? true : isCode || research);
    const host = body.ipfs === undefined ? (parent && typeof parent.host === "string" ? parent.host : false) : body.ipfs;
    const job: JobX = {
      id,
      state: "executing",
      template: plan.template,
      objective: body.objective,
      originalRequest: meta.originalRequest ?? null,
      blockedReason: null,
      createdAt: iso(now),
      updatedAt: iso(now),
      paidBy: meta.paidBy ? (meta.paidBy.toLowerCase() as Address) : null,
      orderId: meta.orderId ?? null,
      parentJobId: parent?.id ?? null,
      createdBy: meta.createdBy ?? "request",
      scheduleId: meta.scheduleId ?? null,
      deliver,
      host: host === true && parent?.site ? parent.site.label : host,
      site: null,
      oracleRequestId: meta.oracleRequestId ?? null,
      delivery: null,
      media: null,
      launch: { requested: !!meta.launch, kind: launchKind as Job["launch"]["kind"], id: null, status: null, chainId: meta.launch ? body.chainId ?? this.app.cfg.launchChains[0] : null },
      workflow: meta.workflow ?? null,
      planning: { planner: "managing-partner", shape: plan.shape, notes: plan.notes },
      project: parent ? { id: parent.project?.id ?? parent.id, head: id } : { id, head: id },
      input: body,
      nodes: plan.nodes.map((n) => ({ ...n, updatedAt: iso(now) })),
      references: body.references ?? [],
      report: null,
      baseJobId: parent?.id ?? null,
      panel: plan.nodes.some((n) => n.kind === "panel") && !meta.oracleRequestId
        ? { state: "open", wanted: plan.nodes.filter((n) => n.kind === "panel").length, quorum: body.panelQuorum ?? Math.floor((body.panelSize ?? 1) / 2) + 1, winner: null, closedAt: null }
        : null,
    };
    if (parent) {
      parent.project = { id: job.project!.id, head: id };
      this.jobs.save(parent);
    }
    this.jobs.save(job);
    this.app.event("job.opened", { jobId: id, template: job.template, nodes: job.nodes.map((n) => `${n.key}:${n.skill}`), launch: job.launch.requested, createdBy: job.createdBy });
    this.refreshReady(job);
    queueMicrotask(() => this.tick());
    return job;
  }

  // ============================================================================================ dispatch

  tick() {
    try {
      this.sweep();
      this.dispatch();
    } catch (e) {
      this.lastDispatch.error = (e as Error).message;
      console.error("[engine] tick failed", e);
    }
  }

  private refreshReady(job: JobX) {
    if (job.state !== "executing") return;
    const byKey = new Map(job.nodes.map((n) => [n.key, n]));
    let changed = false;
    for (const n of job.nodes) {
      if (n.state !== "pending") continue;
      if (n.dependsOn.every((d) => ["accepted", "skipped"].includes(byKey.get(d)?.state ?? ""))) {
        n.state = "ready";
        n.updatedAt = iso(this.app.now());
        changed = true;
      }
    }
    if (changed) this.jobs.save(job);
  }

  load(deviceKey: string): number {
    return this.attempts.count((a) => a.deviceKey === deviceKey && a.state === "leased");
  }

  /** Wallets a node must avoid (independence). */
  conflictWallets(job: JobX, node: NodeX): Set<string> {
    const ws = new Set<string>();
    const add = (w?: string | null) => { if (w) ws.add(w.toLowerCase()); };
    for (const n of job.nodes as NodeX[]) {
      if (n.key === node.key) continue;
      if (["review", "audit", "judge"].includes(node.kind)) {
        if (n.kind === "work" && n.wallet) add(n.wallet);
        if (node.kind === "audit" && n.kind === "audit" && n.wallet) add(n.wallet);
      }
      if (node.kind === "panel" && n.kind === "panel" && n.wallet && ["leased", "verifying", "accepted"].includes(n.state)) add(n.wallet);
    }
    if (node.kind === "panel" && job.oracleRequestId) {
      for (const n of job.nodes as NodeX[]) if (n.kind === "panel" && n.wallet && n.key !== node.key && n.state !== "ready") add(n.wallet);
    }
    return ws;
  }

  ineligible(s: Session, job: JobX, node: NodeX, conflicts = this.conflictWallets(job, node)): string | null {
    if (s.paused) return "paused";
    if (this.load(s.deviceKey) >= s.concurrency) return "busy";
    if (!s.skills.has(node.skill)) return "skill not enabled";
    const meta = this.app.skills.get(node.skill);
    for (const r of meta?.requires ?? []) {
      if (r === "tool:image" && !s.tools.image) return "no image tool";
      if (r === "tool:audio" && !s.tools.audio) return "no audio tool";
      if (r === "tool:video" && !s.tools.video) return "no video tool";
    }
    if (meta?.tier === 1 && s.runtime.name !== "mock" && !s.tools.foundry) return "no foundry";
    if (node.premium && !s.premium) return "not on a premium runtime";
    if (node.excluded.includes(s.tokenId)) {
      const until = node.excludedUntil?.[s.tokenId];
      if (!until || until > iso(this.app.now())) return until ? "cooling down after a handed-back lease" : "excluded after a previous attempt";
    }
    if (conflicts.has(s.wallet.toLowerCase())) return node.kind === "panel" ? "wallet already on this panel" : "wallet worked on this job (not independent)";
    return null;
  }

  dispatch() {
    if (this.dispatching) return;
    this.dispatching = true;
    const t0 = Date.now();
    try {
      const jobs = this.jobs.filter((j) => j.state === "executing").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      for (const job of jobs) {
        // matters filed before the intake screen existed are screened on the way to a seat
        const refused = screenObjective(job.objective) ?? job.nodes.map((n) => screenObjective(n.objective)).find(Boolean) ?? null;
        if (refused) { this.blockJob(job, `refused at intake: this matter ${refused}`); continue; }
        this.refreshReady(job);
        for (const node of job.nodes as NodeX[]) {
          if (node.state !== "ready") continue;
          if (this.sessions.size === 0) { this.note(job, node, "no seats online"); continue; }
          const conflicts = this.conflictWallets(job, node);
          const reasons = new Map<string, number>();
          const candidates: Session[] = [];
          for (const s of this.sessions.values()) {
            const why = this.ineligible(s, job, node, conflicts);
            if (!why) candidates.push(s);
            else reasons.set(why, (reasons.get(why) ?? 0) + 1);
          }
          if (!candidates.length) {
            this.note(job, node, `waiting: ${[...reasons].map(([r, n]) => `${n} ${r}`).join(", ")}`);
            continue;
          }
          candidates.sort((a, b) => this.load(a.deviceKey) - this.load(b.deviceKey) || a.lastAssignedAt - b.lastAssignedAt || Number(BigInt(a.tokenId) - BigInt(b.tokenId)));
          this.assign(candidates[0], job, node);
        }
      }
    } finally {
      this.dispatching = false;
      this.lastDispatch = { finishedAt: iso(this.app.now()), ms: Date.now() - t0, error: null };
    }
  }

  private note(job: JobX, node: NodeX, note: string) {
    if (node.dispatchNote === note) return;
    node.dispatchNote = note;
    node.dispatchNoteAt = iso(this.app.now());
    this.jobs.save(job);
  }

  leaseMs(node: JobNode): number {
    const meta = this.app.skills.get(node.skill);
    const base = node.kind === "panel" ? 20 : node.kind === "work" ? (node.premium ? 90 : meta?.tier === 1 ? 45 : 60) : 30;
    return Math.max(1_000, Math.round(base * 60_000 * this.app.cfg.leaseScale));
  }

  private assign(s: Session, job: JobX, node: NodeX) {
    const now = this.app.now();
    const att: Attempt & { id: string; createdAt: string } = {
      id: randomUUID(),
      createdAt: iso(now),
      leaseId: "",
      jobId: job.id,
      nodeKey: node.key,
      attempt: node.attempt,
      tokenId: s.tokenId,
      agentId: s.agentId,
      wallet: s.wallet,
      deviceKey: s.deviceKey,
      runtime: s.runtime,
      state: "leased",
      leasedAt: iso(now),
      expiresAt: iso(now + this.leaseMs(node)),
      finishedAt: null,
      submissionHash: null,
      failure: null,
    };
    att.leaseId = att.id;
    this.attempts.save(att);
    node.state = "leased";
    node.seat = { tokenId: s.tokenId, agentId: s.agentId };
    node.wallet = s.wallet.toLowerCase();
    node.leaseId = att.leaseId;
    node.dispatchNote = null;
    node.updatedAt = iso(now);
    this.jobs.save(job);
    s.lastAssignedAt = now;
    s.send({ type: "assignment", lease: this.lease(job, node, att) });
    this.app.event("lease.assigned", { jobId: job.id, nodeKey: node.key, skill: node.skill, kind: node.kind, tokenId: s.tokenId, leaseId: att.leaseId, attempt: node.attempt });
  }

  lease(job: JobX, node: NodeX, att: Attempt): Lease {
    const api = this.app.cfg.publicApiUrl;
    const meta = this.app.skills.get(node.skill);
    const byKey = new Map(job.nodes.map((n) => [n.key, n as NodeX]));
    const ancestors = this.ancestors(job, node.key);
    const sourceBundles: Lease["source"]["bundles"] = [];
    for (const b of this.baseBundles(job)) sourceBundles.push(b);
    for (const n of this.topo(job)) {
      if (!ancestors.has(n.key) || n.state !== "accepted" || !n.submissionHash) continue;
      if (n.kind !== "work" && !(n.kind === "panel" && job.panel?.winner === n.key)) continue;
      const sub = this.subs.get(n.submissionHash);
      if (sub?.bundleHash) sourceBundles.push({ nodeKey: n.key, bundleHash: sub.bundleHash, url: `${api}/bundles/${sub.bundleHash}` });
    }
    const lease: Lease = {
      leaseId: att.leaseId,
      jobId: job.id,
      nodeKey: node.key,
      attempt: node.attempt,
      kind: node.kind,
      skill: node.skill,
      role: node.role,
      tier: meta?.tier ?? null,
      inference: meta?.inference ?? null,
      premium: node.premium,
      objective: node.objective ? `${job.objective}\n\nThis step: ${node.objective}` : job.objective,
      acceptanceCriteria: node.acceptanceCriteria,
      allowedPaths: node.allowedPaths,
      inputs: node.inputs.map((f) => ({ name: f.name, path: f.path, hash: f.hash, bytes: f.bytes, mediaType: f.mediaType, url: `${api}/artifacts/${f.hash}` })),
      outputs: node.outputs,
      references: [...new Set([...job.references, ...node.references])],
      variables: node.variables,
      source: { repoUrl: job.input.repoUrl ?? job.delivery?.repoUrl ?? null, baseCommit: job.input.baseCommit ?? null, bundles: sourceBundles },
      issuedAt: Date.parse(att.leasedAt),
      expiresAt: Date.parse(att.expiresAt),
    };
    if (node.kind === "review" || node.kind === "audit" || node.kind === "judge") {
      const keys = node.kind === "judge" ? [...node.dependsOn, ...node.reviews] : node.reviews;
      lease.review = {
        targets: keys.map((k) => byKey.get(k)).filter((n): n is NodeX => !!n && !!n.submissionHash).map((n) => {
          const sub = this.subs.get(n.submissionHash!);
          return { nodeKey: n.key, skill: n.skill, submissionHash: n.submissionHash!, bundleHash: sub?.bundleHash ?? null, summary: sub?.summary ?? null, findings: sub?.findings ?? [] };
        }),
      };
    }
    if (job.oracleRequestId) {
      const r = this.app.store.c<any>("oracle").get(job.oracleRequestId);
      if (r) lease.oracle = { requestId: r.id, question: r.question, chainId: r.chainId, answerType: r.answerType, window: r.window, evidence: r.evidence, head: r.head, definitions: r.definitions, guards: r.guards };
    } else if (node.skill === "research-report") {
      // the lease must ask for what the Clerk will enforce: the step's own minCitations first, then the job's
      lease.research = { rubric: job.input.rubric ? { contains: job.input.rubric.contains, mayNotRestOn: job.input.rubric.mayNotRestOn ?? [] } : null, minCitations: Number(node.variables.minCitations ?? job.input.minCitations ?? 0) || 0 };
    }
    if (node.variables.mode === "fuzz") lease.fuzz = { runs: Number(node.variables.runs), contracts: job.input.contracts ?? [], projectPath: job.input.projectPath ?? null };
    if (job.launch.requested) {
      const chainId = job.launch.chainId ?? this.app.cfg.launchChains[0];
      // swarm launches pair with $COMD unless the payer chose ETH (Launches.defaultPairing)
      lease.launch = { kind: job.launch.kind ?? "evm_project", chainId, pairWith: job.input.pairWith ?? this.app.launches.defaultPairing(chainId), economics: (job.input.economics as Record<string, unknown>) ?? null };
    } else lease.launch = null;
    return lease;
  }

  /** Bundles a continuation starts from (the parent project's accepted work). */
  private baseBundles(job: JobX): Lease["source"]["bundles"] {
    const out: Lease["source"]["bundles"] = [];
    const seen = new Set<string>();
    let base = job.baseJobId ? this.jobs.get(job.baseJobId) : undefined;
    const chain: JobX[] = [];
    while (base && !seen.has(base.id)) { seen.add(base.id); chain.unshift(base); base = base.baseJobId ? this.jobs.get(base.baseJobId) : undefined; }
    for (const j of chain) {
      for (const n of this.topo(j)) {
        if (n.state !== "accepted" || !n.submissionHash || n.kind !== "work") continue;
        const sub = this.subs.get(n.submissionHash);
        if (sub?.bundleHash) out.push({ nodeKey: `${j.id.slice(0, 8)}:${n.key}`, bundleHash: sub.bundleHash, url: `${this.app.cfg.publicApiUrl}/bundles/${sub.bundleHash}` });
      }
    }
    return out;
  }

  topo(job: JobX): NodeX[] {
    const byKey = new Map(job.nodes.map((n) => [n.key, n as NodeX]));
    const out: NodeX[] = [];
    const seen = new Set<string>();
    const visit = (n: NodeX) => {
      if (seen.has(n.key)) return;
      seen.add(n.key);
      for (const d of n.dependsOn) { const m = byKey.get(d); if (m) visit(m); }
      out.push(n);
    };
    for (const n of job.nodes as NodeX[]) visit(n);
    return out;
  }

  ancestors(job: JobX, key: string): Set<string> {
    const byKey = new Map(job.nodes.map((n) => [n.key, n]));
    const out = new Set<string>();
    const stack = [...(byKey.get(key)?.dependsOn ?? [])];
    while (stack.length) {
      const k = stack.pop()!;
      if (out.has(k)) continue;
      out.add(k);
      stack.push(...(byKey.get(k)?.dependsOn ?? []));
    }
    return out;
  }

  // ============================================================================================ leases

  sweep() {
    const now = this.app.now();
    for (const a of this.attempts.filter((x) => x.state === "leased" && Date.parse(x.expiresAt) <= now)) this.closeLease(a, "expired", "lease timed out");
    for (const s of [...this.sessions.values()]) {
      if (now - s.lastHeartbeat > this.app.cfg.heartbeatMs * 3) {
        s.send({ type: "disconnect", code: 4008, reason: "heartbeat timeout" });
        s.close(4008, "heartbeat timeout");
        this.removeSession(s);
      }
    }
  }

  /** Expire or hand back a lease: the seat is excluded from this node and the node is re-posted. */
  closeLease(a: Attempt & { id: string; createdAt: string }, state: "expired" | "cancelled", reason: string) {
    const job = this.jobs.get(a.jobId);
    a.state = state;
    a.failure = reason;
    a.finishedAt = iso(this.app.now());
    this.attempts.save(a);
    for (const s of this.sessions.values()) if (s.deviceKey === a.deviceKey) s.send({ type: "cancel", leaseId: a.leaseId, reason });
    if (!job) return;
    const node = job.nodes.find((n) => n.key === a.nodeKey) as NodeX | undefined;
    if (!node || node.leaseId !== a.leaseId || node.state !== "leased") return;
    this.app.event(state === "expired" ? "lease.expired" : "lease.handed_back", { jobId: job.id, nodeKey: node.key, tokenId: a.tokenId, leaseId: a.leaseId, attempt: node.attempt });
    // a runtime hand-back (model provider down or unpaid, timeout, restart) is not a verdict on the seat: it may try
    // again after a cooldown, so two online Counsel with a hiccup do not strand every matter on the docket
    this.retryNode(job, node, a.tokenId, `${reason} (seat #${a.tokenId})`, true);
  }

  private retryNode(job: JobX, node: NodeX, tokenId: string, reason: string, cooldown = false) {
    if (!node.excluded.includes(tokenId)) node.excluded.push(tokenId);
    if (cooldown) {
      const minutes = Math.max(1, Number(this.app.cfg.storage.LEASE_RETRY_COOLDOWN_MINUTES ?? 20));
      node.excludedUntil = { ...(node.excludedUntil ?? {}), [tokenId]: iso(this.app.now() + minutes * 60_000) };
    } else if (node.excludedUntil?.[tokenId]) {
      delete node.excludedUntil[tokenId]; // a rejection makes it permanent
    }
    node.seat = null;
    node.wallet = null;
    node.leaseId = null;
    node.updatedAt = iso(this.app.now());
    const cap = cooldown ? MAX_RUNTIME_ATTEMPTS : MAX_ATTEMPTS;
    if (node.attempt >= cap) {
      node.state = "failed";
      node.failureReason = `${reason}; ${cap} attempts used`;
      this.jobs.save(job);
      this.app.event("node.failed", { jobId: job.id, nodeKey: node.key, reason: node.failureReason });
      if (node.kind === "panel") return this.afterPanelChange(job);
      return this.blockJob(job, `runtime error: ${node.key} failed after ${MAX_ATTEMPTS} attempts (${reason})`);
    }
    node.attempt++;
    node.state = "ready";
    this.jobs.save(job);
    this.app.event("node.reposted", { jobId: job.id, nodeKey: node.key, attempt: node.attempt, reason });
  }

  onProgress(s: Session, leaseId: string, note?: string): { expiresAt: number } {
    const a = this.attempts.get(leaseId);
    if (!a || a.deviceKey !== s.deviceKey) throw new EngineError("unknown_lease", "no such lease for this device");
    if (a.state !== "leased") throw new EngineError("lease_closed", `lease is ${a.state}`);
    const job = this.jobs.get(a.jobId)!;
    const node = job.nodes.find((n) => n.key === a.nodeKey)!;
    const ms = this.leaseMs(node);
    const cap = Date.parse(a.leasedAt) + 3 * ms;
    const next = Math.min(cap, this.app.now() + ms);
    if (next > Date.parse(a.expiresAt)) {
      a.expiresAt = iso(next);
      this.attempts.save(a);
    }
    if (note) this.app.event("lease.progress", { leaseId, jobId: a.jobId, nodeKey: a.nodeKey, note: note.slice(0, 200) });
    return { expiresAt: Date.parse(a.expiresAt) };
  }

  onCancel(s: Session, leaseId: string, reason?: string) {
    const a = this.attempts.get(leaseId);
    if (!a || a.deviceKey !== s.deviceKey) throw new EngineError("unknown_lease", "no such lease for this device");
    if (a.state !== "leased") throw new EngineError("lease_closed", `lease is ${a.state}`);
    this.closeLease(a, "cancelled", `handed back: ${(reason ?? "no reason").slice(0, 200)}`);
    this.tick();
  }

  openLeases(deviceKey: string): Lease[] {
    const out: Lease[] = [];
    for (const a of this.attempts.filter((x) => x.deviceKey === deviceKey && x.state === "leased")) {
      const job = this.jobs.get(a.jobId);
      const node = job?.nodes.find((n) => n.key === a.nodeKey) as NodeX | undefined;
      if (job && node && node.leaseId === a.leaseId) out.push(this.lease(job, node, a));
    }
    return out;
  }

  addSession(s: Session) {
    this.sessions.set(s.deviceKey, s);
    this.tick();
  }
  removeSession(s: Session) {
    if (this.sessions.get(s.deviceKey) === s) this.sessions.delete(s.deviceKey);
  }
  sessionForToken(tokenId: string): Session | undefined {
    for (const s of this.sessions.values()) if (s.tokenId === tokenId) return s;
    return undefined;
  }

  // ============================================================================================ submissions

  /** Handle a submission frame. Idempotent on (leaseId, hash): outbox resends get {duplicate:true}. */
  submit(s: Session, body: SubmissionBody): { status: string; hash: string; duplicate?: boolean } {
    if (!body || typeof body.leaseId !== "string") throw new EngineError("invalid_submission", "leaseId required");
    const a = this.attempts.get(body.leaseId);
    if (!a || a.deviceKey !== s.deviceKey) throw new EngineError("unknown_lease", "no such lease for this device");
    if (a.state !== "leased") {
      if (a.submissionHash && a.submissionHash === body.hash) return { status: a.state, hash: body.hash, duplicate: true };
      throw new EngineError("lease_closed", `lease is ${a.state}`);
    }
    if (Date.parse(a.expiresAt) <= this.app.now()) throw new EngineError("lease_expired", "lease expired before submission");
    const files = Array.isArray(body.files) ? body.files : [];
    const expected = submissionHashOf(body.leaseId, body.bundleHash ?? null, files, body.result ?? null);
    if (expected !== body.hash) throw new EngineError("invalid_submission", "hash does not match canonicalHash({leaseId, bundleHash, files, result})");
    if (body.bundleHash) {
      const b = this.bundles.get(body.bundleHash);
      if (!b) throw new EngineError("unknown_bundle", "upload the bundle (POST /bundles) before submitting");
      if (!b.leaseIds.includes(body.leaseId)) throw new EngineError("invalid_submission", "upload the bundle for this lease first");
      if (bundleHashOf(b.files) !== bundleHashOf(files)) throw new EngineError("invalid_submission", "files differ from the uploaded bundle");
    } else if (files.length) throw new EngineError("invalid_submission", "files need a bundle");
    const job = this.jobs.get(a.jobId)!;
    const node = job.nodes.find((n) => n.key === a.nodeKey) as NodeX;
    const now = this.app.now();
    const result = (body.result ?? null) as SubmissionRecord["result"];
    const findings = sanitizeFindings(body.result?.findings);
    const sub: SubmissionRecord & { id: string } = {
      id: body.hash,
      hash: body.hash,
      jobId: job.id,
      nodeKey: node.key,
      leaseId: a.leaseId,
      tokenId: a.tokenId,
      agentId: a.agentId,
      wallet: a.wallet,
      deviceKey: a.deviceKey,
      bundleHash: body.bundleHash ?? null,
      files: sortFiles(files),
      summary: typeof body.summary === "string" ? body.summary.slice(0, 4000) : null,
      usage: body.usage ?? {},
      runtime: body.runtime ?? s.runtime,
      result,
      accepted: null,
      verdict: null,
      oracleResult: job.oracleRequestId ? { answer: body.result?.answer ?? null, figure: body.result?.figure ?? null, recipe: body.result?.recipe ?? null, sources: body.result?.sources ?? [] } : null,
      findings,
      artifacts: [],
      createdAt: iso(now),
    };
    this.subs.save(sub);
    a.state = "submitted";
    a.submissionHash = body.hash;
    this.attempts.save(a);
    node.state = "verifying";
    node.updatedAt = iso(now);
    this.jobs.save(job);
    this.app.event("submission.received", { jobId: job.id, nodeKey: node.key, tokenId: a.tokenId, hash: body.hash, files: files.length });
    this.app.track(this.process(job.id, node.key, a.leaseId, sub.hash));
    return { status: "verifying", hash: body.hash };
  }

  /** The Clerk's pass plus kind-specific checks, then accept or reject. */
  private async process(jobId: string, nodeKey: string, leaseId: string, hash: string) {
    const job = this.jobs.get(jobId)!;
    const node = job.nodes.find((n) => n.key === nodeKey) as NodeX;
    const a = this.attempts.get(leaseId)!;
    const sub = this.subs.get(hash)!;
    let dir: string | null = null;
    let base: string | null = null;
    try {
      sub.result = await this.deriveResult(node, sub);
      sub.findings = sanitizeFindings((sub.result as any)?.findings);
      if (job.oracleRequestId) sub.oracleResult = { answer: (sub.result as any)?.answer ?? null, figure: (sub.result as any)?.figure ?? null, recipe: (sub.result as any)?.recipe ?? null, sources: (sub.result as any)?.sources ?? [] };
      this.subs.save(sub);
      const problem = this.resultProblem(job, node, sub);
      base = await this.materialize(job, node.key);
      dir = await this.materialize(job, node.key, sub);
      const v = await this.app.services.verify({
        workspaceDir: dir, baseDir: base, allowedPaths: node.allowedPaths, skill: node.skill, outputs: node.outputs, changed: sub.files.map((f) => f.path), kind: node.kind,
        minCitations: node.skill === "research-report" ? Number(node.variables.minCitations ?? job.input.minCitations ?? 1) || 1 : undefined,
        rubricContains: job.input.rubric?.contains,
      });
      const verdict: Verdict = {
        status: v.ok && !problem ? "accepted" : "rejected",
        profile: v.profile,
        evaluation: node.kind === "work" ? v.evaluation : node.kind === "panel" ? "panel" : "review",
        rejectionCode: problem ? "result" : v.ok ? null : v.failedChecks[0] ?? "verifier",
        detail: problem ?? v.detail,
        verifierVersion: v.version,
        verifiedTreeHash: v.treeHash,
        at: iso(this.app.now()),
        failedChecks: problem ? ["result", ...v.failedChecks] : v.failedChecks,
      };
      sub.artifacts = await this.artifactsOf(node, sub);
      if (verdict.status === "accepted") this.accept(job, node, a, sub, verdict);
      else this.reject(job, node, a, sub, verdict);
    } catch (e) {
      console.error(`[engine] verification of ${hash} failed`, e);
      a.state = "failed";
      a.failure = `verification error: ${(e as Error).message}`;
      this.attempts.save(a);
      this.retryNode(job, node, a.tokenId, a.failure);
    } finally {
      for (const d of [dir, base]) if (d) await rm(d, { recursive: true, force: true }).catch(() => undefined);
      this.tick();
    }
  }

  /**
   * The structured result: what the seat sent in the submission frame, completed from the files the Clerk checks
   * (artifacts/review.json, artifacts/answer.json, artifacts/sources.json) so both always agree.
   */
  private async deriveResult(node: NodeX, sub: SubmissionRecord): Promise<SubmissionRecord["result"]> {
    const r: Record<string, any> = { ...((sub.result as Record<string, unknown>) ?? {}) };
    const read = async (p: string) => {
      const f = sub.files.find((x) => x.path === p);
      if (!f) return null;
      try { return JSON.parse((await this.app.blobs.get(f.sha256))!.data.toString("utf8")); } catch { return null; }
    };
    if (["review", "audit", "judge"].includes(node.kind)) {
      const rv = await read("artifacts/review.json");
      if (rv) {
        r.verdict ??= rv.verdict;
        if (!Array.isArray(r.findings) || !r.findings.length) r.findings = rv.findings ?? [];
        if (rv.area) r.area ??= rv.area;
        if (rv.summary) r.summary ??= rv.summary;
      }
    }
    if (node.skill === "oracle-assess") {
      const a = await read("artifacts/answer.json");
      if (a) {
        if (a.status === "refused" || a.status === "ambiguous") r.refuse ??= String(a.reason ?? a.status);
        else {
          r.answer ??= a.answer;
          r.recipe ??= a.recipe;
          r.sources ??= a.sources;
          if (a.figure !== undefined) r.figure ??= String(a.figure);
        }
      }
    }
    if (node.skill === "research-report") {
      const src = await read("artifacts/sources.json");
      const urls = Array.isArray(src) ? src : Array.isArray(src?.sources) ? src.sources : null;
      if (urls && !Array.isArray(r.citations)) r.citations = urls.map((x: any) => (typeof x === "string" ? x : x?.url)).filter(Boolean);
    }
    return Object.keys(r).length ? (r as SubmissionRecord["result"]) : null;
  }

  private resultProblem(job: JobX, node: NodeX, sub: SubmissionRecord): string | null {
    const r = (sub.result ?? {}) as Record<string, any>;
    if (node.kind === "review" || node.kind === "judge") {
      if (r.verdict !== "accept" && r.verdict !== "reject") return "a review must return verdict accept or reject";
      if (r.verdict === "reject" && !sub.findings.length) return "a rejecting review must list reproducible findings";
    }
    if (job.oracleRequestId) return this.app.oracle.answerProblem(job.oracleRequestId, r);
    if (node.skill === "research-report") {
      const min = Number(node.variables.minCitations ?? job.input.minCitations ?? 0);
      const cites = Array.isArray(r.citations) ? r.citations.filter((c: unknown) => typeof c === "string" && /^https?:\/\//.test(c)) : [];
      if (cites.length < min) return `research needs at least ${min} citations (got ${cites.length})`;
      if (node.kind === "panel" && (typeof r.answer !== "string" || !r.answer.trim())) return "panel members must give a short final answer";
    }
    return null;
  }

  private async artifactsOf(node: NodeX, sub: SubmissionRecord) {
    const out: SubmissionRecord["artifacts"] = [];
    for (const f of sub.files) {
      const named = node.outputs.find((o) => o.path === f.path);
      if (named || f.path.startsWith("artifacts/")) out.push({ name: named?.name ?? path.posix.basename(f.path), path: f.path, mediaType: f.mediaType, hash: f.sha256, bytes: f.bytes, url: `${this.app.cfg.publicApiUrl}/artifacts/${f.sha256}` });
    }
    return out;
  }

  private accept(job: JobX, node: NodeX, a: Attempt & { id: string; createdAt: string }, sub: SubmissionRecord & { id: string }, verdict: Verdict) {
    const now = iso(this.app.now());
    sub.accepted = true;
    sub.verdict = verdict;
    this.subs.save(sub);
    a.state = "accepted";
    a.finishedAt = now;
    this.attempts.save(a);
    node.state = "accepted";
    node.verdict = verdict;
    node.submissionHash = sub.hash;
    node.updatedAt = now;
    this.jobs.save(job);
    this.app.event("node.accepted", { jobId: job.id, nodeKey: node.key, skill: node.skill, tokenId: a.tokenId, evaluation: verdict.evaluation });
    this.app.settlement.onAccepted(job, node, sub);
    if (node.kind === "review" || node.kind === "judge") this.reviewOutcome(job, node, sub);
    if (node.kind === "judge") job.report = renderReport(job, this.subs);
    if (node.kind === "panel") {
      if (job.oracleRequestId) this.app.oracle.onMember(job, node, sub);
      else this.afterPanelChange(job);
    }
    if (node.variables.mode === "fuzz") this.app.fuzz.onNodeAccepted(job, node, sub);
    this.advance(job);
  }

  private reject(job: JobX, node: NodeX, a: Attempt & { id: string; createdAt: string }, sub: SubmissionRecord & { id: string }, verdict: Verdict) {
    sub.accepted = false;
    sub.verdict = verdict;
    this.subs.save(sub);
    a.state = "rejected";
    a.finishedAt = iso(this.app.now());
    a.failure = verdict.detail;
    this.attempts.save(a);
    node.verdict = verdict;
    this.app.event("node.rejected", { jobId: job.id, nodeKey: node.key, tokenId: a.tokenId, detail: verdict.detail });
    this.retryNode(job, node, a.tokenId, `rejected: ${verdict.detail}`);
  }

  /**
   * A rejecting cross-examination (or judge) earns one revision: a fix-findings node on the reviewed work and a
   * fresh review after it, by another independent seat. A second rejection blocks the job ("review failed").
   */
  private reviewOutcome(job: JobX, node: NodeX, sub: SubmissionRecord) {
    const verdict = (sub.result as any)?.verdict;
    if (verdict !== "reject") return;
    const rev = node.kind === "judge" ? node.judgeRevisions : node.revisions;
    if (rev >= MAX_REVISIONS) {
      this.blockJob(job, `review failed: ${node.key} rejected after ${rev} revision(s): ${sub.findings.slice(0, 3).map((f) => f.title).join("; ")}`);
      return;
    }
    const n = rev + 1;
    const fixKey = `fix_${node.key}`.slice(0, 28) + (n > 1 ? `_${n}` : "");
    const targets = node.reviews.map((k) => job.nodes.find((x) => x.key === k)).filter(Boolean) as NodeX[];
    const allowed = [...new Set(targets.flatMap((t) => t.allowedPaths))];
    const blocking = sub.findings.filter((f) => f.blocking ?? (f.severity === "critical" || f.severity === "high"));
    const listed = (blocking.length ? blocking : sub.findings).map((f, i) => ({ ...f, id: f.id ?? `F${i + 1}`, blocking: true }));
    const fix: NodeX = {
      ...makeNode(this.app.skills, fixKey, "fix-findings", "work", {
        dependsOn: [node.key],
        paths: allowed.length ? allowed : undefined,
        references: node.references,
        objective: `Address these findings without widening scope (respond to each in artifacts/responses.json):\n${listed.map((f) => `${f.id}. [${f.severity}] ${f.title}${f.detail ? ` — ${f.detail}` : ""}`).join("\n")}`,
        variables: { findings: JSON.stringify({ findings: listed }) },
      }),
      updatedAt: iso(this.app.now()),
      wallet: null,
      leaseId: null,
    };
    let again: NodeX[];
    if (node.kind === "judge") {
      // the bench re-sits on the fixed code: four specialists + judge
      again = bench(this.app.skills, [fixKey], node.references, `rebench${n}`) as NodeX[];
      again[again.length - 1].judgeRevisions = n;
    } else {
      again = [{ ...structuredClone(node), key: `${node.key}_r${n + 1}`.slice(0, 32), state: "pending", attempt: 1, revisions: n, dependsOn: [fixKey], verdict: null, seat: null, submissionHash: null, excluded: [], wallet: null, leaseId: null, dispatchNote: null, failureReason: null }];
    }
    const last = again[again.length - 1];
    for (const m of job.nodes) if (m.dependsOn.includes(node.key) && m.key !== fixKey) m.dependsOn = m.dependsOn.map((d) => (d === node.key ? last.key : d));
    job.nodes.push(fix, ...again);
    for (const m of again) m.reviews = [...new Set([...node.reviews, fixKey])];
    this.jobs.save(job);
    this.app.event("review.findings", { jobId: job.id, nodeKey: node.key, findings: sub.findings.length, fix: fixKey, rereview: last.key });
  }

  /** Research panels: close on quorum (matching answers) or when quorum can no longer be reached. */
  afterPanelChange(job: JobX) {
    if (job.oracleRequestId) return this.app.oracle.evaluate(job);
    const p = job.panel;
    if (!p || p.state !== "open") return;
    const members = job.nodes.filter((n) => n.kind === "panel");
    const clusters = new Map<string, string[]>();
    for (const n of members) {
      if (n.state !== "accepted" || !n.submissionHash) continue;
      const ans = normAnswer((this.subs.get(n.submissionHash)?.result as any)?.answer);
      clusters.set(ans, [...(clusters.get(ans) ?? []), n.key]);
    }
    const best = [...clusters.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    const open = members.filter((n) => !["accepted", "failed", "skipped", "cancelled"].includes(n.state)).length;
    if (best.length >= p.quorum) {
      p.state = "agreed";
      p.winner = best[0];
      p.closedAt = iso(this.app.now());
      for (const n of members as NodeX[]) if (!["accepted", "failed"].includes(n.state)) this.skipNode(n, "panel closed on quorum");
      this.app.event("panel.agreed", { jobId: job.id, quorum: p.quorum, agreeing: best.length });
    } else if (best.length + open < p.quorum) {
      p.state = "disagreed";
      p.closedAt = iso(this.app.now());
      for (const n of members as NodeX[]) if (!["accepted", "failed"].includes(n.state)) this.skipNode(n, "panel disagreed");
      this.jobs.save(job);
      return this.blockJob(job, `panel disagreed: no ${p.quorum} matching answers`);
    }
    this.jobs.save(job);
    this.advance(job);
  }

  skipNode(n: NodeX, reason: string) {
    if (n.state === "leased" && n.leaseId) {
      const a = this.attempts.get(n.leaseId);
      if (a && a.state === "leased") {
        a.state = "cancelled";
        a.failure = reason;
        a.finishedAt = iso(this.app.now());
        this.attempts.save(a);
        for (const s of this.sessions.values()) if (s.deviceKey === a.deviceKey) s.send({ type: "cancel", leaseId: a.leaseId, reason });
      }
    }
    n.state = "skipped";
    n.failureReason = reason;
    n.updatedAt = iso(this.app.now());
  }

  /** All nodes done → delivery (oracle jobs finish through the attester instead). */
  advance(job: JobX) {
    if (job.state !== "executing") return;
    this.refreshReady(job);
    if (job.oracleRequestId) return;
    const done = job.nodes.every((n) => n.state === "accepted" || n.state === "skipped");
    if (!done) return;
    job.state = "delivering";
    job.updatedAt = iso(this.app.now());
    this.jobs.save(job);
    this.app.event("job.delivering", { jobId: job.id });
    this.app.track(this.deliver(job));
  }

  // ============================================================================================ delivery

  private async deliver(job: JobX) {
    let dir: string | null = null;
    try {
      dir = await this.materialize(job, null);
      if ((job.deliver || job.launch.requested) && !job.delivery) {
        const base = job.input.repoUrl && job.input.baseCommit ? { repoUrl: job.input.repoUrl, commit: job.input.baseCommit } : this.parentRepo(job);
        const r = await this.app.services.publishRepo({ jobId: job.id, title: job.objective.split("\n")[0].slice(0, 80), dir, baseRepo: base });
        job.delivery = { repoUrl: r.repoUrl, commit: r.commit, pullRequestUrl: r.pullRequestUrl, branch: r.branch, publishedAt: iso(this.app.now()), files: (await countFiles(dir)) };
        this.jobs.save(job);
        this.app.event("job.published", { jobId: job.id, repoUrl: r.repoUrl, commit: r.commit });
      }
      if (job.launch.requested) {
        const launch = await this.app.launches.run(job, dir);
        if (launch.status !== "live") return this.blockJob(job, `launch ${launch.status}: ${launch.parkedReason ?? "see /launches/" + launch.id}`);
      }
      if (job.host) await this.app.sites.publishForJob(job, dir);
      job.media = (await this.collectMedia(job)) || null;
      job.state = "completed";
      job.updatedAt = iso(this.app.now());
      this.jobs.save(job);
      this.app.event("job.completed", { jobId: job.id, delivery: job.delivery?.repoUrl ?? null, site: job.site?.url ?? null, launch: job.launch.id });
      this.app.settlement.onJobFinished(job);
      this.app.workflows.onJobFinished(job);
    } catch (e) {
      console.error(`[engine] delivery of ${job.id} failed`, e);
      this.blockJob(job, `delivery failed: ${(e as Error).message}`);
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private parentRepo(job: JobX): { repoUrl: string; commit: string } | null {
    const p = job.baseJobId ? this.jobs.get(job.baseJobId) : null;
    return p?.delivery?.repoUrl && p.delivery.commit ? { repoUrl: p.delivery.repoUrl, commit: p.delivery.commit } : null;
  }

  private async collectMedia(job: JobX) {
    const media: NonNullable<Job["media"]> = [];
    for (const n of job.nodes) {
      if (n.state !== "accepted" || !n.submissionHash) continue;
      for (const f of this.subs.get(n.submissionHash)?.artifacts ?? []) if (/^(image|audio|video)\//.test(f.mediaType)) media.push({ name: f.name, path: f.path, mediaType: f.mediaType, hash: f.hash, url: f.url });
    }
    return media.length ? media : null;
  }

  blockJob(job: JobX, reason: string) {
    if (job.state === "completed" || job.state === "cancelled" || job.state === "blocked") return;
    job.state = "blocked";
    job.blockedReason = reason.slice(0, 500);
    job.updatedAt = iso(this.app.now());
    for (const n of job.nodes as NodeX[]) if (["pending", "ready", "leased"].includes(n.state)) this.skipNode(n, "job blocked");
    this.jobs.save(job);
    this.app.event("job.blocked", { jobId: job.id, reason: job.blockedReason });
    this.app.settlement.onJobFinished(job);
    this.app.workflows.onJobFinished(job);
  }

  /** Finish a job whose outcome another module owns (oracle attestation). */
  finishJob(job: JobX, outcome: "completed" | "blocked", reason?: string) {
    if (outcome === "blocked") return this.blockJob(job, reason ?? "blocked");
    if (job.state === "completed") return;
    job.state = "completed";
    job.updatedAt = iso(this.app.now());
    this.jobs.save(job);
    this.app.event("job.completed", { jobId: job.id });
    this.app.settlement.onJobFinished(job);
  }

  // ============================================================================================ workspaces

  /** Write a job's accepted work (ancestors of `upto`, or everything) plus an optional new submission to a temp dir. */
  async materialize(job: JobX, upto: string | null, extra?: SubmissionRecord): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), `company-${job.id.slice(0, 8)}-`));
    const apply = async (bundleHash: string | null) => {
      if (!bundleHash) return;
      const b = this.bundles.get(bundleHash);
      if (!b) return;
      for (const f of b.files) {
        const obj = await this.app.blobs.get(f.sha256);
        if (!obj) throw new Error(`blob ${f.sha256} missing for ${f.path}`);
        await writeSafe(dir, f.path, obj.data);
      }
    };
    for (const sb of this.baseBundles(job)) await apply(sb.bundleHash);
    const keep = upto ? this.ancestors(job, upto) : null;
    for (const n of this.topo(job)) {
      if (keep && !keep.has(n.key)) continue;
      if (n.state !== "accepted" || !n.submissionHash) continue;
      if (n.kind !== "work" && !(n.kind === "panel" && job.panel?.winner === n.key)) continue;
      await apply(this.subs.get(n.submissionHash)?.bundleHash ?? null);
    }
    const node = upto ? job.nodes.find((n) => n.key === upto) : null;
    for (const f of [...(job.input.inputs ?? []), ...(node?.inputs ?? [])]) {
      const obj = await this.app.blobs.get(f.hash);
      if (obj) await writeSafe(dir, f.path, obj.data);
    }
    // the findings a fix-findings step answers (the Clerk's findings-response check reads this)
    if (node?.variables.findings) await writeSafe(dir, ".company/reads/findings.json", Buffer.from(node.variables.findings));
    if (extra) await apply(extra.bundleHash);
    return dir;
  }
}

// ============================================================================================ helpers

export function submissionHashOf(leaseId: string, bundleHash: string | null, files: SubmissionBody["files"], result: unknown): string {
  return submissionHash(leaseId, bundleHash, files, result);
}

export function sortFiles<T extends { path: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function sanitizeFindings(v: unknown): Finding[] {
  if (!Array.isArray(v)) return [];
  const sev = ["critical", "high", "medium", "low", "info"];
  return v.slice(0, 50).filter((f) => f && typeof f === "object" && typeof f.title === "string").map((f: any) => ({
    ...(typeof f.id === "string" ? { id: f.id.slice(0, 40) } : {}),
    severity: sev.includes(f.severity) ? f.severity : "info",
    title: String(f.title).slice(0, 300),
    ...(typeof f.detail === "string" ? { detail: f.detail.slice(0, 4000) } : {}),
    ...(typeof f.reproduction === "string" ? { reproduction: f.reproduction.slice(0, 4000) } : {}),
    ...(typeof f.location === "string" ? { location: f.location.slice(0, 300) } : {}),
    ...(typeof f.evidence === "string" ? { evidence: f.evidence.slice(0, 4000) } : {}),
    ...(typeof f.blocking === "boolean" ? { blocking: f.blocking } : {}),
    ...(typeof f.reproduced === "boolean" ? { reproduced: f.reproduced } : {}),
  }));
}

export function normAnswer(a: unknown): string {
  return String(a ?? "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
}

function singleSkill(job: Job): string | null {
  const work = job.nodes.filter((n) => n.kind === "work");
  return work.length === 1 ? work[0].skill : job.template.startsWith("skill:") ? job.template.slice(6) : null;
}

async function writeSafe(root: string, rel: string, data: Buffer) {
  const norm = path.posix.normalize(rel);
  if (norm.startsWith("..") || path.posix.isAbsolute(norm) || norm.includes("\0")) throw new Error(`unsafe path ${rel}`);
  const abs = path.join(root, ...norm.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

async function countFiles(dir: string): Promise<number> {
  const { walk } = await import("./services.ts");
  return (await walk(dir)).length;
}

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];
export function renderReport(job: Job, subs: { get(id: string): SubmissionRecord | undefined }): string {
  const judges = job.nodes.filter((n) => n.kind === "judge" && n.submissionHash);
  const judge = judges[judges.length - 1];
  const js = judge ? subs.get(judge.submissionHash!) : undefined;
  const findings = [...(js?.findings ?? [])].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  const lines = [
    `# Audit report — In re: ${job.objective.split("\n")[0].slice(0, 120)}`,
    "",
    `Matter ${job.id}. The Bench: ${job.nodes.filter((n) => n.kind === "audit").length} justices and a chief justice. Verdict: ${(js?.result as any)?.verdict === "accept" ? "Sustained" : "Overruled"}.`,
    "",
    js?.summary ? `${js.summary}\n` : "",
    findings.length ? "## Findings (worst first)" : "## Findings\n\nNone reproduced.",
  ];
  findings.forEach((f, i) => {
    lines.push("", `### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`);
    if (f.location) lines.push(`Location: ${f.location}`);
    if (f.detail) lines.push("", f.detail);
    if (f.reproduction) lines.push("", "Reproduction:", "", "```", f.reproduction, "```");
  });
  return lines.join("\n") + "\n";
}
