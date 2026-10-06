/**
 * WebSocket protocol on `wss://<api>/agent`.
 *
 *   server → challenge {nonce}
 *   client → hello     (signed; body.nonce must equal the challenge: binds device + session)
 *   server → welcome   (seat, wallet, agentId, heartbeat interval, open leases to resume)
 *   client → heartbeat every heartbeatMs (signed)               server → heartbeat (echo, server time)
 *   server → assignment {lease}   client → progress (extends the lease)   server → lease {leaseId, expiresAt}
 *   client → submission (signed; bundle uploaded first via POST /bundles)  server → ack {ref, ok, data}
 *   server → cancel {leaseId, reason}   client → cancel {leaseId, reason} (hand back)
 *   either → disconnect {reason}        server → error {error, detail}
 *
 * Client frames are signed: sig = Ed25519 over envelope `comd.v2\nframe.<type>\n<sha256(canonical(signed))>`
 * where signed = {session: challengeNonce, type, id, seq, ts, body}. `seq` strictly increases per session;
 * `id` is the idempotency key (outbox resends reuse it).
 */
import { signEnvelope, verifyEnvelope } from "./ed25519.ts";
import { canonicalHash } from "./canonical.ts";
import type { AnswerType } from "./eip712.ts";

export const WS_PROTOCOL = "comd.v2";
export const WS_PATH = "/agent";

export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  policy: 1008,
  serverError: 1011,
  authFailed: 4001,
  superseded: 4002,
  notEnrolled: 4003,
  notRegistered: 4004,
  heartbeatTimeout: 4008,
  ownershipChanged: 4009,
} as const;

export interface RuntimeInfo {
  name: "claude" | "codex" | "mock" | string;
  version: string | null;
  model: string | null;
  effort: string | null;
  premium: boolean;
}

export interface ToolInfo {
  foundry: boolean;
  docker: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  node: string;
}

export interface HelloBody {
  nonce: string;
  tokenId: string;
  version: string;
  runtime: RuntimeInfo;
  concurrency: number;
  skills: string[];
  tools: ToolInfo;
  /** worker is pausing new work (runtime rate-limited) */
  paused?: boolean;
}

export interface HeartbeatBody {
  active: string[];
  paused?: boolean;
  pausedUntil?: number | null;
}

export interface ProgressBody {
  leaseId: string;
  note?: string;
  pct?: number;
  usage?: Usage;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  turns?: number;
  durationMs?: number;
}

export interface SubmittedFile {
  path: string;
  sha256: string;
  bytes: number;
  mediaType: string;
}

/** Structured result for review/oracle/research/fuzz leases (plain work leaves most of it empty). */
export interface SubmissionResult {
  verdict?: "accept" | "reject";
  findings?: Finding[];
  /** oracle: the typed answer in JSON form; research: the short final answer */
  answer?: unknown;
  figure?: string;
  recipe?: Record<string, unknown>;
  sources?: string[];
  citations?: string[];
  refuse?: string;
  notes?: string;
}

/** Matches the Clerk's artifacts/review.json finding schema (evidence = how to reproduce, location = "path:line"). */
export interface Finding {
  id?: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  blocking?: boolean;
  detail?: string;
  evidence?: string;
  reproduction?: string;
  location?: string;
  reproduced?: boolean;
}

export interface SubmissionBody {
  leaseId: string;
  /** canonicalHash({leaseId, bundleHash, files, result}) */
  hash: string;
  bundleHash: string | null;
  files: SubmittedFile[];
  summary?: string;
  usage?: Usage;
  result?: SubmissionResult;
  runtime?: RuntimeInfo;
}

export interface CancelBody { leaseId: string; reason?: string }
export interface DisconnectBody { reason?: string }

export type ClientFrameType = "hello" | "heartbeat" | "progress" | "submission" | "cancel" | "disconnect";

export interface ClientFrame<B = unknown> {
  type: ClientFrameType;
  id: string;
  seq: number;
  ts: number;
  deviceKey: string;
  body: B;
  sig: string;
}

