// Dev mock of the control plane (NEXT_PUBLIC_MOCK=1). Serves fixtures shaped like apps/api's responses (events as
// {at,type,data}, seat view, /workers runtime, /names, submissions array, pair seats) so every page renders without a
// backend and the lib/normalize.ts adapters are exercised. Server-only: imported by lib/api.ts
// and the /api/* route handlers, never by client components.
import type {
  Job, JobListItem, JobNode, OracleRequest, Publication, Schedule, RawSwarmEvent, LaunchListItem, Launch, Submission,
} from "./types";
import { CHAIN_ID } from "./config";

const CH = CHAIN_ID;
const CH_NAME = CH === 4663 ? "Robinhood Chain" : "Robinhood Chain Testnet";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

// ---------------------------------------------------------------- deterministic helpers
function prng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = prng(4663);
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const pick = <T,>(a: readonly T[], r = R) => a[Math.floor(r() * a.length)];
const int = (lo: number, hi: number, r = R) => lo + Math.floor(r() * (hi - lo + 1));
const hex = (n: number, r = R) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
const addr = (r = R) => `0x${hex(40, r)}`;
const uuid = (r = R) => `${hex(8, r)}-${hex(4, r)}-4${hex(3, r)}-${pick(["8", "9", "a", "b"], r)}${hex(3, r)}-${hex(12, r)}`;

// Anchor fixture times to process start so ids/ages are stable within one server process.
const NOW = Date.now();
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

// ---------------------------------------------------------------- seats & wallets
export const MAX_SUPPLY = 2000;
const MINTED = 1402;
const WALLETS = Array.from({ length: 260 }, () => addr());
const NAMES: Record<string, string> = {};
["hale", "marbury", "blackstone", "portia", "atticus", "brandeis", "ginsburg", "cardozo", "learnedhand", "story"].forEach((n, i) => {
  NAMES[WALLETS[i]] = `${n}.comd`;
});
// token ids are 1..2000 (index 0 unused, as GET /seats/owners returns them)
const OWNERS: (string | null)[] = Array.from({ length: MAX_SUPPLY + 1 }, (_, i) => (i >= 1 && i <= MINTED ? WALLETS[Math.floor(Math.pow(R(), 1.8) * WALLETS.length)] : null));
const ENROLLED = Array.from({ length: MINTED }, (_, i) => i + 1).filter((i) => i <= 30 || R() < 0.29);
const ONLINE = new Set(ENROLLED.filter(() => R() < 0.91));
const VERSIONS = ["0.1.4+c0de11a2", "0.1.4+c0de11a2", "0.1.4+c0de11a2", "0.1.3+77ab01fe"];
const SEAT_STATS: Record<number, { attempts: number; accepted: number; rejected: number; failed: number; pending: number; turns: number; ms: number; version: string; agentId: string; working: boolean; last: string }> = {};
for (const t of ENROLLED) {
  const attempts = Math.floor(Math.pow(R(), 1.5) * 3400);
  const rejected = Math.floor(attempts * R() * 0.03);
  const failed = Math.floor(attempts * R() * 0.02);
  const pending = Math.min(attempts - rejected - failed, int(0, 40));
  SEAT_STATS[t] = {
    attempts,
    accepted: Math.max(0, attempts - rejected - failed - pending),
    rejected,
    failed,
    pending,
    turns: attempts * int(2, 4),
    ms: attempts * int(40_000, 80_000),
    version: pick(VERSIONS),
    agentId: String(1000 + t),
    working: false,
    last: at(int(1, 600) * MIN),
  };
}
const WORKING = ENROLLED.filter((t) => ONLINE.has(t)).slice(3, 14);
WORKING.forEach((t) => (SEAT_STATS[t].working = true));
const onlineSeat = () => pick(ENROLLED.filter((t) => ONLINE.has(t)));

// ---------------------------------------------------------------- jobs
const OBJECTIVES: [string, string][] = [
  ["skill:build-contract-project", "Build an ERC-4626 vault over COMD with a 0.5% exit fee routed to a treasury, Foundry tests for share accounting and rounding, and an independent review. Do not deploy."],
  ["skill:create-image", "Draw a 1024×1024 pixel-art seal for a cooperative of notaries: black ground, brass ring, a quill crossed over a key."],
  ["skill:research-report", "Which stablecoins are natively issued on Robinhood Chain today, who issues them, and what attestation cadence does each publish? One row per asset."],
  ["impl_tests_review", "Implement a timelock escrow that releases COMD to a beneficiary after a cliff, with invariant tests and a cross-examination."],
  ["launch:custom_token", "Launch $DOCKET: a fixed-supply token with a site that shows holders, the pool and a live burn counter."],
  ["skill:build-website", "Build a one-page site that lists every Counsel seat's accepted work this week, grouped by practice."],
  ["audit", "Audit the bonding curve and fee routing in this repository: src/Curve.sol, src/FeeSplitter.sol."],
  ["skill:create-audio", "Compose a 20-second 8-bit fanfare for a courtroom verdict: four bars, square wave lead, triangle bass."],
  ["launch:univ4_hook", "Build a Uniswap v4 hook that charges a 0.3% fee on sells and routes it to stakers, with tests, an audit panel and a site."],
  ["skill:create-video", "Cut a 15-second teaser of a pixel courtroom: gavel strikes, the docket scrolls, a wax seal stamps a ruling."],
  ["fuzz", "Fuzz the staking vault's share accounting for 100,000 runs; report any invariant that breaks."],
  ["multi_contract", "Write a Merkle distributor and a vesting wallet factory that share one claim page."],
  ["skill:frontend-for-contract", "Frontend for the deployed escrow: connect a wallet, deposit COMD, show the countdown to release."],
  ["research", "Compare how five ERC-8004 deployments score agent reputation; cite each registry's source."],
  ["launch:evm_project", "Release Brief (BRF): an ERC-20 and a tip jar that forwards ETH to a recipient, deployed with a site to tip and read totals."],
  ["skill:write-readme-and-docs", "Write the README and integration guide for the oracle attestation verifier library."],
  ["skill:adversarial-review", "Cross-examine the reward distributor: epoch roots, double-claim protection, owner powers."],
  ["skill:build-ponder-indexer", "Index every Incorporations trade into a table with price, side and trader; serve a JSON API."],
];
const STATES_DIST = ["completed", "completed", "completed", "completed", "completed", "completed", "completed", "completed", "completed", "blocked", "cancelled", "failed"] as const;

interface MockJob extends Job {
  _launch?: string;
}

function makeNodes(template: string, state: string, r = R): JobNode[] {
  const t = template.replace(/^skill:|^launch:/, "");
  let steps: { key: string; role: string; skill: string; dependsOn: string[] }[];
  if (template.startsWith("launch:")) {
    steps = [
      { key: "build_contract_project", role: "implement", skill: "build-contract-project", dependsOn: [] },
      { key: "write_foundry_tests", role: "tests", skill: "write-foundry-tests", dependsOn: ["build_contract_project"] },
      { key: "audit_access", role: "review", skill: "audit-specialist", dependsOn: ["write_foundry_tests"] },
      { key: "audit_math", role: "review", skill: "audit-specialist", dependsOn: ["write_foundry_tests"] },
      { key: "audit_economics", role: "review", skill: "audit-specialist", dependsOn: ["write_foundry_tests"] },
      { key: "audit_integration", role: "review", skill: "audit-specialist", dependsOn: ["write_foundry_tests"] },
      { key: "audit_judge", role: "review", skill: "audit-judge", dependsOn: ["audit_access", "audit_math", "audit_economics", "audit_integration"] },
    ];
  } else if (t === "impl_tests_review" || t === "multi_contract") {
    steps = [
      { key: "impl", role: "implement", skill: "implement-one-contract", dependsOn: [] },
      { key: "tests", role: "tests", skill: "write-foundry-tests", dependsOn: ["impl"] },
      { key: "review", role: "review", skill: "adversarial-review", dependsOn: ["tests"] },
    ];
  } else if (t === "audit") {
    steps = ["access", "math", "economics", "integration"].map((k) => ({ key: `audit_${k}`, role: "review", skill: "audit-specialist", dependsOn: [] as string[] }));
    steps.push({ key: "audit_judge", role: "review", skill: "audit-judge", dependsOn: steps.map((s) => s.key) });
  } else if (t === "research") {
    steps = [1, 2, 3, 4, 5].map((n) => ({ key: `panel_${n}`, role: "implement", skill: "research-report", dependsOn: [] }));
  } else if (t === "fuzz") {
    steps = [{ key: "fuzz", role: "tests", skill: "fuzz-campaign", dependsOn: [] }];
  } else if (t === "build-contract-project") {
    steps = [
      { key: "build_contract_project", role: "implement", skill: "build-contract-project", dependsOn: [] },
      { key: "adversarial_review", role: "review", skill: "adversarial-review", dependsOn: ["build_contract_project"] },
    ];
  } else {
    steps = [{ key: t.replace(/-/g, "_"), role: "implement", skill: t, dependsOn: [] }];
  }
  const n = steps.length;
  const doneUpTo = state === "completed" ? n : state === "executing" ? int(0, n - 1, r) : int(0, n - 1, r);
  return steps.map((s, i) => {
    let st = i < doneUpTo ? "accepted" : i === doneUpTo && state === "executing" ? "running" : state === "executing" ? "waiting" : "cancelled";
    if (state === "blocked" && i === doneUpTo) st = s.role === "review" ? "rejected" : "failed";
    if (state === "failed" && i === doneUpTo) st = "failed";
    const seat = st === "waiting" || st === "cancelled" ? null : { tokenId: String(onlineSeat()), agentId: "" };
    if (seat) seat.agentId = SEAT_STATS[Number(seat.tokenId)].agentId;
    return {
      key: s.key,
      role: s.role,
      skill: s.skill,
      state: st,
      attempt: st === "accepted" && r() < 0.15 ? 2 : 1,
      revisions: 0,
      dependsOn: s.dependsOn,
      allowedPaths: s.role === "tests" ? ["test"] : [],
      failureReason: st === "failed" ? "runtime_error: worker exited before submitting" : st === "rejected" ? "review_failed: 2 high findings unresolved" : null,
      updatedAt: at(int(1, 120) * MIN),
      verdict:
        st === "accepted" || st === "rejected"
          ? {
              status: st,
              profile: s.role === "implement" && /contract|implement/.test(s.skill) ? "foundry" : "none",
              evaluation: s.role === "review" ? "review" : /contract|implement|tests/.test(s.skill) ? "suite" : "structural",
              rejectionCode: st === "rejected" ? "findings_unresolved" : null,
              detail: st === "rejected" ? "the cross-examination found two high findings the builder did not resolve" : /contract|tests/.test(s.skill) ? "forge build and forge test passed in the clean-room rebuild (42 tests)" : "paths and tree verified; no suite was run for this kind of work",
              verifierVersion: "0.1.4+c0de11a2",
              verifiedTreeHash: hex(40, r),
              at: at(int(1, 120) * MIN),
              failedChecks: st === "rejected" ? ["review:high-findings"] : [],
            }
          : null,
      seat,
      live: st === "running" ? { startedAt: at(int(1, 20) * MIN), turns: int(2, 30, r) } : null,
    };
  });
}

