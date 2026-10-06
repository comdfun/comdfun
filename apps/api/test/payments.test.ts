import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { decodeHeaderJson, newRequestToken, signPayment, encodeHeaderJson, type PaymentRequired } from "@company/protocol";
import { harness, pay, post, get, clock, resign, COMD, PAYTO, type Harness } from "./helpers.ts";

const JOB = { objective: "Write a README for an ERC-20 project.", skill: "write-readme-and-docs", paths: ["README.md"] };

describe("paid requests (x402 v2 exact/permit2 in COMD)", () => {
  let h: Harness;
  const payer = privateKeyToAccount(generatePrivateKey());
  before(async () => { h = await harness({ env: { SETTLE_WAIT_MS: "100", ALLOWED_ORIGINS: "https://comd.fun" } }); });
  after(async () => { await h.close(); });

  test("capabilities and openapi describe COMD on eip155:46630 with 18 decimals and per-run schedules", async () => {
    const c = (await get(h, "/requests/capabilities")).body;
    assert.equal(c.payment.network, "eip155:46630");
    assert.equal(c.payment.asset, COMD);
    assert.equal(c.payment.decimals, 18);
    assert.equal(c.payment.symbol, "COMD");
    assert.equal(c.payment.amount, "100000000000000000000");
    assert.equal(c.quoteTtlSeconds, 600);
    assert.deepEqual(c.pricedPer, { "schedule.create": "run", "schedule.topup": "run" });
    assert.equal(c.actions.length, 7);
    assert.deepEqual(c.launches.chains.map((x: any) => x.chainId), [46630, 4663]);
    const o = (await get(h, "/openapi.json")).body;
    assert.equal(o.openapi, "3.1.0");
    assert.ok(o.paths["/requests/{id}/submit"]);
    assert.equal(o["x-company-actions"].length, 7);
  });

  test("happy path: quote 201 → 402 challenge with PAYMENT-REQUIRED → paid 200 admitted; status; paid-by", async () => {
    const r = await pay(h, payer, "job.open", JOB);
    assert.equal(r.quote.status, 201);
    assert.equal(r.quote.body.created, true);
    assert.equal(r.quote.body.order.quote.payment.amount, "100000000000000000000");
    assert.match(r.quote.body.order.quote.quoteHash, /^[0-9a-f]{64}$/);
    assert.equal(r.challenge.status, 402);
    const ch = r.challenge.body as PaymentRequired;
    assert.deepEqual(decodeHeaderJson(r.challenge.headers.get("payment-required")!), ch);
    assert.equal(ch.accepts[0].scheme, "exact");
    assert.equal(ch.accepts[0].extra.assetTransferMethod, "permit2");
    assert.equal(ch.accepts[0].extra.spender, h.settler.spender, "the Permit2 spender the payer must name (web: accepts[0].extra.spender)");
    assert.equal(ch.accepts[0].network, "eip155:46630");
    assert.equal(ch.resourceUrl, `/requests/${r.id}/submit`);
    assert.equal(r.submit.status, 200);
    assert.equal(r.submit.body.status, "admitted");
    assert.equal(r.submit.body.payment.status, "confirmed");
    assert.equal(r.submit.body.admission.result.kind, "job");
    assert.equal(r.submit.body.admission.result.launch, false);
    const st = await get(h, `/requests/${r.id}`, { authorization: `Bearer ${r.token}` });
    assert.equal(st.status, 200);
    assert.equal(st.body.status, "admitted");
    assert.equal((await get(h, `/requests/${r.id}`)).body.error, "request_token_required");
    assert.equal((await get(h, `/requests/${r.id}`, { authorization: `Bearer ${newRequestToken()}` })).status, 404);
    const pb = (await get(h, `/requests/paid-by/${payer.address}`)).body;
    assert.equal(pb.payer, payer.address.toLowerCase());
    assert.ok(pb.orders.some((o: any) => o.orderId === r.id && o.result.kind === "job"));
    assert.equal(JSON.stringify(pb).includes("objective"), false, "paid-by never includes inputs");
    const replay = await post(h, `/requests/${r.id}/submit`, { quoteSignature: r.signed!.quoteSignature }, { authorization: `Bearer ${r.token}`, "payment-signature": r.signed!.header });
    assert.equal(replay.status, 200, "same payment again is an idempotent replay");
    const other = await signPayment(r.challenge.body, payer);
    const again = await post(h, `/requests/${r.id}/submit`, { quoteSignature: other.quoteSignature }, { authorization: `Bearer ${r.token}`, "payment-signature": other.header });
    assert.equal(again.body.error, "order_not_payable");
  });

  test("bearer token, requestKey, action and input errors", async () => {
    const token = newRequestToken();
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: JOB })).body.error, "request_token_required");
    assert.equal((await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: JOB }, { authorization: "Bearer short" })).status, 401);
    assert.equal((await post(h, "/requests/quote", { requestKey: "nope", action: "job.open", input: JOB }, auth)).body.error, "invalid_request");
    assert.equal((await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.fly", input: JOB }, auth)).body.error, "invalid_request");
    const bad = await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: { objective: "" } }, auth);
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error, "invalid_input");
    assert.ok(bad.body.problems.length >= 2);
    const key = randomUUID();
    const a = await post(h, "/requests/quote", { requestKey: key, action: "job.open", input: JOB }, auth);
    const b = await post(h, "/requests/quote", { requestKey: key, action: "job.open", input: JOB }, auth);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200, "same key, same input: replay");
    assert.equal(b.body.order.id, a.body.order.id);
    const c = await post(h, "/requests/quote", { requestKey: key, action: "job.open", input: { ...JOB, objective: "something else entirely" } }, auth);
    assert.equal(c.status, 409);
    assert.equal(c.body.error, "request_key_conflict");
    const big = await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: { ...JOB, objective: "x".repeat(17 * 1024) } }, auth);
    assert.equal(big.status, 413);
    assert.equal(big.body.error, "body_over_limit");
    const cors = await post(h, "/requests/check", { action: "job.open", input: JOB }, { origin: "https://evil.example" });
    assert.equal(cors.status, 403);
    assert.equal(cors.body.error, "origin_not_allowed");
    const ok = await post(h, "/requests/check", { action: "job.open", input: JOB }, { origin: "https://comd.fun" });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://comd.fun");
  });

  test("payment errors: shape, terms, window, approval, rejection, not payable", async () => {
    const shape = await pay(h, payer, "job.open", JOB, { mutate: (s) => { s.header = encodeHeaderJson({ ...s.payment, surprise: true }); } });
    assert.equal(shape.submit.status, 400);
    assert.equal(shape.submit.body.error, "invalid_payment_shape");
    assert.match(shape.submit.body.detail, /surprise/);

    const terms = await pay(h, payer, "job.open", JOB, { mutate: (s) => { s.payment.accepted.amount = "1"; s.header = encodeHeaderJson(s.payment); } });
    assert.equal(terms.submit.body.error, "payment_terms_mismatch");
    const payTo = await pay(h, payer, "job.open", JOB, { mutate: (s) => { s.payment.payload.permit2Authorization.witness.to = COMD; s.header = encodeHeaderJson(s.payment); } });
    assert.equal(payTo.submit.body.error, "payment_terms_mismatch");
    const spender = await pay(h, payer, "job.open", JOB, { mutate: (s) => { s.payment.payload.permit2Authorization.spender = PAYTO; s.header = encodeHeaderJson(s.payment); } });
    assert.equal(spender.submit.body.error, "payment_terms_mismatch");

    const window = await pay(h, payer, "job.open", JOB, { mutate: (s) => { s.payment.payload.permit2Authorization.deadline = 1000; s.header = encodeHeaderJson(s.payment); } });
    assert.equal(window.submit.body.error, "invalid_payment_window");
    const far = await pay(h, payer, "job.open", JOB, { mutate: (s) => { s.payment.payload.permit2Authorization.deadline += 10 * 3600; s.header = encodeHeaderJson(s.payment); } });
    assert.equal(far.submit.body.error, "invalid_payment_window");

    const stranger = privateKeyToAccount(generatePrivateKey());
    const approval = await pay(h, payer, "job.open", JOB, { mutate: async (s) => { s.quoteSignature = await stranger.signMessage({ message: "not a quote approval" }); } });
    assert.equal(approval.submit.status, 400);
    assert.equal(approval.submit.body.error, "invalid_quote_approval");
    const hashDiff = await pay(h, payer, "job.open", JOB, { mutate: (s) => { s.payment.resource = { url: "/elsewhere" }; s.header = encodeHeaderJson(s.payment); } });
    assert.equal(hashDiff.submit.body.error, "invalid_quote_approval", "paymentHash covers the whole payment object");

    const forged = await pay(h, payer, "job.open", JOB, { mutate: async (s, ch) => { s.payment.payload.signature = `0x${"11".repeat(65)}`; await resign(s, ch, payer); } });
    assert.equal(forged.submit.status, 402);
    assert.equal(forged.submit.body.error, "payment_rejected");

    const poor = privateKeyToAccount(generatePrivateKey());
    h.settler.balances.set(poor.address.toLowerCase(), 1n);
    const broke = await pay(h, poor, "job.open", JOB);
    assert.equal(broke.submit.status, 402);
    assert.equal(broke.submit.body.error, "payment_rejected");
    assert.equal(broke.submit.body.reason, "insufficient_funds");
    const st = await get(h, `/requests/${broke.id}`, { authorization: `Bearer ${broke.token}` });
    assert.equal(st.body.status, "payment_failed");
    const retry = await post(h, `/requests/${broke.id}/submit`, {}, { authorization: `Bearer ${broke.token}` });
    assert.equal(retry.body.error, "order_not_payable");
  });

  test("pending settlement: 202, payment_not_confirmed, order_payment_already_started, payment_already_reserved, payment_attempt_conflict", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const real = h.settler.settle.bind(h.settler);
    h.settler.settle = async (p, amount, payTo) => { await gate; return real(p, amount, payTo); };
    try {
      const token = newRequestToken();
      const auth = { authorization: `Bearer ${token}` };
      const q = await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: JOB }, auth);
      const ch = (await post(h, `/requests/${q.body.order.id}/submit`, {}, auth)).body;
      const s1 = await signPayment(ch, payer, { nonce: "777" });
      const [x, y] = await Promise.all([
        post(h, `/requests/${q.body.order.id}/submit`, { quoteSignature: s1.quoteSignature }, { ...auth, "payment-signature": s1.header }),
        post(h, `/requests/${q.body.order.id}/submit`, { quoteSignature: s1.quoteSignature }, { ...auth, "payment-signature": s1.header }),
      ]);
      const codes = [x, y].map((r) => (r.status === 202 ? "pending" : r.body.error));
      assert.ok(codes.includes("pending"), JSON.stringify(codes));
      const loser = codes.find((c) => c !== "pending");
      assert.ok(loser === "payment_attempt_conflict" || loser === "payment_not_confirmed", `concurrent attempt refused with ${loser}`);
      const same = await post(h, `/requests/${q.body.order.id}/submit`, { quoteSignature: s1.quoteSignature }, { ...auth, "payment-signature": s1.header });
      assert.equal(same.body.error, "payment_not_confirmed");
      const s2 = await signPayment(ch, payer);
      const diff = await post(h, `/requests/${q.body.order.id}/submit`, { quoteSignature: s2.quoteSignature }, { ...auth, "payment-signature": s2.header });
      assert.equal(diff.body.error, "order_payment_already_started");
      const q2 = await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: JOB }, auth);
      const ch2 = (await post(h, `/requests/${q2.body.order.id}/submit`, {}, auth)).body;
      const s3 = await signPayment(ch2, payer, { nonce: "777" });
      const reused = await post(h, `/requests/${q2.body.order.id}/submit`, { quoteSignature: s3.quoteSignature }, { ...auth, "payment-signature": s3.header });
      assert.equal(reused.status, 409);
      assert.equal(reused.body.error, "payment_already_reserved");
      release();
      await h.app.idle();
      assert.equal((await get(h, `/requests/${q.body.order.id}`, auth)).body.status, "admitted");
    } finally {
      h.settler.settle = real;
      release();
    }
  });

  test("rate limits: 30 quotes a minute per IP and token (request_limit, Retry-After)", async () => {
    const token = newRequestToken();
    const auth = { authorization: `Bearer ${token}` };
    let last: any;
    for (let i = 0; i < 31; i++) last = await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: { ...JOB, objective: `README number ${i} for a token.` } }, auth);
    assert.equal(last.status, 429);
    assert.equal(last.body.error, "request_limit");
    assert.ok(Number(last.headers.get("retry-after")) > 0);
    const other = await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: JOB }, { authorization: `Bearer ${newRequestToken()}` });
    assert.equal(other.status, 201, "another token has its own window");
  });
});

