/**
 * Environment → typed config. Every name here is listed in INTERFACES.md or apps/api/.env.example.
 *
 * Chain: Robinhood Chain MAINNET 4663 by default (CHAIN_ID=46630 for testnet; anvil e2e uses 46630 too).
 * Contract addresses resolve, per name, from (1) the env var (COUNSEL_NFT, IDENTITY_REGISTRY, …), then (2) the
 * deployment file DEPLOYMENTS_FILE (contracts/deployments/<chainId>.json written by Deploy.s.sol), then (3) the
 * `@company/abi` address book for CHAIN_ID when it is marked deployed.
 *
 * Company.md V4: payments in $COMD (18 decimals, PRICE_COMD default 100 COMD), payTo = RevenueRouter (80% Counsel
 * rewards / 20% firm treasury); the 5% ETH tax of ComdTaxHook feeds the Flywheel (buyback-and-burn / floor sweep);
 * the hook also trims inventory above its cap (85% burn / 6% Bond / 4.5% stakers / 4.5% seats) and funds the BuyWall.
 * Public defaults (production): https://comd.fun, https://api.comd.fun, sites.comd.fun, team@comd.fun.
 */
import { readFileSync } from "node:fs";
import { getAddresses, type AddressBook } from "@company/abi";
import { keeperConfig, type KeeperConfig } from "./keeper.ts";
import { ACTIONS, BRAND, CHAINS, DEFAULT_PRICE_COMD, PERMIT2_ADDRESS, type Action, type Address } from "@company/protocol";

export interface Config {
  port: number;
  host: string;
  chainId: number;
  rpcUrl: string | null;
  publicApiUrl: string;
  publicWebUrl: string;
  sitesDomain: string;
  databaseUrl: string | null;
  storage: Record<string, string | undefined>;
  attesterKey: `0x${string}` | null;
  settlerKey: `0x${string}` | null;
  deployerKey: `0x${string}` | null;
  githubToken: string | null;
  githubOrg: string;
  payTo: Address;
  /** $COMD: the payment asset (zero address until configured) */
  comd: Address;
  permit2: Address;
  /** price per action (per run for schedules), COMD atomic units (18 decimals) */
  priceComd: string;
  contactEmail: string;
  counselNft: Address | null;
  identityRegistry: Address | null;
  reputationRegistry: Address | null;
  projectFactory: Address | null;
  rewardDistributor: Address | null;
  contributorDistributor: Address | null;
  revenueRouter: Address | null;
  flywheel: Address | null;
  comdRouter: Address | null;
  comdTaxHook: Address | null;
  buyWall: Address | null;
  stakedComd: Address | null;
  rewardDripper: Address | null;
  bond: Address | null;
  /** the keeper loop (Flywheel buyback/distribute, RevenueRouter.distribute); enabled by KEEPER_PRIVATE_KEY */
  keeper: KeeperConfig;
  /** marketplace listing source for GET /flywheel/sweep-candidates (null = the route returns []) */
  sweepListingsUrl: string | null;
  treasury: Address;
  /** where each contract address came from (env | deployments | abi) — reported by /health */
  addressSource: Record<string, string>;
  /** test-only: minimum seconds between schedule runs (refused when NODE_ENV=production) */
  scheduleFloorSeconds: number | null;
  /** reward epoch length (default 7 days; shorter only outside production) */
  epochSeconds: number;
  /** forge for the Registrar (FORGE_BIN; default: forge on PATH) */
  forgeBin: string | null;
  /** solc for Registrar launch templates (FOUNDRY_SOLC in the forge script env); null = forge resolves it */
  launchSolc: string | null;
  production: boolean;
  orchestratorRuntime: "claude" | "codex" | "anthropic-api";
  anthropicApiKey: string | null;
  anthropicModel: string;
  enabledActions: Action[];
  allowedOrigins: string[];
  readsPerMinute: number;
  requestsPerMinute: number;
  quotesPerMinute: number;
  launchChains: number[];
  requireRegistration: boolean;
  leaseScale: number;
  skillsDir: string | null;
  /** per-epoch cap of the COMD seat-reward pool (atomic); null = everything unallocated */
  rewardEpochPool: string | null;
  rewardGenesisMs: number;
  adminToken: string | null;
  commit: string | null;
  branch: string | null;
  deployedAt: string | null;
  premiumModels: RegExp | null;
  maxSupply: number;
  heartbeatMs: number;
  trustProxy: boolean;
  /** how long a paid submit waits for settlement before answering 202 */
  settleWaitMs: number;
}

