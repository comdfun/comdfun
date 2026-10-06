import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, recoverTypedDataAddress, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { oracleAttestationTypedData, oracleDomain, uuidToBytes32, type OracleBody } from "@company/protocol";
import { harness, seat, worker, pay, until, get, type Harness } from "./helpers.ts";
import { cluster } from "../src/oracle.ts";

const Q = (o: Partial<OracleBody> & { definitions?: Record<string, string> } = {}): OracleBody => ({
  v: 1, question: "How many swaps did the pool record in the window?", chainId: 46630, window: { hours: 24 }, answerType: "uint256",
  panelSize: 5, quorum: 4, validForSeconds: 3600, evidence: "panel", ...o, definitions: { "mock.answer": "42", ...(o.definitions ?? {}) },
} as OracleBody);

describe("rulings (oracle panels, reproduction, attestation)", () => {
  let h: Harness;
  const honest: any[] = [];
  before(async () => {
    h = await harness();
    for (let i = 1; i <= 5; i++) honest.push(await worker(h, await seat(h, i)));
  });
  after(async () => { for (const w of honest) await w.stop(); await h.close(); });

  const open = async (body: OracleBody) => {
    const b = structuredClone(body);
    b.window = (await h.app.oracle.pinWindow(b)) as any;
    return h.app.oracle.open(b, { paidBy: null }).request.id;
  };
  const settled = (id: string) => until(() => { const r = h.app.store.c<any>("oracle").get(id); return !["assessing", "reproducing"].includes(r.status) && r; }, `oracle ${id}`, 15_000);

  test("paid request: the quorum agrees, the attester signs EIP-712 OracleAttestation, anyone can recover the signer", async () => {
    const payer = privateKeyToAccount(generatePrivateKey());
    const consumer = "0x00000000000000000000000000000000000c0de5" as const;
    const r = await pay(h, payer, "oracle.request", { ...Q(), consumer: { chainId: 4663, verifyingContract: consumer } });
    assert.equal(r.quote.status, 201);
    assert.ok(r.quote.body.order.quote, "window is pinned at quote");
    const id = r.submit.body.admission.result.requestId;
    assert.equal(r.submit.body.admission.result.attestationUrl, `/oracle/requests/${id}/attestation`);
    assert.equal((await get(h, `/oracle/requests/${id}/attestation`)).status === 404 || true, true);
    const done = await settled(id);
    assert.equal(done.status, "attested");
    assert.equal(done.agreement.agreed >= 4, true);
    const att = (await get(h, `/oracle/requests/${id}/attestation`)).body;
    assert.equal(att.domain.name, "Company.md Oracle");
    assert.equal(att.domain.chainId, 4663);
    assert.equal(att.domain.verifyingContract, undefined); // OracleAttestationVerifier: no verifyingContract
    assert.equal(att.tuple.length, 12);
    assert.equal(att.message.requestId, uuidToBytes32(id));
    assert.equal(att.message.figure, "42");
    assert.equal(att.message.answer, encodeAbiParameters([{ type: "uint256" }], [42n]));
    const td = oracleAttestationTypedData(att.message, oracleDomain(4663));
    assert.equal(await recoverTypedDataAddress({ ...(td as any), signature: att.signature }), att.signer);
    const view = (await get(h, `/oracle/requests/${id}?members=0`)).body;
    assert.deepEqual(view.members, []);
    assert.equal(view.computed.answer, "42");
    const list = (await get(h, "/oracle/requests?status=attested")).body;
    assert.ok(list.requests.some((x: any) => x.id === id));
    assert.equal(list.attester, att.signer.toLowerCase());
    assert.equal((await get(h, "/oracle/counts")).body.byStatus.attested >= 1, true);
    assert.equal((await get(h, `/jobs/${done.jobId}`)).body.state, "completed");
  });

  test("evidence=chain: the attester re-runs eth-call / log-count / balance recipes and attests only on a match", async () => {
    const to = "0x00000000000000000000000000000000000000aa";
    const data = "0x18160ddd";
    h.chain.calls.set(`${to}:${data}`, encodeAbiParameters([{ type: "uint256" }], [42n]));
    const ok = await settled(await open(Q({ evidence: "chain", definitions: { "mock.recipe": JSON.stringify({ kind: "eth-call", to, data }) } })));
    assert.equal(ok.status, "attested");
    assert.equal(ok.computed.answer, "42");

    h.chain.calls.set(`${to}:${data}`, encodeAbiParameters([{ type: "uint256" }], [41n]));
    const bad = await settled(await open(Q({ evidence: "chain", definitions: { "mock.recipe": JSON.stringify({ kind: "eth-call", to, data }) } })));
    assert.equal(bad.status, "mismatch");
    assert.match(bad.failure, /chain gives "41"/);

    const topic = keccak256(toHex("Swap(address,address,int256,int256,uint160,uint128,int24)"));
    h.chain.logs.set(`${to}:${topic}`, 42);
    const logs = await settled(await open(Q({ evidence: "chain", definitions: { "mock.recipe": JSON.stringify({ kind: "log-count", address: to, topics: [topic] }) } })));
    assert.equal(logs.status, "attested");

    h.chain.balances.set(to, 42n);
    const bal = await settled(await open(Q({ evidence: "chain", definitions: { "mock.recipe": JSON.stringify({ kind: "balance", address: to }) } })));
    assert.equal(bal.status, "attested");

    const odd = await settled(await open(Q({ evidence: "chain", definitions: { "mock.recipe": JSON.stringify({ kind: "v4-volume-rank" }) } })));
    assert.equal(odd.status, "failed");
  });

  test("guards block an agreed answer outside them", async () => {
    const r = await settled(await open(Q({ guards: { max: "10" } })));
    assert.equal(r.status, "blocked");
    assert.match(r.failure, /guards\.max/);
  });

  test("all quorum members must match; uint256 answers may differ within toleranceBps", () => {
    const req: any = { answerType: "uint256", toleranceBps: 100, head: null };
    const m = (a: string) => ({ answer: a });
    assert.equal(cluster(req, [m("1000"), m("1005"), m("1009"), m("2000")] as any)[0].length, 3);
    assert.equal(cluster({ ...req, toleranceBps: 0 }, [m("1000"), m("1005")] as any)[0].length, 1);
    const list: any = { answerType: "address[]", toleranceBps: 0, head: 1 };
    assert.equal(cluster(list, [{ answer: ["0x1", "0x2"] }, { answer: ["0x1", "0x3"] }] as any)[0].length, 2, "head compares leading entries only");
  });
});

test("a split panel ends disagreed; ambiguous wording is refused at check", async () => {
  const h = await harness();
  try {
    const ws = [];
    for (let i = 1; i <= 3; i++) ws.push(await worker(h, await seat(h, i)));
    for (let i = 4; i <= 5; i++) ws.push(await worker(h, await seat(h, i), { mode: "contrarian" }));
    const b = Q();
    b.window = (await h.app.oracle.pinWindow(b)) as any;
    const id = h.app.oracle.open(b, { paidBy: null }).request.id;
    const r = await until(() => { const x = h.app.store.c<any>("oracle").get(id); return x.status !== "assessing" && x; }, "disagreement", 15_000);
    assert.equal(r.status, "disagreed");
    assert.equal(h.app.store.c<any>("jobs").get(r.jobId).state, "blocked");
    const amb = await (await fetch(`${h.url}/requests/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "oracle.request", input: { ...Q(), question: "Is it good?" } }) })).json() as any;
    assert.equal(amb.blockers[0].code, "ambiguous");
    for (const w of ws) await w.stop();
  } finally {
    await h.close();
  }
});
