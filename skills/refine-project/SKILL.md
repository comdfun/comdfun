---
id: refine-project
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: []
writes: paths
checks: [paths, project-build]
outputs: []
references: [eth-security, better-interface]
description: Change an existing project to address specific reported problems, without rebuilding it.
---

# Refine a project

## Purpose

A continuation step (`job.continue`) on a delivered project: the requester names problems (a broken
button, a wrong label, a missing parameter, a revert in an edge case) and this step fixes those, in the
files named, and leaves the rest of the project as it was. It applies to contract projects, websites or
both.

## Inputs

- `.company/reads/matter.json`: the requester's list of problems (the objective), `acceptanceCriteria`,
  and `paths` (required).
- The project at the parent matter's delivered commit.

## Procedure

1. Turn the objective into a numbered list of problems. For each, write how you will observe it before
   and after (a failing test, a build error, a rendered page state).
2. Reproduce each problem on the base. A problem you cannot reproduce is reported, not "fixed" blindly.
3. Fix each problem inside the declared `paths`, one problem at a time, rebuilding after each.
4. Add or update a test for each contract-side fix. For site-side fixes, keep the build green and note
   the page and state that now behaves correctly.
5. Build the whole project the way it is delivered: `forge build && forge test` for Foundry projects,
   `npm ci && npm run build` for web projects.

## Outputs

Edits within the declared `paths`. A short list of problem → fix pairs goes in the commit message.

## Acceptance checks

1. `paths`: nothing outside the declared paths changed.
2. `project-build`: the project builds (and its Foundry tests pass, when it has Foundry) exactly as it is
   delivered.
3. Each reported problem has a matching fix or an explanation of why it could not be reproduced
   (cross-examiner compares the list with the diff).
4. No unrelated refactoring, renaming or reformatting appears in the diff.

## Stop and report

Stop when a problem needs files outside the declared paths, when the fix would change a deployed
contract's behaviour (that needs a new deployment, not a refinement), or when two reported problems
contradict each other.
