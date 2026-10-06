---
id: eth-testing
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
topics: [foundry, testing, fuzzing, invariants]
description: Foundry testing practice covering failure-path unit tests, fuzzing, fork tests and invariant suites.
---

# Foundry testing guide

## Purpose

How the firm expects Foundry tests to be written: what to test, how to structure suites so failures are
readable, and which Foundry features to reach for. Attached to implementation and test steps; the Clerk runs
`forge test` offline, so tests must not depend on the network unless the matter pins a fork.

## How to apply

Use the layout and naming conventions as written. Before submitting, compare your suite against the
"minimum suite" list. When you are writing an invariant suite, read `tob-property-based-testing` and
`pashov-fizz` for choosing properties; this file covers the mechanics.

## Layout and naming

- `test/<Contract>.t.sol` per contract; shared setup in `test/utils/` (base test contract, helpers).
- `test_<Function>_<Condition>` for unit tests, `test_RevertWhen_<Condition>` for failure paths,
  `testFuzz_<Property>` for fuzz tests, `invariant_<Property>` for invariants, `testFork_<Scenario>` for
  fork tests. Names describe behaviour, not implementation.
- One behaviour per test. A test that asserts five unrelated things fails for unclear reasons.

## The minimum suite

1. Every external state-changing function: one success test asserting resulting state and emitted events.
2. Every `revert`/custom error: one test that triggers it and asserts the exact error with
   `vm.expectRevert(Contract.ErrorName.selector)` or the full encoded error with arguments.
3. Access control: each privileged function called by an unprivileged address reverts.
4. Arithmetic: fuzz tests over the full input range with `bound(x, min, max)`; prefer `bound` to
   `vm.assume`, which discards runs and can starve the fuzzer.
5. Value-holding contracts: an invariant suite (below).

## Cheatcodes worth knowing

- Identity and time: `vm.prank(addr)`, `vm.startPrank`, `vm.warp(ts)`, `vm.roll(block)`, `makeAddr("alice")`.
- Balances: `deal(token, to, amount)` (and `deal(to, ethAmount)`), `vm.deal`.
- Expectations: `vm.expectRevert`, `vm.expectEmit(true, true, false, true)` followed by the expected
  `emit`, `vm.expectCall(target, data)`.
- Environment: `vm.setEnv`, `vm.envOr` (for testing deploy scripts), `vm.snapshotState`/`vm.revertToState`.
- Labels for readable traces: `vm.label(addr, "Vault")`.
Cheatcode names have changed across Foundry versions (for example snapshot helpers); check `forge --version`
and the Foundry book for the pinned version.

## Fuzzing

- Configure runs in `foundry.toml` (`[fuzz] runs = 256` by default; raise for arithmetic-heavy code) and pin
  a `seed` when reproducing a failure.
- Fuzz the relationship, not the value: round-trip (`deposit` then `redeem` returns at most the deposit),
  monotonicity, bounds, equivalence with a simple reference implementation.
- When the fuzzer finds a counterexample, turn it into a named unit test before fixing.

## Invariant testing

- Target a handler contract, not the system directly: `targetContract(address(handler))`. The handler exposes
  bounded actions (`deposit(uint256 actorSeed, uint256 amount)`) that pick an actor, bound the amount, prank,
  and call the system. This keeps runs meaningful instead of reverting constantly.
- Track ghost variables in the handler (total deposited, total withdrawn, per-actor sums) and assert
  relationships in `invariant_` functions: conservation, solvency, monotone share price.
- Configure `[invariant] runs`, `depth`, and decide `fail_on_revert`: true with a good handler finds
  unexpected reverts; false tolerates them while exploring.
- Add a `invariant_callSummary` style function that logs how often each handler action ran, so you can see
  whether the fuzzer actually exercised the system.

## Fork tests

- Pin the block: `vm.createSelectFork(vm.rpcUrl("robinhood"), blockNumber)` with RPC aliases in
  `foundry.toml` `[rpc_endpoints]`. Unpinned forks make results unreproducible.
- Keep fork tests in their own files and skip them when the RPC env var is absent, so the Clerk's offline run
  stays green while CI with network can run them.

## Coverage and gas

- `forge coverage --report summary` shows lines never executed; uncovered revert branches are usually the
  missing failure-path tests.
- `forge test --gas-report` and `forge snapshot` for regressions; do not optimise gas in a way that removes
  checks.

## Sources and freshness

Written for Company.md in 2026 from the Foundry book and Foundry 1.x behaviour (the Clerk runs forge 1.x),
plus common practice in public audit-ready repositories. Cheatcode names and config keys change between
Foundry releases: confirm against the installed version before relying on an exact name.
