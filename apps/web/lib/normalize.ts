// Adapters from the control plane's wire shapes (apps/api/src/routes.ts) to the web's view types. Each accepts the
// current API shape and the older IMD-style shape the web was first written against, so either keeps rendering.
import type { Job, MediaFile, NameRecord, RuntimeInfo, Seat, Submission, Submissions, Worker } from "./types";

type O = Record<string, any>;
const iso = (v: unknown) => (typeof v === "number" ? new Date(v).toISOString() : (v as string | null) ?? null);

export function runtimeOf(v: unknown): RuntimeInfo | null {
  if (!v || typeof v !== "object") return typeof v === "string" ? { name: v, version: null, model: null, effort: null, premium: false } : null;
  const r = v as O;
  return { name: String(r.name ?? r.id ?? "unknown"), version: r.version ?? null, model: r.model ?? r.premiumModel?.model ?? null, effort: r.effort ?? r.premiumModel?.effort ?? null, premium: !!(r.premium ?? r.premiumModel) };
}

/** "Claude Code" / "Codex" from a runtime name. */
export function runtimeLabel(r?: RuntimeInfo | null) {
  if (!r) return "—";
  const n = r.name.toLowerCase();
  return n.includes("claude") ? "Claude Code" : n.includes("codex") ? "Codex" : n === "mock" ? "Mock" : r.name;
}

export function normalizeWorker(w: O): Worker {
  const runtime = runtimeOf(w.runtime ?? (Array.isArray(w.runtimes) ? w.runtimes[0] : null));
  const load = typeof w.load === "number" ? w.load : typeof w.working === "number" ? w.working : w.working ? 1 : 0;
  return {
    deviceKey: w.deviceKey,
    tokenId: String(w.tokenId),
    agentId: w.agentId ?? null,
    wallet: w.wallet,
    working: load,
    version: w.version ?? "",
    outdated: w.outdated,
    runtimes: Array.isArray(w.runtimes) ? w.runtimes.map((r: unknown) => (typeof r === "string" ? r : (r as O)?.name ?? "?")) : runtime ? [runtime.name] : [],
    runtime,
    premium: !!(w.premium ?? runtime?.premium),
    paused: !!w.paused,
    concurrency: w.concurrency,
    heartbeatAt: w.heartbeat ?? w.heartbeatAt,
  };
}

export function normalizeNames(raw: O | null): { count: number; names: NameRecord[] } | null {
  if (!raw) return null;
  const names: NameRecord[] = (raw.names ?? []).map((n: O) => ({ label: n.label, name: n.name, address: n.address ?? n.owner ?? null, url: n.url, tokenId: n.tokenId ?? null, jobId: n.jobId ?? null }));
  return { count: raw.count ?? names.length, names };
}

/** GET /seats/:tokenId. API: work rows are attempts {jobId,nodeKey,skill,state,leasedAt,finishedAt,…}; runtime is RuntimeInfo. */
export function normalizeSeat(raw: O | null): Seat | null {
  if (!raw) return null;
  if (Array.isArray(raw.runtimes) && raw.work?.[0]?.submittedAt !== undefined) return raw as Seat; // legacy shape
  const runtime = runtimeOf(raw.runtime ?? raw.runtimes?.[0]);
  const workRow = (a: O) => ({
    jobId: a.jobId,
    objective: a.objective ?? "",
    jobState: a.jobState ?? "",
    launch: null,
    nodeKey: a.nodeKey,
    role: a.role ?? a.skill ?? "work",
    submissionHash: a.submissionHash ?? `${a.jobId}:${a.nodeKey}:${a.attempt ?? 0}`,
    status: a.status ?? a.state ?? "pending",
    submittedAt: a.submittedAt ?? a.finishedAt ?? a.leasedAt,
    acceptedAt: a.acceptedAt ?? ((a.status ?? a.state) === "accepted" ? a.finishedAt : null),
    oracle: a.oracle ?? null,
  });
  return {
    tokenId: String(raw.tokenId),
    agentId: raw.agentId ?? null,
    chainId: raw.chainId ?? 0,
    collection: raw.collection ?? "",
    status: raw.status ?? (raw.owner ? "active" : "unenrolled"),
    owner: raw.owner ?? "",
    ownership: raw.ownership,
    pairedAt: raw.pairedAt ?? null,
    online: !!raw.online,
    daemonVersion: raw.daemonVersion ?? raw.version ?? null,
    runtimes: runtime ? [{ id: runtime.name, version: runtime.version ?? "", premiumModel: runtime.premium && runtime.model ? { model: runtime.model, effort: runtime.effort ?? "" } : null }] : [],
    runtime,
    lastSeenAt: raw.lastSeenAt ?? null,
    image: raw.image,
    devices: raw.devices ?? (raw.online ? 1 : 0),
    attempts: raw.attempts ?? 0,
    accepted: raw.accepted ?? 0,
    rejected: raw.rejected ?? 0,
    failed: raw.failed ?? 0,
    pending: raw.pending ?? 0,
    turns: raw.turns,
    wallClockMs: raw.wallClockMs,
    work: (raw.work ?? []).map(workRow),
    reviews: (raw.reviews ?? []).map((r: O) =>
      "verdict" in r && "policy" in r
        ? r
        : { jobId: r.jobId, nodeKey: r.nodeKey, role: r.skill ?? "review", value: r.state === "accepted" ? 1 : 0, policy: "", verdict: r.state, submissionHash: r.submissionHash ?? `${r.jobId}:${r.nodeKey}`, status: r.state, txHash: null, chainId: null, sentAt: r.finishedAt ?? null },
    ),
    collaborators: raw.collaborators ?? [],
  };
}

