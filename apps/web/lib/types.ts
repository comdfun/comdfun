// Response shapes of the control plane API (Chambers). Mirrors IMD's documented shapes; optional fields are ones
// the web tolerates being absent.

export type Hex = `0x${string}`;

export interface Health {
  status: string;
  version: string;
  identity?: { chainId: number; collection: string; adapter?: string };
  payments?: {
    enabled: boolean;
    network: string;
    actions: string[];
    gasWallet?: { address: string; balanceEth: string; low: boolean };
    orders?: Record<string, number>;
  };
  connectedDaemons: number;
  workingNow: number;
  acceptedLastDay: number;
  activeEnrollments?: number;
  pendingVerification?: number;
  pendingDeployment?: number;
  verifierUp?: boolean;
  publisherUp?: boolean;
  deployerUp?: boolean;
  computedAt?: string;
}

export interface SwarmSeat {
  tokenId: number;
  agentId: string | null;
  attempts: number;
  accepted: number;
  rejected: number;
  failed: number;
  pending: number;
  last: string | null;
  working: boolean;
  queued: number;
}

/** Worker runtime as the daemon reports it (protocol RuntimeInfo). */
export interface RuntimeInfo {
  name: "claude" | "codex" | "mock" | string;
  version: string | null;
  model: string | null;
  effort: string | null;
  premium: boolean;
}

/** Raw /swarm event as the API stores it. Normalized into SwarmEvent by lib/events.ts. */
export interface RawSwarmEvent {
  at: string;
  type: string;
  data: Record<string, unknown>;
}

export interface SwarmEvent {
  at: string;
  type?: string;
  kind: "accepted" | "rejected" | "opened" | "signed" | "published" | "launched" | "connected" | "review" | "deployed" | string;
  text: string;
  tokenId?: string | null;
  jobId?: string | null;
  requestId?: string | null;
  launchId?: string | null;
}

export interface Swarm {
  at: number;
  health: {
    reachable: boolean;
    agentsOnline: number;
    workingNow: number;
    acceptedLastDay: number;
    jobsDoneLastDay?: number;
    oraclesDoneLastDay?: number;
    seatsEnrolled?: number;
    pendingVerification?: number;
    pendingDeployment?: number;
    pendingSites?: number;
    verifierUp?: boolean;
    publisherUp?: boolean;
    deployerUp?: boolean;
  };
  counts: {
    jobs: number;
    jobStates: Record<string, number>;
    tasksInProgress: number;
    launchesLive: number;
    sites: number;
    inferenceTokens?: number;
  };
  seats: Record<string, SwarmSeat>;
  /** Normalized by api.swarm(); the wire shape is RawSwarmEvent[]. */
  events?: SwarmEvent[];
}

export interface Activity {
  at: number;
  reachable: boolean;
  workflows: number;
  jobs: number;
  oracle: number;
  working: number;
  total: number;
  online?: number;
  acceptedLastDay?: number;
  health?: "ok" | "degraded" | "down";
  mock?: boolean;
  /** latest docket events for the ticker */
  events?: SwarmEvent[];
  launchesLive?: number;
  inferenceTokens?: number;
}

export interface Verdict {
  status: string;
  profile?: string;
  evaluation?: string;
  rejectionCode?: string | null;
  detail?: string;
  verifierVersion?: string;
  verifiedTreeHash?: string;
  at?: string;
  failedChecks?: string[];
}

export interface JobNode {
  key: string;
  role: string;
  state: string;
  attempt: number;
  revisions?: number;
  dependsOn: string[];
  allowedPaths?: string[];
  failureReason?: string | null;
  updatedAt?: string;
  verdict?: Verdict | null;
  seat?: { tokenId: string; agentId: string } | null;
  live?: { startedAt?: string; turns?: number } | null;
  skill?: string;
}

export interface MediaFile {
  hash: string;
  name: string;
  path: string;
  bytes: number;
  committed?: boolean;
  mediaType: string;
  url?: string;
}

export interface JobListItem {
  id: string;
  state: string;
  template: string | null;
  objective: string;
  blockedReason: string | null;
  delivery: unknown;
  createdAt: string;
  updatedAt: string;
  project?: unknown;
}