const JOBS: MockJob[] = [];
{
  let t = 2 * MIN;
  for (let i = 0; i < 168; i++) {
    const [template, objective] = OBJECTIVES[i % OBJECTIVES.length];
    const state = i < 4 ? "executing" : i === 7 ? "executing" : pick(STATES_DIST);
    const id = uuid();
    const created = t;
    t += int(9, 95) * MIN;
    const nodes = makeNodes(template, state);
    const isLaunch = template.startsWith("launch:");
    const kind = template.replace(/^.*:/, "");
    const label = objective.match(/\$([A-Z]+)/)?.[1]?.toLowerCase() ?? (template.includes("website") ? `docket-${i}` : null);
    const media = /image|audio|video/.test(template)
      ? {
          cid: `bafy${hex(52)}`,
          files: Array.from({ length: template.includes("image") ? int(1, 4) : 1 }, (_, k) => {
            const ext = template.includes("image") ? "png" : template.includes("audio") ? "wav" : "mp4";
            const mt = template.includes("image") ? "image/png" : template.includes("audio") ? "audio/wav" : "video/mp4";
            return { hash: hex(64), name: `${ext}${k + 1}`, path: `artifacts/${template.includes("image") ? "seal" : template.includes("audio") ? "fanfare" : "teaser"}-${k + 1}.${ext}`, bytes: int(5_000, 12_000_000), committed: false, mediaType: mt };
          }),
        }
      : null;
    const repoUrl = /contract|website|frontend|launch|multi|impl_tests|readme|ponder|fuzz|audit/.test(template) ? `https://github.com/comd-filings/matter-${1000 + i}-${kind.replace(/_/g, "-")}` : null;
    JOBS.push({
      id,
      state,
      template,
      objective,
      blockedReason: state === "blocked" ? (nodes.find((n) => n.state === "rejected") ? "review_failed" : "runtime_error") : null,
      createdAt: at(created),
      updatedAt: at(Math.max(created - int(3, 40) * MIN, 30_000)),
      workflow: null,
      planning: null,
      paidBy: pick(WALLETS),
      parentJobId: null,
      project: { id, head: id, running: state === "executing" ? id : null, versions: [{ jobId: id, workflowId: null, objective, baseCommit: repoUrl ? hex(40) : null, state, createdAt: at(created) }] },
      deliver: !!repoUrl,
      host: !!label,
      site: label && state === "completed" && /website|launch|frontend/.test(template) ? { label, url: `https://${label}.${process.env.NEXT_PUBLIC_SITES_DOMAIN || "sites.comd.fun"}`, status: "live" } : null,
      launch: isLaunch ? { requested: true, kind, id: null, status: state === "completed" ? "live" : state === "executing" ? "building" : "parked", chainId: CH } : { requested: false, kind: null, id: null, status: null, chainId: null },
      oracleRequestId: null,
      delivery: repoUrl && state === "completed" ? { requested: true, mode: "repository", repoUrl, pullRequestUrl: `${repoUrl}/pull/1`, commit: hex(40) } : null,
      media,
      nodes,
      reviews:
        state === "completed"
          ? [{ status: "sent", chainId: CH, txHash: `0x${hex(64)}`, blockNumber: 1_204_000 + int(0, 90_000), sentAt: at(Math.max(created - 40 * MIN, 60_000)), entries: nodes.filter((n) => n.seat).map((n) => ({ nodeKey: n.key, agentId: n.seat!.agentId, value: 1, role: `verification:${n.verdict?.evaluation ?? "structural"}` })) }]
          : [],
      knownLimitations: state === "completed" && R() < 0.5 ? ["Gas figures are from the local fork, not the live chain.", "The site was checked at 375px and 1280px only."] : [],
    });
  }
}

// ---------------------------------------------------------------- launches
const LAUNCHES: (Launch & { _job: string })[] = JOBS.filter((j) => j.template?.startsWith("launch:")).map((j, i, arr) => {
  const id = uuid();
  const live = j.state === "completed";
  const sym = j.objective.match(/\$([A-Z]+)/)?.[1] ?? j.objective.match(/\(([A-Z]{2,6})\)/)?.[1] ?? "HOOK";
  const tokenAddr = addr();
  j.launch = { ...j.launch!, id };
  (j as MockJob)._launch = id;
  const artifacts = live
    ? [
        { role: "token", name: `${sym}Token`, address: tokenAddr, txHash: `0x${hex(64)}`, blockNumber: 1_100_000 + i * 700 },
        { role: "other", name: j.template === "launch:univ4_hook" ? "SellFeeHook" : `${sym}Treasury`, address: addr(), txHash: `0x${hex(64)}`, blockNumber: 1_100_000 + i * 700 },
        { role: "other", name: "ContributorDistributor", address: addr(), txHash: `0x${hex(64)}`, blockNumber: 1_100_000 + i * 700 + 1 },
      ]
    : [];
  const connected = ENROLLED.slice(0, 6).map((t) => ({ wallet: OWNERS[t]!, agentId: SEAT_STATS[t].agentId, tokenId: String(t), deviceKey: hex(64), lastHeartbeatAt: j.updatedAt }));
  const workers = j.nodes.filter((n) => n.seat).map((n) => ({ wallet: OWNERS[Number(n.seat!.tokenId)]!, deviceKey: hex(64), work: [{ hash: hex(64), role: n.role, jobId: j.id, nodeKey: n.key }] }));
  return {
    _job: j.id,
    id,
    jobId: j.id,
    objective: j.objective,
    launchNumber: arr.length - i,
    kind: j.template!.replace("launch:", ""),
    status: live ? "live" : j.state === "executing" ? "building" : "parked",
    chainId: CH,
    sourceRepoUrl: j.delivery?.repoUrl ?? null,
    sourceCommit: j.delivery?.commit ?? null,
    parkedReason: j.state === "blocked" ? "audit_panel_blocked" : null,
    artifactCount: artifacts.length,
    artifacts,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    policyVersion: 3,
    lifecycle: [
      { status: "requested", at: j.createdAt },
      { status: "building", at: j.createdAt, note: "Managing Partner planned 7 steps with an audit panel" },
      ...(live
        ? [
            { status: "attested", at: j.updatedAt, note: "Registrar rebuilt the source and attested the build" },
            { status: "admitted", at: j.updatedAt, note: "All admission checks passed against policy v3" },
            { status: "deployed", at: j.updatedAt, note: "ProjectFactory deployed with CREATE2" },
            { status: "live", at: j.updatedAt },
          ]
        : []),
    ],
    admission: {
      admittedAt: live ? j.updatedAt : null,
      checks: [
        { id: "build-reproduces", status: live ? "passed" : "pending", detail: "forge build in the clean room matches the attested tree hash" },
        { id: "audit-panel", status: live ? "passed" : j.state === "blocked" ? "failed" : "pending", detail: "4 justices and the chief justice found no unresolved high findings" },
        { id: "supply-split", status: live ? "passed" : "pending", detail: "10% to the swarm, pool share 88%, payer 2%" },
        { id: "gas-ceiling", status: live ? "passed" : "pending", detail: "estimated 0.0041 ETH ≤ ceiling 0.05 ETH" },
        { id: "owners", status: live ? "passed" : "pending", detail: "token, project and LP owners match policy" },
      ],
    },
    attestation: live ? { buildHash: `0x${hex(64)}`, treeHash: hex(40), attestedBy: "0x7e57a77e57a77e57a77e57a77e57a77e57a77e5", attestedAt: j.updatedAt, signature: `0x${hex(130)}` } : null,
    transactions: live ? artifacts.map((a) => ({ label: `deploy ${a.name}`, txHash: a.txHash, blockNumber: a.blockNumber, gasUsed: String(int(400_000, 2_400_000)) })) : [],
    allocations: [
      { label: "Pool (opens the market)", bps: 8800, to: "PoolManager" },
      { label: "Paying wallet", bps: 200, to: j.paidBy! },
      { label: "Swarm · worked on the launch (2%)", bps: 200, to: "ContributorDistributor" },
      { label: "Swarm · connected seats (8%)", bps: 800, to: "ContributorDistributor" },
    ],
    token: live ? { name: `${sym[0]}${sym.slice(1).toLowerCase()}`, symbol: sym, address: tokenAddr, totalSupply: "1000000000000000000000000000" } : null,
    pool: live ? { poolId: `0x${hex(64)}`, pairedWith: "ETH", fee: 3000, hook: j.template === "launch:univ4_hook" ? artifacts[1].address : null } : null,
    rewardSnapshot: live
      ? {
          at: j.updatedAt,
          rule: "equal_connected",
          version: 3,
          workers,
          breakdown: connected.map((c, k) => ({ wallet: c.wallet, launchAmount: k < workers.length ? "2857142857142857142857142" : "0", recentAmount: "13333333333333333333333333" })),
          connected,
          root: `0x${hex(64)}`,
          workCount: workers.length,
          workByKind: { implement: 1, tests: 1, review: Math.max(0, workers.length - 2) },
        }
      : null,
  };
});

