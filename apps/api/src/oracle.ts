/**
 * Rulings (oracle). A request pins its block window at quote time, opens a panel job of `panelSize` oracle-assess
 * members (one per wallet), and closes when `quorum` members give the same answer (uint256 answers may differ by
 * toleranceBps; list answers compare their first `head` entries). Then:
 *
 *   evidence=chain  the attester re-runs the agreed recipe against the pinned window (eth-call | log-count |
 *                   balance) and attests only if the chain reproduces the answer (else `mismatch`)
 *   evidence=panel  the panel's agreement is the evidence
 *
 * The attestation is EIP-712 OracleAttestation, domain {name "Company.md Oracle", version "1", chainId} with NO
 * verifyingContract — exactly contracts/src/oracle/OracleAttestationVerifier.sol; domain chainId = the consumer's
 * chain (`consumer.chainId`, default the question's chain). Signed with ATTESTER_PRIVATE_KEY. issuedAt is backdated
 * 60 s so a consumer can verify it in the next block even when block timestamps lag the attester's clock.
 * Statuses: assessing → reproducing → attested | disagreed | blocked | mismatch | refused | failed.
 */
import { randomUUID } from "node:crypto";
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import {
  canonicalHash, encodeAnswer, oracleAttestationTypedData, oracleDomain, questionHash, typedDataJson, uuidToBytes32,
  type AnswerType, type JobNode, type OracleBody, type SubmissionRecord,
} from "@company/protocol";
import type { App } from "./app.ts";
import type { JobX } from "./engine.ts";
import type { OracleRecord } from "./records.ts";
import { iso } from "./store.ts";
import { planOracle } from "./planner.ts";
import { decodeWord, ChainUnavailable, redactRpc } from "./chain.ts";
import { E } from "./errors.ts";

const HEXADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export class Oracle {
  private readonly app: App;
  constructor(app: App) { this.app = app; }

  private get reqs() { return this.app.store.c<OracleRecord>("oracle"); }

  /** Pin `{hours}` or `{fromBlock,toBlock}` to concrete blocks (done at quote time). */
  async pinWindow(body: OracleBody): Promise<{ fromBlock: number; toBlock: number; toBlockHash: Hex }> {
    const chain = this.app.chainFor(body.chainId);
    if (!chain) throw E.unavailable("chain_unavailable", `no RPC for chain ${body.chainId}`);
    try {
      const w = body.window as any;
      if (w.toBlockHash && Number.isInteger(w.fromBlock)) return { fromBlock: w.fromBlock, toBlock: w.toBlock, toBlockHash: w.toBlockHash };
      const latest = await chain.block("latest");
      if (w.hours !== undefined) {
        const back = Math.min(latest.number, 1000);
        const older = back > 0 ? await chain.block(latest.number - back) : latest;
        const bt = back > 0 ? Math.max(0.05, (latest.timestamp - older.timestamp) / back) : 1;
        return { fromBlock: Math.max(0, latest.number - Math.ceil((w.hours * 3600) / bt)), toBlock: latest.number, toBlockHash: latest.hash };
      }
      if (w.toBlock > latest.number) throw E.invalidInput([{ path: "window.toBlock", code: "future", message: `toBlock is after the head (${latest.number})` }]);
      const b = await chain.block(w.toBlock);
      return { fromBlock: w.fromBlock, toBlock: w.toBlock, toBlockHash: b.hash };
    } catch (e) {
      if (e instanceof ChainUnavailable || /fetch|timeout|ECONN|RPC/i.test((e as Error).message)) throw E.unavailable("chain_unavailable", redactRpc((e as Error).message));
      throw e;
    }
  }

  /** Admit an oracle.request (window already pinned in body.window). */
  open(body: OracleBody, meta: { paidBy: Address | null; orderId?: string | null; scheduleId?: string | null }) {
    const now = this.app.now();
    const id = randomUUID();
    const w = body.window as any;
    const req: OracleRecord = {
      id,
      createdAt: iso(now),
      updatedAt: iso(now),
      status: "assessing",
      question: body.question,
      questionHash: questionHash(body.question),
      chainId: body.chainId,
      window: { fromBlock: w.fromBlock, toBlock: w.toBlock, toBlockHash: w.toBlockHash },
      answerType: body.answerType,
      evidence: body.evidence ?? "chain",
      panelSize: body.panelSize,
      quorum: body.quorum,
      toleranceBps: body.toleranceBps ?? 0,
      head: body.head ?? null,
      validForSeconds: body.validForSeconds,
      definitions: body.definitions ?? {},
      guards: body.guards ?? {},
      consumer: body.consumer ?? null,
      recipe: (body.recipe as Record<string, unknown>) ?? null,
      input: body,
      jobId: "",
      paidBy: meta.paidBy ? (meta.paidBy.toLowerCase() as Address) : null,
      scheduleId: meta.scheduleId ?? null,
      members: [],
      agreement: null,
      computed: null,
      attestation: null,
      signature: null,
      signer: null,
      failure: null,
      attempts: 0,
      attestedAt: null,
    };
    this.reqs.save(req);
    const job = this.app.engine.admitJob({ objective: `Ruling: ${body.question}`, github: false } as any, {
      paidBy: meta.paidBy, orderId: meta.orderId, createdBy: meta.scheduleId ? "schedule" : "request", scheduleId: meta.scheduleId,
      plan: planOracle(body, this.app.skills), oracleRequestId: id,
    });
    req.jobId = job.id;
    this.reqs.save(req);
    this.app.event("oracle.opened", { requestId: id, jobId: job.id, panelSize: req.panelSize, quorum: req.quorum, evidence: req.evidence });
    return { request: req, job };
  }

  /** Structural check of a member's typed answer (or a refusal). */
  answerProblem(requestId: string, r: Record<string, any>): string | null {
    const req = this.reqs.get(requestId);
    if (!req) return "unknown request";
    if (typeof r.refuse === "string" && r.refuse.trim()) return null;
    if (r.answer === undefined) return `answer (${req.answerType}) or refuse is required`;
    if (!validAnswer(req.answerType, r.answer)) return `answer is not a valid ${req.answerType}`;
    if (req.evidence === "chain" && !req.recipe && (!r.recipe || (typeof r.recipe.kind !== "string" && !Array.isArray(r.recipe.steps)))) return "evidence=chain needs a recipe that reproduces the answer";
    const g = req.guards;
    if (g.sources && Array.isArray(r.sources)) {
      const ok = r.sources.filter((s: unknown) => typeof s === "string" && g.sources!.some((p) => s.startsWith(p)));
      if (g.minSources && new Set(ok.map((s: string) => new URL(s).host)).size < g.minSources) return `needs ${g.minSources} distinct sources from the allowed prefixes`;
    }
    return null;
  }

  onMember(job: JobX, node: JobNode, sub: SubmissionRecord) {
    const req = this.reqs.get(job.oracleRequestId!);
    if (!req) return;
    const r = (sub.result ?? {}) as Record<string, any>;
    req.members.push({
      nodeKey: node.key,
      tokenId: sub.tokenId,
      wallet: sub.wallet,
      submissionHash: sub.hash,
      answer: r.refuse ? null : normalizeAnswer(req.answerType, r.answer),
      figure: typeof r.figure === "string" ? r.figure : null,
      refuse: typeof r.refuse === "string" ? r.refuse.slice(0, 500) : null,
      recipe: r.recipe ?? null,
      sources: Array.isArray(r.sources) ? r.sources.slice(0, 32).map(String) : [],
      at: sub.createdAt,
    });
    req.updatedAt = iso(this.app.now());
    this.reqs.save(req);
    this.evaluate(job);
  }

  evaluate(job: JobX) {
    const req = this.reqs.get(job.oracleRequestId!);
    if (!req || req.status !== "assessing") return;
    const panel = job.nodes.filter((n) => n.kind === "panel");
    const pending = panel.filter((n) => !["accepted", "failed", "skipped", "cancelled"].includes(n.state)).length;
    const answered = req.members.filter((m) => !m.refuse);
    const refusals = req.members.filter((m) => m.refuse).length;
    const clusters = cluster(req, answered);
    const best = clusters[0] ?? [];
    if (best.length >= req.quorum) {
      const answer = agreedAnswer(req, best);
      const recipes = new Map<string, { recipe: unknown; n: number }>();
      for (const m of best) if (m.recipe) { const k = canonicalHash(m.recipe); recipes.set(k, { recipe: m.recipe, n: (recipes.get(k)?.n ?? 0) + 1 }); }
      const top = [...recipes.values()].sort((a, b) => b.n - a.n)[0];
      req.agreement = {
        agreed: best.length,
        answer,
        figure: figureOf(req.answerType, answer),
        quorum: req.quorum,
        recipe: req.recipe ?? top?.recipe ?? { kind: "panel" },
        cluster: best.map((m) => m.submissionHash),
        sources: [...new Set(best.flatMap((m) => m.sources.map((s) => { try { return new URL(s).host; } catch { return s; } })))],
        definitions: req.definitions,
        recipeMembers: top?.n ?? 0,
      };
      req.status = "reproducing";
      req.updatedAt = iso(this.app.now());
      for (const n of panel) if (!["accepted", "failed", "skipped"].includes(n.state)) this.app.engine.skipNode(n as any, "panel agreed");
      this.app.store.c("jobs").save(job as any);
      this.reqs.save(req);
      this.app.event("oracle.agreed", { requestId: req.id, agreed: best.length, quorum: req.quorum, answer });
      this.app.track(this.reproduceAndAttest(req.id));
      return;
    }
    let terminal: OracleRecord["status"] | null = null;
    let why = "";
    if (refusals > req.panelSize - req.quorum) { terminal = "refused"; why = `${refusals} members refused the question as worded`; }
    else if (best.length + pending < req.quorum) {
      if (req.members.length === 0) { terminal = "failed"; why = "no member answered"; }
      else { terminal = "disagreed"; why = `no ${req.quorum} matching answers (largest group ${best.length})`; }
    }
    if (terminal) this.finish(req, job, terminal, why);
  }

  private finish(req: OracleRecord, job: JobX, status: OracleRecord["status"], failure: string | null) {
    req.status = status;
    req.failure = failure;
    req.updatedAt = iso(this.app.now());
    this.reqs.save(req);
    this.app.event(`oracle.${status}`, { requestId: req.id, failure });
    if (status === "attested") this.app.engine.finishJob(job, "completed");
    else this.app.engine.finishJob(job, "blocked", `oracle ${status}: ${failure}`);
  }

  private async reproduceAndAttest(id: string) {
    const req = this.reqs.get(id)!;
    const job = this.app.store.c<JobX>("jobs").get(req.jobId)!;
    try {
      const agreed = req.agreement!.answer;
      const guard = await this.guardProblem(req, agreed);
      if (guard) return this.finish(req, job, "blocked", guard);
      if (req.evidence === "chain") {
        const recipe = req.agreement!.recipe as Record<string, any>;
        const computed = await this.runRecipe(req, recipe);
        if (computed === undefined) return this.finish(req, job, "failed", `recipe ${String(recipe?.kind)} cannot be reproduced by this attester`);
        req.computed = { answer: computed, figure: figureOf(req.answerType, computed) };
        if (!sameAnswer(req, computed, agreed)) {
          this.reqs.save(req);
          return this.finish(req, job, "mismatch", `chain gives ${JSON.stringify(computed)}, panel agreed ${JSON.stringify(agreed)}`);
        }
      } else {
        req.computed = { answer: agreed, figure: figureOf(req.answerType, agreed) };
      }
      await this.attest(req);
      this.finish(req, job, "attested", null);
    } catch (e) {
      req.attempts++;
      this.reqs.save(req);
      this.finish(req, job, "failed", (e as Error).message);
    }
  }

  private async guardProblem(req: OracleRecord, answer: unknown): Promise<string | null> {
    const g = req.guards;
    const items = Array.isArray(answer) ? answer.map(String) : [String(answer)];
    if (g.allow && items.some((x) => !g.allow!.map((a) => a.toLowerCase()).includes(x.toLowerCase()))) return "answer is outside guards.allow";
    if (g.deny && items.some((x) => g.deny!.map((a) => a.toLowerCase()).includes(x.toLowerCase()))) return "answer is in guards.deny";
    if (req.answerType === "uint256") {
      if (g.min && BigInt(String(answer)) < BigInt(g.min)) return "answer below guards.min";
      if (g.max && BigInt(String(answer)) > BigInt(g.max)) return "answer above guards.max";
    }
    if (g.mustHaveCode && (req.answerType === "address" || req.answerType === "address[]")) {
      const chain = this.app.chainFor(req.chainId);
      if (!chain) return "cannot check guards.mustHaveCode: no RPC";
      for (const a of items) if ((await chain.getCode(a as Address)) === "0x") return `answer ${a} has no code`;
    }
    return null;
  }

  /** Reproduce simple recipes on chain at the pinned window. Returns undefined for unsupported recipes. */
  async runRecipe(req: OracleRecord, recipeIn: Record<string, any>): Promise<unknown> {
    // the Clerk's answer.json carries recipe.steps; a single supported step is reproducible here
    const recipe = recipeIn?.kind && recipeIn.kind !== "steps" ? recipeIn : Array.isArray(recipeIn?.steps) && recipeIn.steps.length === 1 ? recipeIn.steps[0] : recipeIn;
    const chain = this.app.chainFor(req.chainId);
    if (!chain) throw new Error(`no RPC for chain ${req.chainId}`);
    const at = recipe.block === "from" ? req.window.fromBlock : req.window.toBlock;
    switch (recipe.kind) {
      case "eth-call":
      case "call": {
        if (!HEXADDR.test(recipe.to) || typeof recipe.data !== "string") throw new Error("eth-call recipe needs to and data");
        const raw = await chain.call(getAddress(recipe.to), recipe.data as Hex, at);
        const as = recipe.decode ?? (req.answerType === "bool" ? "bool" : req.answerType === "address" ? "address" : req.answerType === "bytes32" ? "bytes32" : "uint256");
        return normalizeAnswer(req.answerType, decodeWord(raw, as));
      }
      case "log-count": {
        if (!HEXADDR.test(recipe.address)) throw new Error("log-count recipe needs address");
        return String(await chain.logCount(getAddress(recipe.address), (recipe.topics ?? []) as (Hex | null)[], req.window.fromBlock, req.window.toBlock));
      }
      case "balance": {
        if (!HEXADDR.test(recipe.address)) throw new Error("balance recipe needs address");
        return (await chain.balance(getAddress(recipe.address), at)).toString();
      }
      default:
        return undefined;
    }
  }

  private async attest(req: OracleRecord) {
    const now = Math.floor(this.app.now() / 1000);
    const computed = req.computed!.answer;
    const message = {
      requestId: uuidToBytes32(req.id),
      chainId: req.chainId,
      questionHash: req.questionHash,
      answerType: req.answerType,
      answer: encodeAnswer(req.answerType, computed),
      figure: figureOf(req.answerType, computed) ?? "0",
      fromBlock: req.window.fromBlock,
      toBlock: req.window.toBlock,
      blockHash: req.window.toBlockHash,
      panelJobId: uuidToBytes32(req.jobId),
      issuedAt: now - 60,
      expiresAt: now + req.validForSeconds,
    };
    const domain = oracleDomain(req.consumer?.chainId ?? req.chainId);
    const td = oracleAttestationTypedData(message, domain);
    const { signature, signer } = await this.app.services.attestOracle({ typedData: td });
    req.attestation = message;
    req.signature = signature;
    req.signer = signer;
    req.attestedAt = iso(this.app.now());
    this.reqs.save(req);
  }

  attestationView(req: OracleRecord) {
    if (req.status !== "attested" || !req.attestation) return null;
    const td = oracleAttestationTypedData(req.attestation, oracleDomain(req.consumer?.chainId ?? req.chainId));
    const j = typedDataJson(td);
    // `tuple`: the OracleAttestationVerifier.OracleAttestation struct, field order as in Solidity, ready for submit(a, sig)
    const a = req.attestation;
    const tuple = [a.requestId, String(a.chainId), a.questionHash, a.answerType, a.answer, String(a.figure), String(a.fromBlock), String(a.toBlock), a.blockHash, a.panelJobId, String(a.issuedAt), String(a.expiresAt)];
    return { requestId: req.id, domain: j.domain, types: j.types, primaryType: j.primaryType, message: req.attestation, tuple, signature: req.signature, signer: req.signer, attestedAt: req.attestedAt, verifier: "contracts/src/oracle/OracleAttestationVerifier.sol" };
  }

  view(req: OracleRecord, membersQ: string | null) {
    const members = membersQ === "0" ? [] : membersQ ? req.members.filter((m) => m.submissionHash === membersQ) : req.members;
    const { input: _i, paidBy: _p, recipe: _r, ...rest } = req;
    return { ...rest, members, url: `/oracle/requests/${req.id}`, jobUrl: `/jobs/${req.jobId}` };
  }

  listItem(req: OracleRecord) {
    return {
      id: req.id, status: req.status, question: req.question.length > 300 ? `${req.question.slice(0, 300)}...` : req.question, chainId: req.chainId, window: req.window,
      answerType: req.answerType, panelSize: req.panelSize, quorum: req.quorum, jobId: req.jobId, signer: req.signer, attestedAt: req.attestedAt, createdAt: req.createdAt, updatedAt: req.updatedAt,
    };
  }

  /** v4 pool ids mentioned by the request, resolved against launches this control plane deployed. */
  pools(req: OracleRecord) {
    const text = [req.question, ...Object.values(req.definitions), JSON.stringify(req.computed?.answer ?? req.agreement?.answer ?? null)].join(" ");
    const ids = [...new Set((text.match(/0x[0-9a-fA-F]{64}/g) ?? []).map((x) => x.toLowerCase()))];
    const launches = this.app.store.c<any>("launches").all();
    return {
      requestId: req.id,
      pools: ids.map((poolId) => {
        const l = launches.find((x: any) => x.poolId?.toLowerCase() === poolId);
        return l
          ? { poolId, resolved: true, currency0: "0x0000000000000000000000000000000000000000", currency1: l.token, fee: 3000, hooks: l.artifacts.find((a: any) => a.role === "hook")?.address ?? null, launchId: l.id }
          : { poolId, resolved: false };
      }),
    };
  }
}

