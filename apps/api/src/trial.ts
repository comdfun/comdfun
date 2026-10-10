/**
 * One free matter per wallet.
 *
 * Nobody who has not paid knows what the firm produces, and the filing is the product. A wallet proves itself with a
 * signature, asks one research question, and the answer lands on the public docket like any other matter — so the
 * trial is also marketing that writes itself.
 *
 * It is off until someone turns it on, because a free matter is real work: a Counsel does it and no revenue enters
 * the reward pool for it. FREE_MATTERS_PER_DAY is the budget, and nothing runs while it is 0.
 *
 * The caps are deliberately boring and stacked, because free compute attracts exactly the people you would expect:
 *   - one per wallet, ever
 *   - a global ceiling per day (the budget)
 *   - a ceiling per IP per day, so one person with many wallets cannot take the day's budget
 * and the objective goes through the same validation and the same intake screen as a matter someone paid for.
 *
 * Env: FREE_MATTERS_PER_DAY (0 = off), FREE_MATTERS_PER_IP_PER_DAY (default 1), FREE_MATTER_SKILL (default
 * research-report).
 */
import { randomUUID, randomBytes } from "node:crypto";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import type { App } from "./app.ts";
import { E } from "./errors.ts";
import { iso, type Rec } from "./store.ts";
import { validateJobBody } from "./validate.ts";
import { screenObjective } from "./intake.ts";
import type { JobBody } from "@company/protocol";

export const TRIAL_LIMITS = { objective: 1_000, nonceTtlMs: 5 * 60_000 } as const;

export interface TrialRecord extends Rec { address: Address; jobId: string; ip: string; day: string }

const lower = (a: string) => a.toLowerCase() as Address;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class Trial {
  private readonly app: App;
  private readonly nonces = new Map<string, { nonce: string; at: number }>();
  constructor(app: App) { this.app = app; }

  private get col() { return this.app.store.c<TrialRecord>("trials"); }

  private num(key: string, dflt: number): number {
    const n = Number(this.app.cfg.storage[key]);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
  }
  get perDay() { return this.num("FREE_MATTERS_PER_DAY", 0); }
  get perIpPerDay() { return this.num("FREE_MATTERS_PER_IP_PER_DAY", 1); }
  get skill() { return String(this.app.cfg.storage.FREE_MATTER_SKILL || "research-report"); }
  get enabled() { return this.perDay > 0; }

  private usedToday() { const d = dayOf(this.app.now()); return this.col.count((t) => t.day === d); }

  /** What the page needs to decide what to show, for anyone, signed in or not. */
  status(address?: string | null) {
    const used = this.usedToday();
    const mine = address && /^0x[0-9a-fA-F]{40}$/.test(address) ? this.col.find((t) => t.address === lower(address)) : undefined;
    return {
      enabled: this.enabled,
      skill: this.skill,
      remainingToday: Math.max(0, this.perDay - used),
      perDay: this.perDay,
      used: mine ? { jobId: mine.jobId, at: mine.createdAt } : null,
    };
  }

  message(address: Address, nonce: string): string {
    return [
      "Company.md: one free matter",
      "",
      "Sign to prove this wallet is yours and open your free matter.",
      "It is not a transaction and costs nothing.",
      "",
      `Wallet: ${getAddress(address)}`,
      `Nonce: ${nonce}`,
    ].join("\n");
  }

  private addr(a: unknown): Address {
    if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw E.invalidRequest("address must be a 0x-prefixed 20-byte address");
    return lower(a);
  }

  nonce(address: string) {
    if (!this.enabled) throw E.featureOff("free matters are not open at the moment");
    const a = this.addr(address);
    const nonce = randomBytes(16).toString("hex");
    this.nonces.set(a, { nonce, at: this.app.now() });
    return { nonce, message: this.message(a, nonce) };
  }

  /** Prove the wallet, check every cap, validate like a paid matter, then admit it. */
  async claim(body: Record<string, unknown>, ip: string): Promise<{ jobId: string; objective: string }> {
    if (!this.enabled) throw E.featureOff("free matters are not open at the moment");
    const address = this.addr(body.address);

    const pending = this.nonces.get(address);
    if (!pending || this.app.now() - pending.at > TRIAL_LIMITS.nonceTtlMs) throw E.invalidRequest("ask for a fresh nonce first (POST /trial/nonce)");
    const signature = body.signature;
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw E.invalidRequest("signature must be 0x-prefixed hex");
    let ok = false;
    try { ok = await verifyMessage({ address: getAddress(address), message: this.message(address, pending.nonce), signature: signature as Hex }); } catch { ok = false; }
    if (!ok) throw E.unauthorized("bad_signature", "that signature does not recover to this wallet");
    this.nonces.delete(address);

    // the caps, cheapest first
    if (this.col.find((t) => t.address === address)) throw E.conflict("already_used", "this wallet has had its free matter; retaining the firm costs 100 $COMD");
    const day = dayOf(this.app.now());
    if (this.usedToday() >= this.perDay) throw E.rate("free_matters_spent", 3600);
    if (ip && this.col.count((t) => t.day === day && t.ip === ip) >= this.perIpPerDay) throw E.rate("free_matters_spent_here", 3600);

    const objective = String(body.objective ?? "").trim();
    if (objective.length < 12) throw E.invalidRequest("ask a real question (at least 12 characters)");
    if (objective.length > TRIAL_LIMITS.objective) throw E.invalidRequest(`keep it under ${TRIAL_LIMITS.objective} characters`);

    // exactly the screen a paid matter gets
    const refused = screenObjective(objective);
    if (refused) throw E.forbidden("refused", `that matter ${refused}`);

    const jobBody = {
      objective,
      skill: this.skill,
      github: false,
      outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }],
    } as unknown as JobBody;

    const problems = validateJobBody(jobBody, {
      action: "job.open",
      skills: this.app.skills,
      launchChains: this.app.cfg.launchChains,
      launchKindsFor: () => [],
      pairingsFor: () => [],
    });
    if (problems.length) throw E.invalidInput(problems);

    const job = this.app.engine.admitJob(jobBody, { paidBy: address, orderId: null, createdBy: "request" });
    this.col.save({ id: randomUUID(), createdAt: iso(this.app.now()), address, jobId: job.id, ip: ip || "", day });
    this.app.event("trial.opened", { jobId: job.id, address });
    return { jobId: job.id, objective };
  }
}