// ---------------------------------------------------------------- oracle
const QUESTIONS: { q: string; type: string; answer: string; ev: string; chain: number }[] = [
  { q: "How much $COMD was burned on Robinhood Chain in the window?", type: "uint256", answer: "48211.07", ev: "chain", chain: 4663 },
  { q: "Did the Incorporations contract emit more than 500 Trade events in the last 24 hours?", type: "bool", answer: "true", ev: "chain", chain: 4663 },
  { q: "Which three Uniswap v4 pools paired with $COMD had the most swap volume in the last day?", type: "bytes32[]", answer: "0x8a1c…e2, 0x44f0…9b, 0x0c77…31", ev: "chain", chain: 4663 },
  { q: "Who chaired the 2026 Delaware Court of Chancery annual bench conference?", type: "bytes32", answer: "Chancellor K. McCormick", ev: "panel", chain: 1 },
  { q: "What was the median spot price of the ETH/COMD pool across the window, in COMD per 1 ETH?", type: "uint256", answer: "41,902", ev: "chain", chain: 4663 },
  { q: "How many ERC-8004 agents were registered on Robinhood Chain in the window?", type: "uint256", answer: "37", ev: "chain", chain: 4663 },
  { q: "Did openzeppelin/openzeppelin-contracts publish a non-prerelease release on October 1, 2026 UTC?", type: "bool", answer: "false", ev: "panel", chain: 1 },
  { q: "Which address received the most COMD on Robinhood Chain in the window?", type: "address", answer: "0x5fc5…d168", ev: "chain", chain: 4663 },
  { q: "Was the METAR at London Heathrow reporting rain at 12:00 UTC?", type: "bool", answer: "true", ev: "panel", chain: 1 },
  { q: "How many Counsel seats submitted accepted work in the last 24 hours?", type: "uint256", answer: "391", ev: "chain", chain: 46630 },
];
const ORACLE_STATUS = ["attested", "attested", "attested", "attested", "attested", "attested", "attested", "disagreed", "failed", "refused"];
const ORACLES: OracleRequest[] = [];
{
  let t = 4 * MIN;
  for (let i = 0; i < 132; i++) {
    const Q = QUESTIONS[i % QUESTIONS.length];
    const status = i === 1 ? "assessing" : i === 3 ? "reproducing" : pick(ORACLE_STATUS);
    const panelSize = pick([5, 5, 7, 10]);
    const quorum = Math.max(2, panelSize - pick([0, 1, 2]));
    const signed = status === "attested";
    const created = t;
    t += int(6, 70) * MIN;
    const toBlock = 1_290_000 - i * 400;
    const members = Array.from({ length: panelSize }, () => {
      const tk = onlineSeat();
      const ok = status === "attested" ? R() < 0.95 : status === "disagreed" ? R() < 0.6 : R() < 0.4;
      return { ok, tokenId: String(tk), wallet: OWNERS[tk]!, answer: status === "assessing" ? undefined : { v: 1, answer: ok ? Q.answer : "unknown", figure: ok ? Q.answer.replace(/[^0-9.]/g, "") || undefined : undefined, notes: ok ? `Read blocks ${toBlock - 7200}–${toBlock} from the public RPC; cross-checked with Blockscout.` : "Could not reproduce the evidence inside the window." } };
    });
    const agreed = members.filter((m) => m.ok).length;
    const job = JOBS[i % JOBS.length];
    ORACLES.push({
      id: uuid(),
      status,
      question: Q.q,
      questionHash: `0x${hex(64)}`,
      chainId: Q.chain,
      window: { fromBlock: toBlock - 7200, toBlock, toBlockHash: `0x${hex(64)}` },
      answerType: Q.type,
      evidence: Q.ev,
      panelSize,
      quorum,
      toleranceBps: Q.type === "uint256" ? 0 : undefined,
      validForSeconds: 86400,
      definitions: Q.ev === "panel" ? { sources: "Use primary sources only; a missing record is not a negative answer." } : { window: "The window is pinned at quote time to the block range shown." },
      jobId: job.id,
      members,
      agreement: signed || status === "disagreed" ? { agreed, answer: Q.answer, figure: Q.answer.replace(/[^0-9.]/g, ""), quorum, sources: Q.ev === "panel" ? ["github.com", "aviationweather.gov"] : ["rpc.mainnet.chain.robinhood.com"] } : null,
      computed: signed ? { answer: Q.answer, figure: Q.answer.replace(/[^0-9.]/g, "") } : null,
      attestation: signed ? { agreed, answer: `0x${hex(64)}`, figure: Q.answer.replace(/[^0-9]/g, "") || "0", quorum, chainId: Q.chain, toBlock, issuedAt: Math.floor((NOW - created + 20 * MIN) / 1000), expiresAt: Math.floor((NOW - created + 20 * MIN + DAY) / 1000) } : null,
      signature: signed ? `0x${hex(130)}` : null,
      signer: signed ? "0x7e57a77e57a77e57a77e57a77e57a77e57a77e5" : null,
      attestedAt: signed ? at(Math.max(created - 18 * MIN, 30_000)) : null,
      failure: status === "failed" ? "panel_timeout: fewer than quorum answered in time" : status === "refused" ? "ambiguous_question: pin the reading in definitions" : status === "disagreed" ? "quorum_not_met: answers did not match" : null,
      createdAt: at(created),
      updatedAt: at(Math.max(created - 18 * MIN, 30_000)),
      consumer: { chainId: 4663, verifyingContract: "0x1111111111111111111111111111111111111111" },
    });
  }
}

// ---------------------------------------------------------------- schedules (retainers)
const SCHEDULES: Schedule[] = [
  ["Daily $COMD burn ruling", "oracle.request", { cron: "0 9 * * *", tz: "UTC" }, 30, 22, "active"],
  ["Weekly Incorporations digest", "job.open", { cron: "0 8 * * 1", tz: "Europe/London" }, 12, 9, "active"],
  ["Four-hour COMD leader", "oracle.request", { every: "PT4H" }, 60, 41, "active"],
  ["Counsel leaderboard site", "job.open", { every: "P1D" }, 14, 0, "exhausted"],
  ["Heathrow rain check", "oracle.request", { every: "PT6H" }, 28, 13, "paused"],
  ["Monthly reserve report", "job.open", { cron: "0 12 1 * *", tz: "America/New_York" }, 6, 5, "active"],
  ["Pool volume ranking", "oracle.request", { cron: "30 */2 * * *", tz: "UTC" }, 120, 0, "cancelled"],
  ["Hourly gas watch", "oracle.request", { every: "PT1H" }, 240, 199, "active"],
].map(([label, action, cadence, total, remaining, status], i) => {
  const id = uuid();
  const created = (i + 1) * 9 * HOUR;
  return {
    id,
    label: label as string,
    action: action as Schedule["action"],
    actionVersion: 1,
    continue: action === "job.open" && i % 2 === 1,
    status: status as string,
    statusReason: status === "paused" ? "three_failures" : null,
    cadence: cadence as Schedule["cadence"],
    input: action === "oracle.request" ? { v: 1, question: QUESTIONS[i % QUESTIONS.length].q, chainId: 4663, window: { hours: 24 }, answerType: QUESTIONS[i % QUESTIONS.length].type, panelSize: 5, quorum: 5, validForSeconds: 86400 } : { objective: OBJECTIVES[(i * 5) % OBJECTIVES.length][1], skill: "research-report", github: false },
    runs: { total: total as number, remaining: remaining as number },
    runsRemaining: remaining as number,
    runsBought: total as number,
    owner: WALLETS[i * 3],
    paid: true,
    pausedReason: status === "paused" ? "three consecutive runs failed" : null,
    nextRunAt: status === "active" ? new Date(NOW + int(5, 300) * MIN).toISOString() : null,
    lastRunAt: at(int(10, 300) * MIN),
    expiresAt: null,
    createdAt: at(created),
    updatedAt: at(int(10, 300) * MIN),
    url: `/schedules/${id}`,
    latest: Array.from({ length: Math.min(8, (total as number) - (remaining as number)) }, (_, k) => {
      const st = status === "paused" && k < 3 ? "failed" : k === 5 ? "skipped" : "opened";
      const res = action === "oracle.request" ? ORACLES[(i * 7 + k) % ORACLES.length] : null;
      const job = JOBS[(i * 11 + k) % JOBS.length];
      return {
        seq: (total as number) - (remaining as number) - k,
        status: st,
        dueAt: at((k + 1) * 4 * HOUR),
        firedAt: st === "skipped" ? null : at((k + 1) * 4 * HOUR - 20_000),
        missedSlots: st === "skipped" ? 1 : 0,
        failure: st === "failed" ? "input_refused: window resolved to an empty block range" : null,
        result: st === "opened" ? (res ? { kind: "oracle", id: res.id, url: `/oracle/requests/${res.id}` } : { kind: "job", id: job.id, url: `/jobs/${job.id}` }) : null,
      };
    }),
  };
});

