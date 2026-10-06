export * from "./abis/index.js";
export * from "./addresses.js";
export * from "./eip712.js";

export const CHAIN_IDS = { mainnet: 4663, testnet: 46630 } as const;

/** The official COMD/ETH pool (ComdTaxHook + BuyWall): LP fee 0, tick spacing 200, ETH is currency0; 5% ETH tax (max). */
export const COMD_POOL = {
  fee: 0,
  tickSpacing: 200,
  currency0: "0x0000000000000000000000000000000000000000",
  maxTaxBps: 500,
} as const;

/** Flywheel default split of the 5% ETH tax (bps of the tax): buyback-and-burn / Counsel floor sweep. */
export const FLYWHEEL_DEFAULT_BPS = { buyback: 5_000, sweep: 5_000 } as const;

/** Default split of every COMD trimmed from the official pool (or bought by the buy wall), in bps. */
export const TRIM_SPLIT_BPS = { burn: 8_500, bond: 600, stakers: 450, seats: 450 } as const;

/** Default cap ratchet of the official pool (COMD wei). */
export const CAP_DEFAULTS = { capFloor: 100_000n * 10n ** 18n, capDecayPerDay: 100_000n * 10n ** 18n } as const;

/** RevenueRouter default split of COMD job revenue (bps): Counsel rewards / firm treasury. */
export const REVENUE_DEFAULT_BPS = { rewards: 8_000, treasury: 2_000 } as const;

/** RewardDistributor: asset address(0) = native ETH. */
export const ETH_ASSET = "0x0000000000000000000000000000000000000000" as const;

/** ProjectFactory launch kinds (IMD parity). */
export const LAUNCH_KINDS = { custom_token: 0, evm_project: 1, univ4_hook: 2, evm_contracts: 3 } as const;
