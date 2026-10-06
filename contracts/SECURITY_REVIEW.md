# Company.md — contracts security review

> **This is not an audit.** Internal, adversarial reviews done in a limited time box. **Before significant TVL sits
> in these contracts on Robinhood Chain mainnet (4663), have them reviewed by an external audit firm.**

# V4 (2026-10-06): COMD revenue, ETH Bond, USDG removed

Scope of the change (everything else is V3, unchanged):
- `RevenueRouter` now splits **COMD** (same 80/20 default, same bps bounds 5,000–10,000, anyone may `distribute()`).
  COMD is a plain OZ ERC-20 (no fee-on-transfer, no blocklist), so the V3 note about a pausable/blocklisting revenue
  token no longer applies. The rewards share lands in `RewardDistributor` as COMD and is only paid via settler roots
  (`claimed <= total` per root, M-03).
- `Bond` sells its COMD reserve for **ETH**: `buyWithEth(minOut)` is `nonReentrant`, checks enabled / non-zero /
  slippage / reserve, updates accounting, transfers COMD (`safeTransfer`) and then forwards `msg.value` to the treasury
  with a checked low-level call (`TransferFailed` reverts the whole buy, so no ETH is ever stranded in the Bond). A
  treasury that rejects ETH blocks sales until the owner calls `setTreasury` (tested). Owner powers unchanged in
  kind (price, enabled flag, treasury); L-05 (owner can price low and buy the reserve) still applies, now in ETH.
- `MockUSDG` deleted; the USDG distributor invariant / M-03 test now run on a generic second ERC-20
  (`DistributorsInvariantOtherToken`, `test_M03_otherTokenClaimCannotExceedRootTotal`).
- New tests: Bond ETH paths (treasury rejects ETH, fuzzed quote and COMD conservation), COMD revenue split fuzz,
  deploy JSON output. Full suite: 164 tests / 32 suites green.

The V3 section below is kept as history; its USDG references are superseded by V4.

# V3 (2026-10-06): tax + POOL4 mechanics on one pool (ComdTaxHook + BuyWall), sCOMD, Bond, USDG revenue

V3 restores the IMD-inspired POOL4 mechanics (inventory cap, trims, 85/6/4.5/4.5 split, buy wall, sCOMD, dripper,
bond) on the SAME official COMD/ETH pool as the V2 5% ETH tax, removes the Flywheel rewards bucket (buyback / sweep
50/50) and moves job revenue back to USDG (80% Counsel / 20% treasury). V2 and V1 sections below are history;
their findings are mapped in V3.4.

## V3.1 Architecture and scope

The combined logic does not fit one contract with the wall, so it is split:

| Contract | Role | Runtime size (≤ 24,576) |
|---|---|---|
| `ComdTaxHook` | tax (V2), inventory cap/ratchet, trims, split, claims + `flush`, reference tick, main position (locked) | 20,802 |
| `BuyWall` | wall position (only other LP of the pool), H-01 floor, rebalance + tip; filled COMD → `ComdTaxHook.split` | 12,310 |
| `StakedComd` / `RewardDripper` / `Bond` | V1 reviewed code (M-02, L-01, L-04 fixes), renamed; Bond proceeds → treasury | 6,146 / 2,979 / 2,466 |
| `Flywheel` | 2 buckets (buyback / sweep) | 6,122 |
| `RevenueRouter` | USDG 80/20 | 2,330 |
| `Incorporations` | 1% fee back to sCOMD stakers (dripper) | 13,380 |

## V3.2 New threat-model items (combined hook)

| # | Threat | Handling | Test |
|---|---|---|---|
| T14 | **Order of tax and trim** — a trim could change what the swapper receives or the tax base | afterSwap computes and collects the tax from the pool-side delta first; the trim is a separate `modifyLiquidity` by the hook that never touches the swapper's delta | `ComdTrimTest.test_trimNeverAltersExecutedQuote` (same output and price as a no-trim branch, quote == executed), `CombinedHookSecurityTest.test_trimAndTaxIndependent` |
| T15 | **Rogue liquidity** — a second "wall" or any LP diluting/front-running the protocol positions | `beforeAddLiquidity` allows only the hook itself (noSelfCall) and the BuyWall registered once by the owner | `test_onlyRegisteredBuyWallMayAddLiquidity`, `ComdTaxHookTest.test_thirdPartyLiquidityBlocked` |
| T16 | **Split abuse** — someone routes COMD through `split` to farm the 15% legs or fake stats | `split` is BuyWall-only and pulls the tokens (transferFrom) | `test_splitOnlyBuyWall`, `test_splitAndEthGuards` |
| T17 | **ETH accounting across two contracts** — trim ETH, tax ETH and wall ETH mixed | tax ETH only to the Flywheel (`notifyTax`); trim ETH taken straight to the BuyWall (or claims until it is set); the BuyWall accepts ETH only from the PoolManager; the hook holds no ETH at rest | invariant `taxAndTrimConservation` (hook ETH 0, Flywheel ETH == buckets, trimmed == split + pending) |
| T18 | **Claims fallback for two currencies and two destinations** | separate `pendingTax` / `claimEth` / `claimComd`; `flush()` burns exactly their sum of ERC-6909 ids and forwards each to its destination; trim ETH waits while no BuyWall is set | `test_firstBuyTaxHeldAsClaimsThenFlushed`, `TaxClaimsSecurityTest`, invariant |
| T19 | **Wall floor manipulation (H-01) on the new contract** | ported fix: floor moves ≤ `floorDecayTicksPerDay` both ways, toward the price ≤ one day per update; initial floor = opening tick + gap | `H01_WallFloorManipulation` (both tests), `BuyWallTest.test_floorTowardPriceBounded` |
| T20 | **Keeper tip farming** | tip only on ETH handled (new inflow + wall spend); idle calls revert `NothingToRebalance`; caps 1% / 0.002 ETH | `BuyWallTest.testFuzz_tipBounds`, `test_trimEthReachesWallAndPostsAboveTick` |
| T21 | **Re-entrancy via the flywheel during trims** | Flywheel `notifyTax` is accounting only; buyback/sweep keeper-only + nonReentrant; marketplace adapters cannot re-enter (buyback, awardSwept, sweep tried) | `test_reentrantAdapterBlocked`, `test_buybackDuringTrimHeavyStateStaysConserved` |
| T22 | **Ratchet griefing / wash trading** | cap never rises by itself, decay ≤ 100,000 COMD/day regardless of swap count | `test_washTradingDoesNotShrinkCap`, `test_capDecays100kPerDayTowardInventory` |

