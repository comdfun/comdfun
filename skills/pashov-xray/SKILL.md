---
id: pashov-xray
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
topics: [failure-modes, invariants, catalog]
description: A failure-mode catalog and invariant templates for auditing contract projects, organised by mechanism.
---

# Failure-mode catalog and invariant templates

## Purpose

An "x-ray" of where contracts usually break: known failure modes grouped by mechanism, each paired with an
invariant that would catch it. Bench specialists walk the groups relevant to their area; test writers turn the
invariant templates into `invariant_` tests. The idea follows the failure-mode catalogs published by
Pashov Audit Group; the catalog below is written by the firm.

## How to apply

Identify the mechanisms present in the scope (it holds funds, it issues shares, it has rewards, it has
auctions, it trusts an oracle, it uses signatures, it is a hook). For each mechanism, check every failure mode:
not applicable, guarded (cite), or vulnerable (finding). Pick the invariant templates that fit and write them
down as the system's invariants.

## Mechanism: custody of funds

| Failure mode | Look for |
|---|---|
| Double withdrawal | balance zeroed after the transfer; missing `nonReentrant`; replayable claims |
| Stuck funds | no withdraw path when paused or ownerless; transfers to contracts that cannot receive; frozen stablecoin recipient blocks a batch |
| Accounting drift | `balanceOf(this)` used as truth while donations or fee-on-transfer tokens change it |
| Unchecked transfer | ERC-20 return value ignored |

Invariant templates: `sum(userBalances) <= token.balanceOf(vault)`; `totalWithdrawn <= totalDeposited +
realisedYield`; any user with a positive balance can withdraw (liveness, tested by a handler action that must
not revert).

## Mechanism: shares and exchange rates

| Failure mode | Look for |
|---|---|
| First-depositor inflation | shares computed from `balanceOf`; no virtual offset or dead shares |
| Rounding in the user's favour | deposit rounding up shares, withdraw rounding down burned shares |
| Rate manipulation | rate readable mid-transaction by integrators after a donation |

Invariant templates: share price never decreases except via a documented loss; `convertToAssets(totalSupply)
<= totalAssets`; deposit then redeem never returns more than deposited.

## Mechanism: rewards and emissions

| Failure mode | Look for |
|---|---|
| Reward sniping | rewards credited instantly; no streaming; stake-claim-unstake in one block |
| Lost rewards | accrual not updated before balance changes; division producing zero per-token rate |
| Over-distribution | distributions exceeding funded amount; epochs claimable twice |

Invariant templates: `totalClaimed <= totalFunded`; `rewardPerToken` monotone; each (epoch, id) claimed at
most once.

## Mechanism: auctions, sales and bonding curves

| Failure mode | Look for |
|---|---|
| Price manipulation at boundaries | price computed from manipulable state; rounding at tiny sizes |
| Front-running | no minimum output; no deadline |
| Supply overrun | sold amount exceeding reserve; caps checked after transfer |

Invariant templates: `sold <= reserve`; price function monotone in supply; buy then immediate sell never profits.

## Mechanism: oracles and external state

| Failure mode | Look for |
|---|---|
| Stale or zero price | no `updatedAt` check; answer `<= 0` accepted |
| Spot manipulation | `slot0`/reserves used for value decisions |
| Decimal mismatch | feed decimals assumed 18 |

Invariant templates: any value decision uses a price no older than the heartbeat; outcomes stable under
same-block price perturbation (fuzz the pool state before the call).

## Mechanism: authorisation and signatures

| Failure mode | Look for |
|---|---|
| Missing guard | privileged setter without modifier; initialiser callable twice |
| Replay | signature without nonce, deadline, chain id or contract binding |
| Zero-address signer | `ecrecover` result unchecked |

Invariant templates: parameters stay within bounds after any sequence; only role R changes P; each nonce used
once.

## Mechanism: Uniswap v4 hooks

| Failure mode | Look for |
|---|---|
| Callback spoofing | callbacks without `onlyPoolManager` |
| Hostile pools | no key restriction in `beforeInitialize` |
| Delta errors | wrong sign or unit in returned deltas; unsettled deltas |
| Hook DoS | unbounded work in `afterSwap` |

Invariant templates: hook-held balances equal internal accounting; swaps in hook pools never deliver more
than quoted; pools created by others cannot change hook state of the canonical pool.

## Mechanism: lifecycle and state machines

| Failure mode | Look for |
|---|---|
| Out-of-order calls | claim before start, finalize twice, cancel after settle |
| Time edges | `>` vs `>=` at deadlines; `block.number` on Arbitrum chains used as L2 height |

Invariant templates: state only advances along the allowed graph; terminal states are absorbing.

## Sources and freshness

Written for Company.md in 2026 after the structure of publicly shared failure-mode catalogs (Pashov Audit
Group's x-ray approach) and public post-mortems; all entries and wording are the firm's. Extend the catalog
whenever a Bench ruling finds a mode not listed here.