export interface Job extends JobListItem {
  workflow: { id: string; status: string } | null;
  planning: unknown;
  paidBy: string | null;
  parentJobId: string | null;
  project: {
    id: string;
    head: string;
    running: string | null;
    versions: { jobId: string; workflowId: string | null; objective: string; baseCommit: string | null; state: string; createdAt: string }[];
  } | null;
  deliver?: boolean;
  host?: boolean;
  site: { label: string; url: string; status?: string } | null;
  launch: { requested: boolean; kind: string | null; id: string | null; status: string | null; chainId: number | null } | null;
  oracleRequestId: string | null;
  delivery: { requested?: boolean; mode?: string; repoUrl?: string; pullRequestUrl?: string; commit?: string } | null;
  media: { cid?: string; files: MediaFile[] } | null;
  nodes: JobNode[];
  reviews: {
    status: string;
    chainId: number;
    txHash: string | null;
    blockNumber: number | null;
    sentAt: string | null;
    entries: { nodeKey: string; agentId: string; value: number; role: string }[];
  }[];
  knownLimitations?: string[];
}

export interface Submission {
  hash: string;
  nodeKey: string;
  role: string;
  attempt: number;
  deviceKey: string;
  seat: { tokenId: string; agentId: string } | null;
  outcome: string;
  accepted: boolean | null;
  failureReason: string | null;
  failureClass?: string | null;
  usage: {
    model: string;
    turns: number;
    runtime: string;
    inputTokens: number;
    wallClockMs: number;
    outputTokens: number;
    cachedInputTokens: number;
  } | null;
  artifacts: MediaFile[];
  changedPaths: string[];
  summary: string | null;
  createdAt: string;
  verdict: Verdict | null;
  findings: { severity: string; title: string; detail?: string }[];
}

export interface Submissions {
  jobId: string;
  repoUrl: string | null;
  baseCommit: string | null;
  count: number;
  submissions: Submission[];
}

export interface JobRecords {
  records: { id: string; hash: string; chainId: number; registry: string; status: string; txHash: string | null; failure: string | null; blockNumber?: number | null; score?: number | null }[];
  oracleBatches?: unknown[];
}

export interface OracleListItem {
  id: string;
  status: string;
  question: string;
  chainId: number;
  window: { fromBlock?: number; toBlock?: number; toBlockHash?: string; hours?: number };
  answerType: string;
  jobId: string | null;
  signer: string | null;
  attestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  panelSize?: number;
  quorum?: number;
}

export interface OracleRequest extends OracleListItem {
  questionHash: string;
  evidence: string;
  panelSize: number;
  quorum: number;
  toleranceBps?: number;
  validForSeconds: number;
  definitions?: Record<string, string>;
  members: { ok: boolean; tokenId?: string; wallet?: string; answer?: { v: number; notes?: string; answer?: string; figure?: string } ; failure?: string }[];
  agreement: { agreed: number; answer: string; figure?: string; quorum: number; sources?: string[] } | null;
  computed: { answer: string; figure?: string } | null;
  attestation: { agreed: number; answer: string; figure: string; quorum: number; chainId: number; toBlock: number; issuedAt: number; expiresAt?: number } | null;
  signature: string | null;
  failure?: string | null;
  consumer?: { chainId: number; verifyingContract: string };
}

export interface Attestation {
  requestId: string;
  primaryType: string;
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown>;
  signature: string;
  signer: string;
  attestedAt: string;
}

export interface Publication {
  id: string;
  title: string;
  types: string[];
  paidBy: string | null;
  publishedAt: string;
  code: { jobId: string; repoUrl: string | null; pullRequestUrl?: string | null; commit?: string | null; skill?: string; publishedAt: string }[];
  media: { jobId: string; cid?: string; files: MediaFile[]; publishedAt: string }[];
  sites: { jobId: string; label: string; url: string; status?: string; publishedAt: string }[];
  research: { jobId: string; panel: unknown; steps: number; repoUrl: string | null; pullRequestUrl: string | null; publishedAt: string }[];
  audits: { jobId: string; reportUrl?: string; findings?: number; publishedAt: string }[];
  contracts: { jobId?: string; launchId?: string; chainId: number; name: string; address: string; role?: string }[];
  release: { launchId: string; launchNumber: number; token?: { name: string; symbol: string; address: string }; chainId: number } | null;
  versions: unknown[];
  seats?: string[];
}

export interface Publications {
  q: string;
  page: number;
  sort: string;
  type: string;
  count: number;
  items: Publication[];
  pageSize: number;
  totalPages: number;
}

