// Minimal ABI fragments matching INTERFACES.md signatures. Used only until packages/abi (@company/abi) exists;
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
  "function burn(uint256 amount)",
]);

/** V2: quotes are net of the 5% ETH tax; non-view (simulate them). */
export const ComdRouter = parseAbi([
  "function swapExactETHForComd(uint256 minOut, address to, uint256 deadline) payable returns (uint256)",
  "function swapExactComdForETH(uint256 amountIn, uint256 minOut, address to, uint256 deadline) returns (uint256)",
  "function quoteETHForComd(uint256 ethIn) returns (uint256)",
  "function quoteComdForETH(uint256 amountIn) returns (uint256)",
]);

export const ComdTaxHook = parseAbi([
  "function taxBps() view returns (uint16)",
  "function totalTaxed() view returns (uint256)",
  "function pendingTax() view returns (uint256)",
  "function seeded() view returns (bool)",
  "function cap() view returns (uint256)",
  "function currentCap() view returns (uint256)",
  "function inventory() view returns (uint256)",
  "function lastInventory() view returns (uint256)",
  "function stats() view returns ((uint256 trimmedComd, uint256 trimmedEth, uint256 split, uint256 burned, uint256 toBond, uint256 toStakers, uint256 toSeats))",
  "function params() view returns ((uint256 capFloor, uint256 capDecayPerDay, uint16 burnBps, uint16 bondBps, uint16 stakersBps, uint16 seatsBps, int24 refStepTicks))",
]);

/** V3/V4: two buckets of the ETH tax (buyback-and-burn / Counsel floor sweep). */
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
  "function buyback(uint256 minOut) returns (uint256 burned)",
  "event TaxIn(uint256 eth)",
  "event Buyback(uint256 ethIn, uint256 comdBurned)",
  "event Swept(uint256 tokenId, uint256 price)",
]);

/** sCOMD: ERC-4626 vault over COMD. */
export const StakedComd = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

export const RewardDripper = parseAbi([
  "function ratePerSecond() view returns (uint256)",
  "function streamCapPerDay() view returns (uint256)",
  "function pending() view returns (uint256)",
  "function totalDripped() view returns (uint256)",
  "function drip() returns (uint256)",
]);

/** Sells the 6% trim reserve for ETH at priceEth (wei per 1e18 COMD) once enabled. */
export const Bond = parseAbi([
  "function enabled() view returns (bool)",
  "function priceEth() view returns (uint256)",
  "function reserve() view returns (uint256)",
  "function totalSold() view returns (uint256)",
  "function totalProceeds() view returns (uint256)",
  "function quote(uint256 ethIn) view returns (uint256)",
  "function buyWithEth(uint256 minOut) payable returns (uint256)",
  "event Bonded(address indexed buyer, uint256 ethIn, uint256 comdOut)",
]);

export const BuyWall = parseAbi([
  "function wallEthPosted() view returns (uint256)",
  "function totalWallBought() view returns (uint256)",
  "function parkedEth() view returns (uint256)",
  "function floorTick() view returns (int24)",
  "function canRebalance() view returns (bool)",
  "function rebalance() returns (uint256 tip)",
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
  "event CoinCreated(address indexed coin, address indexed creator, string name, string symbol, string metadataURI)",
  "event Trade(address indexed coin, address indexed trader, bool isBuy, uint256 comdAmount, uint256 coinAmount, uint256 ethAmount)",
]);

export const RevenueRouter = parseAbi(["function distribute() returns (uint256 toRewards, uint256 toTreasury)", "function bps() view returns (uint16, uint16)", "function totalToRewards() view returns (uint256)", "function totalToTreasury() view returns (uint256)"]);

export type ContractName =
  | "CounselNFT"
  | "IdentityRegistry"
  | "ComdToken"
  | "ComdRouter"
  | "ComdTaxHook"
  | "Flywheel"
  | "StakedComd"
  | "RewardDripper"
  | "Bond"
  | "BuyWall"
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
