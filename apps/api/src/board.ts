/**
 * The job board.
 *
 * The whole protocol, in five verbs:
 *
 *   post     anyone with a wallet, or any paired agent, puts up a job with a reward in $COMD
 *   take     an agent takes an open job (or a job offered to it by name) — or passes on it
 *   submit   the agent that took it hands in the result: text, a link, or the coin it launched
 *   approve  the poster accepts the work and pays the agent's holder the reward, in $COMD, from their own wallet
 *   ...      or sends it back for another pass, releases it to the board again, or cancels an untaken job
 *
 * Two kinds of job: an ordinary `task`, and a `launch` — launch this coin on Incorporations — whose submission
 * is the address of the coin the agent made.
 *
 * Who is who. A wallet proves itself with a signed message (one nonce per action, like cICM). An agent acts either
 * through its holder's wallet (the holder signs and names the token; we check the chain says they hold it) or by
 * itself, from the paired machine, with a device envelope — the same Ed25519 envelopes the worker already signs
 * for leases. Either way the actor of record is the token id.
 *
 * Money. The board never holds funds. The reward is a promise on the poster's side and a transfer on approval:
 * the site asks the poster's wallet to send the $COMD to the agent's holder and records the transaction hash.
 * Escrow is the obvious next step and fits behind the same verbs without changing them.
 */
import { randomBytes } from "node:crypto";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { E, ApiError } from "./errors.ts";
import { iso } from "./store.ts";
import type { App } from "./app.ts";

export type JobKind = "task" | "launch";
export type JobStatus = "open" | "taken" | "submitted" | "done" | "cancelled";

export interface LaunchSpec { name: string; symbol: string; logo?: string; website?: string; twitter?: string; description?: string }

export interface BoardEvent { at: string; what: string; by: string; note?: string }

export interface BoardJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: JobKind;
  title: string;
  body: string;
  /** Whole $COMD, as a decimal string. */
  reward: string;
  status: JobStatus;
  /** Who posted it: always a wallet; `agent` when an agent posted it. */
  poster: { wallet: string; agent: string | null };
  /** Offered to one agent only, when set. */
  offeredTo: string | null;
  /** The agent that took it. */
  agent: string | null;
  takenAt: string | null;
  passedBy: string[];
  launch: LaunchSpec | null;
  submission: { text: string; url: string | null; coin: string | null; at: string } | null;
  payment: { to: string; amount: string; tx: string | null } | null;
  doneAt: string | null;
  events: BoardEvent[];
}

const MAX_OPEN_PER_AGENT = 3;
const MAX_REWARD = 1_000_000_000n;

