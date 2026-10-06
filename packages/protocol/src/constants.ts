/** Chains, prices, limits and protocol constants shared by the API, the worker and the web app. */
import type { Action, Address } from "./types.ts";

export const PROTOCOL_VERSION = 1;

export interface ChainInfo {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrl: string;
  explorer: string;
  weth: Address;
  permit2: Address;
  /** COMD token (the payment asset) when known; deployments/env otherwise */
  comd: Address | null;
}

export const CHAINS: Record<number, ChainInfo> = {
  4663: {
    chainId: 4663,
    name: "Robinhood Chain",
    testnet: false,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    comd: null,
  },
  46630: {
    chainId: 46630,
    name: "Robinhood Chain Testnet",
    testnet: true,
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    weth: "0x7943e237c7F95DA44E0301572D358911207852Fa",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    comd: null,
  },
};

export const COMD_DECIMALS = 18;
/** 100 COMD per action (per run for schedules) */
export const DEFAULT_PRICE_COMD = "100000000000000000000";
export const BRAND = { name: "Company.md", token: "COMD", web: "https://comd.fun", api: "https://api.comd.fun", sitesDomain: "sites.comd.fun", contact: "team@comd.fun", githubOrg: "comd-filings", workerRepo: "comd-fun/worker", cli: "comd" } as const;
export const QUOTE_TTL_SECONDS = 600;
export const QUOTE_MIN_REMAINING_SECONDS = 60;
export const PAYMENT_MAX_TIMEOUT_SECONDS = 3600;
export const PRICED_PER_RUN: Action[] = ["schedule.create", "schedule.topup"];

export const LIMITS = {
  paidBodyBytes: 16 * 1024,
  requestsPerMinute: 300,
  quotesPerMinute: 30,
  readsPerMinute: 120,
  oracle: { minPanelSize: 5, maxPanelSize: 100 },
  schedule: { minRuns: 1, maxRuns: 1_000_000, minOracleIntervalMinutes: 10, minJobIntervalMinutes: 30, failuresToPause: 3 },
  sitesPerSeatPerDay: 10,
  research: { maxPanel: 9, maxCitations: 20 },
  fuzz: { minRuns: 1_000, maxRuns: 10_000_000 },
} as const;

export const SITE_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const STEP_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const BEARER_RE = /^[0-9a-f]{64}$/i;
