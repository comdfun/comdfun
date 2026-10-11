/**
 * Who gets the credit for a payment into the desk.
 *
 * Ordinarily this is not a question: the wallet in the Transfer's `from` paid, and that wallet is credited. It
 * becomes a question the moment somebody buys with ETH, because then a pool moves the $COMD and the transfer
 * arrives from the pool. These tests pin both halves of that rule, and the refusal in the middle: a contract
 * that is not on the operator's list is credited literally, however plausible it looks.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { pad, type Address, type Hex } from "viem";
import { ChainPayments } from "../src/icm.ts";

const TOKEN = "0xbFdAc6235dBE77C0CD6EDB01c810c7da858c6c41" as Address;
const DESK = "0x54b3aF92c50C5A5D07dB48702A3c5EAD85E7Ca64" as Address;
const SWAPPER = "0x2b6137C6b5609e63E09f00014C48a18196A27421" as Address;
const BUYER = "0x1111111111111111111111111111111111111111" as Address;
const STRANGER = "0x9999999999999999999999999999999999999999" as Address;

const topic = (a: Address) => pad(a.toLowerCase() as Hex, { size: 32 });
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;

/** A chain that answers from a fixed set of logs, and optionally knows who signed each transaction. */
function chainWith(
  logs: { from: Address; txHash: Hex; logIndex: number; units: bigint }[],
  senders: Record<string, Address> = {},
  opts: { txSender?: boolean } = {},
) {
  let txLookups = 0;
  const chain: Record<string, unknown> = {
    configured: true,
    blockNumber: async () => 100,
    rawLogs: async () => logs.map((l) => ({
      topics: [TRANSFER, topic(l.from), topic(DESK)] as Hex[],
      data: `0x${l.units.toString(16).padStart(64, "0")}` as Hex,
      blockNumber: 50,
      txHash: l.txHash,
      logIndex: l.logIndex,
    })),
  };
  if (opts.txSender !== false) {
    chain.txSender = async (h: Hex) => { txLookups++; return senders[h] ?? null; };
  }
  return { app: { chain } as never, lookups: () => txLookups };
}

test("an ordinary transfer credits the wallet it came from", async () => {
  const { app, lookups } = chainWith([{ from: BUYER, txHash: "0xaa", logIndex: 0, units: 5n }]);
  const src = new ChainPayments(app, TOKEN, DESK, 12, [SWAPPER]);
  const { payments } = await src.since(null);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].from, BUYER.toLowerCase());
  assert.equal(lookups(), 0, "a plain transfer needs no transaction lookup at all");
});

test("a swap routed through the swapper credits whoever signed the transaction, not the pool", async () => {
  const { app } = chainWith([{ from: SWAPPER, txHash: "0xbb", logIndex: 0, units: 9n }], { "0xbb": BUYER });
  const src = new ChainPayments(app, TOKEN, DESK, 12, [SWAPPER]);
  const { payments } = await src.since(null);
  assert.equal(payments[0].from, BUYER.toLowerCase(), "the buyer paid in ETH; the pool only moved the token");
});

test("a contract nobody listed is credited literally, however much it looks like a router", async () => {
  // The whole point of the list. If any contract could nominate its transaction's signer as the beneficiary,
  // one that batches several people's payments would credit every one of them to whoever sent the batch.
  const { app, lookups } = chainWith([{ from: STRANGER, txHash: "0xcc", logIndex: 0, units: 3n }], { "0xcc": BUYER });
  const src = new ChainPayments(app, TOKEN, DESK, 12, [SWAPPER]);
  const { payments } = await src.since(null);
  assert.equal(payments[0].from, STRANGER.toLowerCase());
  assert.equal(lookups(), 0, "an unlisted sender is never even looked up");
});

test("the list is matched without regard to case, since an address book may be checksummed either way", async () => {
  const { app } = chainWith([{ from: SWAPPER, txHash: "0xdd", logIndex: 0, units: 1n }], { "0xdd": BUYER });
  const src = new ChainPayments(app, TOKEN, DESK, 12, [SWAPPER.toLowerCase() as Address]);
  assert.equal((await src.since(null)).payments[0].from, BUYER.toLowerCase());
});

test("when the chain will not say who signed, the forwarder is kept rather than a buyer guessed", async () => {
  // Crediting the forwarder is wrong, but it is wrong in a way that is visible and fixable by hand. Picking a
  // wallet out of the air would hand somebody else's money to them and look entirely correct.
  const { app } = chainWith([{ from: SWAPPER, txHash: "0xee", logIndex: 0, units: 7n }], {});
  const src = new ChainPayments(app, TOKEN, DESK, 12, [SWAPPER]);
  assert.equal((await src.since(null)).payments[0].from, SWAPPER.toLowerCase());
});

test("a chain reader with no txSender at all still credits ordinary transfers", async () => {
  const { app } = chainWith([{ from: BUYER, txHash: "0xff", logIndex: 0, units: 2n }], {}, { txSender: false });
  const src = new ChainPayments(app, TOKEN, DESK, 12, [SWAPPER]);
  assert.equal((await src.since(null)).payments[0].from, BUYER.toLowerCase());
});

test("two transfers in one transaction stay two payments", async () => {
  const { app } = chainWith([
    { from: BUYER, txHash: "0x11", logIndex: 0, units: 4n },
    { from: SWAPPER, txHash: "0x11", logIndex: 1, units: 6n },
  ], { "0x11": STRANGER });
  const src = new ChainPayments(app, TOKEN, DESK, 12, [SWAPPER]);
  const { payments } = await src.since(null);
  assert.equal(payments.length, 2);
  assert.notEqual(payments[0].ref, payments[1].ref, "the log index is what keeps them apart");
  assert.equal(payments[0].from, BUYER.toLowerCase());
  assert.equal(payments[1].from, STRANGER.toLowerCase());
});
