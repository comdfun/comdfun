/**
 * The settler: everything that ends up on chain after work is accepted.
 *
 *  - documents: a work record per accepted node (/work-records/:hash.json), a review per cross-examination
 *    (/reviews/:hash.json) and assessments (Bench findings, oracle members) (/review-documents/:hash.json)
 *  - reputation: one feedback batch per finished job → ERC-8004 ReputationRegistry.giveFeedback per entry,
 *    sent when SETTLER_PRIVATE_KEY + REPUTATION_REGISTRY are set, otherwise queued (status "queued")
 *  - rewards: epochs (7 days), COMD only (80% of x402 revenue via RevenueRouter.distribute() + 4.5% of hook trims):
 *    the pool is split among seats by accepted work → RewardDistributor.postRoot(epoch, COMD, root, total)
 *    (leaf (epoch, tokenId, amount))
 *  - launches: the ContributorDistributor root is registered by ProjectFactory.launch itself (see launches.ts)
 */
import { randomUUID } from "node:crypto";
import { buildRewardTree, canonicalHash, type Job, type JobNode, type SubmissionRecord } from "@company/protocol";
import type { App } from "./app.ts";
import { getAddress, type Address } from "viem";
import type { DocumentRecord, FeedbackBatch, OrderRecord, RewardEpoch, RewardEpochAsset } from "./records.ts";
import { iso } from "./store.ts";


export class Settlement {
  private readonly app: App;
  private sending = false;
  constructor(app: App) { this.app = app; }
  private get docs() { return this.app.store.c<DocumentRecord>("documents"); }
  private get batches() { return this.app.store.c<FeedbackBatch>("feedback"); }

  private doc(kind: DocumentRecord["kind"], jobId: string, key: string, body: Record<string, unknown>): string {
    const hash = canonicalHash(body);
    if (!this.docs.has(hash)) this.docs.save({ id: hash, createdAt: iso(this.app.now()), kind, jobId, key, body });
    return hash;
  }

  /** Called for every accepted node. */
  onAccepted(job: Job, node: JobNode, sub: SubmissionRecord) {
    const record = {
      schema: "company.work-record.v1",
      jobId: job.id,
      nodeKey: node.key,
      skill: node.skill,
      role: node.role,
      kind: node.kind,
      seat: { tokenId: sub.tokenId, agentId: sub.agentId, wallet: sub.wallet },
      submissionHash: sub.hash,
      bundleHash: sub.bundleHash,
      files: sub.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
      verdict: sub.verdict ? { status: sub.verdict.status, evaluation: sub.verdict.evaluation, verifiedTreeHash: sub.verdict.verifiedTreeHash } : null,
      usage: sub.usage,
      runtime: sub.runtime ? { name: sub.runtime.name, model: sub.runtime.model } : null,
      acceptedAt: iso(this.app.now()),
    };
    this.doc("work-record", job.id, node.key, record);
    if (node.kind === "review" || node.kind === "judge") {
      this.doc("review", job.id, node.key, {
        schema: "company.review.v1",
        jobId: job.id,
        nodeKey: node.key,
        skill: node.skill,
        reviewer: { tokenId: sub.tokenId, agentId: sub.agentId, wallet: sub.wallet },
        targets: node.reviews,
        verdict: (sub.result as any)?.verdict ?? null,
        findings: sub.findings,
        submissionHash: sub.hash,
      });
    }
    if (node.kind === "audit" || node.kind === "judge" || node.kind === "panel") {
      this.doc("review-document", job.id, node.key, {
        schema: "company.assessment.v1",
        jobId: job.id,
        key: node.key,
        skill: node.skill,
        seat: { tokenId: sub.tokenId, agentId: sub.agentId },
        concern: node.variables.concern ?? null,
        result: sub.result,
        findings: sub.findings,
        submissionHash: sub.hash,
      });
    }
  }

