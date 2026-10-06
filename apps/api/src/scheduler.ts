/**
 * Retainers (schedules): a frozen job.open or oracle.request fired on a cadence with purchased runs.
 *  - floors: 10 minutes between questions, 30 between jobs (checked at quote)
 *  - a slot whose previous result is still in flight is `skipped` (nothing spent)
 *  - an admission that is refused is `failed` (nothing spent); three in a row pause the schedule
 *  - only `opened` runs spend a run; at zero the schedule is `exhausted`
 *  - after an outage the schedule fires once, late, and records the slots it missed in `missedSlots`
 *  - any wallet may top up; a paused or exhausted schedule resumes from its next slot; no refunds
 */
import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { LIMITS, type JobBody, type OracleBody, type ScheduleBody } from "@company/protocol";
import type { App } from "./app.ts";
import type { JobX } from "./engine.ts";
import type { OracleRecord, RunRecord, ScheduleRecord } from "./records.ts";
import { iso } from "./store.ts";
import { missedBetween, nextSlot, parseCadence, type ParsedCadence } from "./cadence.ts";

export class Scheduler {
  private readonly app: App;
  private running = false;
  constructor(app: App) { this.app = app; }
  private get col() { return this.app.store.c<ScheduleRecord>("schedules"); }
  private get runs() { return this.app.store.c<RunRecord>("runs"); }

  private cadence(s: ScheduleRecord): ParsedCadence {
    const c = parseCadence(s.cadence);
    if ("error" in c) throw new Error(c.error);
    return c;
  }
  private anchor(s: ScheduleRecord): number {
    return Date.parse(s.startAt ?? s.createdAt);
  }

  create(body: ScheduleBody, meta: { owner: Address; orderId?: string | null }): ScheduleRecord {
    const now = this.app.now();
    const id = randomUUID();
    const s: ScheduleRecord = {
      id,
      createdAt: iso(now),
      updatedAt: iso(now),
      label: body.label ?? null,
      action: body.action,
      actionVersion: 1,
      input: body.input as unknown as Record<string, unknown>,
      cadence: body.cadence,
      continue: !!body.continue,
      status: "active",
      statusReason: null,
      runsBought: body.runs,
      runsRemaining: body.runs,
      owner: meta.owner.toLowerCase() as Address,
      paid: true,
      nextRunAt: null,
      lastRunAt: null,
      expiresAt: null,
      startAt: body.startAt ? iso(Date.parse(body.startAt)) : null,
      seq: 0,
      consecutiveFailures: 0,
      lastOpenedRef: null,
      orderIds: meta.orderId ? [meta.orderId] : [],
    };
    const c = this.cadence(s);
    const start = Math.max(now, s.startAt ? Date.parse(s.startAt) : now);
    s.nextRunAt = iso(c.kind === "every" ? start : nextSlot(c, this.anchor(s), start - 1));
    this.col.save(s);
    this.app.event("schedule.created", { scheduleId: id, action: s.action, runs: s.runsBought, nextRunAt: s.nextRunAt });
    return s;
  }

  topup(scheduleId: string, runs: number, orderId?: string | null): { schedule: ScheduleRecord; runsAdded: number } {
    const s = this.col.get(scheduleId);
    if (!s) throw new Error("unknown schedule");
    const now = this.app.now();
    s.runsBought += runs;
    s.runsRemaining += runs;
    if (orderId) s.orderIds.push(orderId);
    if (s.status === "exhausted" || s.status === "paused") {
      s.status = "active";
      s.statusReason = null;
      s.consecutiveFailures = 0;
      s.nextRunAt = iso(nextSlot(this.cadence(s), this.anchor(s), now));
    }
    s.updatedAt = iso(now);
    this.col.save(s);
    this.app.event("schedule.topup", { scheduleId, runsAdded: runs, runsRemaining: s.runsRemaining });
    return { schedule: s, runsAdded: runs };
  }