// ---------------------------------------------------------------- publications
function publicationOf(j: MockJob): Publication | null {
  if (j.state !== "completed") return null;
  const tpl = j.template ?? "";
  const types: string[] = [];
  const p: Publication = { id: `job:${j.id}`, title: cut(j.objective.split(/[.:]/)[0], 90), types, paidBy: j.paidBy, publishedAt: j.updatedAt, code: [], media: [], sites: [], research: [], audits: [], contracts: [], release: null, versions: [], seats: [...new Set(j.nodes.filter((n) => n.seat).map((n) => n.seat!.tokenId))] };
  if (j.media) {
    types.push("media");
    p.media.push({ jobId: j.id, cid: j.media.cid, files: j.media.files, publishedAt: j.updatedAt });
  }
  if (tpl.includes("research")) {
    types.push("research");
    p.research.push({ jobId: j.id, panel: tpl === "research" ? { size: 5, quorum: 3 } : null, steps: j.nodes.length, repoUrl: null, pullRequestUrl: null, publishedAt: j.updatedAt });
  }
  if (tpl === "audit") {
    types.push("audits");
    p.audits.push({ jobId: j.id, reportUrl: `/jobs/${j.id}/report.md`, findings: int(0, 6), publishedAt: j.updatedAt });
  }
  if (j.delivery?.repoUrl && !tpl.startsWith("launch:")) {
    types.push(/contract|impl_tests|multi/.test(tpl) ? "contracts" : "code");
    p.code.push({ jobId: j.id, repoUrl: j.delivery.repoUrl, pullRequestUrl: j.delivery.pullRequestUrl ?? null, commit: j.delivery.commit ?? null, skill: tpl.replace("skill:", ""), publishedAt: j.updatedAt });
  }
  if (j.site) {
    types.push("sites");
    p.sites.push({ jobId: j.id, label: j.site.label, url: j.site.url, status: "live", publishedAt: j.updatedAt });
  }
  if (tpl.startsWith("launch:")) {
    const L = LAUNCHES.find((l) => l._job === j.id);
    if (L) {
      types.push("contracts");
      if (L.token) types.unshift("tokens");
      p.title = L.token ? `$${L.token.symbol}` : p.title;
      p.release = { launchId: L.id, launchNumber: L.launchNumber, token: L.token ? { name: L.token.name, symbol: L.token.symbol, address: L.token.address } : undefined, chainId: CH };
      p.contracts = L.artifacts.map((a) => ({ launchId: L.id, chainId: CH, name: a.name, address: a.address, role: a.role }));
    }
  }
  if (!types.length) types.push("code");
  return p;
}
const PUBLICATIONS = JOBS.map(publicationOf).filter((p): p is Publication => !!p);

// ---------------------------------------------------------------- events (docket feed): API shape {at, type, data}
function events(): RawSwarmEvent[] {
  const ev: RawSwarmEvent[] = [];
  const e = (atIso: string, type: string, data: Record<string, unknown>) => ev.push({ at: atIso, type, data });
  for (const j of JOBS.slice(0, 40)) {
    const n = j.nodes.find((x) => x.seat);
    const tk = n?.seat?.tokenId ?? null;
    if (j.state === "executing") {
      e(j.createdAt, "job.opened", { jobId: j.id, template: j.template, nodes: j.nodes.map((x) => `${x.key}:${x.skill ?? x.role}`), launch: !!j.launch?.requested, createdBy: "request" });
      const r = j.nodes.find((x) => x.state === "running" && x.seat);
      if (r) e(r.updatedAt ?? j.updatedAt, "lease.assigned", { jobId: j.id, nodeKey: r.key, skill: r.skill ?? r.role, kind: "work", tokenId: r.seat!.tokenId, attempt: r.attempt });
    } else if (j.state === "completed") {
      if (n) e(n.updatedAt ?? j.updatedAt, "node.accepted", { jobId: j.id, nodeKey: n.key, skill: n.skill ?? n.role, tokenId: tk, evaluation: "rerun" });
      e(j.updatedAt, "job.completed", { jobId: j.id, delivery: j.delivery?.repoUrl ?? null, site: j.site?.url ?? null, launch: null });
    } else if (j.state === "blocked") e(j.updatedAt, "node.rejected", { jobId: j.id, nodeKey: j.nodes.find((x) => x.state === "rejected")?.key ?? "review", tokenId: tk, detail: j.blockedReason });
  }
  for (const o of ORACLES.slice(0, 20)) {
    if (o.status === "attested") {
      e(o.attestedAt!, "oracle.attested", { requestId: o.id, failure: null });
      e(o.updatedAt, "oracle.agreed", { requestId: o.id, agreed: o.agreement?.agreed, quorum: o.quorum, answer: o.agreement?.answer });
    } else e(o.createdAt, "oracle.opened", { requestId: o.id, jobId: o.jobId, panelSize: o.panelSize, quorum: o.quorum, evidence: o.evidence });
  }
  for (const l of LAUNCHES.slice(0, 4)) if (l.status === "live") e(l.updatedAt, "launch.live", { launchId: l.id, launchNumber: l.launchNumber, token: l.token, root: null });
  for (const t of ENROLLED.slice(0, 6)) e(at(int(5, 600) * MIN), "seat.paired", { tokenId: String(t), deviceKey: hex(64), wallet: OWNERS[t] });
  return ev.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50);
}

// ---------------------------------------------------------------- seat detail: API seat view shape
const runtimeFor = (t: number) => ({
  name: t % 3 === 0 ? "codex" : "claude",
  version: t % 3 === 0 ? "codex-cli 0.48.0" : "2.1.290 (Claude Code)",
  // premium = a top-tier model (claude-opus-5-5 / gpt-6-astra) at high effort
  model: t % 3 === 0 ? (t % 4 === 0 ? "gpt-6-astra" : "gpt-6") : t % 4 === 0 ? "claude-opus-5-5" : t % 7 === 0 ? "claude-fable-5-1" : "claude-sonnet-5-5",
  effort: t % 4 === 0 ? "high" : "medium",
  premium: t % 4 === 0,
});

function seatDetail(tokenId: number) {
  if (tokenId < 1 || tokenId > MINTED) return null;
  const s = SEAT_STATS[tokenId];
  const rr = prng(tokenId + 11);
  const work = JOBS.flatMap((j) => j.nodes.filter((n) => n.seat?.tokenId === String(tokenId)).map((n) => ({ j, n })));
  const rows = work
    .map(({ j, n }) => ({ jobId: j.id, nodeKey: n.key, skill: n.skill ?? n.role, state: n.state === "accepted" ? "accepted" : n.state === "rejected" ? "rejected" : n.state === "failed" ? "failed" : n.state === "running" ? "leased" : "submitted", attempt: n.attempt, leasedAt: at(Date.now() - Date.parse(n.updatedAt!) + int(5, 40, rr) * MIN), finishedAt: n.state === "running" ? null : n.updatedAt!, submissionHash: hex(64, rr), failure: n.failureReason ?? null, objective: j.objective.slice(0, 200) }))
    .sort((a, b) => Date.parse(b.leasedAt) - Date.parse(a.leasedAt));
  const base = { tokenId: String(tokenId), owner: OWNERS[tokenId], image: `/art/${tokenId}.svg`, metadata: `/agents/by-token/${tokenId}.json` };
  if (!s) return { ...base, agentId: null, online: false, lastSeenAt: null, version: null, runtime: null, attempts: 0, accepted: 0, rejected: 0, failed: 0, pending: 0, lastWorkedAt: null, work: [], reviews: [], collaborators: [] };
  return {
    ...base,
    agentId: s.agentId,
    online: ONLINE.has(tokenId),
    lastSeenAt: at(int(1, 60, rr) * 1000),
    version: s.version,
    runtime: runtimeFor(tokenId),
    attempts: s.attempts,
    accepted: s.accepted,
    rejected: s.rejected,
    failed: s.failed,
    pending: s.pending,
    lastWorkedAt: s.last,
    work: rows.filter((r) => !/review|audit|judge/.test(r.nodeKey)).slice(0, 50),
    reviews: rows.filter((r) => /review|audit|judge/.test(r.nodeKey)).slice(0, 50),
    collaborators: ENROLLED.slice(0, 5).map((t) => ({ tokenId: String(t), jobs: int(1, 30, rr) })),
  };
}
const COUNSEL_ADDR = "0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

