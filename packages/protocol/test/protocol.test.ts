import { test } from "node:test";
import assert from "node:assert/strict";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { concat, decodeAbiParameters, encodeAbiParameters, keccak256, toHex, zeroAddress } from "viem";
import {
  buildContributorTree, buildRewardTree, canonicalHash, canonicalJson, checkSignedEnvelope, encodeAnswer, envelopeString, generateDeviceKey,
  makeSignedEnvelope, oracleAttestationTypedData, oracleDomain, parsePaymentPayload, parsePaymentSignatureHeader, paymentHash, permit2TypedData,
  quoteApprovalTypedData, recoverTypedSigner, signEnvelope, signFrame, signPayment, submissionHash, uuidToBytes32, verifyEnvelope, verifyFrame,
  verifyProof, workerAuthorizationTypedData, contributorLeaf, rewardLeaf, encodeHeaderJson, typedDataDigest, isPremiumRuntime, requiresPremium, type PaymentRequired,
} from "../src/index.ts";

test("canonical JSON sorts keys, drops undefined, refuses bigint and non-finite", () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, "x"], c: undefined, d: { z: 1, y: 2 } }), '{"a":[true,null,"x"],"b":1,"d":{"y":2,"z":1}}');
  assert.throws(() => canonicalJson({ a: 1n }));
  assert.throws(() => canonicalJson({ a: Infinity }));
  assert.equal(canonicalHash({ x: 1, y: 2 }), canonicalHash({ y: 2, x: 1 }));
});

test("Ed25519 envelopes: comd.v2\\n<KIND>\\n<PAYLOAD_HASH>, kind-separated, tamper-evident", () => {
  const k = generateDeviceKey();
  assert.match(k.deviceKey, /^[0-9a-f]{64}$/);
  const payload = { leaseId: "x", n: 1 };
  assert.match(envelopeString("fuzz.result", payload), /^comd\.v2\nfuzz\.result\n[0-9a-f]{64}$/);
  const sig = signEnvelope(k.privateKeyPem, "fuzz.result", payload);
  assert.ok(verifyEnvelope(k.deviceKey, "fuzz.result", payload, sig));
  assert.equal(verifyEnvelope(k.deviceKey, "enrollment.revoke", payload, sig), false, "a signature for one kind is not valid for another");
  assert.equal(verifyEnvelope(k.deviceKey, "fuzz.result", { ...payload, n: 2 }, sig), false);
  assert.equal(verifyEnvelope(generateDeviceKey().deviceKey, "fuzz.result", payload, sig), false);
  const env = makeSignedEnvelope(k, "enrollment.revoke", { reason: "test" });
  assert.deepEqual(checkSignedEnvelope(env, "enrollment.revoke"), { ok: true });
  assert.equal((checkSignedEnvelope(env, "fuzz.result") as any).error, "invalid_envelope");
  assert.equal((checkSignedEnvelope({ ...env, payload: { ...env.payload, reason: "x" } }, "enrollment.revoke") as any).error, "invalid_signature");
  assert.equal((checkSignedEnvelope(env, "enrollment.revoke", Date.now() + 3_600_000) as any).error, "envelope_expired");
});

test("WS frames are bound to the session challenge", () => {
  const k = generateDeviceKey();
  const f = signFrame(k.privateKeyPem, k.deviceKey, "nonce-a", { type: "heartbeat", id: "1", seq: 1, ts: 1, body: { active: [] } });
  assert.ok(verifyFrame(f, "nonce-a", k.deviceKey));
  assert.equal(verifyFrame(f, "nonce-b", k.deviceKey), false);
  assert.equal(verifyFrame({ ...f, seq: 2 }, "nonce-a", k.deviceKey), false);
});

