---
id: audit-imported-code
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
references: [solidity-security-review, pashov-skill, tob-entry-point-analyzer, eth-security]
description: Audit a requester's contracts as they arrived, before they are adapted for launch, and change nothing.
---

# Audit imported code

## Purpose

When a requester brings their own repository to launch, this step reads it as delivered, before
`adapt-contract-project` touches it, so the record shows which risks came in with the code and which were
introduced by the firm. It produces the same report format as a cross-examination, aimed at a whole
codebase rather than a diff.

## Inputs

- The requester's repository at `repoUrl` and `baseCommit` (pinned in `.company/reads/matter.json`).
- The launch kind the requester asked for, so launch-blocking patterns can be called out.

## Procedure

1. Inventory the codebase: contracts, inheritance, external dependencies with versions, compiler version,
   test suite size. Build and run the suite; record the result in the summary.
2. Produce an entry-point table (see `tob-entry-point-analyzer`): every external state-changing function,
   who may call it, what it moves.
3. Review by area: privileged powers (mint, pause, blocklist, upgrade, fee changes, withdraw-all),
   arithmetic, reentrancy, token integration, oracle use, signatures, denial of service.
4. Call out launch blockers explicitly as blocking findings: post-deployment minting, upgradeability,
   owner control over balances or transfers, fee-on-transfer or rebasing behaviour, hard-coded addresses
   for another chain, dependencies on contracts absent from Robinhood Chain.
5. Write findings with reproducible evidence and a verdict: `reject` when any blocker or high-severity
   issue exists, otherwise `accept`.

## Outputs

`artifacts/review.json` in the cross-examination schema (`verdict`, `summary`, `findings[]` with `id`,
`severity`, `title`, `location`, `blocking`, `evidence`, `recommendation`). Add `"scope"` with the list of
files read and `"suite"` with the observed test result.

## Acceptance checks

1. `no-writes`: the imported tree is untouched; only `artifacts/` changed.
2. `review-report`: the report follows the schema, the verdict agrees with the blocking findings, and every
   location exists in the imported tree.
3. Every launch blocker named in step 4 that is present in the code appears as a blocking finding
   (the audit panel and the Registrar's admission checks rely on it).
4. The `scope` list covers every `.sol` file under `src/` (Managing Partner compares with the tree).

## Stop and report

Stop when the repository or commit cannot be fetched, when it is not a Foundry project and cannot be
built with Foundry, or when it is larger than the matter's scope allows; report the size and stop.
