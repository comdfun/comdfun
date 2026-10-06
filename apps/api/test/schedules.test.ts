import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { harness, pay, get, clock } from "./helpers.ts";
import { nextCron, parseCadence, parseCron, parseDuration, missedBetween, nextSlot } from "../src/cadence.ts";

const MIN = 60_000;

test("cadence: ISO 8601 durations and five-field cron with IANA time zones (DST gaps skipped)", () => {
  assert.equal(parseDuration("PT6H"), 6 * 3600_000);
  assert.equal(parseDuration("P1D"), 86_400_000);
  assert.equal(parseDuration("P2W"), 14 * 86_400_000);
  assert.equal(parseDuration("PT1H30M"), 90 * MIN);
  assert.equal(parseDuration("P"), null);
  assert.equal(parseDuration("PT"), null);
  assert.match((parseCadence({ every: "P1M" }) as any).error, /cron/);
  const daily = parseCron("0 17 * * *");
  assert.equal(new Date(nextCron(daily, "UTC", Date.UTC(2026, 9, 5, 19, 13))).toISOString(), "2026-10-06T17:00:00.000Z");
  const weekdays = parseCron("0 9 * * MON-FRI");
  assert.equal(new Date(nextCron(weekdays, "Europe/London", Date.UTC(2026, 9, 9, 12))).toISOString(), "2026-10-12T08:00:00.000Z", "Friday noon → Monday 09:00 BST");
  const gap = parseCron("30 2 * * *");
  assert.equal(new Date(nextCron(gap, "America/New_York", Date.UTC(2026, 2, 7, 12))).toISOString(), "2026-03-09T06:30:00.000Z", "02:30 does not exist on 8 March in New York");
  assert.equal((parseCadence({ cron: "*/15 * * * *" }) as any).minIntervalMs, 15 * MIN);
  assert.equal((parseCadence({ cron: "0 0 1 * *", tz: "Asia/Tokyo" }) as any).kind, "cron");
  assert.match((parseCadence({ cron: "0 0 * *" }) as any).error, /five fields/);
  assert.match((parseCadence({ cron: "61 * * * *" }) as any).error, /out of range/);
  assert.match((parseCadence({ cron: "0 * * * *", tz: "Mars/Olympus" }) as any).error, /time zone/);
  const every = parseCadence({ every: "PT10M" }) as any;
  assert.equal(nextSlot(every, 0, 25 * MIN), 30 * MIN);
  assert.equal(missedBetween(every, 0, 30 * MIN, 65 * MIN), 3);
});

test("floors: 10 minutes between questions, 30 between jobs; refused at quote with 422", async () => {
  const h = await harness();
  try {
    const payer = privateKeyToAccount(generatePrivateKey());
    const oracle = { v: 1, question: "How many Counsel seats were connected in the window?", chainId: 46630, window: { hours: 1 }, answerType: "uint256", panelSize: 5, quorum: 4, validForSeconds: 600, evidence: "panel" };
    const job = { objective: "Summarise the week's filings.", skill: "research-report" };
    const tooFast = await pay(h, payer, "schedule.create", { action: "oracle.request", input: oracle, cadence: { every: "PT5M" }, runs: 2 });
    assert.equal(tooFast.quote.status, 422);
    assert.equal(tooFast.quote.body.problems[0].code, "too_frequent");
    assert.equal((await pay(h, payer, "schedule.create", { action: "job.open", input: job, cadence: { every: "PT20M" }, runs: 2 })).quote.status, 422);
    assert.equal((await pay(h, payer, "schedule.create", { action: "job.open", input: job, cadence: { cron: "*/15 * * * *" }, runs: 2 })).quote.status, 422);
    assert.equal((await pay(h, payer, "schedule.create", { action: "job.open", input: { ...job, parentJobId: "3b589ab6-de1e-416c-ac37-1fca5aef3179" }, cadence: { every: "PT1H" }, runs: 2 })).quote.status, 422);
    const ok = await pay(h, payer, "schedule.create", { action: "job.open", input: job, cadence: { cron: "0 17 * * *", tz: "UTC" }, runs: 30, label: "Daily brief" });
    assert.equal(ok.quote.status, 201);
    assert.equal(ok.quote.body.order.quote.payment.amount, String(100n * 10n ** 18n * 30n), "priced per run");
    assert.equal(ok.quote.body.order.quote.runs, 30);
    assert.equal(ok.submit.body.admission.result.kind, "schedule");
    const s = (await get(h, `/schedules/${ok.submit.body.admission.result.scheduleId}`)).body;
    assert.equal(s.runs.total, 30);
    assert.equal(s.owner, payer.address.toLowerCase());
    assert.match(s.nextRunAt, /T17:00:00\.000Z$/);
  } finally {
    await h.close();
  }
});