  /** One feedback batch per finished job (accepted nodes only). */
  onJobFinished(job: Job) {
    if (this.batches.find((b) => b.jobId === job.id)) return;
    const subs = this.app.store.c<SubmissionRecord & { id: string }>("submissions");
    const entries: FeedbackBatch["entries"] = [];
    for (const n of job.nodes) {
      if (!n.submissionHash) continue;
      const s = subs.get(n.submissionHash);
      if (!s?.accepted) continue;
      const wr = this.docs.find((d) => d.kind === "work-record" && d.jobId === job.id && d.key === n.key);
      entries.push({
        tag1: n.kind === "work" ? `verification:${s.verdict?.evaluation ?? "structural"}` : n.kind === "panel" ? "panel:member" : `review:${n.kind}`,
        tag2: "acceptance-v1",
        value: 1,
        agentId: s.agentId,
        nodeKey: n.key,
        feedbackHash: wr?.id ?? canonicalHash({ jobId: job.id, nodeKey: n.key }),
        submissionHash: s.hash,
        tokenId: s.tokenId,
      });
    }
    if (!entries.length) return;
    const prev = this.batches.newest({ limit: 1 })[0];
    const cfg = this.app.cfg;
    const now = this.app.now();
    const body = { schema: "company.feedback-batch.v1", jobId: job.id, entries, previousHash: prev?.documentHash ?? "0".repeat(64) };
    const b: FeedbackBatch = {
      id: randomUUID(),
      createdAt: iso(now),
      updatedAt: iso(now),
      jobId: job.id,
      status: "queued",
      entries,
      chainId: cfg.chainId,
      registry: cfg.reputationRegistry,
      identity: { registry: cfg.identityRegistry, collection: cfg.counselNft, chainId: cfg.chainId },
      documentHash: canonicalHash(body),
      previousHash: body.previousHash,
      attempts: 0,
      txHash: null,
      batcher: this.app.writer?.address ?? null,
      blockNumber: null,
      gasUsed: null,
      failure: null,
      sentAt: null,
    };
    this.batches.save(b);
    this.app.event("feedback.queued", { batchId: b.id, jobId: job.id, entries: entries.length });
    if (this.canSendFeedback()) this.app.track(this.sendQueued());
  }

  canSendFeedback(): boolean {
    return !!this.app.writer && !!this.app.cfg.reputationRegistry;
  }

  /** Send queued batches (one giveFeedback per entry with an agentId). */
  async sendQueued() {
    if (this.sending || !this.canSendFeedback()) return;
    this.sending = true;
    try {
      for (const b of this.batches.filter((x) => x.status === "queued" || (x.status === "failed" && x.attempts < 5))) {
        b.attempts++;
        b.status = "submitted";
        this.batches.save(b);
        try {
          let last: { txHash: string; blockNumber: number; gasUsed: string } | null = null;
          for (const e of b.entries) {
            if (!e.agentId || e.txHash) continue;
            last = await this.app.writer!.giveFeedback({
              agentId: BigInt(e.agentId), value: BigInt(e.value), tag1: e.tag1, tag2: e.tag2, endpoint: this.app.cfg.publicApiUrl,
              feedbackURI: `${this.app.cfg.publicApiUrl}/work-records/${e.feedbackHash}.json`, feedbackHash: `0x${e.feedbackHash}`,
            });
            e.txHash = last.txHash;
            this.batches.save(b);
          }
          b.status = "sent";
          this.app.event("feedback.sent", { batchId: b.id, jobId: b.jobId, entries: b.entries.length, txHash: last?.txHash ?? b.txHash });
          b.txHash = last?.txHash ?? b.txHash;
          b.blockNumber = last?.blockNumber ?? null;
          b.gasUsed = last?.gasUsed ?? null;
          b.sentAt = iso(this.app.now());
          b.failure = null;
        } catch (e) {
          b.status = "failed";
          b.failure = (e as Error).message.slice(0, 500);
        }
        b.updatedAt = iso(this.app.now());
        this.batches.save(b);
      }
    } finally {
      this.sending = false;
    }
  }

  // ------------------------------------------------------------------------------------------ reward epochs

  get epochMs(): number { return this.app.cfg.epochSeconds * 1000; }

  epochOf(ms: number): number {
    return Math.floor((ms - this.app.cfg.rewardGenesisMs) / this.epochMs);
  }

  /**
   * Seat rewards are paid in COMD only: 80% of x402 revenue (RevenueRouter.distribute()) plus 4.5% of the hook's
   * inventory trims both land in the RewardDistributor. REWARD_EPOCH_COMD_POOL caps an epoch.
   */
  rewardAssets(): { asset: Address; symbol: string; decimals: number; cap: bigint | null; source: RewardEpochAsset["poolSource"] }[] {
    const cfg = this.app.cfg;
    const out: ReturnType<Settlement["rewardAssets"]> = [];
    if (cfg.comd && !/^0x0{40}$/i.test(cfg.comd)) out.push({ asset: getAddress(cfg.comd), symbol: "COMD", decimals: 18, cap: cfg.rewardEpochPool ? BigInt(cfg.rewardEpochPool) : null, source: cfg.rewardEpochPool ? "env" : "distributor" });
    return out;
  }

