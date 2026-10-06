/** Records the control plane stores (API objects plus bookkeeping fields). */
import type {
  Action, Address, AdmissionResult, Attempt, Cadence, Finding, Job, LaunchKind, LaunchPolicy, LaunchStatus, OracleAttestationJson, OracleBody,
  OracleStatus, OrderStatus, Quote, RunStatus, ScheduleStatus, SubmissionRecord, WorkflowStatus, JobBody, SubmittedFile, Problem,
} from "@company/protocol";

export type { Job, Attempt, SubmissionRecord };

export interface OrderRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  requestKey: string;
  scopeHash: string;
  action: Action;
  input: Record<string, unknown>;
  inputHash: string;
  quote: Quote;
  status: OrderStatus;
  payer: Address | null;
  paymentHash: string | null;
  permitNonce: string | null;
  payment: { status: "none" | "pending" | "confirmed" | "failed"; paid: boolean; transactionHash: string | null; reason: string | null; blockNumber: number | null };
  admission: { action: Action; result: AdmissionResult } | null;
  paidAt: string | null;
}

export interface OracleRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: OracleStatus;
  question: string;
  questionHash: `0x${string}`;
  chainId: number;
  window: { fromBlock: number; toBlock: number; toBlockHash: `0x${string}` };
  answerType: OracleBody["answerType"];
  evidence: "chain" | "panel";
  panelSize: number;
  quorum: number;
  toleranceBps: number;
  head: number | null;
  validForSeconds: number;
  definitions: Record<string, string>;
  guards: NonNullable<OracleBody["guards"]>;
  consumer: OracleBody["consumer"] | null;
  recipe: Record<string, unknown> | null;
  input: OracleBody;
  jobId: string;
  paidBy: Address | null;
  scheduleId: string | null;
  members: { nodeKey: string; tokenId: string; wallet: Address; submissionHash: string; answer: unknown; figure: string | null; refuse: string | null; recipe: unknown; sources: string[]; at: string }[];
  agreement: Record<string, unknown> | null;
  computed: { answer: unknown; figure: string | null } | null;
  attestation: OracleAttestationJson | null;
  signature: `0x${string}` | null;
  signer: Address | null;
  failure: string | null;
  attempts: number;
  attestedAt: string | null;
}

export interface ScheduleRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  label: string | null;
  action: "oracle.request" | "job.open";
  actionVersion: 1;
  input: Record<string, unknown>;
  cadence: Cadence;
  continue: boolean;
  status: ScheduleStatus;
  statusReason: string | null;
  runsBought: number;
  runsRemaining: number;
  owner: Address;
  paid: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  expiresAt: string | null;
  startAt: string | null;
  seq: number;
  consecutiveFailures: number;
  lastOpenedRef: { kind: "job" | "oracle"; id: string; jobId: string } | null;
  orderIds: string[];
}

export interface RunRecord {
  id: string;
  createdAt: string;
  scheduleId: string;
  seq: number;
  status: RunStatus;
  dueAt: string;
  firedAt: string;
  missedSlots: number;
  failure: string | null;
  result: { kind: "job" | "oracle"; id?: string; url?: string; jobId: string; requestId?: string } | null;
}

export interface WorkflowRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: WorkflowStatus;
  failure: string | null;
  request: string;
  context: string;
  draft: JobBody;
  permissions: { github?: boolean; ipfs?: boolean | string; onchain: { kind: LaunchKind; chainId: number } };
  chainId: number;
  objective: string;
  contractsJobId: string | null;
  frontendJobId: string | null;
  frontendPlan: { planner: string; body: JobBody; notes: string[] } | null;
  launch: { id: string; status: string } | null;
  handoff: Record<string, unknown> | null;
  site: { label: string; url: string } | null;
  validation: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[]; at: string } | null;
  brief: string;
  waitingForHosting: boolean;
  paidBy: Address | null;
}