test("EIP-712: WorkerAuthorization, QuoteApproval and OracleAttestation recover their signers", async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const wa = workerAuthorizationTypedData({ deviceKey: `0x${"ab".repeat(32)}`, wallet: acct.address, tokenId: "42", nonce: `0x${"01".repeat(32)}`, expiresAt: 1_900_000_000, relayOrigin: "https://api.comd.fun" }, 46630);
  assert.equal(wa.domain.name, "Company.md Worker");
  assert.equal(await recoverTypedSigner(wa, await acct.signTypedData(wa as any)), acct.address);

  const qa = quoteApprovalTypedData({ resource: "/requests/q/submit", requesterScopeHash: `0x${"11".repeat(32)}`, quoteId: "q", quoteHash: `0x${"22".repeat(32)}`, paymentHash: `0x${"33".repeat(32)}`, action: "job.open", asset: zeroAddress, amount: "100000000000000000000", payTo: zeroAddress, expiresAt: 1_900_000_000 }, 4663);
  assert.equal(qa.domain.name, "Company.md Paid Action");
  const qsig = await acct.signTypedData(qa as any);
  assert.equal(await recoverTypedSigner(qa, qsig), acct.address);
  const tampered = quoteApprovalTypedData({ ...(qa.message as any), amount: "5000001", asset: zeroAddress, payTo: zeroAddress, expiresAt: 1_900_000_000 }, 4663);
  assert.notEqual(await recoverTypedSigner(tampered, qsig), acct.address);

  const msg = { requestId: uuidToBytes32("4dd47615-7358-4dd5-aee8-c56225fc6cce"), chainId: 4663, questionHash: `0x${"44".repeat(32)}` as const, answerType: "uint256" as const, answer: encodeAnswer("uint256", "213"), figure: "213", fromBlock: 1, toBlock: 2, blockHash: `0x${"55".repeat(32)}` as const, panelJobId: uuidToBytes32("f3f1b7e8-c807-4ef5-9b92-fdb8c5c12bd7"), issuedAt: 1, expiresAt: 2 };
  assert.equal(msg.requestId, "0x4dd4761573584dd5aee8c56225fc6cce00000000000000000000000000000000");
  const oa = oracleAttestationTypedData(msg, oracleDomain(4663));
  assert.equal(oa.domain.name, "Company.md Oracle");
  assert.equal(await recoverTypedSigner(oa, await acct.signTypedData(oa as any)), acct.address);
  assert.equal(decodeAbiParameters([{ type: "uint256" }], msg.answer)[0], 213n);
  assert.equal(await recoverTypedSigner(oa, "0x1234"), null);
  // digest == OracleAttestationVerifier.digestFor(a, 4663): domain has no verifyingContract
  assert.deepEqual(Object.keys(oa.domain).sort(), ["chainId", "name", "version"]);
  const T = (s: string) => keccak256(toHex(s));
  const ds = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [T("EIP712Domain(string name,string version,uint256 chainId)"), T("Company.md Oracle"), T("1"), 4663n]));
  const th = T("OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,string answerType,bytes answer,uint256 figure,uint256 fromBlock,uint256 toBlock,bytes32 blockHash,bytes32 panelJobId,uint64 issuedAt,uint64 expiresAt)");
  const sh = keccak256(encodeAbiParameters(
    ["bytes32", "bytes32", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "uint256", "uint256", "bytes32", "bytes32", "uint64", "uint64"].map((type) => ({ type })),
    [th, msg.requestId, 4663n, msg.questionHash, T("uint256"), keccak256(msg.answer), 213n, 1n, 2n, msg.blockHash, msg.panelJobId, 1n, 2n],
  ));
  assert.equal(typedDataDigest(oa), keccak256(concat(["0x1901", ds, sh])));
});

test("premium routing: top-tier model at high effort; contract and front-end work is premium", () => {
  assert.equal(isPremiumRuntime({ model: "claude-opus-4-1", effort: "high" }), true);
  assert.equal(isPremiumRuntime({ model: "gpt-5-codex", effort: "xhigh" }), true);
  assert.equal(isPremiumRuntime({ model: "claude-opus-4-1", effort: "medium" }), false);
  assert.equal(isPremiumRuntime({ model: "claude-opus-4-1", effort: null }), false);
  assert.equal(isPremiumRuntime({ model: "claude-sonnet-4-5", effort: "high" }), false);
  // current ids
  assert.equal(isPremiumRuntime({ model: "claude-opus-5-5", effort: "high" }), true);
  assert.equal(isPremiumRuntime({ model: "gpt-6-astra", effort: "xhigh" }), true);
  assert.equal(isPremiumRuntime({ model: "claude-sonnet-5-5", effort: "high" }), false);
  assert.equal(isPremiumRuntime({ model: "gpt-6-astra", effort: "medium" }), false);
  assert.equal(requiresPremium({ inference: "premium", role: "implement", checks: ["web-build"] }), true);
  assert.equal(requiresPremium({ inference: "standard", role: "implement", checks: ["paths", "foundry-build"] }), true);
  assert.equal(requiresPremium({ inference: "standard", role: "tests", checks: ["foundry-test"] }), true);
  assert.equal(requiresPremium({ inference: "standard", role: "review", checks: ["review-report"] }), false);
  assert.equal(requiresPremium({ inference: "standard", role: "implement", checks: ["research-citations"] }), false);
});

const challenge = (): PaymentRequired => ({
  x402Version: 2,
  accepts: [{ scheme: "exact", network: "eip155:4663", asset: "0xc0d0c0d0c0d0c0d0c0d0c0d0c0d0c0d0c0d0c0d0", amount: "100000000000000000000", payTo: "0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e", maxTimeoutSeconds: 3600, extra: { assetTransferMethod: "permit2" } }],
  quote: { id: "q1", quoteHash: "aa".repeat(32), action: "job.open", payment: { network: "eip155:4663", asset: "0xc0d0c0d0c0d0c0d0c0d0c0d0c0d0c0d0c0d0c0d0", amount: "100000000000000000000", payTo: "0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e" }, expiresAt: 1_900_000_000 },
  requesterScopeHash: "bb".repeat(32),
  resourceUrl: "/requests/q1/submit",
  permit2: { address: "0x000000000022D473030F116dDEE9F6B43aC78BA3", spender: "0x5e771e5e771e5e771e5e771e5e771e5e771e5e77", witnessTypeString: "" },
});