// ------------------------------------------------------------------------------------------ answers

export function validAnswer(t: AnswerType, a: unknown): boolean {
  switch (t) {
    case "bool": return typeof a === "boolean";
    case "address": return typeof a === "string" && HEXADDR.test(a);
    case "bytes32": return typeof a === "string" && HEX32.test(a);
    case "uint256": return (typeof a === "string" && /^[0-9]{1,78}$/.test(a)) || (typeof a === "number" && Number.isSafeInteger(a) && a >= 0);
    case "address[]": return Array.isArray(a) && a.length <= 100 && a.every((x) => typeof x === "string" && HEXADDR.test(x));
    case "bytes32[]": return Array.isArray(a) && a.length <= 100 && a.every((x) => typeof x === "string" && HEX32.test(x));
  }
}

export function normalizeAnswer(t: AnswerType, a: unknown): unknown {
  if (t === "uint256") return BigInt(String(a)).toString();
  if (t === "address" || t === "bytes32") return String(a).toLowerCase();
  if (t === "address[]" || t === "bytes32[]") return (a as string[]).map((x) => x.toLowerCase());
  return a;
}

function key(req: OracleRecord, a: unknown): string {
  if (Array.isArray(a)) return JSON.stringify(req.head ? a.slice(0, req.head) : a);
  return JSON.stringify(a);
}

