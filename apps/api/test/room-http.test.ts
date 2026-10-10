/**
 * The room over real HTTP: every route as a browser would call it, including the Authorization header, the path
 * params and the status codes. The unit tests drive the module directly, so a typo in a route path or a wrong param
 * name would not show up there — this is the one that catches it.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { harness, type Harness } from "./helpers.ts";

const HOLDER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ADMIN = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const POOR = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");

async function room() {
  const h: Harness = await harness({ env: { ROOM_ADMINS: ADMIN.address, PROMO_REWARD_COMD: "100" } });
  const holders: Record<string, { counsel?: number; comd?: bigint }> = {
    [HOLDER.address.toLowerCase()]: { counsel: 1 },
    [ADMIN.address.toLowerCase()]: { comd: 10n ** 18n },
  };
  const chain = h.app.chain as any;
  chain.call = async (_to: string, data: string) => "0x" + BigInt(holders["0x" + data.slice(-40)]?.counsel ?? 0).toString(16).padStart(64, "0");
  chain.erc20Balance = async (_t: string, owner: string) => holders[owner.toLowerCase()]?.comd ?? 0n;

  const call = async (path: string, opts: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${h.url}/room${path}`, {
      method: opts.method ?? "GET",
      headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };

  const signIn = async (account: typeof HOLDER) => {
    const n = await call("/nonce", { method: "POST", body: { address: account.address } });
    assert.equal(n.status, 200, "nonce");
    const signature = await account.signMessage({ message: n.body.message });
    const s = await call("/session", { method: "POST", body: { address: account.address, signature } });
    return s;
  };

  return { h, call, signIn };
}

test("the whole room, over HTTP, the way the page calls it", async (t) => {
  const { h, call, signIn } = await room();
  t.after(() => h.close());

  // the public header
  const stats = await call("");
  assert.equal(stats.status, 200);
  assert.equal(stats.body.rewardComd, "100");

  // the door, before signing
  const standing = await call(`/standing/${HOLDER.address}`);
  assert.equal(standing.status, 200);
  assert.equal(standing.body.counsel, 1);
  assert.equal(standing.body.mayEnter, true);

  // a wallet holding nothing is told so, and refused a session
  const poor = await call(`/standing/${POOR.address}`);
  assert.equal(poor.body.mayEnter, false);
  const refused = await signIn(POOR);
  assert.equal(refused.status, 403, "a wallet with nothing cannot get a session");

  // in
  const holder = await signIn(HOLDER);
  assert.equal(holder.status, 200);
  const token = holder.body.token as string;
  assert.ok(token);

  const me = await call("/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.admin, false);
  assert.equal((await call("/me")).status, 401, "no token, no me");

  // chat
  assert.equal((await call("/messages", { method: "POST", body: { text: "first" }, token })).status, 201);
  assert.equal((await call("/messages", { method: "POST", body: { text: "second" } })).status, 401, "no token, no posting");
  const msgs = await call("/messages");
  assert.equal(msgs.body.messages.length, 1);
  assert.equal(msgs.body.messages[0].text, "first");

  // a holder deletes their own
  const id = msgs.body.messages[0].id;
  assert.equal((await call(`/messages/${id}/delete`, { method: "POST", token })).status, 200);
  assert.equal((await call("/messages")).body.messages.length, 0);

  // a submission
  const sub = await call("/promos", { method: "POST", body: { url: "https://x.com/me/status/1", kind: "thesis", note: "my thesis" }, token });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.status, "pending");
  assert.equal((await call("/promos", { method: "POST", body: { url: "not-a-url" }, token })).status, 400);

  // a holder cannot review, and cannot see the ledger
  assert.equal((await call(`/promos/${sub.body.id}/review`, { method: "POST", body: { decision: "accept" }, token })).status, 403);
  assert.equal((await call("/payouts", { token })).status, 403);

  // the admin can
  const admin = await signIn(ADMIN);
  assert.equal(admin.status, 200);
  const at = admin.body.token as string;
  assert.equal(admin.body.standing.admin, true);

  const reviewed = await call(`/promos/${sub.body.id}/review`, { method: "POST", body: { decision: "accept", reason: "clear" }, token: at });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.status, "accepted");

  const owed = await call("/payouts", { token: at });
  assert.equal(owed.status, 200);
  assert.equal(owed.body.owed.length, 1);
  assert.equal(owed.body.owed[0].comd, "100");
  assert.equal(owed.body.owed[0].address.toLowerCase(), HOLDER.address.toLowerCase());

  const paid = await call(`/payouts/${HOLDER.address}/paid`, { method: "POST", body: { txHash: "0x" + "cd".repeat(32) }, token: at });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.settled, 1);
  assert.equal((await call("/payouts", { token: at })).body.owed.length, 0);

  // removal, over HTTP
  await call("/messages", { method: "POST", body: { text: "still here" }, token });
  const removed = await call(`/members/${HOLDER.address}/remove`, { method: "POST", body: { reason: "test" }, token: at });
  assert.equal(removed.status, 200);
  assert.equal((await call("/messages")).body.messages.length, 0, "their messages went with them");
  assert.equal((await call("/me", { token })).status, 401, "their session is dead");
  assert.equal((await signIn(HOLDER)).status, 403, "and they cannot come back");

  assert.equal((await call(`/members/${HOLDER.address}/readmit`, { method: "POST", token: at })).status, 200);
  assert.equal((await signIn(HOLDER)).status, 200, "until they are let back in");
});

test("the deployer wallet is an admin without being in ROOM_ADMINS, and gets in holding nothing", async (t) => {
  const h: Harness = await harness({ env: {} });
  t.after(() => h.close());
  const chain = h.app.chain as any;
  chain.call = async () => "0x" + "0".repeat(64);
  chain.erc20Balance = async () => 0n;

  const DEPLOYER = "0x71A2e394A20bea28C6C80Dbdc8e238Da40050E29";
  const s = await (await fetch(`${h.url}/room/standing/${DEPLOYER}`)).json() as any;
  assert.equal(s.admin, true, "the deployer is an admin with no configuration at all");
  assert.equal(s.counsel, 0);
  assert.equal(s.comd, "0");
  assert.equal(s.mayEnter, true, "and is let in holding nothing, so the room cannot lock its owner out");
});
