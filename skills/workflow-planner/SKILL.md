---
id: workflow-planner
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: []
writes: none
checks: [no-writes, workflow-plan]
outputs:
  - path: artifacts/workflow.json
    mediaType: application/json
    required: true
references: [evm-project-launch, custom-token-launch, evm-contracts-launch]
description: Propose a bounded parallel workflow as JSON for Chambers to validate, without executing any of it.
---

# Workflow planner

## Purpose

The Managing Partner turns a plain-language request into a matter: which skills run, in what shape, with
which paths and references. This step writes that proposal as data. It executes nothing, spends nothing
and opens nothing; Chambers validates the plan against the catalog and the request's permissions before
any step is leased.

## Inputs

- `.company/reads/request.json`: `{ "request", "context", "permissions": { "github", "ipfs", "onchain":
  { "kind", "chainId" } } }`.
- `.company/reads/catalog.json`: the live skill catalog (ids, kinds, roles, writes, requires, inference).
- `.company/reads/policies.json`: launch policies, when `permissions.onchain` is set.

## Procedure

1. Classify the request: contracts only, contracts plus launch, website, research, media, or a mix.
   Pick the smallest template that fits (`single`, `impl_tests`, `impl_tests_review`, `multi_contract`,
   `fuzz`, `research`) before considering a custom shape.
2. Choose a shape: `chain` for sequential work, `fan_out_join` when components are independent, `dag` when
   some branches depend on others. At most 6 steps. In a `dag`, every step has a `key` and `dependsOn`, and
   all branches join into one final step.
3. Use only runnable skills as steps and only reference skills in `references` (at most 8). Separate
   authorship: implementation and its tests or review are different steps, so different seats.
4. Give every step that writes with a budget (`writes: paths` skills) its `paths`, at most 16, as narrow
   as possible. Add `acceptanceCriteria` (1–8, each testable).
5. Launch requests: contracts are reviewed (`adversarial-review`) before deployment; exactly one frontend
   step (`frontend-for-contract` or `build-website`) after deployment; hosting only if permitted. The Bench
   (four `audit-specialist` + `audit-judge`) is added by Chambers; do not add it yourself.
6. Write the plan and a short rationale for each step.

## Outputs

`artifacts/workflow.json`:
`{ "draft": { "objective", "shape", "steps": [{ "key", "skill", "dependsOn", "objective", "paths",
"acceptanceCriteria", "references" }], "references", "github", "ipfs", "onchain", "chainId" },
"rationale": [{ "key", "why" }] }`.

## Acceptance checks

1. `no-writes`: only `artifacts/` changed.
2. `workflow-plan`: `artifacts/workflow.json` has a valid `shape`, 1–6 steps, every step skill is runnable,
   and a `dag` joins into exactly one final step with no forward dependencies.
3. Every `writes: paths` skill in the plan has non-empty `paths` (Chambers validation).
4. The plan asks for no permission the request did not grant (Chambers validation).

## Stop and report

Stop when the request is outside what the catalog can do (say which part), when it would need more than
six steps (propose how to split it into continuations), or when it asks for something the firm does not do:
impersonation, fabricated records, or anything that collects credentials.