type Member = OracleRecord["members"][number];

/** Groups of members whose answers match; largest first. */
export function cluster(req: OracleRecord, members: Member[]): Member[][] {
  if (req.answerType === "uint256" && req.toleranceBps > 0) {
    let best: Member[][] = [];
    for (const anchor of members) {
      const a = BigInt(String(anchor.answer));
      const tol = (a * BigInt(req.toleranceBps)) / 10_000n;
      const group = members.filter((m) => { const x = BigInt(String(m.answer)); return (x > a ? x - a : a - x) <= tol; });
      best.push(group);
    }
    best = best.sort((x, y) => y.length - x.length);
    return best;
  }
  const map = new Map<string, Member[]>();
  for (const m of members) map.set(key(req, m.answer), [...(map.get(key(req, m.answer)) ?? []), m]);
  return [...map.values()].sort((a, b) => b.length - a.length);
}

function agreedAnswer(req: OracleRecord, group: Member[]): unknown {
  if (req.answerType === "uint256") {
    const xs = group.map((m) => BigInt(String(m.answer))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return xs[Math.floor((xs.length - 1) / 2)].toString();
  }
  return group[0].answer;
}

export function sameAnswer(req: OracleRecord, a: unknown, b: unknown): boolean {
  if (req.answerType === "uint256") {
    const x = BigInt(String(a)), y = BigInt(String(b));
    const tol = (y * BigInt(req.toleranceBps)) / 10_000n;
    return (x > y ? x - y : y - x) <= tol;
  }
  return key(req, a) === key(req, b);
}

export function figureOf(t: AnswerType, a: unknown): string | null {
  if (a === null || a === undefined) return null;
  if (t === "uint256") return String(a);
  if (t === "bool") return a ? "1" : "0";
  if (Array.isArray(a)) return String(a.length);
  return "0";
}

export { keccak256, toHex };
