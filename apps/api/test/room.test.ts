/**
 * The Holders Room. What is worth proving: a wallet cannot get in without signing, cannot get in without holding,
 * a removed wallet is really gone, and the payout ledger cannot be made to lie — not by double review, not by
 * removing someone you owe, not by marking the same submission paid twice.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { harness, type Harness } from "./helpers.ts";
import { ROOM_LIMITS } from "../src/room.ts";

const open: Harness[] = [];
test.after(async () => { for (const h of open) await h.close(); });

const HOLDER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ADMIN = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const STRANGER = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");

/** Sign in for real: nonce → signature → session. Holdings are stubbed on the app's chain reader. */
async function enter(app: any, account: typeof HOLDER) {
  const { nonce } = app.room.nonce(account.address);
  const signature = await account.signMessage({ message: app.room.message(account.address.toLowerCase(), nonce) });
  return app.room.signIn(account.address, signature);
}

/** A room whose chain says exactly who holds what. */
async function appWithHoldings(holders: Record<string, { counsel?: number; comd?: bigint }>) {
  const h = await harness({ listen: false, env: { ROOM_ADMINS: ADMIN.address, PROMO_REWARD_COMD: "100" } });
  open.push(h);
  const of = (a: string) => holders[a.toLowerCase()] ?? {};
  const chain = h.app.chain as any;
  chain.call = async (_to: string, data: string) => "0x" + BigInt(of("0x" + data.slice(-40)).counsel ?? 0).toString(16).padStart(64, "0");
  chain.erc20Balance = async (_t: string, owner: string) => of(owner).comd ?? 0n;
  return h.app as any;
}

test("a wallet holding nothing is refused, however well it signs", async () => {
  const app = await appWithHoldings({});
  await assert.rejects(() => enter(app, STRANGER), /not_a_holder|holding/i);
});

test("one Counsel is enough, and so is any $COMD", async () => {
  const byNft = await appWithHoldings({ [HOLDER.address.toLowerCase()]: { counsel: 1 } });
  assert.ok((await enter(byNft, HOLDER)).token);
  const byToken = await appWithHoldings({ [HOLDER.address.toLowerCase()]: { comd: 1n } });
  assert.ok((await enter(byToken, HOLDER)).token);
});

test("a signature cannot be replayed: the nonce is spent", async () => {
  const app = await appWithHoldings({ [HOLDER.address.toLowerCase()]: { comd: 1n } });
  const { nonce } = app.room.nonce(HOLDER.address);
  const signature = await HOLDER.signMessage({ message: app.room.message(HOLDER.address.toLowerCase(), nonce) });
  assert.ok(await app.room.signIn(HOLDER.address, signature));
  await assert.rejects(() => app.room.signIn(HOLDER.address, signature), /fresh nonce/i);
});

test("someone else's signature does not open your wallet's session", async () => {
  const app = await appWithHoldings({ [HOLDER.address.toLowerCase()]: { comd: 1n }, [STRANGER.address.toLowerCase()]: { comd: 1n } });
  const { nonce } = app.room.nonce(HOLDER.address);
  const wrong = await STRANGER.signMessage({ message: app.room.message(HOLDER.address.toLowerCase(), nonce) });
  await assert.rejects(() => app.room.signIn(HOLDER.address, wrong), /bad_signature|recover/i);
});

test("no session, no speaking", async () => {
  const app = await appWithHoldings({});
  assert.throws(() => app.room.say("not-a-real-token", "hello"), /sign_in_required|sign in/i);
});

test("only an admin reviews, and a submission is reviewed once", async () => {
  const holders = { [HOLDER.address.toLowerCase()]: { comd: 5n }, [ADMIN.address.toLowerCase()]: { comd: 5n } };
  const app = await appWithHoldings(holders);
  const h = await enter(app, HOLDER);
  const a = await enter(app, ADMIN);
  const promo = app.room.submit(h.token, { url: "https://x.com/someone/status/1", kind: "post", note: "a thread" });

  assert.throws(() => app.room.review(h.token, promo.id, "accept", ""), /admin/i);
  const accepted = app.room.review(a.token, promo.id, "accept", "good");
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.rewardComd, "100");
  assert.throws(() => app.room.review(a.token, promo.id, "accept", ""), /already/i);
});

