---
id: build-contract-project
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: any
checks: [paths, foundry-build, foundry-test, foundry-sizes]
outputs: []
references: [eth-security, eth-testing, solidity-security-review]
description: Build and test a complete standalone Foundry project from the objective, without assuming a Uniswap hook.
---

# Build a contract project

## Purpose

Deliver a self-contained Foundry project that implements the objective: contracts, tests, a deployment
script and a short README. "Standalone" means it builds from a clean checkout with nothing but Foundry
and the pinned solc, and it does not assume a Uniswap v4 hook, a launch token or our factory unless the
objective asks for them. This is the default step for "write me a contract that does X".

## Inputs

- `.company/reads/matter.json`: `objective`, step `objective`, `acceptanceCriteria`, optional `paths`
  and `contracts` (names or `.sol` paths the matter expects to exist).
- An empty tree, or a base commit when continuing a project.
- Attached references (always read `eth-security`; read `eth-testing` before writing tests).

## Procedure

1. Restate the objective as a list of state variables, roles, external functions and invariants. Put
   that list at the top of `README.md`; it is the contract you are about to write.
2. Lay out the project: `foundry.toml` (pin `solc_version`, `evm_version = "cancun"`, optimizer on,
   `bytecode_hash = "none"`), `src/`, `test/`, `script/`, `remappings.txt` when libraries are used.
   Vendor libraries under `lib/` with an exact commit; do not depend on network installs at build time.
3. Implement in `src/`. Use custom errors, events for every state change a client needs, checks-effects-
   interactions, `SafeERC20` for token transfers, and explicit rounding direction in every division.
   Keep each deployable contract under the EIP-170 runtime limit.
4. Write tests in `test/`: one unit test per external function's success path, one per revert path
   (assert the exact custom error), fuzz tests for arithmetic, and at least one invariant test when the
   contract holds funds. Name them `test_`, `testFuzz_`, `invariant_`.
5. Write `script/Deploy.s.sol` that reads every parameter from env or a JSON file and holds no literal
   keys or addresses.
6. Run `forge fmt`, `forge build`, `forge test --offline` and `forge build --sizes` until clean.

## Outputs

The project tree: `foundry.toml`, `src/**`, `test/**`, `script/Deploy.s.sol`, `README.md`.

## Acceptance checks

1. `paths`: changes stay inside the declared paths (when declared) and nothing outside the project root.
2. `foundry-build`: `forge build` succeeds offline with the pinned compiler.
3. `foundry-test`: `forge test` passes with at least one passing test; every external state-changing
   function has a revert-path test (judged by the test writer or cross-examiner).
4. `foundry-sizes`: every deployable contract fits EIP-170 (24,576 B runtime) and EIP-3860 (49,152 B
   initcode).
5. The README's opening list of roles, functions and invariants matches the code (cross-examiner).

## Stop and report

Stop when the objective needs an external protocol address on a chain the matter does not name, needs
off-chain infrastructure (keepers, oracles) the objective does not provide for, or contradicts itself.
Report the contradiction with the two clauses quoted instead of picking one.