export interface LaunchRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** our sequence number (1, 2, …) */
  launchNumber: number;
  /** ProjectFactory launchId (the contributor leaves' launchId); null for evm_contracts / before deployment */
  onchainLaunchId: number | null;
  kind: LaunchKind;
  status: LaunchStatus;
  chainId: number;
  jobId: string;
  workflowId: string | null;
  policyVersion: number;
  payer: Address | null;
  sourceRepoUrl: string | null;
  sourceCommit: string | null;
  parkedReason: string | null;
  economics: { poolBps: number; payerBps: number; pairWith: string; initialMarketCapWei: string | null; remainderTo: Address | null };
  admission: { checks: { name: string; ok: boolean; detail: string }[]; at: string } | null;
  attestation: { treeHash: string; buildHash: string; attestedAt: string } | null;
  artifacts: { role: string; name: string; address: Address; txHash: `0x${string}`; blockNumber: number }[];
  transactions: { txHash: `0x${string}`; label: string; gasUsed?: string }[];
  allocations: Record<string, string> | null;
  rewardSnapshot: RewardSnapshot | null;
  token: Address | null;
  tokenInfo?: { name: string; symbol: string; totalSupply: string } | null;
  poolId: `0x${string}` | null;
  lifecycle?: { status: string; at: string; note?: string }[];
  deployment?: { mode: string; template: boolean; gasUsed: string | null; costWei: string | null; notes: string[] } | null;
  launchedEvent?: import("./chain.ts").LaunchedEvent | null;
}

export interface RewardSnapshot {
  rule: "equal_connected";
  takenAt: string;
  totalSupply: string;
  contributorPool: string;
  workersPool: string;
  connectedPool: string;
  perWalletCap: string;
  workers: string[];
  connectedSeats: { tokenId: string; wallet: string }[];
  /** the leaves' launchId (ProjectFactory launchId) */
  launchId?: number;
  root: `0x${string}` | null;
  total: string;
  unlockAt: number;
  leftoverToTreasury: string;
  entries: { account: string; amount: string; workerShare: string; connectedShare: string; capped: boolean }[];
  claims?: { account: string; amount: string; proof: `0x${string}`[]; leaf: `0x${string}` }[];
  rootTx: string | null;
  rootStatus: "queued" | "sent" | "failed" | "none";
}

export interface SiteRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  jobId: string | null;
  kind: "job" | "launch" | "workflow" | "seat";
  tokenId: string | null;
  agentId: string | null;
  owner: Address | null;
  url: string;
  status: "publishing" | "live" | "held" | "taken_down" | "superseded" | "failed";
  holdReason: string | null;
  takenDownAt: string | null;
  takenDownReason: string | null;
  label: string;
  version: string | null;
  bytes: number;
  files: number;
  attempts: number;
  failure: string | null;
  publishedAt: string | null;
  supersededBy: string | null;
  supersededAt: string | null;
}

export interface EnrollmentRecord {
  id: string; // deviceKey
  createdAt: string;
  updatedAt: string;
  deviceKey: string;
  tokenId: string;
  wallet: Address;
  status: "active" | "revoked";
  reason: string | null;
  authorization: Record<string, unknown>;
  signature: string;
  revokedAt: string | null;
}

export interface PairingRecord {
  id: string; // code
  createdAt: string;
  updatedAt: string;
  code: string;
  deviceKey: string;
  nonce: `0x${string}`;
  expiresAt: number;
  relayOrigin: string;
  consumed: boolean;
  wallet: Address | null;
  tokenId: string | null;
}

export interface SeatRecord {
  id: string; // tokenId
  createdAt: string;
  updatedAt: string;
  tokenId: string;
  agentId: string | null;
  owner: Address | null;
  ownerCheckedAt: number;
  deviceKey: string | null;
  wallet: Address | null;
  lastSeenAt: string | null;
  connectedAt: string | null;
  version: string | null;
  runtime: Record<string, unknown> | null;
  sitesToday: { day: string; count: number };
}