  /**
   * Close an epoch: accepted work per seat in [start, end) → one Merkle root per asset (leaf (epoch, tokenId,
   * amount)), split pro rata to accepted work. Amounts are fixed when the root is POSTED, from what the
   * RewardDistributor actually holds: pool = unallocated(asset) (capped per epoch by REWARD_EPOCH_COMD_POOL). An epoch without accepted work posts nothing (funds roll over); an epoch with work
   * but no funds yet waits ("waiting_funds") and is retried by the settler tick, oldest first. Idempotent.
   */
  closeEpoch(epoch: number): RewardEpoch {
    const col = this.app.store.c<RewardEpoch>("epochs");
    const existing = col.get(String(epoch));
    if (existing) return existing;
    const start = this.app.cfg.rewardGenesisMs + epoch * this.epochMs;
    const end = start + this.epochMs;
    const inEpoch = (iso: string | null) => !!iso && Date.parse(iso) >= start && Date.parse(iso) < end;
    const counts = new Map<string, number>();
    for (const a of this.app.store.c<any>("attempts").filter((x) => x.state === "accepted" && inEpoch(x.finishedAt))) counts.set(a.tokenId, (counts.get(a.tokenId) ?? 0) + 1);
    const now = iso(this.app.now());
    const revenue = this.app.store.c<OrderRecord>("orders").filter((o) => o.status === "admitted" && inEpoch(o.paidAt)).reduce((s, o) => s + BigInt(o.quote.payment.amount), 0n);
    const work = Object.fromEntries([...counts].sort((a, b) => Number(BigInt(a[0]) - BigInt(b[0]))));
    const assets: RewardEpochAsset[] = counts.size
      ? this.rewardAssets().map((a) => ({ asset: a.asset, symbol: a.symbol, decimals: a.decimals, pool: "0", poolSource: a.source, cap: a.cap === null ? null : a.cap.toString(), total: "0", root: null, status: "queued", txHash: null, blockNumber: null, failure: null, postedAt: null, entries: [] }))
      : [];
    const ep: RewardEpoch = {
      id: String(epoch), createdAt: now, updatedAt: now, epoch, startsAt: iso(start), endsAt: iso(end),
      revenue: revenue.toString(), work, assets,
      // summary of the first asset (COMD) for older readers
      pool: "0", poolSource: assets[0]?.poolSource ?? "distributor", total: "0", root: null, status: counts.size ? "queued" : "empty", txHash: null, failure: null, entries: [],
    };
    col.save(ep);
    this.app.event("rewards.epoch", { epoch, seats: counts.size, assets: assets.map((a) => a.symbol) });
    if (counts.size) this.app.track(this.postEpoch(epoch));
    return ep;
  }

  private posting = new Map<number, Promise<void>>();
  private ticking: Promise<void> | null = null;

  /** Fix amounts from the distributor's funds and post one root per asset. One run per epoch at a time. */
  postEpoch(epoch: number): Promise<void> {
    const cur = this.posting.get(epoch);
    if (cur) return cur;
    const p = this.postEpochOnce(epoch).finally(() => this.posting.delete(epoch));
    this.posting.set(epoch, p);
    return p;
  }

