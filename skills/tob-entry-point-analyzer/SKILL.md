---
id: tob-entry-point-analyzer
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
topics: [entry-points, access-control, attack-surface]
description: Entry-point analysis in the style of Trail of Bits: every state-changing entry point, who may call it, and what it moves.
---

# Entry-point analysis

## Purpose

Before judging any line of code, list every way state can change from outside: each external or public
non-view function (and fallback/receive), who is allowed to call it, which state it writes, and which value it
moves. The table becomes the map for reviewers and the checklist for access-control tests. The technique
follows the entry-point analysis Trail of Bits describes in its public tooling and guidance; the procedure
below is the firm's own.

## How to apply

Produce the table at the start of any review (`adversarial-review`, `audit-imported-code`, Bench), and attach
it to the report's summary or evidence when it supports a finding. Test writers use the "Who" column to write
one unauthorised-caller test per restricted entry point.

## Procedure

1. Enumerate contracts in scope, including inherited ones; entry points from parents count (for example
   `transferOwnership` from `Ownable`, `upgradeToAndCall` from UUPS).
2. For each contract list every `external`/`public` function that is not `view`/`pure`, plus `receive`,
   `fallback`, and callbacks the contract implements (`onERC721Received`, `unlockCallback`, hook callbacks,
   flash-loan callbacks).
3. Classify the caller restriction:
   - **Public**: anyone.
   - **Role-gated**: owner, named role, allowlist (name the modifier or check).
   - **Contract-gated**: only a specific contract (PoolManager, factory, token).
   - **Self/conditional**: only the beneficiary of a position, only with a valid signature, only in a state.
4. Record writes: storage variables changed, tokens or ETH moved (in or out, to whom), external calls made.
5. Flag anomalies: public functions that write privileged state; role-gated functions that can move user
   funds; callbacks without caller checks; entry points reachable in states where they should not be.

## Table format

| Contract | Entry point | Who | Writes | Moves value | External calls | Notes |
|---|---|---|---|---|---|---|
| Vault | `deposit(uint256,address)` | public | balances, totalShares | asset in from caller | asset.transferFrom | rounding down |
| Vault | `setFee(uint256)` | owner | feeBps | none | none | bounded ≤ 1000 |
| Vault | `sweep(address)` | owner | none | any token out | token.transfer | can it take user assets? |
| Hook | `afterSwap(...)` | PoolManager only | inventory | burn and splits | manager.take | `onlyPoolManager` present |

## What to look for in the finished table

- Every row with "moves value" and "public": is the amount bounded by the caller's own entitlement?
- Every role-gated row: what is the worst outcome if the role holder is malicious or compromised, and can users
  exit first? This becomes the "Roles and powers" section of the README.
- Rows whose restriction relies on `tx.origin`, on `msg.sender.code.length == 0`, or on `sender` passed by a
  router: these are weak since EIP-7702 and in v4 hooks.
- Entry points missing from tests: each restricted row should have a test proving an unauthorised caller
  reverts.

## Automation

Static analysers (Slither's function summary and `entry-points` printers, or a compiler AST walk) produce a
first draft of the table. Always check it by reading: modifiers with internal conditions, inherited overrides
and assembly can hide restrictions or remove them.

## Sources and freshness

Written for Company.md in 2026 after Trail of Bits' publicly documented entry-point analysis and
access-control review practice (their skills repository and Slither printers), described in the firm's
words. Tool names and printer flags change with releases; the manual procedure above does not.
