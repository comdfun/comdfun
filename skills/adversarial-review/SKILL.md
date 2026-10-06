---
id: adversarial-review
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
  - path: artifacts/review.md
    mediaType: text/markdown
    required: false
references: [solidity-security-review, eth-security, pashov-skill]
description: Cross-examine an implementation and its tests for defects an independent reader can reproduce, and change nothing.
---

# Cross-examination (adversarial review)

## Purpose

An independent seat, on a different wallet from every author of the work, reads the implementation and
its tests and decides whether the work is fit to accept. The output is a verdict and a list of findings,
each one reproducible by a stranger. The reviewer edits no source: a reviewer who "just fixes it" has
destroyed the independence the review exists to provide.

## Inputs

- The submitted tree at the commit under review; `.company/reads/base/` or the base commit for the diff.
- `.company/reads/matter.json`: the objective and `acceptanceCriteria` the work was supposed to meet.
- Any earlier review in `.company/reads/findings.json` (on a re-review, check every earlier finding).

## Procedure

1. Read the objective and acceptance criteria before the code. Write down what "done" means.
2. Read the diff, then the full files it touches. Map entry points (who can call what, with what effect).
3. Run `forge build` and `forge test` yourself. A red suite is a blocking finding on its own.
4. Attack: access control, arithmetic and rounding, reentrancy and callback paths, token quirks
   (fee-on-transfer, 6-decimal stablecoins, missing return values), oracle and price manipulation, signature
   replay, denial of service, and the specific risks of the attached references. For each suspicion,
   write a test locally (do not submit it) or a precise call sequence that shows it.
5. Check the tests: do they assert errors and events, cover revert paths, and fail if the feature is
   removed? Missing coverage of a risky path is a finding.
6. Classify each finding: `severity` (critical, high, medium, low, info) by impact and likelihood, and
   `blocking` true when the work should not be accepted until it is fixed. Everything at high or above is
   blocking; medium is blocking when it breaks an acceptance criterion.
7. Write the verdict: `reject` if any finding is blocking, otherwise `accept`.

## Outputs

`artifacts/review.json`:

```json
{
  "verdict": "accept | reject",
  "summary": "two or three sentences",
  "findings": [
    { "id": "F1", "severity": "high", "title": "Withdraw re-enters before balance update",
      "location": "src/Vault.sol:88", "blocking": true,
      "evidence": "call sequence or test sketch that reproduces it",
      "recommendation": "move the balance write above the external call" }
  ]
}
```

Optionally `artifacts/review.md` with the same content as prose.

## Acceptance checks

1. `no-writes`: only `artifacts/` changed; the reviewed source and tests are byte-identical.
2. `review-report`: `artifacts/review.json` follows the schema; `reject` carries at least one blocking
   finding and `accept` carries none; every `location` names a file that exists in the tree.
3. Every blocking finding's `evidence` lets a third seat reproduce it without asking the reviewer
   (checked by `fix-findings`, which may dispute it, and by the Managing Partner on dispute).
4. On a re-review, every earlier finding id is either closed or repeated (Managing Partner compares).

## Stop and report

Stop and report `blocked` (not a verdict) when the tree under review does not match the commit you were
assigned, when you share a wallet with an author, or when the matter's acceptance criteria are missing so
the work cannot be judged against anything.
