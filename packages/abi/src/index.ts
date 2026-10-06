export * from "./abis/index.js";
export * from "./addresses.js";
export * from "./eip712.js";

export const CHAIN_IDS = { mainnet: 4663, testnet: 46630 } as const;

/**
 * $COMD is launched on Pons (1B supply, ETH pair, 5% tax set in Pons); Pons locks the graduated liquidity in a
 * Uniswap v4 pool with its own hook. The contracts reach that pool only through the pluggable swapper
 * (`UniswapV4PoolSwapper.setPoolKey` after graduation). Burns are transfers to the dead address.
 */
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
export const COMD_SUPPLY = 1_000_000_000n * 10n ** 18n;

/** Flywheel default split of the ETH it receives (bps): buyback-and-burn / Counsel floor sweep. */
export const FLYWHEEL_DEFAULT_BPS = { buyback: 5_000, sweep: 5_000 } as const;

/** Incorporations fees (bps of the COMD side): Counsel rewards / dead-address burn / launcher. */
export const INCORPORATIONS_FEE_BPS = { rewards: 100, burn: 50, launcher: 50 } as const;

/** RevenueRouter default split of COMD job revenue (bps): Counsel rewards / firm treasury. */
export const REVENUE_DEFAULT_BPS = { rewards: 8_000, treasury: 2_000 } as const;

/** RewardDistributor: asset address(0) = native ETH. */
export const ETH_ASSET = "0x0000000000000000000000000000000000000000" as const;

/** ProjectFactory launch kinds (IMD parity). */
export const LAUNCH_KINDS = { custom_token: 0, evm_project: 1, univ4_hook: 2, evm_contracts: 3 } as const;