describe("quote expiry and disabled actions", () => {
  test("410 quote_expired after 600 s, 409 quote_too_close_to_expiry in the last minute, 400 action_not_enabled", async () => {
    const c = clock(Date.UTC(2026, 9, 5, 12));
    const h = await harness({ clock: c, env: { ENABLED_ACTIONS: "job.open,oracle.request" } });
    try {
      const payer = privateKeyToAccount(generatePrivateKey());
      const token = newRequestToken();
      const auth = { authorization: `Bearer ${token}` };
      const q = await post(h, "/requests/quote", { requestKey: randomUUID(), action: "job.open", input: JOB }, auth);
      const ch = (await post(h, `/requests/${q.body.order.id}/submit`, {}, auth)).body;
      c.advance(560_000);
      const s = await signPayment(ch, payer);
      const close = await post(h, `/requests/${q.body.order.id}/submit`, { quoteSignature: s.quoteSignature }, { ...auth, "payment-signature": s.header });
      assert.equal(close.status, 409);
      assert.equal(close.body.error, "quote_too_close_to_expiry");
      c.advance(60_000);
      const late = await post(h, `/requests/${q.body.order.id}/submit`, { quoteSignature: s.quoteSignature }, { ...auth, "payment-signature": s.header });
      assert.equal(late.status, 410);
      assert.equal(late.body.error, "quote_expired");
      assert.equal((await get(h, `/requests/${q.body.order.id}`, auth)).body.status, "expired");
      const off = await post(h, "/requests/quote", { requestKey: randomUUID(), action: "launch.open", input: JOB }, auth);
      assert.equal(off.status, 400);
      assert.equal(off.body.error, "action_not_enabled");
    } finally {
      await h.close();
    }
  });
});
