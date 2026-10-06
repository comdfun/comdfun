/**
 * Paid requests: x402 v2 (scheme exact, Permit2) in $COMD (Pons's token; decimals read on chain, 18 expected; PRICE_COMD per action, default 100 COMD),
 * as IMD's flow. payTo = RevenueRouter (50% of what it receives is burned, 50% goes to Counsel rewards).
 *
 *   POST /requests/quote        Bearer token (32 random bytes, hex) + requestKey idempotency → 201 order (quoted)
 *   POST /requests/:id/submit   no PAYMENT-SIGNATURE → 402 challenge (body + PAYMENT-REQUIRED header)
 *                               with PAYMENT-SIGNATURE + {quoteSignature} → verify → settle → admit → 200 (or 202)
 *   GET  /requests/:id          Bearer → status;   GET /requests/paid-by/:address → public summary
 *
 * Order statuses: quoted → payment_pending → admission_pending → admitted | payment_failed | expired.
 */
import { createHash, randomUUID } from "node:crypto";
import { getAddress, type Address } from "viem";
import {
  ACTIONS, BEARER_RE, CHAINS, LIMITS, PAYMENT_MAX_TIMEOUT_SECONDS, QUOTE_MIN_REMAINING_SECONDS, QUOTE_TTL_SECONDS, UUID_RE,
  WITNESS_TYPE_STRING, canonicalHash, encodeHeaderJson, networkOf, parsePaymentSignatureHeader, paymentHash, quoteApprovalTypedData,
  recoverTypedSigner, sameRequirements, type Action, type AdmissionResult, type JobBody, type OracleBody, type PaymentRequired,
  type PaymentRequirements, type Problem, type Quote, type ScheduleBody, type WorkflowBody,
} from "@company/protocol";
import type { App } from "./app.ts";
import { ApiError, E } from "./errors.ts";
import type { JobX } from "./engine.ts";
import type { OrderRecord, ScheduleRecord } from "./records.ts";
import { iso } from "./store.ts";
import { validateJobBody, validateOracleBody, validateScheduleBody, validateTopup, validateWorkflowBody, type JobCheckOpts } from "./validate.ts";
import { describePlan, planJob, planOracle } from "./planner.ts";
import { permit2SignerOk } from "./payments.ts";
import { parseCadence } from "./cadence.ts";
import type { Req, Res } from "./http.ts";

export function scopeHashOf(token: string): string {
  return createHash("sha256").update(`company.requester.v1:${token.toLowerCase()}`).digest("hex");
}

export class Requests {
  private readonly app: App;
  private readonly inflight = new Set<string>();
  constructor(app: App) { this.app = app; }
  private get orders() { return this.app.store.c<OrderRecord>("orders"); }

  // ------------------------------------------------------------------------------------------ capabilities

  payment() {
    const c = this.app.cfg;
    return { network: networkOf(c.chainId), asset: c.comd.toLowerCase() as Address, amount: c.priceComd, payTo: c.payTo.toLowerCase() as Address, decimals: this.app.comdDecimals, symbol: "COMD" };
  }

  jobOpts(): Omit<JobCheckOpts, "action"> {
    return { skills: this.app.skills, launchChains: this.app.cfg.launchChains, launchKindsFor: (c) => this.app.launches.kindsFor(c), pairingsFor: (c) => this.app.launches.pairingsFor(c) };
  }

  capabilities() {
    const c = this.app.cfg;
    const payment = this.payment();
    return {
      actions: c.enabledActions.map((action) => ({ action, version: 1, payment, quoteTtlSeconds: QUOTE_TTL_SECONDS })),
      payment: { ...payment, x402Version: 2, scheme: "exact", assetTransferMethod: "permit2", quoteApproval: "EIP-712", permit2: c.permit2, spender: this.app.settler.spender, witnessTypeString: WITNESS_TYPE_STRING, symbol: "COMD",
        approval: "First, one approval. It lets Permit2 move up to 1,000 COMD, enough for ten requests, and costs gas once." },
      quoteTtlSeconds: QUOTE_TTL_SECONDS,
      pricedPer: { "schedule.create": "run", "schedule.topup": "run" },
      limits: {
        "job.open": { maxObjective: 8000, maxSteps: 6, maxReferences: 8, bodyBytes: LIMITS.paidBodyBytes },
        "oracle.request": { minPanelSize: LIMITS.oracle.minPanelSize, maxPanelSize: LIMITS.oracle.maxPanelSize },
        "schedule.create": { minRuns: 1, maxRuns: 1_000_000, minOracleIntervalMinutes: 10, minJobIntervalMinutes: 30 },
        "schedule.topup": { minRuns: 1, maxRuns: 1_000_000, minOracleIntervalMinutes: 10, minJobIntervalMinutes: 30 },
      },
      launches: {
        defaultChainId: c.launchChains[0],
        chains: c.launchChains.map((chainId) => ({
          chainId,
          name: CHAINS[chainId]?.name ?? `chain ${chainId}`,
          testnet: CHAINS[chainId]?.testnet ?? true,
          kinds: this.app.launches.kindsFor(chainId),
          pairings: this.app.launches.pairingsFor(chainId).map((pairWith) => ({
            pairWith,
            currency: pairWith === "eth" ? "ETH" : "COMD",
            address: pairWith === "eth" ? "0x0000000000000000000000000000000000000000" : c.comd.toLowerCase(),
            symbol: pairWith === "eth" ? "ETH" : "COMD",
            decimals: pairWith === "eth" ? 18 : this.app.comdDecimals,
            kinds: this.app.launches.kindsFor(chainId).filter((k) => k !== "evm_contracts"),
          })),
        })),
      },
      authentication: { scheme: "Bearer", tokenBytes: 32, encoding: "hex", creator: "client" },
    };
  }