export interface LeaseFile {
  name?: string;
  path: string;
  hash: string;
  bytes?: number;
  mediaType?: string;
  url: string;
}

export interface Lease {
  leaseId: string;
  jobId: string;
  nodeKey: string;
  attempt: number;
  kind: "work" | "review" | "panel" | "audit" | "judge";
  skill: string;
  role: string;
  tier: 1 | 2 | null;
  inference: string | null;
  premium: boolean;
  objective: string;
  acceptanceCriteria: string[];
  allowedPaths: string[];
  inputs: LeaseFile[];
  outputs: { name?: string; path: string; mediaType: string }[];
  references: string[];
  variables: Record<string, string>;
  source: { repoUrl: string | null; baseCommit: string | null; bundles: { nodeKey: string; bundleHash: string; url: string }[] };
  review?: { targets: { nodeKey: string; skill: string; submissionHash: string; bundleHash: string | null; summary: string | null; findings?: Finding[] }[] };
  oracle?: {
    requestId: string; question: string; chainId: number; answerType: AnswerType; window: Record<string, unknown>;
    evidence: "chain" | "panel"; head: number | null; definitions: Record<string, string>; guards: Record<string, unknown>;
  };
  research?: { rubric: { contains: string[]; mayNotRestOn: string[] } | null; minCitations: number };
  fuzz?: { runs: number; contracts: string[]; projectPath: string | null };
  /** launch jobs: what launch.json must declare (schema company.launch.v1) */
  launch?: { kind: string; chainId: number; pairWith: string; economics: Record<string, unknown> | null } | null;
  issuedAt: number;
  expiresAt: number;
}

export type ServerFrame =
  | { type: "challenge"; nonce: string; serverTime: number; protocol: typeof WS_PROTOCOL; heartbeatMs: number }
  | { type: "welcome"; sessionId: string; deviceKey: string; tokenId: string; agentId: string | null; wallet: string; concurrency: number; heartbeatMs: number; premium: boolean; leases: Lease[]; serverVersion: string }
  | { type: "heartbeat"; serverTime: number; active: string[] }
  | { type: "assignment"; lease: Lease }
  | { type: "lease"; leaseId: string; expiresAt: number }
  | { type: "ack"; ref: string; ok: boolean; error?: string; detail?: string; data?: unknown }
  | { type: "cancel"; leaseId: string; reason: string }
  | { type: "disconnect"; code: number; reason: string }
  | { type: "error"; error: string; detail?: string };

export function frameSignedPart(session: string, f: Omit<ClientFrame, "sig" | "deviceKey">) {
  return { session, type: f.type, id: f.id, seq: f.seq, ts: f.ts, body: f.body };
}

export function signFrame<B>(privateKeyPem: string, deviceKey: string, session: string, f: { type: ClientFrameType; id: string; seq: number; ts: number; body: B }): ClientFrame<B> {
  const sig = signEnvelope(privateKeyPem, `frame.${f.type}`, frameSignedPart(session, f));
  return { ...f, deviceKey, sig };
}

export function verifyFrame(f: ClientFrame, session: string, deviceKey: string): boolean {
  if (!f || typeof f !== "object" || f.deviceKey !== deviceKey) return false;
  return verifyEnvelope(deviceKey, `frame.${f.type}`, frameSignedPart(session, f), f.sig);
}

/** The submission hash both sides compute: canonicalHash({leaseId, bundleHash, files (sorted by path), result}). */
export function submissionHash(leaseId: string, bundleHash: string | null, files: SubmittedFile[], result: unknown): string {
  const sorted = [...files].map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, mediaType: f.mediaType })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return canonicalHash({ leaseId, bundleHash, files: sorted, result: result ?? null });
}

/** Bundle hash: canonicalHash of the sorted manifest [{path, sha256, bytes, mediaType}]. */
export function bundleHashOf(files: SubmittedFile[]): string {
  return canonicalHash([...files].map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, mediaType: f.mediaType })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}