// ---------------------------------------------------------------- submissions
function submissionsOf(j: MockJob): Submission[] {
  const rr = prng(parseInt(j.id.slice(0, 8), 16));
  return j.nodes
    .filter((n) => n.seat && n.state !== "running")
    .map((n) => ({
      hash: hex(64, rr),
      nodeKey: n.key,
      role: n.role,
      attempt: n.attempt,
      deviceKey: hex(64, rr),
      seat: n.seat!,
      outcome: n.state === "failed" ? "failed" : "completed",
      accepted: n.state === "accepted" ? true : n.state === "rejected" ? false : null,
      failureReason: n.failureReason ?? null,
      failureClass: n.state === "failed" ? "runtime" : null,
      usage: { model: Number(n.seat!.tokenId) % 3 === 0 ? "gpt-6-astra" : "claude-opus-5-5", turns: int(6, 40, rr), runtime: Number(n.seat!.tokenId) % 3 === 0 ? "codex" : "claude", inputTokens: int(12, 400, rr), wallClockMs: int(90_000, 900_000, rr), outputTokens: int(4_000, 60_000, rr), cachedInputTokens: int(100_000, 900_000, rr) },
      artifacts: j.media?.files ?? [],
      changedPaths: n.role === "tests" ? ["test/Vault.t.sol", "test/invariants/Shares.t.sol"] : n.role === "review" ? ["artifacts/review.md"] : ["src/Vault.sol", "src/interfaces/IVault.sol", "README.md", "script/Deploy.s.sol"].slice(0, int(1, 4, rr)),
      summary:
        n.role === "review"
          ? "Cross-examined the contracts against the objective. No high findings remain; one medium (rounding on redeem favours the caller by 1 wei) was fixed by the builder and re-checked. Owner powers are limited to pause and fee recipient."
          : n.role === "tests"
            ? "Added 18 unit tests and 4 invariants (share accounting, rounding direction, fee routing, no free shares). All pass in 2.1s; fuzz runs 10,000 per invariant."
            : "Implemented the work as specified. The contract compiles with solc 0.8.28 and passes the existing suite. Notes for the reviewer: the exit fee is taken in assets before shares are burned, so previewRedeem reflects it.",
      createdAt: n.updatedAt!,
      verdict: n.verdict ?? null,
      findings: n.role === "review" ? [{ severity: "medium", title: "Rounding on redeem favours the caller", detail: "Fixed in the second attempt." }, { severity: "info", title: "Owner can change the fee recipient" }] : [],
    }));
}

// ---------------------------------------------------------------- paid requests (mock state machine)
const ORDERS = new Map<string, { id: string; action: string; input: unknown; status: string; createdAt: number; payer?: string; result?: unknown }>();
const PRICE = "100000000000000000000";
const PAYTO = "0x4e7e4e7e4e7e4e7e4e7e4e7e4e7e4e7e4e7e4e7e";
const COMD_TOKEN = "0xc0dd0c0dd0c0dd0c0dd0c0dd0c0dd0c0dd0c0dd0";

