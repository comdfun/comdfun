---
id: eth-concepts
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
topics: [mental-models, incentives, design]
description: Mental models for onchain systems: who calls each state transition, who pays for it, and why they would.
---

# Onchain mental models

## Purpose

Design mistakes in smart contract systems usually come from forgetting how a blockchain actually runs:
nothing happens unless someone sends a transaction and pays for it, everything is public before it lands,
and every function is callable by anyone in any order. This reference collects the models the firm uses when
planning, building or reviewing a system.

## How to apply

When designing or reviewing, go through each model and write one sentence about how the system satisfies it.
Planners use it to spot missing keepers or incentives before splitting work into steps; reviewers use it to
find liveness and economic findings that a line-by-line read misses.

## Nothing happens by itself

There is no cron on chain. Every state change is a transaction someone chose to send and pay gas for. For each
transition in the system, name the caller:

| Transition | Who calls it | Why would they |
|---|---|---|
| Deposit, withdraw, claim | the user | they want the outcome |
| Liquidation, rebalance, distribution, epoch roll | a keeper or anyone | a fee, a bounty, or the protocol pays them |
| Oracle update | the oracle operator | contract with the protocol |
| Parameter change | governance or owner | stewardship; may be slow |

If the "why" column is empty, that transition will not happen reliably. Time-based logic must be written as
"when someone next calls, catch up" (lazy accrual), not "at time T this happens".

## Everything is public and ordered by someone else

- Pending transactions can be seen and reordered. Any action whose value depends on the state just before it
  (swaps, liquidations, first deposits, auctions) needs slippage limits, deadlines or commit-reveal.
- On Robinhood Chain and most rollups a single sequencer orders transactions; it is first-come-first-served in
  normal operation, but users still cannot assume they land before anyone else.
- There are no secrets in contract storage. `private` only hides from other contracts.

## Every function, any caller, any order

- Assume calls arrive from contracts as well as wallets, in any order, repeated, with extreme values, and inside
  a single transaction together with flash-loaned capital.
- Atomicity cuts both ways: an attacker can borrow, manipulate, profit and repay in one transaction, and your
  own multi-step operations either all succeed or all revert.

## State, events and indexers

- State is the truth contracts can read; events are the cheap history that frontends and indexers read.
  Emit an event for every change a client must follow, with the values a client needs.
- A frontend or indexer must be rebuildable from chain data alone. If it cannot, information is being kept
  somewhere off chain and that is a trust assumption to disclose.

## Custody and approvals

- Approvals are standing permissions. Unlimited approvals to an upgradeable or hookable contract are standing
  risk for the user; exact approvals or Permit2 signatures with deadlines limit it.
- Whoever holds funds holds responsibility: a contract that pools user funds needs a withdraw path that works
  even when the owner is gone.

## Finality and reorganisations

- On an optimistic rollup a transaction is soft-confirmed by the sequencer in seconds, posted to Ethereum later,
  and final against fraud proofs after the challenge window (about a week for withdrawals to L1). Treat
  sequencer confirmation as final for UX, but design cross-chain flows for the challenge window.
- Indexers and oracles should read at a block number and tolerate short reorgs.

## Upgrades and promises

- An owner who can change code or parameters can change any promise the code makes. Disclose every power, add
  timelocks where users need time to exit, and prefer renounceable designs.

## Sources and freshness

Written for Company.md in 2026 from general Ethereum and rollup design practice (the Ethereum yellow paper's
execution model, rollup documentation for Arbitrum and the OP Stack, and public incident analyses). The
models are stable; specific numbers such as challenge windows are chain parameters and must be re-checked
for the chain in question.