export interface Schedule {
  id: string;
  label: string | null;
  action: "oracle.request" | "job.open";
  actionVersion?: number;
  continue: boolean;
  status: string;
  statusReason?: string | null;
  cadence: { every?: string; cron?: string; tz?: string };
  input: Record<string, unknown>;
  runs: { total: number; remaining: number };
  runsRemaining: number;
  runsBought: number;
  owner: string;
  paid: boolean;
  pausedReason?: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  latest?: {
    seq: number;
    status: string;
    dueAt: string;
    firedAt: string | null;
    missedSlots: number;
    failure: string | null;
    result: { kind: string; id: string; url: string } | null;
  }[];
}

export interface SeatRecord {
  tokenId: string;
  agentId: string | null;
  attempts: number;
  accepted: number;
  rejected: number;
  failed: number;
  pending: number;
  lastWorkedAt: string | null;
}

export interface Worker {
  deviceKey: string;
  tokenId: string;
  agentId?: string | null;
  wallet?: string;
  /** number of running leases (API: `load`; `working` is a boolean there) */
  working: number;
  version: string;
  outdated?: boolean;
  runtimes?: string[];
  /** the live runtime: Claude Code / Codex, model id, premium tier */
  runtime?: RuntimeInfo | null;
  premium?: boolean;
  paused?: boolean;
  concurrency?: number;
  heartbeatAt?: string;
}

export interface Contributor {
  deviceKey: string;
  tokenId: string;
  wallet: string;
  turns: number;
  wallClockMs: number;
  attempts: number;
  accepted: number;
}

export interface Seat {
  tokenId: string;
  agentId: string | null;
  chainId: number;
  collection: string;
  adapter?: string;
  status: string;
  owner: string;
  ownership?: string;
  pairedAt: string | null;
  online: boolean;
  daemonVersion: string | null;
  runtimes: { id: string; version: string; premiumModel?: { model: string; effort: string } | null }[];
  /** live runtime (API seat view `runtime`) */
  runtime?: RuntimeInfo | null;
  lastSeenAt?: string | null;
  image?: string;
  devices: number;
  attempts: number;
  accepted: number;
  rejected: number;
  failed: number;
  pending: number;
  turns?: number;
  wallClockMs?: number;
  work: {
    jobId: string;
    objective: string;
    jobState: string;
    launch: unknown;
    nodeKey: string;
    role: string;
    submissionHash: string;
    status: string;
    submittedAt: string;
    acceptedAt: string | null;
    oracle?: { question: string; answer: string; panel: string; agreed: boolean } | null;
  }[];
  reviews: {
    jobId: string;
    nodeKey: string;
    role: string;
    value: number;
    policy: string;
    verdict: string;
    submissionHash: string;
    status: string;
    txHash: string | null;
    chainId: number | null;
    sentAt: string | null;
  }[];
  collaborators?: { tokenId: string; jobs: number }[];
}

export interface LaunchListItem {
  id: string;
  launchNumber: number;
  kind: string;
  status: string;
  chainId: number;
  sourceRepoUrl: string | null;
  sourceCommit: string | null;
  parkedReason: string | null;
  artifactCount: number;
  artifacts: { role: string; name: string; address: string; txHash: string; blockNumber: number }[];
  createdAt: string;
  updatedAt: string;
}

export interface Launch extends LaunchListItem {
  jobId?: string;
  /** ProjectFactory launch id (the ContributorDistributor key); launchNumber is Chambers' own counter */
  onchainLaunchId?: number | null;
  objective?: string;
  policyVersion?: number;
  lifecycle?: { status: string; at: string; note?: string }[];
  admission?: { checks: { id: string; status: string; detail: string }[]; admittedAt: string | null };
  attestation?: { buildHash: string; treeHash: string; attestedBy: string; attestedAt: string; signature?: string } | null;
  transactions?: { label: string; txHash: string; blockNumber: number; gasUsed?: string }[];
  allocations?: { label: string; bps: number; to: string; amount?: string }[];
  token?: { name: string; symbol: string; address: string; totalSupply: string } | null;
  pool?: { poolId: string; pairedWith: string; fee: number; hook: string | null } | null;
  rewardSnapshot?: {
    at: string;
    rule: string;
    version: number;
    workers: { wallet: string; deviceKey: string; work: { hash: string; role: string; jobId: string; nodeKey: string }[] }[];
    breakdown: { wallet: string; launchAmount: string; recentAmount: string }[];
    connected: { wallet: string; agentId: string; tokenId: string; deviceKey: string; lastHeartbeatAt: string }[];
    root?: string;
    workCount?: number;
    workByKind?: Record<string, number>;
  } | null;
}