test("scheduler: opened, skipped while in flight, late with missedSlots, exhausted; three failures pause; any wallet tops up", async () => {
  const c = clock(Date.UTC(2026, 9, 5, 12, 0, 0));
  const h = await harness({ clock: c });
  try {
    const owner = privateKeyToAccount(generatePrivateKey());
    const input = { v: 1, question: "How many Counsel seats were connected in the window?", chainId: 46630, window: { hours: 1 }, answerType: "uint256", panelSize: 5, quorum: 4, validForSeconds: 600, evidence: "panel" };
    const r = await pay(h, owner, "schedule.create", { action: "oracle.request", input, cadence: { every: "PT10M" }, runs: 3, label: "seats" });
    const id = r.submit.body.admission.result.scheduleId;
    const runs = async () => (await get(h, `/schedules/${id}`)).body;
    const oracleOf = (seq: number) => h.app.store.c<any>("runs").get(`${id}:${seq}`).result.requestId;

    await h.app.scheduler.tick();
    let s = await runs();
    assert.equal(s.latest[0].status, "opened");
    assert.equal(s.runsRemaining, 2);
    assert.equal(h.app.store.c<any>("oracle").get(oracleOf(1)).scheduleId, id);

    c.advance(10 * MIN);
    await h.app.scheduler.tick();
    s = await runs();
    assert.equal(s.latest[0].status, "skipped", "the previous question is still being assessed");
    assert.equal(s.runsRemaining, 2, "skipped runs cost nothing");

    h.app.store.c<any>("oracle").get(oracleOf(1)).status = "attested";
    c.advance(10 * MIN);
    await h.app.scheduler.tick();
    s = await runs();
    assert.equal(s.latest[0].status, "opened");
    assert.equal(s.runsRemaining, 1);

    h.app.store.c<any>("oracle").get(oracleOf(3)).status = "attested";
    c.advance(45 * MIN); // outage: slots at +30, +40, +50, +60 are due; fire once, late
    await h.app.scheduler.tick();
    s = await runs();
    assert.equal(s.latest[0].status, "opened");
    assert.equal(s.latest[0].missedSlots, 3);
    assert.equal(s.status, "exhausted");
    assert.equal(s.nextRunAt, null);

    // three consecutive failures pause; a top-up from any wallet resumes from the next slot
    const r2 = await pay(h, owner, "schedule.create", { action: "oracle.request", input, cadence: { every: "PT10M" }, runs: 5 });
    const id2 = r2.submit.body.admission.result.scheduleId;
    const realBlock = h.chain.block.bind(h.chain);
    h.chain.block = async () => { throw new Error("rpc down"); };
    for (let i = 0; i < 3; i++) { await h.app.scheduler.tick(); c.advance(10 * MIN); }
    let s2 = (await get(h, `/schedules/${id2}`)).body;
    assert.deepEqual(s2.latest.map((x: any) => x.status), ["failed", "failed", "failed"]);
    assert.equal(s2.status, "paused");
    assert.match(s2.statusReason, /3 consecutive failures/);
    assert.equal(s2.runsRemaining, 5, "failed runs cost nothing");
    h.chain.block = realBlock;
    const stranger = privateKeyToAccount(generatePrivateKey());
    const top = await pay(h, stranger, "schedule.topup", { scheduleId: id2, runs: 2 });
    assert.equal(top.submit.body.admission.result.runsAdded, 2);
    assert.equal(top.quote.body.order.quote.payment.amount, String(2n * 100n * 10n ** 18n));
    s2 = (await get(h, `/schedules/${id2}`)).body;
    assert.equal(s2.status, "active");
    assert.equal(s2.runsRemaining, 7);
    assert.ok(Date.parse(s2.nextRunAt) > c.now());
    const unknown = await pay(h, stranger, "schedule.topup", { scheduleId: "3b589ab6-de1e-416c-ac37-1fca5aef3179", runs: 1 });
    assert.equal(unknown.quote.status, 422);
    const list = (await get(h, `/schedules?owner=${owner.address}`)).body;
    assert.equal(list.count, 2);
  } finally {
    await h.close();
  }
});
