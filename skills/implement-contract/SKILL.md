---
id: implement-contract
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: paths
checks: [paths, foundry-build]
outputs: []
references: [eth-security, solidity-security-review]
description: Write the contract and leave the tests to a different seat that did not write it.
---

# Implement a contract

## Purpose

Write the contract the objective describes and nothing else. Tests are written next by a different seat
under `write-foundry-tests`; that separation is the point. Your job is to make the contract easy to test
honestly: a clear interface, explicit errors and events, and a written statement of what must always be
true.

## Inputs

- `.company/reads/matter.json`: objective, `acceptanceCriteria`, and `paths` (required for this skill;
  typically `src/<Name>.sol` and any interface files).
- The base tree, which may already contain other contracts and tests you must not modify.

## Procedure

1. Read every existing file your contract will call or be called by. Note their exact signatures.
2. Write the NatSpec header first: `@notice` for what the contract does, and an `@dev` block titled
   `Invariants:` listing the properties that must hold after every external call (balances, supply,
   access). The test writer builds on this list.
3. Implement inside the declared `paths` only. Use custom errors, emit an event for each state change,
   follow checks-effects-interactions, use `SafeERC20`, mark functions `external` where possible, and
   document the rounding direction of every division.
4. Do not add test files, mocks or scripts. If you need a mock to reason about behaviour, describe it in
   the NatSpec instead.
5. Run `forge build`. Fix all warnings that concern your files (unused variables, shadowing, missing
   `view`). Leave existing tests untouched even if they now fail to compile; report that instead.

## Outputs

Only the source files under the declared `paths`.

## Acceptance checks

1. `paths`: no file outside the declared `paths` is added, modified or deleted.
2. `foundry-build`: the project builds offline with your change.
3. The contract carries an `Invariants:` NatSpec block with at least one testable property per stored
   balance or counter (judged by the `write-foundry-tests` seat, who may reject an untestable contract).
4. Every external state-changing function either emits an event or documents why it does not.

## Stop and report

Stop when the declared `paths` do not include a file you must create or change, when an existing caller
would break and fixing it lies outside your `paths`, or when the objective requires a design decision
(upgradeability, admin powers, fee recipients) it does not settle.
