---
id: defi-native
version: 1
kind: reference
origin: parity
role: reference
inference: none
tier: none
judge: none
requires: []
writes: none
checks: []
outputs: []
topics: [vaults, erc-4626, lending, stablecoins, oracles, rwa, liquidity]
description: DeFi foundations for vaults and ERC-4626, yield, lending, stablecoins, oracles, real-world assets and liquidity risk.
---

# DeFi foundations

## Purpose

Background a seat needs to build, review or research capital-markets contracts: how vaults account for
shares, where yield comes from, how lending markets stay solvent, how stablecoins hold their peg, how oracles
fail, and how liquidity disappears. Company.md's own pool uses several of these patterns: a swap tax funding
buybacks and NFT floor sweeps, a capped inventory whose trims are burned or streamed to an ERC-4626 vault (sCOMD),
a protocol buy wall, and a fixed-price bond.

## How to apply

Read the section for the mechanism in the matter before designing it, and the "failure modes" lines before
reviewing it. Research reports should use the vocabulary here precisely (for example "utilisation",
"health factor") and cite primary sources for any numbers.

## Vaults and ERC-4626

- A vault holds `asset` and issues shares. `totalAssets()` is what the vault owns or is owed;
  share price = `totalAssets / totalSupply`.
- Functions: `deposit(assets)` and `mint(shares)` in, `withdraw(assets)` and `redeem(shares)` out; `preview*`
  return exact amounts including fees; `convertTo*` are fee-free estimates; `max*` report limits and must
  return 0 when an action would revert.
- Rounding favours the vault: `deposit`/`previewDeposit` and `redeem`/`previewRedeem` round down what the
  user receives; `mint`/`previewMint` and `withdraw`/`previewWithdraw` round up what the user pays.
- Inflation (donation) attack: the first depositor mints 1 share, donates assets directly, and later depositors'
  shares round to zero. Mitigations: virtual shares and assets (OpenZeppelin's `_decimalsOffset`), seeding the
  vault with dead shares at deployment, or tracking assets internally instead of `balanceOf`.
- Rewards streamed into a vault should be released linearly so that depositing just before a reward and
  withdrawing just after captures nothing. Company.md's `RewardDripper` streams COMD into sCOMD at
  `min(streamCapPerDay, balance / 30 days)`, catches up at most one hour, and streams nothing into an empty vault
  (otherwise the first depositor takes everything that accrued). Its `StakedComd` also holds freshly minted shares
  for the current block, so deposit-drip-redeem in one block captures nothing.
- Rewards paid by snapshot instead (as Company.md pays Counsel seats by accepted work per epoch, Merkle roots in
  `RewardDistributor`) avoid the timing game entirely, at the cost of a claim transaction.

## Where yield comes from

Every yield is someone paying: borrowers (lending interest), traders (swap fees), token issuers (emissions),
protocols (revenue share), or risk taken (liquidation, depeg, smart-contract risk). If a product cannot name
the payer, the yield is emissions or it is not sustainable. Quote yields with their source and period, never
as a promise.

## Lending markets

- Over-collateralised borrowing: each collateral has a loan-to-value (max borrow) and a liquidation threshold
  (when liquidation becomes possible); health factor = collateral value × threshold / debt.
- Interest-rate models are usually kinked in utilisation (borrowed / supplied): gentle below an optimal
  utilisation, steep above it so lenders can always exit.
- Liquidations pay a bonus to keepers; they need liquid markets and fresh prices. Bad debt appears when
  collateral falls faster than liquidators act.
- Failure modes: oracle manipulation of thin collateral, correlated collateral, liquidation cascades, rounding
  that lets dust positions avoid liquidation, interest accrual skipped when nobody calls.

## Stablecoins

| Type | Example | Peg mechanism | Main risks |
|---|---|---|---|
| Fiat-backed, issuer-redeemable | USDC, USDT | 1:1 reserves, redemption by the issuer | issuer freeze and pause powers, reserve quality, banking risk |
| Crypto-collateralised | DAI/USDS | over-collateralised vaults and liquidations | collateral crashes, governance |
| Synthetic / delta-neutral | various | hedged positions | funding rates, venue risk |
| Algorithmic | historical examples | reflexive mint/burn | death spirals |

Contracts handling issuer stablecoins must tolerate a frozen address and a paused token.

## Oracles

- Push feeds (Chainlink-style): read `latestRoundData`, check `answer > 0`, `updatedAt` within the heartbeat,
  and on L2s the sequencer uptime feed with a grace period after restarts.
- TWAPs from AMMs: resist single-block manipulation but lag, and thin pools can be moved over many blocks.
- Never use spot reserves or `slot0` for anything an attacker profits from in the same transaction.

## Real-world assets

Tokenised treasuries, stocks or credit carry off-chain legal claims: transfer restrictions (allowlists),
NAV published by an administrator, redemption windows and settlement delays, and issuer powers to freeze or
claw back. Model them as permissioned, slow-to-redeem assets, not as free-floating ERC-20s.

## Liquidity risk

- Depth and slippage: price impact grows with size relative to pool liquidity; quote with a minimum output.
- Runs: when exits are first-come-first-served and assets are illiquid, rational users rush; withdrawal
  queues, redemption fees or epochs slow runs but must be disclosed.
- Protocol-owned liquidity (as in Company.md's COMD/ETH pool, seeded with 100% of supply and locked forever)
  cannot be pulled by mercenary LPs, but the protocol bears the impermanent loss and the price has no outside depth.
- Capped inventory: when the pool position holds more of the token than a cap, the excess is removed after the
  swap (the swapper's quote is unchanged) and routed elsewhere (Company.md: 85% burned, 6% to the bond, 4.5% to
  stakers, 4.5% to seats). The cap only ratchets down, by a bounded amount per day, so trims are slow by design.
- A protocol buy wall (a standing single-sided bid below the price, funded by ETH freed by trims) supports the
  price only if its floor cannot be dragged: bound how far the floor moves per day and derive it from a lagged
  reference, not the current tick.
- Fixed-price bonds sell a reserve at an owner-set price; the price is a governance decision with no market check,
  so its setter must be trusted or time-locked.
- Swap taxes collected by a hook are a revenue source paid by traders; they reduce volume and must be
  disclosed in every quote (quotes net of tax).

## Sources and freshness

Written for Company.md in 2026 from the ERC-4626 specification, OpenZeppelin's vault documentation and
inflation-attack analysis, public documentation of major lending markets and stablecoin issuers (Paxos,
Circle, Sky/Maker), and Chainlink feed documentation. Market parameters and issuer policies change; cite
current primary sources for any figure used in a deliverable.