function capabilities() {
  const actions = ["job.open", "job.continue", "launch.open", "workflow.open", "oracle.request", "schedule.create", "schedule.topup"];
  return {
    actions: actions.map((a) => ({ action: a, version: a.split(".")[0] + "-1", payment: { network: `eip155:${CH}`, asset: COMD_TOKEN, amount: PRICE, payTo: PAYTO, decimals: 18 }, quoteTtlSeconds: 600 })),
    limits: {
      "oracle.request": { minPanelSize: 5, maxPanelSize: 100 },
      "schedule.create": { minRuns: 1, maxRuns: 1_000_000, minOracleIntervalMinutes: 10, minJobIntervalMinutes: 30 },
      "schedule.topup": { minRuns: 1, maxRuns: 1_000_000, minOracleIntervalMinutes: 10, minJobIntervalMinutes: 30 },
    },
    launches: {
      defaultChainId: 4663,
      chains: [
        { chainId: 4663, name: "Robinhood Chain", testnet: false, kinds: ["univ4_hook", "evm_project", "custom_token", "evm_contracts"], pairings: [
          { pairWith: "eth", currency: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ether", decimals: 18, kinds: ["univ4_hook", "evm_project", "custom_token"] },
          { pairWith: "company", currency: "0xc0bbc0bbc0bbc0bbc0bbc0bbc0bbc0bbc0bbc0bb", symbol: "COMD", name: "Company.md", decimals: 18, kinds: ["custom_token"] },
        ] },
        { chainId: 46630, name: "Robinhood Chain Testnet", testnet: true, kinds: ["univ4_hook", "evm_project", "custom_token", "evm_contracts"], pairings: [
          { pairWith: "eth", currency: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ether", decimals: 18, kinds: ["univ4_hook", "evm_project", "custom_token"] },
        ] },
      ],
    },
    pricedPer: { "schedule.create": "run", "schedule.topup": "run" },
    authentication: { scheme: "Bearer", tokenBytes: 32, encoding: "hex", creator: "client" },
    payment: { x402Version: 2, scheme: "exact", assetTransferMethod: "permit2", quoteApproval: "EIP-712" },
  };
}

function check(body: { action?: string; input?: Record<string, unknown> }) {
  const action = body.action ?? "job.open";
  const input = body.input ?? {};
  const blockers: { code: string; message: string }[] = [];
  const suggestions: { code?: string; message: string }[] = [];
  if (action === "oracle.request") {
    const q = String(input.question ?? "");
    if (q.trim().length < 12) blockers.push({ code: "question_too_short", message: "State the question in full: what is measured, on which chain, over which window." });
    if (Number(input.panelSize ?? 0) < 5) blockers.push({ code: "panel_too_small", message: "A panel needs at least 5 counsel." });
    if (!/window|hour|block|day|today|202\d/i.test(q)) suggestions.push({ code: "pin_time", message: "Pin the time: name the window or the block range the answer must come from." });
    return {
      action,
      blockers,
      suggestions,
      request: { v: 1, question: q, chainId: input.chainId ?? 4663, window: input.window ?? { hours: 24 }, answerType: input.answerType ?? "bool", evidence: input.evidence ?? "chain", panelSize: input.panelSize ?? 5, quorum: input.quorum ?? input.panelSize ?? 5, validForSeconds: input.validForSeconds ?? 86400, consumer: { chainId: 4663, verifyingContract: "0x0000000000000000000000000000000000000000" } },
    };
  }
  if (action === "schedule.create") {
    const runs = Number(input.runs ?? 1);
    const inner = (input.input ?? {}) as Record<string, unknown>;
    if (!inner.question && !inner.objective) blockers.push({ code: "input_required", message: "Describe the question or the job each run opens." });
    return { action, blockers, suggestions, unitAmount: PRICE, runs, amount: String(BigInt(PRICE) * BigInt(runs)), terms: ["Only opened runs spend a run; skipped and failed runs cost nothing.", "Unused runs are not refunded.", "Three failures in a row pause the retainer; a top-up resumes it."] };
  }
  const objective = String(input.objective ?? "");
  if (objective.trim().length < 20) blockers.push({ code: "objective_too_short", message: "Say what to build in at least a sentence: the contracts, the token and what the site shows." });
  if (!/test/i.test(objective) && /contract|token|hook/i.test(objective)) suggestions.push({ code: "ask_for_tests", message: "Ask for tests explicitly; the Clerk only runs suites that exist." });
  const launch = action === "launch.open";
  return {
    action,
    blockers,
    suggestions,
    kind: launch ? String(input.onchain ?? "custom_token") : "job",
    plan: launch
      ? { shape: "dag", steps: [{ skill: "build-contract-project", role: "implement", why: "contracts and token from the objective" }, { skill: "write-foundry-tests", role: "tests", why: "suite the Clerk can rerun" }, { skill: "audit-specialist", role: "review", why: "The Bench: 4 justices" }, { skill: "audit-judge", role: "review", why: "chief justice rules on findings" }, { skill: "frontend-for-contract", role: "implement", why: "site against the live deployment" }], references: ["solidity-security-review", "evm-project-launch"] }
      : { shape: "chain", steps: [{ skill: String(input.skill ?? "build-contract-project"), role: "implement", why: "matches the objective" }, { skill: "adversarial-review", role: "review", why: "independent cross-examination" }], references: [] },
    facts: { chainId: input.chainId ?? 4663, poolBps: (input.economics as Record<string, unknown> | undefined)?.poolBps ?? null, github: true, site: !!input.ipfs },
    judged: { summary: blockers.length ? "Not ready: fix the blockers first." : "Ready to quote. The Managing Partner would plan the steps above." },
  };
}

function admissionFor(action: string, order: { id: string; input: unknown }) {
  const j = JOBS[3];
  switch (action) {
    case "oracle.request":
      return { kind: "oracle", requestId: ORACLES[1].id, jobId: j.id, statusUrl: `/oracle/requests/${ORACLES[1].id}`, attestationUrl: `/oracle/requests/${ORACLES[1].id}/attestation` };
    case "schedule.create":
      return { kind: "schedule", scheduleId: SCHEDULES[0].id, statusUrl: `/schedules/${SCHEDULES[0].id}` };
    case "workflow.open":
      return { kind: "workflow", workflowId: uuid(), jobId: j.id, statusUrl: `/workflows/x`, jobUrl: `/jobs/${j.id}` };
    default:
      return { kind: "job", jobId: j.id, launch: action === "launch.open", statusUrl: `/jobs/${j.id}`, resultUrl: `/jobs/${j.id}/result` };
  }
}

// ---------------------------------------------------------------- router
export interface MockResponse {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

const ok = (json: unknown): MockResponse => ({ status: 200, json });
const notFound = (error: string): MockResponse => ({ status: 404, json: { error } });

function paginateBefore<T extends { createdAt: string }>(rows: T[], q: URLSearchParams) {
  const limit = Math.min(500, Math.max(1, Number(q.get("limit") ?? 100)));
  const before = q.get("before");
  const filtered = before ? rows.filter((r) => Date.parse(r.createdAt) < Date.parse(before)) : rows;
  return filtered.slice(0, limit);
}

function counts() {
  const jobStates: Record<string, number> = {};
  for (const j of JOBS) jobStates[j.state] = (jobStates[j.state] ?? 0) + 1;
  return jobStates;
}

export function mockFetch(method: string, rawPath: string, body?: unknown): MockResponse {
  const url = new URL(rawPath, "http://mock");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const q = url.searchParams;
  const seg = p.split("/").filter(Boolean);

  if (method === "GET") {
    if (p === "/version") return ok({ commit: "c0de11a2", branch: "main", deployedAt: at(2 * DAY), protocolVersion: "comd.v2", features: ["payments", "oracle", "schedules", "launches", "names"] });
    if (p === "/health")
      return ok({ status: "ok", version: "0.1.4+c0de11a2", operatorSurface: "public", identity: { chainId: CH, collection: COUNSEL_ADDR, adapter: "0x8004800480048004800480048004800480048004" }, taskNetwork: true, payments: { enabled: true, network: `eip155:${CH}`, actions: capabilities().actions.map((a) => a.action), gasWallet: { address: "0x5e771e5e771e5e771e5e771e5e771e5e771e5e77", balanceEth: "0.82", low: false }, orders: { quoted: 2, payment_pending: 0, payment_failed: 3, paid: 911, expired: 140 } }, connectedDaemons: ONLINE.size, workingNow: WORKING.length, acceptedLastDay: 61_204, activeEnrollments: ENROLLED.length, pendingVerification: 0, pendingDeployment: 0, verifierUp: true, publisherUp: true, deployerUp: true, computedAt: new Date().toISOString() });
    if (p === "/swarm") {
      const seats: Record<string, unknown> = {};
      for (const t of ENROLLED) {
        const s = SEAT_STATS[t];
        seats[t] = { tokenId: t, agentId: s.agentId, attempts: s.attempts, accepted: s.accepted, rejected: s.rejected, failed: s.failed, pending: s.pending, last: s.last, working: s.working, queued: 0 };
      }
      return ok({
        at: Date.now(),
        health: { reachable: true, agentsOnline: ONLINE.size, workingNow: WORKING.length, acceptedLastDay: 61_204, jobsDoneLastDay: 31, oraclesDoneLastDay: 412, seatsEnrolled: ENROLLED.length, pendingVerification: 3, pendingDeployment: 1, pendingSites: 2, verifierUp: true, publisherUp: true, deployerUp: true },
        counts: { jobs: JOBS.length, jobStates: counts(), tasksInProgress: JOBS.filter((j) => j.state === "executing").length, launchesLive: LAUNCHES.filter((l) => l.status === "live").length, sites: JOBS.filter((j) => j.site).length, inferenceTokens: 18_402_771_092 },
        seats,
        events: events(),
      });
    }
    if (p === "/flywheel") {
      const wei = (eth: number) => (BigInt(Math.round(eth * 1e6)) * 10n ** 12n).toString();
      const comd = (n: number) => (BigInt(Math.round(n)) * 10n ** 18n).toString();
      const swept = [7, 133, 404, 777, 1001, 1234, 1500, 1776, 42];
      const events = [
        { type: "Buyback", source: "flywheel", ethIn: wei(0.84), comdBurned: comd(338_120) },
        { type: "Trimmed", source: "hook", excess: comd(212_400), liquidityRemoved: "0", ethOut: wei(0.31), comdOut: comd(212_400) },
        { type: "Split", source: "hook", amount: comd(212_400), burned: comd(180_540), toBond: comd(12_744), toStakers: comd(9_558), toSeats: comd(9_558) },
        { type: "Swept", source: "flywheel", tokenId: 42, price: wei(0.061) },
        { type: "WallPosted", source: "buyWall", tickLower: -138_200, tickUpper: -137_000, liquidity: "0", eth: wei(1.42) },
        { type: "TaxIn", source: "flywheel", eth: wei(0.0213) },
        { type: "Dripped", source: "rewardDripper", vault: "0x5c0d000000000000000000000000000000005c0d", amount: comd(41_220) },
        { type: "Bonded", source: "bond", buyer: "0x9fad00000000000000000000000000000000f63f", ethIn: wei(0.5), comdOut: comd(50_000) },
        { type: "Buyback", source: "flywheel", ethIn: wei(0.62), comdBurned: comd(251_004) },
        { type: "Distributed", source: "revenueRouter", total: comd(48_000), toRewards: comd(38_400), toTreasury: comd(9_600) },
        { type: "Swept", source: "flywheel", tokenId: 1776, price: wei(0.058) },
        { type: "CapUpdated", source: "hook", cap: comd(31_400_000), inventory: comd(30_880_000) },
        { type: "TaxIn", source: "flywheel", eth: wei(0.0472) },
        { type: "Swept", source: "flywheel", tokenId: 1500, price: wei(0.064) },
      ].map((e, i) => ({ ...e, blockNumber: 1_290_000 - i * 1_311, txHash: `0x${hex(64)}`, at: at((i + 1) * 47 * MIN) }));
      const flywheel = { bps: { buyback: 5000, sweep: 5000 }, buckets: { buyback: wei(0.412), sweep: wei(0.388) }, totals: { taxIn: wei(41.27), boughtBack: wei(20.1), burned: comd(8_102_118), swept: swept.length, sweepSpent: wei(0.55) }, sweptTokenIds: swept, maxSweepPrice: wei(0.08) };
      const hook = {
        taxBps: 500, totalTaxed: wei(41.27), pendingTax: wei(0.0042),
        stats: { trimmedComd: comd(12_880_400), trimmedEth: wei(9.64), split: comd(14_102_900), burned: comd(11_987_465), toBond: comd(846_174), toStakers: comd(634_630), toSeats: comd(634_630) },
        cap: comd(31_400_000), currentCap: comd(31_400_000), inventory: comd(28_120_000), lastInventory: comd(28_120_000),
        params: { capFloor: comd(100_000), capDecayPerDay: comd(100_000), burnBps: 8500, bondBps: 600, stakersBps: 450, seatsBps: 450, refStepTicks: 200 },
        claims: { eth: "0", comd: "0" },
      };
      const buyWall = { postedEth: wei(1.42), floorTick: -138_200, previewFloorTick: -138_000, totalBought: comd(1_222_500), totalTips: wei(0.011), parkedEth: wei(0.08), wallLower: -138_200, wallUpper: -137_000, wallLiquidity: "1", canRebalance: false };
      const staking = { totalAssets: comd(46_210_400), totalShares: (44_980_000n * 10n ** 24n).toString(), ratePerSecond: (BigInt(Math.round((634_630 / 30 / 86_400) * 1e6)) * 10n ** 12n).toString(), streamCapPerDay: comd(250_000), pending: comd(12_400), totalDripped: comd(560_000) };
      const bond = { enabled: true, priceEth: (10n ** 10n).toString(), reserve: comd(796_174), sold: comd(50_000), proceeds: wei(0.5) };
      const revenueRouter = { totalToRewards: comd(1_270_131), totalToTreasury: comd(317_533), bps: { rewards: 8000, treasury: 2000 } };
      return ok({ chainId: CH, configured: true, tax: { taxBps: 500, totalTaxed: hook.totalTaxed, pending: hook.pendingTax, toFlywheel: flywheel.totals.taxIn }, flywheel, hook, buyWall, staking, bond, revenueRouter, ...flywheel, events, errors: {}, computedAt: new Date().toISOString() });
    }
    if (p === "/steps/hourly") return ok({ until: new Date().toISOString(), hours: 24, accepted: Array.from({ length: 24 }, (_, i) => 1800 + Math.round(900 * Math.sin(i / 3)) + i * 20) });
    if (p === "/services") return ok({ services: [{ kind: "verifier", label: "The Clerk", keyPrefix: "c1e7", version: "0.1.4", up: true, lastSeenAt: at(8000), claims: 2 }, { kind: "publisher", label: "Records Office", keyPrefix: "7ec0", version: "0.1.4", up: true, lastSeenAt: at(12000), claims: 0 }, { kind: "deployer", label: "Registrar", keyPrefix: "4e61", version: "0.1.4", up: true, lastSeenAt: at(9000), claims: 0 }] });
    if (p === "/jobs") {
      let rows = JOBS.slice();
      const qq = q.get("q")?.toLowerCase();
      if (qq) rows = rows.filter((j) => j.objective.toLowerCase().includes(qq) || j.id.startsWith(qq));
      const st = q.get("state");
      if (st) {
        const set = new Set(st.split(","));
        rows = rows.filter((j) => set.has(j.state));
      }
      if (q.get("exclude") === "oracle") rows = rows.filter((j) => !j.template?.includes("oracle"));
      const page = paginateBefore(rows, q);
      return ok({ count: page.length, jobs: page.map(({ id, state, template, objective, blockedReason, delivery, createdAt, updatedAt, project }): JobListItem => ({ id, state, template, objective, blockedReason, delivery, createdAt, updatedAt, project })) });
    }
    if (seg[0] === "jobs" && seg[1]) {
      const j = JOBS.find((x) => x.id === seg[1]);
      if (!j) return notFound("unknown_job");
      if (seg.length === 2) {
        const { _launch, ...rest } = j;
        void _launch;
        return ok({ ...rest, media: j.media ? j.media.files.map((f) => ({ name: f.name, path: f.path, mediaType: f.mediaType, hash: f.hash, url: `/artifacts/${f.hash}`, bytes: f.bytes })) : null, stage: j.state });
      }
      if (seg[2] === "submissions") return ok(submissionsOf(j).map((x) => ({ hash: x.hash, nodeKey: x.nodeKey, tokenId: x.seat?.tokenId, agentId: x.seat?.agentId, wallet: OWNERS[Number(x.seat?.tokenId)] ?? null, accepted: x.accepted, verdict: x.verdict, oracleResult: null, findings: x.findings, usage: { turns: x.usage!.turns, inputTokens: x.usage!.inputTokens, outputTokens: x.usage!.outputTokens, cacheTokens: x.usage!.cachedInputTokens, durationMs: x.usage!.wallClockMs }, runtime: runtimeFor(Number(x.seat?.tokenId ?? 0)), summary: x.summary, bundleHash: hex(64), files: x.changedPaths.map((path) => ({ path, sha256: hex(64), bytes: int(400, 9000), mediaType: "text/plain" })), artifacts: x.artifacts, createdAt: x.createdAt })));
      if (seg[2] === "records") return ok({ records: j.reviews.map((r, k) => ({ id: `${j.id}:${k}`, hash: hex(64), chainId: r.chainId, registry: "0x8004a1c3a1c3a1c3a1c3a1c3a1c3a1c3a1c3a1c3", status: r.status === "sent" ? "confirmed" : "queued", txHash: r.txHash, failure: null, blockNumber: r.blockNumber, score: r.entries.length })), oracleBatches: [] });
      if (seg[2] === "result") return ok({ jobId: j.id, projectId: j.id, state: j.state, complete: j.state === "completed", source: j.delivery ? [{ repoUrl: j.delivery.repoUrl, commit: j.delivery.commit }] : [], files: (j.media?.files ?? []).map((f) => ({ ...f, submissionHash: hex(64), url: `/artifacts/${f.hash}` })), delivery: j.delivery });
      if (seg[2] === "assessments") return ok({ assessments: [] });
      if (seg[2] === "panel") return j.template === "research" ? ok({ state: "closed", wanted: 5, quorum: 3, answers: [] }) : notFound("no_panel");
      if (seg[2] === "fuzz") return j.template === "fuzz" ? ok({ state: "closed", runs: 100000, confirmed: 0, results: [] }) : notFound("no_fuzz");
    }
    if (p === "/workflows") return ok({ count: 0, workflows: [] });
    if (p === "/oracle/counts") {
      const byStatus: Record<string, number> = {};
      for (const o of ORACLES) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      return ok({ total: ORACLES.length, byStatus });
    }
    if (p === "/oracle/requests") {
      let rows = ORACLES.slice();
      const st = q.get("status");
      if (st) {
        const set = new Set(st.split(","));
        rows = rows.filter((o) => set.has(o.status));
      }
      const qq = q.get("q")?.toLowerCase();
      if (qq) rows = rows.filter((o) => o.question.toLowerCase().includes(qq));
      const page = paginateBefore(rows, q);
      return ok({ count: page.length, attester: "0x7e57a77e57a77e57a77e57a77e57a77e57a77e5", requests: page.map(({ id, status, question, chainId, window, answerType, jobId, signer, attestedAt, createdAt, updatedAt, panelSize, quorum }) => ({ id, status, question, chainId, window, answerType, jobId, signer, attestedAt, createdAt, updatedAt, panelSize, quorum })) });
    }
    if (seg[0] === "oracle" && seg[1] === "requests" && seg[2]) {
      const o = ORACLES.find((x) => x.id === seg[2]);
      if (!o) return notFound("unknown_request");
      if (!seg[3]) return ok(o);
      if (seg[3] === "attestation") {
        if (!o.attestation) return notFound("not_attested");
        return ok({
          requestId: o.id,
          primaryType: "OracleAttestation",
          domain: { name: "Company.md Oracle", version: "1", chainId: o.consumer?.chainId, verifyingContract: o.consumer?.verifyingContract },
          types: { OracleAttestation: [["requestId", "bytes32"], ["chainId", "uint256"], ["questionHash", "bytes32"], ["answerType", "string"], ["answer", "bytes"], ["figure", "uint256"], ["fromBlock", "uint256"], ["toBlock", "uint256"], ["blockHash", "bytes32"], ["panelJobId", "bytes32"], ["issuedAt", "uint64"], ["expiresAt", "uint64"]].map(([name, type]) => ({ name, type })) },
          message: { requestId: `0x${o.id.replace(/-/g, "").padEnd(64, "0")}`, chainId: o.chainId, questionHash: o.questionHash, answerType: o.answerType, answer: o.attestation.answer, figure: o.attestation.figure, fromBlock: o.window.fromBlock, toBlock: o.window.toBlock, blockHash: o.window.toBlockHash, panelJobId: `0x${(o.jobId ?? "").replace(/-/g, "").padEnd(64, "0")}`, issuedAt: o.attestation.issuedAt, expiresAt: o.attestation.expiresAt },
          signature: o.signature,
          signer: o.signer,
          attestedAt: o.attestedAt,
        });
      }
      if (seg[3] === "pools") return ok({ requestId: o.id, pools: [] });
    }
    if (p === "/schedules") {
      let rows = SCHEDULES.slice();
      const owner = q.get("owner")?.toLowerCase();
      if (owner) rows = rows.filter((s) => s.owner === owner);
      const page = paginateBefore(rows, q);
      return ok({ count: page.length, schedules: page.map(({ latest, ...s }) => (void latest, s)) });
    }
    if (seg[0] === "schedules" && seg[1]) {
      const s = SCHEDULES.find((x) => x.id === seg[1]);
      return s ? ok(s) : notFound("unknown_schedule");
    }
    if (p === "/seats/records") {
      const seats = ENROLLED.map((t) => ({ tokenId: String(t), agentId: SEAT_STATS[t].agentId, attempts: SEAT_STATS[t].attempts, accepted: SEAT_STATS[t].accepted, rejected: SEAT_STATS[t].rejected, failed: SEAT_STATS[t].failed, pending: SEAT_STATS[t].pending, lastWorkedAt: SEAT_STATS[t].last }));
      return ok({ count: seats.length, seats });
    }
    if (p === "/seats/owners") return ok({ owners: OWNERS.slice(0, MINTED + 1) });
    if (seg[0] === "seats" && seg[1]) {
      const s = seatDetail(Number(seg[1]));
      if (!s) return notFound("unknown_seat");
      if (seg[2] === "standing") return ok({ tokenId: s.tokenId, eligible: s.online, online: s.online, running: WORKING.includes(Number(s.tokenId)) ? 1 : 0 });
      return ok(s);
    }
    if (p === "/workers")
      return ok({ count: ONLINE.size, workers: [...ONLINE].map((t) => ({ deviceKey: hex(64), tokenId: String(t), agentId: SEAT_STATS[t].agentId, wallet: OWNERS[t], working: SEAT_STATS[t].working, load: SEAT_STATS[t].working ? 1 : 0, version: SEAT_STATS[t].version, runtimes: [runtimeFor(t)], runtime: runtimeFor(t), premium: runtimeFor(t).premium, tools: { foundry: true, docker: t % 2 === 0, image: true, audio: t % 5 === 0 }, skills: ["build-contracts", "build-website", "research-report"], concurrency: 1, paused: false, connectedAt: at(int(1, 72) * HOUR), heartbeat: at(int(1, 30) * 1000) })) });
    if (p === "/contributors") return ok({ count: ENROLLED.length, contributors: ENROLLED.map((t) => ({ deviceKey: hex(64), tokenId: String(t), wallet: OWNERS[t], turns: SEAT_STATS[t].turns, wallClockMs: SEAT_STATS[t].ms, attempts: SEAT_STATS[t].attempts, accepted: SEAT_STATS[t].accepted })) });
    if (seg[0] === "wallets" && seg[2] === "earnings") {
      const w = seg[1].toLowerCase();
      const owned = OWNERS.map((o, i) => (o?.toLowerCase() === w && SEAT_STATS[i] ? i : -1)).filter((i) => i >= 0);
      const rewards = owned.flatMap((t) => [41, 42, 43].flatMap((epoch) => [
        { kind: "epoch", epoch, tokenId: String(t), asset: COMD_TOKEN, symbol: "COMD", decimals: 18, amount: String(BigInt(int(400, 9000)) * 10n ** 18n), root: `0x${hex(64)}`, proof: [`0x${hex(64)}`, `0x${hex(64)}`], status: "posted" },
      ]));
      return ok({ wallet: w, count: 0, next: null, earnings: [], rewards });
    }
    if (p === "/publications/counts") {
      const qq = q.get("q")?.toLowerCase();
      const rows = qq ? PUBLICATIONS.filter((x) => x.title.toLowerCase().includes(qq)) : PUBLICATIONS;
      const c = (t: string) => rows.filter((x) => x.types.includes(t)).length;
      return ok({ counts: { all: rows.length, tokens: c("tokens"), contracts: c("contracts"), sites: c("sites"), research: c("research"), code: c("code"), media: c("media"), audits: c("audits") } });
    }
    if (p === "/publications") {
      const type = q.get("type") ?? "all";
      const qq = q.get("q")?.toLowerCase() ?? "";
      const sort = q.get("sort") ?? "newest";
      const pageSize = Math.min(100, Math.max(1, Number(q.get("pageSize") ?? 20)));
      const page = Math.max(1, Number(q.get("page") ?? 1));
      let rows = PUBLICATIONS.filter((x) => (type === "all" || x.types.includes(type)) && (!qq || x.title.toLowerCase().includes(qq)));
      if (sort === "oldest") rows = rows.slice().reverse();
      return ok({ q: qq, page, sort, type, count: rows.length, items: rows.slice((page - 1) * pageSize, page * pageSize), pageSize, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) });
    }
    if (p === "/sites") {
      const sites = JOBS.filter((j) => j.site).map((j) => ({ id: j.id, status: "live", label: j.site!.label, url: j.site!.url, jobId: j.id, publishedAt: j.updatedAt }));
      return ok({ count: sites.length, total: sites.length, live: sites.length, sites });
    }
    if (p === "/launches") return ok({ count: LAUNCHES.length, launches: LAUNCHES.map(({ _job, lifecycle, admission, attestation, transactions, allocations, rewardSnapshot, token, pool, ...l }) => (void [_job, lifecycle, admission, attestation, transactions, allocations, rewardSnapshot, token, pool], l)) });
    if (seg[0] === "launches" && seg[1]) {
      const L = LAUNCHES.find((x) => x.id === seg[1]);
      if (!L) return notFound("unknown_launch");
      if (seg[2] === "assurances") return ok({ launchId: L.id, count: L.status === "live" ? 1 : 0, assurances: L.status === "live" ? [{ kind: "audit", provider: "The Bench (internal panel)", url: `/jobs/${L._job}`, commit: L.sourceCommit, recordedAt: L.updatedAt, revokedAt: null }] : [] });
      const { _job, ...rest } = L;
      void _job;
      return ok(rest);
    }
    if (p === "/launch/policies")
      return ok({ count: 1, policies: [{ version: 3, kind: "launch", note: "equal_connected, 10% swarm, pool 10–90%", createdAt: at(10 * DAY), params: { chainId: CH, feeTiers: [500, 3000, 10000], rewardRule: "equal_connected", totalSupply: "1000000000000000000000000000", treasuryBps: 1000, liquidityBps: 8000, contributorPoolBps: 1000, recentContributorBps: 800, recentContributorWindowSeconds: 43200, contributorLockSeconds: 3600, perWalletCapBps: 3000, poolFloorBps: 1000, gasCeilingWei: "50000000000000000", pairedCurrencyAllowlist: ["0x0000000000000000000000000000000000000000", "COMD", "COMD"] } }] });
    if (p === "/feedback/batches") return ok({ count: 0, batches: [] });
    if (p === "/requests/capabilities") return ok(capabilities());
    if (seg[0] === "requests" && seg[1] === "paid-by") return ok({ payer: seg[2], count: 0, orders: [] });
    if (seg[0] === "requests" && seg[1]) {
      const o = ORDERS.get(seg[1]);
      if (!o) return notFound("unknown_order");
      const elapsed = Date.now() - o.createdAt;
      const admitted = o.status === "payment_pending" && elapsed > 2500;
      if (admitted) o.status = "admitted";
      return ok({ status: o.status, order: { id: o.id, status: o.status === "admitted" ? "paid" : "quoted", quote: { action: o.action, expiresAt: Math.floor(o.createdAt / 1000) + 600 } }, payment: o.status === "admitted" ? { status: "confirmed", paid: true, transactionHash: `0x${hex(64)}` } : { status: "pending", paid: false, transactionHash: null }, admission: o.status === "admitted" ? { action: o.action, result: admissionFor(o.action, o) } : null });
    }
    if (p === "/names") return ok({ domain: "comd", resolver: "chambers", count: Object.keys(NAMES).length, names: Object.entries(NAMES).map(([owner, name]) => ({ name, label: name.split(".")[0], url: `https://${name.split(".")[0]}.${process.env.NEXT_PUBLIC_SITES_DOMAIN || "sites.comd.fun"}`, siteId: hex(8), kind: "site", jobId: null, tokenId: null, owner, version: 1, updatedAt: at(DAY) })) });
    if (seg[0] === "names" && seg[1]) {
      const e = Object.entries(NAMES).find(([, n]) => n.split(".")[0] === seg[1]);
      return e ? ok({ label: seg[1], name: e[1], address: e[0] }) : notFound("unknown_label");
    }
    if (seg[0] === "pair" && seg[1] === "wallet")
      return ok({ wallet: seg[2], refreshedAt: at(30_000), seats: OWNERS.map((o, i) => ({ o, i })).filter((x) => x.o !== null && x.o === OWNERS[1]).slice(0, 3).map(({ i }) => ({ tokenId: String(i), agentId: SEAT_STATS[i]?.agentId ?? null, registered: !!SEAT_STATS[i], enrolled: !!SEAT_STATS[i], deviceKey: SEAT_STATS[i] ? hex(64) : null, online: ONLINE.has(i) })) });
    if (seg[0] === "pair" && seg[1])
      return ok({ code: seg[1], consumed: false, enrolled: false, wallet: null, tokenId: null, agentId: null, deviceKey: hex(64), nonce: hex(64), expiresAt: Math.floor(Date.now() / 1000) + 600, expired: false, relayOrigin: "wss://api.comd.fun/agent", chainId: CH, nftContract: COUNSEL_ADDR });
    if (seg[0] === "agents" && seg[1] === "register-intent") {
      const tid = q.get("tokenId") ?? "0";
      const uri = `${process.env.NEXT_PUBLIC_API_URL || "https://api.comd.fun"}/agents/by-token/${tid}.json`;
      return ok({ to: "0x8004800480048004800480048004800480048004", data: "0xf2c298be", chainId: CH, agentURI: uri });
    }
    if (seg[0] === "enrollments" && seg[1]) return ok({ status: "unknown", reason: null });
    return notFound("unknown_route");
  }

  // ---------------- POST
  const b = (body ?? {}) as Record<string, unknown>;
  if (p === "/requests/check") return ok(check(b as { action?: string; input?: Record<string, unknown> }));
  if (p === "/requests/import") return ok({ ok: true, source: { repoUrl: b.url, baseCommit: hex(40), ref: b.ref ?? "main", sizeKb: 412, site: b.kind === "site" ? { framework: "vite" } : null } });
  if (p === "/requests/quote") {
    const id = uuid();
    ORDERS.set(id, { id, action: String(b.action), input: b.input, status: "quoted", createdAt: Date.now() });
    const runs = b.action === "schedule.create" ? Number((b.input as Record<string, unknown>)?.runs ?? 1) : 1;
    return { status: 201, json: { created: true, order: { id, status: "quoted", quote: { id, action: b.action, amount: String(BigInt(PRICE) * BigInt(runs)), payTo: PAYTO, expiresAt: Math.floor(Date.now() / 1000) + 600, quoteHash: hex(64), payment: { asset: COMD_TOKEN, amount: String(BigInt(PRICE) * BigInt(runs)), payTo: PAYTO, network: `eip155:${CH}` } } } } };
  }
  if (seg[0] === "requests" && seg[2] === "submit") {
    const o = ORDERS.get(seg[1]);
    if (!o) return notFound("unknown_order");
    if (!b.quoteSignature) {
      const amount = PRICE;
      const challenge = {
        x402Version: 2,
        error: "payment_required",
        accepts: [{ scheme: "exact", network: `eip155:${CH}`, asset: COMD_TOKEN, amount, payTo: PAYTO, maxTimeoutSeconds: 600, extra: { assetTransferMethod: "permit2", name: "Company.md", version: "1", spender: "0x5e771e5e771e5e771e5e771e5e771e5e771e5e77" } }],
        quote: { id: o.id, action: o.action, amount, payTo: PAYTO, expiresAt: Math.floor(o.createdAt / 1000) + 600, quoteHash: hex(64), payment: { asset: COMD_TOKEN, amount, payTo: PAYTO, network: `eip155:${CH}` } },
        requesterScopeHash: hex(64),
        resourceUrl: `/requests/${o.id}/submit`,
        input: o.input,
      };
      return { status: 402, json: challenge, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(challenge)).toString("base64") } };
    }
    o.status = "payment_pending";
    o.createdAt = Date.now();
    return { status: 202, json: { status: "payment_pending", order: { id: o.id, status: "quoted", quote: { action: o.action, expiresAt: Math.floor(Date.now() / 1000) + 600 } }, payment: { status: "pending", paid: false, transactionHash: null }, admission: null } };
  }
  if (p === "/agents/bind") return ok({ tokenId: b.tokenId, agentId: b.agentId ?? null, status: b.pending ? "pending" : "bound" });
  if (p === "/pair/complete") return ok({ ok: true, enrolled: true, tokenId: (b.message as Record<string, unknown>)?.tokenId });
  if (p === "/pair/start") return ok({ code: "K7Q2-M9", nonce: hex(64), expiresAt: new Date(Date.now() + 10 * MIN).toISOString(), relayOrigin: "wss://api.comd.fun/agent", chainId: CH, nftContract: COUNSEL_ADDR });
  return notFound("unknown_route");
}