All V2 items T1–T13 still hold (pre-seed window, POL-only init, exemption only via the official router with the real
caller, partial fills, donation griefing, sweep caps, distributor caps — now also USDG).

## V3.3 Findings during V3 development

| ID | Severity | Description | Status |
|---|---|---|---|
| V3-01 | Medium | BuyWall: before the first floor update, `_postWall` read the uninitialized stored floor (0) instead of the opening-tick floor, so the first rebalance always parked the ETH. | Fixed (initial floor materialized); `BuyWallTest` |
| V3-02 | Info (design) | With 100% of supply seeded single-sided at the opening price, inventory can never exceed the seed: trims only start once the cap has decayed below inventory re-filled by sells (the room opened by buys closes at ≤ 100,000 COMD/day). | By design (scaled IMD defaults); documented |
| V3-03 | Info | Trims at a price where the main position holds little ETH free almost no ETH for the wall (e.g. the only buyer sells everything back). | By design |
| V3-04 | Info | Owner `setDestinations` can redirect the 15% non-burn legs; `Bond.setPrice` has no lower bound (V1 L-05). | Disclosed; recommend timelock |
| V3-05 | Info | `closeMarket` / `fundInventory` from V1 were not ported: liquidity is locked forever (no rug, no remedy). | By design |

## V3.4 Earlier findings in V3

| ID | Status in V3 | Test |
|---|---|---|
| C-01 pre-seed window | holds (atomic `initializeAndSeed`) | `C01_NoPreSeedWindow` |
| H-01 wall floor | ported to BuyWall | `H01_WallFloorManipulation` |
| M-01 fundInventory slippage | n/a (no fundInventory) | — |
| M-02 sCOMD hold griefing / L-04 ERC-4626 max | ported | `M02_StakeHoldGriefing` |
| M-03 distributor over-claim | holds for COMD, USDG, ETH | `M03_DistributorOverClaim` (3 tests), distributor invariants |
| L-01 drip into empty vault | ported | `L01_DripIntoEmptyVault` |
| L-02 opening tick overflow | `LaunchMath` | `L02_OpeningTickOverflow` |
| L-03 Incorporations refund | defensive only (taxed partial fills revert) | — |
| L-05 Bond price | disclosed | — |
| I-01 vault inflation | holds | `I01_VaultInflationResistance` |
| V2-01..V2-08 | hold | V2 tests (tax, flywheel, security) |

## V3.5 Invariants (`test/security/Invariants.t.sol`)

| Suite | Invariant |
|---|---|
| `TaxConservationInvariant` (buys/sells via router, raw exact-out buys/sells, time warps with fast cap decay → trims, wall rebalances, buybacks, sweeps, flushes, bps changes) | tax: `hook.totalTaxed == flywheel.totalTaxIn + pendingTax`, `totalTaxIn == Σ buckets + boughtBack + sweepSpent`, exact 5% per router swap; trim: `burned + bond + stakers + seats == split`, `trimmedComd + wallBought == split + claimComd`; hook holds no ETH/COMD at rest, wall holds no COMD at rest. Mutation-checked (1-wei bucket leak and 1-wei split leak both fail). `test_handlerActionsAllSucceed` proves every action (incl. a real trim and a wall post) executes. |
| `VaultSharePriceInvariant` | sCOMD `convertToAssets(1e24)` never decreases; vault solvent |
| `DistributorsInvariant` (COMD + ETH) / `DistributorsInvariantUsdg` | per root `claimed ≤ total`; Σ paid ≤ funded; balance ≥ outstanding; contributor launches ≤ total |
| `IncorporationsSolvencyInvariant` | Σ reserves == backing ≤ COMD balance; no coin sells for more than its reserve |

## V3.6 Test counts

32 suites, **161 tests**, all passing (`FOUNDRY_SOLC=$SOLC_PATH FOUNDRY_OFFLINE=true forge test`):