export interface FeedbackBatch {
  id: string;
  createdAt: string;
  updatedAt: string;
  jobId: string;
  status: "queued" | "submitted" | "sent" | "failed";
  entries: { tag1: string; tag2: string; value: number; agentId: string | null; nodeKey: string; feedbackHash: string; submissionHash: string; tokenId: string; txHash?: string | null }[];
  chainId: number;
  registry: Address | null;
  identity: { registry: Address | null; collection: Address | null; chainId: number };
  documentHash: string;
  previousHash: string;
  attempts: number;
  txHash: string | null;
  batcher: Address | null;
  blockNumber: number | null;
  gasUsed: string | null;
  failure: string | null;
  sentAt: string | null;
}

export interface DocumentRecord {
  id: string; // hash
  createdAt: string;
  kind: "review" | "work-record" | "review-document";
  jobId: string;
  key: string;
  body: Record<string, unknown>;
}

export interface BundleRecord {
  id: string; // bundle hash
  createdAt: string;
  leaseId: string;
  jobId: string;
  nodeKey: string;
  tokenId: string;
  deviceKey: string;
  files: SubmittedFile[];
  bytes: number;
  /** content-addressed: identical uploads from other leases are recorded here */
  leaseIds: string[];
  tokenIds: string[];
}

export interface ArtifactRecord {
  id: string; // sha256
  createdAt: string;
  leaseId: string | null;
  jobId: string | null;
  name: string | null;
  mediaType: string;
  bytes: number;
  deviceKey: string | null;
}

export interface FuzzRecord {
  id: string; // jobId
  createdAt: string;
  updatedAt: string;
  jobId: string;
  state: "running" | "clean" | "confirmed" | "failed";
  runs: number;
  confirmed: number;
  results: { leaseId: string; tokenId: string; runs: number; properties: { name: string; status: "pass" | "fail"; counterexample?: string; reproduction?: string; confirmed?: boolean }[]; at: string }[];
}

export interface RewardEpochAsset {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  pool: string;
  poolSource: "distributor" | "env" | "revenue";
  /** per-epoch cap (atomic) or null */
  cap: string | null;
  total: string;
  root: `0x${string}` | null;
  status: "queued" | "waiting_funds" | "posted" | "failed";
  txHash: string | null;
  blockNumber: number | null;
  failure: string | null;
  postedAt: string | null;
  entries: { tokenId: string; accepted: number; amount: string; proof: `0x${string}`[] }[];
}

export interface RewardEpoch {
  id: string; // epoch number
  createdAt: string;
  updatedAt: string;
  epoch: number;
  startsAt: string;
  endsAt: string;
  /** x402 revenue admitted in the epoch (COMD atomic) — informational */
  revenue: string;
  /** accepted attempts per token id */
  work: Record<string, number>;
  /** one Merkle root per asset */
  assets: RewardEpochAsset[];
  // summary of assets[0] (COMD) for older readers
  pool: string;
  poolSource: "distributor" | "env" | "revenue";
  total: string;
  root: `0x${string}` | null;
  status: "empty" | "queued" | "waiting_funds" | "posted" | "failed";
  txHash: string | null;
  failure: string | null;
  entries: { tokenId: string; accepted: number; amount: string; proof: `0x${string}`[] }[];
}

export interface EventRecord { id: string; createdAt: string; type: string; data: Record<string, unknown> }
export interface KvRecord { id: string; createdAt: string; value: unknown }
export interface NonceRecord { id: string; createdAt: string; expiresAt: number }
export interface AssuranceRecord { id: string; createdAt: string; launchId: string; kind: string; provider: string; url: string; commit: string | null; recordedAt: string; revokedAt: string | null }
export interface PolicyRecord extends LaunchPolicy { id: string }

export type { Finding, Problem };
