---
id: gas-and-size-report
version: 1
kind: runnable
origin: parity
role: tests
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: paths
checks: [paths, foundry-build, foundry-test, foundry-sizes, gas-report]
outputs:
  - path: artifacts/gas-report.json
    mediaType: application/json
    required: true
  - path: artifacts/gas-report.md
    mediaType: text/markdown
    required: false
references: [eth-testing]
description: Measure a project's gas use and contract sizes, record them as artifacts, and refuse contracts that cannot deploy.
---

# Gas and size report

## Purpose

Produce numbers a deployer can rely on: runtime and initcode size of every deployable contract, gas per
external function from the test suite, and the cost of deployment. The report is also a gate: a contract
over the EIP-170 or EIP-3860 limit cannot be deployed on Robinhood Chain or any EVM chain, and this step
says so plainly instead of leaving it to the Registrar to discover.

## Inputs

- `.company/reads/matter.json`: objective and `paths` (normally `artifacts/` plus optional
  `.gas-snapshot`).
- A project that builds and has a test suite.

## Procedure

1. Run `forge build --sizes --json` and record `runtime_size` and `init_size` for each contract. Mark
   test, script and mock contracts as not deployable.
2. Run `forge test --gas-report --offline` and record min/avg/median/max gas for each function of each
   deployable contract. Optionally run `forge snapshot` and commit `.gas-snapshot` if it is in `paths`.
3. Estimate deployment gas per contract from the test traces or a local `forge script` simulation.
4. Write `artifacts/gas-report.json`:
   `{ "solc": "0.8.x", "optimizerRuns": n, "contracts": [{ "name", "runtimeSize", "initcodeSize",
   "deployable": bool, "deployGas" }], "functions": [{ "contract", "function", "min", "avg", "median",
   "max", "calls" }] }`.
   Set `deployable` to false when a size limit is exceeded, and say which.
5. Write `artifacts/gas-report.md` with the same numbers as tables and the three most expensive
   functions with a one-line reason each (storage writes, loops, external calls).

## Outputs

- `artifacts/gas-report.json` (required), schema above.
- `artifacts/gas-report.md` (optional) human summary.

## Acceptance checks

1. `paths`: only artifacts and declared snapshot files changed; source and tests untouched.
2. `foundry-build` and `foundry-test`: the project builds and its suite passes, so the gas numbers come
   from a green suite.
3. `foundry-sizes`: the Clerk's own size measurement agrees that every contract marked deployable is within
   limits.
4. `gas-report`: `artifacts/gas-report.json` lists every deployable contract with integer sizes and a
   boolean `deployable`, plus a `functions` array.
5. Numbers in the markdown summary equal those in the JSON (cross-examiner spot-checks three).

## Stop and report

Stop when the suite is red (report which tests), or when the project has no tests to measure: report that
gas cannot be measured without them instead of inventing numbers.
