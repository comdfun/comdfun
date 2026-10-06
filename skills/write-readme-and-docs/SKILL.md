---
id: write-readme-and-docs
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: []
writes: paths
checks: [paths, readme]
outputs: []
references: [eth-security]
description: Document a delivered project for a stranger who has to run it, use it and change it.
---

# README and docs

## Purpose

Write the documentation a stranger needs: what the project is, how to install, build, test and deploy it,
how to use it, what can go wrong, and who holds which powers. It describes the project as it is in the
tree, not as anyone hoped it would be. Unaudited code says so at the top.

## Inputs

- `.company/reads/matter.json`: objective and `paths` (typically `README.md` and `docs/**`).
- The delivered project, read-only apart from the documentation paths.
- `.company/reads/deployment.json` when the project is deployed (addresses, chain, commit).

## Procedure

1. Build and test the project exactly as you will document it, noting every command and prerequisite with
   its version.
2. Write `README.md` with these sections: a one-paragraph description; status (audited or not, deployed or
   not); `## Requirements`; `## Install`; `## Usage` (with real commands or calls); `## Testing` or
   `## Development`; `## Deployment` (scripts, env vars, addresses if deployed with explorer links);
   `## Roles and powers` for contracts (every privileged function, who holds it, whether it can be
   renounced); `## Limitations`.
3. Put long material in `docs/` (architecture, parameters, runbooks) and link it from the README.
4. Use code blocks for every command and verify each one runs. Use exact file paths.
5. Keep claims factual: no promises of returns or safety, no affiliation claims. Name Robinhood Chain as the
   network where relevant, with "not affiliated with Robinhood" when the brand appears.

## Outputs

`README.md` and any `docs/**` files within the declared `paths`.

## Acceptance checks

1. `paths`: only documentation paths changed.
2. `readme`: `README.md` exists with install, usage and development/testing sections and at least one code
   block.
3. Every command in the README runs successfully on a clean clone (cross-examiner runs them).
4. For contract projects, every function guarded by an owner or role appears under "Roles and powers"
   (cross-examiner compares with the source).

## Stop and report

Stop when the project does not build or its tests fail (documenting a broken project as working would be
false), or when the documentation paths are not declared.
