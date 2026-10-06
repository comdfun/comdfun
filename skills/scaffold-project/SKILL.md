---
id: scaffold-project
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: [network]
writes: any
checks: [paths, project-build]
outputs: []
references: [eth-testing, better-interface]
description: Build a working project from an empty tree, including its layout, configuration, and the thing itself.
---

# Scaffold a project

## Purpose

Start a new project from nothing: choose the layout, write the configuration, and implement a first
working version of what the objective asks for, so later steps (tests, reviews, refinements) have
something real to work on. The project may be Foundry, a web app, or both in one repository
(`contracts/` + `web/`, or Foundry at the root with a `web/` folder).

## Inputs

- `.company/reads/matter.json`: objective, `acceptanceCriteria`, optional `paths`.
- An empty tree (or one containing only a README or licence).

## Procedure

1. Decide the shape and write it down in `README.md` first: directories, toolchains, how to build and test.
2. Foundry: `foundry.toml` with pinned `solc_version` and `evm_version`, libraries vendored at exact
   commits, `src/`, `test/`, `script/`. Web: Vite + TypeScript, committed lockfile, `build` script that emits
   `dist/`.
3. Implement the core of the objective, not stubs. A scaffold whose functions all `revert("not implemented")`
   is not accepted.
4. Add at least one meaningful test (Foundry) or a build that renders the main page (web).
5. Add `.gitignore` (`out/`, `cache/`, `node_modules/`, `dist/`, `.env`) and `.env.example` when configuration
   is needed.
6. Build everything from a clean clone the way the README says.

## Outputs

The new project tree with `README.md`, configuration, source, and tests or pages.

## Acceptance checks

1. `paths`: changes stay inside the project root (and declared paths, when given).
2. `project-build`: the Clerk builds whatever the project contains: Foundry build and tests pass; the web
   build (if any) succeeds.
3. The README's build commands work verbatim from a clean clone (cross-examiner runs them).
4. No placeholder implementations remain in the core paths (cross-examiner searches for
   `not implemented` and empty bodies).

## Stop and report

Stop when the objective is too large for one step (say which parts and propose a split for the planner),
or when it requires credentials or services the matter does not provide.