test("x402 payment payloads: client signs, strict parser accepts, and refuses every deviation with a path", async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const s = await signPayment(challenge(), acct);
  const parsed = parsePaymentSignatureHeader(s.header);
  assert.ok(parsed.ok);
  assert.equal(paymentHash(parsed.ok ? parsed.value.raw : null), s.paymentHash);
  const td = permit2TypedData(s.payment.payload.permit2Authorization, 4663);
  assert.equal(await recoverTypedSigner(td, s.payment.payload.signature), acct.address);
  const bad = (mut: (p: any) => void) => { const p = structuredClone(s.payment) as any; mut(p); const r = parsePaymentPayload(p); assert.equal(r.ok, false); return (r as any).detail as string; };
  assert.match(bad((p) => { p.extra = 1; }), /payment\.extra is not allowed/);
  assert.match(bad((p) => { p.x402Version = 1; }), /x402Version must be 2/);
  assert.match(bad((p) => { p.accepted.scheme = "upto"; }), /scheme must be "exact"/);
  assert.match(bad((p) => { p.accepted.network = "base"; }), /network must be eip155/);
  assert.match(bad((p) => { p.accepted.extra.assetTransferMethod = "eip3009"; }), /permit2/);
  assert.match(bad((p) => { p.accepted.extra.spender = "0x12"; }), /extra\.spender must be/);
  assert.match(bad((p) => { p.accepted.extra.relay = "x"; }), /extra\.relay is not allowed/);
  // the web echoes accepts[0] with extra {assetTransferMethod, spender, name, version}
  const withExtra = structuredClone(s.payment) as any;
  withExtra.accepted.extra = { assetTransferMethod: "permit2", spender: "0x5e771e5e771e5e771e5e771e5e771e5e771e5e77", name: "Global Dollar", version: "1" };
  const okExtra = parsePaymentPayload(withExtra);
  assert.ok(okExtra.ok && okExtra.value.accepted.extra.spender === "0x5e771e5e771e5e771e5e771e5e771e5e771e5e77");
  assert.match(bad((p) => { p.accepted.amount = "5e6"; }), /amount must be a decimal/);
  assert.match(bad((p) => { p.payload.signature = "0x00"; }), /65-byte/);
  assert.match(bad((p) => { delete p.payload.permit2Authorization.witness; }), /witness is required/);
  assert.match(bad((p) => { p.payload.permit2Authorization.witness.extra = "0x"; }), /witness\.extra is not allowed/);
  assert.match(bad((p) => { p.payload.permit2Authorization.from = "0x12"; }), /from must be/);
  assert.equal(parsePaymentSignatureHeader("%%%").ok, false);
  assert.equal(parsePaymentSignatureHeader(encodeHeaderJson([1])).ok, false);
  assert.equal(parsePaymentSignatureHeader(undefined).ok, false);
});

test("Merkle trees match @openzeppelin/merkle-tree (reward epochs and launch contributors)", () => {
  const rewards = [{ epoch: 3, tokenId: "1", amount: "1000" }, { epoch: 3, tokenId: "7", amount: "250" }, { epoch: 3, tokenId: "1999", amount: "1" }];
  const mine = buildRewardTree(rewards);
  const oz = StandardMerkleTree.of(rewards.map((r) => [r.epoch, r.tokenId, r.amount]), ["uint256", "uint256", "uint256"]);
  assert.equal(mine.root, oz.root);
  for (const c of mine.claims) {
    assert.ok(verifyProof(c.proof, mine.root, rewardLeaf(c)));
    assert.ok(StandardMerkleTree.verify(oz.root, ["uint256", "uint256", "uint256"], [c.epoch, c.tokenId, c.amount], c.proof));
  }
  const accts = [privateKeyToAccount(generatePrivateKey()).address, privateKeyToAccount(generatePrivateKey()).address];
  const contrib = accts.map((a, i) => ({ launchId: 12, account: a, amount: String(10n ** 24n * BigInt(i + 1)) }));
  const t = buildContributorTree(contrib);
  const oz2 = StandardMerkleTree.of(contrib.map((c) => [c.launchId, c.account, c.amount]), ["uint256", "address", "uint256"]);
  assert.equal(t.root, oz2.root);
  for (const c of t.claims) assert.ok(verifyProof(c.proof, t.root, contributorLeaf(c)));
  const single = buildRewardTree([{ epoch: 0, tokenId: "5", amount: "9" }]);
  assert.equal(single.root, StandardMerkleTree.of([[0, "5", "9"]], ["uint256", "uint256", "uint256"]).root);
});

test("submission hashes ignore file order and cover the result", () => {
  const f = [{ path: "b", sha256: "1".repeat(64), bytes: 1, mediaType: "text/plain" }, { path: "a", sha256: "2".repeat(64), bytes: 2, mediaType: "text/plain" }];
  assert.equal(submissionHash("L", "h", f, { verdict: "accept" }), submissionHash("L", "h", [...f].reverse(), { verdict: "accept" }));
  assert.notEqual(submissionHash("L", "h", f, { verdict: "accept" }), submissionHash("L", "h", f, { verdict: "reject" }));
});