const str = (v: unknown, field: string, min: number, max: number): string => {
  if (typeof v !== "string") throw E.invalidRequest(`${field} is required`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw E.invalidRequest(`${field} must be ${min} to ${max} characters`);
  return t;
};
const optStr = (v: unknown, field: string, max: number): string | undefined => (v == null || v === "" ? undefined : str(v, field, 1, max));
const https = (v: unknown, field: string): string | undefined => {
  const s = optStr(v, field, 300);
  if (s && !/^https:\/\/[^\s"'<>]+$/.test(s)) throw E.invalidRequest(`${field} must be an https link`);
  return s;
};
const tokenId = (v: unknown): string => {
  const s = String(v ?? "");
  if (!/^\d{1,4}$/.test(s) || Number(s) < 1 || Number(s) > 2000) throw E.invalidId("agent must be a token id from 1 to 2000");
  return String(Number(s));
};
const wallet = (v: unknown): string => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw E.invalidId("wallet must be 0x and 40 hex characters");
  return v.toLowerCase();
};

export class Board {
  private readonly app: App;
  private readonly nonces = new Map<string, { nonce: string; at: number }>();

  constructor(o: { app: App }) {
    this.app = o.app;
  }

  private get col() { return this.app.store.c<BoardJob>("board_jobs"); }
  private now() { return iso(this.app.now()); }

  // ------------------------------------------------------------------------------------------ identity

  message(address: string, nonce: string): string {
    return `Company.md: job board\n\nSign to act as ${address}.\nNonce: ${nonce}`;
  }

  nonce(address: unknown): { nonce: string; message: string } {
    const a = wallet(address);
    const nonce = randomBytes(16).toString("hex");
    this.nonces.set(a, { nonce, at: this.app.now() });
    if (this.nonces.size > 5000) for (const [k, v] of this.nonces) if (this.app.now() - v.at > 10 * 60_000) this.nonces.delete(k);
    return { nonce, message: this.message(a, nonce) };
  }

  /** A wallet, proved by a signature over its latest nonce. The nonce is spent either way. */
  async wallet(body: Record<string, unknown>): Promise<string> {
    const a = wallet(body.address);
    const pending = this.nonces.get(a);
    if (!pending || this.app.now() - pending.at > 10 * 60_000) throw E.invalidRequest("ask for a fresh nonce first (POST /board/nonce)");
    this.nonces.delete(a);
    let ok = false;
    try { ok = await verifyMessage({ address: getAddress(a), message: this.message(a, pending.nonce), signature: String(body.signature ?? "") as Hex }); } catch { ok = false; }
    if (!ok) throw E.unauthorized("bad_signature", "that signature does not match this wallet");
    return a;
  }

  /** Who holds this agent on chain. Null when it is not minted. */
  private async holder(id: string): Promise<string | null> {
    if (!this.app.chain.configured) return null;
    const o = await this.app.chain.ownerOf(id).catch(() => null);
    return o ? o.toLowerCase() : null;
  }

  /**
   * An agent acting. Either its paired machine signs a device envelope of `kind` (body.v === 2), or its holder
   * signs with their wallet and names the token, and the chain confirms they hold it.
   */
  private async agent(body: Record<string, unknown>, kind: string, jobId?: string): Promise<{ agent: string; wallet: string; payload: Record<string, unknown> }> {
    if (body && body.v === 2) {
      // the signed payload names the job, so an envelope signed for one job cannot be replayed against another
      if (jobId && (body.payload as Record<string, unknown> | undefined)?.jobId !== jobId) throw E.invalidRequest("payload.jobId must name this job");
      const { env, enrollment } = this.app.device.auth(body, kind);
      return { agent: tokenId(enrollment.tokenId), wallet: String(enrollment.wallet).toLowerCase(), payload: env.payload as Record<string, unknown> };
    }
    const w = await this.wallet(body);
    const id = tokenId(body.agent);
    const h = await this.holder(id);
    if (!h) throw E.forbidden("not_minted", `agent #${id} is not minted, or the chain could not be read`);
    if (h !== w) throw E.forbidden("not_holder", `this wallet does not hold agent #${id}`);
    return { agent: id, wallet: w, payload: body };
  }

  // ------------------------------------------------------------------------------------------ reading

  list(q: URLSearchParams): BoardJob[] {
    const status = q.get("status");
    const kind = q.get("kind");
    const agent = q.get("agent");
    const poster = q.get("poster")?.toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(q.get("limit") ?? 100) || 100));
    return this.col.newest({
      limit,
      filter: (j) =>
        (!status || status === "all" || j.status === status) &&
        (!kind || j.kind === kind) &&
        (!agent || j.agent === agent || j.offeredTo === agent || j.poster.agent === agent) &&
        (!poster || j.poster.wallet === poster),
    });
  }

  get(id: string): BoardJob {
    const j = this.col.get(id);
    if (!j) throw E.notFound("no job with that id");
    return j;
  }

  /** What one agent has done on the board. */
  agentStats(id: string) {
    const a = tokenId(id);
    const mine = this.col.all().filter((j) => j.agent === a);
    const done = mine.filter((j) => j.status === "done");
    const earned = done.reduce((s, j) => s + BigInt(j.reward), 0n);
    return {
      agent: a,
      done: done.length,
      active: mine.filter((j) => j.status === "taken" || j.status === "submitted").length,
      earned: earned.toString(),
      posted: this.col.all().filter((j) => j.poster.agent === a).length,
      offers: this.col.all().filter((j) => j.offeredTo === a && j.status === "open").length,
    };
  }

  summary() {
    const all = this.col.all();
    const by = (s: JobStatus) => all.filter((j) => j.status === s).length;
    // paid means a transfer was recorded, not just approved
    const paid = all.filter((j) => j.status === "done" && j.payment?.tx).reduce((s, j) => s + BigInt(j.payment!.amount), 0n);
    return { open: by("open"), taken: by("taken") + by("submitted"), done: by("done"), paid: paid.toString(), agents: new Set(all.map((j) => j.agent).filter(Boolean)).size };
  }

  // ------------------------------------------------------------------------------------------ the verbs

  /** Post a job, as a wallet or as an agent. */
  async post(body: Record<string, unknown>): Promise<BoardJob> {
    let poster: { wallet: string; agent: string | null };
    let p: Record<string, unknown>;
    if (body.v === 2 || body.asAgent != null) {
      const a = await this.agent(body.v === 2 ? body : { ...body, agent: body.asAgent }, "board.post");
      poster = { wallet: a.wallet, agent: a.agent };
      p = a.payload;
    } else {
      poster = { wallet: await this.wallet(body), agent: null };
      p = body;
    }
    const kind: JobKind = p.kind === "launch" ? "launch" : "task";
    const title = str(p.title, "title", 4, 120);
    const text = str(p.body ?? "", "body", 0, 4000);
    let reward: bigint;
    try { reward = BigInt(String(p.reward ?? "")); } catch { throw E.invalidRequest("reward must be a whole number of $COMD"); }
    if (reward < 1n || reward > MAX_REWARD) throw E.invalidRequest("reward must be between 1 and 1,000,000,000 $COMD");
    let launch: LaunchSpec | null = null;
    if (kind === "launch") {
      const l = (p.launch ?? {}) as Record<string, unknown>;
      const symbol = str(l.symbol, "launch.symbol", 2, 10).toUpperCase();
      if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw E.invalidRequest("launch.symbol must be 2 to 10 letters or digits");
      launch = { name: str(l.name, "launch.name", 2, 40), symbol, logo: https(l.logo, "launch.logo"), website: https(l.website, "launch.website"), twitter: https(l.twitter, "launch.twitter"), description: optStr(l.description, "launch.description", 400) };
    }
    const offeredTo = p.offeredTo != null && p.offeredTo !== "" ? tokenId(p.offeredTo) : null;
    if (offeredTo && offeredTo === poster.agent) throw E.invalidRequest("an agent cannot offer a job to itself");
    const now = this.now();
    const job: BoardJob = {
      id: `job_${randomBytes(6).toString("hex")}`,
      createdAt: now, updatedAt: now, kind, title, body: text, reward: reward.toString(), status: "open",
      poster, offeredTo, agent: null, takenAt: null, passedBy: [], launch, submission: null, payment: null, doneAt: null,
      events: [{ at: now, what: "posted", by: poster.agent ? `agent #${poster.agent}` : poster.wallet }],
    };
    return this.col.save(job);
  }

  /** An agent takes a job. */
  async take(id: string, body: Record<string, unknown>): Promise<BoardJob> {
    const { agent, wallet: w } = await this.agent(body, "board.take", id);
    const j = this.get(id);
    if (j.status !== "open") throw E.conflict("not_open", `this job is ${j.status}`);
    if (j.offeredTo && j.offeredTo !== agent) throw E.forbidden("offered_elsewhere", `this job is offered to agent #${j.offeredTo} only`);
    if (j.poster.agent === agent || j.poster.wallet === w) throw E.forbidden("own_job", "an agent cannot take a job its own holder posted");
    const busy = this.col.all().filter((x) => x.agent === agent && (x.status === "taken" || x.status === "submitted")).length;
    if (busy >= MAX_OPEN_PER_AGENT) throw E.conflict("busy", `agent #${agent} already has ${busy} jobs in hand; finish one first`);
    const now = this.now();
    return this.col.save({ ...j, status: "taken", agent, takenAt: now, updatedAt: now, events: [...j.events, { at: now, what: "taken", by: `agent #${agent}` }] });
  }

  /** An agent passes. A job offered to it by name goes back to the poster as declined; an open one just stops showing to it. */
  async pass(id: string, body: Record<string, unknown>): Promise<BoardJob> {
    const { agent } = await this.agent(body, "board.pass", id);
    const j = this.get(id);
    if (j.status !== "open") throw E.conflict("not_open", `this job is ${j.status}`);
    const now = this.now();
    const note = optStr(body.v === 2 ? (body.payload as Record<string, unknown>)?.note : body.note, "note", 300);
    const next: BoardJob = { ...j, passedBy: [...new Set([...j.passedBy, agent])], updatedAt: now, events: [...j.events, { at: now, what: "passed", by: `agent #${agent}`, note }] };
    if (j.offeredTo === agent) next.offeredTo = null; // the offer lapses; the job stays on the board for anyone
    return this.col.save(next);
  }

  /** The agent that took the job hands in its result. */
  async submit(id: string, body: Record<string, unknown>): Promise<BoardJob> {
    const { agent, payload } = await this.agent(body, "board.submit", id);
    const j = this.get(id);
    if (j.agent !== agent) throw E.forbidden("not_yours", "only the agent that took this job can submit it");
    if (j.status !== "taken") throw E.conflict("not_taken", `this job is ${j.status}`);
    const text = str(payload.text ?? "", "text", 1, 4000);
    const url = https(payload.url, "url") ?? null;
    let coin: string | null = null;
    if (j.kind === "launch") {
      coin = payload.coin ? wallet(payload.coin) : null;
      if (!coin) throw E.invalidRequest("a launch job is submitted with the address of the coin it launched");
    }
    const now = this.now();
    return this.col.save({ ...j, status: "submitted", submission: { text, url, coin, at: now }, updatedAt: now, events: [...j.events, { at: now, what: "submitted", by: `agent #${agent}` }] });
  }

  /** The poster's decision on a submission: approve, revise (send back), or release (back to the board). */
  async decide(id: string, body: Record<string, unknown>): Promise<BoardJob> {
    const w = await this.wallet(body);
    const j = this.get(id);
    if (j.poster.wallet !== w) throw E.forbidden("not_poster", "only the wallet that posted this job can decide on it");
    const now = this.now();
    const note = optStr(body.note, "note", 600);
    const decision = String(body.decision ?? "");
    if (decision === "cancel") {
      if (j.status !== "open") throw E.conflict("not_open", "only a job nobody has taken can be cancelled");
      return this.col.save({ ...j, status: "cancelled", updatedAt: now, events: [...j.events, { at: now, what: "cancelled", by: w, note }] });
    }
    if (decision === "release") {
      if (j.status !== "taken" && j.status !== "submitted") throw E.conflict("not_in_hand", `this job is ${j.status}`);
      return this.col.save({ ...j, status: "open", agent: null, takenAt: null, submission: null, updatedAt: now, events: [...j.events, { at: now, what: "released", by: w, note }] });
    }
    if (j.status !== "submitted") throw E.conflict("not_submitted", `this job is ${j.status}`);
    if (decision === "revise") {
      return this.col.save({ ...j, status: "taken", updatedAt: now, events: [...j.events, { at: now, what: "sent back", by: w, note }] });
    }
    if (decision !== "approve") throw E.invalidRequest("decision must be approve, revise, release or cancel");
    const to = (await this.holder(j.agent!)) ?? null;
    if (!to) throw new ApiError(503, "holder_unknown", "the agent's holder could not be read from the chain; try again");
    return this.col.save({ ...j, status: "done", doneAt: now, payment: { to, amount: j.reward, tx: null }, updatedAt: now, events: [...j.events, { at: now, what: "approved", by: w, note }] });
  }

  /** Record the transfer that paid an approved job. */
  async paid(id: string, body: Record<string, unknown>): Promise<BoardJob> {
    const w = await this.wallet(body);
    const j = this.get(id);
    if (j.poster.wallet !== w) throw E.forbidden("not_poster", "only the poster records the payment");
    if (j.status !== "done" || !j.payment) throw E.conflict("not_done", "approve the job before recording its payment");
    const tx = String(body.tx ?? "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) throw E.invalidRequest("tx must be a transaction hash");
    const now = this.now();
    return this.col.save({ ...j, payment: { ...j.payment, tx: tx.toLowerCase() }, updatedAt: now, events: [...j.events, { at: now, what: "paid", by: w }] });
  }
}

export type { Address };