  // ------------------------------------------------------------------------------------------ validation

  private ensureAction(action: unknown): Action {
    if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) throw E.invalidRequest(`action must be one of ${ACTIONS.join(", ")}`);
    if (!this.app.cfg.enabledActions.includes(action as Action)) throw new ApiError(400, "action_not_enabled", `${action} is not enabled`);
    return action as Action;
  }

  /** Problems for an action's input (nothing charged when non-empty). */
  problems(action: Action, input: unknown): Problem[] {
    const o = this.jobOpts();
    switch (action) {
      case "job.open": return validateJobBody(input, { ...o, action: "job.open" });
      case "launch.open": return validateJobBody(input, { ...o, action: "launch.open" });
      case "job.continue": {
        const p = validateJobBody(input, { ...o, action: "job.continue" });
        if (p.length) return p;
        return this.continuationProblems((input as JobBody).parentJobId!);
      }
      case "workflow.open": return validateWorkflowBody(input, o);
      case "oracle.request": return validateOracleBody(input, { rpcChains: this.app.rpcChains() });
      case "schedule.create": return validateScheduleBody(input, { ...o, action: "schedule", rpcChains: this.app.rpcChains(), floorSeconds: this.app.cfg.scheduleFloorSeconds });
      case "schedule.topup": {
        const p = validateTopup(input);
        if (p.length) return p;
        const s = this.app.store.c<ScheduleRecord>("schedules").get((input as any).scheduleId);
        if (!s) return [{ path: "scheduleId", code: "unknown_schedule", message: "no such schedule" }];
        if (s.status === "cancelled" || s.status === "expired") return [{ path: "scheduleId", code: "not_active", message: `schedule is ${s.status}` }];
        return [];
      }
    }
  }

  private continuationProblems(parentJobId: string): Problem[] {
    const jobs = this.app.store.c<JobX>("jobs");
    const parent = jobs.get(parentJobId);
    if (!parent) return [{ path: "parentJobId", code: "unknown_job", message: "no such job" }];
    const out: Problem[] = [];
    if (parent.state !== "completed" && parent.state !== "blocked") out.push({ path: "parentJobId", code: "parent_running", message: `parent is ${parent.state}; it must be completed or blocked` });
    if (parent.state === "completed" && parent.deliver && !parent.delivery) out.push({ path: "parentJobId", code: "parent_undelivered", message: "parent's GitHub delivery is missing" });
    const projectId = parent.project?.id ?? parent.id;
    if (parent.project && parent.project.head !== parent.id) out.push({ path: "parentJobId", code: "not_head", message: `continue from the project's newest job ${parent.project.head}` });
    if (jobs.find((j) => (j.project?.id ?? j.id) === projectId && (j.state === "executing" || j.state === "delivering"))) out.push({ path: "parentJobId", code: "project_busy", message: "the project has a running job" });
    if (parent.workflow) {
      const wf = this.app.store.c<any>("workflows").get(parent.workflow.id);
      if (wf && !["completed", "blocked", "cancelled", "superseded"].includes(wf.status)) out.push({ path: "parentJobId", code: "workflow_running", message: "the project's workflow is not finished" });
    }
    if (parent.launch.requested) out.push(...[]);
    return out;
  }

  private runsOf(action: Action, input: any): number {
    if (action === "schedule.create" || action === "schedule.topup") return Number(input.runs);
    return 1;
  }

  // ------------------------------------------------------------------------------------------ check

  check(body: any) {
    const action = this.ensureAction(body?.action);
    const input = body?.input;
    const blockers = this.problems(action, input);
    const suggestions: string[] = [];
    const out: Record<string, unknown> = { action, blockers, suggestions, judged: true };
    const kind = action === "workflow.open" ? "workflow" : action === "oracle.request" ? "oracle" : action.startsWith("schedule") ? "schedule" : "job";
    out.kind = kind;
    if (blockers.length) return { ...out, plan: [], facts: {} };
    if (action === "job.open" || action === "launch.open" || action === "job.continue") {
      const parent = action === "job.continue" ? this.app.store.c<JobX>("jobs").get(input.parentJobId) : null;
      const plan = planJob(input, { skills: this.app.skills, launch: action === "launch.open", parentSkill: parent?.nodes.length === 1 ? parent.nodes[0].skill : null });
      out.plan = describePlan(plan);
      out.facts = { template: plan.template, shape: plan.shape, nodes: plan.nodes.length, premium: plan.nodes.some((n) => n.premium), reviews: plan.nodes.filter((n) => n.kind !== "work").length, github: input.github ?? null, hosting: input.ipfs ?? false, launch: action === "launch.open" ? { kind: input.onchain === true ? "evm_project" : input.onchain, chainId: input.chainId ?? this.app.cfg.launchChains[0] } : null, notes: plan.notes };
      if (!input.references?.length && plan.nodes.some((n) => this.app.skills.get(n.skill)?.tier === 1)) suggestions.push("contract work goes better with references such as solidity-security-review or defi-native");
      if (!plan.nodes.some((n) => n.kind === "review") && action !== "launch.open" && plan.nodes.some((n) => this.app.skills.get(n.skill)?.tier === 1)) suggestions.push("add an adversarial-review step for an independent cross-examination");
      if (parent) {
        const next = parent.nodes.some((n) => n.kind === "review") ? [{ skill: "fix-findings", why: "address the cross-examination's findings" }] : [{ skill: "adversarial-review", why: "the project has not been cross-examined" }];
        out.project = { id: parent.project?.id ?? parent.id, head: parent.project?.head ?? parent.id, summary: `${parent.objective.split("\n")[0].slice(0, 200)} (${parent.state})`, next, repoUrl: parent.delivery?.repoUrl ?? null };
      }
    } else if (action === "workflow.open") {
      const plan = planJob(input.draft, { skills: this.app.skills, launch: true });
      out.plan = ["contracts: " + describePlan(plan).join("; "), "deployment: Registrar deploys the attested build", "frontend: workflow-planner plans the site on the deployed commit", "publishing → validating"];
      out.facts = { chainId: input.permissions.onchain.chainId, kind: input.permissions.onchain.kind, hosting: input.draft.ipfs };
    } else if (action === "oracle.request") {
      out.plan = describePlan(planOracle(input, this.app.skills));
      out.request = { ...input, evidence: input.evidence ?? "chain", window: input.window, note: "the window is pinned to blocks when you quote" };
      out.facts = { panelSize: input.panelSize, quorum: input.quorum, evidence: input.evidence ?? "chain" };
      if ((input.evidence ?? "chain") === "chain" && !input.recipe) suggestions.push("evidence=chain: members must propose a recipe the attester can re-run (eth-call, log-count, balance)");
    } else {
      const runs = this.runsOf(action, input);
      out.unitAmount = this.app.cfg.priceComd;
      out.runs = runs;
      out.amount = (BigInt(this.app.cfg.priceComd) * BigInt(runs)).toString();
      out.terms = { purchase: `${runs} run(s) at ${this.app.cfg.priceComd} COMD atomic each`, refunds: "unused runs are not refunded", resultGuaranteed: false };
      out.plan = action === "schedule.create" ? [`${input.action} on ${JSON.stringify(input.cadence)}, ${runs} run(s)`] : [`add ${runs} run(s) to ${input.scheduleId}`];
      if (action === "schedule.create") {
        const c = parseCadence(input.cadence);
        out.facts = { minIntervalMinutes: "error" in c ? null : Math.round(c.minIntervalMs / 60_000), continue: !!input.continue };
      } else out.facts = {};
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ import

  async importRepo(body: any) {
    const problems: Problem[] = [];
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const m = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(url);
    if (!m) problems.push({ path: "url", code: "invalid", message: "url must be a public GitHub repository https://github.com/owner/repo" });
    if (!["site", "contracts", "code"].includes(body?.kind)) problems.push({ path: "kind", code: "invalid", message: "kind must be site, contracts or code" });
    if (body?.ref !== undefined && (typeof body.ref !== "string" || !/^[A-Za-z0-9._/-]{1,200}$/.test(body.ref))) problems.push({ path: "ref", code: "invalid", message: "ref must be a branch name" });
    if (problems.length) return { ok: false, problems };
    const [, owner, repo] = m!;
    const gh = async (p: string) => {
      const r = await this.app.fetch(`https://api.github.com${p}`, { headers: { accept: "application/vnd.github+json", "user-agent": "comd-chambers", ...(this.app.cfg.githubToken ? { authorization: `Bearer ${this.app.cfg.githubToken}` } : {}) }, signal: AbortSignal.timeout(15_000) });
      return { status: r.status, json: r.status === 200 ? await r.json() : null };
    };
    try {
      const meta = await gh(`/repos/${owner}/${repo}`);
      if (meta.status === 404) return { ok: false, problems: [{ path: "url", code: "not_found", message: "repository not found or not public" }] };
      if (meta.status !== 200) throw E.unavailable("github_unavailable", `GitHub returned ${meta.status}`);
      if (meta.json.private) return { ok: false, problems: [{ path: "url", code: "private", message: "repository is private" }] };
      if (meta.json.size > 200_000) return { ok: false, problems: [{ path: "url", code: "too_large", message: `repository is ${meta.json.size} KB; the limit is 200,000 KB` }] };
      const ref = body.ref ?? meta.json.default_branch;
      const commit = await gh(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
      if (commit.status !== 200) return { ok: false, problems: [{ path: "ref", code: "not_found", message: `ref ${ref} not found` }] };
      const tree = await gh(`/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(commit.json.sha)}`);
      const names: string[] = Array.isArray(tree.json) ? tree.json.map((e: any) => String(e.name)) : [];
      const source: Record<string, unknown> = { repoUrl: `https://github.com/${owner}/${repo}`, baseCommit: String(commit.json.sha).toLowerCase(), ref, sizeKb: meta.json.size };
      if (body.kind === "contracts" && !names.includes("foundry.toml")) return { ok: false, problems: [{ path: "url", code: "not_foundry", message: "contracts must be a Foundry project (foundry.toml at the root)" }] };
      if (body.kind === "site") {
        const pkg = names.includes("package.json");
        const html = names.includes("index.html");
        if (!pkg && !html) return { ok: false, problems: [{ path: "url", code: "not_a_site", message: "no package.json or index.html at the root" }] };
        source.site = { packageJson: pkg, indexHtml: html, framework: names.includes("next.config.js") || names.includes("next.config.mjs") ? "next" : names.some((n) => n.startsWith("vite.config")) ? "vite" : pkg ? "node" : "static" };
      }
      return { ok: true, source };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw E.unavailable("github_unavailable", (e as Error).message);
    }
  }

  // ------------------------------------------------------------------------------------------ quote

  async quote(req: Req): Promise<Res> {
    const token = this.bearer(req);
    const body = req.json();
    if (typeof body?.requestKey !== "string" || !UUID_RE.test(body.requestKey)) throw E.invalidRequest("requestKey must be a UUID (reuse it to retry)");
    const action = this.ensureAction(body.action);
    if (body.input === undefined || typeof body.input !== "object" || body.input === null) throw E.invalidRequest("input must be an object");
    const scopeHash = scopeHashOf(token);
    const inputHash = canonicalHash({ action, input: body.input });
    const prior = this.orders.find((o) => o.scopeHash === scopeHash && o.requestKey === body.requestKey);
    if (prior) {
      if (prior.inputHash !== inputHash) throw E.conflict("request_key_conflict", "this requestKey was used with a different input");
      this.expireIfDue(prior);
      return { status: 200, body: { created: false, order: this.orderBrief(prior) } };
    }
    const problems = this.problems(action, body.input);
    if (problems.length) throw E.invalidInput(problems);
    const input = structuredClone(body.input);
    if (action === "oracle.request") input.window = await this.app.oracle.pinWindow(input as OracleBody);
    const now = this.app.now();
    const nowS = Math.floor(now / 1000);
    const runs = this.runsOf(action, input);
    const unit = BigInt(this.app.cfg.priceComd);
    const id = randomUUID();
    const p = this.payment();
    const unsigned: Omit<Quote, "quoteHash"> = {
      v: 1,
      id,
      action,
      policyVersion: 1,
      inputHash,
      issuedAt: nowS,
      expiresAt: nowS + QUOTE_TTL_SECONDS,
      payment: { ...p, amount: (unit * BigInt(runs)).toString(), scheme: "exact" },
      unitAmount: unit.toString(),
      runs,
      payer: null,
      terms: { purchase: runs > 1 ? `${runs} runs of ${action}` : action, resultGuaranteed: false },
    };
    const quote: Quote = { ...unsigned, quoteHash: canonicalHash(unsigned) };
    const order: OrderRecord = {
      id, createdAt: iso(now), updatedAt: iso(now), requestKey: body.requestKey, scopeHash, action, input, inputHash, quote, status: "quoted", payer: null, paymentHash: null, permitNonce: null,
      payment: { status: "none", paid: false, transactionHash: null, reason: null, blockNumber: null }, admission: null, paidAt: null,
    };
    this.orders.save(order);
    this.app.kv.set("lastQuoteAt", iso(now));
    this.app.event("order.quoted", { orderId: id, action, amount: quote.payment.amount });
    return { status: 201, body: { created: true, order: this.orderBrief(order) } };
  }

  private bearer(req: Req): string {
    const t = req.bearer;
    if (!t) throw E.unauthorized("request_token_required", "send Authorization: Bearer <64 hex request token>");
    if (!BEARER_RE.test(t)) throw E.unauthorized("request_token_required", "the request token must be 32 random bytes as 64 hex characters");
    return t;
  }

  private load(req: Req): OrderRecord {
    const token = this.bearer(req);
    const id = req.params.id;
    if (!UUID_RE.test(id)) throw E.invalidId("order id must be a UUID");
    const o = this.orders.get(id);
    if (!o || o.scopeHash !== scopeHashOf(token)) throw E.notFound("no such order for this request token");
    this.expireIfDue(o);
    return o;
  }

  private expireIfDue(o: OrderRecord) {
    if (o.status === "quoted" && Math.floor(this.app.now() / 1000) >= o.quote.expiresAt) {
      o.status = "expired";
      o.updatedAt = iso(this.app.now());
      this.orders.save(o);
    }
  }

  requirements(o: OrderRecord): PaymentRequirements {
    // extra.spender: the Permit2 spender the payer names in PermitWitnessTransferFrom (the settlement wallet, which pays gas)
    return { scheme: "exact", network: o.quote.payment.network, asset: o.quote.payment.asset, amount: o.quote.payment.amount, payTo: o.quote.payment.payTo, maxTimeoutSeconds: PAYMENT_MAX_TIMEOUT_SECONDS, extra: { assetTransferMethod: "permit2", spender: this.app.settler.spender } };
  }

  challenge(o: OrderRecord): PaymentRequired {
    return {
      x402Version: 2,
      error: "payment_required",
      accepts: [this.requirements(o)],
      quote: { id: o.id, quoteHash: o.quote.quoteHash, action: o.action, payment: { network: o.quote.payment.network, asset: o.quote.payment.asset, amount: o.quote.payment.amount, payTo: o.quote.payment.payTo }, expiresAt: o.quote.expiresAt },
      requesterScopeHash: o.scopeHash,
      resourceUrl: `/requests/${o.id}/submit`,
      permit2: { address: this.app.cfg.permit2, spender: this.app.settler.spender, witnessTypeString: WITNESS_TYPE_STRING },
    };
  }

  // ------------------------------------------------------------------------------------------ submit

  async submit(req: Req): Promise<Res> {
    const o = this.load(req);
    const header = req.headers["payment-signature"];
    const headerStr = Array.isArray(header) ? header[0] : header;
    if (!headerStr) {
      if (o.status === "expired") throw new ApiError(410, "quote_expired", "the quote expired; quote again with a new requestKey");
      if (o.status === "quoted") {
        const ch = this.challenge(o);
        return { status: 402, body: ch, headers: { "payment-required": encodeHeaderJson(ch), "access-control-expose-headers": "PAYMENT-REQUIRED" } };
      }
      if (o.status === "payment_failed") throw E.conflict("order_not_payable", "payment failed; quote again");
      return { status: o.status === "admitted" ? 200 : 202, body: this.statusView(o) };
    }

    const parsed = parsePaymentSignatureHeader(headerStr);
    if (!parsed.ok) throw new ApiError(400, "invalid_payment_shape", parsed.detail);
    const { payment, raw } = parsed.value;
    const pHash = paymentHash(raw);

    // replays and conflicting attempts
    if (o.status === "admitted" || o.status === "admission_pending") {
      if (o.paymentHash === pHash) return { status: 200, body: this.statusView(o) };
      throw E.conflict("order_not_payable", `order is ${o.status}`);
    }
    if (o.status === "payment_pending") {
      if (o.paymentHash === pHash) throw E.conflict("payment_not_confirmed", "the payment is still confirming; poll GET /requests/:id");
      throw E.conflict("order_payment_already_started", "a different payment is already in progress for this order");
    }
    if (o.status === "expired") throw new ApiError(410, "quote_expired", "the quote expired; quote again with a new requestKey");
    if (o.status !== "quoted") throw E.conflict("order_not_payable", `order is ${o.status}`);
    const nowS = Math.floor(this.app.now() / 1000);
    if (o.quote.expiresAt - nowS < QUOTE_MIN_REMAINING_SECONDS) throw E.conflict("quote_too_close_to_expiry", `less than ${QUOTE_MIN_REMAINING_SECONDS}s left on the quote; quote again`);

    // terms
    const want = this.requirements(o);
    const diff = sameRequirements(payment.accepted, want);
    if (diff) throw new ApiError(400, "payment_terms_mismatch", `accepted.${diff} does not match the quote`);
    const a = payment.payload.permit2Authorization;
    if (a.permitted.token.toLowerCase() !== want.asset.toLowerCase()) throw new ApiError(400, "payment_terms_mismatch", "permit2Authorization.permitted.token is not the quoted asset");
    if (BigInt(a.permitted.amount) !== BigInt(want.amount)) throw new ApiError(400, "payment_terms_mismatch", "permit2Authorization.permitted.amount is not the quoted amount");
    if (a.witness.to.toLowerCase() !== want.payTo.toLowerCase()) throw new ApiError(400, "payment_terms_mismatch", "permit2Authorization.witness.to is not payTo");
    if (a.spender.toLowerCase() !== this.app.settler.spender.toLowerCase()) throw new ApiError(400, "payment_terms_mismatch", `permit2Authorization.spender must be ${this.app.settler.spender}`);
    if (a.deadline <= nowS) throw new ApiError(400, "invalid_payment_window", "permit deadline has passed");
    if (a.witness.validAfter > nowS) throw new ApiError(400, "invalid_payment_window", "witness.validAfter is in the future");
    if (a.deadline > o.quote.expiresAt + PAYMENT_MAX_TIMEOUT_SECONDS) throw new ApiError(400, "invalid_payment_window", "permit deadline is after the quote expiry window");

    // QuoteApproval
    const body = req.json();
    const sig = body?.quoteSignature;
    if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new ApiError(400, "invalid_quote_approval", "quoteSignature must be a 65-byte hex signature");
    const td = quoteApprovalTypedData({
      resource: `/requests/${o.id}/submit`, requesterScopeHash: `0x${o.scopeHash}`, quoteId: o.id, quoteHash: `0x${o.quote.quoteHash}`, paymentHash: pHash,
      action: o.action, asset: want.asset, amount: want.amount, payTo: want.payTo, expiresAt: o.quote.expiresAt,
    }, this.app.cfg.chainId);
    const approver = await recoverTypedSigner(td, sig);
    if (!approver || approver.toLowerCase() !== a.from.toLowerCase()) throw new ApiError(400, "invalid_quote_approval", "QuoteApproval is not signed by the paying wallet (or paymentHash differs)");
    if (!(await permit2SignerOk(payment, this.app.cfg.chainId, this.app.cfg.permit2))) throw new ApiError(402, "payment_rejected", "the Permit2 signature does not recover permit2Authorization.from", { reason: "invalid_signature" });

    // action-specific payer rules
    if (o.action === "job.continue") {
      const parent = this.app.store.c<JobX>("jobs").get((o.input as any).parentJobId);
      if (!parent?.paidBy || parent.paidBy.toLowerCase() !== a.from.toLowerCase()) throw E.forbidden("payer_not_owner", "only the wallet that paid the parent job may continue it");
    }

    // reservation
    const nonceKey = `${a.from.toLowerCase()}:${a.nonce}`;
    if (this.inflight.has(o.id) || o.status !== "quoted") throw E.conflict("payment_attempt_conflict", "another payment attempt for this order is in flight or done");
    if (this.orders.find((x) => x.id !== o.id && x.permitNonce === nonceKey && x.status !== "payment_failed")) throw E.conflict("payment_already_reserved", "this Permit2 nonce is reserved by another order");
    this.inflight.add(o.id);
    try {
      o.status = "payment_pending";
      o.payer = getAddress(a.from).toLowerCase() as Address;
      o.paymentHash = pHash;
      o.permitNonce = nonceKey;
      o.payment = { status: "pending", paid: false, transactionHash: null, reason: null, blockNumber: null };
      o.updatedAt = iso(this.app.now());
      this.orders.save(o);
      const settle = this.settleAndAdmit(o, payment);
      const done = await Promise.race([settle.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), this.app.cfg.settleWaitMs).unref())]);
      if (!done) return { status: 202, body: this.statusView(o) };
      if ((o.status as string) === "payment_failed") throw new ApiError(402, "payment_rejected", `payment failed: ${o.payment.reason}`, { reason: o.payment.reason });
      return { status: (o.status as string) === "admitted" ? 200 : 202, body: this.statusView(o) };
    } finally {
      this.inflight.delete(o.id);
    }
  }

  private async settleAndAdmit(o: OrderRecord, payment: import("@company/protocol").PaymentPayload) {
    const r = await this.app.settler.settle(payment, BigInt(o.quote.payment.amount), getAddress(o.quote.payment.payTo));
    const now = this.app.now();
    if (!r.ok) {
      o.status = "payment_failed";
      o.payment = { status: "failed", paid: false, transactionHash: null, reason: r.reason, blockNumber: null };
      o.updatedAt = iso(now);
      this.orders.save(o);
      this.app.event("order.payment_failed", { orderId: o.id, reason: r.reason });
      return;
    }
    o.payment = { status: "confirmed", paid: true, transactionHash: r.txHash, reason: null, blockNumber: r.blockNumber };
    o.paidAt = iso(now);
    o.status = "admission_pending";
    this.orders.save(o);
    this.app.kv.set("lastPaidAt", iso(now));
    this.app.event("order.paid", { orderId: o.id, action: o.action, payer: o.payer, txHash: r.txHash });
    let result: AdmissionResult;
    try {
      result = this.admit(o);
    } catch (e) {
      result = { kind: "refused", problems: e instanceof ApiError && Array.isArray(e.extra.problems) ? (e.extra.problems as Problem[]) : [{ path: "", code: "refused", message: (e as Error).message }] };
    }
    o.admission = { action: o.action, result };
    o.status = "admitted";
    o.updatedAt = iso(this.app.now());
    this.orders.save(o);
    this.app.event("order.admitted", { orderId: o.id, action: o.action, result: result.kind });
  }

  /** Turn a paid order into work. */
  admit(o: OrderRecord): AdmissionResult {
    const payer = o.payer;
    const input: any = o.input;
    const jobRes = (jobId: string, extra: Record<string, unknown> = {}): AdmissionResult => ({ kind: "job", jobId, ...extra, statusUrl: `/jobs/${jobId}`, resultUrl: `/jobs/${jobId}/result` } as AdmissionResult);
    switch (o.action) {
      case "job.open": return jobRes(this.app.engine.admitJob(input as JobBody, { paidBy: payer, orderId: o.id }).id, { launch: false });
      case "launch.open": return jobRes(this.app.engine.admitJob(input as JobBody, { paidBy: payer, orderId: o.id, launch: true }).id, { launch: true });
      case "job.continue": {
        const problems = this.continuationProblems(input.parentJobId);
        if (problems.length) return { kind: "refused", problems };
        const parent = this.app.store.c<JobX>("jobs").get(input.parentJobId)!;
        const { parentJobId: _p, ...body } = input;
        const job = this.app.engine.admitJob(body as JobBody, { paidBy: payer, orderId: o.id, parent });
        return jobRes(job.id, { continues: parent.id });
      }
      case "workflow.open": {
        const { workflow, job } = this.app.workflows.open(input as WorkflowBody, { paidBy: payer, orderId: o.id });
        return { kind: "workflow", workflowId: workflow.id, jobId: job.id, statusUrl: `/workflows/${workflow.id}`, jobUrl: `/jobs/${job.id}` };
      }
      case "oracle.request": {
        const { request, job } = this.app.oracle.open(input as OracleBody, { paidBy: payer, orderId: o.id });
        return { kind: "oracle", requestId: request.id, jobId: job.id, statusUrl: `/oracle/requests/${request.id}`, attestationUrl: `/oracle/requests/${request.id}/attestation` };
      }
      case "schedule.create": {
        const s = this.app.scheduler.create(input as ScheduleBody, { owner: payer!, orderId: o.id });
        return { kind: "schedule", scheduleId: s.id, statusUrl: `/schedules/${s.id}` };
      }
      case "schedule.topup": {
        const { schedule, runsAdded } = this.app.scheduler.topup(input.scheduleId, input.runs, o.id);
        return { kind: "schedule", scheduleId: schedule.id, runsAdded, statusUrl: `/schedules/${schedule.id}` };
      }
    }
  }

  // ------------------------------------------------------------------------------------------ views

  orderBrief(o: OrderRecord) {
    return { id: o.id, status: o.status, quote: o.quote };
  }

  statusView(o: OrderRecord) {
    return {
      status: o.status,
      order: { id: o.id, requestKey: o.requestKey, status: o.status, quote: o.quote, createdAt: o.createdAt, paidAt: o.paidAt },
      payment: { status: o.payment.status, paid: o.payment.paid, transactionHash: o.payment.transactionHash, reason: o.payment.reason },
      admission: o.admission,
    };
  }

  status(req: Req): Res {
    return { status: 200, body: this.statusView(this.load(req)) };
  }

  paidBy(address: string) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw E.invalidId("address must be 0x + 40 hex");
    const a = address.toLowerCase();
    const rows = this.orders.newest({ filter: (o) => o.payer === a, limit: 100 });
    for (const o of rows) this.expireIfDue(o);
    return {
      payer: a,
      count: rows.length,
      orders: rows.map((o) => ({
        orderId: o.id, action: o.action, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt,
        payment: { status: o.payment.status, transactionHash: o.payment.transactionHash },
        result: o.admission ? summarize(o.admission.result) : null,
      })),
    };
  }

  openapi() {
    const c = this.app.cfg;
    const p = this.payment();
    const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
    const err = { description: "error", content: { "application/json": { schema: ref("Error") } } };
    return {
      openapi: "3.1.0",
      info: { title: "Company.md — paid requests", version: "1", description: "Quote → x402 challenge → Permit2 payment + EIP-712 QuoteApproval → admission. Asset $COMD (Pons token; decimals as on chain). Not affiliated with Robinhood." },
      servers: [{ url: c.publicApiUrl }],
      components: {
        securitySchemes: { requestToken: { type: "http", scheme: "bearer", description: "32 random bytes as 64 hex characters, generated by the client" } },
        schemas: {
          Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, detail: { type: "string" }, problems: { type: "array", items: { type: "object" } }, reason: { type: "string" } } },
          QuoteRequest: { type: "object", required: ["requestKey", "action", "input"], properties: { requestKey: { type: "string", format: "uuid" }, action: { enum: [...ACTIONS] }, input: { type: "object" } } },
          Quote: { type: "object", properties: Object.fromEntries(["v", "id", "action", "policyVersion", "inputHash", "issuedAt", "expiresAt", "payment", "unitAmount", "runs", "payer", "terms", "quoteHash"].map((k) => [k, {}])) },
          Status: { type: "object", properties: { status: { enum: ["quoted", "payment_pending", "admission_pending", "admitted", "payment_failed", "expired"] }, order: { type: "object" }, payment: { type: "object" }, admission: { type: ["object", "null"] } } },
          PaymentRequired: { type: "object", properties: { x402Version: { const: 2 }, accepts: { type: "array" }, quote: { type: "object" }, requesterScopeHash: { type: "string" }, resourceUrl: { type: "string" } } },
        },
      },
      paths: {
        "/requests/capabilities": { get: { summary: "Enabled actions, prices, limits, launch chains", responses: { 200: { description: "capabilities" } } } },
        "/requests/check": { post: { summary: "Check an input; nothing is created or charged", responses: { 200: { description: "blockers, suggestions, plan, facts" } } } },
        "/requests/import": { post: { summary: "Validate a public GitHub repository as a source", responses: { 200: { description: "{ok, source} or {ok:false, problems}" } } } },
        "/requests/quote": { post: { summary: "Validate input and save a quoted order", security: [{ requestToken: [] }], requestBody: { content: { "application/json": { schema: ref("QuoteRequest") } } }, responses: { 201: { description: "created" }, 200: { description: "idempotent replay" }, 401: err, 409: err, 413: err, 422: err, 429: err } } },
        "/requests/{id}/submit": { post: { summary: "Without PAYMENT-SIGNATURE: 402 challenge. With it and {quoteSignature}: pay and admit.", security: [{ requestToken: [] }], parameters: [{ name: "PAYMENT-SIGNATURE", in: "header", schema: { type: "string" } }], responses: { 200: { description: "final", content: { "application/json": { schema: ref("Status") } } }, 202: { description: "pending" }, 400: err, 402: { description: "x402 challenge or payment_rejected", content: { "application/json": { schema: ref("PaymentRequired") } } }, 403: err, 409: err, 410: err } } },
        "/requests/{id}": { get: { summary: "Order status", security: [{ requestToken: [] }], responses: { 200: { description: "status", content: { "application/json": { schema: ref("Status") } } } } } },
        "/requests/paid-by/{address}": { get: { summary: "Orders paid by a wallet (no inputs, no signatures)", responses: { 200: { description: "orders" } } } },
      },
      "x-company-actions": c.enabledActions.map((action) => ({ action, version: 1, payment: p, quoteTtlSeconds: QUOTE_TTL_SECONDS, limits: (this.capabilities().limits as any)[action] ?? {} })),
    };
  }
}

function summarize(r: AdmissionResult) {
  switch (r.kind) {
    case "job": return { kind: "job", jobId: r.jobId };
    case "workflow": return { kind: "workflow", workflowId: r.workflowId, jobId: r.jobId };
    case "oracle": return { kind: "oracle", requestId: r.requestId, jobId: r.jobId };
    case "schedule": return { kind: "schedule", scheduleId: r.scheduleId };
    case "refused": return { kind: "refused" };
  }
}
