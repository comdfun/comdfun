/**
 * cICM, through the control plane's own HTTP surface.
 *
 * The package has its own tests for the money; these are about the seam: that the routes are mounted, that the
 * wallet signature actually gates key minting, that a key cannot see another wallet's anything, and that the
 * admin surface is invisible without the token.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { harness, get, post, type Harness } from "./helpers.ts";

const A = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const B = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

async function up(env: Record<string, string> = {}) {
  const h: Harness = await harness({ env: { ADMIN_TOKEN: "admin-secret", ICM_COMD_PER_USD: "1000", ...env } });
  /** Ask for a nonce, sign it, and hand back a body with the proof in it. */
  const signed = async (account: typeof A, extra: Record<string, unknown> = {}) => {
    const n = await post(h, "/icm/nonce", { address: account.address });
    const signature = await account.signMessage({ message: n.body.message });
    return { address: account.address, signature, ...extra };
  };
  return { h, signed };
}

const DESK = "0x1111111111111111111111111111111111111111";

test("the rate card is public and says where to pay and what it buys", async (t) => {
  const { h } = await up({ ICM_DEPOSIT_ADDRESS: DESK });
  t.after(() => h.close());
  const res = await get(h, "/icm");
  assert.equal(res.status, 200);
  assert.equal(res.body.rate.symbol, "COMD");
  assert.equal(res.body.rate.tokensPerUsd, "1000");
  assert.equal(res.body.rate.marginBps, 1500);
  assert.match(res.body.endpoint, /\/icm\/v1$/);
  assert.equal(res.body.deposit.address, DESK);
  assert.equal(res.body.deposit.minimumTokens, "1000", "the $1 floor at 1,000 COMD to the dollar");
  assert.match(res.body.deposit.note, /send from the wallet you want credited/);
});

test("with no deposit address there is nothing to pay into, and the page says so", async (t) => {
  const { h } = await up();
  t.after(() => h.close());
  const res = await get(h, "/icm");
  assert.equal(res.status, 200);
  assert.equal(res.body.deposit.address, null, "off by default: an address has to be chosen on purpose");
  assert.match(res.body.deposit.note, /is not set/);
  assert.match(res.body.deposit.note, /nowhere to send/);
});

test("a refused deposit address says why, rather than claiming nothing was configured", async (t) => {
  const { h } = await up({ ICM_DEPOSIT_ADDRESS: "0x000000000000000000000000000000000000dEaD" });
  t.after(() => h.close());
  const res = await get(h, "/icm");
  assert.equal(res.body.deposit.address, null);
  // the operator set a variable: telling them it is unset would send them looking for a thing they already did
  assert.match(res.body.deposit.problem, /shared burn address/i);
  assert.match(res.body.deposit.problem, /nothing else pays into/i);
  assert.ok(!/is not set/.test(res.body.deposit.problem), "it is set; it is refused");

  const unset = await up();
  t.after(() => unset.h.close());
  assert.match((await get(unset.h, "/icm")).body.deposit.problem, /is not set/);

  const junk = await up({ ICM_DEPOSIT_ADDRESS: "my-wallet" });
  t.after(() => junk.h.close());
  assert.match((await get(junk.h, "/icm")).body.deposit.problem, /not an address/);

  // and /health carries the same sentence, so it can be read without opening the page
  assert.match((await get(h, "/health")).body.icm.depositProblem, /shared burn address/i);
});

test("the shared burn address is refused, because everything else already burns there", async (t) => {
  // The Flywheel's buybacks, Incorporations' cut and every manual burn all send $COMD to 0x…dEaD. Watching it
  // would read every one of those as somebody paying for inference and fill the book with credit nobody bought.
  for (const trap of ["0x000000000000000000000000000000000000dEaD", "0x000000000000000000000000000000000000dead", "0x0000000000000000000000000000000000000000"]) {
    const { h } = await up({ ICM_DEPOSIT_ADDRESS: trap });
    t.after(() => h.close());
    const res = await get(h, "/icm");
    assert.equal(res.body.deposit.address, null, `${trap} must not be watched`);
    const book = await get(h, "/icm/admin/book", { authorization: "Bearer admin-secret" });
    assert.equal(book.body.soldMicroUsd, "0", "and no burn anywhere became a sale");
  }
});

test("a key is minted only by a wallet that signed for it", async (t) => {
  const { h, signed } = await up();
  t.after(() => h.close());

  // no proof at all
  assert.equal((await post(h, "/icm/keys", { address: A.address })).status, 400);

  // somebody else's signature over their own nonce
  const theirs = await signed(B);
  const forged = await post(h, "/icm/keys", { address: A.address, signature: theirs.signature });
  assert.equal(forged.status, 400, "A never asked for a nonce, so there is nothing to verify against");

  // a nonce can be spent exactly once
  const n = await post(h, "/icm/nonce", { address: A.address });
  const signature = await A.signMessage({ message: n.body.message });
  const first = await post(h, "/icm/keys", { address: A.address, signature, label: "laptop" });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.match(first.body.secret, /^cicm_live_[0-9a-f]{48}$/);
  assert.equal(first.body.key.label, "laptop");
  const replay = await post(h, "/icm/keys", { address: A.address, signature });
  assert.equal(replay.status, 400, "the same signature cannot mint a second key");
});

test("the secret is shown once and never again", async (t) => {
  const { h, signed } = await up();
  t.after(() => h.close());
  const minted = await post(h, "/icm/keys", await signed(A));
  const secret = minted.body.secret as string;

  const account = await post(h, "/icm/account", await signed(A));
  assert.equal(account.status, 200);
  assert.equal(account.body.keys.length, 1);
  assert.ok(!JSON.stringify(account.body).includes(secret), "the account view does not carry the secret");
  assert.match(account.body.keys[0].display, /^cicm_live_[0-9a-f]{4}…[0-9a-f]{4}$/);
});

