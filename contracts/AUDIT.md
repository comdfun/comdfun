# Company.md — V7 pre-launch audit and safety nets

Date: 2026-10-06 · Scope: every file in `contracts/src/**` and `script/Deploy.s.sol` at the V6 (Pons mode) state,
traced end to end against `INTERFACES.md`, the API (`apps/api/src/pairing.ts`, `payments.ts`, `settlement.ts`,
`launches.ts`, `launch-template.ts`) and the web ABI usage (`apps/web/lib/contracts.ts`).
Method: line-by-line review with the checklist from `SECURITY_REVIEW.md` §2, then a Foundry test for every
adversarial case (`test/security/Audit.t.sol`, `test/SafetyNets*.t.sol`, `test/CounselNFTUpgrade.t.sol`,
`test/Deploy.t.sol`), plus the invariant campaigns extended with the new owner actions. One internal pass; **this is
not an external audit** (see "Residual risks").

Result: no Critical or High issue in the V6 code. The Medium findings are operational (no way to stop a bad root,
no way out of a frozen venue, deployer window on the Flywheel, ETH pairing on by default). All Medium and above are
fixed in this tree; the Low/Info items that were cheap are fixed as well. Everything in Part 2 (safety nets) is
implemented and tested.

## 1. Findings

| ID | Sev. | Contract | Finding | Fix | Proof |
|---|---|---|---|---|---|
| V7-01 | **Medium** | RewardDistributor | A wrong root (off-chain bug or leaked SETTLER key) could not be stopped: roots are immutable and only expire after 365 days, and anyone can submit claims, so a too-generous leaf is drained within minutes. | Admin `revokeRoot(epoch, asset)` (immediate; releases the unclaimed remainder; fix re-posted under a new epoch id) and admin `pause()` on claims and posting. | `RewardDistributorSafetyTest.test_revokeBadRoot`, `test_pauseClaimsAndPosting` |
| V7-02 | **Medium** | Flywheel | Bucket ETH had no exit except the swapper / an adapter: if Pons's hook rejects our swapper and no other venue exists, the buyback bucket is frozen forever; a buggy adapter likewise freezes the sweep bucket. | Owner `pause()` + `rescueETH(to, fromBuyback, fromSweep)` (paused only; buckets stay conserved via `totalRescued`), `rescueERC20`, `rescueERC721`. `receive()` is never paused (Pons payouts must not bounce). | `FlywheelSafetyTest.*`, `FlywheelConservationInvariant` (now includes a rescue action) |
| V7-03 | **Medium** | Deploy.s.sol / Flywheel | The deployer hot key owned the Flywheel until ADMIN called `acceptOwnership()`; a forgotten accept left all Flywheel powers (swapper, adapters, `awardSwept`) with a CI key. | Flywheel constructor takes swapper, sweep cap and adapters so ADMIN is the owner from the first block; nothing pending anywhere. | `DeployTest.test_noDeployerPowersRemain`, `test_deployTestChainWithMockComd` |
| V7-04 | **Medium** | ProjectFactory (deploy) | ETH-paired launches were allowlisted by default although the product pairs launches with $COMD; an ETH-paired pool for a swarm token drains ETH liquidity away from the $COMD economy and contradicts the spec. | $COMD is the only allowlisted pairing; `ALLOW_ETH_PAIRING=true` opts in; ADMIN can `setPairedConfig` later. **The API default must follow** (see §4). | `DeployTest.test_deployTestChainWithMockComd`, `test_allowEthPairingOptIn`, `AuditLaunches.test_comdPairedLaunchEndToEnd`, `LaunchSafetyTest.test_ethPairingCanBeAddedAndRemovedByAdmin` |
| V7-05 | **Medium** | Incorporations | No pause and no recovery: a curve bug would have to be watched while traders drain it, and ETH sent to `receive()` or stray tokens were unrecoverable (V1 I-08). `launcherEthOwed` had no total, so no one could tell owed ETH from surplus. | `pause()` on create + all trades (launcher claims stay open); `totalLauncherEthOwed`; `rescueERC20` (surplus above `totalBacking` / a coin's `coinReserve` only), `rescueETH` (surplus above owed); two-step 48 h `emergencyWithdraw` while paused; `unpause()` refuses while insolvent. | `IncorporationsSafetyTest.*`, `IncorporationsSolvencyInvariant` (owner-rescue + launcher-claim actions, ETH-owed check) |
| V7-06 | Low | CounselNFT | Not upgradeable: a metadata or mint bug would have required a new collection (holders, royalties, ERC-8004 agent URIs lost). | UUPS (`initialize`, `_authorizeUpgrade onlyOwner`, `_disableInitializers`, ERC-7201 storage); `renounceOwnership` disabled so the proxy can never become un-upgradeable by accident. | `CounselNFTUpgradeTest.*` (10 tests), `DeployTest.test_counselNftIsUpgradeableProxyOwnedByAdmin` |
| V7-07 | Low | RevenueRouter | No pause, no recovery of mistaken tokens; COMD could only leave via `distribute()`. | `pause()`; `rescueERC20` (COMD only while paused: a visible two-step emergency; other tokens any time). Receiving revenue (Permit2 transfer) is never blocked. | `RevenueRouterSafetyTest.*` |
| V7-08 | Low | RewardDistributor | Unallocated COMD/ETH (grants, Incorporations fees) could never leave except through roots. | `rescueERC20` / `rescueETH` of **unallocated** balance only; committed roots are untouchable unless revoked first (two separate, evented actions). | `RewardDistributorSafetyTest.test_rescueOnlyUnallocated` |
| V7-09 | Low | ProjectFactory, ContributorDistributor, LaunchGuardHook | No pause of launches; stray tokens/ETH unrecoverable; allocated contributor tokens had no on-chain "reserved" total. | `pause()` (launch + deployContract; LP owners unaffected); `rescueERC20`/`rescueETH`; `rescueFromDistributor` limited to the surplus above `reserved[token]`; hook `rescueERC20` for the factory admin. | `LaunchSafetyTest.*` |
| V7-10 | Low | UniswapV4PoolSwapper, SeaportAdapter | Forced ETH (selfdestruct) or tokens stuck forever. SeaportAdapter had no owner at all. | Swapper `sweep(token, to)`; SeaportAdapter is Ownable2Step (ADMIN) with `rescueETH/ERC20/ERC721` and now rejects a zero Seaport address. | `SwapperAdapterOracleSafetyTest.*` |
| V7-11 | Low | OracleConsumerExample | Attester immutable: a leaked ATTESTER key could not be rotated (example contract; the production attester is off-chain). | `setAttester` (Ownable2Step). | `SwapperAdapterOracleSafetyTest.test_attesterRotation` |
| V7-12 | Info | CounselNFT | Collection name was "Company.md Counsel"; the launch spec asks for "Counsel" / "COUNSEL". | Set in `initialize`; CI checks `name() == "Counsel"` through the proxy. Note: web docs/art still say "Company.md Counsel" (other teams' files; `contractURI` metadata is theirs). | `CounselNFTTest.test_defaults` |
| V7-13 | Info | ERC-8004 | Confirmed: `register(string)` selector `0xf2c298be` is what `apps/api/src/pairing.ts` encodes; the proxy mints to `msg.sender`; `agentURI` equals `CounselNFT.tokenURI` with the default base URI; only the owner (ADMIN) can upgrade either proxy; initializers are locked. No change. | — | `AuditERC8004.*`, `AuditCounselNFT.test_tokenUriMatchesApiAgentUri` |
| V7-14 | Info | RewardDistributor / Permit2 flow | Confirmed: the settler is the Permit2 spender and `payTo` is the RevenueRouter; a plain ERC-20 transfer is all the router needs; leaves bind (epoch, tokenId, amount) and roots bind the asset — no cross-epoch / cross-asset replay. No change. | — | `AuditPayments.*` |
| V7-15 | Info | Incorporations | Confirmed: `x·y` never decreases; a full dump of one coin returns at most its own reserve; 1-wei dust sells revert instead of leaking; fees are exact floors; the trader's ETH refund hook cannot re-enter; the owner cannot reach backing with any owner function. No change beyond V7-05. | — | `AuditIncorporations.*` |
| V7-16 | Info | Flywheel | Confirmed: an adapter delivering a different token id, keeping the ETH, or a second sweep of a held id all revert; swept Counsels can only be moved by the owner, who can re-issue them and sweep them again. | — | `AuditFlywheel.*` |
| V7-17 | Info | Create2Deployer / Oracle | Confirmed V1 I-09 (front-running a hook deployment yields the identical contract) and oracle `issuedAt`/domain binding. | — | `AuditMisc.*` |

Changed behaviour an integrator could notice: `Flywheel` constructor signature (7 args), `SeaportAdapter` and
`OracleConsumerExample` constructors take an owner, `CounselNFT` is constructed empty and initialized through the
proxy (apps keep calling the same function names at the `counselNFT` address), launch pairing default.

## 2. Areas checked with no finding

CounselNFT exact-payment (no stranded change), hard cap across all mint paths, allowlist proof forgery, shared
wallet limit, re-entrant mint (I-10), owner setter bounds; ERC-8004 bootstrap atomicity (proxy + `initialize` in one
constructor, `upgradeToAndCall` owner-only during the hand-over); RevenueRouter rounding (dust to treasury, never
more than half there); RewardDistributor M-03 cap, settler bounds, expiry; Incorporations reserve isolation,
slippage and unknown-coin checks on all four paths, swapper approval rotation; ProjectFactory validation, single-sided
seeding math (rounded down, remainder to payer), `take` paths for fees/removal, guard hook `beforeInitialize`
(flags `0x2000`), contributor leaf binding and cap; Flywheel conservation under refunds, hook taxes, bps extremes,
re-entrant adapters/swappers; UniswapV4PoolSwapper PoolManager-only `receive`/`unlockCallback`, slippage, deadline,
re-pointing; oracle EIP-712 digest vs manual encoding, chain binding, expiry.

## 3. Safety-net policy (owner's requirement: all money recoverable, NFT upgradeable with owner approval)

| Contract | Pause (owner/admin) | Recovery | What recovery can never touch without a prior, separate action |
|---|---|---|---|
| CounselNFT (proxy) | phase 0 closes minting | `upgradeToAndCall` (ADMIN), `rescueERC20`, `rescueERC721`, `withdraw()` → treasury | — |
| Flywheel | `buyback`, `sweep` | `rescueETH` (paused), `rescueERC20`, `rescueERC721`, `awardSwept` | — (bucket ETH is the firm's) |
| RevenueRouter | `distribute` | `rescueERC20` (COMD only while paused) | COMD while unpaused |
| RewardDistributor | claims + `postRoot` | `rescueERC20`/`rescueETH` of unallocated; `revokeRoot` | funds committed to a live root (revoke first) |
| Incorporations | `create` + all trades | `rescueERC20`/`rescueETH` surplus; `scheduleEmergencyWithdraw` → 48 h → `emergencyWithdraw` (paused) | backing and launcher ETH (emergency path only, with public countdown; `unpause` refuses while insolvent) |
| ProjectFactory | `launch`, `deployContract` | `rescueERC20`, `rescueETH`, `rescueFromDistributor` | contributor allocations (`reserved`) |
| ContributorDistributor | — (claims never pause: tokens already owed) | via factory, surplus only | `reserved[token]` |
| LaunchGuardHook | — | `rescueERC20` (factory admin) | — |
| UniswapV4PoolSwapper | — (holds nothing) | `sweep(token, to)` | — |
| SeaportAdapter | — (holds nothing) | `rescueETH/ERC20/ERC721` | — |

Hot-key rotation (ADMIN): `RewardDistributor.grantRole/revokeRole(SETTLER_ROLE)`, `ProjectFactory.grantRole/
revokeRole(REGISTRAR_ROLE)`, `Flywheel.setKeeper`, `OracleConsumerExample.setAttester`, plus `setSwapper` on the
Flywheel and Incorporations and `setTreasury` on RevenueRouter / CounselNFT. Tested in `SafetyNets*.t.sol`.

## 4. Follow-ups outside `contracts/` (not edited here)

- **API launch pairing default** (`apps/api/src/engine.ts:341` `pairWith: job.input.pairWith ?? "eth"`, and the
  seeded policy in `apps/api/src/launches.ts` whose `pairedCurrencyAllowlist` contains the zero address): with
  V7-04 an ETH-paired launch reverts `PairedNotAllowed()` on chain. Default `pairWith` should be `"comd"` and the
  policy allowlist `[comd]` unless the deploy ran with `ALLOW_ETH_PAIRING=true`.
- Web docs / art metadata still name the collection "Company.md Counsel" (`apps/web/lib/docs/pages.ts`,
  `packages/art` collection.json); on-chain `name()` is now "Counsel".

## 5. Residual risks

- One internal pass, no external audit. The upgradeable NFT adds a trust assumption: whoever holds ADMIN can replace
  the collection's code — keep ADMIN on a multisig, consider a timelock in front of `upgradeToAndCall`.
- Owner powers are now broader by design (pause, rescue, emergency withdraw). Every one of them is owner-only,
  evented, and (where it could hurt users) two-step: Incorporations' emergency path has a 48 h public countdown and
  `unpause` is blocked while insolvent; RewardDistributor funds under a live root need a `revokeRoot` first;
  RevenueRouter COMD needs a `pause` first. A compromised ADMIN key is still the single point of failure.
- `UniswapV4PoolSwapper` is tested against a hookless local pool; Pons's hook may require another adapter
  (`setSwapper`). Keeper `minOut` discipline (V2-05) still applies.
- `SeaportAdapter` remains an untested skeleton against a real Seaport.
- `block.number` on Robinhood Chain is the parent-chain block; nothing here depends on it any more.
- Invariant campaigns run at 48–64 runs × 40 depth in CI; run longer campaigns before large TVL.

## 6. Test counts

`FOUNDRY_SOLC=$SOLC_PATH FOUNDRY_OFFLINE=true forge test`: **162 tests / 31 suites**, all passing (V6: 95 / 17).
New: `CounselNFTUpgrade.t.sol` (10), `SafetyNets.t.sol` (16), `SafetyNetsLaunch.t.sol` (9), `security/Audit.t.sol`
(29), `Deploy.t.sol` (+3), invariant handlers extended (rescue, launcher claims, owner-rescue attempts).
