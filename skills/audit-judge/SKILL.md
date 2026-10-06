---
id: audit-judge
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
  - path: artifacts/audit-report.md
    mediaType: text/markdown
    required: true
references: [pashov-skill, solidity-security-review]
description: Merge four specialists' reports, reproduce every claim against the code, and rule on what the author must fix.
---

# Chief justice (audit judge)

## Purpose

The chief justice takes the four specialist reports, removes duplicates, reproduces each claim, and rules.
Specialists are encouraged to report boldly; the judge is paid to be sceptical. The ruling decides whether
the launch may proceed and what `fix-findings` must address. It becomes the public audit record attached
to the launch.

## Inputs

- `.company/reads/specialists/*.json`: the four specialist reports (cross-examination schema with `area`).
- The project at the commit under audit, and `launch.json`.

## Procedure

1. Merge: group findings that describe the same root cause, keep the clearest evidence, and give the merged
   finding a new id (`J1`, `J2`, ...) listing its source ids in the title or evidence.
2. Reproduce each merged finding against the code: follow the call sequence, run the PoC if one is given,
   and read the guarding code. Set `"reproduced": true` only when you confirmed it yourself.
3. Rule on severity independently of what the specialist claimed. Unreproduced findings are not blocking;
   keep them as `info` with `reproduced: false` so the record shows they were considered.
4. Check coverage: compare the four `considered` lists against the launch kind's main risks. If an area
   was not examined, examine it yourself briefly and note it.
5. Verdict: `reject` when any reproduced finding is blocking; otherwise `accept`.
6. Write `artifacts/audit-report.md`: scope (commit, files), method, the Bench (seat ids), a findings table
   (id, severity, status, location), each finding in full, and the coverage note. State plainly that this
   is a review by the swarm and not a guarantee of safety.

## Outputs

- `artifacts/review.json`: cross-examination schema, every finding with `reproduced` (boolean) and
  `sources` (list of specialist finding ids).
- `artifacts/audit-report.md`: the public report described in step 6.

## Acceptance checks

1. `no-writes`: only `artifacts/` changed.
2. `review-report`: schema valid; every finding carries a boolean `reproduced`; the verdict is consistent
   with the blocking findings; locations exist.
3. No finding is blocking unless `reproduced` is true (checked by the Managing Partner before routing to
   `fix-findings`).
4. `artifacts/audit-report.md` contains the scope commit hash and the no-guarantee statement.

## Stop and report

Stop when fewer than four specialist reports are present, when they reviewed different commits, or when a
specialist shares a wallet with an author (the panel is then not independent; report which seat).
