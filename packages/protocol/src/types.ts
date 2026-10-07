/**
 * API objects (the JSON the control plane serves). Shapes follow IMD's public API one-for-one; differences:
 * payment asset COMD (18 decimals) on eip155:4663/46630, `ipfs` hosts on our storage (`site: {label, url}`),
 * ENS replaced by /names.
 *
 * Conventions: ids are UUIDs; times are ISO strings in JSON (`createdAt`), unix seconds where IMD uses them
 * (`expiresAt` on quotes/attestations); hashes are 64 lowercase hex without 0x; token ids, agent ids and
 * atomic amounts are decimal strings.
 */
import type { AnswerType } from "./eip712.ts";
import type { Finding, Usage, SubmittedFile, RuntimeInfo, ToolInfo } from "./frames.ts";

export type Address = `0x${string}`;
export type Iso = string;

// ------------------------------------------------------------------------------------------- actions

export const ACTIONS = ["job.open", "job.continue", "launch.open", "workflow.open", "oracle.request", "schedule.create", "schedule.topup"] as const;
export type Action = (typeof ACTIONS)[number];

export const LAUNCH_KINDS = ["custom_token", "evm_project", "univ4_hook", "evm_contracts"] as const;
export type LaunchKind = (typeof LAUNCH_KINDS)[number];

export const TEMPLATES = ["single", "impl_tests", "impl_tests_review", "multi_contract", "fuzz", "research", "audit"] as const;
export type Template = (typeof TEMPLATES)[number];
export const SHAPES = ["chain", "fan_out_join", "dag"] as const;
export type Shape = (typeof SHAPES)[number];

// ------------------------------------------------------------------------------------------- job body

export interface FileRef {
  name: string;
  path: string;
  hash: string;
  mediaType: string;
  bytes: number;
  submissionHash: string;
}
export interface OutputSpec { name: string; path: string; mediaType: string }

export interface StepBody {
  skill: string;
  key?: string;
  dependsOn?: string[];
  objective?: string;
  acceptanceCriteria?: string[];
  paths?: string[];
  references?: string[];
  inputs?: FileRef[];
  outputs?: OutputSpec[];
  variables?: Record<string, string>;
}

export interface Economics { poolBps?: number; initialMarketCapWei?: string; remainderTo?: Address }

export interface JobBody {
  objective: string;
  skill?: string;
  template?: Template;
  shape?: Shape;
  steps?: StepBody[];
  references?: string[];
  repoUrl?: string;
  baseCommit?: string;
  contracts?: string[];
  paths?: string[];
  inputs?: FileRef[];
  outputs?: OutputSpec[];
  github?: boolean;
  /** kept for API parity: true or a site label; hosts on our storage at https://<label>.<SITES_DOMAIN> */
  ipfs?: boolean | string;
  onchain?: true | LaunchKind;
  owner?: Address;
  chainId?: number;
  pairWith?: "eth" | "comd";
  economics?: Economics;
  // fuzz
  projectPath?: string | null;
  runs?: number;
  rubric?: { contains: string[]; mayNotRestOn?: string[] };
  // research
  panelSize?: number;
  panelQuorum?: number;
  minCitations?: number;
  // continue
  parentJobId?: string;
}

export interface WorkflowBody {
  request: string;
  context?: string;
  draft: JobBody;
  permissions: { github?: boolean; ipfs?: boolean | string; onchain: { kind: LaunchKind; chainId: number } };
}

export interface OracleBody {
  v: 1;
  question: string;
  chainId: number;
  window: { hours: number } | { fromBlock: number; toBlock: number };
  answerType: AnswerType;
  panelSize: number;
  quorum: number;
  validForSeconds: number;
  evidence?: "chain" | "panel";
  head?: number;
  definitions?: Record<string, string>;
  guards?: {
    allow?: string[]; deny?: string[]; mustHaveCode?: boolean; min?: string; max?: string; sources?: string[]; minSources?: number;
  };
  toleranceBps?: number;
  consumer?: { chainId: number; verifyingContract: Address };
  allowAmbiguous?: boolean;
  /** chain recipe the requester pins for evidence=chain (optional; panel members propose one otherwise) */
  recipe?: Recipe;
}