export interface Assurances {
  launchId: string;
  count: number;
  assurances: { kind: string; provider: string; url: string; commit: string | null; recordedAt: string; revokedAt: string | null }[];
}

export interface CapabilityAction {
  action: string;
  version: string;
  payment: { network: string; asset: string; amount: string; payTo: string; decimals: number };
  quoteTtlSeconds: number;
}

export interface Capabilities {
  actions: CapabilityAction[];
  limits: Record<string, Record<string, number>>;
  launches: {
    defaultChainId: number;
    chains: { chainId: number; name: string; testnet: boolean; kinds: string[]; pairings: { pairWith: string; currency: string; symbol: string; name: string; decimals: number; kinds: string[] }[] }[];
  };
  pricedPer: Record<string, string>;
  authentication: { scheme: string; tokenBytes: number; encoding: string; creator: string };
  payment: { x402Version: number; scheme: string; assetTransferMethod: string; quoteApproval: string };
}

export interface CheckResult {
  action: string;
  blockers: { code: string; message: string }[];
  suggestions: { code?: string; message: string }[];
  kind?: string;
  plan?: { shape?: string; steps: { skill: string; role?: string; why?: string; key?: string; dependsOn?: string[] }[]; references?: string[] };
  facts?: Record<string, unknown>;
  judged?: { summary: string };
  request?: Record<string, unknown>;
  unitAmount?: string;
  runs?: number;
  amount?: string;
  terms?: string[];
  project?: { summary: string; next: { skill: string; why: string }[] };
}

export interface QuoteResponse {
  created: boolean;
  order: {
    id: string;
    status: string;
    quote: { id: string; action: string; amount: string; payTo: string; expiresAt: number; quoteHash: string; asset?: string; payment?: { asset: string; amount: string; payTo: string; network: string } };
  };
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { assetTransferMethod: string; name?: string; version?: string; spender?: string; relay?: string; proxy?: string; [k: string]: unknown };
}

export interface PaymentChallenge {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirements[];
  quote: { id: string; action: string; amount: string; payTo: string; expiresAt: number; quoteHash: string; payment?: { asset: string; amount: string; payTo: string; network: string } };
  requesterScopeHash: string;
  resourceUrl: string;
  resource?: { url: string; description?: string; mimeType?: string };
  input?: unknown;
}

export interface RequestStatus {
  status: string;
  order: { id: string; status: string; quote: { action: string; expiresAt: number } };
  payment: { status: string; paid: boolean; transactionHash: string | null; reason?: string } | null;
  admission: { action: string; result: AdmissionResult } | null;
}

export type AdmissionResult =
  | { kind: "job"; jobId: string; launch?: boolean; continues?: string; statusUrl: string; resultUrl: string }
  | { kind: "workflow"; workflowId: string; jobId: string; statusUrl: string; jobUrl: string }
  | { kind: "oracle"; requestId: string; jobId: string; statusUrl: string; attestationUrl: string }
  | { kind: "schedule"; scheduleId: string; runsAdded?: number; statusUrl: string }
  | { kind: "refused"; problems: { path?: string; message: string }[] };

export interface LaunchPolicy {
  version: number;
  kind: string;
  note: string;
  params: Record<string, unknown>;
  createdAt: string;
}

export interface NameRecord {
  label: string;
  name: string;
  /** wallet the name resolves to (API: `owner`) */
  address: string | null;
  url?: string;
  tokenId?: string | null;
  jobId?: string | null;
}

/** Seat reward (RewardDistributor) entry from GET /wallets/:address/earnings `rewards[]`. */
export interface SeatReward {
  kind: "epoch";
  epoch: number;
  tokenId: string;
  /** reward asset: COMD or ETH (address(0)); claim() pays COMD, claimToken(asset, …) any asset incl. ETH */
  asset?: string;
  symbol?: string;
  decimals?: number;
  amount: string;
  root: string | null;
  proof: `0x${string}`[];
  /** posted = root on chain and claimable; waiting_funds / pending = not yet */
  status: string;
  txHash?: string | null;
}