  /** Fire every due schedule once. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.app.now();
      const due = this.col.filter((s) => s.status === "active" && !!s.nextRunAt && Date.parse(s.nextRunAt) <= now);
      for (const s of due) await this.fire(s);
    } finally {
      this.running = false;
    }
  }

  private inFlight(s: ScheduleRecord): boolean {
    const ref = s.lastOpenedRef;
    if (!ref) return false;
    if (ref.kind === "oracle") {
      const r = this.app.store.c<OracleRecord>("oracle").get(ref.id);
      return !!r && (r.status === "assessing" || r.status === "reproducing");
    }
    const j = this.app.store.c<JobX>("jobs").get(ref.jobId);
    return !!j && (j.state === "executing" || j.state === "delivering" || j.state === "planning");
  }

  private async fire(s: ScheduleRecord) {
    const now = this.app.now();
    const c = this.cadence(s);
    const dueAt = Date.parse(s.nextRunAt!);
    const missed = missedBetween(c, this.anchor(s), dueAt, now);
    s.seq++;
    const run: RunRecord = { id: `${s.id}:${s.seq}`, createdAt: iso(now), scheduleId: s.id, seq: s.seq, status: "opening", dueAt: iso(dueAt), firedAt: iso(now), missedSlots: missed, failure: null, result: null };
    s.lastRunAt = iso(now);
    s.nextRunAt = iso(nextSlot(c, this.anchor(s), now));
    if (this.inFlight(s)) {
      run.status = "skipped";
      run.failure = "previous run still in flight";
      this.runs.save(run);
      s.updatedAt = iso(now);
      this.col.save(s);
      this.app.event("schedule.skipped", { scheduleId: s.id, seq: s.seq });
      return;
    }
    this.runs.save(run);
    try {
      if (s.action === "oracle.request") {
        const body = structuredClone(s.input) as unknown as OracleBody;
        body.window = (await this.app.oracle.pinWindow(body)) as any;
        const { request, job } = this.app.oracle.open(body, { paidBy: s.owner, scheduleId: s.id });
        run.result = { kind: "oracle", id: request.id, url: `/oracle/requests/${request.id}`, jobId: job.id, requestId: request.id };
        s.lastOpenedRef = { kind: "oracle", id: request.id, jobId: job.id };
      } else {
        const body = structuredClone(s.input) as unknown as JobBody;
        let parent: JobX | null = null;
        if (s.continue && s.lastOpenedRef) {
          const last = this.app.store.c<JobX>("jobs").get(s.lastOpenedRef.jobId);
          if (last && (last.state === "completed" || last.state === "blocked")) parent = this.app.store.c<JobX>("jobs").get(last.project?.head ?? last.id) ?? last;
        }
        const job = this.app.engine.admitJob(body, { paidBy: s.owner, createdBy: "schedule", scheduleId: s.id, parent });
        run.result = { kind: "job", id: job.id, url: `/jobs/${job.id}`, jobId: job.id };
        s.lastOpenedRef = { kind: "job", id: job.id, jobId: job.id };
      }
      run.status = "opened";
      s.runsRemaining--;
      s.consecutiveFailures = 0;
      if (s.runsRemaining <= 0) { s.status = "exhausted"; s.statusReason = "every run used"; s.nextRunAt = null; }
      this.app.event("schedule.opened", { scheduleId: s.id, seq: s.seq, missedSlots: missed, runsRemaining: s.runsRemaining, ...run.result });
    } catch (e) {
      run.status = "failed";
      run.failure = (e as Error).message.slice(0, 500);
      s.consecutiveFailures++;
      if (s.consecutiveFailures >= LIMITS.schedule.failuresToPause) {
        s.status = "paused";
        s.statusReason = `${s.consecutiveFailures} consecutive failures; last: ${run.failure}`;
      }
      this.app.event("schedule.failed", { scheduleId: s.id, seq: s.seq, failure: run.failure, paused: s.status === "paused" });
    }
    this.runs.save(run);
    s.updatedAt = iso(now);
    this.col.save(s);
  }

  view(s: ScheduleRecord, latest = 20) {
    const runs = this.runs.filter((r) => r.scheduleId === s.id).sort((a, b) => b.seq - a.seq).slice(0, latest);
    return { ...this.listItem(s), statusReason: s.statusReason, lastRunAt: s.lastRunAt, expiresAt: s.expiresAt, latest: runs.map(({ id: _i, createdAt: _c, scheduleId: _s, ...r }) => r) };
  }

  listItem(s: ScheduleRecord) {
    return {
      id: s.id, label: s.label, action: s.action, actionVersion: s.actionVersion, continue: s.continue, status: s.status, statusReason: s.statusReason,
      cadence: s.cadence, input: s.input, runs: { total: s.runsBought, remaining: s.runsRemaining }, runsRemaining: s.runsRemaining, runsBought: s.runsBought,
      owner: s.owner, paid: s.paid, pausedReason: s.status === "paused" ? s.statusReason : null, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, expiresAt: s.expiresAt,
      createdAt: s.createdAt, updatedAt: s.updatedAt, url: `/schedules/${s.id}`,
    };
  }
}