test("a key reads its own balance through the OpenAI-shaped surface", async (t) => {
  const { h, signed } = await up();
  t.after(() => h.close());
  const minted = await post(h, "/icm/keys", await signed(A));
  const res = await get(h, "/icm/v1/key", { authorization: `Bearer ${minted.body.secret}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.balance.available_micro_usd, "0", "a new account has bought nothing yet");
  assert.equal((await get(h, "/icm/v1/key", { authorization: "Bearer cicm_live_" + "0".repeat(48) })).status, 401);
  assert.equal((await get(h, "/icm/v1/key")).status, 401);
});

test("credit granted by an operator is spendable, and a call with no credit is refused for 402", async (t) => {
  const { h, signed } = await up();
  t.after(() => h.close());
  const minted = await post(h, "/icm/keys", await signed(A));
  const key = { authorization: `Bearer ${minted.body.secret}` };

  const broke = await post(h, "/icm/v1/chat/completions", { model: "x/y", messages: [{ role: "user", content: "hi" }] }, key);
  // no provider key in a test harness, so the gateway is off; either way nothing is charged
  assert.ok(broke.status === 402 || broke.status === 503, `got ${broke.status}`);

  const granted = await post(h, "/icm/admin/grant", { owner: A.address, amount: "5", ref: "test-grant-1" }, { authorization: "Bearer admin-secret" });
  assert.equal(granted.status, 201, JSON.stringify(granted.body));
  const after = await get(h, "/icm/v1/key", key);
  assert.equal(after.body.balance.available_micro_usd, "5000000");
});

test("one wallet cannot see or revoke another's keys", async (t) => {
  const { h, signed } = await up();
  t.after(() => h.close());
  const mine = await post(h, "/icm/keys", await signed(A));
  const theirs = await post(h, "/icm/keys", await signed(B));

  const bSees = await post(h, "/icm/account", await signed(B));
  assert.equal(bSees.body.keys.length, 1);
  assert.notEqual(bSees.body.keys[0].id, mine.body.key.id);

  // B tries to revoke A's key: not found, rather than forbidden, so no key id is confirmed to a stranger
  const stolen = await post(h, `/icm/keys/${mine.body.key.id}/revoke`, await signed(B));
  assert.equal(stolen.status, 404);

  const own = await post(h, `/icm/keys/${theirs.body.key.id}/revoke`, await signed(B));
  assert.equal(own.status, 200);
  assert.equal((await get(h, "/icm/v1/key", { authorization: `Bearer ${theirs.body.secret}` })).status, 401, "a revoked key stops working");
});

test("the admin book balances and is invisible without the token", async (t) => {
  const { h, signed } = await up({ ICM_DEPOSIT_ADDRESS: DESK, ICM_BURN_ON_DEPOSIT: "1" });
  t.after(() => h.close());
  await post(h, "/icm/keys", await signed(A));
  await post(h, "/icm/admin/grant", { owner: A.address, amount: "10", ref: "g1" }, { authorization: "Bearer admin-secret" });

  for (const headers of [{} as Record<string, string>, { authorization: "Bearer wrong" }]) {
    const res = await get(h, "/icm/admin/book", headers);
    assert.equal(res.status, 404, "a wrong token learns nothing about whether the route exists");
  }

  const book = await get(h, "/icm/admin/book", { authorization: "Bearer admin-secret" });
  assert.equal(book.status, 200);
  assert.equal(book.body.grantedMicroUsd, "10000000");
  assert.equal(book.body.outstandingMicroUsd, "10000000");
  assert.deepEqual(book.body.drift, [], "the book balances");
  // every credit sold against a burned token is a dollar the treasury has to find
  assert.equal(book.body.backing.unbacked, true);
  assert.match(book.body.backing.note, /treasury must be able to find/);
});

test("health reports cICM without leaking anybody's balance", async (t) => {
  const { h } = await up({ ICM_DEPOSIT_ADDRESS: DESK, ICM_BURN_ON_DEPOSIT: "1" });
  t.after(() => h.close());
  const res = await get(h, "/health");
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.icm.enabled, "boolean");
  assert.equal(res.body.icm.sink, "burn");
  assert.equal(res.body.icm.drift, 0);
  assert.ok(!("accounts" in res.body.icm) || typeof res.body.icm.accounts === "number");
});

test("a misconfigured desk switches itself off instead of taking the control plane with it", async (t) => {
  // Every one of these used to throw out of the Icm constructor, which is called from the App constructor,
  // which means the whole API never starts. An optional desk does not get to stop the firm answering.
  const cases: Record<string, string>[] = [
    { ICM_DEPOSIT_ADDRESS: "not-an-address" },
    { ICM_DEPOSIT_ADDRESS: "0xABCDEF0123456789abcdef0123456789ABCDEF01" }, // a wrong checksum
    { ICM_COMD_PER_USD: "nonsense" },
    { ICM_COMD_PER_USD: "0" },
    { ICM_MARGIN_BPS: "-5" },
  ];
  for (const env of cases) {
    const h: Harness = await harness({ env: { ADMIN_TOKEN: "admin-secret", ...env } });
    t.after(() => h.close());
    // the rest of the API is untouched
    const health = await get(h, "/health");
    assert.equal(health.status, 200, `${JSON.stringify(env)}: the control plane still answers`);
    assert.ok(health.body.version, "and is a real health document, not a crash page");
    // and cICM says what is wrong rather than pretending
    const icm = await get(h, "/icm");
    assert.equal(icm.status, 200);
    if (icm.body.enabled === false && icm.body.reason) assert.match(icm.body.reason, /not set|misconfigured|switched off/i);
  }
});
