---
id: tob-property-based-testing
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
topics: [property-based-testing, fuzzing, echidna, medusa, foundry]
description: Property-based testing guidance in the style of Trail of Bits: choosing, writing, reviewing and debugging properties.
---

# Property-based testing

## Purpose

Property-based testing states what must be true for all inputs and lets a tool search for counterexamples.
For smart contracts it finds the sequences and edge values humans do not think of. This reference covers how to
choose good properties, write them so tools can falsify them, review someone else's properties, and debug
failures. It follows the guidance Trail of Bits publishes on property-based testing with Echidna, Medusa and
Foundry, in the firm's own words.

## How to apply

Test writers: pick properties with the catalogue below, implement them in Foundry (the Clerk runs Foundry; other
fuzzers are optional extras), and record in the test header why each property matters. Reviewers: use the
review checklist to decide whether a property suite actually constrains the code.

## Choosing properties

| Kind | Question it answers | Example |
|---|---|---|
| Invariant | What is always true of the state? | supply equals the sum of balances |
| Postcondition | What must a function guarantee? | after `withdraw(x)`, balance decreased by exactly x |
| Inverse | Does undo restore the state? | `stake` then `unstake` returns the original token balance minus documented fees |
| Idempotence | Does repeating change nothing? | calling `sync()` twice equals calling it once |
| Commutativity | Does order matter when it should not? | two independent deposits in either order give the same shares |
| Metamorphic | How should output change when input changes? | doubling a deposit doubles shares (within rounding) |
| Differential | Does it agree with a reference? | optimised math library vs a straightforward implementation |
| Access | Who must never be able to do something? | non-owner cannot change parameters |

Prefer a few strong properties tied to money and permissions over many weak ones about getters.

## Writing properties that tools can falsify

- Make inputs meaningful: bound them into realistic ranges (`bound`) and include edges (0, 1, max, the
  contract's own limits).
- Use multiple actors and allow realistic attacker actions (donations, transfers, time warps) in handlers.
- Avoid properties that are vacuously true because most calls revert; count successful actions.
- Express tolerances explicitly when rounding is involved (`assertApproxEqAbs(a, b, 1)`) and justify them.
- Keep properties independent of implementation details so a refactor does not need new properties.

## Reviewing a property suite

1. Do properties cover the asset flows and privileged operations, or only easy getters?
2. Would each property fail if the corresponding bug were introduced? Mutate the code mentally (or with a
   mutation tool): remove a check, flip a rounding direction, skip an update. A property that still passes is
   weak.
3. Is the input space reachable? Over-constrained `assume`/`bound` can exclude the bug.
4. Are runs and depth sufficient for the state space? Short sequences miss multi-step exploits.
5. Are failures reproducible (seed recorded, counterexample kept as a unit test)?

## Debugging a failure

- Shrink: Foundry and Echidna minimise the failing sequence; read the shrunk sequence first.
- Replay it as a named unit test with concrete values, then trace (`-vvvv`).
- Decide whether the code or the property is wrong. If the property, fix and document; if the code, keep the
  unit test as a regression test and report a finding.

## Tools

- Foundry: `testFuzz_` for stateless properties, `invariant_` with handlers for stateful ones. Built in, fast,
  what the Clerk runs.
- Echidna and Medusa: coverage-guided stateful fuzzers with corpus management; useful for long campaigns
  (`template: "fuzz"` matters may use them, but deliverables must still include Foundry tests).
- Mutation testing tools help measure property strength.

## Sources and freshness

Written for Company.md in 2026 after Trail of Bits' public property-based testing guidance and the
documentation of Echidna, Medusa and Foundry, rephrased in the firm's words. Tool features change; the property
catalogue and review questions are stable.
