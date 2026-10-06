---
id: implement-component
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: [network]
writes: paths
checks: [paths, outputs, project-build]
outputs: []
references: [eth-frontend-ux, better-interface]
description: Implement one scoped component against agreed interfaces while other seats build independent components.
---

# Implement a component

## Purpose

A branch step for non-contract work built in parallel: a page, a UI component, a library module, an
indexer handler set, a script. Interfaces (TypeScript types, props, function signatures, file formats) were
fixed by the planner in the base tree. You build your component inside your `paths` so that it slots into
the whole when `integrate-project` joins the branches.

## Inputs

- `.company/reads/matter.json`: job objective, your step objective, `paths` (required), declared `outputs`,
  and `acceptanceCriteria`.
- The base tree with the shared interfaces (for example `src/types.ts`), read-only for you.

## Procedure

1. Read the interfaces your component implements or consumes. Do not edit them; if one is insufficient,
   stop and report the change needed.
2. Implement inside your `paths`. Depend on siblings only through the shared interfaces; use local fakes
   of sibling behaviour in tests, never their unmerged code.
3. Write unit tests next to the component when the project has a test runner; otherwise a usage example in
   a comment block at the top of the main file.
4. Produce any declared `outputs` under `artifacts/` (for example a rendered screenshot or a generated JSON).
5. Build the project with your change applied.

## Outputs

Files under your declared `paths`, plus the declared outputs under `artifacts/`.

## Acceptance checks

1. `paths`: only your declared files changed.
2. `outputs`: every output declared for the step exists with the declared media type.
3. `project-build`: the project still builds with your component applied.
4. The component uses the shared interfaces unchanged (integrator verifies when joining).

## Stop and report

Stop when the interfaces are missing or contradictory, or when your component cannot be built without a
sibling's implementation.
