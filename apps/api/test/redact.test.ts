/**
 * The RPC endpoint carries the API key in its path, and an RPC client puts the endpoint it called into its error
 * text. Those messages are handed to whoever filed the request and stored on /health, which is how the key reached
 * a user. Nothing user-facing may carry it.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { redactRpc } from "../src/chain.ts";

test("redactRpc: the real leak — a viem error naming the Alchemy endpoint", () => {
  const msg = 'JSON is not a valid request object.\n\nURL: https://robinhood-mainnet.g.alchemy.com/v2/alch_Y1efN_q51B7ZJRyH8UiZb\nRequest body: {"method":"eth_call"}';
  const out = redactRpc(msg);
  assert.ok(!out.includes("alch_Y1efN_q51B7ZJRyH8UiZb"), "the key must not survive");
  assert.ok(!/\/v2\//.test(out), "the key's path must not survive");
  assert.ok(out.includes("robinhood-mainnet.g.alchemy.com"), "which endpoint failed is the useful half");
  assert.ok(out.includes("JSON is not a valid request object"), "the reason itself is kept");
});

test("redactRpc: a 403 from the public endpoint keeps its meaning", () => {
  const out = redactRpc("HTTP request failed.\n\nStatus: 403\nURL: https://rpc.mainnet.chain.robinhood.com/");
  assert.ok(out.includes("Status: 403"));
  assert.ok(out.includes("rpc.mainnet.chain.robinhood.com"));
});

test("redactRpc: keys are caught even without a URL around them", () => {
  for (const secret of ["alch_abcdefgh12345678", "sk-ant-usr-AAAAAAAAAAAA", "pk_live_0123456789ab"]) {
    assert.ok(!redactRpc(`boom ${secret} boom`).includes(secret), secret);
  }
});

test("redactRpc: an error with no secret in it is left readable", () => {
  assert.equal(redactRpc("execution reverted: InvalidNonce()"), "execution reverted: InvalidNonce()");
});

test("redactRpc: survives the things errors actually are", () => {
  assert.equal(redactRpc(undefined), "");
  assert.equal(redactRpc(null), "");
  assert.equal(redactRpc(new Error("x").message), "x");
});
