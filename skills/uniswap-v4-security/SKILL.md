---
id: uniswap-v4-security
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
topics: [uniswap-v4, hooks, security, audit]
description: Security-first Uniswap v4 hook development: the attack surface of callbacks, deltas, pool keys and hook state.
---

# Uniswap v4 hook security

## Purpose

Hooks run inside every swap and liquidity change of their pools, with the PoolManager's tokens in play. A
hook bug can drain users, LPs or the hook itself, or brick the pool. This reference lists the failure modes
the firm checks on every `univ4_hook` launch and on its own pool (ComdTaxHook and BuyWall), with the guard for
each.

## How to apply

Implementers: satisfy every "guard" line, and write a test for each one that applies. Bench specialists
assigned `hook-callbacks-and-deltas`: walk the list as your failure-mode catalog and record each item as not
applicable, guarded (cite the line) or vulnerable.

## Caller and context

- Callbacks must only be callable by the PoolManager. Guard: `onlyPoolManager` (BaseHook provides it). A
  callable `afterSwap` lets anyone fake swaps.
- `sender` is the router or contract that called the manager, not the user; `tx.origin` is not a user identity
  either. Guard: never authorise or attribute rewards by `sender` unless the router is allowlisted and passes
  the user explicitly (for example in `hookData` signed by the user).
- `hookData` is attacker-controlled. Guard: validate and bound it; never decode addresses from it and send
  them funds without authorisation.

## Pool keys and initialisation

- Anyone can create a pool with your hook and arbitrary tokens. Guard: in `beforeInitialize`, restrict to the
  expected currencies, fee and tick spacing, or to initialisation by the factory.
- Per-pool state must be keyed by `PoolId`. Guard: no global variables that one pool's activity can corrupt
  for another.
- Fake tokens in a hostile pool can reenter your hook through transfer callbacks. Guard: hooks that transfer
  tokens only deal with allowlisted currencies.

## Deltas and settlement

- Return-delta hooks move value: a wrong sign or unit gives tokens away. Guard: unit tests asserting exact
  balances of user, pool and hook for each direction (exact in/out, zeroForOne true/false).
- Every delta the hook creates must be settled within the same unlock. Guard: sync-transfer-settle for
  ERC-20, `settle{value}` for ETH, and `take` only what the hook is owed.
- NoOp or custom-curve hooks can make swaps return nothing; that is a rug vector if logic can change.
  Disclose and, ideally, make the hook immutable.
- Rounding in hook-side fee or trim calculations must favour the pool and never underflow when amounts are tiny.

## Liquidity and price manipulation

- Logic that reads the pool's current price (slot0) during a swap can be manipulated within the same
  transaction. Guard: use a block-lagged reference or a TWAP; bound actions per block. ComdTaxHook keeps a
  reference tick that moves at most a fixed number of ticks per block toward earlier blocks' closing ticks, and
  the BuyWall derives its floor from it.
- Post-swap liquidity changes (inventory trims): removing liquidity in `afterSwap` must not alter the swapper's
  delta or the price the swap already reached. Guard: compute the excess from the position's state after the
  swap, remove only that fraction, settle the removed tokens to the hook, and test that quotes are identical with
  and without a trim.
- Protocol bids (buy walls): a standing bid can be filled by a seller who first pushes the price down, or its floor
  dragged by a pumped reference. Guard: bound floor movement per day in both directions (the BuyWall moves at most
  one day's allowance per update, review H-01), post only above a gap from the reference, and route what the wall
  buys through the same split as trims.
- Initialization windows: a pool initialized in one transaction and seeded in another can be swapped against
  at a bad price in between. Guard: initialize and add the first liquidity atomically, or revert swaps until
  seeded (ComdTaxHook's `initializeAndSeed` does both in one transaction, POL wallet only).
- Just-in-time liquidity and sandwiching around hook or keeper actions (taxes, trims, buybacks, rebalances).
  Guard: make keeper actions permissionless only when profitable manipulation is bounded; cap keeper tips (the
  BuyWall tips at most 1% of the ETH handled and at most 0.002 ETH); give keeper swaps a simulated `minOut` (the
  Flywheel's `buyback(minOut)` is keeper-only with a slippage bound).
- Third-party liquidity in a protocol pool can capture fees or trims meant for the protocol. Guard: refuse it in
  `beforeAddLiquidity` except from the hook itself and its allowlisted helper (ComdTaxHook admits only the
  BuyWall).
- Tax or fee exemptions keyed on `hookData` can be claimed by anyone who sets it. Guard: honour an exemption
  only from a known router that attests its caller (ComdTaxHook exempts only the Flywheel via ComdRouter).
- Donations (`donate`) change fee growth: hooks that read fee growth must tolerate it.

## Gas and liveness

- A reverting or gas-heavy hook blocks all swaps in its pools. Guard: no unbounded loops in callbacks; external
  calls in callbacks wrapped or avoided (ComdTaxHook falls back to holding the tax as ERC-6909 claims and
  forwards it with a permissionless `flush()`); any escape hatch must not itself be usable to seize funds.
- Hooks holding inventory must let LP positions and users exit even when hook logic is paused.

## Admin powers and upgrades

- Owner-settable parameters (caps, fees, splits) need bounds enforced on chain, events, and ideally a delay.
  ComdTaxHook bounds its tax (≤ 5%), cap floor and decay, and the trim split (burn ≥ 50%, other legs ≤ 25% each).
- Locked liquidity has no escape hatch: if the position can never be withdrawn, no bug can be remedied by moving
  it. Disclose this; it is the price of a rug-proof pool.
- Upgradeable hooks can change behaviour behind fixed permissions: avoid, or disclose with a timelock.
- Renounce ownership when parameters are final; make sure renouncing does not break keepers.

## Native ETH and accounting

- ETH is `currency0 = address(0)`. Hooks receiving ETH need `receive()` and must not count `msg.value` twice.
- Accounting that uses `balanceOf(this)` can be inflated by direct transfers; keep internal accounting.

## Test checklist

- Direct calls to each callback from a non-manager address revert.
- A second pool with unexpected tokens cannot be initialised (or cannot affect the first).
- Exact in/out, both directions, ETH and ERC-20: user, pool and hook balances exactly as specified.
- Max and min amounts, zero liquidity, price at limits; gas per swap within budget.
- Invariant: hook-held balances equal its internal accounting; totals conserved across handler actions.

## Sources and freshness

Written for Company.md in 2026 from Uniswap v4 core and periphery sources, Uniswap's hook security guidance,
and public audit reports of v4 hooks, rewritten for the firm's hooks. New hook patterns appear regularly;
revisit the list when v4-periphery releases change BaseHook or delta handling.
