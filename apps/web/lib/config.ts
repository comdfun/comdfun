// Public runtime configuration. Everything is NEXT_PUBLIC_* so it is inlined into client bundles at build time.
export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1" || process.env.NEXT_PUBLIC_MOCK === "true";
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://api.comd.fun").replace(/\/+$/, "");
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://comd.fun").replace(/\/+$/, "");
/** Robinhood Chain mainnet (4663) is the default for launches and payments; 46630 (testnet) is selectable. */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 4663);
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "";
export const ALLOWLIST_URL = process.env.NEXT_PUBLIC_ALLOWLIST_URL || "";
export const SITES_DOMAIN = process.env.NEXT_PUBLIC_SITES_DOMAIN || "sites.comd.fun";
export const MARKETPLACE_URL = process.env.NEXT_PUBLIC_MARKETPLACE_URL || "https://opensea.io/collection/counsel-362029053";
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "team@comd.fun";
/** X profile; every X link is hidden while this is unset. */
export const X_URL = process.env.NEXT_PUBLIC_X_URL || "https://x.com/comdfun";
export const X_HANDLE = "@" + (X_URL.replace(/\/+$/, "").split("/").pop() || "comdfun");
/** The open-source repository (contracts, control plane, worker, art and this site). */
export const GITHUB_URL = (process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/comdfun/comdfun").replace(/\/+$/, "");
export const GITHUB_REPO = GITHUB_URL.replace(/^https?:\/\/github\.com\//, "") || "comdfun/comdfun";
export const SITE_NAME = "Company.md";
export const TOKEN = "$COMD";
export const TOKEN_SYMBOL = "COMD";
/** Payment asset decimals ($COMD). */
export const PAY_DECIMALS = 18;
/** Default action price, COMD atomic (18 decimals) = 100 COMD. Real value comes from GET /requests/capabilities. */
export const DEFAULT_PRICE = 100n * 10n ** 18n;
/** The approval step asks Permit2 for ten requests' worth. */
export const APPROVAL_REQUESTS = 10n;
/** Token economics: $COMD is launched on Pons (1B supply, ETH pair, 5% tax set in Pons → the Flywheel). */
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const TAX_BPS_DEFAULT = 500;
/** Pons: the launchpad that minted $COMD and runs its trading (bonding curve, then a locked Uniswap v4 pool). */
export const PONS_URL = process.env.NEXT_PUBLIC_PONS_URL || "https://pons.fun";
/** Uniswap trade link, set after graduation; the link is hidden while unset. */
export const UNISWAP_URL = process.env.NEXT_PUBLIC_UNISWAP_URL || "";
/** The graduated pool id (bytes32), when known; enables the live price read through the swapper. */
export const COMD_POOL_ID = process.env.NEXT_PUBLIC_COMD_POOL_ID || "";
