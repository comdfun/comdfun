---
id: write-foundry-tests
version: 1
kind: runnable
origin: parity
role: tests
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: paths
checks: [paths, foundry-build, foundry-test]
outputs: []
references: [eth-testing, tob-property-based-testing, pashov-fizz]
description: Test somebody else's accepted implementation, including the paths its author would rather you did not take.
---

# Write Foundry tests

## Purpose

An independent seat (different wallet from the author) writes the test suite for an implementation that
has already been accepted as compiling. The tests are evidence for the cross-examiner and for whoever
deploys the code. A suite that only exercises the happy path is a failed submission even when it is green.

## Inputs

- `.company/reads/matter.json`: objective, `acceptanceCriteria`, and `paths` (normally `test/**`).
- The implementation in `src/`, read-only for you. Its NatSpec `Invariants:` block is your starting list.
- References: `eth-testing` for Foundry technique, `tob-property-based-testing` for choosing properties.

## Procedure

1. Build an inventory: every external/public function, its access rule, the state it writes, the errors
   it can raise, the events it emits. Keep it as a comment block at the top of the main test file.
2. For each function write a success test that asserts state and events (`vm.expectEmit`), and a test
   per revert condition that asserts the exact custom error selector (`vm.expectRevert(Err.selector)`).
3. Write fuzz tests for anything with arithmetic, bounding inputs with `bound()` rather than discarding
   them with `vm.assume`.
4. If the contract holds value or tracks supply, write a handler-based invariant test: a handler contract
   that calls the target with bounded inputs from several actors, ghost variables for expected totals,
   and `invariant_` functions asserting the `Invariants:` list.
5. Try to break it: reentrancy through token callbacks, zero amounts, max amounts, repeated calls,
   calls from unexpected senders, timestamp edges. Keep each attempt as a test.
6. Run `forge test --offline`. A test that fails because the implementation is wrong stays in the suite,
   marked with a comment `// FINDING:` and reported; do not weaken it to pass.

## Outputs

Test files under the declared `paths` (and test-only helpers such as mocks under `test/`).

## Acceptance checks

1. `paths`: only test files changed; `src/` is untouched.
2. `foundry-build`: the suite compiles offline.
3. `foundry-test`: the suite runs; every test passes except ones marked `// FINDING:` that the step's
   result reports as defects (a red suite without a report is rejected).
4. Every external state-changing function has at least one revert-path test asserting a specific error
   (cross-examiner counts them against the inventory comment).
5. When the contract holds funds, at least one `invariant_` test exists with a handler (cross-examiner).

## Stop and report

Stop when `src/` does not compile, when the implementation's behaviour is ambiguous enough that you cannot
decide what a correct test asserts (quote the ambiguity), or when testing needs a fork of a chain the
matter does not pin to a block.
