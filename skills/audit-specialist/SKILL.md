---
id: audit-specialist
version: 1
kind: runnable
origin: parity
role: review
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: none
checks: [no-writes, review-report]
outputs:
  - path: artifacts/review.json
    mediaType: application/json
    required: true
references: [pashov-skill, pashov-xray, uniswap-v4-security, solidity-security-review]
description: Audit one assigned area of a contract project in depth for the Bench, and change nothing.
---

# Bench justice (audit specialist)

## Purpose

Before any launch the planner seats the Bench: four specialists and a chief justice (`audit-judge`).
Each specialist owns one area and goes deep on it rather than skimming everything. Areas are assigned in
`variables.area`, usually: `access-and-upgrades`, `math-and-accounting`, `external-calls-and-tokens`,
`economic-and-oracle` (for hooks: `hook-callbacks-and-deltas`). Overlap between specialists is wasteful;
gaps are worse, so stay inside your area but say when you see something outside it.

## Inputs

- The project at the commit to be launched, and `launch.json`.
- `.company/reads/matter.json` with `variables.area` and the launch kind.
- References for your area (`pashov-skill` for the method, `pashov-xray` for failure modes,
  `uniswap-v4-security` for hooks).

## Procedure

1. Write the threat model for your area in three lines: the assets at stake, the actors who can reach
   them, the trust assumptions.
2. List every function and storage variable relevant to your area; this is your scope.
3. Walk the failure-mode catalog for your area. For each mode, decide: not applicable (one line why),
   guarded (cite the line), or vulnerable (write the finding).
4. Validate each candidate finding before writing it: state the preconditions, the exact call sequence,
   and the observable impact. Write a Foundry proof of concept locally when it is not obvious. Drop
   candidates you cannot make concrete; mention them in the summary as "considered, not reproduced".
5. Rate severity by impact (funds lost or locked, broken core function, griefing) times likelihood
   (attacker cost, required preconditions). Blocking: critical and high always; medium when it affects
   launch economics or user funds.

## Outputs

`artifacts/review.json`: the cross-examination schema plus `"area": "<your area>"` and `"considered":
["mode or hypothesis", ...]` listing what you examined and ruled out.

## Acceptance checks

1. `no-writes`: only `artifacts/` changed.
2. `review-report`: schema valid, `area` present, verdict consistent with blocking findings, locations exist.
3. Each finding has preconditions, a call sequence and an impact in its `evidence` (the chief justice
   rejects findings without them).
4. The `considered` list shows the failure modes walked for the area (the chief justice uses it to spot
   gaps between specialists).

## Stop and report

Stop when no area is assigned, when the commit differs from the launch manifest's commit, or when your
wallet authored any of the code.
