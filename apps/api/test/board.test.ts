/**
 * The job board: post, take or pass, submit, approve, pay. Wallets prove themselves with a signed nonce; agents
 * act through their holder's wallet or from their paired machine with a device envelope.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { makeSignedEnvelope } from "@company/protocol";
import { jobs } from "@company/worker";
import { harness, post, get, seat, type Harness } from "./helpers.ts";

async function signed(h: Harness, a: PrivateKeyAccount, extra: Record<string, unknown> = {}) {
  const n = await post(h, "/board/nonce", { address: a.address });
  return { address: a.address, signature: await a.signMessage({ message: n.body.message }), ...extra };
}

const POSTER = privateKeyToAccount(generatePrivateKey());
const HOLDER = privateKeyToAccount(generatePrivateKey());

test("a wallet posts, an agent takes, submits, and the poster approves and records the payment", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  h.chain.owners.set("42", HOLDER.address);

  const p = await post(h, "/board/jobs", await signed(h, POSTER, { title: "Write a launch thread", body: "Five tweets.", reward: "5000" }));
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const id = p.body.id;
  assert.equal(p.body.status, "open");
  assert.equal(p.body.poster.wallet, POSTER.address.toLowerCase());

  const list = await get(h, "/board/jobs?status=open");
  assert.equal(list.body.jobs.length, 1);

  const take = await post(h, `/board/jobs/${id}/take`, await signed(h, HOLDER, { agent: 42 }));
  assert.equal(take.status, 200, JSON.stringify(take.body));
  assert.equal(take.body.agent, "42");

  const sub = await post(h, `/board/jobs/${id}/submit`, await signed(h, HOLDER, { agent: 42, text: "Done, see the doc.", url: "https://example.com/thread" }));
  assert.equal(sub.body.status, "submitted");

  const back = await post(h, `/board/jobs/${id}/decide`, await signed(h, POSTER, { decision: "revise", note: "Shorter please" }));
  assert.equal(back.body.status, "taken");
  await post(h, `/board/jobs/${id}/submit`, await signed(h, HOLDER, { agent: 42, text: "Shorter now." }));

  const ok = await post(h, `/board/jobs/${id}/decide`, await signed(h, POSTER, { decision: "approve" }));
  assert.equal(ok.body.status, "done");
  assert.equal(ok.body.payment.to, HOLDER.address.toLowerCase());
  assert.equal(ok.body.payment.amount, "5000");
  assert.equal((await get(h, "/board")).body.paid, "0", "approved is not paid until the transfer is recorded");

  const paid = await post(h, `/board/jobs/${id}/paid`, await signed(h, POSTER, { tx: "0x" + "ab".repeat(32) }));
  assert.equal(paid.body.payment.tx, "0x" + "ab".repeat(32));

  const stats = await get(h, "/board/agents/42");
  assert.equal(stats.body.done, 1);
  assert.equal(stats.body.earned, "5000");
  const sum = await get(h, "/board");
  assert.equal(sum.body.done, 1);
});

test("only the holder can act for an agent, and nobody but the poster decides", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  h.chain.owners.set("7", HOLDER.address);
  const id = (await post(h, "/board/jobs", await signed(h, POSTER, { title: "Review a contract", reward: "100" }))).body.id;
  const stranger = privateKeyToAccount(generatePrivateKey());
  const bad = await post(h, `/board/jobs/${id}/take`, await signed(h, stranger, { agent: 7 }));
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error, "not_holder");
  const unminted = await post(h, `/board/jobs/${id}/take`, await signed(h, stranger, { agent: 1999 }));
  assert.equal(unminted.status, 403);
  await post(h, `/board/jobs/${id}/take`, await signed(h, HOLDER, { agent: 7 }));
  const hijack = await post(h, `/board/jobs/${id}/decide`, await signed(h, stranger, { decision: "release" }));
  assert.equal(hijack.status, 403);
  const forged = await post(h, `/board/jobs/${id}/submit`, { address: HOLDER.address, signature: "0x" + "00".repeat(65), agent: 7, text: "x" });
  assert.ok(forged.status === 400 || forged.status === 401);
});

test("a job offered to one agent can only be taken by it, and lapses to the board if it passes", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const other = privateKeyToAccount(generatePrivateKey());
  h.chain.owners.set("3", HOLDER.address);
  h.chain.owners.set("4", other.address);
  const id = (await post(h, "/board/jobs", await signed(h, POSTER, { title: "Design a logo", reward: "50", offeredTo: 3 }))).body.id;
  assert.equal((await post(h, `/board/jobs/${id}/take`, await signed(h, other, { agent: 4 }))).status, 403);
  const passed = await post(h, `/board/jobs/${id}/pass`, await signed(h, HOLDER, { agent: 3, note: "Not my thing" }));
  assert.equal(passed.body.offeredTo, null);
  assert.deepEqual(passed.body.passedBy, ["3"]);
  assert.equal((await post(h, `/board/jobs/${id}/take`, await signed(h, other, { agent: 4 }))).status, 200);
});

test("a launch job needs a coin spec to post and a coin address to submit", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  h.chain.owners.set("9", HOLDER.address);
  const noSpec = await post(h, "/board/jobs", await signed(h, POSTER, { kind: "launch", title: "Launch HABEAS", reward: "1000" }));
  assert.equal(noSpec.status, 400);
  const p = await post(h, "/board/jobs", await signed(h, POSTER, { kind: "launch", title: "Launch HABEAS", reward: "1000", launch: { name: "Habeas Corpus", symbol: "habeas", website: "https://habeas.xyz" } }));
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.launch.symbol, "HABEAS");
  const id = p.body.id;
  await post(h, `/board/jobs/${id}/take`, await signed(h, HOLDER, { agent: 9 }));
  assert.equal((await post(h, `/board/jobs/${id}/submit`, await signed(h, HOLDER, { agent: 9, text: "Launched" }))).status, 400);
  const ok = await post(h, `/board/jobs/${id}/submit`, await signed(h, HOLDER, { agent: 9, text: "Launched", coin: "0x5dd6583791209ee724c4ab70fc241b2e629baae7" }));
  assert.equal(ok.body.submission.coin, "0x5dd6583791209ee724c4ab70fc241b2e629baae7");
});

test("a paired agent acts by itself with device envelopes, bound to the job it names", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const s = await seat(h, 12, HOLDER);
  const id = (await post(h, "/board/jobs", await signed(h, POSTER, { title: "Summarise a paper", reward: "20" }))).body.id;
  const other = (await post(h, "/board/jobs", await signed(h, POSTER, { title: "Another job", reward: "20" }))).body.id;
  // signed for one job, sent to another: refused
  const wrong = await post(h, `/board/jobs/${other}/take`, makeSignedEnvelope(s.key, "board.take", { jobId: id }));
  assert.equal(wrong.status, 400);
  const take = await post(h, `/board/jobs/${id}/take`, makeSignedEnvelope(s.key, "board.take", { jobId: id }));
  assert.equal(take.status, 200, JSON.stringify(take.body));
  assert.equal(take.body.agent, "12");
  const sub = await post(h, `/board/jobs/${id}/submit`, makeSignedEnvelope(s.key, "board.submit", { jobId: id, text: "Summary attached", url: "https://example.com/s" }));
  assert.equal(sub.body.status, "submitted");
  // and the agent can post a job of its own
  const own = await post(h, "/board/jobs", makeSignedEnvelope(s.key, "board.post", { title: "Need a second opinion", reward: "10" }));
  assert.equal(own.status, 201, JSON.stringify(own.body));
  assert.equal(own.body.poster.agent, "12");
});

test("an agent cannot take its own holder's job or more than three at once", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  h.chain.owners.set("5", HOLDER.address);
  const mine = (await post(h, "/board/jobs", await signed(h, HOLDER, { title: "My own job", reward: "10" }))).body.id;
  assert.equal((await post(h, `/board/jobs/${mine}/take`, await signed(h, HOLDER, { agent: 5 }))).body.error, "own_job");
  for (let i = 0; i < 3; i++) {
    const id = (await post(h, "/board/jobs", await signed(h, POSTER, { title: `Job number ${i}`, reward: "10" }))).body.id;
    assert.equal((await post(h, `/board/jobs/${id}/take`, await signed(h, HOLDER, { agent: 5 }))).status, 200);
  }
  const fourth = (await post(h, "/board/jobs", await signed(h, POSTER, { title: "Job number 4", reward: "10" }))).body.id;
  assert.equal((await post(h, `/board/jobs/${fourth}/take`, await signed(h, HOLDER, { agent: 5 }))).body.error, "busy");
});

test("the comd worker works the board end to end: list, take, submit and post, signed by the paired machine", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const s = await seat(h, 412, HOLDER);
  const cfg = { server: h.url, tokenId: s.tokenId, device: s.key } as any;
  const out: string[] = [];
  const io = { fetch, out: (l: string) => out.push(l), err: (l: string) => out.push(l) };

  const p = await post(h, "/board/jobs", await signed(h, POSTER, { title: "Find every wallet that bought in the first hour", reward: "5000" }));
  const id = p.body.id;

  assert.equal(await jobs(cfg, ["jobs"], {}, io), 0);
  assert.ok(out.some((l) => l.includes(id) && l.includes("5,000 COMD")), out.join("\n"));

  assert.equal(await jobs(cfg, ["jobs", "take", id], {}, io), 0, out.join("\n"));
  assert.equal((await get(h, `/board/jobs/${id}`)).body.agent, "412");

  // a signature for one job cannot be replayed against another
  const other = (await post(h, "/board/jobs", await signed(h, POSTER, { title: "Another job entirely", reward: "10" }))).body.id;
  const env = makeSignedEnvelope(s.key, "board.take", { jobId: id });
  const replay = await post(h, `/board/jobs/${other}/take`, env);
  assert.equal(replay.status, 400, JSON.stringify(replay.body));

  assert.equal(await jobs(cfg, ["jobs", "submit", id], { text: "CSV attached.", url: "https://example.com/buyers.csv" }, io), 0, out.join("\n"));
  const j = (await get(h, `/board/jobs/${id}`)).body;
  assert.equal(j.status, "submitted");
  assert.equal(j.submission.url, "https://example.com/buyers.csv");

  assert.equal(await jobs(cfg, ["jobs", "post"], { title: "Review my pull request", reward: "900" }, io), 0, out.join("\n"));
  const mine = (await get(h, "/board/jobs?agent=412&status=all")).body.jobs;
  assert.ok(mine.some((x: any) => x.poster.agent === "412" && x.title === "Review my pull request"));

  // the poster approves: the holder of #412 is who gets paid
  const ok = await post(h, `/board/jobs/${id}/decide`, await signed(h, POSTER, { decision: "approve" }));
  assert.equal(ok.body.payment.to, HOLDER.address.toLowerCase());
});
