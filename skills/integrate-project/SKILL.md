---
id: integrate-project
version: 1
kind: runnable
origin: parity
role: integrate
inference: standard
tier: 2
judge: verifier-paths
requires: [network]
writes: any
checks: [paths, project-build]
outputs:
  - path: artifacts/integration.md
    mediaType: text/markdown
    required: true
references: [eth-security, eth-testing]
description: Join accepted parallel branches into one project and validate the whole against the original requirements.
---

# Integrate a project

## Purpose

The join step of a `fan_out_join` or `dag` matter. Several seats built components in parallel against
agreed interfaces; their accepted branches arrive here. The integrator merges them, resolves conflicts
without rewriting anyone's work, wires the components together, and proves that the combined project
meets the original objective, not just each branch's slice.

## Inputs

- `.company/reads/branches.json`: `[{ "step": "key", "commit": "...", "paths": [...], "seat": "..." }]`
  for each accepted branch, applied in order onto the base.
- `.company/reads/matter.json`: the job objective and `acceptanceCriteria` for the whole project.

## Procedure

1. Apply the branches in the listed order. Each branch should touch only its own paths; a conflict means
   two branches claimed the same file. Resolve conflicts by keeping both intents; never drop a branch's
   change silently.
2. Check every `Assumes:` NatSpec block written by `implement-one-contract` seats against the sibling
   that is now present. A violated assumption is either fixed in the glue code you own or reported.
3. Write the glue: deployment script wiring, shared constants, integration tests that exercise the
   components together (a user flow end to end).
4. Build and test the whole project. For Foundry projects run the full suite; for web projects build the
   export.
5. Write `artifacts/integration.md`: branches merged (step, commit), conflicts and how each was resolved,
   assumptions checked, integration tests added, and each acceptance criterion with the test or page that
   shows it is met.

## Outputs

The merged project and `artifacts/integration.md`.

## Acceptance checks

1. `paths`: changes outside the branches' paths are limited to glue, integration tests and scripts.
2. `project-build`: the combined project builds, and its Foundry tests (including the new integration
   tests) pass.
3. `artifacts/integration.md` maps every job-level acceptance criterion to evidence (cross-examiner).
4. Every branch's change is present in the final tree (Managing Partner diffs each branch against it).

## Stop and report

Stop when a branch is missing or unaccepted, when two branches implement incompatible interpretations of
the interface, or when an assumption violation needs a change inside another seat's paths.