test("the ledger owes what was accepted, and marking paid settles it once", async () => {
  const holders = { [HOLDER.address.toLowerCase()]: { comd: 5n }, [ADMIN.address.toLowerCase()]: { comd: 5n } };
  const app = await appWithHoldings(holders);
  const h = await enter(app, HOLDER);
  const a = await enter(app, ADMIN);
  for (const n of [1, 2, 3]) {
    const p = app.room.submit(h.token, { url: `https://x.com/someone/status/${n}`, kind: "post", note: "" });
    app.room.review(a.token, p.id, n === 3 ? "reject" : "accept", "");
  }
  const owed = app.room.owed();
  assert.equal(owed.length, 1);
  assert.equal(owed[0].accepted, 2, "two accepted, one rejected");
  assert.equal(owed[0].comd, "200");

  const settled = app.room.markPaid(a.token, HOLDER.address, "0x" + "ab".repeat(32));
  assert.equal(settled.settled, 2);
  assert.equal(settled.comd, "200");
  assert.equal(app.room.owed().length, 0, "nothing owed after paying");
  assert.equal(app.room.markPaid(a.token, HOLDER.address, "").settled, 0, "paying twice settles nothing twice");
});

test("removing a wallet clears its messages and pending posts, keeps what it is owed, and locks it out", async () => {
  const holders = { [HOLDER.address.toLowerCase()]: { comd: 5n }, [ADMIN.address.toLowerCase()]: { comd: 5n } };
  const app = await appWithHoldings(holders);
  const h = await enter(app, HOLDER);
  const a = await enter(app, ADMIN);
  app.room.say(h.token, "hello room");
  const paidFor = app.room.submit(h.token, { url: "https://x.com/someone/status/9", kind: "post", note: "" });
  app.room.review(a.token, paidFor.id, "accept", "");
  app.room.submit(h.token, { url: "https://x.com/someone/status/10", kind: "post", note: "" });

  const out = app.room.remove(a.token, HOLDER.address, "spam");
  assert.equal(out.messages, 1);
  assert.equal(out.pending, 1);
  assert.equal(app.room.list().length, 0, "their messages are gone");
  assert.equal(app.room.owed()[0]?.comd, "100", "an accepted reward survives removal — a ban is not a way to avoid paying");
  assert.equal(app.room.session(h.token), null, "their session is dead");
  await assert.rejects(() => enter(app, HOLDER), /removed/i);

  app.room.readmit(a.token, HOLDER.address);
  assert.ok((await enter(app, HOLDER)).token, "and they can be let back in");
});

test("an admin wallet cannot be removed", async () => {
  const holders = { [ADMIN.address.toLowerCase()]: { comd: 5n } };
  const app = await appWithHoldings(holders);
  const a = await enter(app, ADMIN);
  assert.throws(() => app.room.remove(a.token, ADMIN.address, ""), /admin/i);
});

test("the same link cannot be submitted twice, and the daily cap holds", async () => {
  const app = await appWithHoldings({ [HOLDER.address.toLowerCase()]: { comd: 5n } });
  const h = await enter(app, HOLDER);
  app.room.submit(h.token, { url: "https://x.com/a/1", kind: "post", note: "" });
  assert.throws(() => app.room.submit(h.token, { url: "https://X.com/a/1", kind: "post", note: "" }), /already been submitted/i);
  for (let i = 2; i <= ROOM_LIMITS.promosPerDay; i++) app.room.submit(h.token, { url: `https://x.com/a/${i}`, kind: "post", note: "" });
  assert.throws(() => app.room.submit(h.token, { url: "https://x.com/a/99", kind: "post", note: "" }), /limit/i);
});

test("a submission must be an https link", async () => {
  const app = await appWithHoldings({ [HOLDER.address.toLowerCase()]: { comd: 5n } });
  const h = await enter(app, HOLDER);
  for (const url of ["", "notalink", "http://x.com/a/1", "javascript:alert(1)"]) {
    assert.throws(() => app.room.submit(h.token, { url, kind: "post", note: "" }), /https/i, url);
  }
});
