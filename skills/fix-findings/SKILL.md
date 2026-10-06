---
id: fix-findings
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: any
checks: [paths, foundry-build, foundry-test, findings-response]
outputs:
  - path: artifacts/responses.json
    mediaType: application/json
    required: true
references: [eth-security, solidity-security-review]
description: Address exactly the blocking findings of a review, and answer with evidence the ones that do not hold.
---

# Fix findings

## Purpose

After a cross-examination (`adversarial-review`) or an audit panel (`audit-judge`) rejects work, this
step answers each blocking finding: fix it, or dispute it with evidence. It is not a second chance to
redesign. Unrequested changes make the next review longer and are themselves grounds for rejection.

## Inputs

- `.company/reads/findings.json`: `{ "verdict", "findings": [{ "id", "severity", "title", "location",
  "blocking", "evidence", "recommendation" }] }` from the review being answered.
- `.company/reads/matter.json`: objective and `paths` if the matter restricts them.
- The project at the reviewed commit.

## Procedure

1. Reproduce each blocking finding first. Write a test that demonstrates it (it should fail, or show the
   bad state) before changing source. If you cannot reproduce it after a genuine attempt, it is a
   candidate for dispute.
2. Fix each reproduced finding with the smallest change. Keep the reproduction test; it now passes and
   guards the fix.
3. For disputed findings write the reason with evidence: the test that shows the claimed path is
   unreachable, the line that already guards it, or the specification clause that makes it intended.
4. Leave non-blocking findings alone unless the fix is one line and obviously safe; respond to those
   only if you changed something for them.
5. Write `artifacts/responses.json`:
   `{ "responses": [{ "findingId": "F1", "action": "fixed" | "disputed", "detail": "...",
   "tests": ["test/X.t.sol:test_F1_reentrancy"] }] }`.
6. Run the full suite offline.

## Outputs

- Source and test changes.
- `artifacts/responses.json` with one response per blocking finding.

## Acceptance checks

1. `paths`: changes stay within declared paths when the matter declares them.
2. `foundry-build` and `foundry-test`: builds and the full suite passes, including one test per fixed
   finding.
3. `findings-response`: `artifacts/responses.json` answers every blocking finding id from
   `.company/reads/findings.json` with `fixed` or `disputed` and a detail of at least one sentence.
4. The next reviewer can map each `fixed` response to a diff hunk and a test (judged in the re-review).

## Stop and report

Stop when two findings demand contradictory fixes, when a fix requires changing an interface other
contracts depend on outside your paths, or when the findings file is missing or names locations that do
not exist in the tree.
