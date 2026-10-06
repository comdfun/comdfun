// Minimal ABI fragments matching INTERFACES.md signatures (Pons mode). Used only until packages/abi (@company/abi) exists;
// next.config.mjs aliases "@company/abi" to this file when the package is absent. Shape mirrors the expected
// package: named ABI exports by contract name + `addresses[chainId]`.
import { parseAbi, type Address } from "viem";

export const CounselNFT = parseAbi([
  "function MAX_SUPPLY() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function price() view returns (uint256)",
  "function phase() view returns (uint8)",
  "function maxPerWallet() view returns (uint256)",
  "function mintedBy(address) view returns (uint256)",
  "function mint(uint256 quantity) payable",
  "function allowlistMint(uint256 quantity, bytes32[] proof) payable",
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

export const IdentityRegistry = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

export const ERC20 = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const ComdToken = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** Pons mode: the pluggable swapper (UniswapV4PoolSwapper) that reaches Pons's graduated pool; quotes are non-view (simulate). */
export const Swapper = parseAbi([
  "function configured() view returns (bool)",
  "function poolId() view returns (bytes32)",
  "function quoteETHForComd(uint256 ethIn) returns (uint256)",
  "function quoteComdForETH(uint256 amountIn) returns (uint256)",
  "function swapExactETHForComd(uint256 minOut, address to, uint256 deadline) payable returns (uint256)",
  "function swapExactComdForETH(uint256 amountIn, uint256 minOut, address to, uint256 deadline) returns (uint256)",
]);

/** V3+: two buckets of the ETH tax (buyback-and-burn / Counsel floor sweep). */
export const Flywheel = parseAbi([
  "function totalTaxIn() view returns (uint256)",
  "function totalBoughtBack() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function totalSwept() view returns (uint256)",
  "function sweptTokenIds() view returns (uint256[])",
  "function sweepSpent() view returns (uint256)",
  "function bucketBalances() view returns (uint256, uint256)",
  "function bps() view returns (uint16, uint16)",
  "function maxSweepPrice() view returns (uint256)",
  "function swapper() view returns (address)",
  "function buyback(uint256 minOut) returns (uint256 burned)",
  "event TaxIn(uint256 eth)",
  "event Buyback(uint256 ethIn, uint256 comdBurned)",
  "event Swept(uint256 tokenId, uint256 price)",
]);

export const RewardDistributor = parseAbi([
  "function claim(uint256 epoch, uint256 tokenId, uint256 amount, bytes32[] proof)",
  "function claimToken(address asset, uint256 epoch, uint256 tokenId, uint256 amount, bytes32[] proof)",
  "function claimed(uint256 epoch, uint256 tokenId) view returns (bool)",
  "function claimedToken(address asset, uint256 epoch, uint256 tokenId) view returns (bool)",
]);

export const ContributorDistributor = parseAbi([
  "function claim(uint256 launchId, address account, uint256 amount, bytes32[] proof)",
  "function unlockAt(uint256 launchId) view returns (uint256)",
]);

export const Incorporations = parseAbi([
  "function create(string name, string symbol, string metadataURI) returns (address coin)",
  "function buyWithComd(address coin, uint256 comdIn, uint256 minOut) returns (uint256)",
  "function sellForComd(address coin, uint256 amountIn, uint256 minComdOut) returns (uint256)",
  "function buyWithETH(address coin, uint256 minOut) payable returns (uint256)",
  "function sellForETH(address coin, uint256 amountIn, uint256 minEthOut) returns (uint256)",
  "function quoteBuy(address coin, uint256 comdIn) view returns (uint256)",
  "function quoteSell(address coin, uint256 amountIn) view returns (uint256)",
  "function coins(uint256) view returns (address)",
  "function coinCount() view returns (uint256)",
  "function swapper() view returns (address)",
  "function totalToRewards() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "event CoinCreated(address indexed coin, address indexed creator, string name, string symbol, string metadataURI)",
  "event Trade(address indexed coin, address indexed trader, bool isBuy, uint256 comdAmount, uint256 coinAmount, uint256 ethAmount)",
]);

export const RevenueRouter = parseAbi(["function distribute() returns (uint256 toRewards, uint256 toTreasury)", "function bps() view returns (uint16, uint16)", "function totalToRewards() view returns (uint256)", "function totalToTreasury() view returns (uint256)"]);

export type ContractName =
  | "CounselNFT"
  | "IdentityRegistry"
  | "ComdToken"
  | "Swapper"
  | "Flywheel"
  | "RewardDistributor"
  | "ContributorDistributor"
  | "Incorporations"
  | "RevenueRouter"
  | "Permit2"
  | "WETH";

/** External addresses (Permit2, WETH). Protocol contracts are unknown until deploy; env overrides apply on top. */
export const addresses: Record<number, Partial<Record<ContractName, Address>>> = {
  4663: {
    Permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  },
  46630: {
    Permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    WETH: "0x7943e237c7F95DA44E0301572D358911207852Fa",
  },
};