  /** RewardDistributor.postRoot per asset with the amounts fixed from what the distributor holds now. */
  private async postEpochOnce(epoch: number) {
    const col = this.app.store.c<RewardEpoch>("epochs");
    const ep = col.get(String(epoch));
    if (!ep) return;
    const tokens = Object.keys(ep.work);
    const totalWork = Object.values(ep.work).reduce((a, b) => a + b, 0);
    const onChain = !!this.app.writer && !!this.app.cfg.rewardDistributor && this.app.chain.configured;
    for (const a of ep.assets) {
      if (a.status === "posted") continue;
      try {
        let pool: bigint;
        if (onChain) {
          const unallocated = await this.app.chain.rewardUnallocated(a.asset);
          pool = a.cap !== null && BigInt(a.cap) < unallocated ? BigInt(a.cap) : unallocated;
        } else if (a.cap !== null) pool = BigInt(a.cap);
        else pool = (BigInt(ep.revenue) * 8000n) / 10_000n; // no chain: 80% of the epoch's revenue, on paper
        if (pool === 0n || totalWork === 0) { a.status = "waiting_funds"; a.failure = `${a.symbol}: nothing unallocated in the RewardDistributor yet (RevenueRouter.distribute() sends the seats' 80%; trims send 4.5%)`; continue; }
        // pro rata to accepted work; dust to the seat with the most accepted work (ties: lowest token id)
        const amounts = tokens.map((t) => (pool * BigInt(ep.work[t])) / BigInt(totalWork));
        const dust = pool - amounts.reduce((x, y) => x + y, 0n);
        const top = tokens.reduce((bi, t, i) => (ep.work[t] > ep.work[tokens[bi]] ? i : bi), 0);
        amounts[top] += dust;
        const rows = tokens.map((t, i) => ({ epoch, tokenId: t, amount: amounts[i].toString() })).filter((r) => r.amount !== "0");
        const tree = buildRewardTree(rows);
        a.pool = pool.toString();
        a.total = pool.toString();
        a.root = tree.root;
        a.entries = tree.claims.map((c) => ({ tokenId: c.tokenId, accepted: ep.work[c.tokenId], amount: c.amount, proof: c.proof }));
        if (!onChain) { a.status = "queued"; a.failure = "settler not configured (SETTLER_PRIVATE_KEY, REWARD_DISTRIBUTOR, RPC_URL)"; continue; }
        if (await this.app.chain.rewardRootPosted(epoch, a.asset)) { a.status = "posted"; a.failure = "root already on chain"; continue; }
        const r = await this.app.writer!.postRoot(BigInt(epoch), a.asset, tree.root, pool);
        a.status = "posted";
        a.txHash = r.txHash;
        a.blockNumber = r.blockNumber;
        a.postedAt = iso(this.app.now());
        a.failure = null;
        this.app.event("rewards.posted", { epoch, asset: a.symbol, root: a.root, total: a.total, txHash: r.txHash, seats: a.entries.length });
      } catch (e) {
        a.status = "failed";
        a.failure = (e as Error).message.slice(0, 500);
      }
    }
    const first = ep.assets[0];
    if (first) Object.assign(ep, { pool: first.pool, poolSource: first.poolSource, total: first.total, root: first.root, status: first.status === "waiting_funds" ? "queued" : first.status, txHash: first.txHash, failure: first.failure, entries: first.entries });
    ep.updatedAt = iso(this.app.now());
    col.save(ep);
  }

  /** Every seat's claimable rewards (current NFT owner receives them): epoch × asset with amount and proof. */
  rewardsFor(tokenId: string) {
    const rows = this.app.store.c<RewardEpoch>("epochs").all().sort((a, b) => b.epoch - a.epoch);
    const epochs = rows.map((ep) => ({
      epoch: ep.epoch, startsAt: ep.startsAt, endsAt: ep.endsAt, accepted: ep.work?.[tokenId] ?? 0,
      assets: (ep.assets ?? []).flatMap((a) => {
        const e = a.entries.find((x) => x.tokenId === tokenId);
        if (!e) return [];
        return [{ asset: a.asset, symbol: a.symbol, decimals: a.decimals, amount: e.amount, proof: e.proof, root: a.root, status: a.status, txHash: a.txHash, claimable: a.status === "posted",
          call: a.symbol === "COMD" ? { function: "claim(uint256 epoch, uint256 tokenId, uint256 amount, bytes32[] proof)", args: [String(ep.epoch), tokenId, e.amount, e.proof] } : { function: "claimToken(address asset, uint256 epoch, uint256 tokenId, uint256 amount, bytes32[] proof)", args: [a.asset, String(ep.epoch), tokenId, e.amount, e.proof] } }];
      }),
    })).filter((e) => e.assets.length);
    return { tokenId, distributor: this.app.cfg.rewardDistributor, chainId: this.app.cfg.chainId, leaf: "keccak256(bytes.concat(keccak256(abi.encode(epoch, tokenId, amount))))", count: epochs.length, epochs };
  }

  /** Background: close finished epochs, post roots still waiting for funds (oldest first), retry feedback. */
  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.tickOnce().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  private async tickOnce() {
    const current = this.epochOf(this.app.now());
    const col = this.app.store.c<RewardEpoch>("epochs");
    const last = col.all().reduce((m, e) => Math.max(m, e.epoch), -1);
    for (let e = Math.max(0, last + 1, current - 50); e < current; e++) if (!col.has(String(e))) this.closeEpoch(e);
    for (const ep of col.all().sort((a, b) => a.epoch - b.epoch)) {
      if ((ep.assets ?? []).some((a) => a.status === "waiting_funds" || a.status === "failed" || (a.status === "queued" && !a.root))) await this.postEpoch(ep.epoch);
    }
    if (this.canSendFeedback()) await this.sendQueued();
  }
}
