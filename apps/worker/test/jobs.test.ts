import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkSignedEnvelope } from "@company/protocol";
import { loadConfig } from "../src/config.ts";
import { jobs } from "../src/jobs.ts";
import { parseArgs } from "../src/cli.ts";

const JOB = { id: "job_1", kind: "task", title: "Write a thread", body: "Five tweets.", reward: "2500", status: "open", createdAt: new Date().toISOString(),
  poster: { wallet: "0xabc", agent: null }, offeredTo: null, agent: null, launch: null, submission: null };

function rig(tokenId: string | null = "412") {
  const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), "company-jobs-")), "http://board.test");
  cfg.tokenId = tokenId as never;
  const calls: { url: string; method: string; body: any }[] = [];
  const out: string[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    const json = url.includes("/board/jobs?") ? { jobs: [JOB] } : { ...JOB, status: url.endsWith("/take") ? "taken" : JOB.status, agent: "412" };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { cfg, calls, out, io: { fetch, out: (l: string) => out.push(l), err: (l: string) => out.push(l) } };
}

test("comd jobs: lists open jobs and the agent's jobs in hand", async () => {
  const r = rig();
  assert.equal(await jobs(r.cfg, ["jobs"], {}, r.io), 0);
  assert.deepEqual(r.calls.map((c) => c.url), ["http://board.test/board/jobs?status=open", "http://board.test/board/jobs?agent=412&status=all"]);
  assert.ok(r.out.some((l) => l.includes("job_1") && l.includes("2,500 COMD") && l.includes("Write a thread")));
});

test("comd jobs take/pass/submit: device-signed envelopes that name the job", async () => {
  for (const [sub, kind, flags] of [["take", "board.take", {}], ["pass", "board.pass", { note: "not my field" }], ["submit", "board.submit", { text: "Done", url: "https://x.test/r" }]] as const) {
    const r = rig();
    assert.equal(await jobs(r.cfg, ["jobs", sub, "job_1"], flags, r.io), 0, sub);
    const c = r.calls[0];
    assert.equal(c.method, "POST");
    assert.equal(c.url, `http://board.test/board/jobs/job_1/${sub}`);
    assert.equal(c.body.deviceKey, r.cfg.device.deviceKey);
    assert.equal(c.body.payload.jobId, "job_1");
    assert.deepEqual(checkSignedEnvelope(c.body, kind), { ok: true }, `${sub} envelope verifies`);
    assert.equal(checkSignedEnvelope(c.body, "board.take").ok, kind === "board.take", "an envelope is only good for its own kind");
  }
});

test("comd jobs post: posts as the paired agent; submit needs --text; unpaired devices are refused", async () => {
  const r = rig();
  assert.equal(await jobs(r.cfg, ["jobs", "post"], { title: "Review my PR", reward: "9000", to: "7" }, r.io), 0);
  assert.equal(r.calls[0].url, "http://board.test/board/jobs");
  assert.deepEqual({ ...r.calls[0].body.payload, nonce: undefined, expiresAt: undefined }, { kind: "task", title: "Review my PR", reward: "9000", body: "", offeredTo: "7", nonce: undefined, expiresAt: undefined });
  await assert.rejects(jobs(r.cfg, ["jobs", "submit", "job_1"], {}, r.io), /--text/);
  const u = rig(null);
  await assert.rejects(jobs(u.cfg, ["jobs", "take", "job_1"], {}, u.io), /not paired/);
  assert.equal(u.calls.length, 0);
});

test("parseArgs: jobs flags take values", () => {
  assert.deepEqual(parseArgs(["jobs", "submit", "job_1", "--text", "Done it", "--url", "https://x.test"]), { cmd: ["jobs", "submit", "job_1"], flags: { text: "Done it", url: "https://x.test" } });
});
