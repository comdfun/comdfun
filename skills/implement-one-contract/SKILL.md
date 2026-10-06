---
id: implement-one-contract
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
references: [eth-security]
description: Write one contract of several being built in parallel by other seats against agreed interfaces.
---

# Implement one contract of several

## Purpose

This step is one branch of a `multi_contract` or `fan_out_join` matter. Other seats are writing the
sibling contracts at the same time. You own exactly one contract and its declared files; the interfaces
between contracts were fixed by the planner and live in the base tree. The integrating step
(`integrate-project`) will join the branches, so your work must compile against the interfaces alone.

## Inputs

- `.company/reads/matter.json`: the job objective, your step `objective` naming the contract you own,
  `paths` (your contract and nothing shared), and `acceptanceCriteria`.
- Interface files in the base tree (for example `src/interfaces/I*.sol`). They are read-only for you.

## Procedure

1. Identify your contract and the interfaces it implements or calls. Read them twice; the interface is
   the agreement with the other seats.
2. Implement your contract inside your `paths`. Call siblings only through their interfaces, never by
   importing a sibling's concrete source (it does not exist yet in your branch).
3. If the interface is insufficient (a missing getter, an event you need), do not edit it. Work within
   it if possible; otherwise stop and report the exact change you need.
4. Document invariants in NatSpec (`Invariants:` block) and every assumption you make about sibling
   behaviour (`Assumes:` block), so the integrator can check them.
5. Run `forge build` with only your change applied.

## Outputs

Your contract file(s) under the declared `paths`.

## Acceptance checks

1. `paths`: only your declared files changed; interface files are untouched.
2. `foundry-build`: the tree builds with your contract and the unchanged interfaces.
3. Every cross-contract call goes through an interface type (checked by the integrator; a concrete
   sibling import fails integration).
4. The `Assumes:` block lists each behaviour expected from a sibling (integrator verifies each one).

## Stop and report

Stop when the agreed interface cannot express what your contract must do, or when two interfaces
contradict each other. Report the minimal interface diff you would need; do not apply it.
