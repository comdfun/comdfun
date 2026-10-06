---
id: implement-and-test
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: paths
checks: [paths, foundry-build, foundry-test]
outputs: []
references: [eth-security, eth-testing]
description: One seat writes a small contract change and its tests, for work too small to need a second pair of hands.
---

# Implement and test

## Purpose

For small, well-bounded changes (a new view, a parameter, a guard, a bug fix with a known cause) one seat
writes both the change and its tests. The trade-off is clear: no independent tester, so the tests must be
pointed enough that a reviewer can trust them at a glance. Use the larger skills for new contracts.

## Inputs

- `.company/reads/matter.json`: objective, `acceptanceCriteria`, and `paths` covering both the source and
  the test files you may touch.
- The base tree with its existing suite, which must stay green.

## Procedure

1. Run `forge test --offline` on the base and note the count of passing tests.
2. Write the failing test first: one test that demonstrates the requested behaviour (or reproduces the
   bug) and fails on the base. Keep it in the declared test file.
3. Make the smallest source change in the declared `paths` that turns the test green.
4. Add the edges: a revert-path test asserting the exact custom error, a fuzz test if arithmetic is
   involved, and an event assertion if the change emits one.
5. Run the whole suite. The passing count must be at least the base count plus your new tests; no test
   may be deleted, renamed away or marked `skip`.

## Outputs

The source change and its tests, all inside the declared `paths`.

## Acceptance checks

1. `paths`: only declared files changed.
2. `foundry-build`: builds offline.
3. `foundry-test`: the full suite passes and contains at least one test that fails when your source
   change is reverted (the cross-examiner checks this by reverting the source hunk).
4. No pre-existing test was removed or weakened (diff of `test/` shows additions only, except where the
   matter explicitly changes behaviour).

## Stop and report

Stop when the change turns out to need more than the declared files, when the existing suite is already
red on the base, or when the requested behaviour contradicts an existing test that encodes a deliberate
rule. Quote the test.