export type Recipe =
  | { kind: "eth-call"; to: Address; data: `0x${string}`; decode?: "uint256" | "bool" | "address" | "bytes32"; block?: "to" | "from" }
  | { kind: "log-count"; address: Address; topics: (string | null)[] }
  | { kind: "balance"; address: Address; block?: "to" | "from" }
  | { kind: "panel"; source?: string }
  | { kind: string; [k: string]: unknown };

export type Cadence = { every: string } | { cron: string; tz?: string };

export interface ScheduleBody {
  action: "oracle.request" | "job.open";
  input: JobBody | OracleBody;
  cadence: Cadence;
  runs: number;
  label?: string;
  continue?: boolean;
  startAt?: string;
}

export interface TopupBody { scheduleId: string; runs: number }

export interface Problem { path: string; code: string; message: string }

// ------------------------------------------------------------------------------------------- jobs

export type JobState = "planning" | "executing" | "delivering" | "completed" | "blocked" | "cancelled";
export type NodeState = "pending" | "ready" | "leased" | "verifying" | "accepted" | "rejected" | "failed" | "cancelled" | "skipped";

export interface Verdict {
  status: "accepted" | "rejected";
  profile: string;
  evaluation: "rerun" | "structural" | "review" | "panel" | "none";
  rejectionCode: string | null;
  detail: string;
  verifierVersion: string;
  verifiedTreeHash: string | null;
  at: Iso;
  failedChecks: string[];
}

export interface Seat { tokenId: string; agentId: string | null }

export interface JobNode {
  key: string;
  skill: string;
  role: string;
  kind: "work" | "review" | "panel" | "audit" | "judge";
  state: NodeState;
  attempt: number;
  revisions: number;
  judgeRevisions: number;
  dependsOn: string[];
  allowedPaths: string[];
  objective: string | null;
  acceptanceCriteria: string[];
  references: string[];
  inputs: FileRef[];
  outputs: OutputSpec[];
  variables: Record<string, string>;
  premium: boolean;
  /** review/audit nodes: the keys whose work they examine */
  reviews: string[];
  failureReason: string | null;
  dispatchNote: string | null;
  dispatchNoteAt: Iso | null;
  updatedAt: Iso;
  verdict: Verdict | null;
  seat: Seat | null;
  /** accepted submission hash */
  submissionHash: string | null;
  excluded: string[];
  /** tokenId → ISO time until which the exclusion holds; absent = permanent (a rejected result). A lease handed back
   *  for a runtime reason (the holder's model provider failing, a timeout) only sidelines the seat for a cooldown. */
  excludedUntil?: Record<string, string>;
}

export interface Attempt {
  leaseId: string;
  jobId: string;
  nodeKey: string;
  attempt: number;
  tokenId: string;
  agentId: string | null;
  wallet: Address;
  deviceKey: string;
  runtime: RuntimeInfo | null;
  state: "leased" | "submitted" | "accepted" | "rejected" | "expired" | "cancelled" | "failed";
  leasedAt: Iso;
  expiresAt: Iso;
  finishedAt: Iso | null;
  submissionHash: string | null;
  failure: string | null;
}

export interface Delivery {
  repoUrl: string | null;
  commit: string | null;
  pullRequestUrl: string | null;
  branch: string | null;
  publishedAt: Iso | null;
  files: number;
}

export interface SiteRef { label: string; url: string; siteId: string; status: string }

export interface JobLaunchRef { requested: boolean; kind: LaunchKind | null; id: string | null; status: string | null; chainId: number | null }

export interface Job {
  id: string;
  state: JobState;
  template: string;
  objective: string;
  originalRequest: string | null;
  blockedReason: string | null;
  createdAt: Iso;
  updatedAt: Iso;
  paidBy: Address | null;
  orderId: string | null;
  parentJobId: string | null;
  createdBy: "request" | "schedule" | "workflow" | "admin";
  scheduleId: string | null;
  deliver: boolean;
  host: boolean | string;
  site: SiteRef | null;
  oracleRequestId: string | null;
  delivery: Delivery | null;
  media: { name: string; path: string; mediaType: string; hash: string; url: string }[] | null;
  launch: JobLaunchRef;
  workflow: { id: string; role: "contracts" | "frontend" } | null;
  planning: { planner: string; shape: string; notes: string[] } | null;
  project: { id: string; head: string } | null;
  input: JobBody;
  nodes: JobNode[];
  references: string[];
  report: string | null;
}

