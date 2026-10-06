/**
 * npm run demo -w @company/api
 *
 * Chambers on a random port (mock chain, mock Clerk/Records Office/Registrar, mock COMD settlement), six paired and
 * registered Counsel seats running the `company` daemon with the mock runtime, and one payer who buys through the
 * real x402 flow: a matter (job), a launch (with the Bench), a workflow (contracts → deploy → front end → site),
 * a ruling (oracle panel + EIP-712 attestation) and a retainer (schedule). Prints the lifecycle as it happens.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { harness, seat, worker, pay, until, get, getWithHost, type Harness } from "../test/helpers.ts";

const t0 = Date.now();
const out = (s: string) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(2)}s] ${s}`);
const short = (x: unknown) => (typeof x === "string" && /^[0-9a-f-]{36}$/.test(x) ? x.slice(0, 8) : x);

const SHOW = new Set(["job.opened", "lease.assigned", "node.accepted", "node.rejected", "review.findings", "job.published", "launch.admission", "launch.deploying", "launch.live", "launch.parked", "site.live", "job.completed", "job.blocked",
  "oracle.opened", "oracle.agreed", "oracle.attested", "oracle.mismatch", "oracle.disagreed", "schedule.created", "schedule.opened", "schedule.skipped", "schedule.failed", "workflow.opened", "workflow.deployment", "workflow.frontend", "workflow.validating", "workflow.completed", "workflow.blocked", "order.paid", "order.admitted", "feedback.queued", "seat.connected", "panel.agreed"]);

function fmt(type: string, d: Record<string, any>): string {
  const keep = ["jobId", "nodeKey", "skill", "tokenId", "template", "orderId", "action", "launchId", "launchNumber", "kind", "requestId", "agreed", "quorum", "answer", "scheduleId", "seq", "workflowId", "label", "url", "repoUrl", "root", "reason", "failure", "entries", "runsRemaining", "missedSlots"];
  return `${type.padEnd(18)} ${keep.filter((k) => d[k] !== undefined && d[k] !== null).map((k) => `${k}=${short(d[k])}`).join(" ")}`;
}

async function main() {
  const h: Harness = await harness();
  h.app.onEvent((e) => { if (SHOW.has(e.type)) out(fmt(e.type, e.data)); });
  out(`Chambers listening at ${h.url} (chain 46630, COMD 18 dp, price ${h.app.cfg.priceComd} atomic per action)`);

  const seats = [];
  for (let i = 1; i <= 6; i++) seats.push(await seat(h, i));
  for (const [i, s] of seats.entries()) await worker(h, s, { premium: i >= 4, concurrency: 3, delayMs: 15 });
  out(`6 seats paired, registered as ERC-8004 agents and connected (seats #5 and #6 on premium runtimes)`);

  const payer = privateKeyToAccount(generatePrivateKey());
  const finished = (id: string) => until(() => { const j = h.app.store.c<any>("jobs").get(id); return ["completed", "blocked"].includes(j?.state) && j; }, `job ${id}`, 30_000);

  // 1. a matter
  const job = await pay(h, payer, "job.open", {
    objective: "Build a timelock savings vault for COMD with withdrawal after a fixed date.",
    shape: "chain", references: ["solidity-security-review"],
    steps: [{ skill: "build-contract-project" }, { skill: "write-foundry-tests", paths: ["test"] }, { skill: "adversarial-review" }],
  });
  out(`job.open quote ${job.quote.status} → challenge ${job.challenge.status} → paid ${job.submit.status} ${job.submit.body.status}`);
  const j1 = await finished(job.submit.body.admission.result.jobId);
  out(`MATTER ${short(j1.id)}: ${j1.state}; ${j1.nodes.map((n: any) => `${n.key}:${n.state}@#${n.seat?.tokenId}`).join(" ")}; ${j1.delivery?.repoUrl}`);

  // 2. a launch (the Bench sits before deployment)
  const launch = await pay(h, payer, "launch.open", {
    objective: "Launch COUNSEL: a fixed-supply token with a staking contract.", shape: "chain",
    steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }], onchain: "evm_project", chainId: 46630, economics: { poolBps: 8800 },
  });
  const j2 = await finished(launch.submit.body.admission.result.jobId);
  const l = (await get(h, `/launches/${j2.launch.id}?claims=1`)).body;
  out(`LAUNCH #${l.launchNumber}: ${l.status}; token ${l.token}; bench ${j2.nodes.filter((n: any) => n.kind !== "work").map((n: any) => n.key).join(",")}; contributor root ${l.rewardSnapshot?.root?.slice(0, 18)}… (${l.rewardSnapshot?.entries.length} wallets)`);

  // 3. a workflow: contracts → deployment → frontend → publishing → validating
  const wf = await pay(h, payer, "workflow.open", {
    request: "A savings club token with a site where members see the pool.",
    draft: { objective: "Savings club token and members site.", shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }, { skill: "frontend-for-contract" }], onchain: "evm_project", chainId: 46630, ipfs: "savings-club" },
    permissions: { github: true, ipfs: "savings-club", onchain: { kind: "evm_project", chainId: 46630 } },
  });
  const wfId = wf.submit.body.admission.result.workflowId;
  const w = await until(async () => { const x = (await get(h, `/workflows/${wfId}`)).body; return ["completed", "blocked"].includes(x.status) && x; }, "workflow", 30_000);
  out(`WORKFLOW ${short(wfId)}: ${w.status}; site ${w.site?.url}; validation ${w.validation?.checks.map((c: any) => `${c.name}:${c.ok ? "ok" : "no"}`).join(" ")}`);
  const page = await getWithHost(h, "savings-club.sites.test", "/");
  out(`GET / Host: savings-club.sites.test → ${page.status} ${page.headers["x-company-site"]} ${page.body.slice(0, 48).replace(/\n/g, " ")}…`);

  // 4. a ruling
  const oracle = await pay(h, payer, "oracle.request", {
    v: 1, question: "How many Counsel seats were connected at the end of the window?", chainId: 46630, window: { hours: 24 }, answerType: "uint256",
    panelSize: 5, quorum: 4, validForSeconds: 3600, evidence: "panel", definitions: { "mock.answer": "6", seats: "Counsel seats with a live session" },
  });
  const reqId = oracle.submit.body.admission.result.requestId;
  const att = await until(async () => { const r = await get(h, `/oracle/requests/${reqId}/attestation`); return r.status === 200 && r.body; }, "attestation", 30_000);
  const signer = await recoverTypedDataAddress({ domain: att.domain, types: { OracleAttestation: att.types.OracleAttestation }, primaryType: "OracleAttestation", message: { ...att.message, chainId: BigInt(att.message.chainId), figure: BigInt(att.message.figure), fromBlock: BigInt(att.message.fromBlock), toBlock: BigInt(att.message.toBlock), issuedAt: BigInt(att.message.issuedAt), expiresAt: BigInt(att.message.expiresAt) }, signature: att.signature });
  out(`RULING ${short(reqId)}: attested figure=${att.message.figure} window ${att.message.fromBlock}..${att.message.toBlock}; EIP-712 signer ${signer} (matches ${att.signer === signer})`);

  // 5. a retainer
  const sched = await pay(h, payer, "schedule.create", {
    action: "oracle.request", cadence: { every: "PT10M" }, runs: 3, label: "Seat count every ten minutes",
    input: { v: 1, question: "How many Counsel seats were connected at the end of the window?", chainId: 46630, window: { hours: 1 }, answerType: "uint256", panelSize: 5, quorum: 4, validForSeconds: 600, evidence: "panel", definitions: { "mock.answer": "6" } },
  });
  const sid = sched.submit.body.admission.result.scheduleId;
  out(`RETAINER ${short(sid)}: paid ${sched.quote.body.order.quote.payment.amount} atomic COMD for 3 runs`);
  await h.app.scheduler.tick();
  const force = () => { const s = h.app.store.c<any>("schedules").get(sid); s.nextRunAt = new Date(Date.now() - 1000).toISOString(); };
  force(); await h.app.scheduler.tick(); // previous still assessing → skipped
  await until(() => h.app.store.c<any>("oracle").count((x: any) => x.scheduleId === sid && x.status === "attested") >= 1, "retainer run", 30_000);
  force(); await h.app.scheduler.tick();
  const sv = (await get(h, `/schedules/${sid}`)).body;
  out(`RETAINER ${short(sid)}: ${sv.status}, runs remaining ${sv.runsRemaining}/${sv.runsBought}; latest ${sv.latest.map((r: any) => `#${r.seq}:${r.status}`).join(" ")}`);

  await h.app.idle();
  const health = (await get(h, "/health")).body;
  const ep = h.app.settlement.closeEpoch(h.app.settlement.epochOf(Date.now()));
  out(`HEALTH ${health.status} (${health.degraded.join(", ")}); daemons ${health.connectedDaemons}; accepted in 24h ${health.acceptedLastDay}; feedback batches ${health.pendingFeedback} queued; reward epoch ${ep.epoch} root ${ep.root?.slice(0, 18)}… over ${ep.entries.length} seats`);
  await h.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