const ZERO = "0x0000000000000000000000000000000000000000";

function addr(v: string | undefined): Address | null {
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null;
}
function key(v: string | undefined): `0x${string}` | null {
  if (!v) return null;
  const k = v.startsWith("0x") ? v : `0x${v}`;
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as `0x${string}`) : null;
}
function int(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

type BookKey = "counselNFT" | "comdToken" | "identityRegistry" | "reputationRegistry" | "projectFactory" | "rewardDistributor" | "contributorDistributor" | "revenueRouter" | "flywheel" | "comdRouter" | "comdTaxHook" | "buyWall" | "stakedComd" | "rewardDripper" | "bond" | "permit2";

function deploymentBook(env: Record<string, string | undefined>, chainId: number): { file: Partial<Record<BookKey, string>>; abi: Partial<AddressBook> } {
  let file: Partial<Record<BookKey, string>> = {};
  if (env.DEPLOYMENTS_FILE) {
    try {
      const j = JSON.parse(readFileSync(env.DEPLOYMENTS_FILE, "utf8"));
      if (Number(j.chainId) !== chainId) throw new Error(`chainId ${j.chainId} != CHAIN_ID ${chainId}`);
      file = j;
    } catch (e) {
      throw new Error(`DEPLOYMENTS_FILE ${env.DEPLOYMENTS_FILE}: ${(e as Error).message}`);
    }
  }
  let abi: Partial<AddressBook> = {};
  try { const b = getAddresses(chainId); if (b.deployed) abi = b; } catch { /* unknown chain */ }
  return { file, abi };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const chainId = int(env.CHAIN_ID, 4663);
  const production = env.NODE_ENV === "production";
  const book = deploymentBook(env, chainId);
  const addressSource: Record<string, string> = {};
  const pick = (envName: string, key: BookKey): Address | null => {
    const e = addr(env[envName]);
    if (e) { addressSource[key] = "env"; return e; }
    const f = addr(book.file[key]);
    if (f && f !== ZERO) { addressSource[key] = "deployments"; return f; }
    const a = addr((book.abi as any)[key]);
    if (a && a !== ZERO) { addressSource[key] = "abi"; return a; }
    return null;
  };
  const chain = CHAINS[chainId];
  const port = int(env.PORT, 8787);
  const publicApiUrl = (env.PUBLIC_API_URL || (production ? BRAND.api : `http://localhost:${port}`)).replace(/\/$/, "");
  const revenueRouter = pick("REVENUE_ROUTER", "revenueRouter");
  const flywheel = pick("FLYWHEEL", "flywheel");
  const comdTaxHook = pick("COMD_TAX_HOOK", "comdTaxHook");
  const buyWall = pick("BUY_WALL", "buyWall");
  const rewardDripper = pick("REWARD_DRIPPER", "rewardDripper");
  // payTo defaults to the RevenueRouter (SPEC §6: x402 payTo = RevenueRouter)
  const payTo = addr(env.PAYTO_ADDRESS) ?? revenueRouter ?? (ZERO as Address);
  const enabled = env.ENABLED_ACTIONS ? (env.ENABLED_ACTIONS.split(",").map((s) => s.trim()).filter((a) => (ACTIONS as readonly string[]).includes(a)) as Action[]) : [...ACTIONS];
  return {
    port,
    host: env.HOST || "0.0.0.0",
    chainId,
    rpcUrl: env.RPC_URL || null,
    publicApiUrl,
    publicWebUrl: (env.PUBLIC_WEB_URL || (production ? BRAND.web : "http://localhost:3000")).replace(/\/$/, ""),
    sitesDomain: (env.SITES_DOMAIN || (production ? BRAND.sitesDomain : "sites.localhost")).replace(/^\.+/, ""),
    databaseUrl: env.DATABASE_URL || null,
    storage: { ...env, PUBLIC_API_URL: publicApiUrl, BLOB_PUBLIC_URL: env.BLOB_PUBLIC_URL || `${publicApiUrl}/artifacts` },
    attesterKey: key(env.ATTESTER_PRIVATE_KEY),
    settlerKey: key(env.SETTLER_PRIVATE_KEY),
    deployerKey: key(env.DEPLOYER_PRIVATE_KEY),
    githubToken: env.GITHUB_TOKEN || null,
    githubOrg: env.GITHUB_ORG || BRAND.githubOrg,
    payTo,
    comd: pick("COMD_TOKEN", "comdToken") ?? (chain?.comd as Address | null) ?? (ZERO as Address),
    permit2: pick("PERMIT2_ADDRESS", "permit2") ?? PERMIT2_ADDRESS,
    priceComd: /^[0-9]+$/.test(env.PRICE_COMD ?? "") ? env.PRICE_COMD! : DEFAULT_PRICE_COMD,
    contactEmail: env.CONTACT_EMAIL || BRAND.contact,
    counselNft: pick("COUNSEL_NFT", "counselNFT"),
    identityRegistry: pick("IDENTITY_REGISTRY", "identityRegistry"),
    reputationRegistry: pick("REPUTATION_REGISTRY", "reputationRegistry"),
    projectFactory: pick("PROJECT_FACTORY", "projectFactory"),
    rewardDistributor: pick("REWARD_DISTRIBUTOR", "rewardDistributor"),
    contributorDistributor: pick("CONTRIBUTOR_DISTRIBUTOR", "contributorDistributor"),
    revenueRouter,
    flywheel,
    comdRouter: pick("COMD_ROUTER", "comdRouter"),
    comdTaxHook,
    buyWall,
    stakedComd: pick("STAKED_COMD", "stakedComd"),
    rewardDripper,
    bond: pick("BOND", "bond"),
    keeper: keeperConfig(env, { revenueRouter, flywheel, taxHook: comdTaxHook, buyWall, rewardDripper }),
    sweepListingsUrl: env.SWEEP_LISTINGS_URL || null,
    treasury: addr(env.TREASURY_ADDRESS) ?? payTo,
    addressSource,
    scheduleFloorSeconds: !production && /^[0-9]+$/.test(env.SCHEDULE_MIN_INTERVAL_SECONDS ?? "") ? Number(env.SCHEDULE_MIN_INTERVAL_SECONDS) : null,
    epochSeconds: !production && /^[0-9]+$/.test(env.REWARD_EPOCH_SECONDS ?? "") && Number(env.REWARD_EPOCH_SECONDS) >= 1 ? Number(env.REWARD_EPOCH_SECONDS) : 7 * 24 * 3600,
    forgeBin: env.FORGE_BIN || null,
    launchSolc: env.LAUNCH_SOLC || env.SOLC_BIN || null,
    production,
    orchestratorRuntime: (["claude", "codex", "anthropic-api"].includes(env.ORCHESTRATOR_RUNTIME ?? "") ? env.ORCHESTRATOR_RUNTIME : "anthropic-api") as Config["orchestratorRuntime"],
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    anthropicModel: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    enabledActions: enabled,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? env.PUBLIC_WEB_URL ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
    readsPerMinute: int(env.READS_PER_MINUTE, 120),
    requestsPerMinute: int(env.REQUESTS_PER_MINUTE, 300),
    quotesPerMinute: int(env.QUOTES_PER_MINUTE, 30),
    launchChains: (env.LAUNCH_CHAINS || String(chainId)).split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0),
    requireRegistration: env.REQUIRE_REGISTRATION ? env.REQUIRE_REGISTRATION !== "false" : true,
    leaseScale: Number(env.LEASE_SCALE || 1) || 1,
    skillsDir: env.SKILLS_DIR || null,
    rewardEpochPool: /^[0-9]+$/.test(env.REWARD_EPOCH_COMD_POOL ?? env.REWARD_EPOCH_POOL ?? "") ? (env.REWARD_EPOCH_COMD_POOL ?? env.REWARD_EPOCH_POOL)! : null,
    rewardGenesisMs: env.REWARD_GENESIS ? Date.parse(env.REWARD_GENESIS) || Date.UTC(2026, 9, 5) : Date.UTC(2026, 9, 5),
    adminToken: env.ADMIN_TOKEN || null,
    commit: env.GIT_COMMIT || env.RAILWAY_GIT_COMMIT_SHA || null,
    branch: env.GIT_BRANCH || env.RAILWAY_GIT_BRANCH || null,
    deployedAt: env.DEPLOYED_AT || null,
    premiumModels: env.PREMIUM_MODELS ? new RegExp(env.PREMIUM_MODELS, "i") : null,
    maxSupply: int(env.MAX_SUPPLY, 2000),
    heartbeatMs: int(env.HEARTBEAT_MS, 15_000),
    trustProxy: env.TRUST_PROXY !== "false",
    settleWaitMs: int(env.SETTLE_WAIT_MS, 25_000),
  };
}

export const API_VERSION = "0.1.0";