export interface SubmissionRecord {
  hash: string;
  jobId: string;
  nodeKey: string;
  leaseId: string;
  tokenId: string;
  agentId: string | null;
  wallet: Address;
  deviceKey: string;
  bundleHash: string | null;
  files: SubmittedFile[];
  summary: string | null;
  usage: Usage;
  runtime: RuntimeInfo | null;
  result: Record<string, unknown> | null;
  accepted: boolean | null;
  verdict: Verdict | null;
  oracleResult: { answer: unknown; figure: string | null; recipe: unknown; sources: string[] } | null;
  findings: Finding[];
  artifacts: { name: string; path: string; mediaType: string; hash: string; bytes: number; url: string }[];
  createdAt: Iso;
}

// ------------------------------------------------------------------------------------------- orders

export type OrderStatus = "quoted" | "payment_pending" | "admission_pending" | "admitted" | "payment_failed" | "expired";

export interface Quote {
  v: 1;
  id: string;
  action: Action;
  policyVersion: number;
  inputHash: string;
  issuedAt: number;
  expiresAt: number;
  payment: { network: string; asset: Address; amount: string; payTo: Address; decimals: number; scheme: "exact" };
  unitAmount: string;
  runs: number;
  payer: Address | null;
  terms: { purchase: string; resultGuaranteed: false };
  quoteHash: string;
}

export type AdmissionResult =
  | { kind: "job"; jobId: string; launch?: boolean; continues?: string; statusUrl: string; resultUrl: string }
  | { kind: "workflow"; workflowId: string; jobId: string; statusUrl: string; jobUrl: string }
  | { kind: "oracle"; requestId: string; jobId: string; statusUrl: string; attestationUrl: string }
  | { kind: "schedule"; scheduleId: string; runsAdded?: number; statusUrl: string }
  | { kind: "refused"; problems: Problem[] };

// ------------------------------------------------------------------------------------------- oracle

export type OracleStatus = "assessing" | "reproducing" | "attested" | "disagreed" | "blocked" | "mismatch" | "refused" | "failed";

export interface OracleAttestationJson {
  requestId: `0x${string}`;
  chainId: number;
  questionHash: `0x${string}`;
  answerType: AnswerType;
  answer: `0x${string}`;
  figure: string;
  fromBlock: number;
  toBlock: number;
  blockHash: `0x${string}`;
  panelJobId: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
}

// ------------------------------------------------------------------------------------------- schedules

export type ScheduleStatus = "active" | "paused" | "exhausted" | "expired" | "cancelled";
export type RunStatus = "opened" | "skipped" | "failed" | "opening";

// ------------------------------------------------------------------------------------------- workflows

export type WorkflowStatus = "contracts" | "deployment" | "frontend" | "publishing" | "validating" | "completed" | "superseded" | "blocked" | "cancelled";

// ------------------------------------------------------------------------------------------- launches

export interface LaunchPolicyParams {
  kind: LaunchKind;
  chainId: number;
  owners: { token?: Address; project?: Address; treasury: Address; hookAdmin?: Address; lpPosition?: Address };
  feeTiers: number[];
  rewardRule: "equal_connected";
  totalSupply?: string;
  treasuryBps?: number;
  liquidityBps?: number;
  contributorPoolBps: number;
  recentContributorBps: number;
  recentContributorWindowSeconds: number;
  contributorLockSeconds: number;
  perWalletCapBps: number;
  poolFloorBps: number;
  gasCeilingWei: string;
  pairedCurrencyAllowlist: Address[];
  initialMarketCaps?: Record<string, string>;
  initialMarketCapRanges?: Record<string, { min: string; max: string }>;
  minInitialMarketCapWei?: string;
  maxInitialMarketCapWei?: string;
}

export interface LaunchPolicy { version: number; kind: LaunchKind; note: string; params: LaunchPolicyParams; createdAt: Iso }

export type LaunchStatus = "building" | "auditing" | "admission" | "attesting" | "deploying" | "live" | "parked" | "failed";

export interface WorkerPresence {
  deviceKey: string;
  tokenId: string;
  agentId: string | null;
  wallet: Address;
  version: string;
  runtime: RuntimeInfo | null;
  tools: ToolInfo | null;
  skills: string[];
  concurrency: number;
  working: number;
  paused: boolean;
  connectedAt: Iso;
  heartbeatAt: Iso;
}