| Group | Tests |
|---|---|
| Unit — ComdTaxHook 15, ComdTrim 12, BuyWall 8, ComdRouter 7, Flywheel 12, StakedComd 12, Bond 5, RevenueRouter 4, RewardDistributor 8, Incorporations 9, ComdToken 5, CounselNFT 10, ERC8004 2, Oracle 4, ProjectFactory 11 | 124 |
| Deploy script | 4 |
| Integration (end to end) | 1 |
| Security regressions (C-01, H-01 ×2, M-02 ×2, M-03 ×3, L-01, L-02, I-01) + attacks (TaxHookSecurity 9, CombinedHookSecurity 4, TaxClaims 1) | 25 |
| Invariant suites: 6 invariants + 1 handler sanity test | 7 |

Fuzz tests also pass at 1,000 runs.

## V3.7 Owner / keeper powers

See `README.md` (owner table). Highest-impact: ComdTaxHook `setDestinations` (15% legs) and `setTaxBps`; StakedComd
`pause`; Bond `setPrice` + `setEnabled`; Flywheel `awardSwept` / adapters; RewardDistributor settler; ERC-8004
upgrades. None can remove the pool liquidity. `ADMIN` should be a multisig with a timelock.

---

# V2 (2026-10-06): ComdToken, ComdTaxHook, Flywheel

V2 replaces the V1 hook pool (CompanyBurnHook + StakedCompany + RewardDripper + Bond) with a tax design: 100% of a
1,000,000,000 COMD supply in one locked single-sided v4 position, a 5% ETH tax on every buy and sell in the
official pool, and a Flywheel that spends the tax on buyback-and-burn / Counsel floor sweeps / Counsel rewards.
The V1 review below is kept for history; findings on removed contracts no longer apply (table V2.4).

## V2.1 Scope

| Area | Files |
|---|---|
| New, value-holding | `ComdTaxHook.sol`, `Flywheel.sol`, `ComdRouter.sol` (renamed + exemption attestation), `libraries/LaunchMath.sol` |
| New, sweep plumbing | `interfaces/IMarketplaceAdapter.sol`, `mocks/MockMarketplace.sol` (testnet), `marketplace/SeaportAdapter.sol` (skeleton) |
| Changed | `ComdToken.sol` (was CompanyToken), `RewardDistributor.sol` (ETH asset), `RevenueRouter.sol` (COMD burn/rewards, no swaps), `Incorporations.sol` (COMD; staker fee → Counsel rewards), `CounselNFT.sol` / oracle (names, EIP-712 "Company.md Oracle"), `launch/ProjectFactory.sol` (uses LaunchMath) |
| Scripts | `script/Deploy.s.sol`, `script/SeedPool.s.sol` |

## V2.2 Threat model and how each threat is handled