/** GET /jobs/:id. API: media is a file array; nodes carry `kind`. */
export function normalizeJob(raw: O | null): Job | null {
  if (!raw) return null;
  const media = Array.isArray(raw.media) ? { files: raw.media as MediaFile[] } : raw.media ?? null;
  return { ...raw, media, reviews: raw.reviews ?? [], nodes: raw.nodes ?? [], project: raw.project && !raw.project.versions ? { ...raw.project, running: null, versions: [] } : raw.project ?? null } as Job;
}

/** GET /jobs/:id/submissions. API: a plain array of submission records. */
export function normalizeSubmissions(raw: unknown, job?: Job | null): Submissions | null {
  if (!raw) return null;
  if (!Array.isArray(raw)) return raw as Submissions;
  const roleOf = new Map((job?.nodes ?? []).map((n) => [n.key, n.role]));
  const attempts = new Map<string, number>();
  const submissions: Submission[] = raw.map((s: O) => {
    const a = (attempts.get(s.nodeKey) ?? 0) + 1;
    attempts.set(s.nodeKey, a);
    const rt = runtimeOf(s.runtime);
    const u = (s.usage ?? {}) as O;
    return {
      hash: s.hash,
      nodeKey: s.nodeKey,
      role: roleOf.get(s.nodeKey) ?? (/review|audit|judge/.test(s.nodeKey) ? "review" : "implement"),
      attempt: a,
      deviceKey: s.deviceKey ?? "",
      seat: s.tokenId != null ? { tokenId: String(s.tokenId), agentId: s.agentId ?? "" } : null,
      outcome: s.accepted === true ? "accepted" : s.accepted === false ? "rejected" : "pending",
      accepted: s.accepted ?? null,
      failureReason: s.verdict?.status === "rejected" ? s.verdict.detail ?? null : null,
      usage: { model: rt?.model ?? "—", turns: u.turns ?? 0, runtime: rt ? `${rt.name}${rt.version ? ` ${rt.version}` : ""}` : "—", inputTokens: u.inputTokens ?? 0, wallClockMs: u.durationMs ?? u.wallClockMs ?? 0, outputTokens: u.outputTokens ?? 0, cachedInputTokens: u.cacheTokens ?? u.cachedInputTokens ?? 0 },
      artifacts: s.artifacts ?? [],
      changedPaths: (s.files ?? []).map((f: O) => f.path),
      summary: s.summary ?? null,
      createdAt: iso(s.createdAt) ?? "",
      verdict: s.verdict ?? null,
      findings: (s.findings ?? []).map((f: O) => ({ severity: f.severity ?? "info", title: f.title ?? f.summary ?? "finding", detail: f.detail ?? f.evidence })),
    };
  });
  return { jobId: job?.id ?? "", repoUrl: null, baseCommit: null, count: submissions.length, submissions };
}