| # | Threat | Handling | Test |
|---|---|---|---|
| T1 | **Pre-seed price manipulation** (V1 C-01): trading between pool creation and liquidity | The hook initializes its own pool inside `initializeAndSeed` (v4 skips `afterInitialize` for self-calls) and seeds in the same tx; every external `initialize` with this hook reverts `ExternalInitialize`; `beforeSwap` also requires `seeded` | `C01_NoPreSeedWindow`, `ComdTaxHookTest.test_noSwapBeforeSeed_externalInitRefused`, `test_initializeAndSeedAtomic` |
| T2 | **Initializer impersonation** | only `pol` (immutable) can call `initializeAndSeed`, once | `test_onlyPolOnce` |
| T3 | **Third-party LP** in the official pool (dilutes/steals tax-free flow) | `beforeAddLiquidity` reverts for everyone (the hook's own add skips the callback) | `test_thirdPartyLiquidityBlocked` |
| T4 | **Tax bypass via forged exemption** | exemption only if `sender == router` (set once) AND router-written `hookData == flywheel`; ComdRouter writes `msg.sender`, never caller-supplied data | `TaxHookSecurity`: third-party router with forged hookData, custom unlock caller with forged hookData, contract calling the official router — all taxed |
| T5 | **Tax bypass via swap kind / price limits** | all four kinds taxed; beforeSwap-taxed kinds must fill completely (`TaxedPartialFill`), afterSwap-taxed kinds are taxed on the actual amount | `test_*Exact*Tax`, `testFuzz_taxAllKinds`, `test_partialFillCannotUnderpayTax` |
| T6 | **Tax bypass via other pools** | other pools cannot use this hook (T1); other hookless COMD pools have their own liquidity and never touch the official position (accepted: untaxed trading elsewhere is possible but cannot use our liquidity) | `test_otherPoolsCannotReachOfficialLiquidity` |
| T7 | **Flywheel buyback taxed into itself / loop** | exempt path (T4); additionally Flywheel's `receive` accepts ETH only during its own buyback/sweep and counts it as a refund, tax only via `notifyTax` from the hook | `test_buybackNotTaxedIntoItself`, `FlywheelTest.test_buybackIsUntaxedAndBurns` |
| T8 | **Re-entrancy** through marketplace adapters / router refunds | `nonReentrant` on buyback / sweep / distribute / awardSwept; refunds accounted separately from tax; sweep verifies `counsel.ownerOf(tokenId) == flywheel` after the call | `test_reentrantAdapterBlocked` (adapter re-enters buyback, distribute, sweep → `ReentrancyGuardReentrantCall`, buckets unchanged) |
| T9 | **Physical ETH shortfall inside hooks** (V1 lesson): the swapper settles after the hooks | tax taken physically only if the PoolManager holds it, otherwise ERC-6909 claims (`pendingTax`), redeemable only by the hook via permissionless `flush()` → Flywheel | `test_firstBuyTaxHeldAsClaimsThenFlushed`, `TaxClaimsSecurityTest` |
| T10 | **Donation griefing** | `PoolManager.donate` only benefits the locked position; ETH sent to hook/Flywheel is refused; COMD sent to them changes no accounting; ETH sent to RewardDistributor becomes unallocated (cannot break posted roots) | `test_donationsToPoolHookFlywheelAreHarmless`, `test_flushSpamHarmless` |
| T11 | **Sweep overpayment / wrong NFT** | adapter allowlist (owner), price ≤ min(`maxSweepPrice`, keeper `maxPrice`, bucket), only Counsel accepted by `onERC721Received`, delivery checked, refund returned to the bucket | `test_sweepRefusedAboveCaps`, `test_sweepOnlyAllowlistedAdapterAndDelivery`, `test_onlyCounselAccepted`, invariant `sweepSpent ≤ totalSwept·maxSweepPrice` |
| T12 | **Distributor over-pay** (V1 M-03) incl. ETH | per-root `claimed ≤ total`; `postRoot` ≤ unallocated (ETH = balance) | `M03_*`, `RewardDistributorTest.test_eth*`, `DistributorsInvariant` (COMD + ETH) |
| T13 | **Rug / owner theft** | no liquidity-removal function at all; tax destination immutable; RewardDistributor immutable in Flywheel/RevenueRouter; tax hard cap 500 bps | owner tables in README; `test_taxBpsBoundsAndZero` |

## V2.3 Findings during V2 development

| ID | Severity | Description | Status |
|---|---|---|---|
| V2-01 | Medium (design) | Taking the buy-side tax physically in `beforeSwap` fails on the first buy (PoolManager has no ETH yet) — same root cause as V1's large-trim issue. | Fixed: claims fallback + `flush()` (T9) |
| V2-02 | Medium (design) | With a beforeSwap-charged tax, a price-limited partial fill would charge tax on the unswapped part (exact-in buy) or leave the hook's delta larger than the pool output (exact-out sell). | Fixed: `TaxedPartialFill` full-fill requirement (T5) |
| V2-03 | Low | Router refunds and marketplace refunds arrive at the Flywheel via `receive`; mixing them with tax would double-count. | Fixed: refunds only accepted during an op and tracked in `_opRefund`; tax only via `notifyTax` |
| V2-04 | Info | Trades below 20 wei of ETH pay 0 tax (rounding). Splitting a trade into dust swaps costs far more gas than it saves. | Acknowledged |
| V2-05 | Info | Keeper chooses buyback `minOut`; a compromised keeper (or `minOut = 0`) lets the buyback bucket be sandwiched. Bounded per call by the bucket. | Acknowledged; run buyback with a quote-derived `minOut` (`ComdRouter.quoteETHForComd` from the Flywheel address is untaxed) |
| V2-06 | Info | `SeaportAdapter` is a skeleton, not tested against Seaport; only owner-allowlisted adapters can be used. | Acknowledged |
| V2-07 | Info | Liquidity is locked forever (no escape hatch). A defect that requires moving liquidity cannot be remedied; conversely no key can rug it. | By design |
| V2-08 | Info | Incorporations ETH trades pay the pool tax on their ETH↔COMD leg (≈ 13% round-trip cost with curve fees). | By design, documented |

## V2.4 V1 findings after V2

| V1 ID | Contract | Status in V2 |
|---|---|---|
| C-01 | CompanyBurnHook | Lesson kept (T1); contract removed |
| H-01, M-01, I-02, I-04 | CompanyBurnHook | Contract removed |
| M-02, L-01, L-04, I-01 | StakedCompany / RewardDripper | Contracts removed |
| L-05 | Bond | Contract removed |
| L-06 | RevenueRouter | Obsolete: no swaps/adapters; destinations immutable; only `burnBps` settable |
| M-03 | RewardDistributor | Kept; extended to ETH (tests) |
| L-02 | ProjectFactory | Kept; code moved to `LaunchMath` (shared with the hook) |
| L-03 | Incorporations | Code kept (refund of unused router ETH); with ComdTaxHook a partially filled taxed buy reverts, so the path is now defensive only |
| I-03, I-05..I-10 | various | Unchanged |

## V2.5 Invariants (`test/security/Invariants.t.sol`)

| Suite | Invariant |
|---|---|
| `TaxConservationInvariant` (router buys/sells, raw exact-out buys/sells, buyback, distribute, sweep, flush, bps changes; real PoolManager) | `hook.totalTaxed == flywheel.totalTaxIn + pendingTax`; `totalTaxIn == Σ buckets + totalBoughtBack + sweepSpent + totalRewards`; Flywheel ETH == Σ buckets; hook holds no ETH; every router swap taxed exactly 5%; Flywheel holds no COMD; sweep spend ≤ count × cap. Mutation-checked (a 1-wei bucket leak fails it). `test_handlerActionsAllSucceed` proves each handler action really executes. |
| `DistributorsInvariant` | COMD **and ETH** roots: `claimed ≤ total`, Σ paid ≤ funded, balance ≥ outstanding; ContributorDistributor per launch ≤ total |
| `IncorporationsSolvencyInvariant` | Σ reserves == `totalBacking` ≤ COMD balance; no coin can sell for more than its reserve (now through the taxed pool) |

## V2.6 Test counts and sizes

21 suites, **111 tests**, all passing (`FOUNDRY_PROFILE=local forge test`): unit 88, security PoC/regression 14,
invariants 3 (+1 handler sanity test), integration 1, deploy 4. Fuzz tests also pass at 1,000 runs.

Runtime sizes (limit 24,576): ComdTaxHook 12,890 · Flywheel 6,771 · ComdRouter 5,412 · RewardDistributor 5,042 ·
RevenueRouter 2,135 · Incorporations 13,346 · ProjectFactory 21,244 · CounselNFT 8,393 · SeaportAdapter 1,792.

## V2.7 Owner / keeper powers (V2)

| Contract | Holder | Can do to users' value |
|---|---|---|
| ComdTaxHook | owner | set tax 0–5%; set router once. Nothing else. |
| Flywheel | owner | change future split; set `maxSweepPrice`, adapters, keeper; **give swept NFTs to anyone (`awardSwept`)** |
| Flywheel | keeper (or owner) | buyback slippage (V2-05); choose sweep listings within caps |
| RevenueRouter | owner | burn share 0–100% (rest always to Counsel rewards) |
| RewardDistributor | settler / admin | allocate unallocated COMD/ETH to seats; expire roots after 365 d |
| others | — | as V1 tables (CounselNFT, ProjectFactory, Incorporations, ERC-8004 upgrades) |

`ADMIN` should be a multisig with a timelock in front of `setTaxBps`, `setBps`, `setAdapter`, `setMaxSweepPrice`,
`awardSwept`, registry upgrades.

---

# V1 review (history)

> V1: an internal, adversarial review by one reviewer who did not write the code,
> done in a limited time box. **Before significant TVL sits in these contracts on Robinhood Chain mainnet (4663),
> have them reviewed by an external audit firm.** The owner reports that legal checks are done; a smart-contract
> audit is a separate thing and is still outstanding.

Date: 2026-10-06 · Toolchain: Foundry, solc 0.8.26 (optimizer 200, cancun) · OZ 5.4 · Uniswap v4-core `46c6834`

## 1. Scope

All of `contracts/src`:

| Area | Files |
|---|---|
| Hook pool (value-holding, most complex) | `CompanyBurnHook.sol`, `CompanyHookLens.sol`, `CompanyRouter.sol`, `libraries/LiquidityAmountsLib.sol`, `libraries/TickAlign.sol` |
| Staking / rewards | `StakedCompany.sol`, `RewardDripper.sol`, `RewardDistributor.sol`, `Bond.sol`, `RevenueRouter.sol`, `interfaces/ISwapAdapter.sol` |
| Launchpad | `launch/ProjectFactory.sol`, `launch/LaunchToken.sol`, `launch/LaunchGuardHook.sol`, `launch/ContributorDistributor.sol` |
| Incorporations | `Incorporations.sol` |
| Tokens / identity / misc | `CompanyToken.sol`, `CounselNFT.sol`, `ERC8004Bootstrap.sol`, `ERC8004Imports.sol`, `oracle/OracleAttestationVerifier.sol`, `oracle/OracleConsumerExample.sol`, `utils/Create2Deployer.sol`, `mocks/MockUSDG.sol` (testnet only) |

Read for context, not reviewed line by line: `script/Deploy.s.sol`, `script/SeedPool.s.sol` (init/role handover
and seeding flow checked), the vendored ERC-8004 registries, Uniswap v4-core and OpenZeppelin (treated as trusted
dependencies), `apps/api` / `apps/web` (only to keep the ABIs they use stable).

## 2. Method

- Manual review of every contract against SPEC §4–9, `INTERFACES.md` and the README, with the checklist: reentrancy
  (incl. v4 unlock-callback re-entry and hook self-calls / `noSelfCall`), access control, unchecked external calls,
  rounding that leaks or locks funds, ERC-4626 inflation/donation, sandwich/MEV on trims, wall and liquidity adds,
  manipulation of the block-lagged reference tick, DoS (unbounded loops, cap-ratchet griefing, blocking
  flush/rebalance), Merkle double claims and leaf collisions, signature replay (EIP-712 domain, chainId, expiry),
  tick/liquidity overflow, decimal assumptions (USDG 6), fee-on-transfer assumptions, push-vs-pull ETH, owner
  powers vs README disclosure, CREATE2 squatting / pool-initialization front-running, hook permission bits vs
  implemented callbacks, the 24,576-byte code-size limit.
- Every suspected issue was turned into a Foundry PoC on a real v4 `PoolManager` (`test/security/Findings.t.sol`)
  and run against the **unmodified** code first; it was only reported once the PoC failed there. After each fix the
  test passes. Fixes were mutation-checked (fix removed → its test fails again).
- Economic attacks were quantified with scratch simulations (numbers quoted below).
- Handler-based invariant suites (`test/security/Invariants.t.sol`) with ghost accounting; also run with
  `fail_on_revert = true` (0 reverts) to make sure the handlers really exercise the code.

## 3. Findings

| ID | Severity | Contract | Description | Status | Test |
|---|---|---|---|---|---|
| C-01 | **Critical** | CompanyBurnHook | Swaps were allowed between `initialize` and `seed` (two POL transactions). On the empty pool a 1-wei swap moves the price to the tick limit for free; `seed` then deposits the POL inventory at that price and the attacker buys it for dust. PoC: **129,981 of 130,000 seeded COMPANY for 0.000001 ETH**. | Fixed — `afterSwap` reverts `NotSeeded()` until `seed` | `C01_PreSeedPriceManipulation::test_C01_preSeedSwapCannotMovePriceOrStealSeed` |
| H-01 | **High** | CompanyBurnHook | The buy-wall floor moved toward the price *immediately* once the block-lagged `refTick` (200 ticks per parent-chain block, ~12 s) caught up. Holding a pump for a few blocks, donating 0.1 ETH to trigger `rebalance`, then selling into the freshly posted wall extracts the protocol's ETH. PoC (100 ETH main, 50 ETH wall, attacker sells 30k COMPANY): honest sale 21.87 ETH; 10 ETH pump × 10 blocks → 24.86 ETH; 20 ETH pump × 15 blocks (~3 min) → **28.18 ETH (+6.3 ETH from the wall)**. | Fixed — floor moves ≤ `floorDecayTicksPerDay` in **both** directions (toward the price: ≤ one day's allowance per update); initial floor set at `seed` from the opening price; `floorDecayTicksPerDay` ≥ 1 | `H01_WallFloorManipulation::test_H01_pumpedReferenceCannotDragWallAboveMarket`, `::test_H01_floorStillFollowsAGenuineRally` |
| M-01 | Medium | CompanyBurnHook | `fundInventory` added liquidity at the spot price with no bound: the owner's deposit could be sandwiched (push price, owner adds at a bad ratio, reverse). | Fixed — **signature change** `fundInventory(uint256 companyAmount, int24 minTick, int24 maxTick)`, reverts `PriceOutOfBounds()` | `M01_FundInventorySlippage::test_M01_fundInventoryRevertsOutsideTickWindow` |
| M-02 | Medium | StakedCompany | The one-block hold was set on the *receiver* of any deposit and blocked the receiver's **whole** balance. Anyone could deposit 1 wei for a victim at the start of every parent-chain block (cheap on L2) and freeze the victim's stake indefinitely (no redeem/withdraw/transfer). The contract NatSpec claimed the opposite. | Fixed — only shares minted in the current block are held (`heldShares`) | `M02_StakeHoldGriefing::test_M02_depositForVictimDoesNotFreezeTheirStake`, `::test_M02_ownDepositStillHeldSameBlock` |
| M-03 | Medium | RewardDistributor | Claims were never bounded by the root's `total`. A root whose leaves sum to more than its total (off-chain bug, or the hot SETTLER key posting `total = 0`) drained balances committed to *other* epochs; `expireEpoch` would then underflow. | Fixed — `claimed + amount ≤ total` per root (`ExceedsTotal()`); `total ≤ uint128.max` on post | `M03_DistributorOverClaim::test_M03_claimCannotExceedRootTotal`, `DistributorsInvariant` |
| L-01 | Low | RewardDripper | Dripping into an empty vault hands the rewards to the OZ virtual shares forever (no staker can withdraw them) — likely right after launch, before anyone stakes. | Fixed — `pending()` is 0 while the vault has no shares; rewards wait in the dripper | `L01_DripIntoEmptyVault::test_L01_noDripWhileVaultEmpty` |
| L-02 | Low | ProjectFactory | `openingTick` computed `supply·2^192/marketCap` with `mulDiv`, which overflows when the token is currency1 and supply/marketCap ≥ 2^64 (e.g. `custom_token` 1e30 wei vs 1,000 USDG) → such launches reverted depending only on CREATE2 address order. | Fixed — `sqrt(num·2^96/den)·2^48` branch for large ratios | `L02_OpeningTickOverflow::test_L02_openingTickLargeRatio` |
| L-03 | Low | Incorporations | `buyWithETH`: ETH the router refunds on a partial fill (pool out of liquidity, e.g. a narrow main range) stayed in Incorporations, unaccounted and unrecoverable. | Fixed — refunded to the trader; `Trade.ethAmount` is the ETH actually used | `L03_IncorporationsEthRefund::test_L03_partialFillRefundsTrader` |
| L-04 | Low | StakedCompany | ERC-4626 `maxRedeem`/`maxWithdraw`/`maxDeposit`/`maxMint` ignored the hold and the pause (integrators calling `redeem(maxRedeem())` reverted). | Fixed — overrides; held redeems now revert `ERC4626ExceededMaxRedeem` (transfers still `SameBlockHold`) | covered by the M-02 tests |
| L-05 | Low | Bond | Undisclosed owner power: the README said the owner "cannot withdraw the reserve", but `setPrice` has no lower bound — the owner can set 1 USDG-wei/COMPANY, enable and buy the whole reserve. | Acknowledged — disclosed in README owner table | — |
| L-06 | Low | RevenueRouter | Admin can set destinations to any address, and a malicious swap adapter plus a keeper `minCompanyOut = 0` takes the buyback USDG. README wording ("cannot withdraw other than through these routes") understated it. | Acknowledged — disclosed in README owner table | — |
| I-01 | Info | StakedCompany | First-depositor donation attack checked: with decimals offset 6 the victim keeps ≥ 99.9% and the attacker loses ~50% of the donation. | Verified, no change | `I01_VaultInflationResistance::test_I01_donationAttackUnprofitable` |
| I-02 | Info | CompanyBurnHook (H-01 residual) | A reference held pumped for ≥ 2 blocks can still pull the floor toward it by one day's allowance (≤ 400 ticks ≈ 4%) per day; with the 200-tick gap the bid can sit up to ~2% above the market for the part of the wall in that band. Unprofitable at default parameters in our simulation, but scales with wall size vs. main liquidity. | Acknowledged | — |
| I-03 | Info | ProjectFactory | `univ4_hook` launches use the launch's own hook: if that hook lets anyone initialize, an attacker can pre-create the pool for the predictable CREATE2 token and the launch reverts `PoolExists` (DoS only; retry with a new salt). Kinds 0/1 are protected by `LaunchGuardHook`. Custom hooks are fully trusted (they can take swap/LP deltas). | Acknowledged | — |
| I-04 | Info | CompanyBurnHook / CompanyRouter | Inside `afterSwap` the hook `take`s COMPANY from the PoolManager. A third-party router that calls `sync(COMPANY)` *before* the swap and `settle()` *after* is under-credited and its own transaction reverts (no loss). Universal Router's settle (sync+transfer+settle together) and `CompanyRouter` are unaffected. | Acknowledged | — |
| I-05 | Info | OracleAttestationVerifier | No `verifyingContract` in the domain (by spec): an attestation is valid for every consumer on the chain; consumers must de-duplicate by `requestId` (the example does). ChainId binding and expiry verified (`Oracle.t.sol::test_domainBoundToChain`). | By design | existing tests |
| I-06 | Info | RewardDistributor | The leaf has no asset field; the asset is bound only by the per-(epoch, asset) root. The settler must never post the same tree for two assets. | Acknowledged | — |
| I-07 | Info | ContributorDistributor | One claim per (launch, account): roots must aggregate an account's buckets into one leaf (the API does, `apps/api/src/launches.ts`). `perWalletCapBps` is off-chain. | Acknowledged | — |
| I-08 | Info | Incorporations | Intermediate ETH↔COMPANY leg has no own minimum (the final `minOut` bounds the route; documented). Trades < 100 wei pay no fees (gas makes it irrelevant). ETH sent directly to the contract is unrecoverable (no sweep). | Acknowledged | — |
| I-09 | Info | Create2Deployer | Anyone can front-run a hook deployment with the identical init code: the result is the identical contract at the identical address (the script's own call then reverts and must be skipped). | Acknowledged | — |
| I-10 | Info | CounselNFT | `_safeMint` callbacks can re-enter `mint`; `mintedBy` and `totalSupply` are updated before the loop, so limits and ids hold. | Verified, no change | existing tests |

Areas checked with no finding: v4 hook permission bits (`0x1840`: afterInitialize | beforeAddLiquidity | afterSwap,
matching the three implemented callbacks; `LaunchGuardHook` `0x2000`), `noSelfCall` for the hook's own liquidity
ops, `unlockCallback` sender checks (only the contract that called `unlock` is called back), cap ratchet (never
rises by itself; decay ≤ `capDecayPerDay`; wash trading cannot shrink it faster), trim rounding (liquidity rounded
up, ≤ position), split rounding (burn absorbs remainder), ERC-6909 claim redemption, keeper-tip bounds, tick/
liquidity casts (`LiquidityAmountsLib` rounds down; position amounts owed never exceed the ETH provided), Merkle
leaves double-hashed and bound to epoch/launch (no cross-epoch or cross-launch replay), Incorporations curve
(`x·y` never decreases → no round-trip profit; per-coin reserve caps), CounselNFT allowlist/limits, ERC8004 proxy
initialization (atomic in the proxy constructor), MockUSDG only deployable on test chains.

## 4. Invariant tests (`test/security/Invariants.t.sol`)

| Suite | Invariant |
|---|---|
| `HookSplitInvariant` (buys, sells, rebalance, flush, time/blocks on a real PoolManager) | every `Split` event: burned + 6% + 4.5% + 4.5% == amount with the configured bps; `stats` totals == Σ split inputs; supply drop == burned; Bond / stakers (dripper+vault) / RewardDistributor balances == their totals; the hook never holds COMPANY at rest; trimmed − pending claims + wall bought ≤ Σ split |
| `VaultSharePriceInvariant` (deposit/mint/withdraw/redeem/transfer, notify, drip, donations, time) | `convertToAssets(1e24)` never decreases across any action; vault holds ≥ `convertToAssets(totalSupply)` |
| `DistributorsInvariant` (funding, roots whose leaves may exceed their total, claims; ContributorDistributor registrations with over-allocated roots) | each root `claimed ≤ total`; Σ paid ≤ Σ funded; balance ≥ `outstanding`; each launch `claimed ≤ total`; contributor balance == registered − paid |
| `IncorporationsSolvencyInvariant` (COMPANY and ETH buys/sells over 3 coins through the real router + hook) | Σ per-coin `companyReserve` == `totalBacking`; for each coin, selling every outstanding coin returns ≤ its reserve; Σ of those ≤ `totalBacking` ≤ COMPANY balance |

The distributor invariant independently fails on the pre-fix `RewardDistributor` (M-03).

## 5. Test counts

| | Suites | Tests |
|---|---|---|
| Before review | 14 | 108 |
| After review | 27 (13 new test contracts in `test/security/`) | 124 (+11 regression/PoC, +5 invariants) — all pass |

Three existing tests were updated because they encoded fixed behaviour: `StakedCompanyTest.test_dripperRateAndCap` /
`test_dripperLinearUnderCap` (dripped into an empty vault — L-01), `StakedCompanyTest.test_sameBlockHold` (now the
ERC-4626 max error — L-04), and `CompanyBurnHookTest.test_fundInventoryRaisesCap` (new signature — M-01).

`CompanyBurnHook` runtime size after the fixes: **24,162 bytes** (limit 24,576; was 23,989).

## 6. Changed external interfaces

- **`CompanyBurnHook.fundInventory(uint256)` → `fundInventory(uint256 companyAmount, int24 minTick, int24 maxTick)`**
  (owner only; not used by apps/api or apps/web). New error `PriceOutOfBounds()`. Swaps before `seed` now revert
  `NotSeeded()`. `setParams` now requires `floorDecayTicksPerDay ≥ 1`.
- `StakedCompany`: new view `heldShares(address)`; `maxRedeem/maxWithdraw/maxDeposit/maxMint` overridden; a held
  redeem/withdraw reverts `ERC4626ExceededMaxRedeem/Withdraw` instead of `SameBlockHold` (transfers unchanged).
- `RewardDistributor`: new error `ExceedsTotal()`.
- No function or event listed in `INTERFACES.md` or used by `apps/api/src/chain.ts` / `apps/web/lib/contracts.ts`
  changed. ABIs regenerated (`packages/abi`); api and web typecheck clean.

## 7. Remaining risks

- **Unaudited.** This review is one pass by one reviewer; complex v4 accounting (claims, wall, trims inside
  `afterSwap`) deserves a dedicated audit and longer fuzzing campaigns.
- **Wall manipulation residual (I-02).** Recommended: keep `refStepTicks` low (e.g. 20–50) on mainnet, keep
  `floorDecayTicksPerDay` modest, monitor wall ETH relative to main-position liquidity, and alert on `WallPosted`
  with a lower tick far from the 1-hour TWAP of the pool.
- **`block.number` on Robinhood Chain is the parent-chain block** (~12 s, shared by many L2 blocks): the reference
  lag and the sCOMPANY hold are measured in those blocks.
- **Single venue.** The hook pool is the only on-chain price for COMPANY; all buyback/wall logic trusts it.
- **Off-chain correctness**: Merkle roots (per-wallet caps, aggregation, totals), Bond enabling/price, keeper
  liveness (drip must run more often than `catchUpSeconds`; `rebalance`/`flush`).
- **External tokens**: USDG may be pausable/blocklisting; a blocklisted destination makes `RevenueRouter.distribute`
  or a seat claim revert until the admin re-points it.
- **Custom launch hooks (`univ4_hook`)** are fully trusted code chosen by the registrar.
- One unrelated pre-existing API unit test fails (`apps/api/test/reads.test.ts` expects 6 services; the API now also
  lists `Keeper`). Not a contracts issue; left for the API owner.

## 8. Owner / admin powers (as implemented)

| Contract | Holder | What it can do to users' value | Bounded by |
|---|---|---|---|
| CompanyBurnHook | Ownable2Step | **`closeMarket(to)`: take all POL (both positions + hook ETH/COMPANY)**; redirect the 15% non-burn split anywhere (`setDestinations`); raise `capFloor` to 1,000,000 (effectively stop trims); tune wall/tip params | hard param bounds; renounce removes everything |
| StakedCompany | Ownable2Step | **pause → freezes all withdrawals indefinitely**; sweep non-COMPANY tokens | cannot move COMPANY; cannot renounce while paused |
| RewardDripper | Ownable2Step | re-point the vault (redirects all staker rewards); stream params | bounds |
| Bond | Ownable2Step | any price > 0 + enable → can buy the reserve itself (L-05); proceeds destination | — |
| RewardDistributor | AccessControl admin / SETTLER | settler allocates the whole unallocated balance (incl. the 1.5M COMPANY reserve) to any seat; admin re-allocates roots unclaimed after 365 d | a root can never exceed its total (M-03 fix) |
| RevenueRouter | AccessControl admin / KEEPER | send all future USDG anywhere (destinations, adapter) (L-06) | bps bounds |
| ProjectFactory | AccessControl admin / REGISTRAR / per-launch lpOwner | lpOwner removes all launch liquidity; registrar deploys arbitrary code and launches with arbitrary hooks | — |
| Incorporations | Ownable2Step | `virtualCompany` for future coins | 1,000–10,000,000 |
| CounselNFT | Ownable2Step | phase/price/limits/reserve mint/treasury/base URI until frozen | 2,000 cap |
| ERC-8004 registries | Ownable (UUPS) | **upgrade the implementation** | — |

`ADMIN` should be a multisig (ideally with a timelock in front of `closeMarket`, `setDestinations`, `setVault`,
`pause`, registry upgrades); `POL`, `SETTLER`, `KEEPER`, `REGISTRAR` separate hot wallets with nothing else.

## 9. Recommendation

Fix-verified issues above are resolved in this tree, but **the protocol should not hold significant TVL on mainnet
until an external audit firm has reviewed these contracts** (priority: `CompanyBurnHook` + `CompanyRouter`,
`StakedCompany`/`RewardDripper`, `RewardDistributor`, `ProjectFactory`, `Incorporations`). Launch with conservative
parameters and limited POL, put the admin behind a multisig + timelock, and run a public bug bounty.
